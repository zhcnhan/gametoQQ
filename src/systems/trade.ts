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
import { getItemDef } from '../data/items';
import { NEVER_TRADED } from '../data/survival';
import { dayLabel } from '../model/calendar';
import { consumeItem, countByItem } from '../model/consume';
import { createCursor } from '../model/rng';
import type { RunState } from '../model/types';
import type { GameStore } from '../state/store';
import { generateBoxStacks, nextBoxSeq } from './setup';

/** 换一箱要几件东西 */
export const TRADE_COST_PIECES = 3;
/** 换回来的箱型：粮油箱 —— 硬撑时最缺的就是食物与水 */
export const TRADE_BOX_DEF_ID = 'box_staple';
/** 两次之间至少隔几天。没有它，一个存货多的人可以一口气把家底全换成箱子 */
export const TRADE_COOLDOWN_DAYS = 2;

export interface TradePick {
  itemId: string;
  count: number;
}

export type TradeEvent =
  | { type: 'traded'; boxName: string; paid: { itemId: string; count: number }[] }
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
 * 现在能不能开这个口。三个条件缺一不可：在生存期、正在硬撑、冷却已过。
 * 界面用它决定要不要把那一块显出来。
 */
export function canTrade(run: RunState): boolean {
  return run.phase === 'survival_day' && run.survival.last.hardPress && tradeCooldownLeft(run) === 0;
}

/**
 * 拿三件东西换一箱粮油。
 *
 * @param picks 玩家**指认**的物资（品类不限，凑满 `TRADE_COST_PIECES` 件即可）
 */
export function tradeForBox(store: GameStore, picks: readonly TradePick[]): TradeResult {
  const run = store.run;
  if (run.phase !== 'survival_day') return reject('现在不在生存期');
  if (!run.survival.last.hardPress) return reject('日子还过得去，先别去麻烦人家');
  const wait = tradeCooldownLeft(run);
  if (wait > 0) return reject(`上次刚换过，再过 ${wait} 天`);

  const wanted = picks.filter((p) => p.count > 0);
  const total = wanted.reduce((n, p) => n + p.count, 0);
  if (total !== TRADE_COST_PIECES) return reject(`要凑满 ${TRADE_COST_PIECES} 件`);

  // 库存校验按**全屋**算（货架 + 纸箱），与界面给出的清单同源 ——
  // 否则会出现"界面说有、命令说没有"这种最难查的错
  const stock = new Map(countByItem(run.shelves, run.boxesToUnpack).map((s) => [s.itemId, s.count]));
  for (const pick of wanted) {
    if ((stock.get(pick.itemId) ?? 0) < pick.count) return reject(`${getItemDef(pick.itemId).name}没那么多`);
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
    draft.log.push(`${dayLabel(draft.day)} · 以 ${names} 换得 ${def.name}`);
    events.push({ type: 'traded', boxName: def.name, paid });
  });

  return { ok: true, events };
}
