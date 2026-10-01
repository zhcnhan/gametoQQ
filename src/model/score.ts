/**
 * 整理品质评分（策划案 §6.3 的三个可量化维度）。
 *
 * 三个维度问的是三个不同的问题，缺一个，"整理即战力"就有一块够不着：
 *   归位率   —— 你摆好了多少（东西在不在自己划的区里）
 *   临期优先 —— 你排好了多少（同一架上快到期的有没有靠前）
 *   应急可达 —— 急用的那些，在不在伸手就够得到的地方
 *
 * 纯逻辑，可单测。
 */
import { getItemDef } from '../data/items';
import { countCategory } from './consume';
import {
  countOnHandy,
  countStacks,
  fefoRate,
  findZone,
  getStack,
  isShelfFEFO,
  placementRate,
  readingOrder,
  zoneListedFor
} from './shelf';
import type { CategoryId, DisasterProfile, Shelf, UnpackBox, Zone } from './types';

export interface OrganizeScore {
  /** 归位率 0..1 */
  placement: number;
  /** FEFO 率 0..1 */
  fefo: number;
  /** 应急可达率 0..1（§6.3 第三维，M1 阶段 F 补齐） */
  emergency: number;
  /** 全房间物资堆数 */
  stacks: number;
  /** 已"整整齐齐"的货架 id（FEFO 达标 + 分区接收全部物资） */
  tidyShelfIds: string[];
}

/**
 * 单架是否"整整齐齐"：按到期日排好，且架上每件物资都被它所属分区**明确接收**。
 *
 * "明确接收"用的是 `zoneListedFor`（§12 v0.8 归位率修复），与归位率同一把尺子：
 * 一块贴了空清单的货架既不算归位、也不该拿到"整整齐齐"的徽章 ——
 * 两处判定只要不一致，玩家就会看到"归位率 0% 但整整齐齐"这种自相矛盾的屏幕。
 */
export function isShelfTidy(shelf: Shelf, zones: readonly Zone[]): boolean {
  if (!isShelfFEFO(shelf)) return false;
  const zone = findZone(zones, shelf.zoneId);
  if (!zone) return false;
  for (const pos of readingOrder(shelf)) {
    const stack = getStack(shelf, pos);
    if (!stack) continue;
    if (!zoneListedFor(zone, getItemDef(stack.itemId))) return false;
  }
  return true;
}

/**
 * 什么算"应急物资"：该灾难的刚需 ∪ 急救品。
 *
 * 为什么不写死"急救品"：§5 说的是「应急货架（门口/最顺手位）放**急救品**」，
 * 但"什么算应急"是随灾难变的 —— 寒潮那天，一罐燃料比一卷绷带更救命
 * （炉子灭了是真的会出人命）。所以它跟着 `priorityCategories` 走，而不是写一张死表。
 */
export function emergencyCategories(disaster: DisasterProfile): CategoryId[] {
  return [...new Set<CategoryId>([...disaster.priorityCategories, 'medicine'])];
}

/**
 * 应急可达率：**该灾难的应急物资里，有多大比例放在顺手位上。**
 *
 * 分母算的是**全屋**（含还没拆的纸箱）—— 躺在纸箱底下的那卷绷带当然不在顺手位，
 * 它要翻。这和归位率的分母是同一个道理：纸箱里的东西是"还没安顿好"的。
 *
 * 屋里压根没有应急物资时返回 1（同 `placementRate` 的宽容规则）：
 * 手上没药，不该被判成"没放好"。
 */
export function emergencyRate(
  shelves: readonly Shelf[],
  boxes: readonly UnpackBox[],
  disaster: DisasterProfile
): number {
  let handy = 0;
  let total = 0;
  for (const category of emergencyCategories(disaster)) {
    handy += countOnHandy(shelves, category);
    total += countCategory(shelves, boxes, category);
  }
  return total === 0 ? 1 : handy / total;
}

/**
 * @param disaster 必填，不能省。少了它 `emergency` 只能编一个 1 出来，
 *   而那个假满分会被印到结算页上，也会漏进生存期结算 —— 宁可让调用点多写一个参数。
 */
export function computeOrganizeScore(
  shelves: readonly Shelf[],
  zones: readonly Zone[],
  boxes: readonly UnpackBox[],
  disaster: DisasterProfile
): OrganizeScore {
  return {
    // 归位率的分母包含还没拆的纸箱 —— 见 model/shelf.ts 的 placementRate
    placement: placementRate(shelves, zones, boxes),
    fefo: fefoRate(shelves),
    emergency: emergencyRate(shelves, boxes, disaster),
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
