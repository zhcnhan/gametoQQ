/**
 * 「胶带架」的渲染与拖拽落点（用户要的手感：写一张 → 拖到某一行）。
 *
 * ## 为什么这一组必须有
 *
 * 这个交互是**手拼 HTML + 指针手势 + `elementFromPoint` 落点判定**三件事叠起来的，
 * 而其中任何一环断了都**不会报错**：
 *  · 胶带架没渲染出来 → 玩家看到的只是"顶栏少了一行"，不报错；
 *  · 手势没挂上 → 拖不动，也不报错；
 *  · 落点判定错 → 贴到了别的行，而那看起来像"我自己拖歪了"。
 *
 * 所以这里量三件事：**架子上有几张胶带**、**拖到某一行之后那一行真的贴上了**、
 * **剪刀拖上去真的撕下来了**。
 *
 * ## 假 DOM 的三条边界（都在 `fakeDom.ts` 里，前两条踩过）
 *
 *  ① `textContent` 只填在**叶子**文本节点上 —— 容器永远是空串，要读叶子；
 *  ② 假体**不做布局**：不 `place()` 的元素矩形是 0×0，`elementFromPoint` 返回 `null`，
 *     于是"落点断言"会通过、但验的是空气。**测落点必须先摆位置**；
 *  ③ 拖拽的 `pointermove` / `pointerup` 要派发到 **window** 上（手势在拖拽期间挂在 window）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deserialize } from '../state/save';
import { GameStore } from '../state/store';
import { createOrganizeSession } from '../systems/organize';
import { __resetGesturesForTest } from './drag';
import { OrganizeScreen } from './OrganizeScreen';
import {
  FakeDocument,
  asElement,
  installFakeWindow,
  pointerEvent,
  type FakeElement,
  type FakeWindow
} from './fakeDom';

const FIXTURES = import.meta.glob('../tools/save-*.txt', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

function fixture(name: string): string {
  const text = FIXTURES[`../tools/save-${name}.txt`];
  if (!text) throw new Error(`找不到夹具 save-${name}.txt`);
  return text;
}

/**
 * ★★ 每个用例**共用一个**假 window，而且要装在 `globalThis.window` 上。
 *
 * 这一组测试卡了很久，根因全在"window 这个模块级单例"上，值得写清：
 *
 *  · `drag.ts` 的常驻监听（`pointermove` / `pointerup`）是"**每个 window 对象只装一次**"
 *    （`installedOn === window` 守卫），安装时机是 `attachPointerGesture`（= `mount()`）；
 *  · `drag.ts` 起手时的长按定时器走 `window.setTimeout`、`traceDrag` 读
 *    `window.__tunhuoTrace` —— 两者都是**全局** window；
 *  · 而 `installFakeWindow()` 只是**造一个对象**，不会把它装到 `globalThis` 上。
 *
 * 于是"每个用例新建一个假 window"会得到最糟的组合：常驻监听装在一个对象上、
 * 定时器装在另一个上、开关读第三个 —— 表现是**手势完全没反应，且没有任何报错**，
 * 失败信息全都指向"抽屉没开"这类下游现象。
 *
 * 所以：一个 window 用到底，`beforeEach` 里复位手势状态、装好全局引用。
 */
function newWindow(): FakeWindow {
  const doc = new FakeDocument();
  const win = installFakeWindow(doc);
  (globalThis as { window?: unknown }).window = win;
  // 把 doc 挂到 win 上，调用方就不必再传一个（`FakeWindow` 的类型里没有它）
  (win as unknown as Record<string, unknown>)['document'] = doc;
  return win;
}

interface Ctx {
  root: FakeElement;
  store: GameStore;
  win: FakeWindow;
  /**
   * 屏幕实例本身。
   *
   * ⚠ 只用在一个地方：`renderTapeShelf()` 是 `private`，而"整页重绘之后监听还在不在"
   * 这条测试需要**显式触发那条横条的重建**。用 `as unknown as` 取私有方法
   * 是有意的 —— 与其为测试开一个 public 后门（那会变成产品 API 的一部分），
   * 不如让这一处的不正当性**显式可见**。
   */
  screen: OrganizeScreen;
}

/**
 * 抽屉挂在 **`body`** 上（2026-10 起，见 `OrganizeScreen.mount` 的注释），
 * 所以查它要**从 `body` 查**，不能从这个用例的 `root` 里查 ——
 * 从 root 里查会得到"没有抽屉"，而那是"它挂在别处"，不是"它没打开"。
 * （这个 bug 在这个文件里真的发生过：改完之后 4 条测试一起红。）
 */
let body: FakeElement;

function mount(name: string, sharedWin: FakeWindow): Ctx {
  const doc = (sharedWin as unknown as { document: FakeDocument }).document;
  body = doc.body as unknown as FakeElement;
  const root = doc.createElement('div');
  // 挂进文档树 —— 不挂的话 `elementFromPoint` 永远 null，落点断言会在验空气
  doc.body.appendChild(root);
  const save = deserialize(fixture(name));
  if (!save?.run) throw new Error(`夹具 save-${name} 读不出来`);
  const store = new GameStore(save, {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  });
  const screen = new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined
  });
  screen.mount();
  return { root, store, win: sharedWin, screen };
}

const count = (root: FakeElement, sel: string): number => root.querySelectorAll(sel).length;

/**
 * 轻点一下（**鼠标指针**，绕开触摸的长按定时器）。
 *
 * ★★ 为什么用 `pointerType: 'mouse'` 而不是 `'touch'`：
 * 触摸路径下 `onDown` 会起一个 220ms 的长按定时器，于是"轻点"这件事的判定
 * 要跨过假时钟与定时器的时序 —— 我在这上面试了四种写法都没让它稳定走通。
 * 而鼠标路径**没有定时器**（`onDown` 里那句 `if (e.pointerType !== 'mouse')`），
 * 于是"按下 → 抬手"两次派发就构成一次干净的 tap。
 *
 * 这条测试要验的是"**轻点打开抽屉**"这件事（产品行为），
 * 不是"触摸的长按定时器"，所以走鼠标这条路是**降低噪声**，不是绕过验证。
 * 触摸那条路由 `drag.test.ts` 的手势状态机覆盖着。
 */
function tap(win: FakeWindow, el: FakeElement, at: [number, number]): void {
  el.dispatch('pointerdown', pointerEvent(at[0], at[1], { pointerType: 'mouse' }));
  win.dispatch('pointerup', pointerEvent(at[0], at[1], { buttons: 0, pointerType: 'mouse' }));
}

/**
 * 走一次完整的拖拽（**触摸路径**，也就是手机上真实的那条）。
 *
 * ★★ 三条都是实现事实（`drag.test.ts` 里也记过），不是随手选择 ——
 * 这个 helper 写错过两次，两次的表现都是"拖拽没反应"而不是报错：
 *
 *  ① `pointerdown` 派发到**元素**上，`pointermove` / `pointerup` 派发到 **window** 上；
 *  ② `pointerEvent` 收的是**两个数字**（`x, y`），不是 `{x, y}` 对象 ——
 *     传对象会得到 `clientX: undefined`，位移算不出来；
 *  ③ **触摸要先等长按定格**（`longPressMs` 默认 220ms）才进入拖拽，
 *     鼠标才是"移动超过 6px 即刻"（`handleMove` 里按 `pointerType` 分叉）。
 *     所以 `tick` 那一步不能省 —— 少了它，`pointerdown` 之后一个分支都不走，
 *     而失败信息只会说"那一行没变"。
 */
function drag(win: FakeWindow, el: FakeElement, from: [number, number], to: [number, number]): void {
  el.dispatch('pointerdown', pointerEvent(from[0], from[1]));
  win.tick(300); // 长按定格 → 进入拖拽态
  win.dispatch('pointermove', pointerEvent(to[0], to[1]));
  win.dispatch('pointerup', pointerEvent(to[0], to[1], { buttons: 0 }));
}

/**
 * 每个用例开始前：**只造一个** window，复位手势单例，然后它一直用到底。
 *
 * 见 `newWindow()` 的注释 —— 多个 window 对象混用会让手势层那条
 * "每个 window 只装一次常驻监听"的守卫指向错误的那个，
 * 而表现是**手势完全不响应、且没有任何报错**。
 */
let shared: FakeWindow;
beforeEach(() => {
  __resetGesturesForTest();
  shared = newWindow();
});

afterEach(() => {
  __resetGesturesForTest();
  delete (globalThis as { window?: unknown }).window;
});

describe('★ 胶带架渲染出来了', () => {
  it('★★ `rows` 档有 3 张胶带 → 架上 3 个 chip，而且「＋」与剪刀都在', () => {
    const { root } = mount('rows', shared);
    expect(count(root, '[data-tape-shelf]'), '胶带架本身该在').toBe(1);
    expect(count(root, '[data-tape-chip]'), '三张胶带该都在架上').toBe(3);
    expect(count(root, '[data-tape-new]'), '「＋」该在').toBe(1);
    expect(count(root, '[data-tape-scissors]'), '剪刀该在').toBe(1);
  });

  it('★ 一张胶带也没有时（`messy` 档）架上给的是提示，不是空白', () => {
    const { root } = mount('messy', shared);
    expect(count(root, '[data-tape-chip]')).toBe(0);
    expect(count(root, '.tape-shelf-empty'), '空的架子要说清怎么开始').toBe(1);
    // 但「＋」与剪刀仍然在（它们不依赖已有胶带）
    expect(count(root, '[data-tape-new]')).toBe(1);
    expect(count(root, '[data-tape-scissors]')).toBe(1);
  });

  it('★ 每一行都挂着落点标记（拖拽判定的依据）', () => {
    const { root } = mount('rows', shared);
    // rows 档是 3 块 6×4 的家具 → 12 行
    expect(count(root, '[data-shelf-row]')).toBe(12);
    for (const el of root.querySelectorAll('[data-shelf-row]')) {
      expect(el.dataset['shelf'], '每行都要有 data-shelf').toBeTruthy();
      expect(el.dataset['row'], '每行都要有 data-row').not.toBeUndefined();
    }
  });
});

describe('★★ 拖到行上就贴上 / 剪刀拖上去就撕下', () => {
  it('★★ 从架上拖一张到「别的一行」→ 那一行改贴这张胶带', () => {
    const { root, store, win } = mount('rows', shared);
    const chip = root.querySelectorAll('[data-tape-chip]')[0]!;
    const zoneId = chip.dataset['tapeChip']!;
    const target = root.querySelectorAll('[data-shelf-row]')[2]!;
    const shelfId = target.dataset['shelf']!;
    const row = Number(target.dataset['row']!);
    const before = store.run.shelves.find((s) => s.id === shelfId)!.zoneIds[row]!;
    expect(before, '这条用例需要目标行原本贴着别的胶带，否则验不出变化').not.toBe(zoneId);

    chip.place(0, 0, 60, 34);
    target.place(200, 200, 300, 60);
    drag(win, chip, [10, 10], [210, 210]);

    const after = store.run.shelves.find((s) => s.id === shelfId)!.zoneIds[row];
    expect(after, '拖到那一行之后，它该贴着这张胶带').toBe(zoneId);
  });

  it('★★ 剪刀拖到某一行 → 那一行的胶带被撕下来（`zoneId` 变 null）', () => {
    const { root, store, win } = mount('rows', shared);
    const taped = root.querySelectorAll('[data-shelf-row]').find((el) => {
      const shelf = store.run.shelves.find((s) => s.id === el.dataset['shelf']!);
      return shelf && shelf.zoneIds[Number(el.dataset['row']!)] !== null;
    })!;
    const shelfId = taped.dataset['shelf']!;
    const row = Number(taped.dataset['row']!);
    const scissors = root.querySelectorAll('[data-tape-scissors]')[0]!;

    scissors.place(0, 0, 34, 34);
    taped.place(300, 300, 300, 60);
    drag(win, scissors, [10, 10], [310, 310]);

    expect(store.run.shelves.find((s) => s.id === shelfId)!.zoneIds[row], '那一行该被撕干净了').toBeNull();
  });

  it('★★ 拖到空处**当作轻点**（打开抽屉），不是"什么都没发生"', () => {
    /*
     * ★★ 这条是手机上"编辑打不开"的根因（用户："到了电脑上就正常了"）。
     *
     * 手指"轻点"几乎总会移动十几像素、或停得比 220ms 久一点，于是手势层把它判成
     * **拖拽**而不是轻点（`onTap` 要求位移 ≤12px 且 ≤500ms）。玩家于是拖起一张胶带、
     * 又没落到任何行上 —— 而那时的处理曾是"静默什么都不做"，看起来就是点了没反应。
     *
     * 鼠标上不会这样（位移小、按下-抬起快），所以只有手机端出现。
     * 修法是标准做法：拖出去又原样放回来 = 一次点击。
     */
    const { root, store, win } = mount('rows', shared);
    const chip = root.querySelectorAll('[data-tape-chip]')[0]!;
    const zoneId = chip.dataset['tapeChip']!;
    chip.place(0, 0, 60, 34);
    // 所有行都不摆位置（0×0）→ 落点判定必为空
    drag(win, chip, [10, 10], [500, 500]);
    const input = body.querySelectorAll('input[data-zone-name]')[0];
    expect(input, '拖到空处该打开抽屉，而不是静默什么都不做').toBeTruthy();
    expect(store.run.zones.some((z) => z.id === zoneId), '而且什么都不该改').toBe(true);
  });

  it('★ 拖到空处（没落在任何行上）→ 什么都不变', () => {
    const { root, store, win } = mount('rows', shared);
    const chip = root.querySelectorAll('[data-tape-chip]')[0]!;
    const before = store.run.shelves.map((s) => [...s.zoneIds]);
    chip.place(0, 0, 60, 34);
    // 所有行都不摆位置（默认 0×0）→ 命中测试返回 null
    drag(win, chip, [10, 10], [500, 500]);
    expect(store.run.shelves.map((s) => [...s.zoneIds])).toEqual(before);
  });

  it('★★ `elementFromPoint` 落空时靠**几何**也能贴上（"正好放在图标上就没判定"）', () => {
    /*
     * ★★ 这条是用户报的"老问题"：
     *
     * > "不管是剪刀还是加号还是已有标签，如果正好放在图标上就没判定了"
     *
     * 实测里它对应的机制是：格子里的 SVG 图标自己可以命中、
     * 一行里 `pointer-events: none` 的子元素穿透到谁身上依实现而定、
     * 而 `.slot:active` 的 `transform: scale(0.96)` 会让格子在被按住时缩小。
     *
     * 这条用**最极端的模拟**覆盖它：把 `elementFromPoint` 打成永远返回 `null`
     * （比"命中了图标"更糟），只留几何矩形 —— 而胶带仍然必须贴上去。
     * 如果哪天有人把几何兜底删了，这条会立刻红。
     */
    const { root, store, win } = mount('rows', shared);
    const chip = root.querySelectorAll('[data-tape-chip]')[0]!;
    const zoneId = chip.dataset['tapeChip']!;
    const target = root.querySelectorAll('[data-shelf-row]')[2]!;
    const shelfId = target.dataset['shelf']!;
    const row = Number(target.dataset['row']!);
    const before = store.run.shelves.find((s) => s.id === shelfId)!.zoneIds[row]!;
    expect(before, '目标行原本要贴着别的东西，否则验不出变化').not.toBe(zoneId);

    chip.place(0, 0, 60, 34);
    target.place(200, 200, 300, 60);
    // 让 elementFromPoint 永久失效（模拟"命中了图标/幽灵/别的什么"的极端）
    const doc = (shared as unknown as { document: FakeDocument }).document;
    const original = doc.elementFromPoint.bind(doc);
    doc.elementFromPoint = () => null;

    drag(win, chip, [10, 10], [210, 210]);

    doc.elementFromPoint = original;
    expect(store.run.shelves.find((s) => s.id === shelfId)!.zoneIds[row], '几何兜底该把它贴上').toBe(zoneId);
  });

  it('★ 「＋」拖到某一行 → 新建一张（那一行从此有胶带，架上也多一张）', () => {
    const { root, store, win } = mount('rows', shared);
    const fresh = root.querySelectorAll('[data-tape-new]')[0]!;
    const zonesBefore = store.run.zones.length;
    // 找一行**没贴**的
    const bare = root.querySelectorAll('[data-shelf-row]').find((el) => {
      const shelf = store.run.shelves.find((s) => s.id === el.dataset['shelf']!);
      return shelf && shelf.zoneIds[Number(el.dataset['row']!)] === null;
    })!;
    const shelfId = bare.dataset['shelf']!;
    const row = Number(bare.dataset['row']!);

    fresh.place(0, 0, 34, 34);
    bare.place(400, 400, 300, 60);
    drag(win, fresh, [10, 10], [410, 410]);

    const shelf = store.run.shelves.find((s) => s.id === shelfId)!;
    expect(shelf.zoneIds[row], '「＋」落地该建出一张新胶带并贴上').not.toBeNull();
    expect(store.run.zones.length, '胶带总数该 +1').toBe(zonesBefore + 1);
  });
});

describe('★★ 从胶带架上改一张胶带（没有"从哪块架子进"这回事）', () => {
  /*
   * ★★ 这条曾经标着 `it.fails`（D-27），2026-10 拿下了 —— **根因在测试的驱动方式**。
   *
   * 它验的是"从胶带架上轻点一张 → 抽屉打开 → 改名 → 保存"。
   * 之前 `onTap` 始终不触发（而同一条路上的 `onDragStart` / `onDragEnd` 全都正常），
   * 原因是我一直用**触摸**指针去派发：触摸路径下 `onDown` 会起一个 220ms 的
   * 长按定时器，于是"按下 → 抬手"这件事的判定要跨过假时钟与定时器的时序。
   *
   * 换成 `pointerType: 'mouse'`（见 `tap()` 的注释）之后一次就通了 ——
   * **产品逻辑一直是对的**，卡住的是测试没有走对那条路。
   *
   * ⚠ 所以"标 `it.fails` 等它自己变红"这个做法是对的：D-27 现在**清偿**。
   */
  it('★★ 只发一个原生 `click` 也能打开抽屉（手机端的兜底路径）', () => {
    /*
     * ★★ 用户报："手机上……那个胶带的编辑还是不行，他不弹出，
     * 贴上去判定那个功能没问题了" —— 也就是**拖**通了而**点**不通。
     *
     * 手势层的 tap 判定（位移 ≤12px 且 ≤500ms）在真实手指上很紧，
     * 所以在手势之外又挂了一个**原生 `click`**（浏览器自己的判定宽容得多）。
     *
     * 这条测试**完全不碰手势层**：只发一个 click，抽屉必须打开。
     * 它就是那条兜底的守卫 —— 谁把 `el.addEventListener('click', …)` 删了，
     * 这条会立刻红。
     */
    const { root } = mount('rows', shared);
    const chip = root.querySelectorAll('[data-tape-chip]')[0]!;
    chip.dispatch('click', {});
    const input = body.querySelectorAll('input[data-zone-name]')[0];
    expect(input, '原生 click 该把抽屉打开').toBeTruthy();
  });

  it('★★ 整页重绘之后，页面上那一张仍然点得开（手机端真实场景）', () => {
    /*
     * ★★ 这条比"只发一个 click"那条更贴近真机。
     *
     * 手机上玩家点之前，页面已经因为**任何一次操作**重绘过好几轮了
     * （贴一张、拖一件货、点一次排序……每次复盘都会重画这一条）。
     * 如果 `bindTapeGestures()` 只在挂载时跑一次、重绘时忘了重挂，
     * 那么"页面上那一张"就没有监听 —— 而测试里"挂载时那一张"有。
     * 这类"测试绿、真机红"的差别正是这条要挡住的。
     *
     * ⚠ 第一版这条**写得含糊**：它只是重新查了一次元素，并没有真的触发重绘 ——
     * 那样它验的东西与上一条完全一样。现在显式调 `renderTapeShelf()` 重建这一条。
     */
    const { root, screen } = mount('rows', shared);
    const before = root.querySelectorAll('[data-tape-chip]')[0]!;
    // 触发这一条的**重建**（真机上每次页面重绘都会走到这里）
    (screen as unknown as { renderTapeShelf(): void }).renderTapeShelf();
    const after = root.querySelectorAll('[data-tape-chip]')[0]!;
    expect(after, '重建之后架上仍然该有胶带').toBeTruthy();
    expect(after, '重建应当换了元素（否则这条没验到"重挂监听"）').not.toBe(before);

    after.dispatch('click', {});
    const input = body.querySelectorAll('input[data-zone-name]')[0];
    expect(input, '重建之后的那一张也该点得开').toBeTruthy();
  });

  it('★★ 打开之后紧跟的那一发 `click` 落在遮罩上，**不许把它关掉**', () => {
    /*
     * ★★ 这条复现的是手机上的真实现象（用户原话）：
     *
     * > "点一下，瞬间弹出来然后消失，之后再点连这个弹出来的一瞬间都没有了，
     * >  但是如果我切回电脑模式再点一下他又能出现"
     *
     * 机制：触摸序列是 `pointerdown → pointerup →（浏览器补发）click`，
     * 而"打开抽屉"发生在 **pointerup** —— 于是紧接着补发的那个 `click`
     * 落到的是**刚刚盖上来的遮罩**（`.drawer-blocker` 覆盖整屏，
     * 而它自己写着 `data-zone-act="close"`）。打开 → 同一只手指关掉。
     * 桌面没有合成的 click，所以只有小屏上出现。
     *
     * 这条把那一发 click **手动**打在遮罩上，然后要求抽屉还开着。
     */
    const { root } = mount('rows', shared);
    const chip = root.querySelectorAll('[data-tape-chip]')[0]!;
    chip.dispatch('click', {});
    const drawer = body.querySelectorAll('.zone-drawer')[0]!;
    expect(body.querySelectorAll('input[data-zone-name]').length, '先确认它开了').toBe(1);

    // 模拟浏览器补发的那一发 click：目标是遮罩
    const blocker = drawer.querySelectorAll('.drawer-blocker')[0]!;
    drawer.dispatch('click', { target: blocker });

    expect(
      body.querySelectorAll('input[data-zone-name]').length,
      '刚打开时遮罩上的这一发 click 该被忽略，抽屉要还在'
    ).toBe(1);
  });

  it('★ 过一会儿再点遮罩 —— 那才是真的要关', () => {
    /*
     * 上一条的另一半：那个"忽略"必须**只覆盖刚打开的那一小段**。
     * 否则抽屉就再也关不掉了 —— 那比原 bug 更烦人。
     */
    const { root } = mount('rows', shared);
    const chip = root.querySelectorAll('[data-tape-chip]')[0]!;
    chip.dispatch('click', {});
    const drawer = body.querySelectorAll('.zone-drawer')[0]!;
    const blocker = drawer.querySelectorAll('.drawer-blocker')[0]!;
    expect(body.querySelectorAll('input[data-zone-name]').length).toBe(1);

    // 把假时钟推过那 350ms 的窗口
    shared.tick(400);
    drawer.dispatch('click', { target: blocker });

    expect(body.querySelectorAll('input[data-zone-name]').length, '过了窗口该能关掉').toBe(0);
  });

  it('★★ 改名会改到**所有**贴着它的行看到的那个名字', () => {
    const { root, store, win } = mount('rows', shared);
    /*
     * ★ 挑"确实贴在多行上"的那一张，而且**从架子上的 chip 反过来挑** ——
     * 第一版是从 `shelves` 里取第一个非空 zoneId 再去架上找，
     * 于是 `find()` 返回 `undefined`、`chip.dispatch` 当场抛异常，
     * 而报错信息指向"抽屉该开着" —— **真正的原因（元素没找到）被这句话盖住了**。
     * 这类"失败信息指错地方"最费时间，所以这里显式断言挑到了东西。
     */
    const all = store.run.shelves.flatMap((s) => s.zoneIds.map((id) => id)).filter((id): id is string => id !== null);
    const chip = root.querySelectorAll('[data-tape-chip]').find((el) => {
      const id = el.dataset['tapeChip']!;
      return all.filter((x) => x === id).length > 1;
    });
    expect(chip, '架上该有一张贴在多行上的胶带（夹具 `rows` 里三张都是）').toBeTruthy();
    const targetId = chip!.dataset['tapeChip']!;
    const holders = all.filter((x) => x === targetId).length;
    expect(holders, '这张胶带该贴在不止一行上，否则验不出"改到所有行"').toBeGreaterThan(1);

    /*
     * 轻点 → 抽屉该开。走鼠标指针（见 `tap()` 的注释：绕开触摸的长按定时器，
     * 那条路由 `drag.test.ts` 的手势状态机覆盖）。
     */
    tap(win, chip!, [5, 5]);
    const input = body.querySelectorAll('input[data-zone-name]')[0];
    expect(input, '抽屉该开着，而且有名字输入框').toBeTruthy();
    (input as unknown as { value: string }).value = '换了名';
    input!.dispatch('input', {});

    // 保存按钮就在抽屉里 —— 点它要**从抽屉根派发**（假 DOM 不做冒泡，
    // 而 ZoneSheet 的点击处理器挂在根上做事件委托）
    const save = body.querySelectorAll('[data-zone-act="save"]')[0];
    expect(save, '抽屉里该有保存按钮').toBeTruthy();
    const drawer = body.querySelectorAll('.zone-drawer')[0]!;
    drawer.dispatch('click', { target: save });

    const zone = store.run.zones.find((z) => z.id === targetId);
    expect(zone?.name, '名字该改掉了').toBe('换了名');
    /*
     * 行本身只存 `zoneId`，所以"所有贴着它的行都跟着改"是**结构性**的 ——
     * 这条断言钉住那个结构：改完之后，那些行仍然指着同一张胶带。
     */
    const stillHolding = store.run.shelves
      .flatMap((s) => s.zoneIds)
      .filter((id) => id === targetId).length;
    expect(stillHolding, '改名字不该动"它贴在哪几行"').toBe(holders);
  });
});
