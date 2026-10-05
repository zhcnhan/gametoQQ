/**
 * 反差层（§6.6「数字自己说话」）。
 *
 * 这一层的全部内容就是**四个数字**，所以测试也只盯数字。
 * 它的错误不会崩、不会报错，只会让玩家读到一句假话 —— 那才是这里最该挡住的东西。
 */
import { describe, expect, it } from 'vitest';
import { outdoorTemp } from '../data/disaster';
import { CATEGORY_ORDER } from '../data/items';
import { makeStack, setSlotStack } from './shelf';
import { districtDays, handyDays, indoorTemp, supplyDays } from './contrast';
import type { RunState } from './types';
import { createStartingRun } from '../systems/setup';
import { getDisasterDef, SURVIVAL_DAYS } from '../data/disaster';

function emptyRun(): RunState {
  const run = createStartingRun(20261001);
  run.boxesToUnpack = [];
  run.shelves = run.shelves.map((s) => ({
    ...s,
    slots: s.slots.map((row) => row.map(() => ({ stack: null })))
  }));
  return run;
}

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
  throw new Error('货架满了');
}

describe('反差层：四个数字的口径', () => {
  it('屋内温度由庇护所决定：满值 18°C，归零时和外面差不多', () => {
    expect(indoorTemp(100)).toBe(18);
    expect(indoorTemp(0)).toBe(-2);
    expect(indoorTemp(50)).toBe(8);
    // 越界不崩，也不给出荒谬的数
    expect(indoorTemp(999)).toBe(18);
    expect(indoorTemp(-50)).toBe(-2);
  });

  it('★ 余粮天数取**最先见底**的那一项，不是总和', () => {
    const run = emptyRun();
    give(run, 'canned_beans', 10); // 主食：每天 2 件 → 5 天
    give(run, 'mineral_water', 4); // 饮水：每天 2 件 → 2 天
    give(run, 'fuel_can', 8); // 燃料：每天 2 件 → 4 天

    // 米面还够五天，但水只够两天 —— 玩家的余粮就是两天
    expect(supplyDays(run, getDisasterDef(run.disasterId))).toBe(2);
  });

  it('余粮算的是全屋（含还没拆的纸箱）—— 箱子里有粮却报 0 天是在骗人', () => {
    const run = emptyRun();
    run.boxesToUnpack = [
      {
        id: 'box_x',
        defId: 'box_staple',
        items: [makeStack('canned_beans', 6, null), makeStack('mineral_water', 6, null), makeStack('fuel_can', 6, null)]
      }
    ];
    expect(supplyDays(run, getDisasterDef(run.disasterId))).toBe(3);
  });

  it('街区平均随时间递减，而且不会跑到负数', () => {
    expect(districtDays(0)).toBe(0);
    expect(districtDays(1)).toBe(3);
    expect(districtDays(4)).toBe(1);
    expect(districtDays(7)).toBe(0);
    expect(districtDays(99)).toBe(0); // 越界夹到末尾，不给负值
  });

  it('★ 这条曲线必须覆盖**整个生存期**（原来只有 9 天，后 5 天全是同一个数）', () => {
    /*
     * 原来那张表是 9 个数，而 `SURVIVAL_DAYS` 是 14 ——
     * 于是第 10~14 天全都返回最后一档（0），也就是"整条街一点粮都没有了"。
     * 那五天里这个数字**不再有任何信息量**：它既不变化、也不解释任何事，
     * 只是每天印一个 0 在玩家旁边。
     *
     * ★ 而当时的测试**一条都不会红** —— 它们查的是
     * `districtDays(0/1/4/7/99)`，全都是表内的点。
     * 所以这条用例改成遍历**整个生存期**。
     *
     * ⚠ 但下标 0 是**哨兵**（灾难前，day ≤ 0 读它），**不是曲线上的点**。
     * 我第一版从下标 0 开始查单调，于是报出"第 1 天比第 0 天还多"——
     * **是断言错了，不是数据错了**。曲线本身从下标 1 起。
     */
    for (let day = 0; day <= SURVIVAL_DAYS; day++) {
      const v = districtDays(day);
      expect(Number.isFinite(v), `D+${day}`).toBe(true);
      expect(v, `D+${day} 不该是负数`).toBeGreaterThanOrEqual(0);
    }
    // 递减：整条街只会越来越空（从下标 1，也就是 D+1 起）
    let prev = Number.POSITIVE_INFINITY;
    for (let day = 1; day <= SURVIVAL_DAYS; day++) {
      const v = districtDays(day);
      expect(v, `D+${day} 比前一天还多`).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('★ 「你还有粮、整条街已经空了」这个反差必须真的出现过', () => {
    // 这是这一层最狠的一句话（§6.6）。它要求街区在**生存期后段**就已经归零，
    // 而不是等到最后一天才归零 —— 否则玩家没有机会看到那个对比
    expect(districtDays(7)).toBe(0);
    expect(districtDays(14)).toBe(0);
  });

  it('外界温度：灾难那天断崖式下跌，并且两头都夹得住', () => {
    expect(outdoorTemp(-7)).toBe(6);
    expect(outdoorTemp(-1)).toBe(-5);
    expect(outdoorTemp(0)).toBe(-18); // D-Day 的断崖
    expect(outdoorTemp(7)).toBe(-30);
    expect(outdoorTemp(14)).toBe(-36); // §12.3 v0.7：生存期 14 天，寒潮尾声最冷
    // 越界（手改过的档）不崩
    expect(outdoorTemp(-99)).toBe(6);
    expect(outdoorTemp(99)).toBe(-36);
  });

  it('日历里写的温度和 `outdoorTemp` 对得上 —— 玩家会把两句话对照着读', () => {
    const disaster = getDisasterDef('cold_snap');
    for (const forecast of disaster.calendar) {
      const match = /(-?\d+)°C/.exec(forecast.hint);
      if (!match) continue;
      expect(outdoorTemp(forecast.day)).toBe(Number(match[1]));
    }
  });
});

/**
 * ★★ 「随手够得到几天」（M4 工单 W-08）
 *
 * ## 它守的是"整理在日报上可见"这件事
 *
 * `supplyDays` 的分母是"货架 ∪ **纸箱**"，所以**把 30 罐从纸箱搬到贴好胶带的架上，
 * 那块屏幕上一个数都不变** —— 「搬上架」「贴胶带」「标顺手位」三个动作
 * 在日报上完全不可见。这一格就是为它们长的。
 *
 * ## 所以这里的用例形状与上面那组不同
 *
 * 上面那组验"某个数是多少"，这一组验**"搬运会不会让它变"** ——
 * 那才是这一格的用途。一个数如果对搬运恒等不变，它加进来就没有意义。
 */
describe('★★ 随手够得到几天：整理的第一个日报读数', () => {
  /**
   * 往指定货架的指定格放东西（`shelfIndex` 是 `run.shelves` 的下标）。
   *
   * ⚠ **每写一格都要重新从 `run.shelves` 取那块架子**：`setSlotStack` 是纯函数，
   * 拿着旧引用连写两格会让第二格覆盖第一格（同一个位置写两遍）——
   * 我第一版就是这么写的，于是"货铺好了"其实只有一样东西在架上。
   */
  function putOn(run: RunState, shelfIndex: number, itemId: string, count: number, at: number): void {
    const shelf = run.shelves[shelfIndex];
    if (!shelf) throw new Error(`没有第 ${shelfIndex + 1} 块货架`);
    const row = Math.floor(at / shelf.w);
    const col = at % shelf.w;
    run.shelves[shelfIndex] = setSlotStack(shelf, { row, col }, makeStack(itemId, count, null));
  }

  /** 三样刚需各放一格（`at` 是格号，三样必须错开 —— 写同一格会互相覆盖） */
  function putNeeds(run: RunState, shelfIndex: number, count: number, at: number): void {
    putOn(run, shelfIndex, 'canned_beans', count, at);
    putOn(run, shelfIndex, 'mineral_water', count, at + 1);
    putOn(run, shelfIndex, 'fuel_can', count, at + 2);
  }

  /** 全屋备足 `days` 天的三样刚需，全放在**第一块**货架上（行优先铺） */
  function stockedRun(days: number): RunState {
    const run = emptyRun();
    for (const [i, itemId] of ['canned_beans', 'mineral_water', 'fuel_can'].entries()) {
      let left = days * 2;
      let at = i * 8;
      while (left > 0) {
        const take = Math.min(left, 6);
        putOn(run, 0, itemId, take, at);
        left -= take;
        at += 1;
      }
    }
    return run;
  }

  it('★ 东西全堆在纸箱里 → 随手够得到 0 天，而"余粮"照样是 15 天', () => {
    /*
     * 这一条就是 W-08 要解决的那件事的**最小复现**：
     * 同一批货，两个数一个 15 一个 0 —— 而此前后者根本不存在。
     */
    const run = emptyRun();
    run.boxesToUnpack = [
      {
        id: 'box_x',
        defId: 'box_staple',
        items: [
          makeStack('canned_beans', 30, null),
          makeStack('mineral_water', 30, null),
          makeStack('fuel_can', 30, null)
        ]
      }
    ];
    const disaster = getDisasterDef(run.disasterId);
    expect(supplyDays(run, disaster)).toBe(15);
    expect(handyDays(run, disaster), '纸箱里的货不该算"随手够得到"').toBe(0);
  });

  it('★★ 同一批货搬上架并标顺手位 → 余粮那格不变，而"够得到"从 0 天变成 14 天', () => {
    /*
     * ⚠ 两个数的**上限不同**，这一点容易看错：
     * `supplyDays` 是"总量 ÷ 日耗"（15 天就是 15 天），
     * 而 `handyDays` 封顶在 `SURVIVAL_DAYS`（14）—— 生存期只有 14 天，
     * 报"够 15 天"没有读者（见 `handyDays` 的注释）。
     */
    const run = stockedRun(15);
    const disaster = getDisasterDef(run.disasterId);
    const bare = { ...run, shelves: run.shelves.map((s) => ({ ...s, handyRank: null })) };
    // 标顺手位之前：一件都不在顺手位上 → 只剩"半份"那条底，而这批货是按整份备的
    expect(handyDays(bare, disaster)).toBeLessThan(SURVIVAL_DAYS);
    // 标上之后（全屋唯一那一块）
    run.shelves[0] = { ...run.shelves[0]!, handyRank: 1 };
    expect(supplyDays(run, disaster)).toBe(supplyDays(bare, disaster));
    expect(handyDays(run, disaster)).toBe(SURVIVAL_DAYS);
  });

  it('★★ 三个动作各自换来一截：堆箱子 → 上架 → 贴清单（标顺手位只是锦上添花）', () => {
    /*
     * 这是这一格存在的全部理由，所以它一条用例把四档全走一遍。
     *
     * 判据是 `isInPlaceFor`：**顺手位那块架子** ∪ **贴了明确收它的清单的那一行**。
     * 两者是同一类东西（都让取用不必翻），只是强度不同。
     */
    const disaster = getDisasterDef('cold_snap');
    const inBoxes = emptyRun();
    inBoxes.boxesToUnpack = [
      {
        id: 'box_x',
        defId: 'box_staple',
        items: [
          makeStack('canned_beans', 30, null),
          makeStack('mineral_water', 30, null),
          makeStack('fuel_can', 30, null)
        ]
      }
    ];

    // ① 全堆在纸箱里：一件都够不到（翻不动就没得吃）
    expect(handyDays(inBoxes, disaster)).toBe(0);

    // ② 搬上架、**什么都没写**：只剩"半份"那条底 → 凑不齐一天
    const bareShelf = stockedRun(15);
    expect(handyDays(bareShelf, disaster)).toBe(0);

    // ③ 贴一张收满七个品类的清单 → 那一行不用翻 → 满份
    const taped = stockedRun(15);
    taped.zones = [{ id: 'z_all', name: '全收', color: '#000000', autoAccept: { categories: [...CATEGORY_ORDER] } }];
    taped.shelves = taped.shelves.map((s) => ({ ...s, zoneIds: s.zoneIds.map(() => 'z_all') }));
    expect(handyDays(taped, disaster)).toBe(SURVIVAL_DAYS);

    // ④ 再标顺手位：不改变天数（那一块本来就已经够得到了），但换的是"最先兑现"
    const marked = { ...taped, shelves: taped.shelves.map((s, i) => (i === 0 ? { ...s, handyRank: 1 } : s)) };
    expect(handyDays(marked, disaster)).toBe(handyDays(taped, disaster));
  });

  it('★ 一张**空胶带**不算数（与归位率同一个 loophole）', () => {
    /*
     * `zoneListedFor` 的注释里记着 §12 v0.8 修掉的那个漏洞：
     * "贴一张空胶带 = 什么都收 = 归位率恒满"。这一格如果走 `zoneAccepts`，
     * 同样的后门会在这里开第二次 —— 而它更糟：一个空胶带会让
     * "随手够得到"直接报满，而玩家什么秩序都没建立。
     */
    const run = stockedRun(15);
    run.zones = [{ id: 'z_empty', name: '没写', color: '#000000', autoAccept: { categories: [] } }];
    run.shelves = run.shelves.map((s) => ({ ...s, zoneIds: s.zoneIds.map(() => 'z_empty') }));
    expect(handyDays(run, getDisasterDef('cold_snap'))).toBe(0);
  });

  it('★ 顺手位只认那一块 —— 别处堆得再多，这一格也不跟着涨', () => {
    /*
     * 这条守的是"逐日扣"那件事（`handyDays` 第一版拿开局快照算，当场报了 14 天）：
     * 顺手位上的货**每天会被吃掉一点**，而快照会让后面几天继续按"不用翻"算 ——
     * 于是别处的货被偷偷算进了"随手够得到"。
     *
     * 夹具用 5 天：顺手位那块有 10 件燃料，逐日扣到第 6 天就只剩"半份"，正好停在 5 天。
     */
    const run = stockedRun(5);
    const disaster = getDisasterDef(run.disasterId);
    run.shelves[0] = { ...run.shelves[0]!, handyRank: 1 };
    expect(handyDays(run, disaster)).toBe(5);
    // 再往**别的**货架上铺一整批：余粮涨了 7 天，而"随手够得到"一点不涨
    putNeeds(run, 1, 14, 0);
    expect(supplyDays(run, disaster)).toBeGreaterThan(5);
    expect(handyDays(run, disaster)).toBe(5);
  });

  it('屋里什么都没有 → 两个数都是 0（不崩、不给负数）', () => {
    const run = emptyRun();
    const disaster = getDisasterDef(run.disasterId);
    expect(supplyDays(run, disaster)).toBe(0);
    expect(handyDays(run, disaster)).toBe(0);
  });

  it('上限是 `SURVIVAL_DAYS`（囤得再多也只说"够 14 天"）', () => {
    const run = emptyRun();
    // 三块货架全铺满（开局就三块 —— 多要一块会抛，而那是夹具的错，不是产品的）
    for (let i = 0; i < run.shelves.length; i++) {
      for (let n = 0; n < 8; n++) {
        putOn(run, i, 'canned_beans', 6, n * 3);
        putOn(run, i, 'mineral_water', 6, n * 3 + 1);
        putOn(run, i, 'fuel_can', 6, n * 3 + 2);
      }
    }
    run.shelves = run.shelves.map((s, i) => (i === 0 ? { ...s, handyRank: 1 } : s));
    expect(handyDays(run, getDisasterDef(run.disasterId))).toBe(SURVIVAL_DAYS);
  });
});
