/**
 * 生存期每日结算（§6.4）。
 *
 * 一天只结算一次，结算只发生在这个文件里。顺序**不能改**：
 *
 *   ① 腐坏  —— 烂掉的不能吃。必须在消耗之前清，否则玩家会"吃到"当天已经过期的东西。
 *   ② 消耗  —— 按 `data/survival.dailyDrainOf()` 的品类与件数，走 `model/consume` 的 FEFO 取用。
 *   ③ 四维  —— 睡觉恢复体力、灾难磨损庇护所、整理质量影响心情、缺货扣健康。
 *   ④ 记账  —— 写进 `run.log`（阶段 E 的日报按 'D+3 · ' 前缀分组）与 `run.survival` 累计。
 *
 * 关于 `settleSurvivalDay` 的**幂等性**：它自己不判断"今天算过没有"。
 * 幂等由调用方（`systems/phases.ts` 的 `startSurvival` / `advanceSurvivalDay`）保证 ——
 * 那两个命令在推进 `day` 的同一次 `store.commit` 里调用它，所以"day 变了"就必然"刚算过"。
 * 用状态而不是标志位来保证幂等，比多存一个布尔量可靠。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 */
import { dayLabel, severityAt } from '../model/calendar';
import { consumeCategory } from '../model/consume';
import { computeOrganizeScore } from '../model/score';
import { spoilEverything, virtualDay } from '../model/spoil';
import { getDisasterDef } from '../data/disaster';
import { CATEGORY_LABELS, getItemDef } from '../data/items';
import {
  MOOD_DELTA_CAP,
  SHELTER_WEAR_PER_SEVERITY,
  SHORTAGE_HEALTH,
  SHORTAGE_MAX_STACK,
  SHORTAGE_MOOD,
  SHORTAGE_STAMINA,
  STAMINA_RECOVER,
  dailyDrainOf,
  moodFromPlacement
} from '../data/survival';
import type { CategoryId, RunState } from '../model/types';

export interface DrainLine {
  category: CategoryId;
  need: number;
  taken: number;
  shortage: number;
  batches: { itemId: string; count: number; expiresAtDay: number | null; from: 'shelf' | 'box' }[];
  /** 其中有多少件是从**没拆的纸箱**里翻出来的（"整理得好"和"没整理"的体感差别就在这儿） */
  fromBoxes: number;
}

export interface SurvivalReport {
  day: number;
  severity: number;
  drains: DrainLine[];
  spoiled: { itemId: string; count: number }[];
  /** 今天坏掉的总件数 */
  spoiledToday: number;
  deltas: { health: number; mood: number; stamina: number; shelter: number };
  /** 结算后的整理体检（心情修正就是按它算的，界面要能解释"为什么心情涨了"） */
  placement: number;
  fefo: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 结算生存期第 `run.day` 天。**就地修改 run**（调用方负责包在 store.commit 里）。
 * @returns 一份给界面看的报告 —— 表现层不认识规则，只显示这份报告。
 */
export function settleSurvivalDay(run: RunState): SurvivalReport {
  const disaster = getDisasterDef(run.disasterId);
  const severity = severityAt(disaster, run.day);
  // 腐坏按"虚拟天"推进：寒潮 spoilRate=0.5 时它跑得比真实天慢（等于全屋成了冷库）
  const vDay = virtualDay(run.day, disaster.spoilRate);

  // ① 腐坏：货架 + 还没拆的纸箱一起算（纸箱不是冰箱）
  const sweep = spoilEverything(run.shelves, run.boxesToUnpack, vDay);
  run.shelves = sweep.shelves;
  run.boxesToUnpack = sweep.boxes;
  run.survival.spoiled += sweep.total;

  // ② 消耗：FEFO 取用（归位货架优先）
  const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack);
  const drains: DrainLine[] = [];
  let shortageUnits = 0;
  let fromBoxes = 0;
  for (const { category, need } of dailyDrainOf(disaster)) {
    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, category, need);
    run.shelves = result.shelves;
    run.boxesToUnpack = result.boxes;
    drains.push({
      category,
      need,
      taken: result.taken,
      shortage: result.shortage,
      batches: result.batches,
      fromBoxes: result.fromBoxes
    });
    shortageUnits += result.shortage;
    fromBoxes += result.fromBoxes;
  }

  // ③ 四维
  const deltas = { health: 0, mood: 0, stamina: 0, shelter: 0 };
  deltas.stamina += STAMINA_RECOVER;
  deltas.shelter -= Math.round(severity * SHELTER_WEAR_PER_SEVERITY);
  deltas.mood += moodFromPlacement(score.placement);
  // DEFERRED(D-09): 健康在这里只会往下走。
  // 阶段 C 给了体力（睡觉 +15）与心情（归位率加成）完整的增减，但健康既没有自然恢复，
  // 也没有人读 `ItemDef.nutrition.health`（绷带 2 / 感冒药 3）。
  // 它的另一半是阶段 D 的应急取用（§5：急救品放顺手位 → 突发事件不掉健康）与"用药"。
  if (shortageUnits > 0) {
    const pain = Math.min(SHORTAGE_MAX_STACK, shortageUnits);
    deltas.health -= SHORTAGE_HEALTH * pain;
    deltas.mood -= SHORTAGE_MOOD * pain;
    deltas.stamina -= SHORTAGE_STAMINA * pain;
    run.survival.shortageDays += 1;
  }
  deltas.mood = clamp(deltas.mood, -MOOD_DELTA_CAP, MOOD_DELTA_CAP);

  run.stats.health = clamp(run.stats.health + deltas.health, 0, 100);
  run.stats.mood = clamp(run.stats.mood + deltas.mood, 0, 100);
  run.stats.stamina = clamp(run.stats.stamina + deltas.stamina, 0, 100);
  run.stats.shelter = clamp(run.stats.shelter + deltas.shelter, 0, 100);

  // 落盘一份增量快照：刷新回来还要能看见"今天掉了哪些点"（§4A 恢复即续玩）
  run.survival.last = {
    health: deltas.health,
    mood: deltas.mood,
    stamina: deltas.stamina,
    shelter: deltas.shelter,
    shortage: shortageUnits,
    spoiled: sweep.total
  };

  // ④ 报到日志里（阶段 E 的日报按 'D+3 · ' 前缀分组）
  const stamp = dayLabel(run.day);
  const eaten: string[] = [];
  const short: string[] = [];
  for (const line of drains) {
    const name = CATEGORY_LABELS[line.category];
    if (line.taken > 0) eaten.push(`${name} ${line.taken}`);
    if (line.shortage > 0) short.push(`${name} ${line.shortage}`);
  }
  run.log.push(`${stamp} · 消耗 ${eaten.join('、') || '无'}`);
  if (short.length > 0) run.log.push(`${stamp} · 缺 ${short.join('、')}`);
  // 这条日志是"没整理"的体感来源：货架空了，只能去撕箱子
  if (fromBoxes > 0) run.log.push(`${stamp} · 其中 ${fromBoxes} 件是从没拆的纸箱里翻出来的`);
  if (sweep.total > 0) {
    const names = sweep.losses.map((l) => `${getItemDef(l.itemId).name}×${l.count}`).join('、');
    run.log.push(`${stamp} · 坏了 ${names}`);
  }

  return {
    day: run.day,
    severity,
    drains,
    spoiled: sweep.losses,
    spoiledToday: sweep.total,
    deltas,
    placement: score.placement,
    fefo: score.fefo
  };
}
