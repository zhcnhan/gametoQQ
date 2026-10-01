import { describe, expect, it } from 'vitest';
import { SHOP_DEFS } from '../data/shops';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { chooseIdentity } from './phases';
import { createStartingRun } from './setup';
import {
  buildCartView,
  buyCart,
  enterShop,
  findShopStock,
  pickBoxDefId,
  priceOf,
  roundKg,
  type CartLineView
} from './shop';
import { getItemDef } from '../data/items';
import { getIdentityDef } from '../data/identities';
import { getShopDef } from '../data/shops';

function createSaveSchedulerStub() {
  return {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  };
}

function startedStore(seed = 20261001, identityId = 'group_buyer') {
  const store = new GameStore(createSaveGame(createStartingRun(seed)), createSaveSchedulerStub());
  chooseIdentity(store, identityId);
  return store;
}

/** 把当天某件商品的库存直接改成指定值（测边界用；测试里允许绕开命令层） */
function setStock(store: GameStore, shopId: string, itemId: string, stock: number): void {
  const line = findShopStock(store.run, shopId)?.lines.find((l) => l.itemId === itemId);
  if (!line) throw new Error(`没有 ${shopId}/${itemId}`);
  line.stock = stock;
}

describe('价格：点位系数 × 身份折扣', () => {
  it('主食/饮水在团购团长手里便宜 15%（超市不打点位系数）', () => {
    const shop = getShopDef('supermarket');
    const beans = getItemDef('canned_beans'); // 基准 8
    expect(priceOf(beans, shop, getIdentityDef('group_buyer'))).toBe(7); // 8 × 0.85 = 6.8 → 7
    expect(priceOf(beans, shop, getIdentityDef('night_shift'))).toBe(8);
  });

  it('燃料/工具在夜班员手里便宜 20%，但五金店的点位系数更贵', () => {
    const shop = getShopDef('hardware');
    const fuel = getItemDef('fuel_can'); // 基准 30
    expect(priceOf(fuel, shop, getIdentityDef('night_shift'))).toBe(29); // 30 × 1.2 × 0.8 = 28.8 → 29
    expect(priceOf(fuel, shop, getIdentityDef('group_buyer'))).toBe(36); // 30 × 1.2
  });

  it('同一件电池在五金店比超市贵（点位之间必须不重合，行动点才有取舍）', () => {
    const battery = getItemDef('battery'); // 基准 5
    const identity = getIdentityDef('group_buyer'); // 工具不打折，差价只来自点位系数
    expect(priceOf(battery, getShopDef('supermarket'), identity)).toBe(5);
    expect(priceOf(battery, getShopDef('hardware'), identity)).toBe(6); // 5 × 1.2
  });
});

describe('购物车体检：三约束逐条把人话讲清楚', () => {
  it('空篮子不能搬上车', () => {
    const store = startedStore();
    const view = buildCartView(store.run, 'supermarket', []);
    expect(view?.canLoad).toBe(false);
    expect(view?.problems).toContain('购物篮是空的');
  });

  it('这家店没有的东西明确说"没有"', () => {
    const store = startedStore();
    const view = buildCartView(store.run, 'pharmacy', [{ itemId: 'fuel_can', count: 1 }]);
    expect(view?.problems[0]).toContain('这家店没有');
    expect(view?.canLoad).toBe(false);
  });

  it('超出当天库存时自动降到库存数，且只提示、不阻断（否则满车轻货永远搬不走）', () => {
    const store = startedStore();
    setStock(store, 'supermarket', 'canned_beans', 2);
    const view = buildCartView(store.run, 'supermarket', [{ itemId: 'canned_beans', count: 99 }]);
    expect(view?.lines[0]?.count).toBe(2);
    expect(view?.notes.some((p) => p.includes('只剩 2 件'))).toBe(true);
    expect(view?.problems).toEqual([]);
    expect(view?.canLoad).toBe(true);
  });

  it('卖完了说"今天卖完了"', () => {
    const store = startedStore();
    setStock(store, 'supermarket', 'canned_beans', 0);
    const view = buildCartView(store.run, 'supermarket', [{ itemId: 'canned_beans', count: 1 }]);
    expect(view?.problems.some((p) => p.includes('今天卖完了'))).toBe(true);
  });

  it('钱不够：说清还差多少', () => {
    const store = startedStore();
    store.run.cash = 1;
    const view = buildCartView(store.run, 'supermarket', [{ itemId: 'canned_beans', count: 1 }]);
    expect(view?.canLoad).toBe(false);
    expect(view?.problems.some((p) => p.includes('钱不够'))).toBe(true);
  });

  it('超负重：一趟拿不了这么多（超市全买满必然超过 16kg）', () => {
    const store = startedStore();
    const all = SHOP_DEFS.find((s) => s.id === 'supermarket')?.offers.map((o) => ({
      itemId: o.itemId,
      count: 99
    }));
    const view = buildCartView(store.run, 'supermarket', all ?? []);
    expect(view?.problems[0]).toContain('一趟拿不了');
    expect(view?.canLoad).toBe(false);
  });

  it('超车载：车装不下了，并报出今天还能再装多少', () => {
    const store = startedStore();
    store.run.carLoad = 55; // 团购团长车载 58，还能装 3kg
    const view = buildCartView(store.run, 'supermarket', [{ itemId: 'rice_bag', count: 1 }]);
    expect(view?.capacityLeft).toBe(3);
    expect(view?.problems.some((p) => p.includes('车装不下了'))).toBe(true);
  });

  it('三约束全过：canLoad = true 且金额/重量算对', () => {
    const store = startedStore();
    const view = buildCartView(store.run, 'supermarket', [{ itemId: 'canned_beans', count: 2 }]);
    expect(view?.canLoad).toBe(true);
    expect(view?.cost).toBe(14); // 7 × 2
    expect(view?.weight).toBe(0.8);
    expect(view?.pieces).toBe(2);
    expect(view?.cashLeft).toBe(900 - 14);
  });
});

describe('buyCart：把一趟货搬上车', () => {
  it('成功后：扣钱、扣库存、装成一箱进待拆队列、车载累计、写日志', () => {
    const store = startedStore();
    const beforeCash = store.run.cash;
    const beforeBoxes = store.run.boxesToUnpack.length;
    const beforeStock = findShopStock(store.run, 'supermarket')?.lines.find((l) => l.itemId === 'canned_beans')?.stock ?? 0;

    const r = buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 2 }]);
    expect(r.ok).toBe(true);
    expect(store.run.cash).toBe(beforeCash - 14);
    expect(store.run.boxesToUnpack.length).toBe(beforeBoxes + 1);
    expect(findShopStock(store.run, 'supermarket')?.lines.find((l) => l.itemId === 'canned_beans')?.stock).toBe(
      beforeStock - 2
    );
    expect(store.run.carLoad).toBe(0.8);

    const box = store.run.boxesToUnpack[store.run.boxesToUnpack.length - 1];
    expect(box?.defId).toBe('box_staple');
    expect(box?.items.map((s) => s.itemId)).toEqual(['canned_beans']);
    expect(box?.items[0]?.batches[0]?.count).toBe(2);
    expect(store.run.log.some((line) => line.includes('花了 14 元'))).toBe(true);
  });

  it('粮一箱的批次到期日以"当前天"为基准，不是 0（否则 FEFO 无意义）', () => {
    const store = startedStore();
    buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 1 }]);
    const box = store.run.boxesToUnpack[store.run.boxesToUnpack.length - 1];
    const expiry = box?.items[0]?.batches[0]?.expiresAtDay ?? 0;
    // 罐头保质期 720 天 ±12%，从 D-7 起算 → 必然 < 720
    expect(expiry).toBeLessThan(720);
  });

  it('失败时不改任何状态（存档点必须是原子的）', () => {
    const store = startedStore();
    const snapshot = JSON.stringify(store.run);
    const r = buyCart(store, 'pharmacy', [{ itemId: 'fuel_can', count: 1 }]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(store.run)).toBe(snapshot);
  });

  it('搬货不扣行动点：分趟只是物理闸门（1 行动点 = 一个店门）', () => {
    const store = startedStore();
    enterShop(store, 'supermarket');
    const points = store.run.actionPoints;
    expect(buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 2 }]).ok).toBe(true);
    expect(buyCart(store, 'supermarket', [{ itemId: 'mineral_water', count: 1 }]).ok).toBe(true);
    expect(store.run.actionPoints).toBe(points);
  });

  it('每搬一趟都是一箱，箱型按买到的东西自动挑', () => {
    const store = startedStore();
    buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 1 }]);
    buyCart(store, 'pharmacy', [{ itemId: 'bandage', count: 2 }]);
    buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 1 }, { itemId: 'battery', count: 1 }]);
    const ids = store.run.boxesToUnpack.map((b) => b.defId);
    expect(ids.slice(-3)).toEqual(['box_staple', 'box_medical', 'box_mixed']);
  });

  it('箱子 id 稳定递增，不会与开局的 box_1..3 撞名', () => {
    const store = startedStore();
    const before = store.run.boxesToUnpack.map((b) => b.id);
    expect(before).toEqual(['box_1', 'box_2', 'box_3']);
    buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 1 }]);
    expect(store.run.boxesToUnpack.map((b) => b.id)).toEqual(['box_1', 'box_2', 'box_3', 'box_4']);
  });

  it('不在外面的时候买不了', () => {
    const store = startedStore();
    store.run.phase = 'organize';
    // PLACEHOLDER: 阶段 A 还没有"到家卸货"以外的流程，这里只验证 phase 闸门
    expect(buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 1 }]).ok).toBe(false);
  });
});

describe('种子化可复现', () => {
  it('同一个 seed 开两局，当日库存与价格完全一致', () => {
    const a = startedStore(777);
    const b = startedStore(777);
    expect(a.run.shopStocks).toEqual(b.run.shopStocks);
    expect(a.run.seed).toBe(b.run.seed);
  });

  it('同 seed 同操作序列 → 同结果（连买三趟后现金/箱子/游标全等）', () => {
    const run = (store: GameStore) => {
      buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 2 }]);
      buyCart(store, 'pharmacy', [{ itemId: 'bandage', count: 3 }]);
      buyCart(store, 'hardware', [{ itemId: 'battery', count: 4 }]);
      return {
        cash: store.run.cash,
        seed: store.run.seed,
        boxes: store.run.boxesToUnpack,
        carLoad: store.run.carLoad
      };
    };
    const a = run(startedStore(4242, 'night_shift'));
    const b = run(startedStore(4242, 'night_shift'));
    expect(a).toEqual(b);
  });
});

describe('小工具', () => {
  it('pickBoxDefId 按品类挑箱型', () => {
    const view = (ids: string[]): CartLineView[] =>
      ids.map((itemId) => ({
        itemId,
        count: 1,
        unitPrice: 1,
        lineCost: 1,
        unitWeight: 1,
        lineWeight: 1,
        stock: 9
      }));
    expect(pickBoxDefId(view(['canned_beans', 'mineral_water']))).toBe('box_staple');
    expect(pickBoxDefId(view(['bandage', 'cold_medicine']))).toBe('box_medical');
    expect(pickBoxDefId(view(['canned_beans', 'bandage']))).toBe('box_mixed');
  });

  it('roundKg 掐掉浮点毛刺', () => {
    expect(roundKg(0.1 + 0.2)).toBe(0.3);
  });
});
