/**
 * 求援订单（§6.5「NPC 求援 = Wilmot 的限时订单，不是复仇演出」）。
 *
 * ## 这个系统真正在做的事
 *
 * 它把"整理质量"翻译成**别人怎么看你**。
 * §6.5 写得很清楚：「整理得好 → 几下凑齐当场交付」「整理得烂 → 翻箱倒柜找不齐，对方今日离开」。
 * 所以凑单不是一次扣库存的判定，它**要花体力**，而花多少由整理质量决定 ——
 * 东西在自己划的区里就是伸手拿，埋在一堆纸箱里就是当着他的面翻箱倒柜。
 *
 * ## 四条刻意的口径
 *
 *  1. **凑不齐 ≠ 婉拒**。前者是"你没能耐"（不额外扣人情），后者是"你不愿意"（扣）。
 *     混在一起，会让一个囤得少的人背上"不讲情面"的账 —— 那不是他选的；
 *  2. **回报不是每次都有**（`thanks` 是可选字段）。全靠回报会把它变成刷分；
 *  3. **人情可以为负，负了会关门**（§6.5：婉拒 → 后续交易关闭）。
 *     这就是人情在 M1 里的用途，见 systems/trade.ts 的 `canTrade`；
 *  4. **无台词无特写**。婉拒只是一个按钮，日志里也只记一个动作，不写心理活动。
 *     §6.5 的"炫耀感由效率表达"要的是速度，不是狠话。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 */
import { getBoxDef } from '../data/boxes';
import { getDisasterDef } from '../data/disaster';
import { HELP_REQUEST_CHANCE, HELP_REQUEST_DEFS, findHelpRequestDef, type HelpRequestDef } from '../data/helpRequests';
import { CATEGORY_LABELS } from '../data/items';
import { getNpcDef } from '../data/npcs';
import { workCostOf } from '../data/survival';
import { dayLabel } from '../model/calendar';
import { consumeCategory, countCategory } from '../model/consume';
import { createCursor, nextFloat, pick, type RngCursor } from '../model/rng';
import { computeOrganizeScore } from '../model/score';
import type { CategoryId, RunState } from '../model/types';
import type { GameStore } from '../state/store';
import { generateBoxStacks, nextBoxSeq } from './setup';

/** 门口有人吗？有则返回订单 id。消耗一次 RNG */
export function rollHelpRequest(cursor: RngCursor): string | null {
  if (nextFloat(cursor) >= HELP_REQUEST_CHANCE) return null;
  return pick(cursor, HELP_REQUEST_DEFS).id;
}

/**
 * 人情总和（所有 NPC 的关系值加起来）。
 *
 * §6.5 说婉拒的后果是"**后续交易关闭**" —— M1 的落实就是这个数：
 * 它掉到负数，意味着这一片已经没人愿意跟你打交道了，门口自然敲不开（见 trade.ts）。
 */
export function trustTotal(run: RunState): number {
  return Object.values(run.trust).reduce((n, v) => n + v, 0);
}

/** 人情为负 = 被这一片记住的那点事还没过去 */
export function isShutOut(run: RunState): boolean {
  return trustTotal(run) < 0;
}

export interface HelpShortfall {
  /** 逐项：要多少 / 你有多少 */
  lines: { category: CategoryId; need: number; have: number }[];
  /** 还差几件（0 = 凑得齐） */
  missing: number;
  /** 需求总件数（翻找成本的基数） */
  pieces: number;
}

/** 这一单你凑不凑得齐。界面要在玩家按下去之前就把答案告诉他 */
export function inspectRequest(run: RunState, def: HelpRequestDef): HelpShortfall {
  const lines = def.needs.map(({ category, count }) => ({
    category,
    need: count,
    // 全屋口径（货架 + 纸箱）：纸箱里的东西当然能翻出来，只是更费劲 —— 费劲体现在成本上
    have: countCategory(run.shelves, run.boxesToUnpack, category)
  }));
  return {
    lines,
    missing: lines.reduce((n, l) => n + Math.max(0, l.need - l.have), 0),
    pieces: lines.reduce((n, l) => n + l.need, 0)
  };
}

/**
 * 凑这一单要花多少体力。用的是**每日劳作那套公式**（件数 × 1.5~4.5）——
 * 因为它是同一种劳作。区别只在规模：订单通常三到五件，
 * 所以这是一次额外的弯腰，而不是"多过了一天"。
 *
 * 体力见底的人会在这里被拦住，而那正是"没整理 + 没力气"该有的后果。
 */
export function searchCost(run: RunState, def: HelpRequestDef): number {
  const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, getDisasterDef(run.disasterId));
  return workCostOf(score.placement, score.fefo, inspectRequest(run, def).pieces);
}

export type HelpEvent =
  | { type: 'helpFulfilled'; npcName: string; thanks: string }
  | { type: 'helpDeclined'; npcName: string; trustLoss: number }
  | { type: 'helpFailed'; reason: string }
  | { type: 'rejected'; reason: string };

export interface HelpResult {
  ok: boolean;
  events: HelpEvent[];
}

function reject(reason: string): HelpResult {
  return { ok: false, events: [{ type: 'rejected', reason }] };
}

/** 从货架与纸箱里凑单交付 */
export function fulfillRequest(store: GameStore): HelpResult {
  const run = store.run;
  if (run.phase !== 'help_request') return reject('现在门口没有人');
  const def = run.helpRequest ? findHelpRequestDef(run.helpRequest.defId) : null;
  if (!def) return reject('这一单已经过期了');

  const info = inspectRequest(run, def);
  const cost = searchCost(run, def);

  const events: HelpEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    const npc = getNpcDef(def.npcId);

    // 两种"没给成"在这里是**分开**的：一种是你没能耐，一种是你没力气。
    // 都不额外扣人情 —— §6.5 只把"婉拒"算作不讲情面
    const why =
      info.missing > 0
        ? `翻遍了也只凑出${info.pieces - info.missing} 件`
        : draft.stats.stamina < cost
          ? `要翻这一趟得 ${cost} 点体力，你今天没有`
          : '';

    if (why) {
      draft.helpRequest = null;
      draft.phase = 'survival_day';
      draft.log.push(`${dayLabel(draft.day)} · ${npc.name}要${describeNeeds(def)}，没能凑齐（${why}）`);
      events.push({ type: 'helpFailed', reason: why });
      draft.seed = cursor.state;
      return;
    }

    for (const need of def.needs) {
      const result = consumeCategory(draft.shelves, draft.zones, draft.boxesToUnpack, need.category, need.count);
      draft.shelves = result.shelves;
      draft.boxesToUnpack = result.boxes;
    }
    draft.stats.stamina = Math.max(0, draft.stats.stamina - cost);
    draft.trust[def.npcId] = (draft.trust[def.npcId] ?? 0) + def.trustGain;
    draft.deliveredOrders += 1;

    let thanks = '';
    if (def.thanks?.cash) {
      draft.cash += def.thanks.cash;
      thanks = `${def.thanks.cash} 元`;
    }
    if (def.thanks?.boxDefId) {
      const boxDef = getBoxDef(def.thanks.boxDefId);
      draft.boxesToUnpack.push({
        id: `box_${nextBoxSeq(draft.boxesToUnpack)}`,
        defId: boxDef.id,
        items: generateBoxStacks(cursor, boxDef, draft.day)
      });
      thanks = `一${boxDef.name}`;
    }

    draft.helpRequest = null;
    draft.phase = 'survival_day';
    draft.seed = cursor.state;
    draft.log.push(
      `${dayLabel(draft.day)} · 给了${npc.name}${describeNeeds(def)}，人情 +${def.trustGain}` +
        `${thanks ? `，他留下 ${thanks}` : ''}`
    );
    events.push({ type: 'helpFulfilled', npcName: npc.name, thanks });
  });

  return { ok: true, events };
}

/**
 * 婉拒。§6.5：「婉拒」只是一个按钮，无台词无特写；后果纯策略化 ——
 * 关系值下降、后续交易关闭。所以这里除了扣人情什么都不做。
 */
export function declineRequest(store: GameStore): HelpResult {
  const run = store.run;
  if (run.phase !== 'help_request') return reject('现在门口没有人');
  const def = run.helpRequest ? findHelpRequestDef(run.helpRequest.defId) : null;
  if (!def) return reject('这一单已经过期了');

  const events: HelpEvent[] = [];
  store.commit((draft) => {
    const npc = getNpcDef(def.npcId);
    draft.trust[def.npcId] = (draft.trust[def.npcId] ?? 0) - def.trustLoss;
    draft.helpRequest = null;
    draft.phase = 'survival_day';
    draft.log.push(`${dayLabel(draft.day)} · 婉拒了${npc.name}（人情 -${def.trustLoss}）`);
    events.push({ type: 'helpDeclined', npcName: npc.name, trustLoss: def.trustLoss });
  });

  return { ok: true, events };
}

/**
 * 兜底出口：门口已经没人，但 `phase` 还卡在 `'help_request'` 上。
 *
 * 正常情况下 `state/save.ts` 的 `normalizeHelpRequest` 会自愈掉这种档，
 * 这里是**第二道**：界面层的兜底不能省 —— 前一道负责"读档时是对的"，
 * 这一道负责"万一还是走到了这里，玩家不会被关在门口"。
 * 它没有任何副作用，所以可以放心地当成紧急出口。
 */
export function leaveRequest(store: GameStore): HelpResult {
  if (store.run.phase !== 'help_request') return reject('现在不在门口');
  store.commit((draft) => {
    draft.helpRequest = null;
    draft.phase = 'survival_day';
  });
  return { ok: true, events: [] };
}

/** 需求的人话（日志与界面共用同一套说法） */
export function describeNeeds(def: HelpRequestDef): string {
  return def.needs.map((n) => `${CATEGORY_LABELS[n.category]}×${n.count}`).join('、');
}
