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
import { LIVING_ROOM_ID, roomDefOf } from '../data/rooms';
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
  rowZoneId,
  setRowZoneId,
  setSlotStack,
  shelfIsEmpty,
  splitStack,
  stackCount
} from '../model/shelf';
import { computeOrganizeScore, type OrganizeScore } from '../model/score';
import type { CategoryId, HeldOrigin, ItemStack, RunState, Shelf, SlotPos, Zone } from '../model/types';
import type { GameStore } from '../state/store';
import { addFurnitureToHome, roomForNewFurniture } from './home';
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
  /**
   * 新建了一张胶带（**还没贴在哪儿**）。
   *
   * ★ 它与 `zoneUpdated` 分开，因为玩家看到的后果不同：
   * 前者是"手里多了一张新胶带"（架上多一个 chip），后者是"某张胶带变了样"。
   * 合并的话，界面无法用同一条事件决定要不要提示"拖它到某一行上"。
   */
  | { type: 'zoneCreated'; name: string }
  /** 撕下一张胶带（affected = 一起被取下的货架数，供提示文案用） */
  | { type: 'zoneRemoved'; shelfId: string; name: string; affected?: number }
  /** 顺手位被标记 / 取消（§5 的"门口那一块"，全屋唯一） */
  | { type: 'handyChanged'; shelfId: string; rank: number | null }
  /** 新加了一块家具（§10.2.4 的"新货架 / 新家具类型"） */
  | { type: 'furnitureAdded'; shelfId: string; kind: Shelf['kind']; roomId: string; roomLabel: string }
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

/*
 * `HeldOrigin` 现在定义在 `model/types.ts`（它要落盘，而 RunState 引用了它）。
 * 这里重新导出，是为了不破坏已有的 `import { type HeldOrigin } from './organize'`。
 */
export type { HeldOrigin };

export interface OrganizeSession {
  /**
   * 手里正捏着的那件物资。
   *
   * ## ★ 它与 `run.held` 是**同一件事**，必须同步（这是被一个真 bug 逼出来的）
   *
   * 这个字段原来只活在内存里，于是"拿起来之后刷新页面"会让物资**凭空消失**：
   * 格子/箱子里已经被移走了，会话又没了。
   *
   * 现在**落盘的那一份在 `run.held` / `run.heldFrom`**（随 `store.commit` 一起进存档），
   * 而这个字段是它的**内存镜像** —— 让 ui 与命令层读起来方便（不必每次翻 saveGame）。
   *
   * `setHeld()` / `clearHeldState()` 是两个唯一的写入口，它们保证两边不会分家。
   * **不要直接赋值**：那正是"两份状态各自漂移"的来源。
   */
  held: ItemStack | null;
  heldFrom: HeldOrigin;
  /** 已经给过"整整齐齐"小字奖励的货架，避免每放一件就弹一次 */
  tidyShelfIds: string[];
}

/**
 * 唯一允许改"手里那件"的地方 —— 同时写内存镜像与落盘字段。
 *
 * `next` 为 null 表示把手清空。**两边一起改**，不允许只改一边。
 */
function setHeld(run: RunState, session: OrganizeSession, next: ItemStack | null, from: HeldOrigin): void {
  session.held = next;
  session.heldFrom = next ? from : { kind: 'none' };
  run.held = next;
  run.heldFrom = next ? from : { kind: 'none' };
}

export function createOrganizeSession(): OrganizeSession {
  return { held: null, heldFrom: { kind: 'none' }, tidyShelfIds: [] };
}

/**
 * 从存档里恢复整理会话（刷新/读档后调用）。
 *
 * ★ 这条函数存在的理由就是"手里那件不许丢"。见 `RunState.held` 的注释。
 *
 * 正常情况下 `run.held` 与 `run.heldFrom` 是一对有效数据，直接镜像到会话即可。
 * 但如果来处**已经不存在**了（箱子被拆空后消失、格子被人为改过），
 * 就把物资送进**临时搁置箱** —— 宁可它出现在一个奇怪的地方，
 * 也**绝不允许它消失**。这与 `returnHeld` 的最后一级兜底是同一个口径。
 *
 * @returns 是否发生了一次"归档到临时搁置箱"（供调用方决定要不要提交落盘）
 */
export function restoreOrganizeSession(store: GameStore, session: OrganizeSession): boolean {
  const run = store.run;
  const held = run.held;
  if (!held) {
    // 没有手里那件 → 会话也必须是空的（防止两份状态不一致）
    session.held = null;
    session.heldFrom = { kind: 'none' };
    return false;
  }

  const from = run.heldFrom;
  const originAlive =
    from.kind === 'shelf'
      ? run.shelves.some((s) => s.id === from.shelfId)
      : from.kind === 'box'
        ? run.boxesToUnpack.some((b) => b.id === from.boxId)
        : true; // kind:'none' → 原位无从谈起，就地保持"拿在手里"

  if (originAlive) {
    session.held = held;
    session.heldFrom = from;
    return false;
  }

  // 来处没了 → 进临时搁置箱，绝不丢
  store.commit((draft) => {
    draft.boxesToUnpack.push({
      id: `box_${nextBoxSeq(draft.boxesToUnpack)}`,
      defId: STRAY_BOX_ID,
      items: [held]
    });
    draft.held = null;
    draft.heldFrom = { kind: 'none' };
  });
  session.held = null;
  session.heldFrom = { kind: 'none' };
  return true;
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
  /*
   * ★ **手里那件也算家里的**（v15 补的一个连带 bug）。
   *
   * "拿起来"会把物资从格子/箱子里移走，所以不把它算进来的话：
   *  · 顶部台账条的"在库 N 件"会在玩家举着东西时**少算**；
   *  · 依赖 `householdTotals` 的探针 / 测试同样少算 —— 而那是本项目的验收工具。
   * 一件物资不会因为在手里就不属于这个家。
   */
  if (run.held) {
    stacks += 1;
    const n = stackCount(run.held);
    pieces += n;
    weight += getItemDef(run.held.itemId).unitWeight * n;
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

  // 唯一写入口：同时写内存镜像（session）与落盘字段（run）
  setHeld(run, session, item, { kind: 'box', boxId });
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

  setHeld(run, session, stack, { kind: 'shelf', shelfId, pos });
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
    /*
     * 剩下的（可能没有）留在手里。
     *
     * 有剩余时来处记 `none`：手里这件是"上一步没放下的一部分"，
     * 它不该被当成"从某一格拖起来的"，否则下一次落点会被判成互换。
     */
    setHeld(run, session, left, { kind: 'none' });
    const events: OrganizeEvent[] = [
      { type: 'placed', itemId: held.itemId, shelfId, pos, partial: left !== null, count: move }
    ];
    events.push(...detectNewTidy(store.run, session));
    countShelved(store, move);
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
  // 格上那件进手里，来处就是这一格（"接着搬"的语义）
  setHeld(run, session, target, { kind: 'shelf', shelfId, pos });
  const events: OrganizeEvent[] = [
    { type: 'placed', itemId: held.itemId, shelfId, pos, partial: false, count: stackCount(held) }
  ];
  events.push(...detectNewTidy(store.run, session));
  countShelved(store, stackCount(held));
  return ok(events);
}

/**
 * 累计"生涯上架过多少件"（v16，成就「仓库管理员」读它）。
 *
 * ## ★ 为什么记在 `placeHeld` 里，而不是结算时数一遍货架
 *
 * "上架过 300 件"问的是**玩家做过的动作总量**，而"货架上现在有多少件"
 * 回答的是**此刻的状态** —— 两者会被两件事拉开：玩家可以把东西拿下来
 * （`pickupFromShelf`）、可以整堆搬回箱子（`returnHeld`）。
 * 结算时数货架的话，一个反复搬了 500 件、最后只留 20 件在架上的玩家
 * 会被记成 20 —— 而那恰恰是这条成就**最该奖励**的那个人。
 *
 * ## 为什么只数"放上去"的一个方向
 *
 * 拿下来不减。这条成就奖励的是**搬运的劳作本身**，而"我又把它拿下来了"
 * 不该抹掉那次弯腰。两个方向都记会让它变成"净上架量"，
 * 而那个数会随着玩家整理来整理去反复横跳 —— 玩家永远不知道自己在哪。
 *
 * ## ★ 它写的是跨局账本（`commitMeta`），这是分层的一处显式例外
 *
 * 完整的理由写在 `state/store.ts` 的 `commitMeta` 注释里（那一处说清了
 * "为什么这是对的而不是破例"）。一句话：**这个数回答的是"我这辈子"，
 * 不是"这一局"**，所以它本来就不该有一个单局的副本。
 */
function countShelved(store: GameStore, pieces: number): void {
  if (!(pieces > 0)) return;
  store.commitMeta((meta) => {
    meta.totalShelved += pieces;
  });
}

/**
 * **手里那件 ↔ 落点那件** 互换（拖拽交换走这条）。
 *
 * ## 为什么不能复用 `swapSlots`（这是被玩家的复现逼出来的）
 *
 * 拖拽的物理过程是：`onDragStart` 先把起手那一格的东西**拿进手里**
 * （`pickupFromShelf`），于是**起手那一格是空的** —— 而 `swapSlots` 要求
 * `from` 与 `to` 两格都有东西，所以它**必然拒绝**，并甩出那句
 * "两个格子都得有东西才谈得上互换"。玩家看到的正是这句话。
 *
 * 正确的模型不是"两个格子对调"，而是"**手里这件**换到落点、落点那件回到起手格"：
 *
 *     from 格（空）  ←  target 那件
 *     to   格        ←  held（手里那件）
 *     手里           ← 空
 *
 * 玩家看到的效果与"两格对调"完全一样，但它符合拖拽的真实中间状态。
 *
 * ## 三条边界
 *
 *  · `from` 与 `to` 不能是同一格（拖回原处 = 放回去，不是互换）；
 *  · `to` 上必须真有东西（空格子是"搬过去"，走 `placeHeld`）；
 *  · 同一件物资不互换（那是合并）。
 *
 * 成功时会把 `session.held` 清空 —— 互换的定义就是"谁都不留在手上"。
 */
export function swapHeldWithSlot(
  store: GameStore,
  session: OrganizeSession,
  from: { shelfId: string; pos: SlotPos },
  to: { shelfId: string; pos: SlotPos }
): CommandResult {
  const held = session.held;
  if (!held) return reject('手里是空的');

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

  const target = getStack(toShelf, to.pos);
  if (!target) return reject('那一格是空的，直接放下去就行');
  if (target.itemId === held.itemId) return reject('同一件物资，直接叠起来就行');

  store.commit((draft) => {
    const sTo = draft.shelves[toIdx];
    if (sTo) draft.shelves[toIdx] = setSlotStack(sTo, to.pos, held);
    const sFrom = draft.shelves[fromIdx];
    if (sFrom) draft.shelves[fromIdx] = setSlotStack(sFrom, from.pos, target);
  });

  // 互换的定义就是"谁都不留在手上"
  setHeld(run, session, null, { kind: 'none' });

  return ok([
    {
      type: 'swapped',
      itemId: held.itemId,
      shelfId: to.shelfId,
      pos: to.pos,
      toItemId: target.itemId,
      from: { shelfId: from.shelfId, pos: from.pos }
    }
  ]);
}

/**
 * **两格互换**（`from` 与 `to` 上都有东西时用；例如将来的"框选两格对调"）。
 *
 * ## 与 `swapHeldWithSlot` 的分工
 *
 *  · 拖拽交换（玩家实际用的那条）走 `swapHeldWithSlot` —— 因为拖拽的中间状态是
 *    "起手格已空、东西在手里"；
 *  · 这里要求两格**都非空**，是一个纯粹的"两格对调"操作。
 *
 * 两者对玩家的可见效果相同，但**前置条件不同**，混用就会出现
 * "我明明拖了两件东西，它说必须得有东西才谈得上互换" —— 那条 bug 就是这么来的。
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

/** 把手清空 —— 唯一写入口 `setHeld` 的薄封装，保证落盘字段一起清 */
function clearHeld(run: RunState, session: OrganizeSession): void {
  setHeld(run, session, null, { kind: 'none' });
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
        clearHeld(run, session);
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
      clearHeld(run, session);
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
      clearHeld(run, session);
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
    clearHeld(run, session);
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
  clearHeld(run, session);
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
   * 显式指定"我在改这张已有的胶带"（改名 + 改色 + 改清单，**所有贴着它的行**一起变）。
   * 不传则是"给这几行写一段胶带"：同名复用，没有同名才新建。
   * 两种语义必须由 ui 明确区分，命令层不猜 —— 否则"改这张的名字"和"换一张新的"分不开。
   */
  zoneId?: string;
  /**
   * 要贴哪几行。
   *
   * ★ 胶带的粒度是**一行**（用户拍板 2026-10），而且"可以给多行使用"——
   * 所以这里收一个数组，一次贴多行。
   *
   * ⚠ **不传 = 整块货架的每一行**。保留这个默认值有两个具体理由：
   *  ① 老界面/老测试调它时不必改；
   *  ② "把这一架都贴成主食区"本来就是一个常见意图，
   *     而它现在只是"选中所有行"的一个特例 —— 不必单独一条命令。
   */
  rows?: number[];
}

export function applyZone(store: GameStore, shelfId: string, input: ZoneInput): CommandResult {
  const run = store.run;
  const shelfIndex = run.shelves.findIndex((s) => s.id === shelfId);
  if (shelfIndex < 0) return reject('货架不存在');
  const shelf = run.shelves[shelfIndex];
  if (!shelf) return reject('货架不存在');
  const name = input.name.trim();
  if (!name) return reject('胶带得有个名字');
  const color = input.color || DEFAULT_ZONE_COLOR;
  const categories = normalizeCategories(input.categories);
  const editId = input.zoneId;
  if (editId && !findZone(run.zones, editId)) return reject('没有这张胶带');

  /*
   * 要贴的行：默认整块，越界的一律丢掉。
   * ★ 越界行**丢掉而不是夹取** —— 夹取会把"第 9 行"悄悄变成"第 3 行"，
   * 于是玩家看到胶带贴到了一行他没选的地方。
   */
  const rows = (input.rows ?? Array.from({ length: shelf.h }, (_, r) => r)).filter(
    (r) => Number.isInteger(r) && r >= 0 && r < shelf.h
  );
  if (rows.length === 0) return reject('没选中要贴的行');

  store.commit((draft) => {
    const target = draft.shelves[shelfIndex];
    if (!target) return;

    // ① 明确在编辑某张胶带 → 改名 + 改色 + 改清单，id 不变，所有贴着它的行一起跟着变
    if (editId) {
      const zone = draft.zones.find((z) => z.id === editId);
      if (zone) {
        zone.name = name;
        zone.color = color;
        writeZoneRule(zone, categories);
      }
      return;
    }

    // ② 同名胶带已存在 → 复用同一张（绝不造重名分区）。
    //    注意：**这里绝不改写它的清单** —— 清单属于胶带本身，
    //    否则"把另外两行也贴成主食区"会把主食区的清单按当前输入框的状态清掉。
    //    改清单只有一条路：上面的 ①（抽屉里点"改这段胶带"）。
    const sameName = draft.zones.find((z) => z.name === name);
    if (sameName) {
      const previous = rows.map((r) => rowZoneId(target, r));
      for (const row of rows) target.zoneIds = setRowZoneId(target, row, sameName.id);
      // 换过去之后，那些**再没有任何一行用**的旧胶带要回收
      for (const id of new Set(previous)) {
        if (id && id !== sameName.id) recycleIfOrphan(draft, id);
      }
      return;
    }

    // ③ 写一段新的：先给这几行腾空（旧胶带若成孤儿就回收），再贴新的
    const previous = rows.map((r) => rowZoneId(target, r));
    for (const row of rows) target.zoneIds = setRowZoneId(target, row, null);
    for (const id of new Set(previous)) {
      if (id) recycleIfOrphan(draft, id);
    }
    const zone: Zone = { id: nextZoneId(draft.zones), name, color };
    writeZoneRule(zone, categories);
    draft.zones.push(zone);
    for (const row of rows) target.zoneIds = setRowZoneId(target, row, zone.id);
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  加一块家具（§10.2.4 的「新货架 / 新家具类型」—— 第 6 步 B 的入口）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么它现在才能做
 *
 * 第 6 步 A 把家具变成了**真的有效果**的东西（冰箱 0.4 倍的腐坏速度），
 * 但玩家**拿不到** —— 家里永远是开局那三块。
 * 卡点不在机制，而在"谁发给你"：§10.2.4 把新家具定为**解锁物**，
 * 而解锁系统（`systems/unlock.ts`）与房间容量是第 7 步的事。现在两样都有了。
 *
 * ## 代价：它花**现金**
 *
 * 设计上没有明写"家具要花钱"，但"搬更大的家"如果免费，
 * 那 §6.2 的**行动点与现金取舍**就会多出一条免费的路：
 * 东西放不下 → 直接加一块 → 不需要在想清楚"该丢什么"。
 * 而"想清楚该丢什么"正是整理这件事的核心。
 *
 * 所以定价取的是**一床棉被的两倍上下**（棉被 45）：一件家具 ≈ 100 元。
 * 那个价位的意思是"买得起，但要少买几罐燃料" ——
 * 与 §6.2 的三约束同一条松紧度。
 */
export const FURNITURE_PRICE = 100;

export function addFurnitureCommand(
  store: GameStore,
  session: OrganizeSession,
  kind: Shelf['kind']
): CommandResult {
  const run = store.run;
  /*
   * 手里还拿着东西时不许加家具：新家具会插进 `shelves`，
   * 而"手里那件从哪来"的位置引用（`session.heldFrom`）在那之后可能指向别处。
   * 与拖拽中途不许重开一局是同一条纪律 —— **不制造无法解释的中间状态**。
   */
  if (session.held) return reject('先把手里那件放下');

  const room = roomForNewFurniture(store.save.meta, run);
  if (!room) return reject('家里放不下了 —— 去解锁一间新房');

  if (run.cash < FURNITURE_PRICE) return reject(`现金不够（要 ${FURNITURE_PRICE}）`);

  const plan = addFurnitureToHome(store.save.meta, run, kind);
  if (!plan.added) return reject('家里放不下了');

  store.commit((draft) => {
    draft.shelves = plan.shelves;
    draft.cash -= FURNITURE_PRICE;
  });

  const added = store.run.shelves[store.run.shelves.length - 1];
  const roomDef = roomDefOf(plan.roomId ?? LIVING_ROOM_ID);
  return ok([
    {
      type: 'furnitureAdded',
      shelfId: added?.id ?? '',
      kind,
      roomId: roomDef.id,
      // 房名一起带出去：界面不必再查一次表，也就不会与命令层的口径分家
      roomLabel: roomDef.label
    }
  ]);
}

/** 把胶带贴到货架上；zoneId = null 表示"撕下"（这张胶带没人用了就自己消失） */
export function assignZone(
  store: GameStore,
  shelfId: string,
  zoneId: string | null,
  rows?: number[]
): CommandResult {
  const run = store.run;
  const shelfIndex = run.shelves.findIndex((s) => s.id === shelfId);
  if (shelfIndex < 0) return reject('货架不存在');
  const shelfNow = run.shelves[shelfIndex];
  if (!shelfNow) return reject('货架不存在');
  if (zoneId !== null && !findZone(run.zones, zoneId)) return reject('没有这张胶带');

  // 同 `applyZone`：不传 = 整块；越界丢掉（不夹取）
  const targets = (rows ?? Array.from({ length: shelfNow.h }, (_, r) => r)).filter(
    (r) => Number.isInteger(r) && r >= 0 && r < shelfNow.h
  );
  if (targets.length === 0) return reject('没选中要贴的行');

  const previousZoneIds = [...new Set(targets.map((r) => rowZoneId(shelfNow, r)))].filter(
    (id): id is string => id !== null
  );
  const previousZone = previousZoneIds.length === 1 ? findZone(run.zones, previousZoneIds[0]!) : null;

  store.commit((draft) => {
    const shelf = draft.shelves[shelfIndex];
    if (!shelf) return;
    for (const row of targets) shelf.zoneIds = setRowZoneId(shelf, row, zoneId);
    // 取下/换贴之后，那些**再没有任何一行在用**的旧胶带要收走
    for (const id of previousZoneIds) {
      if (id !== zoneId) recycleIfOrphan(draft, id);
    }
  });

  const events: OrganizeEvent[] = [{ type: 'zoneUpdated', shelfId }];
  if (!zoneId && previousZone) events.push({ type: 'zoneRemoved', shelfId, name: previousZone.name });
  return ok(events);
}

/**
 * 只改一张胶带**自己**（名字 / 颜色 / 清单），不碰"它贴在哪几行"。
 *
 * ## 为什么需要它（与 `applyZone` 的分工）
 *
 * `applyZone` 是"**给某块架子的某几行**贴一张胶带"，所以它必须知道货架与行。
 * 而 2026-10 加的手感是"从**胶带架**上轻点一张胶带 → 改它" ——
 * 那时玩家想改的是**这张胶带本身**，而它可能贴在好几块架子上，
 * "从哪一块进"没有答案。拿一个假货架去凑 `applyZone`，后果是把胶带
 * 贴到玩家没看见的行上。
 *
 * ★ 改名字时**同时改所有贴着它的行看到的名字**：行只存 `zoneId`，
 * 名字在 `zones` 表里只有一份 —— 这是行级胶带之后"一块架子上两种颜色"
 * 能成立的原因，也是这里不需要遍历货架的原因。
 */
export function editZone(
  store: GameStore,
  zoneId: string,
  input: { name: string; color: string; categories: CategoryId[] }
): CommandResult {
  const run = store.run;
  const zone = findZone(run.zones, zoneId);
  if (!zone) return reject('没有这张胶带');
  const name = input.name.trim();
  if (name.length === 0) return reject('给它起个名字');
  if (name.length > 8) return reject('名字最多 8 个字（手机上一行放得下）');

  store.commit((draft) => {
    for (const z of draft.zones) {
      if (z.id !== zoneId) continue;
      z.name = name;
      z.color = input.color;
      /*
       * 空清单是**合法**的（§12 v0.8：空清单的胶带归位率是 0），
       * 所以这里不做"至少要选一个品类"的校验 —— 那是玩家的自由，
       * 而它的代价（归位率 0）已经在分数上体现了。
       */
      z.autoAccept = { categories: [...input.categories] };
    }
  });
  return ok([{ type: 'zoneUpdated', shelfId: '' }]);
}

/**
 * 新建一张胶带（**只建，不贴**）。
 *
 * ## 为什么它必须与"贴"分开
 *
 * 玩家建一张胶带的路径现在是"**从胶带架上把「＋」拖到某一行**"——
 * 那个动作同时完成"建"与"贴"。而抽屉里的保存是**另一条**路：
 * 玩家在里面写名字、挑颜色、勾清单，然后按保存。
 *
 * 那时**没有任何落点信息**（抽屉里已经没有行选择器了）。如果这个命令
 * 顺手替玩家猜一个落点，就会出现上一个版本那个 bug 的同类现象：
 * 显示"贴到 0 行" / 贴到上一次选中的、已经过期的行。
 *
 * ★ 所以：**建完就是"还没贴在哪儿"**（`usageCount === 0`），
 * 界面上那条"从上面那条「胶带」栏里拖到某一行上才算贴上"就是它的出路。
 */
export function createZone(
  store: GameStore,
  input: { name: string; color: string; categories: CategoryId[] }
): CommandResult {
  const run = store.run;
  const name = input.name.trim();
  if (name.length === 0) return reject('给它起个名字');
  if (name.length > 8) return reject('名字最多 8 个字（手机上一行放得下）');
  /*
   * 同名不同一张会让"贴着哪张"在界面上分不清（行只存 zoneId，
   * 而玩家是**按名字**记的），所以这里也拦一下。`applyZone` 的同名分支
   * 是"复用那一张"，而这里是"新建"，语义不同 —— 不能直接借。
   */
  if (run.zones.some((z) => z.name === name)) return reject('已经有同名的胶带了');

  const stamp = `${Date.now().toString(36)}${Math.floor(run.zones.length).toString(36)}`;
  const zone: Zone = {
    id: `z_${stamp}`,
    name,
    color: input.color,
    // 只建不贴：没有任何一行指向它
    autoAccept: { categories: [...input.categories] }
  };
  store.commit((draft) => {
    draft.zones = [...draft.zones, zone];
  });
  return ok([{ type: 'zoneCreated', name: zone.name }]);
}

/** 显式剪掉一张胶带（UI 的"撕下最后一行"已能自动回收，这个留给脚本/M1 用） */
export function deleteZone(store: GameStore, zoneId: string): CommandResult {
  const run = store.run;
  const zone = findZone(run.zones, zoneId);
  if (!zone) return reject('没有这张胶带');
  // 现在数的是**行**，不是货架 —— 一张胶带可以贴在好几块架子上、每块只贴一行
  const affected = run.shelves.reduce(
    (n, s) => n + Array.from({ length: s.h }, (_, r) => rowZoneId(s, r)).filter((id) => id === zoneId).length,
    0
  );
  store.commit((draft) => {
    draft.zones = draft.zones.filter((z) => z.id !== zoneId);
    for (const shelf of draft.shelves) {
      for (let row = 0; row < shelf.h; row++) {
        if (rowZoneId(shelf, row) === zoneId) shelf.zoneIds = setRowZoneId(shelf, row, null);
      }
    }
  });
  return ok([{ type: 'zoneRemoved', shelfId: '', name: zone.name, affected }]);
}

/** 这张胶带还有**任何一行**在用吗？没有就收走（撕下最后一行 = 胶带消失） */
function recycleIfOrphan(run: RunState, zoneId: string): void {
  const stillUsed = run.shelves.some((s) =>
    Array.from({ length: s.h }, (_, r) => rowZoneId(s, r)).includes(zoneId)
  );
  if (stillUsed) return;
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
