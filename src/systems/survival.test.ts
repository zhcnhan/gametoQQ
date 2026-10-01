/**
 * 生存期每日结算（§6.4）与它依赖的两个纯逻辑模块（腐坏 / FEFO 取用）。
 *
 * 这一组测试同时守住一条**已拍板的设计**：
 * 腐坏是灾难的属性，而寒潮是天然冷库 —— 所以 M1 全程不该有任何东西坏掉。
 * 最后那一条用例（"换成热浪同一批牛奶会坏"）就是这条立场的反证：
 * 机制本身是通的，只是寒潮这一档不让它发作。
 */
import { describe, expect, it } from 'vitest';
import { SURVIVAL_DAYS, getDisasterDef } from '../data/disaster';
import { NIGHT_SLEEP } from '../data/nightEvents';
import { moodFromPlacement, dailyDrainOf } from '../data/survival';
import { consumeCategory, countCategory } from '../model/consume';
import { makeStack, setSlotStack } from '../model/shelf';
import { isBatchSpoiled, spoilEverything, virtualDay } from '../model/spoil';
import type { RunState, SlotPos, Zone } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { advanceSurvivalDay, chooseIdentity, chooseNightOption, endDay, goHome, sleep, startSurvival } from './phases';
import { settleSurvivalDay } from './survival';
import { createStartingRun } from './setup';

function createSaveSchedulerStub() {
  return {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  };
}

/** 往货架上塞一件指定到期日的物资（测试里允许直接写状态） */
function put(run: RunState, shelfId: string, pos: SlotPos, itemId: string, count: number, expiry: number | null): void {
  const index = run.shelves.findIndex((s) => s.id === shelfId);
  const shelf = run.shelves[index];
  if (!shelf) throw new Error(`没有货架 ${shelfId}`);
  run.shelves[index] = setSlotStack(shelf, pos, makeStack(itemId, count, expiry));
}

/** 一份"刚好能撑一天"的最小开局（不依赖随机箱子内容） */
function bareRun(seed = 20261001): RunState {
  const run = createStartingRun(seed);
  run.boxesToUnpack = [];
  run.shelves = run.shelves.map((shelf) =>
    shelf.slots.length > 0
      ? { ...shelf, slots: shelf.slots.map((row) => row.map(() => ({ stack: null }))) }
      : shelf
  );
  return run;
}

/** 直接落在 D-Day 上 */
function storeAtDDay(seed = 20261001): GameStore {
  const run = bareRun(seed);
  run.phase = 'survival_day';
  run.day = 0;
  return new GameStore(createSaveGame(run), createSaveSchedulerStub());
}

describe('腐坏：它是灾难的属性，不是物资的属性', () => {
  it('virtualDay：囤货期按真实天走，灾难期按 spoilRate 换算', () => {
    expect(virtualDay(-7, 0.5)).toBe(-7);
    expect(virtualDay(0, 3)).toBe(0);
    expect(virtualDay(4, 0.5)).toBe(2);
    expect(virtualDay(4, 3)).toBe(12);
  });

  it('不易腐的东西永远不坏（expiresAtDay === null）', () => {
    expect(isBatchSpoiled({ expiresAtDay: null, count: 99 }, 99999)).toBe(false);
  });

  it('★ 寒潮 spoilRate = 0.5：M1 全程没有东西会坏 —— 这是拍板的设计，不是漏做', () => {
    const run = bareRun();
    // 牛奶保质期 21 天，D-7 买 → 绝对到期日 14（= D+14）
    put(run, 'shelf_a', { row: 0, col: 0 }, 'milk', 3, 14);
    const disaster = getDisasterDef(run.disasterId);
    expect(disaster.spoilRate).toBe(0.5);

    for (let day = 1; day <= SURVIVAL_DAYS; day++) {
      const sweep = spoilEverything(run.shelves, run.boxesToUnpack, virtualDay(day, disaster.spoilRate));
      expect(sweep.total).toBe(0);
    }
  });

  it('反证：换成热浪（spoilRate 3）同一批牛奶会在生存期提前坏掉 —— 机制本身是通的', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'milk', 3, 14);
    // D+5 时虚拟天已经跑到 15 > 14
    const sweep = spoilEverything(run.shelves, run.boxesToUnpack, virtualDay(5, 3));
    expect(sweep.total).toBe(3);
    expect(sweep.losses[0]?.itemId).toBe('milk');
    expect(sweep.shelves[0]?.slots[0]?.[0]?.stack).toBeNull();
  });

  it('纸箱里的东西也会坏（纸箱不是冰箱，否则没人有理由拆箱）', () => {
    const run = bareRun();
    run.boxesToUnpack = [{ id: 'box_1', defId: 'box_staple', items: [makeStack('milk', 3, 10)] }];
    const sweep = spoilEverything(run.shelves, run.boxesToUnpack, 12);
    expect(sweep.total).toBe(3);
    expect(sweep.boxes[0]?.items).toEqual([]);
  });

  it('只坏该坏的批次，剩下的照旧（同堆里早到期的坏、晚到期的留）', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 2, 5);
    const shelf = run.shelves[0];
    if (!shelf) throw new Error('缺货架');
    // 同一格再叠一个晚到期的批次
    const stacked = setSlotStack(shelf, { row: 0, col: 0 }, {
      itemId: 'canned_beans',
      batches: [
        { expiresAtDay: 5, count: 2 },
        { expiresAtDay: 50, count: 3 }
      ]
    });
    run.shelves[0] = stacked;

    const sweep = spoilEverything(run.shelves, run.boxesToUnpack, 20);
    expect(sweep.total).toBe(2);
    const left = sweep.shelves[0]?.slots[0]?.[0]?.stack;
    expect(left?.batches).toEqual([{ expiresAtDay: 50, count: 3 }]);
  });
});

describe('取用：先归位，再 FEFO', () => {
  it('同组内先取最早到期的', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 2, 60);
    put(run, 'shelf_a', { row: 0, col: 1 }, 'canned_beans', 2, 10);

    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2);
    expect(result.taken).toBe(2);
    expect(result.batches[0]?.expiresAtDay).toBe(10);
    expect(result.shortage).toBe(0);
  });

  it('★ 归位的货架先出，哪怕它到期更晚 —— 这是"整理即战力"最直接的兑现', () => {
    const run = bareRun();
    const zone: Zone = { id: 'zone_1', name: '口粮区', color: '#C8372D', autoAccept: { categories: ['food'] } };
    run.zones = [zone];
    const shelfA = run.shelves[0];
    if (!shelfA) throw new Error('缺货架');
    run.shelves[0] = { ...shelfA, zoneId: 'zone_1' };

    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 2, 90); // 归位，晚到期
    put(run, 'shelf_b', { row: 0, col: 0 }, 'canned_beans', 2, 10); // 没归位，早到期

    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2);
    expect(result.batches[0]?.expiresAtDay).toBe(90);
  });

  it('没贴胶带 / 清单不认的货架一样能取，只是排在后面', () => {
    const run = bareRun();
    const zone: Zone = { id: 'zone_1', name: '药柜', color: '#C8372D', autoAccept: { categories: ['medicine'] } };
    run.zones = [zone];
    const shelfA = run.shelves[0];
    if (!shelfA) throw new Error('缺货架');
    run.shelves[0] = { ...shelfA, zoneId: 'zone_1' }; // 这张胶带只收医疗

    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 2, 90); // 在"药柜"里，不算归位
    put(run, 'shelf_b', { row: 0, col: 0 }, 'canned_beans', 2, 10);
    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2);
    expect(result.batches[0]?.expiresAtDay).toBe(10); // 大家都没归位 → 纯 FEFO
  });

  it('取不满时报缺口，不会凭空变出物资', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 1, 60);
    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2);
    expect(result.taken).toBe(1);
    expect(result.shortage).toBe(1);
  });

  it('★ 货架空了就翻纸箱 —— §1「不整理，也能活」不是一句口号', () => {
    const run = bareRun();
    run.boxesToUnpack = [{ id: 'box_1', defId: 'box_staple', items: [makeStack('canned_beans', 6, 60)] }];
    // 货架上一件都没有
    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2);
    expect(result.taken).toBe(2);
    expect(result.shortage).toBe(0);
    expect(result.fromBoxes).toBe(2);
    expect(result.batches.every((b) => b.from === 'box')).toBe(true);
    expect(result.boxes[0]?.items[0]?.batches[0]?.count).toBe(4);
  });

  it('货架够吃时绝不碰纸箱（整理的意义是"更快"，不是"能不能活"）', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 4, 60);
    run.boxesToUnpack = [{ id: 'box_1', defId: 'box_staple', items: [makeStack('canned_beans', 6, 10)] }];
    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2);
    // 纸箱里那批到期更早（10 < 60），但它排在货架之后
    expect(result.fromBoxes).toBe(0);
    expect(result.boxes[0]?.items[0]?.batches[0]?.count).toBe(6);
  });

  it('"还能撑几天"要把没拆的纸箱算进去', () => {
    const run = bareRun();
    run.boxesToUnpack = [{ id: 'box_1', defId: 'box_staple', items: [makeStack('mineral_water', 6, 60)] }];
    expect(countCategory(run.shelves, run.boxesToUnpack, 'water')).toBe(6);
    expect(countCategory(run.shelves, [], 'water')).toBe(0);
  });

  it('品类隔离：要食物不会把药拿走', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'bandage', 5, null);
    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2);
    expect(result.taken).toBe(0);
    expect(countCategory(result.shelves, result.boxes, 'medicine')).toBe(5);
  });
});

describe('每日结算：把整理变成数字', () => {
  it('消耗表 = §8 基础（食物 2 / 水 2）+ 寒潮加成（燃料 2）', () => {
    expect(dailyDrainOf(getDisasterDef('cold_snap'))).toEqual([
      { category: 'food', need: 2 },
      { category: 'water', need: 2 },
      { category: 'fuel', need: 2 }
    ]);
  });

  it('凑齐了：物资被扣、体力回血、庇护所被灾难磨掉、日志写一条', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 4, 60);
    put(run, 'shelf_a', { row: 0, col: 1 }, 'mineral_water', 4, 60);
    put(run, 'shelf_a', { row: 0, col: 2 }, 'fuel_can', 4, null);
    run.day = 3;
    run.stats = { health: 90, mood: 60, stamina: 50, shelter: 80 };

    const report = settleSurvivalDay(run);
    expect(report.drains.map((d) => d.taken)).toEqual([2, 2, 2]);
    expect(report.spoiledToday).toBe(0);
    expect(countCategory(run.shelves, run.boxesToUnpack, 'food')).toBe(2);
    expect(countCategory(run.shelves, run.boxesToUnpack, 'water')).toBe(2);
    expect(countCategory(run.shelves, run.boxesToUnpack, 'fuel')).toBe(2);
    expect(run.stats.stamina).toBe(65); // 50 + 15
    expect(run.stats.shelter).toBeLessThan(80); // 灾难开始磨损
    expect(run.log.some((line) => line.startsWith('D+3 · 消耗'))).toBe(true);
    expect(run.survival.last.stamina).toBe(15);
    expect(run.survival.shortageDays).toBe(0);
  });

  it('凑不齐：记缺口、扣健康与心情、累计缺货天数 +1（§12.3 不死人，只是变难）', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 1, 60); // 只有 1 件食物
    run.day = 2;
    run.stats = { health: 100, mood: 100, stamina: 100, shelter: 100 };

    const report = settleSurvivalDay(run);
    const foodLine = report.drains.find((d) => d.category === 'food');
    expect(foodLine?.shortage).toBe(1);
    expect(run.stats.health).toBeLessThan(100);
    expect(run.stats.mood).toBeLessThan(100);
    expect(run.survival.shortageDays).toBe(1);
    expect(report.drains.reduce((n, d) => n + d.shortage, 0)).toBeGreaterThan(0);
  });

  it('四维都夹在 0..100（不会因为连续缺货变成负数）', () => {
    const run = bareRun();
    run.day = 5;
    run.stats = { health: 2, mood: 1, stamina: 0, shelter: 1 };
    settleSurvivalDay(run);
    expect(run.stats.health).toBeGreaterThanOrEqual(0);
    expect(run.stats.mood).toBeGreaterThanOrEqual(0);
    expect(run.stats.stamina).toBeGreaterThanOrEqual(0);
    expect(run.stats.shelter).toBeGreaterThanOrEqual(0);
  });

  it('结算自己不动 day —— 推进日历是命令的职责，不是结算的', () => {
    const run = bareRun();
    run.day = 4;
    settleSurvivalDay(run);
    expect(run.day).toBe(4);
  });

  it('归位率越高心情越好，越低越是负担（但永远只是心情，不是判罚）', () => {
    expect(moodFromPlacement(1)).toBe(4);
    expect(moodFromPlacement(0.8)).toBe(4);
    expect(moodFromPlacement(0.5)).toBe(1);
    expect(moodFromPlacement(0.2)).toBe(-2);
    expect(moodFromPlacement(0)).toBe(-4);
  });

  it('整理得好的存档，心情净收益比乱的高（同一天、同样有粮）', () => {
    const tidy = bareRun();
    const messy = bareRun();
    for (const run of [tidy, messy]) {
      put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 4, 60);
      put(run, 'shelf_b', { row: 0, col: 1 }, 'mineral_water', 4, 60);
      put(run, 'shelf_c', { row: 0, col: 2 }, 'fuel_can', 4, null);
      run.day = 3;
      run.stats = { health: 80, mood: 60, stamina: 60, shelter: 80 };
    }
    // 给 tidy 贴上正确清单（三块货架各管一类）
    const makeZone = (id: string, name: string, category: 'food' | 'water' | 'fuel') => ({
      id,
      name,
      color: '#C8372D',
      autoAccept: { categories: [category] as ('food' | 'water' | 'fuel')[] }
    });
    tidy.zones = [makeZone('z1', '口粮', 'food'), makeZone('z2', '饮水', 'water'), makeZone('z3', '燃料', 'fuel')];
    tidy.shelves = tidy.shelves.map((shelf, index) => ({ ...shelf, zoneId: ['z1', 'z2', 'z3'][index] ?? null }));

    settleSurvivalDay(tidy);
    settleSurvivalDay(messy);
    expect(tidy.stats.mood).toBeGreaterThan(messy.stats.mood);
  });
});

describe('生存期命令与状态机', () => {
  it('囤货期最后一天过完 → 落在 D-Day（survival_day / day 0，还没吃第一顿）', () => {
    const store = new GameStore(createSaveGame(createStartingRun(7)), createSaveSchedulerStub());
    chooseIdentity(store, 'group_buyer');
    for (let i = 0; i < 7; i++) {
      goHome(store);
      endDay(store);
      if (store.run.phase === 'night') {
        chooseNightOption(store, NIGHT_SLEEP);
        sleep(store);
      }
    }
    expect(store.run.phase).toBe('survival_day');
    expect(store.run.day).toBe(0);
  });

  it('开始撑：day 0 → 1 并立刻结算 D+1', () => {
    const store = storeAtDDay();
    const result = startSurvival(store);
    expect(result.ok).toBe(true);
    expect(store.run.day).toBe(1);
    expect(store.run.survival.last.spoiled).toBe(0); // 寒潮不会坏东西
    expect(result.events.some((e) => e.type === 'survivalSettled')).toBe(true);
  });

  it('重复"开始撑"被拒（幂等，不会白算一天）', () => {
    const store = storeAtDDay();
    startSurvival(store);
    expect(startSurvival(store).ok).toBe(false);
    expect(store.run.day).toBe(1);
  });

  it('过一天：day +1 并结算；第 7 天之后再推进 → ending', () => {
    const store = storeAtDDay();
    startSurvival(store);
    for (let day = 1; day < SURVIVAL_DAYS; day++) {
      expect(advanceSurvivalDay(store).ok).toBe(true);
      expect(store.run.day).toBe(day + 1);
    }
    expect(store.run.day).toBe(SURVIVAL_DAYS);
    const done = advanceSurvivalDay(store);
    expect(done.ok).toBe(true);
    expect(store.run.phase).toBe('ending');
    expect(done.events.some((e) => e.type === 'survivalCompleted')).toBe(true);
  });

  it('D-Day 之前不能开始撑', () => {
    const store = new GameStore(createSaveGame(bareRun(3)), createSaveSchedulerStub());
    store.run.phase = 'organize';
    expect(startSurvival(store).ok).toBe(false);
  });
});
