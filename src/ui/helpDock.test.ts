/**
 * ★★ 求援订单那一屏的**排版契约**（M4 W-11）
 *
 * ## 为什么排版也值得有守卫
 *
 * 这一屏的底部原来只有一个按钮，现在最多有四个（主按钮 + 两档 + 婉拒），
 * 而且文案比别处都长（"从没拆的纸箱拿 13.5 点"）。它当时**不能**用
 * `.dock-tools`：那个容器没有 `flex-wrap`，按钮挤出去的部分会被
 * 容器直接裁掉 —— 而裁掉的那一枚，恰恰是"这条路上唯一走得通的那一档"。
 *
 * 所以这里守的是两条**结构**判据（不是像素）：
 *  ① 底部是竖排容器（`dock-stack`），不是横排工具条；
 *  ② 那一列按钮的顺序就是三档从省力到费劲的顺序 —— 玩家从下往上读，
 *     读到的次序与"哪条路便宜"一致。
 *
 * ⚠ 真正的宽度契约由 `scripts/check-layout.mjs` 在构建前扫 CSS 守住，
 * 这里守的是**这个屏幕用了哪个容器**：换回 `dock-tools` 会让那五条
 * 里的一条失效，而屏幕级测试看不出像素溢出，只会看到"少了一个按钮"。
 */
import { describe, expect, it } from 'vitest';
import { makeStack, setSlotStack } from '../model/shelf';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createStartingRun } from '../systems/setup';
import { HelpScreen } from './HelpScreen';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

function storeAtDoor(): GameStore {
  const run = createStartingRun(20261004, { disasterId: 'cold_snap' });
  run.phase = 'help_request';
  run.day = 3;
  run.identityId = 'group_buyer';
  run.helpRequest = { defId: 'q_wang_medicine' };
  run.zones = [{ id: 'z_med', name: '药那一行', color: '#C8372D', autoAccept: { categories: ['medicine'] } }];
  run.shelves = run.shelves.map((s, i) => {
    const cleared = { ...s, slots: s.slots.map((row) => row.map(() => ({ stack: null }))) };
    return i === 0 ? { ...cleared, zoneIds: cleared.zoneIds.map((_, row) => (row === 0 ? 'z_med' : null)) } : cleared;
  });
  const a = run.shelves[0];
  const b = run.shelves[1];
  if (a) run.shelves[0] = setSlotStack(a, { row: 0, col: 0 }, makeStack('bandage', 3, null));
  if (b) run.shelves[1] = setSlotStack(b, { row: 0, col: 0 }, makeStack('bandage', 3, null));
  run.boxesToUnpack = [{ id: 'box_1', defId: 'box_medical', items: [makeStack('bandage', 3, null)] }];
  return new GameStore(createSaveGame(run), stubScheduler());
}

function mount(store: GameStore): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new HelpScreen(asElement(root), store, {
    onFulfill: () => undefined,
    onDecline: () => undefined,
    onLeave: () => undefined
  }).mount();
  return root;
}

describe('★★ 求援订单那一屏：四个按钮排得下（M4 W-11）', () => {
  it('★ 底部是**竖排**容器，不是横排工具条（横排会把够得着的那一档裁掉）', () => {
    const root = mount(storeAtDoor());
    const dock = root.querySelector('.dock');
    expect(dock, '这一屏没有底部按钮区').not.toBeNull();
    expect(dock?.classList.contains('dock-stack')).toBe(true);
    expect(dock?.classList.contains('dock-tools')).toBe(false);
  });

  it('★ 按钮顺序 = 三档从省力到费劲，主按钮（划好的那行）排在最前', () => {
    const root = mount(storeAtDoor());
    const buttons = root.querySelectorAll('[data-action="fulfill"]');
    expect(buttons.map((b) => b.dataset['source'])).toEqual(['marked', 'shelf', 'box']);
    // 价钱在按钮上单调递增 —— 这条断言是"顺序"这条判据的实质，
    // 光比档位名的话，把三个按钮的顺序打乱照样能写出一串一样的名字
    const costs = buttons.map((b) => Number(/[\d.]+/.exec(b.textContent)?.[0]));
    expect(costs).toEqual([...costs].sort((x, y) => x - y));
    expect(costs[0]).toBeLessThan(costs[2] ?? 0);
  });

  it('★ 婉拒排在三档之后（它不是"第四条路"，是"不选"）', () => {
    const root = mount(storeAtDoor());
    const dock = root.querySelector('.dock');
    const actions = (dock?.querySelectorAll('[data-action]') ?? []).map((b) => b.dataset['action']);
    expect(actions[actions.length - 1]).toBe('decline');
    expect(actions.filter((a) => a === 'fulfill')).toHaveLength(3);
  });
});
