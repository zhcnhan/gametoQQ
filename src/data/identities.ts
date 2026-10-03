/**
 * 身份静态表（§8：MVP 身份 2 个 —— 完整版 5+）。
 *
 * 数值口径（对齐 §8「失衡红线：只要'囤什么都行'成立，整理就失去意义」）：
 *  两个身份刻意做成"钱多 vs 车大"的取舍，而不是强弱之分 ——
 *  团购团长现金多、折扣在主食饮水；夜班员现金少，但车能一次拉更多燃料与工具。
 *
 * 相对 §7 的两处字段扩展（carryLimit / perkRule）理由写在 model/types.ts 的对应注释里。
 */
import type { IdentityDef } from '../model/types';

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
  // ═══ 生成内容 identity-01 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "nurse",
    name: "夜班护士",
    tagline: "在医院上夜班，见惯了半夜来挂急诊的人",
    startCash: 820,
    vehicleCapacity: 46,
    carryLimit: 18,
    perk: "职业习惯：医疗品便宜 25%",
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
    perk: "旧物人缘：奢侈品便宜 30%",
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
    perk: "工友价：保暖与燃料便宜 10%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["warmth", "fuel"],
      rate: 0.1
    },
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
    perk: "业主关系：饮水与保暖便宜 15%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["water", "warmth"],
      rate: 0.15
    },
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
    perk: "布料渠道：保暖品便宜 25%",
    perkRule: {
      kind: "categoryDiscount",
      categories: ["warmth"],
      rate: 0.25
    },
    tier: 2,
    decision: "保暖最便宜但手提小，这局要把'冷'这件事用钱解决"
  },
  // ═══ 生成内容 identity-01 止 ═══
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
