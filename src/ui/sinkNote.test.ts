/*
 * ★★ 整理页那条"水位"提示（W-05 的界面那一半）。
 *
 * ## 为什么这条要单独有一份用例
 *
 * `homeSink` 让白天事件能真的吃掉玩家屋里的几排 —— 而**盘面自己说不出这件事**：
 * 一排没了之后，屏幕上只剩一块"本来就只有三排"的货架。玩家回到整理页，
 * 面对的是一个无法解释的现状（"我这块货架是几个排来着？"）。
 *
 * 这正是 §10.1A 那条铁则要禁的形状：机制生效了、数字也改了，而玩家
 * **没有可以据以察觉的东西**。所以 `run.homeSinkRows` 必须有读点，
 * 而"有读点"这件事只有渲染断言钉得住 —— 命令层算得再对，
 * 少写一行 `this.sinkNoteEl.textContent = …` 就是没有。
 *
 * ⚠ 反过来的那一半同样重要：**没淹过就不许提水**。一个永远挂着的
 * "注意水位"会让玩家去翻一个根本不存在的账本（而且它会让"这一局抽到洪水"
 * 变得没有信息量）。所以这里两个方向都验。
 */
import { describe, expect, it } from 'vitest';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createOrganizeSession } from '../systems/organize';
import { createStartingRun } from '../systems/setup';
import { OrganizeScreen } from './OrganizeScreen';
import { __resetGesturesForTest } from './drag';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function saveStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 挂一屏整理页，`sinkRows` 与 `h` 由调用方给 */
function mount(opts: { sinkRows: number; shelfHeights?: number[] }): FakeElement {
  __resetGesturesForTest();
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  root.place(0, 0, 1000, 900);

  const run = createStartingRun(20261001, { disasterId: 'cold_snap' });
  run.phase = 'organize';
  run.day = -3;
  run.identityId = 'group_buyer';
  run.actionPoints = 3;
  run.homeSinkRows = opts.sinkRows;
  if (opts.shelfHeights) {
    run.shelves = run.shelves.map((s, i) => {
      const h = opts.shelfHeights?.[i] ?? s.h;
      return { ...s, h, slots: s.slots.slice(0, h), zoneIds: s.zoneIds.slice(0, h) };
    });
  }

  const store = new GameStore(createSaveGame(run), saveStub());
  new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined,
    onBackToSurvival: () => undefined
  }).mount();
  return root;
}

/** 那一行的文字（没写出来时是空串） */
function noteText(root: FakeElement): string {
  const note = root.querySelectorAll('[data-sink-note]')[0];
  return note?.textContent ?? '';
}

describe('★★ 整理页的水位提示（W-05）', () => {
  it('★ 淹过水：说出少了多少排，以及"每块各少一排"这个实情', () => {
    const root = mount({ sinkRows: 1, shelfHeights: [3, 3, 3] });
    const text = noteText(root);
    expect(text).toContain('水');
    expect(text).toContain('一排');
    /*
     * 口径：`homeSinkRows` 累加的是"这一次淹了几排"，而 `sinkShelves` 是
     * **逐块各砍一排** —— 所以"一共少了 3 排"是错的读法，
     * 而"每块家具各少了一排"才是盘面上真实发生的事。
     */
    expect(text).toContain('每块家具各少了一排');
    // 把"少了"换算成当下的事实：全屋还剩几排
    expect(text).toContain('9 排');
  });

  it('★ 没淹过水：一个字都不提水（不许挂一条永远在的警告）', () => {
    const root = mount({ sinkRows: 0 });
    expect(noteText(root)).toBe('');
    /*
     * 除了文字空着，那一行还得**藏起来** —— 一个空的 `<p class="block-note">`
     * 会照旧吃掉它那 6px 上边距，而那条 margin 是给"有话说"的行准备的。
     *
     * ⚠ 判据是**属性在不在**（真浏览器把裸属性读回来是空串），所以比 `''`：
     * 比 `'true'` 会让这条用例在真机上失效（`toggleAttribute` 写的是裸属性）。
     */
    expect(root.querySelectorAll('[data-sink-note]')[0]?.attributes?.['hidden']).toBe('');
  });

  it('淹过水又恢复正常水位时，那一行会重新露出来（属性真的被摘掉）', () => {
    const root = mount({ sinkRows: 1, shelfHeights: [3, 3, 3] });
    expect(root.querySelectorAll('[data-sink-note]')[0]?.attributes?.['hidden']).toBeUndefined();
  });

  it('淹了两排（事件可以再淹一次）时说的是两排', () => {
    const root = mount({ sinkRows: 2, shelfHeights: [2, 2, 2] });
    const text = noteText(root);
    // ⚠ 数字与"排"之间没有空格：`rows === 1` 那一档写的是"靠地那一排"，
    // 两侧口径要一样（中文数字后面本来就不加空格）
    expect(text).toContain('靠地那2 排');
    expect(text).toContain('6 排');
  });
});
