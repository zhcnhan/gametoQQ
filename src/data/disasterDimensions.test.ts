/**
 * 灾难维度签名的守护测试（§10B.3.1 的机械验收办法 / 5b）。
 *
 * ## 这个文件在守什么
 *
 * "一百多场"退化的情况**不是写得难看**，而是写着写着只剩数字在变。
 * 那种退化肉眼看不出来：每一场单看都合理，只有把它们排成矩阵才看得出
 * "这 20 场是同一个东西"。
 *
 * 所以 §10B.3.1 给了一条机械判据：
 *
 * > 任意两场灾难如果只在前 4 个维度上不同，就必须合并或重写。
 *
 * 而这条判据要能真的判，前提是"这一场用了几维"**是算出来的**。
 * 所以下面测试的重点不是"现在这 4 场合格"（那只说明今天没事），
 * 而是**判据本身会不会失效**：
 *
 *  1. 每一维都读得出值、且归一化正确（不写 = 写中性值）；
 *  2. 合成维度（第 9 / 14 维各含两件事）**只算一维**，不虚高；
 *  3. ★ **两场只差 L1 的假灾难必须被判不合格** —— 这是反证，
 *     没有它，整条校验可能只是"看起来在守"；
 *  4. 现有那几场真的过得了（否则判据太严，会逼着内容去凑维度数）。
 */
import { describe, expect, it } from 'vitest';
import { DISASTER_DEFS } from './disaster';
import {
  DISASTER_DIMENSIONS,
  L1_DIMENSION_NOS,
  disasterSignature,
  sameButL1,
  usedDimensions
} from './disasterDimensions';
import type { DisasterProfile } from '../model/types';

/** 造一场最小可用的灾难（只给必填字段），用来做反证 */
function fakeDisaster(over: Partial<DisasterProfile> & { id: string; name: string }): DisasterProfile {
  return {
    calendar: [],
    dailyDrain: {},
    priorityCategories: [],
    windowScene: 'x',
    temperatures: {},
    spoilRate: 1,
    family: '温度',
    level: 'L1',
    tier: 1,
    axis: '',
    counterIntuitive: '',
    ...over
  } as DisasterProfile;
}

describe('维度清单本身', () => {
  it('恰好 17 维，编号 1~17 连续无缺（§10B.3.1 那张表）', () => {
    expect(DISASTER_DIMENSIONS).toHaveLength(17);
    const nos = DISASTER_DIMENSIONS.map((d) => d.no);
    expect(nos).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });

  it('每一维都有中文名，且与策划案那张表对得上', () => {
    const labels = DISASTER_DIMENSIONS.map((d) => d.label);
    for (const want of ['每日消耗', '腐坏速度', '刚需排序', '外界温度', '独有机制']) {
      expect(labels).toContain(want);
    }
    expect(DISASTER_DIMENSIONS.filter((d) => d.tier === 'L1')).toHaveLength(4);
    expect(L1_DIMENSION_NOS).toEqual([1, 2, 3, 4]);
  });

  it('★ 归一化：不写与写中性值必须读到同一个值（否则"用了几维"会凭空虚高）', () => {
    const bare = fakeDisaster({ id: 'a', name: 'A' });
    const neutral = fakeDisaster({
      id: 'b',
      name: 'B',
      shelterDecayPerDay: 0,
      restEfficiency: 1,
      carryFactor: 1,
      actionPointDelta: 0,
      shopSupplyFactor: 1,
      closedShopIds: [],
      priceSurcharge: 0,
      eventPoolWeights: {},
      npcVisitFactor: 1,
      categoryEfficiency: {},
      capacityFactor: 1,
      unusableShelfIds: [],
      healthRiskPerDay: 0,
      scoreWeights: {},
      specialMechanics: []
    });
    expect(disasterSignature(bare)).toBe(disasterSignature(neutral));
  });

  it('★ 合成维度只算一维：第 9 维里"库存减半"与"关掉五金店"是同一维的两种取值', () => {
    const a = fakeDisaster({ id: 'a', name: 'A', shopSupplyFactor: 0.5 });
    const b = fakeDisaster({ id: 'b', name: 'B', closedShopIds: ['hardware'] });
    // 两场都只"用到第 9 维"，而不是各占一维
    expect(usedDimensions(a)).toEqual([9]);
    expect(usedDimensions(b)).toEqual([9]);
    // 但它们的取值不同 → 签名不同（不是换皮）
    expect(disasterSignature(a)).not.toBe(disasterSignature(b));
  });
});

describe('★★ 反证：只差 L1 的假灾难必须被判不合格', () => {
  it('两场一模一样 → 判"全部 17 维相同"', () => {
    const a = fakeDisaster({ id: 'a', name: '甲', dailyDrain: { fuel: 2 } });
    const b = fakeDisaster({ id: 'b', name: '乙', dailyDrain: { fuel: 2 } });
    const verdict = sameButL1(a, b);
    expect(verdict).not.toBeNull();
    expect(verdict).toContain('全部 17 维上完全相同');
  });

  it('★ 只差"更冷 / 烂得更快 / 刚需换了 / 消耗更多" → 判不合格（这就是换皮）', () => {
    const base = fakeDisaster({
      id: 'a',
      name: '寒潮甲',
      dailyDrain: { fuel: 2 },
      spoilRate: 0.5,
      priorityCategories: ['fuel', 'warmth'],
      temperatures: { 0: -18 }
    });
    // 第 1~4 维全动一遍，一个 L2 维度都不碰 —— 那正是 §10B.3.1 说的"同一件事的不同数字"
    const clone = fakeDisaster({
      id: 'b',
      name: '寒潮乙',
      dailyDrain: { fuel: 3 },
      spoilRate: 0.3,
      priorityCategories: ['fuel'],
      temperatures: { 0: -25 }
    });
    const verdict = sameButL1(base, clone);
    expect(verdict, '只差 L1 的两场必须被判不合格').not.toBeNull();
    expect(verdict).toContain('只在第');
    expect(verdict).toContain('L1');
  });

  it('动了任何一个 L2 维度 → 不再判不合格（判据不能太严）', () => {
    const base = fakeDisaster({ id: 'a', name: '甲', dailyDrain: { fuel: 2 } });
    const withRest = fakeDisaster({ id: 'b', name: '乙', dailyDrain: { fuel: 3 }, restEfficiency: 0.6 });
    expect(sameButL1(base, withRest)).toBeNull();
  });
});

describe('现有的 4 场：真的过得了这条判据', () => {
  it('逐对比较，没有一对"只差 L1"', () => {
    const pairs: string[] = [];
    for (let i = 0; i < DISASTER_DEFS.length; i++) {
      for (let j = i + 1; j < DISASTER_DEFS.length; j++) {
        const a = DISASTER_DEFS[i]!;
        const b = DISASTER_DEFS[j]!;
        const verdict = sameButL1(a, b);
        if (verdict) pairs.push(verdict);
      }
    }
    expect(pairs).toEqual([]);
  });

  it('每一场声明的 level 与它真正用到的维度数对得上', () => {
    const MIN = { L1: 4, L2: 6, L3: 10, L4: 15 } as const;
    const bad: string[] = [];
    for (const def of DISASTER_DEFS) {
      const used = usedDimensions(def);
      if (used.length < MIN[def.level]) {
        bad.push(`${def.name} 声称 ${def.level} 且只用了 ${used.length} 维`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('★ 每场都用到了 L1 的全部四维（基础四维是底，不是可选项）', () => {
    // 温度（第 4 维）是必填字段，所以它必然算"用到"；其余三维每场都该给出取值
    for (const def of DISASTER_DEFS) {
      const used = usedDimensions(def);
      for (const no of L1_DIMENSION_NOS) {
        expect(used, `${def.name} 缺第 ${no} 维`).toContain(no);
      }
    }
  });

  it('没有任何两场签名相同（真·换皮）', () => {
    const sigs = DISASTER_DEFS.map((d) => `${d.name}:${disasterSignature(d)}`);
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const s of sigs) {
      const [name, sig] = s.split(/:(.*)/s) as [string, string];
      const prev = seen.get(sig);
      if (prev) dupes.push(`${prev} 与 ${name}`);
      else seen.set(sig, name);
    }
    expect(dupes).toEqual([]);
  });
});
