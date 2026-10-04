/**
 * 腐坏推进（§5 引擎④「对齐的快感」的对手方）。
 *
 * **核心立场（已拍板）：腐坏是灾难的属性，不是物资的属性。**
 * 所以这个文件不读 `ItemDef.shelfLifeDays` 来决定"多久坏"，只做一件事：
 * 把玩家的"日历天"换算成**虚拟天**，再拿去和批次的绝对到期日比。
 *
 *   virtualDay(day) = day <= 0 ? day : day × spoilRate
 *
 *   · `spoilRate = 1`   → 虚拟天 = 真实天，保质期如实推进
 *   · `spoilRate > 1`   → 热浪 / 洪水 / 疫情：虚拟天跑得比真实天快，东西提前坏
 *   · `spoilRate < 1`   → 寒潮：虚拟天跑得慢，等于全屋都成了冷库（M1 就是这一档）
 *
 * 这个换算是**收敛的**：它不改任何批次的 `expiresAtDay`，所以物资搬来搬去、
 * 刷新读档都不会累积误差，也不会出现"搬进冰箱再搬出来保质期变了"这种脏状态。
 *
 * ★ **冰箱就接在这个倍率上**（M3 第 6 步）：文件头原来写着"将来要接的话，
 * 接在这个函数的倍率上，而不是去改写批次" —— 落地时正是这么做的，
 * 只不过倍率不是全局一个数，而是**每个容器各算各的**（见 `spoilEverything`）。
 * 那条"不改批次"的性质因此更重要了：同一堆东西从纸箱搬进冰箱，
 * 它的 `expiresAtDay` 一个字节都没动，变的只是**拿什么虚拟天去比**。
 *
 * model/ 层纪律：纯函数，不碰任何浏览器 API。
 */
import { spoilFactorOf } from '../data/furniture';
import { getItemDef } from '../data/items';
import { cloneShelf, getStack, readingOrder, setSlotStack } from './shelf';
import type { ItemBatch, ItemStack, Shelf } from './types';

/** 把日历天换算成"腐坏意义上的天"。见文件头的公式 */
export function virtualDay(day: number, spoilRate: number): number {
  return day <= 0 ? day : day * spoilRate;
}

/** 这个批次在虚拟第 `vDay` 天是否已经坏了。不易腐（expiresAtDay === null）永远不坏 */
export function isBatchSpoiled(batch: ItemBatch, vDay: number): boolean {
  return batch.expiresAtDay !== null && batch.expiresAtDay <= vDay;
}

export interface SpoilLoss {
  itemId: string;
  count: number;
}

export interface SpoilResult {
  /** 清完之后仍然可用的堆（原地过滤过批次，不易腐的照旧） */
  stack: ItemStack | null;
  /** 这一堆坏掉了多少件 */
  lost: number;
}

/** 单堆的腐坏结算：坏掉的批次直接扣掉，返回剩下的 */
export function spoilStack(stack: ItemStack, vDay: number): SpoilResult {
  let lost = 0;
  const kept: ItemBatch[] = [];
  for (const batch of stack.batches) {
    if (isBatchSpoiled(batch, vDay)) {
      lost += batch.count;
      continue;
    }
    kept.push({ ...batch });
  }
  if (lost === 0) return { stack, lost: 0 };
  if (kept.length === 0) return { stack: null, lost };
  return { stack: { itemId: stack.itemId, batches: kept }, lost };
}

/** 货架上是否还有任何一件会腐坏的东西（没有的话整局都不用算腐坏，提前退出） */
export function hasPerishable(items: readonly ItemStack[]): boolean {
  return items.some((stack) => getItemDef(stack.itemId).perishable);
}

export interface SpoilSweep {
  shelves: Shelf[];
  boxes: { id: string; defId: string; items: ItemStack[] }[];
  losses: SpoilLoss[];
  total: number;
}

/**
 * 全屋腐坏结算：**货架 + 还没拆的纸箱一起算**。
 *
 * 为什么纸箱里的也要坏：§6.3 的整理之所以有意义，前提是"不整理会付出代价"。
 * 如果囤回来的箱子永远不会坏，玩家就没有理由拆箱 —— 那会把整个「整理」的动机抽掉。
 * 纸箱不是冰箱。
 *
 * ## ★ 家具在这里第一次真的起作用（D-02 清偿）
 *
 * 原来是"全屋一个 `vDay`"，而那个数由**灾难的 `spoilRate`** 算出 ——
 * 于是"这一件放在冰箱里还是纸箱里"**在架构上就问不出来**。
 * 这正是冰箱从 M1 起就没有玩法效果的根本原因（不是忘了接，是**没地方接**）。
 *
 * 现在每个容器**各算各的虚拟天**：
 *
 * ```
 * vDay_容器 = virtualDay(day, 灾难.spoilRate × 家具.spoilFactor)
 * ```
 *
 *  · **货架** → 按自家 `kind` 的乘数（冰箱 0.4 / 柜子 0.75 / 普通 1）；
 *  · **纸箱** → 固定 1（"纸箱不是冰箱"这句话在代码里就是这个 1）。
 *
 * @param shelves 全部家具
 * @param boxes 还没拆的纸箱
 * @param day **真实天**（不是虚拟天 —— 虚拟天从这里才算得出来）
 * @param disasterSpoilRate 这一场灾难的 `spoilRate`
 */
export function spoilEverything(
  shelves: readonly Shelf[],
  boxes: readonly { id: string; defId: string; items: ItemStack[] }[],
  day: number,
  disasterSpoilRate: number
): SpoilSweep {
  const tally = new Map<string, number>();
  const add = (itemId: string, count: number): void => {
    if (count <= 0) return;
    tally.set(itemId, (tally.get(itemId) ?? 0) + count);
  };

  const nextShelves = shelves.map((shelf) => {
    // ★ 这一块自己的虚拟天：灾难的倍率 × 这一种家具的乘数
    const vDay = virtualDay(day, disasterSpoilRate * spoilFactorOf(shelf.kind));
    let next = cloneShelf(shelf);
    for (const pos of readingOrder(next)) {
      const stack = getStack(next, pos);
      if (!stack) continue;
      const result = spoilStack(stack, vDay);
      if (result.lost === 0) continue;
      add(stack.itemId, result.lost);
      next = setSlotStack(next, pos, result.stack);
    }
    return next;
  });

  // 纸箱的虚拟天：**没有家具保护**，就是灾难的倍率本身
  const boxVDay = virtualDay(day, disasterSpoilRate);
  const nextBoxes = boxes.map((box) => {
    const items: ItemStack[] = [];
    for (const stack of box.items) {
      const result = spoilStack(stack, boxVDay);
      if (result.lost > 0) add(stack.itemId, result.lost);
      if (result.stack) items.push(result.stack);
    }
    return { id: box.id, defId: box.defId, items };
  });

  const losses: SpoilLoss[] = [...tally.entries()].map(([itemId, count]) => ({ itemId, count }));
  return {
    shelves: nextShelves,
    boxes: nextBoxes,
    losses,
    total: losses.reduce((sum, l) => sum + l.count, 0)
  };
}
