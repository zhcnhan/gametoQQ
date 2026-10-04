/**
 * 物资静态表（策划案 §8：MVP 10~12 种；§10B 目标 **120~200 种**）。
 * 纯常量，不含任何逻辑与 DOM 引用。
 *
 * M3 第 1 步已清偿 D-23（八张表的统一注册表）：本表由 `data/registry.ts` 汇总，
 * 图鉴 / 成就 / 解锁只读注册表，不再各自 import 这张表。**加物资时不要动注册表** ——
 * 它是按表推导的，加一行数据就够了。
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
    tags: ['canned', 'food'],
    tier: 1
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
    tags: ['dry', 'food'],
    tier: 1
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
    tags: ['grain', 'food'],
    tier: 1
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
    tags: ['grain', 'food'],
    tier: 1
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
    tags: ['drink', 'water'],
    tier: 1
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
    tags: ['drink', 'fresh'],
    tier: 1
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
    tags: ['medkit', 'medicine'],
    tier: 1
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
    tags: ['medkit', 'medicine'],
    tier: 1
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
    tags: ['fuel', 'flammable'],
    tier: 1
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
    tags: ['warmth', 'soft'],
    tier: 1
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
    tags: ['power', 'tool'],
    tier: 1
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
    tags: ['tool', 'heavy'],
    tier: 1
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
    tags: ['treat', 'luxury', 'keepsake'],
    tier: 1
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
    tags: ['treat', 'luxury', 'keepsake'],
    tier: 1
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
    tags: ['treat', 'luxury', 'keepsake'],
    tier: 1
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
    tags: ['treat', 'luxury', 'keepsake'],
    tier: 1
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
    tags: ['treat', 'luxury', 'keepsake'],
    tier: 1
  },
  // ═══ 生成内容 物资-01 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "canned_corned_beef",
    name: "午餐肉罐头",
    category: "food",
    icon: "can-corned-beef",
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 1095,
    nutrition: {
      food: 2,
      comfort: 1
    },
    basePrice: 22,
    tags: ["canned", "food", "treat"],
    tier: 1,
    decision: "少数零下不结冰的荤食，但比黄豆罐头贵近一倍，要不要为口味花这笔钱",
    note: "寒潮局里不用加热就能吃的荤菜"
  },
{
    id: "canned_fish",
    name: "豆豉鲮鱼罐头",
    category: "food",
    icon: "can-fish-blackbean",
    unitWeight: 0.2,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 1095,
    nutrition: {
      food: 2
    },
    basePrice: 18,
    tags: ["canned", "food"],
    tier: 1,
    decision: "单价最高的罐头，省空间不省钱，囤它还是囤两份黄豆罐头",
    note: "重量最轻的荤食，搬运惩罚大的局里值钱"
  },
{
    id: "canned_peach",
    name: "糖水黄桃罐头",
    category: "food",
    icon: "can-peach-syrup",
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 720,
    nutrition: {
      food: 1,
      water: 1,
      comfort: 2
    },
    basePrice: 16,
    tags: ["canned", "food", "treat"],
    tier: 1,
    decision: "又解馋又补水，但一罐半斤重，为它占一格货架值不值",
    note: "心情掉得快的局里，甜的比饭先吃完"
  },
{
    id: "canned_vegetable",
    name: "什锦蔬菜罐头",
    category: "food",
    icon: "can-veg-mixed",
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 730,
    nutrition: {
      food: 1,
      health: 1
    },
    basePrice: 10,
    tags: ["canned", "food"],
    tier: 1,
    decision: "唯一耐放的蔬菜来源，味道一般，要不要为健康维专门囤一排",
    note: "两周不吃菜的那几天，它是唯一的菜"
  },
{
    id: "canned_congee",
    name: "八宝粥罐头",
    category: "food",
    icon: "can-congee-eight",
    unitWeight: 0.36,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 720,
    nutrition: {
      food: 2,
      water: 1
    },
    basePrice: 7,
    tags: ["canned", "food"],
    tier: 1,
    decision: "带水的饭，断水局里一罐顶两样，但按热量算不如米划算",
    note: "缺水灾难里它是饭也是水"
  },
{
    id: "compressed_biscuit",
    name: "压缩饼干",
    category: "food",
    icon: "box-biscuit-pressed",
    unitWeight: 0.25,
    slotSize: 1,
    stackLimit: 10,
    perishable: true,
    shelfLifeDays: 1095,
    nutrition: {
      food: 3
    },
    basePrice: 12,
    tags: ["dry", "food"],
    tier: 1,
    decision: "单位重量最顶饿的主食，难吃到影响心情，囤多少是道算术题",
    note: "搬运惩罚大的局里，每公斤最划算的热量"
  },
{
    id: "energy_bar",
    name: "能量棒",
    category: "food",
    icon: "box-energy-bar",
    unitWeight: 0.06,
    slotSize: 1,
    stackLimit: 12,
    perishable: true,
    shelfLifeDays: 365,
    nutrition: {
      food: 1,
      comfort: 1
    },
    basePrice: 9,
    tags: ["dry", "food", "treat"],
    tier: 2,
    decision: "轻到可以塞满缝隙，但按热量算是最贵的主食",
    note: "车载装不下时的补丁，也是送人情的轻便货"
  },
{
    id: "oatmeal_bag",
    name: "燕麦片",
    category: "food",
    icon: "bag-oat-rolled",
    unitWeight: 0.7,
    slotSize: 1,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 365,
    nutrition: {
      food: 2
    },
    basePrice: 14,
    tags: ["grain", "dry", "food"],
    tier: 1,
    decision: "要热水才好吃，燃料紧张的局里它是二等主食",
    note: "燃料富余的局里，它比泡面省水"
  },
{
    id: "dried_noodles",
    name: "挂面",
    category: "food",
    icon: "bag-noodle-dried",
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 540,
    nutrition: {
      food: 3
    },
    basePrice: 9,
    tags: ["dry", "grain", "food"],
    tier: 1,
    decision: "便宜又顶饿，但必须生火煮，停电停气的局里它帮不上忙",
    note: "燃料管够的局里，最便宜的热量"
  },
{
    id: "rice_small",
    name: "小袋米",
    category: "food",
    icon: "bag-rice-small",
    unitWeight: 2,
    slotSize: 2,
    stackLimit: 3,
    perishable: true,
    shelfLifeDays: 365,
    nutrition: {
      food: 3
    },
    basePrice: 18,
    tags: ["grain", "food"],
    tier: 1,
    decision: "比整袋米轻一半、单价贵两成，车载小的身份只能选它",
    note: "手提上限低的身份的主粮方案"
  },
{
    id: "cornmeal_bag",
    name: "玉米面",
    category: "food",
    icon: "bag-cornmeal",
    unitWeight: 1,
    slotSize: 1,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 240,
    nutrition: {
      food: 2
    },
    basePrice: 8,
    tags: ["grain", "dry", "food"],
    tier: 2,
    decision: "比面粉便宜近一半，保质期也更短，省钱还是省心",
    note: "现金紧的开局里，它把口粮预算压到最低"
  },
{
    id: "vermicelli",
    name: "红薯粉条",
    category: "food",
    icon: "bag-vermicelli",
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 730,
    nutrition: {
      food: 2
    },
    basePrice: 7,
    tags: ["dry", "food"],
    tier: 1,
    decision: "耐放又便宜，但光吃它不管饱，它只是别的菜的延伸",
    note: "配罐头吃的填充物，让一罐顶两顿"
  },
{
    id: "instant_rice",
    name: "自热米饭",
    category: "food",
    icon: "box-rice-selfheat",
    unitWeight: 0.35,
    slotSize: 1,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 270,
    nutrition: {
      food: 3,
      comfort: 1
    },
    basePrice: 16,
    tags: ["food", "treat"],
    tier: 2,
    decision: "不用火不用电就能吃上热饭，但一份顶三份挂面的钱",
    note: "大停电和断气局里，唯一的热饭"
  },
{
    id: "ham_sausage",
    name: "火腿肠",
    category: "food",
    icon: "bag-sausage-ham",
    unitWeight: 0.3,
    slotSize: 1,
    stackLimit: 10,
    perishable: true,
    shelfLifeDays: 180,
    nutrition: {
      food: 1
    },
    basePrice: 8,
    tags: ["food"],
    tier: 1,
    decision: "泡面伴侣，单独吃顶不了事，为它花钱等于为口味花钱",
    note: "连续吃泡面的日子里，它是下饭的理由"
  },
{
    id: "vacuum_egg",
    name: "卤蛋",
    category: "food",
    icon: "bag-egg-vacuum",
    unitWeight: 0.05,
    slotSize: 1,
    stackLimit: 10,
    perishable: true,
    shelfLifeDays: 180,
    nutrition: {
      food: 1
    },
    basePrice: 3,
    tags: ["food"],
    tier: 2,
    decision: "最便宜的蛋白质，但一枚也顶不了什么，按把抓还是按个买",
    note: "塞缝级物资，顺手位的常客"
  },
{
    id: "dried_pork",
    name: "猪肉脯",
    category: "food",
    icon: "bag-pork-dried",
    unitWeight: 0.2,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 270,
    nutrition: {
      food: 2,
      comfort: 1
    },
    basePrice: 20,
    tags: ["dry", "food", "treat"],
    tier: 2,
    decision: "又轻又耐放的肉，价格像零食，囤它是为了过日子的感觉",
    note: "生存期中段心情塌陷时，它比罐头管用"
  },
{
    id: "frozen_dumpling",
    name: "速冻饺子",
    category: "food",
    icon: "bag-dumpling-frozen",
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 90,
    nutrition: {
      food: 3,
      comfort: 1
    },
    basePrice: 13,
    tags: ["fresh", "food"],
    tier: 1,
    decision: "好吃顶饿但依赖冰箱，停电局里它是第一天就要吃完的债",
    note: "寒潮局里是硬货，停电局里是陷阱"
  },
{
    id: "fresh_bread",
    name: "吐司面包",
    category: "food",
    icon: "bag-bread-toast",
    unitWeight: 0.3,
    slotSize: 1,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 5,
    nutrition: {
      food: 2
    },
    basePrice: 8,
    tags: ["fresh", "food"],
    tier: 1,
    decision: "五天就坏，灾前买它等于赌灾难准时到",
    note: "囤货期最后两天才值得买的东西"
  },
{
    id: "egg_tray",
    name: "一盒鸡蛋",
    category: "food",
    icon: "carton-egg-tray",
    unitWeight: 0.6,
    slotSize: 2,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 20,
    nutrition: {
      food: 2,
      health: 1
    },
    basePrice: 12,
    tags: ["fresh", "food"],
    tier: 1,
    decision: "二十天保质期的鲜货，占两格还怕颠，囤它要算好日子",
    note: "生存期前段的营养来源，后段指望不上"
  },
{
    id: "cabbage",
    name: "大白菜",
    category: "food",
    icon: "misc-cabbage",
    unitWeight: 1.5,
    slotSize: 2,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 30,
    nutrition: {
      food: 1,
      water: 1
    },
    basePrice: 4,
    tags: ["fresh", "food"],
    tier: 1,
    decision: "四块钱一棵能吃一星期，但一棵占两格，空间换便宜",
    note: "冬天最耐放的鲜菜，寒潮局的性价比之王"
  },
{
    id: "potato_bag",
    name: "一袋土豆",
    category: "food",
    icon: "bag-potato",
    unitWeight: 2,
    slotSize: 2,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 60,
    nutrition: {
      food: 2
    },
    basePrice: 7,
    tags: ["fresh", "food"],
    tier: 1,
    decision: "能放两个月还便宜，但两公斤起买，小车载装不了几袋",
    note: "介于鲜食和主粮之间的过渡物资"
  },
{
    id: "kimchi_jar",
    name: "辣白菜坛子",
    category: "food",
    icon: "jar-kimchi",
    unitWeight: 1,
    slotSize: 2,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 180,
    nutrition: {
      food: 1,
      comfort: 1
    },
    basePrice: 16,
    tags: ["food", "treat"],
    tier: 2,
    decision: "一坛吃半个月，开胃耐放，但一公斤的玻璃坛磕碰不得",
    note: "连续吃罐头的日子里，它是下饭的理由"
  },
{
    id: "peanut_butter",
    name: "花生酱",
    category: "food",
    icon: "jar-peanut-butter",
    unitWeight: 0.35,
    slotSize: 1,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 540,
    nutrition: {
      food: 2,
      comfort: 1
    },
    basePrice: 19,
    tags: ["food", "treat"],
    tier: 2,
    decision: "不用火不用水的高热量，单价不低，为省事付钱",
    note: "停水停气局里的干粮升级项"
  },
{
    id: "honey_jar",
    name: "一罐蜂蜜",
    category: "food",
    icon: "jar-honey",
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 6,
    perishable: false,
    nutrition: {
      food: 1,
      comfort: 2
    },
    basePrice: 28,
    tags: ["food", "treat"],
    tier: 2,
    decision: "唯一真正不过期的吃的，贵，囤它等于给很坏的局买保险",
    note: "保质期焦虑局的终极答案，也能换人情"
  },
{
    id: "sugar_bag",
    name: "白砂糖",
    category: "food",
    icon: "bag-sugar",
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 6,
    perishable: false,
    nutrition: {
      food: 1
    },
    basePrice: 6,
    tags: ["dry", "food"],
    tier: 1,
    decision: "便宜耐放但不算饭，它让别的东西变得能吃",
    note: "冲糖水补体力，也是交换市场上的硬通货"
  },
{
    id: "salt_bag",
    name: "食用盐",
    category: "food",
    icon: "bag-salt",
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 6,
    perishable: false,
    nutrition: {},
    basePrice: 4,
    tags: ["dry", "food"],
    tier: 1,
    decision: "四块钱一包永远用得上，但谁会为四块钱的东西占一格",
    note: "没人抢它，但缺了它饭菜难以下咽"
  },
{
    id: "cooking_oil",
    name: "食用油",
    category: "food",
    icon: "bottle-plastic-oil",
    unitWeight: 0.9,
    slotSize: 2,
    stackLimit: 4,
    perishable: false,
    nutrition: {
      food: 1
    },
    basePrice: 16,
    tags: ["food"],
    tier: 1,
    decision: "买了面粉大米就必须买它，近一公斤的瓶子是搬运负担",
    note: "开火做饭的前提，断粮局的隐形刚需"
  },
{
    id: "milk_powder",
    name: "全脂奶粉",
    category: "food",
    icon: "can-milk-powder",
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 720,
    nutrition: {
      food: 2,
      health: 1
    },
    basePrice: 26,
    tags: ["dry", "food"],
    tier: 1,
    decision: "比鲜奶耐放两年，但要水冲着喝，断水局里它等于面粉",
    note: "有水就是奶，没水就是粉，囤它之前先看水"
  },
{
    id: "baby_formula",
    name: "婴儿奶粉",
    category: "food",
    icon: "can-baby-formula",
    unitWeight: 0.9,
    slotSize: 2,
    stackLimit: 3,
    perishable: true,
    shelfLifeDays: 540,
    nutrition: {
      food: 2,
      health: 1
    },
    basePrice: 45,
    tags: ["dry", "food"],
    tier: 2,
    decision: "全家没人喝它，但出了事它是能换到任何东西的硬货",
    note: "母婴货架被抢空的第一样，留着换人情"
  },
{
    id: "chocolate_bar",
    name: "黑巧克力",
    category: "food",
    icon: "box-chocolate-dark",
    unitWeight: 0.1,
    slotSize: 1,
    stackLimit: 10,
    perishable: true,
    shelfLifeDays: 540,
    nutrition: {
      food: 1,
      comfort: 2
    },
    basePrice: 15,
    tags: ["treat", "food"],
    tier: 1,
    decision: "轻小的高热量，心情和肚子都顾，但热浪局里它会化成一摊",
    note: "寒冷局里的硬通货，炎热局里的风险品"
  },
{
    id: "water_big",
    name: "大桶水",
    category: "water",
    icon: "bottle-plastic-big",
    unitWeight: 5,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {
      water: 3
    },
    basePrice: 15,
    tags: ["water", "drink", "heavy"],
    tier: 1,
    decision: "五公斤一桶最划算的水，但手提上限低的身份根本搬不动",
    note: "断水局里的压舱石"
  },
{
    id: "water_case",
    name: "整箱矿泉水",
    category: "water",
    icon: "carton-water-case",
    unitWeight: 7,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {
      water: 3
    },
    basePrice: 24,
    tags: ["water", "drink", "heavy"],
    tier: 1,
    decision: "比单瓶买便宜三成，但七公斤一箱，买回来就占一整格",
    note: "批发思路的水，适合车载大的身份"
  },
{
    id: "cola_bottle",
    name: "大瓶可乐",
    category: "water",
    icon: "bottle-cola-big",
    unitWeight: 1.3,
    slotSize: 2,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 270,
    nutrition: {
      water: 2,
      comfort: 1
    },
    basePrice: 8,
    tags: ["drink", "water", "treat"],
    tier: 1,
    decision: "能当水喝还能提心情，但按补水算是奢侈的",
    note: "心情维护的暗线物资"
  },
{
    id: "juice_box",
    name: "利乐包果汁",
    category: "water",
    icon: "carton-juice",
    unitWeight: 0.25,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 270,
    nutrition: {
      water: 1,
      comfort: 1
    },
    basePrice: 5,
    tags: ["drink", "water"],
    tier: 2,
    decision: "小包装不压秤，补水效率一般，图的是换换口味",
    note: "给日子留一点甜味"
  },
{
    id: "soda_can",
    name: "苏打水一罐",
    category: "water",
    icon: "can-soda",
    unitWeight: 0.33,
    slotSize: 1,
    stackLimit: 10,
    perishable: true,
    shelfLifeDays: 365,
    nutrition: {
      water: 1
    },
    basePrice: 4,
    tags: ["drink", "water"],
    tier: 1,
    decision: "单价最低的罐装水，堆一摞不心疼，就是不解饿",
    note: "水的最轻包装形态"
  },
{
    id: "coconut_water",
    name: "椰子水",
    category: "water",
    icon: "carton-coconut",
    unitWeight: 0.33,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 270,
    nutrition: {
      water: 2,
      health: 1
    },
    basePrice: 9,
    tags: ["drink", "water"],
    tier: 2,
    decision: "带电解质的天然水，单价是矿泉水的三倍",
    note: "热浪局里它比纯水更顶用"
  },
{
    id: "electrolyte_powder",
    name: "电解质冲剂",
    category: "water",
    icon: "box-electrolyte",
    unitWeight: 0.1,
    slotSize: 1,
    stackLimit: 10,
    perishable: true,
    shelfLifeDays: 730,
    nutrition: {
      water: 1,
      health: 1
    },
    basePrice: 15,
    tags: ["dry", "drink"],
    tier: 2,
    decision: "一百克顶十瓶水的功能，但必须有水可冲",
    note: "热浪局的保命粉，没水的局里它是废纸"
  },
{
    id: "tea_tin",
    name: "茶叶铁罐",
    category: "water",
    icon: "can-tea-leaves",
    unitWeight: 0.15,
    slotSize: 1,
    stackLimit: 8,
    perishable: false,
    nutrition: {
      comfort: 2
    },
    basePrice: 18,
    tags: ["drink", "treat"],
    tier: 2,
    decision: "要热水才有意义，燃料紧张的局里它是负担",
    note: "燃料富余的局里，热茶是最便宜的体面"
  },
{
    id: "orange_drink",
    name: "橘子粉",
    category: "water",
    icon: "bag-drink-orange",
    unitWeight: 0.2,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 540,
    nutrition: {
      water: 1,
      comfort: 1
    },
    basePrice: 6,
    tags: ["dry", "drink"],
    tier: 2,
    decision: "一包冲一壶，便宜讨喜，但占了喝水的份额",
    note: "让人愿意多喝水的办法"
  },
{
    id: "water_pouch",
    name: "应急饮用水",
    category: "water",
    icon: "bag-water-pouch",
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 1095,
    nutrition: {
      water: 2
    },
    basePrice: 12,
    tags: ["water", "drink"],
    tier: 2,
    decision: "三年保质期的水，价格翻三倍，买的是不用操心的确定性",
    note: "放在那就忘了它的那种保险"
  },
  // ═══ 生成内容 物资-01 止 ═══,
  // ═══ 生成内容 物资-02 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "gauze_roll",
    name: "纱布卷",
    category: "medicine",
    icon: "box-gauze-roll",
    unitWeight: 0.12,
    slotSize: 1,
    stackLimit: 6,
    perishable: false,
    nutrition: {
      health: 1
    },
    basePrice: 9,
    tags: ["medkit", "medicine"],
    tier: 1,
    decision: "便宜、量大，但只止血不消炎 —— 伤口烂了它救不回来",
    note: "绷带的「多买几卷也不心疼」版本"
  },
{
    id: "alcohol_bottle",
    name: "医用酒精",
    category: "medicine",
    icon: "bottle-alcohol",
    unitWeight: 0.6,
    slotSize: 2,
    stackLimit: 2,
    perishable: false,
    nutrition: {
      health: 2
    },
    basePrice: 26,
    tags: ["medkit", "medicine", "flammable"],
    tier: 2,
    decision: "能消毒也能当引火物 —— 用它烧了火，伤口就只能拿水冲",
    note: "一物两用，用的是同一瓶"
  },
{
    id: "ors_powder",
    name: "口服补液盐",
    category: "medicine",
    icon: "bag-ors-powder",
    unitWeight: 0.08,
    slotSize: 1,
    stackLimit: 10,
    perishable: true,
    shelfLifeDays: 730,
    nutrition: {
      water: 1,
      health: 1
    },
    basePrice: 7,
    tags: ["medkit", "medicine", "drink"],
    tier: 2,
    decision: "它既算药也算水 —— 归到药那一格，缺水那天你会找不到它",
    note: "归类本身就是个决定"
  },
{
    id: "antibiotic",
    name: "抗生素",
    category: "medicine",
    icon: "box-antibiotic",
    unitWeight: 0.05,
    slotSize: 1,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 540,
    nutrition: {
      health: 3
    },
    basePrice: 68,
    tags: ["medkit", "medicine"],
    tier: 3,
    decision: "最贵的一件，只治感染 —— 而感染是活过第十天之后才会遇到的事",
    note: "买它是为了一件现在还没发生的事"
  },
{
    id: "cough_syrup",
    name: "止咳糖浆",
    category: "medicine",
    icon: "bottle-cough-syrup",
    unitWeight: 0.35,
    slotSize: 2,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 400,
    nutrition: {
      health: 1,
      comfort: 1
    },
    basePrice: 22,
    tags: ["medkit", "medicine"],
    tier: 2,
    decision: "治病顺带哄心情，但一格只放得下两瓶",
    note: "玻璃瓶占地方"
  },
{
    id: "painkiller",
    name: "止痛片",
    category: "medicine",
    icon: "box-painkiller",
    unitWeight: 0.06,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 900,
    nutrition: {
      health: 1,
      comfort: 1
    },
    basePrice: 15,
    tags: ["medkit", "medicine"],
    tier: 1,
    decision: "最便宜的「心情药」—— 但它不治任何真的病",
    note: "把医疗格用来买舒服，是一个真取舍"
  },
{
    id: "burn_cream",
    name: "烫伤膏",
    category: "medicine",
    icon: "box-burn-cream",
    unitWeight: 0.1,
    slotSize: 1,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 600,
    nutrition: {
      health: 2
    },
    basePrice: 19,
    tags: ["medkit", "medicine"],
    tier: 2,
    decision: "只在生火取暖的那几天有用 —— 而不生火你会冻着",
    note: "与燃料那一格直接竞争"
  },
{
    id: "throat_honey",
    name: "润喉蜂蜜",
    category: "medicine",
    icon: "jar-honey-throat",
    unitWeight: 0.7,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: {
      health: 1,
      food: 1,
      comfort: 1
    },
    basePrice: 34,
    tags: ["medkit", "medicine", "treat"],
    tier: 2,
    decision: "一格只放一罐，而它同时是药、是粮、是甜头 —— 三样都不精",
    note: "样样都沾一点的那种货"
  },
{
    id: "candle_pack",
    name: "一包蜡烛",
    category: "fuel",
    icon: "box-candle-pack",
    unitWeight: 0.25,
    slotSize: 1,
    stackLimit: 3,
    perishable: false,
    nutrition: {},
    basePrice: 8,
    tags: ["fuel", "light", "flammable"],
    tier: 1,
    decision: "烧得慢、热得少 —— 它是灯，不是炉子",
    note: "照明与取暖在寒潮里是两件事"
  },
{
    id: "lamp_oil",
    name: "煤油",
    category: "fuel",
    icon: "bottle-lamp-oil",
    unitWeight: 1.8,
    slotSize: 2,
    stackLimit: 2,
    perishable: false,
    nutrition: {},
    basePrice: 30,
    tags: ["fuel", "light", "flammable"],
    tier: 2,
    decision: "比燃料罐耐烧，但一格只放两瓶、而且洒了就没了",
    note: "大瓶装的典型代价"
  },
{
    id: "charcoal_bag",
    name: "一袋木炭",
    category: "fuel",
    icon: "bag-charcoal",
    unitWeight: 3.5,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 16,
    tags: ["fuel", "heavy"],
    tier: 1,
    decision: "便宜、热量足，但整袋 3.5 公斤 —— 上架要占两格还得弯腰搬",
    note: "重货的标准取舍"
  },
{
    id: "gasoline_can",
    name: "汽油桶",
    category: "fuel",
    icon: "bottle-gasoline",
    unitWeight: 6,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 70,
    tags: ["fuel", "flammable", "heavy"],
    tier: 3,
    decision: "一格顶四格的热量，代价是它一个人搬不动、而且怕火",
    note: "最危险也最顶用的那一件"
  },
{
    id: "fire_starter",
    name: "引火块",
    category: "fuel",
    icon: "box-fire-starter",
    unitWeight: 0.3,
    slotSize: 1,
    stackLimit: 6,
    perishable: false,
    nutrition: {},
    basePrice: 12,
    tags: ["fuel", "flammable"],
    tier: 2,
    decision: "本身不顶烧，但没有它，湿柴点不着 —— 是「点火」不是「燃料」",
    note: "它回答的是「能不能点着」，不是「能烧多久」"
  },
{
    id: "firewood",
    name: "劈好的柴",
    category: "fuel",
    icon: "bag-firewood",
    unitWeight: 5,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 20,
    tags: ["fuel", "heavy"],
    tier: 2,
    decision: "最便宜的燃料，但一格只能放一捆、而且必须有引火块",
    note: "便宜的东西往往要求你先有别的"
  },
{
    id: "spirit_lamp",
    name: "酒精炉",
    category: "fuel",
    icon: "bottle-spirit-lamp",
    unitWeight: 0.9,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 55,
    tags: ["fuel", "tool"],
    tier: 3,
    decision: "烧得省，但烧的是医用酒精 —— 炉子和药抢同一瓶",
    note: "与 `alcohol_bottle` 直接抢资源"
  },
{
    id: "down_jacket",
    name: "羽绒服",
    category: "warmth",
    icon: "bag-down-jacket",
    unitWeight: 0.9,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: {
      comfort: 1
    },
    basePrice: 130,
    tags: ["warmth", "soft"],
    tier: 3,
    decision: "穿在身上那一格就省了 —— 但脱下来它就占两格",
    note: "贵，但它是唯一「随身」的保暖"
  },
{
    id: "heat_pack",
    name: "暖宝宝",
    category: "warmth",
    icon: "box-heat-pack",
    unitWeight: 0.05,
    slotSize: 1,
    stackLimit: 12,
    perishable: true,
    shelfLifeDays: 500,
    nutrition: {
      comfort: 2
    },
    basePrice: 4,
    tags: ["warmth", "treat"],
    tier: 1,
    decision: "一片只顶半天，但一格能塞十二片 —— 拿数量换质量",
    note: "消耗品那一类"
  },
{
    id: "long_johns",
    name: "保暖内衣",
    category: "warmth",
    icon: "bag-long-johns",
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 2,
    perishable: false,
    nutrition: {
      comfort: 1
    },
    basePrice: 48,
    tags: ["warmth", "soft"],
    tier: 2,
    decision: "轻、便宜、全天有效 —— 但它不能给第二个人穿",
    note: "单人向的解法"
  },
{
    id: "wool_blanket",
    name: "羊毛毯",
    category: "warmth",
    icon: "bag-wool-blanket",
    unitWeight: 2.2,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {
      comfort: 1
    },
    basePrice: 38,
    tags: ["warmth", "soft", "heavy"],
    tier: 1,
    decision: "比棉被便宜、比棉被薄，但同样占满一格",
    note: "棉被的廉价替代"
  },
{
    id: "hot_water_bottle",
    name: "橡胶热水袋",
    category: "warmth",
    icon: "bottle-hot-water",
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {
      comfort: 2
    },
    basePrice: 28,
    tags: ["warmth", "tool"],
    tier: 2,
    decision: "本身不产热 —— 你得先烧水灌进去，于是它与燃料绑在一起",
    note: "它把「保暖」变成「燃料问题」"
  },
{
    id: "multi_tool",
    name: "多用工具钳",
    category: "tool",
    icon: "box-multitool",
    unitWeight: 0.3,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 88,
    tags: ["tool"],
    tier: 3,
    decision: "一格就够，但它只值这个价当一次「什么都能拧一下」",
    note: "工具箱的轻量替代"
  },
{
    id: "powerbank",
    name: "充电宝",
    category: "tool",
    icon: "box-powerbank",
    unitWeight: 0.45,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 96,
    tags: ["tool", "power"],
    tier: 3,
    decision: "手电与收音机都靠它 —— 但它的电用完就再也充不回来了",
    note: "一次性电力的那种"
  },
{
    id: "rope",
    name: "尼龙绳",
    category: "tool",
    icon: "bag-rope",
    unitWeight: 1.1,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 32,
    tags: ["tool"],
    tier: 2,
    decision: "平时完全用不上，而需要它的那一次没有它过不去",
    note: "纯保险件"
  },
{
    id: "hand_crank_light",
    name: "手摇手电",
    category: "tool",
    icon: "box-hand-crank-light",
    unitWeight: 0.35,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 45,
    tags: ["tool", "light"],
    tier: 2,
    decision: "不用电池，代价是每次用都得先摇一分钟",
    note: "把「电池没了」这个问题删掉"
  },
{
    id: "duct_tape",
    name: "宽胶带",
    category: "tool",
    icon: "bag-duct-tape",
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 2,
    perishable: false,
    nutrition: {},
    basePrice: 14,
    tags: ["tool"],
    tier: 1,
    decision: "补窗户、绑东西、封箱子都行 —— 什么都能凑合，什么都凑合不好",
    note: "最便宜的工具"
  },
{
    id: "tarp",
    name: "防水布",
    category: "tool",
    icon: "bag-tarp",
    unitWeight: 2.6,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 58,
    tags: ["tool", "heavy"],
    tier: 2,
    decision: "一整格换一块挡雨的布 —— 洪水那天它值这个价，别的天不值",
    note: "只在特定灾难里回本的货"
  },
{
    id: "radio_set",
    name: "收音机",
    category: "tool",
    icon: "box-radio-set",
    unitWeight: 0.7,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: {
      comfort: 1
    },
    basePrice: 74,
    tags: ["tool", "power"],
    tier: 3,
    decision: "两格换一个「知道外面怎么了」 —— 情报在这局里不能吃也不能烧",
    note: "它买的是心情与信息，不是物资"
  },
{
    id: "chocolate_gift",
    name: "礼盒巧克力",
    category: "luxury",
    icon: "box-chocolate-gift",
    unitWeight: 0.35,
    slotSize: 1,
    stackLimit: 1,
    perishable: true,
    shelfLifeDays: 300,
    nutrition: {},
    basePrice: 120,
    tags: ["treat", "luxury", "keepsake"],
    tier: 3,
    decision: "一格换一次大心情 —— 而它能换四罐罐头",
    note: "奢侈品里的顶配；它的价值不在数值，在「你还愿不愿意为这个花钱」"
  },
{
    id: "instant_coffee",
    name: "速溶咖啡",
    category: "luxury",
    icon: "jar-instant-coffee",
    unitWeight: 0.2,
    slotSize: 1,
    stackLimit: 1,
    perishable: true,
    shelfLifeDays: 500,
    nutrition: {},
    basePrice: 40,
    tags: ["treat", "luxury"],
    tier: 2,
    decision: "比咖啡豆便宜、比咖啡豆耐放 —— 但没有现磨那种「今天还像样」的感觉",
    note: "与 `coffee_beans` 是一对"
  },
{
    id: "dried_fruit",
    name: "果干",
    category: "luxury",
    icon: "bag-dried-fruit",
    unitWeight: 0.25,
    slotSize: 1,
    stackLimit: 3,
    perishable: true,
    shelfLifeDays: 240,
    nutrition: {},
    basePrice: 26,
    tags: ["treat", "luxury"],
    tier: 2,
    decision: "一格换一次甜头，没有别的用处 —— 它连饿都顶不了",
    note: "最便宜的那一档奢侈：用来验证「玩家还愿不愿意为纯心情花钱」"
  },
  // ═══ 生成内容 物资-02 止 ═══
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
  'luxury'];
