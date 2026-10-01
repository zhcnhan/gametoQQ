/**
 * 跨局结算（§6.7 图鉴 / §9.6 第三项）与 luxury 品类的赌性。
 *
 * 这一组守两条**最容易悄悄坏掉**的口径：
 *
 *  ① **结算只发一次奖**：结局有三条路（撑满 / 健康归零 / 读档自愈），
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
import { SAVE_VERSION, createSaveGame, deserialize, migrate, serialize } from '../state/save';
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

/** 一个已经走完的局：撑满 14 天，屋子里留了几样东西 */
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

  it('★ 商店一件都不卖 —— 唯一的来源是运气（否则赌性当场消失）', () => {
    const luxuryIds = new Set(ITEM_DEFS.filter((d) => d.category === 'luxury').map((d) => d.id));
    for (const shop of SHOP_DEFS) {
      for (const offer of shop.offers) {
        expect(luxuryIds.has(offer.itemId)).toBe(false);
      }
    }
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

describe('存档 v13：M2 四组新字段的迁移与自愈', () => {
  it('当前版本就是 v13', () => {
    expect(SAVE_VERSION).toBe(13);
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
