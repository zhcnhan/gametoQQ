/**
 * 求援订单（§6.5）。
 *
 * 这组用例守的核心只有一条：**凑单要花力气，而花多少由整理质量决定**。
 * §6.5 写的「整理得好 → 几下凑齐当场交付」「整理得烂 → 翻箱倒柜找不齐」，
 * 在实现上就是"翻找成本"这一个数字 —— 它要是没接上整理质量，
 * 这个系统就退化成"扣三件东西换个 toast"。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_SURVIVAL_SNAPSHOT, round1 } from '../data/survival';
import { countCategory } from '../model/consume';
import { makeStack, setRowZoneId, setSlotStack, stackCount } from '../model/shelf';
import type { RunState } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { getHelpRequestDef } from '../data/helpRequests';
import { createStartingRun } from './setup';
import {
  declineRequest,
  fulfillRequest,
  inspectRequest,
  isShutOut,
  quoteSources,
  searchCost,
  sourceCostOf,
  trustTotal
} from './help';
import { canTrade, tradeForBox } from './trade';

function createSaveSchedulerStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 往货架上塞一堆指定物资（找第一个空格） */
function give(run: RunState, itemId: string, count: number): void {
  const shelf = run.shelves[0];
  if (!shelf) throw new Error('开局没有货架');
  for (let row = 0; row < shelf.h; row++) {
    for (let col = 0; col < shelf.w; col++) {
      if (shelf.slots[row]?.[col]?.stack === null) {
        run.shelves[0] = setSlotStack(shelf, { row, col }, makeStack(itemId, count, null));
        return;
      }
    }
  }
  throw new Error('这块货架塞不下测试用的物资');
}

/** 一个"门口站着王阿姨、家里清空"的生存期存档 */
function storeAtDoor(defId = 'q_wang_medicine'): GameStore {
  const run = createStartingRun(20261001);
  run.phase = 'help_request';
  run.day = 3;
  run.identityId = 'group_buyer';
  run.helpRequest = { defId };
  run.boxesToUnpack = [];
  run.shelves = run.shelves.map((s) => ({
    ...s,
    zoneId: null,
    slots: s.slots.map((row) => row.map(() => ({ stack: null })))
  }));
  run.stats = { health: 90, mood: 60, stamina: 80, shelter: 80 };
  return new GameStore(createSaveGame(run), createSaveSchedulerStub());
}

function medicineOf(store: GameStore): number {
  const run = store.run;
  return countCategory(run.shelves, run.boxesToUnpack, 'medicine');
}

/**
 * W-11 的三档摆法（系统层版，与 `src/ui/helpSource.test.ts` 那份**故意分开写** ——
 * 两处都自己摆一遍，谁的摆法错了就在谁那一层报红，而不是一起绿）：
 *
 *   · `shelf_a` 第 0 行贴「药那一行」、放 1 件 → 贴了清单那一档 **1 件**
 *   · `shelf_a` 第 1 行没贴、放 2 件           → 上了架但没写清单那一档 **3 件**（含第 0 行）
 *   · `box_1` 里 3 件                          → 没拆的纸箱那一档 **3 件**
 *
 * 「货架上」那一档**刻意包含**贴了清单的那一行：那一档问的是"从架子上拿"，
 * 而"写没写清单"只决定它在哪一档算 **1.5** 还是 **3.3**。
 */
function stockThreeWays(store: GameStore): void {
  store.commit((draft) => {
    draft.shelves = draft.shelves.map((s, i) => {
      const cleared = { ...s, slots: s.slots.map((row) => row.map(() => ({ stack: null }))) };
      return i === 0 ? { ...cleared, zoneIds: setRowZoneId(cleared, 0, 'z_med') } : cleared;
    });
    const a = draft.shelves[0];
    if (a) {
      draft.shelves[0] = setSlotStack(a, { row: 0, col: 0 }, makeStack('bandage', 1, null));
      draft.shelves[0] = setSlotStack(draft.shelves[0] ?? a, { row: 1, col: 0 }, makeStack('bandage', 2, null));
    }
    draft.zones = [{ id: 'z_med', name: '药那一行', color: '#000000', autoAccept: { categories: ['medicine'] } }];
    draft.boxesToUnpack = [{ id: 'box_1', defId: 'box_medical', items: [makeStack('bandage', 3, null)] }];
  });
}

describe('求援订单：交付与婉拒', () => {
  it('交付：扣货、涨人情、回日报等他明天再来', () => {
    const store = storeAtDoor(); // 王阿姨要 3 件药
    give(store.run, 'bandage', 5);

    const result = fulfillRequest(store);
    expect(result.ok).toBe(true);
    expect(medicineOf(store)).toBe(2); // 5 - 3
    expect(store.run.trust['npc_wang']).toBe(2);
    expect(store.run.deliveredOrders).toBe(1);
    expect(store.run.helpRequest).toBeNull();
    expect(store.run.phase).toBe('survival_day'); // 处理完就回日报，日历不走
    expect(store.run.day).toBe(3);
  });

  it('交付会真的花掉体力，而且体力不会变成负数', () => {
    const store = storeAtDoor();
    give(store.run, 'bandage', 5);
    const before = store.run.stats.stamina;
    fulfillRequest(store);
    expect(store.run.stats.stamina).toBeLessThan(before);
    expect(store.run.stats.stamina).toBeGreaterThanOrEqual(0);
  });

  it('★ 凑不齐 ≠ 婉拒：没能耐不扣人情，但对方今日离开', () => {
    const store = storeAtDoor();
    give(store.run, 'bandage', 1); // 只有 1 件，要 3 件

    const result = fulfillRequest(store);
    // ok 说的是"命令推进了"，不是"你给成了" —— 凑不齐也是一次正常推进（对方今日离开）
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.type === 'helpFailed')).toBe(true);
    // 关键：他没被记恨 —— 那不是他的选择
    expect(store.run.trust['npc_wang'] ?? 0).toBe(0);
    expect(store.run.helpRequest).toBeNull();
    expect(store.run.phase).toBe('survival_day');
    expect(medicineOf(store)).toBe(1); // 一件都没动
  });

  it('婉拒：扣人情，也回日报（§6.5：只是一个按钮，无台词无特写）', () => {
    const store = storeAtDoor();
    give(store.run, 'bandage', 5);

    const result = declineRequest(store);
    expect(result.ok).toBe(true);
    expect(store.run.trust['npc_wang']).toBe(-2);
    expect(store.run.helpRequest).toBeNull();
    expect(store.run.phase).toBe('survival_day');
    expect(medicineOf(store)).toBe(5); // 东西还在
  });

  it('★ §12 v0.8：同一单三种摆放 —— 4.5 / 9.9 / 13.5 变成 4.5 / 9.9 / 13.5，但中间那档变了意思', () => {
    const def = getHelpRequestDef('q_wang_medicine'); // 要 3 件药

    // ① 上了架，而且这张胶带**明确收药**（归位率 1、临期优先 1）
    const tidy = storeAtDoor();
    give(tidy.run, 'bandage', 3);
    tidy.run.zones = [{ id: 'z_med', name: '药', color: '#000000', autoAccept: { categories: ['medicine'] } }];
    tidy.run.shelves = tidy.run.shelves.map((s) =>
      // ★ 整块贴一张 = 每一行都是它（v19 之后粒度是一行，见 `Shelf.zoneIds`）
      s.id === tidy.run.shelves[0]?.id ? { ...s, zoneIds: s.zoneIds.map(() => 'z_med') } : s
    );

    // ② 上了架、但一张清单都没写（归位率 0、临期优先 1）
    const plain = storeAtDoor();
    give(plain.run, 'bandage', 3);

    // ③ 原封不动堆在纸箱里（归位率 0、临期优先 0）
    const boxed = storeAtDoor();
    boxed.run.boxesToUnpack = [{ id: 'box_x', defId: 'box_medical', items: [makeStack('bandage', 3, null)] }];

    // 数字还是 4.5 / 9.9 / 13.5，但**中间那一档的性质变了**（§12 v0.8）：
    // 老口径下它拿的是"胶带什么都收"的归位率满分；新口径下它的归位率是 0，
    // 那 0.4 的质量全部来自 fefo —— 也就是"东西至少上架了、而且是按到期日排的"。
    // 换句话说：**上了架本身仍然算数，算数的那一项从"归位"变成了"排架"**；
    // 而"守没守自己写的秩序"这一项，只有写了清单才拿得到。
    expect(searchCost(tidy.run, def)).toBe(4.5);
    expect(searchCost(plain.run, def)).toBe(9.9);
    expect(searchCost(boxed.run, def)).toBe(13.5);
  });

  it('★ §12 v0.8：空清单的胶带 = 没贴胶带的归位率（都是 0），差别只剩排架那 0.4', () => {
    const def = getHelpRequestDef('q_wang_medicine');
    const open = storeAtDoor();
    give(open.run, 'bandage', 3);
    open.run.zones = [{ id: 'z_med', name: '药', color: '#000000' }]; // 空清单
    open.run.shelves = open.run.shelves.map((s) =>
      s.id === open.run.shelves[0]?.id ? { ...s, zoneIds: s.zoneIds.map(() => 'z_med') } : s
    );

    const bare = storeAtDoor();
    give(bare.run, 'bandage', 3);

    expect(searchCost(open.run, def)).toBe(searchCost(bare.run, def));
    expect(searchCost(open.run, def)).toBe(9.9);
  });

  it('★ W-06：装卸工「翻找省力 20%」也管凑单 —— 同一个数是两处乘的', () => {
    /*
     * `workCostOf` 的生产读点只有两处：`systems/survival.ts` 的日报与这里的
     * `searchCost`。**一处乘、一处不乘的表现是"日报说少花了、隔天凑订单又没花"** ——
     * 两个数各自都"对"，所以不会有任何报错，只有玩家觉得这个身份时灵时不灵。
     *
     * 所以这条用例守的不是某个数字，是**两个读点必须同口径**：这里钉住凑单那半，
     * `survival.test.ts` 钉住日报那半。
     */
    const def = getHelpRequestDef('q_wang_medicine');
    const plain = storeAtDoor(); // 默认 group_buyer
    give(plain.run, 'bandage', 3);

    const porter = storeAtDoor();
    porter.run.identityId = 'warehouse_porter';
    give(porter.run, 'bandage', 3);

    expect(searchCost(plain.run, def)).toBe(9.9);
    // ⚠ 乘数**先乘再 `round1`**（与日报同口径）：`9.9 × 0.8 = 7.92` 记成 `7.9`。
    // 先 round 再乘会得到 7.92 → 也是 7.9，看着一样，但那是巧合 —— 不写死这条，
    // 将来 base 变成 3 位小数时两处会差 0.1，而两个数各自都"对"。
    expect(searchCost(porter.run, def)).toBe(round1(9.9 * 0.8));
  });

  it('★★ W-11：报的三档价钱、取货时扣的钱、进箱子的货是**同一笔账**', () => {
    /*
     * 这一条钉的是整套 W-11 里最容易分家的地方：屏幕上报价用 `quoteSources`、
     * 按下去扣钱用 `sourceCostOf`、真取货用 `consumeCategory(…, from)`。
     * 三处各自都"算得对"，而只要有两处口径不同，表现就是
     * "写着 4.5 点、扣了 9.9 点，东西还从别的地方拿了" —— 没有任何报错。
     */
    const def = getHelpRequestDef('q_wang_medicine'); // 要 3 件药
    const store = storeAtDoor();
    stockThreeWays(store);

    const quotes = quoteSources(store.run, def);
    expect(quotes.map((q) => q.source)).toEqual(['marked', 'shelf', 'box']);
    // ★ 价钱按**真拿得出的件数**算：划好的那行只有 1 件 → 1.5 点（不是 3 件的 4.5）
    expect(quotes.map((q) => q.pieces)).toEqual([1, 3, 3]);
    expect(quotes.map((q) => q.cost)).toEqual([1.5, 9.9, 13.5]);
    expect(quotes.map((q) => q.enough)).toEqual([false, true, true]);
    // 报价与"按这一档算要多少体力"必须是同一个函数算出来的
    for (const q of quotes) expect(sourceCostOf(store.run, def, q.source)).toBe(q.cost);

    // 真按「货架上」那一档交：扣 9.9、东西从架子上出、纸箱一件不动
    const before = store.run.stats.stamina;
    const result = fulfillRequest(store, 'shelf');
    expect(result.ok).toBe(true);
    expect(round1(before - store.run.stats.stamina)).toBe(9.9);
    expect(store.run.boxesToUnpack[0]?.items).toHaveLength(1);
    expect(stackCount(store.run.boxesToUnpack[0]?.items[0] ?? makeStack('x', 0, null))).toBe(3);
    // 货架上那三件没了，而日志说出了这是从哪儿凑的（§10.1A 的非数字表达）
    expect(countCategory(store.run.shelves, [], 'medicine')).toBe(0);
    expect(store.run.log.join('\n')).toContain('从货架上凑的');
  });

  it('★★ W-11：指定那一档只从**那一档**拿 —— 划好的那行只算真贴了清单的那一行', () => {
    /*
     * 「划好的那行」这一档的粒度是**行**：`shelf_a` 第 0 行贴了、第 1 行没贴，
     * 于是第 1 行那 2 件**不算**这一档的。这条用例的全部意义就是这一点 ——
     * 如果哪一天有人图省事把 `'marked'` 实现成"整块货架贴过胶带"，上面那条
     * 报价用例仍然全绿（1 件变 3 件时它会红，但如果两块货架都贴了就不红），
     * 而玩家会发现"我明明只划了一行，它却从别处拿了"。
     */
    const store = storeAtDoor();
    stockThreeWays(store);

    // 这一档只有 1 件、而单子要 3 件 → 拦下来，一件都不许动
    const fail = fulfillRequest(store, 'marked');
    expect(fail.events.find((e) => e.type === 'helpFailed')).toBeDefined();
    expect(countCategory(store.run.shelves, [], 'medicine')).toBe(3);
    // ⚠ 凑不齐之后**门口就没人了**（`draft.helpRequest = null`）——
    // 所以这条用例不能在同一次登门上"先失败再补货再交"，得换一次登门。
    expect(store.run.helpRequest).toBeNull();

    // 再来一次：这一行补到 3 件（第 0 行第 1 格），第 1 行那 2 件**不补**
    const again = storeAtDoor();
    stockThreeWays(again);
    again.commit((draft) => {
      const a = draft.shelves[0];
      if (a) draft.shelves[0] = setSlotStack(a, { row: 0, col: 1 }, makeStack('bandage', 2, null));
    });
    expect(fulfillRequest(again, 'marked').ok).toBe(true);
    // 那一行的 3 件全没了
    expect(stackCount(again.run.shelves[0]?.slots[0]?.[0]?.stack ?? makeStack('x', 0, null))).toBe(0);
    expect(stackCount(again.run.shelves[0]?.slots[0]?.[1]?.stack ?? makeStack('x', 0, null))).toBe(0);
    // 第 1 行那两件还在 —— 它没被写进清单，这一档就不该碰它
    expect(stackCount(again.run.shelves[0]?.slots[1]?.[0]?.stack ?? makeStack('x', 0, null))).toBe(2);
    // 纸箱也一件没动
    expect(stackCount(again.run.boxesToUnpack[0]?.items[0] ?? makeStack('x', 0, null))).toBe(3);
  });
});

describe('人情：它在 M1 里的唯一用途，是决定门口还开不开', () => {
  it('婉拒到人情为负 → 以物易物直接关门（§6.5：后续交易关闭）', () => {
    const store = storeAtDoor();
    give(store.run, 'bandage', 5);

    declineRequest(store); // 婉拒之后人会回到日报
    // 摆成"正在硬撑、也不在冷却里"：这时门要是还关着，就只能是因为人情
    store.run.survival.last = { ...EMPTY_SURVIVAL_SNAPSHOT, hardPress: true };

    expect(store.run.phase).toBe('survival_day');
    expect(trustTotal(store.run)).toBeLessThan(0);
    expect(isShutOut(store.run)).toBe(true);
    expect(canTrade(store.run)).toBe(false);
    expect(tradeForBox(store, { picks: [{ itemId: 'bandage', count: 3 }], cashOn: false }).ok).toBe(false);
  });

  it('没被人记恨时，硬撑照样能敲门', () => {
    const store = storeAtDoor('q_classmate_food');
    store.run.helpRequest = null;
    store.run.phase = 'survival_day';
    give(store.run, 'battery', 6);
    store.run.survival.last = { ...EMPTY_SURVIVAL_SNAPSHOT, hardPress: true };

    expect(canTrade(store.run)).toBe(true);
    expect(tradeForBox(store, { picks: [{ itemId: 'battery', count: 3 }], cashOn: false }).ok).toBe(true);
  });
});

describe('求援订单：需求判定', () => {
  it('报缺口时报的是"真的还差几件"，纸箱里的货也算数', () => {
    const run = storeAtDoor().run;
    run.boxesToUnpack = [{ id: 'box_x', defId: 'box_medical', items: [makeStack('bandage', 3, null)] }];

    const info = inspectRequest(run, getHelpRequestDef('q_wang_medicine'));
    expect(info.pieces).toBe(3);
    expect(info.missing).toBe(0); // 在箱子里也算凑得齐 —— 只是翻出来更费劲
  });

  it('翻不动的时候，凑单会被体力拦下（对方不记恨，但东西还在）', () => {
    const store = storeAtDoor();
    give(store.run, 'bandage', 5);
    store.run.stats.stamina = 1; // 远低于翻找成本

    const result = fulfillRequest(store);
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.type === 'helpFailed')).toBe(true);
    expect(store.run.trust['npc_wang'] ?? 0).toBe(0);
    expect(medicineOf(store)).toBe(5);
  });
});
