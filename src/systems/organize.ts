/**
 * 整理系统：**ui 唯一被允许调用的写入口**（提示词 0 第 3 条）。
 *
 * 本文件属于 systems/：纯逻辑，不碰任何浏览器 API（DOM、定时器、音频）。
 * 副作用只有一处 —— 通过 store.commit() 改状态并落盘；手感（音效/拟声字/动画）
 * 由本文件返回的 OrganizeEvent 描述，交给 fx/ 与 ui/ 去演。
 */
import { BOX_DEFS } from '../data/boxes';
import { getItemDef } from '../data/items';
import { DEFAULT_ZONE_COLOR } from '../data/palette';
import {
  autoPlace,
  dropStack,
  fefoSorted,
  findZone,
  getStack,
  isInside,
  isShelfFEFO,
  readingOrder,
  roomInSlot,
  setSlotStack,
  shelfIsEmpty,
  splitStack,
  stackCount
} from '../model/shelf';
import { computeOrganizeScore, type OrganizeScore } from '../model/score';
import type { CategoryId, ItemStack, RunState, Shelf, SlotPos, Zone } from '../model/types';
import type { GameStore } from '../state/store';

// ———————— 事件（表现层的唯一输入） ————————

export type OrganizeEvent =
  | { type: 'boxOpened'; boxIndex: number; itemId: string; leftInBox: number }
  | { type: 'boxEmptied'; boxIndex: number }
  | { type: 'picked'; itemId: string; shelfId: string; pos: SlotPos }
  | { type: 'placed'; itemId: string; shelfId: string; pos: SlotPos; partial: boolean; count: number }
  | { type: 'swapped'; itemId: string; shelfId: string; pos: SlotPos }
  | { type: 'returned'; itemId: string }
  | { type: 'sorted'; changedShelves: number }
  | { type: 'tidy'; shelfId: string }
  | { type: 'zoneUpdated'; shelfId: string }
  | { type: 'rejected'; reason: string };

export interface CommandResult {
  ok: boolean;
  events: OrganizeEvent[];
}

function reject(reason: string): CommandResult {
  return { ok: false, events: [{ type: 'rejected', reason }] };
}

function ok(events: OrganizeEvent[]): CommandResult {
  return { ok: true, events };
}

// ———————— 会话态（不进存档） ————————

/**
 * 手里捏着的物资**不落盘**：§4A 明说"整理到一半的状态完整保留（手里捏着的物资回到原位即可）"。
 * 刷新后 held 丢失 = 那件物资回到它原来的箱子/格子，正是策划案要的行为。
 */
export type HeldOrigin =
  | { kind: 'none' }
  | { kind: 'box'; boxRef: number }
  | { kind: 'shelf'; shelfId: string; pos: SlotPos };

export interface OrganizeSession {
  held: ItemStack | null;
  heldFrom: HeldOrigin;
  /** 已经给过"整整齐齐"小字奖励的货架，避免每放一件就弹一次 */
  tidyShelfIds: string[];
}

export function createOrganizeSession(): OrganizeSession {
  return { held: null, heldFrom: { kind: 'none' }, tidyShelfIds: [] };
}

/** 重开一局时清空会话态（手里那件物资跟着作废） */
export function resetSession(session: OrganizeSession): void {
  session.held = null;
  session.heldFrom = { kind: 'none' };
  session.tidyShelfIds = [];
}

// ———————— 视图模型（ui 只读） ————————

export interface BoxView {
  index: number;
  name: string;
  hint: string;
  items: ItemStack[];
  total: number;
  top: ItemStack | null;
}

export interface OrganizeView {
  shelves: Shelf[];
  zones: Zone[];
  boxes: BoxView[];
  held: ItemStack | null;
  score: OrganizeScore;
  tidyShelfIds: string[];
}

export function buildBoxViews(run: RunState): BoxView[] {
  return run.boxesToUnpack.map((items, index) => {
    // 箱型按顺序贴在开局生成的箱子上；超出定义范围的箱（M1 采购补货）走兜底名字
    const def = BOX_DEFS[index % BOX_DEFS.length];
    return {
      index,
      name: def?.name ?? '没写标签的箱',
      hint: def?.hint ?? '',
      items,
      total: items.reduce((sum, s) => sum + stackCount(s), 0),
      top: items[0] ?? null
    };
  });
}

export function buildView(store: GameStore, session: OrganizeSession): OrganizeView {
  const run = store.run;
  return {
    shelves: run.shelves,
    zones: run.zones,
    boxes: buildBoxViews(run),
    held: session.held,
    score: computeOrganizeScore(run.shelves, run.zones),
    tidyShelfIds: [...session.tidyShelfIds]
  };
}

/** 全房间物资合计（顶部台账条用） */
export function inventoryTotals(run: RunState): { stacks: number; pieces: number; weight: number } {
  let stacks = 0;
  let pieces = 0;
  let weight = 0;
  for (const shelf of run.shelves) {
    for (const pos of readingOrder(shelf)) {
      const stack = getStack(shelf, pos);
      if (!stack) continue;
      stacks += 1;
      const n = stackCount(stack);
      pieces += n;
      weight += getItemDef(stack.itemId).unitWeight * n;
    }
  }
  return { stacks, pieces, weight };
}

// ———————— 命令：拆箱 ————————

export function takeFromBox(store: GameStore, session: OrganizeSession, boxIndex: number): CommandResult {
  if (session.held) {
    return reject('手里还捏着东西，先放上去');
  }
  const run = store.run;
  const box = run.boxesToUnpack[boxIndex];
  if (!box || box.length === 0) return reject('这是个空箱');

  const item = box[0] as ItemStack;
  const leftInBox = Math.max(0, box.length - 1); // 先记下来：commit 会就地改到同一个数组对象上
  const events: OrganizeEvent[] = [];

  store.commit((draft) => {
    const target = draft.boxesToUnpack[boxIndex];
    if (!target || target.length === 0) return;
    target.shift();
    // 空箱自动压扁消失：直接把箱从队列里摘掉，ui 依据 boxEmptied 事件在旧位置放压扁动画
    if (target.length === 0) {
      draft.boxesToUnpack.splice(boxIndex, 1);
      events.push({ type: 'boxEmptied', boxIndex });
    }
  });

  session.held = item;
  session.heldFrom = { kind: 'box', boxRef: boxIndex };
  events.unshift({ type: 'boxOpened', boxIndex, itemId: item.itemId, leftInBox });
  return ok(events);
}

// ———————— 命令：格子点击（点选-点放的主入口） ————————

export function tapSlot(store: GameStore, session: OrganizeSession, shelfId: string, pos: SlotPos): CommandResult {
  if (session.held) return placeHeld(store, session, shelfId, pos);
  return pickupFromShelf(store, session, shelfId, pos);
}

export function pickupFromShelf(store: GameStore, session: OrganizeSession, shelfId: string, pos: SlotPos): CommandResult {
  if (session.held) return reject('手里已经拿着东西了');
  const run = store.run;
  const idx = run.shelves.findIndex((s) => s.id === shelfId);
  const shelf = idx >= 0 ? run.shelves[idx] : undefined;
  if (!shelf) return reject('这里没有货架');
  if (!isInside(shelf, pos)) return reject('格子不存在');
  const stack = getStack(shelf, pos);
  if (!stack) return ok([]); // 点空格＝什么也没发生，不打扰

  store.commit((draft) => {
    const s = draft.shelves[idx];
    if (!s) return;
    draft.shelves[idx] = setSlotStack(s, pos, null);
  });

  session.held = stack;
  session.heldFrom = { kind: 'shelf', shelfId, pos };
  return ok([{ type: 'picked', itemId: stack.itemId, shelfId, pos }]);
}

/** 放置（长按拖拽落点也走这里，保证两条操作路径行为完全一致） */
export function placeHeld(store: GameStore, session: OrganizeSession, shelfId: string, pos: SlotPos): CommandResult {
  const held = session.held;
  if (!held) return reject('手里是空的');
  const run = store.run;
  const idx = run.shelves.findIndex((s) => s.id === shelfId);
  const shelf = idx >= 0 ? run.shelves[idx] : undefined;
  if (!shelf) return reject('这里没有货架');
  if (!isInside(shelf, pos)) return reject('格子不存在');

  const target = getStack(shelf, pos);

  // ① 空格 / 同类合并：算这一格还能塞几件，塞不下的留在手里（永不死锁）
  if (!target || target.itemId === held.itemId) {
    const room = roomInSlot(shelf, pos, held.itemId);
    if (room <= 0) return reject('这一格塞不下了');
    const move = Math.min(room, stackCount(held));
    const { taken, left } = splitStack(held, move);
    store.commit((draft) => {
      const s = draft.shelves[idx];
      if (!s) return;
      const dropped = dropStack(s, pos, taken);
      if (dropped) draft.shelves[idx] = dropped;
    });
    session.held = left;
    if (!left) session.heldFrom = { kind: 'none' };
    const events: OrganizeEvent[] = [
      { type: 'placed', itemId: held.itemId, shelfId, pos, partial: left !== null, count: move }
    ];
    events.push(...detectNewTidy(store.run, session));
    return ok(events);
  }

  // ② 不同物资：交换（格上的东西进手里）
  store.commit((draft) => {
    const s = draft.shelves[idx];
    if (!s) return;
    draft.shelves[idx] = setSlotStack(s, pos, held);
  });
  session.held = target;
  session.heldFrom = { kind: 'shelf', shelfId, pos };
  const events: OrganizeEvent[] = [{ type: 'swapped', itemId: held.itemId, shelfId, pos }];
  events.push(...detectNewTidy(store.run, session));
  return ok(events);
}

// ———————— 命令：把手里的东西放回去（永不丢件） ————————

export function returnHeld(store: GameStore, session: OrganizeSession): CommandResult {
  const held = session.held;
  if (!held) return reject('手里是空的');
  const run = store.run;

  // ① 先试原格 / 原货架
  if (session.heldFrom.kind === 'shelf') {
    const origin = session.heldFrom;
    const idx = run.shelves.findIndex((s) => s.id === origin.shelfId);
    const shelf = idx >= 0 ? run.shelves[idx] : undefined;
    if (shelf) {
      const exact = getStack(shelf, origin.pos) === null && roomInSlot(shelf, origin.pos, held.itemId) > 0;
      const pos = exact ? origin.pos : null;
      const placed = pos
        ? { shelf: dropStack(shelf, pos, held), pos }
        : (() => {
            const auto = autoPlace(shelf, held);
            return auto ? { shelf: auto.shelf, pos: auto.pos } : null;
          })();
      const nextShelf = placed ? placed.shelf : null;
      if (nextShelf) {
        store.commit((draft) => {
          const target = draft.shelves.find((s) => s.id === origin.shelfId);
          if (!target) return;
          const i = draft.shelves.indexOf(target);
          draft.shelves[i] = nextShelf;
        });
        session.held = null;
        session.heldFrom = { kind: 'none' };
        return ok([{ type: 'returned', itemId: held.itemId }]);
      }
    }
  }

  // ② 再试全房间任意有位置的货架
  for (let i = 0; i < run.shelves.length; i++) {
    const auto = autoPlace(run.shelves[i] as Shelf, held);
    if (!auto) continue;
    const shelfIndex = i;
    store.commit((draft) => {
      const target = draft.shelves[shelfIndex];
      if (target) draft.shelves[shelfIndex] = auto.shelf;
    });
    session.held = null;
    session.heldFrom = { kind: 'none' };
    return ok([{ type: 'returned', itemId: held.itemId }]);
  }

  // ③ 实在放不下：新开一个箱子装着，等玩家腾出地方（策划案 §12.3：永远留逆转口）
  store.commit((draft) => {
    draft.boxesToUnpack.push([held]);
  });
  session.held = null;
  session.heldFrom = { kind: 'none' };
  return ok([{ type: 'returned', itemId: held.itemId }]);
}

// ———————— 命令：FEFO 一键排序（"帮我按保质期排"） ————————

export function sortAllByFEFO(store: GameStore, session: OrganizeSession): CommandResult {
  let changed = 0;
  store.commit((draft) => {
    draft.shelves = draft.shelves.map((shelf) => {
      const before = orderSignature(shelf);
      const after = fefoSorted(shelf);
      const next = orderSignature(after) === before ? shelf : after;
      if (next !== shelf) changed += 1;
      return next;
    });
  });
  const events: OrganizeEvent[] = [{ type: 'sorted', changedShelves: changed }];
  events.push(...detectNewTidy(store.run, session));
  return ok(events);
}

/** 用"物资顺序指纹"判断排序是否真的动了货架，避免没变化也放音效 */
function orderSignature(shelf: Shelf): string {
  return readingOrder(shelf)
    .map((pos) => {
      const stack = getStack(shelf, pos);
      if (!stack) return '-';
      return `${stack.itemId}:${stackCount(stack)}`;
    })
    .join('|');
}

// ———————— 命令：分区（引擎① 自建秩序） ————————

export interface ZoneInput {
  name: string;
  color: string;
  categories: CategoryId[];
}

export function applyZone(store: GameStore, shelfId: string, input: ZoneInput): CommandResult {
  const run = store.run;
  const shelfIndex = run.shelves.findIndex((s) => s.id === shelfId);
  if (shelfIndex < 0) return reject('货架不存在');
  const name = input.name.trim();
  if (!name) return reject('分区得起个名字');
  const categories = [...new Set(input.categories)];
  const autoAccept = categories.length > 0 ? { categories } : undefined;

  store.commit((draft) => {
    const shelf = draft.shelves[shelfIndex];
    if (!shelf) return;
    const existing = findZone(draft.zones, shelf.zoneId);
    if (existing) {
      existing.name = name;
      existing.color = input.color || DEFAULT_ZONE_COLOR;
      if (autoAccept) existing.autoAccept = autoAccept;
      else delete existing.autoAccept;
      return;
    }
    const zone: Zone = {
      id: nextZoneId(draft.zones),
      name,
      color: input.color || DEFAULT_ZONE_COLOR,
      ...(autoAccept ? { autoAccept } : {})
    };
    draft.zones.push(zone);
    shelf.zoneId = zone.id;
  });

  return ok([{ type: 'zoneUpdated', shelfId }]);
}

/** 把某个已存在的分区指派给货架（分区列表里点一下就行） */
export function assignZone(store: GameStore, shelfId: string, zoneId: string | null): CommandResult {
  const run = store.run;
  const shelfIndex = run.shelves.findIndex((s) => s.id === shelfId);
  if (shelfIndex < 0) return reject('货架不存在');
  if (zoneId !== null && !findZone(run.zones, zoneId)) return reject('分区不存在');
  store.commit((draft) => {
    const shelf = draft.shelves[shelfIndex];
    if (shelf) shelf.zoneId = zoneId;
  });
  return ok([{ type: 'zoneUpdated', shelfId }]);
}

export function deleteZone(store: GameStore, zoneId: string): CommandResult {
  const run = store.run;
  if (!findZone(run.zones, zoneId)) return reject('分区不存在');
  store.commit((draft) => {
    draft.zones = draft.zones.filter((z) => z.id !== zoneId);
    for (const shelf of draft.shelves) {
      if (shelf.zoneId === zoneId) shelf.zoneId = null;
    }
  });
  return ok([]);
}

function nextZoneId(zones: readonly Zone[]): string {
  let max = 0;
  for (const z of zones) {
    const n = Number(z.id.replace(/^zone_/, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `zone_${max + 1}`;
}

// ———————— 内部：整整齐齐检测（§5A 招牌奖励） ————————

/**
 * 触发条件按 §5A 原文："一整列 FEFO 排满时给'整整齐齐'小字奖励" —— 只要求该架非空且已按到期日升序。
 * 归位率是另一套尺子（§6.3），留给结算界面，不混着用。
 */
function detectNewTidy(run: RunState, session: OrganizeSession): OrganizeEvent[] {
  const events: OrganizeEvent[] = [];
  const current: string[] = [];
  for (const shelf of run.shelves) {
    if (shelfIsEmpty(shelf) || !isShelfFEFO(shelf)) continue;
    current.push(shelf.id);
    if (!session.tidyShelfIds.includes(shelf.id)) events.push({ type: 'tidy', shelfId: shelf.id });
  }
  session.tidyShelfIds = current;
  return events;
}
