/**
 * 存档读写（§4A：每个动作完成即写 localStorage，debounce ≤ 300ms）。
 *
 * 职责边界：
 *  - 只负责"序列化 / 校验 / 迁移 / 落盘节流"，不认识任何玩法规则；
 *  - 不直接摸 window，介质由 state/storage.ts 注入。
 */
import type { MetaProfile, RunState, SaveGame } from '../model/types';
import { createMemoryStorage, resolveStorage, type StorageLike } from './storage';

export const STORAGE_KEY = 'tunhuo.save';
/** 当前 schema 版本。M3 会升到 2（图鉴 MetaProfile 扩展），届时在这里加迁移函数。 */
export const SAVE_VERSION = 1;
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

  const save: SaveGame = {
    meta,
    run,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    syncVersion: typeof raw.syncVersion === 'number' ? raw.syncVersion : 1,
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : createDeviceId()
  };

  if (declared < 1) return migrateV0ToV1(save);
  return normalizeV1(save);
}

function normalizeV1(save: SaveGame): SaveGame | null {
  if (!save.run) return save;
  const run = save.run;
  if (!Array.isArray(run.shelves) || !Array.isArray(run.zones) || !Array.isArray(run.boxesToUnpack)) {
    return { ...save, run: null };
  }
  run.zones = asArray(run.zones);
  run.log = asArray(run.log);
  run.trust = isObject(run.trust) ? (run.trust as Record<string, number>) : {};
  if (typeof run.seed !== 'number') run.seed = Date.now() >>> 0;
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
