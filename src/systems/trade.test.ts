/**
 * 以物易物（§12.3 v0.6 的出口）。
 *
 * 这组用例守的是一条设计立场：**它不保证能救你**。
 * 三件换一箱，箱子里装什么由种子化 RNG 决定 —— 一个必然把你救回来的按钮
 * 不是选择，是流程。所以这里只测"规矩"，不测"一定换得到吃的"。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_SURVIVAL_SNAPSHOT, NEVER_TRADED } from '../data/survival';
import { countByItem } from '../model/consume';
import { makeStack, setSlotStack } from '../model/shelf';
import type { RunState } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createStartingRun } from './setup';
import { canTrade, tradeCooldownLeft, tradeForBox } from './trade';

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

/** 一个"正在硬撑、屋里有货"的生存期存档 */
function storePressing(seed = 20261001): GameStore {
  const run = createStartingRun(seed);
  run.phase = 'survival_day';
  run.day = 3;
  run.identityId = 'group_buyer';
  run.stats = { health: 40, mood: 40, stamina: 40, shelter: 60 };
  run.survival.last = { ...EMPTY_SURVIVAL_SNAPSHOT, hardPress: true, hardPressLevel: 'straining' };
  run.boxesToUnpack = [];
  give(run, 'battery', 6);
  give(run, 'canned_beans', 4);
  return new GameStore(createSaveGame(run), createSaveSchedulerStub());
}

function countOf(store: GameStore, itemId: string): number {
  const run = store.run;
  return countByItem(run.shelves, run.boxesToUnpack).find((s) => s.itemId === itemId)?.count ?? 0;
}

/**
 * 只数货架上的。
 *
 * 换箱之后必须用这个而不是全屋口径：换回来的粮油箱里**也可能装着黄豆罐头**，
 * 混在一起数会得到"换出去一件反而多了一件"的怪结果。
 */
function shelfCountOf(store: GameStore, itemId: string): number {
  return countByItem(store.run.shelves, []).find((s) => s.itemId === itemId)?.count ?? 0;
}

describe('以物易物：硬撑时的出口', () => {
  it('日子过得去的时候换不成（它不是商店，是街坊之间的一句"帮个忙"）', () => {
    const store = storePressing();
    store.run.survival.last.hardPress = false;
    expect(canTrade(store.run)).toBe(false);
    expect(tradeForBox(store, [{ itemId: 'battery', count: 3 }]).ok).toBe(false);
    expect(countOf(store, 'battery')).toBe(6);
  });

  it('三件换一箱：东西从屋里扣掉，粮油箱进待拆队列', () => {
    const store = storePressing();
    const boxesBefore = store.run.boxesToUnpack.length;

    const result = tradeForBox(store, [{ itemId: 'battery', count: 3 }]);
    expect(result.ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(3);
    expect(store.run.boxesToUnpack.length).toBe(boxesBefore + 1);
    expect(store.run.boxesToUnpack[boxesBefore]?.defId).toBe('box_staple');
    expect(store.run.boxesToUnpack[boxesBefore]?.items.length).toBeGreaterThan(0);
  });

  it('品类不限，可以几样凑满三件（取舍感就来自这里）', () => {
    const store = storePressing();
    const result = tradeForBox(store, [
      { itemId: 'battery', count: 2 },
      { itemId: 'canned_beans', count: 1 }
    ]);
    expect(result.ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(4);
    expect(shelfCountOf(store, 'canned_beans')).toBe(3);
  });

  it('凑不满三件不给换', () => {
    const store = storePressing();
    const result = tradeForBox(store, [{ itemId: 'battery', count: 2 }]);
    expect(result.ok).toBe(false);
    expect(countOf(store, 'battery')).toBe(6);
    expect(store.run.boxesToUnpack.length).toBe(0);
  });

  it('库里没那么多也不给换（校验按全屋算，与界面列的清单同源）', () => {
    const store = storePressing();
    expect(tradeForBox(store, [{ itemId: 'battery', count: 99 }]).ok).toBe(false);
    expect(countOf(store, 'battery')).toBe(6);
  });

  it('纸箱里的东西也能拿去换 —— 恰恰是最需要这个出口的人才会全堆在箱子里', () => {
    const store = storePressing();
    store.run.shelves = store.run.shelves.map((s) => ({
      ...s,
      slots: s.slots.map((row) => row.map(() => ({ stack: null })))
    }));
    store.run.boxesToUnpack = [
      { id: 'box_x', defId: 'box_mixed', items: [makeStack('battery', 6, null)] }
    ];

    expect(tradeForBox(store, [{ itemId: 'battery', count: 3 }]).ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(3);
  });

  it('两天冷却：刚换完不能马上再换，但两天后可以', () => {
    const store = storePressing();
    expect(tradeForBox(store, [{ itemId: 'battery', count: 3 }]).ok).toBe(true);
    expect(store.run.survival.lastTradeDay).toBe(3);
    expect(tradeCooldownLeft(store.run)).toBe(2);
    expect(canTrade(store.run)).toBe(false);
    expect(tradeForBox(store, [{ itemId: 'battery', count: 3 }]).ok).toBe(false);

    store.run.day = 5;
    expect(tradeCooldownLeft(store.run)).toBe(0);
    expect(canTrade(store.run)).toBe(true);
    expect(tradeForBox(store, [{ itemId: 'battery', count: 3 }]).ok).toBe(true);
    expect(countOf(store, 'battery')).toBe(0);
  });

  it('从没换过的存档不处于冷却中', () => {
    const store = storePressing();
    expect(store.run.survival.lastTradeDay).toBe(NEVER_TRADED);
    expect(tradeCooldownLeft(store.run)).toBe(0);
    expect(canTrade(store.run)).toBe(true);
  });
});
