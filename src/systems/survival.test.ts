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
import { getItemDef } from '../data/items';
import { NIGHT_SLEEP } from '../data/nightEvents';
import { moodFromPlacement, dailyDrainOf, hardPressTier, workCostOf } from '../data/survival';
import { consumeCategory, countCategory } from '../model/consume';
import { makeStack, setSlotStack } from '../model/shelf';
import { isBatchSpoiled, spoilEverything, virtualDay } from '../model/spoil';
import type { RunState, SlotPos, Zone } from '../model/types';
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
  const shelf = run.shelves[0];
  if (!shelf) throw new Error('开局没有货架');
  let at = 0;
  for (const itemId of ['canned_beans', 'mineral_water', 'fuel_can']) {
    let left = days * 2;
    while (left > 0) {
      if (at >= shelf.w * shelf.h) throw new Error('这块货架放不下测试用的口粮');
      const pos = { row: Math.floor(at / shelf.w), col: at % shelf.w };
      const take = Math.min(left, getItemDef(itemId).stackLimit);
      put(run, shelf.id, pos, itemId, take, null);
      left -= take;
      at += 1;
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

/** 找这块货架上第一个空格（测试用；找不到就抛，免得用例静默地什么都没测到） */
function freePos(run: RunState, shelfId: string): SlotPos {
  const shelf = run.shelves.find((s) => s.id === shelfId);
  if (!shelf) throw new Error(`没有货架 ${shelfId}`);
  for (let row = 0; row < shelf.h; row++) {
    for (let col = 0; col < shelf.w; col++) {
      if (shelf.slots[row]?.[col]?.stack === null) return { row, col };
    }
  }
  throw new Error(`货架 ${shelfId} 满了`);
}

/**
 * 直接落在 D-Day 上。
 *
 * 默认**备足 8 天的口粮** —— 这一组用例关心的是"日历怎么走、命令收不收账"，
 * 不是"人会不会饿死"。断粮与倒下是另外的用例，它们自己造空货架。
 */
function storeAtDDay(seed = 20261001, days = SURVIVAL_DAYS + 1): GameStore {
  const run = bareRun(seed);
  stockFor(run, days);
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

  it('过一天：day +1 并结算；第 7 天之后再推进 → ending', () => {
    const store = storeAtDDay();
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

  it('同样的货、同样的天：归位的那一份，第二天体力明显更宽裕', () => {
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
    // 两份只差一件事：tidy 给这块货架贴了一张"什么都收"的胶带 → 归位率 0 → 100%
    tidy.zones = [{ id: 'zone_all', name: '全收', color: '#000000' }];
    tidy.shelves = tidy.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, zoneId: 'zone_all' } : s));

    const messyReport = settleSurvivalDay(messy);
    const tidyReport = settleSurvivalDay(tidy);

    expect(messyReport.quality).toBeLessThan(tidyReport.quality);
    expect(messyReport.workCost).toBeGreaterThan(tidyReport.workCost);
    expect(messy.stats.stamina).toBeLessThan(tidy.stats.stamina);
    // 一天差 10.8 点体力（19.8 − 9.0）—— 7 天下来就是"能不能睡够觉"的区别
    expect(tidy.stats.stamina - messy.stats.stamina).toBeCloseTo(10.8, 1);
  });

  it('健康跌破触发线会自动开药箱，补到线上就停（不吃冤枉药）', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 1);
    put(run, 'shelf_a', freePos(run, 'shelf_a'), 'bandage', 1, null);
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
    put(run, 'shelf_a', freePos(run, 'shelf_a'), 'quilt', 1, null);
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
