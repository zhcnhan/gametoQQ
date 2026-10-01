/**
 * 开局装配（纯逻辑，禁止 DOM）。
 * M0 只做"一间房 + 3 货架 + 3 箱待拆物资"，采购 / 身份 / 灾难全部留到 M1。
 */
import { BOX_DEFS, type BoxDef } from '../data/boxes';
import { getItemDef } from '../data/items';
import { createCursor, nextInt, randomSeed, shuffle, type RngCursor } from '../model/rng';
import { createShelf, makeStack, ROOM_ID, SHELF_H, SHELF_W } from '../model/shelf';
import type { ItemStack, RunState, Shelf, UnpackBox } from '../model/types';

export const STARTING_SHELF_COUNT = 3;
export const STARTING_BOX_COUNT = 3;
export const SHELF_IDS = ['shelf_a', 'shelf_b', 'shelf_c'] as const;

export function createStartingShelves(roomId: string = ROOM_ID): Shelf[] {
  const kinds: Shelf['kind'][] = ['shelf', 'shelf', 'fridge'];
  return SHELF_IDS.slice(0, STARTING_SHELF_COUNT).map((id, i) =>
    createShelf(id, roomId, kinds[i] ?? 'shelf', SHELF_W, SHELF_H, null)
  );
}

export function boxDefAt(index: number): BoxDef {
  const def = BOX_DEFS[index];
  if (!def) throw new Error(`没有第 ${index + 1} 号箱型的定义`);
  return def;
}

/** 批次到期日：保质期 ±12% 抖动。不易腐返回 null（= 永不到期，FEFO 时排最后） */
export function rollExpiry(cursor: RngCursor, itemId: string, dayRef = 0): number | null {
  const def = getItemDef(itemId);
  if (!def.perishable || !def.shelfLifeDays) return null;
  const jitter = Math.max(1, Math.round(def.shelfLifeDays * 0.12));
  return dayRef + def.shelfLifeDays + nextInt(cursor, -jitter, jitter);
}

/**
 * 拆箱引擎③：一箱里摸出的东西是"一件一件"的堆栈。
 * 同一种物资超过 2 件时有概率拆成两个批次 —— 拆箱时能亲眼看到保质期不一样，
 * 后面的 FEFO 排序才有得排（否则玩家没有理由用排序按钮）。
 */
export function generateBoxStacks(cursor: RngCursor, def: BoxDef): ItemStack[] {
  const itemCount = nextInt(cursor, def.minItems, def.maxItems);
  const pool = shuffle(cursor, def.pool);
  const out: ItemStack[] = [];
  for (let i = 0; i < itemCount; i++) {
    const itemId = pool[i % pool.length];
    if (!itemId) break;
    const item = getItemDef(itemId);
    const maxPer = Math.max(1, Math.min(def.maxCountPerItem, item.stackLimit));
    const count = nextInt(cursor, 1, maxPer);
    const canSplit = item.perishable && count > 2;
    const splitAt = canSplit && nextInt(cursor, 0, 1) === 1 ? Math.floor(count / 2) : count;
    out.push(makeStack(itemId, splitAt, rollExpiry(cursor, itemId)));
    if (splitAt < count) out.push(makeStack(itemId, count - splitAt, rollExpiry(cursor, itemId)));
  }
  return out;
}

export function createStartingBoxes(cursor: RngCursor, count: number = STARTING_BOX_COUNT): UnpackBox[] {
  const boxes: UnpackBox[] = [];
  for (let i = 0; i < count; i++) {
    const def = boxDefAt(i);
    boxes.push({ id: `box_${i + 1}`, defId: def.id, items: generateBoxStacks(cursor, def) });
  }
  return boxes;
}

/**
 * 开新局。
 * seed 落盘策略：存的是"已经用掉的游标值"，后续任何随机（M1 的商店库存、事件抽取）
 * 都从这个游标继续走，于是同档同序。
 */
export function createStartingRun(seed: number = randomSeed()): RunState {
  const cursor = createCursor(seed);
  const run: RunState = {
    // PLACEHOLDER: M0 没有状态机，直接落在整理页；M1 换成 prologue → stockpile_shop ⇄ organize
    phase: 'organize',
    day: 0,
    identityId: 'default',
    disasterId: 'cold_snap',
    cash: 0,
    shelves: createStartingShelves(),
    zones: [],
    boxesToUnpack: createStartingBoxes(cursor),
    stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
    trust: {},
    deliveredOrders: 0,
    log: [],
    seed: cursor.state
  };
  return run;
}

/** 箱子正面的手写标签：有箱型定义就用定义里的，没有就按里面的头一件自己编 */
export function boxLabel(box: UnpackBox): string {
  if (box.items.length === 0) return '空箱';
  const def = BOX_DEFS.find((b) => b.id === box.defId);
  if (def) return def.name;
  const first = box.items[0];
  return first ? `${getItemDef(first.itemId).name} 一箱` : '没写标签的箱';
}

/** 箱内序号：整局唯一（'box_1' / 'box_stray_3'），空箱被摘掉也不会让别的箱串位 */
export function nextBoxSeq(boxes: readonly UnpackBox[]): number {
  let max = 0;
  for (const box of boxes) {
    const m = /(\d+)$/.exec(box.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export { createCursor };
