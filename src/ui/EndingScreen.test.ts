/**
 * 结算页「整理得怎么样」那一块的守护测试（铁则 §10.1A 欠账②，2026-10）。
 *
 * ## 为什么要给它写测试
 *
 * 这一块原来只有三个孤零零的百分比。补上参照物之后它多出两条**会静默坏掉**的路：
 *
 *  1. **刻度线**：档位门槛要是渲染那边自己写一遍（而不是读 `GRADE_STEPS`），
 *     屏幕上的标签与刻度就会各说各话 —— 界面照常渲染，只是**在骗人**；
 *  2. **与上一局的对比**：`meta.lastRunScore` 在 `settleRunMeta` 里会被**当场覆盖**，
 *     所以"上一局是什么"必须在覆盖之前抓下来。抓错顺序的后果不是报错，
 *     而是每一行都显示 `比上一局 ±0` —— 看起来完全正常，其实什么都没比。
 *     这条只有一条断言能守住：**上一局的数字必须真的出现在屏幕上**。
 *
 * 还有一条最容易漏的：**第一局不许编造对比**。没有参照物的时候画一个 `±0`
 * 比什么都不画更坏（玩家会以为"我上一局也是 62%"）。
 *
 * ## ★ 假 DOM 的三条边界（都在 `fakeDom.ts` 里）
 *
 *  1. `dispatch` 不冒泡 → 事件要派发到 root；
 *  2. `textContent` 只填在叶子文本节点上 → 断言一律读具体的叶子
 *     （`.score-row-value` / `.score-next` / `.score-delta`），读容器得到 `''`；
 *  3. **不支持后代组合子** → 用 `querySelectorAll('.score-delta')` 再按顺序取，
 *     不要写 `.score-row .score-delta`。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GRADE_STEPS, gradeWith } from '../model/score';
import { createSaveGame, createMetaProfile } from '../state/save';
import { GameStore } from '../state/store';
import type { LastRunScore, SaveGame } from '../model/types';
import { createStartingRun } from '../systems/setup';
import { EndingScreen } from './EndingScreen';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 一个已经走完的局：活过 7 天，屋子里留了点东西让比率不是 0 */
function finishedRun(seed = 20261003) {
  const run = createStartingRun(seed);
  run.day = 7;
  run.phase = 'ending';
  run.outcome = 'survived';
  run.identityId = 'group_buyer';
  return run;
}

interface Ctx {
  root: FakeElement;
  store: GameStore;
  save: SaveGame;
}

/**
 * 挂一张结算页。
 *
 * @param previous 上一局的成绩快照；不传 = 第一局（`lastRunScore` 为 null）
 */
function setup(previous?: LastRunScore): Ctx {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  doc.body.appendChild(root);

  const run = finishedRun();
  const save = createSaveGame(run);
  save.meta = { ...createMetaProfile(), lastRunScore: previous ?? null };
  const store = new GameStore(save, stubScheduler());
  const screen = new EndingScreen(asElement(root), store, {
    onRestart: () => undefined,
    onOpenCodex: () => undefined
  });
  screen.mount();
  return { root, store, save };
}

/** 取一批叶子的文字（容器是空串，见文件头第 2 条） */
const texts = (root: FakeElement, selector: string): string[] =>
  root.querySelectorAll(selector).map((el) => el.textContent ?? '');

const LAST: LastRunScore = {
  placement: 30,
  fefo: 90,
  emergency: 61,
  disasterId: 'cold_snap',
  day: 4,
  outcome: 'collapsed'
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('结算页的三个比率：数值、刻度、与上一局的对比', () => {
  it('三行都在，而且每行都报出一个百分比', () => {
    const { root } = setup();
    const values = texts(root, '.score-row-value');
    expect(values).toHaveLength(3);
    for (const v of values) expect(v).toMatch(/\d+%/);
  });

  it('★ 每行都有「离下一档还差多少」—— 这就是那个「形状」', () => {
    const { root } = setup();
    const next = texts(root, '.score-next');
    expect(next).toHaveLength(3);
    /*
     * 每一行要么说"还差 N% 到「某档」"，要么说"到顶了"。
     * 不许出现空串 —— 空串就是"这一行没有形状"，也就是这次要修的那个毛病。
     */
    for (const n of next) {
      expect(n.length).toBeGreaterThan(0);
      expect(n === '到顶了' || /还差 \d+% 到「.+」/.test(n)).toBe(true);
    }
  });

  it('★ 刻度线的位置来自 `GRADE_STEPS`，不是渲染那边自己写的数', () => {
    const { root } = setup();
    const ticks = root.querySelectorAll('.score-tick');
    const want = GRADE_STEPS.filter((s) => s.at > 0).length;
    // 三行 × 每行的刻度数
    expect(ticks).toHaveLength(want * 3);
    const at = ticks.slice(0, want).map((el) => el.getAttribute('style') ?? '');
    for (const step of GRADE_STEPS.filter((s) => s.at > 0)) {
      expect(at.some((s) => s.includes(`--at:${step.at / 100}`))).toBe(true);
    }
  });

  it('★ 没有上一局时**一格对比都不编**，并且明说为什么', () => {
    const { root } = setup();
    expect(root.querySelectorAll('.score-delta')).toHaveLength(0);
    expect(texts(root, '.score-baseline').join('')).toContain('第一局');
  });

  it('★★ 有上一局时，**上一局的数字真的出现在屏幕上**（顺序没写反）', () => {
    const { root } = setup(LAST);
    const deltas = texts(root, '.score-delta');
    expect(deltas).toHaveLength(3);

    /*
     * ★ 这一条是整个用例的重点：它验的不是"有没有画箭头"，
     * 而是"箭头比的是不是**上一局**"。
     *
     * 只看"有没有 .score-delta"是不够的 —— 顺序写反时它照样有，
     * 只不过每一行都是 `±0`。所以这里必须**从上一局的数字反推期望值**：
     * 本局的归位率与上局的 30 差多少，屏幕上就得写多少。
     */
    const now = texts(root, '.score-row-value').map((v) => Number.parseInt(v, 10));
    const [p, f, e] = [now[0] as number, now[1] as number, now[2] as number];
    const expected = [p - LAST.placement, f - LAST.fefo, e - LAST.emergency].map((d) =>
      `比上一局 ${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}`
    );
    expect(deltas).toEqual(expected);

    // 而且至少有一行**不是** ±0，否则上面那组期望值等于没验
    expect(expected.some((t) => !t.includes('±0'))).toBe(true);
  });

  it('★ 箭头说清"拿什么在比"：上一局是哪一场灾难、什么结局', () => {
    const { root } = setup(LAST);
    const note = texts(root, '.score-baseline').join('');
    expect(note).toContain('寒潮');
    // 倒下的一局要报天数，而不是含糊地说"上一局"
    expect(note).toContain('第 4 天');
  });

  it('★ 上一局活到最后 → 说的是"活到了最后"，不是"走到第 7 天"', () => {
    const { root } = setup({ ...LAST, outcome: 'survived', day: 14 });
    expect(texts(root, '.score-baseline').join('')).toContain('活到了最后');
  });

  it('涨与跌的记号能分开（`is-up` / `is-down` / `is-flat` 只出现它该出现的那个）', () => {
    const { root } = setup(LAST);
    const ups = root.querySelectorAll('.score-delta.is-up');
    const downs = root.querySelectorAll('.score-delta.is-down');
    const flats = root.querySelectorAll('.score-delta.is-flat');
    expect(ups.length + downs.length + flats.length).toBe(3);

    // 归位率必然比上一局的 30 高（屋子里留了东西），所以至少有一个 is-up
    const values = texts(root, '.score-row-value').map((v) => Number.parseInt(v, 10));
    if ((values[0] as number) > LAST.placement) expect(ups.length).toBeGreaterThan(0);
    if ((values[0] as number) === LAST.placement) expect(flats.length).toBeGreaterThan(0);
  });

  it('★ 结算把这一局的成绩记进了 meta，而且**只记一次**（反复刷新不会把参照物刷没）', () => {
    const { store, root } = setup(LAST);
    const recorded = store.save.meta.lastRunScore;
    expect(recorded).not.toBeNull();
    expect(recorded?.disasterId).toBe(store.run.disasterId);
    expect(recorded?.day).toBe(7);
    expect(recorded?.outcome).toBe('survived');

    /*
     * 再渲染一次（= 玩家刷新结算页）。
     *
     * ★ 这里要守的是 `meta`：第二遍**不许**把参照物覆盖成"这一局自己"。
     * 覆盖了的话玩家一刷新就会看到三行 `比上一局 ±0` ——
     * 一个看起来完全正常的屏幕，其实什么都没比。
     *
     * ⚠ 而第二遍的**对比行本身会消失**，这是一个已知的、刻意接受的行为：
     * `settleRunMeta` 有幂等闸（`run.metaSettled`），第二遍返回 null，
     * 于是"上一局是什么"这个**结算那一刻才有**的信息就没了。
     * 所以下面两条断言要分开写：meta 必须一动不动，界面上那三行则可以没有。
     */
    const screen = new EndingScreen(asElement(root), store, {
      onRestart: () => undefined,
      onOpenCodex: () => undefined
    });
    screen.mount();
    expect(store.save.meta.lastRunScore).toEqual(recorded);
    // 而"这一局"的数不许被自己顶掉（第一遍记的就是这一局）
    expect(store.save.meta.lastRunScore?.day).toBe(7);
  });
});

describe('gradeWith：刻度的口径与标签同源', () => {
  it('每一档的边界都落在 GRADE_STEPS 上，且从不报"还差 0%"', () => {
    for (let p = 0; p <= 100; p++) {
      const g = gradeWith(p / 100);
      const floor = GRADE_STEPS.find((s) => s.label === g.label);
      expect(floor?.at).toBe(g.floor);
      // 到顶时必须是 null，而不是"还差 0%"
      if (p >= 100) {
        expect(g.next).toBeNull();
        expect(g.toNext).toBeNull();
      } else {
        expect(g.toNext).toBeGreaterThan(0);
      }
    }
  });

  it('档位名字与门槛对得上（改表就得改标签，反过来也一样）', () => {
    expect(gradeWith(0).label).toBe('无从下手');
    expect(gradeWith(0.01).label).toBe('翻箱倒柜');
    expect(gradeWith(0.5).label).toBe('凑合能用');
    // ⚠ 79.9% 会先被 `toPercent` 四舍五入成 80 —— 档位判在**整数百分比**上
    expect(gradeWith(0.794).label).toBe('凑合能用');
    expect(gradeWith(0.8).label).toBe('有条不紊');
    expect(gradeWith(1).label).toBe('整整齐齐');
  });
});
