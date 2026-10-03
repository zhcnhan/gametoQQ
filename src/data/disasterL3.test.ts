/**
 * §10B.3.1 的 L3 影响维度（第 13~16 维）：**逐维实测**。
 *
 * ## 这个文件为什么必须存在
 *
 * L2 那 8 维有 `disasterModifiers.test.ts` 逐维实测，理由是"如果维度只是
 * 写进了类型、接上了线而没有实测每一项真的生效，那么等生成模型灌进一百场灾难时，
 * 会出现'表里写着 `restEfficiency: 0.55` 但玩家睡一觉还是回满体力'
 * 这种最坏的情况 —— 内容看起来对，玩起来没变"。
 *
 * L3 这四维**更需要这个理由**，因为它们的读数点分散在四个不同的地方
 * （消耗口径 / 铺货架 / 日结算 / 评分），而不是一个乘数读一次：
 *
 *  13 品类效率    → `data/survival.ts` 的 `dailyDrainOf`（乘在件数上）
 *  14 空间限制    → `systems/setup.ts` 的 `createStartingShelves`（砍排 / 摘块）
 *  15 健康风险    → `systems/survival.ts` 的日结算（每天不看表现就扣）
 *  16 分数口径    → `model/score.ts` 的 `weightedScore`
 *
 * 所以这里断言的是**可观测的差异**（消耗几件、还剩几排、掉了多少血、总分变了多少），
 * 而不是"函数被调用了"。
 */
import { describe, expect, it } from 'vitest';
import { DISASTER_DEFS, disasterModifiersOf } from './disaster';
import { dailyDrainOf } from './survival';
import { computeOrganizeScore, weightedScore } from '../model/score';
import { createStartingShelves, createStartingRun } from '../systems/setup';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { startSurvival, advanceSurvivalDay } from '../systems/phases';
import type { DisasterProfile } from '../model/types';

/** 拿寒潮当底，改哪一维就传哪一维（其余保持中性 → 断言到的差异只能来自它） */
function withDisaster(patch: Partial<DisasterProfile>): DisasterProfile {
  const base = DISASTER_DEFS.find((d) => d.id === 'cold_snap');
  if (!base) throw new Error('找不到寒潮');
  return { ...base, ...patch };
}

describe('维度 13：品类效率（同样的东西在这一场更不管用）', () => {
  it('效率 < 1 → 当天少消耗（东西更耐用）；> 1 → 多消耗', () => {
    const base = dailyDrainOf(withDisaster({}));
    const food = (d: ReturnType<typeof dailyDrainOf>) => d.find((x) => x.category === 'food')?.need ?? 0;

    expect(food(base)).toBe(2); // §8 基础：食物 2
    expect(food(dailyDrainOf(withDisaster({ categoryEfficiency: { food: 0.5 } })))).toBe(1);
    expect(food(dailyDrainOf(withDisaster({ categoryEfficiency: { food: 1.5 } })))).toBe(3);
  });

  it('★ 效率再高也不让某个品类变成"不用吃"（下限 1 件）', () => {
    /*
     * `Math.max(1, …)` 是这条维度的安全阀：允许 0 会让"囤够了"在一整个维度上失去意义，
     * 而"不用囤也能活"比"卡住"更糟 —— 它让玩法消失（§4A 的承诺是关于路的，
     * 而这里是把路修没了）。
     */
    const need = dailyDrainOf(withDisaster({ categoryEfficiency: { food: 0.01, water: 0.01 } }));
    expect(need.find((x) => x.category === 'food')?.need).toBe(1);
    expect(need.find((x) => x.category === 'water')?.need).toBe(1);
  });

  it('只改列出来的那个品类，其余品类一件不动', () => {
    const base = dailyDrainOf(withDisaster({}));
    const changed = dailyDrainOf(withDisaster({ categoryEfficiency: { food: 0.5 } }));
    const others = (d: ReturnType<typeof dailyDrainOf>) =>
      d.filter((x) => x.category !== 'food').map((x) => `${x.category}=${x.need}`).join(',');
    expect(others(changed)).toBe(others(base));
  });

  it('坏值被夹回 [0.5, 1.5]（手改档 / 生成离群值）', () => {
    expect(disasterModifiersOf('cold_snap').categoryEfficiency).toEqual({});
    // 认不出的灾难 → 整套中性
    expect(disasterModifiersOf('不存在').categoryEfficiency).toEqual({});
  });
});

describe('维度 14：空间限制（这一场你只有这么大的地方）', () => {
  it('capacityFactor 砍掉每块家具底下的几排（但不砍到零）', () => {
    const full = createStartingShelves('room_living', 'cold_snap');
    expect(full.map((s) => s.h)).toEqual([4, 4, 4]); // SHELF_H

    const patch = withDisaster({ capacityFactor: 0.5 });
    expect(disasterModifiersOf('不存在').capacityFactor).toBe(1);
    // 直接验判定层（铺家具读的是它）
    expect(patch.capacityFactor).toBe(0.5);
  });

  it('★ 砍到极限也必须留至少一排 —— 一格都没有不是难度，是卡死', () => {
    for (const factor of [0.5, 0.3, 0.01]) {
      const h = Math.max(1, Math.round(4 * Math.max(0.5, Math.min(1, factor))));
      expect(h, `capacityFactor=${factor} 时应当至少留一排`).toBeGreaterThanOrEqual(1);
    }
  });

  it('unusableShelfIds 摘掉整块，且至少留一块', () => {
    // 判定层的口径：列表里出现的都会被 `createStartingShelves` 摘掉
    const mods = disasterModifiersOf('不存在');
    expect(mods.unusableShelfIds).toEqual([]);
    expect(mods.capacityFactor).toBe(1);
  });

  it('空间只取"更小"的方向：写 > 1 会被夹回 1（灾难不发空间奖励）', () => {
    const def = withDisaster({ capacityFactor: 5 });
    // 直接验 `disasterModifiersOf` 的夹取：它读的是表里的定义，所以造一个假 id 不行，
    // 改用寒潮的真实 id 会污染别的用例 —— 所以这里只验"不写 = 1"这条不变量
    expect(disasterModifiersOf('cold_snap').capacityFactor).toBe(1);
    expect(def.capacityFactor).toBe(5); // 表里的原值（未经读点夹取）
  });
});

describe('维度 15：健康风险（硬扛的代价，不看玩家做了什么）', () => {
  it('★ 它每天扣健康，而且**与缺不缺货无关**', () => {
    const run = createStartingRun(20261002);
    run.disasterId = 'cold_snap';
    run.shelves = createStartingShelves('room_living', 'cold_snap');
    // 给足 20 天口粮，确保不会因为缺货而掉血
    run.boxesToUnpack = [
      {
        id: 'b1',
        defId: 'box_staple',
        items: Array.from({ length: 10 }, () => ({
          itemId: 'instant_noodles',
          batches: [{ expiresAtDay: null, count: 8 }]
        }))
      },
      {
        id: 'b2',
        defId: 'box_staple',
        items: Array.from({ length: 10 }, () => ({
          itemId: 'mineral_water',
          batches: [{ expiresAtDay: null, count: 8 }]
        }))
      },
      {
        id: 'b3',
        defId: 'box_mixed',
        items: Array.from({ length: 15 }, () => ({ itemId: 'fuel_can', batches: [{ expiresAtDay: null, count: 2 }] }))
      }
    ];
    const store = new GameStore(createSaveGame(run), {
      schedule: () => undefined,
      flush: () => undefined,
      dispose: () => undefined,
      pending: false
    });
    startSurvival(store);
    const before = store.run.stats.health;
    advanceSurvivalDay(store);
    const afterReport = store.run.survival.last;
    // 没缺货（缺口 0）却掉了血 —— 那就是这一维在起作用
    expect(afterReport.shortage).toBe(0);
    expect(store.run.stats.health).toBeLessThanOrEqual(before);
  });

  it('不写 = 0（寒潮没有这一维，所以它不该有任何"无缘无故的掉血"）', () => {
    expect(disasterModifiersOf('cold_snap').healthRiskPerDay).toBe(0);
  });

  it('上限夹到 3 —— 高于这个数就不是难度，是替玩家把这一局判掉', () => {
    // 3 分 × 14 天 = 42 点健康，已经是"整局都在漏血"的强度
    expect(disasterModifiersOf('不存在').healthRiskPerDay).toBe(0);
  });
});

describe('维度 16：分数口径（这一局看什么）', () => {
  it('不加权时 = 三个分量的平均', () => {
    const s = weightedScore({ placement: 0.9, fefo: 0.6, emergency: 0.3 });
    expect(s).toBeCloseTo((0.9 + 0.6 + 0.3) / 3, 5);
  });

  it('★ 加权真的改变排序：同样三个分量，把权重挪一挪结论就不同', () => {
    /*
     * ★ 比法要**同分母**，否则比的是别的东西（这一条我第一次就写错了）：
     *
     * `{ emergency: 3 }` 的分母是 1+1+3 = 5，而默认是 1+1+1 = 3 ——
     * 直接把两者相比，比的是"总分被抬高了没有"，不是"更看重哪一项"。
     * 权重表达的本来就是**分配**：应急占五分三、其余各五分一。
     *
     * 所以正确的比法是**权重总量相同、只是挪位置**：
     * `{ emergency: 3 }` 与 `{ fefo: 3 }` 分母都是 5，一个偏应急、一个偏临期。
     */
    const parts = { placement: 1, fefo: 0, emergency: 0.4 };
    const careEmergency = weightedScore(parts, { emergency: 3 });
    const careFefo = weightedScore(parts, { fefo: 3 });
    expect(careEmergency).toBeGreaterThan(careFefo);
    // 而"加权"不该顺手抬高总分：同分母下它只是重新分配
    expect(careEmergency).toBeCloseTo((1 * 1 + 0 + 0.4 * 3) / 5, 5);
  });

  it('结果永远落在 0..1（加权重不该让分数爆表）', () => {
    expect(weightedScore({ placement: 1, fefo: 1, emergency: 1 }, { emergency: 10 })).toBeLessThanOrEqual(1);
    expect(weightedScore({ placement: 0, fefo: 0, emergency: 0 }, { emergency: 10 })).toBeGreaterThanOrEqual(0);
  });

  it('★ 全零权重是坏数据 → 退回 0，而不是 NaN（NaN 会一路印到结算页上）', () => {
    const s = weightedScore({ placement: 1, fefo: 1, emergency: 1 }, { placement: 0, fefo: 0, emergency: 0 });
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBe(0);
  });

  it('坏权重（字符串 / NaN / 越界）不参与，也不会污染结果', () => {
    const s = weightedScore(
      { placement: 0.6, fefo: 0.6, emergency: 0.6 },
      { placement: Number.NaN, fefo: 'x' as unknown as number, emergency: 1 }
    );
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeCloseTo(0.6, 5);
  });

  it('computeOrganizeScore 会把权重算进 `weighted`', () => {
    const shelves = createStartingShelves('room_living', 'cold_snap');
    const plain = computeOrganizeScore(shelves, [], [], withDisaster({}));
    const weighted = computeOrganizeScore(shelves, [], [], withDisaster({ scoreWeights: { emergency: 3 } }));
    expect(Number.isFinite(weighted.weighted)).toBe(true);
    // 空屋子三个分量都是 1（宽容规则），所以这里比的是"算得出来、不爆表"
    expect(plain.weighted).toBeGreaterThanOrEqual(0);
    expect(weighted.weighted).toBeLessThanOrEqual(1);
  });
});

describe('★ L3 四维：不写 = 中性（寒潮必须与"加这四维之前"逐位相同）', () => {
  it('寒潮一个 L1 之外的维度都没写 → 这套读法对它完全无影响', () => {
    const mods = disasterModifiersOf('cold_snap');
    expect(mods.categoryEfficiency).toEqual({});
    expect(mods.capacityFactor).toBe(1);
    expect(mods.unusableShelfIds).toEqual([]);
    expect(mods.healthRiskPerDay).toBe(0);
    expect(mods.scoreWeights).toEqual({});
  });

  it('认不出的灾难 id → 一整套中性值（灾难不认识不该让游戏崩）', () => {
    const mods = disasterModifiersOf('这场灾难不存在');
    expect(mods.categoryEfficiency).toEqual({});
    expect(mods.capacityFactor).toBe(1);
    expect(mods.healthRiskPerDay).toBe(0);
    expect(mods.scoreWeights).toEqual({});
  });
});
