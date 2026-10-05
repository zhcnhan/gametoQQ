/**
 * 生存期日报里「市场」那一行的守护测试（D-17 的第二版）。
 *
 * ## 它守的是用户报的那个横幅
 *
 * 第一版长这样：**「有钱也难买到 2.2 倍」**，而且**每天都出现**。
 * 用户的反馈：
 *
 * > "有个奇怪的横幅，有钱也难买到 xx 倍是啥意思，说明白，
 * >  文案不要这么让人看不懂还无说明"
 *
 * 两条都是真问题，而第二条更严重。这个文件把两条都钉住：
 *
 *  1. ★ **没有消息时一个字都不显示。** 生存期买不了东西（商店只在囤货期开），
 *     所以"现在 2.2 倍"是玩家改不了的事实 —— 每天印一遍就是废话。
 *     判据：`shopPriceFactor === 1` 且没有限购 → 这一行**整个不存在**；
 *  2. ★ **有消息时必须说清"相对什么"。** 第一版只给一个倍数，没有参照物；
 *     现在必须写明"比这一场的平常价"以及"下一天出门时会按这个价结账"。
 *
 * ## 假 DOM 的边界（§3.2）
 *
 * `textContent` 只填在叶子文本节点上，所以断言读 `.market-line` 这个叶子。
 * 它不存在 = 那一行没渲染 —— 这正是第 1 条要的判据。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { makeStack } from '../model/shelf';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createStartingRun } from '../systems/setup';
import { SurvivalScreen } from './SurvivalScreen';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';
import type { SurvivalSnapshot } from '../model/types';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 一份"正在生存期、有日报"的局面 */
function survivalStore(over: { priceFactor?: number; limits?: { category: string; max: number }[] } = {}) {
  const run = createStartingRun(20261007);
  run.identityId = 'group_buyer';
  run.cash = 500;
  run.phase = 'survival_day';
  run.day = 3;
  run.shopPriceFactor = over.priceFactor ?? 1;
  run.shopLimits = (over.limits ?? []) as never;
  // 日报快照：界面读 `run.survival.last`
  run.survival.last = {
    day: 3,
    health: 0,
    mood: 0,
    stamina: 0,
    shelter: 0,
    shortage: 0,
    unreachable: 0,
    spoiled: 0,
    hardPress: false,
    hardPressLevel: 'none',
    usedMedicine: 0,
    usedWarmth: 0,
    emergencyId: null,
    emergencyResolved: false,
    emergencyHurt: 0
  } as unknown as SurvivalSnapshot;
  return new GameStore(createSaveGame(run), stubScheduler());
}

interface Ctx {
  root: FakeElement;
  screen: SurvivalScreen;
}

function mount(over: Parameters<typeof survivalStore>[0] = {}): Ctx {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = survivalStore(over);
  const screen = new SurvivalScreen(asElement(root), store, {
    onStart: () => undefined,
    onNext: () => undefined,
    onTrade: () => false
  });
  screen.mount();
  return { root, screen };
}

/** 找 `.market-line` 这一行；不存在返回 null */
function marketLine(root: FakeElement): FakeElement | null {
  const all = root.querySelectorAll('.market-line');
  return all[0] ?? null;
}

afterEach(() => {
  // 每个用例自己装一份假的 window，卸掉免得互相污染
  delete (globalThis as { window?: unknown }).window;
});

describe('★★ 没有消息时：这一行**一个字都不显示**', () => {
  it('★★ 物价没被人抬过、也没有限购 → 没有这一行', () => {
    /*
     * 这是用户报的那个 bug 的核心：生存期买不了东西，
     * 所以"现在 2.2 倍"每天印一遍就是废话。
     */
    const { root } = mount({ priceFactor: 1, limits: [] });
    expect(marketLine(root), '不该有一个每天都在的物价横幅').toBeNull();
  });

  it('★ 这条判据与"这一场的逐日价格"无关（那不是消息，是背景）', () => {
    /*
     * `dayPriceFactor`（这一场的逐日曲线）人人如此、天天如此 ——
     * 它由灾难决定，玩家改不了，所以它**不该单独成一条横幅**。
     * 这里通过"只改 `shopPriceFactor`"来间接确认：那个数不动时就不显示。
     */
    const { root } = mount({ priceFactor: 1 });
    expect(marketLine(root)).toBeNull();
  });
});

describe('★★ 有消息时：说清"相对什么"', () => {
  it('★★ 物价被事件抬过 → 显示，而且写明参照物与后果', () => {
    const { root } = mount({ priceFactor: 1.3 });
    const line = marketLine(root);
    expect(line, '有涨价消息时该显示这一行').not.toBeNull();
    const text = line!.textContent;
    // ① 说清相对什么（"这一场的平常价"），而不是一个没有参照物的倍数
    expect(text).toContain('平常价');
    // ② 说清后果（下一天出门会按这个价结账）——玩家需要知道它影响什么
    expect(text).toContain('结账');
    // ③ 百分比是**这一趟比平常贵多少**，而不是一个裸倍数
    expect(text).toContain('30%');
  });

  it('★ 只有限购、没有涨价 → 也要显示（限购是下一个囤货日的处境）', () => {
    const { root } = mount({ priceFactor: 1, limits: [{ category: 'medicine', max: 2 }] });
    const line = marketLine(root);
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain('限购');
    // 品类名要翻成中文（不能把 category id 直接印给玩家）
    expect(line!.textContent).toContain('医疗');
    expect(line!.textContent).not.toContain('medicine');
  });

  it('★ 降价也说（`shopPriceFactor < 1` 时不能只报涨价）', () => {
    const { root } = mount({ priceFactor: 0.85 });
    const line = marketLine(root);
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain('便宜');
  });

  it('★ 涨价与限购同时有 → 两件事都说', () => {
    const { root } = mount({ priceFactor: 1.2, limits: [{ category: 'food', max: 3 }] });
    const text = marketLine(root)?.textContent ?? '';
    expect(text).toContain('贵');
    expect(text).toContain('限购');
  });
});

/**
 * ★★ 反差层的两块：「室内 / 室外」与「你 / 整条街」（M4 W-08 + 用户 2026-10 的文案重写）
 *
 * ## 第一件事：标题必须对得上底下的数（用户点名的那句）
 *
 * 用户的原话："外面里面为啥不能叫室内室外呢，类似的尴尬文案你给我全部改了！！！"
 *
 * 原来那一块是"外面 / 里面"当标题、底下第一行写"外面 / 屋里"、第二行却是
 * "你的余粮 / 街区平均"（跟室内室外毫无关系）。所以现在的判据是：
 * **每块的标题就是它底下那两个数在比什么** ——
 * 温度归「室内 / 室外」，天数归「你 / 整条街」，而且两块各自独立渲染。
 *
 * ## 第二件事：「不用翻就拿到」那一行只在它**不等于**存货时才出现
 *
 * 差是 0 的时候（整批货还躺在纸箱里、或恰好全在明面上）并排放两个相同的数
 * 会让人以为这一格坏了。所以判据是"那一行存在 / 不存在"，不是"数字是多少"。
 *
 * ## 第三件事：D-Day 那一屏也要有温度
 *
 * 用户报的"外面里面那个我没看到"，一半原因就在这里：反差层原来整个挂在
 * `dayHtml()` 里，而 D-Day 走的是 `ddayHtml()` —— 灾难落地那一屏反而没有温度。
 */
describe('★★ 反差层：标题对得上数、差值对得上盘面、D-Day 也要有温度', () => {
  /** 铺一份"全在纸箱里"的局面（存货有、够得到 0） */
  function inBoxes(): GameStore {
    const store = survivalStore();
    store.commit((draft) => {
      draft.shelves = draft.shelves.map((s) => ({
        ...s,
        slots: s.slots.map((row) => row.map(() => ({ stack: null })))
      }));
      draft.boxesToUnpack = [
        {
          id: 'box_x',
          defId: 'box_staple',
          items: [makeStack('canned_beans', 30, null), makeStack('mineral_water', 30, null), makeStack('fuel_can', 30, null)]
        }
      ];
    });
    return store;
  }

  function mountStore(store: GameStore): FakeElement {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const root = doc.createElement('div');
    new SurvivalScreen(asElement(root), store, {
      onStart: () => undefined,
      onNext: () => undefined,
      onTrade: () => false
    }).mount();
    return root;
  }

  it('★★ 标题就是它在比什么：出现「室内 / 室外」与「你 / 整条街」，且**不再有**「外面 / 里面」', () => {
    const root = mountStore(inBoxes());
    const titles = root.querySelectorAll('.block-title').map((el) => el.textContent);
    expect(titles).toContain('室内 / 室外');
    expect(titles).toContain('你 / 整条街');
    // ★ 用户点名要去掉的那两个词
    expect(titles.join('｜'), '「外面 / 里面」那个标题回来了').not.toContain('外面 / 里面');
    const all = allText(root);
    expect(all, '温度那一格还写着"外面" —— 与标题的"室外"又成了两个词').not.toContain('外面');
    expect(all).toContain('室外');
    expect(all).toContain('室内');
  });

  it('★ 货全在纸箱里 → 出现「不用翻就拿到 0 天」，而"你的存货"仍在', () => {
    /*
     * ⚠ 走 `allText`（`fakeDom` 的叶文本收集），不是读某个容器的 `textContent`：
     * `.contrast-cell` 里是 `<i>标签</i><b>数字</b>` 这种混排，而假体不实现文本节点
     * —— 容器的 `textContent` 是**空串**，于是"这一格没渲染"会把一个正确的界面报成坏的。
     */
    const root = mountStore(inBoxes());
    const all = allText(root);
    expect(all, '反差层没有"不用翻就拿到"那一格').toContain('不用翻就拿到');
    expect(all, '"你的存货"那一格不见了').toContain('你的存货');
    expect(all, '差值那一格没有一起出现').toContain('要翻才拿得到');
    // 而它单独占一对（用来给样式挂钩，也用来给这条断言定位）
    expect(root.querySelectorAll('.contrast-pair.is-reach').length).toBe(1);
  });

  it('★ 屋里空着（存货也是 0）→ 差值那一对**不渲染**（两个相同的数只会让人以为坏了）', () => {
    const store = survivalStore();
    store.commit((draft) => {
      draft.shelves = draft.shelves.map((s) => ({
        ...s,
        slots: s.slots.map((row) => row.map(() => ({ stack: null })))
      }));
      draft.boxesToUnpack = [];
    });
    const root = mountStore(store);
    const all = allText(root);
    expect(all).not.toContain('不用翻就拿到');
    expect(root.querySelectorAll('.contrast-pair.is-reach').length, '差为 0 时不该有那一对').toBe(0);
    // 而两块标题照旧 —— 否则就是整块没渲染，而不是"那一对没渲染"
    const titles = root.querySelectorAll('.block-title').map((el) => el.textContent);
    expect(titles).toContain('室内 / 室外');
    expect(titles).toContain('你 / 整条街');
  });

  it('★★ D-Day 那一屏也要有温度（用户报的"没看到"有一半在这里）', () => {
    /*
     * D-Day 走的是 `ddayHtml()`，而反差层原来整个挂在 `dayHtml()` 里 ——
     * 于是"灾难落地、外面 -18°C"那一屏**反而没有温度**，而那正是这一层
     * 最该说话的地方（§6.6：数字自己说话）。
     */
    const store = survivalStore();
    store.commit((draft) => {
      draft.day = 0;
      draft.phase = 'survival_day';
    });
    const root = mountStore(store);
    const titles = root.querySelectorAll('.block-title').map((el) => el.textContent);
    expect(titles, 'D-Day 那一屏没有温度块').toContain('室内 / 室外');
    expect(allText(root)).toContain('室外');
    // 而"你 / 整条街"那一块**不该**在 D-Day 出现：还没结算过，天数没有意义
    expect(titles, 'D-Day 不该报存货天数').not.toContain('你 / 整条街');
  });
});
