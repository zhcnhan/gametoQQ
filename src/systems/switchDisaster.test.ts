/**
 * ★★ 换灾难的走查入口（用户 2026-10 连着几轮报"指令没生效"）
 *
 * ## 这个文件存在的理由，就是那几轮是怎么被浪费掉的
 *
 * 用户的原话：
 *
 * > "那个切换灾难指令根本就没生效过，他只会在控制台发一句
 * >  `[囤货末世] 换成了「热浪」…` 类似的话就再也没有任何变化了"
 *
 * 查下去是**三个错叠在一起**，而每一个单独看都"说得通"：
 *
 *  ① 那段逻辑写在 `main.ts` 的 `if (import.meta.env.DEV)` 里 ——
 *     `npm run build` 出来的那一份**压根没有它**；
 *  ② ★ **它一次都没有被测试跑过**：`main.ts` 一 import 就装配整个应用
 *     （抓 `#app`、建 store、挂路由），所以那个函数搬不进单测 ——
 *     它唯一的验收方式是"人工去控制台敲一下看屏幕"；
 *  ③ 而"看屏幕"这条路当时也是断的：那条带子被 `style.css` 里一段**坏注释**
 *     吃掉了（见 `style.css` 桌面适配那段），于是屏幕上**真的没有任何变化**。
 *
 * 三条里最该记的是 ②：**一个只靠"人工敲一下"来验收的功能，事实上没有验收。**
 * 所以换灾难的逻辑搬到了 `systems/`（纯函数），而这一组用例把它钉住。
 */
import { describe, expect, it } from 'vitest';
import { getDisasterDef } from '../data/disaster';
import { createStartingRun } from './setup';
import { findDisasterByName, switchDisaster } from './switchDisaster';

describe('★★ 换灾难：控制台/URL 那两条入口背后的逻辑', () => {
  it('★ 按**中文名**认得出（用户敲的是 `disaster("热浪")`）', () => {
    expect(findDisasterByName('热浪')?.id).toBe('heat_wave');
    // 按 id 也认得出（URL 那条路用得上）
    expect(findDisasterByName('heat_wave')?.id).toBe('heat_wave');
    // 前后空格容错（从控制台粘过来常带空格）
    expect(findDisasterByName('  洪水  ')?.id).toBe('flood_urban');
  });

  it('认不出时**返回 null，不抛**（它跑在控制台里，抛异常会很难看）', () => {
    expect(findDisasterByName('哥斯拉')).toBeNull();
    expect(findDisasterByName('')).toBeNull();
  });

  it('★★ 换成热浪：`run.disasterId` 真的变了，而且**盘面跟着变**', () => {
    const run = createStartingRun(20261001);
    expect(run.disasterId).toBe('cold_snap');
    const result = switchDisaster(run, '热浪');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('热浪');
    expect(run.disasterId).toBe('heat_wave');
    // ★ 空间维度也要跟着重铺（否则"换一场"只换了名字）
    expect(run.shelves.length).toBe(createStartingRun(20261001, { disasterId: 'heat_wave' }).shelves.length);
  });

  it('★★ 换成洪水：屋里的**块数与排数**真的按这一场重铺（那是这一维的可见部分）', () => {
    const run = createStartingRun(20261001);
    const before = run.shelves.map((s) => s.h);
    const result = switchDisaster(run, '洪水');
    expect(result.ok).toBe(true);
    // 洪水：capacityFactor 0.8 → 每块 4 排变 3 排
    const after = run.shelves.map((s) => s.h);
    expect(after, `换完之后排数没变（${before.join('/')} → ${after.join('/')}）`).not.toEqual(before);
    expect(run.shelves.every((s) => s.h === 3)).toBe(true);
  });

  it('★ 换成摘掉货架的那一场：块数真的少一块（内涝摘 shelf_a）', () => {
    const run = createStartingRun(20261001);
    expect(run.shelves.length).toBe(3);
    switchDisaster(run, '内涝');
    expect(run.shelves.map((s) => s.id)).not.toContain('shelf_a');
    expect(run.shelves.length).toBe(2);
  });

  it('★ 认不出的那一场**什么都不改**（不能改一半再报错）', () => {
    const run = createStartingRun(20261001);
    const snapshotId = run.disasterId;
    const snapshotShelves = JSON.stringify(run.shelves);
    const result = switchDisaster(run, '哥斯拉');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('哥斯拉');
    expect(run.disasterId).toBe(snapshotId);
    expect(JSON.stringify(run.shelves)).toBe(snapshotShelves);
  });

  it('★ 116 场**每一场都换得动**（不是只有那几个手测过的）', async () => {
    const { DISASTER_DEFS } = await import('../data/disaster');
    const broken: string[] = [];
    for (const def of DISASTER_DEFS) {
      const run = createStartingRun(20261001);
      const result = switchDisaster(run, def.name);
      if (!result.ok || run.disasterId !== def.id) broken.push(`${def.name}(${def.id})`);
      // 而且换完之后必须真的按这一场铺（至少一块、至少一排 —— §4A 不许卡死）
      if (run.shelves.length < 1 || run.shelves.some((s) => s.h < 1)) {
        broken.push(`${def.name} 换完是空屋`);
      }
    }
    expect(broken, '这些场次换不过去').toEqual([]);
  });

  it('★ 换完之后 `getDisasterDef` 读得到（认不出的 id 会在别处抛异常）', () => {
    const run = createStartingRun(20261001);
    switchDisaster(run, '沙暴');
    expect(() => getDisasterDef(run.disasterId)).not.toThrow();
    expect(getDisasterDef(run.disasterId).name).toBe('沙暴');
  });
});
