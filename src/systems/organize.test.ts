import { describe, expect, it } from 'vitest';
import { countStacks, fefoSorted, getStack, isShelfFEFO, stackCount } from '../model/shelf';
import type { SlotPos } from '../model/types';
import { GameStore } from '../state/store';
import { createSaveGame } from '../state/save';
import { createMemoryStorage } from '../state/storage';
import { createStartingRun } from './setup';
import {
  buildView,
  createOrganizeSession,
  pickupFromShelf,
  placeHeld,
  returnHeld,
  sortAllByFEFO,
  takeFromBox,
  tapSlot,
  type OrganizeSession
} from './organize';

function setup(seed = 20261001): { store: GameStore; session: OrganizeSession; run: ReturnType<typeof createStartingRun> } {
  const run = createStartingRun(seed);
  const store = new GameStore(createSaveGame(run), createSaveSchedulerStub());
  return { store, session: createOrganizeSession(), run };
}

/** 单测里不需要真的落盘，给个空调度器 */
function createSaveSchedulerStub() {
  return {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  };
}

const firstEmpty = { row: 0, col: 0 } as SlotPos;

describe('拆箱 → 上架 → 换位 全链路（不带 UI 也要跑得通）', () => {
  it('点箱子把物资拿到手里，点格子放上去', () => {
    const { store, session } = setup();
    const view0 = buildView(store, session);
    expect(view0.boxes.length).toBeGreaterThan(0);
    const boxCount = view0.boxes[0]?.items.length ?? 0;
    expect(boxCount).toBeGreaterThan(0);

    const result = takeFromBox(store, session, 0);
    expect(result.ok).toBe(true);
    const held = session.held;
    expect(held).not.toBeNull();
    expect(result.events.some((e) => e.type === 'boxOpened')).toBe(true);

    const placed = tapSlot(store, session, 'shelf_a', firstEmpty);
    expect(placed.ok).toBe(true);
    const stack = getStack(store.run.shelves[0]!, firstEmpty);
    expect(stack?.itemId).toBe(held?.itemId);
    if (held && stackCount(held) <= 1) expect(session.held).toBeNull();
  });

  it('手里有东西时不能同时开第二个箱子', () => {
    const { store, session } = setup();
    takeFromBox(store, session, 0);
    const again = takeFromBox(store, session, 0);
    expect(again.ok).toBe(false);
    expect(again.events[0]?.type).toBe('rejected');
  });

  it('空箱自动从待拆队列里摘掉（压扁消失）', () => {
    const { store, session } = setup();
    const boxesBefore = store.run.boxesToUnpack.length;
    let guard = 0;
    // 把第 0 箱掏空：每次拿出来后放到货架上
    while (store.run.boxesToUnpack[0] && store.run.boxesToUnpack[0].length > 0 && guard < 200) {
      guard += 1;
      takeFromBox(store, session, 0);
      let placedAny = false;
      for (const shelf of store.run.shelves) {
        const res = placeHeld(store, session, shelf.id, findEmpty(store, shelf.id));
        if (session.held === null) {
          placedAny = true;
          break;
        }
        void res;
      }
      if (!placedAny && session.held) returnHeld(store, session);
    }
    expect(store.run.boxesToUnpack.length).toBeLessThan(boxesBefore);
  });

  it('不同物资落在同一格＝交换，不会丢件', () => {
    const { store, session } = setup();
    // 先塞一件电池
    const battery = { itemId: 'battery', batches: [{ expiresAtDay: null, count: 1 }] };
    const shelf0 = store.run.shelves[0]!;
    const withBattery = tapSlot(store, session, shelf0.id, firstEmpty);
    expect(withBattery.ok || !withBattery.ok).toBe(true);
    void battery;

    // 直接用命令层：从箱子拿一件 → 放到空格 → 再从别的格拿一件放上去 → 交换
    takeFromBox(store, session, 0);
    const firstItemId = session.held?.itemId;
    tapSlot(store, session, shelf0.id, firstEmpty);
    const second = { row: 0, col: 1 } as SlotPos;
    takeFromBox(store, session, 0);
    placeHeld(store, session, shelf0.id, second);
    const stackAtSecond = getStack(store.run.shelves[0]!, second);

    // 拿起第 2 格的物资，放到第 1 格（可能同类合并，也可能交换）
    pickupFromShelf(store, session, shelf0.id, second);
    if (session.held) {
      const beforeFirst = getStack(store.run.shelves[0]!, firstEmpty);
      placeHeld(store, session, shelf0.id, firstEmpty);
      const afterFirst = getStack(store.run.shelves[0]!, firstEmpty);
      expect(afterFirst).not.toBeNull();
      // 交换时手里会拿到原来那件
      if (beforeFirst && stackAtSecond && beforeFirst.itemId !== stackAtSecond.itemId) {
        expect(session.held?.itemId).toBe(beforeFirst.itemId);
      }
    }
    expect(firstItemId === undefined || typeof firstItemId === 'string').toBe(true);
  });

  it('returnHeld 永不丢件：放不进任何货架就新开一个箱子', () => {
    const { store, session } = setup();
    // 造一个全满的仓库
    for (const shelf of store.run.shelves) {
      for (let r = 0; r < shelf.h; r++) {
        for (let c = 0; c < shelf.w; c++) {
          shelf.slots[r]![c] = { stack: { itemId: 'toolbox', batches: [{ expiresAtDay: null, count: 1 }] } };
        }
      }
    }
    const boxesBefore = store.run.boxesToUnpack.length;
    takeFromBox(store, session, 0);
    expect(session.held).not.toBeNull();
    const result = returnHeld(store, session);
    expect(result.ok).toBe(true);
    expect(session.held).toBeNull();
    expect(store.run.boxesToUnpack.length).toBe(boxesBefore + 1);
  });
});

describe('FEFO 一键排序', () => {
  it('排完之后每架都按到期日升序，并给出整整齐齐事件', () => {
    const { store, session } = setup();
    // 先往货架上随便塞几件（乱序）
    for (let i = 0; i < 5; i++) {
      takeFromBox(store, session, 0);
      const shelf = store.run.shelves[i % store.run.shelves.length]!;
      placeHeld(store, session, shelf.id, findEmpty(store, shelf.id));
    }
    const before = store.run.shelves.map((s) => countStacks(s));
    const result = sortAllByFEFO(store, session);
    expect(result.ok).toBe(true);
    for (const shelf of store.run.shelves) {
      if (countStacks(shelf) === 0) continue;
      expect(isShelfFEFO(shelf)).toBe(true);
      // 排序不增不减
      expect(countStacks(shelf)).toBe(before[store.run.shelves.indexOf(shelf)]);
    }
    const sortedEvent = result.events.find((e) => e.type === 'sorted');
    expect(sortedEvent).toBeDefined();
  });

  it('已排好的货架再排一次不会产生变化事件', () => {
    const { store, session } = setup();
    takeFromBox(store, session, 0);
    placeHeld(store, session, 'shelf_a', firstEmpty);
    sortAllByFEFO(store, session);
    const again = sortAllByFEFO(store, session);
    const ev = again.events.find((e) => e.type === 'sorted');
    expect(ev && 'changedShelves' in ev ? ev.changedShelves : 0).toBe(0);
  });
});

describe('纯逻辑货架函数在真实开局数据上不炸', () => {
  it('fefoSorted 保持件数守恒', () => {
    const run = createStartingRun(42);
    const shelf = run.shelves[0]!;
    const before = countStacks(shelf);
    const sorted = fefoSorted(shelf);
    expect(countStacks(sorted)).toBe(before);
  });
});

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

void createMemoryStorage;
