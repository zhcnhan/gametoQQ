import { describe, expect, it } from 'vitest';
import { FIRST_STOCKPILE_DAY, disasterModifiersOf } from '../data/disaster';
import { NIGHT_SLEEP } from '../data/nightEvents';
import { ACTION_POINTS_PER_DAY, SHOP_DEFS } from '../data/shops';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import {
  GO_HOME_AP_COST,
  NEXT_PHASES,
  advanceSurvivalDay,
  backToSurvival,
  canAdvance,
  chooseIdentity,
  chooseNightOption,
  endDay,
  ensureDayStocks,
  goHome,
  goOrganize,
  goOut,
  isStockpilePhase,
  isSurvivalOrganize,
  sleep,
  startSurvival
} from './phases';
import { createStartingRun } from './setup';
import { enterShop } from './shop';
import { applyZone } from './organize';

function createSaveSchedulerStub() {
  return {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  };
}

function newStore(seed = 20261001) {
  return new GameStore(createSaveGame(createStartingRun(seed)), createSaveSchedulerStub());
}

function startedStore(seed = 20261001, identityId = 'group_buyer') {
  const store = newStore(seed);
  chooseIdentity(store, identityId);
  return store;
}

/**
 * 完整走完一天。
 *
 * 阶段 B 之后 `endDay` 有了岔路：约 60% 的夜晚会先入夜，需要决定 + 关灯才跨天。
 * 这个 helper 把两条路并成一条 —— 测试关心的是"过了一天"这件事本身，
 * 不该被"今晚有没有事"的随机性缠住（那一层由 night.test.ts 专门覆盖）。
 */
function passDay(store: GameStore): void {
  endDay(store);
  if (store.run.phase === 'night') {
    chooseNightOption(store, NIGHT_SLEEP);
    sleep(store);
  }
}

describe('开局：prologue → stockpile_shop', () => {
  it('新局停在 prologue，身份与现金都是空的', () => {
    const store = newStore();
    expect(store.run.phase).toBe('prologue');
    expect(store.run.identityId).toBe('');
    expect(store.run.cash).toBe(0);
    expect(store.run.shopStocks).toEqual([]);
  });

  it('选身份后一次性把身份/现金/第一天/行动点/当日库存全部就位', () => {
    const store = startedStore(20261001, 'night_shift');
    expect(store.run.phase).toBe('stockpile_shop');
    expect(store.run.identityId).toBe('night_shift');
    expect(store.run.cash).toBe(780); // §12.3 v0.7：14 天窗口下的开局现金
    expect(store.run.day).toBe(FIRST_STOCKPILE_DAY);
    expect(store.run.actionPoints).toBe(ACTION_POINTS_PER_DAY);
    expect(store.run.shopStocks.map((s) => s.shopId)).toEqual(SHOP_DEFS.map((s) => s.id));
    expect(store.run.shopStocks.every((s) => s.day === FIRST_STOCKPILE_DAY)).toBe(true);
  });

  it('开局就会生成当日库存（否则第一天进店是空的）', () => {
    const store = startedStore();
    const supermarket = store.run.shopStocks.find((s) => s.shopId === 'supermarket');
    expect(supermarket?.lines.length).toBeGreaterThan(0);
    expect(supermarket?.lines.every((l) => l.stock >= 1 && l.price >= 1)).toBe(true);
  });

  it('已经开过的局不能再选身份', () => {
    const store = startedStore();
    const again = chooseIdentity(store, 'night_shift');
    expect(again.ok).toBe(false);
    expect(store.run.identityId).toBe('group_buyer');
  });

  it('不存在的身份被拒', () => {
    const store = newStore();
    expect(chooseIdentity(store, '不存在的身份').ok).toBe(false);
    expect(store.run.phase).toBe('prologue');
  });
});

describe('外出 ⇄ 回家', () => {
  it('进店消耗 1 行动点，并记住"正站在哪家店"', () => {
    const store = startedStore();
    const r = enterShop(store, 'supermarket');
    expect(r.ok).toBe(true);
    expect(store.run.actionPoints).toBe(ACTION_POINTS_PER_DAY - 1);
    expect(store.run.currentShopId).toBe('supermarket');
    expect(store.run.visitedShopIds).toEqual(['supermarket']);
  });

  it('行动点用完就进不去店门了', () => {
    const store = startedStore();
    store.run.actionPoints = 0;
    const r = enterShop(store, 'pharmacy');
    expect(r.ok).toBe(false);
    expect(store.run.currentShopId).toBeNull();
  });

  it('回家后可以再出门（只要行动点没用完）', () => {
    const store = startedStore();
    enterShop(store, 'supermarket');
    expect(goHome(store).ok).toBe(true);
    expect(store.run.phase).toBe('organize');
    expect(store.run.currentShopId).toBeNull();

    expect(goOut(store).ok).toBe(true);
    expect(store.run.phase).toBe('stockpile_shop');
  });

  it('在家不能进店，在外不能过一天（非法流转被拒）', () => {
    const store = startedStore();
    expect(enterShop(store, 'supermarket').ok).toBe(true);
    expect(endDay(store).ok).toBe(false); // 还在外面
    expect(goHome(store).ok).toBe(true);
    expect(enterShop(store, 'supermarket').ok).toBe(false); // 已经在家
  });

  it('行动点为 0 时再出门被拒', () => {
    const store = startedStore();
    goHome(store);
    store.run.actionPoints = 0;
    expect(goOut(store).ok).toBe(false);
    expect(store.run.phase).toBe('organize');
  });
});

describe('过一天：日历推进', () => {
  it('过一天会换天、重置行动点、重置车载、换一份当日库存', () => {
    const store = startedStore();
    const before = store.run.shopStocks.map((s) => s.lines.map((l) => l.stock).join(','));
    store.run.carLoad = 12; // 假装今天搬了 12kg 上车
    store.run.actionPoints = 0;
    goHome(store);

    passDay(store);
    expect(store.run.day).toBe(FIRST_STOCKPILE_DAY + 1);
    expect(store.run.phase).toBe('stockpile_shop');
    expect(store.run.actionPoints).toBe(ACTION_POINTS_PER_DAY);
    expect(store.run.carLoad).toBe(0);
    expect(store.run.visitedShopIds).toEqual([]);
    expect(store.run.shopStocks.every((s) => s.day === store.run.day)).toBe(true);
    // 库存被重新掷过（大概率不同，但绝不与昨天共享同一条 day）
    expect(store.run.shopStocks.map((s) => s.lines.map((l) => l.stock).join(','))).not.toEqual(before);
  });

  it('连点 7 次过一天：D-7 一路走到 D-Day，phase 交给生存期', () => {
    const store = startedStore();
    expect(store.run.day).toBe(-7);
    for (let i = 0; i < 7; i++) {
      goHome(store);
      passDay(store);
    }
    expect(store.run.day).toBe(0);
    // 阶段 C 起 D-Day 不再直接进结算页，而是交给生存期（货架上的成果全都还在）
    expect(store.run.phase).toBe('survival_day');
    expect(store.run.actionPoints).toBe(0);
    expect(store.run.log.some((line) => line.startsWith('D-Day'))).toBe(true);
  });

  it('走到 D-Day 之后囤货期的"过一天"被拒（日历交给生存期了）', () => {
    const store = startedStore();
    for (let i = 0; i < 7; i++) {
      goHome(store);
      passDay(store);
    }
    expect(endDay(store).ok).toBe(false);
    expect(store.run.phase).toBe('survival_day');
  });

  it('囤货期最后一天是 -1，不是 0', () => {
    const store = startedStore();
    for (let i = 0; i < 6; i++) {
      goHome(store);
      passDay(store);
    }
    expect(store.run.day).toBe(-1);
    expect(store.run.phase).toBe('stockpile_shop');
  });
});

describe('状态机流转表', () => {
  it('钉死 M1 阶段 A 允许的流转', () => {
    expect(canAdvance('prologue', 'stockpile_shop')).toBe(true);
    expect(canAdvance('stockpile_shop', 'organize')).toBe(true);
    expect(canAdvance('organize', 'night')).toBe(true);
    expect(canAdvance('organize', 'ending')).toBe(true);
    expect(canAdvance('ending', 'stockpile_shop')).toBe(false);
    expect(canAdvance('prologue', 'ending')).toBe(false);
    expect(NEXT_PHASES.ending).toEqual([]);
  });

  it('isStockpilePhase 只认囤货期三个界面', () => {
    expect(isStockpilePhase('stockpile_shop')).toBe(true);
    expect(isStockpilePhase('organize')).toBe(true);
    expect(isStockpilePhase('night')).toBe(true);
    expect(isStockpilePhase('survival_day')).toBe(false);
    expect(isStockpilePhase('ending')).toBe(false);
  });
});

/**
 * 一路推进到 D-Day（`phase === 'survival_day'` 且 `day === 0`）。
 *
 * ⚠ 它**不能用 `passDay` 循环固定次数** —— 囤货期的最后一天是 `day === -1`，
 * 而它离开局隔了 7 天（`FIRST_STOCKPILE_DAY = -7`）。这里按 phase 循环，
 * 哪天跨过去就哪天停，改日历起点也不会让这个 helper 静默失效。
 */
function toDDay(store: GameStore): void {
  let guard = 0;
  while (store.run.phase !== 'survival_day' && guard < 30) {
    if (store.run.phase === 'organize') passDay(store);
    else if (store.run.phase === 'stockpile_shop') goHome(store);
    else break;
    guard += 1;
  }
  if (store.run.phase !== 'survival_day') throw new Error('没能推进到 D-Day');
  expect(store.run.day).toBe(0);
}

/** D-Day 之后迈出第一步：`day 0 → 1`，`startSurvival` 会顺手发今天的行动点 */
function inSurvival(seed = 20261001): GameStore {
  const store = startedStore(seed);
  toDDay(store);
  startSurvival(store);
  return store;
}

describe('★★ 生存期回整理页（M4 决策 B）', () => {
  it('★ 生存期有行动点 —— 它是"回家整理"的代价，而它以前从 D-Day 起恒为 0', () => {
    const store = inSurvival();
    expect(store.run.phase).toBe('survival_day');
    /*
     * 这一条是整个 W-09 的地基：`startNextDay` 跨到 D-Day 时把行动点清零，
     * 而**之后再没人写过它** —— 于是"每次回去花 1 点"会变成"永远付不起"。
     * 断言写成"≥1 且 = 算式结果"而不是写死 3：`actionPointDelta` 是这一场的维度之一。
     */
    const mods = disasterModifiersOf(store.run.disasterId);
    expect(store.run.actionPoints).toBe(Math.max(1, ACTION_POINTS_PER_DAY + mods.actionPointDelta));
    expect(store.run.actionPoints).toBeGreaterThanOrEqual(1);
  });

  it('流转表允许 survival_day ⇄ organize，且回到日报是合法的', () => {
    expect(canAdvance('survival_day', 'organize')).toBe(true);
    expect(canAdvance('organize', 'survival_day')).toBe(true);
    // 反证：这两条本来是假的，而"从生存期回整理页"正是靠它们
    expect(NEXT_PHASES.survival_day).toContain('organize');
  });

  it('★ 回去花掉 1 个行动点，phase 变成 organize，日志里记了账', () => {
    const store = inSurvival();
    const before = store.run.actionPoints;
    expect(goOrganize(store).ok).toBe(true);
    expect(store.run.phase).toBe('organize');
    expect(store.run.actionPoints).toBe(before - GO_HOME_AP_COST);
    expect(store.run.log.some((l) => l.includes('回家整理'))).toBe(true);
  });

  it('★ 行动点不够时拒绝，且**什么都不改**', () => {
    const store = inSurvival();
    const day = store.run.day;
    store.run.actionPoints = GO_HOME_AP_COST - 1;
    const result = goOrganize(store);
    expect(result.ok).toBe(false);
    // 拒绝要说清原因与还差多少（界面的浮字直接用它）
    const reason = result.events.find((e) => e.type === 'rejected');
    expect(reason && 'reason' in reason ? reason.reason : '').toContain('行动点');
    expect(store.run.phase).toBe('survival_day');
    expect(store.run.day).toBe(day);
    expect(store.run.actionPoints).toBe(GO_HOME_AP_COST - 1);
  });

  it('囤货期不能走这条路（那是另一条：goOut / endDay）', () => {
    const store = startedStore();
    const result = goOrganize(store);
    expect(result.ok).toBe(false);
    expect(store.run.phase).toBe('stockpile_shop');
  });

  it('★ 回日报不结算、不跨天 —— 日历的推进权只在 advanceSurvivalDay 手里', () => {
    const store = inSurvival();
    const day = store.run.day;
    expect(goOrganize(store).ok).toBe(true);
    expect(backToSurvival(store).ok).toBe(true);
    expect(store.run.phase).toBe('survival_day');
    expect(store.run.day).toBe(day);
  });

  it('★★ isSurvivalOrganize 认的是"这一天跨过去了没"，不是 phase 本身', () => {
    const store = startedStore();
    goHome(store);
    expect(store.run.phase).toBe('organize');
    // 囤货期的整理 → 不是生存期那次
    expect(isSurvivalOrganize(store.run)).toBe(false);

    const surv = inSurvival();
    goOrganize(surv);
    expect(surv.run.phase).toBe('organize');
    expect(isSurvivalOrganize(surv.run)).toBe(true);

    /*
     * ★ D-Day **当天**（day === 0）也算生存期：灾难已经登陆，只是第一顿还没吃。
     * 判据若写成 `day >= 1`，那一屏的"回家整理"会掉回囤货期的形状
     * （dock 里冒出"再去采购 / 过一天"，而商店在生存期是关的）。
     */
    const dday = startedStore();
    toDDay(dday);
    expect(dday.run.day).toBe(0);
    dday.run.phase = 'organize';
    expect(isSurvivalOrganize(dday.run)).toBe(true);
  });

  it('★ 回去整理完，整理本身照常生效（用户口径："做出操作也会有影响"）', () => {
    const store = inSurvival();
    goOrganize(store);
    /*
     * 这一条不重复验 `systems/organize.ts` 的命令（那是它自己的测试），
     * 只钉住**这件事本身**：换到生存期之后，整理页的命令仍然走得通。
     * 若哪一天有人给整理命令加一道"只在囤货期允许"的闸，这条会红。
     */
    const result = applyZone(store, 'shelf_a', { name: '主食', color: '#8a8a80', categories: ['food'] });
    expect(result.ok).toBe(true);
  });

  it('★ 每次回日报之后还能再回去（用户口径："可以自由回去"）', () => {
    const store = inSurvival();
    let trips = 0;
    while (store.run.actionPoints >= GO_HOME_AP_COST) {
      expect(goOrganize(store).ok).toBe(true);
      expect(backToSurvival(store).ok).toBe(true);
      trips += 1;
    }
    // 今天的行动点全部换成了"回去整理"，一次都没被拒
    expect(trips).toBeGreaterThanOrEqual(2);
    expect(store.run.phase).toBe('survival_day');
  });

  it('★ 下一天把行动点补回来（否则第二天再也回不去）', () => {
    const store = inSurvival();
    goOrganize(store);
    backToSurvival(store);
    store.run.actionPoints = 0;
    advanceSurvivalDay(store);
    const mods = disasterModifiersOf(store.run.disasterId);
    expect(store.run.actionPoints).toBe(Math.max(1, ACTION_POINTS_PER_DAY + mods.actionPointDelta));
  });
});

describe('存档自愈：ensureDayStocks', () => {
  it('库存已经是今天的 → 什么都不做，seed 一分不动（幂等）', () => {
    const store = startedStore();
    const seed = store.run.seed;
    expect(ensureDayStocks(store)).toBe(false);
    expect(store.run.seed).toBe(seed);
  });

  it('库存不属于今天（v4 迁移过来的空档）→ 重建并推进 seed', () => {
    const store = startedStore();
    const seed = store.run.seed;
    store.run.shopStocks = [];
    expect(ensureDayStocks(store)).toBe(true);
    expect(store.run.shopStocks).toHaveLength(SHOP_DEFS.length);
    expect(store.run.shopStocks.every((s) => s.day === store.run.day)).toBe(true);
    expect(store.run.seed).not.toBe(seed);
    // 再调一次不再动
    expect(ensureDayStocks(store)).toBe(false);
  });

  it('不是囤货期（prologue / ending）不碰库存', () => {
    const store = newStore();
    expect(ensureDayStocks(store)).toBe(false);
  });
});
