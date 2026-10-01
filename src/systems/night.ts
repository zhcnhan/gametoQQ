/**
 * 夜间事件（§6.2「夜间小事件」）—— **纯逻辑部分**。
 *
 * 这个文件只回答两个问题：
 *   1. 今晚有没有事？（`rollNight`，种子化）
 *   2. 选完之后世界变成什么样？（`applyNightEffect`）
 *
 * 它**不碰 store**。命令（`chooseNightOption` / `sleep`）放在 `systems/phases.ts` ——
 * 因为它们要和 `endDay` 一起维护状态机，放在同一处才不会出现"两个文件各推一次日历"的裂缝。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 */
import { getBoxDef } from '../data/boxes';
import { NIGHT_EVENT_DEFS, NIGHT_SLEEP } from '../data/nightEvents';
import { nextFloat, pick, type RngCursor } from '../model/rng';
import type { NightEffect, NightEventDef, NightOption, RunState } from '../model/types';
import { generateBoxStacks, nextBoxSeq } from './setup';

/**
 * 有事件的夜晚占比。
 * 已拍板：约 60% 的天有事 —— 有些夜晚直接跳过，节奏更松弛，也让事件显得更像"意外"
 * 而不是"每晚的例会"。种子化决定，同 seed 同结果。
 */
export const NIGHT_EVENT_CHANCE = 0.6;

/** 今晚有事吗？有则返回事件 id，没有返回 null。消耗一次 RNG */
export function rollNight(cursor: RngCursor): string | null {
  if (nextFloat(cursor) >= NIGHT_EVENT_CHANCE) return null;
  return pick(cursor, NIGHT_EVENT_DEFS).id;
}

/**
 * 取第 `choice` 个选择对应的选项。
 * `NIGHT_SLEEP` 与越界下标都返回 null —— 调用方据此走"什么都不做"的分支（后果为空）。
 */
export function optionAt(def: NightEventDef, choice: number): NightOption | null {
  if (choice === NIGHT_SLEEP) return null;
  return def.options[choice] ?? null;
}

const STAT_MIN = 0;
const STAT_MAX = 100;

/** 四维状态都夹在 0..100；现金夹在 ≥ 0（不给人欠债，M1 不做负债玩法） */
function shiftStat(value: number, delta: number): number {
  return Math.max(STAT_MIN, Math.min(STAT_MAX, value + delta));
}

/**
 * 把选项后果落到状态上。
 * 注意它**只做加法**：夜间的选项效果一律是"交换"，不做条件判定 ——
 * §6.2 的夜间是"可选行动"，不是"必须解决的难题"，弄成条件链会变成考试。
 *
 * DEFERRED(D-09): 四维状态在 M1 里**只减不增** —— 这里是主要的扣减来源，
 * 而整个里程碑没有恢复途径（每日结算属阶段 C）。所以这些数字在 M1 里不影响任何事。
 * 不要因为"体力只降不升看起来不对"就在这里加一个恢复项。
 */
export function applyNightEffect(run: RunState, effect: NightEffect, cursor: RngCursor): void {
  if (effect.cash) run.cash = Math.max(0, run.cash + effect.cash);
  if (effect.health) run.stats.health = shiftStat(run.stats.health, effect.health);
  if (effect.mood) run.stats.mood = shiftStat(run.stats.mood, effect.mood);
  if (effect.stamina) run.stats.stamina = shiftStat(run.stats.stamina, effect.stamina);
  if (effect.shelter) run.stats.shelter = shiftStat(run.stats.shelter, effect.shelter);
  if (effect.boxDefId) {
    const def = getBoxDef(effect.boxDefId);
    // 批次到期日以**当前天**为基准，与白天采购一致（同一套 FEFO 尺子）
    run.boxesToUnpack.push({
      id: `box_${nextBoxSeq(run.boxesToUnpack)}`,
      defId: def.id,
      items: generateBoxStacks(cursor, def, run.day)
    });
  }
}

/**
 * 后果的人话摘要，给界面显示。
 * 返回空数组 = 什么都没变（"直接睡"就是这种情况），界面据此不渲染数值行。
 */
export function describeEffect(effect: NightEffect): string[] {
  const parts: string[] = [];
  const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
  if (effect.cash) parts.push(`现金 ${signed(effect.cash)}`);
  if (effect.health) parts.push(`健康 ${signed(effect.health)}`);
  if (effect.mood) parts.push(`心情 ${signed(effect.mood)}`);
  if (effect.stamina) parts.push(`体力 ${signed(effect.stamina)}`);
  if (effect.shelter) parts.push(`庇护所 ${signed(effect.shelter)}`);
  if (effect.boxDefId) parts.push('带回来一箱货');
  return parts;
}
