/**
 * 货架纯逻辑（策划案 §6.3 整理 = 核心中的核心）。
 *
 * 本文件属于 model/：纯函数、无副作用，不碰任何浏览器 API（DOM、定时器、音频）。
 * 所有函数返回**新的** Shelf，不改入参 —— 配合原子存档，任何中间状态都能整份写盘。
 */
import { getItemDef } from '../data/items';
import type { ItemDef, ItemStack, Shelf, Slot, SlotPos, UnpackBox, Zone } from './types';

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
  return { id, roomId, kind, w, h, slots, zoneId };
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

/** 把整架物资按到期日升序重排，从左上角开始紧凑码放；不易腐的排最后 */
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
 * 归位率 = 放在"接受它"的胶带上的堆数 ÷ **你拥有的全部堆数**。
 *
 * 分母必须包含**还没拆的纸箱**（第三个参数），否则会出现一个荒谬的结果：
 * 玩家一件都没上架、23 件主食全堆在纸箱里，归位率却显示 100% ——
 * 因为货架是空的，"空房间"按 M0 的宽容规则返回了 1。
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
      if (zoneAccepts(zone, getItemDef(stack.itemId))) ok += 1;
    }
  }
  // 纸箱里的每一堆都是"还没被安置"的，它们算分母、不算分子
  for (const box of boxes) total += box.items.length;
  return total === 0 ? 1 : ok / total;
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
