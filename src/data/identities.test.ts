/**
 * 身份天赋的守卫（M4 W-06）。
 *
 * ## 这一组用例存在的理由
 *
 * W-06 之前，十个身份的天赋**全是** `categoryDiscount`，唯一执行点在
 * `systems/shop.ts`。W-06 往 `PerkRule` 里加了 `workCostFactor` 与
 * `extraHandySlot` —— 于是第一次出现"**规则生效了，但界面上一个字都没写**"这种错法。
 *
 * 它比"写了没生效"难查得多：
 *  · 玩家不会报 bug —— 他不知道自己少拿了两成体力，只会觉得这个身份"没什么感觉"；
 *  · 类型系统看不出来 —— `perk` 是个 `string`，写什么都通过；
 *  · 代码审查也容易过 —— 两个字段隔了十几行，而且它们**看起来**各自都对。
 *
 * 所以这里把"两个字段必须互相印证"变成一条会红的断言。
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS } from './items';
import { IDENTITY_DEFS, handySlotLimitOf, identityCategoryRate, identityWorkFactor, perkText } from './identities';

describe('身份天赋的文案与规则必须互相印证（M4 W-06）', () => {
  it('★ 每一条 `perk` 都含有 `perkText(perkRule)` —— 生效了那一条必须写在脸上', () => {
    for (const def of IDENTITY_DEFS) {
      const ruleText = perkText(def.perkRule);
      expect(
        def.perk.includes(ruleText),
        `身份 ${def.id}（${def.name}）的天赋文案里没有「${ruleText}」。\n` +
          `    实际文案：${def.perk}\n` +
          `    一条只有系统知道的天赋等于没有这条天赋（§10.1A）。`
      ).toBe(true);
    }
  });

  it('★ 文案里不许出现 ASCII 字母 —— 品类名漏映射就会以 "fuel" 的形式漏到界面上', () => {
    /*
     * `perkText` 用 `CATEGORY_NAMES[c] ?? c` 兜底，所以漏映射时它**不抛**，
     * 而是把英文 id 原样交给玩家（"fuel便宜 20%"）。这条就是那个兜底的守卫。
     */
    for (const def of IDENTITY_DEFS) {
      const text = `${def.perk}${perkText(def.perkRule)}`;
      expect(/[A-Za-z]/.test(text), `身份 ${def.id} 的天赋文案里出现了英文字母：${text}`).toBe(false);
    }
  });

  it('★ 品类中文名只有一份口径：天赋文案里用的是 CATEGORY_LABELS 那套词', () => {
    /*
     * 这里原来有一份自己的小表，与 `CATEGORY_LABELS` 有两处不一致
     * （"医疗品 / 奢侈品" vs 全界面的"医疗 / 享受"）。两处**永远不会
     * 同时出现在一屏上**，所以谁也不会报这个 bug —— 只能靠断言。
     */
    expect(CATEGORY_LABELS.medicine).toBe('医疗');
    expect(CATEGORY_LABELS.luxury).toBe('享受');
    // 十个身份的 perk 里不许出现那两个旧词
    for (const def of IDENTITY_DEFS) {
      expect(def.perk.includes('医疗品'), `${def.id} 的文案还在用旧词「医疗品」`).toBe(false);
      expect(def.perk.includes('奢侈品'), `${def.id} 的文案还在用旧词「奢侈品」`).toBe(false);
    }
  });

  it('四种 PerkRule 都至少有一个身份在用（加了新成员却没人用 = 白写）', () => {
    const kinds = new Set(IDENTITY_DEFS.map((d) => d.perkRule.kind));
    // `none` 是"没有门路"的兜底，允许没人用；另外三种必须是活的
    expect(kinds.has('categoryDiscount')).toBe(true);
    expect(kinds.has('workCostFactor')).toBe(true);
    expect(kinds.has('extraHandySlot')).toBe(true);
  });
});

describe('天赋读点：认不出身份时给默认值，绝不抛（M4 W-06 踩出来的）', () => {
  /*
   * ★★ 这一组的来源是一次**红了 37 条**的事故。
   *
   * `getIdentityDef('')` 会 `throw new Error('未知身份 id: ')` —— 而单测里
   * 满屏都是 `{ ...run, identityId: '' }` 这种骨架状态，天赋读点一接上就炸。
   * 教训（值得单独记）：**一个"设了默认值但会抛"的查询比没有默认值更糟** ——
   * 它看起来安全，实际不是。
   */
  it('空 id / 认不出的 id：折扣 0、成本乘数 1、顺手位 1 块', () => {
    for (const bad of ['', 'nope', 'GROUP_BUYER']) {
      expect(identityCategoryRate(bad, 'food')).toBe(0);
      expect(identityWorkFactor(bad)).toBe(1);
      expect(handySlotLimitOf(bad)).toBe(1);
    }
  });

  it('认得出的身份给出真值（否则上一条只是在验"什么都返回默认值"）', () => {
    expect(identityCategoryRate('group_buyer', 'food')).toBeCloseTo(0.15, 6);
    expect(identityCategoryRate('group_buyer', 'fuel')).toBe(0);
    expect(identityWorkFactor('warehouse_porter')).toBeLessThan(1);
    expect(handySlotLimitOf('security_guard')).toBe(2);
  });

  it('★ W-06 的两个新天赋真的落在数据里（不是只写在注释里）', () => {
    const porter = IDENTITY_DEFS.find((d) => d.id === 'warehouse_porter');
    const guard = IDENTITY_DEFS.find((d) => d.id === 'security_guard');
    expect(porter?.perkRule).toEqual({ kind: 'workCostFactor', rate: 0.8 });
    expect(guard?.perkRule).toEqual({ kind: 'extraHandySlot' });
    // 另外九个人仍是普通上限：这条破例不该悄悄变成常态
    const others = IDENTITY_DEFS.filter((d) => d.id !== 'security_guard');
    expect(others.every((d) => handySlotLimitOf(d.id) === 1)).toBe(true);
  });
});
