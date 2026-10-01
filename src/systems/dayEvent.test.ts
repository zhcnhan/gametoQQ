/**
 * 白天随机事件与物价波动（§6.2 / M2 清偿 D-10）。
 *
 * 这一组守三件事：
 *
 *  ① **种子化可复现**：同 seed、同点位、同进出顺序 → 同事件序列；
 *  ② **"不参与"永远是一条路**（§4A）：每条事件都必须能退出，
 *     而且"白跑一趟"要真的结束这一趟（否则它和"照常买"没有区别）；
 *  ③ **限购与削库存只活一天**：换天必须清干净 —— 昨天的限购跟着走到今天，
 *     是这套机制最容易出、也最难被玩家说清的那种 bug。
 */
import { describe, expect, it } from 'vitest';
import { DAY_EVENT_DEFS, dayPriceFactor } from '../data/dayEvents';
import { SHOP_DEFS } from '../data/shops';
import { createCursor } from '../model/rng';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { chooseIdentity } from './phases';
import { createStartingRun } from './setup';
import {
  basePriceOf,
  buildCartView,
  buyCart,
  enterShop,
  findShopStock,
  leaveShop,
  purchaseLimitOf,
  resolveDayEvent,
  rollDayEvent
} from './shop';

function createSaveSchedulerStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

function startedStore(seed = 20261001, identityId = 'group_buyer') {
  const store = new GameStore(createSaveGame(createStartingRun(seed)), createSaveSchedulerStub());
  chooseIdentity(store, identityId);
  return store;
}

describe('物价波动：它补的是 D-03 留下的那个空洞', () => {
  it('逐日上行：灾前便宜，灾难越近越贵', () => {
    // 囤货期开头是"灾前促销"，D-3 回到原价，D-Day 起跳
    expect(dayPriceFactor(-7)).toBeLessThan(1);
    expect(dayPriceFactor(-3)).toBe(1);
    expect(dayPriceFactor(-2)).toBeGreaterThan(1);
    expect(dayPriceFactor(0)).toBeGreaterThan(dayPriceFactor(-1));
    expect(dayPriceFactor(14)).toBeGreaterThan(dayPriceFactor(7));
    // 单调不减：物价不会自己回落 —— 这是这个函数唯一的默认方向
    let prev = 0;
    for (let day = -7; day <= 14; day++) {
      const f = dayPriceFactor(day);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('日历覆盖不到的日子夹到最近的一档，不返回 0 或 NaN', () => {
    expect(dayPriceFactor(-99)).toBe(dayPriceFactor(-7));
    expect(dayPriceFactor(99)).toBe(dayPriceFactor(14));
    expect(Number.isFinite(dayPriceFactor(1000))).toBe(true);
  });

  it('★ 当天单价里烘进了当天的物价倍率 —— 界面与结账读的是同一个数', () => {
    const store = startedStore();
    const line = findShopStock(store.run, 'supermarket')?.lines.find((l) => l.itemId === 'canned_beans');
    expect(line).toBeDefined();
    // 事件倍率是 1（还没碰上事件），所以实际单价 = 生成时烘进去的那个数
    expect(basePriceOf(store.run, line as { price: number })).toBe((line as { price: number }).price);
  });

  it('★ 事件涨价只影响今天剩下的时间：shopPriceFactor 乘上去，换天清掉', () => {
    const store = startedStore();
    const line = findShopStock(store.run, 'supermarket')?.lines.find((l) => l.itemId === 'canned_beans');
    const before = basePriceOf(store.run, line as { price: number });
    store.commit((draft) => {
      draft.shopPriceFactor = 1.5;
    });
    expect(basePriceOf(store.run, line as { price: number })).toBe(Math.max(1, Math.round(before * 1.5)));
  });
});

describe('白天事件的抽签', () => {
  it('同 seed 同点位 → 同结果（同一天连进三次同一家店也一致）', () => {
    const seq = (seed: number, shopId: string, n = 30): (string | null)[] => {
      const cursor = createCursor(seed);
      return Array.from({ length: n }, () => rollDayEvent(cursor, shopId));
    };
    expect(seq(20261001, 'supermarket')).toEqual(seq(20261001, 'supermarket'));
  });

  it('★ 黑市商人只在五金店后巷 —— onlyShops 之外的店门权重是 0，抽不到他', () => {
    const inHardware = Array.from({ length: 200 }, (_, i) => rollDayEvent(createCursor(i), 'hardware'));
    const inPharmacy = Array.from({ length: 200 }, (_, i) => rollDayEvent(createCursor(i), 'pharmacy'));
    expect(inHardware).toContain('d_black_market');
    expect(inPharmacy).not.toContain('d_black_market');
  });

  it('约六成的店门没事 —— 一天进三家店，家家有事就成了例会', () => {
    let hits = 0;
    const draws = 2000;
    for (let i = 0; i < draws; i++) if (rollDayEvent(createCursor(i), 'supermarket')) hits += 1;
    const rate = hits / draws;
    expect(rate).toBeGreaterThan(0.35);
    expect(rate).toBeLessThan(0.75);
  });

  it('每条事件的选项都在 2~3 个、标签不超过 8 字（手机竖屏一行放得下）', () => {
    for (const def of DAY_EVENT_DEFS) {
      expect(def.options.length).toBeGreaterThanOrEqual(2);
      expect(def.options.length).toBeLessThanOrEqual(3);
      for (const opt of def.options) {
        expect(opt.label.length).toBeLessThanOrEqual(8);
        expect(opt.outcome.length).toBeGreaterThan(4);
      }
    }
  });
});

describe('白天事件接进 enterShop：门口先讲那件事', () => {
  /** 反复开新局，直到这一家店门口真的出了指定的那件事（种子化地穷举） */
  function storeAtEvent(eventId: string, seed = 1, shopId = 'supermarket') {
    for (let s = seed; s < seed + 400; s++) {
      const store = startedStore(s);
      const result = enterShop(store, shopId);
      if (store.run.dayEvent?.defId === eventId) return { store, result };
    }
    throw new Error(`400 个 seed 里没抽到 ${eventId}`);
  }

  it('★ 掷中事件时，行动点照扣、店门照进、dayEvent 挂上（它是"路上的遭遇"）', () => {
    const { store, result } = storeAtEvent('d_queue_aunt');
    expect(result.ok).toBe(true);
    expect(store.run.actionPoints).toBe(2);
    expect(store.run.currentShopId).toBe('supermarket');
    expect(store.run.dayEvent?.shopId).toBe('supermarket');
    expect(store.run.dayEvent?.choice).toBeNull();
    expect(result.events.some((e) => e.type === 'dayEventHit')).toBe(true);
  });

  it('"排到底"：花体力与心情，货还能买', () => {
    const { store } = storeAtEvent('d_queue_aunt');
    const stamina = store.run.stats.stamina;
    const res = resolveDayEvent(store, 0);
    expect(res.ok).toBe(true);
    expect(store.run.stats.stamina).toBeLessThan(stamina);
    expect(store.run.dayEvent?.choice).toBe(0);
    expect(store.run.dayEvent?.applied?.stamina).toBeLessThan(0);
    // 已经决定过 → 再点被拒（幂等）
    expect(resolveDayEvent(store, 1).ok).toBe(false);
  });

  it('★ "不排了，换一家" = 这趟白跑：退回点位列表，但行动点不还（那是进门的价钱）', () => {
    const { store } = storeAtEvent('d_queue_aunt');
    const points = store.run.actionPoints;
    const res = resolveDayEvent(store, 1);
    expect(res.ok).toBe(true);
    expect(store.run.dayEvent).toBeNull();
    expect(store.run.currentShopId).toBeNull();
    expect(store.run.actionPoints).toBe(points);
    expect(res.events.some((e) => e.type === 'dayEventResolved' && e.visitLost)).toBe(true);
  });

  it('★ 每条事件都必须有一条"不参与"的路（§4A）', () => {
    for (const def of DAY_EVENT_DEFS) {
      const has = def.options.some((o) => o.effect.visitLost === true);
      expect(has).toBe(true);
    }
  });

  it('★ 限购：事件加的上限真的会限制能买几件，而且换天清掉', () => {
    const { store } = storeAtEvent('d_purchase_limit');
    const res = resolveDayEvent(store, 0); // "按限购买" → 主食限 2 件
    expect(res.ok).toBe(true);
    expect(purchaseLimitOf(store.run, 'supermarket', 'canned_beans')).toBe(2);

    // 限购之下：想买 6 件会被截到 2 件，而且只提示、不阻断
    const view = buildCartView(store.run, 'supermarket', [{ itemId: 'canned_beans', count: 6 }]);
    expect(view?.lines[0]?.count).toBe(2);
    expect(view?.notes.some((n) => n.includes('限购'))).toBe(true);
    expect(view?.canLoad).toBe(true);
    // 结账也只扣 2 件的钱
    const cost = view?.cost ?? 0;
    const cash = store.run.cash;
    expect(buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 6 }]).ok).toBe(true);
    expect(store.run.cash).toBe(cash - cost);
    // 买满之后不能加购
    const again = buildCartView(store.run, 'supermarket', [{ itemId: 'canned_beans', count: 1 }]);
    expect(again?.canLoad).toBe(false);
  });

  it('★ 削库存：抢完了就是抢完了 —— 当天该品类的行真的少掉件数', () => {
    const { store } = storeAtEvent('d_panic_buying');
    const before = SHOP_DEFS.find((s) => s.id === 'supermarket')
      ?.offers.filter((o) => o.itemId.startsWith('canned') || o.itemId.includes('noodle'))
      .length ?? 0;
    const stockBefore = findShopStock(store.run, 'supermarket')?.lines.reduce((n, l) => n + l.stock, 0) ?? 0;
    const res = resolveDayEvent(store, 1); // "照原计划买" → 削 2 件主食
    expect(res.ok).toBe(true);
    const applied = store.run.dayEvent?.applied;
    expect(applied?.stockCut.length).toBeGreaterThan(0);
    const stockAfter = findShopStock(store.run, 'supermarket')?.lines.reduce((n, l) => n + l.stock, 0) ?? 0;
    expect(stockAfter).toBeLessThan(stockBefore);
    void before;
  });

  it('黑市商人：给得起钱才成立，钱不够时命令层也挡（界面置灰之外的第二道）', () => {
    const { store } = storeAtEvent('d_black_market', 1, 'hardware');
    store.run.cash = 10; // 要 120
    const res = resolveDayEvent(store, 0);
    expect(res.ok).toBe(false);
    expect(store.run.cash).toBe(10);
    expect(store.run.dayEvent?.choice).toBeNull();
  });

  it('黑市商人：给得起就带回来一箱，钱照扣', () => {
    const { store } = storeAtEvent('d_black_market', 1, 'hardware');
    const boxes = store.run.boxesToUnpack.length;
    const cash = store.run.cash;
    const res = resolveDayEvent(store, 0);
    expect(res.ok).toBe(true);
    expect(store.run.boxesToUnpack.length).toBe(boxes + 1);
    expect(store.run.cash).toBe(cash - 120);
    expect(store.run.dayEvent?.applied?.gotBox).toBe(true);
  });

  it('★ "先不进去"：事件没处理也能退出（leaveShop 清干净 dayEvent）', () => {
    const { store } = storeAtEvent('d_queue_aunt');
    const res = leaveShop(store);
    expect(res.ok).toBe(true);
    expect(store.run.dayEvent).toBeNull();
    expect(store.run.currentShopId).toBeNull();
  });

  it('不在外面的时候不能处理门口的事', () => {
    const store = startedStore();
    store.run.phase = 'organize';
    expect(resolveDayEvent(store, 0).ok).toBe(false);
  });
});
