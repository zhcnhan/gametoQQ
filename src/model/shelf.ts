/**
 * 货架纯逻辑（策划案 §6.3 整理 = 核心中的核心）。
 *
 * 本文件属于 model/：纯函数、无副作用，不碰任何浏览器 API（DOM、定时器、音频）。
 * 所有函数返回**新的** Shelf，不改入参 —— 配合原子存档，任何中间状态都能整份写盘。
 */
import { getItemDef } from '../data/items';
import { EXHAUSTED_REACH } from '../data/survival';
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
  // zoneIds 与 slots 同长：**一行一个位置**（粒度是行，见 `Shelf.zoneIds` 的注释）
  const zoneIds: (string | null)[] = Array.from({ length: h }, () => zoneId);
  return { id, roomId, kind, w, h, slots, zoneIds, handyRank: null };
}

export function cloneShelf(shelf: Shelf): Shelf {
  return {
    ...shelf,
    slots: shelf.slots.map((row) => row.map((slot) => cloneSlot(slot))),
    // 数组也要拷：否则"给这一行贴胶带"会改到原对象（原子存档要求返回新对象）
    zoneIds: [...shelf.zoneIds]
  };
}

export function cloneSlot(slot: Slot): Slot {
  return { stack: slot.stack ? cloneStack(slot.stack) : null };
}

export function cloneStack(stack: ItemStack): ItemStack {
  return { itemId: stack.itemId, batches: stack.batches.map((b) => ({ ...b })) };
}

/**
 * 坐标是否落在这块货架里。
 *
 * ★★ **必须是整数** —— 这条不能只用范围比较写。
 *
 * 压测（`scripts/stress.mjs`）抓到一个丢件的输入：坐标给小数（`row = 0.5`）时，
 * `0.5 >= 0 && 0.5 < h` 成立 → 这里判为"在界内"，
 * 但 `slots[0.5]` 是 `undefined`，于是 `setSlotStack` 走到 `if (!row) return shelf;`
 * **静默返回原货架**（没放上去），而 `placeHeld` 那边已经把东西从手里清掉了 ——
 * **放置报成功、物资却消失了**（实测全屋 21 → 19 件）。
 *
 * 界面造不出小数坐标（来自 `data-row` / `data-col`），但"静默失败"是最坏的失败方式：
 * 调用方以为成功了。加上整数判定之后，越界坐标会被明确拒绝（`placeHeld` 会 reject）。
 */
export function isInside(shelf: Shelf, pos: SlotPos): boolean {
  if (!Number.isInteger(pos.row) || !Number.isInteger(pos.col)) return false;
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
  /*
   * 想要拆出来的件数：**整数、且不超过这一叠的总数**。
   *
   * ★ `Math.floor` 是必须的：批次件数可能是小数（压测会造出 1.5 + 1.5 这种输入，
   * 而 `normalizeStack` 不会把它取整）。不取整的话 `want = 3` 而 `Number.isInteger` 判 false
   * → 直接归 0，**守恒就断了**（这是我第一版引入的回归，靠"整数输入下守恒"那条断言抓出来）。
   */
  const total = normalized.batches.reduce((n, b) => n + b.count, 0);
  const want = Number.isInteger(count) && count > 0 ? Math.min(count, Math.floor(total)) : 0;
  let remain = want;
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
/**
 * 「帮我按保质期排」——**按胶带分组**排，而不是整块架子一起排。
 *
 * ## ★★ 这条是走测反馈改的（2026-10）
 *
 * 用户的原话：
 *
 * > "这个他只能做到同架升序，**做不到一行分组排序**哦"
 *
 * 他说得对，而且这比"排序不够好"严重：原来它把**整块架子**上的堆按到期日
 * 一股脑重排，于是**货会从自己那一行被搬到别的行** ——
 * 而"哪一行放什么"正是玩家自己立的规矩。按一次按钮就把分类冲掉，
 * 那这个按钮是**破坏性的**，玩家只能不用它。
 *
 * 现在按 `fefoGroups` 分组：每一组（同一张胶带的多行 + 没贴胶带的行各自成一组）
 * 在自己的**格子范围内**按到期日升序排。货物的归属不变，只是组内换了位置 ——
 * 与 `fefoRate` 的口径（M3 已改成按组统计）也对齐了。
 *
 * ★ 排序**不动胶带**：`zoneIds` 原样带走。行级分区是玩家立的规矩。
 */
export function fefoSorted(shelf: Shelf): Shelf {
  let next = createShelf(shelf.id, shelf.roomId, shelf.kind, shelf.w, shelf.h);
  next.handyRank = shelf.handyRank;
  next.zoneIds = [...shelf.zoneIds];

  for (const group of fefoGroups(shelf)) {
    /*
     * 这一组的格子（按行序、行内按列序 = 与 `readingOrder` 同一顺序），
     * 以及这一组现在装着的东西。
     */
    const cells: SlotPos[] = [];
    for (const row of [...group.rows].sort((a, b) => a - b)) {
      for (let col = 0; col < shelf.w; col++) cells.push({ row, col });
    }
    const stacks = cells
      .map((pos) => getStack(shelf, pos))
      .filter((s): s is ItemStack => s !== null)
      .sort((a, b) => {
        const d = fefoKey(a) - fefoKey(b);
        if (d !== 0) return d;
        return a.itemId.localeCompare(b.itemId);
      });

    // 先清空这一组的格子，再按排好的顺序填回去 —— 组与组之间互不越界
    for (const pos of cells) next = setSlotStack(next, pos, null);
    for (let i = 0; i < stacks.length; i++) {
      const pos = cells[i];
      const stack = stacks[i];
      if (!pos || !stack) break;
      next = setSlotStack(next, pos, stack);
    }
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

/**
 * **这一行**是否按到期日升序。
 *
 * ★ 胶带细到行之后（用户拍板 2026-10），"排好序"这件事也该细到行 ——
 * 因为玩家立规矩的单位就是行：一块货架上"主食那两行要按到期日排、
 * 最上面那行随便堆"是完全合理的意图，而按**整架**判定会把它判成没排好。
 */
export function isRowFEFO(shelf: Shelf, row: number): boolean {
  const keys: number[] = [];
  for (let col = 0; col < shelf.w; col++) {
    const stack = getStack(shelf, { row, col });
    if (stack) keys.push(fefoKey(stack));
  }
  for (let i = 1; i < keys.length; i++) {
    if ((keys[i - 1] as number) > (keys[i] as number)) return false;
  }
  return true;
}

/**
 * 按**胶带**分组的 FEFO：每一组（同一张胶带的那些行 + 没贴胶带的行各自成组）
 * 都要按到期日升序。
 *
 * ## 为什么分组算，而不是"每行都排好"
 *
 * 同一张胶带贴在**两块货架**上时（用户明确要的"可以给多行使用"），
 * 那两块上属于它的行构成**一个**整理单位 —— 玩家把主食分两块架子放是常态，
 * 而他写的那张"主食"清单说的是"这些格子里的东西按到期日排"。
 * 逐行各排各的会允许"第 1 行 3 号到期、第 2 行 1 号到期"，
 * 而那个组合在取用上确实是错的（FEFO 的意义就是先拿快到期的）。
 *
 * ## 没贴胶带的行也算一组
 *
 * 它们不是"免检"：一堆没过期日排序的散货，`fefo` 那一项拿不到分。
 * 所以"没贴胶带"不会让这一项白送 —— 与归位率那边"没写清单就是 0"不同，
 * 这里量的是**顺序**，而顺序对没贴胶带的堆同样有意义。
 */
export function fefoGroups(shelf: Shelf): { zoneId: string | null; rows: number[] }[] {
  const byZone = new Map<string, number[]>();
  for (let row = 0; row < shelf.h; row++) {
    const id = rowZoneId(shelf, row);
    const key = id ?? '';
    const list = byZone.get(key) ?? [];
    list.push(row);
    byZone.set(key, list);
  }
  return [...byZone.entries()].map(([key, rows]) => ({ zoneId: key === '' ? null : key, rows }));
}

/** 一个分组（同一张胶带的多行）是否整体按到期日升序 */
export function isGroupFEFO(shelf: Shelf, rows: readonly number[]): boolean {
  const keys: number[] = [];
  // 按行号升序读，行内按列 —— 与 `readingOrder` 同一顺序
  for (const row of [...rows].sort((a, b) => a - b)) {
    for (let col = 0; col < shelf.w; col++) {
      const stack = getStack(shelf, { row, col });
      if (stack) keys.push(fefoKey(stack));
    }
  }
  for (let i = 1; i < keys.length; i++) {
    if ((keys[i - 1] as number) > (keys[i] as number)) return false;
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

// ———————— 分区（胶带）：粒度是**一行** ————————

/**
 * 这一行属于哪张胶带（`null` = 没贴）。
 *
 * ★ **所有读"行分区"的地方都必须走这里**，不许直接写 `shelf.zoneIds[row]`。
 * 理由与 `disasterModifiersOf` 是同一个：数组可以被手改档、可以被旧代码写短、
 * 行号可以越界 —— 而 `zoneIds[7]` 在只有 4 行的货架上返回 `undefined`，
 * `undefined` 与 `null` 在 `findZone` 里**表现相同**（都当成没贴），
 * 所以那种错**不会报错**，只会静默地当没贴。
 *
 * 越界一律当"没贴"（`null`）—— 而不是抛：这一行读在渲染路径上。
 */
export function rowZoneId(shelf: Shelf, row: number): string | null {
  const v = shelf.zoneIds[row];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * 给一行贴上 / 撕下胶带。返回**新的** `zoneIds` 数组（不改入参）。
 *
 * ★ 长度按 `shelf.h` 补齐：老档的 `zoneIds` 可能比行数短（迁移补的），
 * 而"写第 3 行"时数组必须真的有 3 个位置 —— 否则写入会被 JS 静默丢掉。
 */
export function setRowZoneId(shelf: Shelf, row: number, zoneId: string | null): (string | null)[] {
  const next = [...shelf.zoneIds];
  while (next.length < shelf.h) next.push(null);
  if (row >= 0 && row < shelf.h) next[row] = zoneId;
  return next;
}

/** 这块货架用到了哪几张胶带（去重，按行序） */
export function zoneIdsOf(shelf: Shelf): string[] {
  const out: string[] = [];
  for (let row = 0; row < shelf.h; row++) {
    const id = rowZoneId(shelf, row);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 这块货架有没有贴过胶带 */
export function hasAnyZone(shelf: Shelf): boolean {
  return zoneIdsOf(shelf).length > 0;
}

/**
 * 这块货架**第一张**用到的胶带 id（一行都没贴返回 `null`）。
 *
 * ★ 抽屉在"没指定看哪一行"时用它取"当前那张"。一块货架可以贴两张胶带，
 * 所以"这架贴着的是什么"在一般情况下**没有唯一答案** ——
 * 这个函数是那个问题的降级答案，用在"玩家没告诉我们看哪一行"的时候。
 */
export function firstZoneIdOf(shelf: Shelf): string | null {
  for (let row = 0; row < shelf.h; row++) {
    const id = rowZoneId(shelf, row);
    if (id) return id;
  }
  return null;
}

/**
 * **整块货架贴着同一张胶带**时返回它的 id，否则 `null`。
 *
 * ★ 它是"这一架有没有被当成一个整体"这个问题的答案，有两个真实用途：
 *
 *  ① **界面措辞**：整块一张时可以说"这架贴着「主食」"；一行一张时只能说
 *     "这架贴了 2 行"—— 说错了就是假话，而玩家会照那句话去理解自己的货架；
 *  ② **测试**：老的用例全是"整块贴一张"的语义，这个函数让它们**保义**地
 *     迁到行级结构上（而不是把断言放松成 `toContain`）。
 *
 * ⚠ 注意它**不是**"第一张"：一行都没贴与贴了两张都返回 `null`。
 * 想要"随便给我一张"请用 `firstZoneIdOf`。两个问题不同，别混。
 */
export function onlyZoneIdOf(shelf: Shelf): string | null {
  const ids = new Set<string | null>();
  for (let row = 0; row < shelf.h; row++) ids.add(rowZoneId(shelf, row));
  return ids.size === 1 ? ([...ids][0] ?? null) : null;
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
 *  1. "上架了但一张清单都没写"与"全堆在纸箱里"在**归位率**上同为 0 ——
 *     区别转移到取用顺序（上了架的排在纸箱前）、墨点（空清单不点名）
 *     与**临期优先**（上了架、且按到期日排好，那一项仍然拿得到分）；
 *  2. "没写清单"不是 0 与 1 之间的某一档，它就是 0。所以 `moodFromPlacement`
 *     那个 `> 0` 的档（心情 −2）在归位率这一项上永远不会被触发：
 *     归位率只有"一件都没归位"和"归位了一部分"两种状态，
 *     而"一部分"要求至少有一张清单写过。这是修复的副作用，不是设计 ——
 *     真要给它一个中间档，该动的是 `moodFromPlacement` 的分档，不是这里的分子。
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
    /*
     * ★ 一行一张胶带（用户拍板 2026-10）。
     *
     * 这里原来是 `findZone(zones, shelf.zoneId)` —— **一块货架一个 zone**。
     * 现在每一行各查各的：同一块架子上，"主食那两行"可以算归位、
     * "最上面那行"不算。这就是"归位率的分母细到行"的落地。
     *
     * ⚠ 一个刻意的后果：**贴胶带贴得越细，能拿到的分越多** ——
     * 只贴一行也能把那一行的堆算进分子。会不会让最优解退化成
     * "每行都贴一张"？会，而那正是"想清楚每一行放什么"这个动作本身，
     * 不是 loophole（与 v0.8 修掉的"贴一张空胶带"不同：空清单不接收任何东西）。
     */
    for (let row = 0; row < shelf.h; row++) {
      const zone = findZone(zones, rowZoneId(shelf, row));
      for (let col = 0; col < shelf.w; col++) {
        const stack = getStack(shelf, { row, col });
        if (!stack) continue;
        total += 1;
        if (zoneListedFor(zone, getItemDef(stack.itemId))) ok += 1;
      }
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
 * ★ **这一堆是不是"写明了放哪儿"**（M4 W-08 的判据）。
 *
 * 两种情况算：① 它在**顺手位**那块架子上；② 它所在那一**行**贴着一张
 * **明确收它**的胶带（`zoneListedFor` —— 与归位率同一把尺子）。
 *
 * ## 为什么"贴了胶带"也算够得到
 *
 * 这一格要回答的是"**体力见底那天，屋里哪些东西不用翻就找得到**"。
 * 而"贴了胶带"这件事的含义正是"我知道这类东西在哪一行" —— 它省掉的**不是距离，
 * 是翻找**。所以它与顺手位是同一类东西（都让取用不必翻），只是强度不同：
 * 顺手位是"伸手就拿"，胶带是"直着走过去拿"。
 *
 * ★ 判据刻意走 `zoneListedFor` 而不是 `zoneAccepts`（与归位率同一个理由）：
 * 一张**空胶带**什么都收，所以它没有告诉你任何东西 —— 那种"贴了等于没贴"
 * 正是 §12 v0.8 修掉的那个 loophole，这里不能再开一个后门。
 */
export function isInPlaceFor(shelf: Shelf, row: number, item: ItemDef, zones: readonly Zone[]): boolean {
  if (shelf.handyRank !== null) return true;
  return zoneListedFor(findZone(zones, rowZoneId(shelf, row)), item);
}

/**
 * ★★ **体力见底那一天，这个品类能凑到几件** —— 生存期结算那条算式的模型层版本。
 *
 * 口径（与 `systems/survival.ts` 的结算逐字一致）：
 * **一半的需求（向上取整）＋ 顺手位上的那些**。
 *  · 一半是"翻不动也还剩一口气"的那条底（`EXHAUSTED_REACH`，刻意不是 0 ——
 *    饿死人不该由"累"来完成）；
 *  · 顺手位上的**不用翻**，所以是**加**上去的，不受那一半的限制。
 *
 * ## ⚠ 它**刻意不看胶带**（"顺手位 ∪ 贴了清单的行"是另一件事）
 *
 * 我一度想让这个函数也认胶带（"写明放哪儿的都算够得到"），那样日报那一格
 * 与结算就是同一个口径了 —— 但那条路会把**顺手位在"最糟那天"的唯一性**
 * 让给胶带，于是"门口那一块"退化成可有可无。两者的分工要保住：
 *
 * | 谁 | 管什么 |
 * | --- | --- |
 * | **胶带**（`isInPlaceFor` 的那一半） | 取用顺序与归位 —— 每天省的是**翻找** |
 * | **顺手位**（`countOnHandy`） | 最糟的那天**够不够得着** —— 就是这一条 |
 *
 * 所以这里只认顺手位，而日报的 `handyDays` 读 `isInPlaceFor` ——
 * **两个问题不同，读数就该不同。** 注释写在这里，免得下一个人把它们"统一"掉。
 *
 * ⚠ 它是**结算那条算式的复印件**，而复印件会漂（§2.16）。目前它没有生产读者
 * （结算自己写着那三行，见 `systems/survival.ts` 里那段"刻意不看胶带"的注释），
 * 留着的唯一理由是给测试一个可直接调用的口径。**改动结算那一行时，这里要跟着改。**
 *
 * @param need 这一类今天要几件（基础消耗，不含硬撑加码）
 */
export function dailyReachable(
  shelves: readonly Shelf[],
  category: CategoryId,
  need: number,
  exhausted: boolean
): number {
  if (need <= 0) return 0;
  const handy = countOnHandy(shelves, category);
  return exhausted ? Math.min(need, Math.max(0, Math.ceil(need * EXHAUSTED_REACH)) + handy) : need;
}

/**
 * 某品类**写明放哪儿**的总件数（顺手位 ∪ 贴了收它的清单的行）。
 *
 * 它是 `dailyReachable` 与日报那一格共同的分子，所以只允许一个实现 ——
 * 与 `countOnHandy` 的注释是同一条纪律（"两处各写一份，玩家会看到自相矛盾"）。
 */
export function countInPlace(shelves: readonly Shelf[], zones: readonly Zone[], category: CategoryId): number {
  let total = 0;
  for (const shelf of shelves) {
    for (let row = 0; row < shelf.h; row++) {
      for (let col = 0; col < shelf.w; col++) {
        const stack = getStack(shelf, { row, col });
        if (!stack) continue;
        const item = getItemDef(stack.itemId);
        if (item.category !== category) continue;
        if (!isInPlaceFor(shelf, row, item, zones)) continue;
        total += stackCount(stack);
      }
    }
  }
  return total;
}

/**
 * FEFO 率 = **按胶带分组**之后，已按到期日升序的组数 ÷ 非空的组数。
 *
 * ★ 口径跟着胶带一起细到行（用户拍板 2026-10）。
 *
 * 原来的口径是"非空**货架**里排好的比例"，而胶带细到行之后，
 * 玩家立规矩的单位变成了**行**：一块货架上"主食那两行按到期日排、
 * 最上面那行随手堆"是合理意图，按整架判会把它判成没排好。
 * 所以现在按 `fefoGroups` 分组统计（同一张胶带的多行 = 一组，
 * 没贴胶带的行各自成一组）。
 *
 * ★ 分组**全空**时返回 **0**，不是 1（M1 手测后修正，这条没变）。
 *
 * 这里跟 `placementRate` 的"空房间宽容规则"刻意相反，理由是两个指标问的问题不一样：
 *   · 归位率问"你摆好了多少" —— 手上真的没货时给 1（开局第一秒不该是 0%）；
 *   · FEFO 率问"你排好了多少" —— 一组格子都没用上是**还没开始排**，不是"全都排好了"。
 *
 * 原来返回 1 的后果被玩家当场抓到：**囤了 17 箱一口没拆、货架全空，临期优先却显示 100%**。
 * 它同时还是"整理质量"的输入之一（见 data/survival.ts 的 organizeQuality），
 * 所以这个 1 会直接漏进生存期的体力结算里 —— 不整理的人反而拿到满分的排架成绩。
 *
 * ⚠ 一个刻意的后果：**一块货架现在会贡献多个组**（贴了两张胶带就是两组）。
 * 分母因此从"几块货架"变成"几组格子" —— 贴胶带贴得越细，这一项的分母越大。
 * 那是对的：分得更细的人，本来就该在更细的尺度上被衡量。
 */
export function fefoRate(shelves: readonly Shelf[]): number {
  let total = 0;
  let ok = 0;
  for (const shelf of shelves) {
    for (const group of fefoGroups(shelf)) {
      // 这一组里一件东西都没有 → 不算分母（空组不是"排好了"，也不是"没排"）
      const hasAny = group.rows.some((row) => {
        for (let col = 0; col < shelf.w; col++) if (getStack(shelf, { row, col })) return true;
        return false;
      });
      if (!hasAny) continue;
      total += 1;
      if (isGroupFEFO(shelf, group.rows)) ok += 1;
    }
  }
  return total === 0 ? 0 : ok / total;
}

export interface ShelfView {
  shelf: Shelf;
  /** 这块货架**用到了哪些**胶带（一行一张，所以可能不止一张） */
  zoneIds: string[];
  /** 每一行的胶带与颜色（界面按行上色，顺序 = 行序） */
  rowZones: (Zone | null)[];
  fefoOk: boolean;
  stacks: number;
}

export function shelfViews(shelves: readonly Shelf[], zones: readonly Zone[]): ShelfView[] {
  return shelves.map((shelf) => ({
    shelf,
    zoneIds: zoneIdsOf(shelf),
    rowZones: Array.from({ length: shelf.h }, (_, row) => findZone(zones, rowZoneId(shelf, row))),
    fefoOk: fefoGroups(shelf).every((g) => isGroupFEFO(shelf, g.rows)),
    stacks: countStacks(shelf)
  }));
}
