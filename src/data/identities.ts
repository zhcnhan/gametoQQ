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
    tagline: '手里攥着一整栋楼的需求清单',
    // §12.3 v0.7.1：v0.7 曾提到 1000，实测"钱太多"回调回 900 —— 燃料调价（30→18）之后
    // 约束该由价格来做，不该由钱包做。14 天刚需（燃料 616 + 主食 112 + 水 84）≈ 812，
    // 占现金九成；第二床棉被（54）就得靠人情回款或顶夜班去换。
    startCash: 900,
    vehicleCapacity: 58,
    carryLimit: 16,
    perk: '团购渠道：主食与饮水便宜 15%',
    perkRule: { kind: 'categoryDiscount', categories: ['food', 'water'], rate: 0.15 }
  },
  {
    id: 'night_shift',
    name: '加油站夜班员',
    tagline: '油枪、卷帘门，和一台随时能开走的面包车',
    // §12.3 v0.7.1：夜班员燃料内部价 17/罐，28 罐 = 476，加上主食饮水 ≈ 700，
    // 占现金九成 —— 和团购团长的 812/900 同一个松紧度，身份折扣省下的就是他的余裕。
    startCash: 780,
    vehicleCapacity: 52,
    carryLimit: 22,
    perk: '内部价：燃料与工具便宜 20%',
    perkRule: { kind: 'categoryDiscount', categories: ['fuel', 'tool'], rate: 0.2 }
  }
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
