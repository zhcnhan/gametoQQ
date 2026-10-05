/**
 * 开局页「这一局是哪一场灾难」的守护测试（M4 决策 A / 工单 W-01）。
 *
 * ## 它守的是**一句话的准确性**
 *
 * 在 W-01 之前，开局页读的是 `M1_DISASTER_ID`（写死寒潮）—— 那时它是对的，
 * 因为实机只有寒潮。而 116 场能被抽到之后，那一页会**当着一场热浪的面
 * 念寒潮的日历、寒潮的温度、寒潮的刚需品类**。
 *
 * 这个 bug 的形状值得记住：它**不报错、不白屏、也不难看** ——
 * 它只是让玩家照着"要燃料和棉被"囤了 7 天，D-Day 来了才发现是热浪。
 * 所以守护读的是**真的渲染出来的那几个叶子**，而不是"看那个字段传对了没"。
 *
 * ## ⚠ 假 DOM 读不到的那一句（`fakeDom.ts` 的解析器边界）
 *
 * `最要紧的是 <b>燃料</b> 和 <b>保暖</b>。` 在假 DOM 里只剩下那两段 `<b>`，
 * 前后那两句散字**整个不存在**（它不实现文本节点）——
 * 所以这里**不断言**"最要紧的是"，也不假装那一句没问题。
 * 它由 `disaster.priorityCategories` 直接驱动，而那个字段的读数已经在
 * `model/score.test.ts`（应急品类跟着灾难走）里守着。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMetaProfile } from '../state/save';
import { PrologueScreen } from './PrologueScreen';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function mount(disasterId: string, meta?: ReturnType<typeof createMetaProfile>): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new PrologueScreen(asElement(root), {
    disasterId,
    meta: meta ?? createMetaProfile(),
    onConfirm: () => undefined,
    onRestart: () => undefined
  }).mount();
  return root;
}

/** 一份"撑过 n 次、见过 m 场"的跨局账本 */
function metaWith(survivedRuns: number, seen: string[]): ReturnType<typeof createMetaProfile> {
  const meta = createMetaProfile();
  meta.survivedRuns = survivedRuns;
  meta.codex.disasters = seen;
  return meta;
}

/**
 * 第 n 个区块的标题（`h2.block-title` 是纯文本叶子，读得到）。
 *
 * ⚠ 顺序按**出现次序**算，所以每加一段正文，这里的下标都要跟着改 ——
 * 2026-10 加"怎么玩"那一段（`ui/howToPlay.ts`）时就撞过一次。
 * 读这一页的某一段时，优先用下面的 `titleIndex` 按名字找。
 */
function blockTitle(root: FakeElement, index: number): string {
  return root.querySelectorAll('.block-title')[index]?.textContent ?? '';
}

/** 按标题里的词找那一段的下标（比记下标稳 —— 加一段正文不会让断言说谎） */
function titleIndex(root: FakeElement, keyword: string): number {
  return root.querySelectorAll('.block-title').findIndex((el) => el.textContent.includes(keyword));
}

/** 第 n 个区块的说明行（`p.block-note`，多数是纯文本叶子） */
function blockNotes(root: FakeElement): string[] {
  return root.querySelectorAll('.block-note').map((el) => el.textContent);
}

afterEach(() => {
  installFakeWindow(new FakeDocument());
});

describe('★ 开局页显示的是**这一局真的抽到的那一场**', () => {
  it('寒潮局：身份卡下面那一段说的就是寒潮', () => {
    const root = mount('cold_snap');
    // ★ 按名字找，不记下标：这一段的前面现在还有"怎么玩"（2026-10 加）
    const at = titleIndex(root, '这一局会撞上什么');
    expect(at, '开局页少了「这一局会撞上什么」那一段').toBeGreaterThan(0);
    expect(blockTitle(root, at)).toContain('这一局会撞上什么');
    expect(allText(root)).toContain('寒潮');
    // 怎么玩 → 身份卡 → 这一局会撞上什么，三段；日历那一整条已经搬去顶栏（D-33 / 决策 E）
    expect(root.querySelectorAll('.block-title')).toHaveLength(3);
  });

  it('★★ 热浪局：那一页**不许**出现"寒潮"两个字', () => {
    /*
     * 这是本文件的核心一条。它防的是"日历按抽到的那场走、而标题/文案
     * 还写着上一版的常量"—— 那种错在屏幕上是自相矛盾的，
     * 而它读起来仍然像一句正常的话（玩家会以为"寒潮"是这一场灾难的代号）。
     *
     * ★ 断言走 `allText`（`fakeDom` 的叶文本收集）而不是挑几个 `.block-note`：
     * **这一条是"整页不许出现"** —— 只读几个已知的叶子，等于给"将来某处
     * 新加一句写死的寒潮文案"留了一个不会被抓到的口子。而那一句正是最容易漏的
     * （"最要紧的是 …" 就是这么一处：它在假体里根本不是叶子）。
     */
    const root = mount('heat_wave');
    /*
     * ★ 灾难名在 D-33 之后只住在**顶栏**（`ui/prophetBar.ts` 的 `.run-bar-name`），
     * 标题按用户拍板写死成"这一局会撞上什么"（"能介绍更多"那条）。
     * 所以这里比的是**整页**：念的是抽到的这一场。
     */
    expect(allText(root)).toContain('热浪');
    expect(allText(root), '开局页在热浪局里念了寒潮的日历').not.toContain('寒潮');
  });

  it('★★ D-Day 那句与"最要紧的两类"都按这一场来：两场不一样', () => {
    /*
     * ★ D-33 之后这一条的判据换了（原来比的是两场画出的 `.cal-bar` 强度曲线）：
     * 那条曲线**整块搬去了顶栏**（`ui/prophetBar.ts`，由 `windowBandHtml` 画在每一屏），
     * 开局页不再拥有"这一场的形状"。但开局页仍有它自己那两句话要说
     * —— D-Day 的 `hint` 与"最要紧的是哪两类"（**选身份时要看的东西**）。
     *
     * ⚠ 所以这条用例现在守的是**那两句话也得跟着这一场走**，
     * 而不是"开局页还画着日历"（画不画不影响玩法，那两句话错了才影响）。
     * 曲线本身按这一场走，由 `ui/prophetBar.test.ts` 与 `ui/windowBand.test.ts` 守着。
     */
    const cold = blockNotes(mount('cold_snap'));
    const heat = blockNotes(mount('heat_wave'));
    expect(cold, '两场在开局页说了同一句话 —— 说明那两句话没跟着这一场走').not.toEqual(heat);
    // 寒潮要燃料与保暖、热浪要饮水与医疗品：这一句错位就会把玩家引去囤错东西
    // ⚠ 品类名取 `CATEGORY_LABELS`（医疗品那一栏在界面里就叫「医疗」）
    expect(allText(mount('cold_snap'))).toContain('保暖');
    expect(allText(mount('heat_wave'))).toContain('医疗');
  });

  it('日历起点那句预告来自这一场（不是写死的寒潮那句）', () => {
    const cold = blockNotes(mount('cold_snap'));
    const heat = blockNotes(mount('heat_wave'));
    // 第一段区块的说明行是身份解锁提示，日历那一句在它后面
    expect(cold).not.toEqual(heat);
  });
});

/**
 * ★★ 「这一局可能抽到哪几场 / 还差什么才能碰到别的灾难」
 *
 * ## 用户报的那句话就是这一组的由来
 *
 * > "我问一下你的设定是不是必须撑过一次寒潮才能解锁其他灾难呢，
 * >  因为我没通过几次他也没解锁"
 *
 * 那条规则本身是对的（数据里写着），但**界面上一个字都没有** ——
 * 玩家只能靠"反复重开、发现永远是寒潮"自己猜，而猜出来的版本比真相宽松，
 * 于是它读起来像 bug。这一组把那句话钉在屏幕上。
 */
describe('★★ 开局页要自己说清"这一局能抽到几场、还差什么"', () => {
  it('全新档：只说"现在 1 场都可能"，并说清差什么', () => {
    const all = allText(mount('cold_snap'));
    expect(all, '开局页没说"灾难是随机抽的"').toContain('随机抽的');
    expect(all).toContain('1 场');
    expect(all, '没说还差什么').toMatch(/再撑到最后 \d+ 次/);
    expect(all, '没说还有多少场没放出来').toMatch(/还有 \d+ 场没放出来/);
  });

  it('★ "还差什么"取**更近**的那个条件（与 `disasterTopTier` 的 Math.max 同一套口径）', () => {
    /*
     * 两个条件取更宽的那个 = "谁先到算谁"。所以提示要报**更近的那一条**：
     *   · 撑过 2 次、见过 2 场 → 离 tier 3 差"再撑 1 次"（而 tier 3 根本不看图鉴）；
     *   · 撑过 3 次、见过 5 场 → 离 tier 4 差"再撑 2 次"，而图鉴那条还差 3 场 ——
     *     两条都报得出来，所以必须挑近的。
     * 报错了那一条，玩家会去追一个更远的目标。
     */
    const byRuns = allText(mount('cold_snap', metaWith(2, ['cold_snap', 'heat_wave'])));
    expect(byRuns).toContain('再撑到最后 1 次');
    expect(byRuns).not.toContain('图鉴里再点亮');

    // tier 3 → 4：撑过 3 次（还差 2 次）vs 见过 5 场（还差 3 场）→ 报更近的那个
    const toTier4 = allText(
      mount('cold_snap', metaWith(3, ['a', 'b', 'c', 'd', 'e']))
    );
    expect(toTier4).toContain('再撑到最后 2 次');
    expect(toTier4).not.toContain('图鉴里再点亮');
  });

  it('★ 全部放出来之后就不再说"还差什么"（不留一条永远追不上的提示）', () => {
    const all = allText(mount('cold_snap', metaWith(9, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])));
    expect(all).not.toContain('没放出来');
    expect(all).toContain('都可能');
  });

  it('★ 池子大小随进度变（撑过 1 次 → 33 场，与数据一致）', () => {
    const one = allText(mount('cold_snap', metaWith(1, ['cold_snap'])));
    expect(one).toContain('33 场');
  });
});
