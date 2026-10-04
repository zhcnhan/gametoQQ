/**
 * 反差层（§6.6「数字自己说话」）。
 *
 * 这一层的全部内容就是**四个数字**，所以测试也只盯数字。
 * 它的错误不会崩、不会报错，只会让玩家读到一句假话 —— 那才是这里最该挡住的东西。
 */
import { describe, expect, it } from 'vitest';
import { outdoorTemp } from '../data/disaster';
import { makeStack, setSlotStack } from './shelf';
import { districtDays, indoorTemp, supplyDays } from './contrast';
import type { RunState } from './types';
import { createStartingRun } from '../systems/setup';
import { getDisasterDef, SURVIVAL_DAYS } from '../data/disaster';

function emptyRun(): RunState {
  const run = createStartingRun(20261001);
  run.boxesToUnpack = [];
  run.shelves = run.shelves.map((s) => ({
    ...s,
    slots: s.slots.map((row) => row.map(() => ({ stack: null })))
  }));
  return run;
}

function give(run: RunState, itemId: string, count: number): void {
  const shelf = run.shelves[0];
  if (!shelf) throw new Error('开局没有货架');
  for (let row = 0; row < shelf.h; row++) {
    for (let col = 0; col < shelf.w; col++) {
      if (shelf.slots[row]?.[col]?.stack === null) {
        run.shelves[0] = setSlotStack(shelf, { row, col }, makeStack(itemId, count, null));
        return;
      }
    }
  }
  throw new Error('货架满了');
}

describe('反差层：四个数字的口径', () => {
  it('屋内温度由庇护所决定：满值 18°C，归零时和外面差不多', () => {
    expect(indoorTemp(100)).toBe(18);
    expect(indoorTemp(0)).toBe(-2);
    expect(indoorTemp(50)).toBe(8);
    // 越界不崩，也不给出荒谬的数
    expect(indoorTemp(999)).toBe(18);
    expect(indoorTemp(-50)).toBe(-2);
  });

  it('★ 余粮天数取**最先见底**的那一项，不是总和', () => {
    const run = emptyRun();
    give(run, 'canned_beans', 10); // 主食：每天 2 件 → 5 天
    give(run, 'mineral_water', 4); // 饮水：每天 2 件 → 2 天
    give(run, 'fuel_can', 8); // 燃料：每天 2 件 → 4 天

    // 米面还够五天，但水只够两天 —— 玩家的余粮就是两天
    expect(supplyDays(run, getDisasterDef(run.disasterId))).toBe(2);
  });

  it('余粮算的是全屋（含还没拆的纸箱）—— 箱子里有粮却报 0 天是在骗人', () => {
    const run = emptyRun();
    run.boxesToUnpack = [
      {
        id: 'box_x',
        defId: 'box_staple',
        items: [makeStack('canned_beans', 6, null), makeStack('mineral_water', 6, null), makeStack('fuel_can', 6, null)]
      }
    ];
    expect(supplyDays(run, getDisasterDef(run.disasterId))).toBe(3);
  });

  it('街区平均随时间递减，而且不会跑到负数', () => {
    expect(districtDays(0)).toBe(0);
    expect(districtDays(1)).toBe(3);
    expect(districtDays(4)).toBe(1);
    expect(districtDays(7)).toBe(0);
    expect(districtDays(99)).toBe(0); // 越界夹到末尾，不给负值
  });

  it('★ 这条曲线必须覆盖**整个生存期**（原来只有 9 天，后 5 天全是同一个数）', () => {
    /*
     * 原来那张表是 9 个数，而 `SURVIVAL_DAYS` 是 14 ——
     * 于是第 10~14 天全都返回最后一档（0），也就是"整条街一点粮都没有了"。
     * 那五天里这个数字**不再有任何信息量**：它既不变化、也不解释任何事，
     * 只是每天印一个 0 在玩家旁边。
     *
     * ★ 而当时的测试**一条都不会红** —— 它们查的是
     * `districtDays(0/1/4/7/99)`，全都是表内的点。
     * 所以这条用例改成遍历**整个生存期**。
     *
     * ⚠ 但下标 0 是**哨兵**（灾难前，day ≤ 0 读它），**不是曲线上的点**。
     * 我第一版从下标 0 开始查单调，于是报出"第 1 天比第 0 天还多"——
     * **是断言错了，不是数据错了**。曲线本身从下标 1 起。
     */
    for (let day = 0; day <= SURVIVAL_DAYS; day++) {
      const v = districtDays(day);
      expect(Number.isFinite(v), `D+${day}`).toBe(true);
      expect(v, `D+${day} 不该是负数`).toBeGreaterThanOrEqual(0);
    }
    // 递减：整条街只会越来越空（从下标 1，也就是 D+1 起）
    let prev = Number.POSITIVE_INFINITY;
    for (let day = 1; day <= SURVIVAL_DAYS; day++) {
      const v = districtDays(day);
      expect(v, `D+${day} 比前一天还多`).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('★ 「你还有粮、整条街已经空了」这个反差必须真的出现过', () => {
    // 这是这一层最狠的一句话（§6.6）。它要求街区在**生存期后段**就已经归零，
    // 而不是等到最后一天才归零 —— 否则玩家没有机会看到那个对比
    expect(districtDays(7)).toBe(0);
    expect(districtDays(14)).toBe(0);
  });

  it('外界温度：灾难那天断崖式下跌，并且两头都夹得住', () => {
    expect(outdoorTemp(-7)).toBe(6);
    expect(outdoorTemp(-1)).toBe(-5);
    expect(outdoorTemp(0)).toBe(-18); // D-Day 的断崖
    expect(outdoorTemp(7)).toBe(-30);
    expect(outdoorTemp(14)).toBe(-36); // §12.3 v0.7：生存期 14 天，寒潮尾声最冷
    // 越界（手改过的档）不崩
    expect(outdoorTemp(-99)).toBe(6);
    expect(outdoorTemp(99)).toBe(-36);
  });

  it('日历里写的温度和 `outdoorTemp` 对得上 —— 玩家会把两句话对照着读', () => {
    const disaster = getDisasterDef('cold_snap');
    for (const forecast of disaster.calendar) {
      const match = /(-?\d+)°C/.exec(forecast.hint);
      if (!match) continue;
      expect(outdoorTemp(forecast.day)).toBe(Number(match[1]));
    }
  });
});
