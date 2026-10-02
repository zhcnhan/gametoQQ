/**
 * 生存期取用（§6.4：「从货架按规则取用 → 取用规则 = 对整理系统的检验」）。
 *
 * ## 取用顺序（三个来源，顺序不能反）
 *
 *   ① **归位的货架**（贴了胶带、且胶带清单接受这个品类）—— 你自己划的区，闭着眼也拿得到
 *   ② **其他货架** —— 一样能拿到，只是要翻两下
 *   ③ **还没拆的纸箱** —— 得先撕开箱子翻，最慢
 *
 * 组内一律按 **FEFO**（最早到期的先出）—— §5 引擎④：临期优先，
 * 避免把新货先吃掉、让旧货烂在架上。
 *
 * ★ 这里用的是 `zoneAccepts`（容不容），**不是**归位率那套 `zoneListedFor`（有没有写进清单）。
 * 两者在 §12 v0.8 之后刻意分开，而且分开的理由就在这里：
 * 取用顺序问的是"**去哪翻最省事**"，一张没写清单的胶带确实把东西规规矩矩码在了一起，
 * 从它上面拿当然是"伸手拿"而不是"翻箱倒柜"。
 * 归位率问的是"**你守没守自己写的秩序**"，没写清单就无从谈起。
 * 把两者并成一个判定，就会出现"归位率 0% 的货架反而被优先取用"这种看起来矛盾、
 * 但其实是两句不同的话被压成了一句话 —— 代价是玩家读不懂屏幕上那两个数。
 * 代价与实测见策划案 §12 的 v0.8 标注。
 *
 * ## 为什么纸箱必须能吃（这条不是可选项）
 *
 * 第一版只从货架取，实测结果是：玩家囤了 19 箱货、一口没拆，然后在 D+1 开始饿死。
 * 那直接推翻了 §1 的信条「**不整理，也能活**；整理得好，活得漂亮」——
 * 也把 §5 引擎① 的「游戏不评判对错」变成了空话（不整理会被系统当场处死）。
 *
 * 所以纸箱里的东西**可以吃**，只是排在最后。整理的意义是"更快、更省心、心情更好"
 * （以及 §5 的 FEFO 红利），不是"能不能活"。
 *
 * DEFERRED(D-11): §6.4 还写了"乱 → 翻乱相邻货架（滚雪球）"，这里**刻意没做**。
 * 那是一条会自我放大的惩罚：越乱越乱，玩家一旦掉进去就爬不出来，与 §12.3
 * 「永远留逆转口」相冲。M1 的替代做法是把"乱"的代价记在心情上
 * （见 data/survival.ts 的 moodFromPlacement），可逆、可解释、也能被玩家理解。
 *
 * model/ 层纪律：纯函数，不碰任何浏览器 API。
 */
import { getItemDef } from '../data/items';
import {
  cloneShelf,
  findZone,
  firstBatchExpiry,
  getStack,
  readingOrder,
  setSlotStack,
  splitStack,
  stackCount,
  zoneAccepts
} from './shelf';
import type { CategoryId, ItemStack, Shelf, SlotPos, UnpackBox, Zone } from './types';

export interface TakenBatch {
  itemId: string;
  count: number;
  expiresAtDay: number | null;
  /** 这一批是从哪儿翻出来的（界面据此解释"为什么今天这么费劲"） */
  from: 'shelf' | 'box';
}

export interface ConsumeResult {
  shelves: Shelf[];
  boxes: UnpackBox[];
  /** 实际取走的件数 */
  taken: number;
  /** 还差多少件（= 当天没吃到 / 没烧到） */
  shortage: number;
  batches: TakenBatch[];
  /** 其中有多少件是从没拆的纸箱里翻出来的 */
  fromBoxes: number;
}

/** 排序权重：越小越先被取 */
const RANK_IN_PLACE = 0;
const RANK_SHELF = 1;
const RANK_BOX = 2;

interface Candidate {
  rank: number;
  shelfIndex: number;
  row: number;
  col: number;
  boxIndex: number;
  expiry: number;
}

function expiryKey(stack: ItemStack): number {
  const expiry = firstBatchExpiry(stack);
  return expiry === null ? Number.POSITIVE_INFINITY : expiry;
}

/**
 * 按 FEFO 取走 `need` 件某品类的物资（货架优先，纸箱兜底）。
 *
 * @returns 新的货架与纸箱数组（都是 clone 过的），以及取走的明细与缺口。
 *          调用方直接替换 `run.shelves` / `run.boxesToUnpack` 即可。
 */
export function consumeCategory(
  shelves: readonly Shelf[],
  zones: readonly Zone[],
  boxes: readonly UnpackBox[],
  category: CategoryId,
  need: number
): ConsumeResult {
  const nextShelves = shelves.map(cloneShelf);
  const nextBoxes = boxes.map((box) => ({ ...box, items: box.items.slice() }));

  /*
   * ★★ `need` 必须是**正整数** —— 压测（`scripts/stress.mjs`）抓到：
   * 传 NaN 时下面 `need <= 0` 对 NaN 是 false（不早退），而所有 `remaining` 相关的比较
   * 也全是 false → 循环把**整个品类全清空**，同时 `taken` / `shortage` 都成了 NaN。
   *
   * 一个坏参数会让一整个品类的存货消失。界面传的是每天的固定消耗（小整数），
   * 所以这不是玩家能碰到的 bug；但"整个品类被清空"这种后果值得用一行挡住 ——
   * 与 `model/shelf.ts` 的 `splitStack` 守卫同一套路。
   */
  if (!Number.isInteger(need) || need <= 0) {
    return { shelves: nextShelves, boxes: nextBoxes, taken: 0, shortage: 0, batches: [], fromBoxes: 0 };
  }

  const candidates: Candidate[] = [];

  for (let i = 0; i < shelves.length; i++) {
    const shelf = shelves[i];
    if (!shelf) continue;
    const zone = findZone(zones, shelf.zoneId);
    for (const pos of readingOrder(shelf)) {
      const stack = getStack(shelf, pos);
      if (!stack) continue;
      if (getItemDef(stack.itemId).category !== category) continue;
      candidates.push({
        rank: zoneAccepts(zone, getItemDef(stack.itemId)) ? RANK_IN_PLACE : RANK_SHELF,
        shelfIndex: i,
        row: pos.row,
        col: pos.col,
        boxIndex: -1,
        expiry: expiryKey(stack)
      });
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (!box) continue;
    for (let k = 0; k < box.items.length; k++) {
      const stack = box.items[k];
      if (!stack) continue;
      if (getItemDef(stack.itemId).category !== category) continue;
      // 纸箱里的堆不记行列，用 k 当位置（见下面的写回逻辑）
      candidates.push({
        rank: RANK_BOX,
        shelfIndex: -1,
        row: i,
        col: k,
        boxIndex: i,
        expiry: expiryKey(stack)
      });
    }
  }

  // 先按来源权重，再按 FEFO。末尾用位置兜底，保证顺序稳定可复现
  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.expiry !== b.expiry) return a.expiry - b.expiry;
    if (a.shelfIndex !== b.shelfIndex) return a.shelfIndex - b.shelfIndex;
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  const batches: TakenBatch[] = [];
  let remain = need;
  let fromBoxes = 0;

  for (const candidate of candidates) {
    if (remain <= 0) break;

    if (candidate.boxIndex >= 0) {
      const box = nextBoxes[candidate.boxIndex];
      if (!box) continue;
      const at = candidate.col;
      const current = box.items[at];
      if (!current) continue;
      const take = Math.min(remain, stackCount(current));
      if (take <= 0) continue;
      const { taken, left } = splitStack(current, take);
      if (left) box.items[at] = left;
      else box.items.splice(at, 1);
      for (const batch of taken.batches) {
        batches.push({ itemId: taken.itemId, count: batch.count, expiresAtDay: batch.expiresAtDay, from: 'box' });
      }
      fromBoxes += take;
      remain -= take;
      continue;
    }

    const shelf = nextShelves[candidate.shelfIndex];
    if (!shelf) continue;
    const pos = { row: candidate.row, col: candidate.col };
    const current = getStack(shelf, pos);
    if (!current) continue;
    const take = Math.min(remain, stackCount(current));
    if (take <= 0) continue;
    const { taken, left } = splitStack(current, take);
    nextShelves[candidate.shelfIndex] = setSlotStack(shelf, pos, left);
    for (const batch of taken.batches) {
      batches.push({ itemId: taken.itemId, count: batch.count, expiresAtDay: batch.expiresAtDay, from: 'shelf' });
    }
    remain -= take;
  }

  const taken = need - Math.max(0, remain);
  return {
    shelves: nextShelves,
    boxes: nextBoxes,
    taken,
    shortage: Math.max(0, remain),
    batches,
    fromBoxes
  };
}

/**
 * 全屋某品类还有多少件（**货架 + 还没拆的纸箱**）。
 * 界面上的"还能撑几天"必须把纸箱算进去 —— 否则玩家会看着"主食 0 件"却明明有一箱没拆。
 */
export function countCategory(
  shelves: readonly Shelf[],
  boxes: readonly UnpackBox[],
  category: CategoryId
): number {
  let total = 0;
  for (const shelf of shelves) {
    for (const pos of readingOrder(shelf)) {
      const stack = getStack(shelf, pos);
      if (!stack) continue;
      if (getItemDef(stack.itemId).category !== category) continue;
      total += stackCount(stack);
    }
  }
  for (const box of boxes) {
    for (const stack of box.items) {
      if (getItemDef(stack.itemId).category !== category) continue;
      total += stackCount(stack);
    }
  }
  return total;
}

/**
 * 全屋每种物资各有多少件（**货架 + 还没拆的纸箱**）。按件数从多到少。
 *
 * 交易界面要用它列出"你能拿什么去换"。只数货架是不够的 ——
 * 一个东西全在箱子里的人，恰恰是最需要这个出口的人。
 */
export function countByItem(
  shelves: readonly Shelf[],
  boxes: readonly UnpackBox[]
): { itemId: string; count: number }[] {
  const tally = new Map<string, number>();
  const add = (itemId: string, n: number): void => {
    if (n <= 0) return;
    tally.set(itemId, (tally.get(itemId) ?? 0) + n);
  };
  for (const shelf of shelves) {
    for (const pos of readingOrder(shelf)) {
      const stack = getStack(shelf, pos);
      if (stack) add(stack.itemId, stackCount(stack));
    }
  }
  for (const box of boxes) {
    for (const stack of box.items) add(stack.itemId, stackCount(stack));
  }
  return [...tally.entries()]
    .map(([itemId, count]) => ({ itemId, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.itemId.localeCompare(b.itemId)));
}

/**
 * 按 **itemId** 取走 N 件（货架优先、同架按 FEFO、纸箱兜底）。
 *
 * 与 `consumeCategory` 的分工：那个按品类（生存期的每日消耗，系统自己挑），
 * 这个精确到物资本身 —— 因为交易要玩家**指认**他拿什么去换，
 * 而那正是"取舍感"唯一可能的来源。
 *
 * @returns 新的货架与纸箱（都是 clone 过的），以及实际取走的件数
 */
export function consumeItem(
  shelves: readonly Shelf[],
  boxes: readonly UnpackBox[],
  itemId: string,
  need: number
): { shelves: Shelf[]; boxes: UnpackBox[]; taken: number } {
  const nextShelves = shelves.map(cloneShelf);
  const nextBoxes = boxes.map((box) => ({ ...box, items: box.items.slice() }));
  if (need <= 0) return { shelves: nextShelves, boxes: nextBoxes, taken: 0 };

  let remain = need;

  // ① 货架：同一种物资里按到期日升序（FEFO），先把快过期的换出去
  const spots: { shelfIndex: number; pos: SlotPos; expiry: number }[] = [];
  for (let i = 0; i < shelves.length; i++) {
    const shelf = shelves[i];
    if (!shelf) continue;
    for (const pos of readingOrder(shelf)) {
      const stack = getStack(shelf, pos);
      if (!stack || stack.itemId !== itemId) continue;
      spots.push({ shelfIndex: i, pos, expiry: expiryKey(stack) });
    }
  }
  spots.sort((a, b) => (a.expiry !== b.expiry ? a.expiry - b.expiry : a.shelfIndex - b.shelfIndex));

  for (const spot of spots) {
    if (remain <= 0) break;
    const shelf = nextShelves[spot.shelfIndex];
    if (!shelf) continue;
    const current = getStack(shelf, spot.pos);
    if (!current) continue;
    const take = Math.min(remain, stackCount(current));
    if (take <= 0) continue;
    const { taken, left } = splitStack(current, take);
    nextShelves[spot.shelfIndex] = setSlotStack(shelf, spot.pos, left);
    remain -= taken.batches.reduce((n, b) => n + b.count, 0);
  }

  // ② 纸箱兜底
  for (let i = 0; i < nextBoxes.length && remain > 0; i++) {
    const box = nextBoxes[i];
    if (!box) continue;
    for (let k = 0; k < box.items.length && remain > 0; k++) {
      const stack = box.items[k];
      if (!stack || stack.itemId !== itemId) continue;
      const take = Math.min(remain, stackCount(stack));
      if (take <= 0) continue;
      const { taken, left } = splitStack(stack, take);
      if (left) box.items[k] = left;
      else {
        box.items.splice(k, 1);
        k -= 1; // 摘掉一堆之后下标要退一格，否则会跳过下一堆
      }
      remain -= taken.batches.reduce((n, b) => n + b.count, 0);
    }
  }

  return { shelves: nextShelves, boxes: nextBoxes, taken: need - remain };
}
