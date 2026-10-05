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
import { identityWorkFactor } from '../data/identities';
import {
  HELP_REQUEST_CHANCE,
  HELP_REQUEST_DEFS,
  findHelpRequestDef,
  helpRequestWeight,
  type HelpRequestDef
} from '../data/helpRequests';
import { CATEGORY_LABELS } from '../data/items';
import { getNpcDef } from '../data/npcs';
import { workCostOf, round1 } from '../data/survival';
import { dayLabel } from '../model/calendar';
import { consumeCategory, countCategory } from '../model/consume';
import { createCursor, nextFloat, pickEventAvoidingRecent, type RngCursor } from '../model/rng';
import { computeOrganizeScore } from '../model/score';
import type { CategoryId, RunState } from '../model/types';
import type { GameStore } from '../state/store';
import { disasterModifiersOf } from '../data/disaster';
import { intelCapacity } from './intel';
import { generateBoxStacks, nextBoxSeq } from './setup';

/**
 * 门口有人吗？有则返回订单 id。消耗一次 RNG。
 *
 * §10B.3.1 的 L2 维度：`npcVisitFactor` 把"有人来敲门"的概率按灾难缩放。
 * 大停电时邻居来得更勤（1.3，大家都没电、抱团），骚乱时没人敢出门（0.5）。
 * **这一维改变的是"人情"这条线在整局里的分量** —— 而人情能换回款，
 * 所以它同时影响现金与物资，是少数几条真正跨系统的维度。
 *
 * 概率夹在 0~1：`npcVisitFactor` 再大也不该让门口**永远**站着人
 * （那样"门口有人"就不再是一个事件，而是背景噪音）。
 */
export function rollHelpRequest(
  cursor: RngCursor,
  recent: readonly string[] = [],
  disasterId?: string
): string | null {
  const mods = disasterModifiersOf(disasterId);
  const chance = Math.max(0, Math.min(1, HELP_REQUEST_CHANCE * mods.npcVisitFactor));
  if (nextFloat(cursor) >= chance) return null;
  return pickEventAvoidingRecent(cursor, HELP_REQUEST_DEFS, recent, helpRequestWeight)?.id ?? null;
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
  const lines = def.demands.map(({ category, count }) => ({
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
 *
 * ★ M4 W-06：这里也必须乘身份的省力系数。`workCostOf` 的**全部生产读点只有两处**
 * —— 本函数与 `systems/survival.ts` 的日报 —— 只乘一处、漏一处的表现是
 * "日报说少花了、隔天凑订单又没花"：两个数各自都"对"，所以不会有任何报错，
 * 只有玩家觉得这个身份时灵时不灵。
 */
export function searchCost(run: RunState, def: HelpRequestDef): number {
  const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, getDisasterDef(run.disasterId));
  const base = workCostOf(score.placement, score.fefo, inspectRequest(run, def).pieces);
  return round1(base * identityWorkFactor(run.identityId));
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

/**
 * 从货架与纸箱里凑单交付。
 *
 * ## 关于返回值的口径（这里踩过一个坑，值得写清楚）
 *
 * `ok: true` 的意思是「**这一单我处理了，日历可以往下走了**」——
 * 而**不是**"你成功给到了"。三种结果要靠 `events` 区分：
 * `helpFulfilled`（交付成功）/ `helpFailed`（凑不齐或没力气）/ `rejected`（门口压根没人）。
 *
 * 为什么"凑不齐"也算 `ok: true`：命令已经把 `helpRequest` 清掉、`phase` 推回 `survival_day` 了 ——
 * 状态是真的变了。这时若返回 `ok: false`，表现层会把它当"这次操作没生效"来处理：
 * 弹一条"凑不齐"的错误提示，界面还停在原地等玩家再点一次（而那一单已经不在了）。
 * 更糟的是任何"失败了就退而求其次"的调用方会接着去调 `declineRequest`，
 * 于是玩家背上一次他从来没做过的"不讲情面"。
 *
 * 换句话说：**`ok` 回答"状态变了吗"，`events` 回答"变成了什么"**。
 * 两者混用就会在两个地方同时出错（界面与账本），而且都不容易看出来。
 */
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
        ? `翻遍了也只凑出 ${info.pieces - info.missing} 件`
        : draft.stats.stamina < cost
          ? `翻这一趟要 ${cost} 点体力，你今天不够`
          : '';

    if (why) {
      draft.helpRequest = null;
      draft.phase = 'survival_day';
      draft.log.push(`${dayLabel(draft.day)} · ${npc.name}要${describeNeeds(def)}，没能凑齐（${why}）`);
      events.push({ type: 'helpFailed', reason: why });
      draft.seed = cursor.state;
      return;
    }

    for (const need of def.demands) {
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
    /*
     * ★ 情报（§6.5 的第三种回报，2026-10 清偿 D-13）。
     *
     * 它是唯一一种**不给东西、给消息**的回报 —— 所以文案也得换一套说法：
     * "他留下 X" 对一条消息不成立（那是东西的说法）。用**数量**说：
     * "他多说了两句" / 加了个数字。
     *
     * ⚠ 上限是"还没到的天数"：再多的情报也没有东西可揭了，
     * 而给一个用不掉的数字是**在骗玩家**（他会以为攒着有用）。
     */
    if (def.thanks?.intel) {
      const capacity = intelCapacity(draft);
      const before = draft.intel;
      draft.intel = Math.min(capacity, before + def.thanks.intel);
      const gained = draft.intel - before;
      if (gained > 0) thanks = thanks ? `${thanks}，另外多说了${gained}天的事` : `多说了${gained}天的事`;
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
  return def.demands.map((n) => `${CATEGORY_LABELS[n.category]}×${n.count}`).join('、');
}
