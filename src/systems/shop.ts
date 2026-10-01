/**
 * 采购系统（§6.2 扫货 = 爽点② 的载体）。
 *
 * systems/ 层纪律：不碰任何浏览器 API；唯一副作用是 store.commit()（改状态 + 落盘），
 * 手感由返回的 ShopEvent 描述，交给 ui/ 与 fx/ 去演。
 *
 * 三约束落地口径（按已拍板的分工，§6.2）：
 *   现金 cash            —— 总预算，扣了就没了
 *   负重 carryLimit      —— **单趟**上限：购物篮一次搬上车的重量天花板，超了得先"搬一趟"
 *   车载 vehicleCapacity —— **当天累计**上限：一天跑几家店加起来能带回家的总重量
 *
 * 分趟刻意不扣行动点：行动点的语义是"进几家店门"（1 点 = 一个点位），
 * 若再拿它扣分趟，"1 点 = 一个点位"当场失效。
 */
import { getBoxDef } from '../data/boxes';
import { getIdentityDef } from '../data/identities';
import { getItemDef } from '../data/items';
import { SHOP_DEFS, getShopDef } from '../data/shops';
import { dayLabel } from '../model/calendar';
import { createCursor, nextInt, type RngCursor } from '../model/rng';
import { makeStack } from '../model/shelf';
import type {
  IdentityDef,
  ItemDef,
  ItemStack,
  RunState,
  ShopDayStock,
  ShopDef,
  UnpackBox
} from '../model/types';
import type { GameStore } from '../state/store';
import { nextBoxSeq, rollExpiry } from './setup';

// ———————— 事件（表现层的唯一输入） ————————

export type ShopEvent =
  | { type: 'enteredShop'; shopId: string }
  /** 从货架前退回点位列表（不动行动点、不动库存） */
  | { type: 'leftShop' }
  /** 一趟货搬上了车：一箱进待拆队列（引擎③ 拆箱惊喜） */
  | { type: 'loaded'; boxId: string; boxName: string; pieces: number; weight: number; cost: number }
  | { type: 'rejected'; reason: string };

export interface ShopResult {
  ok: boolean;
  events: ShopEvent[];
}

function reject(reason: string): ShopResult {
  return { ok: false, events: [{ type: 'rejected', reason }] };
}

function ok(events: ShopEvent[]): ShopResult {
  return { ok: true, events };
}

// ———————— 纯逻辑：价格 / 库存 / 购物车 ————————

/** kg 保留两位：0.12kg 的泡面 × 5 累加会出现 0.6000000000000001，界面上很难看 */
export function roundKg(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 当天单价 = 基准价 × 点位系数 × 身份折扣。
 * 折扣只按"品类"打折（§7 的 perk 例子就是"燃料价格 -20%"），不做逐件特例 ——
 * 规则越少，玩家越容易在脑子里算清这笔账，这才是"规划乐趣"。
 */
export function priceOf(item: ItemDef, shop: ShopDef, identity: IdentityDef): number {
  let price = item.basePrice * shop.priceFactor;
  const rule = identity.perkRule;
  if (rule.kind === 'categoryDiscount' && rule.categories.includes(item.category)) {
    price *= 1 - rule.rate;
  }
  return Math.max(1, Math.round(price));
}

/**
 * 生成"某一天"的全部点位库存。
 * 种子化：库存基数 ±1 抖动，抖动顺序 = 静态表里点位与商品的声明顺序（绝不依赖 Map 遍历顺序）。
 */
export function rollShopStocks(identity: IdentityDef, cursor: RngCursor, day: number): ShopDayStock[] {
  return SHOP_DEFS.map((shop) => ({
    shopId: shop.id,
    day,
    lines: shop.offers.map((offer) => {
      const item = getItemDef(offer.itemId);
      return {
        itemId: offer.itemId,
        price: priceOf(item, shop, identity),
        stock: Math.max(1, offer.stock + nextInt(cursor, -1, 1))
      };
    })
  }));
}

export function findShopStock(run: RunState, shopId: string): ShopDayStock | null {
  return run.shopStocks.find((s) => s.shopId === shopId) ?? null;
}

/** 购物篮里的一行（ui 只读视图，不含任何"能不能买"的判断） */
export interface CartLineView {
  itemId: string;
  count: number;
  unitPrice: number;
  lineCost: number;
  unitWeight: number;
  lineWeight: number;
  /** 这家店还剩几件（用于 UI 限制加号） */
  stock: number;
}

export interface CartView {
  lines: CartLineView[];
  cost: number;
  weight: number;
  pieces: number;
  cash: number;
  cashLeft: number;
  carryLimit: number;
  /** 今天已经搬上车的重量 */
  carLoad: number;
  vehicleCapacity: number;
  /** 车还剩多少 kg */
  capacityLeft: number;
  /**
   * 提示（**不阻断**）：例如"只剩 9 件，先按这些算"。
   * 与 problems 分开是必须的 —— 库存被截断不该让"搬上车"按钮变灰，
   * 否则玩家点满一车轻货时会莫名其妙永远搬不动（这是 v1 实现踩过的坑）。
   */
  notes: string[];
  /** 阻断项（钱不够 / 超负重 / 超车载 / 空篮子）；空数组 = 可以搬上车 */
  problems: string[];
  canLoad: boolean;
}

export interface CartLine {
  itemId: string;
  count: number;
}

/**
 * 购物车视图 + 三约束体检。纯函数，ui 直接用它的结果渲染按钮状态与提示文案 ——
 * 玩家在点下"搬回车上"之前就该知道自己超了哪一条（§5 引擎②：每个动作都被接住）。
 */
export function buildCartView(run: RunState, shopId: string, lines: readonly CartLine[]): CartView | null {
  const stock = findShopStock(run, shopId);
  if (!stock) return null;
  const identity = identityOf(run);
  if (!identity) return null;

  const carryLimit = identity.carryLimit;
  const vehicleCapacity = identity.vehicleCapacity;
  const capacityLeft = roundKg(Math.max(0, vehicleCapacity - run.carLoad));

  const views: CartLineView[] = [];
  const notes: string[] = [];
  const problems: string[] = [];
  let cost = 0;
  let weight = 0;
  let pieces = 0;

  for (const line of lines) {
    if (line.count <= 0) continue;
    const sku = stock.lines.find((l) => l.itemId === line.itemId);
    const item = getItemDef(line.itemId);
    if (!sku) {
      problems.push(`${item.name}：这家店没有`);
      continue;
    }
    if (sku.stock <= 0) {
      problems.push(`${item.name}：今天卖完了`);
      continue;
    }
    const count = Math.min(line.count, sku.stock);
    if (count < line.count) notes.push(`${item.name}：只剩 ${sku.stock} 件，先按这些算`);
    const lineCost = sku.price * count;
    const lineWeight = roundKg(item.unitWeight * count);
    views.push({
      itemId: line.itemId,
      count,
      unitPrice: sku.price,
      lineCost,
      unitWeight: item.unitWeight,
      lineWeight,
      stock: sku.stock
    });
    cost += lineCost;
    weight += lineWeight;
    pieces += count;
  }

  weight = roundKg(weight);
  if (views.length === 0) {
    problems.push('购物篮是空的');
  } else {
    if (cost > run.cash) problems.push(`钱不够，还差 ${cost - run.cash} 元`);
    if (weight > carryLimit) problems.push(`一趟拿不了 ${weight}kg，一次最多 ${carryLimit}kg`);
    if (weight > capacityLeft) problems.push(`车装不下了，今天还能再装 ${capacityLeft}kg`);
  }

  return {
    lines: views,
    cost,
    weight,
    pieces,
    cash: run.cash,
    cashLeft: Math.max(0, run.cash - cost),
    carryLimit,
    carLoad: run.carLoad,
    vehicleCapacity,
    capacityLeft,
    notes,
    problems,
    canLoad: views.length > 0 && problems.length === 0
  };
}

/** prologue 阶段 identityId 还是空字符串，这里必须能安全返回 null（不能抛） */
function identityOf(run: RunState): IdentityDef | null {
  if (!run.identityId) return null;
  try {
    return getIdentityDef(run.identityId);
  } catch {
    return null;
  }
}

// ———————— 命令 ————————

/** 进一个店门：消耗 1 行动点（同一天再进一次也允许，但很浪费 —— 库存不会自己补） */
export function enterShop(store: GameStore, shopId: string): ShopResult {
  const run = store.run;
  if (run.phase !== 'stockpile_shop') return reject('现在不是在外面的时候');
  if (!SHOP_DEFS.some((s) => s.id === shopId)) return reject('没有这个点位');
  if (run.actionPoints <= 0) return reject('今天的行动点用完了');
  if (run.carLoad >= identityLimitOf(run)) return reject('车已经装满了，先回家卸货');

  const firstTime = !run.visitedShopIds.includes(shopId);
  store.commit((draft) => {
    draft.actionPoints -= 1;
    draft.currentShopId = shopId;
    if (!draft.visitedShopIds.includes(shopId)) draft.visitedShopIds.push(shopId);
    if (firstTime) {
      draft.log.push(`${dayLabel(draft.day)} · 进了${getShopDef(shopId).name}。`);
    }
  });
  return ok([{ type: 'enteredShop', shopId }]);
}

/** 从货架前退回点位列表。刻意不做"退回也要花行动点"这种设计 —— 看一圈不买是玩家的权利 */
export function leaveShop(store: GameStore): ShopResult {
  const run = store.run;
  if (run.phase !== 'stockpile_shop') return reject('现在不在外面');
  if (run.currentShopId === null) return ok([]);
  store.commit((draft) => {
    draft.currentShopId = null;
  });
  return ok([{ type: 'leftShop' }]);
}

/**
 * 把这一趟货搬回车上（= 提交购物篮）。
 * 成功的定义是三约束全过：钱够 / 单趟不超负重 / 当天累计不超车载。
 * 成功后立刻打包成一箱进入待拆队列 —— §6.2「打包箱制」与引擎③「拆箱惊喜」在这里接上。
 */
export function buyCart(store: GameStore, shopId: string, lines: readonly CartLine[]): ShopResult {
  const run = store.run;
  if (run.phase !== 'stockpile_shop') return reject('现在不是在外面的时候');

  const view = buildCartView(run, shopId, lines);
  if (!view) return reject('这个点位今天没有货');
  const firstProblem = view.problems[0];
  if (firstProblem !== undefined) return reject(firstProblem);

  const boxDefId = pickBoxDefId(view.lines);
  const boxDef = getBoxDef(boxDefId);
  const boxId = `box_${nextBoxSeq(run.boxesToUnpack)}`;

  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    const stock = draft.shopStocks.find((s) => s.shopId === shopId);
    if (stock) {
      for (const line of view.lines) {
        const sku = stock.lines.find((l) => l.itemId === line.itemId);
        if (sku) sku.stock = Math.max(0, sku.stock - line.count);
      }
    }
    // 批次到期日以"当前天"为基准：D-7 买的和 D-1 买的会差出好几天，FEFO 才排得出意义（§5 引擎④）
    const items: ItemStack[] = view.lines.map((line) =>
      makeStack(line.itemId, line.count, rollExpiry(cursor, line.itemId, draft.day))
    );
    const box: UnpackBox = { id: boxId, defId: boxDefId, items };
    draft.boxesToUnpack.push(box);
    draft.cash -= view.cost;
    draft.carLoad = roundKg(draft.carLoad + view.weight);
    draft.seed = cursor.state;
    draft.log.push(
      `${dayLabel(draft.day)} · 在${getShopDef(shopId).name}花了 ${view.cost} 元，${view.pieces} 件装成一箱（${view.weight}kg）。`
    );
  });

  return ok([
    { type: 'loaded', boxId, boxName: boxDef.name, pieces: view.pieces, weight: view.weight, cost: view.cost }
  ]);
}

/**
 * 这一趟的箱型：按买到的东西自动挑，不让玩家再选一次。
 * §5 引擎②「慷慨的手感」—— 采购的动作已经够多了，装箱是系统该做的家务。
 */
export function pickBoxDefId(lines: readonly CartLineView[]): string {
  const cats = new Set(lines.map((l) => getItemDef(l.itemId).category));
  const allFoodish = [...cats].every((c) => c === 'food' || c === 'water');
  const allMedicine = [...cats].every((c) => c === 'medicine');
  if (allFoodish) return 'box_staple';
  if (allMedicine) return 'box_medical';
  return 'box_mixed';
}

function identityLimitOf(run: RunState): number {
  const identity = identityOf(run);
  return identity ? identity.vehicleCapacity : Number.POSITIVE_INFINITY;
}
