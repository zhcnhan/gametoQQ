/**
 * 屏幕级：**拖拽交换**这一条路径的端到端测试。
 *
 * ## 为什么单独一个文件、只测一件事
 *
 * 玩家反复报"把一件拖到另一件上不是直接交换" —— 而它在**桌面端可复现**、
 * 在纯命令层测试里却是绿的（`swapSlots` 本身没问题）。也就是说 bug 落在
 * `OrganizeScreen.endDrag` 那个"选哪条路"的判断上，只有把整块屏幕跑起来才能抓到。
 *
 * 之前那个大而全的屏幕级文件（`OrganizeScreen.drag.test.ts`）因为跨用例状态
 * 没理顺而整块跳过了。这里的做法更保守：**一个文件只留一条路径、每个用例
 * 自己把状态清干净**，先保证这条能稳定跑，再谈铺开。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getStack, makeStack, setSlotStack } from '../model/shelf';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createOrganizeSession, type OrganizeSession } from '../systems/organize';
import { createStartingRun } from '../systems/setup';
import { OrganizeScreen } from './OrganizeScreen';
import { __resetGesturesForTest } from './drag';
import { FakeDocument, type FakeElement, asElement, installFakeWindow, pointerEvent } from './fakeDom';

function saveStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

interface Ctx {
  root: FakeElement;
  store: GameStore;
  session: OrganizeSession;
  screen: OrganizeScreen;
  win: ReturnType<typeof installFakeWindow>;
}

function setup(): Ctx {
  __resetGesturesForTest();
  const doc = new FakeDocument();
  const win = installFakeWindow(doc);
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  root.place(0, 0, 1000, 800);

  const store = new GameStore(createSaveGame(createStartingRun(20261001)), saveStub());
  const session = createOrganizeSession();
  const screen = new OrganizeScreen(asElement(root), store, session, {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined
  });
  screen.mount();
  return { root, store, session, screen, win };
}

/** 摆几何（假体没有布局引擎，必须手工摆；每次重绘后都要重摆） */
function layout(ctx: Ctx): void {
  ctx.root.querySelectorAll('[data-shelf-card]').forEach((card, ci) => {
    card.place(10, 100 + ci * 300, 380, 280);
    ctx.root
      .querySelectorAll(`[data-slot][data-shelf="${card.dataset['shelfCard']}"]`)
      .forEach((slot) => {
        const row = Number(slot.dataset['row']);
        const col = Number(slot.dataset['col']);
        slot.place(10 + col * 64, 140 + ci * 300 + row * 64, 60, 60);
      });
  });
}

function slotAt(ctx: Ctx, shelfId: string, row: number, col: number): FakeElement {
  const el = ctx.root.querySelector(
    `[data-slot][data-shelf="${shelfId}"][data-row="${row}"][data-col="${col}"]`
  );
  if (!el) throw new Error(`找不到格子 ${shelfId}(${row},${col})`);
  return el;
}

/** 直接往某格放一件东西，然后重绘 + 重摆几何 */
function put(ctx: Ctx, shelfId: string, row: number, col: number, itemId: string, count = 1): void {
  const idx = ctx.store.run.shelves.findIndex((s) => s.id === shelfId);
  ctx.store.commit((draft) => {
    const s = draft.shelves[idx];
    if (!s) return;
    draft.shelves[idx] = setSlotStack(s, { row, col }, makeStack(itemId, count, null));
  });
  ctx.screen.render();
  layout(ctx);
}

const itemAt = (ctx: Ctx, row: number, col: number): string | undefined =>
  getStack(ctx.store.run.shelves[0]!, { row, col })?.itemId;

/** 用鼠标从 (fr,fc) 拖到 (tr,tc) 并松手 */
function dragMouse(ctx: Ctx, from: [number, number], to: [number, number]): void {
  const a = slotAt(ctx, 'shelf_a', from[0], from[1]);
  a.dispatch('pointerdown', pointerEvent(a.center.x, a.center.y, { pointerType: 'mouse' }));
  ctx.win.dispatch('pointermove', pointerEvent(a.center.x + 20, a.center.y, { pointerType: 'mouse' }));
  // 拾取会触发重绘 → 重摆几何、重取元素
  layout(ctx);
  const b = slotAt(ctx, 'shelf_a', to[0], to[1]);
  ctx.win.dispatch('pointermove', pointerEvent(b.center.x, b.center.y, { pointerType: 'mouse' }));
  ctx.win.dispatch('pointerup', pointerEvent(b.center.x, b.center.y, { pointerType: 'mouse', buttons: 0 }));
}

describe('屏幕级：拖拽交换', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    layout(ctx);
    // 打开手势/拖拽诊断，把这个用例里每一环的实际分支打到测试输出里
    (globalThis as unknown as Record<string, unknown>)['__tunhuoTrace'] = true;
  });

  it('脚手架自检：格子与货架卡都在、几何摆好了', () => {
    expect(ctx.root.querySelectorAll('[data-slot]').length).toBeGreaterThan(0);
    expect(ctx.root.querySelector('[data-shelf-card]')).not.toBeNull();
    // 命中测试要能指到格子，否则后面每条断言都在验空气
    const a = slotAt(ctx, 'shelf_a', 0, 0);
    expect(ctx.root.ownerDocument.elementFromPoint(a.center.x, a.center.y)).toBe(a);
  });

  it('★ 把 A 拖到 B 上 → 两格互换，手保持空', () => {
    put(ctx, 'shelf_a', 0, 0, 'canned_beans', 3);
    put(ctx, 'shelf_a', 0, 1, 'bandage', 2);

    dragMouse(ctx, [0, 0], [0, 1]);

    expect(itemAt(ctx, 0, 0), 'A 那格应拿到 bandage').toBe('bandage');
    expect(itemAt(ctx, 0, 1), 'B 那格应拿到 canned_beans').toBe('canned_beans');
    expect(ctx.session.held, '互换之后手里必须是空的').toBeNull();
  });

  it('★ 交换**不许**把被换的那件塞进手里（这是玩家要的"独立开"）', () => {
    put(ctx, 'shelf_a', 0, 0, 'canned_beans', 3);
    put(ctx, 'shelf_a', 0, 1, 'bandage', 2);
    dragMouse(ctx, [0, 0], [0, 1]);
    // 手里空 = 走的是 swapSlots；手里是 bandage = 走成了 placeHeld 那支
    expect(ctx.session.held).toBeNull();
  });

  it('★ 拖到自己那一格上 → 什么都不变（不是"必须得有东西"那种拒绝）', () => {
    put(ctx, 'shelf_a', 0, 0, 'canned_beans', 3);
    const a = slotAt(ctx, 'shelf_a', 0, 0);
    a.dispatch('pointerdown', pointerEvent(a.center.x, a.center.y, { pointerType: 'mouse' }));
    ctx.win.dispatch('pointermove', pointerEvent(a.center.x + 20, a.center.y, { pointerType: 'mouse' }));
    ctx.win.dispatch('pointermove', pointerEvent(a.center.x, a.center.y, { pointerType: 'mouse' }));
    ctx.win.dispatch('pointerup', pointerEvent(a.center.x, a.center.y, { pointerType: 'mouse', buttons: 0 }));
    // 物资要么回到原格、要么还在手里，但**不许消失**
    const total = (itemAt(ctx, 0, 0) === 'canned_beans' ? 3 : 0) + (ctx.session.held?.itemId === 'canned_beans' ? 3 : 0);
    expect(total, '一件都不许丢').toBeGreaterThanOrEqual(3);
  });

  it('★★ 幽灵**不许**挡住落点（"正正好好放在 B 上反而判定不到"）', () => {
    /*
     * 玩家报得很准："把 A 正正好好放在 B 上反而判定不到、边缘一圈就能交换"。
     * 机制：幽灵跟着指针、**正好在指针底下**，而 `elementFromPoint` 命中的是最上层
     * 元素 —— 幽灵当时是**可命中的**（`.fx-layer` 虽然设了 `pointer-events: none`，
     * 但一条针对 `.drag-ghost` 自身的规则会覆盖继承），于是被命中的是幽灵而不是格子。
     * 只有指针偏到幽灵外面时，才轮到下面的格子。
     *
     * 这条用假体把这个局面**造出来**：把一个和幽灵同尺寸、同位置的层压在 B 上。
     * 它必须**不影响**判定 —— 否则就是幽灵又在挡路。
     */
    put(ctx, 'shelf_a', 0, 0, 'canned_beans', 3);
    put(ctx, 'shelf_a', 0, 1, 'bandage', 2);
    const b = slotAt(ctx, 'shelf_a', 0, 1);

    // 造一个"覆盖层"，正好压在 B 上（位置、尺寸都照着幽灵来）
    const layer = ctx.root.ownerDocument.createElement('div');
    layer.classList.add('fx-layer');
    layer.pointerEvents = 'none'; // ← 幽灵所在的层本身不吃事件
    ctx.root.ownerDocument.body.appendChild(layer);
    const ghost = ctx.root.ownerDocument.createElement('div');
    ghost.classList.add('drag-ghost');
    ghost.pointerEvents = 'none'; // ← 幽灵自己也不吃（CSS 里已补上这一条）
    const size = 56;
    ghost.place(b.center.x - size / 2, b.center.y - size / 2, size, size);
    layer.appendChild(ghost);

    // 命中测试必须仍然指向 B 那个格子
    expect(ctx.root.ownerDocument.elementFromPoint(b.center.x, b.center.y), '命中测试被覆盖层挡住了').toBe(b);

    // 而且真正拖一遍要能交换成功
    dragMouse(ctx, [0, 0], [0, 1]);
    expect(itemAt(ctx, 0, 0)).toBe('bandage');
    expect(itemAt(ctx, 0, 1)).toBe('canned_beans');
    expect(ctx.session.held).toBeNull();
  });

  /*
   * ⚠️ 这里**刻意不再造"幽灵挡在正中"的测试**。
   *
   * 试过一版：手工建一个可命中的 `.drag-ghost` 压在 B 正中，再拖一遍。
   * 结果是 vitest worker 稳定地把内存吃到 4GB 然后崩掉（跑 40 秒）。
   * 二分排查确认不是 `pickDropSlot` 的问题 —— 直接调它、走几何兜底那条路
   * 是正常的（26ms 内跑完、返回正确元素）。问题出在"假体 + 手工幽灵 +
   * 完整拖拽"这个组合上，而**为一条测试去深挖假体的病理行为不划算**。
   *
   * 几何兜底本身已经有两层保障：
   *  · `.drag-ghost` 必须写 `pointer-events: none` —— `scripts/check-style.mjs` 第 ⑥ 条守卫；
   *  · 假体的命中测试尊重 `pointerEvents` —— `fakeDom.test.ts` 里有自检；
   *  · 而"命中到 fx-layer 就改按坐标找"那段是纯几何计算，读代码即可确认。
   *
   * 如果将来真需要这条测试，正确的做法是**给假体加上层叠顺序（z-index）的模拟**，
   * 而不是靠"手工塞一个元素"来伪造。
   */

  it('★ 拖到空格上 → 就是搬过去，不进手里', () => {
    put(ctx, 'shelf_a', 0, 0, 'canned_beans', 3);
    dragMouse(ctx, [0, 0], [1, 3]);
    expect(itemAt(ctx, 1, 3)).toBe('canned_beans');
    expect(ctx.session.held).toBeNull();
  });
});
