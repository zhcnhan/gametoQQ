/**
 * 物资静态表（策划案 §8：MVP 10~12 种；§10B 目标 **120~200 种**）。
 * 纯常量，不含任何逻辑与 DOM 引用。
 *
 * `DEFERRED(D-23): 八张内容表还没有统一注册表，图鉴 / 成就 / 解锁各自的查询是散的`
 * —— 见 `docs/囤货末世-游戏策划案.md` §10B.5 与 `src/meta/deferred.ts` 的 D-23。
 * 它是 §10B 的**第 1 步**：不先做它，图鉴界面会 import 八张表、成就条件会各自硬编码，
 * 而"写了但永远出不来"的内容没人能自动查出来（M2 的 D-16 就是这个）。
 *
 * 数值约定（§7）：
 *  - slotSize：1=小件 / 2=大瓶 / 4=整袋
 *    DEFERRED(D-07): 槽位矩阵目前是"一格一栈"，slotSize **没有参与任何计算** ——
 *    大米（slotSize 4）和电池（slotSize 1）占同样一格。要么让它真的吃格子，
 *    要么承认它是废字段并从 §7 里删掉；现在这样悬着是最差的。
 *  - stackLimit：单槽堆叠上限
 *  - nutrition：基础营养，M0 不使用，M1 生存期消耗读这里
 */
import type { CategoryId, ItemDef } from '../model/types';

export const ITEM_DEFS: readonly ItemDef[] = [
  {
    id: 'canned_beans',
    name: '黄豆罐头',
    category: 'food',
    icon: 'can',
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 720,
    nutrition: { food: 1 },
    basePrice: 8,
    tags: ['canned', 'food']
  },
  {
    id: 'instant_noodles',
    name: '泡面',
    category: 'food',
    icon: 'noodles',
    unitWeight: 0.12,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 180,
    nutrition: { food: 1, comfort: 1 },
    basePrice: 5,
    tags: ['dry', 'food']
  },
  {
    id: 'rice_bag',
    name: '大米',
    category: 'food',
    icon: 'rice',
    unitWeight: 5,
    slotSize: 4,
    stackLimit: 1,
    perishable: true,
    shelfLifeDays: 365,
    nutrition: { food: 4 },
    basePrice: 40,
    tags: ['grain', 'food']
  },
  {
    id: 'flour',
    name: '面粉',
    category: 'food',
    icon: 'flour',
    unitWeight: 2.5,
    slotSize: 2,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 240,
    nutrition: { food: 3 },
    basePrice: 22,
    tags: ['grain', 'food']
  },
  {
    id: 'mineral_water',
    name: '矿泉水',
    category: 'water',
    icon: 'water',
    unitWeight: 1.5,
    slotSize: 2,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 365,
    nutrition: { water: 2 },
    basePrice: 3,
    tags: ['drink', 'water']
  },
  {
    id: 'milk',
    name: '牛奶',
    category: 'water',
    icon: 'milk',
    unitWeight: 1,
    slotSize: 2,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 21,
    nutrition: { water: 1, food: 1, comfort: 1 },
    basePrice: 12,
    tags: ['drink', 'fresh']
  },
  {
    id: 'bandage',
    name: '绷带',
    category: 'medicine',
    icon: 'bandage',
    unitWeight: 0.1,
    slotSize: 1,
    stackLimit: 10,
    perishable: false,
    nutrition: { health: 2 },
    basePrice: 6,
    tags: ['medkit', 'medicine']
  },
  {
    id: 'cold_medicine',
    name: '感冒药',
    category: 'medicine',
    icon: 'pill',
    unitWeight: 0.05,
    slotSize: 1,
    stackLimit: 8,
    perishable: false,
    nutrition: { health: 3 },
    basePrice: 18,
    tags: ['medkit', 'medicine']
  },
  {
    id: 'fuel_can',
    name: '燃料罐',
    category: 'fuel',
    icon: 'fuel',
    unitWeight: 4,
    slotSize: 2,
    stackLimit: 2,
    perishable: false,
    nutrition: {},
    // §12.3 v0.7：30 → 18。旧价下 14 天刚需 28 罐 = 1008 元（五金店 ×1.2），比全部起始现金还贵，
    // "拉长窗口"会直接变成"必死"。18 让它仍是最大的一笔（28 罐 ≈ 616 元，占预算六成），
    // 但咬牙买得起 —— 于是"要不要少买两罐换几床棉被"第一次成为真问题。
    basePrice: 18,
    tags: ['fuel', 'flammable']
  },
  {
    id: 'quilt',
    name: '棉被',
    category: 'warmth',
    icon: 'quilt',
    unitWeight: 3,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: { comfort: 3 },
    // §12.3 v0.7：60 → 45。庇护所跌破 40 后睡觉只回一半体力（见 data/survival.ts），
    // 棉被从"修一个没有下游的数字"变成"修你的睡眠"。45（五金店 54）让"买两床"挤得进预算。
    basePrice: 45,
    tags: ['warmth', 'soft']
  },
  {
    id: 'battery',
    name: '电池',
    category: 'tool',
    icon: 'battery',
    unitWeight: 0.03,
    slotSize: 1,
    stackLimit: 12,
    perishable: false,
    nutrition: {},
    basePrice: 5,
    tags: ['power', 'tool']
  },
  {
    id: 'toolbox',
    name: '工具箱',
    category: 'tool',
    icon: 'toolbox',
    unitWeight: 6,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 80,
    tags: ['tool', 'heavy']
  },

  // ———————— M2：luxury 品类实装（§12 拍板 v0.9） ————————
  //
  // ## 为什么需要它们
  //
  // `CategoryId` 里一直有 `luxury`，但**一件物品都没有** —— 于是：
  //   · 胶带清单上的"享受"胶囊永远选不出意义（一个空品类）；
  //   · §5 引擎③「拆箱惊喜」没有"赌"性：神秘混合箱开出来的永远是能算清账的东西，
  //     玩家拆箱时不会有一次"这次会不会开出点好的"的心跳；
  //   · 图鉴（§9.6）缺一批收集目标。
  //
  // ## 三条硬约束（写在这里，免得后来者"顺手"给它们加数值）
  //
  //  1. **不参与生存数值**：`nutrition` 全空、不是任何灾难的 `priorityCategories`。
  //     它们不进 `dailyDrainOf`，也不会被自动补给取用 —— 买了不会让你活得久一点。
  //     这是刻意的：一个"买奢侈品能活更久"的机制会把整理期变成又一道算术题；
  //  2. **只在神秘混合箱里低概率开出**（`data/boxes.ts` 的 `luxuryChance`），
  //     而且**商店里一件都不卖**（`data/shops.ts` 里没有它们的 offer）。
  //     唯一的来源是运气，这才叫"赌"；
  //  3. **它们的价值只有两条**：点亮图鉴 + 心情（`comfort` 读得到的地方见下）。
  //     心情那一格走的是**整理期的摆放**而不是生存期的消耗 —— 见 `tags` 里的 'keepsake'。
  //
  // 价格写成"贵得离谱"但其实买不到：`basePrice` 只用于图鉴与结算的估值展示，
  // 商店不卖它们，所以这个数不进任何一次结账。
  {
    id: 'cocoa_tin',
    name: '可可粉铁罐',
    category: 'luxury',
    icon: 'cocoa_tin',
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 400,
    nutrition: {},
    basePrice: 30,
    tags: ['treat', 'luxury', 'keepsake']
  },
  {
    id: 'cigarettes',
    name: '一条烟',
    category: 'luxury',
    icon: 'cigarettes',
    unitWeight: 0.3,
    slotSize: 1,
    stackLimit: 5,
    perishable: false,
    nutrition: {},
    // 它在末世里的用途不用解释：硬通货
    basePrice: 60,
    tags: ['treat', 'luxury', 'keepsake']
  },
  {
    id: 'coffee_beans',
    name: '半袋咖啡豆',
    category: 'luxury',
    icon: 'coffee_beans',
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 120,
    nutrition: {},
    basePrice: 45,
    tags: ['treat', 'luxury', 'keepsake']
  },
  {
    id: 'picture_book',
    name: '一本画册',
    category: 'luxury',
    icon: 'picture_book',
    unitWeight: 0.9,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 70,
    tags: ['treat', 'luxury', 'keepsake']
  },
  {
    id: 'hot_water_bag_gift',
    name: '印花的暖水袋',
    category: 'luxury',
    icon: 'hot_water_bag_gift',
    unitWeight: 0.6,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    // 刻意**不给 comfort**：给了它就会进自动添被那条链，于是"奢侈品"变成了
    // 保暖品的一个更便宜的替代 —— 那条路会让 §8 的 warmth 刚需失效。
    // 它只是个好看的东西
    basePrice: 35,
    tags: ['treat', 'luxury', 'keepsake']
  }
];

const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEM_DEFS.map((d) => [d.id, d]));

export function getItemDef(itemId: string): ItemDef {
  const def = ITEM_BY_ID.get(itemId);
  if (!def) throw new Error(`未知物资 id: ${itemId}`);
  return def;
}

export function hasItemDef(itemId: string): boolean {
  return ITEM_BY_ID.has(itemId);
}

export const ITEM_IDS: readonly string[] = ITEM_DEFS.map((d) => d.id);

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  food: '主食',
  water: '饮水',
  medicine: '医疗',
  fuel: '燃料',
  warmth: '保暖',
  tool: '工具',
  luxury: '享受'
};

/**
 * 品类的**稳定顺序**（胶带胶囊按它排、存档里的清单也按它归一化）。
 *
 * 必须显式写出来，不能靠 `Object.keys(CATEGORY_LABELS)`：
 * 那样顺序会随 label 表的编辑而变，玩家看到的胶囊会莫名换位子，
 * 而且同一个存档在不同版本里序列化出的字符串会不一样（diff 噪音）。
 */
export const CATEGORY_ORDER: readonly CategoryId[] = [
  'food',
  'water',
  'medicine',
  'fuel',
  'warmth',
  'tool',
  'luxury'
];
