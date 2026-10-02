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
 *
 * D-10 已清偿（M2）：§6.2 的「随机事件：物价波动、限购、插队大妈、黑市商人」
 * 现在落在 `enterShop` 之前：进店那一下用当前 seed 游标判定"这家店今天有没有事"，
 * 事件本体在 `data/dayEvents.ts`，判定与落账在本文件下半部分。
 * 「物价波动」走的是另一条路（它没得选，见 `data/dayEvents.ts` 的 `dayPriceFactor`）。
 */
import { BOX_DEFS, getBoxDef, type BoxDef } from '../data/boxes';
import { DAY_EVENT_DEFS, DAY_EVENT_NONE_WEIGHT, dayEventWeight, dayPriceFactor, findDayEvent } from '../data/dayEvents';
import { getIdentityDef } from '../data/identities';
import { getItemDef } from '../data/items';
import { SHOP_DEFS, actionCostOf, getShopDef } from '../data/shops';
import { disasterModifiersOf } from '../data/disaster';
import { dayLabel } from '../model/calendar';
import { createCursor, nextFloat, nextInt, type RngCursor } from '../model/rng';
import { firstBatchExpiry, makeStack, stackCount } from '../model/shelf';
import type {
  CategoryId,
  DayEffectApplied,
  DayEventDef,
  DayOption,
  DayOptionEffect,
  IdentityDef,
  ItemDef,
  ItemStack,
  RunState,
  ShopDayStock,
  ShopDef,
  ShopLimit,
  UnpackBox
} from '../model/types';
import type { GameStore } from '../state/store';
import { generateBoxStacks, nextBoxSeq, recordEvent, rollExpiry } from './setup';

// ———————— 事件（表现层的唯一输入） ————————

export type ShopEvent =
  | { type: 'enteredShop'; shopId: string }
  /** 从货架前退回点位列表（不动行动点、不动库存） */
  | { type: 'leftShop' }
  /** 一趟货搬上了车：一箱进待拆队列（引擎③ 拆箱惊喜） */
  | { type: 'loaded'; boxId: string; boxName: string; pieces: number; weight: number; cost: number }
  /** 门口出了一件事，日历停在原地等玩家决定（白天事件，§6.2 / D-10） */
  | { type: 'dayEventHit'; defId: string; shopId: string }
  /** 白天事件处理完了（`visitLost` = 这一趟白跑了，界面据此退回点位列表） */
  | { type: 'dayEventResolved'; defId: string; choice: number; summary: string[]; visitLost: boolean }
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
 *
 * ★ M2：`price` 里**烘进了当天的物价倍率**（`data/dayEvents.dayPriceFactor`）。
 * 这样做而不是"每次显示时再乘"的理由：囤货期一个玩家的全部决策都建立在
 * "今天这件多少钱"上，而这个数在一天之内必须**只有一个来源** ——
 * 否则"界面显示 7 元、结账扣 8 元"这种事迟早会发生（`buildCartView` 与 `buyCart`
 * 共用同一份 line.price，同源的代价只有一处）。
 *
 * 事件带来的涨价（`run.shopPriceFactor`）不走这里：它在事件发生**之后**才存在，
 * 所以由 `basePriceOf()` 叠一次。两份倍率各管一段，账在 `basePriceOf` 上合。
 */
export function rollShopStocks(identity: IdentityDef, cursor: RngCursor, day: number, disasterId?: string): ShopDayStock[] {
  const factor = dayPriceFactor(day);
  /*
   * §10B.3.1 的 L2 维度：**商店供应**与**物价加成**。
   *
   *  · `shopSupplyFactor` 直接乘在库存上（大停电 0.5 = 大半货架空着）。
   *    `Math.max(0, ...)` 允许某件货真的变成 0 —— 那正是"断供"的表达，
   *    而 `buildCartView` 本来就会对 `stock <= 0` 报"今天卖完了"。
   *  · `closedShopIds` 让整家店不开门（这一场没电/被淹/被封）。
   *  · `priceSurcharge` 是"这一场本来就贵"，与逐日物价曲线相乘。
   *
   * ★ 乘数走 `disasterModifiersOf`（唯一读点，含默认值与区间夹取）。
   */
  const mods = disasterModifiersOf(disasterId);
  const priceMul = factor * (1 + mods.priceSurcharge);
  return SHOP_DEFS.filter((shop) => !mods.closedShopIds.includes(shop.id)).map((shop) => ({
    shopId: shop.id,
    day,
    lines: shop.offers.map((offer) => {
      const item = getItemDef(offer.itemId);
      const rolled = Math.max(1, offer.stock + nextInt(cursor, -1, 1));
      return {
        itemId: offer.itemId,
        price: Math.max(1, Math.round(priceOf(item, shop, identity) * priceMul)),
        stock: Math.max(0, Math.round(rolled * mods.shopSupplyFactor))
      };
    })
  }));
}

/**
 * 当天的**实际**单价 = 生成时烘进 line.price 的那一份（点位系数 × 身份折扣 × 当日物价倍率）
 * × 事件带来的额外倍率。
 *
 * 界面与结账都必须走这个函数。任何一处直接读 `line.price` 都会漏掉事件那一段。
 */
export function basePriceOf(run: RunState, line: { price: number }): number {
  return Math.max(1, Math.round(line.price * run.shopPriceFactor));
}

/**
 * 今天能不能再买这件（限购，来自白天事件）。
 *
 * ★ 它是**全程**上限：要减去今天已经买走的量。不减的话，
 * "每人限购两袋"就变成了"每次结账最多两袋"—— 分两趟就能买四袋。
 * 那不是玩家狡猾，是机制漏了。
 *
 * @returns 今天这件在这家店还能买几件；没有限购则返回 `Number.POSITIVE_INFINITY`
 */
export function purchaseLimitOf(run: RunState, shopId: string, itemId: string): number {
  const category = getItemDef(itemId).category;
  const limits = run.shopLimits.filter((l) => l.shopId === shopId && l.category === category);
  if (limits.length === 0) return Number.POSITIVE_INFINITY;
  // 同一品类有多条限购时取**最严**的那条：玩家不会记得自己触发过几条，
  // 界面只能给一个答案，而那个答案必须是不会让他"买了又被拒"的那个
  const cap = Math.min(...limits.map((l) => l.max));
  const bought = boughtTodayOf(run, shopId, itemId);
  return Math.max(0, cap - bought);
}

/** 今天这件在这家店已经买走多少（记账见 `ShopBoughtToday`） */
export function boughtTodayOf(run: RunState, shopId: string, itemId: string): number {
  return run.shopBoughtToday[`${shopId}|${itemId}`] ?? 0;
}

/**
 * 进店**之前**掷一次：今天这家店有没有事？有则返回事件 id，没有返回 null。消耗一次 RNG。
 *
 * 权重池里混了一个"今天没事"的虚拟条目（`DAY_EVENT_NONE_WEIGHT`），
 * 所以"有没有事"和"是哪件事"共用同一次抽签 —— 与突发事件同一套做法（见 data/dayEvents.ts）。
 *
 * `dayEventWeight` 负责把 `onlyShops` 之外的店门权重压成 0：
 * 黑市商人只会出现在五金店后巷，别处抽不到他。
 */
export function rollDayEvent(
  cursor: RngCursor,
  shopId: string,
  recent: readonly string[] = [],
  disasterId?: string
): string | null {
  /*
   * §10B.3.1 的 L2 维度：**事件池权重**。
   *
   * `eventPoolWeights` 是 `{标签: 倍数}` —— 寒潮局把"冷"抬到 3 倍、
   * 骚乱局把"人"抬到 3 倍，于是**同一套事件表在不同灾难下带来不同的事**。
   * 这是"多角度全方位"里最省事、效果最明显的一维：
   * 它不需要新事件，只需要让已有的事件**按场次重新分配出场率**。
   *
   * 匹配口径：事件写了 `tags` 就按标签查；没写标签就退回按 id 查
   * （存量内容不必立刻补标签，但新内容必须写 —— 校验会提示覆盖率）。
   */
  const mods = disasterModifiersOf(disasterId);
  const weightMul = (def: { id: string; tags?: readonly string[] }): number => {
    let mul = 1;
    for (const tag of def.tags ?? []) mul *= mods.eventPoolWeights[tag] ?? 1;
    if (!def.tags || def.tags.length === 0) mul *= mods.eventPoolWeights[def.id] ?? 1;
    return mul;
  };
  const pool = DAY_EVENT_DEFS.map((def) => ({
    def,
    weight: dayEventWeight(def, shopId) * weightMul(def)
  })).filter((e) => e.weight > 0);
  const total = DAY_EVENT_NONE_WEIGHT + pool.reduce((n, e) => n + e.weight, 0);
  if (total <= 0) return null;
  const roll = nextFloat(cursor) * total;
  if (roll < DAY_EVENT_NONE_WEIGHT) return null;
  // 最近出过的那一条不会再出（同夜间 / 求援 / 突发的口径，见 model/rng.ts）
  const last = recent[0];
  let acc = DAY_EVENT_NONE_WEIGHT;
  for (const entry of pool) {
    if (entry.def.id === last && pool.length > 1) continue;
    acc += entry.weight;
    if (roll < acc) return entry.def.id;
  }
  return pool[pool.length - 1]?.def.id ?? null;
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

  /*
   * §10B.3.1 的 L2 维度：**单趟搬运上限**受这一场灾难影响。
   *
   * 高温 / 缺氧 / 风雪里，一趟能提的重量本来就该少 —— 这是"多角度全方位"里
   * 最容易被忽略但玩家立刻能感觉到的一维：同样是 6 罐燃料，
   * 平时一趟拿走，沙暴里得跑两趟（而行动点就那么多）。
   *
   * `Math.max(1, ...)`：再糟的天气也不该让玩家一件都搬不动（那会变成死局）。
   */
  const mods = disasterModifiersOf(run.disasterId);
  const carryLimit = Math.max(1, roundKg(identity.carryLimit * mods.carryFactor));
  const vehicleCapacity = identity.vehicleCapacity;
  const capacityLeft = roundKg(Math.max(0, vehicleCapacity - run.carLoad));

  const views: CartLineView[] = [];
  const notes: string[] = [];
  const problems: string[] = [];
  let cost = 0;
  let weight = 0;
  let pieces = 0;

  /*
   * ★★ 先把**同一个品类的多行并成一行**。
   *
   * 压测（`scripts/stress.mjs`）抓到两个由此而来的洞：
   *  · "店里只剩 0 件，两行各买 0 → 实际到手 8 件"——
   *    每行各自对着"还剩多少"算，逐行都不超，**合起来就超了**；
   *  · "限购 2 件被重复行绕过：一次结账买到 4 件"——
   *    `purchaseLimitOf` 是逐行算的，而限购的语义是**全程上限**，
   *    在一次结账之内就漏了。
   *
   * 合并之后每个品类只剩一行，上面两条约束自然就成了"对总数成立"。
   * 界面本来也不会给同一个品类发两行（篮子按 itemId 归并），
   * 所以这一步在正常玩法下是恒等的 —— 它守的是"接线层被人改坏"。
   */
  const merged: CartLine[] = [];
  const indexByItem = new Map<string, number>();
  for (const line of lines) {
    const at = indexByItem.get(line.itemId);
    if (at === undefined) {
      indexByItem.set(line.itemId, merged.length);
      merged.push({ itemId: line.itemId, count: line.count });
    } else {
      const cur = merged[at];
      if (cur) merged[at] = { itemId: cur.itemId, count: cur.count + line.count };
    }
  }

  for (const line of merged) {
    /*
     * ★★ 件数必须是**正整数** —— 这条守卫不能用"比较"来写。
     *
     * 压测（`scripts/stress.mjs`）抓到一个会**污染整份存档**的输入：
     * 件数给 NaN 时，下面所有比较对它都是 false ——
     * `line.count <= 0` 不成立（不跳过）、`count < line.count` 不成立（不报问题），
     * 于是三大约束**全部放行**：现金被写成 NaN、箱内批次件数也是 NaN，
     * 之后每一次读数都带着它（现金 / 库存 / 件数 / 四维全被污染）。
     *
     * 界面造不出 NaN（件数来自 `+` / `-` 按钮），所以这不是玩家能碰到的 bug；
     * 但它是**接线层不设防**，而 NaN 一旦进来就收不回去。
     * `Number.isInteger` 一次挡掉 NaN / 小数 / Infinity。
     */
    if (!Number.isInteger(line.count) || line.count <= 0) continue;
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
    // 限购（来自白天事件）：先按"店里还剩多少"降到今天还能卖的量
    const limit = purchaseLimitOf(run, shopId, line.itemId);
    const available = limit === Number.POSITIVE_INFINITY ? sku.stock : Math.min(sku.stock, limit);
    if (available <= 0) {
      problems.push(`${item.name}：今天限购，你已经买满了`);
      continue;
    }
    const count = Math.min(line.count, available);
    if (count < line.count) {
      notes.push(
        limit === Number.POSITIVE_INFINITY
          ? `${item.name}：只剩 ${sku.stock} 件，先按这些算`
          : `${item.name}：今天限购 ${limit} 件，先按这些算`
      );
    }
    const unitPrice = basePriceOf(run, sku);
    const lineCost = unitPrice * count;
    const lineWeight = roundKg(item.unitWeight * count);
    views.push({
      itemId: line.itemId,
      count,
      unitPrice,
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

/**
 * 进一个店门：消耗 1 行动点（同一天再进一次也允许，但很浪费 —— 库存不会自己补）。
 *
 * ★ 扣完行动点之后、把 `currentShopId` 立起来之前，**先掷一次白天事件**
 * （§6.2 / D-10 的接入点）。掷中就把 `dayEvent` 挂上，界面据此先画事件、不画货架。
 *
 * 三件事的顺序是有讲究的：
 *   · 行动点**照扣**。事件是"进店路上的遭遇"，不是"没进成店"——
 *     玩家的时间确实花掉了，这也是"插队大妈"那条事件里"不排了"仍然要花钱的原因；
 *   · `visitedShopIds` 照记。今天来过就是来过；
 *   · `currentShopId` 立起来，因为界面要站在门口把那件事读完（"换一家"才是出口）。
 */
export function enterShop(store: GameStore, shopId: string): ShopResult {
  const run = store.run;
  if (run.phase !== 'stockpile_shop') return reject('现在不是在外面的时候');
  if (!SHOP_DEFS.some((s) => s.id === shopId)) return reject('没有这个点位');
  /*
   * 进店要花几点，由 `ShopDef.actionCost` 决定（不写 = 1）。
   * §10B 扩点位之后，远的店（郊区仓库 / 批发市场）可以花 2 点但更便宜 ——
   * 那正是"多一家店"能做出的差异，否则它只是多一次点击。
   * 检查用 `actionCostOf` 而不是硬编码 1：不然"要 2 点的店"会在只剩 1 点时
   * 被放进去、然后扣成负数。
   */
  const cost = actionCostOf(shopId);
  if (run.actionPoints < cost) return reject('今天的行动点不够去那儿');
  if (run.carLoad >= identityLimitOf(run)) return reject('车已经装满了，先回家卸货');

  const firstTime = !run.visitedShopIds.includes(shopId);
  const events: ShopEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    draft.actionPoints -= cost;
    draft.currentShopId = shopId;
    if (!draft.visitedShopIds.includes(shopId)) draft.visitedShopIds.push(shopId);
    if (firstTime) {
      draft.log.push(`${dayLabel(draft.day)} · 进了${getShopDef(shopId).name}。`);
    }
    const eventId = rollDayEvent(cursor, shopId, draft.eventHistory.day, draft.disasterId);
    if (eventId) {
      draft.dayEvent = { defId: eventId, shopId, choice: null, applied: null };
      recordEvent(draft, 'day', eventId);
      events.push({ type: 'dayEventHit', defId: eventId, shopId });
    }
    draft.seed = cursor.state;
  });
  events.unshift({ type: 'enteredShop', shopId });
  return ok(events);
}

// ———————— 白天事件（§6.2 / D-10） ————————

/** 取第 `choice` 个选项。越界返回 null（调用方据此走"不参与"的分支） */
export function dayOptionAt(def: DayEventDef, choice: number): DayOption | null {
  return def.options[choice] ?? null;
}

/**
 * 一个白天事件选项**必须**至少命中一个的字段 —— 也就是"落到玩家身上"的那些。
 *
 * ★ 它是那条硬约束的可执行形式：`dayEvent.test.ts` 会遍历事件表里的每一个选项，
 * 只要它的 effect 里一个都没命中，测试就红。加新事件时它会当场拦住
 * "写一个没有后果的选项"。
 *
 * 刻意**不在这里**的三个字段：
 *  · `stockCut` / `limit` —— 它们只改商店。玩家不会因为"别人把货抢走了"
 *    或"店里限购了"得到任何东西，所以它们只能当事件的背景，不能单独成项；
 *  · `priceUp` —— 它是**惩罚**。单独成项就等于"进去挨一刀"，那不是选择。
 *    （它可以和其他效果一起出现，见"抢购"那条的紧急补货。）
 */
export const PLAYER_FACING_EFFECT_KEYS = ['cash', 'stamina', 'mood', 'boxDefId', 'grab', 'visitLost'] as const;

/** 这个选项有没有"落到玩家身上"的效果。没有 = 玩家点完什么都不会变 */
export function hasPlayerFacingEffect(effect: DayOptionEffect): boolean {
  return PLAYER_FACING_EFFECT_KEYS.some((key) => effect[key] !== undefined);
}

/**
 * 把选项后果落到状态上，并返回**实际生效**的数值。
 *
 * 与 `systems/night.ts` 的 `applyNightEffect` 同一条纪律：现金给不起就按有多少给多少，
 * 摘要与结果文案一律读**实际值**，绝不读选项声明的数 ——
 * 屏幕报一件没发生的事，比数值本身更糟（见 `AppliedEffect` 的注释）。
 *
 * 事件对商店库存的削减走**品类**：`stockCut.category` 落到当天该店所有该品类的行上。
 * 注意它扣的是**商店**的货架，不是玩家家里的东西 —— 文案必须说清这一点
 * （见 `DayOptionEffect` 的字段注释）。
 */
export function applyDayEffect(run: RunState, effect: DayOptionEffect, shopId: string, cursor: RngCursor): DayEffectApplied {
  const applied: DayEffectApplied = {
    cash: 0,
    priceUp: 0,
    stockCut: [],
    limits: [],
    stamina: 0,
    mood: 0,
    gotBox: false,
    boxName: '',
    grabbed: [],
    visitLost: false
  };

  if (effect.cash) {
    const next = Math.max(0, run.cash + effect.cash);
    applied.cash = next - run.cash;
    run.cash = next;
  }
  if (effect.priceUp) {
    // 涨价只影响今天剩下的时间，所以直接乘在当天的倍率上（换天时被 rollDaySetup 清掉）
    const factor = 1 + effect.priceUp;
    run.shopPriceFactor = Math.round(run.shopPriceFactor * factor * 1000) / 1000;
    applied.priceUp = effect.priceUp;
  }
  if (effect.stockCut) {
    const { category, count } = effect.stockCut;
    const stock = run.shopStocks.find((s) => s.shopId === shopId);
    if (stock) {
      for (const line of stock.lines) {
        if (getItemDef(line.itemId).category !== category) continue;
        const cut = Math.min(line.stock, Math.max(1, Math.round(count / 2)));
        if (cut <= 0) continue;
        line.stock -= cut;
        applied.stockCut.push({ shopId, itemId: line.itemId, count: cut });
      }
    }
  }
  if (effect.limit) {
    // 限购的语义是"**今天这家店这个品类最多卖你几件**"。
    // ★ 这里**不减去"已经买走的量"**，而且那是可证的：事件只在 `enterShop` 那一下触发，
    // 而进店之前玩家站在点位列表上 —— 当天还没在这家店买过任何东西。
    // 若将来把事件挪到店内触发（比如"货架前有人插队"），这里必须补一笔买入记账，
    // 否则会出现"事件发生前买过的人拿到一个比实际更宽松的上限"。
    const limit: ShopLimit = { shopId, category: effect.limit.category, max: effect.limit.max };
    run.shopLimits.push(limit);
    applied.limits.push(limit);
  }
  if (effect.grab) {
    // 当场拿到货：从这家店**当前**的货架上取，装成一箱进待拆队列。
    // 取不满就按实际拿到的算 —— 货架本来就是有限的，"抢"也不该凭空变出东西
    const taken = grabFromShop(run, shopId, effect.grab.category, effect.grab.count, cursor);
    applied.grabbed = taken.grabbed;
    if (taken.grabbed.length > 0) {
      applied.gotBox = true;
      applied.boxName = taken.boxName;
      // ★ 重量必须照实记进当天的车载 —— 不记的话玩家会看到"家里多了东西、车上负重没变"，
      // 那是 M2 第一版黑市那一箱的真 bug（玩家当场就看出来了）
      run.carLoad = roundKg(run.carLoad + taken.weight);
    }
  }
  if (effect.stamina) {
    // 与夜间事件同一条纪律：摘要必须报**实际**变化，不能报选项声明的数
    const next = clampStat(run.stats.stamina + effect.stamina);
    applied.stamina = next - run.stats.stamina;
    run.stats.stamina = next;
  }
  if (effect.mood) {
    const next = clampStat(run.stats.mood + effect.mood);
    applied.mood = next - run.stats.mood;
    run.stats.mood = next;
  }
  if (effect.boxDefId) {
    const def = getBoxDef(effect.boxDefId);
    const items = generateBoxStacks(cursor, def, run.day);
    run.boxesToUnpack.push({
      id: `box_${nextBoxSeq(run.boxesToUnpack)}`,
      defId: def.id,
      // 批次到期日以**当前天**为基准，与白天采购、夜间事件共用同一套 FEFO 尺子
      items
    });
    applied.gotBox = true;
    applied.boxName = def.name;
    // 同一笔账：手里多了一箱，车上就多一份重量（它此刻确实在你车上）
    const weight = items.reduce((n, s) => n + getItemDef(s.itemId).unitWeight * stackCount(s), 0);
    run.carLoad = roundKg(run.carLoad + weight);
  }
  if (effect.visitLost) {
    applied.visitLost = true;
  }

  return applied;
}

/**
 * 从这家店**当前**的货架上取走几件某品类的东西，装成一箱。
 *
 * 它是"抢购 / 趁乱拿"这类选项的落点：货是真的从店里少的，也是真的进你家的。
 * 按到期日升序取（和 FEFO 一样，先拿快过期的）—— 这条不为了好玩，
 * 只为了让"店里少了什么"和"你拿到了什么"是同一批货，对得上账。
 */
/**
 * 拿到某品类的东西：**优先从这家店当前的货架上取**，货架不够时用同品类的箱子补足。
 *
 * ## 为什么必须有"补足"这一步（这是被玩家的截图逼出来的）
 *
 * 第一版是"货架上有就取、没有就返回空"。看起来合理，实际会造成一个**最糟的组合**：
 * 文案已经说了"你拿了两袋米"（那是数据表里写死的），而效果返回空 ——
 * 于是屏幕上同时出现"你拿了两袋米"和"这一趟没拿到货"，
 * 玩家拿到的是**自相矛盾的两句话**（他的截图就是这一张）。
 *
 * 口径因此定成：**文案承诺了货，就一定要给到货**。
 * 店里的现货优先（那是"真从货架上少的"，账对得上），
 * 缺的部分用同品类的箱子补 —— 因为这一趟的意义是"你拿到了"，
 * 而不是"店里的库存算术"。返回空只在**品类根本不存在**时发生（那是配置错误，不是玩法）。
 */
function grabFromShop(
  run: RunState,
  shopId: string,
  category: CategoryId,
  count: number,
  cursor: RngCursor
): { grabbed: { itemId: string; count: number }[]; weight: number; boxName: string } {
  const stock = run.shopStocks.find((s) => s.shopId === shopId);
  const items: ItemStack[] = [];
  let left = count;
  if (stock) {
    const lines = stock.lines.filter((l) => getItemDef(l.itemId).category === category && l.stock > 0);
    for (const line of lines) {
      if (left <= 0) break;
      const take = Math.min(left, line.stock);
      if (take <= 0) continue;
      line.stock -= take;
      left -= take;
      items.push(makeStack(line.itemId, take, rollExpiry(cursor, line.itemId, run.day)));
    }
  }

  // 货架不够 → 用同品类的箱子补足这一趟承诺的件数
  if (left > 0) {
    const boxDef = boxForCategory(category);
    if (boxDef) {
      const generated = generateBoxStacks(cursor, boxDef, run.day).filter(
        (s) => getItemDef(s.itemId).category === category
      );
      for (const stack of generated) {
        if (left <= 0) break;
        const take = Math.min(left, stackCount(stack));
        if (take <= 0) continue;
        left -= take;
        items.push(makeStack(stack.itemId, take, firstBatchExpiry(stack)));
      }
    }
  }

  const weight = items.reduce((n, s) => n + getItemDef(s.itemId).unitWeight * stackCount(s), 0);
  if (items.length === 0) return { grabbed: [], weight: 0, boxName: '' };

  // 箱型按拿到的东西自动挑（与采购同一套），这样"抢回来的那箱"看起来也是正经一箱
  const def = getBoxDef(
    pickBoxDefId(
      items.map((s) => ({
        itemId: s.itemId,
        count: stackCount(s),
        unitPrice: 0,
        lineCost: 0,
        unitWeight: getItemDef(s.itemId).unitWeight,
        lineWeight: 0,
        stock: 0
      }))
    )
  );
  run.boxesToUnpack.push({ id: `box_${nextBoxSeq(run.boxesToUnpack)}`, defId: def.id, items });
  return {
    grabbed: items.map((s) => ({ itemId: s.itemId, count: stackCount(s) })),
    weight,
    boxName: def.name
  };
}

/**
 * 这个品类该用哪个箱型补货。按 `BOX_DEFS` 的声明顺序找第一个含有该品类物资的箱子。
 *
 * 不写一张死表：物资表加东西时死表会漂，而 `BOX_DEFS` 的 pool 是唯一的真相。
 * 找不到就退回 `box_mixed`（它的池子覆盖全部正经物资，一定找得到）。
 */
function boxForCategory(category: CategoryId): BoxDef | null {
  for (const def of BOX_DEFS) {
    if (def.pool.some((id) => getItemDef(id).category === category)) return def;
  }
  return BOX_DEFS.find((d) => d.id === 'box_mixed') ?? null;
}

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * 决定白天事件怎么办。`choice` 为选项下标。
 *
 * 与夜间事件同一个两段式：先选，再看后果。`applied` 落盘的理由也一样 ——
 * 刷新回来要能复现"你已经决定过、结果是这样"，而不是按选项声明的数值重算一遍。
 *
 * `visitLost` 的出口是**把玩家退回点位列表**（`currentShopId = null`）：
 * "这趟白跑"必须真的结束这一趟，否则它和"照常买"没有区别。
 */
export function resolveDayEvent(store: GameStore, choice: number): ShopResult {
  const run = store.run;
  if (run.phase !== 'stockpile_shop') return reject('现在不是在外面的时候');
  const state = run.dayEvent;
  if (!state) return reject('门口没什么事');
  if (state.choice !== null) return reject('已经决定了');
  const def = findDayEvent(state.defId);
  if (!def) return reject('没有这件事');
  const option = dayOptionAt(def, choice);
  if (!option) return reject('没有这个选项');
  if (option.requireFullCash) {
    const cost = Math.max(0, -(option.effect.cash ?? 0));
    if (run.cash < cost) return reject(`钱不够，还差 ${cost - run.cash} 元`);
  }

  const events: ShopEvent[] = [];
  store.commit((draft) => {
    const cursor = createCursor(draft.seed);
    const target = draft.dayEvent;
    const applied = applyDayEffect(draft, option.effect, target?.shopId ?? '', cursor);
    if (target) {
      target.choice = choice;
      target.applied = applied;
    }
    const summary = describeDayEffect(applied);
    draft.log.push(
      `${dayLabel(draft.day)} · ${getShopDef(target?.shopId ?? '').name}门口：${option.label}${
        summary.length > 0 ? `（${summary.join('，')}）` : ''
      }`
    );
    // 白跑一趟 = 这一趟到此为止：退回点位列表（行动点照扣，那是"进店"的价钱）
    if (applied.visitLost) {
      draft.currentShopId = null;
      draft.dayEvent = null;
    }
    draft.seed = cursor.state;
    events.push({ type: 'dayEventResolved', defId: def.id, choice, summary, visitLost: applied.visitLost });
  });

  return ok(events);
}

/**
 * 把事件的实际后果写成一行数值摘要。空数组 = 什么都没变，界面据此不渲染数值行。
 *
 * ★ 两条口径，都是被玩家当场问出来的：
 *
 *  1. **先报"你拿到了什么"，再报代价** —— 玩家的原话是
 *     "我抢了东西买了东西，光提示什么货架减少了……家里的东西并没有增长啊"。
 *     顺序反映的是他关心的东西：这趟白来没有？拿到了什么？然后才是花掉多少。
 *     所以 `grab` / `gotBox` 排在最前面；
 *  2. **说清是"店里的"还是"家里的"**。原来那句"货架少了 N 件"读起来像自家货架，
 *     而它改的是**商店**的货架。现在写成"店里少了 N 件"（说不清是哪儿的话，
 *     玩家就会去找一个根本没发生的损失）。
 */
export function describeDayEffect(applied: DayEffectApplied): string[] {
  const parts: string[] = [];
  const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
  // ① 先报收获
  const grabbed = applied.grabbed.reduce((n, g) => n + g.count, 0);
  if (grabbed > 0) {
    const names = applied.grabbed
      .map((g) => `${getItemDef(g.itemId).name}×${g.count}`)
      .join('、');
    parts.push(`拿到 ${names}`);
  } else if (applied.gotBox) {
    parts.push(`带回来一${applied.boxName}`);
  }
  // ② 再报代价
  if (applied.cash) parts.push(`现金 ${signed(applied.cash)}`);
  if (applied.stamina) parts.push(`体力 ${signed(applied.stamina)}`);
  if (applied.mood) parts.push(`心情 ${signed(applied.mood)}`);
  if (applied.priceUp) parts.push(`物价 +${Math.round(applied.priceUp * 100)}%`);
  const cut = applied.stockCut.reduce((n, c) => n + c.count, 0);
  if (cut > 0) parts.push(`店里少了 ${cut} 件`);
  for (const limit of applied.limits) parts.push(`今天限购 ${limit.max} 件`);
  return parts;
}

/** 结果文案里的 `{spentCash}` 换成实际花掉的现金（正数）。同夜间事件的 `resolveOutcome` */
export function resolveDayOutcome(option: DayOption, applied: DayEffectApplied): string {
  return option.outcome.replace('{spentCash}', String(Math.abs(applied.cash)));
}

/**
 * 从货架前退回点位列表。刻意不做"退回也要花行动点"这种设计 —— 看一圈不买是玩家的权利。
 *
 * 同时清掉门口那件事（如果还没处理）：`dayEvent` 只在"站在某家店门口"时有意义，
 * 而"先不进去"就是 §4A 要求的那条**不参与的路**。留着它会让玩家下次进门时
 * 看到一段属于上一趟的文案。
 */
export function leaveShop(store: GameStore): ShopResult {
  const run = store.run;
  if (run.phase !== 'stockpile_shop') return reject('现在不在外面');
  if (run.currentShopId === null && run.dayEvent === null) return ok([]);
  store.commit((draft) => {
    draft.currentShopId = null;
    draft.dayEvent = null;
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
    // 记账：限购要减掉"今天已经买走的"（见 model/types.ts 的 ShopBoughtToday）。
    // 它和上面那句扣库存是两件事 —— 库存是"店里还剩多少"，记账是"我买过多少"，
    // 只有后者能让限购成为全程上限
    for (const line of view.lines) {
      const key = `${shopId}|${line.itemId}`;
      draft.shopBoughtToday[key] = (draft.shopBoughtToday[key] ?? 0) + line.count;
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
