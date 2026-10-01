/**
 * 货架纯逻辑（策划案 §6.3 整理 = 核心中的核心）。
 *
 * 本文件属于 model/：纯函数、无副作用，不碰任何浏览器 API（DOM、定时器、音频）。
 * 所有函数返回**新的** Shelf，不改入参 —— 配合原子存档，任何中间状态都能整份写盘。
 */
import { getItemDef } from '../data/items';
import type { CategoryId, ItemDef, ItemStack, Shelf, Slot, SlotPos, UnpackBox, Zone } from './types';

export const SHELF_W = 6;
export const SHELF_H = 4;
export const ROOM_ID = 'room_living';

let idSeq = 0;

/** 仅用于运行时生成 id；不参与随机，不进存档（存档读回后 id 已存在） */
export function nextShelfId(prefix = 'shelf'): string {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
}

export function createShelf(
  id: string,
  roomId: string,
  kind: Shelf['kind'],
  w: number = SHELF_W,
  h: number = SHELF_H,
  zoneId: string | null = null
): Shelf {
  const slots: Slot[][] = [];
  for (let r = 0; r < h; r++) {
    const row: Slot[] = [];
    for (let c = 0; c < w; c++) row.push({ stack: null });
    slots.push(row);
  }
  // handyRank 开局一律 null：门口是哪块，由玩家在整理页自己指认（§5）
  return { id, roomId, kind, w, h, slots, zoneId, handyRank: null };
}

export function cloneShelf(shelf: Shelf): Shelf {
  return {
    ...shelf,
    slots: shelf.slots.map((row) => row.map((slot) => cloneSlot(slot)))
  };
}

export function cloneSlot(slot: Slot): Slot {
  return { stack: slot.stack ? cloneStack(slot.stack) : null };
}

export function cloneStack(stack: ItemStack): ItemStack {
  return { itemId: stack.itemId, batches: stack.batches.map((b) => ({ ...b })) };
}

export function isInside(shelf: Shelf, pos: SlotPos): boolean {
  return pos.row >= 0 && pos.row < shelf.h && pos.col >= 0 && pos.col < shelf.w;
}

export function getStack(shelf: Shelf, pos: SlotPos): ItemStack | null {
  if (!isInside(shelf, pos)) return null;
  const row = shelf.slots[pos.row];
  if (!row) return null;
  const slot = row[pos.col];
  return slot ? slot.stack : null;
}

/** 读写顺序：先第一行左→右，再第二行……（= 玩家眼中的"从左上角开始排"） */
export function readingOrder(shelf: Shelf): SlotPos[] {
  const out: SlotPos[] = [];
  for (let r = 0; r < shelf.h; r++) {
    for (let c = 0; c < shelf.w; c++) out.push({ row: r, col: c });
  }
  return out;
}

export function samePos(a: SlotPos, b: SlotPos): boolean {
  return a.row === b.row && a.col === b.col;
}

// ———————— 堆栈基础度量 ————————

export function stackCount(stack: ItemStack): number {
  return stack.batches.reduce((sum, b) => sum + b.count, 0);
}

export function stackUnitWeight(stack: ItemStack): number {
  return getItemDef(stack.itemId).unitWeight * stackCount(stack);
}

/** 该堆最靠前（最早到期）的批次到期日；全部为 null（不易腐）时返回 null */
export function firstBatchExpiry(stack: ItemStack): number | null {
  let min: number | null = null;
  for (const b of stack.batches) {
    if (b.expiresAtDay === null) continue;
    if (min === null || b.expiresAtDay < min) min = b.expiresAtDay;
  }
  return min;
}

/** FEFO 排序键：不易腐 = 永不到期 = 永远排最后 */
function fefoKey(stack: ItemStack): number {
  const e = firstBatchExpiry(stack);
  return e === null ? Number.POSITIVE_INFINITY : e;
}

/** 规范化：合掉同到期日的批次，按到期日升序（FEFO 取 batches[0] 即最早批次） */
export function normalizeStack(stack: ItemStack): ItemStack {
  const buckets = new Map<string, number>();
  for (const b of stack.batches) {
    if (b.count <= 0) continue;
    const key = b.expiresAtDay === null ? 'null' : String(b.expiresAtDay);
    buckets.set(key, (buckets.get(key) ?? 0) + b.count);
  }
  const batches = [...buckets.entries()]
    .map(([key, count]) => ({ expiresAtDay: key === 'null' ? null : Number(key), count }))
    .sort((a, b) => {
      const av = a.expiresAtDay ?? Number.POSITIVE_INFINITY;
      const bv = b.expiresAtDay ?? Number.POSITIVE_INFINITY;
      return av - bv;
    });
  return { itemId: stack.itemId, batches };
}

export function makeStack(itemId: string, count: number, expiresAtDay: number | null): ItemStack {
  return normalizeStack({ itemId, batches: [{ expiresAtDay, count }] });
}

export function stackLimitOf(itemId: string): number {
  return getItemDef(itemId).stackLimit;
}

/**
 * 从最早批次开始取走 count 件（FEFO 取用；§5 引擎④）。
 * 返回取出的堆与剩下的堆（剩下为空则 left = null）。
 */
export function splitStack(
  stack: ItemStack,
  count: number
): { taken: ItemStack; left: ItemStack | null } {
  const normalized = normalizeStack(stack);
  const taken: ItemStack = { itemId: normalized.itemId, batches: [] };
  const left: ItemStack = { itemId: normalized.itemId, batches: [] };
  let remain = Math.max(0, count);
  for (const batch of normalized.batches) {
    if (remain <= 0) {
      left.batches.push({ ...batch });
      continue;
    }
    const take = Math.min(batch.count, remain);
    if (take > 0) {
      taken.batches.push({ expiresAtDay: batch.expiresAtDay, count: take });
      remain -= take;
    }
    const rest = batch.count - take;
    if (rest > 0) left.batches.push({ expiresAtDay: batch.expiresAtDay, count: rest });
  }
  return {
    taken: normalizeStack(taken),
    left: left.batches.length === 0 ? null : normalizeStack(left)
  };
}

/** 该格还能再塞几件同物资（不同物资 / 满格返回 0） */
export function roomInSlot(shelf: Shelf, pos: SlotPos, itemId: string): number {
  const cur = getStack(shelf, pos);
  const limit = stackLimitOf(itemId);
  if (!cur) return limit;
  if (cur.itemId !== itemId) return 0;
  return Math.max(0, limit - stackCount(cur));
}

// ———————— 放置 / 交换 ————————

/** 该格能否接下这一堆：空格看上限；同物资可合并，也看上限；不同物资不行（真实货架纪律） */
export function canAccept(shelf: Shelf, pos: SlotPos, stack: ItemStack): boolean {
  if (!isInside(shelf, pos)) return false;
  const cur = getStack(shelf, pos);
  const incoming = stackCount(stack);
  if (incoming <= 0) return false;
  if (!cur) return incoming <= stackLimitOf(stack.itemId);
  if (cur.itemId !== stack.itemId) return false;
  return stackCount(cur) + incoming <= stackLimitOf(stack.itemId);
}

export function setSlotStack(shelf: Shelf, pos: SlotPos, stack: ItemStack | null): Shelf {
  if (!isInside(shelf, pos)) return shelf;
  const next = cloneShelf(shelf);
  const row = next.slots[pos.row];
  if (!row) return shelf;
  row[pos.col] = { stack: stack ? cloneStack(stack) : null };
  return next;
}

/** 放进指定格：空格则放入，同物资则合并（合并后按到期日归一化）。放不下返回 null。 */
export function dropStack(shelf: Shelf, pos: SlotPos, stack: ItemStack): Shelf | null {
  const cur = getStack(shelf, pos);
  if (!cur) {
    if (stackCount(stack) > stackLimitOf(stack.itemId)) return null;
    return setSlotStack(shelf, pos, stack);
  }
  if (cur.itemId !== stack.itemId) return null;
  if (!canAccept(shelf, pos, stack)) return null;
  return setSlotStack(shelf, pos, normalizeStack(mergeBatches(cur, stack)));
}

function mergeBatches(a: ItemStack, b: ItemStack): ItemStack {
  return { itemId: a.itemId, batches: [...a.batches, ...b.batches] };
}

/** 取走一格：返回新货架与被取走的堆 */
export function takeStack(shelf: Shelf, pos: SlotPos): { shelf: Shelf; stack: ItemStack | null } {
  const cur = getStack(shelf, pos);
  if (!cur) return { shelf, stack: null };
  return { shelf: setSlotStack(shelf, pos, null), stack: cloneStack(cur) };
}

function moveWithinShelf(shelf: Shelf, from: SlotPos, to: SlotPos): Shelf | null {
  if (samePos(from, to)) return shelf;
  const src = getStack(shelf, from);
  if (!src) return null;
  const dst = getStack(shelf, to);
  if (!dst) return dropStack(setSlotStack(shelf, from, null), to, src);
  if (dst.itemId === src.itemId) {
    return dropStack(setSlotStack(shelf, from, null), to, src);
  }
  // 交换：两件物资各自落到对方的格子（格容量按物资本身校验过，交换必然装得下）
  return setSlotStack(setSlotStack(shelf, to, src), from, dst);
}

/** 货架内 / 跨货架移动（目标占用则交换）。移动失败返回 null。 */
export function moveStack(
  from: Shelf,
  fromPos: SlotPos,
  to: Shelf,
  toPos: SlotPos
): { from: Shelf; to: Shelf } | null {
  if (from.id === to.id) {
    const next = moveWithinShelf(from, fromPos, toPos);
    return next ? { from: next, to: next } : null;
  }
  const src = getStack(from, fromPos);
  if (!src) return null;
  const dst = getStack(to, toPos);
  const fromCleared = setSlotStack(from, fromPos, null);
  if (!dst) {
    const toNext = dropStack(to, toPos, src);
    if (!toNext) return null;
    return { from: fromCleared, to: toNext };
  }
  if (dst.itemId === src.itemId) {
    const toNext = dropStack(to, toPos, src);
    if (!toNext) return null;
    return { from: fromCleared, to: toNext };
  }
  return { from: setSlotStack(fromCleared, fromPos, dst), to: setSlotStack(to, toPos, src) };
}

/** 自动找位：优先合并进同类且有富余的格，否则第一个能放下的空格。找不到返回 null。 */
export function autoPlace(
  shelf: Shelf,
  stack: ItemStack
): { shelf: Shelf; pos: SlotPos } | null {
  const order = readingOrder(shelf);
  let emptyFallback: SlotPos | null = null;
  for (const pos of order) {
    const cur = getStack(shelf, pos);
    if (!cur) {
      if (emptyFallback === null) emptyFallback = pos;
      continue;
    }
    if (cur.itemId !== stack.itemId) continue;
    if (!canAccept(shelf, pos, stack)) continue;
    const next = dropStack(shelf, pos, stack);
    if (next) return { shelf: next, pos };
  }
  if (emptyFallback) {
    const next = dropStack(shelf, emptyFallback, stack);
    if (next) return { shelf: next, pos: emptyFallback };
  }
  return null;
}

// ———————— FEFO（引擎④ 对齐的快感） ————————

/**
 * 把整架物资按到期日升序重排，从左上角开始紧凑码放；不易腐的排最后。
 *
 * ★ 排序只动**东西的次序**，绝不动这架货架的属性：`zoneId`（贴的胶带）与
 * `handyRank`（顺手位）都必须原样带过去。
 *
 * 这不是可选的严谨 —— 它曾经是个真 bug：重建货架时只传了 `zoneId`，
 * 于是"帮我按保质期排"这颗按钮会把顺手位悄悄抹掉。
 * 而顺手位是 `HANDY_SLOTS = 1` 的**全屋唯一**标记（§12.3 v0.7.1），
 * 玩家按一次排序就丢掉它、而且屏幕上没有任何提示 —— 那正是最难查的一类 bug：
 * 数值全都对，只是你之前做过的那个决定不见了。
 * 单测里有一条专门盯着它（`shelf.test.ts` 的"排序不动货架属性"）。
 */
export function fefoSorted(shelf: Shelf): Shelf {
  const stacks = readingOrder(shelf)
    .map((pos) => getStack(shelf, pos))
    .filter((s): s is ItemStack => s !== null)
    .sort((a, b) => {
      const d = fefoKey(a) - fefoKey(b);
      if (d !== 0) return d;
      return a.itemId.localeCompare(b.itemId);
    });
  let next = createShelf(shelf.id, shelf.roomId, shelf.kind, shelf.w, shelf.h, shelf.zoneId);
  next.handyRank = shelf.handyRank;
  const order = readingOrder(next);
  for (let i = 0; i < stacks.length; i++) {
    const pos = order[i];
    const stack = stacks[i];
    if (!pos || !stack) break;
    next = setSlotStack(next, pos, stack);
  }
  return next;
}

/** 同架是否已按到期日升序（空槽忽略；不易腐视为 +∞ 排在最后） */
export function isShelfFEFO(shelf: Shelf): boolean {
  const keys = readingOrder(shelf)
    .map((pos) => getStack(shelf, pos))
    .filter((s): s is ItemStack => s !== null)
    .map(fefoKey);
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1] as number;
    const cur = keys[i] as number;
    if (prev > cur) return false;
  }
  return true;
}

export function shelfIsEmpty(shelf: Shelf): boolean {
  return readingOrder(shelf).every((pos) => getStack(shelf, pos) === null);
}

export function countStacks(shelf: Shelf): number {
  return readingOrder(shelf).filter((pos) => getStack(shelf, pos) !== null).length;
}

export function shelfFillRate(shelf: Shelf): number {
  const total = shelf.w * shelf.h;
  return total === 0 ? 0 : countStacks(shelf) / total;
}

// ———————— 分区 / 归位率 / FEFO 率（整理品质三个可量化维度中的两个） ————————

/** 分区是否接收该物资：没写规则 = 玩家自己说了算（引擎① 自建秩序，游戏不评判对错） */
export function zoneAccepts(zone: Zone | null, item: ItemDef): boolean {
  if (!zone) return false;
  const rule = zone.autoAccept;
  if (!rule) return true;
  const cats = rule.categories ?? [];
  const tags = rule.tags ?? [];
  if (cats.length === 0 && tags.length === 0) return true;
  if (cats.includes(item.category)) return true;
  return item.tags.some((t) => tags.includes(t));
}

/**
 * 这张胶带有没有**明确接收**这件物资 —— 即它写了清单，而且清单里有它。
 *
 * ## 为什么必须与 `zoneAccepts` 分开（§12 v0.8 归位率修复）
 *
 * `zoneAccepts` 回答的是「**容不容**」：没写清单 = 什么都收。它是对的，
 * 而且它的读者（`consume.ts` 的取用顺序、`isOffZone` 的墨点）本来就该这么读 ——
 * 一张空胶带确实没有把任何东西排除在外，所以它不该被人格化成"你放错了"。
 *
 * 但归位率问的是另一个问题：「**你有没有按自己写的清单放**」，
 * 而它要的正是"**明确**"这两个字 —— 没有清单就无从谈起"按清单放"。
 *
 * M1 把这两个问题混成了一个判定，后果当场就被玩家抓到了：
 * **贴一张空胶带 = 什么都收 = 归位率恒满**，于是最优解退化成"贴一张空胶带"，
 * §5 引擎①「自建秩序」的全部乐趣被一个 loophole 绕过去了。
 * 修法就是这一处：归位率的分子只认 `zoneListedFor`（明确清单），
 * 而 `zoneAccepts` 维持原义 —— 两者名字不同、问题不同，注释就在这里把账说清。
 *
 * 一个直接的后果，也是刻意的：**"上架了但没写清单"与"全堆在纸箱里"
 * 在归位率上完全等价（都是 0）**。它们当然还是有区别的 ——
 * 上了架的取用排在纸箱前面、也不会被墨点点名 —— 但"你有没有守自己写的秩序"
 * 这一项，两者都还没开始。实测数字见策划案 §12 的 v0.8 标注。
 */
export function zoneListedFor(zone: Zone | null, item: ItemDef): boolean {
  if (!zone) return false;
  const rule = zone.autoAccept;
  if (!rule) return false;
  const cats = rule.categories ?? [];
  const tags = rule.tags ?? [];
  if (cats.includes(item.category)) return true;
  return item.tags.some((t) => tags.includes(t));
}

/**
 * 这一堆是不是"不在这张胶带的清单里" —— **只给格子上的小色点用**。
 *
 * 与 zoneAccepts 是同一套判定，但刻意分成两个名字，因为两件事语义不同：
 *  - `zoneAccepts` = 这张胶带收不收它（客观事实，参与算分）；
 *  - `isOffZone`  = 要不要在界面上点一个小色点（表现决策）。
 *
 * 两条刻意的规则：
 *  1. **没贴胶带的货架永不提示**。§5 引擎①：「不整理也能活」——
 *     没有分区是一种正经活法，不是错误，不该被点名。
 *  2. 提示必须是**中性**的：界面上用墨色空心小点，不用朱红（§5A 规定朱红 = 警告/重要）。
 *     §5 明说"游戏不评判对错"，这个点表达的是"它不在这张胶带的清单里"，
 *     而不是"你放错了"。文案与颜色都不许说教。
 */
export function isOffZone(zone: Zone | null, stack: ItemStack): boolean {
  if (!zone) return false;
  return !zoneAccepts(zone, getItemDef(stack.itemId));
}

export function findZone(zones: readonly Zone[], zoneId: string | null): Zone | null {
  if (!zoneId) return null;
  return zones.find((z) => z.id === zoneId) ?? null;
}

/**
 * 归位率 = 放在"**明确接收它**的清单"上的堆数 ÷ **你拥有的全部堆数**。
 *
 * ## 分子只认明确清单（§12 v0.8 修复的 loophole）
 *
 * 原来分子走的是 `zoneAccepts`，而它对"没写清单的胶带"返回 true ——
 * 于是「贴一张空胶带」= 什么都收 = 归位率恒满。玩家实测当场指出这个漏洞：
 * 最优解退化成贴一张空胶带，引擎① 的决策乐趣被绕过。
 *
 * 现在改走 `zoneListedFor`：**只有被某张清单明确写进去的堆才算归位**。
 * 没贴胶带的货架、贴了空清单的胶带、清单里没有它的 —— 三种都是"还没归位"。
 * 语义因此变得可以一句话说完：**归位率量的是"你守没守自己写的秩序"**。
 *
 * 由此产生两条刻意的后果（都写进策划案 §12 v0.8 的实测表）：
 *  1. "上架了但一张清单都没写"与"全堆在纸箱里"在归位率上同为 0 ——
 *     区别转移到取用顺序（上了架的排在纸箱前）与墨点（空清单不点名）；
 *  2. **不写任何清单的屋子，整理质量的上限被锁死在 fefo 那一项（0.4）**，
 *     每天净掉 6 点体力。连清单都不写的人活不过第二周 ——
 *     这是修复的代价，不是事故，见策划案 §12 v0.8 的修订理由。
 *
 * ## 分母必须包含还没拆的纸箱
 *
 * 否则会出现一个荒谬的结果：玩家一件都没上架、23 件主食全堆在纸箱里，
 * 归位率却显示 100% —— 因为货架是空的，"空房间"按 M0 的宽容规则返回了 1。
 * 那把这个指标变成了谎话，也让"拆箱上架"失去了数值上的必要。
 *
 * 仍然保留"M0 的宽容"：真的什么都没有时（手上无货、架上无货）返回 1，
 * 而不是 0 —— 开局第一秒不该给玩家一个 0%。
 */
export function placementRate(
  shelves: readonly Shelf[],
  zones: readonly Zone[],
  boxes: readonly UnpackBox[] = []
): number {
  let total = 0;
  let ok = 0;
  for (const shelf of shelves) {
    const zone = findZone(zones, shelf.zoneId);
    for (const pos of readingOrder(shelf)) {
      const stack = getStack(shelf, pos);
      if (!stack) continue;
      total += 1;
      if (zoneListedFor(zone, getItemDef(stack.itemId))) ok += 1;
    }
  }
  // 纸箱里的每一堆都是"还没被安置"的，它们算分母、不算分子
  for (const box of boxes) total += box.items.length;
  return total === 0 ? 1 : ok / total;
}

/**
 * 顺手位有几块：**全屋唯一**（§12.3 v0.7.1，玩家拍板）。
 *
 * 最初按"门口那两块"做成了上限 2，玩家实测后指出：能标两块就会有人全标上 ——
 * 而且门口那块本该只有一个答案。唯一化之后它才是一个真的取舍：
 * 24 格要同时装下燃料（15 格）和药，就必然有东西挤不进顺手位。
 */
export const HANDY_SLOTS = 1;

/** 顺手位货架，按顺位从先到后（`1` = 门口那块） */
export function handyShelves(shelves: readonly Shelf[]): Shelf[] {
  return shelves
    .filter((s) => s.handyRank !== null)
    .sort((a, b) => (a.handyRank ?? 0) - (b.handyRank ?? 0));
}

/**
 * 某品类在**顺手位**货架上一共有多少件（只数货架，纸箱里的显然不在顺手位）。
 *
 * 它是两处的共同输入，所以必须只有一个实现：
 *  · §6.3 的第三维「应急可达率」—— 急用品有多大比例放在顺手位；
 *  · 生存期结算里"体力见底的时候，哪些还够得到"。
 *
 * 两处各写一份的话，玩家会看到"应急率 100% 但翻不动时还是拿不到药"这种自相矛盾。
 */
export function countOnHandy(shelves: readonly Shelf[], category: CategoryId): number {
  let total = 0;
  for (const shelf of handyShelves(shelves)) {
    for (const pos of readingOrder(shelf)) {
      const stack = getStack(shelf, pos);
      if (!stack) continue;
      if (getItemDef(stack.itemId).category !== category) continue;
      total += stackCount(stack);
    }
  }
  return total;
}

/**
 * FEFO 率 = 非空货架中已按到期日升序的比例（同一套尺子，不许含糊）。
 *
 * ★ 货架全空时返回 **0**，不是 1（M1 手测后修正）。
 *
 * 这里跟 `placementRate` 的"空房间宽容规则"刻意相反，理由是两个指标问的问题不一样：
 *   · 归位率问"你摆好了多少" —— 手上真的没货时给 1（开局第一秒不该是 0%）；
 *   · FEFO 率问"你排好了多少" —— 一块货架都没用上是**还没开始排**，不是"全都排好了"。
 *
 * 原来返回 1 的后果被玩家当场抓到：**囤了 17 箱一口没拆、货架全空，临期优先却显示 100%**。
 * 它同时还是"整理质量"的输入之一（见 data/survival.ts 的 organizeQuality），
 * 所以这个 1 会直接漏进生存期的体力结算里 —— 不整理的人反而拿到满分的排架成绩。
 */
export function fefoRate(shelves: readonly Shelf[]): number {
  const nonEmpty = shelves.filter((s) => !shelfIsEmpty(s));
  if (nonEmpty.length === 0) return 0;
  const ok = nonEmpty.filter((s) => isShelfFEFO(s)).length;
  return ok / nonEmpty.length;
}

export interface ShelfView {
  shelf: Shelf;
  zone: Zone | null;
  fefoOk: boolean;
  stacks: number;
}

export function shelfViews(shelves: readonly Shelf[], zones: readonly Zone[]): ShelfView[] {
  return shelves.map((shelf) => ({
    shelf,
    zone: findZone(zones, shelf.zoneId),
    fefoOk: isShelfFEFO(shelf),
    stacks: countStacks(shelf)
  }));
}
