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
import { FIRST_STOCKPILE_DAY } from '../data/disaster';
import { getIdentityDef, hasIdentityDef } from '../data/identities';
import { ACTION_POINTS_PER_DAY } from '../data/shops';
import { dayLabel } from '../model/calendar';
import { createCursor, type RngCursor } from '../model/rng';
import type { GamePhase, RunState } from '../model/types';
import type { GameStore } from '../state/store';
import { rollShopStocks } from './shop';

/**
 * 合法流转表。写在这里而不是散在 ui 里，好处有两个：
 *  1. 单测可以直接钉死"什么阶段能到什么地方"，ui 改错也跑不过；
 *  2. 界面按它决定按钮可用性，不会出现"点了没反应"的死按钮。
 */
export const NEXT_PHASES: Record<GamePhase, readonly GamePhase[]> = {
  prologue: ['stockpile_shop'],
  stockpile_shop: ['organize'],
  organize: ['stockpile_shop', 'night', 'ending'],
  night: ['stockpile_shop', 'ending'],
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
  | { type: 'dayStarted'; day: number }
  | { type: 'disasterLanded'; day: number }
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
 */
export function endDay(store: GameStore): PhaseResult {
  const run = store.run;
  if (run.phase !== 'organize') return reject('先把东西放下再睡');
  const events: PhaseEvent[] = [];

  store.commit((draft) => {
    // PLACEHOLDER: 夜间事件池属阶段 B。接入点就是这里 ——
    //   届时用 cursor 种子化判定"今晚有没有事"（约 60% 的天），有则 draft.phase = 'night' 并抽一条事件。
    const cursor = createCursor(draft.seed);
    events.push(startNextDay(draft, cursor));
    draft.seed = cursor.state;
  });

  return ok(events);
}

/**
 * 跨到"下一天"。返回值是给表现层的事件，方便 ui 分辨"新的一天"与"D-Day"。
 * 注意：这里**只**在囤货期内部推进，并且 day 一旦走到 0 就直接进 ending（D-Day 揭晓）。
 */
function startNextDay(run: RunState, cursor: RngCursor): PhaseEvent {
  const next = run.day + 1;

  if (next >= 0) {
    run.day = 0;
    run.phase = 'ending';
    run.actionPoints = 0;
    run.carLoad = 0;
    run.currentShopId = null;
    run.log.push('D-Day · 寒潮登陆。');
    return { type: 'disasterLanded', day: 0 };
  }

  const identity = getIdentityDef(run.identityId);
  run.day = next;
  run.phase = 'stockpile_shop';
  run.actionPoints = ACTION_POINTS_PER_DAY;
  run.carLoad = 0; // 车上的货都卸在家里了
  run.visitedShopIds = [];
  run.currentShopId = null;
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
