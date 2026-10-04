/**
 * 跨局结算（§6.7 图鉴 / §9.6 第三项）与 luxury 品类的赌性。
 *
 * 这一组守两条**最容易悄悄坏掉**的口径：
 *
 *  ① **结算只发一次奖**：结局有三条路（走完 / 健康归零 / 读档自愈），
 *     而三条路都会走到结算页。结算页每渲染一次就发一次奖励的话，
 *     反复刷新就能把图鉴与纪录刷满 —— 那不是上瘾循环，是记账错误；
 *  ② **奢侈品只能从神秘混合箱里开出来**：不参与生存数值、商店一件不卖。
 *     一旦有人在商店里加了 offer，或者给它填了 nutrition，
 *     "奢侈品"就变成了另一种粮食，收集目标当场降格成补给品。
 */
import { describe, expect, it } from 'vitest';
import { BOX_DEFS, getBoxDef } from '../data/boxes';
import { ITEM_DEFS, getItemDef } from '../data/items';
import { SHOP_DEFS } from '../data/shops';
import { dailyDrainOf } from '../data/survival';
import { getDisasterDef } from '../data/disaster';
import { createCursor } from '../model/rng';
import { makeStack } from '../model/shelf';
import type { RunState } from '../model/types';
import { SAVE_VERSION, createMetaProfile, createSaveGame, deserialize, migrate, serialize } from '../state/save';
import { GameStore } from '../state/store';
import { earnedCodex, settleRunMeta } from './codex';
import { createStartingRun, generateBoxStacks } from './setup';

function createSaveSchedulerStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

function bareRun(seed = 20261001): RunState {
  const run = createStartingRun(seed);
  run.boxesToUnpack = [];
  run.shelves = run.shelves.map((shelf) => ({
    ...shelf,
    slots: shelf.slots.map((row) => row.map(() => ({ stack: null })))
  }));
  return run;
}

function storeOf(run: RunState): GameStore {
  return new GameStore(createSaveGame(run), createSaveSchedulerStub());
}

/** 一个已经走完的局：活过 14 天，屋子里留了几样东西 */
function finishedRun(overrides: Partial<RunState> = {}): RunState {
  const run = bareRun();
  run.day = 14;
  run.phase = 'ending';
  run.outcome = 'survived';
  run.identityId = 'group_buyer';
  run.boxesToUnpack = [
    { id: 'b1', defId: 'box_staple', items: [makeStack('canned_beans', 4, null), makeStack('cocoa_tin', 1, null)] }
  ];
  run.trust = { npc_wang: 2 };
  return Object.assign(run, overrides);
}

describe('luxury 品类：它的价值只有两条 —— 图鉴与赌性', () => {
  it('五件奢侈品都在，而且都不参与生存数值', () => {
    const luxuries = ITEM_DEFS.filter((d) => d.category === 'luxury');
    expect(luxuries.length).toBeGreaterThanOrEqual(3);
    for (const item of luxuries) {
      // nutrition 全空：它不该进自动补给那条链（`healOf` / `shelterOf` 都读 nutrition）
      expect(item.nutrition).toEqual({});
      // 不是任何灾难的刚需（寒潮刚需是 fuel/warmth，奢侈品一个都不该在里面）
      expect(getDisasterDef('cold_snap').priorityCategories).not.toContain('luxury');
    }
    // 每日消耗里也不该出现 luxury 这个品类
    const drained = dailyDrainOf(getDisasterDef('cold_snap')).map((d) => d.category);
    expect(drained).not.toContain('luxury');
  });

  it('★ 奢侈品即使上架，也只能是"贵、量少、与生存无关" —— 绝不能变成一条划算的路', () => {
    /*
     * ## 这条规则 M3 改了口径，理由如下（不是为了让测试变绿）
     *
     * 原来是**绝对禁令**：`SHOP_DEFS` 里一件奢侈品都不许有，
     * 理由是"唯一的来源是运气，否则赌性当场消失"。
     *
     * 现在有三个点位在卖（社区小卖部的可可粉、加油站的一条烟、
     * 周末旧货市的暖水袋与画册）。这不是随手加的 —— 它同时**清偿了 D-16**：
     * `hot_water_bag_gift` 原来不在任何箱子的池子里，图鉴上那一格永远空着。
     * 内容批次选择给它一个真实的来源，而不是让它继续当占位符。
     *
     * ★ 但禁令背后的**担忧仍然成立**，所以这里不删规则，而是把它换成
     * 可执行的形式。奢侈品进商店的真正风险不是"赌性没了"（神秘混合箱
     * 仍然是它最便宜的来源），而是这三件事：
     *
     *  ① **它不能变成一条划算的路**。奢侈品只在**整理期摆放**时回一点心情
     *     （`tags` 里的 `keepsake`），而心情本身不救命。所以只要它**贵**，
     *     买它就永远是"花钱买心情"而不是"花钱买活路"——
     *     一旦它便宜到能顺手捎一件，逐日囤货的预算表就被它挤歪了；
     *  ② **它不能挤掉刚需**。这一条由上面那个"不参与生存数值"的用例守着；
     *  ③ **货架上不能多**。库存给大了，玩家会在囤货期把它当常规采购。
     *
     * 判据落在**行为**上而不是"在不在卖"上：单件售价不得低于 20 元，
     * 而且每家店的每一档库存不超过 5 件。
     */
    const luxuries = new Map(
      ITEM_DEFS.filter((d) => d.category === 'luxury').map((d) => [d.id, d] as const)
    );
    const offenders: string[] = [];
    for (const shop of SHOP_DEFS) {
      for (const offer of shop.offers) {
        const item = luxuries.get(offer.itemId);
        if (!item) continue;
        // 实际最低到手价：点位系数是唯一能把它压低的东西
        const floorPrice = Math.round(item.basePrice * shop.priceFactor);
        if (floorPrice < 20) offenders.push(`${shop.id} 的 ${item.name} 只要 ${floorPrice} 元（太便宜）`);
        if (offer.stock > 5) offenders.push(`${shop.id} 的 ${item.name} 库存 ${offer.stock} 件（太多）`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('★ 只有神秘混合箱有奢侈品池，粮油箱与医疗箱一个都不给', () => {
    const mixed = getBoxDef('box_mixed');
    expect(mixed.luxuryChance).toBeGreaterThan(0);
    expect(mixed.luxuryPool?.length ?? 0).toBeGreaterThan(0);
    for (const def of BOX_DEFS) {
      if (def.id === 'box_mixed') continue;
      expect(def.luxuryChance ?? 0).toBe(0);
    }
    // 奢侈品也不该出现在任何箱子的**正经池**里：那会把它摊平成普通货
    const luxuryIds = new Set(ITEM_DEFS.filter((d) => d.category === 'luxury').map((d) => d.id));
    for (const def of BOX_DEFS) {
      for (const id of def.pool) expect(luxuryIds.has(id)).toBe(false);
    }
  });

  it('★ 开箱概率是种子化的，而且落在声明的量级上', () => {
    const mixed = getBoxDef('box_mixed');
    const chance = mixed.luxuryChance ?? 0;

    // 同 seed 同结果
    const open = (seed: number): string[] => generateBoxStacks(createCursor(seed), mixed, -7).map((s) => s.itemId);
    expect(open(20261001)).toEqual(open(20261001));

    // 大样本：开出的比例接近声明值（抽 3000 箱）
    let boxes = 0;
    let hits = 0;
    for (let seed = 0; seed < 3000; seed++) {
      const items = generateBoxStacks(createCursor(seed), mixed, -7);
      boxes += 1;
      if (items.some((s) => getItemDef(s.itemId).category === 'luxury')) hits += 1;
    }
    const rate = hits / boxes;
    expect(rate).toBeGreaterThan(chance - 0.04);
    expect(rate).toBeLessThan(chance + 0.04);
  });

  it('★ 一箱最多开出一件奢侈品（多件会让"开出一件好东西"贬值）', () => {
    for (let seed = 0; seed < 400; seed++) {
      const items = generateBoxStacks(createCursor(seed), getBoxDef('box_mixed'), -7);
      const luxury = items.filter((s) => getItemDef(s.itemId).category === 'luxury');
      expect(luxury.length).toBeLessThanOrEqual(1);
    }
  });

  it('★ 没有 luxuryChance 的箱型不消耗那次掷 —— 否则粮油箱的内容会随混合箱改概率而变', () => {
    // 两个同 seed 的游标：一个开粮油箱，一个开混合箱。
    // 粮油箱不掷奢侈品，所以它之后游标前进的距离**只由它自己的内容决定** ——
    // 这条用"开完粮油箱后的游标值"钉住
    const cursorA = createCursor(999);
    generateBoxStacks(cursorA, getBoxDef('box_staple'), -7);
    const afterStaple = cursorA.state;

    const cursorB = createCursor(999);
    generateBoxStacks(cursorB, getBoxDef('box_staple'), -7);
    expect(cursorB.state).toBe(afterStaple);
    // 而且它确实没有为奢侈品多掷一次：把概率改成 0 与不写，游标结果相同
    const plain = { ...getBoxDef('box_staple'), luxuryChance: 0, luxuryPool: ['cocoa_tin'] };
    const cursorC = createCursor(999);
    generateBoxStacks(cursorC, plain, -7);
    expect(cursorC.state).toBe(afterStaple);
  });
});

describe('跨局结算：只发一次奖', () => {
  it('第一次结算：点亮图鉴、记下纪录、返回本局成绩', () => {
    const store = storeOf(finishedRun());
    const verdict = settleRunMeta(store);
    expect(verdict).not.toBeNull();
    expect(verdict?.days).toBe(14);
    expect(verdict?.outcome).toBe('survived');
    // 屋里那两样 + 灾难 + 敲过门的 NPC
    expect(verdict?.fresh.items).toContain('canned_beans');
    expect(verdict?.fresh.items).toContain('cocoa_tin');
    expect(verdict?.fresh.disasters).toEqual(['cold_snap']);
    expect(verdict?.fresh.npcs).toEqual(['npc_wang']);
    expect(verdict?.newRecord).toBe(true);
    expect(verdict?.previousBest).toBe(0);
    expect(store.save.meta.bestSurvivalDays['cold_snap']).toBe(14);
    expect(store.run.metaSettled?.outcome).toBe('survived');
  });

  it('★ 第二次结算（结算页被刷新）→ 一个字节都不改', () => {
    const store = storeOf(finishedRun());
    settleRunMeta(store);
    const codexAfter = JSON.stringify(store.save.meta.codex);
    const bestAfter = store.save.meta.bestSurvivalDays['cold_snap'];

    const again = settleRunMeta(store);
    expect(again).toBeNull();
    expect(JSON.stringify(store.save.meta.codex)).toBe(codexAfter);
    expect(store.save.meta.bestSurvivalDays['cold_snap']).toBe(bestAfter);
  });

  it('★ 第二局不会把上一局的点亮重复计入（fresh 只报**新**的）', () => {
    const store = storeOf(finishedRun());
    settleRunMeta(store);
    // 换一局：同样的物资 + 一个上一局没见过的 NPC
    const next = finishedRun({ trust: { npc_wang: 2, npc_classmate: 1 } });
    store.replaceRun(next);
    const verdict = settleRunMeta(store);
    expect(verdict?.fresh.items).toEqual([]); // 罐头都见过了
    expect(verdict?.fresh.disasters).toEqual([]);
    expect(verdict?.fresh.npcs).toEqual(['npc_classmate']);
    expect(verdict?.freshCount).toBe(1);
  });

  it('没走到结局的局不结算（outcome 为 null 时什么都不发）', () => {
    const store = storeOf(finishedRun({ outcome: null, phase: 'survival_day', day: 5 }));
    expect(settleRunMeta(store)).toBeNull();
    expect(store.run.metaSettled).toBeNull();
  });

  it('★ 没破纪录时不覆盖最佳纪录，但仍然记下这一局（不算新点亮）', () => {
    const store = storeOf(finishedRun());
    settleRunMeta(store);
    const short = finishedRun({ day: 6, outcome: 'collapsed' });
    store.replaceRun(short);
    const verdict = settleRunMeta(store);
    expect(verdict?.newRecord).toBe(false);
    expect(verdict?.previousBest).toBe(14);
    expect(store.save.meta.bestSurvivalDays['cold_snap']).toBe(14); // 没被 6 覆盖
    expect(store.run.metaSettled?.outcome).toBe('collapsed');
  });

  it('★ 最好连击取历史最大，不跟着这一局的下滑走', () => {
    const store = storeOf(finishedRun());
    store.run.survival.safeStreak = 9;
    settleRunMeta(store);
    expect(store.save.meta.bestSafeStreak).toBe(9);

    const worse = finishedRun();
    worse.survival.safeStreak = 2;
    store.replaceRun(worse);
    settleRunMeta(store);
    expect(store.save.meta.bestSafeStreak).toBe(9);
  });

  it('三页的 id 落盘前排序（否则存档 diff 全是噪音）', () => {
    const store = storeOf(finishedRun());
    store.replaceRun(
      finishedRun({
        boxesToUnpack: [
          {
            id: 'b1',
            defId: 'box_mixed',
            items: [makeStack('toolbox', 1, null), makeStack('canned_beans', 1, null), makeStack('bandage', 1, null)]
          }
        ]
      })
    );
    settleRunMeta(store);
    const items = store.save.meta.codex.items;
    expect(items).toEqual([...items].sort());
  });

  it('earnedCodex 是纯函数：同样的屋子永远算出同一份点亮清单', () => {
    const run = finishedRun();
    expect(earnedCodex(run)).toEqual(earnedCodex(run));
  });
});

describe('存档 v13~v19：M2~M3 新字段的迁移与自愈', () => {
  it('当前版本是 v19（M3 第 7 步之后：胶带粒度细到「一行」）', () => {
    /*
     * ★ 这条断言是**故意的**：它是"改 schema 必须 +1 版本"那条规矩的报警器。
     *
     * 它的价值在改 schema 时显形 —— 你加了字段却没抬版本号，
     * 它不会红（因为版本号没变），但 `save.test.ts` 的往返测试会红；
     * 而你抬了版本号却忘了写迁移，这条会红并让你想起"迁移写了没有"。
     * 两个方向都有人守，所以它是这套自愈体系里的一个必要齿轮。
     */
    expect(SAVE_VERSION).toBe(19);
  });

  it('★★ v17 老档：`survivedRuns` 补 0，而且**不从纪录反推**', () => {
    /*
     * 这条守的是"补的值必须等于那个时刻真实发生的事"。
     *
     * `bestSurvivalDays` 那张表**不能**用来推"活过几次"：它记的是纪录，
     * 而这里要的是计数 —— 两者在"纪录被刷新"时会分家。
     * 更要紧的是：v18 之前**根本没有解锁功能**，
     * 所以"他本来就没有解锁过任何东西"，补 0 是**说真话**。
     *
     * ★ 一个撒谎的进度比一个归零的进度更坏：玩家记得自己活过好几次，
     * 却看到"再活一次就解锁"没有任何变化 —— 那正是用户报的那个 bug 的形状。
     */
    const meta = {
      version: 17,
      identityLevels: {},
      codex: { items: [], disasters: ['cold_snap'], npcs: [] },
      // 故意放一份"看起来活过很多次"的纪录
      bestSurvivalDays: { cold_snap: 14 },
      bestSafeStreak: 9,
      achievements: [],
      totalShelved: 640,
      everBoughtItemIds: []
    } as never;
    const back = deserialize(serialize({ meta, run: null, savedAt: 1, syncVersion: 1, deviceId: 'd' }));
    expect(back?.meta.survivedRuns).toBe(0);
  });

  it('★ v18 往返：`survivedRuns` 存得住、被清洗成正整数', () => {
    const meta = { ...createMetaProfile(), survivedRuns: 3 } as never;
    const back = deserialize(serialize({ meta, run: null, savedAt: 1, syncVersion: 1, deviceId: 'd' }));
    expect(back?.meta.survivedRuns).toBe(3);
  });

  it('★★ v18 老档的"整块胶带" → 每一行都是那一张（v19 的行级迁移）', () => {
    /*
     * 这条守的是"迁移一条**语义**"，而不只是"迁移一个形状"。
     *
     * v18 及更早的 `Shelf.zoneId` 是**一块货架贴一张**，所以搬进
     * `zoneIds` 之后，那一张必须出现在**每一行**上。搞成"只给第 0 行"
     * 或者"全丢掉"的话，一次更新会把所有人写好的分区清空 ——
     * 而那种坏法**不会报错**（界面只是显示"还没贴"）。
     */
    const run = createStartingRun(20261008) as unknown as Record<string, unknown>;
    const shelves = run['shelves'] as Record<string, unknown>[];
    // 手工退回 v18 的形状：删掉 zoneIds，换成标量 zoneId
    for (const s of shelves) {
      delete s['zoneIds'];
      s['zoneId'] = 'zone_legacy';
    }
    run['zones'] = [{ id: 'zone_legacy', name: '老的', color: '#000000' }];
    const back = deserialize(
      serialize({ meta: { version: 18 } as never, run: run as never, savedAt: 1, syncVersion: 1, deviceId: 'd' })
    );
    expect(back?.run, '这份档要能读回来').not.toBeNull();
    for (const s of back!.run!.shelves) {
      expect(s.zoneIds, `${s.id} 的 zoneIds 长度该等于行数`).toHaveLength(s.h);
      for (let row = 0; row < s.h; row++) {
        expect(s.zoneIds[row], `${s.id} 第 ${row} 行该继承那张老胶带`).toBe('zone_legacy');
      }
    }
  });

  it('★★ `zoneIds` 全空但 `zoneId` 有值 → 仍然按老胶带补（抓过一个真的坏档）', () => {
    /*
     * ★ 这条是补出来的，因为**它抓到了一个真的坏档**。
     *
     * "先 `createShelf`、再补一个 `zoneId`"的代码会同时留下
     * `zoneIds: [null,null,null,null]` 与 `zoneId: 'zone_x'`。
     * 我原来的判据是"`zoneIds` 是数组就用它" → 于是优先信了那个全空的数组，
     * **那张胶带变成孤儿**：存档里有 1 张胶带，而每块架子每一行都显示"还没贴"。
     *
     * 那个坏档**自身是自洽的** —— 模型层、迁移层、测试全绿，
     * 是我把 `good` 档逐行打出来（`scripts/_probe-migrate.ts`）才看见的。
     * 判据因此改成"数组里**真的有东西**才算数"。
     */
    const run = createStartingRun(20261008) as unknown as Record<string, unknown>;
    const shelves = run['shelves'] as Record<string, unknown>[];
    for (const s of shelves) {
      // 两个字段同时在，而数组是全空的
      s['zoneIds'] = Array.from({ length: s['h'] as number }, () => null);
      s['zoneId'] = 'zone_legacy';
    }
    run['zones'] = [{ id: 'zone_legacy', name: '老的', color: '#000000' }];
    const back = deserialize(
      serialize({ meta: { version: 18 } as never, run: run as never, savedAt: 1, syncVersion: 1, deviceId: 'd' })
    );
    expect(back!.run!.shelves[0]!.zoneIds[0], '全空的数组不该压过标量 zoneId').toBe('zone_legacy');
  });

  it('★ v14 老档：手里那件补空（不反推 —— 老档根本没记录过这件事）', () => {
    const run = createStartingRun(5) as unknown as Record<string, unknown>;
    delete run['held'];
    delete run['heldFrom'];
    const back = deserialize(
      serialize({ meta: { version: 14 } as never, run: run as never, savedAt: 1, syncVersion: 1, deviceId: 'd' })
    );
    expect(back?.run?.held).toBeNull();
    expect(back?.run?.heldFrom).toEqual({ kind: 'none' });
  });

  it('★★ v15：手里那件能存档往返（这是"刷新不丢件"的地基）', () => {
    const run = createStartingRun(5);
    run.held = { itemId: 'canned_beans', batches: [{ count: 3, expiresAtDay: 12 }] } as never;
    run.heldFrom = { kind: 'shelf', shelfId: 'shelf_a', pos: { row: 1, col: 2 } };
    const back = deserialize(
      serialize({ meta: { version: 15 } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'd' })
    );
    expect(back?.run?.held?.itemId).toBe('canned_beans');
    expect(back?.run?.held?.batches[0]?.count).toBe(3);
    expect(back?.run?.heldFrom).toEqual({ kind: 'shelf', shelfId: 'shelf_a', pos: { row: 1, col: 2 } });
  });

  it('★ v15 自愈：手里那件形状不对 → 丢弃；来处形状不对 → 退回 none', () => {
    const run = createStartingRun(5) as unknown as Record<string, unknown>;
    run['held'] = { nope: true }; // 没有 itemId / batches
    run['heldFrom'] = { kind: '不存在的来处' };
    const back = deserialize(
      serialize({ meta: { version: 15 } as never, run: run as never, savedAt: 1, syncVersion: 1, deviceId: 'd' })
    );
    expect(back?.run?.held).toBeNull();
    expect(back?.run?.heldFrom).toEqual({ kind: 'none' });
  });

  it('★ v15 自愈：手里是空的，来处必须一起被清成 none（两份状态不许分家）', () => {
    const run = createStartingRun(5) as unknown as Record<string, unknown>;
    run['held'] = null;
    run['heldFrom'] = { kind: 'shelf', shelfId: 'shelf_a', pos: { row: 0, col: 0 } };
    const back = deserialize(
      serialize({ meta: { version: 15 } as never, run: run as never, savedAt: 1, syncVersion: 1, deviceId: 'd' })
    );
    expect(back?.run?.held).toBeNull();
    expect(back?.run?.heldFrom).toEqual({ kind: 'none' });
  });

  it('★ v13 老档：事件近期记录补空数组', () => {
    const run = createStartingRun(5) as unknown as Record<string, unknown>;
    delete run['eventHistory'];
    const back = deserialize(
      serialize({ meta: { version: 13 } as never, run: run as never, savedAt: 1, syncVersion: 1, deviceId: 'd' })
    );
    expect(back?.run?.eventHistory).toEqual({ night: [], help: [], day: [], emergency: [] });
  });

  it('★ 事件记录里认不出来的 id 会被清掉（改过名字的事件不该一直占着"避开"的名额）', () => {
    const run = createStartingRun(5);
    run.eventHistory = {
      night: ['n_night_shift', 'n_已经删掉的事件'],
      help: ['q_wang_medicine', 'q_不存在'],
      day: ['d_queue_aunt'],
      emergency: ['e_cut_hand', 'e_也没有了']
    };
    const back = deserialize(
      serialize({ meta: { version: 14 } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'd' })
    );
    expect(back?.run?.eventHistory.night).toEqual(['n_night_shift']);
    expect(back?.run?.eventHistory.help).toEqual(['q_wang_medicine']);
    expect(back?.run?.eventHistory.day).toEqual(['d_queue_aunt']);
    expect(back?.run?.eventHistory.emergency).toEqual(['e_cut_hand']);
  });

  it('★ v12 老档：四组字段补空值，而且**不反推**已结束那一局的图鉴', () => {
    const run = createStartingRun(5) as unknown as Record<string, unknown>;
    // 把 run 削成 v12 的样子：去掉所有 M2 新字段
    delete run['shopPriceFactor'];
    delete run['shopLimits'];
    delete run['shopBoughtToday'];
    delete run['dayEvent'];
    delete run['metaSettled'];
    const survival = run['survival'] as Record<string, unknown>;
    delete survival['safeStreak'];
    const last = survival['last'] as Record<string, unknown>;
    delete last['emergencyId'];
    delete last['emergencyResolved'];
    delete last['emergencyLost'];

    const raw = serialize({
      meta: {
        version: 12,
        identityLevels: {},
        codex: { items: ['x'], disasters: [], npcs: [] },
        // 老档没有 bestSafeStreak —— 这正是迁移要补的那一格
        bestSurvivalDays: {}
      } as never,
      run: run as never,
      savedAt: 1,
      syncVersion: 1,
      deviceId: 'dev'
    });
    const back = deserialize(raw);
    expect(back?.meta.version).toBe(SAVE_VERSION);
    expect(back?.run?.shopPriceFactor).toBe(1);
    expect(back?.run?.shopLimits).toEqual([]);
    expect(back?.run?.shopBoughtToday).toEqual({});
    expect(back?.run?.dayEvent).toBeNull();
    expect(back?.run?.metaSettled).toBeNull();
    expect(back?.run?.survival.safeStreak).toBe(0);
    expect(back?.run?.survival.last.emergencyId).toBeNull();
    expect(back?.meta.bestSafeStreak).toBe(0);
    // 老档已经点亮的图鉴要保住（那是玩家的账，不能被迁移清掉）
    expect(back?.meta.codex.items).toEqual(['x']);
  });

  it('★ 认不出来的 dayEvent 会被清掉（否则玩家被关在一段没有文字的文案前）', () => {
    const run = createStartingRun(5);
    run.phase = 'stockpile_shop';
    run.currentShopId = 'supermarket';
    run.dayEvent = { defId: 'd_不存在的事件', shopId: 'supermarket', choice: null, applied: null };
    const back = deserialize(serialize({ meta: { version: 13 } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'd' }));
    expect(back?.run?.dayEvent).toBeNull();
  });

  it('★ 认不出来的突发事件 id 退化成"今天没事"（不让日报去查一个不存在的 id）', () => {
    const run = createStartingRun(5);
    run.survival.last.emergencyId = 'e_已经被删掉的事件';
    const back = deserialize(serialize({ meta: { version: 13 } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'd' }));
    expect(back?.run?.survival.last.emergencyId).toBeNull();
  });

  it('★ meta 被手改坏（codex 不是对象）也能补成合法形状，不抛异常', () => {
    const save = createSaveGame(bareRun());
    (save.meta as unknown as Record<string, unknown>)['codex'] = 'broken';
    const back = migrate(JSON.parse(JSON.stringify(save)));
    expect(back?.meta.codex).toEqual({ items: [], disasters: [], npcs: [] });
    expect(back?.meta.bestSafeStreak).toBe(0);
  });

  it('★ shopBoughtToday 里的坏值被丢掉（字符串会让限购算出 NaN）', () => {
    const run = createStartingRun(5);
    run.shopBoughtToday = { 'supermarket|canned_beans': 'three' as unknown as number, 'supermarket|milk': 2, 'x|y': -1 };
    const back = deserialize(serialize({ meta: { version: 13 } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'd' }));
    expect(back?.run?.shopBoughtToday).toEqual({ 'supermarket|milk': 2 });
  });
});
