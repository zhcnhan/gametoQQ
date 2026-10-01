/**
 * 应急可达率（§6.3 的第三维，M1 阶段 F 补齐）。
 *
 * 它守的是一个很容易写成"看起来对"的地方：只有应急物资**真的在顺手位上**才算数。
 * 最常见的真实情况恰恰是"药全在纸箱底"──那必须是 0%，不能因为"玩家有药"就给分。
 */
import { describe, expect, it } from 'vitest';
import { getDisasterDef } from '../data/disaster';
import { emergencyCategories, emergencyRate } from './score';
import { createShelf, makeStack, setSlotStack } from './shelf';
import type { Shelf, UnpackBox } from './types';

const COLD_SNAP = getDisasterDef('cold_snap');

function shelfWith(id: string, itemId: string, count: number, handyRank: number | null): Shelf {
  const shelf = createShelf(id, 'room_living', 'shelf', 2, 1, null);
  const withStack = setSlotStack(shelf, { row: 0, col: 0 }, makeStack(itemId, count, null));
  return { ...withStack, handyRank };
}

describe('应急可达率', () => {
  it('应急品类跟着灾难走：寒潮要燃料，另外永远算上医疗', () => {
    const categories = emergencyCategories(COLD_SNAP);
    expect(categories).toContain('fuel');
    expect(categories).toContain('medicine');
  });

  it('药全在顺手位 → 100%', () => {
    expect(emergencyRate([shelfWith('s1', 'bandage', 4, 1)], [], COLD_SNAP)).toBe(1);
  });

  it('药一半在顺手位 → 50%', () => {
    const shelves = [shelfWith('s1', 'bandage', 2, 1), shelfWith('s2', 'bandage', 2, null)];
    expect(emergencyRate(shelves, [], COLD_SNAP)).toBeCloseTo(0.5, 2);
  });

  it('★ 药全在纸箱里 → 0% —— 分母算全屋，因为箱底那卷绷带确实不在顺手位', () => {
    const boxes: UnpackBox[] = [{ id: 'b1', defId: 'box_medical', items: [makeStack('bandage', 4, null)] }];
    expect(emergencyRate([], boxes, COLD_SNAP)).toBe(0);
  });

  it('顺手位放的是罐头、药在普通货架上 → 0%（顺手位本身不加分，加分的只有"对的东西在顺手位"）', () => {
    const shelves = [shelfWith('s1', 'canned_beans', 4, 1), shelfWith('s2', 'bandage', 4, null)];
    expect(emergencyRate(shelves, [], COLD_SNAP)).toBe(0);
  });

  it('屋里压根没有应急物资 → 1（宽容：手上没药不该被判成"没放好"）', () => {
    expect(emergencyRate([shelfWith('s1', 'canned_beans', 4, null)], [], COLD_SNAP)).toBe(1);
  });
});
