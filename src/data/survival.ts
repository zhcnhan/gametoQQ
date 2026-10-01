/**
 * 生存期数值（§8「MVP 刻意压简，先求闭环」）。
 *
 * 集中放一个文件，是为了让"数值平衡"这件事将来只需要改一处 ——
 * §8 只给了「每日基础消耗 食物 2 / 水 2 / 燃料(寒潮) 2」一行，
 * 其余全是我按"能跑通闭环"定的初始值。**这些数字都还没有经过一轮完整的手感验证**，
 * 第一次调平衡时请直接改这里，不要去 systems/ 里找。
 *
 * 一条贯穿始终的原则：**代价都是可逆的缓慢下降，不是死亡判定**。
 * §12.3 明确写了「弹尽粮绝不死人，进入'硬撑'状态（心情/健康缓降），永远留逆转口」，
 * 所以这里没有任何"归零即结束"的数值。
 */
import type { CategoryId, DisasterProfile, SurvivalSnapshot } from '../model/types';

/** `SurvivalState.last` 的零值（D-Day 还没结算过时用它） */
export const EMPTY_SURVIVAL_SNAPSHOT: SurvivalSnapshot = {
  health: 0,
  mood: 0,
  stamina: 0,
  shelter: 0,
  shortage: 0,
  spoiled: 0
};

/** §8：每日基础消耗（件）。灾难独有的加成由 `DisasterProfile.dailyDrain` 叠加 */
export const BASE_DRAIN: Readonly<Partial<Record<CategoryId, number>>> = { food: 2, water: 2 };

/** 睡一觉恢复的体力 */
export const STAMINA_RECOVER = 15;

/** 庇护所每天被灾难磨损 = 灾难强度 × 这个数（寒潮强度 0.55~1.0 → 每天 -4.4 ~ -8） */
export const SHELTER_WEAR_PER_SEVERITY = 8;

/** 缺货一天的代价（缺口越大越疼，但有上限，避免一次断粮直接判死） */
export const SHORTAGE_HEALTH = 6;
export const SHORTAGE_MOOD = 8;
export const SHORTAGE_STAMINA = 5;
/** 缺货疼痛的封顶倍率：缺口是 1 件还是 10 件，最多差这么多倍 */
export const SHORTAGE_MAX_STACK = 3;

/** 每天的心情修正上限，防止心情在长局里被单一因子拉爆或砸穿 */
export const MOOD_DELTA_CAP = 12;

/**
 * 当天要消耗的品类与件数。
 * ⚠ 消耗按**件数**，不读 `ItemDef.nutrition` —— 已拍板（见策划案 §6.4 与 §8 的拍板标注）：
 * 燃料走件数消耗，其余品类一并沿用同一把尺子，避免"半袋大米"这种需要拆分的算法。
 * `nutrition` 因此暂时是个没人读的字段，记在 src/meta/deferred.ts 的 D-07 里。
 */
export function dailyDrainOf(disaster: DisasterProfile): { category: CategoryId; need: number }[] {
  const merged = new Map<CategoryId, number>();
  for (const [category, need] of Object.entries(BASE_DRAIN) as [CategoryId, number][]) {
    merged.set(category, (merged.get(category) ?? 0) + need);
  }
  for (const [category, need] of Object.entries(disaster.dailyDrain) as [CategoryId, number][]) {
    merged.set(category, (merged.get(category) ?? 0) + need);
  }
  return [...merged.entries()]
    .filter(([, need]) => need > 0)
    .map(([category, need]) => ({ category, need }));
}

/**
 * 归位率带来的心情修正 —— 这是"整理即战力"在生存期的**软性**兑现：
 * 东西都在自己该在的地方，闭着眼也拿得到；满屋翻找则会一天天磨掉耐心。
 *
 * 为什么不给硬性惩罚（比如"没归位就多消耗一件"）：那会让玩家在整理期被迫做减法，
 * 与 §5 引擎①「游戏不评判对错」相冲。心情是代价，不是判罚。
 */
export function moodFromPlacement(placement: number): number {
  if (placement >= 0.8) return 4;
  if (placement >= 0.5) return 1;
  if (placement > 0) return -2;
  return -4;
}
