/**
 * 整理品质评分（策划案 §6.3 三个可量化维度中的两个；应急可达率属 M1）。
 * 纯逻辑，可单测。
 */
import { getItemDef } from '../data/items';
import { countStacks, fefoRate, findZone, isShelfFEFO, placementRate, readingOrder, getStack, zoneAccepts } from './shelf';
import type { Shelf, Zone } from './types';

export interface OrganizeScore {
  /** 归位率 0..1 */
  placement: number;
  /** FEFO 率 0..1 */
  fefo: number;
  /** 全房间物资堆数 */
  stacks: number;
  /** 已"整整齐齐"的货架 id（FEFO 达标 + 分区接收全部物资） */
  tidyShelfIds: string[];
}

/** 单架是否"整整齐齐"：按到期日排好，且架上每件物资都被它所属分区接收 */
export function isShelfTidy(shelf: Shelf, zones: readonly Zone[]): boolean {
  if (!isShelfFEFO(shelf)) return false;
  const zone = findZone(zones, shelf.zoneId);
  if (!zone) return false;
  for (const pos of readingOrder(shelf)) {
    const stack = getStack(shelf, pos);
    if (!stack) continue;
    if (!zoneAccepts(zone, getItemDef(stack.itemId))) return false;
  }
  return true;
}

export function computeOrganizeScore(shelves: readonly Shelf[], zones: readonly Zone[]): OrganizeScore {
  return {
    placement: placementRate(shelves, zones),
    fefo: fefoRate(shelves),
    stacks: shelves.reduce((sum, s) => sum + countStacks(s), 0),
    tidyShelfIds: shelves.filter((s) => isShelfTidy(s, zones)).map((s) => s.id)
  };
}

/** 0..1 → 0..100 整数，用于日报与结算界面 */
export function toPercent(ratio: number): number {
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

export function gradeLabel(ratio: number): string {
  const p = toPercent(ratio);
  if (p >= 100) return '整整齐齐';
  if (p >= 80) return '有条不紊';
  if (p >= 50) return '凑合能用';
  if (p > 0) return '翻箱倒柜';
  return '无从下手';
}
