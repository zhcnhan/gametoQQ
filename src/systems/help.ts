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
import { consumeCategory, countCategory, countCategoryFrom, type ConsumeSource } from '../model/consume';
import { haulFactorOfShelves } from '../model/haul';
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

// ———————— ★★ M4 W-11：这一趟从哪一档翻 ————————

/**
 * 三档来源，各有一个**固定的每件价钱**（§6.4 那把尺子的三个刻度，见 `data/survival.ts`）：
 *
 *   1.5 —— 贴了清单、而且清单收它的那几行（伸手拿，闭着眼也拿得到）
 *   3.3 —— 上了架，但那一行没写清单（要翻两下）—— `WORK_PER_ITEM_MID`，刻意是两端的中点
 *   4.5 —— 还没拆的纸箱（当着人家的面拆箱）—— 就是 `WORK_PER_ITEM_HARD`
 *
 * ## 它换掉了什么，又刻意**没**换掉什么
 *
 * W-11 之前只有一个数：整单按**全屋整理质量**算一个体力价（4.5 ~ 13.5 之间连续取值）。
 * 那个数是"你这一屋子平均有多乱"，而它对**这一单到底从哪儿拿**一无所知 ——
 * 于是 §6.5 承诺的那场取舍（"现在拆箱省时间，还是翻我划好的那一行省力气"）
 * 在屏幕上根本没有落点：玩家看到的永远只有那一个混合价。
 *
 * ★ 现在两套并存，**全屋口径没有被替换**：
 *   · `searchCost`（老口径）继续按质量算那个混合价，是默认的那条路；
 *   · `sourceCostOf`（新口径）把三档各自的价钱摆出来，玩家可以**指定**用哪一档。
 * 两者的差就是这一单"本来能多便宜"—— 那正是要摆给玩家看的东西。
 *
 * ⚠ 三档的价钱**不乘** `workCostOf` 的质量曲线，只乘身份天赋。
 * 理由：这一档的价钱说的就是"这一档有多费劲"，质量那 0.6/0.4 的加权
 * 是给**混合**口径用的；两者相乘会得到"整理得好的纸箱也便宜"这种不成立的话。
 */
export const WORK_PER_ITEM_MARKED = 1.5;
export const WORK_PER_ITEM_MID = 3.3;
export const WORK_PER_ITEM_BOX = 4.5;

/**
 * 这一趟只准从这一档翻。
 *
 * 与 `model/consume.ts` 的 `ConsumeSource` **刻意是同一个三值集合**
 * （那边是"取货时怎么过滤"，这边是"界面上的按钮叫哪一档"）——
 * 两者一旦分家，表现是"按钮说按划好的那行算 4.5、实际按别处算"。
 */
export type WorkSource = ConsumeSource;

/** 这一档每件多少体力 */
export function workPerItemOf(source: WorkSource): number {
  if (source === 'marked') return WORK_PER_ITEM_MARKED;
  if (source === 'shelf') return WORK_PER_ITEM_MID;
  return WORK_PER_ITEM_BOX;
}

/** 三档的固定顺序：从最省力到最费劲。界面按它排版，别在各处各写一遍 */
export const WORK_SOURCES: readonly WorkSource[] = ['marked', 'shelf', 'box'];

/** 档位的名字（界面上那个按钮说什么） */
export function workSourceLabel(source: WorkSource): string {
  if (source === 'marked') return '划好的那行';
  if (source === 'shelf') return '货架上';
  return '没拆的纸箱';
}

export interface SourceQuote {
  source: WorkSource;
  /** 按这一档算，这一单要多少体力（已含身份天赋） */
  cost: number;
  /** 这一档上凑得出几件（可能少于需求） */
  pieces: number;
  /** 这一档够不够凑齐这一单 */
  enough: boolean;
}

/**
 * 这一档上凑得出几件（**封顶在需求件数**：多出来的那些不用拿）。
 *
 * `quoteSources` 与 `sourceCostOf` 都只问它 —— 与 `countCategoryFrom` 那句
 * 注释同一个道理，两处各写一遍的账迟早会分家。
 */
function availableFrom(run: RunState, def: HelpRequestDef, source: WorkSource): { have: number; missing: number } {
  let have = 0;
  let missing = 0;
  for (const need of def.demands) {
    const got = countCategoryFrom(run.shelves, run.zones, run.boxesToUnpack, need.category, source);
    have += Math.min(got, need.count);
    missing += Math.max(0, need.count - got);
  }
  return { have, missing };
}

/**
 * 三档各自的报价。★ 界面拿它画按钮，`fulfillRequest` 拿同一档去取货 ——
 * 两边问的是同一个 `countCategoryFrom`（见那里的注释：两把尺子会分家）。
 *
 * ## ★★ 价钱按**这一档真拿得出的件数**算，不是按需求件数
 *
 * 第一版写的是 `workPerItemOf(source) * pieces * factor`（`pieces` = 需求总数），
 * 于是"这一档只有 2 件、而单子要 3 件"那一行会印成「只有 2 件 · **9.9 点**」——
 * 9.9 是 3 件的钱。玩家读到的是一句自相矛盾的话，而这一屏的全部意义
 * 就是那两个数能对着看。
 *
 * 那一档不够时它的按钮根本不会画出来（`HelpScreen` 只画 `enough` 的），
 * 所以这个数在那时只是个参照；而够的时候它恰好等于 `sourceCostOf` ——
 * **屏幕上写的与按下去付的是同一个数**，这一条由 `helpSource.test.ts` 跨层钉住。
 *
 * **乘数先乘再 `round1`**，与 `searchCost`、与日报同口径 ——
 * 先 round 再乘在两个数都是整数时看不出区别，而 base 一旦有小数就会差 0.1。
 */
export function quoteSources(run: RunState, def: HelpRequestDef): SourceQuote[] {
  const factor = identityWorkFactor(run.identityId);
  return WORK_SOURCES.map((source) => {
    const { have, missing } = availableFrom(run, def, source);
    return {
      source,
      cost: round1(workPerItemOf(source) * have * factor),
      pieces: have,
      enough: missing === 0
    };
  });
}

/**
 * 按**指定档位**算这一单的体力（与 `quoteSources` 同一把尺子）。
 *
 * 与 `searchCost` 的分工写在 `WORK_PER_ITEM_MARKED` 那段注释里。
 * 件数同样取 `availableFrom` —— 它与 `quoteSources` 必须给出同一个数，
 * 否则"报价说 4.5 点、按下去扣了 9.9 点"，而两边各自都算得对。
 */
export function sourceCostOf(run: RunState, def: HelpRequestDef, source: WorkSource): number {
  const { have } = availableFrom(run, def, source);
  return round1(workPerItemOf(source) * have * identityWorkFactor(run.identityId));
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
 *
 * ★ 维度 7 的位置那一半（`model/haul.ts`）也必须乘在这里，理由逐字相同：
 * 凑这一单的人和每天翻找的人是同一个，"东西压在最里头"对他一样费劲。
 * 所以本函数与日报各自乘 `workFactor` 与 `haulFactorOf`，**两个乘数都不能漏**。
 */
export function searchCost(run: RunState, def: HelpRequestDef): number {
  const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, getDisasterDef(run.disasterId));
  const base = workCostOf(score.placement, score.fefo, inspectRequest(run, def).pieces);
  const haul = haulFactorOfShelves(run.shelves, disasterModifiersOf(run.disasterId).carryFactor);
  return round1(base * identityWorkFactor(run.identityId) * haul);
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
 *
 * ★★ M4 W-11：多了一个可选的 `from`（"这一趟只从哪一档翻"）。
 *   · 不传（`'all'`）→ 与从前**逐位相同**：全屋一起凑，价钱按整理质量那个混合价；
 *   · 传了 → 只从那一档取，价钱按那一档的固定单价（见 `WORK_PER_ITEM_MARKED` 一段）。
 *
 * ⚠ 传了档位而那一档**不够**时，走的是"凑不齐"那条路（对方今日离开、不扣人情），
 * 而不是回头去别处补货。这一点必须与 `quoteSources` 的 `enough` 一致 ——
 * 界面只给够的那几档画按钮，所以正常走不到这里；但真走到了，
 * 报出来的话必须是"那一档上不够"，不是"你屋里没有"。
 */
export function fulfillRequest(store: GameStore, from: ConsumeSource | 'all' = 'all'): HelpResult {
  const run = store.run;
  if (run.phase !== 'help_request') return reject('现在门口没有人');
  const def = run.helpRequest ? findHelpRequestDef(run.helpRequest.defId) : null;
  if (!def) return reject('这一单已经过期了');

  const info = inspectRequest(run, def);
  const cost = from === 'all' ? searchCost(run, def) : sourceCostOf(run, def, from);
  /** 选了档位时，"凑得齐吗"要按**那一档**问，不能拿全屋那个数回答 */
  const missing =
    from === 'all'
      ? info.missing
      : def.demands.reduce(
          (n, need) =>
            n +
            Math.max(
              0,
              need.count - countCategoryFrom(run.shelves, run.zones, run.boxesToUnpack, need.category, from)
            ),
          0
        );

  const events: HelpEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    const npc = getNpcDef(def.npcId);

    // 两种"没给成"在这里是**分开**的：一种是你没能耐，一种是你没力气。
    // 都不额外扣人情 —— §6.5 只把"婉拒"算作不讲情面
    const why =
      missing > 0
        ? from === 'all'
          ? `翻遍了也只凑出 ${info.pieces - info.missing} 件`
          : `${workSourceLabel(from)}只有 ${info.pieces - missing} 件`
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
      const result = consumeCategory(
        draft.shelves,
        draft.zones,
        draft.boxesToUnpack,
        need.category,
        need.count,
        from
      );
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
    /*
     * ★ W-11：日志里写上"从哪儿凑的"。这不是装饰 —— 它是 §10.1A 铁则要的
     * **非数字表达**：同一单 4.5 点与 13.5 点的差别，只有在这一行里才看得出
     * 是"伸手拿的"还是"当着面拆箱的"。
     */
    draft.log.push(
      `${dayLabel(draft.day)} · 给了${npc.name}${describeNeeds(def)}，人情 +${def.trustGain}` +
        `${from === 'all' ? '' : `（从${workSourceLabel(from)}凑的）`}` +
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
