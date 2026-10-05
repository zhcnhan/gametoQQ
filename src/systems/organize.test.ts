import { describe, expect, it } from 'vitest';
import { countStacks, fefoSorted, getStack, isShelfFEFO, makeStack, setSlotStack, stackCount } from '../model/shelf';
import type { SlotPos } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import {
  SNAP_PREFER_PX,
  SNAP_PREFER_TOUCH_PX,
  buildView,
  createOrganizeSession,
  householdTotals,
  inventoryTotals,
  pickSnapCandidate,
  pickupFromShelf,
  placeHeld,
  restoreOrganizeSession,
  returnHeld,
  sortAllByFEFO,
  swapSlots,
  takeFromBox,
  toggleHandy,
  type OrganizeSession,
  type SnapCandidate
} from './organize';
import { createStartingRun } from './setup';

/** 单测里不需要真的落盘，给个空调度器 */
function createSaveSchedulerStub() {
  return {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  };
}

function setup(seed = 20261001) {
  const run = createStartingRun(seed);
  const store = new GameStore(createSaveGame(run), createSaveSchedulerStub());
  const session: OrganizeSession = createOrganizeSession();
  return { store, session, run };
}

describe('顺手位（§5「门口那一块」，全屋唯一 · §12.3 v0.7.1）', () => {
  it('标记与取消：点一下成为顺手位，再点一下撤下', () => {
    const { store } = setup();
    const first = store.run.shelves[0];
    if (!first) throw new Error('开局货架不足');

    expect(toggleHandy(store, first.id).ok).toBe(true);
    expect(store.run.shelves.find((s) => s.id === first.id)?.handyRank).toBe(1);

    expect(toggleHandy(store, first.id).ok).toBe(true);
    expect(store.run.shelves.find((s) => s.id === first.id)?.handyRank).toBeNull();
    expect(store.run.shelves.every((s) => s.handyRank === null)).toBe(true);
  });

  it('★ 全屋唯一：标第二块时旧的那块自动让位（radio，不是拒绝）', () => {
    const { store } = setup();
    const ids = store.run.shelves.slice(0, 3).map((s) => s.id);
    expect(toggleHandy(store, ids[0] as string).ok).toBe(true);
    expect(toggleHandy(store, ids[1] as string).ok).toBe(true);

    // 玩家拍板的理由："全设置上顺手位我不就无敌了" —— 所以只能有一个答案，
    // 换标记不该被"先撤旧的再标新的"两步挡住
    expect(store.run.shelves.find((s) => s.id === ids[1])?.handyRank).toBe(1);
    expect(store.run.shelves.find((s) => s.id === ids[0])?.handyRank).toBeNull();
    expect(store.run.shelves.filter((s) => s.handyRank !== null)).toHaveLength(1);
  });

  it('不存在的货架被拒（不能悄悄什么都不做）', () => {
    const { store } = setup();
    expect(toggleHandy(store, 'shelf_nope').ok).toBe(false);
  });

  /*
   * ★★ M4 W-06：上限**随身份变**。
   *
   * 上面那两条断言（radio 语义、让位）现在是"**普通身份**的行为"——
   * 它们仍然必须成立，因为绝大多数的十个身份都是上限 1。
   * 这一组补的是小区保安那一档（`{ kind: 'extraHandySlot' }`）。
   *
   * 为什么这件事值得两条用例：`toggleHandy` 是**唯一**决定 `handyRank` 取几的地方，
   * 而存档层的 `normalizeShelves` 按 `HANDY_SLOTS = 2` 钳制、**看不见身份** ——
   * 也就是说"保安的第二块到底算不算数"完全由这个函数回答。
   * 它一旦退回"永远让位"，表现只是保安标不上第二块，不会有任何报错。
   */
  it('★ 保安（extraHandySlot）能同时标两块，而且顺位分得清 1 和 2', () => {
    const { store } = setup();
    store.run.identityId = 'security_guard';
    const ids = store.run.shelves.slice(0, 3).map((s) => s.id);

    expect(toggleHandy(store, ids[0] as string).ok).toBe(true);
    expect(store.run.shelves.find((s) => s.id === ids[0])?.handyRank).toBe(1);

    expect(toggleHandy(store, ids[1] as string).ok).toBe(true);
    // ★ 关键：第二块**不赶走**第一块 —— 上限没满就占下一个空位
    expect(store.run.shelves.find((s) => s.id === ids[1])?.handyRank).toBe(2);
    expect(store.run.shelves.find((s) => s.id === ids[0])?.handyRank).toBe(1);
    expect(store.run.shelves.filter((s) => s.handyRank !== null)).toHaveLength(2);

    // 满了之后才回到 radio 语义：标第三块时前两块一起让位
    expect(toggleHandy(store, ids[2] as string).ok).toBe(true);
    expect(store.run.shelves.find((s) => s.id === ids[2])?.handyRank).toBe(1);
    expect(store.run.shelves.filter((s) => s.handyRank !== null)).toHaveLength(1);
  });

  it('★ 保安撤下第一块之后，再标的那一块**补回 1 号位**（不会出现两个 rank 1，也不会两块都是 2）', () => {
    const { store } = setup();
    store.run.identityId = 'security_guard';
    const ids = store.run.shelves.slice(0, 3).map((s) => s.id);

    toggleHandy(store, ids[0] as string); // rank 1
    toggleHandy(store, ids[1] as string); // rank 2
    toggleHandy(store, ids[0] as string); // 撤下第一块 → 只剩 rank 2 那一块
    toggleHandy(store, ids[2] as string); // 空出来的 1 号位应该被补上

    /*
     * ⚠ 这条用例抓到过一个真实现缺陷：第一版按"已占用数 + 1"给顺位，
     * 撤掉 1 号位之后已占用数是 1 → 新那块也拿 **2**，于是两块都是 rank 2、1 号位空着。
     * 后果不是报错，是 `model/score.ts` 的 `emergencyRate` 少算了"最顺手的那一块"。
     */
    const ranks = store.run.shelves
      .filter((s) => s.handyRank !== null)
      .map((s) => s.handyRank)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(ranks).toEqual([1, 2]);
  });

  it('★ 普通身份仍是上限 1：保安那条天赋不是偷偷放宽给所有人的', () => {
    const { store } = setup();
    const ids = store.run.shelves.slice(0, 2).map((s) => s.id);
    toggleHandy(store, ids[0] as string);
    toggleHandy(store, ids[1] as string);
    expect(store.run.shelves.filter((s) => s.handyRank !== null)).toHaveLength(1);
  });
});

function firstBoxId(store: GameStore, index = 0): string {
  const box = store.run.boxesToUnpack[index];
  if (!box) throw new Error(`没有第 ${index} 箱`);
  return box.id;
}

function findEmpty(store: GameStore, shelfId: string): SlotPos {
  const shelf = store.run.shelves.find((s) => s.id === shelfId);
  if (!shelf) return { row: 0, col: 0 };
  for (let r = 0; r < shelf.h; r++) {
    for (let c = 0; c < shelf.w; c++) {
      if (getStack(shelf, { row: r, col: c }) === null) return { row: r, col: c };
    }
  }
  return { row: 0, col: 0 };
}

const P0: SlotPos = { row: 0, col: 0 };

describe('箱子身份（稳定 id）', () => {
  it('开局箱子带 id 与箱型，id 唯一', () => {
    const { store } = setup();
    const boxes = store.run.boxesToUnpack;
    expect(boxes.length).toBe(3);
    const ids = boxes.map((b) => b.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(['box_1', 'box_2', 'box_3']);
    expect(boxes.every((b) => b.defId.length > 0 && b.items.length > 0)).toBe(true);
  });

  it('空箱被摘掉后，剩下的箱子 id 不变（不会串箱）', () => {
    const { store, session } = setup();
    const first = firstBoxId(store, 0);
    let guard = 0;
    while (store.run.boxesToUnpack.some((b) => b.id === first) && guard < 100) {
      guard += 1;
      takeFromBox(store, session, first);
      // 注意：这里必须真的上架，不能用 returnHeld —— 新行为会把东西送回原箱，永远掏不空
      if (session.held) placeHeld(store, session, 'shelf_c', findEmpty(store, 'shelf_c'));
    }
    // box_1 被压扁收走，但 box_2 / box_3 还是它们自己
    expect(store.run.boxesToUnpack.map((b) => b.id)).toEqual(['box_2', 'box_3']);
  });
});

describe('拆箱 → 上架（点选-点放）', () => {
  it('点箱子把物资拿到手里，点格子放上去', () => {
    const { store, session } = setup();
    const boxId = firstBoxId(store);
    const before = buildView(store, session).boxes[0]?.items.length ?? 0;
    expect(before).toBeGreaterThan(0);

    const opened = takeFromBox(store, session, boxId);
    expect(opened.ok).toBe(true);
    expect(opened.events.some((e) => e.type === 'boxOpened')).toBe(true);
    const held = session.held;
    expect(held).not.toBeNull();

    const placed = placeHeld(store, session, 'shelf_a', P0);
    expect(placed.ok).toBe(true);
    expect(getStack(store.run.shelves[0]!, P0)?.itemId).toBe(held?.itemId);
  });

  it('手里有东西时不能同时开第二个箱子', () => {
    const { store, session } = setup();
    takeFromBox(store, session, firstBoxId(store));
    const again = takeFromBox(store, session, firstBoxId(store, 1));
    expect(again.ok).toBe(false);
    expect(again.events[0]?.type).toBe('rejected');
  });

  it('不存在的箱子 id 被拒绝，而不是崩掉', () => {
    const { store, session } = setup();
    const res = takeFromBox(store, session, 'box_不存在');
    expect(res.ok).toBe(false);
  });
});

describe('放回：名副其实的"回原位"', () => {
  it('从货架拿起的 → 放回原格', () => {
    const { store, session } = setup();
    takeFromBox(store, session, firstBoxId(store));
    const itemId = session.held?.itemId;
    placeHeld(store, session, 'shelf_a', { row: 1, col: 2 });

    pickupFromShelf(store, session, 'shelf_a', { row: 1, col: 2 });
    expect(session.held).not.toBeNull();
    expect(getStack(store.run.shelves[0]!, { row: 1, col: 2 })).toBeNull();

    const res = returnHeld(store, session);
    expect(res.ok).toBe(true);
    expect(session.held).toBeNull();
    const back = getStack(store.run.shelves[0]!, { row: 1, col: 2 });
    expect(back?.itemId).toBe(itemId);
    const ev = res.events.find((e) => e.type === 'returned');
    expect(ev && 'toWhere' in ev ? ev.toWhere : '').toContain('原位');
  });

  it('从箱子拿起的 → 放回原箱，并且是箱内首位（下一个摸出来的还是它）', () => {
    const { store, session } = setup();
    const boxId = firstBoxId(store);
    const boxBefore = store.run.boxesToUnpack.find((b) => b.id === boxId)!;
    const nextUp = boxBefore.items[0]!.itemId; // 箱内首位，就是下一个会被摸出来的那件
    expect(boxBefore.items.length).toBeGreaterThan(1);

    takeFromBox(store, session, boxId);
    const held = session.held!;
    expect(held.itemId).toBe(nextUp);

    const shelvesBefore = store.run.shelves.reduce((n, s) => n + countStacks(s), 0);
    const res = returnHeld(store, session);
    expect(res.ok).toBe(true);
    expect(session.held).toBeNull();

    const boxAfter = store.run.boxesToUnpack.find((b) => b.id === boxId)!;
    expect(boxAfter.items[0]).toEqual(held);
    // 没有偷偷把东西上架
    expect(store.run.shelves.reduce((n, s) => n + countStacks(s), 0)).toBe(shelvesBefore);
    const ev = res.events.find((e) => e.type === 'returned');
    expect(ev && 'toWhere' in ev ? ev.toWhere : '').toBe('粮油箱');
  });

  it('原箱已经被压扁收走 → 退而求其次上架，仍然不丢件', () => {
    const { store, session } = setup();
    const boxId = firstBoxId(store);
    let guard = 0;
    let lastHeld: string | null = null;
    // 把 box_1 掏到只剩一件，然后单独把最后一件拿出来（此时箱子会被摘掉）
    while (store.run.boxesToUnpack.find((b) => b.id === boxId)!.items.length > 1 && guard < 50) {
      guard += 1;
      takeFromBox(store, session, boxId);
      lastHeld = session.held?.itemId ?? null;
      placeHeld(store, session, 'shelf_a', findEmpty(store, 'shelf_a'));
    }
    takeFromBox(store, session, boxId);
    expect(store.run.boxesToUnpack.some((b) => b.id === boxId)).toBe(false);

    const res = returnHeld(store, session);
    expect(res.ok).toBe(true);
    expect(session.held).toBeNull();
    // 东西进了货架（没丢，也没开新箱）
    expect(store.run.boxesToUnpack.length).toBe(2);
    expect(lastHeld === null || typeof lastHeld === 'string').toBe(true);
  });

  it('全满且原位回不去 → 开"临时搁置箱"，绝不丢件', () => {
    const { store, session } = setup();
    for (const shelf of store.run.shelves) {
      for (let r = 0; r < shelf.h; r++) {
        for (let c = 0; c < shelf.w; c++) {
          shelf.slots[r]![c] = { stack: { itemId: 'toolbox', batches: [{ expiresAtDay: null, count: 1 }] } };
        }
      }
    }
    const boxId = firstBoxId(store);
    takeFromBox(store, session, boxId);
    const itemId = session.held?.itemId;
    // 先把来处箱子抹掉，模拟"原箱已经没了"
    store.run.boxesToUnpack = store.run.boxesToUnpack.filter((b) => b.id !== boxId);

    const res = returnHeld(store, session);
    expect(res.ok).toBe(true);
    const stray = store.run.boxesToUnpack.find((b) => b.defId === 'box_stray');
    expect(stray).toBeDefined();
    expect(stray?.items[0]?.itemId).toBe(itemId);
    expect(res.events.some((e) => e.type === 'returned' && e.toWhere === '临时搁置箱')).toBe(true);
  });

  it('手里没东西时放回被拒绝', () => {
    const { store, session } = setup();
    const res = returnHeld(store, session);
    expect(res.ok).toBe(false);
    expect(res.events[0]?.type).toBe('rejected');
  });
});

describe('★ 手里那件物资不许丢（v15：它现在落盘）', () => {
  /*
   * 玩家报的原话："手里拿着东西时刷新页面，这件物资会丢"。
   *
   * 根因：`held` 原来只活在内存（`OrganizeSession`），而"拿起来"会把物资
   * **从格子/箱子里移走** —— 于是刷新后格子里没有、会话也没了 = 凭空消失。
   * 这违反本项目"杀进程损失 = 0"的核心承诺，也与 §4A 写明的
   * "手里捏着的物资回到原位即可"不符。
   */

  it('★ 从货架拿起 → 物资进了 run.held（就会随存档落盘）', () => {
    const { store, session } = setup();
    const idx = store.run.shelves.findIndex((s) => s.id === 'shelf_a');
    store.commit((draft) => {
      const s = draft.shelves[idx];
      if (!s) return;
      draft.shelves[idx] = setSlotStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 3, null));
    });
    const before = householdTotals(store.run).pieces;

    pickupFromShelf(store, session, 'shelf_a', { row: 0, col: 0 });

    expect(session.held?.itemId).toBe('canned_beans');
    // ★ 关键：落盘字段也有一份（`store.commit` 会把它写进 localStorage）
    expect(store.run.held?.itemId, 'run.held 必须同步 —— 否则刷新就丢').toBe('canned_beans');
    expect(store.run.heldFrom).toEqual({ kind: 'shelf', shelfId: 'shelf_a', pos: { row: 0, col: 0 } });
    // 而且**总数不变**：拿在手里不等于离开这个家
    expect(householdTotals(store.run).pieces, '举着东西时总数不许少算').toBe(before);
  });

  it('★★ 拿起之后"刷新"（重建会话）→ 手里那件还在，一件都没丢', () => {
    const { store, session } = setup();
    const idx = store.run.shelves.findIndex((s) => s.id === 'shelf_a');
    store.commit((draft) => {
      const s = draft.shelves[idx];
      if (!s) return;
      draft.shelves[idx] = setSlotStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 3, null));
    });
    const before = householdTotals(store.run).pieces;
    pickupFromShelf(store, session, 'shelf_a', { row: 0, col: 0 });

    // 模拟刷新：新会话 + 从同一份 run 恢复
    const fresh = createOrganizeSession();
    const archived = restoreOrganizeSession(store, fresh);

    expect(archived, '来处还在，不该走临时搁置箱那条路').toBe(false);
    expect(fresh.held?.itemId, '★ 刷新后手里那件必须还在').toBe('canned_beans');
    expect(fresh.held?.batches[0]?.count).toBe(3);
    expect(fresh.heldFrom).toEqual({ kind: 'shelf', shelfId: 'shelf_a', pos: { row: 0, col: 0 } });
    expect(householdTotals(store.run).pieces, '★ 一件都不许丢').toBe(before);
  });

  it('★★ 来处已经不存在（箱子被拆空后消失）→ 进临时搁置箱，而不是消失', () => {
    const { store, session } = setup();
    const box = store.run.boxesToUnpack[0];
    if (!box) throw new Error('开局应该有箱子');
    const boxId = box.id;

    /*
     * 把箱子削到只剩一件。
     * 刻意**直接改状态**而不是用 `returnHeld` —— 后者会把东西放回**原箱**，
     * 于是箱子永远不满也不空、最后一件拿不掉（这一版就是那么写错的）。
     */
    store.commit((draft) => {
      const b = draft.boxesToUnpack.find((x) => x.id === boxId);
      if (b && b.items.length > 1) b.items.splice(1);
    });
    // ★ 基准要在"削箱之后"取：削箱本身会丢掉一批件数，那不是这条测试要验的事
    const before = householdTotals(store.run).pieces;

    // 拿起最后那一件 —— 空箱会自动消失（`takeFromBox` 的行为）
    const res = takeFromBox(store, session, boxId);
    expect(res.ok).toBe(true);
    expect(store.run.boxesToUnpack.some((b) => b.id === boxId), '箱子应该已经消失').toBe(false);
    expect(store.run.heldFrom).toEqual({ kind: 'box', boxId });
    const heldItemId = store.run.held?.itemId;

    // 刷新 → 来处（那个箱子）已经没了
    const fresh = createOrganizeSession();
    const archived = restoreOrganizeSession(store, fresh);

    expect(archived, '应该走"归档到临时搁置箱"那条路').toBe(true);
    expect(fresh.held, '手里空了（东西已经归位）').toBeNull();
    expect(store.run.held, '落盘字段也要清干净').toBeNull();
    expect(store.run.heldFrom).toEqual({ kind: 'none' });
    // ★ 关键：物资出现在临时搁置箱里，而不是消失
    const stray = store.run.boxesToUnpack.find((b) => b.defId === 'box_stray');
    expect(stray, '必须有临时搁置箱').toBeDefined();
    expect(stray?.items.some((s) => s.itemId === heldItemId), '那件物资应该在搁置箱里').toBe(true);
    expect(householdTotals(store.run).pieces, '★ 一件都不许丢').toBe(before);
  });

  it('★ 手里是空的时候，恢复不该凭空造出手里那件', () => {
    const { store } = setup();
    const fresh = createOrganizeSession();
    expect(restoreOrganizeSession(store, fresh)).toBe(false);
    expect(fresh.held).toBeNull();
    expect(fresh.heldFrom).toEqual({ kind: 'none' });
  });

  it('★ 手里那件放下去之后，落盘字段也一起清空（两份状态不许分家）', () => {
    const { store, session } = setup();
    const idx = store.run.shelves.findIndex((s) => s.id === 'shelf_a');
    store.commit((draft) => {
      const s = draft.shelves[idx];
      if (!s) return;
      draft.shelves[idx] = setSlotStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 3, null));
    });
    pickupFromShelf(store, session, 'shelf_a', { row: 0, col: 0 });
    placeHeld(store, session, 'shelf_a', { row: 1, col: 1 });

    expect(session.held, '手里空了').toBeNull();
    expect(store.run.held, '落盘字段也必须是空的').toBeNull();
    expect(store.run.heldFrom).toEqual({ kind: 'none' });
  });
});

describe('交换不丢件', () => {
  /**
   * ★ 这一组守的是**两条路必须分开**（玩家的原话：
   * "他现在的交换逻辑不是把两个物品交换，而是把被交换的那个东西换到手上，这不好"）。
   *
   *  · 点选-点放：手里拿着东西 → 放上去，被换的那件**进手里**（`placeHeld`）；
   *  · 拖拽：不拿东西，A 拖到 B 上 → **两格对调，手保持空**（`swapSlots`）。
   */
  describe('★ swapSlots：两格对调，手保持空（拖拽那条路）', () => {
    /** 直接往两格放两件不同的物资（绕开命令层，好让品类是确定的） */
    function twoSlots(store: GameStore): { a: SlotPos; b: SlotPos } {
      const a: SlotPos = { row: 0, col: 0 };
      const b: SlotPos = { row: 0, col: 1 };
      store.commit((draft) => {
        const shelf = draft.shelves[0];
        if (!shelf) return;
        draft.shelves[0] = setSlotStack(shelf, a, makeStack('canned_beans', 3, null));
        const s2 = draft.shelves[0];
        if (s2) draft.shelves[0] = setSlotStack(s2, b, makeStack('bandage', 2, null));
      });
      return { a, b };
    }

    it('同架两格互换：东西对调，谁都不进手里', () => {
      const { store, session } = setup();
      const { a, b } = twoSlots(store);

      const res = swapSlots(store, { shelfId: 'shelf_a', pos: a }, { shelfId: 'shelf_a', pos: b });
      expect(res.ok).toBe(true);
      const shelf = store.run.shelves[0]!;
      expect(getStack(shelf, a)?.itemId).toBe('bandage');
      expect(getStack(shelf, b)?.itemId).toBe('canned_beans');
      // ★ 关键：手是空的（这正是玩家要的"独立开"）
      expect(session.held).toBeNull();
      expect(session.heldFrom).toEqual({ kind: 'none' });
    });

    it('总数守恒（换不是丢也不是复制）', () => {
      const { store } = setup();
      const { a, b } = twoSlots(store);
      const before = householdTotals(store.run).pieces;
      swapSlots(store, { shelfId: 'shelf_a', pos: a }, { shelfId: 'shelf_a', pos: b });
      expect(householdTotals(store.run).pieces).toBe(before);
    });

    it('事件带上了两边位置，界面才能两边都给反馈', () => {
      const { store } = setup();
      const { a, b } = twoSlots(store);
      const res = swapSlots(store, { shelfId: 'shelf_a', pos: a }, { shelfId: 'shelf_a', pos: b });
      const ev = res.events.find((e) => e.type === 'swapped');
      expect(ev).toBeDefined();
      if (ev && ev.type === 'swapped') {
        expect(ev.itemId).toBe('canned_beans');
        expect(ev.toItemId).toBe('bandage');
        expect(ev.from).toEqual({ shelfId: 'shelf_a', pos: a });
        expect(ev.pos).toEqual(b);
      }
    });

    it('跨货架也能换', () => {
      const { store } = setup();
      store.commit((draft) => {
        const s0 = draft.shelves[0];
        const s1 = draft.shelves[1];
        if (s0) draft.shelves[0] = setSlotStack(s0, { row: 0, col: 0 }, makeStack('canned_beans', 1, null));
        if (s1) draft.shelves[1] = setSlotStack(s1, { row: 1, col: 2 }, makeStack('battery', 4, null));
      });
      const res = swapSlots(
        store,
        { shelfId: 'shelf_a', pos: { row: 0, col: 0 } },
        { shelfId: 'shelf_b', pos: { row: 1, col: 2 } }
      );
      expect(res.ok).toBe(true);
      expect(getStack(store.run.shelves[0]!, { row: 0, col: 0 })?.itemId).toBe('battery');
      expect(getStack(store.run.shelves[1]!, { row: 1, col: 2 })?.itemId).toBe('canned_beans');
    });

    it('三种边界都拒绝：空着的一格 / 同一件物资 / 同一格', () => {
      const { store } = setup();
      const { a, b } = twoSlots(store);
      // 空格
      expect(swapSlots(store, { shelfId: 'shelf_a', pos: a }, { shelfId: 'shelf_a', pos: { row: 2, col: 2 } }).ok).toBe(
        false
      );
      // 同一格
      expect(swapSlots(store, { shelfId: 'shelf_a', pos: a }, { shelfId: 'shelf_a', pos: a }).ok).toBe(false);
      // 同一件物资（那是"叠起来"，不是互换）
      store.commit((draft) => {
        const s = draft.shelves[0];
        if (s) draft.shelves[0] = setSlotStack(s, { row: 1, col: 1 }, makeStack('canned_beans', 1, null));
      });
      expect(
        swapSlots(store, { shelfId: 'shelf_a', pos: a }, { shelfId: 'shelf_a', pos: { row: 1, col: 1 } }).ok
      ).toBe(false);
      // 拒绝之后不许动过任何东西
      expect(getStack(store.run.shelves[0]!, a)?.itemId).toBe('canned_beans');
      expect(getStack(store.run.shelves[0]!, b)?.itemId).toBe('bandage');
    });

    it('★ 两条路确实是分开的：placeHeld 仍然把被换的那件放进手里', () => {
      // 这一条是"独立开"的另一半 —— 不能为了新行为把旧行为改坏：
      // 点选-点放时手里那件必须有去处，否则它会凭空消失
      const { store, session } = setup();
      const { a, b } = twoSlots(store);
      expect(pickupFromShelf(store, session, 'shelf_a', { row: 1, col: 5 }).ok).toBe(true); // 空手
      // 直接把手里的东西设成一件不同的物资，再放到 b 上
      session.held = makeStack('battery', 1, null);
      session.heldFrom = { kind: 'box', boxId: 'x' };
      const res = placeHeld(store, session, 'shelf_a', b);
      expect(res.ok).toBe(true);
      expect(getStack(store.run.shelves[0]!, b)?.itemId).toBe('battery');
      // 原来在 b 上的那件进手里了（不是消失、也不是原地不动）
      expect(session.held?.itemId).toBe('bandage');
      // 而 a 那一格完全没被碰过
      expect(getStack(store.run.shelves[0]!, a)?.itemId).toBe('canned_beans');
    });

    /**
     * ★★ 回归：**先点一件拿在手上、再去拖另一件**时，来源不能读成"手里那件的来处"。
     *
     * 玩家原话："我明明是把两个东西拖动互换，他要提示我一句什么必须得有东西才
     * 称得上互换，然后拒绝交换，这不是傻比吗"。
     *
     * 根因（UI 层）：`onDragStart` 只在"手里空"时才拾取这一格，
     * 而来源原来是从 `session.heldFrom` 读的 —— 那个字段指的是**手里那件的来处**。
     * 于是"点 A 拿在手上（A 那格空了）、再拖 B 到 C 上"时：
     *   · 手里还是 A → 不拾取 B；
     *   · 来源被读成 **A 那一格（空的）**；
     *   · `swapSlots(from = 空的 A 格, to = C)` → `!a` → 拒绝，并给出那句鬼话。
     *
     * 这一组把**正确来源**的含义钉在命令层：`swapSlots` 的 `from` 必须是
     * **这一趟拖拽起手的那一格**（B），而不是手里那件的来处（A）。
     */
    it('★★ 交换的来源必须是"这一趟起手的那一格"，不是"手里那件的来处"', () => {
      const { store, session } = setup();
      const a: SlotPos = { row: 0, col: 0 };
      const b: SlotPos = { row: 0, col: 1 };
      const c: SlotPos = { row: 0, col: 2 };
      store.commit((draft) => {
        let s = draft.shelves[0];
        if (!s) return;
        s = setSlotStack(s, a, makeStack('canned_beans', 3, null));
        s = setSlotStack(s, b, makeStack('bandage', 2, null));
        s = setSlotStack(s, c, makeStack('battery', 4, null));
        draft.shelves[0] = s;
      });

      // 玩家先点了 A（A 进手里，A 那格空了）
      expect(pickupFromShelf(store, session, 'shelf_a', a).ok).toBe(true);
      expect(session.held?.itemId).toBe('canned_beans');
      expect(session.heldFrom).toEqual({ kind: 'shelf', shelfId: 'shelf_a', pos: a });
      expect(getStack(store.run.shelves[0]!, a)).toBeNull();

      // 然后他拖 B 到 C 上。UI 传进来的 `from` 必须是 **B**（这一趟起手的格子）。
      const res = swapSlots(store, { shelfId: 'shelf_a', pos: b }, { shelfId: 'shelf_a', pos: c });
      expect(res.ok, '这一趟从 B 起手，两格都有东西，必须换成功').toBe(true);
      expect(getStack(store.run.shelves[0]!, b)?.itemId).toBe('battery');
      expect(getStack(store.run.shelves[0]!, c)?.itemId).toBe('bandage');
      // A 那一格仍然空着、A 仍在手里 —— 拖拽不该悄悄改变手里的东西
      expect(getStack(store.run.shelves[0]!, a)).toBeNull();
      expect(session.held?.itemId).toBe('canned_beans');
    });

    it('★ 而如果把"手里那件的来处"当成来源（旧 bug），就会被拒绝 —— 这条说明白它错在哪', () => {
      const { store, session } = setup();
      const a: SlotPos = { row: 0, col: 0 };
      const c: SlotPos = { row: 0, col: 2 };
      store.commit((draft) => {
        let s = draft.shelves[0];
        if (!s) return;
        s = setSlotStack(s, a, makeStack('canned_beans', 3, null));
        s = setSlotStack(s, c, makeStack('battery', 4, null));
        draft.shelves[0] = s;
      });
      pickupFromShelf(store, session, 'shelf_a', a); // A 进手里，A 格空了
      // 旧实现会把 `from` 传成 A 那格 —— 它是空的，于是拒绝，并给出那句莫名其妙的提示
      const wrong = swapSlots(store, { shelfId: 'shelf_a', pos: a }, { shelfId: 'shelf_a', pos: c });
      expect(wrong.ok).toBe(false);
      // 拒绝的理由在 events 里（`CommandResult` 只有 ok/events 两个字段）
      const rejected = wrong.events.find((e) => e.type === 'rejected');
      expect(rejected && rejected.type === 'rejected' && rejected.reason).toContain('都得有东西');
    });
  });

  it('不同物资落在同一格 → 格上那件进手里', () => {
    const { store, session } = setup();
    takeFromBox(store, session, firstBoxId(store));
    placeHeld(store, session, 'shelf_a', P0);
    const first = getStack(store.run.shelves[0]!, P0)!;

    // 从另一个箱子拿一件不同的，放到同一格
    for (const box of store.run.boxesToUnpack) {
      takeFromBox(store, session, box.id);
      if (!session.held) continue;
      if (session.held.itemId !== first.itemId) break;
      returnHeld(store, session);
    }
    if (session.held && session.held.itemId !== first.itemId) {
      const incoming = session.held.itemId;
      placeHeld(store, session, 'shelf_a', P0);
      expect(getStack(store.run.shelves[0]!, P0)?.itemId).toBe(incoming);
      expect(session.held?.itemId).toBe(first.itemId);
    }
  });

  it('同类合并到同一格，总数守恒', () => {
    const { store, session } = setup();
    // 找同一箱里两件同名物资（拆箱有概率把同种拆成两批）
    let total = 0;
    for (const box of [...store.run.boxesToUnpack]) {
      while (store.run.boxesToUnpack.some((b) => b.id === box.id) && total < 2) {
        takeFromBox(store, session, box.id);
        if (!session.held) break;
        const placed = placeHeld(store, session, 'shelf_b', { row: 0, col: total });
        if (placed.ok) total += 1;
        else returnHeld(store, session);
      }
    }
    const counters = [0, 1].map((c) => getStack(store.run.shelves[1]!, { row: 0, col: c })).filter(Boolean);
    expect(counters.length).toBeGreaterThan(0);
    expect(store.run.shelves[1]!.slots.flat().filter((s) => s.stack).length).toBe(total);
  });
});

describe('FEFO 一键排序', () => {
  it('排完之后每架都按到期日升序，件数守恒', () => {
    const { store, session } = setup();
    for (let i = 0; i < 6; i++) {
      takeFromBox(store, session, firstBoxId(store, i % store.run.boxesToUnpack.length));
      const shelf = store.run.shelves[i % store.run.shelves.length]!;
      placeHeld(store, session, shelf.id, findEmpty(store, shelf.id));
    }
    const before = store.run.shelves.map((s) => countStacks(s));
    const result = sortAllByFEFO(store, session);
    expect(result.ok).toBe(true);
    store.run.shelves.forEach((shelf, i) => {
      expect(countStacks(shelf)).toBe(before[i]);
      if (countStacks(shelf) > 0) expect(isShelfFEFO(shelf)).toBe(true);
    });
    expect(result.events.some((e) => e.type === 'sorted')).toBe(true);
  });

  it('已排好的货架再排一次 → changedShelves 为 0', () => {
    const { store, session } = setup();
    takeFromBox(store, session, firstBoxId(store));
    placeHeld(store, session, 'shelf_a', P0);
    sortAllByFEFO(store, session);
    const again = sortAllByFEFO(store, session);
    const ev = again.events.find((e) => e.type === 'sorted');
    expect(ev && 'changedShelves' in ev ? ev.changedShelves : -1).toBe(0);
  });
});

describe('真实开局数据上不炸', () => {
  it('fefoSorted 保持件数守恒', () => {
    const run = createStartingRun(42);
    const shelf = run.shelves[0]!;
    const before = countStacks(shelf);
    expect(countStacks(fefoSorted(shelf))).toBe(before);
  });

  it('同种子开局完全一致（存档可复现）', () => {
    const a = createStartingRun(777);
    const b = createStartingRun(777);
    expect(a.boxesToUnpack).toEqual(b.boxesToUnpack);
    expect(a.seed).toBe(b.seed);
    const counts = (run: typeof a) => run.boxesToUnpack.map((box) => box.items.reduce((n, s) => n + stackCount(s), 0));
    expect(counts(a)).toEqual(counts(b));
  });
});

describe('★★ 吸附偏好：半径内优先"清单收它的那一行"（W-02）', () => {
  /** 造一批候选：`d` = 距离，`listed` = 这一行的清单收不收手里那件 */
  const cands = (...pairs: [number, boolean][]): SnapCandidate[] =>
    pairs.map(([distance, listed]) => ({ distance, listed }));

  it('半径内、清单收它 → 哪怕比最近的那格远一点，也选它（这就是 W-02 的全部）', () => {
    // 0 号：距离 10 但不收；1 号：距离 18 但清单收它 → 取 1
    expect(pickSnapCandidate(cands([10, false], [18, true]))).toBe(1);
  });

  it('★★ 半径**外**的清单行不许抢 —— 指针悬在这儿，物资不能被吸到屏幕另一头去', () => {
    // 1 号虽然清单收它，但距离 200 远超半径 26
    expect(pickSnapCandidate(cands([10, false], [200, true]))).toBe(0);
    // 边界也要守：刚好 26 之内算数，26 之外不算
    expect(pickSnapCandidate(cands([10, false], [SNAP_PREFER_PX, true]))).toBe(1);
    expect(pickSnapCandidate(cands([10, false], [SNAP_PREFER_PX + 0.001, true]))).toBe(0);
  });

  it('半径内有两个清单行 → 取更近的那个（偏好不等于"随便挑一个"）', () => {
    expect(pickSnapCandidate(cands([12, false], [22, true], [15, true]))).toBe(2);
  });

  it('最近的本来就是清单行 → 还是它（这一条防的是"为了偏好绕远路"）', () => {
    expect(pickSnapCandidate(cands([8, true], [20, true]))).toBe(0);
  });

  it('半径内一个清单行都没有 → 老实取最近（没有偏好可讲）', () => {
    expect(pickSnapCandidate(cands([30, false], [40, false]))).toBe(0);
    // 手里空着（没有"收不收"可言）时，调用方会把 listed 全填 false —— 退化成原来的行为
    expect(pickSnapCandidate(cands([10, false], [12, false], [90, false]))).toBe(0);
  });

  it('平局取先出现的那个（= 文档顺序，与 smallestUnderPoint 同一口径）', () => {
    expect(pickSnapCandidate(cands([10, true], [10, true]))).toBe(0);
    expect(pickSnapCandidate(cands([10, false], [10, false]))).toBe(0);
    // 平局里一个是清单行：近的那个（0 号）也是清单行 → 它留下
    expect(pickSnapCandidate(cands([10, true], [10, false]))).toBe(0);
  });

  it('触屏的偏好半径更宽（手指比鼠标不准），而合法判据一个字没动', () => {
    expect(SNAP_PREFER_TOUCH_PX).toBeGreaterThan(SNAP_PREFER_PX);
    const far = cands([10, false], [35, true]);
    expect(pickSnapCandidate(far, SNAP_PREFER_PX), '鼠标：35 太远，不抢').toBe(0);
    expect(pickSnapCandidate(far, SNAP_PREFER_TOUCH_PX), '触屏：35 在半径内，让它抢').toBe(1);
  });

  it('候选为空是**调用方的错**（抛出来，而不是悄悄返回 -1 让上面吸不到格子）', () => {
    expect(() => pickSnapCandidate([])).toThrow();
  });
});

describe('全副家当：货架 + 没拆的箱子', () => {
  it('还没拆的箱子也要算进"囤到多少"，否则结算页会显示 0', () => {
    const { store } = setup();
    const onlyShelf = inventoryTotals(store.run);
    const whole = householdTotals(store.run);

    // 开局三箱全在箱子里，货架是空的
    expect(onlyShelf.pieces).toBe(0);
    expect(whole.pieces).toBeGreaterThan(0);
    expect(whole.pieces).toBe(
      store.run.boxesToUnpack.reduce((n, box) => n + box.items.reduce((m, s) => m + stackCount(s), 0), 0)
    );
  });

  it('上了架之后，两个数会从两端逼近同一个值', () => {
    const { store, session } = setup();
    const boxId = firstBoxId(store);
    takeFromBox(store, session, boxId);
    const moved = session.held ? stackCount(session.held) : 0;
    placeHeld(store, session, 'shelf_a', P0);

    expect(inventoryTotals(store.run).pieces).toBe(moved);
    expect(householdTotals(store.run).pieces).toBeGreaterThanOrEqual(moved);
  });
});
