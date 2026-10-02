/**
 * 全流程走测（M2 验收的"最后跑一局"那条，只是跑在**真实命令**上而不是浏览器里）。
 *
 * ## 它比单测多测了什么
 *
 * 单测各自守一块规则；这一条守**它们接起来还成不成立**：
 * 真实状态机（prologue → 囤货 → 夜间 → D-Day → 生存 → 结算）、真实的采购/整理命令、
 * 真实的种子游标、真实的存档序列化来回。M1 的教训是"每一块都对，接起来卡死"
 * （刷新卡在夜里、卡在门口），所以这一条必须有。
 *
 * ## 三档各跑一整局，而且都从**存档字符串**里恢复一次
 *
 * 每次换页/换天都过一遍 `serialize` → `deserialize`，等于模拟"玩家每次操作后都刷新页面"。
 * §4A 承诺的是"任何时刻杀进程，损失 = 0"，而这条走测就是那句话的回归测试。
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, getItemDef } from '../data/items';
import { NIGHT_SLEEP } from '../data/nightEvents';
import { SURVIVAL_DAYS, getDisasterDef } from '../data/disaster';
import { dailyDrainOf } from '../data/survival';
import type { CategoryId, RunState } from '../model/types';
import { makeStack, setSlotStack } from '../model/shelf';
import { GameStore } from '../state/store';
import { SAVE_VERSION, createSaveGame, deserialize, serialize } from '../state/save';
import { settleRunMeta } from './codex';
import { declineRequest, fulfillRequest } from './help';
import {
  advanceSurvivalDay,
  chooseIdentity,
  chooseNightOption,
  endDay,
  goHome,
  sleep,
  startSurvival
} from './phases';
import {
  applyZone,
  assignZone,
  createOrganizeSession,
  householdTotals,
  pickupFromShelf,
  placeHeld,
  restoreOrganizeSession,
  sortAllByFEFO,
  takeFromBox
} from './organize';
import { buildCartView, buyCart, enterShop, findShopStock, resolveDayEvent } from './shop';
import { createStartingRun } from './setup';

/**
 * 囤货期的一趟采购。
 *
 * ## 策略（它是被实测**调出来**的，不是拍脑袋写的）
 *
 * 第一版"每天三家店、按需买满"实测买到了 74 件主食、**1 罐燃料**，D+13 倒下。
 * 原因不是钱：**车装不下**（车载 58kg/天，燃料一件就 4kg）。
 * 主食便宜、轻、件数多，一趟超市就能把车塞满，等走到五金店时车里只剩 1.34kg。
 *
 * 所以这里的口径是：
 *   · **按钱包比例分账**：燃料 0.40 / 主食 0.25 / 饮水 0.12 / 医疗保暖 0.1，
 *     而且**每家店都按当前钱包重算** —— 超市花掉一部分，五金店拿到的份额自然变小；
 *   · **主食的"重货"（大米、面粉）只在第一天之后才买** —— 它们一件 5kg / 2.5kg，
 *     在 D-7 那天买等于把车留给燃料的位置占了。真实玩家也会先抢燃料；
 *   · 每次结账装到**单趟负重**为止，剩下的分下一趟（分趟不扣行动点）。
 */
function stockUp(store: GameStore, shopId: string): number {
  const drain = dailyDrainOf(getDisasterDef(store.run.disasterId));
  const daysLeft = SURVIVAL_DAYS + 1;
  const stock = findShopStock(store.run, shopId);
  if (!stock) return 0;

  /** 这个品类还能花多少钱。按**当前钱包**的比例算，每家店重算一次 */
  const purse = (category: CategoryId): number => {
    const cash = store.run.cash;
    if (category === 'fuel') return cash * 0.4;
    if (category === 'food') return cash * 0.25;
    if (category === 'water') return cash * 0.12;
    return cash * 0.1;
  };

  /** 重货：一件 2.5kg 以上的主食。晚期再买，免得占掉燃料的位置 */
  const HEAVY = new Set(['rice_bag', 'flour']);

  const PRIORITY: CategoryId[] = ['fuel', 'food', 'water', 'medicine', 'warmth'];
  const wants = new Map<string, number>();
  for (const category of PRIORITY) {
    if (category === 'medicine' || category === 'warmth') {
      const target = category === 'medicine' ? 6 : 2;
      for (const line of stock.lines) {
        if (getItemDef(line.itemId).category !== category || line.stock <= 0) continue;
        wants.set(line.itemId, (wants.get(line.itemId) ?? 0) + target);
      }
      continue;
    }
    const need = drain.find((d) => d.category === category)?.need ?? 0;
    if (need <= 0) continue;
    for (const line of stock.lines) {
      if (getItemDef(line.itemId).category !== category || line.stock <= 0) continue;
      if (HEAVY.has(line.itemId) && store.run.day < -4) continue;
      wants.set(line.itemId, (wants.get(line.itemId) ?? 0) + need * daysLeft);
    }
  }
  // eslint-disable-next-line no-console
  if (WALK_DEBUG) {
    console.log(
      'STOCKUP',
      shopId,
      'day=' + store.run.day,
      'cash=' + store.run.cash,
      'purse(fuel)=' + Math.round(purse('fuel')),
      'wants=' + JSON.stringify(Object.fromEntries(wants))
    );
  }

  // 反复结账，直到这一趟装不下任何东西（分趟不扣行动点，所以可以多跑几趟）
  let boughtPieces = 0;
  for (let trip = 0; trip < 12; trip++) {
    const lines = [...wants.entries()]
      .filter(([, count]) => count > 0)
      .map(([itemId, count]) => ({ itemId, count: Math.min(count, 99) }));
    if (lines.length === 0) return boughtPieces;
    const view = buildCartView(store.run, shopId, lines);
    if (!view || view.lines.length === 0) return boughtPieces;
    // 只把"这一趟真的能装下、而且这个品类还买得起"的那部分放进车
    let picked = view.lines.map((l) => ({ itemId: l.itemId, count: l.count }));
    let guard = 0;
    while (guard < 80) {
      guard += 1;
      const check = buildCartView(store.run, shopId, picked);
      if (!check) return boughtPieces;
      const affordable = check.lines.every((l) => {
        const sameCat = check.lines.filter(
          (x) => getItemDef(x.itemId).category === getItemDef(l.itemId).category
        );
        const catCost = sameCat.reduce((n, x) => n + x.unitPrice * x.count, 0);
        return catCost <= purse(getItemDef(l.itemId).category) && l.unitPrice > 0;
      });
      if (check.canLoad && affordable) break;
      // 退一件：优先退最贵的（它最可能是超出品类预算的那一个）
      const priciest = [...check.lines].sort((a, b) => b.unitPrice - a.unitPrice)[0];
      if (!priciest) break;
      picked = picked
        .map((p) => (p.itemId === priciest.itemId ? { ...p, count: p.count - 1 } : p))
        .filter((p) => p.count > 0);
      if (picked.length === 0) return boughtPieces;
    }
    const finalCheck = buildCartView(store.run, shopId, picked);
    if (!finalCheck || !finalCheck.canLoad) return boughtPieces;
    if (!buyCart(store, shopId, picked).ok) return boughtPieces;
    for (const p of picked) {
      BOUGHT.set(getItemDef(p.itemId).category, (BOUGHT.get(getItemDef(p.itemId).category) ?? 0) + p.count);
      boughtPieces += p.count;
    }
    for (const p of picked) {
      const left = (wants.get(p.itemId) ?? 0) - p.count;
      if (left > 0) wants.set(p.itemId, left);
      else wants.delete(p.itemId);
    }
    if (wants.size === 0) break;
  }
  return boughtPieces;
}

/**
 * 调试开关。排查"为什么这一趟没买到东西"时把它改成 true，
 * 会逐店打印当时的钱包、各品类预算与想买的清单。
 * 平时必须是 false —— 一个会说话的测试跑起来很吵。
 */
const WALK_DEBUG = false;

/** 调试用：沿途按品类累计买了多少件（只在走测报告里读它） */
const BOUGHT = new Map<string, number>();

function createSaveSchedulerStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 门口有人：一律交付（走测要覆盖"交付真的生效"那条路；交不出就婉拒，免得卡住） */
function handleDoor(store: GameStore): void {
  if (!fulfillRequest(store).ok) declineRequest(store);
}

/**
 * 包一层"每次操作都刷新页面"的存档：所有命令跑在**反序列化回来的** store 上，
 * 命令跑完再把整份存档序列化回去。这不是为了好看 —— 它是 §4A 那条承诺的模拟。
 */
function refreshRoundTrip(store: GameStore): string {
  const text = serialize(store.save);
  return text;
}

function reload(text: string): GameStore {
  const back = deserialize(text);
  if (!back) throw new Error('存档读不回来');
  return new GameStore(back, createSaveSchedulerStub());
}

/**
 * ★★ "拿着东西的时候刷新页面" —— 玩家报过的一个真丢件 bug。
 *
 * 原来的 `held` 只活在内存里，而"拿起来"会把物资**从格子/箱子里移走**，
 * 于是刷新后格子里没有、会话也没了 = **凭空消失**。
 * 这条守的是：无论刷新多少次，一件都不许少。
 */
describe('★★ 拿着东西刷新页面：一件都不许丢', () => {
  it('从货架拿起 → 连刷三次 → 手里那件还在，总数不变', () => {
    const session = createOrganizeSession();
    let store = new GameStore(createSaveGame(createStartingRun(20261001)), createSaveSchedulerStub());

    // 铺一件到货架上，然后拿在手里
    const idx = store.run.shelves.findIndex((s) => s.id === 'shelf_a');
    store.commit((draft) => {
      const s = draft.shelves[idx];
      if (!s) return;
      draft.shelves[idx] = setSlotStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 3, null));
    });
    const before = householdTotals(store.run).pieces;
    const picked = pickupFromShelf(store, session, 'shelf_a', { row: 0, col: 0 });
    expect(picked.ok).toBe(true);
    expect(session.held?.itemId).toBe('canned_beans');

    // 连刷三次，每次都用**新建的会话**（模拟真实刷新：会话是内存，重启即空）
    for (let i = 0; i < 3; i++) {
      store = reload(refreshRoundTrip(store));
      const fresh = createOrganizeSession();
      restoreOrganizeSession(store, fresh);
      expect(fresh.held?.itemId, `第 ${i + 1} 次刷新后手里那件不该丢`).toBe('canned_beans');
      expect(fresh.held?.batches[0]?.count).toBe(3);
      expect(householdTotals(store.run).pieces, `第 ${i + 1} 次刷新后总数不该变`).toBe(before);
    }
  });
});

/** 把货架上的东西按品类铺好、贴一张写全清单的胶带、标顺手位、FEFO 排一遍 */
function tidyUp(store: GameStore, session: ReturnType<typeof createOrganizeSession>): void {
  // 拆箱并上架：依次摸出来、放到第一块有空位的货架上
  let guard = 0;
  while (store.run.boxesToUnpack.length > 0 && guard < 400) {
    guard += 1;
    const box = store.run.boxesToUnpack[0];
    if (!box) break;
    takeFromBox(store, session, box.id);
    if (!session.held) break;
    const shelf = store.run.shelves.find((s) => s.slots.some((row) => row.some((slot) => slot.stack === null)));
    if (!shelf) break;
    let placed = false;
    for (let r = 0; r < shelf.h && !placed; r++) {
      for (let c = 0; c < shelf.w && !placed; c++) {
        if (shelf.slots[r]?.[c]?.stack === null) {
          placeHeld(store, session, shelf.id, { row: r, col: c });
          placed = true;
        }
      }
    }
    if (!placed) break;
  }
  // 贴一张写全清单的胶带（§12 v0.8：空清单不给归位率的分）
  for (const shelf of store.run.shelves) {
    applyZone(store, shelf.id, {
      name: '全收',
      color: '#000000',
      categories: [...CATEGORY_ORDER]
    });
  }
  const zoneId = store.run.zones[0]?.id ?? null;
  if (zoneId) for (const shelf of store.run.shelves) assignZone(store, shelf.id, zoneId);
  // 顺手位：全屋唯一
  store.commit((draft) => {
    draft.shelves.forEach((s, i) => {
      s.handyRank = i === 0 ? 1 : null;
    });
  });
  sortAllByFEFO(store, session);
}

/**
 * 跑完一整局。`tidy` 决定囤货期到底整理成什么样 —— 这一条就是"好档 vs 乱档"。
 * @returns 走完之后的存档 + 沿途记录（夜间事件、白天事件、突发事件、结局）
 */
function playFullRun(seed: number, tidy: boolean) {
  let store = new GameStore(createSaveGame(createStartingRun(seed)), createSaveSchedulerStub());
  const session = createOrganizeSession();
  const nightEvents: string[] = [];
  const dayEvents: string[] = [];
  const emergencies: string[] = [];

  expect(chooseIdentity(store, 'group_buyer').ok).toBe(true);
  store = reload(refreshRoundTrip(store));

  // ———————— 囤货期 7 天：每天进三家店、回家整理、过一天 ————————
  for (let d = 0; d < 7; d++) {
    // ★ 行动点要真的用掉：进五金店买燃料、进超市买主食、进药店买药，
    // 而且**同一家店可以反复进**（这是真实可用的策略，也是唯一的解）。
    // 走测的第一版每天只进三家店各一次，实测燃料永远不够 ——
    // 因为车载 58kg/天 是硬闸门，而燃料一件就 4kg。
    // 第二版把"再进一次"补上之后才买到 28 罐。
    for (const shopId of ['hardware', 'supermarket', 'pharmacy'] as const) {
      let laps = 0;
      while (store.run.actionPoints > 0 && laps < 4) {
        laps += 1;
        // 走真实命令：进店会掷白天事件，掷中就当场处理掉（一律选第一条 = "参与"）
        if (!enterShop(store, shopId).ok) break;
        if (store.run.dayEvent) {
          dayEvents.push(store.run.dayEvent.defId);
          resolveDayEvent(store, 0);
        }
        if (!tidy) break;
        const bought = stockUp(store, shopId);
        // 这家店已经没有"能买且买得起"的东西了 → 换下一家，别浪费行动点
        if (bought === 0) break;
      }
    }
    goHome(store);
    if (tidy) tidyUp(store, session);
    store = reload(refreshRoundTrip(store));

    endDay(store);
    if (store.run.phase === 'night') {
      nightEvents.push(store.run.night?.eventId ?? '');
      chooseNightOption(store, NIGHT_SLEEP);
      sleep(store);
    }
    store = reload(refreshRoundTrip(store));
  }

  // ———————— D-Day ————————
  expect(store.run.phase).toBe('survival_day');
  expect(store.run.day).toBe(0);
  if (tidy) {
    tidyUp(store, session);
    store = reload(refreshRoundTrip(store));
  }

  startSurvival(store);
  let guard = 0;
  while (store.run.phase !== 'ending' && guard < 60) {
    guard += 1;
    if (store.run.phase === 'help_request') {
      handleDoor(store);
    } else {
      if (store.run.survival.last.emergencyId) emergencies.push(store.run.survival.last.emergencyId);
      advanceSurvivalDay(store);
    }
    // 每三天过一次存档往返 —— 模拟"随时杀进程"
    if (guard % 3 === 0) store = reload(refreshRoundTrip(store));
  }

  // ———————— 结算 ————————
  const finalText = refreshRoundTrip(store);
  const verdict = settleRunMeta(store);
  const finalStore = reload(serialize(store.save));
  return { store: finalStore, verdict, nightEvents, dayEvents, emergencies, finalText };
}

describe('全流程走测：真实命令 × 存档往返 × 三档', () => {
  it('★ 好档：真实命令走完 16 天（囤货 7 + 生存 14），图鉴与纪录都落账', () => {
    const { store, verdict, nightEvents, dayEvents, emergencies } = playFullRun(20261001, true);

    // 结局与日历
    expect(store.run.phase).toBe('ending');
    expect(store.run.outcome).toBe('survived');
    expect(store.run.day).toBe(SURVIVAL_DAYS);

    // 跨局结算真的发了奖，而且记账了
    expect(verdict).not.toBeNull();
    expect(store.save.meta.codex.disasters).toContain('cold_snap');
    expect(store.save.meta.bestSurvivalDays['cold_snap']).toBe(SURVIVAL_DAYS);
    expect(store.run.metaSettled?.outcome).toBe('survived');
    expect(store.save.meta.version).toBe(SAVE_VERSION);

    // 沿途真的发生了些事 —— 否则这条走测什么也没覆盖到
    expect(nightEvents.length).toBeGreaterThan(0);
    expect(dayEvents.length).toBeGreaterThan(0);
    expect(emergencies.length).toBeGreaterThan(0);

    // ★ 存档版本与"每次操作都能读回来"：这一路每一段都过了 serialize → deserialize
    expect(deserialize(serialize(store.save))).not.toBeNull();
  });

  it('★ 乱档：不买也不整理 → 走不完全程，但存档一路都能读回来', () => {
    const { store, finalText } = playFullRun(20261001, false);
    expect(store.run.phase).toBe('ending');
    // 一局里什么都不做（不进店买、不整理）必然倒下 —— 这正是 §12.3 v0.7 那条修订要的
    expect(store.run.outcome).toBe('collapsed');
    expect(store.run.day).toBeLessThan(SURVIVAL_DAYS);
    // 无论结局是什么，最后那份存档必须能读回来（§4A）
    expect(deserialize(finalText)).not.toBeNull();
  });

  it('★ 结算幂等：同一条走测里反复进结算页，图鉴不会被刷第二遍', () => {
    const { store } = playFullRun(4242, true);
    const before = JSON.stringify(store.save.meta.codex);
    expect(settleRunMeta(store)).toBeNull();
    expect(JSON.stringify(store.save.meta.codex)).toBe(before);
  });

  it('★ 存档往返不丢 M2 新字段（白天事件 / 限购 / 买入记账 / 安全感）', () => {
    const run: RunState = createStartingRun(7);
    run.phase = 'stockpile_shop';
    run.currentShopId = 'supermarket';
    run.identityId = 'group_buyer';
    run.dayEvent = { defId: 'd_queue_aunt', shopId: 'supermarket', choice: 0, applied: null };
    run.shopPriceFactor = 1.5;
    run.shopLimits = [{ shopId: 'supermarket', category: 'food', max: 2 }];
    run.shopBoughtToday = { 'supermarket|canned_beans': 2 };
    run.survival.safeStreak = 5;

    const back = deserialize(serialize(createSaveGame(run)));
    expect(back?.run?.dayEvent?.defId).toBe('d_queue_aunt');
    expect(back?.run?.dayEvent?.choice).toBe(0);
    expect(back?.run?.shopPriceFactor).toBe(1.5);
    expect(back?.run?.shopLimits).toHaveLength(1);
    expect(back?.run?.shopBoughtToday).toEqual({ 'supermarket|canned_beans': 2 });
    expect(back?.run?.survival.safeStreak).toBe(5);
  });

  it('★ 状态机没有死胡同：夜里必须能关灯走出去（§4A 无死按钮）', () => {
    const night = new GameStore(createSaveGame(createStartingRun(11)), createSaveSchedulerStub());
    chooseIdentity(night, 'group_buyer');
    goHome(night);
    night.commit((draft) => {
      draft.phase = 'night';
      draft.night = { eventId: 'n_night_shift', choice: null, applied: null };
    });
    // 还没决定时不能直接睡 —— 这是唯一一处刻意要求"先做个决定"
    expect(sleep(night).ok).toBe(false);
    // "直接睡"永远是一条路，而且它之后必然能跨天
    expect(chooseNightOption(night, NIGHT_SLEEP).ok).toBe(true);
    expect(sleep(night).ok).toBe(true);
    expect(night.run.phase).not.toBe('night');
    // 跨天之后落在白天的两个界面之一（每个都要有出口）
    expect(['stockpile_shop', 'organize']).toContain(night.run.phase);
  });

  it('★ 门口那一单没有死胡同：交付 / 婉拒 / 兜底出口三条都能走回日报', () => {
    const door = new GameStore(createSaveGame(createStartingRun(13)), createSaveSchedulerStub());
    chooseIdentity(door, 'group_buyer');
    door.commit((draft) => {
      draft.phase = 'help_request';
      draft.helpRequest = { defId: 'q_wang_medicine' };
      draft.day = 3;
      // 开局那三箱货里有绷带 —— 不清空的话这一单是交得出去的
      draft.boxesToUnpack = [];
      draft.shelves = draft.shelves.map((s) => ({
        ...s,
        slots: s.slots.map((row) => row.map(() => ({ stack: null })))
      }));
    });
    // 一件药都没有 → 交付必然失败（"凑不齐 ≠ 婉拒"），但它必须给一条**出路**。
    // 注意 `ok: true` 是**刻意的**：交付这条命令返回的是"我处理了这一单、日历可以往下走了"，
    // 而不是"你成功给到了"—— 否则调用方会把"凑不齐"再当成"没处理"，
    // 于是它接着去婉拒，玩家就会背上一次他从来没做过的"不讲情面"。
    const handled = fulfillRequest(door);
    expect(handled.ok).toBe(true);
    expect(handled.events.some((e) => e.type === 'helpFailed')).toBe(true);
    expect(door.run.phase).toBe('survival_day');
    expect(door.run.helpRequest).toBeNull();
    // 关键：凑不齐**不扣人情**（那是"你没能耐"，不是"你不愿意"，见 systems/help.ts）
    expect(door.run.trust['npc_wang'] ?? 0).toBe(0);
    // 而且日历真的能往下走（没有"卡在门口"这种死胡同）
    expect(door.run.phase).toBe('survival_day');
  });

  it('★ 门口：婉拒也是一条出口，而且它扣的是人情（与碰巧凑不齐分开）', () => {
    const door = new GameStore(createSaveGame(createStartingRun(17)), createSaveSchedulerStub());
    chooseIdentity(door, 'group_buyer');
    door.commit((draft) => {
      draft.phase = 'help_request';
      draft.helpRequest = { defId: 'q_wang_medicine' };
      draft.day = 3;
    });
    expect(declineRequest(door).ok).toBe(true);
    expect(door.run.phase).toBe('survival_day');
    expect(door.run.helpRequest).toBeNull();
    expect(door.run.trust['npc_wang'] ?? 0).toBeLessThan(0);
  });
});
