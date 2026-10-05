/**
 * 全流程走测（M2 验收的"最后跑一局"那条，只是跑在**真实命令**上而不是浏览器里）。
 *
 * ## 它比单测多测了什么
 *
 * 单测各自守一块规则；这一条守**它们接起来还成不成立**：
 * 真实状态机（prologue → 囤货 → 夜间 → D-Day → 生存 → 结算）、真实的采购/整理命令、
 * 真实的种子游标、真实的存档序列化来回。M1 的教训是"每一块都对，接起来卡死"
 * （刷新卡在夜里、卡在门口），所以这一条必须有。
 *
 * ## 三档各跑一整局，而且都从**存档字符串**里恢复一次
 *
 * 每次换页/换天都过一遍 `serialize` → `deserialize`，等于模拟"玩家每次操作后都刷新页面"。
 * §4A 承诺的是"任何时刻杀进程，损失 = 0"，而这条走测就是那句话的回归测试。
 *
 * ## ★ 夹具搬去了 `walkthroughRun.ts`（M4 W-01）
 *
 * 理由有两条，都是实际撞到的：
 *
 *  1. **116 场灾难现在真的会被抽到了**，于是"跑一整局"不再只跑寒潮 ——
 *     另外 115 场从来没有被玩过一遍。补那个缺口要把同一套策略放到别的灾难上跑，
 *     而 `scripts/_probe-*.ts` **import 不了这个文件**：它带了 `vitest`，
 *     `vite-node` 会当场抛 `Vitest failed to access its internal state`；
 *  2. ★ 更重要的：**那件事得留在仓库里**。以后每加一场灾难，
 *     "它能不能玩"都该被跑一遍（"数据写了 ≠ 这一局能玩"，D-32 的教训）——
 *     而那不该是一次性探针的活。
 */
import { describe, expect, it } from 'vitest';
import { getDisasterDef, SURVIVAL_DAYS } from '../data/disaster';
import { dailyDrainOf } from '../data/survival';
import { NIGHT_SLEEP } from '../data/nightEvents';
import type { RunState } from '../model/types';
import { GameStore } from '../state/store';
import { SAVE_VERSION, createSaveGame, deserialize, serialize } from '../state/save';
import { settleRunMeta } from './codex';
import { declineRequest, fulfillRequest } from './help';
import { chooseIdentity, chooseNightOption, goHome, sleep } from './phases';
import { createStartingRun } from './setup';
import { createSaveSchedulerStub, expectedShelves, playFullRun, trialDisaster } from './walkthroughRun';

describe('全流程走测：真实命令 × 存档往返 × 三档', () => {
  it('★ 好档：真实命令走完 16 天（囤货 7 + 生存 14），图鉴与纪录都落账', () => {
    const { store, verdict, nightEvents, dayEvents, emergencies } = playFullRun(20261001, true);

    // 结局与日历
    expect(store.run.phase).toBe('ending');
    expect(store.run.outcome).toBe('survived');
    expect(store.run.day).toBe(SURVIVAL_DAYS);

    // 跨局结算真的发了奖，而且记账了
    expect(verdict).not.toBeNull();
    expect(store.save.meta.codex.disasters).toContain('cold_snap');
    expect(store.save.meta.bestSurvivalDays['cold_snap']).toBe(SURVIVAL_DAYS);
    expect(store.run.metaSettled?.outcome).toBe('survived');
    expect(store.save.meta.version).toBe(SAVE_VERSION);

    // 沿途真的发生了些事 —— 否则这条走测什么也没覆盖到
    expect(nightEvents.length).toBeGreaterThan(0);
    expect(dayEvents.length).toBeGreaterThan(0);
    expect(emergencies.length).toBeGreaterThan(0);

    // ★ 存档版本与"每次操作都能读回来"：这一路每一段都过了 serialize → deserialize
    expect(deserialize(serialize(store.save))).not.toBeNull();
  });

  it('★ 乱档：不买也不整理 → 走不完全程，但存档一路都能读回来', () => {
    const { store, finalText } = playFullRun(20261001, false);
    expect(store.run.phase).toBe('ending');
    // 一局里什么都不做（不进店买、不整理）必然倒下 —— 这正是 §12.3 v0.7 那条修订要的
    expect(store.run.outcome).toBe('collapsed');
    expect(store.run.day).toBeLessThan(SURVIVAL_DAYS);
    // 无论结局是什么，最后那份存档必须能读回来（§4A）
    expect(deserialize(finalText)).not.toBeNull();
  });

  it('★ 结算幂等：同一条走测里反复进结算页，图鉴不会被刷第二遍', () => {
    const { store } = playFullRun(4242, true);
    const before = JSON.stringify(store.save.meta.codex);
    expect(settleRunMeta(store)).toBeNull();
    expect(JSON.stringify(store.save.meta.codex)).toBe(before);
  });

  it('★ 存档往返不丢 M2 新字段（白天事件 / 限购 / 买入记账 / 安全感）', () => {
    const run: RunState = createStartingRun(7);
    run.phase = 'stockpile_shop';
    run.currentShopId = 'supermarket';
    run.identityId = 'group_buyer';
    run.dayEvent = { defId: 'd_queue_aunt', shopId: 'supermarket', choice: 0, applied: null };
    run.shopPriceFactor = 1.5;
    run.shopLimits = [{ shopId: 'supermarket', category: 'food', max: 2 }];
    run.shopBoughtToday = { 'supermarket|canned_beans': 2 };
    run.survival.safeStreak = 5;

    const back = deserialize(serialize(createSaveGame(run)));
    expect(back?.run?.dayEvent?.defId).toBe('d_queue_aunt');
    expect(back?.run?.dayEvent?.choice).toBe(0);
    expect(back?.run?.shopPriceFactor).toBe(1.5);
    expect(back?.run?.shopLimits).toHaveLength(1);
    expect(back?.run?.shopBoughtToday).toEqual({ 'supermarket|canned_beans': 2 });
    expect(back?.run?.survival.safeStreak).toBe(5);
  });

  it('★ 状态机没有死胡同：夜里必须能关灯走出去（§4A 无死按钮）', () => {
    const night = new GameStore(createSaveGame(createStartingRun(11)), createSaveSchedulerStub());
    chooseIdentity(night, 'group_buyer');
    goHome(night);
    night.commit((draft) => {
      draft.phase = 'night';
      draft.night = { eventId: 'n_night_shift', choice: null, applied: null };
    });
    // 还没决定时不能直接睡 —— 这是唯一一处刻意要求"先做个决定"
    expect(sleep(night).ok).toBe(false);
    // "直接睡"永远是一条路，而且它之后必然能跨天
    expect(chooseNightOption(night, NIGHT_SLEEP).ok).toBe(true);
    expect(sleep(night).ok).toBe(true);
    expect(night.run.phase).not.toBe('night');
    // 跨天之后落在白天的两个界面之一（每个都要有出口）
    expect(['stockpile_shop', 'organize']).toContain(night.run.phase);
  });

  it('★ 门口那一单没有死胡同：交付 / 婉拒 / 兜底出口三条都能走回日报', () => {
    const door = new GameStore(createSaveGame(createStartingRun(13)), createSaveSchedulerStub());
    chooseIdentity(door, 'group_buyer');
    door.commit((draft) => {
      draft.phase = 'help_request';
      draft.helpRequest = { defId: 'q_wang_medicine' };
      draft.day = 3;
      // 开局那三箱货里有绷带 —— 不清空的话这一单是交得出去的
      draft.boxesToUnpack = [];
      draft.shelves = draft.shelves.map((s) => ({
        ...s,
        slots: s.slots.map((row) => row.map(() => ({ stack: null })))
      }));
    });
    // 一件药都没有 → 交付必然失败（"凑不齐 ≠ 婉拒"），但它必须给一条**出路**。
    // 注意 `ok: true` 是**刻意的**：交付这条命令返回的是"我处理了这一单、日历可以往下走了"，
    // 而不是"你成功给到了"—— 否则调用方会把"凑不齐"再当成"没处理"，
    // 于是它接着去婉拒，玩家就会背上一次他从来没做过的"不讲情面"。
    const handled = fulfillRequest(door);
    expect(handled.ok).toBe(true);
    expect(handled.events.some((e) => e.type === 'helpFailed')).toBe(true);
    expect(door.run.phase).toBe('survival_day');
    expect(door.run.helpRequest).toBeNull();
    // 关键：凑不齐**不扣人情**（那是"你没能耐"，不是"你不愿意"，见 systems/help.ts）
    expect(door.run.trust['npc_wang'] ?? 0).toBe(0);
    // 而且日历真的能往下走（没有"卡在门口"这种死胡同）
    expect(door.run.phase).toBe('survival_day');
  });

  it('★ 门口：婉拒也是一条出口，而且它扣的是人情（与碰巧凑不齐分开）', () => {
    const door = new GameStore(createSaveGame(createStartingRun(17)), createSaveSchedulerStub());
    chooseIdentity(door, 'group_buyer');
    door.commit((draft) => {
      draft.phase = 'help_request';
      draft.helpRequest = { defId: 'q_wang_medicine' };
      draft.day = 3;
    });
    expect(declineRequest(door).ok).toBe(true);
    expect(door.run.phase).toBe('survival_day');
    expect(door.run.helpRequest).toBeNull();
    expect(door.run.trust['npc_wang'] ?? 0).toBeLessThan(0);
  });
});

/**
 * ★★ 跨灾难的走测（M4 W-01 的验收，2026-10）
 *
 * ## 这一组在守什么
 *
 * W-01 之前实机每一局都是寒潮 —— 也就是说**另外 115 场从来没有被玩过一遍**。
 * 而"数据写了"与"这一局能玩"是两件事：整个 W-01 的起因就是
 * 43 场写了空间维度、生效 0 场（D-32）。
 * 所以灾难一旦能被抽到，"它能不能走到结算"就必须有人跑。
 *
 * ## 判据的形状：**只判"坏了没有"，不判"难不难"**
 *
 * 每一场都跑一遍完整走测（真实命令 × 存档往返 × 同一条已验证的采购策略），
 * 然后只问三件事：走到 `ending` 了吗、四维越界了吗、`disasterId` 中途被换了吗。
 *
 * ⚠ **"有没有活满 14 天"刻意不当判据**：灾难分 L1~L4，难度本来就该有差，
 * 而"哪一场该多难"是设计问题，不是这条测试能回答的。活满多少场只作观察值。
 *
 * ⚠ **样本不是全量**：全量 116 场 × 一整局要跑几十秒，而这里是"每次 `npm test` 都跑"
 * 的位置。样本按 **每个家族 + 每个 level + 几类最容易出问题的形状**（空间代价最狠的、
 * 关店的、高日耗的、腐坏两端的、断电的）挑，全量的那一遍走
 * `scripts/_probe-walk-all-disasters.ts`（同样是这套夹具）。
 */
describe('★★ 跨灾难走测：每一场都走得到结算，而且不静默换灾难', () => {
  /** 每个家族 / 每个 level / 每类极端形状各挑代表 */
  const SAMPLE = [
    'flood_urban', // 水 · capacityFactor 0.8（空间维度最常见的那一档）
    'tsunami', // 水 · capacityFactor 0.55 **且**摘掉 shelf_a（最狠的空间代价）
    'heat_wave', // 温度 · 日耗 水 5 + 腐坏 2.4（需求侧最重的一类）
    'blackout_winter', // 组合 · 断电（冰箱停摆 → 腐坏反向）
    'mold_rain', // 生物 · 腐坏 3.0（全案最快）
    'riot_curfew', // 社会 · 关店（供给侧最紧）
    'sandstorm_air', // 空气
    'quake_cold', // 组合 · capacity 0.65
    'hub_paralysis', // 结构 · 断货运
    'ice_age' // L4 · 连续低温 + capacity 0.8
  ];

  it('★ 十场代表（覆盖 7 个家族 / L2~L4）：每一场都走到结算，四维不越界', () => {
    const results = SAMPLE.map((id) => trialDisaster(id));
    const broken = results.filter((r) => r.problems.length > 0);
    expect(
      broken.map((r) => `${r.name}(${r.id})：${r.problems.join('；')}`),
      '这些灾难走不完一整局'
    ).toEqual([]);
    // 而"走完了"这件事本身也要有独立的证据（`problems` 为空时 `finished` 必须为真）
    expect(results.every((r) => r.finished), '有问题却报没问题 —— 判据自己坏了').toBe(true);
  });

  it('★★ 每一场开局的**盘面形状**都对（块数 / 排数 / 格数）', () => {
    /*
     * ★ 这一条是补上来的，因为上面那条**抓不到 W-01 那一类 bug**：
     * 我故意把 `createStartingShelves` 的 `capacityFactor` 写死成 0.55 之后，
     * 十场样本**全部照旧通过** —— 每一场都还能走完，只是寒潮局的货架被砍错了。
     *
     * 所以"走得通"之外还要问"**它铺出来的盘面对不对**"，而那个期望值
     * 由 `expectedShelves` **独立算**（读数据，不读实现）—— 两处都读同一个函数
     * 只是在自证，抓不到接线错。
     */
    for (const id of SAMPLE) {
      const want = expectedShelves(id);
      const run = createStartingRun(20261001, { disasterId: id });
      const got = {
        blocks: run.shelves.length,
        rows: run.shelves[0]?.h ?? 0,
        slots: run.shelves.reduce((n, s) => n + s.w * s.h, 0)
      };
      expect(got, `${getDisasterDef(id).name} 开局的盘面形状不对`).toEqual(want);
    }
  });

  it('★ 空间维度在这些真实局里确实生效（最狠那一场只剩 1 块货架）', () => {
    /*
     * 这一条是 W-01 的**正面证据**，而且是从"走完一整局"这条路上取的 ——
     * 不是调一次 `createStartingShelves` 就算数（那样验的是函数，不是接线）。
     */
    const tsunami = getDisasterDef('tsunami');
    expect(tsunami.capacityFactor).toBe(0.55);
    expect(tsunami.unusableShelfIds?.length ?? 0).toBeGreaterThan(0);
    const run = createStartingRun(20261001, { disasterId: 'tsunami' });
    // 三块摘掉一块 → 两块；而每块再按 0.55 砍排（4 → 2）
    expect(run.shelves.length).toBe(2);
    expect(run.shelves.every((s) => s.h === 2)).toBe(true);
    // 对照：寒潮局是满的
    expect(createStartingRun(20261001).shelves.length).toBe(3);
  });

  it('★ 灾难的日耗跟着这一场走（热浪要 5 份水，寒潮要 2 份燃料）', () => {
    /*
     * "抽到哪一场"这件事一旦接上，**需求侧**也会跟着变 ——
     * 而界面上的"你囤到的"、结算里的消耗、缺货判定全部读它。
     */
    const heat = dailyDrainOf(getDisasterDef('heat_wave'));
    const cold = dailyDrainOf(getDisasterDef('cold_snap'));
    expect(heat.find((d) => d.category === 'water')?.need).toBe(5);
    expect(cold.find((d) => d.category === 'fuel')?.need).toBe(2);
    expect(heat).not.toEqual(cold);
  });
});
