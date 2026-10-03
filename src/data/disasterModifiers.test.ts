/**
 * §10B.3.1 的 8 个 L2 影响维度：**逐维实测**。
 *
 * ## 这个文件为什么必须存在
 *
 * "多灾难"是 M3 最大的一块内容（112~116 场），而它的地基是这 8 个维度。
 * 如果维度只是"写进了类型、接上了线"而没有**实测每一项真的生效**，
 * 那么等生成模型灌进一百场灾难时，会出现"表里写着 `restEfficiency: 0.55`
 * 但玩家睡一觉还是回满体力"这种最坏的情况 —— 内容看起来对，玩起来没变。
 *
 * 所以这里每一项都断言**可观测的差异**（掉多少庇护所、回多少体力、
 * 几个行动点、几家店开门、多少钱、采样频率），而不是断言"函数被调用了"。
 *
 * ## 两条通用约定，也在这一组里守着
 *
 *  1. **不写 = 中性**：寒潮没定义这些字段，所以它必须与"加这些维度之前"逐位相同。
 *     这一条是"零破坏"的证明 —— 381 条既有测试全绿是它的旁证，这里是它的直证。
 *  2. **坏值不许污染存档**：乘数走 `disasterModifiersOf`，NaN / 越界一律夹回区间。
 *     M2 的 D-20 就是"一个 NaN 污染整份存档"，这里从入口堵住。
 */
import { describe, expect, it } from 'vitest';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { IDENTITY_DEFS } from '../data/identities';
import { DISASTER_DEFS, disasterModifiersOf, outdoorTemp } from '../data/disaster';
import { createCursor } from '../model/rng';
import { createStartingRun } from '../systems/setup';
import { chooseIdentity, chooseNightOption, endDay, ensureDayStocks, sleep } from '../systems/phases';
import { NIGHT_SLEEP } from '../data/nightEvents';
import { buildCartView, rollDayEvent } from '../systems/shop';
import { rollHelpRequest } from '../systems/help';
import { settleSurvivalDay } from '../systems/survival';
import type { DisasterProfile } from '../model/types';

const noop = { schedule() {}, flush() {}, dispose() {}, pending: false };

function freshStore(seed = 20261002): GameStore {
  const store = new GameStore(createSaveGame(createStartingRun(seed)), noop);
  chooseIdentity(store, IDENTITY_DEFS[0].id);
  ensureDayStocks(store);
  return store;
}

/**
 * 临时给寒潮加上几个 L2 字段，跑完自动还原。
 *
 * 为什么用"改造现有那场"而不是"新写一场测试灾难"：
 * 前者顺带证明了"这些字段加在存量灾难上是安全的"（存量灾难不写它们）。
 * 还原放在 `finally` 里 —— 忘了还原会污染同一文件里后面的用例，
 * 那种失败看起来会像是被测代码错了。
 */
function withModifiers<T>(patch: Partial<DisasterProfile>, body: () => T): T {
  const def = DISASTER_DEFS.find((d) => d.id === 'cold_snap');
  if (!def) throw new Error('找不到寒潮定义');
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) saved[key] = (def as unknown as Record<string, unknown>)[key];
  Object.assign(def, patch);
  try {
    return body();
  } finally {
    for (const key of Object.keys(patch)) {
      if (saved[key] === undefined) delete (def as unknown as Record<string, unknown>)[key];
      else (def as unknown as Record<string, unknown>)[key] = saved[key];
    }
  }
}

describe('§10B.3.1 L2 维度：默认值与坏值防御', () => {
  it('★ 不写 = 中性（寒潮必须与"加这些维度之前"完全一致）', () => {
    const m = disasterModifiersOf('cold_snap');
    expect(m.shelterDecayPerDay).toBe(0);
    expect(m.restEfficiency).toBe(1);
    expect(m.carryFactor).toBe(1);
    expect(m.actionPointDelta).toBe(0);
    expect(m.shopSupplyFactor).toBe(1);
    expect(m.priceSurcharge).toBe(0);
    expect(m.npcVisitFactor).toBe(1);
    expect(m.closedShopIds).toEqual([]);
    expect(m.eventPoolWeights).toEqual({});
  });

  it('★ 认不出的灾难不崩，退回中性值', () => {
    expect(disasterModifiersOf('这个灾难不存在').restEfficiency).toBe(1);
    expect(disasterModifiersOf(undefined).carryFactor).toBe(1);
  });

  it('★★ 坏值被夹进区间（NaN / 负数 / 巨数都不许污染存档）', () => {
    withModifiers({ restEfficiency: NaN, carryFactor: -5, actionPointDelta: 99, priceSurcharge: 1e9 }, () => {
      const m = disasterModifiersOf('cold_snap');
      expect(m.restEfficiency).toBe(1); // NaN → 默认值
      expect(m.carryFactor).toBe(0.5); // 负数 → 下界
      expect(m.actionPointDelta).toBe(1); // 巨数 → 上界
      expect(m.priceSurcharge).toBe(0.8); // 巨数 → 上界
    });
  });

  it('庇护所衰减只取"更坏"的方向（正数不该把灾难变成修房子）', () => {
    withModifiers({ shelterDecayPerDay: 99 }, () => {
      expect(disasterModifiersOf('cold_snap').shelterDecayPerDay).toBe(0);
    });
  });
});

describe('§10B.3.1 L2 维度：逐维实测', () => {
  it('① 庇护所额外衰减：屋子坏得更快', () => {
    const runOnce = (patch: Partial<DisasterProfile>): number =>
      withModifiers(patch, () => {
        const store = freshStore();
        store.commit((draft) => {
          draft.day = 3;
        });
        const before = store.run.stats.shelter;
        settleSurvivalDay(store.run);
        return before - store.run.stats.shelter;
      });
    const base = runOnce({});
    const worse = runOnce({ shelterDecayPerDay: -3 });
    expect(worse).toBeGreaterThan(base);
    expect(worse - base).toBe(3);
  });

  it('② 休息效率：睡觉回得更少', () => {
    const runOnce = (patch: Partial<DisasterProfile>): number =>
      withModifiers(patch, () => {
        const store = freshStore();
        store.commit((draft) => {
          draft.day = 3;
          draft.stats.stamina = 40;
        });
        settleSurvivalDay(store.run);
        return store.run.stats.stamina;
      });
    const base = runOnce({});
    const tired = runOnce({ restEfficiency: 0.5 });
    expect(tired).toBeLessThan(base);
  });

  it('③ 搬运折减：一趟提得更少', () => {
    const store = freshStore();
    const shopId = store.run.shopStocks[0]?.shopId ?? 'supermarket';
    const line = store.run.shopStocks.find((s) => s.shopId === shopId)?.lines[0];
    expect(line).toBeDefined();
    if (!line) return;
    const limitOf = (patch: Partial<DisasterProfile>): number =>
      withModifiers(patch, () => buildCartView(store.run, shopId, [{ itemId: line.itemId, count: 99 }])?.carryLimit ?? -1);
    const base = limitOf({});
    const heavy = limitOf({ carryFactor: 0.5 });
    expect(heavy).toBeLessThan(base);
    expect(heavy).toBeGreaterThanOrEqual(1); // 再糟也不该一件都搬不动
  });

  it('④ 行动点增减：一天少做一件事，但至少留 1 点', () => {
    /*
     * `endDay` 要求 `phase === 'organize'`（"先把东西放下再睡"），开局是 `stockpile_shop`。
     * 不摆正 phase 的话命令会被 reject，而"行动点没变"看起来像是维度没生效 ——
     * 这个坑我在一次性脚本里踩过一次，写进注释免得下次再踩。
     *
     * ★★ 第二个坑（M3 补内容时才显形）：**`endDay` 不保证跨天**。
     * 它先掷一次"今晚有没有事"（[`rollNight`]），有事就把 phase 推到 `night` 等你决定，
     * **行动点要等关灯之后才重算**。所以"调一次 `endDay` 然后读 `actionPoints`"
     * 本来就是错的写法 —— 它此前是**碰巧**对的：原来只有 6 条夜间事件，
     * 这个 seed 恰好掷空。M3 把夜间事件加到 28 条之后，同一个 seed 掷中了事件，
     * 于是行动点**一个都没动**（`3`），而报错看起来像"`actionPointDelta` 没生效"。
     *
     * 这类失败最值得记的一点：**测试通过的原因和它声称的原因不是同一个**。
     * 所以这里改成走完"入夜 → 直接睡 → 跨天"的完整路径，不再依赖掷骰运气。
     */
    const apOf = (patch: Partial<DisasterProfile>): number =>
      withModifiers(patch, () => {
        const store = freshStore();
        store.commit((draft) => {
          draft.day = -5;
          draft.phase = 'organize';
        });
        endDay(store);
        if (store.run.phase === 'night') {
          chooseNightOption(store, NIGHT_SLEEP); // 直接睡：不参与今晚的事
          sleep(store);
        }
        return store.run.actionPoints;
      });
    const base = apOf({});
    expect(apOf({ actionPointDelta: -1 })).toBe(base - 1);
    expect(apOf({ actionPointDelta: -99 })).toBeGreaterThanOrEqual(1);
  });

  it('⑤ 商店供应：货架空一半 + 整家店不开门', () => {
    const stockOf = (patch: Partial<DisasterProfile>): { total: number; shops: number } =>
      withModifiers(patch, () => {
        const store = freshStore();
        store.commit((draft) => {
          draft.shopStocks = [];
        });
        ensureDayStocks(store);
        return {
          total: store.run.shopStocks.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.stock, 0), 0),
          shops: store.run.shopStocks.length
        };
      });
    const base = stockOf({});
    expect(stockOf({ shopSupplyFactor: 0.5 }).total).toBeLessThan(base.total);
    expect(stockOf({ closedShopIds: ['pharmacy'] }).shops).toBe(base.shops - 1);
  });

  it('⑥ 物价加成：这一场本来就贵', () => {
    const priceOf = (patch: Partial<DisasterProfile>): number =>
      withModifiers(patch, () => {
        const store = freshStore();
        store.commit((draft) => {
          draft.shopStocks = [];
        });
        ensureDayStocks(store);
        return store.run.shopStocks[0]?.lines[0]?.price ?? -1;
      });
    expect(priceOf({ priceSurcharge: 0.5 })).toBeGreaterThan(priceOf({}));
  });

  it('⑦ 事件池权重：某一类事的出场率被抬高', () => {
    /*
     * 用**采样频率**断言，而不是"权重函数返回了 3" ——
     * 前者是玩家能感觉到的，后者只是实现细节。
     * 3000 次抽样足够让 8 倍权重显出差距（实测 1274 → 2582）。
     */
    const sampleSupply = (patch: Partial<DisasterProfile>): { supply: number; other: number } =>
      withModifiers(patch, () => {
        let supply = 0;
        let other = 0;
        for (let i = 0; i < 3000; i++) {
          const id = rollDayEvent(createCursor(1000 + i), 'supermarket', [], 'cold_snap');
          if (id === 'd_panic_buying' || id === 'd_purchase_limit') supply += 1;
          else if (id) other += 1;
        }
        return { supply, other };
      });
    const base = sampleSupply({});
    const boosted = sampleSupply({ eventPoolWeights: { supply: 8 } });
    expect(boosted.supply).toBeGreaterThan(base.supply);
    expect(boosted.other).toBeLessThan(base.other);
  });

  it('⑧ NPC 行为：邻居来得更勤 / 没人敢出门', () => {
    const sampleVisits = (patch: Partial<DisasterProfile>): number =>
      withModifiers(patch, () => {
        let hits = 0;
        for (let i = 0; i < 4000; i++) {
          // 必须传 disasterId：不传会读到中性值 1，三次采样完全相同
          if (rollHelpRequest(createCursor(2000 + i), [], 'cold_snap')) hits += 1;
        }
        return hits;
      });
    const base = sampleVisits({});
    expect(sampleVisits({ npcVisitFactor: 1.5 })).toBeGreaterThan(base);
    expect(sampleVisits({ npcVisitFactor: 0.3 })).toBeLessThan(base);
  });

  it('⑨ 外表温度按灾难读（D-15）：同一套界面能显示 -36 也能显示 +41', () => {
    expect(outdoorTemp(0, 'cold_snap')).toBe(-18);
    expect(outdoorTemp(0, '不存在的灾难')).toBe(0);
    expect(outdoorTemp(99, 'cold_snap')).toBe(outdoorTemp(14, 'cold_snap')); // 夹到最后一档
  });
});
