/**
 * 求援订单（§6.5）。
 *
 * 这组用例守的核心只有一条：**凑单要花力气，而花多少由整理质量决定**。
 * §6.5 写的「整理得好 → 几下凑齐当场交付」「整理得烂 → 翻箱倒柜找不齐」，
 * 在实现上就是"翻找成本"这一个数字 —— 它要是没接上整理质量，
 * 这个系统就退化成"扣三件东西换个 toast"。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_SURVIVAL_SNAPSHOT } from '../data/survival';
import { countCategory } from '../model/consume';
import { makeStack, setSlotStack } from '../model/shelf';
import type { RunState } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { getHelpRequestDef } from '../data/helpRequests';
import { createStartingRun } from './setup';
import { declineRequest, fulfillRequest, inspectRequest, isShutOut, searchCost, trustTotal } from './help';
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

  it('箱子里 100 件药的档，和分门别类的档，交付速度不一样', () => {
    const tidy = storeAtDoor();
    give(tidy.run, 'bandage', 5);
    tidy.run.zones = [{ id: 'z_med', name: '药', color: '#000000' }];
    tidy.run.shelves = tidy.run.shelves.map((s) => (s.id === tidy.run.shelves[0]?.id ? { ...s, zoneId: 'z_med' } : s));

    const messy = storeAtDoor();
    messy.run.boxesToUnpack = [
      { id: 'box_x', defId: 'box_medical', items: [makeStack('bandage', 5, null)] }
    ];

    const def = getHelpRequestDef('q_wang_medicine');
    expect(searchCost(messy.run, def)).toBeGreaterThan(searchCost(tidy.run, def));
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
    expect(tradeForBox(store, [{ itemId: 'bandage', count: 3 }]).ok).toBe(false);
  });

  it('没被人记恨时，硬撑照样能敲门', () => {
    const store = storeAtDoor('q_classmate_food');
    store.run.helpRequest = null;
    store.run.phase = 'survival_day';
    give(store.run, 'battery', 6);
    store.run.survival.last = { ...EMPTY_SURVIVAL_SNAPSHOT, hardPress: true };

    expect(canTrade(store.run)).toBe(true);
    expect(tradeForBox(store, [{ itemId: 'battery', count: 3 }]).ok).toBe(true);
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
