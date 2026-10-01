/**
 * 生存期每日结算（§6.4 + M1 平衡改造）。
 *
 * 一天只结算一次，结算只发生在这个文件里。顺序**不能改**：
 *
 *   ① 腐坏  —— 烂掉的不能吃。必须在消耗之前清，否则玩家会"吃到"当天已经过期的东西。
 *   ② 消耗  —— 按 `data/survival.dailyDrainOf()` 的品类与件数，走 `model/consume` 的 FEFO 取用。
 *   ③ 劳作  —— 把今天翻出来的货"搬"到桌上要花体力，成本由**整理质量**决定（§6.4「乱 → 翻找耗时」）。
 *   ④ 缺货  —— 没凑齐就扣健康 / 心情 / 体力。
 *   ⑤ 硬撑  —— 四维跌破线就进入硬撑，代价再叠一层（§12.3 v0.5 修订）。
 *   ⑥ 补给  —— 健康低自动开药箱、屋子冷自动添被（两个"囤了却没用"的品类在这里兑现）。
 *   ⑦ 落定  —— 一次性写回四维，并留一份增量快照给界面。
 *
 * ## 为什么 ③ 必须排在 ④ 之前
 *
 * 劳作算的是"你今天真的翻了多少件"，而翻出来的件数正是 ② 的结果。
 * 如果把它写在缺货判断之后，断粮那天反而会变成"最轻松的一天"（没东西可翻）。
 *
 * ## 关于 `health` 归零
 *
 * 这个文件只负责把数算对，**不判胜负**。归零 → `collapsed` 的判定在
 * `systems/phases.ts` 里做 —— 那样"什么算结束"就只有一处定义，存档层也不用猜。
 *
 * ## 关于 `settleSurvivalDay` 的**幂等性**
 *
 * 它自己不判断"今天算过没有"。幂等由调用方（`systems/phases.ts` 的
 * `startSurvival` / `advanceSurvivalDay`）保证 —— 那两个命令在推进 `day` 的同一次
 * `store.commit` 里调用它，所以"day 变了"就必然"刚算过"。
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
  EXHAUSTED_REACH,
  EXHAUSTED_STAMINA,
  MEDICINE_TRIGGER,
  MOOD_DELTA_CAP,
  SHELTER_WEAR_PER_SEVERITY,
  SHORTAGE_HEALTH,
  SHORTAGE_MAX_STACK,
  SHORTAGE_MOOD,
  SHORTAGE_STAMINA,
  STAMINA_RECOVER,
  WARMTH_TRIGGER,
  dailyDrainOf,
  hardPressTier,
  healOf,
  isHardPress,
  moodFromPlacement,
  organizeQuality,
  shelterOf,
  workCostOf
} from '../data/survival';
import type { CategoryId, HardPressLevel, RunState } from '../model/types';

/** 每天最多自动用掉几件补给（医疗 / 保暖各算一份）。它只防"一次吃光库存"，不限制正常情况下按需取用 */
const SUPPLY_MAX_PER_DAY = 2;

export interface DrainLine {
  category: CategoryId;
  need: number;
  taken: number;
  /** 货架和纸箱里都翻遍了也没有 */
  shortage: number;
  /** 有货，但今天没力气翻到。与 shortage 分开记，界面才能说清是"没有"还是"拿不动" */
  unreachable: number;
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
  /** 结算后的整理体检（心情修正与体力劳作都是按它算的，界面要能解释"今天为什么这么累"） */
  placement: number;
  fefo: number;
  /** 整理质量（0..1）= 归位率 × 0.6 + 临期优先率 × 0.4 */
  quality: number;
  /** 今天的翻找劳作（体力，正数）。它同时也是 `deltas.stamina` 里被扣掉的那部分 */
  workCost: number;
  fromShelves: number;
  fromBoxes: number;
  /** 有货但没力气翻到的件数（体力见底的那天才 > 0） */
  unreachable: number;
  hardPress: boolean;
  /** 今天是硬撑里的哪一档（`'none'` = 没在硬撑） */
  hardPressLevel: HardPressLevel;
  usedMedicine: number;
  usedWarmth: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 收掉浮点尾巴，保留两位小数。
 *
 * 必须做，而且必须做在**写回四维之前**：劳作成本带一位小数（9.9 / 13.5 / 19.8），
 * 和一条小数的体力相加就会掉出 `4.799999999999997` 这种数字 —— 而四维是**直接印在界面上**的，
 * 玩家会看到它。数值本身是准的，错的只是显示，但屏幕上多一串 9 就是错。
 *
 * `+ 0` 是为了把 `-0` 归一成 `0`（`Math.round(-0.001 * 100) / 100` 会得到负零）。
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0;
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
  //    体力见底的人翻不动 —— 当天能取到的量打折。它不判死（还剩一半），
  //    但足以把"东西堆在箱子里"推成一条下坡路：翻不动 → 少吃 → 更没力气。
  const exhausted = run.stats.stamina < EXHAUSTED_STAMINA;
  //    硬撑的人烧得更多（§12.3 v0.6）。判档看的是**天亮时**的四维：
  //    昨天已经垮在线上的人，今天一睁眼就该知道自己还没缓过来。
  const dawnTier = isHardPress(run.stats) ? hardPressTier(run.survival.hardPressStreak) : null;
  const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack);
  const drains: DrainLine[] = [];
  let shortageUnits = 0;
  /** 真的没有的那些（不含"有货但拿不动"）。它与 shortageUnits 分开累计，结算页要用它说清栽在哪 */
  let realShortageUnits = 0;
  let unreachableUnits = 0;
  let fromBoxes = 0;
  let takenPieces = 0;
  for (const { category, need: baseNeed } of dailyDrainOf(disaster)) {
    // 硬撑的额外消耗算进"今天需要多少"，而不是事后算成"少吃了一顿" ——
    // 账要记在需求侧，玩家才会在库存表上看到那一天多掉了一件
    const need = baseNeed + (dawnTier?.extraDrain[category] ?? 0);
    const reachable = exhausted ? Math.max(0, Math.ceil(need * EXHAUSTED_REACH)) : need;
    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, category, reachable);
    run.shelves = result.shelves;
    run.boxesToUnpack = result.boxes;
    const unreachable = need - reachable;
    drains.push({
      category,
      need,
      taken: result.taken,
      shortage: result.shortage,
      unreachable,
      batches: result.batches,
      fromBoxes: result.fromBoxes
    });
    shortageUnits += result.shortage + unreachable;
    realShortageUnits += result.shortage;
    unreachableUnits += unreachable;
    takenPieces += result.taken;
    fromBoxes += result.fromBoxes;
  }
  const fromShelves = takenPieces - fromBoxes;

  // ③ 劳作：整理质量的直接代价（§6.4「乱 → 翻找耗时」）
  const quality = organizeQuality(score.placement, score.fefo);
  const workCost = workCostOf(score.placement, score.fefo, takenPieces);

  const deltas = { health: 0, mood: 0, stamina: 0, shelter: 0 };
  // 睡一觉 +12，今天的翻找再扣掉一笔 —— 整理差的人会把觉白睡掉
  deltas.stamina += STAMINA_RECOVER - workCost;
  deltas.shelter -= Math.round(severity * SHELTER_WEAR_PER_SEVERITY);
  deltas.mood += moodFromPlacement(score.placement);

  // ④ 缺货：没凑齐就是没凑齐，缺口越大越疼（封顶见 SHORTAGE_MAX_STACK）
  if (shortageUnits > 0) {
    const pain = Math.min(SHORTAGE_MAX_STACK, shortageUnits);
    deltas.health -= SHORTAGE_HEALTH * pain;
    deltas.mood -= SHORTAGE_MOOD * pain;
    deltas.stamina -= SHORTAGE_STAMINA * pain;
    run.survival.shortageDays += 1;
  }
  // 累计件数（结算页读它）：天数会被"缺 1 件"和"缺 5 件"糊成同一个数，件数不会
  run.survival.shortagePieces += realShortageUnits;
  run.survival.unreachablePieces += unreachableUnits;

  // ⑤ 硬撑：判定用的是"④ 之后、⑥ 之前"的状态 —— 药能把你救回来，但今天确实难受过
  const shadow = {
    health: clamp(run.stats.health + deltas.health, 0, 100),
    mood: clamp(run.stats.mood + deltas.mood, 0, 100),
    stamina: clamp(run.stats.stamina + deltas.stamina, 0, 100)
  };
  const hardPress = isHardPress(shadow);
  const todayTier = hardPress ? hardPressTier(run.survival.hardPressStreak) : null;
  if (todayTier) {
    deltas.mood -= todayTier.mood;
    deltas.health -= todayTier.health;
    deltas.stamina -= todayTier.stamina;
    run.survival.hardPressDays += 1;
    run.survival.hardPressStreak += 1;
  } else {
    // 缓过来了就立刻归零。档位算的是**连续**天数：
    // "硬撑一下就好"和"已经第五天爬不起来"对身体的含义完全不同
    run.survival.hardPressStreak = 0;
  }
  deltas.mood = clamp(deltas.mood, -MOOD_DELTA_CAP, MOOD_DELTA_CAP);

  // ⑥ 自动补给：囤了却一直没有用途的两个品类在这里兑现（医疗 → 健康，保暖 → 庇护所）
  const supply = autoSupply(run, {
    health: run.stats.health + deltas.health,
    shelter: run.stats.shelter + deltas.shelter
  });
  deltas.health += supply.heal;
  deltas.shelter += supply.warmth;

  // ⑦ 落定四维（结尾统一收一次小数，见 round2 的注释）
  deltas.health = round2(deltas.health);
  deltas.mood = round2(deltas.mood);
  deltas.stamina = round2(deltas.stamina);
  deltas.shelter = round2(deltas.shelter);

  run.stats.health = clamp(round2(run.stats.health + deltas.health), 0, 100);
  run.stats.mood = clamp(round2(run.stats.mood + deltas.mood), 0, 100);
  run.stats.stamina = clamp(round2(run.stats.stamina + deltas.stamina), 0, 100);
  run.stats.shelter = clamp(round2(run.stats.shelter + deltas.shelter), 0, 100);

  // 落盘一份增量快照：刷新回来还要能看见"今天掉了哪些点"（§4A 恢复即续玩）
  run.survival.last = {
    health: deltas.health,
    mood: deltas.mood,
    stamina: deltas.stamina,
    shelter: deltas.shelter,
    shortage: shortageUnits,
    spoiled: sweep.total,
    fromShelves,
    fromBoxes,
    unreachable: unreachableUnits,
    workCost,
    hardPress,
    hardPressLevel: todayTier?.level ?? 'none',
    usedMedicine: supply.usedMedicine,
    usedWarmth: supply.usedWarmth
  };

  // ⑧ 报到日志里（阶段 E 的日报按 'D+3 · ' 前缀分组）
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
  if (fromBoxes > 0) {
    run.log.push(`${stamp} · 其中 ${fromBoxes} 件是从没拆的纸箱里翻出来的（翻找耗掉 ${workCost} 点体力）`);
  } else if (workCost > 0) {
    run.log.push(`${stamp} · 翻找耗掉 ${workCost} 点体力`);
  }
  if (unreachableUnits > 0) {
    run.log.push(`${stamp} · 实在翻不动，少拿了 ${unreachableUnits} 件`);
  }
  if (todayTier) {
    // 报的是**档位名**而不是"硬撑"两个字：玩家回头翻日志时，
    // "撑不住（连续第 3 天）"比"硬撑"能让他想起那几天是怎么过的
    run.log.push(
      `${stamp} · ${todayTier.name}（连续第 ${run.survival.hardPressStreak} 天）`
    );
  }
  if (supply.usedMedicine > 0) {
    run.log.push(`${stamp} · 用了 ${supply.usedMedicine} 件药（健康 +${supply.heal}）`);
  }
  if (supply.usedWarmth > 0) {
    run.log.push(`${stamp} · 添了 ${supply.usedWarmth} 件保暖（庇护所 +${supply.warmth}）`);
  }
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
    fefo: score.fefo,
    quality,
    workCost,
    fromShelves,
    fromBoxes,
    unreachable: unreachableUnits,
    hardPress,
    hardPressLevel: todayTier?.level ?? 'none',
    usedMedicine: supply.usedMedicine,
    usedWarmth: supply.usedWarmth
  };
}

interface SupplyOutcome {
  usedMedicine: number;
  usedWarmth: number;
  heal: number;
  warmth: number;
}

/**
 * 自动补给：跌到触发线以下才动，补到线上就停 —— 不留"今天健康 69，一口气吃掉两件药"的浪费。
 *
 * 取货一律走 `consumeCategory`，所以它和吃饭烧火一样遵守 **FEFO**：
 * 快过期的绷带先被用掉。这不是顺手，而是必须 —— 否则"药箱最底层那卷过期的"就永远没人碰。
 */
function autoSupply(run: RunState, current: { health: number; shelter: number }): SupplyOutcome {
  const out: SupplyOutcome = { usedMedicine: 0, usedWarmth: 0, heal: 0, warmth: 0 };

  let health = current.health;
  while (out.usedMedicine < SUPPLY_MAX_PER_DAY && health < MEDICINE_TRIGGER) {
    const drawn = drawOne(run, 'medicine');
    if (!drawn) break;
    const heal = healOf(getItemDef(drawn.itemId));
    if (heal <= 0) break; // 这个品类里没有任何能回血的物资，别再空转
    out.usedMedicine += 1;
    out.heal += heal;
    health += heal;
  }

  let shelter = current.shelter;
  while (out.usedWarmth < SUPPLY_MAX_PER_DAY && shelter < WARMTH_TRIGGER) {
    const drawn = drawOne(run, 'warmth');
    if (!drawn) break;
    const warm = shelterOf(getItemDef(drawn.itemId));
    if (warm <= 0) break;
    out.usedWarmth += 1;
    out.warmth += warm;
    shelter += warm;
  }

  return out;
}

/** 从某品类里按 FEFO 取走 1 件，返回取到的那件（没货返回 null）。就地改 run 的货架与纸箱 */
function drawOne(run: RunState, category: CategoryId): { itemId: string } | null {
  const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, category, 1);
  if (result.taken <= 0) return null;
  run.shelves = result.shelves;
  run.boxesToUnpack = result.boxes;
  const first = result.batches[0];
  return first ? { itemId: first.itemId } : null;
}
