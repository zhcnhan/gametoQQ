/**
 * 全局状态容器（state/ 层）。
 *
 * 契约（提示词 0 第 3 条）：
 *  - ui/ 不允许直接改数据，只能调用 systems/ 暴露的命令函数；
 *  - 命令函数内部通过 `store.commit(mutator)` 一次性改完再落盘，保证"每个玩家动作 = 一个存档点"。
 */
import type { MetaProfile, RunState, SaveGame } from '../model/types';
import { SAVE_VERSION, createSaveGame, createSaveScheduler, loadSave, touch, type SaveScheduler } from './save';
import { resolveStorage, type StorageLike } from './storage';

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

  /**
   * 改**跨局账本**（`meta`）的写入口。
   *
   * ## 为什么它必须与 `commit` 分开（而不是让命令层直接摸 `store.save.meta`）
   *
   * `commit` 的契约是"唯一允许的副作用，而且是改 `run`"—— 那是 §1.1 立的分层规矩：
   * 单局状态走一条路，跨局账本走另一条。混在一起会出现一个**很具体的**问题：
   * `commit` 之后 `scheduler.schedule` 会把整份存档（含 meta）写下去，
   * 于是"我到底有没有改 meta"这件事变得无法从调用点看出来 ——
   * 而那正是 codex.ts 当初不得不手写 `store.persistNow()` 的原因。
   *
   * 有了这个入口，"改元数据"是一个**显式的、可搜索的**动作：
   * 谁在改生涯账本，grep `commitMeta` 就全在眼前。
   *
   * ★ 注意它**不 notify**（与 `persistNow` 一致）：meta 的变化全都在
   * `run` 也变了的那一刻发生（结算、买货），那一次 `commit` 已经通知过界面了。
   * 额外通知一次会让界面在同一帧里重绘两遍。
   *
   * ## ★★ 一处必须写明的分层例外（AGENTS.md 说"唯一允许的副作用是 store.commit()"）
   *
   * `systems/` 现在有两处调用它，都是**为了给跨局账本记账**，而且都发生在
   * 一个已经 `commit` 过的命令里：
   *   · `systems/shop.ts` 的 `buyCart` —— 记 `everBoughtItemIds`（成就「先见之明」）；
   *   · `systems/organize.ts` 的 `placeHeld` —— 记 `totalShelved`（成就「仓库管理员」）。
   *
   * 为什么这是对的而不是破例：**它们仍然只经由 store 写状态**（没碰 DOM、
   * 没碰 localStorage、没绕过存档），而那两条规矩（`systems/` 不许碰 DOM、
   * 只有 `storage.ts` 碰 localStorage）一条都没破。多出来的只是"这次要写的
   * 是跨局账本而不是单局状态"。
   *
   * 如果哪天要再加一处，先问一句：这个数**是不是真的跨局**？
   * 单局能回答的东西一律走 `run`（那才是 `commit` 的正路）——
   * 这正是我一开始把 `boughtItemIds` 加进 `RunState` 又删掉的原因：
   * 成就只问"这辈子买过吗"，所以它本来就不该有一个单局的副本。
   */
  commitMeta(mutator: (meta: SaveGame['meta']) => void): void {
    mutator(this.saveGame.meta);
    this.saveGame.meta.version = SAVE_VERSION;
    touch(this.saveGame);
    this.revision += 1;
    this.scheduler.schedule(this.saveGame);
  }

  /**
   * 读档后立即把（可能刚迁移过的）存档落盘。
   * 注意 flush() 只在"有待写内容"时才有写动作，所以这里必须显式 schedule 一次，
   * 否则 v1 → v2 这类 schema 升级只活在内存里，每次开页面都要重迁一遍。
   */
  persistNow(): void {
    touch(this.saveGame);
    this.revision += 1;
    this.scheduler.schedule(this.saveGame);
    this.scheduler.flush();
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
 *
 * ## ★ 为什么 `factory` 要收一个 `meta`（M4 决策 A）
 *
 * 开新局这一步从 M4 起要读**跨局账本**：这一局抽到哪一场灾难由 tier 阶梯决定
 * （撑过几次 / 见过几场，见 `data/disaster.ts` 的 `DISASTER_TIER_GATES`）。
 * 而 `meta` 恰好是 `bootstrapStore` 手里有、调用方拿不到的那个东西 ——
 * 让调用方自己去 `loadSave()` 再读一遍，等于把"哪一个 meta 才是权威"
 * 变成两个答案（§2.8 的老毛病）。
 *
 * 旧签名 `() => RunState` 仍然成立（多余参数可以忽略），所以测试里的
 * `() => createStartingRun(1)` 一个字都不用改。
 */
export function bootstrapStore(
  factory: (meta: MetaProfile) => RunState,
  storage: StorageLike = resolveStorage()
): GameStore {
  const existing = loadSave(storage);
  if (existing && existing.run) {
    const store = new GameStore(existing, createSaveScheduler(storage));
    // 迁移立刻落盘，别让"版本升级"只活在内存里
    store.persistNow();
    return store;
  }
  const save = existing ?? createSaveGame(null);
  const store = new GameStore(save, createSaveScheduler(storage));
  const run = factory(save.meta);
  // 老档的 meta（图鉴/纪录）要保住，只换 run
  store.replaceRun(run);
  store.flush();
  return store;
}
