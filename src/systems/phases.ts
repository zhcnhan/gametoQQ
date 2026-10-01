/**
 * 状态机（§4.1 单局三段式 / §7 GamePhase）。
 *
 * systems/ 层纪律：不碰任何浏览器 API；唯一副作用是 store.commit()（改状态 + 落盘）。
 *
 * 阶段流转图（M1 阶段 A 实到 `ending` 为止）：
 *
 *   prologue ──chooseIdentity──▶ stockpile_shop ⇄ organize ──endDay──▶ (下一轮的 stockpile_shop)
 *                                     │                                    │
 *                                     └────────── day 走到 -1 ─────────────┴──▶ ending（D-Day）
 *
 * 关于 `night`：§4.1 的节拍是"扫货 → 拆箱 → 整理 → 夜间小事件"。
 * 夜间事件池属于阶段 B，所以阶段 A 的 `endDay` 直接跨过夜晚推进到下一天；
 * `endDay` 是夜间事件的**唯一**接入点，阶段 B 只需在这里插入"今晚有没有事"的判定。
 *
 * 关于 `survival_day` / `help_request`：属阶段 C/D，阶段 A 不会产生这两个 phase。
 */
import { FIRST_STOCKPILE_DAY, SURVIVAL_DAYS } from '../data/disaster';
import { getIdentityDef, hasIdentityDef } from '../data/identities';
import { NIGHT_SLEEP, findNightEvent } from '../data/nightEvents';
import { ACTION_POINTS_PER_DAY } from '../data/shops';
import { dayLabel } from '../model/calendar';
import { createCursor, type RngCursor } from '../model/rng';
import type { GamePhase, RunState } from '../model/types';
import type { GameStore } from '../state/store';
import { rollHelpRequest } from './help';
import { NO_EFFECT, applyNightEffect, cashCost, describeEffect, optionAt, rollNight } from './night';
import { rollShopStocks } from './shop';
import { settleSurvivalDay, type SurvivalReport } from './survival';

/**
 * 合法流转表。写在这里而不是散在 ui 里，好处有两个：
 *  1. 单测可以直接钉死"什么阶段能到什么地方"，ui 改错也跑不过；
 *  2. 界面按它决定按钮可用性，不会出现"点了没反应"的死按钮。
 */
export const NEXT_PHASES: Record<GamePhase, readonly GamePhase[]> = {
  prologue: ['stockpile_shop'],
  stockpile_shop: ['organize'],
  // 囤货期最后一天过完 → D-Day（survival_day）
  organize: ['stockpile_shop', 'night', 'survival_day', 'ending'],
  night: ['stockpile_shop', 'survival_day', 'ending'],
  survival_day: ['survival_day', 'help_request', 'ending'],
  help_request: ['survival_day'],
  ending: []
};

export function canAdvance(from: GamePhase, to: GamePhase): boolean {
  return NEXT_PHASES[from].includes(to);
}

/** 是不是"囤货期"的三个界面（每日库存只在这三个 phase 里有效） */
export function isStockpilePhase(phase: GamePhase): boolean {
  return phase === 'stockpile_shop' || phase === 'organize' || phase === 'night';
}

// ———————— 事件 ————————

export type PhaseEvent =
  | { type: 'identityChosen'; identityId: string; identityName: string; cash: number }
  | { type: 'wentHome' }
  | { type: 'wentOut' }
  /** 今晚有事，日历停在原地等玩家决定（§4.1：整理 → 夜间 → 第二天） */
  | { type: 'nightFell'; eventId: string }
  /** 玩家决定了今晚怎么办；summary 是给人看的一行数值摘要（"直接睡"时为空） */
  | { type: 'nightResolved'; eventId: string; choice: number; summary: string[] }
  | { type: 'dayStarted'; day: number }
  /** D-Day：灾难登陆，日历从此只往正数走（生存期开始） */
  | { type: 'disasterLanded'; day: number }
  /** 生存期每一天的结算报告 —— 报告是纯数据，界面对规则一无所知，只负责显示它 */
  | { type: 'survivalSettled'; report: SurvivalReport }
  /** 撑满 7 天 */
  | { type: 'survivalCompleted'; days: number }
  /** 健康归零，这一局停在这里（§12.3 v0.5 修订：硬撑不是免死金牌） */
  | { type: 'survivalEnded'; outcome: 'collapsed'; day: number }
  /** 门口有人（§6.5）。phase 会推进到 'help_request'，等玩家决定给还是不给 */
  | { type: 'helpKnocked'; defId: string }
  /** 这一单处理完了（交付 / 婉拒 / 凑不齐），回到日报 */
  | { type: 'helpResolved'; npcName: string; outcome: 'fulfilled' | 'declined' | 'failed' }
  | { type: 'rejected'; reason: string };

export interface PhaseResult {
  ok: boolean;
  events: PhaseEvent[];
}

function reject(reason: string): PhaseResult {
  return { ok: false, events: [{ type: 'rejected', reason }] };
}

function ok(events: PhaseEvent[]): PhaseResult {
  return { ok: true, events };
}

// ———————— 开局 ————————

/**
 * 选身份 = 真正开始这一局（§9.1 开局界面）。
 * 这一下同时完成：发钱、定第一天、发当日库存、把 phase 推到 stockpile_shop —— 一个原子存档点。
 */
export function chooseIdentity(store: GameStore, identityId: string): PhaseResult {
  const run = store.run;
  if (run.phase !== 'prologue') return reject('这一局已经开过了');
  if (!hasIdentityDef(identityId)) return reject('没有这个身份');
  const identity = getIdentityDef(identityId);
  const events: PhaseEvent[] = [];

  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    draft.identityId = identity.id;
    draft.cash = identity.startCash;
    draft.day = FIRST_STOCKPILE_DAY;
    draft.phase = 'stockpile_shop';
    draft.actionPoints = ACTION_POINTS_PER_DAY;
    draft.carLoad = 0;
    draft.visitedShopIds = [];
    draft.currentShopId = null;
    // M2：新的一天从"没有事件、原价、没买过"开始
    // （事件涨价、限购与买入记账都只活一天，见 data/dayEvents.ts）
    draft.shopPriceFactor = 1;
    draft.shopLimits = [];
    draft.shopBoughtToday = {};
    draft.dayEvent = null;
    draft.shopStocks = rollShopStocks(identity, cursor, FIRST_STOCKPILE_DAY);
    draft.seed = cursor.state;
    draft.log.push(`${dayLabel(FIRST_STOCKPILE_DAY)} · ${identity.name}。${identity.perk}`);
    events.push({
      type: 'identityChosen',
      identityId: identity.id,
      identityName: identity.name,
      cash: identity.startCash
    });
  });

  return ok(events);
}

// ———————— 外出 ⇄ 回家 ————————

export function goHome(store: GameStore): PhaseResult {
  const run = store.run;
  if (run.phase !== 'stockpile_shop') return reject('现在不在外面');
  store.commit((draft) => {
    draft.phase = 'organize';
    draft.currentShopId = null;
    draft.log.push(`${dayLabel(draft.day)} · 到家了。`);
  });
  return ok([{ type: 'wentHome' }]);
}

/** 再出门：只要行动点没用完就允许（不作废行动点，符合"解压 > 挑战"） */
export function goOut(store: GameStore): PhaseResult {
  const run = store.run;
  if (run.phase !== 'organize') return reject('现在不在家里');
  if (run.actionPoints <= 0) return reject('今天的行动点用完了，明天再出门');
  store.commit((draft) => {
    draft.phase = 'stockpile_shop';
  });
  return ok([{ type: 'wentOut' }]);
}

// ———————— 过一天 ————————

/**
 * 过一天（囤货期的唯一时间出口，§4A：时间只在玩家主动点它时流动）。
 * 刻意**不要求**拆完所有箱子 —— §5 引擎①「游戏不评判对错」，没拆完就出门也是玩家的自由。
 *
 * §4.1 的节拍是「扫货 → 回家拆箱 → 整理 → **夜间小事件** → 第二天」，所以这里有两条岔路：
 *   · 今晚有事 → phase 推到 'night'，**日历先不动**，等玩家决定完再跨天；
 *   · 今晚没事 → 直接跨天（约 40% 的夜间就这么跳过去了，节奏因此松弛）。
 */
export function endDay(store: GameStore): PhaseResult {
  const run = store.run;
  if (run.phase !== 'organize') return reject('先把东西放下再睡');
  const events: PhaseEvent[] = [];

  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    const eventId = rollNight(cursor);
    if (eventId) {
      draft.night = { eventId, choice: null, applied: null };
      draft.phase = 'night';
      events.push({ type: 'nightFell', eventId });
    } else {
      events.push(startNextDay(draft, cursor));
    }
    draft.seed = cursor.state;
  });

  return ok(events);
}

// ———————— 夜间（§6.2） ————————

/**
 * 决定今晚怎么办。`choice` 为选项下标，或 `NIGHT_SLEEP`（直接睡，无后果）。
 *
 * 这一步与"跨天"**分成两个命令**，是为了让玩家先看到后果再睡 ——
 * 而且它顺带给了存档一个天然的中间态：`choice !== null` 时刷新，
 * 回来看到的是"你已经决定过、只是还没关灯"，而不是把选择重放一遍。
 */
export function chooseNightOption(store: GameStore, choice: number): PhaseResult {
  const run = store.run;
  if (run.phase !== 'night') return reject('现在不是夜里');
  const night = run.night;
  if (!night) return reject('今晚没什么事');
  if (night.choice !== null) return reject('已经决定了');
  const def = findNightEvent(night.eventId);
  if (!def) return reject('没有这件事');
  const option = optionAt(def, choice);
  if (choice !== NIGHT_SLEEP && !option) return reject('没有这个选项');
  // 买货那一类必须给得起钱。界面会把它置灰，这里再挡一道 ——
  // 存档是玩家能改的，而"多少钱能买什么"不该只由界面说了算。
  if (option?.requireFullCash) {
    const cost = cashCost(option);
    if (run.cash < cost) return reject(`钱不够，还差 ${cost - run.cash} 元`);
  }

  const events: PhaseEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    // applied 是**实际**生效的数值（现金可能给不满），摘要与结果文案都用它，不用选项声明的数
    const applied = option ? applyNightEffect(draft, option.effect, cursor) : NO_EFFECT;
    const target = draft.night;
    if (target) {
      target.choice = choice;
      target.applied = applied;
    }
    const summary = describeEffect(applied);
    draft.log.push(
      `夜间 · ${option ? option.label : '直接睡'}${summary.length > 0 ? `（${summary.join('，')}）` : ''}`
    );
    draft.seed = cursor.state;
    events.push({ type: 'nightResolved', eventId: def.id, choice, summary });
  });

  return ok(events);
}

/** 关灯，跨到第二天。必须先对今晚有决定（包括"直接睡"）—— 这是唯一一处不允许跳过的确认 */
export function sleep(store: GameStore): PhaseResult {
  const run = store.run;
  if (run.phase !== 'night') return reject('现在不是夜里');
  if (run.night && run.night.choice === null) return reject('先决定今晚怎么办');

  const events: PhaseEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    draft.night = null;
    events.push(startNextDay(draft, cursor));
    draft.seed = cursor.state;
  });

  return ok(events);
}

// ———————— 生存期（§6.4 / 阶段 C） ————————
//
// 生存期的推进与囤货期刻意分开写，因为两件事的形状不一样：
//   · 囤货期的"过一天"是玩家来安排（买货、拆箱、整理），系统只负责翻日历；
//   · 生存期的"过一天"是系统来收账（消耗、腐坏、四维），玩家只负责看和承受。
// 所以后者每一步都必须带一份**结算报告**回去，否则界面没有东西可显示。

/**
 * 结算一天，然后判断这一局是不是到这里为止了。
 *
 * "什么算结束"**只**在这一个地方定义 —— `systems/survival.ts` 只负责把四维算对，
 * 它不知道"输赢"这回事。这样存档层不用猜，界面也不用各处复制同一套阈值。
 */
function settleAndMaybeEnd(run: RunState, events: PhaseEvent[], cursor: RngCursor): void {
  // 突发事件（§5 的另一半）在结算里抽签 —— 因此"同 seed 同事件序列"
  // 和每日四维的账是同一条 RNG 流，回放一次结算就能复现整天的经过
  events.push({ type: 'survivalSettled', report: settleSurvivalDay(run, cursor) });
  if (run.stats.health > 0) {
    // §6.5：结算完之后、玩家离开日报之前，门口可能站着人。
    // 放在**结算之后**是刻意的 —— 求援要用的是"今天过完之后"的库存与体力，
    // 顺序反了会出现"用还没到手的物资去凑单"。
    const defId = rollHelpRequest(cursor);
    if (defId) {
      run.helpRequest = { defId };
      run.phase = 'help_request';
      events.push({ type: 'helpKnocked', defId });
    }
    return;
  }
  run.outcome = 'collapsed';
  run.phase = 'ending';
  run.log.push(`${dayLabel(run.day)} · 撑不住了。`);
  events.push({ type: 'survivalEnded', outcome: 'collapsed', day: run.day });
}

/**
 * 从 D-Day 迈出第一步：`day 0 → 1`，并**立刻结算 D+1**。
 *
 * 为什么结算是"进入某一天"而不是"离开某一天"的代价：这样界面永远在显示
 * "今天已经发生的事"，而不是"明天将会怎样"—— 玩家看完就能对着自己的货架做判断。
 * 附带的好处是幂等：结算是 `day` 变化的一部分，重复点 / 刷新 / 读档都不会重算
 * （因此不需要额外存一个"今天算过了没"的标志位）。
 */
export function startSurvival(store: GameStore): PhaseResult {
  const run = store.run;
  if (run.phase !== 'survival_day') return reject('现在不是生存期');
  if (run.day !== 0) return reject('已经开始了');

  const events: PhaseEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    draft.day = 1;
    settleAndMaybeEnd(draft, events, cursor);
    draft.seed = cursor.state;
  });
  return ok(events);
}

/**
 * 撑过一天。第 7 天之后再推进 → 结算页。
 *
 * 这里有两个出口，**顺序不能反**：
 *   ① 先看这次结算有没有把健康打到 0（`settleAndMaybeEnd` 会接住，直接进 collapsed 结局）；
 *   ② 否则再看是不是撑满了 —— 撑满 7 天就是撑过去了（§12.3）。
 * 反过来的话，"第 7 天倒下"的人会拿到"你撑过去了"的评语。
 */
export function advanceSurvivalDay(store: GameStore): PhaseResult {
  const run = store.run;
  if (run.phase !== 'survival_day') return reject('现在不是生存期');
  if (run.day < 1) return reject('还没开始撑');

  const events: PhaseEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    const next = draft.day + 1;
    if (next > SURVIVAL_DAYS) {
      draft.phase = 'ending';
      draft.outcome = 'survived';
      draft.log.push(`撑过 ${SURVIVAL_DAYS} 天。`);
      events.push({ type: 'survivalCompleted', days: SURVIVAL_DAYS });
      draft.seed = cursor.state;
      return;
    }
    draft.day = next;
    settleAndMaybeEnd(draft, events, cursor);
    draft.seed = cursor.state;
  });
  return ok(events);
}

/**
 * 跨到"下一天"。返回值是给表现层的事件，方便 ui 分辨"新的一天"与"D-Day"。
 * 注意：这里**只**在囤货期内部推进。day 走到 0 时把 phase 交给 `survival_day`
 * （D-Day 揭晓，不结算），再往后由 `startSurvival` / `advanceSurvivalDay` 接手。
 */
function startNextDay(run: RunState, cursor: RngCursor): PhaseEvent {
  const next = run.day + 1;

  if (next >= 0) {
    run.day = 0;
    run.phase = 'survival_day';
    run.actionPoints = 0;
    run.carLoad = 0;
    run.currentShopId = null;
    run.night = null; // 夜里的事留在昨天
    run.log.push('D-Day · 寒潮登陆。');
    // D-Day 本身**不结算**：灾难刚落地，第一顿还没吃。结算从 D+1 开始（见 startSurvival）
    return { type: 'disasterLanded', day: 0 };
  }

  const identity = getIdentityDef(run.identityId);
  run.day = next;
  run.phase = 'stockpile_shop';
  run.actionPoints = ACTION_POINTS_PER_DAY;
  run.carLoad = 0; // 车上的货都卸在家里了
  run.visitedShopIds = [];
  run.currentShopId = null;
  run.night = null; // 新的一天从白天开始，昨晚的事不跟着走
  // M2：事件涨价、限购与买入记账都只活一天 —— 不在这里清，
  // 昨天的限购会跟着玩家走到今天。这是最容易漏的一处
  // （`rollShopStocks` 只负责货，不负责这些"今天的状态"）
  run.shopPriceFactor = 1;
  run.shopLimits = [];
  run.shopBoughtToday = {};
  run.dayEvent = null;
  run.shopStocks = rollShopStocks(identity, cursor, next);
  run.log.push(`${dayLabel(next)} · 新的一天，${ACTION_POINTS_PER_DAY} 个行动点。`);
  return { type: 'dayStarted', day: next };
}

// ———————— 存档自愈 ————————

/**
 * 保证"今天的点位库存"存在且属于今天。幂等，且**只在真的不对时**才动 RNG 与落盘：
 * 每次读档都重建库存会让 seed 游标被刷新次数牵着走，"同 seed 同结果"当场失效。
 *
 * 什么时候会真的不对：v3 → v4 迁移过来的老档（新字段是空数组）、或手改过的档。
 * @returns 是否真的重建了（调用方据此决定要不要刷界面）
 */
export function ensureDayStocks(store: GameStore): boolean {
  const run = store.run;
  if (!isStockpilePhase(run.phase)) return false;
  if (!run.identityId || !hasIdentityDef(run.identityId)) return false;
  const fresh = run.shopStocks.length > 0 && run.shopStocks.every((s) => s.day === run.day);
  if (fresh) return false;

  const identity = getIdentityDef(run.identityId);
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    draft.shopStocks = rollShopStocks(identity, cursor, draft.day);
    draft.seed = cursor.state;
  });
  return true;
}
