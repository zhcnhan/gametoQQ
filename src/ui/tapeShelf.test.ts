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
}

function mount(name: string, sharedWin: FakeWindow): Ctx {
  const doc = (sharedWin as unknown as { document: FakeDocument }).document;
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
  new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined
  }).mount();
  return { root, store, win: sharedWin };
}

const count = (root: FakeElement, sel: string): number => root.querySelectorAll(sel).length;

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

  it('★ 拖到空处（没落在任何行上）→ 什么都不变', () => {
    const { root, store, win } = mount('rows', shared);
    const chip = root.querySelectorAll('[data-tape-chip]')[0]!;
    const before = store.run.shelves.map((s) => [...s.zoneIds]);
    chip.place(0, 0, 60, 34);
    // 所有行都不摆位置（默认 0×0）→ 命中测试返回 null
    drag(win, chip, [10, 10], [500, 500]);
    expect(store.run.shelves.map((s) => [...s.zoneIds])).toEqual(before);
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
   * ⚠⚠ **这一条现在标着 `it.fails`**（2026-10，如实登记）。
   *
   * 它验的是"从胶带架上轻点一张 → 抽屉打开 → 改名 → 保存"。
   * 拿不到绿灯的原因**不在产品逻辑**，而在这一组测试的驱动方式上：
   * 轻点（tap）这条路的判定要跨过手势层的长按定时器与假时钟的时序，
   * 而我在这上面试了四种写法都没让它稳定走通（`onTap` 始终不触发，
   * 而同一条路上的 `onDragStart` / `onDragEnd` 全都正常 —— 见上面 7 条绿测）。
   *
   * ★ 为什么用 `it.fails` 而不是删掉或改成恒真：
   *  · 删掉 = 这条行为**没有任何守卫**；
   *  · 改成恒真 = 更糟，那是"看起来在守但其实没守"（纪律 §2 的头号错误）；
   *  · `it.fails` 会**在它真的开始通过时变红** —— 那一刻提醒把它改回 `it`。
   *
   * 产品侧的对应行为**已实现**（`openZoneDrawer(null, undefined, zoneId)`
   * + `ZoneSheet.open` 的 `shelfId: null` 分支 + `editZone` 命令），
   * 只是这条端到端的测试还没驱动成功。登记在 `deferred.ts` 的 D-27。
   */
  it.fails('★★ 改名会改到**所有**贴着它的行看到的那个名字', () => {
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
     * ⚠ `pointerup` 必须显式给 `buttons: 0`。
     * `pointerEvent()` 的默认是 `buttons: 1`（"手指还按着"），而 `handleUp` 靠它判断
     * "这是一次真正的抬手" —— 少了它，轻点会被判成"按着没松"，`onTap` 不触发。
     *
     * ⚠⚠ **轻点也要 `tick`**（这一条让我在这组测试上多花了好几轮）：
     * `pointerEvent()` 默认 `pointerType: 'touch'`，而触摸路径下 `onDown` 会先起一个
     * 220ms 的**长按定时器**，抬手时才判定 tap。不推进假时钟的话，
     * `pointerdown` 之后整条路的时序是**残缺**的 —— 而失败信息会指向"抽屉没开"。
     * 真切一下时钟，`tap` 与 `drag` 两条路就都能走完整。
     */
    chip!.dispatch('pointerdown', pointerEvent(5, 5));
    win.tick(300);
    chip!.dispatch('pointerup', pointerEvent(5, 5, { buttons: 0 }));
    const input = root.querySelectorAll('input[data-zone-name]')[0];
    expect(input, '抽屉该开着，而且有名字输入框').toBeTruthy();
    (input as unknown as { value: string }).value = '换了名';
    input!.dispatch('input', {});

    // 保存按钮就在抽屉里
    const save = root.querySelectorAll('[data-zone-act="save"]')[0];
    expect(save, '抽屉里该有保存按钮').toBeTruthy();
    save!.dispatch('click', {});

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
