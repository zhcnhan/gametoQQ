/**
 * 以物易物（§12.3 v0.6 的出口）。
 *
 * 这组用例守的是一条设计立场：**它不保证能救你**。
 * 三件换一箱，箱子里装什么由种子化 RNG 决定 —— 一个必然把你救回来的按钮
 * 不是选择，是流程。所以这里只测"规矩"，不测"一定换得到吃的"。
 */
import { describe, expect, it } from 'vitest';
import { dayPriceFactor } from '../data/dayEvents';
import { EMPTY_SURVIVAL_SNAPSHOT, NEVER_TRADED } from '../data/survival';
import { countByItem } from '../model/consume';
import { makeStack, setSlotStack } from '../model/shelf';
import type { RunState } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createStartingRun } from './setup';
import {
  cashPriceOf,
  canTrade,
  pickCashFor,
  tradeCooldownLeft,
  tradeForBox,
  type TradeIntent
} from './trade';

function createSaveSchedulerStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 老老实实给三件货那一单（大多数用例走这条） */
function threeOf(itemId: string): TradeIntent {
  return { picks: [{ itemId, count: 3 }], cashOn: false };
}

/** 往货架上塞一堆指定物资（找第一个空格） */
function give(run: RunState, itemId: string, count: number): void {
  const shelf = run.shelves[0];
  if (!shelf) throw new Error('开局没有货架');
  for (let row = 0; row < shelf.h; row++) {
    for (let col = 0; col < shelf.w; col++) {
      if (shelf.slots[row]?.[col]?.stack === null) {
        run.shelves[0] = setSlotStack(shelf, { row, col }, makeStack(itemId, count, null));
        return;
      }
    }
  }
  throw new Error('这块货架塞不下测试用的物资');
}

/**
 * 一个"正在硬撑、屋里有货"的生存期存档。
 *
 * ⚠ `run.cash` 是**手动给的**：身份现金（`startCash`）只在 `chooseIdentity` 里进状态，
 * 而这里直接跳到生存期，所以 `createStartingRun` 给的是 0 元。
 */
function storePressing(seed = 20261001): GameStore {
  const run = createStartingRun(seed);
  run.phase = 'survival_day';
  run.day = 3;
  run.identityId = 'group_buyer';
  run.cash = 900;
  run.stats = { health: 40, mood: 40, stamina: 40, shelter: 60 };
  run.survival.last = { ...EMPTY_SURVIVAL_SNAPSHOT, hardPress: true, hardPressLevel: 'straining' };
  run.boxesToUnpack = [];
  give(run, 'battery', 6);
  give(run, 'canned_beans', 4);
  return new GameStore(createSaveGame(run), createSaveSchedulerStub());
}

function countOf(store: GameStore, itemId: string): number {
  const run = store.run;
  return countByItem(run.shelves, run.boxesToUnpack).find((s) => s.itemId === itemId)?.count ?? 0;
}

/**
 * 只数货架上的。
 *
 * 换箱之后必须用这个而不是全屋口径：换回来的粮油箱里**也可能装着黄豆罐头**，
 * 混在一起数会得到"换出去一件反而多了一件"的怪结果。
 */
function shelfCountOf(store: GameStore, itemId: string): number {
  return countByItem(store.run.shelves, []).find((s) => s.itemId === itemId)?.count ?? 0;
}

describe('以物易物：硬撑时的出口', () => {
  it('日子过得去的时候换不成（它不是商店，是街坊之间的一句"帮个忙"）', () => {
    const store = storePressing();
    store.run.survival.last.hardPress = false;
    expect(canTrade(store.run)).toBe(false);
    expect(tradeForBox(store, threeOf('battery')).ok).toBe(false);
    expect(countOf(store, 'battery')).toBe(6);
  });

  it('三件换一箱：东西从屋里扣掉，粮油箱进待拆队列', () => {
    const store = storePressing();
    const boxesBefore = store.run.boxesToUnpack.length;

    const result = tradeForBox(store, threeOf('battery'));
    expect(result.ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(3);
    expect(store.run.boxesToUnpack.length).toBe(boxesBefore + 1);
    expect(store.run.boxesToUnpack[boxesBefore]?.defId).toBe('box_staple');
    expect(store.run.boxesToUnpack[boxesBefore]?.items.length).toBeGreaterThan(0);
  });

  it('品类不限，可以几样凑满三件（取舍感就来自这里）', () => {
    const store = storePressing();
    const result = tradeForBox(store, {
      picks: [
        { itemId: 'battery', count: 2 },
        { itemId: 'canned_beans', count: 1 }
      ],
      cashOn: false
    });
    expect(result.ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(4);
    expect(shelfCountOf(store, 'canned_beans')).toBe(3);
  });

  it('凑不满三件不给换', () => {
    const store = storePressing();
    const result = tradeForBox(store, { picks: [{ itemId: 'battery', count: 2 }], cashOn: false });
    expect(result.ok).toBe(false);
    expect(countOf(store, 'battery')).toBe(6);
    expect(store.run.boxesToUnpack.length).toBe(0);
  });

  it('库里没那么多也不给换（校验按全屋算，与界面列的清单同源）', () => {
    const store = storePressing();
    expect(tradeForBox(store, { picks: [{ itemId: 'battery', count: 99 }], cashOn: false }).ok).toBe(false);
    expect(countOf(store, 'battery')).toBe(6);
  });

  it('纸箱里的东西也能拿去换 —— 恰恰是最需要这个出口的人才会全堆在箱子里', () => {
    const store = storePressing();
    store.run.shelves = store.run.shelves.map((s) => ({
      ...s,
      slots: s.slots.map((row) => row.map(() => ({ stack: null })))
    }));
    store.run.boxesToUnpack = [
      { id: 'box_x', defId: 'box_mixed', items: [makeStack('battery', 6, null)] }
    ];

    expect(tradeForBox(store, threeOf('battery')).ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(3);
  });

  it('两天冷却：刚换完不能马上再换，但两天后可以', () => {
    const store = storePressing();
    expect(tradeForBox(store, threeOf('battery')).ok).toBe(true);
    expect(store.run.survival.lastTradeDay).toBe(3);
    expect(tradeCooldownLeft(store.run)).toBe(2);
    expect(canTrade(store.run)).toBe(false);
    expect(tradeForBox(store, threeOf('battery')).ok).toBe(false);

    store.run.day = 5;
    expect(tradeCooldownLeft(store.run)).toBe(0);
    expect(canTrade(store.run)).toBe(true);
    expect(tradeForBox(store, threeOf('battery')).ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(0);
  });

  it('从没换过的存档不处于冷却中', () => {
    const store = storePressing();
    expect(store.run.survival.lastTradeDay).toBe(NEVER_TRADED);
    expect(tradeCooldownLeft(store.run)).toBe(0);
    expect(canTrade(store.run)).toBe(true);
  });
});

/**
 * ★ 现金那一件（M4 决策 B：给生存期赚到的现金一个出口）。
 *
 * 这一组的重点是那条**看不见的口径**：用钱顶掉的是"折成现金最贵的那一件"，
 * 而它由命令层挑（`pickCashFor`），界面只交开关。所以这里既测"钱真的扣了"，
 * 也测"挑的是哪一件" —— 后者错了不会报错，只会在屏幕上少扣几十块钱。
 */
describe('现金顶一件：生存期现金的出口', () => {
  it('★★ 用钱顶一件 → 少给一件货、按价扣钱、日志把两样都写出来', () => {
    const store = storePressing();
    const wallet = store.run.cash;
    const price = cashPriceOf(store.run, 'canned_beans');

    const result = tradeForBox(store, {
      picks: [
        { itemId: 'battery', count: 1 },
        { itemId: 'canned_beans', count: 1 }
      ],
      cashOn: true
    });

    expect(result.ok).toBe(true);
    expect(store.run.cash).toBe(wallet - price);
    // 两件货交出去了（第三件被钱顶掉），所以电池只少 1
    expect(countOf(store, 'battery')).toBe(5);
    expect(shelfCountOf(store, 'canned_beans')).toBe(3);
    expect(store.run.boxesToUnpack.length).toBe(1);
    const traded = result.events.find((e) => e.type === 'traded');
    expect(traded).toMatchObject({ cash: price });
    expect(store.run.log.some((line) => line.includes(`现金 ${price} 元`))).toBe(true);
  });

  it('★★ 顶掉的是**折成现金最贵**的那一件，不是 basePrice 最高的那一件', () => {
    const store = storePressing();
    // 团购团长（主食/饮水 -15%）→ 罐头折 7 元、大米折 34 元
    const picks = new Map([
      ['canned_beans', 1],
      ['rice_bag', 1]
    ]);
    expect(pickCashFor(store.run, picks)).toBe('rice_bag');
    expect(cashPriceOf(store.run, 'rice_bag')).toBeGreaterThan(cashPriceOf(store.run, 'canned_beans'));

    // 顺序反过来也是同一件（取决于价钱，不取决于挑选顺序）
    const flipped = new Map([
      ['rice_bag', 1],
      ['canned_beans', 1]
    ]);
    expect(pickCashFor(store.run, flipped)).toBe('rice_bag');
  });

  it('一件都没挑时挑不出那一件（开关落空，不该让玩家付一笔算不出来的钱）', () => {
    const store = storePressing();
    expect(pickCashFor(store.run, new Map())).toBeNull();

    const result = tradeForBox(store, { picks: [], cashOn: true });
    expect(result.ok).toBe(false);
    expect(store.run.cash).toBe(900);
  });

  it('★ 现金不够时拒绝，并把价钱与余额一起说出来', () => {
    const store = storePressing();
    store.run.cash = 3;
    give(store.run, 'rice_bag', 1);
    const price = cashPriceOf(store.run, 'rice_bag');

    const result = tradeForBox(store, {
      picks: [
        { itemId: 'rice_bag', count: 1 },
        { itemId: 'battery', count: 1 }
      ],
      cashOn: true
    });

    expect(result.ok).toBe(false);
    const rejected = result.events.find((e) => e.type === 'rejected');
    expect(rejected).toMatchObject({ reason: `现金不够：这一件折 ${price} 元，你还有 3 元` });
    // 货一件都不能少、箱子也不给
    expect(countOf(store, 'battery')).toBe(6);
    expect(store.run.boxesToUnpack.length).toBe(0);
  });

  it('★★ 钱顶掉的那一件必须真的在屋里并付得起 —— 这一条两道都要过', () => {
    const store = storePressing();
    // 清单里放一个不存在的货 + 一个真有的：挑得出来（价钱算得出来），
    // 而命令层的库存校验会拦住它 —— 界面给出的清单不会这样，但命令层不能依赖界面自觉
    const bogus = tradeForBox(store, {
      picks: [
        { itemId: 'battery', count: 1 },
        { itemId: 'no_such_item' as string, count: 1 }
      ],
      cashOn: true
    });
    expect(bogus.ok).toBe(false);
    expect(countOf(store, 'battery')).toBe(6);

    // 屋里真有的两件：这一单成交，电池少 1（另一件被钱顶掉），钱按罐头折价扣
    const price = cashPriceOf(store.run, 'canned_beans');
    const ok = tradeForBox(store, {
      picks: [
        { itemId: 'battery', count: 1 },
        { itemId: 'canned_beans', count: 1 }
      ],
      cashOn: true
    });
    expect(ok.ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(5);
    expect(store.run.cash).toBe(900 - price);
  });

  it('★ 开关关着时一件钱都不花（三件货那一单不能被现金悄悄改掉）', () => {
    const store = storePressing();
    const result = tradeForBox(store, threeOf('battery'));
    expect(result.ok).toBe(true);
    expect(store.run.cash).toBe(900);
    const traded = result.events.find((e) => e.type === 'traded');
    expect(traded).toMatchObject({ cash: 0 });
  });

  it('折算价跟着**当天的物价**走：同一样东西在不同日子里折得不一样', () => {
    const store = storePressing();
    const run = store.run;
    // 不写死哪一天贵：逐日算出这一场灾难自己的倍率，挑最便宜与最贵的那两天比
    const factors = Array.from({ length: 15 }, (_, day) => ({ day, f: dayPriceFactor(day, run.disasterId) }));
    const low = factors.reduce((a, b) => (b.f < a.f ? b : a));
    const high = factors.reduce((a, b) => (b.f > a.f ? b : a));
    expect(high.f).toBeGreaterThan(low.f);

    run.day = low.day;
    const cheap = cashPriceOf(run, 'rice_bag');
    run.day = high.day;
    const dear = cashPriceOf(run, 'rice_bag');
    expect(dear).toBeGreaterThan(cheap);
  });
});

