/**
 * 身份熟练度与身份分批的守护测试（§10B.3 / M3 第 3 步）。
 *
 * ## 这个文件在守什么
 *
 * §10B.3 把这一层定为**唯一一个真的改数值**的环节（"成就是勋章，身份熟练度是
 * 开局参数"），所以它最容易出的三类问题都不是"算错数"：
 *
 *  1. ★ **等级漏进单局公式** —— 那会让 §12 的三条永久回归探针只对"某个等级"成立，
 *     而且**没有任何测试会发现**（探针里用的身份永远是 1 级）。
 *     这一条靠"加成只有三个字段、且只在 `identityStartOf` 换算"来守；
 *  2. **两个读者算出不同的数** —— 界面说一趟能拿 19kg、命令层说 18kg。
 *     这一条靠"等级快照进 `RunState`，两边读同一个数"来守；
 *  3. **升级看不见** —— 一个玩家永远不知道存在的隐藏数值等于没有成长。
 *     这一条靠结算页那一段（`EndingScreen.identityHtml`）来守。
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_DEFS } from '../data/identities';
import { MAX_IDENTITY_LEVEL, clampIdentityLevel, sanitizeIdentityLevels } from '../data/identityLevels';
import { createMetaProfile } from '../state/save';
import {
  LEVEL_BONUS_PER_STEP,
  identityStartOf,
  levelOf,
  raiseIdentityLevel,
  startNumbersOf,
  unlockHintOf
} from './identity';
import type { MetaProfile } from '../model/types';

function metaWith(levels: Record<string, number> = {}): MetaProfile {
  return Object.assign(createMetaProfile(), { identityLevels: levels });
}

describe('熟练度：读等级的口径', () => {
  it('没记录 = 1 级（不是 0 —— 一个从没活到最后的身份也是能用的）', () => {
    expect(levelOf(metaWith(), 'nurse')).toBe(1);
  });

  it('越界与坏值一律夹回 1~3（手改档、云备份合并都可能给出这些）', () => {
    const meta = metaWith({ nurse: 0, tailor: 99, security_guard: -5 });
    expect(levelOf(meta, 'nurse')).toBe(1);
    expect(levelOf(meta, 'tailor')).toBe(MAX_IDENTITY_LEVEL);
    expect(levelOf(meta, 'security_guard')).toBe(1);
    expect(clampIdentityLevel(Number.NaN)).toBe(1);
    expect(clampIdentityLevel('2')).toBe(1); // 字符串不算数
    expect(clampIdentityLevel(2.4)).toBe(2);
  });

  it('★ 存档自愈：认不出的身份 id 与坏值都丢掉（不许留来历不明的状态）', () => {
    const cleaned = sanitizeIdentityLevels({
      nurse: 2,
      这个身份不存在: 3,
      tailor: 'abc',
      security_guard: Number.NaN,
      teacher_retired: 99
    });
    expect(cleaned).toEqual({ nurse: 2, teacher_retired: MAX_IDENTITY_LEVEL });
  });
});

describe('熟练度：开局参数（唯一的换算点）', () => {
  it('1 级就是 `IdentityDef` 里写的那一份（零加成，老档行为不变）', () => {
    for (const def of IDENTITY_DEFS) {
      const s = identityStartOf(metaWith(), def.id);
      expect(s.startCash, def.id).toBe(def.startCash);
      expect(s.vehicleCapacity, def.id).toBe(def.vehicleCapacity);
      expect(s.carryLimit, def.id).toBe(def.carryLimit);
      expect(s.level, def.id).toBe(1);
    }
  });

  it('每升一级只加那三个数，而且**只加一次**（不会越级重复加）', () => {
    for (const def of IDENTITY_DEFS) {
      for (const level of [1, 2, 3]) {
        const s = identityStartOf(metaWith({ [def.id]: level }), def.id);
        const steps = level - 1;
        expect(s.startCash, `${def.id} Lv${level}`).toBe(def.startCash + steps * LEVEL_BONUS_PER_STEP.startCash);
        expect(s.vehicleCapacity).toBe(def.vehicleCapacity + steps * LEVEL_BONUS_PER_STEP.vehicleCapacity);
        expect(s.carryLimit).toBe(def.carryLimit + steps * LEVEL_BONUS_PER_STEP.carryLimit);
      }
    }
  });

  it('★★ 加成的量级必须**小**（它是熟练奖励，不是碾压）', () => {
    /*
     * §6.2 的"三约束"（现金 / 车载 / 负重）本身就是紧的：
     * 两个身份的开局现金 780~1150，而 14 天刚需约 700~810 —— 余裕只有一成上下。
     * 一个"每级 +10%"的加成就足以把"要不要少买两罐燃料"这个决定抹平，
     * 而那是寒潮局唯一的核心取舍。
     *
     * 所以这里把"小"写成可执行的判据：**满级（3 级）的总加成不超过基准的 15%**。
     */
    for (const def of IDENTITY_DEFS) {
      const max = identityStartOf(metaWith({ [def.id]: MAX_IDENTITY_LEVEL }), def.id);
      const twoSteps = 2; // 3 级 = 加两次
      expect(max.startCash - def.startCash, `${def.id} 现金加成过大`).toBeLessThanOrEqual(
        def.startCash * 0.15 + 1
      );
      expect(max.vehicleCapacity - def.vehicleCapacity).toBeLessThanOrEqual(def.vehicleCapacity * 0.15 + 1);
      expect(max.carryLimit - def.carryLimit).toBeLessThanOrEqual(def.carryLimit * 0.15 + 1);
      expect(twoSteps).toBe(MAX_IDENTITY_LEVEL - 1);
    }
  });

  it('★ 认不出的身份 id 不抛异常（它跑在开局页的渲染路径上）', () => {
    expect(() => identityStartOf(metaWith(), '这个身份不存在')).not.toThrow();
    expect(identityStartOf(metaWith(), '这个身份不存在').startCash).toBe(0);
  });

  it('startNumbersOf 与 identityStartOf 是同一份数（两个 API 不许打架）', () => {
    const meta = metaWith({ nurse: 3 });
    const a = identityStartOf(meta, 'nurse');
    const b = startNumbersOf(meta, 'nurse');
    expect(b).toEqual({
      startCash: a.startCash,
      vehicleCapacity: a.vehicleCapacity,
      carryLimit: a.carryLimit,
      level: a.level
    });
  });

  it('满级时 toNext 是 0（界面据此说"已经满了"而不是"还要 0 次"）', () => {
    expect(identityStartOf(metaWith(), 'nurse').toNext).toBe(1);
    expect(identityStartOf(metaWith({ nurse: MAX_IDENTITY_LEVEL }), 'nurse').toNext).toBe(0);
  });
});

describe('熟练度：升级', () => {
  it('升一级就是 +1，而且会写进 meta', () => {
    const meta = metaWith();
    expect(raiseIdentityLevel(meta, 'nurse')).toBe(2);
    expect(meta.identityLevels['nurse']).toBe(2);
    expect(raiseIdentityLevel(meta, 'nurse')).toBe(3);
  });

  it('★ 到 3 级就停住（不会升到 4 —— 加成的区间是按 1~3 标定的）', () => {
    const meta = metaWith({ nurse: MAX_IDENTITY_LEVEL });
    expect(raiseIdentityLevel(meta, 'nurse')).toBe(MAX_IDENTITY_LEVEL);
    expect(raiseIdentityLevel(meta, 'nurse')).toBe(MAX_IDENTITY_LEVEL);
    expect(meta.identityLevels['nurse']).toBe(MAX_IDENTITY_LEVEL);
  });

  it('升级只动这一个身份，别的身份不受影响', () => {
    const meta = metaWith({ tailor: 2 });
    raiseIdentityLevel(meta, 'nurse');
    expect(meta.identityLevels).toEqual({ tailor: 2, nurse: 2 });
  });
});

describe('身份分批（§10B.3）：开局桌面只放三张', () => {
  it('★ 开局档恰好三个（§8 是"三选一"，不是"九选一"）', () => {
    const tier1 = IDENTITY_DEFS.filter((d) => d.tier === 1);
    expect(tier1).toHaveLength(3);
  });

  it('每个身份都分了档，而且档位在 1~4 里', () => {
    for (const def of IDENTITY_DEFS) {
      expect([1, 2, 3, 4], def.id).toContain(def.tier);
    }
  });

  it('★ 分批是"上手难度"而不是"强弱" —— 高 tier 不许全面强于低 tier', () => {
    /*
     * §10B.3 的红线：**身份必须是取舍，不是强弱**。
     *
     * 判据：任何一个高 tier 身份的**三项都 ≥ 某个 tier 1 身份**，
     * 就等于"解锁一个更强的选择" —— 那是数值成长，不是新打法。
     * 这里逐对比较，抓"全面压制"。
     */
    const tier1 = IDENTITY_DEFS.filter((d) => d.tier === 1);
    const dominations: string[] = [];
    for (const high of IDENTITY_DEFS.filter((d) => d.tier > 1)) {
      for (const low of tier1) {
        const better =
          high.startCash >= low.startCash &&
          high.vehicleCapacity >= low.vehicleCapacity &&
          high.carryLimit >= low.carryLimit;
        const strictly = high.startCash > low.startCash || high.vehicleCapacity > low.vehicleCapacity || high.carryLimit > low.carryLimit;
        if (better && strictly) dominations.push(`${high.name} 全面强于 ${low.name}`);
      }
    }
    expect(dominations).toEqual([]);
  });

  it('未解锁的身份也给得出一句"怎么解锁"（界面上要写这句）', () => {
    for (const def of IDENTITY_DEFS) {
      const hint = unlockHintOf(def.id);
      expect(hint.length, def.id).toBeGreaterThan(0);
    }
    expect(unlockHintOf('这个身份不存在').length).toBeGreaterThan(0);
  });
});

describe('★ 只改开局：等级不许渗进单局公式', () => {
  it('加成的字段就是那三个 —— 类型层面也只有一个换算点', () => {
    // 这条是"防扩散"的可执行形式：`LEVEL_BONUS_PER_STEP` 只许有这三个键。
    // 加第四个键（比如"每级多一个行动点"）会当场红，而那正是
    // "等级改到单局里"的第一步。
    expect(Object.keys(LEVEL_BONUS_PER_STEP).sort()).toEqual(['carryLimit', 'startCash', 'vehicleCapacity']);
  });

  it('`IdentityDef` 本身**不含**等级信息（等级只在 meta，不在内容表）', () => {
    // 内容表是"这个身份是什么"，等级是"你把它练到几级" —— 两者混在一起
    // 会让"加一个身份"变成"要同时想它在 3 个等级下的样子"
    for (const def of IDENTITY_DEFS) {
      expect(Object.keys(def)).not.toContain('level');
      expect(Object.keys(def)).not.toContain('identityLevel');
    }
  });
});
