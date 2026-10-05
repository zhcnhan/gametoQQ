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
import {
  KEEPSAKE_MOOD_MAX,
  moodFromPlacement,
  dailyDrainOf,
  hardPressTier,
  keepsakeMoodOf,
  round1,
  workCostOf
} from '../data/survival';
import { consumeCategory, countCategory, countCategoryFrom } from '../model/consume';
import { haulFactorOfShelves, workHauledOf } from '../model/haul';
import { scatterRows } from '../model/scatter';
import { createShelf, fefoSorted, getStack, makeStack, readingOrder, setSlotStack, stackCount } from '../model/shelf';
import { isBatchSpoiled, spoilEverything, virtualDay } from '../model/spoil';
import type { CategoryId, ItemStack, RunState, Shelf, SlotPos, UnpackBox, Zone } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { declineRequest } from './help';
import { boxDefIdForItemIds } from './shop';
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

/**
 * 一份"刚好能撑一天"的最小开局（**不依赖随机箱子内容**）。
 *
 * ## ★★ 这里必须把 RNG 游标恢复成原始种子 —— 否则这个探针会随内容量漂
 *
 * `createStartingRun(seed)` 会顺手抽三个开局箱，而那一步**消耗 RNG 状态**；
 * 而箱子池是**按品类从 `ITEM_DEFS` 现算**的（`data/boxes.ts` 的
 * `itemIdsIn(MEDICAL_CATEGORIES)` 之类）。于是加一件医疗品 →
 * 池子变长 → 洗牌的消耗次数变了 → 游标位置整体移位 →
 * **后续每一次随机都换了一条序列**（地板卡、心情、突发事件）。
 *
 * 实测：给医疗加 8 件之后，同一条好档探针的逐日体力从
 * `[…,100,97,89,89]`（最低 89）变成 `[…,89,86,78,78]`（最低 **78**），
 * 而探针的库存是**写死的**（`probeLarder()`）、一件新物资都没用到。
 *
 * 所以这里显式把游标按回原种子：`boxesToUnpack` 反正紧接着就被清空/替换，
 * 那一次抽取的**结果**没人要，但它对游标的**影响**被留下来了 —— 那才是漂移的来源。
 *
 * ★ 这条修的是"探针太脆"，不是"断言放宽"：
 * 改完之后同一条曲线不再随内容量变化，`staminaFloor` 那个门才重新是个门。
 */
/**
 * 一只装着指定物资的没拆纸箱（测试用）。
 *
 * ★ 存在的理由：`countKeepsakes` **只吃 `shelves`** —— "收在纸箱里不算"
 * 这条规则是靠签名实现的，而签名本身测不出来。所以要先有一只装得下它的箱子，
 * 才谈得上断言"它在箱子里的时候没被算进去"。
 */
function boxOf(itemId: string, count: number): UnpackBox {
  return {
    id: `box_test_${itemId}`,
    defId: boxDefIdForItemIds([itemId]),
    items: [makeStack(itemId, count, null)]
  };
}

/**
 * 把三类口粮各放一整行、**位置写死**（每一类占一块货架的第 0 行）。
 *
 * ★ 与 `stockFor` 的区别就是它存在的理由：`stockFor` 是**游标式**铺货
 * （塞满一格换下一格），所以"多放一件别的东西"会让后面每一件都往后挪一格 ——
 * 于是两次运行的盘面**整体不同**，任何"只差一件"的对照实验都失去分辨力。
 * 这里每类固定占 `row 0`，留下的空格在两次运行里一一对应。
 */
function stockEvenly(run: RunState, colPerCategory = 3): void {
  const lines: [string, number][] = [
    ['canned_beans', colPerCategory],
    ['mineral_water', colPerCategory],
    ['fuel_can', colPerCategory]
  ];
  lines.forEach(([itemId, count], index) => {
    const shelf = run.shelves[index];
    if (!shelf) throw new Error(`没有第 ${index + 1} 块货架可放 ${itemId}`);
    for (let col = 0; col < count; col += 1) {
      put(run, shelf.id, { row: 0, col: 1 + col }, itemId, 1, null);
    }
  });
}

/**
 * 一场**真的搬不动**的灾难，供维度 7（搬运惩罚的位置那一半）的用例使用。
 *
 * ★ 为什么不能靠 `createStartingRun(seed)` 默认抽到的那场：默认是寒潮，
 * 而 `src/data/disaster.ts` 里**没有** `cold_snap` 的 `carryFactor` 行 ——
 * `disasterModifiersOf('cold_snap').carryFactor` 就是 1，
 * `haulFactorOfShelves` 直接返回 1，用例会**假绿**。
 *
 * 海啸的 `carryFactor: 0.5` 是最糟那一档（`HAUL_FULL_RAMP = 0.5` → 吃满），
 * 用它才能让"压在靠里那块更贵"这件事真的发生。
 */
const DEEP_DISASTER = 'tsunami';

function bareRun(seed = 20261001): RunState {  const run = createStartingRun(seed);
  run.boxesToUnpack = [];
  // ★ 把游标按回原种子（理由见上）
  run.seed = seed;
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
      zoneIds: s.zoneIds.map(() => 'zone_all'),
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
      const sweep = spoilEverything(run.shelves, run.boxesToUnpack, day, disaster.spoilRate);
      expect(sweep.total).toBe(0);
    }
  });

  it('反证：换成热浪（spoilRate 3）同一批牛奶会在生存期提前坏掉 —— 机制本身是通的', () => {
    const run = bareRun();
    put(run, 'shelf_a', { row: 0, col: 0 }, 'milk', 3, 14);
    // D+5 时虚拟天已经跑到 15 > 14
    const sweep = spoilEverything(run.shelves, run.boxesToUnpack, 5, 3);
    expect(sweep.total).toBe(3);
    expect(sweep.losses[0]?.itemId).toBe('milk');
    expect(sweep.shelves[0]?.slots[0]?.[0]?.stack).toBeNull();
  });

  it('纸箱里的东西也会坏（纸箱不是冰箱，否则没人有理由拆箱）', () => {
    const run = bareRun();
    run.boxesToUnpack = [{ id: 'box_1', defId: 'box_staple', items: [makeStack('milk', 3, 10)] }];
    const sweep = spoilEverything(run.shelves, run.boxesToUnpack, 12, 1);
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

    const sweep = spoilEverything(run.shelves, run.boxesToUnpack, 20, 1);
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
    run.shelves[0] = { ...shelfA, zoneIds: shelfA.zoneIds.map(() => 'zone_1') };

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
    run.shelves[0] = { ...shelfA, zoneIds: shelfA.zoneIds.map(() => 'zone_1') }; // 这张胶带只收医疗

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

describe('★★ 取用的三档来源（M4 W-11）', () => {
  /**
   * 摆出一个三档俱全的屋子：
   *   `shelf_a` 第 0 行贴「口粮区」（清单收 food）放 1 件 → 贴了清单那一档
   *   `shelf_a` 第 1 行没贴、放 2 件                    → 上了架但没写清单那一档
   *   `box_1` 里 3 件                                   → 没拆的纸箱那一档
   */
  function threeWays(): RunState {
    const run = bareRun();
    run.zones = [{ id: 'zone_food', name: '口粮区', color: '#C8372D', autoAccept: { categories: ['food'] } }];
    const shelfA = run.shelves[0];
    if (!shelfA) throw new Error('缺货架');
    run.shelves[0] = { ...shelfA, zoneIds: shelfA.zoneIds.map((_, row) => (row === 0 ? 'zone_food' : null)) };
    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 1, 60);
    put(run, 'shelf_a', { row: 1, col: 0 }, 'canned_beans', 2, 60);
    run.boxesToUnpack = [{ id: 'box_1', defId: 'box_staple', items: [makeStack('canned_beans', 3, 60)] }];
    return run;
  }

  it('★★ `from` 是"只准从这一档拿"，不是"优先从这一档拿"', () => {
    /*
     * 这个区分是整套 W-11 的地基：`'marked'` 说的是"我当着人家的面只翻我划好的那一行"。
     * 一旦它退化成"优先"（不够就顺手去别处补），界面上那三档价钱就变成
     * 一句谎话 —— 玩家选了 1.5 一件那档，实际拿的是纸箱里的货。
     */
    const run = threeWays();

    // 这一档（贴了清单、清单认它）只有 1 件，要 2 件 → 只拿到 1 件、差 1 件，**不去别处补**
    const marked = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2, 'marked');
    expect(marked.taken).toBe(1);
    expect(marked.shortage).toBe(1);
    expect(marked.fromBoxes).toBe(0);
    expect(marked.boxes[0]?.items[0]?.batches[0]?.count).toBe(3); // 纸箱一件没动
    // 没写清单的那一行也一件没动
    expect(countCategory(marked.shelves, [], 'food')).toBe(2);
  });

  it('★ 三档各自拿得到多少 —— 归位的货架与没归位的货架分属两档', () => {
    const run = threeWays();
    const count = (from: 'marked' | 'shelf' | 'box' | 'all'): number =>
      countCategoryFrom(run.shelves, run.zones, run.boxesToUnpack, 'food', from);

    expect(count('marked')).toBe(1); // 只有第 0 行那一件
    expect(count('shelf')).toBe(3); // 两行加一起（第 1 行那两件"上了架但没写清单"）
    expect(count('box')).toBe(3);
    expect(count('all')).toBe(6);
    // ★ 数货与取货必须是同一个判断：某一档数得出几件，就从那一档拿得到几件
    for (const from of ['marked', 'shelf', 'box'] as const) {
      const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 99, from);
      expect(result.taken, `${from}：数得出 ${count(from)} 件，却只拿到 ${result.taken} 件`).toBe(count(from));
    }
  });

  it('★ 不传 `from` 时逐位等于从前的行为（每日消耗那条路不许被这一档改变）', () => {
    const run = threeWays();
    const a = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2);
    const b = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2, 'all');
    expect(a.taken).toBe(b.taken);
    expect(a.fromBoxes).toBe(b.fromBoxes);
    expect(a.batches).toEqual(b.batches);
    expect(a.shortage).toBe(b.shortage);
    // 归位那一行先出（老规矩没变）
    expect(a.batches[0]?.from).toBe('shelf');
  });

  it('★ 只从纸箱拿：货架上明明有，也一件不碰', () => {
    const run = threeWays();
    const boxed = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2, 'box');
    expect(boxed.taken).toBe(2);
    expect(boxed.fromBoxes).toBe(2);
    expect(boxed.batches.every((b) => b.from === 'box')).toBe(true);
    // 货架上三件原封不动
    expect(countCategory(boxed.shelves, [], 'food')).toBe(3);
  });

  it('★ 只从货架上拿：纸箱里明明有，也一件不碰', () => {
    const run = threeWays();
    const shelved = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 3, 'shelf');
    expect(shelved.taken).toBe(3);
    expect(shelved.fromBoxes).toBe(0);
    expect(countCategory(shelved.shelves, [], 'food')).toBe(0);
    expect(shelved.boxes[0]?.items[0]?.batches[0]?.count).toBe(3);
  });

  it('★ 贴了胶带但清单不认它 → 那一行算"货架上"那一档，不算"划好的那行"', () => {
    const run = bareRun();
    run.zones = [{ id: 'zone_med', name: '药柜', color: '#C8372D', autoAccept: { categories: ['medicine'] } }];
    const shelfA = run.shelves[0];
    if (!shelfA) throw new Error('缺货架');
    run.shelves[0] = { ...shelfA, zoneIds: shelfA.zoneIds.map(() => 'zone_med') };
    put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 2, 60); // 在"药柜"里，不算归位

    expect(countCategoryFrom(run.shelves, run.zones, run.boxesToUnpack, 'food', 'marked')).toBe(0);
    expect(countCategoryFrom(run.shelves, run.zones, run.boxesToUnpack, 'food', 'shelf')).toBe(2);
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

  it('★ W-06：装卸工「翻找省力 20%」—— 日报要说出少花了多少（§10.1A）', () => {
    /*
     * 这个身份的天赋**只改一个数字**，所以它必须同时有非数字表达 —— 否则玩家
     * 只能感觉"这个身份好像没什么用"。`workSaved` 就是那句话的数据源
     * （`ui/SurvivalScreen.ts` 的日报拿它写"这一趟少花 N 点"）。
     *
     * ⚠ 两个数字都要断言：`workCost` 是玩家真正失去的体力，`workSaved` 是
     * 屏幕上那句话。只测一个的话，"乘数乘了、减数忘了"这种错法照样绿 ——
     * 而它的表现是界面上写着"少花 0 点"。
     */
    const stock = (run: ReturnType<typeof bareRun>) => {
      put(run, 'shelf_a', { row: 0, col: 0 }, 'canned_beans', 4, 60);
      put(run, 'shelf_a', { row: 0, col: 1 }, 'mineral_water', 4, 60);
      put(run, 'shelf_a', { row: 0, col: 2 }, 'fuel_can', 4, null);
      run.day = 3;
      run.stats = { health: 90, mood: 60, stamina: 50, shelter: 80 };
    };

    const plain = bareRun(); // 默认身份：没有省力天赋
    plain.identityId = 'group_buyer';
    stock(plain);
    const plainReport = settleSurvivalDay(plain);

    const porter = bareRun();
    porter.identityId = 'warehouse_porter';
    stock(porter);
    const porterReport = settleSurvivalDay(porter);

    // 同样的屋子、同样的六件活：基准账一模一样（§6.4 的 1.0→9.0 / 0.0→27.0 不受身份影响）
    expect(plainReport.workSaved).toBe(0); // 没有天赋的人不许"省下"任何东西
    expect(porterReport.workCost).toBeCloseTo(round1(plainReport.workCost * 0.8), 5);
    // ★ 两个数字各自 `round1`（乘数乘完就舍入，见 `systems/survival.ts`），所以
    //   和**不是**精确等于基准 —— 差在 0.1 以内，这就是"同口径"的全部含义。
    expect(porterReport.workCost + porterReport.workSaved).toBeCloseTo(plainReport.workCost, 1);
    expect(porterReport.workSaved).toBeGreaterThan(plainReport.workCost * 0.15);
    expect(porterReport.workSaved).toBeLessThan(plainReport.workCost * 0.25);
    expect(porterReport.workCost).toBeLessThan(plainReport.workCost);
  });

  it('★ 维度 7：搬不动的天气里，东西压在靠里那块真的更费劲', () => {
    /*
     * ## 这一条守的是"位置那一半"真的接到了劳作账上
     *
     * M4 验收第 1 条数的是"17 个维度里有几个真的改『该放哪儿』"。在 `carryFactor`
     * 只乘手提上限的年代，答案里没有第 7 维 —— 它改的是"你一次能搬多少"，
     * 与"东西放在哪块架子上"无关。
     *
     * ## ⚠ 必须显式挑一场有搬运惩罚的灾难
     *
     * `createStartingRun(seed)` 默认抽到寒潮，而 `src/data/disaster.ts` 里
     * **没有** `cold_snap` 的 `carryFactor` 行 —— 乘数恒为 1，这一条会**假绿**
     * （"压在深处更贵"这个断言会因为两边都等于 1 而通过）。
     *
     * ## ⚠ 也必须是**同一批货、同一批活**的两次结算
     *
     * 两边的件数必须一样，否则 `workCost` 的差里混着"今天活多活少"，
     * 而那个差与位置无关 —— 用例就不再是在测位置。
     *
     * ⚠ 但**不能**断言"放门口时 `deep.workHauled === 0`"：`bareRun` 开局三块架子，
     * 八件货铺在前两块上，第三块（`index = 2`）即便空着也让**前两块**里的
     * 第二块落在第 1 层 —— 那个数本来就该大于 0。真正要断的是
     * **全压在靠里那块时更贵**，以及**没有搬运惩罚的天气里这笔恒为 0**。
     */
    const build = (toDeep: boolean) => {
      const run = bareRun();
      run.disasterId = DEEP_DISASTER;
      // ★ 装卸工（`workCostFactor: 0.8`）：让 `workSaved` 与 `workHauled`
      //   同时非零，才验得出"两笔各算在自己的基准上"（默认身份两条路数值相同）
      run.identityId = 'warehouse_porter';
      // ⚠ 海啸带 `capacityFactor: 0.55` + `unusableShelfIds: ['shelf_a']`：
      //   每块只剩 2 排、还少一块。这里按**实际**的架子数铺，不去猜 3 块 4 排。
      const goods: ItemStack[] = [];
      // 八件主食，一件一格；`bareRun` 已把全部格子清空
      for (let i = 0; i < 8; i++) goods.push(makeStack('canned_beans', 1, 60));
      let at = 0;
      const perShelf = Math.ceil(goods.length / run.shelves.length);
      run.shelves = run.shelves.map((shelf, index) => {
        // 铺匀（`toDeep` 假）时门口那块与里面那块各拿一半；压深处时全给**最后**那块
        const take = toDeep
          ? index === run.shelves.length - 1
            ? goods.length
            : 0
          : index === run.shelves.length - 1
            ? Math.max(0, goods.length - perShelf * (run.shelves.length - 1))
            : Math.min(perShelf, Math.max(0, goods.length - at));
        let next = shelf;
        for (let n = 0; n < take; n++) {
          const flat = at + n;
          next = setSlotStack(
            next,
            { row: Math.floor(flat / next.w), col: flat % next.w },
            goods[flat] ?? makeStack('canned_beans', 1, 60)
          );
        }
        at += take;
        return next;
      });
      run.day = 3;
      run.stats = { health: 90, mood: 60, stamina: 60, shelter: 80 };
      return run;
    };

    const spread = build(false);
    const allDeep = build(true);
    const front = settleSurvivalDay(spread);
    const deep = settleSurvivalDay(allDeep);

    // 同一批活（件数一样）—— 是这一条用例的前提
    expect(front.workCost).toBeGreaterThan(0);
    expect(deep.fromShelves).toBe(front.fromShelves);
    // ★ 摆法真的改变了乘数本身（不是靠件数变多）：全压在深处更贵
    expect(haulFactorOfShelves(allDeep.shelves, 0.5)).toBeGreaterThan(
      haulFactorOfShelves(spread.shelves, 0.5)
    );
    // ★ 平时（没有搬运惩罚）这笔恒为 0 —— 三条永久回归探针的前提
    expect(haulFactorOfShelves(allDeep.shelves, 1)).toBe(1);
    // ★ 压在靠里那块：多花的力气必须真的出现在账上，而且是加在 `workCost` 上的
    expect(deep.workHauled).toBeGreaterThan(0);
    expect(deep.workCost).toBeGreaterThan(front.workCost);
    expect(deep.workHauled).toBeGreaterThan(front.workHauled);
    /*
     * ★★ 这一笔必须乘在**身份之后**的基准上（`workAfterIdentity`），不是 `workBase`。
     *
     * ⚠ 这条判据非这样写不可。两种算法的差只有零点几，而 `round1` 会把
     * `.05 / .15` 那一档直接舍掉 —— 拿"差 0.1 以内就算对"去比，
     * **错的实现照样绿**。我真试过：把 `workHauledOf(workAfterIdentity, …)`
     * 改成 `workHauledOf(workBase, …)`，整套 50 条全过。
     *
     * 所以这里把**界面上印出来的那个数**逐字算一遍：
     *   `workBase` → 身份那一乘 → 这一场的搬运乘数 → `workHauledOf`。
     * 用 `workBase` 当基准的话印出来是 1.2，正确的那条是 0.8 —— 一眼分得开。
     *
     * ⚠ 身份必须取装卸工（`rate: 0.8`）：默认身份两乘相等，
     * 这条断言对它没有分辨力。
     */
    expect(deep.workSaved).toBeGreaterThan(0);
    const identityFactor = 0.8; // 装卸工省 20%
    const workBase = deep.workSaved / (1 - identityFactor);
    const haulFactor = haulFactorOfShelves(allDeep.shelves, 0.5);
    expect(deep.workHauled).toBe(workHauledOf(round1(workBase * identityFactor), haulFactor));
    // ★ 而乘错地方的那条路会印出另一个数 —— 这一条就是给它留的
    expect(deep.workHauled).not.toBe(workHauledOf(workBase, haulFactor));
  });

  it('归位率越高心情越好，越低越是负担（但永远只是心情，不是判罚）', () => {
    expect(moodFromPlacement(1)).toBe(4);
    expect(moodFromPlacement(0.8)).toBe(4);
    expect(moodFromPlacement(0.5)).toBe(1);
    expect(moodFromPlacement(0.2)).toBe(-2);
    expect(moodFromPlacement(0)).toBe(-4);
  });

  it('★ D-29：摆出来的纪念品真的换成心情，而收在纸箱里的不算', () => {
    /*
     * ## 这一条为什么非有不可
     *
     * `keepsake` 这个 tag 从 M1 起就写在五件奢侈品上，注释也一直说着
     * "整理期摆放回心情"—— 而在此之前**全仓零读取**：那一整类东西
     * 只剩"贵 + 占地方 + 不解饿"。所以这一条守的是"承诺兑现了没有"，
     * 不是"公式算得对不对"。
     *
     * ## 两边必须**别的都一样**，只差"摆出来还是收起来"
     *
     * ⚠ 第一版只摆了三罐可可粉、屋里什么吃的都没有 —— 于是两边都缺货，
     * 心情每天被 `MOOD_DELTA_CAP = 12` **砸到下限**，纪念品那两点的差
     * 被封顶吃掉，断言拿到的是 `0 vs 2`。
     *
     * ⚠ 第二版备足了口粮，却把可可粉写在 `{ row: 0, col: 0 }` —— 那正是
     * `stockFor` 刚放主食的那一格，于是"摆可可粉"实际做的是**把主食换掉**：
     * 一边缺粮、一边不缺，心情差跑到 `-8`，而它跟纪念品毫无关系。
     *
     * ⚠ 第三版改用 `freePos`，**还是不行**：`stockFor` 是**游标式**铺货
     * （塞满一格换下一格），多一件可可粉会让后面每一件主食都往后挪一格 ——
     * 于是连"哪一格装的什么"都变了，归位率从 0.4 掉到 0，质量那一项就不再可比。
     *
     * ★ 最终用的是 `stockEvenly`：**每一类各占一块货架的第一行**，位置写死。
     * 于是 `{ row: 0, col: 0 }` 那一格在两边都是空的，只有可可粉进不进得去这一件事不同。
     */
    const build = (onShelf: number) => {
      const run = bareRun();
      stockEvenly(run, 3);
      run.day = 3;
      run.stats = { health: 90, mood: 60, stamina: 60, shelter: 80 };
      if (onShelf > 0) put(run, 'shelf_a', { row: 0, col: 0 }, 'cocoa_tin', onShelf, 400);
      // 收起来的那一件：装进一只没拆的纸箱（`countKeepsakes` 只吃 `shelves`）
      run.boxesToUnpack = [boxOf('cocoa_tin', 1)];
      return run;
    };

    const shown = settleSurvivalDay(build(2));
    const boxed = settleSurvivalDay(build(0));

    // 数得对：两罐摆出来 = 两件（收在箱子里的那罐没有被算进来）
    expect(shown.keepsakes).toBe(2);
    expect(boxed.keepsakes).toBe(0);
    expect(shown.moodFromKeepsakes).toBe(2);
    expect(boxed.moodFromKeepsakes).toBe(0);
    // 心情真的多出来那两点（两边都没有缺货，所以这个差只可能来自纪念品）
    expect(shown.deltas.mood - boxed.deltas.mood).toBeCloseTo(2, 5);
    /*
     * ★★ 它**不进整理质量** —— 这一条是留给"顺手把它塞进 `organizeQuality`"的人的。
     *
     * 混进去的表现是玩家发现"把可可粉摆在门口能提高归位率"，
     * 而那件事没有道理：这条轴问的是"东西在不在该在的地方"。
     * 顺带，混进去还会**漂掉三条永久回归探针**（它们的屋里没有奢侈品）。
     */
    expect(shown.quality).toBe(boxed.quality);
    expect(shown.placement).toBe(boxed.placement);
  });

  it('★ D-29：纪念品的心情有上限 —— 顶得上，但顶不过整理本身', () => {
    /*
     * `moodFromPlacement` 的值域是 **-4 ~ +4**，而它是 §6.3 的主轴。
     * 纪念品加成一旦超过它，玩家会得出"把屋子码整齐不如多囤几罐可可粉"，
     * 那正好把整理这条轴从中心挤到边缘。上限 3 的意思是：它顶得上，但顶不过。
     */
    expect(keepsakeMoodOf(1)).toBe(1);
    expect(keepsakeMoodOf(3)).toBe(3);
    expect(keepsakeMoodOf(4)).toBe(3);
    expect(keepsakeMoodOf(99)).toBe(KEEPSAKE_MOOD_MAX);
    expect(KEEPSAKE_MOOD_MAX).toBeLessThan(4); // 不许追平 moodFromPlacement 的最高档
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
    tidy.shelves = tidy.shelves.map((shelf, index) => ({ ...shelf, zoneIds: shelf.zoneIds.map(() => ['z1', 'z2', 'z3'][index] ?? null) }));

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
    tidy.shelves = tidy.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, zoneIds: s.zoneIds.map(() => 'zone_all') } : s));

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
    plain.shelves = plain.shelves.map((s) => (s.id === 'shelf_a' ? { ...s, zoneIds: s.zoneIds.map(() => 'zone_all') } : s));

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

  it('★★ 屋里的药按这一场算效力（M4 W-04：恢复侧的接线）', () => {
    /*
     * 目的：钉住 `autoSupply` **把灾难传给了 `healOf`**。
     *
     * 这一条用的是一个 `categoryEfficiency.medicine < 1` 的灾难：断电的冬天里药照样吃，
     * 但只值平常的八成。如果哪天有人把 `healOf(getItemDef(...), disaster)`
     * 改回 `healOf(getItemDef(...))`（或者把乘数搬到调用方去），
     * 这条会当场红 —— 上面那条寒潮用例**不会**（寒潮的 medicine 是 1，
     * 乘不乘都一样，这正是"接线了但没测出来"的典型）。
     *
     * ⚠ 挑灾难有个硬条件：它**不能每天消耗药品**。`outbreak_flu` 的 medicine 效率也是 0.6，
     * 但它 `dailyDrain: { medicine: 2 }` —— 每日消耗**排在自动开药之前**，
     * 绷带会先被当成口粮吃掉。`blackout_winter` 是全表**唯一**同时满足
     * "药效率 < 1"和"不耗药"的一场。
     *
     * ★★ 判据写成**同一局跑两遍再相减**，不是写死一个数。
     *
     * 写死 `deltas.health === 4.8` 会**假红**：那一天的账里还叠着缺货惩罚、
     * 四维自然衰减、灾难的 `healthRiskPerDay` 等等（实测这一局是 −4.5），
     * 药的那一份只是其中一项。相减则把那一整串背景全部约掉，
     * 剩下的**恰好**是 `healOf` —— 判据于是只说它要说的那件事。
     * （这个坑是跑出来才发现的：第一版断言拿到 0.3，与 4.8 差了 4.5。）
     */
    function healthWithBandage(bandaged: boolean): number {
      const run = bareRun();
      run.disasterId = 'blackout_winter'; // 药效率 0.8，每日只耗燃料与主食
      stockFor(run, SURVIVAL_DAYS + 1);
      if (bandaged) {
        const slot = freePos(run);
        put(run, slot.shelfId, slot.pos, 'bandage', 1, null);
      }
      run.day = 3;
      run.stats = { health: 65, mood: 60, stamina: 50, shelter: 80 };
      return settleSurvivalDay(run).deltas.health;
    }

    const without = healthWithBandage(false);
    const with_ = healthWithBandage(true);
    // 绷带 `nutrition.health` 是 2，`MEDICINE_HEAL_FACTOR` 是 3，这一场再乘 0.8
    expect(with_ - without).toBeCloseTo(2 * 3 * 0.8, 5);
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
    /*
     * ★ M4 W-03：这一局**一件都没放顺手位**，所以那 3 件全都是"没铺到手边"。
     *
     * 两个数在这里相等**不是巧合**，而是这一段的判据：`unreachable`（结果）
     * 与 `handyGap`（原因）在"顺手位空着"这个极端上必须重合 ——
     * 不重合就说明有一笔账算漏了（比如 `handyGap` 忘了按"真的没有"封顶）。
     */
    expect(report.handyGap).toBe(3);
    expect(run.survival.unreachablePieces).toBe(3);
    expect(run.survival.handyGapPieces).toBe(3);
    // 关键：这不是"没有"，是"拿不动" —— 两个数必须分得开，界面才能说对话
    expect(report.drains.every((d) => d.shortage === 0)).toBe(true);
    expect(report.hardPress).toBe(true);
  });

  it('★★ 顺手位铺到一件 → 两个数一起变（M4 W-03 的判据）', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 1);
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 20, shelter: 100 }; // 低于 EXHAUSTED_STAMINA

    /*
     * ★ 顺手位铺在**另一块货架**上（`shelf_b`），不是 `shelf_a`。
     *
     * 这不是图省事：`stockFor` 是游标式铺货（塞满一格换下一格），
     * 往它已经铺好的格子里再塞一件同品类的东西**是把那一格叠高**，
     * 于是"够得着"的那一份也跟着变 —— 那是 `stockFor` 的账，不是顺手位的账。
     */
    const handy = run.shelves[1]!;
    handy.handyRank = 1;
    put(run, 'shelf_b', { row: 0, col: 1 }, 'fuel_can', 1, null);

    const report = settleSurvivalDay(run);
    /*
     * ★ 这一局实际发生的事（跑出来才知道，所以写下来）：
     * `stockFor(SURVIVAL_DAYS + 1)` 把主食与饮水整整齐齐排在 `shelf_a` 上，
     * 燃料则**溢出到 `shelf_b`**（顺手位正好是它）。往 `shelf_b` 再补 1 件燃料，
     * 做的事就是"让燃料那一件够得着"：
     *
     *     unreachable 3 → 2（燃料那 1 件有顺手位撑着，不用再少拿了）
     *     handyGap    3 → 2（顺手位现在铺对了 1 件，还差主食与饮水那 2 件）
     *
     * ⚠ 两个数在这里**恰好一起减 1**，那不代表它们是同一个数：
     * 第一个在问"今天少了几件"，第二个在问"几件是铺一下就回得来的"。
     * 上面那条"顺手位空着时两个数都是 3"才是它们相等的唯一场合。
     */
    expect(report.unreachable).toBe(2); // 结果账：少了 2 件
    expect(report.handyGap).toBe(2); // 原因账：这 2 件都是"铺一下就能拿回来"的
    expect(run.survival.handyGapPieces).toBe(2);
    expect(run.survival.unreachablePieces).toBe(2);
    expect(report.fromShelves).toBe(4); // 需要 6 件、实际拿到 4 件（3 件翻出来的 + 顺手位上那 1 件）
  });

  it('★★ 顺手位把三个品类都摆上 → 反而一件都不缺（两个数一起归零，而这正是它的价值）', () => {
    const run = bareRun();
    stockFor(run, SURVIVAL_DAYS + 2);
    run.day = 3;
    run.stats = { health: 100, mood: 100, stamina: 20, shelter: 100 };

    const handy = run.shelves[1]!;
    handy.handyRank = 1;
    put(run, 'shelf_b', { row: 0, col: 0 }, 'canned_beans', 1, null);
    put(run, 'shelf_b', { row: 0, col: 1 }, 'mineral_water', 1, null);
    put(run, 'shelf_b', { row: 0, col: 2 }, 'fuel_can', 1, null);

    const report = settleSurvivalDay(run);
    // 顺手位上的**不用翻**，所以它们是加在"一半"之上的 —— 2 件的一半 + 1 件 = 够
    expect(report.unreachable).toBe(0);
    expect(report.handyGap).toBe(0);
    expect(report.drains.every((d) => d.taken === d.need)).toBe(true);
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
  run.shelves = run.shelves.map((s, i) => ({ ...s, zoneIds: s.zoneIds.map(() => 'zone_all'), handyRank: handy && i === 0 ? 1 : null }));
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
  /** 每天被翻乱了几件（D-11 的观测量） */
  const scatteredByDay: number[] = [];
  let guard = 0;
  while (store.run.phase === 'survival_day' && guard < 60) {
    /*
     * ★ 中途补救那一刻，**这里原来是直接改 `run` 状态**造的场面
     * （`shelveEverything` + `fefoAll` 绕过一切界面与命令）。
     *
     * W-09（M4 决策 B：生存期可以自由回家整理）做完之后，**这个场面玩家真的做得出来了**：
     * 日报 → 「回家整理」（花 1 行动点）→ 上架 / 写清单 / FEFO / 标顺手位 → 「回日报」。
     * 所以这一段注释跟着更新（纪律 §2.17：注释里的场景要么还成立、要么说清它变了）。
     *
     * ⚠ 但探针**仍然直接改状态**，刻意不走 `goOrganize` / `backToSurvival`：
     * 三条永久回归探针量的是"整理质量对生存曲线的影响"这一条因果，
     * 而"回去要花几个行动点"是另一件事 —— 把它搅进来会让这条基线
     * 在每次调 `GO_HOME_AP_COST` 时都漂一次。行动点那一层由
     * `systems/phases.test.ts` 的「生存期回整理页」那一组单独钉。
     */
    if (fixAtDay !== null && store.run.day === fixAtDay) {
      shelveEverything(store.run);
      fefoAll(store.run);
    }
    advanceSurvivalDay(store);
    resolveHelpIfAny(store);
    staminaFloor = Math.min(staminaFloor, store.run.stats.stamina);
    staminaByDay.push(store.run.stats.stamina);
    scatteredByDay.push(store.run.survival.last.scattered);
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
    scatteredByDay,
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
    // 实测轨迹（14 天，RNG 游标已按回原种子，见 `bareRun`）：体力
    // [98,96,99,100,100,100,100,100,100,100,100,97,94,94]、最低 94、健康 100 → 70、
    // 庇护所一路被磨到 22。
    // 整理质量 1.0 → 每天 6 件 × 1.5 = 9 点，睡一觉回 12 —— 净 +3；
    // 突发事件里化解得掉的那几条不额外扣分，所以它不该把这条曲线拽下去。
    // 后程那几点体力是庇护所跌破 40 之后"睡不踏实"扣的（§12.3 v0.7），不是整理的问题。
    //
    // ⚠ 门槛从 `> 80` 抬到 `> 90` 是**有意的**：原来那个 80 是照着"最低 89"定的余量，
    // 而那时这条曲线其实在随内容量漂（加 8 件医疗品就掉到 78）。
    // 游标钉住之后它不再漂，所以门槛可以贴着实测值定 —— 那才是它作为
    // "整理→体力这条链有没有退化"的报警器该有的松紧度。
    expect(good.staminaFloor).toBeGreaterThan(90);
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
    /*
     * ★ 补救那一份**显式标上顺手位**（`shelve(run, true)`）。
     *
     * 原来它走的是 `shelve` 的默认值 —— 而"补救"的定义是**好好整理一遍**：
     * 上架、写清单、FEFO、标顺手位，四件都是整理的一部分。
     * 少做最后一件会让这个对照实验比它该有的样子更弱：
     * 顺手位决定突发事件化不化解（`countOnHandy`），而事件化解与否
     * 直接落在体力曲线上。
     */
    const rescued = runProbe((run) => shelveEverything(run, true), 2);

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
    /*
     * ★ 门槛与实测值（2026-10 重取）。
     *
     * 实测：乱档 `staminaFloor = 0`（D+10 倒），补救 `= 94`（活满 14 天）。
     * 门槛定在 **70**，而不是贴着 94 定 —— 这一条主张的是
     * "**补救把下沉止住了，而且止得很干净**"，不是"最低点恰好是某个数"。
     * 乱档是 0、补救是 94，两者之间的差距（94 点）才是这段代码要守的东西；
     * 把门槛钉在 90 只会让它在下次内容变动时毫无理由地红。
     *
     * ⚠ 两个值都是**重取**的，原因是 `bareRun` 把 RNG 游标按回了原种子
     * （见那个函数的注释：修"内容量会拖探针漂"）。原来那两处
     * （`> 40` 与 `> 65`，而且它们互相矛盾）是更早一版序列下的数。
     */
    expect(rescued.staminaFloor).toBeGreaterThan(70);
    expect(rescued.staminaFloor).toBeGreaterThan(messy.staminaFloor);
    /*
     * ★★ 补救的轨迹是"**上升然后在高位振荡**"，不是单调爬升。
     *
     * 实测（2026-10 清偿 D-11 之后重取，理由见下）：
     *   乱档  [65, 40, 23, 4.5, 0, 0, 0]                     最低 0，D+10 倒
     *   补救  [98, 91, 94, 97, 100, 100, 98, 96, 99, 100, 100, 97, 94, 94]  最低 91
     *
     * ⚠ 这两组数**重取过一次**：加「翻乱相邻货架」时它们先变成了
     * `[100,100,100,...]`（补救那局前六天顶在上限）。那不是"机制把曲线压低了"，
     * 而是我当时**没加 `placement >= 1 → 不翻乱` 那一条**，于是连整理好的盘面
     * 也被翻乱 —— 而翻乱让它更"顺手"地取到了东西，反而省了体力。
     * 补上那一条之后曲线回到这里的两组值。**所以这条用例的红是有用的**：
     * 它是发现那个设计错误的唯一信号。
     *
     * ⚠ 原来这里写的是 `staminaByDay[2] > staminaByDay[0]`，注释还标着"实测"——
     * 而它**从来没有成立过**：D+0 补的是 98，D+2 是 94（补货当天要先付整理劳作）。
     * 那是"照着想要的结论写断言"，不是量出来的。
     *
     * 现在改成两条真的可主张的：
     *  ① **同日对照**：D+2 那一刻，补救的 94 对乱档的 23 —— 差距是这一段代码的意义；
     *  ② **早期确实在升**：D+2 的 94 → D+4 的 100（走上限了）。
     * 高位那段（D+7 起 94~100 振荡）是庇护所跌破后的睡眠折损，
     * 不归整理管 —— 所以不断言它单调。
     */
    expect(rescued.staminaByDay[2] as number).toBeGreaterThan(messy.staminaByDay[2] as number);
    expect(rescued.staminaByDay[4] as number).toBeGreaterThan(rescued.staminaByDay[2] as number);
    /*
     * ★★ 而整理好的那一局**不该被翻乱**（D-11 的 `placement >= 1` 那条）——
     * 这是"翻乱"与"整整齐齐"能共存的前提，所以钉在探针里。
     */
    expect(rescued.scatteredByDay.every((n) => n === 0), '整理好的盘面不该被自己翻乱').toBe(true);
  });
});

describe('★★ 翻乱相邻货架（§6.4 的滚雪球）—— D-11', () => {
  /** 一块盘面上有多少件（用 `stackCount`：`ItemStack` 里没有 `count` 字段） */
  function piecesOf(shelf: Shelf): number {
    return readingOrder(shelf).reduce((sum, p) => {
      const stack = getStack(shelf, p);
      return sum + (stack ? stackCount(stack) : 0);
    }, 0);
  }

  /**
   * 一个**盘面乱但东西够**的档：口粮按货架顺序平铺（没有胶带，所以"没归位"），
   * 于是 `placement` 很低 —— 这正是"翻找会把这一行翻乱"的现场。
   *
   * ⚠ 不能用"全堆在箱子里"那个乱档：那时 `fromShelves = 0`（一件都没上架），
   * 而翻乱的前提是**你从货架上翻了东西**。所以那一种恰好**不该**触发翻乱。
   */
  function runMessyOnShelves(days: number) {
    const run = bareRun();
    run.day = 0;
    run.phase = 'survival_day';
    stockFor(run, days);
    const store = new GameStore(createSaveGame(run), createSaveSchedulerStub());
    startSurvival(store);
    resolveHelpIfAny(store);
    return store;
  }

  it('★★ 盘面乱 + 今天从货架上取了东西 → 真的翻乱，而且日报里写了', () => {
    const store = runMessyOnShelves(SURVIVAL_DAYS + 1);
    advanceSurvivalDay(store);
    const last = store.run.survival.last;
    expect(last.scattered, '乱盘面上翻找该把某几行翻乱').toBeGreaterThan(0);
    expect(last.scatteredRows.length, '日报要说清是哪一行').toBeGreaterThan(0);
    expect(
      store.run.log.some((line) => line.includes('翻乱了')),
      '这件事必须进日报 —— 不做声的机制等于没发生'
    ).toBe(true);
  });

  it('★★ 翻乱**不丢东西**（同一块盘面前后件数必须一致）', () => {
    /*
     * ⚠ 这条**不走结算**，而是自己铺一块盘面、做一次翻乱再比对。
     *
     * 为什么不走结算：结算是会**正常地消耗掉一些**的（那是既有机制），
     * 拿整局的前后件数比，量到的是"消耗 + 翻乱"两件事，分不清翻乱有没有吃件 ——
     * 那种断言会在别的地方红，而不是在这里。而 `stockFor` 之后架上本来就是空的
     * （东西在箱子里，那正是"没整理"），所以借它做这块盘面也是错的。
     *
     * 主张只有一句：**一个会丢东西的机制会让玩家再也不敢整理**。
     */
    let shelf = createShelf('probe', 'room_living', 'shelf', 3, 3);
    /*
     * ⚠ 三格放**三种不同的货**：用同一种货的话"顺序变了没有"根本看不出来
     * （`['canned_beans','canned_beans',...]` 旋转之后还是同一个数组）。
     * 第一版就是这么写的，于是断言红得莫名其妙。
     */
    for (const [col, itemId] of ['canned_beans', 'rice_bag', 'salt_bag'].entries()) {
      shelf = setSlotStack(shelf, { row: 0, col }, makeStack(itemId, 3 + col, null));
    }
    const before = piecesOf(shelf);
    expect(before, '这块盘面上该有东西（否则这条在验空气）').toBeGreaterThan(0);

    const moved = scatterRows(shelf, [0], () => 0).shelves[0];
    if (!moved) throw new Error('该返回一块货架');
    expect(piecesOf(moved), '翻乱前后件数必须一样').toBe(before);
    expect(
      [0, 1, 2].map((col) => getStack(moved, { row: 0, col })?.itemId),
      '而且顺序真的变了'
    ).not.toEqual([0, 1, 2].map((col) => getStack(shelf, { row: 0, col })?.itemId));
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
