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
import type { CategoryId, ItemStack, Shelf, UnpackBox, Zone } from './types';

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

  if (need <= 0) {
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
