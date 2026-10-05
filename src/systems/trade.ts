/**
 * 以物易物（§12.3「永远留逆转口」里那条一直没做的"交易"）。
 *
 * ## 为什么要有它
 *
 * 硬撑本身只是一个倒计时 —— 玩家掉进去以后除了干挨着什么都做不了，
 * 所以它一直是"不痛不痒"的：疼是疼的，但没有一个可以做的**决定**。
 * 有了这个出口，硬撑才变成一个要去想的状态：要不要拿三件东西换一箱粮油？
 * 换回来能撑几天？拿哪三件？
 *
 * ## 三条硬约束
 *
 *  1. **只在硬撑时可用**。它不是商店，是街坊之间的一句"帮个忙" ——
 *     日子还过得去的时候，没人会去开这个口；
 *  2. **三件换一箱，品类不限**。取舍感全在"拿哪三件"上，所以命令收的是
 *     玩家**指认**的具体物资（`TradePick`），而不是品类；
 *  3. **箱子里装着什么由种子化 RNG 决定**（复用拆箱引擎），所以它**不保证能救你**。
 *     一个必然把你救回来的按钮不是选择，是流程。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 */
import { getBoxDef, type BoxDef } from '../data/boxes';
import { dayPriceFactor } from '../data/dayEvents';
import { disasterModifiersOf } from '../data/disaster';
import { getIdentityDef } from '../data/identities';
import { getItemDef, hasItemDef } from '../data/items';
import { NEVER_TRADED } from '../data/survival';
import { dayLabel } from '../model/calendar';
import { consumeItem, countByItem } from '../model/consume';
import { createCursor } from '../model/rng';
import type { RunState } from '../model/types';
import type { GameStore } from '../state/store';
import { isShutOut } from './help';
import { generateBoxStacks, nextBoxSeq } from './setup';

/** 换一箱要几件东西 */
export const TRADE_COST_PIECES = 3;
/**
 * 三件额度里，**最多几件可以用现金顶**。
 *
 * ★ 定成 1 而不是 3（或"随便几件"）是这一条的全部要点：额度里的**大部分仍然必须是货**。
 * §12.3 那句"整理得好才拿得出东西"是靠"你手上真的有三件"撑着的；
 * 允许整箱都用钱买，硬撑就会退化成"有钱就行"，而现金在生存期本来几乎没有别的出口
 * （W-09 关掉了"花现金加家具"）—— 那条退化的路一旦打开就走不回来了。
 *
 * 所以现金买到的不是"免掉三件"，而是**"其中一件不用动家底"**：
 * 该舍弃哪一件、值不值得花这个钱，仍然是玩家的决定。
 */
export const TRADE_MAX_CASH_PIECES = 1;
/** 换回来的箱型：粮油箱 —— 硬撑时最缺的就是食物与水 */
export const TRADE_BOX_DEF_ID = 'box_staple';
/** 两次之间至少隔几天。没有它，一个存货多的人可以一口气把家底全换成箱子 */
export const TRADE_COOLDOWN_DAYS = 2;

export interface TradePick {
  itemId: string;
  count: number;
}

/**
 * 界面交上来的**一单意图**：给哪几件货 + 用现金顶掉哪一件（不给钱时是 null）。
 *
 * 它存在的理由是一道分层纪律：**"用钱顶哪一件"这条规矩住在 systems 层**（`cashForPick`）。
 * 界面自己算出 itemId 再交给 `main.ts` 的话，那条规矩就有了第二份实现 ——
 * 而两份实现漂开的表现是"界面报的价钱与命令扣的钱不一样"，不是任何一条报错。
 * 所以界面交出的是**开关状态**，命令把它翻译成具体是哪一件。
 */
export interface TradeIntent {
  picks: readonly TradePick[];
  /** 玩家开了"用钱顶一件"没有 */
  cashOn: boolean;
}

/**
 * 一件东西**折成现金**是多少（M4 决策 B：给生存期的现金一个出口）。
 *
 * ## 口径（必须与商店的定价同源）
 *
 * 商店里一个点位的实价是 `priceOf(物资, 点位, 身份) × dayPriceFactor(day, 灾难)
 * × (1 + priceSurcharge)`（见 `systems/shop.ts` 的 `priceOf` / `basePriceOf`）。
 * 生存期没有点位可言，所以取**中间那一段**：`basePrice × 身份折扣 × 当日与灾难的倍率`。
 *
 * ★ 它**刻意不去反推 `line.price`**：那要除一个可能小于 1 的倍数，
 * 会把"今天更便宜"算成"更贵"（`priceStressOf` 的第一版就栽在这上面，
 * 见它的注释）。反着算不如正着算 —— 从 `basePrice` 往上乘，每一步都有据可查。
 *
 * ⚠ 生存期 `run.shopPriceFactor` 永远是 1（事件只活一天，而事件属于囤货期），
 * 所以这里不乘它。乘了也不会有错，但会给出一个"其实不可能出现"的输入依赖。
 */
export function cashPriceOf(run: RunState, itemId: string): number {
  const item = getItemDef(itemId);
  return cashPriceOfItem(run, item);
}

function cashPriceOfItem(run: RunState, item: { basePrice: number; category: string }): number {
  let price = item.basePrice;
  const identity = getIdentityDef(run.identityId);
  const rule = identity.perkRule;
  if (rule.kind === 'categoryDiscount' && rule.categories.includes(item.category as never)) {
    price *= 1 - rule.rate;
  }
  price *= dayPriceFactor(run.day, run.disasterId);
  price *= 1 + disasterModifiersOf(run.disasterId).priceSurcharge;
  return Math.max(1, Math.round(price));
}

/**
 * 在玩家已经挑好的那几件里，挑出**用现金顶掉的那一件**（一件都没挑时返回 null）。
 *
 * ★ 它取的是"**折成现金最贵**的那一件"，不是"`basePrice` 最高的那一件" ——
 * 两者在打折品类的日子里会给出不同的答案，而玩家付的是前者。
 * 界面把这句话原样告诉玩家（"按你挑的最贵那件算"），所以这里不能另立一套口径。
 *
 * ★★ 挑哪一件是**命令层**的规矩（见 `TradeIntent`）：界面只交"开关开没开"。
 * 两份实现漂开的表现是"界面报的价钱与命令扣的钱不一样"，不是任何一条报错。
 *
 * 为什么不让玩家自己指哪一件用钱顶：见 `SurvivalScreen.tradePickerHtml` 的注释 ——
 * 玩家在"三件里挑三件"这件事上挑的是"割哪三样肉"，不是"哪一件付钱"。
 */
export function pickCashFor(run: RunState, picks: ReadonlyMap<string, number>): string | null {
  let bestId: string | null = null;
  let best = 0;
  for (const [itemId, count] of picks) {
    if (count <= 0) continue;
    /*
     * ★ 认不出的 id 直接跳过，**不许让它把命令打崩**。
     *
     * `cashPriceOf` 走 `getItemDef`，而它对着未知 id 是**抛异常**的
     * （`未知物资 id: …`）。界面当然只会给出屋里有的事，但命令层不能依赖界面自觉：
     * 一个抛出去的异常在这里的后果是"整单换箱炸掉"，而不是一句拒绝。
     * 跳过之后这一件挑不出来，命令照常走"要凑满 N 件"那条拒绝路径。
     */
    if (!hasItemDef(itemId)) continue;
    const price = cashPriceOf(run, itemId);
    if (price > best) {
      best = price;
      bestId = itemId;
    }
  }
  return bestId;
}

export type TradeEvent =
  | { type: 'traded'; boxName: string; paid: { itemId: string; count: number }[]; cash: number }
  | { type: 'rejected'; reason: string };

export interface TradeResult {
  ok: boolean;
  events: TradeEvent[];
}

function reject(reason: string): TradeResult {
  return { ok: false, events: [{ type: 'rejected', reason }] };
}

/** 距离下次能开口还得等几天（0 = 现在就能） */
export function tradeCooldownLeft(run: RunState): number {
  if (run.survival.lastTradeDay === NEVER_TRADED) return 0;
  return Math.max(0, TRADE_COOLDOWN_DAYS - (run.day - run.survival.lastTradeDay));
}

/**
 * 现在能不能开这个口。四个条件缺一不可：没被人记恨、在生存期、正在硬撑、冷却已过。
 *
 * ★ 第一条是 §6.5 那句「婉拒 → **后续交易关闭**」的落点，也是人情在 M1 里唯一的用途。
 * 它足够重 —— 一次婉拒就能关掉整局的救急出口 —— 所以它必须**看得见**：
 * 界面要明说"你不好意思再去了"，而不是让玩家点了才发现按钮没反应。
 */
export function canTrade(run: RunState): boolean {
  if (isShutOut(run)) return false;
  return run.phase === 'survival_day' && run.survival.last.hardPress && tradeCooldownLeft(run) === 0;
}

/**
 * 拿三件东西换一箱粮油。
 *
 * ## 现金那一件（M4 决策 B）
 *
 * `picks` 里的**件数**与现金顶掉的那一件加起来必须正好 `TRADE_COST_PIECES`：
 * 于是"用现金顶掉一件"不是省下一件，而是**把一件换成了它的价钱**。
 * 对价的定法见 `cashPriceOf` —— 它是**这一件今天值多少**，不是一口价，
 * 所以"用现金顶大米还是顶罐头"在贵的日子里会拉开差距。
 *
 * ★ 具体顶哪一件**由这里决定**（`cashForPick`：已经挑好的那几件里最贵的），
 * 界面交上来的只是 `intent.cashOn` 这个开关 —— 见 `TradeIntent` 的注释。
 *
 * @param intent 玩家指认的物资（品类不限）+ "用钱顶一件"开没开
 */
export function tradeForBox(store: GameStore, intent: TradeIntent): TradeResult {
  const run = store.run;
  if (isShutOut(run)) return reject('上次没给他，现在去不合适');
  if (run.phase !== 'survival_day') return reject('现在不在生存期');
  if (!run.survival.last.hardPress) return reject('还没到要开口的地步');
  const wait = tradeCooldownLeft(run);
  if (wait > 0) return reject(`上次刚换过，再过 ${wait} 天`);

  const wanted = intent.picks.filter((p) => p.count > 0);
  const total = wanted.reduce((n, p) => n + p.count, 0);
  /*
   * ★★ "用钱顶一件"只在**货真的凑得出来**的前提下成立。
   *
   * 第一版让界面在挑东西之前就能打开这个开关，于是屋里只剩两件时命令会去
   * `cashForPick` 一个**空**清单 —— 挑不出那一件，`cashFor` 变成 null，
   * 玩家却已经被界面告知"用钱顶一件"，最后收到的是"要凑满 3 件"这种驴唇不对马嘴的拒绝。
   * 现在开关只有在 `picks` 非空时才有意义：界面按同一条判据渲染（`cashUsable`）。
   */
  const pickedMap = new Map(wanted.map((p) => [p.itemId, p.count]));
  const cashFor = intent.cashOn && pickedMap.size > 0 ? pickCashFor(run, pickedMap) : null;
  const need = TRADE_COST_PIECES - (cashFor === null ? 0 : 1);
  if (total !== need) {
    return reject(
      cashFor === null
        ? `要凑满 ${TRADE_COST_PIECES} 件`
        : `用现金顶一件，另外还要凑满 ${need} 件`
    );
  }

  // 库存校验按**全屋**算（货架 + 纸箱），与界面给出的清单同源 ——
  // 否则会出现"界面说有、命令说没有"这种最难查的错。
  // ★ `hasItemDef` 那一道**必须在 `getItemDef` 之前**：后者对着未知 id 是抛异常的，
  //   而抛出去的异常在命令层的后果是"整单换箱炸掉"，不是一句拒绝。
  const stock = new Map(countByItem(run.shelves, run.boxesToUnpack).map((s) => [s.itemId, s.count]));
  for (const pick of wanted) {
    if (!hasItemDef(pick.itemId)) return reject('没有这一件东西');
    if ((stock.get(pick.itemId) ?? 0) < pick.count) return reject(`${getItemDef(pick.itemId).name}没那么多`);
  }

  /*
   * ★ 现金那一件**必须真的在屋里**。
   *
   * 不校验的话，玩家可以拿一个自己不存在的物资 id 去顶那一件 ——
   * 价格照样算得出来（`cashPriceOf` 只看 `basePrice`），于是"用钱顶一件"
   * 会变成"凭空少给一件"。这一条在界面那边看不出来（界面只会给出屋里有的事），
   * 但命令层不能依赖界面自觉。
   */
  let cash = 0;
  if (cashFor !== null) {
    if (!hasItemDef(cashFor)) return reject('没有这一件东西');
    if ((stock.get(cashFor) ?? 0) < 1) return reject(`${getItemDef(cashFor).name}已经没有了`);
    cash = cashPriceOf(run, cashFor);
    if (run.cash < cash) return reject(`现金不够：这一件折 ${cash} 元，你还有 ${run.cash} 元`);
  }

  const events: TradeEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    const paid: { itemId: string; count: number }[] = [];
    for (const pick of wanted) {
      const result = consumeItem(draft.shelves, draft.boxesToUnpack, pick.itemId, pick.count);
      draft.shelves = result.shelves;
      draft.boxesToUnpack = result.boxes;
      if (result.taken > 0) paid.push({ itemId: pick.itemId, count: result.taken });
    }
    draft.cash -= cash;

    const def: BoxDef = getBoxDef(TRADE_BOX_DEF_ID);
    draft.boxesToUnpack.push({
      id: `box_${nextBoxSeq(draft.boxesToUnpack)}`,
      defId: def.id,
      // 装什么由种子化 RNG 决定 —— 它不保证能救你，这一点是刻意的
      items: generateBoxStacks(cursor, def, draft.day)
    });

    draft.survival.lastTradeDay = draft.day;
    draft.seed = cursor.state;

    const names = paid.map((p) => `${getItemDef(p.itemId).name}×${p.count}`).join('、');
    const bits = cash > 0 ? `${names ? `${names}、` : ''}现金 ${cash} 元` : names;
    draft.log.push(`${dayLabel(draft.day)} · 以 ${bits} 换得 ${def.name}`);
    events.push({ type: 'traded', boxName: def.name, paid, cash });
  });

  return { ok: true, events };
}
