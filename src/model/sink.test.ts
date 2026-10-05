/**
 * 屋子进水：「从下往上」吃掉空间（M4 W-05 的地基）。
 *
 * ## 这一组要钉住的四件事
 *
 *  ① **砍的是尾部**（屏幕上最下面那几排）。这条最容易搞反 —— 数据的 row 0 是
 *     **最上面**一排（见 `model/sink.ts` 顶部那段数据约定），所以"从下往上"
 *     在数组上是 `slice(0, h - n)`。搞反了不会报错：玩家只会发现
 *     **最顺手的那一排**先没了；
 *  ② **东西不蒸发** —— 被砍那几排里的货必须原样出现在 `salvaged` 里。
 *     一个会丢东西的机制会让玩家再也不敢整理（与 `model/scatter.ts` 同一条教训）；
 *  ③ **三个数组必须同长**：`h` / `slots` / `zoneIds`。只改一个就会出现
 *     "放得进去、东西却不见了"那一类静默 bug（`isInside` 只查 `h`）；
 *  ④ **每块至少留一排**，而且砍不动的那块**原样不动**。
 */
import { describe, expect, it } from 'vitest';
import { createShelf, getStack, makeStack, setSlotStack } from './shelf';
import { HOME_SINK_MAX_ROWS, sinkShelves } from './sink';
import type { Shelf, Zone } from './types';

const label = (_shelf: Shelf, index: number): string => `第 ${index + 1} 块`;

function tape(id: string, name: string): Zone {
  return { id, name, color: '#000' };
}

/** 一块 4 排的货架，往 `rows` 这几排各放一件（col 0），并给这几排贴上同一张胶带 */
function shelfWith(id: string, rows: readonly number[], zoneId: string | null = null): Shelf {
  let shelf = createShelf(id, 'room_living', 'shelf');
  if (zoneId !== null) shelf = { ...shelf, zoneIds: shelf.zoneIds.map(() => zoneId) };
  for (const row of rows) shelf = setSlotStack(shelf, { row, col: 0 }, makeStack('canned_beans', 3, null));
  return shelf;
}

/** 往一格放一件**指定的**货（用来分辨"被捞走的是哪一件"） */
function put(shelf: Shelf, row: number, itemId: string): Shelf {
  return setSlotStack(shelf, { row, col: 0 }, makeStack(itemId, 1, null));
}

describe('sinkShelves：砍哪几排', () => {
  it('★ 砍的是**最后**那几排（数据里 row 0 是屏幕上最上面）', () => {
    /*
     * ⚠ 这份 fixture 的力气全在**两头都放了不同的货**上。
     *
     * 只放最后一排的话，"砍尾部"与"砍头部"两种实现都砍不掉它
     * （砍头部时它留在原地），用例照样全绿 —— 那条断言就只会说"没事"。
     * 所以这里靠"被捞走的那件是**哪一件**"来判方向，而不是靠"有没有被捞走"。
     */
    const shelf = put(shelfWith('shelf_a', [0]), 3, 'rice_bag');
    const res = sinkShelves([shelf], [], 1, label);

    expect(res.rows).toBe(1);
    expect(res.shelfIds).toEqual(['shelf_a']);
    const after = res.shelves[0];
    expect(after.h).toBe(3);
    expect(after.slots).toHaveLength(3);
    expect(after.zoneIds).toHaveLength(3);
    // ★ 捞走的是**最下面**那件（rice_bag），最上面那件还在原处
    expect(res.salvaged).toHaveLength(1);
    expect(res.salvaged[0].stacks.map((s) => s.itemId)).toEqual(['rice_bag']);
    expect(getStack(after, { row: 0, col: 0 })?.itemId).toBe('canned_beans');
    expect(getStack(after, { row: 2, col: 0 })).toBeNull();
  });

  it('★ 东西不蒸发：被砍那几排的货全部出现在 salvaged 里', () => {
    const shelf = shelfWith('shelf_a', [2, 3]);
    const res = sinkShelves([shelf], [], 1, label);
    // 只砍 1 排 → 只有 row 3 那件被捞出来，row 2 那件留在原地
    expect(res.salvaged[0].stacks).toHaveLength(1);
    expect(getStack(res.shelves[0], { row: 2, col: 0 })).not.toBeNull();
    // 砍 2 排 → 两件都在
    const two = sinkShelves(res.shelves, [], 1, label);
    expect(two.salvaged[0].stacks).toHaveLength(1);
  });

  it('空排被砍时不会有 salvaged 条目（水位到了，但没什么可捞的）', () => {
    const res = sinkShelves([shelfWith('shelf_a', [0])], [], 1, label);
    expect(res.rows).toBe(1);
    /*
     * ⚠ `salvaged` 必须**整条都不在**，而不是"在、但 stacks 是空的"。
     * 后者放过了"砍错方向"这类 bug：从**上面**砍掉一排时，被砍的是空排，
     * 于是 `salvaged` 里会出现一条 `stacks: []` 的记录 —— 界面照着它
     * 报"捞出来 1 箱"，而实际上什么都没捞（`shop.ts` 是按条目逐个装箱的）。
     */
    expect(res.salvaged).toEqual([]);
  });

  it('★ 每块至少留一排：只剩一排的那块原样不动，别的块照砍', () => {
    const tall = shelfWith('shelf_a', [3]);
    const low = { ...shelfWith('shelf_b', []), h: 1, slots: [shelfWith('shelf_b', []).slots[0]], zoneIds: [null] };
    const res = sinkShelves([tall, low], [], 2, label);

    expect(res.rows).toBe(2);
    expect(res.shelfIds).toEqual(['shelf_a']);
    expect(res.shelves[0].h).toBe(2);
    // 矮家具原样：**同一个对象**（没被改，也没被复制）
    expect(res.shelves[1]).toBe(low);
    expect(res.shelves[1].h).toBe(1);
  });

  it('全部只剩一排时一行都砍不动（rows = 0，调用方据此不报"淹了"）', () => {
    const one = { ...shelfWith('shelf_a', []), h: 1, slots: [shelfWith('shelf_a', []).slots[0]], zoneIds: [null] };
    const res = sinkShelves([one], [], 2, label);
    expect(res.rows).toBe(0);
    expect(res.shelfIds).toEqual([]);
    expect(res.shelves[0].h).toBe(1);
  });

  it('排数被夹在 HOME_SINK_MAX_ROWS 之内', () => {
    expect(sinkShelves([shelfWith('shelf_a', [])], [], 9, label).rows).toBe(HOME_SINK_MAX_ROWS);
    expect(sinkShelves([shelfWith('shelf_a', [])], [], 0, label).rows).toBe(0);
    expect(sinkShelves([shelfWith('shelf_a', [])], [], -1, label).rows).toBe(0);
  });

  it('★ 改完之后 h / slots / zoneIds 三个长度必须一致', () => {
    const res = sinkShelves([shelfWith('shelf_a', [], 'zone_food')], [], 2, label);
    const after = res.shelves[0];
    expect(after.slots).toHaveLength(after.h);
    expect(after.zoneIds).toHaveLength(after.h);
  });

  it('入参不被改（原子存档要求返回新对象）', () => {
    const shelf = shelfWith('shelf_a', [3]);
    const before = shelf.slots.length;
    sinkShelves([shelf], [], 1, label);
    expect(shelf.slots).toHaveLength(before);
    expect(shelf.h).toBe(4);
  });
});

describe('sinkShelves：胶带', () => {
  it('★ 一行都不剩的胶带被报出来（由调用方从 run.zones 摘掉）', () => {
    // 整块都贴着 zone_food → 砍掉一排之后还剩三排，胶带仍然活着
    const partly = sinkShelves([shelfWith('shelf_a', [], 'zone_food')], [tape('zone_food', '主食')], 1, label);
    expect(partly.orphanZones).toEqual([]);

    // 只有**最后那一排**贴着 zone_rare → 砍掉之后它一行都不剩
    let only = createShelf('shelf_a', 'room_living', 'shelf');
    only = { ...only, zoneIds: [null, null, null, 'zone_rare'] };
    const res = sinkShelves([only], [tape('zone_rare', '囤货')], 1, label);
    expect(res.orphanZones.map((z) => z.name)).toEqual(['囤货']);
  });

  it('别的货架上还贴着同一张胶带时不算失效', () => {
    let a = createShelf('shelf_a', 'room_living', 'shelf');
    a = { ...a, zoneIds: [null, null, null, 'zone_rare'] };
    const b = createShelf('shelf_b', 'room_living', 'shelf', 6, 4, 'zone_rare');
    const res = sinkShelves([a, b], [tape('zone_rare', '囤货')], 1, label);
    expect(res.orphanZones).toEqual([]);
  });
});
