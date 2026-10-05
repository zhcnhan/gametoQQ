/*
 * ★★ 吸附偏好（W-02，2026-10）：指针附近**有清单收它的那一行**时，吸到那一行去。
 *
 * ## 这一份为什么是"屏幕级"的
 *
 * `pickSnapCandidate` 是纯函数，规则本身在 `systems/organize.test.ts` 里验完了。
 * 这里验的是**接线**：真实的货架与胶带、真实的指针轨迹、真实的吸附标记。
 * 三件事只有在这一层才可能坏：
 *
 *  1. `nearestLegalSlot` 里那句"这一行是哪张胶带"算错了（`zoneListedFor` 查错表、
 *     胶带被找成 `null`）—— 纯函数全绿也照样是"偏好永不生效"；
 *  2. ♥ **半径与真实几何对不上**（本文件上线时抓到的就是这个）：第一版半径 26px，
 *     而 60px 的格子、3px 的缝意味着"最近的格心"永远在 31.5px 以内 ——
 *     26px 的偏好在整张盘面上**一次都触发不了**。见 `systems/organize.ts` 里那张表；
 *  3. ★ `data-snap` 这个标记的**存活范围**：它由 `nearestLegalSlot` 每帧重打、
 *     在同一函数开头抹掉上一帧的。第一版把"抹掉"挂在 `clearHover()` 里，
 *     而 `clearHover()` 是在判定**之后**被调用的 —— 于是它删掉的正是这一帧刚打的
 *     标记：屏幕上 `is-hover-snap` 加得上（那是提前读出来的布尔值），
 *     `data-snap` 却永远查不到。这条只有跑真实帧序才看得见。
 *
 *  4. 还有一条只有这一层能发现的：`moveDrag` 里"落点没变就提前 return"配上
 *     **跨手势残留的 `hoverEl`**，会让"按下就拖到某处然后停住"这种最自然的操作
 *     第一次落点永远不亮（修在 `beginDrag` 里那句 `clearHover()`）。
 *
 * ★ 反证过：把 `nearestLegalSlot` 里的 `zoneListedFor(zone, itemDef)` 换成 `false`
 * （即退回改动前的"只取最近"），下面那条 ★★ 会当场红（`2,1` 变成 `1,1`）。
 *
 * ⚠ 假体没有布局引擎：每次重绘都要重摆几何（`layout`），否则所有格子的矩形都是 0。
 *
 * ## 指针为什么要落在**缝里**（第一版全红的原因）
 *
 * `nearestLegalSlot`（"最近的合法落点"）只在**指针在货架卡里、却不在任何格子上**时
 * 才会被调用：指针正下方有格子时走的是"精确命中"那条路（那是玩家明确指着某一格）。
 * 所以指针必须落在**两行之间的缝**里，否则"偏好"这段代码一次都跑不到。
 * 第一版把指针放在格心，于是所有断言都在验那条与偏好无关的路。
 *
 * ## 取样点是从几何里算出来的（不要凭感觉改）
 *
 * 格子 60×60、间距 64，`layout` 把 `shelf_a` 的 (row,col) 摆成
 * 左上角 `(10 + 64·col, 140 + 64·row)`，所以格心 = `(40 + 64·col, 170 + 64·row)`；
 * 格子占 `[row·64+140, row·64+200)`，行与行之间只有 **4px** 的缝（44..47 那一带）。
 *
 * | 常量 | 位置 | 命中格子？ | 第 1 行格心 | 第 2 行格心 |
 * | --- | --- | --- | --- | --- |
 * | `EXACT` (104,234) | (1,1) 正中间 | (1,1)（精确命中） | 0 | 64 |
 * | `ROW_GAP` (104,265) | 第 1/2 行之间的缝、偏上 1px | 无 | **31.0** | 33.0 |
 * | `FAR_TAPE` (104,202) | 第 0/1 行之间的缝 | 无 | **32.0**（第 1 行） | 96（第 2 行） |
 *
 * ★ `ROW_GAP` 就是 W-02 唯一"看得见"的地方，而且**只有 2px 宽**：
 * y=265 时第 1 行 31.0 险胜第 2 行 33.0，y=267 就反过来了。
 * 这不是测试写窄了 —— 那是这张盘面的真实几何：行与行只隔 4px，
 * 所以"清单收它的那一行"能替玩家做的决定，本来就只发生在
 * "指针正压在某一行的边上"这种模棱两可的时刻（这正是设计要的克制）。
 * `FAR_TAPE` 则用来验**反方向**：贴了胶带的那一行在半径**外**时，
 * 它再"该收"也不许把落点从更近的那一行抢走。
 *
 * ⚠ 这里**不能**用"卡底死区"来验半径外：卡是 380×280，而四行格子纵向占到
 * y=392 —— 末行比卡片本身还低，所以"在卡里、又在所有格子下面"的点根本不存在
 * （第一版取 `y=397`，那是**卡外**，`pickDropSlot` 直接走第 ④ 段返回 null）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeStack, setSlotStack } from '../model/shelf';
import type { ZoneInput } from '../systems/organize';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { applyZone, createOrganizeSession, type OrganizeSession } from '../systems/organize';
import { createStartingRun } from '../systems/setup';
import { OrganizeScreen } from './OrganizeScreen';
import { __resetGesturesForTest } from './drag';
import { FakeDocument, asElement, installFakeWindow, pointerEvent, type FakeElement } from './fakeDom';

/** 第 1/2 行之间的缝、偏上 1px：离 (1,1) 31.0px（半径内）、离 (2,1) 33.0px */
const ROW_GAP: readonly [number, number] = [104, 265];
/**
 * 第 0/1 行之间的缝（偏下 1px）：第 1 行离 **31.0px**、第 0 行离 33.0px，
 * 两者都在半径内，而贴了胶带的第 2 行离 **94px**（半径外）——
 * 用来验"半径外的清单行再该收也不许抢"。
 */
const FAR_TAPE: readonly [number, number] = [104, 203];
/** (1,1) 的正中间 —— 验"精确命中那条路不走吸附" */
const EXACT: readonly [number, number] = [104, 234];

function saveStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

interface Ctx {
  store: GameStore;
  session: OrganizeSession;
  screen: OrganizeScreen;
  root: FakeElement;
  win: ReturnType<typeof installFakeWindow>;
}

function setup(): Ctx {
  __resetGesturesForTest();
  const doc = new FakeDocument();
  const win = installFakeWindow(doc);
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  root.place(0, 0, 1000, 900);

  const store = new GameStore(createSaveGame(createStartingRun(20261001)), saveStub());
  const session = createOrganizeSession();
  const screen = new OrganizeScreen(asElement(root), store, session, {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined,
        onBackToSurvival: () => undefined
  });
  screen.mount();
  const ctx = { store, session, screen, root, win };
  layout(ctx);
  return ctx;
}

/** 摆几何：每块货架一张卡，卡里格子按 60×60、间距 64 排开（假体不布局） */
function layout(ctx: Ctx): void {
  ctx.root.querySelectorAll('[data-shelf-card]').forEach((card, ci) => {
    card.place(10, 100 + ci * 300, 380, 280);
    ctx.root
      .querySelectorAll(`[data-slot][data-shelf="${card.dataset['shelfCard']}"]`)
      .forEach((slot) => {
        slot.place(
          10 + Number(slot.dataset['col']) * 64,
          140 + ci * 300 + Number(slot.dataset['row']) * 64,
          60,
          60
        );
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

/** 往某格放一件（开局货架是空的，所以这是唯一的"有东西"的来源） */
function put(ctx: Ctx, shelfId: string, row: number, col: number, itemId: string, count = 2): void {
  const idx = ctx.store.run.shelves.findIndex((s) => s.id === shelfId);
  ctx.store.commit((draft) => {
    const s = draft.shelves[idx];
    if (!s) return;
    draft.shelves[idx] = setSlotStack(s, { row, col }, makeStack(itemId, count, null));
  });
  ctx.screen.render();
  layout(ctx);
}

/** 给**某一行**贴一张胶带（`ZoneInput` 用 `applyZone`，与玩家操作同一条路） */
function tapeRow(ctx: Ctx, shelfId: string, row: number, input: Omit<ZoneInput, 'color'>): void {
  const r = applyZone(ctx.store, shelfId, { color: '#8a8a80', rows: [row], ...input });
  if (!r.ok) throw new Error(`贴胶带失败：${JSON.stringify(r.events)}`);
  ctx.screen.render();
  layout(ctx);
}

interface DragResult {
  /** 被打了 `data-snap="1"` 的那一格（= 走的"吸附"那条路） */
  snapped: FakeElement | null;
  /** 悬停高亮的格子（精确命中或吸附都会亮） */
  hover: FakeElement | null;
}

/** 从 `from` 拿起，拖到 `near`，返回吸附标记与悬停格 */
function drag(ctx: Ctx, from: readonly [number, number], near: readonly [number, number]): DragResult {
  const a = slotAt(ctx, 'shelf_a', from[0], from[1]);
  a.dispatch('pointerdown', pointerEvent(a.center.x, a.center.y, { pointerType: 'mouse' }));
  // 第一段移动只负责"越过 6px 阈值、开始拖"；拾取也发生在这一段
  ctx.win.dispatch('pointermove', pointerEvent(a.center.x + 20, a.center.y, { pointerType: 'mouse' }));
  layout(ctx);
  ctx.win.dispatch('pointermove', pointerEvent(near[0], near[1], { pointerType: 'mouse' }));
  const marked = ctx.root.querySelectorAll('[data-snap="1"]');
  return {
    snapped: marked[0] ?? null,
    hover: ctx.root.querySelector('.is-hover, .is-hover-snap, .is-hover-swap')
  };
}

const rc = (el: FakeElement | null): string | undefined =>
  el === null ? undefined : `${el.dataset['row']},${el.dataset['col']}`;

describe('屏幕级：吸附优先落在"清单收它的那一行"（W-02）', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('脚手架自检：三块货架、24 格几何摆好了、取样点确实不落在任何格子上', () => {
    expect(ctx.root.querySelectorAll('[data-shelf-card]').length).toBe(3);
    expect(ctx.root.querySelectorAll('[data-slot][data-shelf="shelf_a"]').length).toBe(24);
    expect(slotAt(ctx, 'shelf_a', 0, 0).rect.width).toBe(60);
    // 这几条是整份文件的前提：取样点若被某格命中，后面的断言验的就不是偏好那条路
    const doc = ctx.root.ownerDocument;
    expect(doc.elementFromPoint(ROW_GAP[0], ROW_GAP[1])?.dataset['row']).toBeUndefined();
    expect(doc.elementFromPoint(FAR_TAPE[0], FAR_TAPE[1])?.dataset['row']).toBeUndefined();
    expect(doc.elementFromPoint(EXACT[0], EXACT[1])?.dataset['row']).toBe('1');
    // ★ 取样点还必须在**卡片里面**，否则走的是"货架之外不吸附"那条路（第 ④ 段）
    expect(doc.elementFromPoint(ROW_GAP[0], ROW_GAP[1])?.closest('[data-shelf-card]')).not.toBeNull();
    expect(doc.elementFromPoint(FAR_TAPE[0], FAR_TAPE[1])?.closest('[data-shelf-card]')).not.toBeNull();
  });

  it('拿起来之后手里真的有东西（否则后面每条断言都在验空气）', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    const a = slotAt(ctx, 'shelf_a', 0, 0);
    a.dispatch('pointerdown', pointerEvent(a.center.x, a.center.y, { pointerType: 'mouse' }));
    ctx.win.dispatch('pointermove', pointerEvent(a.center.x + 20, a.center.y, { pointerType: 'mouse' }));
    expect(ctx.session.held?.itemId).toBe('rice_bag');
    expect(ctx.session.heldFrom.kind).toBe('shelf');
  });

  it('★★ 没贴胶带 → 缝里取最近：(1,1)（这一条是下一条的对照）', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    const { snapped } = drag(ctx, [0, 0], ROW_GAP);
    expect(rc(snapped), '没胶带时就该老实取最近的那一格').toBe('1,1');
  });

  it('★★ 第 2 行贴了收主食的胶带 → **同一套指针轨迹**改吸第 2 行（那一行收它）', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    // (1,1) 31.0px 比 (2,1) 33.0px 更近 —— 但胶带在 34px 半径内，于是它赢了
    tapeRow(ctx, 'shelf_a', 2, { name: '主食', categories: ['food'] });
    const { snapped, hover } = drag(ctx, [0, 0], ROW_GAP);
    expect(rc(snapped), '清单收它的那一行要赢过"更近但没规矩"的那一行').toBe('2,1');
    expect(hover?.classList.contains('is-hover-snap'), '吸附那条路要打上记号').toBe(true);
  });

  it('★ 胶带收的是**别的**品类 → 偏好不许生效（否则等于"有胶带就乱吸"）', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    // 第 2 行收医疗品类，手里这袋米不归它管
    tapeRow(ctx, 'shelf_a', 2, { name: '医疗', categories: ['medicine'] });
    const { snapped } = drag(ctx, [0, 0], ROW_GAP);
    expect(rc(snapped), '第 2 行不收它，就该老实取最近的 (1,1)').toBe('1,1');
  });

  it('★ 胶带贴在**别的货架**上时本架不受影响（查表不许跨架）', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    tapeRow(ctx, 'shelf_b', 2, { name: '主食', categories: ['food'] });
    const { snapped } = drag(ctx, [0, 0], ROW_GAP);
    expect(rc(snapped), 'shelf_b 的胶带管不到 shelf_a').toBe('1,1');
  });

  it('★★ 清单行在半径**外**时不许抢：哪怕它收这件，也得老实取更近的那一行', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    /*
     * 取样点在第 0/1 行之间的缝里（y=203：第 0 行格子到 200、第 1 行从 204 开始）：
     * 到第 1 行格心 **31.0px**、到第 0 行 **33.0px**（两者都在 34px 半径内），
     * 而贴了胶带的第 2 行离 **94px**（半径外）—— 它收这件米，但不许抢。
     */
    tapeRow(ctx, 'shelf_a', 2, { name: '主食', categories: ['food'] });
    const { snapped } = drag(ctx, [0, 0], FAR_TAPE);
    expect(rc(snapped), '半径外的清单行不许抢走最近的格子').toBe('1,1');
  });

  it('★ 指针**正落在格子里**时走精确命中那条路：不该出现吸附标记', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    tapeRow(ctx, 'shelf_a', 2, { name: '主食', categories: ['food'] });
    const { snapped, hover } = drag(ctx, [0, 0], EXACT);
    expect(rc(snapped), '精确命中不是吸附，不该打 data-snap').toBeUndefined();
    expect(rc(hover), '精确命中的是 (1,1) 那一格').toBe('1,1');
  });

  it('★ 换了落点时旧格子的标记要被清掉（标记必须唯一）', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    tapeRow(ctx, 'shelf_a', 2, { name: '主食', categories: ['food'] });
    drag(ctx, [0, 0], ROW_GAP);
    expect(ctx.root.querySelectorAll('[data-snap="1"]').length, '那次该标一格').toBe(1);
    // 移到货架之外：不吸附，标记要清空
    ctx.win.dispatch('pointermove', pointerEvent(500, 850, { pointerType: 'mouse' }));
    expect(ctx.root.querySelectorAll('[data-snap="1"]').length).toBe(0);
  });

  it('松手之后东西真的落进那一行（不是只画个虚线框）', () => {
    put(ctx, 'shelf_a', 0, 0, 'rice_bag');
    tapeRow(ctx, 'shelf_a', 2, { name: '主食', categories: ['food'] });
    const a = slotAt(ctx, 'shelf_a', 0, 0);
    a.dispatch('pointerdown', pointerEvent(a.center.x, a.center.y, { pointerType: 'mouse' }));
    ctx.win.dispatch('pointermove', pointerEvent(a.center.x + 20, a.center.y, { pointerType: 'mouse' }));
    layout(ctx);
    ctx.win.dispatch('pointermove', pointerEvent(ROW_GAP[0], ROW_GAP[1], { pointerType: 'mouse' }));
    ctx.win.dispatch('pointerup', pointerEvent(ROW_GAP[0], ROW_GAP[1], { pointerType: 'mouse', buttons: 0 }));

    const shelf = ctx.store.run.shelves.find((s) => s.id === 'shelf_a');
    expect(shelf, 'shelf_a 应该还在').toBeDefined();
    // `Shelf.slots` 是**二维**的：`slots[row][col]`（`src/model/types.ts:562`）
    const at = (r: number, c: number) => shelf?.slots[r]?.[c] ?? null;
    expect(at(2, 1)?.stack?.itemId, '第 2 行第 1 列应该有那袋米').toBe('rice_bag');
    expect(at(0, 0)?.stack ?? null, '原位必须空出来').toBeNull();
  });
});
