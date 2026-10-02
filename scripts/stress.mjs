/**
 * 《囤货末世》全量压测 / 模糊测试（手工工具，不是单测）。
 *
 * 跑法：`npx vite-node scripts/stress.mjs`
 * 旋钮（环境变量）：
 *   STRESS_SEED        随机种子（默认 20261002，同 seed 同结果）
 *   STRESS_GAMES       S1 混沌整局数（默认 1500）
 *   STRESS_SAVE_FUZZ   S3 存档破坏样本数（默认 4000）
 *   STRESS_MODEL_FUZZ  S4 model 层每组样本数（默认 800）
 *
 * 六个套件：
 *   S1 混沌整局  —— 机器人用命令层打完整局，操作里掺非法输入，每步后扫不变量，定期模拟刷新
 *   S2 定点打击  —— 阅读源码时锁定的可疑点，逐个做确定性复现
 *   S3 存档破坏  —— 对真实存档做随机变异，读档后继续玩，检验"自愈"是否名副其实
 *   S4 model fuzz —— 纯函数喂 NaN / Infinity / 小数 / 巨数
 *   S5 守恒与幂等 —— 件数/现金守恒，命令重复调用不重复生效
 *   S6 规模与性能 —— 800 箱 / 5 万条日志下的耗时与存档体积
 *
 * 结果：stdout 摘要 + scripts/stress-results.json（供报告引用）。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createSaveGame, serialize, deserialize, SAVE_VERSION } from '../src/state/save';
import { GameStore } from '../src/state/store';
import { createStartingRun, generateBoxStacks } from '../src/systems/setup';
import {
  chooseIdentity,
  goHome,
  goOut,
  endDay,
  chooseNightOption,
  sleep,
  startSurvival,
  advanceSurvivalDay,
  ensureDayStocks
} from '../src/systems/phases';
import {
  createOrganizeSession,
  resetSession,
  takeFromBox,
  tapSlot,
  pickupFromShelf,
  placeHeld,
  swapHeldWithSlot,
  swapSlots,
  returnHeld,
  sortAllByFEFO,
  applyZone,
  assignZone,
  deleteZone,
  toggleHandy,
  householdTotals,
  inventoryTotals,
  buildView
} from '../src/systems/organize';
import { enterShop, leaveShop, buyCart, buildCartView, resolveDayEvent, purchaseLimitOf } from '../src/systems/shop';
import { fulfillRequest, declineRequest, leaveRequest } from '../src/systems/help';
import { tradeForBox, canTrade } from '../src/systems/trade';
import { settleRunMeta } from '../src/systems/codex';
import { consumeCategory, consumeItem, countByItem } from '../src/model/consume';
import { spoilEverything } from '../src/model/spoil';
import {
  splitStack,
  normalizeStack,
  makeStack,
  dropStack,
  createShelf,
  setSlotStack,
  getStack,
  stackCount
} from '../src/model/shelf';
import { computeOrganizeScore } from '../src/model/score';
import { createCursor, nextInt, nextFloat, pick, pickWeighted, shuffle } from '../src/model/rng';
import { ITEM_DEFS, ITEM_IDS, CATEGORY_ORDER, getItemDef } from '../src/data/items';
import { SHOP_DEFS } from '../src/data/shops';
import { IDENTITY_DEFS } from '../src/data/identities';
import { BOX_DEFS } from '../src/data/boxes';
import { FIRST_STOCKPILE_DAY, SURVIVAL_DAYS, getDisasterDef } from '../src/data/disaster';
import { findNightEvent, NIGHT_SLEEP } from '../src/data/nightEvents';
import { findDayEvent } from '../src/data/dayEvents';
import { healOf, shelterOf } from '../src/data/survival';

const here = dirname(fileURLToPath(import.meta.url));

// ———————————————————————— 配置 ————————————————————————
const SEED = Number(process.env.STRESS_SEED ?? 20261002) >>> 0;
const GAMES = Number(process.env.STRESS_GAMES ?? 1500);
const SAVE_FUZZ = Number(process.env.STRESS_SAVE_FUZZ ?? 4000);
const MODEL_FUZZ = Number(process.env.STRESS_MODEL_FUZZ ?? 800);

const rng = createCursor(SEED);
const rint = (min, max) => nextInt(rng, min, max);
const rfloat = () => nextFloat(rng);
const rpick = (list) => list[rint(0, list.length - 1)];
const chance = (p) => rfloat() < p;

// ———————————————————————— 结果收集 ————————————————————————
const issues = new Map(); // key -> { severity, title, count, examples[] }
const stats = { ops: 0, games: 0, gamesEnded: 0, saveMutants: 0, saveMutantsPlayable: 0, modelCalls: 0, reloads: 0 };

function report(severity, key, title, detail) {
  let it = issues.get(key);
  if (!it) {
    it = { severity, title, count: 0, examples: [] };
    issues.set(key, it);
  }
  it.count += 1;
  if (it.examples.length < 4 && detail !== undefined) it.examples.push(String(detail).slice(0, 600));
}

const P0 = 'P0-致命';
const P1 = 'P1-严重';
const P2 = 'P2-中等';
const P3 = 'P3-观察';

// ———————————————————————— 基础设施 ————————————————————————
const noopScheduler = { schedule() {}, flush() {}, dispose() {}, pending: false };

function freshStore(seed) {
  const store = new GameStore(createSaveGame(null), noopScheduler);
  store.replaceRun(createStartingRun(seed));
  return store;
}

function reloadStore(store) {
  const text = serialize(store.save);
  const loaded = deserialize(text);
  if (!loaded) return null;
  return new GameStore(loaded, noopScheduler);
}

function piecesOf(run) {
  return householdTotals(run).pieces;
}

function fmtErr(e) {
  return e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : String(e);
}

// ———————————————————————— 不变量扫描 ————————————————————————
/**
 * 深扫整个 run：任何非有限数字都是事故（合法状态里不该出现 NaN/Infinity）。
 * 再叠加一组语义检查。返回命中的问题 key 列表（已 report）。
 */
function scanRun(run, ctx) {
  // ① 深扫非有限数字
  const seen = new Set();
  const walk = (v, path, depth) => {
    if (depth > 40) return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) report(P0, 'nonfinite:' + path.replace(/\d+/g, 'N'), `状态里出现非有限数字：${path}`, `${ctx} 值=${v}`);
      return;
    }
    if (typeof v !== 'object' || v === null) return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], `${path}[${i}]`, depth + 1);
    } else {
      for (const [k, val] of Object.entries(v)) walk(val, `${path}.${k}`, depth + 1);
    }
  };
  walk(run, 'run', 0);

  // ② 语义检查
  const s = run.stats;
  if (s) {
    for (const k of ['health', 'mood', 'stamina', 'shelter']) {
      const v = s[k];
      if (typeof v === 'number' && Number.isFinite(v) && (v < 0 || v > 100)) {
        report(P1, `stat-range:${k}`, `四维越界 stats.${k}=${v}`, ctx);
      }
    }
  }
  if (typeof run.cash === 'number' && Number.isFinite(run.cash) && run.cash < 0) {
    report(P0, 'cash-negative', `现金为负：${run.cash}`, ctx);
  }
  if (typeof run.day === 'number' && Number.isFinite(run.day)) {
    if (!Number.isInteger(run.day)) report(P1, 'day-fractional', `day 不是整数：${run.day}`, ctx);
    else if (run.day < FIRST_STOCKPILE_DAY || run.day > SURVIVAL_DAYS) {
      report(P1, 'day-range', `day 越界：${run.day}`, ctx);
    }
  }
  if (typeof run.actionPoints === 'number' && run.actionPoints < 0) {
    report(P1, 'ap-negative', `行动点为负：${run.actionPoints}`, ctx);
  }
  if (typeof run.carLoad === 'number' && Number.isFinite(run.carLoad) && run.carLoad < 0) {
    report(P1, 'carload-negative', `车载为负：${run.carLoad}`, ctx);
  }

  // ③ 物资堆：件数必须为正整数；货架矩阵必须与 w/h 一致
  const checkStack = (stack, where) => {
    if (!stack || typeof stack !== 'object') return;
    if (!Array.isArray(stack.batches)) {
      report(P1, 'stack-batches-not-array', `堆没有 batches 数组（${where}）`, ctx);
      return;
    }
    if (stack.batches.length === 0) report(P2, 'ghost-stack', `空堆（batches=0）赖在${where}`, ctx);
    let total = 0;
    for (const b of stack.batches) {
      if (typeof b.count !== 'number' || !Number.isFinite(b.count)) continue; // 深扫已报
      if (b.count <= 0) report(P1, 'batch-nonpositive', `批次件数 ${b.count}（${where} ${stack.itemId}）`, ctx);
      if (!Number.isInteger(b.count)) report(P1, 'batch-fractional', `批次件数是小数 ${b.count}（${where} ${stack.itemId}）`, ctx);
      total += b.count;
    }
    if (total === 0 && stack.batches.length > 0) report(P2, 'ghost-stack-zero', `总件数为 0 的堆（${where} ${stack.itemId}）`, ctx);
  };
  for (const shelf of run.shelves ?? []) {
    if (!Array.isArray(shelf.slots)) continue;
    if (shelf.slots.length !== shelf.h) report(P1, 'shelf-dim-h', `货架 ${shelf.id} slots 行数 ${shelf.slots.length} ≠ h=${shelf.h}`, ctx);
    for (const row of shelf.slots) {
      if (!Array.isArray(row)) continue;
      if (row.length !== shelf.w) report(P1, 'shelf-dim-w', `货架 ${shelf.id} 列数 ${row.length} ≠ w=${shelf.w}`, ctx);
      for (const slot of row) if (slot && slot.stack) checkStack(slot.stack, `货架${shelf.id}`);
    }
  }
  for (const box of run.boxesToUnpack ?? []) {
    if (!Array.isArray(box.items)) continue;
    for (const stack of box.items) checkStack(stack, `纸箱${box.id}`);
  }

  // ④ 事件历史长度
  const eh = run.eventHistory;
  if (eh) {
    for (const k of ['night', 'help', 'day', 'emergency']) {
      if (Array.isArray(eh[k]) && eh[k].length > 4) report(P2, 'history-overflow', `eventHistory.${k} 超过 4 条`, ctx);
    }
  }

  // ⑤ 落盘往返不炸
  try {
    const back = deserialize(serialize(storeOf(run)));
    if (!back) report(P1, 'roundtrip-null', 'serialize→deserialize 返回 null', ctx);
  } catch (e) {
    report(P0, 'roundtrip-throw', `落盘往返抛异常：${fmtErr(e)}`, ctx);
  }
}

// scanRun 需要反查 store —— 用 WeakMap 挂上
const storeOfMap = new WeakMap();
function storeOf(run) {
  return storeOfMap.get(run)?.save;
}
function linkStore(store) {
  if (store.hasRun) storeOfMap.set(store.run, store);
}

// ———————————————————————— 混沌机器人 ————————————————————————
const JUNK_IDS = ['', ' ', '不存在的', 'box_999', 'shelf_zzz', '🦊', '__proto__', 'a'.repeat(3000)];
const REAL_SHOP_IDS = SHOP_DEFS.map((s) => s.id);
const REAL_IDENTITY_IDS = IDENTITY_DEFS.map((i) => i.id);

function junkPos() {
  const vals = [-1, 0, 1, 2, 3, 4, 5, 6, 0.5, 2.5, NaN, Infinity, -0.5];
  return { row: rpick(vals), col: rpick(vals) };
}
function realPos(run) {
  const shelf = rpick(run.shelves);
  return { shelfId: shelf.id, pos: { row: rint(0, shelf.h - 1), col: rint(0, shelf.w - 1) } };
}
function maybeJunkShelfId(run) {
  return chance(0.85) ? rpick(run.shelves).id : rpick(JUNK_IDS);
}

function craftCartLines(run) {
  const shopId = run.currentShopId;
  const stock = shopId ? run.shopStocks.find((s) => s.shopId === shopId) : null;
  const lines = [];
  const avail = stock ? stock.lines : [];
  const nLines = rint(1, 4);
  for (let i = 0; i < nLines; i++) {
    const itemId = avail.length > 0 && chance(0.8) ? rpick(avail).itemId : rpick([...ITEM_IDS, ...JUNK_IDS]);
    const count = rpick([1, 1, 2, 3, 0, -1, NaN, Infinity, 2.5, 0.1, 1e6, 999999999]);
    lines.push({ itemId, count });
  }
  // 20%：重复行（同一件物资来两行 —— 复制漏洞的猎杀目标）
  if (avail.length > 0 && chance(0.2)) {
    const dupe = rpick(avail).itemId;
    lines.push({ itemId: dupe, count: rint(1, 5) }, { itemId: dupe, count: rint(1, 5) });
  }
  return lines;
}

function botStep(store, session) {
  const run = store.run;
  const phase = run.phase;
  /** 所有动作统一 try 一遍由外层抓 */
  const moves = [];
  const push = (w, label, fn) => moves.push({ w, label, fn });

  // —— 阶段内的合法动作 ——
  if (phase === 'prologue') {
    push(90, 'chooseIdentity:real', () => chooseIdentity(store, rpick(REAL_IDENTITY_IDS)));
    push(5, 'chooseIdentity:junk', () => chooseIdentity(store, rpick(JUNK_IDS)));
  }

  if (phase === 'stockpile_shop') {
    push(35, 'enterShop:real', () => enterShop(store, rpick(REAL_SHOP_IDS)));
    push(3, 'enterShop:junk', () => enterShop(store, rpick(JUNK_IDS)));
    push(8, 'leaveShop', () => leaveShop(store));
    if (run.dayEvent && run.dayEvent.choice === null) {
      const def = findDayEvent(run.dayEvent.defId);
      const n = def ? def.options.length : 2;
      push(30, 'resolveDayEvent', () => resolveDayEvent(store, rpick([rint(0, n + 1), -1, NaN, 0.5, 99, '1'])));
    }
    if (run.currentShopId && !run.dayEvent) {
      push(30, 'buyCart', () => buyCart(store, run.currentShopId, craftCartLines(run)));
    }
    push(15, 'goHome', () => goHome(store));
  }

  if (phase === 'organize') {
    const boxes = run.boxesToUnpack;
    if (boxes.length > 0) {
      push(25, 'takeFromBox', () => takeFromBox(store, session, chance(0.9) ? rpick(boxes).id : rpick(JUNK_IDS)));
    }
    push(30, 'tapSlot', () => {
      const shelfId = maybeJunkShelfId(run);
      const pos = chance(0.75) && run.shelves.some((s) => s.id === shelfId) ? realPos(run).pos : junkPos();
      tapSlot(store, session, shelfId, pos);
    });
    if (session.held) push(12, 'returnHeld', () => returnHeld(store, session));
    push(6, 'sortAllByFEFO', () => sortAllByFEFO(store, session));
    push(6, 'applyZone', () => {
      const name = rpick(['主食区', '药', '门口', '', '   ', '🥫🥫🥫', 'x'.repeat(5000), '主食区']);
      const cats = chance(0.7) ? shuffle(rng, CATEGORY_ORDER).slice(0, rint(0, 3)) : undefined;
      const editId = chance(0.25) && run.zones.length > 0 ? rpick(run.zones).id : undefined;
      applyZone(store, maybeJunkShelfId(run), { name, color: '#abc', categories: cats, zoneId: editId });
    });
    if (run.zones.length > 0) {
      push(4, 'assignZone', () => assignZone(store, maybeJunkShelfId(run), chance(0.5) ? rpick(run.zones).id : null));
      push(2, 'deleteZone', () => deleteZone(store, chance(0.7) ? rpick(run.zones).id : rpick(JUNK_IDS)));
    }
    push(4, 'toggleHandy', () => toggleHandy(store, maybeJunkShelfId(run)));
    push(4, 'swapSlots', () => {
      const a = realPos(run);
      const b = realPos(run);
      swapSlots(store, a, b);
    });
    if (session.held && session.heldFrom.kind === 'shelf') {
      push(6, 'swapHeldWithSlot', () => {
        const to = realPos(run);
        swapHeldWithSlot(store, session, { shelfId: session.heldFrom.shelfId, pos: session.heldFrom.pos }, to);
      });
    }
    push(8, 'goOut', () => goOut(store));
    push(12, 'endDay', () => endDay(store));
  }

  if (phase === 'night') {
    const night = run.night;
    if (night && night.choice === null) {
      const def = findNightEvent(night.eventId);
      const n = def ? def.options.length : 2;
      push(70, 'chooseNightOption', () => chooseNightOption(store, rpick([rint(0, n + 1), NIGHT_SLEEP, -5, NaN, 0.5, 99, '0'])));
    }
    push(40, 'sleep', () => sleep(store));
  }

  if (phase === 'survival_day') {
    if (run.day === 0) push(60, 'startSurvival', () => startSurvival(store));
    else push(60, 'advanceSurvivalDay', () => advanceSurvivalDay(store));
    push(10, 'tradeForBox', () => {
      const owned = countByItem(run.shelves, run.boxesToUnpack);
      const picks = [];
      if (owned.length > 0 && chance(0.7)) {
        const a = rpick(owned);
        picks.push({ itemId: a.itemId, count: rpick([1, 2, 3, 0, -1, NaN, 1.5, 1e6]) });
        if (chance(0.6)) picks.push({ itemId: rpick(owned).itemId, count: rpick([1, 2, 0.5, NaN]) });
      } else {
        picks.push({ itemId: rpick([...ITEM_IDS, ...JUNK_IDS]), count: 3 });
      }
      tradeForBox(store, picks);
    });
  }

  if (phase === 'help_request') {
    push(45, 'fulfillRequest', () => fulfillRequest(store));
    push(35, 'declineRequest', () => declineRequest(store));
    push(5, 'leaveRequest', () => leaveRequest(store));
  }

  if (phase === 'ending') {
    push(60, 'settleRunMeta', () => settleRunMeta(store));
  }

  // —— 跨阶段乱点（任何时候都不该崩、不该生效）——
  push(4, 'wrongPhase:endDay', () => endDay(store));
  push(3, 'wrongPhase:sleep', () => sleep(store));
  push(3, 'wrongPhase:enterShop', () => enterShop(store, rpick(REAL_SHOP_IDS)));
  push(2, 'wrongPhase:startSurvival', () => startSurvival(store));
  push(2, 'wrongPhase:advanceSurvival', () => advanceSurvivalDay(store));
  push(2, 'wrongPhase:fulfill', () => fulfillRequest(store));
  push(2, 'wrongPhase:settleMeta', () => settleRunMeta(store));

  const total = moves.reduce((n, m) => n + m.w, 0);
  let roll = rfloat() * total;
  let picked = moves[moves.length - 1];
  for (const m of moves) {
    roll -= m.w;
    if (roll < 0) {
      picked = m;
      break;
    }
  }
  return picked;
}

function playGame(seed, maxSteps, opSink) {
  let store = freshStore(seed);
  linkStore(store);
  const session = createOrganizeSession();
  const opLog = [];
  let steps = 0;
  let endingOps = 0;
  while (steps < maxSteps) {
    if (!store.hasRun) return { store, steps, broken: 'run-null' };
    const move = botStep(store, session);
    opLog.push(move.label);
    if (opLog.length > 30) opLog.shift();
    try {
      move.fn();
    } catch (e) {
      report(P0, `crash:${move.label}:${firstLine(e)}`, `命令抛异常：${move.label}`, `seed=${seed} 最近操作: ${opLog.join(' → ')}\n${fmtErr(e)}`);
      return { store, steps, broken: 'crash' };
    }
    stats.ops += 1;
    steps += 1;
    if (store.hasRun) {
      linkStore(store);
      scanRun(store.run, `seed=${seed} step=${steps} 上次操作=${move.label} 最近: ${opLog.slice(-6).join('→')}`);
    }
    const phase = store.hasRun ? store.run.phase : 'ending';
    if (phase === 'ending') {
      endingOps += 1;
      if (endingOps > 6) {
        stats.gamesEnded += 1;
        return { store, steps, broken: null };
      }
    }
    // 每 ~30 步模拟一次刷新（读档后继续）。手里拿着东西时先放回 ——
    // "拿着东西刷新"丢不丢件由 S2-T1 单独钉死，不在这里制造噪音。
    if (steps % 30 === rint(0, 29)) {
      if (session.held) returnHeld(store, session);
      const next = reloadStore(store);
      stats.reloads += 1;
      if (!next) {
        report(P0, 'reload-null', ' serialize→deserialize 读不回来', `seed=${seed} step=${steps}`);
        return { store, steps, broken: 'reload' };
      }
      store = next;
      linkStore(store);
      resetSession(session);
      if (store.hasRun && store.run.phase !== 'ending') ensureDayStocks(store);
    }
  }
  return { store, steps, broken: null };
}

function firstLine(e) {
  return String(e && e.message ? e.message : e).slice(0, 80);
}

// ———————————————————————— S1 混沌整局 ————————————————————————
function suiteChaos() {
  const t0 = performance.now();
  for (let g = 0; g < GAMES; g++) {
    const seed = rint(1, 0x7fffffff);
    playGame(seed, 500);
    stats.games += 1;
  }
  return performance.now() - t0;
}

// ———————————————————————— S2 定点打击 ————————————————————————
/** 快速把一局推进到 organize 且有货可拿 */
function storeAtOrganize(seed = 777) {
  const store = freshStore(seed);
  linkStore(store);
  chooseIdentity(store, REAL_IDENTITY_IDS[0]);
  goHome(store);
  return store;
}

function suiteTargeted() {
  const t0 = performance.now();

  // T1a 手里拿着东西（来自纸箱）→ 刷新 → 物资必须还在
  {
    const store = storeAtOrganize(1001);
    const session = createOrganizeSession();
    const before = piecesOf(store.run);
    const box = store.run.boxesToUnpack[0];
    const res = takeFromBox(store, session, box.id);
    if (!res.ok || !session.held) report(P2, 't1-setup', 'T1 前置失败：没拿到东西', '');
    else {
      const reloaded = reloadStore(store);
      const after = piecesOf(reloaded.run);
      if (after !== before) {
        report(P0, 'held-lost-on-refresh', '手里拿着东西时刷新页面，物资永久丢失',
          `拿起前全屋 ${before} 件 → 刷新读档后 ${after} 件（手里的 ${session.held.itemId}×${stackCount(session.held)} 没了；它已从箱里删、只活在内存 session 里）`);
      }
    }
  }
  // T1b 手里拿着东西（来自货架）→ 刷新
  {
    const store = storeAtOrganize(1002);
    const session = createOrganizeSession();
    // 先拆一箱放一件上货架
    takeFromBox(store, session, store.run.boxesToUnpack[0].id);
    const shelf = store.run.shelves[0];
    placeHeld(store, session, shelf.id, { row: 0, col: 0 });
    const before = piecesOf(store.run);
    const res = pickupFromShelf(store, session, shelf.id, { row: 0, col: 0 });
    if (res.ok && session.held) {
      const reloaded = reloadStore(store);
      const after = piecesOf(reloaded.run);
      if (after !== before) {
        report(P0, 'held-lost-on-refresh', '手里拿着东西时刷新页面，物资永久丢失',
          `从货架拿起 → 刷新后 ${before} → ${after} 件`);
      }
    }
  }
  // T1c 手里拿着东西点"过一天"（UI 不拦），再刷新
  {
    const store = storeAtOrganize(1003);
    const session = createOrganizeSession();
    takeFromBox(store, session, store.run.boxesToUnpack[0].id);
    const before = piecesOf(store.run);
    const r = endDay(store); // 手里还拿着
    if (r.ok) {
      const reloaded = reloadStore(store);
      const after = piecesOf(reloaded.run);
      if (after !== before) {
        report(P0, 'held-lost-endday', '手里拿着东西点"过一天"，物资随刷新丢失',
          `endDay 放行（ok=true），刷新后 ${before} → ${after} 件`);
      }
    }
  }

  // T2 小数坐标放东西：isInside(0.5) 通过、写入静默失败 → 物资消失
  {
    const store = storeAtOrganize(1004);
    const session = createOrganizeSession();
    takeFromBox(store, session, store.run.boxesToUnpack[0].id);
    if (session.held) {
      const before = piecesOf(store.run);
      const r = placeHeld(store, session, store.run.shelves[0].id, { row: 0.5, col: 1 });
      const after = piecesOf(store.run);
      if (r.ok && after < before) {
        report(P0, 'fractional-pos-loss', '小数格子坐标（row=0.5）放置"成功"但物资消失',
          `placeHeld 返回 ok 且手里已清空，全屋却 ${before} → ${after} 件（isInside 不查整数、setSlotStack 静默失败）`);
      }
    }
  }

  // T3a 购物车重复行：两份同样的行各按满库存结算 → 件数凭空翻倍
  {
    const store = freshStore(1005);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    const run = store.run;
    enterShop(store, REAL_SHOP_IDS[0]);
    if (run.dayEvent) resolveDayEvent(store, 0); // 清掉事件
    const stock = run.shopStocks.find((s) => s.shopId === run.currentShopId);
    const line = stock.lines.find((l) => l.stock >= 2);
    if (line) {
      run.cash = 1e7; // 排除现金约束，只看库存约束
      const before = piecesOf(run);
      const r = buyCart(store, run.currentShopId, [
        { itemId: line.itemId, count: line.stock },
        { itemId: line.itemId, count: line.stock }
      ]);
      const gained = piecesOf(run) - before;
      if (r.ok && gained > line.stock) {
        report(P1, 'cart-dupe-lines', '购物车重复行绕过库存上限：买 1 份库存得 2 份货',
          `店里 ${line.itemId} 只剩 ${line.stock} 件，两行各买 ${line.stock} → 实际到手 ${gained} 件（buildCartView 不对篮内重复行合并限额）`);
      }
    }
  }
  // T3b 购物车重复行绕限购
  {
    const store = freshStore(1006);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    const run = store.run;
    enterShop(store, REAL_SHOP_IDS[0]);
    if (run.dayEvent) resolveDayEvent(store, 0);
    const stock = run.shopStocks.find((s) => s.shopId === run.currentShopId);
    const line = stock.lines.find((l) => l.stock >= 4);
    if (line) {
      run.cash = 1e7;
      const cat = getItemDef(line.itemId).category;
      run.shopLimits.push({ shopId: run.currentShopId, category: cat, max: 2 }); // 模拟事件限购 2 件
      const before = piecesOf(run);
      const r = buyCart(store, run.currentShopId, [
        { itemId: line.itemId, count: 2 },
        { itemId: line.itemId, count: 2 }
      ]);
      const gained = piecesOf(run) - before;
      if (r.ok && gained > 2) {
        report(P1, 'cart-dupe-limit', '限购 2 件被重复行绕过：一次结账买到 4 件',
          `purchaseLimitOf 逐行算、不合计篮内同品 —— "全程上限"在单次结账内就漏了`);
      }
    }
  }

  // T4 购物车 NaN 件数：三约束全失效 → 现金变 NaN
  {
    const store = freshStore(1007);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    const run = store.run;
    enterShop(store, REAL_SHOP_IDS[0]);
    if (run.dayEvent) resolveDayEvent(store, 0);
    const stock = run.shopStocks.find((s) => s.shopId === run.currentShopId);
    const line = stock.lines[0];
    const view = buildCartView(run, run.currentShopId, [{ itemId: line.itemId, count: NaN }]);
    if (view && view.canLoad) {
      const r = buyCart(store, run.currentShopId, [{ itemId: line.itemId, count: NaN }]);
      if (r.ok && !Number.isFinite(run.cash)) {
        report(P0, 'cart-nan-count', '购物车 count=NaN：三约束全部放行，现金被写成 NaN',
          `buildCartView 的 > 比较对 NaN 全 false → problems 空 → canLoad=true → cash -= NaN`);
      }
    }
  }

  // T5 小器件数：买到 2.5 件
  {
    const store = freshStore(1008);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    const run = store.run;
    enterShop(store, REAL_SHOP_IDS[0]);
    if (run.dayEvent) resolveDayEvent(store, 0);
    const stock = run.shopStocks.find((s) => s.shopId === run.currentShopId);
    const line = stock.lines.find((l) => l.stock >= 3);
    run.cash = 1e7;
    const r = buyCart(store, run.currentShopId, [{ itemId: line.itemId, count: 2.5 }]);
    if (r.ok) {
      const box = run.boxesToUnpack[run.boxesToUnpack.length - 1];
      const n = box.items.reduce((s2, st) => s2 + stackCount(st), 0);
      if (!Number.isInteger(n)) {
        report(P1, 'cart-fractional-count', '购物车收小器件数：家里出现 2.5 件物资',
          `count=2.5 未被取整 → 箱内批次 count=2.5 → 后续消耗/腐坏全按小数走`);
      }
    }
  }

  // T6 手改档 disasterId → 自愈不拦 → 整理视图/生存结算崩
  {
    const store = storeAtOrganize(1009);
    const text = serialize(store.save).replace('"disasterId":"cold_snap"', '"disasterId":"alien_invasion"');
    const loaded = deserialize(text);
    if (loaded && loaded.run) {
      try {
        buildView({ run: loaded.run }, createOrganizeSession());
        // buildView 内部 getDisasterDef —— 不抛则说明有兜底
      } catch (e) {
        report(P0, 'tamper-disasterId', '手改存档 disasterId：读档"自愈"放行，随后界面/结算抛异常',
          `normalizeRun 不校验 disasterId，getDisasterDef 直接 throw：${firstLine(e)}`);
      }
      try {
        const st = new GameStore(loaded, noopScheduler);
        computeOrganizeScore(st.run.shelves, st.run.zones, st.run.boxesToUnpack, getDisasterDef(st.run.disasterId));
      } catch (e) {
        /* 同上，不重复报 */
      }
    }
  }

  // T7 手改档货架上的 itemId → 自愈不拦 → 任何渲染/取用崩
  {
    const store = storeAtOrganize(1010);
    const run = store.run;
    run.shelves[0] = setSlotStack(run.shelves[0], { row: 0, col: 0 }, makeStack('canned_beans', 3, null));
    const text = serialize(store.save).replace(/"itemId":"canned_beans"/, '"itemId":"dragon_egg"');
    const loaded = deserialize(text);
    if (loaded && loaded.run) {
      try {
        inventoryTotals(loaded.run);
      } catch (e) {
        report(P0, 'tamper-itemId', '手改存档物资 id：读档"自愈"放行，台账/渲染即崩',
          `normalizeShelves 不看 stack.itemId 合法性，getItemDef 直接 throw：${firstLine(e)}`);
      }
    }
  }

  // T8 手改档 identityId → 自愈不拦 → 过一天时崩（且 commit 半途）
  {
    const store = storeAtOrganize(1011);
    const text = serialize(store.save).replace(`"identityId":"${REAL_IDENTITY_IDS[0]}"`, '"identityId":"ghost"');
    const loaded = deserialize(text);
    if (loaded && loaded.run) {
      const st = new GameStore(loaded, noopScheduler);
      storeOfMap.set(st.run, st);
      try {
        // 推进到需要跨天的那一刻
        endDay(st);
        if (st.run.phase === 'night') {
          chooseNightOption(st, NIGHT_SLEEP);
          sleep(st);
        }
      } catch (e) {
        report(P0, 'tamper-identityId', '手改存档 identityId：过一天时 getIdentityDef 抛异常',
          `normalizeRun 不校验 identityId；startNextDay 第一句就 throw：${firstLine(e)}`);
      }
    }
  }

  // T9 手改档 stats.health = 字符串 → 自愈不拦 → 结算即 NaN / 判死逻辑混乱
  {
    const store = freshStore(1012);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    const raw = JSON.parse(serialize(store.save));
    raw.run.stats.health = 'abc';
    raw.run.day = 0;
    raw.run.phase = 'survival_day';
    const loaded = deserialize(JSON.stringify(raw));
    if (loaded && loaded.run) {
      const st = new GameStore(loaded, noopScheduler);
      storeOfMap.set(st.run, st);
      try {
        startSurvival(st);
      } catch (e) {
        report(P1, 'tamper-stats-crash', '手改 stats 后生存结算抛异常', fmtErr(e));
      }
      const h = st.run.stats.health;
      if (typeof h !== 'number' || !Number.isFinite(h)) {
        report(P1, 'tamper-stats', '手改存档 stats（字符串/NaN）：normalize 不重建 stats，四维被污染',
          `health 结算后 = ${String(h)}；phase=${st.run.phase} outcome=${String(st.run.outcome)}`);
      }
      if (st.run.outcome === 'collapsed' && typeof st.run.stats.health !== 'number') {
        report(P1, 'tamper-stats-death', 'NaN 健康被判定"死亡"：health>0 对 NaN 恒 false', `health=${String(h)}`);
      }
    }
  }

  // T13 交易收小器件数：1.5 + 1.5 = 3 通过校验 → 消耗 1.5 件
  {
    const store = freshStore(1013);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    const run = store.run;
    // 直接摆到生存期硬撑态
    run.phase = 'survival_day';
    run.day = 3;
    run.survival.last.hardPress = true;
    run.shelves[0] = setSlotStack(run.shelves[0], { row: 0, col: 0 }, makeStack('canned_beans', 6, null));
    if (canTrade(run)) {
      const before = piecesOf(run);
      const r = tradeForBox(store, [
        { itemId: 'canned_beans', count: 1.5 },
        { itemId: 'canned_beans', count: 1.5 }
      ]);
      if (r.ok) {
        const lost = before - piecesOf(run);
        const box = run.boxesToUnpack[run.boxesToUnpack.length - 1];
        const boxPieces = box.items.reduce((n, st) => n + stackCount(st), 0);
        if (Math.abs(lost - boxPieces - 3) > 1e-9 || !Number.isInteger(before - piecesOf(run) + boxPieces)) {
          // 付出的件数不是整数即命中
        }
        const shelfCount = stackCount(getStack(run.shelves[0], { row: 0, col: 0 }) ?? makeStack('canned_beans', 0, null));
        if (!Number.isInteger(shelfCount)) {
          report(P1, 'trade-fractional', '以物易物收小器件数：货架上剩 4.5 件罐头',
            `picks 1.5+1.5 通过"凑满 3 件"校验 → consumeItem 取走 1.5 → 货架余 ${shelfCount}`);
        }
      }
    }
  }

  // T14 夜间选项下标给字符串 "0"：被执行；读档后 choice 归 null → 同一晚可再选一次（效果吃两遍）
  {
    let dup = false;
    for (let seed = 2000; seed < 2100 && !dup; seed++) {
      const store = storeAtOrganize(seed);
      const r = endDay(store);
      if (store.run.phase !== 'night') continue;
      const cash0 = store.run.cash;
      const def = findNightEvent(store.run.night.eventId);
      if (!def || def.options.length === 0) continue;
      const res = chooseNightOption(store, '0'); // 字符串下标
      if (res.ok) {
        const cash1 = store.run.cash;
        const reloaded = reloadStore(store);
        // 读档后 choice 被归 null → 可以再选一次
        if (reloaded.run.night && reloaded.run.night.choice === null) {
          const st = reloaded;
          storeOfMap.set(st.run, st);
          const res2 = chooseNightOption(st, 0);
          if (res2.ok && st.run.cash !== cash1) {
            report(P1, 'night-string-choice', '夜间选项用字符串下标被执行，读档后同一晚能再选一次（效果翻倍）',
              `第一次选后现金 ${cash0}→${cash1}；读档把 choice 归 null，再选后 ${st.run.cash}`);
            dup = true;
          }
        }
      }
    }
  }

  // T15 手改档商店价格 NaN → 买入后现金 NaN
  {
    const store = freshStore(1014);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    const raw = JSON.parse(serialize(store.save));
    raw.run.shopStocks[0].lines[0].price = NaN; // JSON 里落成 null
    const loaded = deserialize(JSON.stringify(raw));
    if (loaded && loaded.run) {
      const st = new GameStore(loaded, noopScheduler);
      storeOfMap.set(st.run, st);
      enterShop(st, raw.run.shopStocks[0].shopId);
      if (st.run.dayEvent) resolveDayEvent(st, 0);
      const line = loaded.run.shopStocks[0].lines[0];
      const r = buyCart(st, line.itemId === undefined ? raw.run.shopStocks[0].shopId : raw.run.shopStocks[0].shopId, [
        { itemId: line.itemId, count: 1 }
      ]);
      if (r.ok && !Number.isFinite(st.run.cash)) {
        report(P1, 'tamper-shop-price-nan', '手改档商店价格 NaN：normalize 不校验 line.price，买入即现金 NaN',
          `shopStocks[].lines[].price 只做形状校验，数值不兜底`);
      }
    }
  }

  // T26 缺 stats 的"完整档"（版本号齐全但 stats 被删）→ 夜间效果崩
  {
    const store = freshStore(1015);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    const raw = JSON.parse(serialize(store.save));
    delete raw.run.stats;
    const loaded = deserialize(JSON.stringify(raw));
    if (loaded && loaded.run) {
      const st = new GameStore(loaded, noopScheduler);
      storeOfMap.set(st.run, st);
      let crashed = null;
      try {
        // 夜间效果直接读 run.stats.health
        const { applyNightEffect } = { applyNightEffect: null };
      } catch (e) {
        crashed = e;
      }
      try {
        st.run.stats.health += 1; // UI/系统任何地方一碰就炸
      } catch (e) {
        crashed = e;
      }
      if (crashed) {
        report(P1, 'tamper-no-stats', '存档缺整个 stats 对象：normalize 不补，任何读写四维的地方直接 TypeError',
          firstLine(crashed));
      }
    }
  }

  // T30 __proto__ 键：不得污染原型
  {
    const raw = JSON.parse(serialize(storeAtOrganize(1016).save));
    raw.run.trust = JSON.parse('{"__proto__": 5, "npc_wang": 2}');
    raw.run.shopBoughtToday = JSON.parse('{"__proto__": 7}');
    deserialize(JSON.stringify(raw));
    if (Object.prototype[5] !== undefined || {}.polluted !== undefined) {
      report(P0, 'proto-pollution', '存档里的 __proto__ 键污染了 Object.prototype', '');
    }
  }

  // T31 限购绕过补充：buyCart 不校验 dayEvent 是否已处理（可以先买再理事件）
  {
    const store = freshStore(1017);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    // 反复进店直到撞上事件
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      const r = enterShop(store, rpick(REAL_SHOP_IDS));
      if (store.run.dayEvent) hit = true;
      else leaveShop(store);
      if (!r.ok) break;
    }
    if (hit) {
      const stock = store.run.shopStocks.find((s) => s.shopId === store.run.dayEvent.shopId);
      const line = stock?.lines.find((l) => l.stock > 0);
      if (line) {
        store.run.cash = 1e7;
        const r = buyCart(store, store.run.dayEvent.shopId, [{ itemId: line.itemId, count: 1 }]);
        if (r.ok) {
          report(P3, 'buy-while-event-pending', '白天事件未处理时仍能结账（命令层不拦，纯靠 UI 遮挡）',
            '事件选项的限购/涨价可以被"先买完再决定"绕过');
        }
      }
    }
  }

  return performance.now() - t0;
}

// ———————————————————————— S3 存档破坏 ————————————————————————
function makeBaseSaves() {
  const bases = [];
  // ① 囤货中期：玩过几步的真实档
  {
    const { store } = playGameSilently(3101, 25);
    bases.push({ name: '囤货中期', text: serialize(store.save) });
  }
  // ② 生存期：跳到 D-Day 再结算两天
  {
    const store = freshStore(3102);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    store.run.day = 0;
    store.run.phase = 'survival_day';
    startSurvival(store);
    advanceSurvivalDay(store);
    bases.push({ name: '生存期D+2', text: serialize(store.save) });
  }
  // ③ 结局档
  {
    const store = freshStore(3103);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    store.run.day = 1;
    store.run.phase = 'survival_day';
    store.run.stats.health = 0;
    advanceSurvivalDay(store);
    bases.push({ name: '结局档', text: serialize(store.save) });
  }
  return bases;
}

function playGameSilently(seed, steps) {
  return playGame(seed, steps);
}

/** 随机变异：每次挑 1~6 种破坏手法 */
function mutateSaveText(text) {
  const raw = JSON.parse(text);
  const labels = [];
  const n = rint(1, 6);
  for (let i = 0; i < n; i++) {
    const m = rint(0, 21);
    try {
      switch (m) {
        case 0: raw.run && (raw.run.day = rpick([NaN, Infinity, -Infinity, 1e9, -1e9, 0.5, 'abc', null])); labels.push('day坏值'); break;
        case 1: raw.run && (raw.run.cash = rpick([NaN, -50, 'abc', null, 1e308, -1e308])); labels.push('cash坏值'); break;
        case 2: raw.run && (raw.run.phase = rpick(['credits', '', null, 42, 'NIGHT'])); labels.push('phase坏值'); break;
        case 3: raw.run && (raw.run.seed = rpick([NaN, -1, 1e20, 'abc', null])); labels.push('seed坏值'); break;
        case 4: if (raw.run?.stats) raw.run.stats[rpick(['health', 'mood', 'stamina', 'shelter'])] = rpick([NaN, 'x', null, -30, 999]); labels.push('stats坏值'); break;
        case 5: raw.run && (raw.run.disasterId = rpick(['godzilla', '', null, 7])); labels.push('disasterId坏值'); break;
        case 6: raw.run && (raw.run.identityId = rpick(['ghost', '', null])); labels.push('identityId坏值'); break;
        case 7: raw.run && (raw.run.shelves = rpick([null, {}, 'x', [null], [{}], [{ id: 'a', slots: [] }]])); labels.push('shelves坏值'); break;
        case 8: raw.run && (raw.run.boxesToUnpack = rpick([null, {}, [null], [{ id: 1, items: 'x' }], [{ id: 'b', defId: 'nope', items: [{ itemId: 'x', batches: [{ count: -3, expiresAtDay: NaN }] }] }]])); labels.push('boxes坏值'); break;
        case 9: raw.run && (raw.run.night = rpick([{ eventId: 'nope', choice: null }, { eventId: null }, 'x', 42])); labels.push('night坏值'); break;
        case 10: raw.run && (raw.run.helpRequest = rpick([{ defId: 'nope' }, { defId: null }, 'x'])); labels.push('help坏值'); break;
        case 11: raw.run && (raw.run.dayEvent = rpick([{ defId: 'nope', shopId: 'nope', choice: null }, { defId: null }, 5])); labels.push('dayEvent坏值'); break;
        case 12: raw.run && (raw.run.eventHistory = rpick([null, { night: 'x' }, { night: ['nope1', 'nope2'], help: [1, 2, 3] }])); labels.push('history坏值'); break;
        case 13: raw.run && (raw.run.log = rpick(['x', null, 42, [1, null, {}]])); labels.push('log坏值'); break;
        case 14: raw.run && (raw.run.trust = rpick(['x', null, [1], { npc_wang: 'x' }])); labels.push('trust坏值'); break;
        case 15: raw.run && (raw.run.shopStocks = rpick([null, {}, [{ shopId: 'supermarket', day: -7, lines: [{ itemId: 'canned_beans', price: NaN, stock: -5 }] }]])); labels.push('stocks坏值'); break;
        case 16: raw.run && (raw.run.survival = rpick([null, 42, { last: 'x' }, { spoiled: -5, lastTradeDay: 'x' }])); labels.push('survival坏值'); break;
        case 17: raw.meta && (raw.meta.version = rpick(['14', 999, -1, NaN, null])); labels.push('version坏值'); break;
        case 18: raw.meta && (raw.meta.codex = rpick([null, 'x', { items: 'x' }, { items: [1, null] }])); labels.push('codex坏值'); break;
        case 19: { // 删随机顶层键
          const ks = raw.run ? Object.keys(raw.run) : [];
          if (ks.length > 0) { const k = rpick(ks); delete raw.run[k]; labels.push(`删run.${k}`); }
          break;
        }
        case 20: { // 随机叶子换坏值
          const junk = rpick([NaN, Infinity, -1e308, '💥', null, [], {}]);
          const path = [];
          let cur = raw;
          for (let d = 0; d < 6; d++) {
            if (typeof cur !== 'object' || cur === null) break;
            const ks = Object.keys(cur);
            if (ks.length === 0) break;
            const k = rpick(ks);
            path.push(k);
            cur = cur[k];
          }
          let target = raw;
          for (let d = 0; d < path.length - 1; d++) target = target[path[d]];
          if (path.length > 0 && typeof target === 'object' && target !== null) {
            target[path[path.length - 1]] = junk;
            labels.push(`叶子${path.join('.')}=${String(junk).slice(0, 12)}`);
          }
          break;
        }
        case 21: { // 巨大化
          if (raw.run) {
            raw.run.log = Array.from({ length: 20000 }, (_, j) => `D+1 · 假日志 ${j}`);
            labels.push('log×20000');
          }
          break;
        }
      }
    } catch { /* 变异器自己不许炸 */ }
  }
  return { text: JSON.stringify(raw), labels: labels.join(',') || '无操作' };
}

function suiteSaveFuzz() {
  const t0 = performance.now();
  const bases = makeBaseSaves();
  for (let i = 0; i < SAVE_FUZZ; i++) {
    const base = rpick(bases);
    let mutant;
    try {
      mutant = mutateSaveText(base.text);
    } catch (e) {
      continue;
    }
    stats.saveMutants += 1;
    let loaded = null;
    try {
      loaded = deserialize(mutant.text);
    } catch (e) {
      report(P0, 'savefuzz-deserialize-throw', `deserialize 抛异常（${base.name}）`, `变异: ${mutant.labels}\n${fmtErr(e)}`);
      continue;
    }
    if (!loaded || !loaded.run) continue; // 退回新局是合法出口
    stats.saveMutantsPlayable += 1;
    const store = new GameStore(loaded, noopScheduler);
    storeOfMap.set(store.run, store);
    scanRun(store.run, `存档fuzz[${base.name}] 变异: ${mutant.labels}`);
    // 继续玩 25 步 —— 自愈后的档必须真的玩得下去
    const session = createOrganizeSession();
    for (let s = 0; s < 25; s++) {
      if (!store.hasRun) break;
      if (store.run.phase === 'ending' && s > 3) break;
      const move = botStep(store, session);
      try {
        move.fn();
      } catch (e) {
        report(P0, `savefuzz-play-crash:${move.label}:${firstLine(e)}`, `坏档自愈后继续玩时崩溃：${move.label}（${base.name}）`,
          `变异: ${mutant.labels}\n${fmtErr(e)}`);
        break;
      }
      stats.ops += 1;
      if (store.hasRun) {
        storeOfMap.set(store.run, store);
        if (s % 5 === 0) scanRun(store.run, `存档fuzz游玩中[${base.name}] 变异: ${mutant.labels} 操作=${move.label}`);
      }
    }
  }
  // 纯垃圾 JSON 也得活着接住
  const garbage = ['', 'null', '[]', '123', '"abc"', '{', '{"meta":null}', '{"run":[]}', '{"meta":{"version":999999}}', '{"run":{"phase":"x"}}', '\u0000\u0001', '{"meta":{"version":14},"run":null}'];
  for (const g of garbage) {
    try {
      deserialize(g);
    } catch (e) {
      report(P0, 'garbage-json-throw', '垃圾 JSON 让 deserialize 抛异常', JSON.stringify(g.slice(0, 40)) + ' ' + fmtErr(e));
    }
  }
  return performance.now() - t0;
}

// ———————————————————————— S4 model 层 fuzz ————————————————————————
function suiteModelFuzz() {
  const t0 = performance.now();
  const weirdCounts = [NaN, Infinity, -Infinity, -1, 0, 0.5, 1.5, 1e9, 3];
  const weirdExpiry = [null, NaN, Infinity, -Infinity, -7, 0, 999999999];
  const weirdNeed = [NaN, Infinity, -Infinity, -1, 0, 0.5, 1e9, 2];

  for (let i = 0; i < MODEL_FUZZ; i++) {
    // splitStack
    {
      const stack = {
        itemId: rpick(ITEM_IDS),
        batches: Array.from({ length: rint(1, 4) }, () => ({ count: rpick(weirdCounts), expiresAtDay: rpick(weirdExpiry) }))
      };
      const n = rpick(weirdNeed);
      try {
        const r = splitStack(stack, n);
        stats.modelCalls += 1;
        // 输入全是正整数时，输出必须守恒且非负整数
        const inTotal = stack.batches.reduce((s2, b) => s2 + b.count, 0);
        const outTaken = r.taken.batches.reduce((s2, b) => s2 + b.count, 0);
        const outLeft = r.left ? r.left.batches.reduce((s2, b) => s2 + b.count, 0) : 0;
        if (Number.isInteger(inTotal) && inTotal > 0 && Number.isInteger(n) && n >= 0) {
          if (outTaken + outLeft !== inTotal) {
            report(P1, 'model-split-lost', 'splitStack 正整数输入下不守恒', `in=${inTotal} n=${n} taken=${outTaken} left=${outLeft}`);
          }
        }
        if (Number.isNaN(n) && outTaken + outLeft !== inTotal) {
          report(P2, 'model-split-nan', 'splitStack 收到 NaN：整堆被销毁（taken 空 / left 空）', `in=${JSON.stringify(stack).slice(0, 120)}`);
        }
      } catch (e) {
        report(P2, 'model-split-throw', 'splitStack 抛异常', `n=${n} ${fmtErr(e)}`);
      }
    }
    // consumeCategory / consumeItem
    {
      const shelves = [createShelf('s1', 'room', 'shelf')];
      let shelf = shelves[0];
      shelf = setSlotStack(shelf, { row: 0, col: 0 }, makeStack('canned_beans', 6, 5));
      shelf = setSlotStack(shelf, { row: 0, col: 1 }, makeStack('mineral_water', 6, null));
      shelves[0] = shelf;
      const boxes = [{ id: 'b1', defId: 'box_staple', items: [makeStack('canned_beans', 4, 9)] }];
      const need = rpick(weirdNeed);
      try {
        const r = consumeCategory(shelves, [], boxes, 'food', need);
        stats.modelCalls += 1;
        if (Number.isNaN(need)) {
          const remain = r.shelves[0] && getStack(r.shelves[0], { row: 0, col: 0 });
          if (!remain) {
            report(P2, 'model-consume-nan-wipe', 'consumeCategory 收到 NaN：整个品类被清空且 taken=NaN',
              `need=NaN → 货架上 6 件罐头全没了，taken=${r.taken} shortage=${r.shortage}`);
          }
        }
      } catch (e) {
        report(P2, 'model-consume-throw', 'consumeCategory 抛异常', `need=${need} ${fmtErr(e)}`);
      }
      try {
        const r2 = consumeItem(shelves, boxes, 'canned_beans', need);
        stats.modelCalls += 1;
        if (Number.isNaN(need)) {
          const left = countByItem(r2.shelves, r2.boxes).find((x) => x.itemId === 'canned_beans');
          if (!left) {
            report(P2, 'model-consumeitem-nan-wipe', 'consumeItem 收到 NaN：该物资全屋清零', `taken=${r2.taken}`);
          }
        }
      } catch (e) {
        report(P2, 'model-consumeitem-throw', 'consumeItem 抛异常', `need=${need} ${fmtErr(e)}`);
      }
    }
    // spoilEverything
    {
      const vDay = rpick([NaN, Infinity, -Infinity, 0.5, -3, 100]);
      const shelves = [setSlotStack(createShelf('s1', 'room', 'shelf'), { row: 0, col: 0 }, makeStack('canned_beans', 6, 5))];
      try {
        const r = spoilEverything(shelves, [], vDay);
        stats.modelCalls += 1;
        if (!Number.isInteger(r.total)) report(P2, 'model-spoil-noninteger', 'spoilEverything 损耗不是整数', `vDay=${vDay} total=${r.total}`);
      } catch (e) {
        report(P2, 'model-spoil-throw', 'spoilEverything 抛异常', `vDay=${vDay} ${fmtErr(e)}`);
      }
    }
    // normalizeStack 喂脏批次
    {
      const stack = {
        itemId: rpick(ITEM_IDS),
        batches: Array.from({ length: rint(1, 4) }, () => ({ count: rpick(weirdCounts), expiresAtDay: rpick(weirdExpiry) }))
      };
      try {
        const r = normalizeStack(stack);
        stats.modelCalls += 1;
      } catch (e) {
        report(P2, 'model-normalize-throw', 'normalizeStack 抛异常', fmtErr(e));
      }
    }
    // nextInt / pickWeighted 边界
    {
      const a = rpick([NaN, -5, 0, 3, 1e9]);
      const b = rpick([NaN, -5, 0, 3, 1e9]);
      try {
        nextInt(rng, a, b);
        stats.modelCalls += 1;
      } catch { /* max<min 抛是设计内行为 */ }
      try {
        pickWeighted(rng, [
          { item: 'a', weight: rpick([NaN, Infinity, -1, 0, 1]) },
          { item: 'b', weight: rpick([NaN, Infinity, -1, 0, 1]) }
        ]);
        stats.modelCalls += 1;
      } catch (e) {
        report(P2, 'model-pickweighted-throw', 'pickWeighted 抛异常', fmtErr(e));
      }
    }
  }

  // dropStack 放空堆（0 件）→ 幽灵堆占位
  {
    const shelf = createShelf('s1', 'room', 'shelf');
    const ghost = { itemId: 'canned_beans', batches: [] };
    const next = dropStack(shelf, { row: 0, col: 0 }, ghost);
    if (next && getStack(next, { row: 0, col: 0 }) !== null) {
      report(P2, 'model-dropstack-ghost', 'dropStack 接受 0 件空堆：货架上出现"幽灵堆"占一格', 'canAccept 有 count>0 检查，dropStack 的空格路径没有');
    }
  }

  // 药品/保暖品里有没有 heal/shelter 为 0 的（autoSupply 会白吃掉它）
  {
    const zeroHeal = ITEM_DEFS.filter((d) => d.category === 'medicine' && healOf(d) <= 0).map((d) => d.id);
    const zeroWarm = ITEM_DEFS.filter((d) => d.category === 'warmth' && shelterOf(d) <= 0).map((d) => d.id);
    if (zeroHeal.length > 0) {
      report(P1, 'autosupply-zero-heal', '自动补给会"白吃"不回血的药品（消耗掉但 0 效果）', zeroHeal.join(','));
    }
    if (zeroWarm.length > 0) {
      report(P1, 'autosupply-zero-warm', '自动补给会"白用"不加庇护的保暖品（消耗掉但 0 效果）', zeroWarm.join(','));
    }
  }

  return performance.now() - t0;
}

// ———————————————————————— S5 守恒与幂等 ————————————————————————
function suiteIntegrity() {
  const t0 = performance.now();

  // 购买守恒：件数 +n、现金 -cost、车载 +weight，一个都不能差
  for (let i = 0; i < 120; i++) {
    const store = freshStore(rint(1, 0x7fffffff));
    linkStore(store);
    chooseIdentity(store, rpick(REAL_IDENTITY_IDS));
    enterShop(store, rpick(REAL_SHOP_IDS));
    if (store.run.dayEvent) resolveDayEvent(store, 0);
    const run = store.run;
    const stock = run.shopStocks.find((s) => s.shopId === run.currentShopId);
    if (!stock) continue;
    const line = rpick(stock.lines.filter((l) => l.stock > 0));
    if (!line) continue;
    const count = rint(1, Math.min(3, line.stock));
    const p0 = piecesOf(run);
    const c0 = run.cash;
    const w0 = run.carLoad;
    const view = buildCartView(run, run.currentShopId, [{ itemId: line.itemId, count }]);
    if (!view || !view.canLoad) continue;
    const r = buyCart(store, run.currentShopId, [{ itemId: line.itemId, count }]);
    if (r.ok) {
      if (piecesOf(run) - p0 !== view.pieces) report(P0, 'integrity-buy-pieces', '购买后件数不守恒', `+${piecesOf(run) - p0} vs 视图 ${view.pieces}`);
      if (c0 - run.cash !== view.cost) report(P0, 'integrity-buy-cash', '购买后现金不守恒', `${c0}-${run.cash} ≠ ${view.cost}`);
      if (Math.abs(run.carLoad - w0 - view.weight) > 0.01) report(P1, 'integrity-buy-weight', '购买后车载不守恒', `${w0}+${view.weight} ≠ ${run.carLoad}`);
    }
  }

  // 拆箱-放回守恒：拿起再放回，件数必须一模一样
  for (let i = 0; i < 120; i++) {
    const store = storeAtOrganize(rint(1, 0x7fffffff));
    const session = createOrganizeSession();
    const run = store.run;
    if (run.boxesToUnpack.length === 0) continue;
    const p0 = piecesOf(run);
    takeFromBox(store, session, rpick(run.boxesToUnpack).id);
    if (!session.held) continue;
    returnHeld(store, session);
    if (piecesOf(run) !== p0) {
      report(P0, 'integrity-pick-return', '拿起→放回后件数变了', `${p0} → ${piecesOf(run)}`);
    }
  }

  // 幂等：同一命令打两遍，第二遍不得再生效
  {
    const store = storeAtOrganize(5001);
    const r1 = endDay(store);
    if (store.run.phase === 'night') {
      const r2 = endDay(store);
      if (r2.ok) report(P1, 'idempotent-endday', 'night 阶段 endDay 二次调用仍然 ok', '');
      const c1 = chooseNightOption(store, 0);
      const cash1 = store.run.cash;
      const c2 = chooseNightOption(store, 0);
      if (c2.ok && store.run.cash !== cash1) report(P0, 'idempotent-night-choice', '夜间选项二次生效（现金被动了两次）', '');
      sleep(store);
      const day1 = store.run.day;
      const s2 = sleep(store);
      if (s2.ok && store.run.day !== day1) report(P0, 'idempotent-sleep', 'sleep 二次推进日历', '');
    } else {
      const r2 = endDay(store);
      if (r2.ok) report(P1, 'idempotent-endday-2', '跨天后 endDay 二次调用仍 ok（日历连跳）', `day=${store.run.day}`);
    }
  }

  // settleRunMeta 幂等
  {
    const store = freshStore(5002);
    linkStore(store);
    chooseIdentity(store, REAL_IDENTITY_IDS[0]);
    store.run.day = 1;
    store.run.phase = 'survival_day';
    store.run.stats.health = 0;
    advanceSurvivalDay(store);
    const v1 = settleRunMeta(store);
    const codex1 = JSON.stringify(store.save.meta.codex);
    const v2 = settleRunMeta(store);
    const codex2 = JSON.stringify(store.save.meta.codex);
    if (v1 && v2) report(P0, 'idempotent-meta', 'settleRunMeta 发了两次奖励', '');
    if (codex1 !== codex2) report(P0, 'idempotent-meta-2', 'settleRunMeta 第二次改了图鉴', '');
  }

  // 事件选项二次决定
  {
    for (let seed = 5100; seed < 5150; seed++) {
      const store = freshStore(seed);
      linkStore(store);
      chooseIdentity(store, REAL_IDENTITY_IDS[0]);
      enterShop(store, rpick(REAL_SHOP_IDS));
      if (!store.run.dayEvent) continue;
      const cash1 = store.run.cash;
      const r1 = resolveDayEvent(store, 0);
      const cash2 = store.run.cash;
      const r2 = resolveDayEvent(store, 0);
      if (r2.ok && store.run.cash !== cash2) {
        report(P0, 'idempotent-dayevent', '白天事件二次生效', `现金 ${cash1}→${cash2}→${store.run.cash}`);
        break;
      }
    }
  }

  // 求援二次处理
  {
    for (let seed = 5200; seed < 5300; seed++) {
      const store = freshStore(seed);
      linkStore(store);
      chooseIdentity(store, REAL_IDENTITY_IDS[0]);
      store.run.day = 1;
      store.run.phase = 'survival_day';
      advanceSurvivalDay(store);
      if (store.run.phase !== 'help_request') continue;
      const t1 = JSON.stringify(store.run.trust);
      fulfillRequest(store);
      const r2 = fulfillRequest(store);
      if (r2.ok) report(P1, 'idempotent-help', '求援单二次交付成功', `trust ${t1} → ${JSON.stringify(store.run.trust)}`);
      break;
    }
  }

  return performance.now() - t0;
}

// ———————————————————————— S6 规模与性能 ————————————————————————
function suitePerf() {
  const t0 = performance.now();
  const perf = {};

  // 巨型档：800 箱 + 货架铺满
  const store = freshStore(6001);
  linkStore(store);
  chooseIdentity(store, REAL_IDENTITY_IDS[0]);
  const run = store.run;
  const cursor = createCursor(6001);
  for (let i = 0; i < 800; i++) {
    const def = BOX_DEFS[i % BOX_DEFS.length];
    run.boxesToUnpack.push({ id: `box_perf_${i}`, defId: def.id, items: generateBoxStacks(cursor, def, -7) });
  }
  /*
   * ★ 用**下标**取货架，不要 `for (const shelf of run.shelves)` 再 `indexOf(shelf)`。
   *
   * `setSlotStack` 返回的是**新对象**，我们把它写回 `run.shelves[si]` ——
   * 于是 `for...of` 手里那个旧引用**已经不在数组里了**，下一轮 `indexOf(旧引用)`
   * 返回 -1，`run.shelves[-1]` 是 undefined，接着在 `setSlotStack` 里读 `shelf.h` 就炸。
   * （这是本工具原本就有的崩溃：S1~S5 都能跑，一到 S6 就 `Cannot read properties of undefined`。）
   */
  for (let si = 0; si < run.shelves.length; si++) {
    const w = run.shelves[si]?.w ?? 0;
    const h = run.shelves[si]?.h ?? 0;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const id = ITEM_IDS[(r * w + c) % ITEM_IDS.length];
        const cur = run.shelves[si];
        if (!cur) continue;
        run.shelves[si] = setSlotStack(cur, { row: r, col: c }, makeStack(id, 2, null));
      }
    }
  }
  perf['件数'] = piecesOf(run);

  const time = (label, fn, times = 30) => {
    const samples = [];
    for (let i = 0; i < times; i++) {
      const s = performance.now();
      fn();
      samples.push(performance.now() - s);
    }
    samples.sort((a, b) => a - b);
    perf[label] = {
      p50: Math.round(samples[Math.floor(samples.length / 2)] * 100) / 100,
      max: Math.round(samples[samples.length - 1] * 100) / 100
    };
  };

  time('buildView×800箱', () => buildView(store, createOrganizeSession()));
  time('sortAllByFEFO×800箱', () => sortAllByFEFO(store, createOrganizeSession()), 10);
  time('serialize×800箱', () => serialize(store.save), 20);
  time('deserialize×800箱', () => deserialize(serialize(store.save)), 10);
  time('householdTotals×800箱', () => householdTotals(run), 20);
  time('spoilEverything×800箱', () => spoilEverything(run.shelves, run.boxesToUnpack, 3), 10);
  time('consumeCategory×800箱', () => consumeCategory(run.shelves, run.zones, run.boxesToUnpack, 'food', 2), 10);
  perf['serializeKB'] = Math.round(serialize(store.save).length / 1024);

  // 日志无限增长：5 万条日志的存档体积（localStorage 配额通常 5MB）
  const store2 = storeAtOrganize(6002);
  for (let i = 0; i < 50000; i++) store2.run.log.push(`D+${i % 15} · 在超市花了 120 元，6 件装成一箱（3.2kg）。`);
  perf['log5万条KB'] = Math.round(serialize(store2.save).length / 1024);

  // 100 局长期运行后 log 自然长度
  return { perf, ms: performance.now() - t0 };
}

// ———————————————————————— 汇总 ————————————————————————
function main() {
  console.log(`[stress] seed=${SEED} games=${GAMES} saveFuzz=${SAVE_FUZZ} modelFuzz=${MODEL_FUZZ}\n`);
  const t0 = performance.now();

  const t1 = suiteTargeted();
  console.log(`[S2 定点打击] ${(t1 / 1000).toFixed(1)}s`);

  const t2 = suiteIntegrity();
  console.log(`[S5 守恒幂等] ${(t2 / 1000).toFixed(1)}s`);

  const t3 = suiteModelFuzz();
  console.log(`[S4 model fuzz] ${(t3 / 1000).toFixed(1)}s`);

  const t4 = suiteChaos();
  console.log(`[S1 混沌整局] ${(t4 / 1000).toFixed(1)}s`);

  const t5 = suiteSaveFuzz();
  console.log(`[S3 存档破坏] ${(t5 / 1000).toFixed(1)}s`);

  const { perf, ms: t6 } = suitePerf();
  console.log(`[S6 规模性能] ${(t6 / 1000).toFixed(1)}s`);

  const total = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n[stress] 总耗时 ${total}s`);
  console.log(`[stress] 操作总数 ${stats.ops}，整局 ${stats.games}（打到结局 ${stats.gamesEnded}），模拟刷新 ${stats.reloads}，存档变异 ${stats.saveMutants}（可玩 ${stats.saveMutantsPlayable}），model 调用 ${stats.modelCalls}`);

  const order = [P0, P1, P2, P3];
  const sorted = [...issues.entries()].sort((a, b) => order.indexOf(a[1].severity) - order.indexOf(b[1].severity) || b[1].count - a[1].count);
  console.log(`\n[stress] 命中问题 ${sorted.length} 类：`);
  for (const [key, it] of sorted) {
    console.log(`  [${it.severity}] ×${it.count} ${it.title}  <${key}>`);
  }

  const out = {
    seed: SEED,
    scale: { games: GAMES, saveFuzz: SAVE_FUZZ, modelFuzz: MODEL_FUZZ },
    stats,
    perf,
    issues: sorted.map(([key, it]) => ({ key, severity: it.severity, title: it.title, count: it.count, examples: it.examples }))
  };
  const outPath = join(here, 'stress-results.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n[stress] 明细已写入 ${outPath}`);
}

main();
