/**
 * 图鉴界面的守护测试（§10B.2 / 补 D-16）。
 *
 * ## 为什么它值得一个测试，而不是"肉眼看一眼"
 *
 * 这一页最容易坏的**不是**布局，而是两件"看起来正常、其实在骗人"的事：
 *
 *  1. **未点亮的格子不给来源** —— §10B.2 明说"玩家需要知道还差什么、去哪儿找"，
 *     而一页只画"？？？"的图鉴等于没有收集目标。它坏起来是**静默的**：
 *     界面照样渲染，只是每一格都没线索；
 *  2. **分母写死** —— 结算页原来写的是 `disasters: 1, // M2 只有寒潮`。
 *     多灾难一落地它就成了假账（"点亮 4 / 总数 1"），而**没有任何报错**。
 *     这一页必须**问注册表**。
 *
 * 还有一条只有界面层才看得见的：**每一条内容都得画出来**。
 * 注册表里有 57 件物资，页面上少了三件不会有任何报错 —— 除非有人数一遍。
 *
 * ## ★ 假 DOM 的两条边界（都在 `fakeDom.ts` 里，踩过一次，写在这儿免得再踩）
 *
 *  1. **`dispatch` 不冒泡** —— 界面把委托挂在 root 上，所以事件要**派发到 root**、
 *     把被点的元素放进 `event.target`（真实浏览器冒泡之后到达委托者时正是这个样子）。
 *     直接 `el.dispatch('click')` 不会触发任何东西，而且**不报错**；
 *  2. **`textContent` 只填在叶子文本节点上** —— 容器（按钮、卡片）永远是空串。
 *     所以断言一律读具体的叶子（`.codex-name` / `.codex-source` / `.codex-tab em`），
 *     读容器会得到 `''`，而那种失败看起来像"界面没渲染"。
 *
 * 另一条已知边界（§3.2）：假体的**层叠顺序**不可靠，所以这里一条几何/遮挡都不测。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, getItemDef, hasItemDef } from '../data/items';
import { countOfKind, entriesOfKind } from '../data/registry';
import { SHOP_DEFS } from '../data/shops';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createStartingRun } from '../systems/setup';
import { CodexScreen } from './CodexScreen';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

interface Ctx {
  root: FakeElement;
  store: GameStore;
  screen: CodexScreen;
}

function setup(onClose: () => void = () => undefined): Ctx {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  doc.body.appendChild(root);

  const store = new GameStore(createSaveGame(createStartingRun(20261002)), stubScheduler());
  const screen = new CodexScreen(asElement(root), store, { onClose });
  screen.mount();
  return { root, store, screen };
}

/** 点一个子元素：事件派发到 root（假体不冒泡），目标放进 event.target */
function click(root: FakeElement, selector: string): void {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`找不到 ${selector}`);
  root.dispatch('click', { target: el });
}

/** 取一批叶子的文字（容器是空串，见文件头第 2 条） */
const texts = (root: FakeElement, selector: string): string[] =>
  root.querySelectorAll(selector).map((el) => el.textContent ?? '');

/**
 * 取"某个容器下面的某种叶子"的文字。
 *
 * ★ 为什么不用 `.codex-tab em` 这种后代选择器：假体**不支持后代组合子**
 * （`closest` 那段注释里写明了它只认 `[attr]` / 标签名 / 类名这几种简单选择器）。
 * `.codex-tab em` 会被当成"同时是 .codex-tab 又是 em"的**单个元素**，
 * 于是一个都匹配不到 —— 而失败的样子是"数量 0"，看起来像界面没渲染。
 *
 * 这个限制本身**不值得改假体**（真实界面用的是简单的单层选择器，
 * 只有测试想穿透两层），所以这里按"先找容器、再在容器里找叶子"两步走。
 */
function leafTexts(root: FakeElement, container: string, leaf: string): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll(container)) {
    for (const child of el.children) {
      if (child.tagName === leaf.toUpperCase()) out.push(child.textContent ?? '');
    }
  }
  return out;
}

/** 整页"看得见的字"：把全部叶子的文字拼起来（等价于人眼扫一遍） */
const pageText = (root: FakeElement): string =>
  [root, ...root.querySelectorAll('*')].map((el) => el.textContent ?? '').join(' ');

describe('图鉴界面：三页与进度', () => {
  let ctx: Ctx;
  afterEach(() => ctx.screen.dispose());

  it('三页的进度分母**都来自注册表**（不写死数字：结算页那个 `disasters: 1` 就是这么变成假账的）', () => {
    ctx = setup();
    // 标签栏上三页各自的进度：分子/分母
    const tabs = leafTexts(ctx.root, '.codex-tab', 'em');
    expect(tabs).toEqual([
      `0 / ${countOfKind('item')}`,
      `0 / ${countOfKind('disaster')}`,
      `0 / ${countOfKind('npc')}`
    ]);
    // 顶部还有一条总计
    expect(pageText(ctx.root)).toContain(`点亮 0 / ${countOfKind('item') + countOfKind('disaster') + countOfKind('npc')}`);
  });

  it('★ 每一条物资都画出来了（少了三件不会有任何报错，只能数）', () => {
    ctx = setup();
    expect(ctx.root.querySelectorAll('.codex-card')).toHaveLength(countOfKind('item'));
  });

  it('翻到灾难页与关系页，各自也一条不少', () => {
    ctx = setup();
    click(ctx.root, '[data-page="disasters"]');
    expect(ctx.root.querySelectorAll('.codex-card')).toHaveLength(countOfKind('disaster'));
    click(ctx.root, '[data-page="npcs"]');
    expect(ctx.root.querySelectorAll('.codex-card')).toHaveLength(countOfKind('npc'));
  });

  it('未点亮的格子是"未点亮"的样子（虚线轮廓，不是藏起来）', () => {
    ctx = setup();
    const cards = ctx.root.querySelectorAll('.codex-card');
    expect(cards.length).toBeGreaterThan(0);
    // 一个新档什么都没点亮 → 一张 is-on 都不该有
    expect(cards.filter((c) => c.classList.contains('is-on'))).toHaveLength(0);
  });

  it('点亮之后那一格变成"已点亮"（is-on），而且名字照旧显示', () => {
    ctx = setup();
    ctx.store.save.meta.codex.items = ['canned_beans'];
    ctx.screen.render();
    const on = ctx.root.querySelectorAll('.codex-card.is-on');
    expect(on).toHaveLength(1);
    // 卡片是 .codex-card 的直接子元素（后代选择器不支持，见 leafTexts 的注释）
    const names = on[0]!.children
      .filter((c) => c.classList.contains('codex-name'))
      .map((c) => c.textContent ?? '');
    expect(names).toEqual(['黄豆罐头']);  });
});

describe('图鉴界面：★「从哪儿来」必须算出来，而且不许留空', () => {
  let ctx: Ctx;
  afterEach(() => ctx.screen.dispose());

  it('★★ 每一格都有一行来源，**没有一格是空串**', () => {
    /*
     * 这条守的正是 D-16 能藏那么久的原因：一件谁都拿不到的物资，
     * 在界面上与"我懒得写来源"长得一模一样。
     * 所以 `describeSources` 对"没有来源"返回的是一句**明确的话**（"还没有来源"），
     * 而不是空串 —— 而当前内容下每件都能拿到，所以那句话也不该出现。
     */
    ctx = setup();
    const sources = texts(ctx.root, '.codex-source');
    expect(sources).toHaveLength(countOfKind('item'));
    expect(sources.filter((s) => s.trim().length === 0)).toEqual([]);
    expect(sources.filter((s) => s === '还没有来源')).toEqual([]);
  });

  it('来源里真的写出了点位名（"超市"这种，而不是 id）', () => {
    ctx = setup();
    const sources = texts(ctx.root, '.codex-source').join(' ');
    expect(sources).toContain('在卖');
    expect(sources).toContain('超市');
  });

  it('灾难页与关系页也各有一行来源（它们不是物资，但同样要告诉玩家怎么遇到）', () => {
    ctx = setup();
    click(ctx.root, '[data-page="disasters"]');
    // 灾难那一页的每一格都要有字（具体写什么见下面那一组）
    expect(texts(ctx.root, '.codex-source').filter((s) => s.trim().length === 0)).toEqual([]);
    click(ctx.root, '[data-page="npcs"]');
    expect(texts(ctx.root, '.codex-source').every((s) => s === '在门口遇见的')).toBe(true);
  });
});

/**
 * ★★ 灾难页的"从哪儿来"是**算出来的** —— 用户 2026-10 报的
 *
 * ## 用户的原话
 *
 * > "还有图鉴里解锁的灾难也会显示开局时揭晓，这不对吧"
 *
 * 他说得对。那一行原来是写死的 `source: '开局时揭晓'`：
 * 在一个只有寒潮的版本里它是对的（那**确实**是开局就揭晓的），
 * 而 116 场能被抽到之后它当场变成假话 ——
 * **从没碰到过的灾难也写着"开局时揭晓"**，而它们的真实状态是"还没放出来"。
 *
 * ★ 而这条错误恰好是这一页的规矩**自己**不许的：`describeSources` 的注释写着
 * "从哪儿来那句话必须从注册表推导，不手写"。物资与 NPC 都是算的，只有灾难是写死的 ——
 * 于是它是这套规矩欠下的一笔，而不是一个新需求。
 */
describe('★★ 灾难页的"从哪儿来"要算：打过 / 能抽到 / 还没放出来，三种说法', () => {
  let ctx: Ctx;
  afterEach(() => ctx.screen.dispose());

  it('★★ 没有一格写"开局时揭晓"（那句话在 116 场下是假话）', () => {
    ctx = setup();
    click(ctx.root, '[data-page="disasters"]');
    const sources = texts(ctx.root, '.codex-source');
    expect(sources.length).toBe(countOfKind('disaster'));
    expect(
      sources.filter((s) => s.includes('开局时揭晓')),
      '图鉴里又出现了"开局时揭晓"这句写死的话'
    ).toEqual([]);
  });

  it('★ 打过的那一场报"活到过 D+n"（比"打过"更有信息量）', () => {
    /*
     * ⚠ 夹具里那一局的 meta 是**空的**（`createSaveGame` 给一份全新账本），
     * 所以这里要自己点亮一场 —— 不点的话三种说法里的第一种永远测不到，
     * 而那条断言会以一个"看起来像界面没渲染"的样子失败。
     */
    ctx = setup();
    ctx.store.save.meta.codex.disasters = ['cold_snap'];
    ctx.store.save.meta.bestSurvivalDays['cold_snap'] = 11;
    ctx.screen.render();
    click(ctx.root, '[data-page="disasters"]');
    const sources = texts(ctx.root, '.codex-source');
    expect(sources, '点亮过的灾难没报"活到过第几天"').toContain('活到过 D+11');
  });

  it('★★ 还没放出来的那些说清"还差什么"（与开局页同一套口径）', () => {
    ctx = setup();
    click(ctx.root, '[data-page="disasters"]');
    const sources = texts(ctx.root, '.codex-source');
    // 全新档：除了寒潮，其余 115 场都还没放出来 → 都该报一个门槛
    const hints = sources.filter((s) => s.includes('才会出现'));
    expect(hints.length, '没放出来的灾难没有一行说清还差什么').toBeGreaterThan(100);
    expect(hints.some((s) => /再撑到最后 \d+ 次/.test(s))).toBe(true);
  });
});

describe('图鉴界面：成就段（§10B.2 的印章）', () => {
  let ctx: Ctx;
  afterEach(() => ctx.screen.dispose());

  it('成就段画出了全部成就，未解锁的是空的印，解锁的盖朱红', () => {
    ctx = setup();
    const seals = ctx.root.querySelectorAll('.seal');
    expect(seals.length).toBeGreaterThan(0);
    expect(seals.filter((s) => s.classList.contains('is-on'))).toHaveLength(0);

    ctx.store.save.meta.achievements = ['a_spotless'];
    ctx.screen.render();
    expect(ctx.root.querySelectorAll('.seal.is-on')).toHaveLength(1);
  });

  it('★ 每一条成就都写清了"怎么才算达成"（一行"未解锁"等于没告诉玩家能做什么）', () => {
    ctx = setup();
    const hints = leafTexts(ctx.root, '.seal-body', 'i');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.filter((h) => h.trim().length === 0)).toEqual([]);
    // 名字也在（不是只有判据）
    expect(leafTexts(ctx.root, '.seal-body', 'b').length).toBe(hints.length);
  });
});

describe('图鉴界面：★★ 进度条与"还缺什么、去哪儿补"（铁则欠账③）', () => {
  let ctx: Ctx;
  afterEach(() => ctx.screen.dispose());

  /** 量一根条的填充量（挂在 `<i class="codex-bar-fill">` 的内联样式上） */
  const fills = (root: FakeElement): number[] =>
    root
      .querySelectorAll('.codex-bar-fill')
      .map((el) => Number(/--fill:\s*([\d.]+)/.exec(el.getAttribute('style') ?? '')?.[1] ?? 'NaN'));

  it('★ 每个品类都有一根条，而且**条数与品类数对得上**（漏一组不会有任何报错，只能数）', () => {
    ctx = setup();
    const groups = CATEGORY_ORDER.filter((c) =>
      entriesOfKind('item').some((e) => hasItemDef(e.id) && getItemDef(e.id).category === c)
    );
    expect(ctx.root.querySelectorAll('.codex-bar')).toHaveLength(groups.length);
  });

  it('★ 全空的档：每根条都是 0，而且**数字照旧在**（条不能把数字换掉）', () => {
    ctx = setup();
    expect(fills(ctx.root).every((f) => f === 0)).toBe(true);
    // 标题行里的 `0 / N` 还在
    const counts = texts(ctx.root, '.codex-count');
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((t) => /^\d+ \/ \d+$/.test(t.trim()))).toBe(true);
  });

  it('★★ 点亮一件之后，**那一组的**条真的长了一格（不是随便哪根条）', () => {
    ctx = setup();
    const before = fills(ctx.root);
    const item = entriesOfKind('item').find((e) => hasItemDef(e.id))!;
    const def = getItemDef(item.id);
    ctx.store.save.meta.codex.items = [item.id];
    ctx.screen.render();
    const after = fills(ctx.root);

    const groups = CATEGORY_ORDER.filter((c) =>
      entriesOfKind('item').some((e) => hasItemDef(e.id) && getItemDef(e.id).category === c)
    );
    const at = groups.indexOf(def.category);
    expect(after[at]!).toBeGreaterThan(before[at]!);
    // 别的组不许跟着动
    after.forEach((v, i) => {
      if (i !== at) expect(v).toBe(before[i]!);
    });
  });

  it('★ 集齐一组 → `is-full`（全满与差一件在一根细条上分不出来）', () => {
    ctx = setup();
    const group = entriesOfKind('item').filter((e) => hasItemDef(e.id) && getItemDef(e.id).category === 'water');
    ctx.store.save.meta.codex.items = group.map((e) => e.id);
    ctx.screen.render();
    expect(ctx.root.querySelectorAll('.codex-bar.is-full')).toHaveLength(1);
  });

  it('★★ 汇总说清"还缺几件 + 去哪儿补"，而且**去哪儿是从注册表算的**', () => {
    ctx = setup();
    const missing = texts(ctx.root, '.codex-missing');
    expect(missing.length).toBeGreaterThan(0);
    // 每一条都必须报一个数字，且必须报一个地点（"还缺 N 件。"后面什么都不说等于没说）
    for (const line of missing) {
      expect(line).toMatch(/还缺 \d+ 件/);
      expect(line.length).toBeGreaterThan('还缺 0 件：。'.length);
    }
    // 至少有一条真的点出了某家店（新档什么都没点亮 → 全部物资都缺）
    const shops = SHOP_DEFS.map((s) => s.name);
    expect(missing.some((line) => shops.some((name) => line.includes(name)))).toBe(true);
  });

  it('★ 缺的数字与卡片上的未点亮数**对得上**（两处各算一遍早晚会漂）', () => {
    ctx = setup();
    const dark = ctx.root.querySelectorAll('.codex-card').filter((c) => !c.classList.contains('is-on')).length;
    const claimed = texts(ctx.root, '.codex-missing').reduce((sum, line) => {
      const n = /还缺 (\d+) 件/.exec(line);
      return sum + Number(n?.[1] ?? 0);
    }, 0);
    // 物资页分品类汇总，灾难/NPC 页各一条 —— 这里只看物资页：它等于全部未点亮的物资
    expect(claimed).toBe(dark);
  });

  it('★ 全都点亮时不报"还缺 0 件"（填满之后再挂一句就是噪音）', () => {
    ctx = setup();
    // 把三页全部点亮
    ctx.store.save.meta.codex.items = entriesOfKind('item').map((e) => e.id);
    ctx.store.save.meta.codex.npcs = entriesOfKind('npc').map((e) => e.id);
    ctx.screen.render();
    expect(texts(ctx.root, '.codex-missing')).toEqual([]);
  });
});

describe('图鉴界面：出口', () => {
  it('「返回」会回调装配层（哪一屏由它决定）', () => {
    let closed = 0;
    const ctx = setup(() => (closed += 1));
    click(ctx.root, '[data-action="close"]');
    expect(closed).toBe(1);
    ctx.screen.dispose();
  });

  it('★ dispose 摘掉监听器（换页之后点它不该再有反应）', () => {
    let closed = 0;
    const ctx = setup(() => (closed += 1));
    ctx.screen.dispose();
    click(ctx.root, '[data-action="close"]');
    expect(closed).toBe(0);
  });
});
