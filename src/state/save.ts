/**
 * 存档读写（§4A：每个动作完成即写 localStorage，debounce ≤ 300ms）。
 *
 * 职责边界：
 *  - 只负责"序列化 / 校验 / 迁移 / 落盘节流"，不认识任何玩法规则；
 *  - 不直接摸 window，介质由 state/storage.ts 注入。
 */
import { BOX_DEFS } from '../data/boxes';
import { FIRST_STOCKPILE_DAY, SURVIVAL_DAYS } from '../data/disaster';
import { IDENTITY_DEFS, hasIdentityDef } from '../data/identities';
import { ACTION_POINTS_PER_DAY } from '../data/shops';
import type { GamePhase, ItemStack, MetaProfile, RunState, SaveGame, UnpackBox, Zone } from '../model/types';
import { createMemoryStorage, resolveStorage, type StorageLike } from './storage';

export const STORAGE_KEY = 'tunhuo.save';
/**
 * 当前 schema 版本。
 *  - v1：M0 首版（待拆箱是 `ItemStack[][]`）
 *  - v2：待拆箱升级为 `UnpackBox[]`（稳定 id + 箱型），"放回原箱"才可能是对的
 *  - v3：分区收敛为"胶带"（名字 + 颜色），剥掉存量存档里的 autoAccept 规则声明
 *  - v4：M1 囤货期（状态机 + 采购）—— 补行动点/车载/当日库存四个字段，
 *        并把 M0 的 `day: 0`（占位）迁成"囤货期最后一天" `-1`
 *  - v5（规划中）：M3 图鉴 MetaProfile 扩展
 */
export const SAVE_VERSION = 4;
/** 落盘节流上限（提示词 0：debounce ≤ 300ms） */
export const SAVE_DEBOUNCE_MS = 250;

function createDeviceId(): string {
  let id = '';
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 10; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `dev_${id}`;
}

export function createMetaProfile(): MetaProfile {
  return {
    version: SAVE_VERSION,
    identityLevels: {},
    codex: { items: [], disasters: [], npcs: [] },
    bestSurvivalDays: {}
  };
}

export function createSaveGame(run: RunState | null): SaveGame {
  return {
    meta: createMetaProfile(),
    run,
    savedAt: Date.now(),
    syncVersion: 1,
    deviceId: createDeviceId()
  };
}

/** 写盘前统一"打时间戳 + 递增 syncVersion"（§4A：冲突时取 syncVersion 大者） */
export function touch(save: SaveGame): SaveGame {
  save.savedAt = Date.now();
  save.syncVersion += 1;
  save.meta.version = SAVE_VERSION;
  return save;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * 迁移入口：把任意版本的原始 JSON 抬到当前 SAVE_VERSION。
 * version 缺失 → 视为 0（最早期裸档），补默认字段后进入 1。
 * 无法识别（未来版本 / 结构崩坏）→ 返回 null，由调用方开新局，绝不抛异常。
 */
export function migrate(raw: unknown): SaveGame | null {
  if (!isObject(raw)) return null;
  const rawMeta = isObject(raw.meta) ? raw.meta : {};
  const declared =
    typeof rawMeta.version === 'number'
      ? rawMeta.version
      : typeof raw.version === 'number'
        ? raw.version
        : 0;
  if (declared > SAVE_VERSION) return null; // 未来版本存档，本端不认，避免写坏别人的档

  const meta: MetaProfile = {
    ...createMetaProfile(),
    ...(rawMeta as Partial<MetaProfile>)
  };

  let run: RunState | null = null;
  if (isObject(raw.run)) {
    run = raw.run as unknown as RunState;
  }

  let save: SaveGame = {
    meta,
    run,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    syncVersion: typeof raw.syncVersion === 'number' ? raw.syncVersion : 1,
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : createDeviceId()
  };

  if (declared < 1) save = migrateV0ToV1(save);
  if (declared < 2) save = migrateV1ToV2(save);
  if (declared < 3) save = migrateV2ToV3(save);
  if (declared < 4) save = migrateV3ToV4(save);
  return normalizeRun(save);
}

/**
 * v3 → v4：M0 单页整理 → M1 囤货期。迁移做三件事，每一件都有明确理由：
 *
 * 1) 补 4 个囤货期字段（行动点 / 车载 / 当日库存 / 当日已访点位）。
 * 2) `day` 归一化。M0 把 `day` 恒写成 0 表示"整理中"，而 M1 的 0 是 **D-Day（灾难降临日）** ——
 *    若照搬，老玩家一读档就直接被判定"灾难已经降临"，会当场跳结算。
 *    故按"囤货期最后一天"(`-1`) 迁：整理的成果一件不丢，还能再采买一天，然后正常迎接 D-Day。
 * 3) 身份与现金落地。M0 的 `identityId: 'default'` / `cash: 0` 都是占位，
 *    `getIdentityDef('default')` 会抛异常；补成第一个真身份并按它的 startCash 发钱。
 */
export function migrateV3ToV4(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    if (!hasIdentityDef(run.identityId)) {
      const fallback = IDENTITY_DEFS[0];
      if (fallback) {
        run.identityId = fallback.id;
        if (!run.cash) run.cash = fallback.startCash;
      }
    }
    if (run.phase === 'organize' && run.day >= 0) run.day = -1;
    if (typeof run.actionPoints !== 'number') run.actionPoints = ACTION_POINTS_PER_DAY;
    if (typeof run.carLoad !== 'number') run.carLoad = 0;
    run.shopStocks = asArray(run.shopStocks);
    run.visitedShopIds = asArray(run.visitedShopIds);
    if (typeof run.currentShopId !== 'string') run.currentShopId = null;
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v2 → v3：M0 界面撤掉了"本区接收"这类规则声明。若保留存量规则，它仍会参与归位率计算，
 * 玩家会看到归位率莫名掉到 0%（而他明明没做过什么）。所以迁移时统一剥掉 autoAccept。
 * 字段本身留在 §7 的类型里，M1 生存期的自动取用要用时再启用。
 */
export function migrateV2ToV3(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    for (const zone of asArray<Zone>(run.zones)) {
      if (isObject(zone) && 'autoAccept' in zone) delete (zone as { autoAccept?: unknown }).autoAccept;
    }
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v1 → v2：待拆箱从 `ItemStack[][]` 升级为 `UnpackBox[]`。
 * 老档里箱子只有下标没有身份，迁移时按出现顺序补 `box_1..n` 与对应箱型 —— 内容一件不丢。
 */
export function migrateV1ToV2(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    const raw = asArray<unknown>(run.boxesToUnpack);
    run.boxesToUnpack = raw.map((box, index) => {
      if (Array.isArray(box)) {
        return {
          id: `box_${index + 1}`,
          defId: BOX_DEFS[index % BOX_DEFS.length]?.id ?? 'box_mixed',
          items: box as ItemStack[]
        } satisfies UnpackBox;
      }
      return box as UnpackBox;
    });
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

const PHASES: readonly GamePhase[] = [
  'prologue',
  'stockpile_shop',
  'organize',
  'night',
  'survival_day',
  'help_request',
  'ending'
];

/**
 * 收尾净化：把任何来源（迁移产物 / 被人手改过的档 / 版本号撒谎的档）整成"界面一定接得住"的形态。
 * 原则同 v2 时代：宁可退回新局，也不让 UI 崩在一个 undefined 上。
 */
function normalizeRun(save: SaveGame): SaveGame | null {
  if (!save.run) return save;
  const run = save.run;
  if (!Array.isArray(run.shelves) || !Array.isArray(run.zones) || !Array.isArray(run.boxesToUnpack)) {
    return { ...save, run: null };
  }
  run.zones = asArray(run.zones);
  run.log = asArray(run.log);
  run.trust = isObject(run.trust) ? (run.trust as Record<string, number>) : {};
  if (typeof run.seed !== 'number') run.seed = Date.now() >>> 0;
  // 兜底：任何非 UnpackBox 形态的箱（例如手改过的档）一律丢弃，宁可开新局也不让 UI 崩
  run.boxesToUnpack = asArray<unknown>(run.boxesToUnpack).filter(
    (box): box is UnpackBox => isObject(box) && typeof box.id === 'string' && Array.isArray(box.items)
  );

  // ———————— M1 囤货期字段 ————————
  if (!PHASES.includes(run.phase)) run.phase = 'stockpile_shop';
  if (typeof run.day !== 'number' || !Number.isFinite(run.day)) run.day = FIRST_STOCKPILE_DAY;
  run.day = Math.min(SURVIVAL_DAYS, Math.max(FIRST_STOCKPILE_DAY, Math.round(run.day)));
  if (typeof run.actionPoints !== 'number') run.actionPoints = ACTION_POINTS_PER_DAY;
  run.actionPoints = Math.max(0, Math.round(run.actionPoints));
  if (typeof run.carLoad !== 'number') run.carLoad = 0;
  run.carLoad = Math.max(0, run.carLoad);
  run.shopStocks = asArray<RunState['shopStocks'][number]>(run.shopStocks).filter(
    (s) => isObject(s) && typeof s.shopId === 'string' && Array.isArray(s.lines)
  );
  run.visitedShopIds = asArray<string>(run.visitedShopIds).filter((v) => typeof v === 'string');
  run.currentShopId = typeof run.currentShopId === 'string' ? run.currentShopId : null;

  // 状态一致性：day 已经走到灾难日（>= 0），就不该还停在囤货期的三个界面上，
  // 否则玩家点"过一天"会原地打转，而且永远见不到 D-Day。
  if (run.day >= 0 && (run.phase === 'stockpile_shop' || run.phase === 'organize' || run.phase === 'night')) {
    run.phase = 'ending';
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/** v0（无 version 字段的裸档）→ v1：补齐 seed / stats / 订单计数等 */
export function migrateV0ToV1(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    if (typeof run.seed !== 'number') run.seed = save.savedAt >>> 0;
    if (!isObject(run.stats)) {
      run.stats = { health: 100, mood: 70, stamina: 100, shelter: 100 };
    }
    if (typeof run.deliveredOrders !== 'number') run.deliveredOrders = 0;
    if (!run.phase) run.phase = 'organize';
    if (typeof run.day !== 'number') run.day = 0;
    if (!run.identityId) run.identityId = 'default';
    if (!run.disasterId) run.disasterId = 'cold_snap';
    if (typeof run.cash !== 'number') run.cash = 0;
    run.zones = asArray<RunState['zones'][number]>(run.zones);
    run.log = asArray<string>(run.log);
    run.boxesToUnpack = asArray<RunState['boxesToUnpack'][number]>(run.boxesToUnpack);
  }
  save.meta = { ...createMetaProfile(), ...save.meta };
  save.meta.version = SAVE_VERSION;
  return save;
}

export function serialize(save: SaveGame): string {
  return JSON.stringify(save);
}

export function deserialize(raw: string | null): SaveGame | null {
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadSave(storage: StorageLike = resolveStorage()): SaveGame | null {
  return deserialize(storage.getItem(STORAGE_KEY));
}

export function writeSave(save: SaveGame, storage: StorageLike = resolveStorage()): void {
  try {
    storage.setItem(STORAGE_KEY, serialize(save));
  } catch {
    // 配额满/隐私模式：静默失败，内存态继续玩，不打断
  }
}

export function clearSave(storage: StorageLike = resolveStorage()): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 落盘调度器：合并 300ms 内的连续动作成一次写盘，同时提供 flush()
 * 给 pagehide/visibilitychange 用 —— 关标签页那一刻也必须无损。
 */
export interface SaveScheduler {
  schedule(save: SaveGame): void;
  flush(): void;
  dispose(): void;
  readonly pending: boolean;
}

export function createSaveScheduler(
  storage: StorageLike = resolveStorage(),
  delayMs: number = SAVE_DEBOUNCE_MS
): SaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty: SaveGame | null = null;

  const writeNow = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (dirty) {
      writeSave(dirty, storage);
      dirty = null;
    }
  };

  return {
    schedule(save) {
      dirty = save;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(writeNow, delayMs);
    },
    flush: writeNow,
    dispose() {
      writeNow();
    },
    get pending() {
      return dirty !== null;
    }
  };
}

export { createMemoryStorage };
