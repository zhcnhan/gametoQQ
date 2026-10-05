/**
 * 搬运惩罚的位置那一半（§10B.3.1 第 7 维，M4 验收第 1 条的第四维）。
 *
 * ## 这一组要钉住的三件事
 *
 *  ① **平时不生效**：`carryFactor >= 1` 时乘数恒为 1。
 *     这一条最要紧 —— M4 之前 17 个维度里只有 3 个改"该放哪儿"，
 *     而这三条永久回归探针（好档活 / 乱档倒）的前提是"同一份货 = 同一个结果"。
 *     搬运惩罚要是平时也在罚，那些探针的结论就会随屋子布局漂移；
 *  ② **只在"搬不动的天气"里拉开距离**：门口那块永远 1.0，越往里越贵，
 *     最里头那块恰好吃满 `HAUL_PREMIUM_MAX`；
 *  ③ **按存量加权**，不是按"第几块"一刀切 —— 空着的最里头那块不该收费
 *     （不然"多买一块架子然后空着"会莫名其妙变贵，玩家学不到任何东西）。
 */
import { describe, expect, it } from 'vitest';
import {
  HAUL_FULL_RAMP,
  HAUL_PREMIUM_MAX,
  farShelfNote,
  haulFactorAt,
  haulFactorOfShelves,
  haulIndexOfShelves,
  haulRamp,
  workHauledOf
} from './haul';
import { createShelf, makeStack, setSlotStack } from './shelf';
import type { Shelf } from './types';

/** 一块货架，往 col 0 的第 0 排堆 `count` 件（一件一格，够用就行） */
function stacked(id: string, count: number): Shelf {
  let shelf = createShelf(id, 'room_living', 'shelf');
  for (let i = 0; i < count; i++) {
    shelf = setSlotStack(shelf, { row: 0, col: i }, makeStack('canned_beans', 1, null));
  }
  return shelf;
}

describe('haulRamp：这一场有多严重', () => {
  it('平时的搬运惩罚（1 或不写）→ 0：这条路整条不生效', () => {
    expect(haulRamp(1)).toBe(0);
    expect(haulRamp(1.2)).toBe(0); // 灾难不该让屋子变大，> 1 与 1 等价
    expect(haulRamp(Number.NaN)).toBe(0); // 坏值退回"没有惩罚"，不是"惩罚拉满"
  });

  it('★ 最糟的那一档（0.5）恰好吃满，中间档按比例', () => {
    expect(haulRamp(1 - HAUL_FULL_RAMP)).toBe(1);
    expect(haulRamp(0.4)).toBe(1); // 比最糟还糟（理论上夹不到）也不超过 1
    expect(haulRamp(0.75)).toBeCloseTo(0.5, 6);
  });
});

describe('haulFactorAt：第几层贵多少', () => {
  it('★ 门口那块（index 0）永远不罚 —— 哪怕天气最糟', () => {
    expect(haulFactorAt(0, 0.5)).toBe(1);
    expect(haulFactorAt(0, 1)).toBe(1);
  });

  it('★ 越往里越贵，最里头那块恰好吃满上限', () => {
    const worst = 0.5;
    expect(haulFactorAt(1, worst)).toBeCloseTo(1 + HAUL_PREMIUM_MAX / 2, 6);
    expect(haulFactorAt(2, worst)).toBeCloseTo(1 + HAUL_PREMIUM_MAX, 6);
    // 第 3 层不该继续涨 —— 一栋屋子能有的"深"就到这里
    expect(haulFactorAt(9, worst)).toBeCloseTo(1 + HAUL_PREMIUM_MAX, 6);
    // 单调性：往里走只会更贵，不会更便宜
    expect(haulFactorAt(1, worst)).toBeGreaterThan(haulFactorAt(0, worst));
    expect(haulFactorAt(2, worst)).toBeGreaterThan(haulFactorAt(1, worst));
  });

  it('★ 上限明显小于装卸工的 20% —— 否则"选谁"就不重要了', () => {
    // 这条断言是给下一个改 HAUL_PREMIUM_MAX 的人看的：20% 那条线是身份天赋的，
    // 位置这一半压过去，玩家会发现"挑身份不如挑摆法"，而那与 §6 的分工相反
    expect(HAUL_PREMIUM_MAX).toBeLessThan(0.2);
    expect(HAUL_PREMIUM_MAX).toBeGreaterThan(0.05); // 也不能小到在日报上看不见
  });
});

describe('haulIndexOfShelves：第几层按什么算', () => {
  it('★ 按 `run.shelves` 的顺序，门口是第一块', () => {
    const map = haulIndexOfShelves([stacked('shelf_a', 1), stacked('shelf_b', 1), stacked('shelf_c', 1)]);
    expect(map.get('shelf_a')).toBe(0);
    expect(map.get('shelf_b')).toBe(1);
    expect(map.get('shelf_c')).toBe(2);
  });

  it('一块都没有 → 空表（不是抛异常）', () => {
    expect(haulIndexOfShelves([]).size).toBe(0);
  });
});

describe('haulFactorOfShelves：全屋乘数', () => {
  it('★ 平时恒为 1（三条永久回归探针的前提）', () => {
    const shelves = [stacked('shelf_a', 3), stacked('shelf_b', 3), stacked('shelf_c', 3)];
    expect(haulFactorOfShelves(shelves, 1)).toBe(1);
    expect(haulFactorOfShelves(shelves, Number.NaN)).toBe(1);
  });

  it('只有门口那块有货 → 1：东西都在手边，天气再糟也不多花', () => {
    expect(haulFactorOfShelves([stacked('shelf_a', 5), stacked('shelf_b', 0)], 0.5)).toBe(1);
  });

  it('★ 空着的最里头那块不收费（按存量加权，不是按第几块一刀切）', () => {
    const onlyFront = [stacked('shelf_a', 4), stacked('shelf_b', 0), stacked('shelf_c', 0)];
    expect(haulFactorOfShelves(onlyFront, 0.5)).toBe(1);
  });

  it('★ 全压在深处才最贵，而且不超过上限', () => {
    const deep = [stacked('shelf_a', 0), stacked('shelf_b', 0), stacked('shelf_c', 4)];
    const factor = haulFactorOfShelves(deep, 0.5);
    expect(factor).toBeCloseTo(1 + HAUL_PREMIUM_MAX, 6);
    expect(factor).toBeLessThanOrEqual(1 + HAUL_PREMIUM_MAX);
  });

  it('★ 深浅各一半 → 落在中间：这是"挪一部分"能换到的收益', () => {
    const half = [stacked('shelf_a', 2), stacked('shelf_b', 0), stacked('shelf_c', 2)];
    const factor = haulFactorOfShelves(half, 0.5);
    const all = haulFactorOfShelves([stacked('shelf_a', 0), stacked('shelf_b', 0), stacked('shelf_c', 4)], 0.5);
    expect(factor).toBeLessThan(all);
    expect(factor).toBeGreaterThan(1);
    // 一半在深处：正好是上限的一半
    expect(factor).toBeCloseTo(1 + HAUL_PREMIUM_MAX / 2, 6);
  });

  it('★ 没有货 → 1（空屋子不是"最贵"）', () => {
    expect(haulFactorOfShelves([stacked('shelf_a', 0)], 0.5)).toBe(1);
    expect(haulFactorOfShelves([], 0.5)).toBe(1);
  });
});

describe('workHauledOf / farShelfNote：给玩家看的那两个数', () => {
  it('★ 多花的体力从乘数反算，且不为负数', () => {
    expect(workHauledOf(10, 1)).toBe(0);
    expect(workHauledOf(10, 1.15)).toBeCloseTo(1.5, 6);
    expect(workHauledOf(10, 0.8)).toBe(0); // 乘数小于 1 不是"省了"，是数据坏了
    expect(workHauledOf(Number.NaN, 1.15)).toBe(0);
  });

  it('★ 门口那块与"没有惩罚"的天气都不挂牌子', () => {
    expect(farShelfNote(0, 0.5)).toBeNull();
    expect(farShelfNote(1, 1)).toBeNull();
    expect(farShelfNote(2, 1)).toBeNull();
  });

  it('★ 牌子上的百分比与乘数一致（两处各写一遍就会漂）', () => {
    const worst = 0.5;
    const mid = farShelfNote(1, worst) ?? '';
    const deep = farShelfNote(2, worst) ?? '';
    const pctOf = (s: string): number => Number(/(\d+)%/.exec(s)?.[1] ?? '-1');
    expect(pctOf(mid)).toBe(Math.round((haulFactorAt(1, worst) - 1) * 100));
    expect(pctOf(deep)).toBe(Math.round((haulFactorAt(2, worst) - 1) * 100));
    // 最里头那句要说"最里头"，中间那句不能说"最里头"
    expect(deep).toContain('最里头');
    expect(mid).not.toContain('最里头');
  });
});
