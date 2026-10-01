/**
 * 全局状态容器（state/ 层）。
 *
 * 契约（提示词 0 第 3 条）：
 *  - ui/ 不允许直接改数据，只能调用 systems/ 暴露的命令函数；
 *  - 命令函数内部通过 `store.commit(mutator)` 一次性改完再落盘，保证"每个玩家动作 = 一个存档点"。
 */
import type { RunState, SaveGame } from '../model/types';
import { createSaveGame, createSaveScheduler, loadSave, touch, type SaveScheduler } from './save';

export type StoreListener = () => void;

export class GameStore {
  private readonly saveGame: SaveGame;
  private readonly scheduler: SaveScheduler;
  private readonly listeners = new Set<StoreListener>();
  /** 每次提交自增，ui 用来判断是否需要重绘（避免无意义 diff） */
  private revision = 0;

  constructor(save: SaveGame, scheduler: SaveScheduler = createSaveScheduler()) {
    this.saveGame = save;
    this.scheduler = scheduler;
  }

  get save(): SaveGame {
    return this.saveGame;
  }

  get run(): RunState {
    const run = this.saveGame.run;
    if (!run) throw new Error('当前没有进行中的对局（run === null）');
    return run;
  }

  get hasRun(): boolean {
    return this.saveGame.run !== null;
  }

  get currentRevision(): number {
    return this.revision;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 唯一的写入口：改完即打时间戳、调度落盘、通知订阅者 */
  commit(mutator: (run: RunState) => void): void {
    const run = this.saveGame.run;
    if (!run) throw new Error('commit 失败：当前没有进行中的对局');
    mutator(run);
    touch(this.saveGame);
    this.revision += 1;
    this.scheduler.schedule(this.saveGame);
    this.notify();
  }

  /** 开新局 / 结束对局（同样立即落盘） */
  replaceRun(run: RunState | null): void {
    this.saveGame.run = run;
    touch(this.saveGame);
    this.revision += 1;
    this.scheduler.schedule(this.saveGame);
    this.notify();
  }

  /** pagehide / visibilitychange 时调用，把待写的档立刻砸进磁盘 */
  flush(): void {
    this.scheduler.flush();
  }

  dispose(): void {
    this.scheduler.dispose();
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * 启动装配：读档 → 有档就用档；没档（或档坏了）就用 factory 开新局。
 * 返回的 store 已经持有已落盘的初始状态。
 */
export function bootstrapStore(factory: () => RunState): GameStore {
  const existing = loadSave();
  if (existing && existing.run) {
    const store = new GameStore(existing);
    store.flush();
    return store;
  }
  const store = new GameStore(existing ?? createSaveGame(null));
  const run = factory();
  // 老档的 meta（图鉴/纪录）要保住，只换 run
  store.replaceRun(run);
  store.flush();
  return store;
}
