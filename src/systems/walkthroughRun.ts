/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  跨灾难的走测夹具（M4 W-01 的配套，**从 `walkthrough.test.ts` 拆出来的**）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么它必须从测试文件里搬出来
 *
 * W-01 之前实机每一局都是寒潮，所以"跑一整局"这条走测只需要跑寒潮。
 * 而 116 场现在真的会被抽到了 —— **另外 115 场从来没有被玩过一遍**。
 * 补那个缺口的办法只有一条：把**同一套已经验证过的策略**放到别的灾难上跑。
 *
 * 我第一版是在一个 `scripts/_probe-*.ts` 里 import `walkthrough.test.ts` 的
 * `playFullRun`，而那样**跑不起来**：那个文件 import 了 `vitest`，于是
 * `vite-node` 当场抛 `Vitest failed to access its internal state`。
 *
 * ★ 更重要的理由是：**这一条得留在仓库里**。它不是一个一次性探针 ——
 * 以后每加一场灾难，它都该被跑一遍（"数据写了 ≠ 这一局能玩"，D-32 的教训）。
 * 所以夹具搬到这里（不带 vitest），测试与探针都能用。
 *
 * ## 它验什么、不验什么
 *
 * 验：这一场能不能从 `prologue` 走到 `ending`，四维会不会越界，
 *     `disasterId` 会不会中途被换掉（那是"日历一场、货架另一场"那个 bug 的形状）。
 * 不验：难度合不合理 —— 那要三档探针，而且"哪一场该多难"是设计问题。
 */
import { CATEGORY_ORDER, getItemDef } from '../data/items';
import { NIGHT_SLEEP } from '../data/nightEvents';
import { SURVIVAL_DAYS, getDisasterDef } from '../data/disaster';
import { dailyDrainOf } from '../data/survival';
import { makeStack, setSlotStack, SHELF_H, SHELF_W } from '../model/shelf';
import type { CategoryId, RunState, SurvivalSnapshot } from '../model/types';
import { SAVE_VERSION, createSaveGame, deserialize, serialize } from '../state/save';
import { GameStore } from '../state/store';
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
  sortAllByFEFO,
  takeFromBox,
  placeHeld,
  type OrganizeSession
} from './organize';
import { buildCartView, buyCart, enterShop, findShopStock, resolveDayEvent } from './shop';
import { createStartingRun } from './setup';

export function createSaveSchedulerStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

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
export function stockUp(store: GameStore, shopId: string, opts: { debug?: boolean } = {}): number {
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
  if (opts.debug) {
    // eslint-disable-next-line no-console
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
    boughtPieces += picked.reduce((n, p) => n + p.count, 0);
    for (const p of picked) {
      const left = (wants.get(p.itemId) ?? 0) - p.count;
      if (left > 0) wants.set(p.itemId, left);
      else wants.delete(p.itemId);
    }
    if (wants.size === 0) break;
  }
  return boughtPieces;
}

/** 门口有人：一律交付（走测要覆盖"交付真的生效"那条路；交不出就婉拒，免得卡住） */
export function handleDoor(store: GameStore): void {
  if (!fulfillRequest(store).ok) declineRequest(store);
}

/** 把货架上的东西按品类铺好、贴一张写全清单的胶带、标顺手位、FEFO 排一遍 */
export function tidyUp(store: GameStore, session: OrganizeSession): void {
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

export interface WalkResult {
  store: GameStore;
  verdict: ReturnType<typeof settleRunMeta>;
  nightEvents: string[];
  dayEvents: string[];
  emergencies: string[];
  finalText: string;
}

/**
 * 跑完一整局（真实命令 × 存档往返）。
 *
 * @param tidy 囤货期到底整理成什么样 —— 这一条就是"好档 vs 乱档"
 * @param disasterId 这一局抽到哪一场（默认寒潮：三条永久回归探针与夹具都钉在它上面）
 */
export function playFullRun(seed: number, tidy: boolean, disasterId = 'cold_snap'): WalkResult {
  let store = new GameStore(createSaveGame(createStartingRun(seed, { disasterId })), createSaveSchedulerStub());
  const session = createOrganizeSession();
  const nightEvents: string[] = [];
  const dayEvents: string[] = [];
  const emergencies: string[] = [];

  if (!chooseIdentity(store, 'group_buyer').ok) throw new Error('选身份失败');
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
  if (store.run.phase !== 'survival_day' || store.run.day !== 0) {
    throw new Error(`没走到 D-Day（phase=${store.run.phase} day=${store.run.day}）`);
  }
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

/**
 * 一轮的**读数**（给"116 场都走得通吗"这类检查用）。
 *
 * 它刻意只回**可以被机器判的数**，不回"感觉如何"：
 * 四维有没有越界、走没走到结算、`disasterId` 有没有中途被换掉。
 */
/**
 * ★ **这一场开局应该有几块家具、几排、几格** —— 从数据算出来，不看实现。
 *
 * ## 为什么要在这里再算一遍
 *
 * `trialDisaster` 最初只判"走到结算了没有"，而那样**抓不到 W-01 那一类 bug**：
 * 我故意把 `createStartingShelves` 的 `capacityFactor` 写死成 0.55 之后，
 * 10 场样本**全部照旧通过**（每一场都还能走完）—— 而灾潮局的货架已经被砍错了。
 *
 * 所以"这一场走得通"之外还要问一句"**它铺出来的盘面对不对**"。
 * 口径与 `systems/setup.ts` 的注释一致（同一套算术，但**独立实现**：
 * 这里读数据、那里读代码 —— 复印件与原件对不上就是 bug，而两处都读同一个函数
 * 就只是在自证）。三个粒度各判一次：**块数 / 排数 / 格子数**。
 */
export function expectedShelves(disasterId: string): { blocks: number; rows: number; slots: number } {
  const def = getDisasterDef(disasterId);
  const removed = def.unusableShelfIds?.length ?? 0;
  // 至少留一块（§4A：一格都没有不是难度，是卡死）
  const blocks = Math.max(1, 3 - Math.min(2, removed));
  const cap = typeof def.capacityFactor === 'number' && Number.isFinite(def.capacityFactor) ? def.capacityFactor : 1;
  const clamped = Math.max(0.5, Math.min(1, cap));
  // 与 `rowsFor` 的口径一致：< 1 时向下取整（"乘了就必须真的少一排"），= 1 时原样
  const rows = clamped >= 1 ? SHELF_H : Math.max(1, Math.floor(SHELF_H * clamped));
  return { blocks, rows, slots: blocks * rows * SHELF_W };
}

export interface DisasterTrial {
  id: string;
  name: string;
  level: string;
  /** 走到 `ending` 了没有 */
  finished: boolean;
  /** 活满 14 天没有（**观察用**，不是判据：难度本来就该有差） */
  survived: boolean;
  day: number;
  outcome: string;
  stats: { health: number; mood: number; stamina: number; shelter: number };
  /** 开局实际的家具形状（与 `expectedShelves` 对照） */
  shelves: { blocks: number; rows: number; slots: number };
  /** 四维越界 / 中途换灾难 / 没走到结算 / **空间铺错** —— 这些才是"这一场坏了"的判据 */
  problems: string[];
}

export function trialDisaster(id: string, seed = 20261001, tidy = true): DisasterTrial {
  const def = getDisasterDef(id);
  const base: DisasterTrial = {
    id,
    name: def.name,
    level: def.level,
    finished: false,
    survived: false,
    day: 0,
    outcome: '',
    stats: { health: 0, mood: 0, stamina: 0, shelter: 0 },
    shelves: { blocks: 0, rows: 0, slots: 0 },
    problems: []
  };

  /*
   * ★ 空间那一层**在走测之前**先判（用 `createStartingRun` 的真实开局，
   * 而不是走完之后的盘面 —— 走完之后玩家会加家具、会搬家，那就不是开局了）。
   */
  const before = createStartingRun(seed, { disasterId: id });
  const actual = {
    blocks: before.shelves.length,
    rows: before.shelves[0]?.h ?? 0,
    slots: before.shelves.reduce((n, s) => n + s.w * s.h, 0)
  };
  const want = expectedShelves(id);
  if (actual.blocks !== want.blocks || actual.rows !== want.rows || actual.slots !== want.slots) {
    return {
      ...base,
      shelves: actual,
      problems: [
        `开局空间铺错了：期望 ${want.blocks} 块 × ${want.rows} 排 = ${want.slots} 格，` +
          `实际 ${actual.blocks} 块 × ${actual.rows} 排 = ${actual.slots} 格`
      ]
    };
  }

  let out: WalkResult;
  try {
    out = playFullRun(seed, tidy, id);
  } catch (err) {
    return { ...base, shelves: actual, problems: [`抛异常：${(err as Error).message.split('\n')[0]}`] };
  }
  const run = out.store.run;
  const problems: string[] = [];
  if (run.phase !== 'ending') problems.push(`没走到结算：phase=${run.phase}`);
  if (run.disasterId !== id) problems.push(`中途换了灾难：变成了 ${run.disasterId}`);
  for (const [k, v] of Object.entries(run.stats)) {
    if (!Number.isFinite(v) || v < 0 || v > 100) problems.push(`四维越界：${k}=${v}`);
  }
  return {
    ...base,
    finished: run.phase === 'ending',
    survived: run.outcome === 'survived' && run.day >= SURVIVAL_DAYS,
    day: run.day,
    outcome: run.outcome ?? '',
    stats: {
      health: Math.round(run.stats.health),
      mood: Math.round(run.stats.mood),
      stamina: Math.round(run.stats.stamina),
      shelter: Math.round(run.stats.shelter)
    },
    shelves: actual,
    problems
  };
}

/*
 * 下面这些是为了"没有 vitest 也能跑"而留的转出：
 * 老走测文件里的几个小工具（存档往返、拿在手里的东西）在别的测试里也有用。
 */
export function refreshRoundTrip(store: GameStore): string {
  return serialize(store.save);
}

export function reload(text: string): GameStore {
  const back = deserialize(text);
  if (!back) throw new Error('存档读不回来');
  return new GameStore(back, createSaveSchedulerStub());
}

export { SAVE_VERSION, createSaveGame, deserialize, serialize, makeStack, setSlotStack, householdTotals };
export type { RunState, SurvivalSnapshot };
