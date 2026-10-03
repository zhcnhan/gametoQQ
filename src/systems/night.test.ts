/**
 * 夜间事件（§6.2）。
 * 这一组测试钉的是"夜是可选行动，不是考试"这条设计：
 * 事件池的形态、60% 的种子化判定、选项后果的落账方式，以及**夜一定有出口**。
 */
import { describe, expect, it } from 'vitest';
import { NIGHT_EVENT_DEFS, NIGHT_SLEEP, findNightEvent, hasNightEvent } from '../data/nightEvents';
import { createCursor } from '../model/rng';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { NIGHT_EVENT_CHANCE, NO_EFFECT, describeEffect, optionAt, resolveOutcome, rollNight } from './night';
import { chooseIdentity, chooseNightOption, endDay, goHome, sleep } from './phases';
import { createStartingRun } from './setup';

function createSaveSchedulerStub() {
  return {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  };
}

/** 走到"刚回家、还没过这一天"的状态 */
function storeAtHome(seed: number): GameStore {
  const store = new GameStore(createSaveGame(createStartingRun(seed)), createSaveSchedulerStub());
  chooseIdentity(store, 'group_buyer');
  goHome(store);
  return store;
}

/** 反复换 seed 直到抽中一个"今晚有事"的晚上 —— 比 mock RNG 更贴近真实调用链 */
function storeAtNight(): GameStore {
  for (let seed = 1; seed < 500; seed++) {
    const store = storeAtHome(seed);
    endDay(store);
    if (store.run.phase === 'night') return store;
  }
  throw new Error('500 个种子里都没有一个夜晚有事件，说明判定的概率算错了');
}

describe('事件表：形态校验', () => {
  it('事件表非空、id 唯一（条数是内容量，不是不变量 —— 别把数字写死在这里）', () => {
    expect(NIGHT_EVENT_DEFS.length).toBeGreaterThanOrEqual(6);
    const ids = NIGHT_EVENT_DEFS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条 2~3 个选项（§6.2），标签 ≤ 8 字（手机竖屏一行放得下）', () => {
    for (const def of NIGHT_EVENT_DEFS) {
      expect(def.options.length).toBeGreaterThanOrEqual(2);
      expect(def.options.length).toBeLessThanOrEqual(3);
      for (const opt of def.options) {
        expect(opt.label.length).toBeLessThanOrEqual(8);
        expect(opt.outcome.length).toBeGreaterThan(4);
      }
    }
  });

  it('文本 1~2 句、克制（不许出现引号台词）', () => {
    /*
     * ★ 这里 M3 修了两处，两处都是"测试的写法与它声称的规则不是一回事"：
     *
     *  1. **数量断言从"恰好 6 条"改成"至少 6 条、id 唯一"。**
     *     原来那条 `toHaveLength(6)` 守的其实是"表里恰好有 6 条"这个**事实**，
     *     而不是任何设计规则 —— M3 把夜间事件补到 28 条时它当场就红了。
     *     条数是内容量，不是不变量；**id 唯一**才是不变量。
     *  2. **`text.includes('：')` 这个判据写宽了。**
     *     它想拦的是**台词腔**（"王阿姨说：'…'"），但冒号本身在"报事实"
     *     的句子里是正常的：`半夜冻醒了一次。你摸到床头的温度贴：9°C。`
     *     这一条与 §10B 的内容口径完全一致（"天气只报温度与事实"），
     *     而它在旧判据下会被判违规。
     *     所以改成拦**真正的台词标志**：引号对（`""` / `''` / `「」`）
     *     与"某某说："这种转述引语。
     */
    const DIALOGUE = /[“”‘’「」『』]|说\s*[：:]/;
    for (const def of NIGHT_EVENT_DEFS) {
      expect(def.text.length).toBeGreaterThan(8);
      expect(def.text.length).toBeLessThanOrEqual(60);
      expect(DIALOGUE.test(def.text), `${def.id} 的正文像是台词：${def.text}`).toBe(false);
    }
  });

  it('数值量级合理（防止手滑多打一个 0）', () => {
    for (const def of NIGHT_EVENT_DEFS) {
      for (const opt of def.options) {
        for (const [key, value] of Object.entries(opt.effect)) {
          if (key === 'boxDefId') continue;
          expect(Math.abs(value as number)).toBeLessThanOrEqual(200);
        }
      }
    }
  });

  it('id 查表：认识自己表里的，不认识的就返回 null', () => {
    expect(hasNightEvent(NIGHT_EVENT_DEFS[0]?.id ?? '')).toBe(true);
    expect(findNightEvent('n_does_not_exist')).toBeNull();
  });
});

describe('今晚有没有事：种子化判定', () => {
  it('约 60% 的夜晚有事（统计上落在 0.5~0.7）', () => {
    let hits = 0;
    const samples = 600;
    for (let i = 0; i < samples; i++) {
      if (rollNight(createCursor(i * 7919 + 13))) hits += 1;
    }
    const rate = hits / samples;
    expect(rate).toBeGreaterThan(0.5);
    expect(rate).toBeLessThan(0.7);
    expect(NIGHT_EVENT_CHANCE).toBe(0.6);
  });

  it('同 seed 同序列（存档可复现），且既不是全有事也不是全没事', () => {
    const seq = (seed: number): (string | null)[] => {
      const cursor = createCursor(seed);
      return Array.from({ length: 14 }, () => rollNight(cursor));
    };
    const a = seq(20261001);
    expect(a).toEqual(seq(20261001));
    expect(a.some((id) => id !== null)).toBe(true);
    expect(a.some((id) => id === null)).toBe(true);
  });

  it('抽中的一定是表里的事件', () => {
    const cursor = createCursor(4242);
    for (let i = 0; i < 100; i++) {
      const id = rollNight(cursor);
      if (id) expect(hasNightEvent(id)).toBe(true);
    }
  });
});

describe('过一天 → 入夜', () => {
  it('今晚有事：日历停在原地，phase 推到 night，choice 为空（等玩家决定）', () => {
    const store = storeAtNight();
    expect(store.run.phase).toBe('night');
    expect(store.run.day).toBe(-7); // 日历没动 —— 决定完才跨天
    expect(store.run.night?.choice).toBeNull();
    expect(store.run.night?.eventId).toBeTruthy();
  });

  it('今晚没事：直接跨天（约 40% 的夜晚就这么跳过去）', () => {
    for (let seed = 1; seed < 500; seed++) {
      const store = storeAtHome(seed);
      endDay(store);
      if (store.run.phase === 'stockpile_shop') {
        expect(store.run.night).toBeNull();
        expect(store.run.day).toBe(-6);
        return;
      }
    }
    throw new Error('500 个种子里没有一个夜晚没事，说明判定的概率算错了');
  });

  it('在家才能过一天（在外/夜里都不行）', () => {
    const store = storeAtNight();
    expect(endDay(store).ok).toBe(false);
  });
});

describe('决定今晚怎么办', () => {
  it('选项后果真的落账：心情涨、体力掉、日志写一条', () => {
    const store = storeAtNight();
    const def = findNightEvent(store.run.night?.eventId ?? '');
    expect(def).not.toBeNull();
    const opt = def?.options[0];
    expect(opt).toBeDefined();
    if (!def || !opt) return;

    const before = { ...store.run.stats };
    const result = chooseNightOption(store, 0);
    expect(result.ok).toBe(true);
    expect(store.run.night?.choice).toBe(0);
    expect(store.run.stats.mood).toBe(clamp(before.mood + (opt.effect.mood ?? 0)));
    expect(store.run.stats.stamina).toBe(clamp(before.stamina + (opt.effect.stamina ?? 0)));
    expect(store.run.log.some((line) => line.startsWith('夜间 · '))).toBe(true);
  });

  it('「关灯睡觉」= 什么都不做：数值一分不动，但选择被记住（夜必须能过）', () => {
    const store = storeAtNight();
    const before = { stats: { ...store.run.stats }, cash: store.run.cash, boxes: store.run.boxesToUnpack.length };
    const result = chooseNightOption(store, NIGHT_SLEEP);
    expect(result.ok).toBe(true);
    expect(store.run.night?.choice).toBe(NIGHT_SLEEP);
    expect(store.run.stats).toEqual(before.stats);
    expect(store.run.cash).toBe(before.cash);
    expect(store.run.boxesToUnpack.length).toBe(before.boxes);
  });

  it('不能反悔：同一个晚上选过一次就锁住了', () => {
    const store = storeAtNight();
    chooseNightOption(store, NIGHT_SLEEP);
    expect(chooseNightOption(store, 0).ok).toBe(false);
    expect(store.run.night?.choice).toBe(NIGHT_SLEEP);
  });

  it('越界 / 非法选择被拒，且不改状态', () => {
    const store = storeAtNight();
    const snapshot = JSON.stringify(store.run);
    expect(chooseNightOption(store, 99).ok).toBe(false);
    expect(store.run.night?.choice).toBeNull();
    expect(JSON.stringify(store.run)).toBe(snapshot);
  });

  it('白天不能做夜间决定', () => {
    const store = storeAtHome(1);
    expect(chooseNightOption(store, 0).ok).toBe(false);
  });

  it('带箱的选项会真的塞一箱进待拆队列（引擎③：拆箱惊喜）', () => {
    // 直接构造"半夜补货"这一晚，专测 boxDefId 这条支路
    const store = storeAtHome(20261001);
    const before = store.run.boxesToUnpack.length;
    store.run.phase = 'night';
    store.run.night = { eventId: 'n_midnight_restock', choice: null, applied: null };

    const result = chooseNightOption(store, 0);
    expect(result.ok).toBe(true);
    expect(store.run.boxesToUnpack.length).toBe(before + 1);
    const box = store.run.boxesToUnpack[store.run.boxesToUnpack.length - 1];
    expect(box?.defId).toBe('box_mixed');
    expect(box?.items.length).toBeGreaterThan(0);
  });

  it('四维与现金都被夹在合法区间（不会因为一个选项变成负数或爆表）', () => {
    const store = storeAtHome(20261001);
    store.run.stats.mood = 2;
    store.run.stats.stamina = 3;
    store.run.cash = 0;
    store.run.phase = 'night';
    store.run.night = { eventId: 'n_night_shift', choice: null, applied: null };

    chooseNightOption(store, 0); // 体力 -25，现金 +120
    expect(store.run.stats.stamina).toBe(0);
    expect(store.run.cash).toBe(120);

    const store2 = storeAtHome(20261001);
    store2.run.cash = 10;
    store2.run.phase = 'night';
    store2.run.night = { eventId: 'n_old_classmate', choice: null, applied: null };
    chooseNightOption(store2, 0); // 现金 -80
    expect(store2.run.cash).toBe(0);
  });
});

describe('钱不够的时候，界面要说实话', () => {
  /** 兜里只有 25 元、正被老同学借钱的一晚 */
  function storeBroke(): GameStore {
    const store = storeAtHome(20261001);
    store.run.cash = 25;
    store.run.phase = 'night';
    store.run.night = { eventId: 'n_old_classmate', choice: null, applied: null };
    return store;
  }

  it('人情类选项允许少给：只有 25 就只扣 25', () => {
    const store = storeBroke();
    expect(chooseNightOption(store, 0).ok).toBe(true);
    expect(store.run.cash).toBe(0);
    expect(store.run.night?.applied?.cash).toBe(-25);
  });

  it('★ 摘要报的是**实际**扣掉的数，不是选项里写的 80', () => {
    const store = storeBroke();
    chooseNightOption(store, 0);
    const applied = store.run.night?.applied;
    expect(applied).toBeTruthy();
    if (!applied) return;
    expect(describeEffect(applied)).toContain('现金 -25');
    expect(describeEffect(applied)).not.toContain('现金 -80');
  });

  it('结果文案里的 {spentCash} 换成真数：钱够说 80，钱不够说 25', () => {
    const option = findNightEvent('n_old_classmate')?.options[0];
    expect(option).toBeTruthy();
    if (!option) return;
    expect(resolveOutcome(option, { ...NO_EFFECT, cash: -80 })).toContain('转过去 80');
    expect(resolveOutcome(option, { ...NO_EFFECT, cash: -25 })).toContain('转过去 25');
  });

  it('买货类选项必须给得起钱：钱不够就拒，也不能白给一箱', () => {
    const store = storeAtHome(20261001);
    const before = store.run.boxesToUnpack.length;
    store.run.cash = 10;
    store.run.phase = 'night';
    store.run.night = { eventId: 'n_midnight_restock', choice: null, applied: null };

    expect(chooseNightOption(store, 0).ok).toBe(false); // 这一趟要 50 元
    expect(store.run.boxesToUnpack.length).toBe(before);
    expect(store.run.cash).toBe(10);
  });

  it('钱够的时候一切照旧', () => {
    const store = storeAtHome(20261001);
    const before = store.run.boxesToUnpack.length;
    store.run.cash = 200;
    store.run.phase = 'night';
    store.run.night = { eventId: 'n_midnight_restock', choice: null, applied: null };

    expect(chooseNightOption(store, 0).ok).toBe(true);
    expect(store.run.cash).toBe(150);
    expect(store.run.boxesToUnpack.length).toBe(before + 1);
  });
});

describe('关灯 → 跨到第二天', () => {
  it('没做决定就不让睡（夜里没有别的出口，所以这一步必须拦）', () => {
    const store = storeAtNight();
    expect(sleep(store).ok).toBe(false);
    expect(store.run.phase).toBe('night');
  });

  it('选了之后关灯：跨天、行动点回满、车载清零、夜色清空', () => {
    const store = storeAtNight();
    chooseNightOption(store, NIGHT_SLEEP);
    const result = sleep(store);
    expect(result.ok).toBe(true);
    expect(store.run.phase).toBe('stockpile_shop');
    expect(store.run.day).toBe(-6);
    expect(store.run.night).toBeNull();
    expect(store.run.carLoad).toBe(0);
    expect(store.run.actionPoints).toBeGreaterThan(0);
  });

  it('同 seed 走同一条夜路 → 结果完全一致（存档可复现）', () => {
    const run = (): unknown => {
      const store = storeAtNightFrom(777);
      chooseNightOption(store, 0);
      sleep(store);
      return { day: store.run.day, stats: store.run.stats, cash: store.run.cash, seed: store.run.seed };
    };
    expect(run()).toEqual(run());
  });
});

/** 与 storeAtNight 相同，但固定种子并要求它真的入夜 */
function storeAtNightFrom(seed: number): GameStore {
  const store = storeAtHome(seed);
  endDay(store);
  if (store.run.phase !== 'night') {
    // 这个种子今晚没事 —— 直接手工安一个夜色，测的还是同一条命令链
    store.run.phase = 'night';
    store.run.night = { eventId: 'n_neighbor_soup', choice: null, applied: null };
  }
  return store;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

describe('后果摘要（界面用）', () => {
  it('空后果返回空数组 —— 界面据此不渲染数值行（"直接睡"不该被写一句"无变化"）', () => {
    expect(describeEffect(NO_EFFECT)).toEqual([]);
    expect(describeEffect({ ...NO_EFFECT, mood: 0 })).toEqual([]);
  });

  it('正负号看得懂', () => {
    expect(describeEffect({ ...NO_EFFECT, mood: 12, stamina: -8 })).toEqual(['心情 +12', '体力 -8']);
    expect(describeEffect({ ...NO_EFFECT, gotBox: true })).toEqual(['带回来一箱货']);
  });

  it('optionAt 把 NIGHT_SLEEP 解成 null（= 什么都不做）', () => {
    const def = NIGHT_EVENT_DEFS[0];
    expect(def).toBeDefined();
    if (!def) return;
    expect(optionAt(def, NIGHT_SLEEP)).toBeNull();
    expect(optionAt(def, 0)).toBe(def.options[0]);
    expect(optionAt(def, 99)).toBeNull();
  });
});
