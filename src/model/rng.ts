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

/** 带权条目：`weight <= 0` 的条目永远不会被抽到（用于"这个点位抽不到它"） */
export interface Weighted<T> {
  item: T;
  weight: number;
}

/**
 * 按权重抽一个。**与 `pick` 一样只消耗一次随机数**，所以两者可以互换而不影响存档回放。
 *
 * 权重非正的条目直接剔除；全都被剔除时返回 null（调用方据此走"今天没有这件事"）。
 *
 * ★ 它是"事件不要重复"的落点：把最近出过的那几条权重调低，
 * 就能在不改变"一次抽签"这个性质的前提下拉开间隔。
 * 用"先掷概率再抽"的两段式也能做到，但那样一次事件要消耗两个随机数，
 * 而"某一天有没有事"就不再只依赖一个数了（回放与调试都会变难）。
 */
export function pickWeighted<T>(cursor: RngCursor, entries: readonly Weighted<T>[]): T | null {
  const live = entries.filter((e) => e.weight > 0);
  if (live.length === 0) return null;
  const total = live.reduce((n, e) => n + e.weight, 0);
  let roll = nextFloat(cursor) * total;
  for (const entry of live) {
    roll -= entry.weight;
    if (roll < 0) return entry.item;
  }
  // 浮点尾巴：落在最后一条上
  return (live[live.length - 1] as Weighted<T>).item;
}

/**
 * 一条事件最近出现过几次（越靠前越近）。用来算"重复惩罚"。
 *
 * `history` 存的是**事件 id 的近期序列**（最新在前），由调用方随存档落盘。
 */
export function recentCount(history: readonly string[], id: string): number {
  return history.filter((h) => h === id).length;
}

/**
 * 抽一条事件，**上一条刚出过的那条不会再出**（其余等权）。
 *
 * ## 为什么只排除"上一条"，而且排得干脆
 *
 * 玩家的反馈是"重复太多"（求援池 6 单、每天 45%、均匀随机 → 同一个 NPC
 * 前后两次问同一件事的概率是 50%）。修法有两条路：
 *
 *  · **软性压权重**（把最近 N 条压到 15%）：分布更平滑，但"连着两次同一件事"
 *    仍然会发生 —— 算下来大约每 12 次抽签就撞一次，玩家照样会觉得重复；
 *  · **硬性排除上一条**（这里选的）：**连着两次同一件事的概率是 0**，
 *    而池子里还剩 5 条可选，随机性一点没少。间隔拉开到"至少隔一次"就够消除
 *    "又是这件事"的观感了，再多排除反而会让后面几次变得可预测。
 *
 * 所以口径是：**只排除紧邻的上一条，而且排得干净**。这也是"别连着又来"这句话
 * 唯一能保证的实现方式 —— 概率压低只是让它变少，不是让它不发生。
 *
 * 抽签仍然只吃一个随机数，所以"某一天有没有事"仍然只依赖一个数（回放与调试不变）。
 *
 * @param history 近期已出的事件 id（**最新在前**），由调用方维护与落盘
 * @param weightOf 条目权重（`<= 0` 的直接剔除，用于"这个点位抽不到它"）
 */
export function pickEventAvoidingRecent<T extends { id: string }>(
  cursor: RngCursor,
  defs: readonly T[],
  history: readonly string[],
  weightOf: (def: T) => number
): T | null {
  const last = history[0];
  const pool = defs.filter((d) => d.id !== last);
  // 池子只有一条时（不可能发生，但别让兜底变成崩）退化成全池
  const usable = pool.length > 0 ? pool : defs;
  return pickWeighted(cursor, usable.map((item) => ({ item, weight: weightOf(item) })));
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
