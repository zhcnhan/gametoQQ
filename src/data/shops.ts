/**
 * 囤货期点位静态表（§6.2：地图点位 = 超市 / 药店 / 五金建材 / 农贸市场 / 黑市；
 * M1 范围只取前 3 个：超市 / 药店 / 五金店）。
 *
 * `DEFERRED(D-24): 内容的「校验」做了（scripts/check-content.mjs），但「注册表」还没做`
 * —— 见 `docs/囤货末世-游戏策划案.md` §10B.5 与 `src/meta/deferred.ts` 的 D-24。
 * 两者分工不同：**校验**管"进来的数据合不合格"（构建期），
 * **注册表**管"已经进来的内容怎么被查询与遍历"（运行期，图鉴 / 成就 / 解锁的输入）。
 * 本文件是"加一家店只改这里"的示范：加店不需要动 `model/types.ts`。
 *
 * ## ★ 加一家店只需要在这里加一条（§10B.5：加内容 = 加一行数据，不动代码）
 *
 * 原来 `ShopId` 是字面量联合类型（`'supermarket' | 'pharmacy' | 'hardware'`），
 * 于是**每加一家店都要去改 `model/types.ts`** —— §10B 要把点位扩到十几个，
 * 那样会反复动类型文件。现在 `ShopId = string`，约束由两处守：
 *  · 本文件的 `isShopId()`（运行期真相，存档自愈用它）；
 *  · `scripts/check-content.mjs`（构建期静态校验，拦住悬空引用与离群数值）。
 *
 * ## 设计口径（加店时必须遵守，否则"跑几个点位"的取舍会塌掉）
 *
 *  - **同一件物资在多个点位有售时，靠 `priceFactor` 拉开差价** ——
 *    五金店的燃料最贵，这就是"跑几个点位"的取舍来源（§6.2 的行动点设计要想成立，
 *    点位之间**必须不重合**）。新店也要有自己的"最划算品类"，否则它只是多一次点击；
 *  - `offers` 里引用的 `itemId` **必须真实存在**（构建期校验会拦）；
 *  - `actionCost`：进这家店花几点行动点。默认 1；远的地方（郊区仓库、批发市场）
 *    可以是 2 —— 那是"更便宜但要花更多时间"的取舍，也是新店能做出差异的地方。
 */
import type { ShopDef, ShopId } from '../model/types';

export const SHOP_DEFS: readonly ShopDef[] = [
  {
    id: 'supermarket',
    name: '超市',
    blurb: '粮油、菜、水都在这一层。人最多，也空得最快。',
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
    blurb: '绷带和感冒药。柜台后面还堆着几箱水。',
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
    blurb: '燃料、工具、棉被。比超市贵两成。',
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
 * 进这家店要花几点行动点。
 *
 * 不变量：**至少 1 点**。写 0 会让"进店"变成免费动作，行动点这套约束当场失效
 * （而 §6.2 的取舍全建立在"一天只有 3 点"上）。
 */
export function actionCostOf(shopId: string): number {
  const def = SHOP_BY_ID.get(shopId);
  const raw = def?.actionCost ?? 1;
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

/** 全部点位 id（给"真店"抽样、界面遍历、内容校验共用一份真相） */
export const ALL_SHOP_IDS: readonly string[] = SHOP_DEFS.map((s) => s.id);

/**
 * 每天行动点（§6.2：每天 2~3 个行动点；M1 取上界 3）。
 * 语义按已拍板：1 行动点 = 进一个店门（店内可买多件，分趟搬货不扣点）。
 */
export const ACTION_POINTS_PER_DAY = 3;
