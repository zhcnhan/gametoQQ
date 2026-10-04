/**
 * 逐日物价曲线：**它必须按灾难算**（D-19 清偿）。
 *
 * ## 这个文件存在的理由是"旧 bug 抓不住"
 *
 * 原来 `dayPriceFactor(day)` 读 `data/dayEvents.ts` 里一张写死的 22 行表，
 * 只覆盖寒潮。116 场灾难落地之后，**另外 115 场全在按寒潮的曲线定价** ——
 * 而 `dayEvent.test.ts` 里那一组用例**一条都不会红**：
 * 它们全都在测寒潮（"灾前便宜、越来越贵、单调不减"），
 * 而那些属性对"所有人共用一条曲线"同样成立。
 *
 * 所以这里每一组都拿**两场不同的灾难**对拍。判据是**差异**，不是数值。
 */
import { describe, expect, it } from 'vitest';
import { DISASTER_DEFS, getDisasterDef } from './disaster';
import { dayPriceFactor } from './dayEvents';
import { severityAt } from '../model/calendar';

const COLD = 'cold_snap';

/** 生存期的每一天（买不了东西，但日报会读它） */
const SURVIVAL = Array.from({ length: 15 }, (_, d) => d);

describe('★★ 不同的灾难道出不同的物价曲线（这一条能抓住 D-19）', () => {
  it('★ 至少有两种明显不同的曲线（不是所有灾难一个样）', () => {
    /*
     * 这条断言的意思很直白：把 116 场的曲线两两比一遍，
     * 如果**全都一样**，那这条曲线就还是"一张全局表"，只是换了个写法。
     *
     * 我第一版按"严重度的**峰值**"算，结果 116 场的峰值**全是 1.0**，
     * 于是算出来一模一样 —— 而当时没有任何用例会发现。
     */
    const signature = (id: string) => SURVIVAL.map((d) => dayPriceFactor(d, id).toFixed(2)).join('/');
    const distinct = new Set(DISASTER_DEFS.map((d) => signature(d.id)));
    expect(distinct.size, '所有灾难道出了同一条物价曲线').toBeGreaterThan(5);
  });

  it('★ 分得出"持续型"与"衰减型"：热浪顶格到底，极地涡旋一路降价', () => {
    const heat = SURVIVAL.map((d) => dayPriceFactor(d, 'heat_wave'));
    expect(Math.min(...heat), '热浪一上来就该是顶格').toBeCloseTo(heat[0] as number, 2);
    expect(heat[14], '热浪到最后一刻也不便宜').toBeGreaterThan(2);

    // 找一场真的衰减的（"极地涡旋"那句 notes 里写着 0.9→0.5）
    const fading = DISASTER_DEFS.filter((d) => {
      const curve = SURVIVAL.map((day) => dayPriceFactor(day, d.id));
      return (curve[14] as number) < (curve[0] as number) - 0.1;
    });
    expect(fading.length, '一场衰减型都没有 —— 那说明价格只由峰值决定').toBeGreaterThan(0);
  });

  it('★ 同一场里"最贵的那天"随灾难不同（不是都在 D+7）', () => {
    const peakDay = (id: string) => {
      let best = 0;
      let bestV = -1;
      for (const d of SURVIVAL) {
        const v = dayPriceFactor(d, id);
        if (v > bestV) {
          bestV = v;
          best = d;
        }
      }
      return best;
    };
    const days = new Set(DISASTER_DEFS.map((d) => peakDay(d.id)));
    expect(days.size, '所有灾难的最贵时刻都是同一天').toBeGreaterThan(1);
  });
});

describe('★ 寒潮：它是唯一被玩过、调过的那条曲线，必须一个字都不变', () => {
  /*
   * 这份数据是**原样搬过来的历史**（M2 的"早买还是晚买"这个博弈就是它撑起来的）。
   * 我试过用严重度把它拟合出来 —— 最大偏差 0.29，因为**寒潮的严重度曲线本身是抖的**，
   * 而那条物价曲线是肉眼调平的。
   *
   * 所以这一组用例把它 22 天逐日钉住。**改它就是改一个已经被玩过的数值**，
   * 而那种改动最容易被当成"顺手优化掉"。
   */
  const ORIGINAL = new Map<number, number>([
    [-7, 0.95], [-6, 0.95], [-5, 0.98], [-4, 0.98], [-3, 1.0], [-2, 1.05], [-1, 1.12],
    [0, 1.25], [1, 1.4], [2, 1.5], [3, 1.6], [4, 1.7], [5, 1.8], [6, 1.9], [7, 2.0],
    [8, 2.0], [9, 2.05], [10, 2.05], [11, 2.1], [12, 2.1], [13, 2.15], [14, 2.2]
  ]);

  it('寒潮 22 天逐日与原表一致（搬运一条历史数据该有的做法）', () => {
    const bad: string[] = [];
    for (const [day, want] of ORIGINAL) {
      const got = dayPriceFactor(day, COLD);
      if (Math.abs(got - want) > 1e-9) bad.push(`D${day}：原 ${want} vs 现 ${got}`);
    }
    expect(bad).toEqual([]);
  });

  it('寒潮带的是**显式曲线**，而不是走"按严重度算"那条默认路', () => {
    // 这条防的是"顺手把寒潮的 priceCurve 删掉，反正公式也算得出来"——
    // 公式算得出来，但**算出来的不是这条曲线**
    expect(getDisasterDef(COLD).priceCurve).toBeDefined();
    expect(Object.keys(getDisasterDef(COLD).priceCurve ?? {}).length).toBe(22);
  });
});

describe('显式曲线的边界处理', () => {
  it('★ 自己带曲线的灾难：日历外的日子夹到最近一档（物价不会自己往回走）', () => {
    expect(dayPriceFactor(-99, COLD)).toBe(0.95);
    expect(dayPriceFactor(999, COLD)).toBe(2.2);
    expect(Number.isFinite(dayPriceFactor(100000, COLD))).toBe(true);
  });

  it('小数天取整（结算按整天走，不该出现"第 3.4 天的价格"）', () => {
    expect(dayPriceFactor(3.4, COLD)).toBe(dayPriceFactor(3, COLD));
    expect(dayPriceFactor(3.6, COLD)).toBe(dayPriceFactor(4, COLD));
  });

  it('★ 认不出的灾难 id 不抛异常（它跑在商店渲染与日报的路径上）', () => {
    expect(() => dayPriceFactor(3, '这场灾难不存在')).not.toThrow();
    expect(dayPriceFactor(3, '这场灾难不存在')).toBeGreaterThan(0);
  });

  it('★ 价格永远是个正数、而且是有限的（界面上不能出现 0 元或 NaN）', () => {
    for (const def of DISASTER_DEFS) {
      for (const day of [-30, -7, 0, 7, 14, 400]) {
        const v = dayPriceFactor(day, def.id);
        expect(Number.isFinite(v), `${def.name} D${day}`).toBe(true);
        expect(v, `${def.name} D${day}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('与严重度的关系：价格跟着这一场的强度走', () => {
  it('★ 强度回升的那几天，价格也跟着回升（同一场内部自洽）', () => {
    /*
     * 抽查几场：把"严重度上升"的日子找出来，价格必须同步上升。
     * 不要求逐日单调（灾难的日历允许抖动），只要求**趋势一致**：
     * 一个从 D+3 到 D+9 明显变强的灾难，不该在那几天越卖越便宜。
     */
    for (const def of DISASTER_DEFS.slice(0, 40)) {
      if (def.priceCurve) continue; // 显式曲线不参与这条（它不受严重度约束）
      const a = severityAt(def, 3);
      const b = severityAt(def, 9);
      if (b - a < 0.05) continue; // 强度没怎么变，无从判断
      const pa = dayPriceFactor(3, def.id);
      const pb = dayPriceFactor(9, def.id);
      expect(pb, `${def.name}：D+9 比 D+3 强，却更便宜`).toBeGreaterThanOrEqual(pa);
    }
  });
});
