/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  扫货页：物价压力要**看得见**（铁则 §10.1A）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 这一份钉住的是哪笔账
 *
 * `priceSurcharge`（维度 10）是 116 场灾难里 **110 场**都写了的那一维，
 * 从 M4 W-01 起真的生效了 —— 而它此前在屏幕上**等于不存在**：
 * 扫货页只报一个绝对价，玩家没有参照物，也就无从知道"这一场物价贵四成"。
 *
 * 用户的口径：**"任何东西都要让我有感知"**。而"有感知"这件事有一个可判定的形式 ——
 * **玩家能在花掉行动点之前说出"今天该不该换一家"**。所以这一份断言的落点是那句话，
 * 不是某个 class 名：
 *
 *  1. 平常价（去掉灾难加成与事件加成）**算得对**，且与生成时的口径是同一把尺子；
 *  2. ★ 灾难让物价变**便宜**时方向不能反（`mul < 1` 的那个坑，第一版真踩了）；
 *  3. 贵的时候，出现**非数字的表达**（斜纹条 + 箭头）**与**数字（百分比）；
 *  4. 不贵的时候，**一个多余的标记都不许有**（否则"标记"会贬值成噪音）；
 *  5. ★ **店门口的卡片上就先看得见** —— 进店才知道，那时行动点已经花掉了；
 *  6. 限购与涨价**分开说**：一个是"最多几件"，一个是"贵多少"，玩家才对得上账。
 *
 * ## 假 DOM 的边界（§3.2）
 *
 * 用 `allText` 读整棵树的文本、用 `querySelectorAll` 数标记的个数。
 * 这一份**不**断言具体文案的字面写法，只断言"该出现的出现了、不该出现的没出现"。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getItemDef } from '../data/items';
import { getShopDef } from '../data/shops';
import { DISASTER_DEFS, disasterModifiersOf } from '../data/disaster';
import { dayPriceFactor } from '../data/dayEvents';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createStartingRun } from '../systems/setup';
import { priceStressOf } from '../systems/shop';
import { ShopScreen } from './ShopScreen';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/**
 * 挑一场**真的会抬价**的灾难当主角。
 *
 * ★ 第一版我随手写了 `cold_snap` —— 它是 116 场里**仅有的 6 场
 * `priceSurcharge === 0`** 之一，于是整份用例的"贵"全是靠事件倍率假装的，
 * 而真实机制那一维在验 0。从数据里挑主角就不会再犯。
 */
function pickPricey(): { id: string; surcharge: number } {
  for (const def of DISASTER_DEFS) {
    const surcharge = disasterModifiersOf(def.id).priceSurcharge;
    if (surcharge > 0 && dayPriceFactor(0, def.id) > 1) return { id: def.id, surcharge };
  }
  throw new Error('116 场里找不到一场既抬价、当天逐日倍率又 > 1 的灾难 —— 数据变了，这一份用例的前提要重写');
}

const PRICEY = pickPricey();

/**
 * 一份"在扫货页、店里有三件货"的局面。
 *
 * ⚠ 刻意不复用 `SurvivalScreen.test.ts` 的工厂：那一份要造日报快照与生存期状态，
 * 而这一份只关心价格那条线。少一处依赖，坏的时候少一个嫌疑人。
 */
function shopStore(
  over: { priceFactor?: number; limit?: { category: string; max: number } | null; inShop?: boolean } = {}
) {
  const run = createStartingRun(20261007);
  run.identityId = 'group_buyer';
  run.phase = 'stockpile_shop';
  run.day = 0;
  run.cash = 500;
  run.disasterId = PRICEY.id;
  run.shopPriceFactor = over.priceFactor ?? 1;
  run.shopLimits = (over.limit ? [{ shopId: 'supermarket', ...over.limit }] : []) as never;
  run.shopBoughtToday = {};
  run.visitedShopIds = [];
  /*
   * 只放三条货：够断言"贵/不贵/限购"三种情况，又不至于让这一份测试变成
   * 在核对整张物资表（那是 `data/` 层的事）。
   *
   * ★ 物资 id 从超市**自己的报价表**里取，价格用物品的 **`basePrice`**。
   * 我第一次写的是 `rice` / `water` / `canned_meat`（三个都不是真的 id），
   * 价格又用了不存在的 `.value` —— 于是渲染出 `↓便宜 NaN%`。
   * 那是**测试自己的错**，但它顺手证明了一件好事：NaN 真的会一路走到屏幕上。
   */
  const itemIds = getShopDef('supermarket').offers.slice(0, 3).map((o) => o.itemId);
  run.shopStocks = [
    {
      shopId: 'supermarket',
      lines: itemIds.map((itemId) => ({ itemId, stock: 5, price: getItemDef(itemId).basePrice }))
    }
  ] as never;
  run.currentShopId = over.inShop === false ? null : 'supermarket';
  return new GameStore(createSaveGame(run), stubScheduler());
}

interface Ctx {
  root: FakeElement;
  store: GameStore;
}

function mount(over: Parameters<typeof shopStore>[0] = {}, disasterId = PRICEY.id): Ctx {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = shopStore(over);
  store.run.disasterId = disasterId;
  const screen = new ShopScreen(asElement(root), store, { onLeave: () => undefined } as never);
  screen.mount();
  return { root, store };
}

/** 把"总倍率"设成指定值（用事件倍率去凑），返回那一份 store */
function withTotalMul(mul: number) {
  const run = createStartingRun(20261007);
  run.disasterId = PRICEY.id;
  run.day = 0;
  const natural = dayPriceFactor(0, PRICEY.id) * (1 + PRICEY.surcharge);
  return { priceFactor: mul / natural };
}

afterEach(() => {
  // 每个用例自己装一份假的 window，卸掉免得互相污染
  delete (globalThis as { window?: unknown }).window;
});

describe('物价压力 · 平常价的算法', () => {
  it('★ 去掉了灾难加成与事件加成 —— 与生成时的口径是同一把尺子', () => {
    const run = createStartingRun(20261007);
    run.disasterId = PRICEY.id;
    run.day = 0;
    run.shopPriceFactor = 1;
    run.shopStocks = [];

    const line = { price: 100 };
    const mul = dayPriceFactor(0, PRICEY.id) * (1 + PRICEY.surcharge);
    const price = priceStressOf(run as never, line);

    // 平常价 = 实价 / 总倍率（两边各自取整，所以允许 1 元残差）
    expect(Math.abs(price.base - 100 / mul)).toBeLessThanOrEqual(1);
    expect(price.percent, `这一场（${PRICEY.id}）会抬价，所以百分比必须为正`).toBeGreaterThan(0);
  });

  it('把事件倍率也除掉 —— 否则"比平常贵"里会混进事件的账', () => {
    const run = createStartingRun(20261007);
    run.disasterId = PRICEY.id;
    run.day = 0;
    const base = priceStressOf(run as never, { price: 100 }).base;

    run.shopPriceFactor = 2;
    const price = priceStressOf(run as never, { price: 100 });
    // 事件把价抬了一倍，而"平常价"这个参照物本身**不该跟着动**
    expect(price.base).toBe(base);
    expect(price.percent).toBeGreaterThan(0);
  });

  it('★★ 灾难让物价变**便宜**时，方向不能反（`mul < 1` 的那个坑）', () => {
    /*
     * 第一版用 `Math.round(actual / mul)` 算参照物，`mul < 1` 时它会把参照物
     * 抬到比实价还高 —— 于是"今天更便宜"被报成"贵了 40%"，**方向整个反了**。
     * 这一条钉住方向。
     */
    const natural = dayPriceFactor(0, PRICEY.id) * (1 + PRICEY.surcharge);
    const run = createStartingRun(20261007);
    run.disasterId = PRICEY.id;
    run.day = 0;
    run.shopPriceFactor = 0.4 / natural; // 总倍率 = 0.4
    const price = priceStressOf(run as never, { price: 200 });

    expect(price.percent, '打折就是打折，不许报成涨价').toBeLessThanOrEqual(0);
    expect(Number.isNaN(price.percent), 'NaN 会一路渲染到屏幕上（第一版就漏了这个）').toBe(false);
  });
});

describe('物价压力 · 该出现什么、不该出现什么', () => {
  it('★★ 这一场本来就抬价、又没有事件时：百分比直接报出来', () => {
    // 总倍率 = 灾难自然值（事件倍率 1）→ 涨幅就该等于 priceSurcharge 那一档
    const { root } = mount({ priceFactor: 1 });
    const text = allText(root);

    expect(text).toMatch(/贵\s*\d+%/);
    expect(text).not.toContain('NaN');
  });

  it('★★ 不贵的时候：一个压力标记都没有（标记不许贬值成噪音）', () => {
    // 用事件倍率把总倍率拉回 1 → "今天不比平常贵"
    const { root } = mount(withTotalMul(1));

    expect(allText(root)).not.toContain('贵');
    expect(allText(root)).not.toContain('便宜');
    expect(root.querySelectorAll('.price-meter').length, '不贵时不许画计量条').toBe(0);
    expect(root.querySelectorAll('.price-stress').length).toBe(0);
  });

  it('★★ 贵的时候：箭头 + 百分比 + 计量条，三样同时出现', () => {
    const { root } = mount({ priceFactor: 1.4 });
    const text = allText(root);

    expect(text, '要有百分比（想精确算账的人有得算）').toMatch(/贵\s*\d+%/);
    expect(text, '要有箭头的方向（不读数字也知道往哪边偏）').toContain('↑');
    expect(
      root.querySelectorAll('.price-meter').length,
      '★ 还要有**非数字**那一路表达 —— 铁则要的是"能一眼扫出来"，不是"数字变大"'
    ).toBeGreaterThan(0);
  });

  it('★ 涨幅越大，计量条越长（否则它只是装饰）', () => {
    /*
     * ⚠ 档位挂在**外层** `.price-stress` 上（`--stress` 由它继承给 `.price-meter`
     * 的 `width`）。第一版我去读 `.price-meter` 自己的 `style`，读到两个空串 ——
     * 那时断言看起来像"涨幅没影响档位"，其实是在**问错了元素**
     * （而且空串相等还会让"不该相等"那条误红）。
     *
     * ⚠⚠ 第二版拿 `priceFactor` 1.05 与 1.9 去比 —— **两个都顶在封顶那一档**，
     * 因为这一场灾难的自然涨幅本来就有两百多个百分点，事件倍率加的那点
     * 相对量根本不足以跨档。所以这一条改成**直接比"贵"与"更贵"**：
     * 用 `withTotalMul` 精确指定总倍率，让两个样本真的落在不同档上。
     * ★ 教训：拿"随手挑的两个数"去验刻度，很可能两个都落在同一档 ——
     * 那时失败信息看起来像"刻度坏了"，其实是**样本没选好**。
     */
    const stressOf = (root: FakeElement) =>
      Number((root.querySelectorAll('.price-stress')[0]?.getAttribute('style') ?? '').replace(/\D/g, ''));
    const mild = stressOf(mount(withTotalMul(1.3)).root);
    const heavy = stressOf(mount(withTotalMul(4)).root);

    expect(mild, '贵一点就该有条').toBeGreaterThan(0);
    expect(heavy, '贵得多，条必须更长').toBeGreaterThan(mild);
  });

  it('★★ 进店**之前**就在卡片上看得见"今天这家贵"', () => {
    const { root } = mount({ inShop: false });
    const text = allText(root);

    expect(text, '店门口就要报涨幅 —— 进了店才知道，行动点已经花掉了').toMatch(/今天贵\s*\d+%/);
    expect(root.querySelectorAll('.shop-card.is-pricey').length).toBeGreaterThan(0);
  });

  it('没有事的那一天：卡片上不挂价格标记', () => {
    const { root } = mount({ ...withTotalMul(1), inShop: false });
    expect(root.querySelectorAll('.shop-pricey').length).toBe(0);
  });

  it('★ 限购与涨价分开说（一个是"最多几件"、一个是"贵多少"）', () => {
    const food = getItemDef(getShopDef('supermarket').offers[0]!.itemId).category;
    const { root } = mount({ priceFactor: 1.3, limit: { category: food, max: 2 } });
    const text = allText(root);

    expect(text).toContain('限购');
    expect(text).toMatch(/贵\s*\d+%/);
  });
});
