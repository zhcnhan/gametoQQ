/**
 * 整理系统：**ui 唯一被允许调用的写入口**（提示词 0 第 3 条）。
 *
 * 本文件属于 systems/：纯逻辑，不碰任何浏览器 API（DOM、定时器、音频）。
 * 副作用只有一处 —— 通过 store.commit() 改状态并落盘；手感（音效/拟声字/动画）
 * 由本文件返回的 OrganizeEvent 描述，交给 fx/ 与 ui/ 去演。
 */
import { getBoxDef, STRAY_BOX_ID } from '../data/boxes';
import { getDisasterDef } from '../data/disaster';
import { CATEGORY_ORDER, getItemDef } from '../data/items';
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
import { boxLabel, nextBoxSeq } from './setup';

// ———————— 事件（表现层的唯一输入） ————————

export type OrganizeEvent =
  | { type: 'boxOpened'; boxId: string; itemId: string; leftInBox: number }
  | { type: 'boxEmptied'; boxId: string; label: string }
  | { type: 'picked'; itemId: string; shelfId: string; pos: SlotPos }
  | { type: 'placed'; itemId: string; shelfId: string; pos: SlotPos; partial: boolean; count: number }
  /**
   * 两格**互相**交换（谁都不进手里）。
   *
   * ★ 它与"`placed` 落在一个被占用的格子上"是两件事，M2 走测时被玩家要求拆开：
   *  · `placed` 落在占用格 = "我把手里的东西放上去，那一件换到我手里"（接着搬）；
   *    这是**点选-点放**的路径，手里本来就有东西；
   *  · 这里 = "这两件对调"：A 去 B 的位置、B 去 A 的位置，**手始终是空的**。
   *    这是**拖拽**的路径。合成一件事的话，玩家想理一下顺序时会发现
   *    "我只是想把这两件对调，结果有一件跑到手上来了"。
   */
  | {
      type: 'swapped';
      itemId: string;
      shelfId: string;
      pos: SlotPos;
      /** 被换走的那一件（去到 `from`） */
      toItemId: string;
      from: { shelfId: string; pos: SlotPos };
    }
  /** 放回：toWhere 是给玩家看的一句人话（"粮油箱" / "货架 B 的原位" / "临时搁置箱"） */
  | { type: 'returned'; itemId: string; toWhere: string }
  | { type: 'sorted'; changedShelves: number }
  | { type: 'tidy'; shelfId: string }
  | { type: 'zoneUpdated'; shelfId: string }
  /** 撕下一张胶带（affected = 一起被取下的货架数，供提示文案用） */
  | { type: 'zoneRemoved'; shelfId: string; name: string; affected?: number }
  /** 顺手位被标记 / 取消（§5 的"门口那一块"，全屋唯一） */
  | { type: 'handyChanged'; shelfId: string; rank: number | null }
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
  | { kind: 'box'; boxId: string }
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
  id: string;
  defId: string;
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
  return run.boxesToUnpack.map((box) => {
    const def = getBoxDef(box.defId);
    return {
      id: box.id,
      defId: box.defId,
      name: def.name,
      hint: def.hint,
      items: box.items,
      total: box.items.reduce((sum, s) => sum + stackCount(s), 0),
      top: box.items[0] ?? null
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
    // 归位率把还没拆的纸箱算进分母：它们同样是"还没被安置的货"
    score: computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, getDisasterDef(run.disasterId)),
    tidyShelfIds: [...session.tidyShelfIds]
  };
}

/**
 * 全副家当：货架上的 **+ 还没拆的箱子里的**。
 *
 * 与 inventoryTotals 的分工（两个数都要，不能合并成一个）：
 *  - inventoryTotals = "我已经摆好了多少"，整理界面的台账条看它，所以只数货架；
 *  - householdTotals = "这一局我总共囤到了多少"，结算界面看它 —— 没拆的箱子当然也是我的货，
 *    否则一个囤了 20 箱却懒得拆的玩家会在结算页看到"在库 0 件"。
 */
export function householdTotals(run: RunState): { stacks: number; pieces: number; weight: number } {
  const onShelf = inventoryTotals(run);
  let stacks = onShelf.stacks;
  let pieces = onShelf.pieces;
  let weight = onShelf.weight;
  for (const box of run.boxesToUnpack) {
    for (const stack of box.items) {
      stacks += 1;
      const n = stackCount(stack);
      pieces += n;
      weight += getItemDef(stack.itemId).unitWeight * n;
    }
  }
  return { stacks, pieces, weight: Math.round(weight * 100) / 100 };
}

/** 全房间物资合计（顶部台账条用：只算已上架的） */
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

export function takeFromBox(store: GameStore, session: OrganizeSession, boxId: string): CommandResult {
  if (session.held) {
    return reject('手里还捏着东西，先放上去');
  }
  const run = store.run;
  const box = run.boxesToUnpack.find((b) => b.id === boxId);
  if (!box) return reject('没有这个箱子');
  if (box.items.length === 0) return reject('这是个空箱');

  const item = box.items[0] as ItemStack;
  const leftInBox = Math.max(0, box.items.length - 1); // 先记下来：commit 会就地改到同一个对象上
  const label = boxLabel(box);
  const events: OrganizeEvent[] = [];

  store.commit((draft) => {
    const target = draft.boxesToUnpack.find((b) => b.id === boxId);
    if (!target || target.items.length === 0) return;
    target.items.shift();
    // 空箱自动压扁消失：直接把箱从队列里摘掉，ui 依据 boxEmptied 事件在旧位置放压扁动画。
    // 箱子用稳定 id 标识，摘箱不会让别的箱子"串位"，手里那件物资的来处依然准确。
    if (target.items.length === 0) {
      draft.boxesToUnpack.splice(draft.boxesToUnpack.indexOf(target), 1);
      events.push({ type: 'boxEmptied', boxId, label });
    }
  });

  session.held = item;
  session.heldFrom = { kind: 'box', boxId };
  events.unshift({ type: 'boxOpened', boxId, itemId: item.itemId, leftInBox });
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

  // ② 不同物资：**手上的这件放上去，格上那件进手里**（接着搬）
  //    注意这与 `swapSlots` 不是一回事：这里手是"满载"的，交换只是副产物。
  //    "两件对调、手保持空"是拖拽那条路径，走 `swapSlots`。
  store.commit((draft) => {
    const s = draft.shelves[idx];
    if (!s) return;
    draft.shelves[idx] = setSlotStack(s, pos, held);
  });
  session.held = target;
  session.heldFrom = { kind: 'shelf', shelfId, pos };
  const events: OrganizeEvent[] = [
    { type: 'placed', itemId: held.itemId, shelfId, pos, partial: false, count: stackCount(held) }
  ];
  events.push(...detectNewTidy(store.run, session));
  return ok(events);
}

/**
 * **两格互换**（拖拽专用）：`from` 与 `to` 上的东西对调，**手保持空**。
 *
 * ## 为什么它必须是一个独立命令（玩家要求）
 *
 * 原来的实现只有"把手里那件放到占用格上"，副产物是"被换的那件进手里"。
 * 对**点选-点放**来说那是对的（玩家本来就在搬东西，手上那件得有个去处）；
 * 但对**拖拽**来说是错的 —— 玩家的原话是
 * "他现在的交换逻辑不是把两个物品交换，而是把被交换的那个东西换到手上，这不好"。
 * 想理一下两件的顺序，结果手上多了一件，还得再找地方放下。
 *
 * ## 三条边界
 *
 *  · 两格必须都有东西（空格子的情况是"搬过去"，那只该走 `placeHeld`/`dropStack`）；
 *  · 同一件物资不互换（那是合并，交给 `placeHeld`）——否则会白耗一次操作、还弹个假音效；
 *  · 互不影响其它格子，也不碰 `session.held`（调用方负责确保手是空的）。
 */
export function swapSlots(
  store: GameStore,
  from: { shelfId: string; pos: SlotPos },
  to: { shelfId: string; pos: SlotPos }
): CommandResult {
  const run = store.run;
  const fromIdx = run.shelves.findIndex((s) => s.id === from.shelfId);
  const toIdx = run.shelves.findIndex((s) => s.id === to.shelfId);
  const fromShelf = fromIdx >= 0 ? run.shelves[fromIdx] : undefined;
  const toShelf = toIdx >= 0 ? run.shelves[toIdx] : undefined;
  if (!fromShelf || !toShelf) return reject('这里没有货架');
  if (!isInside(fromShelf, from.pos) || !isInside(toShelf, to.pos)) return reject('格子不存在');
  if (from.shelfId === to.shelfId && from.pos.row === to.pos.row && from.pos.col === to.pos.col) {
    return reject('同一格');
  }

  const a = getStack(fromShelf, from.pos);
  const b = getStack(toShelf, to.pos);
  if (!a || !b) return reject('两个格子都得有东西才谈得上互换');
  if (a.itemId === b.itemId) return reject('同一件物资，直接叠起来就行');

  store.commit((draft) => {
    // 同一块货架上换：一次改完，避免"先清空再写回"中间态被存档逮到
    if (fromIdx === toIdx) {
      const s = draft.shelves[fromIdx];
      if (!s) return;
      const cleared = setSlotStack(s, from.pos, null);
      draft.shelves[fromIdx] = setSlotStack(cleared, to.pos, a);
      const after = draft.shelves[fromIdx];
      if (after) draft.shelves[fromIdx] = setSlotStack(after, from.pos, b);
      return;
    }
    // 跨货架：两边各写一次
    const sFrom = draft.shelves[fromIdx];
    const sTo = draft.shelves[toIdx];
    if (sFrom) draft.shelves[fromIdx] = setSlotStack(sFrom, from.pos, b);
    if (sTo) draft.shelves[toIdx] = setSlotStack(sTo, to.pos, a);
  });

  return ok([
    {
      type: 'swapped',
      itemId: a.itemId,
      shelfId: to.shelfId,
      pos: to.pos,
      toItemId: b.itemId,
      from: { shelfId: from.shelfId, pos: from.pos }
    }
  ]);
}

// ———————— 命令：把手里的东西放回去（名副其实的"回原位"，永不丢件） ————————

function clearHeld(session: OrganizeSession): void {
  session.held = null;
  session.heldFrom = { kind: 'none' };
}

function shelfLabelOf(run: RunState, shelfId: string, index: number): string {
  const shelf = run.shelves.find((s) => s.id === shelfId);
  if (!shelf) return '货架';
  const kind = shelf.kind === 'fridge' ? '冰箱' : shelf.kind === 'cabinet' ? '柜子' : '货架';
  return `${kind} ${['A', 'B', 'C', 'D', 'E', 'F'][index] ?? index + 1}`;
}

/**
 * 放回 = 把这件物资送回**它来的地方**，按"越接近原位越优先"降落：
 *   ① 从货架拿的 → 原格（原位）
 *   ② 原格回不去 / 从箱子拿的 → 原货架自动找位 → 原箱内首位
 *   ③ 原位都回不去（比如原箱已经被压扁收走了）→ 全房间找位置
 *   ④ 实在放不下 → 开一个"临时搁置箱"（策划案 §12.3：永远留逆转口）
 */
export function returnHeld(store: GameStore, session: OrganizeSession): CommandResult {
  const held = session.held;
  if (!held) return reject('手里是空的');
  const run = store.run;
  const from = session.heldFrom;

  // ① 原格（原位优先，放回就是放回）
  if (from.kind === 'shelf') {
    const origin = from;
    const shelfIndex = run.shelves.findIndex((s) => s.id === origin.shelfId);
    const shelf = shelfIndex >= 0 ? run.shelves[shelfIndex] : undefined;
    if (shelf && getStack(shelf, origin.pos) === null && roomInSlot(shelf, origin.pos, held.itemId) > 0) {
      const restored = dropStack(shelf, origin.pos, held);
      if (restored) {
        store.commit((draft) => {
          const i = draft.shelves.findIndex((s) => s.id === origin.shelfId);
          if (i >= 0) draft.shelves[i] = restored;
        });
        clearHeld(session);
        return ok([{ type: 'returned', itemId: held.itemId, toWhere: `${shelfLabelOf(run, origin.shelfId, shelfIndex)} 原位` }]);
      }
    }
  }

  // ② 原货架 / 原箱
  if (from.kind === 'shelf') {
    const origin = from;
    const shelfIndex = run.shelves.findIndex((s) => s.id === origin.shelfId);
    const shelf = shelfIndex >= 0 ? run.shelves[shelfIndex] : undefined;
    const auto = shelf ? autoPlace(shelf, held) : null;
    if (auto && shelf) {
      const next = auto.shelf;
      store.commit((draft) => {
        const i = draft.shelves.findIndex((s) => s.id === origin.shelfId);
        if (i >= 0) draft.shelves[i] = next;
      });
      clearHeld(session);
      return ok([{ type: 'returned', itemId: held.itemId, toWhere: `${shelfLabelOf(run, origin.shelfId, shelfIndex)}（同架就近）` }]);
    }
  }

  if (from.kind === 'box') {
    const originBoxId = from.boxId;
    const box = run.boxesToUnpack.find((b) => b.id === originBoxId);
    if (box) {
      const label = boxLabel(box);
      store.commit((draft) => {
        const target = draft.boxesToUnpack.find((b) => b.id === originBoxId);
        // 塞回箱内首位：下一个摸出来的还是它，玩家的思路不会断
        if (target) target.items.unshift(held);
      });
      clearHeld(session);
      return ok([{ type: 'returned', itemId: held.itemId, toWhere: label }]);
    }
  }

  // ③ 全房间找位置
  for (let i = 0; i < run.shelves.length; i++) {
    const auto = autoPlace(run.shelves[i] as Shelf, held);
    if (!auto) continue;
    const shelfIndex = i;
    const next = auto.shelf;
    store.commit((draft) => {
      const target = draft.shelves[shelfIndex];
      if (target) draft.shelves[shelfIndex] = next;
    });
    clearHeld(session);
    return ok([{ type: 'returned', itemId: held.itemId, toWhere: shelfLabelOf(run, (run.shelves[i] as Shelf).id, i) }]);
  }

  // ④ 临时搁置箱
  store.commit((draft) => {
    draft.boxesToUnpack.push({
      id: `box_${nextBoxSeq(draft.boxesToUnpack)}`,
      defId: STRAY_BOX_ID,
      items: [held]
    });
  });
  clearHeld(session);
  return ok([{ type: 'returned', itemId: held.itemId, toWhere: '临时搁置箱' }]);
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
//
// 心智模型 = 纸胶带：**一张胶带 = 一个分区 = 名字 + 颜色 + 清单**，可以贴到任意多块货架上。
//  - 同名 = 同一张胶带（不会出现两个"主食区"），颜色以先贴的那张为准；
//  - **清单**（`Zone.autoAccept.categories`）= 这张胶带收哪些品类。这是"归位率"的全部依据：
//    东西放在"接受它"的胶带上才算归位。清单由玩家自己点，游戏不预设任何答案；
//  - **不填清单 = 什么都收**（归位率恒满）。"我不分类"是一种正经营法，不是错误；
//  - 撕下 = 从这架取下来，胶带还在（除非没有别的货架用它了，它会自己消失）。
//
// ★ 与 §5 引擎①「游戏不评判对错」的关系（这一层最容易做歪，写清楚）：
//   规则是**玩家写的**，所以"没按自己写的清单放"是"你没守住自己的秩序"，
//   不是"游戏说你错了"。据此，命令层做到三件事：
//     1. 永不因"放错"拒绝任何操作（placeHeld 完全不看分区）；
//     2. 永不返回"放错了"这类事件（§7 的事件表里就没有这一条）；
//     3. 界面上只允许一个**中性**信息点（model 层 isOffZone），
//        且**没贴胶带的货架永不提示**。压力测试留给生存期的日报去做。

export interface ZoneInput {
  name: string;
  color: string;
  /**
   * 这张胶带收哪些品类。**空 / 不传 = 什么都收**。
   *
   * 归一化规则：按 `CATEGORY_ORDER` 排序去重后再落盘 ——
   * 否则同一套选择会因为点击顺序不同而序列化出不同字符串（存档 diff 噪音）。
   */
  categories?: CategoryId[];
  /**
   * 显式指定"我在改这张已有的胶带"（改名 + 改色 + 改清单，其他贴着它的货架一起变）。
   * 不传则是"给这架写一段胶带"：同名复用，没有同名才新建。
   * 两种语义必须由 ui 明确区分，命令层不猜 —— 否则"改这张的名字"和"换一张新的"分不开。
   */
  zoneId?: string;
}

export function applyZone(store: GameStore, shelfId: string, input: ZoneInput): CommandResult {
  const run = store.run;
  const shelfIndex = run.shelves.findIndex((s) => s.id === shelfId);
  if (shelfIndex < 0) return reject('货架不存在');
  const name = input.name.trim();
  if (!name) return reject('胶带得有个名字');
  const color = input.color || DEFAULT_ZONE_COLOR;
  const categories = normalizeCategories(input.categories);
  const editId = input.zoneId;
  if (editId && !findZone(run.zones, editId)) return reject('没有这张胶带');

  store.commit((draft) => {
    const shelf = draft.shelves[shelfIndex];
    if (!shelf) return;

    // ① 明确在编辑某张胶带 → 改名 + 改色 + 改清单，id 不变，其他贴着它的货架一起跟着变
    if (editId) {
      const target = draft.zones.find((z) => z.id === editId);
      if (target) {
        target.name = name;
        target.color = color;
        writeZoneRule(target, categories);
      }
      return;
    }

    // ② 同名胶带已存在 → 复用同一张（绝不造重名分区）。
    //    注意：**这里绝不改写它的清单** —— 清单属于胶带本身，
    //    否则"把另一块架子也贴成主食区"会把主食区的清单按当前输入框的状态清掉。
    //    改清单只有一条路：上面的 ①（抽屉里点"改这段胶带"）。
    const sameName = draft.zones.find((z) => z.name === name);
    if (sameName) {
      const previous = shelf.zoneId;
      shelf.zoneId = sameName.id;
      if (previous && previous !== sameName.id) recycleIfOrphan(draft, previous);
      return;
    }

    // ③ 写一段新的：先把这架腾空（旧胶带若成孤儿就回收），再贴新的
    const previous = shelf.zoneId;
    shelf.zoneId = null;
    if (previous) recycleIfOrphan(draft, previous);
    const zone: Zone = { id: nextZoneId(draft.zones), name, color };
    writeZoneRule(zone, categories);
    draft.zones.push(zone);
    shelf.zoneId = zone.id;
  });

  return ok([{ type: 'zoneUpdated', shelfId }]);
}

/** 按稳定顺序归一化玩家的选择；空 = 什么都收（落盘时不带 autoAccept 字段，比存一个空对象干净） */
function normalizeCategories(input: readonly CategoryId[] | undefined): CategoryId[] {
  if (!input || input.length === 0) return [];
  return CATEGORY_ORDER.filter((c) => input.includes(c));
}

function writeZoneRule(zone: Zone, categories: CategoryId[]): void {
  if (categories.length === 0) {
    delete zone.autoAccept;
    return;
  }
  zone.autoAccept = { categories: [...categories] };
}

// ———————— 命令：顺手位（"门口那一块"，全屋唯一） ————————

/**
 * 把一块货架标成顺手位 / 取消（§5「应急货架（门口/最顺手位）」+ §6.3 的应急可达率）。
 *
 * **全屋唯一**（§12.3 v0.7.1 玩家拍板）：标第二块时旧的那块自动让位 ——
 * radio 语义，不是"最多 N 块"的配额。做成自动让位而不是弹拒绝，是因为
 * "先撤旧的、再标新的"是两步无意义的操作；换标记的意图本来就一目了然。
 * （存档层 `normalizeShelves` 仍按 `HANDY_SLOTS` 钳制，手改出来的多标记会被清掉。）
 *
 * 为什么是"标记"而不是"拖动排序"：整理页的货架是网格，长按拖动会和滚动打架，
 * 而 §4A 要求每个动作都能被中途打断。点一下表达的是同一件事，却不需要一个新手势。
 */
export function toggleHandy(store: GameStore, shelfId: string): CommandResult {
  const run = store.run;
  const idx = run.shelves.findIndex((s) => s.id === shelfId);
  const shelf = idx >= 0 ? run.shelves[idx] : undefined;
  if (!shelf) return reject('货架不存在');

  const current = shelf.handyRank;
  store.commit((draft) => {
    const target = draft.shelves[idx];
    if (!target) return;
    if (current !== null) {
      target.handyRank = null;
    } else {
      for (const s of draft.shelves) s.handyRank = null;
      target.handyRank = 1;
    }
  });

  return ok([{ type: 'handyChanged', shelfId, rank: store.run.shelves[idx]?.handyRank ?? null }]);
}

/** 把胶带贴到货架上；zoneId = null 表示"撕下"（这张胶带没人用了就自己消失） */
export function assignZone(store: GameStore, shelfId: string, zoneId: string | null): CommandResult {
  const run = store.run;
  const shelfIndex = run.shelves.findIndex((s) => s.id === shelfId);
  if (shelfIndex < 0) return reject('货架不存在');
  const shelfNow = run.shelves[shelfIndex];
  const previousZone = shelfNow ? findZone(run.zones, shelfNow.zoneId) : null;
  if (zoneId !== null && !findZone(run.zones, zoneId)) return reject('没有这张胶带');

  store.commit((draft) => {
    const shelf = draft.shelves[shelfIndex];
    if (!shelf) return;
    const previous = shelf.zoneId;
    shelf.zoneId = zoneId;
    // 取下/换贴之后，如果旧胶带没有任何货架在用，就把它收走
    if (previous && previous !== zoneId) recycleIfOrphan(draft, previous);
  });

  const events: OrganizeEvent[] = [{ type: 'zoneUpdated', shelfId }];
  if (!zoneId && previousZone) events.push({ type: 'zoneRemoved', shelfId, name: previousZone.name });
  return ok(events);
}

/** 显式剪掉一张胶带（UI 的"撕下最后一块"已能自动回收，这个留给脚本/M1 用） */
export function deleteZone(store: GameStore, zoneId: string): CommandResult {
  const run = store.run;
  const zone = findZone(run.zones, zoneId);
  if (!zone) return reject('没有这张胶带');
  const affected = run.shelves.filter((s) => s.zoneId === zoneId).length;
  store.commit((draft) => {
    draft.zones = draft.zones.filter((z) => z.id !== zoneId);
    for (const shelf of draft.shelves) {
      if (shelf.zoneId === zoneId) shelf.zoneId = null;
    }
  });
  return ok([{ type: 'zoneRemoved', shelfId: '', name: zone.name, affected }]);
}

/** 这张胶带还有货架在用吗？没有就收走（撕下最后一块货架 = 胶带消失） */
function recycleIfOrphan(run: RunState, zoneId: string): void {
  if (run.shelves.some((s) => s.zoneId === zoneId)) return;
  run.zones = run.zones.filter((z) => z.id !== zoneId);
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
