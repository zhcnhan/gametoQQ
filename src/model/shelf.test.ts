import { describe, expect, it } from 'vitest';
import { getDisasterDef } from '../data/disaster';
import {
  autoPlace,
  canAccept,
  createShelf,
  dropStack,
  fefoRate,
  fefoSorted,
  firstBatchExpiry,
  getStack,
  isShelfFEFO,
  makeStack,
  moveStack,
  normalizeStack,
  onlyZoneIdOf,
  placementRate,
  readingOrder,
  stackCount,
  takeStack
} from './shelf';
import { computeOrganizeScore } from './score';
import { createCursor, nextInt, shuffle } from './rng';
import type { ItemStack, Shelf, Zone } from './types';

function shelf(w = 6, h = 4, id = 's1'): Shelf {
  return createShelf(id, 'room_living', 'shelf', w, h, null);
}

describe('堆栈规范化', () => {
  it('同到期日的批次会合并，并按到期日升序', () => {
    const s = normalizeStack({
      itemId: 'canned_beans',
      batches: [
        { expiresAtDay: 90, count: 2 },
        { expiresAtDay: 10, count: 1 },
        { expiresAtDay: 90, count: 3 }
      ]
    });
    expect(s.batches).toEqual([
      { expiresAtDay: 10, count: 1 },
      { expiresAtDay: 90, count: 5 }
    ]);
    expect(stackCount(s)).toBe(6);
  });

  it('不易腐物资排最后，firstBatchExpiry 为最早到期日', () => {
    const s = normalizeStack({
      itemId: 'bandage',
      batches: [
        { expiresAtDay: null, count: 2 },
        { expiresAtDay: 5, count: 1 }
      ]
    });
    expect(s.batches[0]).toEqual({ expiresAtDay: 5, count: 1 });
    expect(firstBatchExpiry(s)).toBe(5);
    expect(firstBatchExpiry(makeStack('bandage', 3, null))).toBeNull();
  });
});

describe('放置规则', () => {
  it('空格只在堆叠上限内可放', () => {
    const s = shelf();
    expect(canAccept(s, { row: 0, col: 0 }, makeStack('battery', 12, null))).toBe(true);
    expect(canAccept(s, { row: 0, col: 0 }, makeStack('battery', 13, null))).toBe(false);
  });

  it('同物资可合并，合并后超上限则拒绝', () => {
    let s = shelf();
    s = dropStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 4, 100)) as Shelf;
    expect(canAccept(s, { row: 0, col: 0 }, makeStack('canned_beans', 2, 200))).toBe(true);
    expect(canAccept(s, { row: 0, col: 0 }, makeStack('canned_beans', 3, 200))).toBe(false);
    const merged = dropStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 2, 200)) as Shelf;
    const stack = getStack(merged, { row: 0, col: 0 });
    expect(stack && stackCount(stack)).toBe(6);
    expect(stack && stack.batches.map((b) => b.count)).toEqual([4, 2]);
  });

  it('不同物资不能叠在同一格', () => {
    let s = shelf();
    s = dropStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 1, 100)) as Shelf;
    expect(dropStack(s, { row: 0, col: 0 }, makeStack('battery', 1, null))).toBeNull();
  });

  it('takeStack 取走后格子清空且不改原货架', () => {
    let s = shelf();
    s = dropStack(s, { row: 1, col: 2 }, makeStack('bandage', 3, null)) as Shelf;
    const { shelf: after, stack } = takeStack(s, { row: 1, col: 2 });
    expect(stack && stackCount(stack)).toBe(3);
    expect(getStack(after, { row: 1, col: 2 })).toBeNull();
    expect(getStack(s, { row: 1, col: 2 })).not.toBeNull(); // 纯函数：原对象不变
  });

  it('autoPlace 优先合进同类富余格，其次第一个空格', () => {
    let s = shelf();
    s = dropStack(s, { row: 1, col: 3 }, makeStack('battery', 2, null)) as Shelf;
    const placed = autoPlace(s, makeStack('battery', 3, null));
    expect(placed).not.toBeNull();
    expect(placed && placed.pos).toEqual({ row: 1, col: 3 });

    const placed2 = autoPlace(s, makeStack('toolbox', 1, null));
    expect(placed2 && placed2.pos).toEqual({ row: 0, col: 0 });
  });
});

describe('移动与交换', () => {
  it('同货架内换位', () => {
    let s = shelf();
    s = dropStack(s, { row: 0, col: 0 }, makeStack('battery', 1, null)) as Shelf;
    s = dropStack(s, { row: 0, col: 5 }, makeStack('bandage', 1, null)) as Shelf;
    const moved = moveStack(s, { row: 0, col: 0 }, s, { row: 0, col: 5 });
    expect(moved).not.toBeNull();
    const next = moved as { from: Shelf; to: Shelf };
    expect(getStack(next.to, { row: 0, col: 5 })?.itemId).toBe('battery');
    expect(getStack(next.to, { row: 0, col: 0 })?.itemId).toBe('bandage');
  });

  it('跨货架交换', () => {
    let a = shelf(6, 4, 'a');
    let b = shelf(6, 4, 'b');
    a = dropStack(a, { row: 0, col: 0 }, makeStack('battery', 1, null)) as Shelf;
    b = dropStack(b, { row: 2, col: 1 }, makeStack('bandage', 5, null)) as Shelf;
    const moved = moveStack(a, { row: 0, col: 0 }, b, { row: 2, col: 1 });
    expect(moved).not.toBeNull();
    const next = moved as { from: Shelf; to: Shelf };
    expect(getStack(next.from, { row: 0, col: 0 })?.itemId).toBe('bandage');
    expect(getStack(next.to, { row: 2, col: 1 })?.itemId).toBe('battery');
  });

  it('跨货架移动合并同类', () => {
    let a = shelf(6, 4, 'a');
    let b = shelf(6, 4, 'b');
    a = dropStack(a, { row: 3, col: 3 }, makeStack('battery', 2, null)) as Shelf;
    b = dropStack(b, { row: 0, col: 0 }, makeStack('battery', 4, null)) as Shelf;
    const moved = moveStack(a, { row: 3, col: 3 }, b, { row: 0, col: 0 });
    const next = moved as { from: Shelf; to: Shelf };
    expect(getStack(next.from, { row: 3, col: 3 })).toBeNull();
    const stack = getStack(next.to, { row: 0, col: 0 });
    expect(stack && stackCount(stack)).toBe(6);
  });
});

describe('FEFO', () => {
  it('fefoSorted 按到期日升序紧凑重排', () => {
    let s = shelf(3, 2);
    s = dropStack(s, { row: 0, col: 0 }, makeStack('milk', 1, 300)) as Shelf;
    s = dropStack(s, { row: 1, col: 2 }, makeStack('milk', 1, 20)) as Shelf;
    s = dropStack(s, { row: 0, col: 1 }, makeStack('bandage', 1, null)) as Shelf;
    const sorted = fefoSorted(s);
    const order = readingOrder(sorted).map((pos) => getStack(sorted, pos));
    expect(order[0] && firstBatchExpiry(order[0])).toBe(20);
    expect(order[1] && firstBatchExpiry(order[1])).toBe(300);
    expect(order[2] && firstBatchExpiry(order[2])).toBeNull();
    expect(isShelfFEFO(sorted)).toBe(true);
  });

  it('错序的货架判定为未达标', () => {
    let s = shelf(2, 1);
    s = dropStack(s, { row: 0, col: 0 }, makeStack('milk', 1, 300)) as Shelf;
    s = dropStack(s, { row: 0, col: 1 }, makeStack('milk', 1, 20)) as Shelf;
    expect(isShelfFEFO(s)).toBe(false);
    expect(isShelfFEFO(fefoSorted(s))).toBe(true);
  });

  it('fefoRate 只统计非空货架', () => {
    let a = shelf(2, 1, 'a');
    let b = shelf(2, 1, 'b');
    a = dropStack(a, { row: 0, col: 0 }, makeStack('milk', 1, 50)) as Shelf;
    b = dropStack(b, { row: 0, col: 0 }, makeStack('milk', 1, 80)) as Shelf;
    b = dropStack(b, { row: 0, col: 1 }, makeStack('milk', 1, 40)) as Shelf;
    const empty = shelf(2, 1, 'c');
    expect(fefoRate([a, b, empty])).toBeCloseTo(0.5, 5);
  });
  it('★ 排序只动货物的次序，绝不动这架货架的属性（曾经把顺手位抹掉的真 bug）', () => {
    // 现场：玩家在整理页给 shelf_a 贴了胶带、标了顺手位，然后点了"按保质期排"。
    // 老实现重建货架时只带走了 zoneId，handyRank 被静默清成 null ——
    // 顺手位是全屋唯一的标记（HANDY_SLOTS = 1），丢一次就要玩家自己发现并重标。
    // 这类 bug 最难查：数值全对，只是你之前做过的那个决定不见了。
    let s = createShelf('shelf_x', 'room_living', 'shelf', 2, 1, 'z_food');
    s.handyRank = 1;
    s = dropStack(s, { row: 0, col: 0 }, makeStack('milk', 1, 300)) as Shelf;
    s = dropStack(s, { row: 0, col: 1 }, makeStack('milk', 1, 20)) as Shelf;

    const sorted = fefoSorted(s);
    expect(sorted.handyRank).toBe(1);
    expect(onlyZoneIdOf(sorted)).toBe('z_food');
    expect(firstBatchExpiry(getStack(sorted, { row: 0, col: 0 }) as ItemStack)).toBe(20);
  });
});

describe('归位率与整理评分', () => {
  const zones: Zone[] = [
    { id: 'z_food', name: '主食区', color: '#C8372D', autoAccept: { categories: ['food'] } },
    { id: 'z_free', name: '随便放', color: '#5B5B57' }
  ];

  it('无分区算未归位；分区规则接受才算归位', () => {
    let loose = shelf(2, 1, 'loose');
    let food = shelf(2, 1, 'food');
    loose = dropStack(loose, { row: 0, col: 0 }, makeStack('battery', 1, null)) as Shelf;
    food.zoneIds = food.zoneIds.map(() => 'z_food');
    food = dropStack(food, { row: 0, col: 0 }, makeStack('canned_beans', 1, 500)) as Shelf;
    food = dropStack(food, { row: 0, col: 1 }, makeStack('battery', 1, null)) as Shelf;
    // 3 堆里只有罐头归位
    expect(placementRate([loose, food], zones)).toBeCloseTo(1 / 3, 5);
  });

  it('★ §12 v0.8：空清单的胶带不再算归位（"贴一张空胶带"这个 loophole 已修）', () => {
    let s = shelf(2, 1, 'free');
    s.zoneIds = s.zoneIds.map(() => 'z_free');
    s = dropStack(s, { row: 0, col: 0 }, makeStack('toolbox', 1, null)) as Shelf;
    // 老口径：没写清单 = 什么都收 → 归位率恒满 → 最优解退化成"贴一张空胶带"
    // 新口径：归位率量的是"你有没有按自己写的清单放"，没清单就无从谈起
    expect(placementRate([s], zones)).toBe(0);
  });

  it('★ §12 v0.8：明确清单与空清单的差别，就是 100% 与 0% 的差别', () => {
    let listed = shelf(2, 1, 'listed');
    listed.zoneIds = listed.zoneIds.map(() => 'z_food');
    listed = dropStack(listed, { row: 0, col: 0 }, makeStack('canned_beans', 1, null)) as Shelf;

    let open = shelf(2, 1, 'open');
    open.zoneIds = open.zoneIds.map(() => 'z_free');
    open = dropStack(open, { row: 0, col: 0 }, makeStack('canned_beans', 1, null)) as Shelf;

    expect(placementRate([listed], zones)).toBe(1);
    expect(placementRate([open], zones)).toBe(0);
  });

  it('空房间：归位率宽容为 1（不出生就给人 0%），但 FEFO 率是 0（一块货架都没用上 = 还没开始排）', () => {
    const score = computeOrganizeScore([shelf()], zones, [], getDisasterDef('cold_snap'));
    expect(score.placement).toBe(1);
    // ★ M1 手测修正：这里原来是 1，导致"囤了 17 箱一口没拆、货架全空"的人
    // 依然拿着 100% 的临期优先 —— 而它还是生存期体力劳作质量的输入之一。
    expect(score.fefo).toBe(0);
    expect(score.stacks).toBe(0);
    expect(score.tidyShelfIds).toEqual([]);
  });

  it('整整齐齐 = FEFO 达标 + 分区全接收', () => {
    const shelfA = createShelf('tidy', 'room_living', 'shelf', 2, 1, 'z_food');
    const withItems = dropStack(shelfA, { row: 0, col: 0 }, makeStack('canned_beans', 2, 400)) as Shelf;
    const score = computeOrganizeScore([withItems], zones, [], getDisasterDef('cold_snap'));
    expect(score.tidyShelfIds).toEqual(['tidy']);
  });
});

describe('种子化 RNG', () => {
  it('同种子同序列', () => {
    const a = createCursor(12345);
    const b = createCursor(12345);
    const seqA = Array.from({ length: 8 }, () => nextInt(a, 0, 1000));
    const seqB = Array.from({ length: 8 }, () => nextInt(b, 0, 1000));
    expect(seqA).toEqual(seqB);
  });

  it('不同种子不同序列', () => {
    const a = createCursor(1);
    const b = createCursor(2);
    expect(nextInt(a, 0, 1e9)).not.toBe(nextInt(b, 0, 1e9));
  });

  it('shuffle 不改原数组且是排列', () => {
    const src = [1, 2, 3, 4, 5, 6];
    const cursor = createCursor(777);
    const out = shuffle(cursor, src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort((x, y) => x - y)).toEqual(src);
  });
});
