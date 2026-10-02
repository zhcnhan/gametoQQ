/**
 * 开局装配（纯逻辑，禁止 DOM）。
 *
 * M1 起本文件只负责两件事：
 *  1. "一局开始时长什么样"—— 一间房 + 3 货架 + 3 箱刚送到的货（`createStartingRun` 停在 prologue）；
 *  2. 物资的随机生成原语 —— 箱内内容与批次到期日，供采购系统复用（同一个 seed 开出同一箱）。
 * 身份 / 灾难 / 日历 / 每日库存都不在这里，它们在 data/ 与 systems/phases.ts。
 */
import { BOX_DEFS, type BoxDef } from '../data/boxes';
import { FIRST_STOCKPILE_DAY, M1_DISASTER_ID } from '../data/disaster';
import { getItemDef } from '../data/items';
import { EMPTY_SURVIVAL_SNAPSHOT, NEVER_TRADED } from '../data/survival';
import { createCursor, nextFloat, nextInt, pick, randomSeed, shuffle, type RngCursor } from '../model/rng';
import { createShelf, makeStack, ROOM_ID, SHELF_H, SHELF_W } from '../model/shelf';
import type { EventHistory, ItemStack, RunState, Shelf, UnpackBox } from '../model/types';

export const STARTING_SHELF_COUNT = 3;
/** 事件近期记录留几条（与 `EVENT_HISTORY_KEEP` 同值，这里再导一次方便 data 层引用） */
const KEEP = 4;
export const STARTING_BOX_COUNT = 3;
export const SHELF_IDS = ['shelf_a', 'shelf_b', 'shelf_c'] as const;

/**
 * 开局的三块家具。
 *
 * DEFERRED(D-08): §8 写的是「2 房间 × 3 货架（6×4 格）+ 冰箱 1 个」，这里只有
 *   **1 个房间、3 块家具**（两块货架 + 一块冰箱）。空间压力因此比策划案小
 *   （72 格 vs 策划案意图），7 天采购下来大约装到 8 成 —— 还没到"放不下"的紧张感。
 *   要不要按 §8 扩到 2 房间，取决于生存期是否需要一个"货架不够用"的决策点。
 *
 * DEFERRED(D-02): 第三块的 kind='fridge' 目前**只影响它显示成"冰箱 C"**，
 *   没有任何玩法效果（§8 说的"腐坏减速"要等阶段 C，且要等 M3 的灾难才真正吃紧）。
 */
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
export function generateBoxStacks(cursor: RngCursor, def: BoxDef, dayRef = 0): ItemStack[] {
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
    out.push(makeStack(itemId, splitAt, rollExpiry(cursor, itemId, dayRef)));
    if (splitAt < count) out.push(makeStack(itemId, count - splitAt, rollExpiry(cursor, itemId, dayRef)));
  }
  // 奢侈品是**额外**的一抽，不占上面那些名额（M2，§12 拍板 v0.9）。
  // 放在最后掷的理由：这样"这一箱有几件正经货"与"有没有开到好东西"是两件独立的事，
  // 玩家拆到箱底那一下的期待才是纯粹的 —— 而不是"少了一件罐头换来的"。
  const luxury = rollLuxury(cursor, def, dayRef);
  if (luxury) out.push(luxury);
  return out;
}

/**
 * 这一箱有没有开出奢侈品（M2）。没有 `luxuryChance` 的箱型直接返回 null，**不消耗 RNG**。
 *
 * 不消耗那一次掷很要紧：`box_staple` / `box_medical` 是玩家按品类买的确定性商品，
 * 它们不该因为"表里没有奢侈品"而在 RNG 流里留下一个空位 ——
 * 那会让同 seed 下粮油箱的内容随着"混合箱的奢侈品概率"变化而变化。
 */
function rollLuxury(cursor: RngCursor, def: BoxDef, dayRef: number): ItemStack | null {
  const chance = def.luxuryChance ?? 0;
  const pool = def.luxuryPool ?? [];
  if (chance <= 0 || pool.length === 0) return null;
  if (nextFloat(cursor) >= chance) return null;
  const itemId = pick(cursor, pool);
  // 每次只开出一件：多件会让"开出一件好东西"这件事贬值
  return makeStack(itemId, 1, rollExpiry(cursor, itemId, dayRef));
}

/**
 * @param dayRef 批次到期日的起算天。M1 传当前天（囤货期为负），
 *   这样 D-7 买的罐头和 D-1 买的会差出好几天 —— 否则 FEFO 根本没有可排的东西（§5 引擎④）。
 */
export function createStartingBoxes(
  cursor: RngCursor,
  count: number = STARTING_BOX_COUNT,
  dayRef = 0
): UnpackBox[] {
  const boxes: UnpackBox[] = [];
  for (let i = 0; i < count; i++) {
    const def = boxDefAt(i);
    boxes.push({ id: `box_${i + 1}`, defId: def.id, items: generateBoxStacks(cursor, def, dayRef) });
  }
  return boxes;
}

/**
 * 开新局：**停在 prologue**（§9.1 开局界面）。
 *
 * 身份与现金都还是空的，等玩家在开局页点完身份卡，由 `systems/phases.ts` 的
 * `chooseIdentity()` 一次性填上并推进到囤货期第一天。这样"选身份"也是一个原子存档点。
 *
 * seed 落盘策略：存的是"已经用掉的游标值"，后续任何随机（点位库存、事件抽取）
 * 都从这个游标继续走，于是同档同序。
 */
export function createStartingRun(seed: number = randomSeed()): RunState {
  const cursor = createCursor(seed);
  const run: RunState = {
    phase: 'prologue',
    day: FIRST_STOCKPILE_DAY,
    identityId: '',
    disasterId: M1_DISASTER_ID,
    cash: 0,
    shelves: createStartingShelves(),
    zones: [],
    // 重生前家里就有的三箱货（§4.1 第0段"重生开局"）—— 不让玩家对着空货架开场
    boxesToUnpack: createStartingBoxes(cursor, STARTING_BOX_COUNT, FIRST_STOCKPILE_DAY),
    stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
    trust: {},
    deliveredOrders: 0,
    log: [],
    seed: cursor.state,
    actionPoints: 0,
    carLoad: 0,
    shopStocks: [],
    visitedShopIds: [],
    currentShopId: null,
    // M2：开局还没有白天事件。物价倍率给 1，真正的当日价由 chooseIdentity /
    // 换天时的 rollDaySetup 按"那一天"的倍率算进 line.price（见 systems/shop.ts）
    shopPriceFactor: 1,
    shopLimits: [],
    shopBoughtToday: {},
    dayEvent: null,
    eventHistory: emptyEventHistory(),
    night: null,
    helpRequest: null,
    survival: {
      spoiled: 0,
      shortageDays: 0,
      shortagePieces: 0,
      unreachablePieces: 0,
      hardPressDays: 0,
      hardPressStreak: 0,
      safeStreak: 0,
      lastTradeDay: NEVER_TRADED,
      last: { ...EMPTY_SURVIVAL_SNAPSHOT }
    },
    outcome: null,
    metaSettled: null
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

/**
 * 把一条刚抽中的事件记进"近期记录"（`RunState.eventHistory`），最新在前、只留几条。
 *
 * 它服务的是 M2 走测反馈里那条"重复"：求援订单池只有 6 单，
 * 而每次都是均匀随机 —— 同一个 NPC 前后两次问同一件事的概率是 50%。
 * 记下最近出过的，抽签时把它们的权重压低（见 `model/rng.ts` 的 `pickEventAvoidingRecent`）。
 *
 * 放在 setup.ts 是因为它是**纯记账**，不属于任何一个事件池；
 * 三个抽签点（夜间 / 求援 / 白天）都要用它，各写一份必然漂。
 */
export function recordEvent(run: RunState, kind: keyof EventHistory, eventId: string): void {
  const next = [eventId, ...run.eventHistory[kind].filter((id) => id !== eventId)];
  run.eventHistory[kind] = next.slice(0, KEEP);
}

/** 空的事件记录（开新局与老档迁移都用它） */
export function emptyEventHistory(): EventHistory {
  return { night: [], help: [], day: [], emergency: [] };
}

export { createCursor };
