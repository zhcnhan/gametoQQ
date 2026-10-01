/**
 * 种子化随机（策划案 §10：所有随机走种子化 RNG，方便存档一致与调试）。
 * 纯逻辑，不碰 DOM。
 *
 * 用法：整局只维护一个 `number` 型的 seed 游标，凡是要消耗随机数的地方都往下游走，
 * 这样"同一个 seed + 同一串操作 = 同一个结果"，存档天然可复现。
 */

export interface RngCursor {
  /** 当前种子游标，必须随存档一起落盘 */
  state: number;
}

export function createCursor(seed: number): RngCursor {
  return { state: seed >>> 0 };
}

/** mulberry32：32 位状态、分布够好、实现只有几行 */
export function nextFloat(cursor: RngCursor): number {
  let a = (cursor.state + 0x6d2b79f5) >>> 0;
  cursor.state = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** [min, max] 闭区间整数 */
export function nextInt(cursor: RngCursor, min: number, max: number): number {
  if (max < min) throw new Error(`nextInt: max(${max}) < min(${min})`);
  return min + Math.floor(nextFloat(cursor) * (max - min + 1));
}

export function pick<T>(cursor: RngCursor, list: readonly T[]): T {
  if (list.length === 0) throw new Error('pick: 空数组');
  return list[nextInt(cursor, 0, list.length - 1)] as T;
}

/** Fisher-Yates，返回新数组，不改入参 */
export function shuffle<T>(cursor: RngCursor, list: readonly T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(cursor, 0, i);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** 非负整数种子，用于开新局；调用方负责把它写进存档 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
