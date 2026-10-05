/**
 * 开局的**灾难阶梯**（M4 决策 A / 工单 W-01）。
 *
 * ## 这个文件在守什么
 *
 * 116 场灾难从 M3 起就躺在 `data/disaster.ts` 里，而**实机每一局都是寒潮** ——
 * 因为 `systems/setup.ts` 把 `M1_DISASTER_ID` 写死了。于是 43 场写了
 * `capacityFactor`、31 场写了 `unusableShelfIds`，**一场都没生效过**。
 *
 * 修法（用户 2026-10 拍板）是"按 tier 阶梯放量"：第一局固定寒潮，
 * 之后撑得越久、见过得越多，池子越大。所以这个文件要守的是**阶梯本身的形状**：
 *
 *  1. ★ **第一局必然只有寒潮** —— 它是唯一的 L1（教学关），也是用户选这条的理由；
 *  2. 每一档的池子**真的抽得到**（不是"理论上有"）；
 *  3. ★ 抽签**不扰动 `run.seed` 那条主序列** —— 否则三条永久回归探针全漂，
 *     而那种漂的**原因看不出来**（§4.4 的老账）；
 *  4. ★ "不生效的条件"必须是 `null` 而不是某个数 —— 这一格我连着写错两次
 *     （先 `0` 再 `-1`，两个都恒真），而发现它靠的是探针的第一行输出；
 *  5. ★★ **从"结算"到"下一局抽签"这一段要有人走**（用户 2026-10 报"没通过几次
 *     他也没解锁"之后补的）：上面四条验的都是"给定进度 → 池子多大"，
 *     而没有一条验"打完一局之后进度真的会动、新开的那一局真的读到它" ——
 *     那正是"接线"那一类缺口（§2.19）的形状。
 */
import { describe, expect, it } from 'vitest';
import { DISASTER_DEFS, disasterPool, disasterTopTier, lockedDisasterCount } from './disaster';
import { createCursor, pick } from '../model/rng';
import { createMetaProfile } from '../state/save';
import { createStartingRun, createStartingShelves, rollDisasterId } from '../systems/setup';
import { playFullRun } from '../systems/walkthroughRun';
import { ROOM_ID } from '../model/shelf';
import type { MetaProfile } from '../model/types';

/** 一份进度（`MetaProfile` 里抽签要读的那两个数） */
function progress(survivedRuns: number, seenDisasters: number) {
  return { survivedRuns, seenDisasters };
}

/** 跨局账本 → 抽签要读的那两个数（与 `disasterProgressOf` 同一个口径） */
function progressOf(meta: MetaProfile) {
  return progress(meta.survivedRuns, meta.codex.disasters.length);
}

describe('★ 第一局：必然且只有寒潮（用户 2026-10 选的那条）', () => {
  it('全新档的池子里恰好一场，而且是寒潮', () => {
    const pool = disasterPool(progress(0, 0));
    expect(pool).toHaveLength(1);
    expect(pool[0]?.id).toBe('cold_snap');
  });

  it('★ 全新档无论什么 seed 都抽到寒潮（用 200 个 seed 打一遍，而不是"看一行代码"）', () => {
    const ids = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) ids.add(rollDisasterId(progress(0, 0), seed));
    expect([...ids]).toEqual(['cold_snap']);
  });

  it('★ "不生效的条件"不能是一个数：否则 0 进度会直接开到 tier 3', () => {
    /*
     * 这一条守的是一类**具体犯过两次**的错：`DISASTER_TIER_GATES` 的 `seen`
     * 先写成 `0`、再写成 `-1`，两个都让"见过 0 场 >= 门槛"恒真 ——
     * 于是全新档的池子是 110 场，"第一局固定寒潮"当场失效。
     *
     * 断言写成"池子恰好一场"而不是"门槛是 null"：前者是**玩家看得见的事实**，
     * 后者是实现细节。将来换一种编码（比如条件对象）这条仍然成立。
     */
    expect(disasterPool(progress(0, 0))).toHaveLength(1);
    expect(disasterTopTier(progress(0, 0))).toBe(1);
  });
});

describe('阶梯：撑得越久 / 见过越多，池子越大', () => {
  it('每一档的池子大小（与 2026-10 探针实测一致）', () => {
    // 实测在 scripts/_probe-disaster-ladder.ts 里跑过；这里是**回归**，不是首次确认
    expect(disasterPool(progress(0, 0))).toHaveLength(1);
    expect(disasterPool(progress(1, 1))).toHaveLength(33);
    expect(disasterPool(progress(3, 3))).toHaveLength(110);
    expect(disasterPool(progress(5, 5))).toHaveLength(116);
  });

  it('池子只增不减（进度回退不会把见过的灾难收回去）', () => {
    let last = 0;
    for (let runs = 0; runs <= 6; runs++) {
      const size = disasterPool(progress(runs, runs)).length;
      expect(size, `撑过 ${runs} 次的池子比上一次小`).toBeGreaterThanOrEqual(last);
      last = size;
    }
  });

  it('★ 第二个条件（见过 N 场）能独立解锁 tier 4 —— 两个条件取更宽的那个', () => {
    // 一局都没撑过，但图鉴里见过 8 场 → 也够 tier 4
    expect(disasterTopTier(progress(0, 8))).toBe(4);
    expect(disasterPool(progress(0, 8))).toHaveLength(DISASTER_DEFS.length);
  });

  it('lockedDisasterCount 与池子互补（界面报"还有 N 场"时用）', () => {
    for (const [runs, seen] of [
      [0, 0],
      [1, 1],
      [3, 3],
      [5, 5]
    ] as const) {
      const p = progress(runs, seen);
      expect(disasterPool(p).length + lockedDisasterCount(p)).toBe(DISASTER_DEFS.length);
    }
  });

  it('★ 每一场灾难最终都够得到（池子覆盖率 = 100%，没有永远抽不到的场次）', () => {
    // 「写了但永远出不来」是 D-16 那一类错误。开满进度之后必须一场不剩
    const pool = disasterPool(progress(99, 99));
    const ids = new Set(pool.map((d) => d.id));
    const unreachable = DISASTER_DEFS.filter((d) => !ids.has(d.id)).map((d) => `${d.name}(${d.id})`);
    expect(unreachable, '这些灾难永远抽不到').toEqual([]);
  });
});

describe('★★ 打完一局之后：新开的那一局真的会换灾难吗', () => {
  /*
   * ## 这一组是用户 2026-10 报的那句话逼出来的
   *
   * > "我问一下你的设定是不是必须撑过一次寒潮才能解锁其他灾难呢，
   * >  因为我没通过几次他也没解锁"
   *
   * 我查下去发现两件事：
   *
   *  ① **规则确实是这样**（`survivedRuns >= 1` 才放 tier 2），而且它挡住了
   *     "打了几次没通关"的玩家 —— 他们会一直看到寒潮，于是合理地以为这是 bug；
   *  ② ★ **而它此前没有任何一条端到端的测试**：`disasterLadder.test.ts` 上面那些
   *     验的都是"给定进度 → 池子多大"，**没有一条**验"打完之后进度真的会动、
   *     新开的那一局真的读到它"。那正是"接线"那一类缺口（§2.19）的形状 ——
   *     每一段都对，而从"结算"到"下一局抽签"这一段没人走过。
   *
   * ⚠ 而它没被走过有一个具体原因：走测夹具 `playFullRun` **每一局都从一份全新的
   * 跨局账本开始**（`createSaveGame(null)`），于是它读不到调用方的进度。
   * 所以我先给夹具加了 `meta` 参数（见 `systems/walkthroughRun.ts` 的注释）——
   * 在此之前，"跨局的一切"在这套夹具上都是不可测的。
   */
  it('★★ 真打一局（真实命令 + 真实结算）→ 进度真的 +1，而新开的那一局真的换了灾难', () => {
    const meta = createMetaProfile();
    expect(disasterTopTier(progressOf(meta)), '全新档不该已经解锁别的').toBe(1);

    // 打一局寒潮（好档策略，实测能撑过去）
    const out = playFullRun(20261001, true, 'cold_snap', meta);
    expect(out.store.run.outcome).toBe('survived');
    const after = out.store.save.meta;

    // ① 结算真的把计数记上了（这是"解锁"的唯一输入）
    expect(after.survivedRuns, '撑过去了一局，survivedRuns 却没涨').toBe(1);
    expect(after.codex.disasters).toContain('cold_snap');

    // ② 而新开的那一局**真的**读到了它
    expect(disasterTopTier(progressOf(after))).toBe(2);
    expect(disasterPool(progressOf(after)).length).toBe(33);

    // ③ 拿真实抽签函数抽一把：抽到的东西必须真的在池子里
    const pool = new Set(disasterPool(progressOf(after)).map((d) => d.id));
    const drawn = [1, 2, 3, 4, 5].map((s) => rollDisasterId(progressOf(after), 20261000 + s));
    for (const id of drawn) expect(pool.has(id), `${id} 不在池子里`).toBe(true);

    /*
     * ④ ★ 而"换没换"这件事要用**抽签的分布**判，不能用某一个 seed 判：
     *    同 seed 同结果（那是存档回放的前提），所以单独一次抽签不能证明池子变大了。
     *    这里用 200 个 seed 打一遍 —— 全新档只会给出 1 种，撑过一局之后必然远多于 1。
     */
    const before = new Set(Array.from({ length: 200 }, (_, i) => rollDisasterId(progressOf(meta), i + 1)));
    const now = new Set(Array.from({ length: 200 }, (_, i) => rollDisasterId(progressOf(after), i + 1)));
    expect(before.size, '全新档只能抽到寒潮').toBe(1);
    expect(now.size, '撑过一局之后还是只能抽到一场 —— 那正是用户报的那个现象').toBeGreaterThan(20);
  });

  it('★ 没撑过去的那一局**不算**（"没通过几次"正是用户报的那个状态）', () => {
    /*
     * 用户的原话里最要紧的四个字是"**没通过**几次" —— 而规则要求的是
     * `outcome === 'survived'`（撑满 14 天）。倒下的那几局不算数，
     * 所以"打了很多次但都没通关"的玩家会一直只看到寒潮。
     *
     * 这一条把那个事实钉住：它是**设计**（`systems/codex.ts` 的"倒下的那一局不算"），
     * 不是 bug —— 而它必须被写下来，否则下一个人会把它当成 bug 去"修"。
     */
    const meta = createMetaProfile();
    // 乱档（不买不整理）实测约 D+10 倒下
    const out = playFullRun(20261001, false, 'cold_snap', meta);
    expect(out.store.run.outcome).toBe('collapsed');
    expect(out.store.save.meta.survivedRuns, '倒下的那一局不该给解锁计数').toBe(0);
    expect(disasterTopTier(progressOf(out.store.save.meta))).toBe(1);
  });
});

describe('★ 抽签与主随机流是两条线（三条永久回归探针的前提）', () => {
  it('★ 抽签不会改到传进去的那个 seed 值（它是值参数，抽的是自己那条流）', () => {
    const seed = 20261001;
    const before = seed;
    for (let i = 0; i < 20; i++) rollDisasterId(progress(3, 3), seed);
    expect(seed).toBe(before);
  });

  it('★★ `createStartingRun` 落盘的 seed 与传进去的一致 —— 抽签没吃掉主序列的一个数', () => {
    /*
     * 这是本组最要紧的一条。`createStartingRun(seed)` 里唯一消耗随机的是
     * "抽三个开局箱"，而 `run.seed = cursor.state` 是那之后的值。
     * 一旦抽签也用那条游标（哪怕只多消耗一次），这个数就会变 ——
     * 而它一变，后续每一次随机（地板卡 / 心情 / 突发事件）都换一条序列，
     * 三条永久回归探针的基线（好档活满 14 天 / 乱档 D+10 倒）整体漂移。
     *
     * 所以这里钉的不是"某个具体数值"，而是**抽签前后那个游标位置不变**这个性质：
     * 下面的期望值是从夹具实测抄下来的，改内容量会红 —— 那是刻意的报警，不是噪音。
     */
    const plain = createStartingRun(20261001);
    const drawn = createStartingRun(20261001, { disasterId: 'heat_wave' });
    expect(drawn.seed, '指定灾难与不指定，落盘的 seed 必须一样').toBe(plain.seed);
    expect(drawn.boxesToUnpack.map((b) => b.defId)).toEqual(plain.boxesToUnpack.map((b) => b.defId));
  });

  it('同一个 seed 抽到同一场（同 seed 同结果 —— 存档回放的前提）', () => {
    const p = progress(3, 3);
    expect(rollDisasterId(p, 4242)).toBe(rollDisasterId(p, 4242));
  });

  it('池子里的每一场都真的抽得到（400 个 seed 打一遍）', () => {
    const pool = disasterPool(progress(3, 3));
    const hits = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) hits.add(pick(createCursor(seed), pool).id);
    // 110 场对 400 个 seed：抽不满是正常的（生日悖论），但必须远多于 1
    expect(hits.size).toBeGreaterThan(80);
    // 而抽到的每一个都必须在池子里（抽签不会越界）
    const allowed = new Set(pool.map((d) => d.id));
    for (const id of hits) expect(allowed.has(id), `${id} 不在池子里`).toBe(true);
  });
});

describe('★ 空间维度（#14）真的生效了 —— W-01 的正面证据', () => {
  it('一场 capacityFactor < 1 的灾难：开局每块家具的**排数**真的矮了', () => {
    /*
     * 洪水（`flood_urban`）：`capacityFactor: 0.8`。
     * 在 M4 之前这一条**不可能通过** —— `createStartingRun` 把实参写死成寒潮，
     * 而寒潮没写这个字段。所以这条用例本身就是那一维"从没生效过"的反证。
     */
    const shelves = createStartingShelves(ROOM_ID, 'flood_urban');
    const full = createStartingShelves(ROOM_ID, 'cold_snap');
    expect(full).toHaveLength(3);
    expect(shelves).toHaveLength(full.length);
    for (let i = 0; i < shelves.length; i++) {
      expect(shelves[i]!.h, `第 ${i + 1} 块的排数没被砍矮`).toBeLessThan(full[i]!.h);
    }
  });

  it('一场 unusableShelfIds 非空的灾难：开局**真的少了一整块**', () => {
    // 内涝（waterlog_slow）：摘掉 shelf_a
    const shelves = createStartingShelves(ROOM_ID, 'waterlog_slow');
    expect(shelves.map((s) => s.id)).not.toContain('shelf_a');
    expect(shelves.length).toBeLessThan(createStartingShelves(ROOM_ID, 'cold_snap').length);
  });

  it('★ `createStartingRun` 的**货架**与 `disasterId` 是同一场（两处不许分家）', () => {
    /*
     * 这个 bug 的形状：日历按抽到的那场走，而房间按寒潮铺 ——
     * 玩家看到"洪水"，货架却是满高的。所以这条同时验两侧。
     */
    const run = createStartingRun(20261001, { disasterId: 'waterlog_slow' });
    expect(run.disasterId).toBe('waterlog_slow');
    expect(run.shelves.map((s) => s.id)).not.toContain('shelf_a');
  });

  it('认不出的灾难 id 退回寒潮（存档可手改，而 `getDisasterDef` 认不出会抛）', () => {
    const run = createStartingRun(1, { disasterId: 'alien_invasion' });
    expect(run.disasterId).toBe('cold_snap');
  });

  it('★ 覆盖率的账：43 场写了 capacityFactor、31 场写了 unusableShelfIds，现在都能生效', () => {
    /*
     * 这条是"那一整维以前一场都没生效"的**账面证据**（W-01 的验收口径之一）。
     * 它不去逐场跑开局（那要 116 次），只验"池子里真的有这么多场写着它" ——
     * 而"写了"能不能变成"生效"由上面两条用例负责。
     */
    let cap = 0;
    let unusable = 0;
    for (const d of DISASTER_DEFS) {
      if (typeof d.capacityFactor === 'number' && d.capacityFactor !== 1) cap++;
      if (Array.isArray(d.unusableShelfIds) && d.unusableShelfIds.length > 0) unusable++;
    }
    expect(cap).toBeGreaterThanOrEqual(40);
    expect(unusable).toBeGreaterThanOrEqual(30);
  });
});
