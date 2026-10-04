/**
 * 「翻乱相邻货架」（§6.4 的滚雪球）—— 清偿 D-11。
 *
 * ## 这一组要守住的是什么
 *
 * 这条机制**天生容易做坏**：D-11 原来刻意不做，理由就是"它会自我放大，
 * 玩家掉进去就爬不出来"。所以测试要钉的不是"它会乱"，而是
 * **它的三条收敛**：
 *
 *  ① **没翻找就不会乱**（`taken = 0` → 0 处）—— 屋子不会自己乱；
 *  ② **整理好了就不会乱**（`placement >= 1` → 0 处）—— ★ 这条是我第一版的
 *     设计错误：那时连满分盘面都会被翻乱 4~6 件，而它正好违背这条机制
 *     要教的东西（"你分好这一行，明天就不会被翻乱"）。
 *     见 `scatterCountFor` 的注释；
 *  ③ **只在一行之内挪位** —— 不跨行、不跨架、**不销毁、不新增**。
 *     最后一条最要紧：一个会丢东西的机制会让玩家再也不敢整理。
 */
import { describe, expect, it } from 'vitest';
import { readingOrder, createShelf, makeStack, setSlotStack, getStack } from './shelf';
import { SCATTER_MAX_PER_DAY, messiestRows, scatterCountFor, scatterRows } from './scatter';
import { createStartingRun } from '../systems/setup';
import type { Shelf } from './types';

describe('★ 该翻乱几处：三条收敛', () => {
  it('★★ 没从货架上取东西 → 0 处（屋子不会自己乱）', () => {
    expect(scatterCountFor({ taken: 0, unreachable: 3, placement: 0.1 })).toBe(0);
  });

  it('★★ 全都归位了 → 0 处（★ 这一条是补上的设计错误）', () => {
    /*
     * 第一版没有这条，于是"中途补救"那一局（归位率 1.0）每天照样被翻乱 4~6 件。
     * 玩家从中学到的是"整理没用，反正都会乱"—— 那正好是这条机制的反面。
     * ⚠ 它同时是成就「整整齐齐」的门槛（`cleanDays`），让满分盘面被自己翻乱，
     * 会让那条成就变成运气。
     */
    expect(scatterCountFor({ taken: 10, unreachable: 0, placement: 1 })).toBe(0);
    expect(scatterCountFor({ taken: 10, unreachable: 5, placement: 1 })).toBe(0);
  });

  it('★ 取了东西而且盘面乱 → 有翻乱，而且乱得越狠越多', () => {
    const tidy = scatterCountFor({ taken: 10, unreachable: 0, placement: 0.9 });
    const messy = scatterCountFor({ taken: 10, unreachable: 0, placement: 0.5 });
    const awful = scatterCountFor({ taken: 10, unreachable: 2, placement: 0.2 });
    expect(tidy).toBeGreaterThan(0);
    expect(messy).toBeGreaterThan(tidy);
    expect(awful).toBeGreaterThan(messy);
  });

  it('★ 一天翻乱有上限（不许一天之内把一屋子毁掉）', () => {
    const worst = scatterCountFor({ taken: 99, unreachable: 99, placement: 0 });
    expect(worst).toBe(SCATTER_MAX_PER_DAY);
    expect(worst).toBeLessThanOrEqual(4);
  });
});

/** 一块 3×3 的货架，按 `fill` 决定每一格放什么 */
function shelfWith(fill: readonly (readonly string[])[]): Shelf {
  let shelf = createShelf('s1', 'room_living', 'shelf', 3, 3);
  for (let row = 0; row < fill.length; row++) {
    for (let col = 0; col < (fill[row]?.length ?? 0); col++) {
      const itemId = fill[row]?.[col];
      if (!itemId) continue;
      shelf = setSlotStack(shelf, { row, col }, makeStack(itemId, 3, 100));
    }
  }
  return shelf;
}

describe('★ 翻乱：只在一行内挪位，而且不丢东西', () => {
  it('★★ 同一行的顺序真的变了（不是原地不动）', () => {
    const before = shelfWith([['canned_beans', 'rice_bag', 'salt_bag']]);
    const result = scatterRows(before, [0], () => 0);
    const moved = result.shelves[0];
    expect(moved).toBeDefined();
    if (!moved) return;
    const ids = (shelf: Shelf): (string | null)[] =>
      [0, 1, 2].map((col) => getStack(shelf, { row: 0, col })?.itemId ?? null);
    expect(ids(moved), '顺序该变').not.toEqual(ids(before));
  });

  it('★★ 不丢东西、不新增：件数与种类都一样', () => {
    const before = shelfWith([['canned_beans', 'rice_bag', 'salt_bag']]);
    const moved = scatterRows(before, [0], () => 0).shelves[0];
    if (!moved) throw new Error('该返回一块货架');
    const tally = (shelf: Shelf): string[] =>
      readingOrder(shelf)
        .map((p) => getStack(shelf, p)?.itemId)
        .filter((x): x is string => Boolean(x))
        .sort();
    expect(tally(moved)).toEqual(tally(before));
  });

  it('★ 只碰被点到的那一行（别的行一格不动）', () => {
    const before = shelfWith([
      ['canned_beans', 'rice_bag', 'salt_bag'],
      ['battery', 'candle_pack', 'milk']
    ]);
    const moved = scatterRows(before, [0], () => 0).shelves[0];
    if (!moved) throw new Error('该返回一块货架');
    for (let col = 0; col < 3; col++) {
      expect(getStack(moved, { row: 1, col })?.itemId, '第 2 行不该动').toBe(
        getStack(before, { row: 1, col })?.itemId
      );
    }
  });

  it('★ 一行只有一件时没什么可翻的（返回 0 件）', () => {
    const before = shelfWith([['canned_beans']]);
    expect(scatterRows(before, [0], () => 0).moved).toBe(0);
  });

  it('★ 不碰胶带（翻乱翻的是位置，不是规矩）', () => {
    const before = { ...shelfWith([['canned_beans', 'rice_bag', 'salt_bag']]), zoneIds: ['z_staple', null, null] };
    const moved = scatterRows(before, [0], () => 0).shelves[0];
    expect(moved?.zoneIds).toEqual(before.zoneIds);
  });
});

describe('★ 挑哪几行来翻：先挑最乱的', () => {
  it('★ 一行有胶带却没按清单放 → 排在没立规矩的行前面', () => {
    const run = createStartingRun(20261001);
    /*
     * 造两块架：A 有胶带（什么都不收）但东西全不在清单里；B 没有胶带。
     * 两块都"乱"，而 A 是**立了规矩没守**，所以它该先被翻。
     */
    run.zones = [
      {
        id: 'z_narrow',
        name: '只收电池',
        color: '#000',
        categories: ['tool'],
        createdAtDay: 0
      } as never
    ];
    run.shelves = [
      { ...shelfWith([['rice_bag', 'milk', 'salt_bag']]), id: 'shelfA', zoneIds: ['z_narrow', null, null] },
      { ...shelfWith([['rice_bag', 'milk', 'salt_bag']]), id: 'shelfB', zoneIds: [null, null, null] }
    ];
    const picked = messiestRows(run, 2);
    expect(picked.length).toBe(2);
    expect(picked[0]?.shelfId, '立了规矩没守的那一行该排前面').toBe('shelfA');
  });

  it('★ 空的货架不进候选（没有东西可翻）', () => {
    const run = createStartingRun(20261001);
    run.shelves = [createShelf('empty', 'room_living', 'shelf', 3, 3)];
    expect(messiestRows(run, 4)).toEqual([]);
  });
});
