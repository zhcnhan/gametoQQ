/**
 * 身份静态表（§8：MVP 身份 2 个 —— 完整版 5+）。
 *
 * 数值口径（对齐 §8「失衡红线：只要'囤什么都行'成立，整理就失去意义」）：
 *  两个身份刻意做成"钱多 vs 车大"的取舍，而不是强弱之分 ——
 *  团购团长现金多、折扣在主食饮水；夜班员现金少，但车能一次拉更多燃料与工具。
 *
 * 相对 §7 的两处字段扩展（carryLimit / perkRule）理由写在 model/types.ts 的对应注释里。
 */
import { CATEGORY_LABELS } from './items';
import type { CategoryId, IdentityDef, PerkRule } from '../model/types';

export const IDENTITY_DEFS: readonly IdentityDef[] = [
  {
    id: 'group_buyer',
    name: '社区团购团长',
    tagline: '管着一整栋楼的团购群',
    // §12.3 v0.7.1：v0.7 曾提到 1000，实测"钱太多"回调回 900 —— 燃料调价（30→18）之后
    // 约束该由价格来做，不该由钱包做。14 天刚需（燃料 616 + 主食 112 + 水 84）≈ 812，
    // 占现金九成；第二床棉被（54）就得靠人情回款或顶夜班去换。
    startCash: 900,
    vehicleCapacity: 58,
    carryLimit: 16,
    perk: '团购渠道：主食与饮水便宜 15%',
    perkRule: { kind: 'categoryDiscount', categories: ['food', 'water'], rate: 0.15 },
    tier: 1
  },
  {
    id: 'night_shift',
    name: '加油站夜班员',
    tagline: '在加油站上夜班，有一台面包车',
    // §12.3 v0.7.1：夜班员燃料内部价 17/罐，28 罐 = 476，加上主食饮水 ≈ 700，
    // 占现金九成 —— 和团购团长的 812/900 同一个松紧度，身份折扣省下的就是他的余裕。
    startCash: 780,
    vehicleCapacity: 52,
    carryLimit: 22,
    perk: '内部价：燃料与工具便宜 20%',
    perkRule: { kind: 'categoryDiscount', categories: ['fuel', 'tool'], rate: 0.2 },
    tier: 1
  },
  // ═══ 生成内容 身份 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "nurse",
    name: "夜班护士",
    tagline: "在医院上夜班，见惯了半夜来挂急诊的人",
    startCash: 820,
    vehicleCapacity: 46,
    carryLimit: 18,
    perk: "职业习惯：医疗便宜 25%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["medicine"],
      rate: 0.25
    },
    tier: 1,
    decision: "医疗品便宜但车小，把省下的钱压在药上，还是承认这局装不下太多"
  },
{
    id: "delivery_rider",
    name: "外卖骑手",
    tagline: "跑遍了城里每一家店的后门",
    startCash: 700,
    vehicleCapacity: 40,
    carryLimit: 14,
    perk: "熟门熟路：主食便宜 20%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["food"],
      rate: 0.2
    },
    tier: 2,
    decision: "钱少车小但主食最便宜，这局要把口粮成本压到底，别的品类全靠省"
  },
{
    id: "teacher_retired",
    name: "退休教师",
    tagline: "教了四十年书，家里书比米多",
    startCash: 1150,
    vehicleCapacity: 42,
    carryLimit: 12,
    perk: "旧物人缘：享受便宜 30%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["luxury"],
      rate: 0.3
    },
    tier: 3,
    decision: "现金最多但手提最低，这局要靠计划赢，自己的手帮不上忙"
  },
{
    id: "warehouse_porter",
    name: "装卸工",
    tagline: "在物流园扛了八年包，力气是本钱",
    startCash: 680,
    vehicleCapacity: 72,
    carryLimit: 30,
    /*
     * ★ W-06：这个身份的天赋**不再是折扣**，而是"每趟翻找少花两成体力"。
     *
     * 为什么必须是它：十个身份原来的天赋全是 `categoryDiscount`，全部只在
     * `systems/shop.ts` 生效 —— 也就是**所有身份都在改"囤什么划算"，
     * 没有一个改"整理划不划算"**。而这份文件开头自己写着失衡红线：
     * 只要"囤什么都行"成立，整理就失去意义。这条天赋是那条红线上的第一个例外。
     *
     * ⚠ 一个身份只能有一个 `perkRule`。所以"保暖与燃料便宜 10%"（原来那条）
     * 降级成**附加文案**留在 `perk` 里，不再被执行 —— 别把它当成还在生效的规则。
     */
    perk: "力气是本钱：翻找省力 20% · 工友价：保暖与燃料便宜 10%",
    perkRule: { kind: "workCostFactor", rate: 0.8 },
    tier: 3,
    decision: "钱最少但力气最大，一天能搬别人两天的量，问题是搬什么回来"
  },
{
    id: "security_guard",
    name: "小区保安",
    tagline: "在这小区看了六年门，家家户户都脸熟",
    startCash: 760,
    vehicleCapacity: 50,
    carryLimit: 20,
    /*
     * ★ W-06：唯一一个把顺手位上限抬到 2 的身份。
     *
     * §12.3 v0.7.1 把顺手位定成"全屋唯一"（玩家实测后拍板：能标两块就会有人全标上），
     * 所以这是一处**刻意的破例**，破例的理由必须具体到这个人的经历上：
     * 看了六年门的人知道别人不知道的入口。
     *
     * ⚠ 它只抬**上限**，不替玩家标 —— 两块仍然要玩家自己在整理页点出来，
     * 而且**有顺位**（1 号位排在前面，`model/score.ts` 的应急率按它从先到后数）。
     * 同上一处：饮水与保暖的 15% 降级成附加文案。
     */
    perk: "看了六年门：顺手位可以标两块 · 业主关系：饮水与保暖便宜 15%",
    perkRule: { kind: "extraHandySlot" },
    tier: 2,
    decision: "什么都会一点但没有长项，这局要靠不犯错赢"
  },
{
    id: "tailor",
    name: "裁缝",
    tagline: "开了十五年裁缝铺，碎布头都舍不得扔",
    startCash: 790,
    vehicleCapacity: 45,
    carryLimit: 15,
    perk: "布料渠道：保暖便宜 25%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["warmth"],
      rate: 0.25
    },
    tier: 2,
    decision: "保暖最便宜但手提小，这局要把'冷'这件事用钱解决"
  },
  // ═══ 生成内容 身份 止 ═══,
  // ═══ 生成内容 身份-02 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "fuel_depot_guard",
    name: "燃料库夜间门卫",
    tagline: "在油库值了六年夜班，哪根阀门什么脾气你都清楚",
    startCash: 640,
    vehicleCapacity: 68,
    carryLimit: 26,
    perk: "知道后门在哪：燃料便宜 35%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["fuel"],
      rate: 0.35
    },
    tier: 4,
    decision: "燃料便宜三成半、车也大，但手上现金是所有人里最少的 —— 前三天你会很紧"
  },
{
    id: "hospital_pharmacist",
    name: "医院药房",
    tagline: "在药房窗口后面站了十年，看一眼就知道该拿哪一格",
    startCash: 660,
    vehicleCapacity: 38,
    carryLimit: 10,
    perk: "认得每一盒：医疗便宜 35%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["medicine"],
      rate: 0.35
    },
    tier: 4,
    decision: "药最便宜，但车载与手提都是最低那一档 —— 你能把药价压到地上，却搬不回多少"
  },
  // ═══ 生成内容 身份-02 止 ═══
];

const IDENTITY_BY_ID: ReadonlyMap<string, IdentityDef> = new Map(IDENTITY_DEFS.map((d) => [d.id, d]));

export function getIdentityDef(identityId: string): IdentityDef {
  const def = IDENTITY_BY_ID.get(identityId);
  if (!def) throw new Error(`未知身份 id: ${identityId}`);
  return def;
}

export function hasIdentityDef(identityId: string): boolean {
  return IDENTITY_BY_ID.has(identityId);
}

// ———————— 天赋读点：给 systems / ui 问的那几个问题 ————————

/**
 * ★★ 这一组读点**收 `identityId: string` 并且认不出时给默认值，绝不抛**。
 *
 * 原设计收 `IdentityDef`（调用方先 `getIdentityDef(id)`），看着更类型安全 ——
 * 一接上就红了 **37 条**：`getIdentityDef('')` 会
 * `throw new Error('未知身份 id: ')`，而单测里满屏都是
 * `{ ...run, identityId: '' }` 这种骨架状态。
 *
 * 教训值得单独记：**一个"设了默认值但会抛"的查询比没有默认值更糟** ——
 * 它看起来安全，实际不是。所以这里四件事一起做：
 * 收 id（不逼调用方先查表）、认不出给中性值（0 折扣 / 1 倍成本 / 1 个位置）、
 * 经同一个 `perkRuleOf` 出口、并且都有 `data/identities.test.ts` 逐条钉住。
 */
function perkRuleOf(identityId: string): PerkRule | null {
  return IDENTITY_BY_ID.get(identityId)?.perkRule ?? null;
}

/** 这个身份的某品类折扣。`0` = 不打折（认不出身份也是 0） */
export function identityCategoryRate(identityId: string, category: CategoryId): number {
  const rule = perkRuleOf(identityId);
  if (rule?.kind !== 'categoryDiscount') return 0;
  return rule.categories.includes(category) ? rule.rate : 0;
}

/**
 * 这个身份翻找劳作的**成本乘数**：`0.8` = 少花两成。
 *
 * ⚠ 它只能在读点上乘（`systems/survival.ts` 的日报、`systems/help.ts` 的凑单），
 * **不能塞进 `data/survival.ts` 的 `workCostOf`** —— 那是 §6.4 的基准账
 * （1.0→9.0 / 0.5→18.0 / 0.0→27.0），三条永久回归探针照着它算。
 * 一处乘一处不乘的表现是"日报说少花了、隔天凑订单又没花"，
 * 两个数各自都"对"，所以不会有任何报错。
 */
export function identityWorkFactor(identityId: string): number {
  const rule = perkRuleOf(identityId);
  return rule?.kind === 'workCostFactor' ? rule.rate : 1;
}

/**
 * 顺手位**玩法上限**（§12.3 v0.7.1 定的"全屋唯一"，`extraHandySlot` 是唯一破例）。
 *
 * ⚠ 与 `model/shelf.ts` 的 `HANDY_SLOTS` 分工不同：那个是**容量**，存档层按它钳制、
 * 看不见身份（否则 `save → data/identities` 就成了一条反向依赖）；
 * 这个只在命令层与界面被问 —— 也就是"这一局允许标几块"。
 */
export function handySlotLimitOf(identityId: string): number {
  const rule = perkRuleOf(identityId);
  return rule?.kind === 'extraHandySlot' ? 2 : 1;
}

// ———————— 天赋文案：从规则文字化 ————————

/**
 * 品类的中文名。
 *
 * ★ **刻意从 `data/items.ts` 的 `CATEGORY_LABELS` 取，不在这里另写一份。**
 *
 * 这里原来有一份自己的小表，而它与 `CATEGORY_LABELS` 有**两处不一致**：
 * 它写"医疗品 / 奢侈品"，而全界面（胶带胶囊、图鉴、日报、商店）用的是
 * "医疗 / 享受"。于是同一个品类在身份卡上叫一个名字、在胶带上叫另一个 ——
 * 玩家会以为它们是两种东西，而这两处**永远不会同时出现在一屏上**，
 * 所以谁也不会报这个 bug。
 *
 * 这正是"品类中文名的唯一口径"该有的形状：一份数据，人人来取。
 */
const CATEGORY_NAMES: Record<string, string> = CATEGORY_LABELS;

/** 把一个小数说成百分数（`0.15` → `'15%'`）。天赋文案与 `perkText` 共用同一个口径 */
export function percentOf(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * ★ 把 `PerkRule` 说成人话。**这是天赋"真正生效的那一条"的唯一文字来源。**
 *
 * ## 为什么不让 `perk` 字段自己写
 *
 * W-06 往 `PerkRule` 里加了两个成员之后，`identity.perk` 那十个字符串
 * 全部只描述了 `categoryDiscount` 那一半 —— 如果新天赋不写进去，
 * 玩家会看到"装卸工：工友价 便宜 10%"，而真正让这个身份好玩的那一条
 * **一个字都不在界面上**。而那正是 §10.1A 那条铁则（"任何东西都要让我有感知"）
 * 要拦的事，只不过它拦的是**反向**的：不是"写了没生效"，是"生效了但没写"。
 *
 * 所以每条规则都必须能文字化，并由 `data/identities.test.ts` 逐条核对
 * `def.perk` 里真的含有这段文字 —— 让"忘了写"变成一条会红的断言，而不是
 * 一个要靠人看出来的空缺。
 *
 * ⚠ 文案里的**空格是判据的一部分**：十个身份的中文习惯都是
 * "医疗便宜 25%"（数字前留一个空格），所以这里也留 —— 写的时候同时参考
 * `CATEGORY_NAMES`（= `CATEGORY_LABELS`）里那个品类到底叫什么。
 * 不留空格、或用另一个中文名，`perk.includes(perkText(rule))` 就会对着
 * 十条**正确**的文案报红，而一条会误报的守卫迟早会被人注释掉。
 */
export function perkText(rule: PerkRule): string {
  switch (rule.kind) {
    case 'none':
      return '没有特别的门路';
    case 'categoryDiscount':
      return `${rule.categories.map((c) => CATEGORY_NAMES[c] ?? c).join('与')}便宜 ${percentOf(rule.rate)}`;
    case 'workCostFactor':
      return `翻找省力 ${percentOf(1 - rule.rate)}`;
    case 'extraHandySlot':
      return '顺手位可以标两块';
  }
}
