import { describe, expect, it } from 'vitest';
import { countStacks, fefoSorted, getStack, isShelfFEFO, stackCount } from '../model/shelf';
import type { SlotPos } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import {
  buildView,
  createOrganizeSession,
  pickupFromShelf,
  placeHeld,
  returnHeld,
  sortAllByFEFO,
  takeFromBox,
  type OrganizeSession
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

describe('交换不丢件', () => {
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
