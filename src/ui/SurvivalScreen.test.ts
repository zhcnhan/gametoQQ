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
import { GO_HOME_AP_COST } from '../systems/phases';
import { createStartingRun } from '../systems/setup';
import { cashPriceOf, type TradeIntent } from '../systems/trade';
import { SurvivalScreen } from './SurvivalScreen';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';
import type { SurvivalSnapshot } from '../model/types';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 一份"正在生存期、有日报"的局面 */
function survivalStore(
  over: { priceFactor?: number; limits?: { category: string; max: number }[]; disasterId?: string } = {}
) {
  const run = createStartingRun(20261007, { disasterId: over.disasterId ?? 'cold_snap' });
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

function mount(
  over: Parameters<typeof survivalStore>[0] = {},
  props: Partial<{ actionPoints: number; day: number }> = {}
): Ctx {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = survivalStore(over);
  if (props.actionPoints !== undefined) store.run.actionPoints = props.actionPoints;
  if (props.day !== undefined) store.run.day = props.day;
  const screen = new SurvivalScreen(asElement(root), store, {
    onStart: () => undefined,
    onNext: () => undefined,
    onTrade: () => false,
    onGoOrganize: () => undefined
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
      onTrade: () => false,
        onGoOrganize: () => undefined
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

/**
 * ★★ 「今天要算的账」：物价加成与负重惩罚的当期取值（M4 W-12）
 *
 * ## 它守的是哪一笔账
 *
 * 116 场灾难里 **90 场**写了 `priceSurcharge`（维度 10）、**83 场**写了
 * `carryFactor`（维度 7）。两者从 M4 W-01 起都真的生效了，而可见落点原来只有：
 *
 *  · 扫货页那个"今天贵 N%"角标 —— 要**出了门**才看得到；
 *  · 日报里"比这一场的平常价贵 N%" —— 那是**已经过完一天**的复盘。
 *
 * 而这两个数影响的决定是"**今天该不该出门买、还是先把家里的吃干净**"，
 * 那是一个在屋里就要做的判断。所以它们挂到了「室内 / 室外」那一块底下。
 *
 * ## 判据里两个刻意的地方
 *
 *  ① **中性值时不渲染**：`cold_snap` 这两维都是默认值，那时这一行必须
 *     **不存在** —— 写一句"物价正常、负重正常"会让玩家以为每天都要读它，
 *     而空白在那一天才是真话（§5 引擎①：只陈述，不夸）。
 *  ② **只说数、不解释**：这一行不是教程。它写"贵 40%"而不是
 *     "因为这一场物资紧张所以价格上浮"，理由与 `.market-line` 一样 ——
 *     玩家要的是一个能据以做决定的数，不是一段设定说明。
 */
describe('★★ 「今天要算的账」：物价与负重的当期取值（M4 W-12）', () => {
  function mountStore3(store: GameStore): FakeElement {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const root = doc.createElement('div');
    new SurvivalScreen(asElement(root), store, {
      onStart: () => undefined,
      onNext: () => undefined,
      onTrade: () => false,
      onGoOrganize: () => undefined
    }).mount();
    return root;
  }

  /** 这一行本身（它挂 `.block-note.is-pressure`，见 `style.css` 那段注释） */
  function pressureLine(root: FakeElement): FakeElement | null {
    return root.querySelectorAll('.block-note.is-pressure')[0] ?? null;
  }

  it('★ 两维都是中性 → 这一行**不存在**（没消息的时候一个字都不写）', () => {
    // `cold_snap` 没有 `priceSurcharge` 行、也没有 `carryFactor` 行
    const root = mountStore3(survivalStore({ disasterId: 'cold_snap' }));
    expect(pressureLine(root), '平常的日子里不该有这一行').toBeNull();
  });

  it('★★ 这一场物价贵、又搬不动 → 两个数都写出来，而且各有参照', () => {
    /*
     * `tsunami`（海啸）：`priceSurcharge: 0.8`（这一维的**最高档**，上限就是 0.8）
     * / `carryFactor: 0.5`（**最低档**，上限就是 0.5）—— 两个数的极端同时出现，
     * 正好一次把"两句都要出现、而且都要按百分数说"钉住。
     */
    const root = mountStore3(survivalStore({ disasterId: 'tsunami' }));
    const line = pressureLine(root);
    expect(line, '这一场明明又贵又搬不动，界面上却一个字没有').not.toBeNull();
    const text = line!.textContent;
    expect(text, '贵了多少').toContain('80%');
    expect(text, '少拎多少').toContain('50%');
    /*
     * ★ 参照物必须在：`tsunami` 的 `priceSurcharge` 是 **0.8**（不是 80），
     * 而这一行说的是"比平常贵 80%" —— 去掉"比平常"三个字，
     * 玩家会把这个数读成"价格是平常的 80%"（方向刚好相反）。
     */
    expect(text).toContain('比平常');
  });

  it('★ 只说"贵"或只说"少拎"：另一句不许留一个空壳（逗号、零、空格）', () => {
    /*
     * ★★ 这一条同时是一条**数据不变量**，而它会红。
     *
     * 实测（`DISASTER_DEFS` 116 场）：**109 场两个维度都有值**、
     * 1 场两个都没有（`cold_snap`）、5 场只有负重、**只有 1 场只有物价**
     * —— 就是 `chem_spill`（化学品泄漏，`priceSurcharge: 0.3`、`carryFactor` 是 1）。
     *
     * 所以拿它来钉"只说一句"那一支：同一次实测就把我上一版的错误假设照出来了 ——
     * 我当时以为 `blackout_winter` 没有 `carryFactor`，实际上它是 `0.8`，
     * 于是"另一句不该出现"那条断言**报的是它自己找错了地方**，
     * 而不是功能坏了（实测输出：`'今天要算的账：东西比平常贵 35%，一趟少拎 20%。'`
     * 不该 contain "少拎"）。
     *
     * 判据里凡出现"少拎"就是拼串漏了条件，而那种句子读起来是
     * "一趟少拎 0%"（把中性值说成了一条坏消息）。
     */
    const root = mountStore3(survivalStore({ disasterId: 'chem_spill' }));
    const text = pressureLine(root)?.textContent ?? '';
    expect(text, '这一场没写负重那一维').toContain('比平常');
    expect(text, '中性值不许被印成"少拎 0%"').not.toContain('少拎');
  });

  it('★ 只有负重、没有物价（5 场里挑一场）→ 反向那一支也要成立', () => {
    /*
     * `typhoon_land`（台风登陆）：`carryFactor: 0.7`、没有 `priceSurcharge`。
     * 两条支路各有一个真实场次看着，改坏任何一支都有用例接住。
     */
    const root = mountStore3(survivalStore({ disasterId: 'typhoon_land' }));
    const text = pressureLine(root)?.textContent ?? '';
    expect(text).toContain('少拎');
    expect(text, '中性值不许被印成"贵 0%"').not.toContain('比平常');
  });
});

/**
 * ★★ 突发事件的**框**（2026-10 用户："把那些事件任务也弄得显眼一点，
 * 哪怕是不同的给个框也行啊，注意设计美学"）
 *
 * ## 它守的是"这一件有没有被抓住眼睛"
 *
 * 在加框之前，一件突发事件与"消耗 主食 2"那类流水长得一模一样 ——
 * 都只是正文里一段普通的话。而它是这一局里**最该被读到**的东西：
 * 它决定"你的整理有没有救到你"，而且它可能整局都不出现（约三成日子）。
 *
 * 判据三件：**有框**（不是光秃秃一段话）、**顶上写着这是什么**、
 * **已解决与未解决长得不一样**（颜色语义一个都不是新发明的：
 * 暖黄 = 安全 / 窗内，朱红 = 警告 —— §5A 那两条原样适用）。
 */
describe('★★ 突发事件的框：它必须自己站出来', () => {
  /** 一份带突发事件的日子（`resolved` 决定接住没有） */
  function withEmergency(resolved: boolean): GameStore {
    const store = survivalStore();
    store.commit((draft) => {
      draft.survival.last = {
        ...draft.survival.last,
        emergencyId: 'e_pipe_freeze',
        emergencyResolved: resolved,
        emergencyHurt: resolved ? 0 : 2
      } as never;
    });
    return store;
  }

  function mountStore2(store: GameStore): FakeElement {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const root = doc.createElement('div');
    new SurvivalScreen(asElement(root), store, {
      onStart: () => undefined,
      onNext: () => undefined,
      onTrade: () => false,
        onGoOrganize: () => undefined
    }).mount();
    return root;
  }

  it('★★ 突发事件有自己的框，而且顶上写着"这是什么"', () => {
    const root = mountStore2(withEmergency(true));
    const frames = root.querySelectorAll('.event-frame');
    expect(frames.length, '突发事件没有套框 —— 它混在流水里了').toBeGreaterThan(0);
    const kinds = root.querySelectorAll('.event-kind').map((el) => el.textContent);
    expect(kinds.join('｜'), '框上没有一行说"这是什么"').toContain('突发');
  });

  it('★★ 已解决与未解决**长得不一样**（暖黄 vs 朱红那两条既有语义）', () => {
    const okRoot = mountStore2(withEmergency(true));
    const badRoot = mountStore2(withEmergency(false));
    const ok = okRoot.querySelectorAll('.event-frame')[0];
    const bad = badRoot.querySelectorAll('.event-frame')[0];
    expect(ok?.classList.contains('is-resolved'), '已解决没画成"安全"那一档').toBe(true);
    expect(bad?.classList.contains('is-hurt'), '未解决没画成"警告"那一档').toBe(true);
    // 两档的类名必须互斥（同一个框不该同时是两种语义）
    expect(ok?.classList.contains('is-hurt')).toBe(false);
    /*
     * ⚠ 顶上那行字要读**叶子**（`.event-kind`）：`.event-frame` 里还有 `<p>`，
     * 而假 DOM 的混排容器 `textContent` 是空串 —— 读容器会得到 ''，
     * 那条失败看起来像"框没渲染"（假体的老边界，见 `fakeDom.ts`）。
     */
    expect(okRoot.querySelectorAll('.event-kind')[0]?.textContent).toContain('已解决');
    expect(badRoot.querySelectorAll('.event-kind')[0]?.textContent).toContain('未解决');
  });
});

describe('★★ 回家整理（M4 决策 B）：入口在，但不能是个死按钮', () => {
  /** 找 dock 里那个按钮；不存在返回 null */
  function goBtn(root: FakeElement): FakeElement | null {
    return root.querySelectorAll('[data-action="go-organize"]')[0] ?? null;
  }

  it('D-Day 与普通日报都给出这个入口', () => {
    expect(goBtn(mount({}, { day: 3 }).root), '普通日报').not.toBeNull();
    expect(goBtn(mount({}, { day: 0 }).root), 'D-Day').not.toBeNull();
  });

  it('★ 行动点够时按钮可用，并写出它要花几点', () => {
    const btn = goBtn(mount({}, { actionPoints: GO_HOME_AP_COST }).root);
    expect(btn?.disabled).toBeFalsy();
    expect(btn?.textContent).toContain(String(GO_HOME_AP_COST));
  });

  it('★★ 行动点不够时**不消失、也不无声地灰掉** —— 灰掉并说出还剩几点', () => {
    /*
     * ⚠ `over` 必须显式给一个空对象：`survivalStore` 的**默认值**里有 `actionPoints: 3`，
     * 只传 `{}` 之外的东西才能让这一条测到"不够"那一支。
     */
    const btn = goBtn(mount({}, { actionPoints: 0 }).root);
    expect(btn, '按钮不许凭空消失（那样玩家会以为这条路不存在）').not.toBeNull();
    expect(btn?.disabled, '点不动就要说明为什么').toBe(true);
    // ★ 说明里必须有那个数：「今天剩 0 点」——写"行动点不够"等于什么都没说
    expect(btn?.textContent).toContain('0');
    expect(btn?.textContent).toContain('不够');
  });

  it('★ 点它调的是 onGoOrganize 那一条路', () => {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const root = doc.createElement('div');
    const store = survivalStore();
    store.run.actionPoints = 3;
    let calls = 0;
    const screen = new SurvivalScreen(asElement(root), store, {
      onStart: () => undefined,
      onNext: () => undefined,
      onTrade: () => false,
      onGoOrganize: () => {
        calls += 1;
      }
    });
    screen.mount();
    const btn = root.querySelectorAll('[data-action="go-organize"]')[0];
    expect(btn).toBeTruthy();
    /*
     * ⚠ 假体的 `dispatch` **不做冒泡**（`fakeDom.ts`：它只调自己的 listener），
     * 而这一屏的点击是**挂在 root 上的委托**（`target.closest('[data-action]')`）。
     * 所以要从 root 派发、并把 `target` 指到那个按钮 —— 直接 `btn.dispatch('click')`
     * 只会得到"零次调用"，看起来像产品代码坏了。
     */
    root.dispatch('click', { target: btn });
    expect(calls).toBe(1);
  });
});

/**
 * ★★ 现金顶一件（M4 决策 B 的第四个出口）。
 *
 * ## 它守的是"这一屏比命令层多知道的那一半"
 *
 * 命令层（`systems/trade`）只负责"这一单成不成立"；而**开关什么时候可点、
 * 打开之后要不要替玩家退掉一件、付不起的时候说什么**，全在这一屏。
 * 这三件事坏掉都不会报错：
 *
 *  ① 清单空着时开关可点 → 玩家打开它，命令挑不出那一件，最后收到一句驴唇不对马嘴的拒绝；
 *  ② 打开开关时不退件 → 额度从 3 缩到 2，"凑齐 3/2、按钮永远灰着"，一个死局；
 *  ③ 现金不够时不说 → 玩家只能靠点一下才知道差多少。
 */
describe('★★ 现金顶一件：开关的三个状态都要说清楚', () => {
  /**
   * 一个"正在硬撑、屋里有货"的局面（交易才开得了门）。
   *
   * ⚠ 三个条件缺一不可：`hardPress`（不是硬撑时这一节整个不出现）、
   * 冷却已过（`lastTradeDay = NEVER_TRADED`，而 `createStartingRun` 给的正是它）、
   * 以及货架上有东西（清单空着时开关是灰的）。
   */
  function tradeStore(): GameStore {
    const store = survivalStore();
    store.run.survival.last.hardPress = true;
    store.run.survival.last.hardPressLevel = 'straining';
    store.commit((draft) => {
      draft.boxesToUnpack = [];
      const shelf = draft.shelves[0];
      if (!shelf) throw new Error('开局没有货架');
      shelf.slots[0]![0] = { stack: makeStack('battery', 4, null) };
      shelf.slots[0]![1] = { stack: makeStack('canned_beans', 4, null) };
      shelf.slots[0]![2] = { stack: makeStack('rice_bag', 1, null) };
    });
    return store;
  }

  function mountTrade(): { root: FakeElement; store: GameStore; intents: TradeIntent[] } {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const root = doc.createElement('div');
    const store = tradeStore();
    const intents: TradeIntent[] = [];
    const screen = new SurvivalScreen(asElement(root), store, {
      onStart: () => undefined,
      onNext: () => undefined,
      onTrade: (intent) => {
        intents.push(intent);
        return false; // 一律不当成交：被拒时界面必须**留着**已选与开关
      },
      onGoOrganize: () => undefined
    });
    screen.mount();
    return { root, store, intents };
  }

  /** 假体的 `dispatch` **不冒泡**，所以点击一律从 root 派发并把 target 指过去 */
  function click(root: FakeElement, selector: string, index = 0): void {
    const target = root.querySelectorAll(selector)[index];
    if (!target) throw new Error(`点不到 ${selector}[${index}]`);
    root.dispatch('click', { target });
  }

  const cashBtn = (root: FakeElement): FakeElement | null => root.querySelectorAll('.trade-cash')[0] ?? null;
  const confirmBtn = (root: FakeElement): FakeElement | null =>
    root.querySelectorAll('[data-action="trade-confirm"]')[0] ?? null;

  it('★ 清单空着时开关是灰的，并说清为什么（不是让玩家白点一下）', () => {
    const { root } = mountTrade();
    const btn = cashBtn(root);
    expect(btn, '开关必须存在 —— 它不存在的话玩家不知道还有这条路').not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.classList.contains('is-idle')).toBe(true);
    expect(btn?.textContent).toContain('先挑');
  });

  it('★★ 打开开关：额度从 3 缩到 2，并**替玩家退掉多出来的那一件**', () => {
    const { root } = mountTrade();
    /*
     * ⚠ 一次点击 = **加一件**，而点到已经选过的那一堆是**收回一件**
     * （`togglePick` 的语义，也是唯一的撤销方式）。所以"凑满三件"必须点**三样不同的东西** ——
     * 之前这里点了两次电池，实际得到的是 1 件。
     */
    click(root, '[data-pick="battery"]');
    click(root, '[data-pick="canned_beans"]');
    click(root, '[data-pick="rice_bag"]');
    expect(root.querySelectorAll('.trade-count')[0]?.textContent).toContain('3/3');

    click(root, '[data-action="trade-cash"]');

    // ① 额度变了；② 真的退了一件（否则会停在"凑齐 3/2"这个死局上）
    expect(root.querySelectorAll('.trade-count')[0]?.textContent).toContain('2/2');
    const chosen = root
      .querySelectorAll('.trade-chosen')
      .reduce((n, el) => n + Number((el.textContent ?? '').replace(/\D+/g, '')), 0);
    expect(chosen, '挑中的件数必须与额度一致').toBe(2);
    expect(cashBtn(root)?.classList.contains('is-on')).toBe(true);
    expect(confirmBtn(root)?.disabled).toBeFalsy();
  });

  it('★ 付得起时开关把**价钱**报出来（它是玩家做这个决定的唯一依据）', () => {
    const { root, store } = mountTrade();
    click(root, '[data-pick="canned_beans"]');
    click(root, '[data-action="trade-cash"]');
    const price = cashPriceOf(store.run, 'canned_beans');
    expect(cashBtn(root)?.textContent).toContain(`${price} 元`);
    expect(root.querySelectorAll('.is-cash-short')).toHaveLength(0);
  });

  it('★★ 付不起时不灰按钮，而是把"差多少"说出来', () => {
    const { root, store } = mountTrade();
    store.commit((draft) => {
      draft.cash = 0;
    });
    click(root, '[data-pick="canned_beans"]');
    click(root, '[data-action="trade-cash"]');

    const note = root.querySelectorAll('.is-cash-short')[0];
    expect(note, '现金不够时必须有一行说明').toBeTruthy();
    expect(note?.textContent).toContain('现金不够');
    expect(note?.textContent).toContain(String(cashPriceOf(store.run, 'canned_beans')));
    // 说明在，但"交给他"仍然是灰的 —— 钱不够本来就成交不了
    expect(confirmBtn(root)?.disabled).toBe(true);
  });

  it('★★ 交出去的是"一单意图"（开关状态），不是界面自己算好的那一件', () => {
    const { root, intents } = mountTrade();
    click(root, '[data-pick="battery"]');
    click(root, '[data-pick="canned_beans"]');
    click(root, '[data-action="trade-cash"]');
    click(root, '[data-action="trade-confirm"]');

    expect(intents).toHaveLength(1);
    expect(intents[0]?.cashOn).toBe(true);
    expect(intents[0]?.picks.map((p) => p.itemId).sort()).toEqual(['battery', 'canned_beans']);
    // 挑哪一件是 systems/trade 的规矩（`pickCashFor`），界面不许替它决定
    expect(Object.keys(intents[0] ?? {})).not.toContain('cashFor');
    // 被拒（`onTrade` 返回 false）→ 已选与开关**都留着**，玩家改一下就能再试
    expect(root.querySelectorAll('.trade-chosen').length).toBeGreaterThan(0);
    expect(cashBtn(root)?.classList.contains('is-on')).toBe(true);
  });
});

describe('★★ 维度 7 的位置那一半：日报要把"多花了多少"说出来', () => {
  /**
   * 造一份"有日报、劳作是 20 点"的局面，`workSaved` / `workHauled` 由调用方给。
   *
   * ⚠ 这一组用的是**文件顶层**的 `mount`（它自己造日报快照），不是
   * `.contrast` 那一组里的 `mountStore` —— 后者在另一个 `describe` 里，取不到。
   * 所以这里先 `mount` 拿到 root 与 store，再 `commit` 改那两个数并重挂一次。
   */
  function withWork(over: { workSaved?: number; workHauled?: number }): FakeElement {
    const store = survivalStore();
    store.commit((draft) => {
      const last = draft.survival.last;
      if (!last) throw new Error('这一屏需要一份日报快照');
      last.workCost = 20;
      last.workSaved = over.workSaved ?? 0;
      last.workHauled = over.workHauled ?? 0;
    });
    const root = doc2Root();
    new SurvivalScreen(asElement(root), store, {
      onStart: () => undefined,
      onNext: () => undefined,
      onTrade: () => false,
      onGoOrganize: () => undefined
    }).mount();
    return root;
  }

  function doc2Root(): FakeElement {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    return root;
  }

  it('★ 说出来"多花了几点"，并指出怎么改（挪到门口那块）', () => {
    /*
     * ## 这一句和 `workSaved` 那句是**一对**
     *
     * `workSaved` 说"你挑的人替你省的"，`workHauled` 说"这一场的天气 +
     * 你自己的摆法罚你的"。只说前一句，玩家会在体力账上看到一笔解释不了的窟窿，
     * 然后把账记到别处（以为公式坏了、以为灾难更狠了），而不会想到
     * "我把米堆在最里头那块架子上了"。
     */
    const text = allText(withWork({ workHauled: 2.4 }));
    expect(text, '压在靠里那块多花的体力没有说出来').toContain('搬不动的天气');
    expect(text).toContain('多花');
    expect(text).toContain('2.4');
    // ★ 给的是"怎么改"，不是一个光秃秃的数
    expect(text).toContain('门口');
  });

  it('★ 没有搬运惩罚时一个字都不提位置（不许挂一条永远在的提示）', () => {
    /*
     * 平时摆哪儿都一分不多花。一条永远挂着的"靠里那块费劲"会让玩家
     * 去挪一个本来不该挪的屋子 —— 那比不说更坏。
     *
     * ⚠ 判据必须用**只属于这一句**的措辞（"搬不动的天气" / "靠里"），
     * 不能拿"多花"当判据：整理那一块本来就有一句
     * "东西还没放进你自己写的清单里，每天找它们要多花力气" ——
     * 它讲的不是位置，但会让这条断言**永远红着**。
     */
    const text = allText(withWork({ workHauled: 0 }));
    expect(text, '平时不该提位置').not.toContain('搬不动的天气');
    expect(text).not.toContain('靠里');
  });

  it('两句可以同时出现（搬不动的天气 + 装卸工）：它们说的是两笔不同的账', () => {
    const text = allText(withWork({ workSaved: 4, workHauled: 2.4 }));
    expect(text).toContain('少花');
    expect(text).toContain('多花');
  });
});
