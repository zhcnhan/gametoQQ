/**
 * 整理页「按房间分组」的守护测试（§10.2.4 的「搬更大的家」）。
 *
 * ## 它守的是用户报的那一屏
 *
 * > "储藏间现在就是一个横条上面写着 0/3 呢，啥用没有啊。就一个分格线"
 *
 * 他说得对。一个空房间原来只画**一条分隔线 + 一个计数**，而三件事一条都没说：
 *
 *  ① 这间房**是干什么的**；② 它**值多少**；③ 怎么**把东西放进去**。
 *
 * 而"解锁一间空房"在设计上是对的（§10.2.4：新那间空着、能放三块）——
 * 错的只是**它没说话**。所以这里不是把空房藏起来，而是钉住"它必须说话"。
 *
 * ## 为什么这条以前抓不到
 *
 * 三个老档里**一个都复现不出"空房间"**（`big-house` 的储藏间已经有一块了）。
 * 而一个复现不出来的状态没法验收、也没法写测试 —— 所以先补了
 * `save-empty-room.txt`（活过 1 次、储藏间刚解锁、还空着），才有这个文件。
 *
 * ## 假 DOM 的边界（§3.2）
 *
 * `textContent` 只填在**叶子**文本节点上，所以断言一律读叶子
 * （`.room-empty` / `.room-count`），读容器（`.room-group`）会得到空串，
 * 而那种失败看起来像"界面没渲染"。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { deserialize } from '../state/save';
import { GameStore } from '../state/store';
import { createOrganizeSession } from '../systems/organize';
import { createStartingRun } from '../systems/setup';
import { OrganizeScreen } from './OrganizeScreen';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';

/**
 * 夹具用 vitest 的 `?raw` 读，而不是 `node:fs`。
 *
 * ★ `ui/` 层不许 import `node:fs`（它是浏览器层的代码，而这一层最后要能跑在
 * 真的浏览器里）。`src/tools/saveFixtures.test.ts` 早就用过 `?raw`，
 * 而且 `.txt` 的 `?raw` 是**正常**的 —— 出问题的是 `.css`（见 §3.1）。
 */
const FIXTURES = import.meta.glob('../tools/save-*.txt', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

function fixture(name: string): string {
  const text = FIXTURES[`../tools/save-${name}.txt`];
  if (!text) throw new Error(`找不到夹具 save-${name}.txt`);
  return text;
}

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

interface Ctx {
  root: FakeElement;
}

/** 用仓库里那份 `empty-room` 夹具挂一屏（与人工走查看的是同一份数据） */
function mountFromFixture(name: string): Ctx {
  const save = deserialize(fixture(name));
  if (!save?.run) throw new Error(`夹具 save-${name} 读不出来`);
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = new GameStore(save, stubScheduler());
  new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined
  }).mount();
  return { root };
}

/** 只有一间房时的局面（手搓，用于对照） */
function mountSingleRoom(): Ctx {
  const run = createStartingRun(20261007);
  run.identityId = 'group_buyer';
  run.phase = 'organize';
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = new GameStore({ ...deserialize(fixture('good'))!, run }, stubScheduler());
  new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined
  }).mount();
  return { root };
}

const textOf = (root: FakeElement, sel: string): string =>
  root.querySelectorAll(sel).map((el) => el.textContent).join('｜');

/**
 * 房名。
 *
 * ★ `.room-title` 里有一半是**子元素**（`<span class="room-count">`），
 * 而假 DOM 的 `textContent` 只填在叶子文本节点上 —— 所以读 `.room-title`
 * 会得到一个空的 `textContent`（§3.2 的那条边界：**读容器会得到空串，
 * 而那种失败看起来像"界面没渲染"**）。
 *
 * 所以我给房名单独加了一个 `.room-label` 叶子来承载它。
 * 这不只是为了测试好写：**房名与计数是两件事**，一个给眼睛、一个给进度，
 * 分开之后样式也各自独立。
 */
const roomLabels = (root: FakeElement): string => textOf(root, '.room-label');

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('★★ 空房间必须说话（用户报的那一屏）', () => {
  it('★★ 储藏间空着时，画的是**说明**而不是一条光秃秃的分隔线', () => {
    const { root } = mountFromFixture('empty-room');
    // 两间房的标题都在（分组生效了）
    const titles = roomLabels(root);
    expect(titles).toContain('客厅');
    expect(titles, '储藏间刚解锁，标题该在').toContain('储藏间');
    // ★ 而且要有一段说明 —— 这是这条用例的全部意义
    const empty = textOf(root, '.room-empty-body');
    expect(empty.length, '空房间必须有一段说明，不能只有一条线').toBeGreaterThan(10);
  });

  it('★ 说明里要写出"能放几块"（那是玩家刚用一次通关换来的东西）', () => {
    const { root } = mountFromFixture('empty-room');
    const empty = textOf(root, '.room-empty-body');
    expect(empty, '要说清容量').toMatch(/放\s*\d+\s*块/);
    // 容量要来自房间表，不是写死的数
    expect(empty).toContain('3');
  });

  it('★ 说明里要指出下一步动作（加家具的按钮在下面）', () => {
    const { root } = mountFromFixture('empty-room');
    expect(textOf(root, '.room-empty-body'), '要说清怎么往里放东西').toContain('下面');
  });

  it('★ 两个计数都在，而且空的那间是 0/3', () => {
    const { root } = mountFromFixture('empty-room');
    const counts = textOf(root, '.room-count');
    expect(counts).toContain('3/6'); // 客厅
    expect(counts).toContain('0/3'); // 储藏间
  });
});

describe('★ 对照组：只有一间房时不分组', () => {
  it('★ 不画房名、也不画空房间说明（那一刻"客厅"没有信息量）', () => {
    const { root } = mountSingleRoom();
    expect(roomLabels(root), '一间房时不该出现房间标题').toBe('');
    expect(textOf(root, '.room-empty-body'), '也不该出现空房间说明').toBe('');
  });
});

describe('★ 有家具的房间不画空说明', () => {
  it('big-house：两间都有家具 → 没有 `.room-empty`', () => {
    const { root } = mountFromFixture('big-house');
    expect(roomLabels(root)).toContain('储藏间');
    expect(textOf(root, '.room-empty-body'), '有家具的房间不该出现"这间还空着"').toBe('');
  });
});
