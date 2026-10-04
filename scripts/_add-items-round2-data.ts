/**
 * 第 II 批物资的**数据**（30 件，补齐五个稀疏品类）。
 *
 * ★ 这个文件只放数据，不放"怎么入库" —— 入库走正规流程：
 *
 *     npx vite-node scripts/_make-batch2.ts     # 写出 content/物资/物资-02.json
 *     node scripts/check-content.mjs content/物资/物资-02.json
 *     node scripts/merge-content.mjs 物资-02      # 幂等，可反复重跑
 *
 * ⚠ 它**不是长期资产**：内容一旦入库，`src/data/items.ts` 与
 * `content/物资/物资-02.json` 才是真相，这个 .ts 只是那次搬运的中转站。
 * 留着它的唯一理由是"让那次搬运可复查"（当时是怎么写的、哪几条写错过）。
 */
export interface ItemRow {
  id: string;
  name: string;
  category: string;
  icon: string;
  unitWeight: number;
  slotSize: number;
  stackLimit: number;
  perishable: boolean;
  shelfLifeDays?: number;
  nutrition: Record<string, number>;
  basePrice: number;
  tags: string[];
  tier: number;
  decision: string;
  note: string;
}

export const ROWS: ItemRow[] = [
  // ─────────────────────────── 医疗（2 → 10） ───────────────────────────
  {
    id: 'gauze_roll',
    name: '纱布卷',
    category: 'medicine',
    icon: 'box-gauze-roll',
    unitWeight: 0.12,
    slotSize: 1,
    stackLimit: 6,
    perishable: false,
    nutrition: { health: 1 },
    basePrice: 9,
    tags: ['medkit', 'medicine'],
    tier: 1,
    decision: '便宜、量大，但只止血不消炎 —— 伤口烂了它救不回来',
    note: '绷带的「多买几卷也不心疼」版本'
  },
  {
    id: 'alcohol_bottle',
    name: '医用酒精',
    category: 'medicine',
    icon: 'bottle-alcohol',
    unitWeight: 0.6,
    slotSize: 2,
    stackLimit: 2,
    perishable: false,
    nutrition: { health: 2 },
    basePrice: 26,
    tags: ['medkit', 'medicine', 'flammable'],
    tier: 2,
    decision: '能消毒也能当引火物 —— 用它烧了火，伤口就只能拿水冲',
    note: '一物两用，用的是同一瓶'
  },
  {
    id: 'ors_powder',
    name: '口服补液盐',
    category: 'medicine',
    icon: 'bag-ors-powder',
    unitWeight: 0.08,
    slotSize: 1,
    stackLimit: 10,
    perishable: true,
    shelfLifeDays: 730,
    nutrition: { water: 1, health: 1 },
    basePrice: 7,
    tags: ['medkit', 'medicine', 'drink'],
    tier: 2,
    decision: '它既算药也算水 —— 归到药那一格，缺水那天你会找不到它',
    note: '归类本身就是个决定'
  },
  {
    id: 'antibiotic',
    name: '抗生素',
    category: 'medicine',
    icon: 'box-antibiotic',
    unitWeight: 0.05,
    slotSize: 1,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 540,
    nutrition: { health: 3 },
    basePrice: 68,
    tags: ['medkit', 'medicine'],
    tier: 3,
    decision: '最贵的一件，只治感染 —— 而感染是活过第十天之后才会遇到的事',
    note: '买它是为了一件现在还没发生的事'
  },
  {
    id: 'cough_syrup',
    name: '止咳糖浆',
    category: 'medicine',
    icon: 'bottle-cough-syrup',
    unitWeight: 0.35,
    slotSize: 2,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 400,
    nutrition: { health: 1, comfort: 1 },
    basePrice: 22,
    tags: ['medkit', 'medicine'],
    tier: 2,
    decision: '治病顺带哄心情，但一格只放得下两瓶',
    note: '玻璃瓶占地方'
  },
  {
    id: 'painkiller',
    name: '止痛片',
    category: 'medicine',
    icon: 'box-painkiller',
    unitWeight: 0.06,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 900,
    nutrition: { health: 1, comfort: 1 },
    basePrice: 15,
    tags: ['medkit', 'medicine'],
    tier: 1,
    decision: '最便宜的「心情药」—— 但它不治任何真的病',
    note: '把医疗格用来买舒服，是一个真取舍'
  },
  {
    id: 'burn_cream',
    name: '烫伤膏',
    category: 'medicine',
    icon: 'box-burn-cream',
    unitWeight: 0.1,
    slotSize: 1,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 600,
    nutrition: { health: 2 },
    basePrice: 19,
    tags: ['medkit', 'medicine'],
    tier: 2,
    decision: '只在生火取暖的那几天有用 —— 而不生火你会冻着',
    note: '与燃料那一格直接竞争'
  },
  {
    id: 'throat_honey',
    name: '润喉蜂蜜',
    category: 'medicine',
    icon: 'jar-honey-throat',
    unitWeight: 0.7,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: { health: 1, food: 1, comfort: 1 },
    basePrice: 34,
    tags: ['medkit', 'medicine', 'treat'],
    tier: 2,
    decision: '一格只放一罐，而它同时是药、是粮、是甜头 —— 三样都不精',
    note: '样样都沾一点的那种货'
  },
  // ─────────────────────────── 燃料（1 → 8） ───────────────────────────
  {
    id: 'candle_pack',
    name: '一包蜡烛',
    category: 'fuel',
    icon: 'box-candle-pack',
    unitWeight: 0.25,
    slotSize: 1,
    stackLimit: 3,
    perishable: false,
    nutrition: {},
    basePrice: 8,
    tags: ['fuel', 'light', 'flammable'],
    tier: 1,
    decision: '烧得慢、热得少 —— 它是灯，不是炉子',
    note: '照明与取暖在寒潮里是两件事'
  },
  {
    id: 'lamp_oil',
    name: '煤油',
    category: 'fuel',
    icon: 'bottle-lamp-oil',
    unitWeight: 1.8,
    slotSize: 2,
    stackLimit: 2,
    perishable: false,
    nutrition: {},
    basePrice: 30,
    tags: ['fuel', 'light', 'flammable'],
    tier: 2,
    decision: '比燃料罐耐烧，但一格只放两瓶、而且洒了就没了',
    note: '大瓶装的典型代价'
  },
  {
    id: 'charcoal_bag',
    name: '一袋木炭',
    category: 'fuel',
    icon: 'bag-charcoal',
    unitWeight: 3.5,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 16,
    tags: ['fuel', 'heavy'],
    tier: 1,
    decision: '便宜、热量足，但整袋 3.5 公斤 —— 上架要占两格还得弯腰搬',
    note: '重货的标准取舍'
  },
  {
    id: 'gasoline_can',
    name: '汽油桶',
    category: 'fuel',
    icon: 'bottle-gasoline',
    unitWeight: 6,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 70,
    tags: ['fuel', 'flammable', 'heavy'],
    tier: 3,
    decision: '一格顶四格的热量，代价是它一个人搬不动、而且怕火',
    note: '最危险也最顶用的那一件'
  },
  {
    id: 'fire_starter',
    name: '引火块',
    category: 'fuel',
    icon: 'box-fire-starter',
    unitWeight: 0.3,
    slotSize: 1,
    stackLimit: 6,
    perishable: false,
    nutrition: {},
    basePrice: 12,
    tags: ['fuel', 'flammable'],
    tier: 2,
    decision: '本身不顶烧，但没有它，湿柴点不着 —— 是「点火」不是「燃料」',
    note: '它回答的是「能不能点着」，不是「能烧多久」'
  },
  {
    id: 'firewood',
    name: '劈好的柴',
    category: 'fuel',
    icon: 'bag-firewood',
    unitWeight: 5,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 20,
    tags: ['fuel', 'heavy'],
    tier: 2,
    decision: '最便宜的燃料，但一格只能放一捆、而且必须有引火块',
    note: '便宜的东西往往要求你先有别的'
  },
  {
    id: 'spirit_lamp',
    name: '酒精炉',
    category: 'fuel',
    icon: 'bottle-spirit-lamp',
    unitWeight: 0.9,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 55,
    tags: ['fuel', 'tool'],
    tier: 3,
    decision: '烧得省，但烧的是医用酒精 —— 炉子和药抢同一瓶',
    note: '与 `alcohol_bottle` 直接抢资源'
  },
  // ─────────────────────────── 保暖（1 → 6） ───────────────────────────
  {
    id: 'down_jacket',
    name: '羽绒服',
    category: 'warmth',
    icon: 'bag-down-jacket',
    unitWeight: 0.9,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: { comfort: 1 },
    basePrice: 130,
    tags: ['warmth', 'soft'],
    tier: 3,
    decision: '穿在身上那一格就省了 —— 但脱下来它就占两格',
    note: '贵，但它是唯一「随身」的保暖'
  },
  {
    id: 'heat_pack',
    name: '暖宝宝',
    category: 'warmth',
    icon: 'box-heat-pack',
    unitWeight: 0.05,
    slotSize: 1,
    stackLimit: 12,
    perishable: true,
    shelfLifeDays: 500,
    nutrition: { comfort: 2 },
    basePrice: 4,
    tags: ['warmth', 'treat'],
    tier: 1,
    decision: '一片只顶半天，但一格能塞十二片 —— 拿数量换质量',
    note: '消耗品那一类'
  },
  {
    id: 'long_johns',
    name: '保暖内衣',
    category: 'warmth',
    icon: 'bag-long-johns',
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 2,
    perishable: false,
    nutrition: { comfort: 1 },
    basePrice: 48,
    tags: ['warmth', 'soft'],
    tier: 2,
    decision: '轻、便宜、全天有效 —— 但它不能给第二个人穿',
    note: '单人向的解法'
  },
  {
    id: 'wool_blanket',
    name: '羊毛毯',
    category: 'warmth',
    icon: 'bag-wool-blanket',
    unitWeight: 2.2,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: { comfort: 1 },
    basePrice: 38,
    tags: ['warmth', 'soft', 'heavy'],
    tier: 1,
    decision: '比棉被便宜、比棉被薄，但同样占满一格',
    note: '棉被的廉价替代'
  },
  {
    id: 'hot_water_bottle',
    name: '橡胶热水袋',
    category: 'warmth',
    icon: 'bottle-hot-water',
    unitWeight: 0.5,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: { comfort: 2 },
    basePrice: 28,
    tags: ['warmth', 'tool'],
    tier: 2,
    decision: '本身不产热 —— 你得先烧水灌进去，于是它与燃料绑在一起',
    note: '它把「保暖」变成「燃料问题」'
  },
  // ─────────────────────────── 工具（2 → 9） ───────────────────────────
  {
    id: 'multi_tool',
    name: '多用工具钳',
    category: 'tool',
    icon: 'box-multitool',
    unitWeight: 0.3,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 88,
    tags: ['tool'],
    tier: 3,
    decision: '一格就够，但它只值这个价当一次「什么都能拧一下」',
    note: '工具箱的轻量替代'
  },
  {
    id: 'powerbank',
    name: '充电宝',
    category: 'tool',
    icon: 'box-powerbank',
    unitWeight: 0.45,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 96,
    tags: ['tool', 'power'],
    tier: 3,
    decision: '手电与收音机都靠它 —— 但它的电用完就再也充不回来了',
    note: '一次性电力的那种'
  },
  {
    id: 'rope',
    name: '尼龙绳',
    category: 'tool',
    icon: 'bag-rope',
    unitWeight: 1.1,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 32,
    tags: ['tool'],
    tier: 2,
    decision: '平时完全用不上，而需要它的那一次没有它过不去',
    note: '纯保险件'
  },
  {
    id: 'hand_crank_light',
    name: '手摇手电',
    category: 'tool',
    icon: 'box-hand-crank-light',
    unitWeight: 0.35,
    slotSize: 1,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 45,
    tags: ['tool', 'light'],
    tier: 2,
    decision: '不用电池，代价是每次用都得先摇一分钟',
    note: '把「电池没了」这个问题删掉'
  },
  {
    id: 'duct_tape',
    name: '宽胶带',
    category: 'tool',
    icon: 'bag-duct-tape',
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 2,
    perishable: false,
    nutrition: {},
    basePrice: 14,
    tags: ['tool'],
    tier: 1,
    decision: '补窗户、绑东西、封箱子都行 —— 什么都能凑合，什么都凑合不好',
    note: '最便宜的工具'
  },
  {
    id: 'tarp',
    name: '防水布',
    category: 'tool',
    icon: 'bag-tarp',
    unitWeight: 2.6,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 58,
    tags: ['tool', 'heavy'],
    tier: 2,
    decision: '一整格换一块挡雨的布 —— 洪水那天它值这个价，别的天不值',
    note: '只在特定灾难里回本的货'
  },
  {
    id: 'radio_set',
    name: '收音机',
    category: 'tool',
    icon: 'box-radio-set',
    unitWeight: 0.7,
    slotSize: 2,
    stackLimit: 1,
    perishable: false,
    nutrition: { comfort: 1 },
    basePrice: 74,
    tags: ['tool', 'power'],
    tier: 3,
    decision: '两格换一个「知道外面怎么了」 —— 情报在这局里不能吃也不能烧',
    note: '它买的是心情与信息，不是物资'
  },
  // ─────────────────────────── 享受（5 → 8） ───────────────────────────
  {
    id: 'chocolate_gift',
    name: '礼盒巧克力',
    category: 'luxury',
    icon: 'box-chocolate-gift',
    unitWeight: 0.35,
    slotSize: 1,
    stackLimit: 1,
    perishable: true,
    shelfLifeDays: 300,
    /*
     * ★ `nutrition` 必须**全空** —— 这一条我第一版写错了，是测试纠正的我。
     *
     * 我原来给了 `{ comfort: 3 }`，想法是「礼盒巧克力该最哄人」。但
     * `data/survival.ts` 的 `shelterOf()` 读的正是 `nutrition.comfort`，
     * 每点换 **4 点庇护所回复**，而且是**自动**从库存里取的（庇护所跌破线就开箱）。
     *
     * 于是「最哄人的零食」会变成一件**真的生存物资**：囤它等于囤庇护所。
     * 而 `codex.test.ts` 那条规则（奢侈品不许进自动补给链）说的就是这件事 ——
     * 奢侈品的价值只能是图鉴与赌性，**不能是数值**。
     */
    nutrition: {},
    basePrice: 120,
    tags: ['treat', 'luxury', 'keepsake'],
    tier: 3,
    decision: '一格换一次大心情 —— 而它能换四罐罐头',
    note: '奢侈品里的顶配；它的价值不在数值，在「你还愿不愿意为这个花钱」'
  },
  {
    id: 'instant_coffee',
    name: '速溶咖啡',
    category: 'luxury',
    icon: 'jar-instant-coffee',
    unitWeight: 0.2,
    slotSize: 1,
    stackLimit: 1,
    perishable: true,
    shelfLifeDays: 500,
    nutrition: {},
    basePrice: 40,
    tags: ['treat', 'luxury'],
    tier: 2,
    decision: '比咖啡豆便宜、比咖啡豆耐放 —— 但没有现磨那种「今天还像样」的感觉',
    note: '与 `coffee_beans` 是一对'
  },
  {
    id: 'dried_fruit',
    name: '果干',
    category: 'luxury',
    icon: 'bag-dried-fruit',
    unitWeight: 0.25,
    slotSize: 1,
    stackLimit: 3,
    perishable: true,
    shelfLifeDays: 240,
    /*
     * ⚠ 同上：这里**不能**写 `food`。写了它就同时是粮、又便宜，
     * 于是「囤零食」变成一条划算的路 —— 而那正是奢侈品唯一不许成为的东西。
     * 想吃果干，你就得真的拿一格货架与几十块钱去换一次心情。
     */
    nutrition: {},
    basePrice: 26,
    tags: ['treat', 'luxury'],
    tier: 2,
    decision: '一格换一次甜头，没有别的用处 —— 它连饿都顶不了',
    note: '最便宜的那一档奢侈：用来验证「玩家还愿不愿意为纯心情花钱」'
  }
];
