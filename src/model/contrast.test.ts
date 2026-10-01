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
import { getDisasterDef } from '../data/disaster';

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

  it('外界温度：灾难那天断崖式下跌，并且两头都夹得住', () => {
    expect(outdoorTemp(-7)).toBe(6);
    expect(outdoorTemp(-1)).toBe(-5);
    expect(outdoorTemp(0)).toBe(-18); // D-Day 的断崖
    expect(outdoorTemp(7)).toBe(-30);
    // 越界（手改过的档 / 更长的生存期）不崩
    expect(outdoorTemp(-99)).toBe(6);
    expect(outdoorTemp(99)).toBe(-30);
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
