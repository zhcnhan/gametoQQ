/**
 * ★★ 求援订单：三档来源各自的价钱（M4 W-11）
 *
 * ## 这一组守的是什么
 *
 * W-11 之前，这一屏只有一个数：整单按**全屋整理质量**算出的混合价。
 * 它对"这一单到底从哪儿拿"一无所知，于是 §6.5 承诺的那场取舍
 * （"现在拆箱省时间，还是翻我划好的那一行省力气"）在屏幕上没有落点。
 *
 * 现在三档明码标价摆出来，所以这一组要守两条：
 *  ① **三档都画出来**，而且不够的那档明说"只有 N 件"（藏起来玩家就看不到
 *     "东西压在箱子里让这一单贵了三倍"这句话）；
 *  ② ★ **按钮上那个价钱就是按下去真正付掉的价钱** —— 按钮从自己的
 *     `data-source` 读档位，不在点击处理里重算。这一条只能用"屏幕级 +
 *     系统级对着同一次操作取数"来验，光看渲染或光看命令都验不到。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findHelpRequestDef, type HelpRequestDef } from '../data/helpRequests';
import { makeStack, setSlotStack, stackCount } from '../model/shelf';
import type { RunState, Zone } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { fulfillRequest, quoteSources, type WorkSource } from '../systems/help';
import { createStartingRun } from '../systems/setup';
import { HelpScreen } from './HelpScreen';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

const MEDICINE: Zone = {
  id: 'z_med',
  name: '药那一行',
  color: '#C8372D',
  autoAccept: { categories: ['medicine'] }
};

/** 王阿姨要 3 件药（`q_wang_medicine`）；`findHelpRequestDef` 类型可空，这里一次收掉 */
function wangDef(): HelpRequestDef {
  const def = findHelpRequestDef('q_wang_medicine');
  if (!def) throw new Error('没有 q_wang_medicine 这一单');
  return def;
}

function put(run: RunState, shelfId: string, row: number, col: number, itemId: string, count: number): void {
  const i = run.shelves.findIndex((s) => s.id === shelfId);
  const shelf = run.shelves[i];
  if (!shelf) throw new Error(`没有家具 ${shelfId}`);
  run.shelves[i] = setSlotStack(shelf, { row, col }, makeStack(itemId, count, null));
}

/**
 * 王阿姨要 3 件药，而这三件分在三个地方：
 *
 *   · `shelf_a` 第 0 行贴了「药那一行」（清单收 medicine）→ **贴了清单的那一档**
 *   · `shelf_b` 第 0 行没贴任何胶带             → **上了架但没写清单那一档**
 *   · `box_1` 里还剩 1 件                        → **没拆的纸箱那一档**
 *
 * 三档因此**各自都不够三件**，所以"按钮只画够的那几档"这条规则不会
 * 把任何一档藏起来 —— 三档都得画，而且都得明说自己有几件。
 */
function scatteredStore(): GameStore {
  const run = createStartingRun(20261002, { disasterId: 'cold_snap' });
  run.phase = 'help_request';
  run.day = 3;
  run.identityId = 'group_buyer';
  run.helpRequest = { defId: 'q_wang_medicine' };
  run.zones = [MEDICINE];
  run.shelves = run.shelves.map((s) => ({
    ...s,
    zoneIds: s.zoneIds.map(() => null),
    slots: s.slots.map((row) => row.map(() => ({ stack: null })))
  }));
  // ★ 只贴第 0 行：粒度的单位是**一行**，而这一组要验的正是这一点
  const a = run.shelves[0];
  if (!a) throw new Error('开局没有 shelf_a');
  run.shelves[0] = { ...a, zoneIds: a.zoneIds.map((_, row) => (row === 0 ? MEDICINE.id : null)) };
  put(run, 'shelf_a', 0, 0, 'bandage', 1);
  put(run, 'shelf_b', 0, 0, 'bandage', 1);
  // ★ 箱子必须在这里就给好：整档不够的用例要的是"这一档只有 1 件"，
  // 而"档位上根本没有箱子"是另一回事（那连按钮都不该画）
  run.boxesToUnpack = [{ id: 'box_1', defId: 'box_medical', items: [makeStack('bandage', 1, null)] }];
  run.stats = { health: 90, mood: 60, stamina: 80, shelter: 80 };
  return new GameStore(createSaveGame(run), stubScheduler());
}

function mountHelp(store: GameStore, onFulfill: (source: WorkSource) => void): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new HelpScreen(asElement(root), store, { onFulfill, onDecline: () => undefined, onLeave: () => undefined }).mount();
  return root;
}

/** 点某个按钮：假体没有事件冒泡，所以直接把 target 摆成它（`onClick` 用 `closest` 认人） */
function clickButton(root: FakeElement, action: string, source?: string): void {
  const selector = source ? `[data-action="${action}"][data-source="${source}"]` : `[data-action="${action}"]`;
  const button = root.querySelector(selector);
  if (!button) throw new Error(`屏幕上没有 ${selector}`);
  root.dispatch('click', { target: button });
}

/**
 * 三档**各自都够**：`shelf_a` 第 0 行（贴了清单）三件、
 * `shelf_b` 第 0 行（没写清单）三件、`box_1` 里三件。
 *
 * ★ 三档都必须真的有货 —— 第一版只往 `shelf_a` 摆三件，于是
 * "从没拆的纸箱拿"那一档没有按钮，而那条用例想验的是**按钮上的数**，
 * 不是"没货就不画按钮"（那是另一条用例的事）。
 */
function stockAllTiers(store: GameStore): void {
  store.commit((draft) => {
    draft.shelves = draft.shelves.map((s) => ({
      ...s,
      slots: s.slots.map((row) => row.map(() => ({ stack: null })))
    }));
    const a = draft.shelves[0];
    const b = draft.shelves[1];
    if (a) draft.shelves[0] = setSlotStack(a, { row: 0, col: 0 }, makeStack('bandage', 3, null));
    if (b) draft.shelves[1] = setSlotStack(b, { row: 0, col: 0 }, makeStack('bandage', 3, null));
    draft.boxesToUnpack = [{ id: 'box_1', defId: 'box_medical', items: [makeStack('bandage', 3, null)] }];
  });
}

const openedDocs: { restore: () => void }[] = [];
afterEach(() => {
  for (const d of openedDocs.splice(0)) d.restore();
  vi.restoreAllMocks();
});

describe('★★ 求援订单：从哪儿凑（M4 W-11）', () => {
  it('三档都画出来，不够的那档明说"只有 N 件"，价钱按**真拿得出的件数**算', () => {
    const store = scatteredStore();
    const root = mountHelp(store, () => undefined);

    const rows = root.querySelectorAll('.where-row');
    if (rows.length !== 3) throw new Error(`该有三档，只有 ${rows.length}`);
    // 三档的名字都在，顺序从最省力到最费劲
    const cells = (cls: string): string[] => rows.map((r) => r.querySelector(cls)?.textContent ?? '');
    expect(cells('.where-name')).toEqual(['划好的那行', '货架上', '没拆的纸箱']);
    // 这一单要 3 件绷带；贴了清单那一行 1 件、没写清单的行 2 件（shelf_a 之外还有 shelf_b）、纸箱 1 件
    expect(cells('.where-have')).toEqual(['只有 1 件', '只有 2 件', '只有 1 件']);
    // ★ 价钱按**真拿得出的件数**算：1 件 → 1.5（不是 3 件的 4.5）、2 件 → 6.6（不是 9.9）
    expect(cells('.where-cost')).toEqual(['1.5 点', '6.6 点', '4.5 点']);
    // ★ 三档都不够 → 三行都该是"次一等"的样子（而不是三行里混一行正常的）
    expect(rows.every((r) => r.classList.contains('is-short'))).toBe(true);
    // 数据属性跟着档位走：屏幕级测试靠它认出"这一行是哪一档"
    expect(rows.map((r) => r.dataset['where'])).toEqual(['marked', 'shelf', 'box']);
  });

  it('★ 缺哪一档就不画哪一档的按钮（免得按下去才发现凑不齐）', () => {
    const store = scatteredStore();
    const quotes = quoteSources(store.run, wangDef());
    // 三档都不够
    expect(quotes.every((q) => !q.enough)).toBe(true);

    const root = mountHelp(store, () => undefined);
    expect(root.querySelectorAll('[data-action="fulfill"]')).toHaveLength(1); // 只剩那个 disabled 的主按钮
    expect(root.querySelector('[data-action="fulfill"]')?.disabled).toBe(true);
    // 婉拒永远在
    expect(root.querySelector('[data-action="decline"]')).not.toBeNull();
  });

  it('★ 够的那几档各画一个按钮，价钱写在按钮上，顺序从最省力到最费劲', () => {
    const store = scatteredStore();
    stockAllTiers(store);

    const quotes = quoteSources(store.run, wangDef());
    expect(quotes.map((q) => q.source)).toEqual(['marked', 'shelf', 'box']);
    // 每件的价钱 1.5 / 3.3 / 4.5，三件 → 4.5 / 9.9 / 13.5
    expect(quotes.map((q) => q.cost)).toEqual([4.5, 9.9, 13.5]);

    const root = mountHelp(store, () => undefined);
    const buttons = root.querySelectorAll('[data-action="fulfill"]');
    // 三档各一个（含主按钮那一枚）
    expect(buttons.map((b) => b.dataset['source'])).toEqual(['marked', 'shelf', 'box']);
    expect(buttons.map((b) => b.textContent)).toEqual([
      '从划好的那行拿4.5 点',
      '从货架上拿 9.9 点',
      '从没拆的纸箱拿 13.5 点'
    ]);
    // ★ 主按钮不再靠"猜哪档够"来画，所以此刻它是启用的
    expect(buttons[0]?.disabled).toBe(false);
  });

  it('★★ 按钮上那个价钱，就是按下去真正付掉的价钱', () => {
    /*
     * 这条是这一组唯一**跨层**的判据：屏幕说 4.5，命令就真的扣 4.5。
     * 只验渲染会漏掉"点击处理里重算了一遍别的档"，只验命令会漏掉
     * "按钮上的数字根本没接上" —— 两种都不会报错，只会让玩家觉得
     * 屏幕上那个数是个装饰。
     */
    for (const source of ['marked', 'shelf', 'box'] as const) {
      const store = scatteredStore();
      // 三档各自都够，于是每档都真的按得下去
      stockAllTiers(store);

      const seen: WorkSource[] = [];
      // 真按下去：屏幕回调 → 命令，与 main.ts 里那条链子同一形状
      const root = mountHelp(store, (picked) => {
        seen.push(picked);
        fulfillRequest(store, picked);
      });
      const button = root.querySelector(`[data-action="fulfill"][data-source="${source}"]`);
      if (!button) throw new Error(`${source} 那一档没有按钮`);
      // ★ 价钱从**按钮自己的字**上读：从 `quoteSources` 取数来比的话，
      // 两边的错会一起错，照样全绿
      const shown = Number(/[\d.]+/.exec(button.textContent)?.[0]);

      const before = store.run.stats.stamina;
      clickButton(root, 'fulfill', source);

      expect(seen).toEqual([source]); // ★ 屏幕传出来的档位就是按钮上写的那个
      const paid = Math.round((before - store.run.stats.stamina) * 10) / 10;
      expect(paid, `${source}：按钮写 ${shown}、实际扣了 ${paid}`).toBeCloseTo(shown, 5);
    }
  });

  it('★ 婉拒那条路上不碰任何一档（它本来就不该翻东西）', () => {
    const store = scatteredStore();
    const declined = vi.fn();
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const root = doc.createElement('div');
    new HelpScreen(asElement(root), store, {
      onFulfill: () => undefined,
      onDecline: declined,
      onLeave: () => undefined
    }).mount();

    const before = store.run.shelves.map((s) => s.slots.flat().map((slot) => slot.stack?.itemId ?? null));
    clickButton(root, 'decline');
    expect(declined).toHaveBeenCalledTimes(1);
    expect(store.run.shelves.map((s) => s.slots.flat().map((slot) => slot.stack?.itemId ?? null))).toEqual(before);
  });

  it('★ 「从划好的那行拿」真的只从那一行拿 —— 纸箱原封不动', () => {
    const store = scatteredStore();
    stockAllTiers(store);

    fulfillRequest(store, 'marked');

    // 纸箱还在、里面那三件没被动过
    expect(store.run.boxesToUnpack).toHaveLength(1);
    expect(stackCount(store.run.boxesToUnpack[0]?.items[0] ?? makeStack('x', 0, null))).toBe(3);
    // shelf_b（没清单那一行）那件也还在
    const b = store.run.shelves.find((s) => s.id === 'shelf_b');
    expect(b?.slots[0]?.[0]?.stack?.itemId).toBe('bandage');
  });

  it('★ 那一档不够时报的是"划好的那行"，而不是全屋口径', () => {
    const store = scatteredStore();
    // 三件都摆到 shelf_b（没写清单那一档）→ marked 那一档一件都没有
    store.commit((draft) => {
      draft.shelves = draft.shelves.map((s) => ({
        ...s,
        slots: s.slots.map((row) => row.map(() => ({ stack: null })))
      }));
      const b = draft.shelves[1];
      if (b) draft.shelves[1] = setSlotStack(b, { row: 0, col: 0 }, makeStack('bandage', 3, null));
    });

    const result = fulfillRequest(store, 'marked');
    const failed = result.events.find((e) => e.type === 'helpFailed');
    expect(failed).toBeDefined();
    expect(failed && 'reason' in failed ? failed.reason : '').toContain('划好的那行');
    // 一件都没动
    expect(stackCount(store.run.shelves[1]?.slots[0]?.[0]?.stack ?? makeStack('x', 0, null))).toBe(3);
  });

  it('★ 从纸箱拿要按 4.5 一件算，而且真的只从箱子里出', () => {
    const store = scatteredStore();
    store.commit((draft) => {
      draft.boxesToUnpack = [{ id: 'box_1', defId: 'box_medical', items: [makeStack('bandage', 3, null)] }];
    });

    const before = store.run.stats.stamina;
    fulfillRequest(store, 'box');

    expect(Math.round((before - store.run.stats.stamina) * 10) / 10).toBe(13.5); // 4.5 × 3
    expect(store.run.boxesToUnpack[0]?.items).toHaveLength(0); // 全从箱子里出
    // 货架上那两件见证人没被动
    expect(store.run.shelves[0]?.slots[0]?.[0]?.stack?.itemId).toBe('bandage');
  });

  it('★ 日志里写上"从哪儿凑的"（§10.1A 要的非数字表达）', () => {
    const store = scatteredStore();
    stockAllTiers(store);
    fulfillRequest(store, 'marked');
    expect(store.run.log.join('\n')).toContain('从划好的那行凑的');

    // 老口径（不传档位）不写这一句 —— 它本来就没有"从哪儿"这回事
    const plain = scatteredStore();
    stockAllTiers(plain);
    fulfillRequest(plain);
    expect(plain.run.log.join('\n')).not.toContain('凑的）');
  });

  it('★ 身份天赋对三档的价钱一视同仁（省力是省力，不是某一档的优惠）', () => {
    const def = wangDef();
    const store = scatteredStore();
    stockAllTiers(store);

    const buyer = quoteSources(store.run, def);
    store.commit((draft) => {
      draft.identityId = 'warehouse_porter'; // 翻找省力 20%
    });
    const porter = quoteSources(store.run, def);

    expect(buyer.map((q) => q.cost)).toEqual([4.5, 9.9, 13.5]);
    expect(porter.map((q) => q.cost)).toEqual([3.6, 7.9, 10.8]);
  });
});
