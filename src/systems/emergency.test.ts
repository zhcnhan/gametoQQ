/**
 * 突发事件（§5 的另一半，M2 清偿 D-06 残留）。
 *
 * 这一组守两件事：
 *
 *  ① **种子化可复现**：同 seed 同事件序列。突发事件是每日结算里唯一一处
 *     会掷骰子的地方（其余都是确定的账），所以它是"同档同序"最容易破的一环；
 *  ② **顺手位是判定唯一依据**：《应急货架（门口/最顺手位）放急救品 → 突发事件不掉健康》——
 *     这一句在代码里只允许有一种读法（`countOnHandy`），而且它数的是**顺手位**，
 *     不是"全屋有没有"。
 */
import { describe, expect, it } from 'vitest';
import { EMERGENCY_CHANCE, EMERGENCY_DEFS, findEmergency } from '../data/emergencies';
import { CATEGORY_LABELS, ITEM_DEFS, getItemDef } from '../data/items';
import { createCursor } from '../model/rng';
import { countOnHandy, makeStack, setSlotStack } from '../model/shelf';
import type { RunState } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createStartingRun } from './setup';
import { rollEmergency, settleEmergency, settleSurvivalDay } from './survival';

function createSaveSchedulerStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

function bareRun(seed = 20261001): RunState {
  const run = createStartingRun(seed);
  run.boxesToUnpack = [];
  run.shelves = run.shelves.map((shelf) => ({
    ...shelf,
    slots: shelf.slots.map((row) => row.map(() => ({ stack: null })))
  }));
  return run;
}

/** 往某块货架上放一件（测试里允许直接写状态） */
function put(run: RunState, shelfId: string, itemId: string, count: number, col = 0): void {
  const index = run.shelves.findIndex((s) => s.id === shelfId);
  const shelf = run.shelves[index];
  if (!shelf) throw new Error(`没有货架 ${shelfId}`);
  run.shelves[index] = setSlotStack(shelf, { row: 0, col }, makeStack(itemId, count, null));
}

describe('突发事件的抽签：种子化、低频、可复现', () => {
  it('同 seed 同序列 —— 掷 40 天的结果逐日相同', () => {
    const seq = (seed: number): (string | null)[] => {
      const cursor = createCursor(seed);
      return Array.from({ length: 40 }, () => rollEmergency(cursor)?.id ?? null);
    };
    expect(seq(20261001)).toEqual(seq(20261001));
    // 不同 seed 应当走出不同的序列（否则种子化是假的）
    expect(seq(20261001)).not.toEqual(seq(777));
  });

  it('★ 低频：约三成日子有事 —— 它要像意外，不能像日程', () => {
    /*
     * ★ 这里从"权重"改成"概率"，是 M3 的一次真修正（不只是测试写法变了）。
     *
     * 原来这条断言算的是 `事件数 / (事件数 + EMERGENCY_NONE_WEIGHT)` ——
     * 那个式子**把事件数写进了期望值**，所以它永远自洽：表里加多少条事件，
     * 它都会说"符合预期"。M3 把突发事件从 7 条加到 28 条，有事概率
     * 从 30% 涨到 63%，**而这条测试当时是绿的**（它算出的期望也一起涨到了 63%）。
     *
     * 真正抓住它的是下面那句硬上限 `< 0.45`。所以现在把期望也钉在
     * **设计意图**（`EMERGENCY_CHANCE = 30%`）上，加了内容就不会跟着漂。
     */
    const cursor = createCursor(12345);
    let hits = 0;
    const draws = 2000;
    for (let i = 0; i < draws; i++) if (rollEmergency(cursor)) hits += 1;
    const rate = hits / draws;
    expect(rate).toBeGreaterThan(EMERGENCY_CHANCE - 0.05);
    expect(rate).toBeLessThan(EMERGENCY_CHANCE + 0.05);
    // 而且它必须明显低于夜间事件的 60% —— 否则"突发事件"就不再是突发
    expect(rate).toBeLessThan(0.45);
  });

  it('抽出来的每一条都在表里，且都真的能被化解（没有"必扣血"的事件）', () => {
    const cursor = createCursor(999);
    for (let i = 0; i < 300; i++) {
      const def = rollEmergency(cursor);
      if (!def) continue;
      expect(findEmergency(def.id)).not.toBeNull();
      // 每一条都要有明确的化解条件，否则它不是检查题，是随机扣血
      expect(def.needOnHandy).toBeGreaterThan(0);
      expect(CATEGORY_LABELS[def.category]).toBeTruthy();
    }
  });
});

describe('突发事件的判定：顺手位上有就化解，没有就按缺货口径受创', () => {
  const cutHand = findEmergency('e_cut_hand'); // 要 1 件医疗

  it('顺手位上有那件东西 → 化解，lost = 0', () => {
    const run = bareRun();
    put(run, 'shelf_a', 'bandage', 3);
    run.shelves = run.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, handyRank: 1 } : s));

    const outcome = settleEmergency(run, cutHand as NonNullable<typeof cutHand>);
    expect(outcome.resolved).toBe(true);
    expect(outcome.lost).toBe(0);
    expect(outcome.handyHave).toBe(3);
  });

  it('★ 药在屋里、但不在顺手位 → 仍然受创（分母算全屋，但判定只认顺手位）', () => {
    const run = bareRun();
    put(run, 'shelf_b', 'bandage', 3); // 有药，但 shelf_b 不是顺手位

    const outcome = settleEmergency(run, cutHand as NonNullable<typeof cutHand>);
    expect(outcome.resolved).toBe(false);
    expect(outcome.lost).toBe(1);
    expect(outcome.handyHave).toBe(0);
  });

  it('药在纸箱里 → 不算（箱底那卷确实没在门口）', () => {
    const run = bareRun();
    run.boxesToUnpack = [{ id: 'b1', defId: 'box_medical', items: [makeStack('bandage', 5, null)] }];
    const outcome = settleEmergency(run, cutHand as NonNullable<typeof cutHand>);
    expect(outcome.resolved).toBe(false);
  });

  it('★★ 表里的**每一个品类**都有一条能化解它的路（M3 补内容后新增的守卫）', () => {
    /*
     * ## 为什么必须逐品类过一遍
     *
     * M3 把突发事件从 7 条（只要医疗与燃料）扩到 28 条（**七个品类各 3 条**），
     * 而这件事把一个此前看不出来的空洞暴露了出来：
     *
     * 探针里那条"标了顺手位 → 突发事件化解得掉"的用例当时是**假绿** ——
     * 它靠的不是"顺手位这条机制"，而是"突发事件恰好只要医疗与燃料"这个
     * **内容侧的事实**（而探针的货恰好在那两类上铺得够）。品类一扩，
     * 那条断言立刻用一句"体力没差"指向了错误的方向。
     *
     * 所以这里不再靠"那批货恰好覆盖得到"，而是**对每一个出现的品类**
     * 都构造一次"顺手位上有它 / 没有它"的判定。表里将来加第 8 个品类时，
     * 这条会自动覆盖到它 —— 只要那个品类真的有物资能放在顺手位上。
     *
     * 判据同时也是内容纪律的机器版：**一条事件要的品类，
     * 必须是玩家真的能囤到的东西**（否则它不是检查题，是随机扣血）。
     */
    const categories = [...new Set(EMERGENCY_DEFS.map((d) => d.category))];
    // 七个品类都要有事件（内容量口径：§10B.6 说突发事件按"压力轴"分批，
    // 而品类覆盖是它最省事的验收办法）
    expect(categories.length).toBeGreaterThanOrEqual(7);

    const uncovered: string[] = [];
    for (const category of categories) {
      // 找一个该品类的物资，用它当"放在顺手位上的急救品"
      const item = ITEM_DEFS.find((d) => d.category === category);
      if (!item) {
        uncovered.push(`品类 ${category} 没有任何物资能囤 —— 要它的突发事件永远化解不掉`);
        continue;
      }
      const defs = EMERGENCY_DEFS.filter((d) => d.category === category);
      // 该品类里要得最多的那一条：能化解它，就说明这个品类真的够用
      const hardest = defs.reduce((a, b) => (b.needOnHandy > a.needOnHandy ? b : a));

      // ① 顺手位上有足够的件数 → 化解
      const withHandy = bareRun();
      put(withHandy, 'shelf_a', item.id, hardest.needOnHandy);
      withHandy.shelves = withHandy.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, handyRank: 1 } : s));
      const ok = settleEmergency(withHandy, hardest);
      if (!ok.resolved) uncovered.push(`品类 ${category}（${hardest.id} 要 ${hardest.needOnHandy} 件）放够了却没化解`);

      // ② 同样的货放在**不是顺手位**的架子上 → 受创
      const withoutHandy = bareRun();
      put(withoutHandy, 'shelf_b', item.id, hardest.needOnHandy);
      const bad = settleEmergency(withoutHandy, hardest);
      if (bad.resolved) uncovered.push(`品类 ${category}（${hardest.id}）没放顺手位却化解了`);
    }
    expect(uncovered).toEqual([]);
  });

  it('差一件也不算化解（needOnHandy 是下限，不是"有就行"）', () => {
    const fever = findEmergency('e_fever'); // 要 2 件医疗
    const run = bareRun();
    put(run, 'shelf_a', 'bandage', 1);
    run.shelves = run.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, handyRank: 1 } : s));

    expect(settleEmergency(run, fever as NonNullable<typeof fever>).resolved).toBe(false);
  });

  it('要真烧掉的那几种会真的扣（炉子熄了 → 顺手位上少一罐燃料）', () => {
    const stove = findEmergency('e_stove_out') as NonNullable<ReturnType<typeof findEmergency>>; // consumes: true
    const run = bareRun();
    put(run, 'shelf_a', 'fuel_can', 2);
    run.shelves = run.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, handyRank: 1 } : s));

    const first = settleEmergency(run, stove);
    // handyHave 报的是**判定时**顺手位上几件（界面要用它解释"靠什么化解的"），
    // 所以第一次读到的仍然是 2 —— 但货已经被烧掉一罐了
    expect(first.resolved).toBe(true);
    expect(first.handyHave).toBe(2);
    const left = countOnHandy(run.shelves, 'fuel');
    expect(left).toBe(1);
    // 还剩 1 罐，第二次仍然够（needOnHandy = 1）
    expect(settleEmergency(run, stove).resolved).toBe(true);
    expect(countOnHandy(run.shelves, 'fuel')).toBe(0);
    // 第三次就没得烧了 → 受创。这条才是"炉子熄了"真正的疼法
    const third = settleEmergency(run, stove);
    expect(third.resolved).toBe(false);
    expect(third.lost).toBe(stove.lost);
  });

  it('★ 化解**不**消耗库存（除非 consumes）—— 它奖励的是"放在顺手位"，不是"有存货"', () => {
    const run = bareRun();
    put(run, 'shelf_a', 'bandage', 2);
    run.shelves = run.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, handyRank: 1 } : s));
    const before = run.shelves[0]?.slots[0]?.[0]?.stack;

    settleEmergency(run, cutHand as NonNullable<typeof cutHand>);
    const after = run.shelves[0]?.slots[0]?.[0]?.stack;
    expect(after).toEqual(before);
  });
});

describe('突发事件接进每日结算：它真的会改四维', () => {
  it('★ 没化解时按缺货口径扣健康（与 §6.4 的缺货共用同一组常量）', () => {
    const run = bareRun();
    // 断粮的一天：缺货已经把健康压下去，突发事件再叠一层
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 100, shelter: 100 };
    const report = settleSurvivalDay(run, createCursor(11));
    if (report.emergencyId && !report.emergencyResolved) {
      expect(report.emergencyLost).toBeGreaterThan(0);
    }
    // 无论抽到什么都必须是合法状态（不会因为事件表改了名字而抛）
    expect(report.emergencyId === null || findEmergency(report.emergencyId) !== null).toBe(true);
  });

  it('不传游标 = 今天不掷（单测与结算页预览的默认口径）', () => {
    const run = bareRun();
    run.day = 3;
    const report = settleSurvivalDay(run);
    expect(report.emergencyId).toBeNull();
    expect(run.survival.last.emergencyId).toBeNull();
  });

  it('★ 同 seed 同一天 → 同一个突发事件（存档一致性的底线）', () => {
    const once = (): { id: string | null; resolved: boolean } => {
      const run = bareRun(4242);
      run.day = 3;
      const report = settleSurvivalDay(run, createCursor(run.seed));
      return { id: report.emergencyId, resolved: report.emergencyResolved };
    };
    expect(once()).toEqual(once());
  });

  it('突发事件写进日报，而且说清是靠什么化解的（或缺了什么）', () => {
    const run = bareRun();
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 100, shelter: 100 };
    const store = new GameStore(createSaveGame(run), createSaveSchedulerStub());
    const report = settleSurvivalDay(store.run, createCursor(7));
    if (report.emergencyId) {
      const def = findEmergency(report.emergencyId);
      expect(def).not.toBeNull();
      const name = CATEGORY_LABELS[(def as NonNullable<typeof def>).category];
      const line = store.run.log.find((l) => l.includes((def as NonNullable<typeof def>).text.slice(0, 6)));
      expect(line).toBeDefined();
      expect(line).toContain(name);
    }
  });
});

describe('安全感连击（§12 拍板 v0.9）', () => {
  it('该拿到的都拿到了 → 连击 +1；缺货 → 归零', () => {
    const run = bareRun();
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 100, shelter: 100 };
    // 什么吃的都没有 = 断粮，一定不达标
    settleSurvivalDay(run);
    expect(run.survival.safeStreak).toBe(0);

    const fed = bareRun();
    fed.day = 3;
    fed.stats = { health: 100, mood: 100, stamina: 100, shelter: 100 };
    for (const [itemId, col] of [
      ['canned_beans', 0],
      ['mineral_water', 1],
      ['fuel_can', 2]
    ] as const) {
      put(fed, 'shelf_a', itemId, getItemDef(itemId).stackLimit, col);
    }
    settleSurvivalDay(fed);
    // 有吃有烧、没缺货、也不在硬撑 → 达标
    expect(fed.survival.safeStreak).toBeGreaterThan(0);
  });

  it('连击是连续的：断一天就归零，再达标重新从 1 开始', () => {
    const run = bareRun();
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 100, shelter: 100 };
    for (const [itemId, col] of [
      ['canned_beans', 0],
      ['mineral_water', 1],
      ['fuel_can', 2]
    ] as const) {
      put(run, 'shelf_a', itemId, 4, col);
    }
    settleSurvivalDay(run);
    const first = run.survival.safeStreak;
    expect(first).toBe(1);

    // 把货抽干 → 第二天断粮 → 归零
    run.shelves = run.shelves.map((s) => ({ ...s, slots: s.slots.map((row) => row.map(() => ({ stack: null }))) }));
    run.day = 4;
    settleSurvivalDay(run);
    expect(run.survival.safeStreak).toBe(0);
  });
});
