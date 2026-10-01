/**
 * 囤货期点位静态表（§6.2：地图点位 = 超市 / 药店 / 五金建材 / 农贸市场 / 黑市；
 * M1 范围只取前 3 个：超市 / 药店 / 五金店）。
 *
 * 设计口径：
 *  - 同一件物资在多个点位有售时，靠 ShopDef.priceFactor 拉开差价 —— 五金店的燃料最贵，
 *    这就是"跑几个点位"的取舍来源（§6.2 的行动点设计要想成立，点位之间必须不重合）。
 *  - 商品池与 §8 的 12 种物资严格对齐，不新增物资（加内容=加静态表，不动代码）。
 */
import type { ShopDef, ShopId } from '../model/types';

export const SHOP_DEFS: readonly ShopDef[] = [
  {
    id: 'supermarket',
    name: '超市',
    blurb: '粮油菜水最全，也是最早被抢空的地方',
    priceFactor: 1,
    offers: [
      { itemId: 'canned_beans', stock: 8 },
      { itemId: 'instant_noodles', stock: 12 },
      { itemId: 'rice_bag', stock: 3 },
      { itemId: 'flour', stock: 4 },
      { itemId: 'mineral_water', stock: 10 },
      { itemId: 'milk', stock: 5 },
      { itemId: 'battery', stock: 6 }
    ]
  },
  {
    id: 'pharmacy',
    name: '药店',
    blurb: '绷带与感冒药，柜台后面还堆着几箱水',
    priceFactor: 1.15,
    offers: [
      { itemId: 'bandage', stock: 10 },
      { itemId: 'cold_medicine', stock: 6 },
      { itemId: 'mineral_water', stock: 4 }
    ]
  },
  {
    id: 'hardware',
    name: '五金店',
    blurb: '燃料、工具、棉被 —— 寒潮一来，这里最贵',
    priceFactor: 1.2,
    offers: [
      { itemId: 'fuel_can', stock: 5 },
      { itemId: 'toolbox', stock: 2 },
      { itemId: 'quilt', stock: 4 },
      { itemId: 'battery', stock: 8 },
      { itemId: 'bandage', stock: 3 }
    ]
  }
];

const SHOP_BY_ID: ReadonlyMap<string, ShopDef> = new Map(SHOP_DEFS.map((s) => [s.id, s]));

export function getShopDef(shopId: string): ShopDef {
  const def = SHOP_BY_ID.get(shopId);
  if (!def) throw new Error(`未知点位 id: ${shopId}`);
  return def;
}

export function isShopId(value: string): value is ShopId {
  return SHOP_BY_ID.has(value);
}

/**
 * 每天行动点（§6.2：每天 2~3 个行动点；M1 取上界 3）。
 * 语义按已拍板：1 行动点 = 进一个店门（店内可买多件，分趟搬货不扣点）。
 */
export const ACTION_POINTS_PER_DAY = 3;
