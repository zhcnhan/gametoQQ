import { describe, expect, it } from 'vitest';
import { FIRST_STOCKPILE_DAY } from '../data/disaster';
import { NIGHT_SLEEP } from '../data/nightEvents';
import { ACTION_POINTS_PER_DAY, SHOP_DEFS } from '../data/shops';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import {
  NEXT_PHASES,
  canAdvance,
  chooseIdentity,
  chooseNightOption,
  endDay,
  ensureDayStocks,
  goHome,
  goOut,
  isStockpilePhase,
  sleep
} from './phases';
import { createStartingRun } from './setup';
import { enterShop } from './shop';

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
    expect(store.run.cash).toBe(680);
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

  it('连点 7 次过一天：D-7 一路走到 D-Day，phase 变 ending', () => {
    const store = startedStore();
    expect(store.run.day).toBe(-7);
    for (let i = 0; i < 7; i++) {
      goHome(store);
      passDay(store);
    }
    expect(store.run.day).toBe(0);
    expect(store.run.phase).toBe('ending');
    expect(store.run.actionPoints).toBe(0);
    expect(store.run.log.some((line) => line.startsWith('D-Day'))).toBe(true);
  });

  it('走到 D-Day 之后再过一天被拒（结束页不会再往下走）', () => {
    const store = startedStore();
    for (let i = 0; i < 7; i++) {
      goHome(store);
      passDay(store);
    }
    expect(endDay(store).ok).toBe(false);
    expect(store.run.phase).toBe('ending');
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
