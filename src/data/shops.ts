/**
 * 囤货期点位静态表（§6.2：地图点位 = 超市 / 药店 / 五金建材 / 农贸市场 / 黑市；
 * M1 范围只取前 3 个：超市 / 药店 / 五金店）。
 *
 * M3 第 1 步已清偿 D-24（校验与注册表的分工）：本表由 `data/registry.ts` 汇总，
 * 而"加一家店"这件事有**三道守**：`isShopId()`（运行期）、`check-content.mjs`
 * （入库前的 JSON）、`check-registry.mjs`（在册内容的可达性与分层）。
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
    ],
    tier: 1
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
    ],
    tier: 1
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
    ],
    tier: 1
  },
  // ═══ 生成内容 shop-01 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "market",
    name: "农贸市场",
    blurb: "棚子底下还有几个摊。菜比超市新鲜，但没人给你装袋。",
    priceFactor: 0.88,
    actionCost: 2,
    offers: [
      {
        itemId: "rice_bag",
        stock: 5
      },
      {
        itemId: "flour",
        stock: 6
      },
      {
        itemId: "mineral_water",
        stock: 8
      },
      {
        itemId: "instant_noodles",
        stock: 10
      },
      {
        itemId: "milk",
        stock: 4
      },
      {
        itemId: "canned_beans",
        stock: 6
      },
      {
        itemId: "vermicelli",
        stock: 8
      },
      {
        itemId: "instant_rice",
        stock: 5
      },
      {
        itemId: "ham_sausage",
        stock: 8
      },
      {
        itemId: "vacuum_egg",
        stock: 8
      },
      {
        itemId: "dried_pork",
        stock: 5
      },
      {
        itemId: "frozen_dumpling",
        stock: 5
      },
      {
        itemId: "fresh_bread",
        stock: 8
      },
      {
        itemId: "egg_tray",
        stock: 5
      }
    ],
    specialty: ["food", "grain"],
    tier: 1,
    decision: "多花一个行动点换更便宜的粮油，还是省下这点去别处"
  },
{
    id: "wholesale",
    name: "粮油批发站",
    blurb: "仓库里整垛整垛的米面。老板只收现金，两袋起订。",
    priceFactor: 0.8,
    actionCost: 2,
    offers: [
      {
        itemId: "rice_bag",
        stock: 12
      },
      {
        itemId: "flour",
        stock: 10
      },
      {
        itemId: "mineral_water",
        stock: 15
      },
      {
        itemId: "canned_corned_beef",
        stock: 5
      },
      {
        itemId: "canned_fish",
        stock: 5
      },
      {
        itemId: "canned_peach",
        stock: 5
      },
      {
        itemId: "canned_vegetable",
        stock: 8
      },
      {
        itemId: "canned_congee",
        stock: 8
      },
      {
        itemId: "compressed_biscuit",
        stock: 5
      },
      {
        itemId: "energy_bar",
        stock: 8
      },
      {
        itemId: "oatmeal_bag",
        stock: 5
      },
      {
        itemId: "dried_noodles",
        stock: 8
      },
      {
        itemId: "rice_small",
        stock: 5
      },
      {
        itemId: "cornmeal_bag",
        stock: 8
      }
    ],
    specialty: ["grain", "food"],
    tier: 1,
    decision: "一次压一大笔现金换最低单价，还是把钱留着分散采买"
  },
{
    id: "community_store",
    name: "社区小卖部",
    blurb: "老板娘认识楼里每一个人。货架不高，但灾后也开着。",
    priceFactor: 1.05,
    offers: [
      {
        itemId: "instant_noodles",
        stock: 6
      },
      {
        itemId: "mineral_water",
        stock: 6
      },
      {
        itemId: "battery",
        stock: 4
      },
      {
        itemId: "cigarettes",
        stock: 3
      },
      {
        itemId: "canned_beans",
        stock: 5
      },
      {
        itemId: "cocoa_tin",
        stock: 2
      },
      {
        itemId: "cabbage",
        stock: 8
      },
      {
        itemId: "potato_bag",
        stock: 8
      },
      {
        itemId: "kimchi_jar",
        stock: 5
      },
      {
        itemId: "peanut_butter",
        stock: 5
      },
      {
        itemId: "honey_jar",
        stock: 3
      },
      {
        itemId: "sugar_bag",
        stock: 8
      },
      {
        itemId: "salt_bag",
        stock: 8
      },
      {
        itemId: "cooking_oil",
        stock: 5
      }
    ],
    specialty: ["treat", "drink"],
    tier: 1,
    decision: "贵一点但离家近还认人，应急补货来不来这"
  },
{
    id: "clinic",
    name: "街角诊所",
    blurb: "一间门面两张床。医生兼着卖药，能聊两句病情。",
    priceFactor: 1.3,
    offers: [
      {
        itemId: "cold_medicine",
        stock: 8
      },
      {
        itemId: "bandage",
        stock: 10
      },
      {
        itemId: "mineral_water",
        stock: 4
      },
      {
        itemId: "coconut_water",
        stock: 8
      },
      {
        itemId: "electrolyte_powder",
        stock: 5
      },
      {
        itemId: "tea_tin",
        stock: 5
      },
      {
        itemId: "orange_drink",
        stock: 8
      },
      {
        itemId: "water_pouch",
        stock: 5
      }
    ],
    specialty: ["medicine", "medkit"],
    tier: 1,
    decision: "比药店贵，但胜在不排队还离得近，急用时来不来"
  },
{
    id: "gas_station",
    name: "加油站便利店",
    blurb: "二十四小时亮着灯。半夜能买到电池和烟，白天反而贵。",
    priceFactor: 1.4,
    offers: [
      {
        itemId: "fuel_can",
        stock: 4
      },
      {
        itemId: "battery",
        stock: 8
      },
      {
        itemId: "cigarettes",
        stock: 5
      },
      {
        itemId: "instant_noodles",
        stock: 6
      },
      {
        itemId: "mineral_water",
        stock: 8
      },
      {
        itemId: "cocoa_tin",
        stock: 2
      },
      {
        itemId: "milk_powder",
        stock: 3
      },
      {
        itemId: "baby_formula",
        stock: 3
      },
      {
        itemId: "chocolate_bar",
        stock: 5
      },
      {
        itemId: "water_big",
        stock: 5
      },
      {
        itemId: "water_case",
        stock: 5
      },
      {
        itemId: "cola_bottle",
        stock: 8
      },
      {
        itemId: "juice_box",
        stock: 8
      },
      {
        itemId: "soda_can",
        stock: 8
      }
    ],
    specialty: ["power", "treat"],
    tier: 1,
    decision: "全城最贵的便利店，但它从不关门，什么时候值得为它付钱"
  },
{
    id: "weekend_flea",
    name: "周末旧货市",
    blurb: "每周日半天。旧棉被、旧工具摆一地，看成色开价。",
    priceFactor: 0.75,
    actionCost: 2,
    offers: [
      {
        itemId: "quilt",
        stock: 4
      },
      {
        itemId: "toolbox",
        stock: 3
      },
      {
        itemId: "battery",
        stock: 6
      },
      {
        itemId: "picture_book",
        stock: 3
      },
      {
        itemId: "cocoa_tin",
        stock: 2
      },
      {
        itemId: "hot_water_bag_gift",
        stock: 1
      }
    ],
    specialty: ["warmth", "keepsake"],
    tier: 1,
    decision: "便宜三成但全是旧货还要看日子，为省钱等不等周日"
  },
  // ═══ 生成内容 shop-01 止 ═══
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
