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
import { CATEGORY_ORDER, getItemDef } from '../data/items';
import { NIGHT_SLEEP } from '../data/nightEvents';
import { moodFromPlacement, dailyDrainOf, hardPressTier, workCostOf } from '../data/survival';
import { consumeCategory, countCategory } from '../model/consume';
import { fefoSorted, makeStack, setSlotStack } from '../model/shelf';
import { isBatchSpoiled, spoilEverything, virtualDay } from '../model/spoil';
import type { CategoryId, ItemStack, RunState, SlotPos, UnpackBox, Zone } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { declineRequest } from './help';
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

/**
 * 给货架备足 `days` 天的口粮（主食 / 饮水 / 燃料各 2 件一天，见 §8 的每日消耗）。
 * 一堆塞满就换下一格 —— 取 `stackLimit` 而不是硬编码，改物资表时这里不会失效。
 */
function stockFor(run: RunState, days: number): void {
  // §12.3 v0.7 之后要备 15 天的口粮：燃料一格只能叠 2 罐，光 shelf_a（24 格）放不下，
  // 所以按"货架列表游标"铺，塞满一块换下一块 —— 对用例来说仍然是"备足 N 天"一句话
  const cursors = run.shelves.map((shelf) => ({ shelf, at: 0 }));
  const nextSlot = () => {
    for (const c of cursors) {
      if (c.at < c.shelf.w * c.shelf.h) {
        const pos = { row: Math.floor(c.at / c.shelf.w), col: c.at % c.shelf.w };
        c.at += 1;
        return { shelfId: c.shelf.id, pos };
      }
    }
    throw new Error('所有货架都放不下测试用的口粮');
  };
  for (const itemId of ['canned_beans', 'mineral_water', 'fuel_can']) {
    let left = days * 2;
    while (left > 0) {
      const slot = nextSlot();
      const take = Math.min(left, getItemDef(itemId).stackLimit);
      put(run, slot.shelfId, slot.pos, itemId, take, null);
      left -= take;
    }
  }
}

/**
 * 把"门口有人"这件事处理掉。
 *
 * ★ 这个函数本身就是阶段 D 的行为说明：`advanceSurvivalDay` 之后 phase 可能**不是**
 * `survival_day` 而是 `help_request` —— 门口站着人时，玩家得先给个答复，日历才走得下去。
 * 所以任何"连续过 N 天"的用例都必须带上它，否则会在门口被卡住。
 *
 * 这里一律选婉拒 —— 这一组用例关心的是日历与四维，不是人情。
 */
function resolveHelpIfAny(store: GameStore): void {
  if (store.run.phase !== 'help_request') return;
  declineRequest(store);
}

/**
 * 找第一个空格（测试用；找不到就抛，免得用例静默地什么都没测到）。
 * 不传 `shelfId` = 全屋按货架顺序找 —— §12.3 v0.7 之后 stockFor 会把 shelf_a 铺满，
 * 单测里补放的那件药/被经常落在后面的货架上。
 */
function freePos(run: RunState, shelfId?: string): { shelfId: string; pos: SlotPos } {
  const shelves = shelfId ? run.shelves.filter((s) => s.id === shelfId) : run.shelves;
  for (const shelf of shelves) {
    for (let row = 0; row < shelf.h; row++) {
      for (let col = 0; col < shelf.w; col++) {
        if (shelf.slots[row]?.[col]?.stack === null) return { shelfId: shelf.id, pos: { row, col } };
      }
    }
  }
  throw new Error(`没有空格（${shelfId ?? '全屋'}）`);
}

/**
 * 直接落在 D-Day 上。
 *
 * 默认**备足 15 天的口粮** —— 这一组用例关心的是"日历怎么走、命令收不收账"，
 * 不是"人会不会饿死"。断粮与倒下是另外的用例，它们自己造空货架。
 *
 * `tidy = true` 时再给每块货架贴一张**写明全部品类**的胶带 —— 要一路点满 14 天的
 * 用例必须用它：不贴胶带的屋子每天净掉 7.8 体力，走到 D+13 就累死了（这正是 v0.7 的本意，
 * 但那些用例要测的是日历，不是这个）。数值断言（19.8 那组）仍然用默认的乱档。
 *
 * ★ §12 v0.8 之后这张胶带必须**写全清单**：空清单的胶带归位率是 0，
 * 和"全堆在纸箱里"等价 —— 用它来当"整理好的档"已经不成立了。
 * 清单直接取 `CATEGORY_ORDER`（七个品类全收），也就是造一个"什么都收"的等价物。
 */
function storeAtDDay(seed = 20261001, days = SURVIVAL_DAYS + 1, tidy = false): GameStore {
  const run = bareRun(seed);
  stockFor(run, days);
  if (tidy) {
    run.zones = [{ id: 'zone_all', name: '全收', color: '#000000', autoAccept: { categories: [...CATEGORY_ORDER] } }];
    // 顺手位一起标上：这一组用例要测的是**日历怎么走**，不是"没标顺手位会怎样"。
    // 不标的话，突发事件（M2）每天都会真的受创，走到 D+13 就撑不住了 ——
    // 那条曲线由"没标顺手位"那条专门用例负责（见全周期探针那一组）
    run.shelves = run.shelves.map((s, i) => ({
      ...s,
      zoneId: 'zone_all',
      handyRank: i === 0 ? 1 : null
    }));
  }
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
    // 体力 = 睡觉 +12 − 翻找劳作。这一屋没有分区（placement 0）、同架按到期日排好了（fefo 1），
    // 质量 = 0.6×0 + 0.4×1 = 0.4 → 每件 3.3 → 6 件共 19.8。
    // 这就是 §6.4「乱 → 翻找耗时」在数值上的落点。
    expect(report.workCost).toBeCloseTo(19.8, 1);
    expect(report.fromShelves).toBe(6);
    expect(report.fromBoxes).toBe(0);
    expect(run.stats.stamina).toBeCloseTo(42.2, 1); // 50 + 12 − 19.8
    expect(run.stats.shelter).toBeLessThan(80); // 灾难开始磨损
    expect(run.log.some((line) => line.startsWith('D+3 · 消耗'))).toBe(true);
    expect(run.survival.last.stamina).toBeCloseTo(-7.8, 1); // 12 − 19.8
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

  it('过一天：day +1 并结算；第 14 天之后再推进 → ending', () => {
    const store = storeAtDDay(20261001, SURVIVAL_DAYS + 1, true);
    startSurvival(store);
    resolveHelpIfAny(store);
    for (let day = 1; day < SURVIVAL_DAYS; day++) {
      expect(advanceSurvivalDay(store).ok).toBe(true);
      resolveHelpIfAny(store);
      expect(store.run.day).toBe(day + 1);
    }
    expect(store.run.day).toBe(SURVIVAL_DAYS);
    const done = advanceSurvivalDay(store);
    expect(done.ok).toBe(true);
    expect(store.run.phase).toBe('ending');
    expect(store.run.outcome).toBe('survived'); // 囤够的人拿到的是"撑过去了"
    expect(done.events.some((e) => e.type === 'survivalCompleted')).toBe(true);
  });

  it('D-Day 之前不能开始撑', () => {
    const store = new GameStore(createSaveGame(bareRun(3)), createSaveSchedulerStub());
    store.run.phase = 'organize';
    expect(startSurvival(store).ok).toBe(false);
  });
});

describe('M1 平衡改造：整理质量真的会变成体力，撑不住真的会结束', () => {
  it('劳作成本：整理质量从满分掉到 0，同样 6 件货要多花两倍体力（§6.4「乱 → 翻找耗时」）', () => {
    // 一天固定翻 6 件（主食 2 / 饮水 2 / 燃料 2）
    expect(workCostOf(1, 1, 6)).toBeCloseTo(9, 1); // 每件 1.5
    expect(workCostOf(0, 0, 6)).toBeCloseTo(27, 1); // 每件 4.5
    // 断粮那天没东西可翻，劳作自然是 0 —— 但它同时会被缺货惩罚砸得更狠
    expect(workCostOf(0, 0, 0)).toBe(0);
  });

  it('同样的货、同样的天：**写了清单**的那一份，第二天体力明显更宽裕', () => {
    const build = (): RunState => {
      const run = bareRun();
      put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 4, 60);
      put(run, 'shelf_a', { row: 0, col: 1 }, 'mineral_water', 4, 60);
      put(run, 'shelf_a', { row: 0, col: 2 }, 'fuel_can', 4, null);
      run.day = 3;
      run.stats = { health: 90, mood: 60, stamina: 50, shelter: 80 };
      return run;
    };
    const messy = build();
    const tidy = build();
    // 两份只差一件事：tidy 给这块货架贴了一张**写明三个品类**的胶带 → 归位率 0 → 100%
    // ★ §12 v0.8：这里必须写清单。空清单的胶带归位率也是 0，
    // 用它当"整理好的档"会得出"整理完全没用"的结论 —— 而那正是修复要澄清的事：
    // **真正起作用的是清单，不是胶带本身**。
    tidy.zones = [
      { id: 'zone_all', name: '全收', color: '#000000', autoAccept: { categories: ['food', 'water', 'fuel'] } }
    ];
    tidy.shelves = tidy.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, zoneId: 'zone_all' } : s));

    const messyReport = settleSurvivalDay(messy);
    const tidyReport = settleSurvivalDay(tidy);

    expect(messyReport.quality).toBeLessThan(tidyReport.quality);
    expect(messyReport.workCost).toBeGreaterThan(tidyReport.workCost);
    expect(messy.stats.stamina).toBeLessThan(tidy.stats.stamina);
    // 一天差 10.8 点体力（19.8 − 9.0）—— 14 天下来就是"能不能睡够觉"的区别
    expect(tidy.stats.stamina - messy.stats.stamina).toBeCloseTo(10.8, 1);
  });

  it('★ §12 v0.8：**只上架、不写清单**与"全堆在纸箱里"的差别，只剩"排架"那 0.4', () => {
    // 这条用例是那次修复的账本。两者归位率**同为 0** —— loophole 修掉了。
    // 剩下的差别全部来自 fefo：上了架、而且是按到期日排的，就拿得到那 0.4 的权重；
    // 纸箱不计入 fefo（fefoRate 只数货架），所以那 0.4 也拿不到。
    const plain = bareRun();
    put(plain, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 4, 60);
    put(plain, 'shelf_a', { row: 0, col: 1 }, 'mineral_water', 4, 60);
    put(plain, 'shelf_a', { row: 0, col: 2 }, 'fuel_can', 4, null);
    plain.day = 3;
    plain.stats = { health: 90, mood: 60, stamina: 50, shelter: 80 };
    // 贴一张空胶带（"我不分类"）—— 老口径下这会让归位率恒满
    plain.zones = [{ id: 'zone_all', name: '全收', color: '#000000' }];
    plain.shelves = plain.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, zoneId: 'zone_all' } : s));

    const boxed = bareRun();
    boxed.boxesToUnpack = [
      {
        id: 'b1',
        defId: 'box_staple',
        items: [makeStack('canned_beans', 4, 60), makeStack('mineral_water', 4, 60), makeStack('fuel_can', 4, null)]
      }
    ];
    boxed.day = 3;
    boxed.stats = { health: 90, mood: 60, stamina: 50, shelter: 80 };

    const plainReport = settleSurvivalDay(plain);
    const boxedReport = settleSurvivalDay(boxed);

    expect(plainReport.placement).toBe(0);
    expect(boxedReport.placement).toBe(0);
    // 空胶带**没有**给归位率带来任何分：它和"没贴胶带"完全一样
    expect(plainReport.quality).toBeCloseTo(0.4, 5);
    expect(boxedReport.quality).toBeCloseTo(0, 5);
    // 每件 3.3 vs 4.5，6 件 → 19.8 vs 27
    expect(plainReport.workCost).toBeCloseTo(19.8, 5);
    expect(boxedReport.workCost).toBeCloseTo(27, 5);
    // 而"纸箱里翻出来的"这一行仍然只说真话：上了架的一件都不用翻
    expect(plainReport.fromBoxes).toBe(0);
    expect(boxedReport.fromBoxes).toBe(6);
  });

  it('健康跌破触发线会自动开药箱，补到线上就停（不吃冤枉药）', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 1);
    const slot = freePos(run);
    put(run, slot.shelfId, slot.pos, 'bandage', 1, null);
    run.day = 3;
    run.stats = { health: 65, mood: 60, stamina: 50, shelter: 80 };

    const report = settleSurvivalDay(run);
    // 65 → 71（一卷绷带 +6）已经越过 70，不该再拆第二件
    expect(report.usedMedicine).toBe(1);
    expect(report.deltas.health).toBe(6);
    expect(run.stats.health).toBe(71);
    expect(countCategory(run.shelves, run.boxesToUnpack, 'medicine')).toBe(0);
  });

  it('屋子冷了会自动添被 —— 保暖品终于有用途（§8 寒潮刚需里的 warmth）', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 1);
    const slot = freePos(run);
    put(run, slot.shelfId, slot.pos, 'quilt', 1, null);
    run.day = 3; // 强度 0.8 → 庇护所磨损 −6
    run.stats = { health: 90, mood: 60, stamina: 50, shelter: 55 };

    const report = settleSurvivalDay(run);
    expect(report.usedWarmth).toBe(1);
    expect(report.deltas.shelter).toBe(6); // −6 磨损，+12 添被（棉被 comfort 3 × 4）
    expect(run.stats.shelter).toBe(61); // 55 − 6 + 12，越过 60 就停手
  });

  it('缺货把四维压到线下 → 当天记一次硬撑，代价再叠一层（§12.3 v0.5）', () => {
    const run = bareRun(); // 空货架 = 全断
    run.day = 3;
    run.stats = { health: 44, mood: 60, stamina: 50, shelter: 80 };

    const report = settleSurvivalDay(run);
    expect(report.hardPress).toBe(true);
    expect(run.survival.hardPressDays).toBe(1);
    expect(report.workCost).toBe(0); // 没东西可翻
    expect(report.deltas.health).toBe(-18 - 3); // 缺货 6 件、封顶 3 倍 = −18；硬撑再 −3
    expect(run.stats.health).toBe(23);
  });

  it('体力见底就翻不动了：货有的是，人也只能拿到一半（§6.4「翻找耗时」的极端形态）', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 1);
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 20, shelter: 100 }; // 低于 EXHAUSTED_STAMINA

    const report = settleSurvivalDay(run);
    expect(report.unreachable).toBe(3); // 三个品类各少拿 1 件（2 件 → 1 件）
    expect(report.fromShelves).toBe(3);
    // 关键：这不是"没有"，是"拿不动" —— 两个数必须分得开，界面才能说对话
    expect(report.drains.every((d) => d.shortage === 0)).toBe(true);
    expect(report.hardPress).toBe(true);
  });

  it('★ 一直点"过一天"不会自动通关：断粮的人会走到 collapsed，而且撑不到第 7 天', () => {
    const store = new GameStore(createSaveGame(bareRun()), createSaveSchedulerStub());
    // 用 commit 摆状态，而不是直接写 `store.run.phase = 'survival_day'`：
    // 直接赋值会让 TS 把 `store.run.phase` 收窄成 `'survival_day'`，
    // 于是下面那句"什么时候走到 ending"的比较会被判成**不可能成立**。
    store.commit((d) => {
      d.phase = 'survival_day';
      d.day = 0;
    });
    startSurvival(store);

    let guard = 0;
    while (store.run.phase !== 'ending' && guard < 40) {
      if (store.run.phase === 'help_request') declineRequest(store);
      else advanceSurvivalDay(store);
      guard += 1;
    }

    expect(store.run.phase).toBe('ending');
    expect(store.run.outcome).toBe('collapsed');
    expect(store.run.stats.health).toBe(0);
    expect(store.run.survival.hardPressDays).toBeGreaterThan(0);
    expect(store.run.day).toBeLessThan(SURVIVAL_DAYS); // 没撑到第 7 天就停下来了
  });
});

// ———————— 全周期探针用的"同一批货"（§12 v0.7/v0.8 的实测口径） ————————

/**
 * 四档探针共用的同一批货：14 天口粮 30/30/30 + 药 + 两床被。
 *
 * 刻意把它抽成一个常量而不是在四处各写一遍：探针的全部意义就是
 * **只改"怎么摆"，不改"有什么"** —— 一旦四份货不一样，那四条曲线就没法互相对照了。
 */
function probeLarder(): UnpackBox[] {
  return [
    {
      id: 'b1',
      defId: 'box_staple',
      items: [
        makeStack('instant_noodles', 8, null),
        makeStack('instant_noodles', 8, null),
        makeStack('instant_noodles', 8, null),
        makeStack('instant_noodles', 6, null)
      ]
    },
    {
      id: 'b2',
      defId: 'box_staple',
      items: [
        makeStack('mineral_water', 6, null),
        makeStack('mineral_water', 6, null),
        makeStack('mineral_water', 6, null),
        makeStack('mineral_water', 6, null),
        makeStack('mineral_water', 6, null)
      ]
    },
    { id: 'b3', defId: 'box_mixed', items: Array.from({ length: 15 }, () => makeStack('fuel_can', 2, null)) },
    { id: 'b4', defId: 'box_medical', items: [makeStack('bandage', 4, null)] },
    { id: 'b5', defId: 'box_mixed', items: [makeStack('quilt', 1, null), makeStack('quilt', 1, null)] }
  ];
}

/**
 * 把纸箱里的货按**品类**铺到货架上，并贴好写全清单的胶带。这就是"整理好的档"。
 *
 * 两条刻意的安排：
 *
 *  1. **清单必须写全** —— §12 v0.8 之后没有清单的胶带不算整理（归位率 0），
 *     拿它当"好档"会得出"整理完全没用"的结论；
 *  2. **应急品类（医疗 / 燃料）优先铺到第一块货架上**，`handy = true` 时那块就是顺手位。
 *     这不是为了让测试好看，而是"整理好的档"在 §5 那套口径下的**定义**：
 *     急救品放在够得到的地方。不这么铺，顺手位上就没有药，
 *     突发事件（`data/emergencies.ts`）每次都化解不掉 —— 那是另一条用例要测的反面。
 */
function shelveEverything(run: RunState, handy = true): void {
  const EMERGENCY_CATEGORIES: CategoryId[] = ['medicine', 'fuel'];
  const all: ItemStack[] = [];
  for (const box of run.boxesToUnpack) all.push(...box.items);
  run.boxesToUnpack = [];

  const first = all.filter((s) => EMERGENCY_CATEGORIES.includes(getItemDef(s.itemId).category));
  const rest = all.filter((s) => !EMERGENCY_CATEGORIES.includes(getItemDef(s.itemId).category));

  const place = (shelfId: string, stacks: ItemStack[]): void => {
    const shelf = run.shelves.find((s) => s.id === shelfId);
    if (!shelf) return;
    let at = 0;
    for (const stack of stacks) {
      if (at >= shelf.w * shelf.h) break;
      const pos = { row: Math.floor(at / shelf.w), col: at % shelf.w };
      at += 1;
      run.shelves = run.shelves.map((s) => (s.id === shelfId ? setSlotStack(s, pos, stack) : s));
    }
  };

  place('shelf_a', first);
  place('shelf_b', rest.slice(0, 24));
  place('shelf_c', rest.slice(24, 48));

  run.zones = [{ id: 'zone_all', name: '全收', color: '#000000', autoAccept: { categories: [...CATEGORY_ORDER] } }];
  // 顺手位**全屋唯一**（§12.3 v0.7.1）：标第一块。急救品因此也落在它上面 ——
  // 这正是"整理好的档"该有的样子，也是应急可达率有意义的唯一前提
  run.shelves = run.shelves.map((s, i) => ({ ...s, zoneId: 'zone_all', handyRank: handy && i === 0 ? 1 : null }));
}

/** 一键 FEFO（等价于整理页那颗按钮） */
function fefoAll(run: RunState): void {
  run.shelves = run.shelves.map((s) => fefoSorted(s));
}

/**
 * 跑完一整局并回报轨迹。探针只关心四件事：走到第几天、结局、体力最低点、硬撑几天。
 * `fixAtDay` 非空时在第 N 天结算前"补救"（全上架 + 写清单 + FEFO）——
 * 那是"中途补救必须有用"那条的落点。
 */
/**
 * 单局探针的跑法。`seed` 决定**这一局是什么货**（开局三箱的内容 + 突发事件序列），
 * 所以它对"好不好"极其敏感 —— 一条探针结论必须至少跨两个 seed 成立才算结论，
 * 否则它测的是那一局的运气，不是规则。用法见下面的探针用例。
 */
function runProbe(build: (run: RunState) => void, fixAtDay: number | null = null, seed = 20261001) {
  const run = bareRun(seed);
  run.boxesToUnpack = probeLarder();
  run.day = 0;
  run.phase = 'survival_day';
  build(run);
  const store = new GameStore(createSaveGame(run), createSaveSchedulerStub());
  startSurvival(store);
  resolveHelpIfAny(store);

  let staminaFloor = store.run.stats.stamina;
  /**
   * 这一局碰上的突发事件，以及它们**化解了没有**。
   *
   * 「顺手位到底管不管用」要直接量这个，而不是反推体力 —— 理由见下面那条用例的注释：
   * 体力是被短缺、劳作、睡眠、硬撑一起搅动的数，拿它当探针会把"机制没生效"
   * 读成"这局运气好"，而我就真的这么误读过一次。
   */
  const emergencies: { id: string; resolved: boolean }[] = [];
  /** 每天的体力（跑完之后读，用来读"下沉有没有被止住"） */
  const staminaByDay: number[] = [];
  let guard = 0;
  while (store.run.phase === 'survival_day' && guard < 60) {
    if (fixAtDay !== null && store.run.day === fixAtDay) {
      shelveEverything(store.run);
      fefoAll(store.run);
    }
    advanceSurvivalDay(store);
    resolveHelpIfAny(store);
    staminaFloor = Math.min(staminaFloor, store.run.stats.stamina);
    staminaByDay.push(store.run.stats.stamina);
    if (store.run.survival.last.emergencyId) {
      emergencies.push({
        id: store.run.survival.last.emergencyId,
        resolved: store.run.survival.last.emergencyResolved
      });
    }
    guard += 1;
  }
  return {
    day: store.run.day,
    outcome: store.run.outcome,
    staminaFloor,
    staminaByDay,
    hardPressDays: store.run.survival.hardPressDays,
    health: store.run.stats.health,
    mood: store.run.stats.mood,
    emergencies
  };
}

describe('★ 全周期探针（§12.3 v0.7 / §12 v0.8 的永久回归）：好档活、乱档倒、中途补救有用', () => {
  it('好档：全上架 + 写全清单 + FEFO + 标顺手位 → 撑过 14 天', () => {
    const good = runProbe((run) => {
      shelveEverything(run);
      fefoAll(run);
    });
    expect(good.outcome).toBe('survived');
    expect(good.day).toBe(SURVIVAL_DAYS);
    expect(good.hardPressDays).toBe(0);
    // 实测轨迹（14 天）：体力 100 → 88、健康 100 → 70、庇护所一路被磨到 22。
    // 整理质量 1.0 → 每天 6 件 × 1.5 = 9 点，睡一觉回 12 —— 净 +3；
    // 突发事件标了顺手位就化解得掉，所以它不该把这条曲线拽下去。
    // 后程那几点体力是庇护所跌破 40 之后"睡不踏实"扣的（§12.3 v0.7），不是整理的问题。
    expect(good.staminaFloor).toBeGreaterThan(80);
    expect(good.health).toBeGreaterThan(60);
  });

  it('★ 标了顺手位 → 突发事件化解得掉；没标 → 每一件都受创（§5 的下游）', () => {
    /*
     * 这条用例钉的是 §5 那句「应急货架（门口/最顺手位）放急救品 → 突发事件不掉健康」。
     *
     * ## ★ 判据 M3 换过一次，因为**原来的判据是假绿**
     *
     * 原来的写法是：`expect(noHandy.staminaFloor).toBeLessThan(withHandy.staminaFloor)`
     * —— 拿"体力下限更低"当"顺手位有用"的证据。它戴着**跨三个 seed** 的帽子，
     * 看起来相当硬。但 M3 补进 21 条突发事件之后它红了（86 对 86），
     * 而查下去发现的目标不是"机制坏了"，是**这条断言从来就没在量那件事**：
     *
     *   · 突发事件表的品类从"医疗 / 燃料"扩到**七个品类全覆盖**
     *     （每类各 3 条），其中有一批要的是 `needOnHandy: 2~3`；
     *   · 而这批探针货里只有 2 床被子、5 瓶水、1 卷绷带、1 罐燃料，
     *     铺货规则（`shelveEverything`）只把**医疗与燃料**铺在第一块货架（= 顺手位）。
     *     于是新事件要的 `warmth×3` / `water×2` / `luxury×2` / `food×2`
     *     **两种摆法下都凑不齐** —— 顺不顺手位，结果完全一样（四件全受创）。
     *   · 体力下限之所以曾经"看得出差别"，是因为早期事件真的要医疗与燃料，
     *     而那两样正是被刻意铺在顺手位上的。判据只是在**蹭**那个巧合。
     *
     * 换句话说：它此前能过，靠的是"突发事件恰好只要那两类"这个**内容侧的事实**，
     * 而不是"顺手位这条机制"。这种断言一旦内容变了就会用一条误导性的报错
     * （"体力没差"）指向一个错误的方向。
     *
     * ## 所以现在直接量那件机制本身
     *
     * 逐件看**化解了没有**（`emergencyResolved`）：
     *   · 标了顺手位 → 落在顺手位上的那几类必须化解得掉；
     *   · 没标 → 一件都不该化解（`handyRank` 为 null 时顺手位是空的）。
     * 它不依赖"这一局体力曲线长什么样"，也不依赖"这批货恰好有什么"。
     *
     * ★ 仍然跨 seed：突发事件的抽签吃种子，单跑一局可能一件都碰不上。
     */
    for (const seed of [20261001, 777, 4242]) {
      const noHandy = runProbe(
        (run) => {
          shelveEverything(run, false);
          fefoAll(run);
        },
        null,
        seed
      );
      const withHandy = runProbe(
        (run) => {
          shelveEverything(run, true);
          fefoAll(run);
        },
        null,
        seed
      );
      // 两种摆法碰上的突发事件必须是同一批 —— 只有顺手位这一个变量在变，
      // 否则这条对比就不成立了（这也是"只改怎么摆，不改有什么"那条口径的延长）
      expect(noHandy.emergencies.map((e) => e.id)).toEqual(withHandy.emergencies.map((e) => e.id));
      // 没标顺手位 → 顺手位是空的 → 每一件都受创
      expect(noHandy.emergencies.every((e) => !e.resolved), `seed=${seed} 没标顺手位却化解掉了`).toBe(true);
      /*
       * 标了之后不少于没标 —— 这是**这条用例能保证的那一半**。
       *
       * ★ 刻意不写成"必须化解掉至少一件"：那取决于这批货里到底有没有
       * 顺手位上那几类（而这批探针货是固定的一批口粮，不是为此设计的）。
       * 我试过那个更硬的写法，它当场就红了 —— 于是我差点又走一遍
       * "把 fixture 调到让断言变绿"的老路，那正是这条用例原来假绿的成因。
       *
       * "顺手位对**每一个品类**都真的有用"由
       * `emergency.test.ts` 的「★★ 表里的每一个品类都有一条能化解它的路」守着 ——
       * 那条才是这个机制的守卫，这里只负责"在真实的一局里它没被接错线"。
       */
      expect(withHandy.emergencies.filter((e) => e.resolved).length).toBeGreaterThanOrEqual(
        noHandy.emergencies.filter((e) => e.resolved).length
      );
      // 两种摆法都撑得过 14 天 —— §5 引擎①「不整理也能活」没有被推翻，
      // 它只是从"没有代价"变成了"代价看得见"
      expect(noHandy.outcome).toBe('survived');
      expect(withHandy.outcome).toBe('survived');
    }
  });

  it('好档：全上架 + 写全清单 + FEFO + 标顺手位 → 撑过 14 天', () => {
    const good = runProbe((run) => {
      shelveEverything(run);
      fefoAll(run);
    });
    expect(good.outcome).toBe('survived');
    expect(good.day).toBe(SURVIVAL_DAYS);
    expect(good.hardPressDays).toBe(0);
    // 实测轨迹（14 天）：体力 100 → 88、健康 100 → 70、庇护所一路被磨到 22。
    // 整理质量 1.0 → 每天 6 件 × 1.5 = 9 点，睡一觉回 12 —— 净 +3；
    // 突发事件里化解得掉的那几条不额外扣分，所以它不该把这条曲线拽下去。
    // 后程那几点体力是庇护所跌破 40 之后"睡不踏实"扣的（§12.3 v0.7），不是整理的问题。
    expect(good.staminaFloor).toBeGreaterThan(80);
    expect(good.health).toBeGreaterThan(60);
  });

  it('乱档：同一批货全堆在纸箱里 → 活不到第 14 天', () => {
    const messy = runProbe(() => undefined);
    expect(messy.outcome).toBe('collapsed');
    expect(messy.day).toBeLessThan(SURVIVAL_DAYS);
    expect(messy.hardPressDays).toBeGreaterThan(0);
    // 质量 0 → 每天 27 点，睡一觉只回 12 —— 第一天就在往下掉
    expect(messy.staminaFloor).toBe(0);
  });

  it('中途补救：乱档在第 2 天全部上架 + 写清单 + FEFO → 撑过 14 天', () => {
    const messy = runProbe(() => undefined);
    const rescued = runProbe(() => undefined, 2);

    // 乱档的轨迹（实测）：体力 70 → 55 → 40 → 23 → 4.5 → 0，D+6 起趴在 0 上，
    // D+10 健康归零。每天净 -15 体力，睡一觉回的那 12 点根本不够。
    expect(messy.outcome).toBe('collapsed');
    expect(messy.day).toBeLessThan(SURVIVAL_DAYS);
    expect(messy.staminaFloor).toBe(0);

    // 同一天补救（实测）：体力止跌回升，不再穿底；健康虽然已经掉了 24 点，
    // 但从此不再往下走。★ 逆转口的形状是"**在下沉变成欠债之前**把它止住"：
    // D+2 补救 → 撑过去；D+5 补救 → 照样 D+10 倒下
    // （那时体力已经趴在 0 上，"翻不动 → 少拿 → 缺货扣健康"那一段启动了）。
    // 所以 §12.3 v0.5 那句"代价都可逆、都能爬回来"要补一个前提：
    // **爬回来的窗口是有限的**，过了窗口，账就从体力转成了健康。
    expect(rescued.outcome).toBe('survived');
    expect(rescued.day).toBe(SURVIVAL_DAYS);
    expect(rescued.day).toBeGreaterThan(messy.day);
    expect(rescued.staminaFloor).toBeGreaterThan(40);
    expect(rescued.staminaFloor).toBeGreaterThan(messy.staminaFloor);
    // 补救之后下沉确实停住了：体力在回升，而不是像乱档那样一路往下
    expect(rescued.staminaByDay[2] as number).toBeGreaterThan(rescued.staminaByDay[0] as number);
  });
});

describe('硬撑分档：把"下沉"变成看得见的位置（§12.3 v0.6）', () => {
  it('连续第 1~2 天是「硬撑」，第 3 天起「撑不住」，第 5 天起「快垮了」', () => {
    expect(hardPressTier(0).name).toBe('硬撑');
    expect(hardPressTier(1).name).toBe('硬撑');
    expect(hardPressTier(2).name).toBe('撑不住');
    expect(hardPressTier(3).name).toBe('撑不住');
    expect(hardPressTier(4).name).toBe('快垮了');
    expect(hardPressTier(9).name).toBe('快垮了');
  });

  it('★ 「撑不住」会真的多烧一份口粮 —— 这才叫难度，不只是四维掉几点', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 1);
    run.day = 3;
    // 体力 30 < 硬撑线 40 → 天亮时就在硬撑里
    run.stats = { health: 100, mood: 100, stamina: 30, shelter: 100 };
    run.survival.hardPressStreak = 2; // 已经连续两天 → 今天是"撑不住"

    const report = settleSurvivalDay(run);
    // 基础主食 2 件 + 硬撑加成 1 件。账记在**需求侧**，玩家会在库存表上看到那一天多掉一件
    expect(report.drains.find((d) => d.category === 'food')?.need).toBe(3);
    expect(report.hardPressLevel).toBe('failing');
    expect(run.survival.hardPressStreak).toBe(3);
  });

  it('「快垮了」多烧的是主食和燃料各一份', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 1);
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 30, shelter: 100 };
    run.survival.hardPressStreak = 4;

    const report = settleSurvivalDay(run);
    expect(report.drains.find((d) => d.category === 'food')?.need).toBe(4); // 2 + 2
    expect(report.drains.find((d) => d.category === 'fuel')?.need).toBe(3); // 2 + 1
    expect(report.hardPressLevel).toBe('collapsing');
  });

  it('★ 体力见底时，顺手位上的东西是你唯一还够得到的（§5 的应急货架）', () => {
    const build = (handy: boolean): RunState => {
      const run = bareRun();
      // 只备一天的量，全放在同一块货架上
      put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 2, null);
      put(run, 'shelf_a', { row: 0, col: 1 }, 'mineral_water', 2, null);
      put(run, 'shelf_a', { row: 0, col: 2 }, 'fuel_can', 2, null);
      run.day = 3;
      run.stats = { health: 90, mood: 60, stamina: 10, shelter: 80 }; // 10 < EXHAUSTED_STAMINA
      if (handy) run.shelves = run.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, handyRank: 1 } : s));
      return run;
    };

    // 不在顺手位：翻不动，每样只能拿到一半（2 → 1）
    const plain = settleSurvivalDay(build(false));
    expect(plain.drains.every((d) => d.taken === 1)).toBe(true);

    // 在顺手位：那块货架上的东西不用翻，照旧全拿得到。
    // 这就是 §5「应急货架（门口/最顺手位）」在数值上的落点。
    const handy = settleSurvivalDay(build(true));
    expect(handy.drains.every((d) => d.taken === 2)).toBe(true);
  });

  it('★ §12.3 v0.7：同一批货，摆上架活满 14 天，堆在纸箱里活不过 14 天', () => {
    // 玩家原话："不能任何时候一直点下一天就能完事"。这条用例就是那条诉求的回归测试。
    const messy = bareRun();
    messy.boxesToUnpack = [
      { id: 'b1', defId: 'box_staple', items: [makeStack('instant_noodles', 8, null), makeStack('instant_noodles', 8, null), makeStack('instant_noodles', 8, null), makeStack('instant_noodles', 6, null)] },
      { id: 'b2', defId: 'box_staple', items: [makeStack('mineral_water', 6, null), makeStack('mineral_water', 6, null), makeStack('mineral_water', 6, null), makeStack('mineral_water', 6, null), makeStack('mineral_water', 6, null)] },
      { id: 'b3', defId: 'box_mixed', items: Array.from({ length: 15 }, () => makeStack('fuel_can', 2, null)) },
      { id: 'b4', defId: 'box_medical', items: [makeStack('bandage', 4, null)] },
      { id: 'b5', defId: 'box_mixed', items: [makeStack('quilt', 1, null), makeStack('quilt', 1, null)] }
    ];
    const store = new GameStore(createSaveGame(messy), createSaveSchedulerStub());
    store.run.day = 0;
    store.run.phase = 'survival_day';
    startSurvival(store);
    resolveHelpIfAny(store);

    let guard = 0;
    while (store.run.phase === 'survival_day' && guard < 40) {
      advanceSurvivalDay(store);
      resolveHelpIfAny(store);
      guard += 1;
    }
    // 物资管够（30/30/30 + 药 + 被）也没用 —— 体力穿底 → 翻不动 → 硬撑爬档 → 健康归零
    expect(store.run.outcome).toBe('collapsed');
    expect(store.run.day).toBeLessThan(SURVIVAL_DAYS);
    expect(store.run.survival.hardPressDays).toBeGreaterThan(0);
  });

  it('§12.3 v0.7：庇护所跌破 40 → 睡觉只回一半（warmth 终于有了下游）', () => {
    const build = (shelter: number): RunState => {
      const run = bareRun();
      stockFor(run, SURVIVAL_DAYS + 1);
      run.day = 3;
      // 体力 60：结算后仍高于硬撑线 40，避开硬撑档对这个对照的干扰
      run.stats = { health: 90, mood: 60, stamina: 60, shelter };
      return run;
    };
    // 两份只差庇护所：35 的那晚睡不踏实。劳作同为 19.8（quality 0.4 的乱档 6 件）
    const coldRun = build(35);
    const warmRun = build(80);
    const cold = settleSurvivalDay(coldRun);
    const warm = settleSurvivalDay(warmRun);
    expect(cold.deltas.stamina).toBeCloseTo(6 - 19.8, 1); // 回一半
    expect(warm.deltas.stamina).toBeCloseTo(12 - 19.8, 1); // 睡满
    expect(warmRun.stats.stamina - coldRun.stats.stamina).toBeCloseTo(6, 1);
  });

  it('缓过来了连续天数立刻归零（档位算的是连续，不是累计）', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 1);
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 100, shelter: 100 };
    run.survival.hardPressStreak = 3;

    settleSurvivalDay(run);
    expect(run.survival.hardPressStreak).toBe(0);
    expect(run.survival.hardPressDays).toBe(0);
    expect(run.survival.last.hardPressLevel).toBe('none');
  });
});
