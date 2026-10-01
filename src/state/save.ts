/**
 * 存档读写（§4A：每个动作完成即写 localStorage，debounce ≤ 300ms）。
 *
 * 职责边界：
 *  - 只负责"序列化 / 校验 / 迁移 / 落盘节流"，不认识任何玩法规则；
 *  - 不直接摸 window，介质由 state/storage.ts 注入。
 */
import { BOX_DEFS } from '../data/boxes';
import { findDayEvent } from '../data/dayEvents';
import { FIRST_STOCKPILE_DAY, SURVIVAL_DAYS } from '../data/disaster';
import { findEmergency } from '../data/emergencies';
import { IDENTITY_DEFS, hasIdentityDef } from '../data/identities';
import { findHelpRequestDef } from '../data/helpRequests';
import { NIGHT_SLEEP, findNightEvent } from '../data/nightEvents';
import { ACTION_POINTS_PER_DAY } from '../data/shops';
import { EMPTY_SURVIVAL_SNAPSHOT, NEVER_TRADED } from '../data/survival';
import type {
  AppliedEffect,
  DayEffectApplied,
  Shelf,
  GamePhase,
  ItemStack,
  MetaProfile,
  RunState,
  SaveGame,
  UnpackBox,
  Zone
} from '../model/types';
import { HANDY_SLOTS } from '../model/shelf';
import { createMemoryStorage, resolveStorage, type StorageLike } from './storage';

export const STORAGE_KEY = 'tunhuo.save';
/**
 * 当前 schema 版本。
 *  - v1：M0 首版（待拆箱是 `ItemStack[][]`）
 *  - v2：待拆箱升级为 `UnpackBox[]`（稳定 id + 箱型），"放回原箱"才可能是对的
 *  - v3：分区收敛为"胶带"（名字 + 颜色），剥掉存量存档里的 autoAccept 规则声明
 *  - v4：M1 囤货期（状态机 + 采购）—— 补行动点/车载/当日库存四个字段，
 *        并把 M0 的 `day: 0`（占位）迁成"囤货期最后一天" `-1`
 *  - v5：M1 夜间事件 —— 新增 `night`（§6.2），并让"卡在夜里"的坏档能自愈
 *  - v6：M1 生存期 —— 新增 `survival`（累计腐坏与缺货天数），结算页要用
 *  - v7：M1 平衡改造 —— `survival` 增加硬撑天数，结算快照增加"取用来源 / 劳作 / 补给"六项，
 *        并新增 `outcome`（这一局是撑过去了，还是没撑住）
 *  - v8：夜间事件的结果落盘 —— 新增 `NightState.applied`，记录这一晚**实际**发生了什么，
 *        修掉"现金不够时界面报的却是选项声明的数"那个 bug
 *  - v9：硬撑分档（§12.3 v0.6）—— `survival` 增加连续硬撑天数，结算快照增加档位
 *  - v10：结算页的口径修正 —— `survival` 增加"累计缺口件数"与"有货拿不动件数"，
 *        取代那个会被"缺 1 件"和"缺 5 件"糊成同一个数的缺货天数
 *  - v11：求援订单（§6.5）—— 新增 `helpRequest`，并让"卡在门口"的坏档能自愈
 *  - v12：顺手位（§5「应急货架（门口/最顺手位）」）—— `Shelf` 新增 `handyRank`，
 *        同时补齐 §6.3 的第三维「应急可达率」
 *  - v13：M2 四件套 ——
 *        ① 图鉴与 meta 闭环（§6.7/§9.6）：`MetaProfile` 增加 `bestSafeStreak`
 *           与 `codex` 的三页（`items`/`disasters`/`npcs`）；
 *        ② `survival` 增加 `safeStreak`（夜间"安全感"连击）、
 *           `last` 快照增加突发事件三项；
 *        ③ 白天随机事件（§6.2 / D-10）：`shopPriceFactor` / `shopLimits` / `dayEvent`；
 *        ④ `metaSettled` —— 这一局的成果记没记进 meta（三个结局出口只许发一次奖励）
 */
export const SAVE_VERSION = 13;
/** 落盘节流上限（提示词 0：debounce ≤ 300ms） */
export const SAVE_DEBOUNCE_MS = 250;

function createDeviceId(): string {
  let id = '';
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 10; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `dev_${id}`;
}

export function createMetaProfile(): MetaProfile {
  return {
    version: SAVE_VERSION,
    identityLevels: {},
    codex: { items: [], disasters: [], npcs: [] },
    bestSurvivalDays: {},
    bestSafeStreak: 0
  };
}

export function createSaveGame(run: RunState | null): SaveGame {
  return {
    meta: createMetaProfile(),
    run,
    savedAt: Date.now(),
    syncVersion: 1,
    deviceId: createDeviceId()
  };
}

/** 写盘前统一"打时间戳 + 递增 syncVersion"（§4A：冲突时取 syncVersion 大者） */
export function touch(save: SaveGame): SaveGame {
  save.savedAt = Date.now();
  save.syncVersion += 1;
  save.meta.version = SAVE_VERSION;
  return save;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * 迁移入口：把任意版本的原始 JSON 抬到当前 SAVE_VERSION。
 * version 缺失 → 视为 0（最早期裸档），补默认字段后进入 1。
 * 无法识别（未来版本 / 结构崩坏）→ 返回 null，由调用方开新局，绝不抛异常。
 */
export function migrate(raw: unknown): SaveGame | null {
  if (!isObject(raw)) return null;
  const rawMeta = isObject(raw.meta) ? raw.meta : {};
  const declared =
    typeof rawMeta.version === 'number'
      ? rawMeta.version
      : typeof raw.version === 'number'
        ? raw.version
        : 0;
  if (declared > SAVE_VERSION) return null; // 未来版本存档，本端不认，避免写坏别人的档

  const meta: MetaProfile = normalizeMeta({
    ...createMetaProfile(),
    ...(rawMeta as Partial<MetaProfile>)
  });

  let run: RunState | null = null;
  if (isObject(raw.run)) {
    run = raw.run as unknown as RunState;
  }

  let save: SaveGame = {
    meta,
    run,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    syncVersion: typeof raw.syncVersion === 'number' ? raw.syncVersion : 1,
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : createDeviceId()
  };

  if (declared < 1) save = migrateV0ToV1(save);
  if (declared < 2) save = migrateV1ToV2(save);
  if (declared < 3) save = migrateV2ToV3(save);
  if (declared < 4) save = migrateV3ToV4(save);
  if (declared < 5) save = migrateV4ToV5(save);
  if (declared < 6) save = migrateV5ToV6(save);
  if (declared < 7) save = migrateV6ToV7(save);
  if (declared < 8) save = migrateV7ToV8(save);
  if (declared < 9) save = migrateV8ToV9(save);
  if (declared < 10) save = migrateV9ToV10(save);
  if (declared < 11) save = migrateV10ToV11(save);
  if (declared < 12) save = migrateV11ToV12(save);
  if (declared < 13) save = migrateV12ToV13(save);
  return normalizeRun(save);
}

/**
 * 跨局存档的字段级兜底。
 *
 * 和 `normalizeRun` 同一个原则：任何来源（迁移产物 / 手改过的档 / 版本号撒谎的档）
 * 都要被整成"界面一定接得住"的形态。这里尤其重要的是 `codex` ——
 * 结算页要往它上面挂"本局新点亮 X 项"，一个 undefined 会让整个结算页崩掉。
 */
function normalizeMeta(meta: MetaProfile): MetaProfile {
  const codex = (isObject(meta.codex) ? meta.codex : {}) as Partial<Record<'items' | 'disasters' | 'npcs', unknown>>;
  const strList = (v: unknown): string[] =>
    asArray<unknown>(v).filter((x): x is string => typeof x === 'string');
  return {
    version: SAVE_VERSION,
    identityLevels: isObject(meta.identityLevels) ? (meta.identityLevels as Record<string, number>) : {},
    codex: {
      items: strList(codex.items),
      disasters: strList(codex.disasters),
      npcs: strList(codex.npcs)
    },
    bestSurvivalDays: isObject(meta.bestSurvivalDays)
      ? (meta.bestSurvivalDays as Record<string, number>)
      : {},
    bestSafeStreak:
      typeof meta.bestSafeStreak === 'number' && Number.isFinite(meta.bestSafeStreak)
        ? Math.max(0, Math.round(meta.bestSafeStreak))
        : 0
  };
}

/**
 * v12 → v13：M2 四件套（图鉴与 meta 闭环 / 安全感连击 / 白天事件 / 一次性的 meta 结算）。
 *
 * 四组字段全部补"空值"，而且**每一项都刻意不反推**：
 *
 *  ① `codex` 三页补空数组。老档走过的那几局**不给补记** ——
 *     图鉴的语义是"你在本端见过它"，而 M1 时期根本没有这个账本，
 *     凭空补一份等于告诉玩家他见过一些他从没见过的物资；
 *  ② `bestSafeStreak` 补 0。老档没有"安全感"这个概念，补 0 是诚实的；
 *  ③ `survival.safeStreak` 补 0（同上）；
 *  ④ `shopPriceFactor` 补 **1**（原价）而不是当天的物价倍率 ——
 *     老档的当日库存是按旧价生成的，突然乘一个 0.95 会让"存档里的价格"
 *     和"玩家昨天看到的价格"对不上。补 1 = 这一天的价格不因为迁移而变；
 *  ⑤ `shopLimits` / `dayEvent` 补空 / null；`metaSettled` 补 null。
 *
 *     ★ `metaSettled` 补 null 有一个**必须接受的后果**：一个正卡在 `ending`
 *     的老档读档之后会被重算一次 meta（发一次图鉴）。这是可接受的 ——
 *     他确实打完了那一局，而 M1 时代没有账本，所以那不是"重复发奖"，
 *     是"第一次发"。相对的，如果补成一个非 null 的值，老玩家会永远拿不到那一局的东西。
 */
export function migrateV12ToV13(save: SaveGame): SaveGame {
  const run = save.run;
  save.meta = normalizeMeta(save.meta);
  if (run) {
    run.shopPriceFactor = 1;
    run.shopLimits = [];
    run.shopBoughtToday = {};
    run.dayEvent = null;
    run.metaSettled = null;
    const survival = run.survival as unknown as Record<string, unknown> | undefined;
    if (survival && typeof survival.safeStreak !== 'number') survival.safeStreak = 0;
    const last = survival && isObject(survival.last) ? survival.last : null;
    if (last) {
      if (typeof last.emergencyId !== 'string') last.emergencyId = null;
      if (typeof last.emergencyResolved !== 'boolean') last.emergencyResolved = false;
      if (typeof last.emergencyLost !== 'number') last.emergencyLost = 0;
    }
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v11 → v12：顺手位（§5「应急货架（门口/最顺手位）」+ §6.3 的应急可达率）。
 *
 * 老档补 `null`，而且**刻意不替玩家指认**门口是哪块 —— 他还没做过那个选择。
 * 替他选就等于白送一份"应急可达率 100%"，而补完是 0% 才是诚实的：
 * 他确实没把药放在顺手位，因为他压根还没指认过顺手位。
 * （代价很小：进整理页点两下就补回来了。）
 */
export function migrateV11ToV12(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    for (const shelf of run.shelves) shelf.handyRank = null;
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v10 → v11：求援订单（§6.5）。
 *
 * 老档补 `null`。**刻意不动 `phase`** —— 老档不存在 `'help_request'` 这个值，
 * 所以补完 `null` 之后没有任何东西会卡住（真正的自愈在 `normalizeHelpRequest` 里，
 * 它同时挡住"手改出来的 `phase: 'help_request'` + 空订单"那种死胡同）。
 */
export function migrateV10ToV11(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) run.helpRequest = null;
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v9 → v10：结算页的口径修正。
 *
 * 两个新字段都补 0，而且**刻意不反推**：老档只记了"有几天短了口粮"，没记短了几件 ——
 * 拿天数硬估一个件数，只会编出一份假的精确。0 的意思是"这一局没进过账"，
 * 比一个编出来的数字诚实。
 */
export function migrateV9ToV10(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    if (typeof run.survival.shortagePieces !== 'number') run.survival.shortagePieces = 0;
    if (typeof run.survival.unreachablePieces !== 'number') run.survival.unreachablePieces = 0;
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v8 → v9：硬撑分档（§12.3 v0.6）。
 *
 * 连续天数补 0，这个选择是**保守的**：一个正卡在硬撑里的老档，读档后当天算"第 1 天"
 * （最轻的一档），而不是一个可能已经更重的档位。
 * 宁可让老玩家少受一点罚，也不要凭空给他一个"快垮了"。
 */
export function migrateV8ToV9(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    if (typeof run.survival.hardPressStreak !== 'number') run.survival.hardPressStreak = 0;
    if (typeof run.survival.lastTradeDay !== 'number') run.survival.lastTradeDay = NEVER_TRADED;
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v7 → v8：夜间事件的结果落盘（`NightState.applied`）。
 *
 * 老档补 `null`，而且**刻意不反推** —— 反推的素材只有"选项声明的数值"，
 * 而那恰恰是它要修的那个东西：一个兜里只有 25 元的人，当年那次"转他 80"实际只扣了 25，
 * 反推只会把假账再算一遍。
 *
 * `null` 的意思是"这一晚发生过什么已经不可考"，界面据此退化成不显示数值摘要。
 * 这只影响那些正好卡在夜里存下来的老档，代价可以接受。
 */
export function migrateV7ToV8(save: SaveGame): SaveGame {
  const run = save.run;
  if (run && run.night) run.night.applied = null;
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v6 → v7：M1 平衡改造。
 *
 * 只补默认值，**不动任何既有数据**：
 *  ① `survival.hardPressDays` 补 0 —— 老档走过的天数里没有"硬撑"这个概念；
 *  ② `outcome` 补 null。**刻意不反推已经结束的老档**：那些 `ending` 全部来自阶段 A
 *     （囤货期走完就结束），当时生存期还不存在，给它标 'survived' 等于凭空送一个纪录。
 *     结算页对 `outcome === null && phase === 'ending'` 有专门的说法（见 ui/EndingScreen.ts）。
 *
 * 结算快照的新字段（取用来源 / 劳作 / 补给 / 硬撑）不在这一层补 ——
 * 它们由 `normalizeRun` 统一兜底，因为手改过的档同样需要这层保护。
 */
export function migrateV6ToV7(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    if (typeof run.survival.hardPressDays !== 'number') run.survival.hardPressDays = 0;
    run.outcome = null;
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v5 → v6：新增 `survival`（生存期累计账）。
 * 老档补 0 —— 但要注意：如果老档的 `day` 已经落在生存期（阶段 A/B 时期 `ending` 的档
 * 不会是这样，手改过的档可能），补 0 意味着"过去几天的损耗没进账"。
 * 这是可接受的：那几天的消耗本来就没发生过（阶段 A/B 没有生存期结算）。
 */
export function migrateV5ToV6(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    run.survival = {
      spoiled: 0,
      shortageDays: 0,
      shortagePieces: 0,
      unreachablePieces: 0,
      hardPressDays: 0,
      hardPressStreak: 0,
      safeStreak: 0,
      lastTradeDay: NEVER_TRADED,
      last: { ...EMPTY_SURVIVAL_SNAPSHOT }
    };
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v4 → v5：新增 `night`（§6.2 夜间事件）。
 * 老档里没有"夜色"这个概念，补 `null`（= 今晚没事）。
 * **刻意不动 day 与 phase** —— 老玩家读档后仍站在原来的白天，只是今晚可能会遇上一次夜间事件。
 */
export function migrateV4ToV5(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) run.night = null;
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v3 → v4：M0 单页整理 → M1 囤货期。迁移做三件事，每一件都有明确理由：
 *
 * 1) 补 4 个囤货期字段（行动点 / 车载 / 当日库存 / 当日已访点位）。
 * 2) `day` 归一化。M0 把 `day` 恒写成 0 表示"整理中"，而 M1 的 0 是 **D-Day（灾难降临日）** ——
 *    若照搬，老玩家一读档就直接被判定"灾难已经降临"，会当场跳结算。
 *    故按"囤货期最后一天"(`-1`) 迁：整理的成果一件不丢，还能再采买一天，然后正常迎接 D-Day。
 * 3) 身份与现金落地。M0 的 `identityId: 'default'` / `cash: 0` 都是占位，
 *    `getIdentityDef('default')` 会抛异常；补成第一个真身份并按它的 startCash 发钱。
 */
export function migrateV3ToV4(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    if (!hasIdentityDef(run.identityId)) {
      const fallback = IDENTITY_DEFS[0];
      if (fallback) {
        run.identityId = fallback.id;
        if (!run.cash) run.cash = fallback.startCash;
      }
    }
    if (run.phase === 'organize' && run.day >= 0) run.day = -1;
    if (typeof run.actionPoints !== 'number') run.actionPoints = ACTION_POINTS_PER_DAY;
    if (typeof run.carLoad !== 'number') run.carLoad = 0;
    run.shopStocks = asArray(run.shopStocks);
    run.visitedShopIds = asArray(run.visitedShopIds);
    if (typeof run.currentShopId !== 'string') run.currentShopId = null;
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v2 → v3：M0 界面撤掉了"本区接收"这类规则声明。若保留存量规则，它仍会参与归位率计算，
 * 玩家会看到归位率莫名掉到 0%（而他明明没做过什么）。所以迁移时统一剥掉 autoAccept。
 * 字段本身留在 §7 的类型里，M1 生存期的自动取用要用时再启用。
 */
export function migrateV2ToV3(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    for (const zone of asArray<Zone>(run.zones)) {
      if (isObject(zone) && 'autoAccept' in zone) delete (zone as { autoAccept?: unknown }).autoAccept;
    }
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v1 → v2：待拆箱从 `ItemStack[][]` 升级为 `UnpackBox[]`。
 * 老档里箱子只有下标没有身份，迁移时按出现顺序补 `box_1..n` 与对应箱型 —— 内容一件不丢。
 */
export function migrateV1ToV2(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    const raw = asArray<unknown>(run.boxesToUnpack);
    run.boxesToUnpack = raw.map((box, index) => {
      if (Array.isArray(box)) {
        return {
          id: `box_${index + 1}`,
          defId: BOX_DEFS[index % BOX_DEFS.length]?.id ?? 'box_mixed',
          items: box as ItemStack[]
        } satisfies UnpackBox;
      }
      return box as UnpackBox;
    });
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

const PHASES: readonly GamePhase[] = [
  'prologue',
  'stockpile_shop',
  'organize',
  'night',
  'survival_day',
  'help_request',
  'ending'
];

/**
 * 收尾净化：把任何来源（迁移产物 / 被人手改过的档 / 版本号撒谎的档）整成"界面一定接得住"的形态。
 * 原则同 v2 时代：宁可退回新局，也不让 UI 崩在一个 undefined 上。
 */
function normalizeRun(save: SaveGame): SaveGame | null {
  if (!save.run) return save;
  const run = save.run;
  if (!Array.isArray(run.shelves) || !Array.isArray(run.zones) || !Array.isArray(run.boxesToUnpack)) {
    return { ...save, run: null };
  }
  run.zones = asArray(run.zones);
  normalizeShelves(run);
  run.log = asArray(run.log);
  run.trust = isObject(run.trust) ? (run.trust as Record<string, number>) : {};
  if (typeof run.seed !== 'number') run.seed = Date.now() >>> 0;
  // 兜底：任何非 UnpackBox 形态的箱（例如手改过的档）一律丢弃，宁可开新局也不让 UI 崩
  run.boxesToUnpack = asArray<unknown>(run.boxesToUnpack).filter(
    (box): box is UnpackBox => isObject(box) && typeof box.id === 'string' && Array.isArray(box.items)
  );

  // ———————— M1 囤货期字段 ————————
  if (!PHASES.includes(run.phase)) run.phase = 'stockpile_shop';
  if (typeof run.day !== 'number' || !Number.isFinite(run.day)) run.day = FIRST_STOCKPILE_DAY;
  run.day = Math.min(SURVIVAL_DAYS, Math.max(FIRST_STOCKPILE_DAY, Math.round(run.day)));
  if (typeof run.actionPoints !== 'number') run.actionPoints = ACTION_POINTS_PER_DAY;
  run.actionPoints = Math.max(0, Math.round(run.actionPoints));
  if (typeof run.carLoad !== 'number') run.carLoad = 0;
  run.carLoad = Math.max(0, run.carLoad);
  run.shopStocks = asArray<RunState['shopStocks'][number]>(run.shopStocks).filter(
    (s) => isObject(s) && typeof s.shopId === 'string' && Array.isArray(s.lines)
  );
  run.visitedShopIds = asArray<string>(run.visitedShopIds).filter((v) => typeof v === 'string');
  run.currentShopId = typeof run.currentShopId === 'string' ? run.currentShopId : null;

  // ———————— M2 白天事件（§6.2 / D-10） ————————
  // 物价倍率兜底成 1（原价）。手改出来的 0 或负数会让所有价格夹到 1 元，
  // 那比"贵"更糟 —— 它会让整条经济链失效而玩家看不出来。
  run.shopPriceFactor =
    typeof run.shopPriceFactor === 'number' && Number.isFinite(run.shopPriceFactor) && run.shopPriceFactor > 0
      ? run.shopPriceFactor
      : 1;
  run.shopLimits = asArray<unknown>(run.shopLimits).filter(
    (l): l is RunState['shopLimits'][number] =>
      isObject(l) && typeof l.shopId === 'string' && typeof l.category === 'string' && typeof l.max === 'number'
  );
  // 买入记账：只留合法的非负整数，坏值一律丢掉。
  // 它被手改大 = 玩家自己把限购调松了，那是他的存档；
  // 但一个字符串会让 `purchaseLimitOf` 算出 NaN，进而让整条购物车静态失效
  const boughtRaw = isObject(run.shopBoughtToday) ? run.shopBoughtToday : {};
  const bought: Record<string, number> = {};
  for (const [key, value] of Object.entries(boughtRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) bought[key] = Math.round(value);
  }
  run.shopBoughtToday = bought;
  normalizeDayEvent(run);

  // ———————— M1 夜间字段 ————————
  normalizeNight(run);

  // ———————— M1 求援订单（§6.5） ————————
  normalizeHelpRequest(run);

  // ———————— M1 生存期字段 ————————
  const survival = isObject(run.survival) ? (run.survival as Record<string, unknown>) : {};
  const last = isObject(survival.last) ? (survival.last as Record<string, unknown>) : {};
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  run.survival = {
    spoiled: typeof survival.spoiled === 'number' && survival.spoiled >= 0 ? Math.round(survival.spoiled) : 0,
    shortageDays:
      typeof survival.shortageDays === 'number' && survival.shortageDays >= 0 ? Math.round(survival.shortageDays) : 0,
    shortagePieces: Math.max(0, num(survival.shortagePieces)),
    unreachablePieces: Math.max(0, num(survival.unreachablePieces)),
    hardPressDays:
      typeof survival.hardPressDays === 'number' && survival.hardPressDays >= 0
        ? Math.round(survival.hardPressDays)
        : 0,
    hardPressStreak:
      typeof survival.hardPressStreak === 'number' && survival.hardPressStreak >= 0
        ? Math.round(survival.hardPressStreak)
        : 0,
    safeStreak:
      typeof survival.safeStreak === 'number' && survival.safeStreak >= 0 ? Math.round(survival.safeStreak) : 0,
    // 它可以是负数（没换过时是 -99），所以不夹 ≥ 0
    lastTradeDay: typeof survival.lastTradeDay === 'number' ? Math.round(survival.lastTradeDay) : NEVER_TRADED,
    last: {
      health: num(last.health),
      mood: num(last.mood),
      stamina: num(last.stamina),
      shelter: num(last.shelter),
      shortage: Math.max(0, num(last.shortage)),
      spoiled: Math.max(0, num(last.spoiled)),
      fromShelves: Math.max(0, num(last.fromShelves)),
      fromBoxes: Math.max(0, num(last.fromBoxes)),
      unreachable: Math.max(0, num(last.unreachable)),
      workCost: Math.max(0, num(last.workCost)),
      hardPress: last.hardPress === true,
      hardPressLevel:
        last.hardPressLevel === 'straining' ||
        last.hardPressLevel === 'failing' ||
        last.hardPressLevel === 'collapsing'
          ? last.hardPressLevel
          : 'none',
      usedMedicine: Math.max(0, num(last.usedMedicine)),
      usedWarmth: Math.max(0, num(last.usedWarmth)),
      // 认不出来的突发事件退化成"今天没事" —— 事件表被改过名字时，
      // 宁可少显示一条旧叙事，也不要让日报去查一个不存在的 id
      emergencyId: typeof last.emergencyId === 'string' && findEmergency(last.emergencyId) ? last.emergencyId : null,
      emergencyResolved: last.emergencyResolved === true,
      emergencyLost: Math.max(0, num(last.emergencyLost))
    }
  };

  // ———————— 结局 ————————
  run.outcome = run.outcome === 'survived' || run.outcome === 'collapsed' ? run.outcome : null;

  // ———————— M2 跨局结算（§6.7 图鉴 / §9.6） ————————
  // `metaSettled` 只在真的结算过时才算数：`at` 不是数字 = 没记过（或被手改坏了）
  run.metaSettled =
    isObject(run.metaSettled) &&
    typeof (run.metaSettled as { at?: unknown }).at === 'number' &&
    ((run.metaSettled as { outcome?: unknown }).outcome === 'survived' ||
      (run.metaSettled as { outcome?: unknown }).outcome === 'collapsed')
      ? {
          at: (run.metaSettled as { at: number }).at,
          outcome: (run.metaSettled as { outcome: 'survived' | 'collapsed' }).outcome
        }
      : null;

  // 状态一致性：day 已经走到灾难日（>= 0），就不该还停在囤货期的三个界面上，
  // 否则玩家点"过一天"会原地打转，而且永远见不到 D-Day。
  // 修正方向是**把玩家带进生存期**而不是直接结束 —— 囤货期的成果货架全都还在，
  // 凭空结束掉是对玩家最差的处理。
  if (run.day >= 0 && (run.phase === 'stockpile_shop' || run.phase === 'organize' || run.phase === 'night')) {
    run.phase = run.day > SURVIVAL_DAYS ? 'ending' : 'survival_day';
    run.night = null;
  }
  // 自愈：健康已经归零却还停在生存期界面上（结算后被杀进程、或手改过的档）→ 补上结局。
  // 不补的话玩家会看到一个"还能继续点、但怎么点都活不回来"的死局。
  if (run.phase === 'survival_day' && run.stats.health <= 0) {
    run.phase = 'ending';
    if (run.outcome !== 'survived') run.outcome = 'collapsed';
  }
  // 不需要额外处理"撑过头"的档：上面那行已经把 day 夹在 ≤ SURVIVAL_DAYS，
  // 所以 `survival_day` 这个 phase 下不可能出现 day > 7。
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * 夜色的自愈。这个函数存在的唯一理由是：**夜是没有出口的死胡同，坏档会把人永远关在里面**
 * （UI 上没有"跳过夜晚"的按钮，玩家只能做选择才能跨天）。
 * 所以三种坏法都必须被拦住：
 *
 *  ① `phase === 'night'` 但 `night` 空 → 清掉夜色，退回白天（可以继续采买）；
 *  ② `night.eventId` 在当前事件表里找不到（事件被删/改名）→ 同上；
 *  ③ `choice` 不是合法值（越界下标 / 事件选项数变了）→ 退成 `null`（重新选），而不是清掉整个夜晚。
 * 反过来，**不在夜里却留着 night** → 也清掉，否则下次入夜会读到上一晚的残影。
 */
function normalizeNight(run: RunState): void {
  const raw = run.night;
  const eventId = isObject(raw) && typeof raw.eventId === 'string' ? raw.eventId : '';
  const def = findNightEvent(eventId);

  if (run.phase !== 'night' || !def) {
    run.night = null;
    // 在夜里却没事件可放 → 绝不能留在 night 这个 phase 上
    if (run.phase === 'night') run.phase = 'stockpile_shop';
    return;
  }

  const rawChoice = (raw as { choice?: unknown }).choice;
  let choice: number | null = null;
  if (typeof rawChoice === 'number' && Number.isInteger(rawChoice)) {
    const legal = rawChoice === NIGHT_SLEEP || (rawChoice >= 0 && rawChoice < def.options.length);
    choice = legal ? rawChoice : null;
  }
  // applied 只在"已经决定过"的时候才有意义；还没选的时候留着上一晚的残影会显示错摘要
  run.night = {
    eventId: def.id,
    choice,
    applied: choice === null ? null : normalizeApplied((raw as { applied?: unknown }).applied)
  };
}

/**
 * 货架的字段级兜底（目前只有 `handyRank`）。
 *
 * 顺手位**全屋唯一**（§12.3 v0.7.1）：手改过的档可能出现两块都标 1、或标出超出
 * `HANDY_SLOTS` 的顺位 —— 这里按原顺位重排一次 1..n，把多余的降回普通货架。
 */
function normalizeShelves(run: RunState): void {
  const ranked: Shelf[] = [];
  for (const shelf of run.shelves) {
    const raw = (shelf as { handyRank?: unknown }).handyRank;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= HANDY_SLOTS) {
      shelf.handyRank = raw;
      ranked.push(shelf);
    } else {
      shelf.handyRank = null;
    }
  }
  ranked
    .sort((a, b) => (a.handyRank ?? 0) - (b.handyRank ?? 0))
    .forEach((shelf, i) => {
      shelf.handyRank = i < HANDY_SLOTS ? i + 1 : null;
    });
}

/**
 * 门口那一单的自愈。
 *
 * 它和夜色是**同一类问题**：`phase === 'help_request'` 是一个没有出口的房间 ——
 * 界面上只有「凑单」和「婉拒」两个按钮，而两个都要求"门口真的站着人"。
 * 所以两种坏法都必须被拦住：
 *
 *  ① `phase === 'help_request'` 但订单空 / 认不出来 → 退回日报（否则玩家被永远关在门口）；
 *  ② 不在门口却留着订单 → 清掉，否则明天的日报会读到今天这一单的残影。
 */
function normalizeHelpRequest(run: RunState): void {
  const raw = run.helpRequest;
  const defId = isObject(raw) && typeof raw.defId === 'string' ? raw.defId : '';
  const def = findHelpRequestDef(defId);

  if (run.phase !== 'help_request' || !def) {
    run.helpRequest = null;
    if (run.phase === 'help_request') run.phase = 'survival_day';
    return;
  }

  run.helpRequest = { defId: def.id };
}

/**
 * 白天事件的自愈。
 *
 * 与夜色、门口那一单是**同一类问题**：`dayEvent` 非空时界面只画事件、不画货架，
 * 所以一个认不出来的 `dayEvent` 会把玩家永久关在一段没有文字的文案前面。
 * 三种坏法全部拦住：
 *
 *  ① `defId` 在事件表里找不到（事件被删/改名）→ 清掉，回到货架；
 *  ② `choice` 是越界下标 / 选项数变了 → 退成 `null`（重新选），而不是清掉整件事；
 *  ③ `applied` 只在"已经决定过"时有意义，否则会显示上一件事的摘要。
 *
 * 还有一条 `dayEvent` 独有的：它只在**站在某家店门口**时才有意义。
 * 不在 `stockpile_shop`、或 `currentShopId` 是空的 → 清掉。
 */
function normalizeDayEvent(run: RunState): void {
  const raw = run.dayEvent;
  const defId = isObject(raw) && typeof raw.defId === 'string' ? raw.defId : '';
  const def = findDayEvent(defId);
  const shopId = isObject(raw) && typeof raw.shopId === 'string' ? raw.shopId : '';
  const standing = run.phase === 'stockpile_shop' && typeof run.currentShopId === 'string';
  const sameShop = standing && run.currentShopId === shopId;

  if (!def || !sameShop) {
    run.dayEvent = null;
    return;
  }

  const rawChoice = (raw as { choice?: unknown }).choice;
  let choice: number | null = null;
  if (typeof rawChoice === 'number' && Number.isInteger(rawChoice) && rawChoice >= 0 && rawChoice < def.options.length) {
    choice = rawChoice;
  }
  run.dayEvent = {
    defId: def.id,
    shopId,
    choice,
    applied: choice === null ? null : normalizeDayApplied((raw as { applied?: unknown }).applied)
  };
}

/**
 * 把白天事件的实际后果收成合法形状。
 *
 * 与 `normalizeApplied` 同一条纪律：**坏掉时退化成 0，绝不拿选项声明的数值去补** ——
 * 那正是 `NightState.applied` 存在的理由（见 v7 → v8 的注释）。
 */
function normalizeDayApplied(raw: unknown): DayEffectApplied | null {
  if (!isObject(raw)) return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  return {
    cash: num(raw.cash),
    priceUp: typeof raw.priceUp === 'number' && Number.isFinite(raw.priceUp) ? raw.priceUp : 0,
    stockCut: asArray<unknown>(raw.stockCut).filter(
      (c): c is DayEffectApplied['stockCut'][number] =>
        isObject(c) && typeof c.shopId === 'string' && typeof c.itemId === 'string' && typeof c.count === 'number'
    ),
    limits: asArray<unknown>(raw.limits).filter(
      (l): l is DayEffectApplied['limits'][number] =>
        isObject(l) && typeof l.shopId === 'string' && typeof l.category === 'string' && typeof l.max === 'number'
    ),
    stamina: num(raw.stamina),
    mood: num(raw.mood),
    gotBox: raw.gotBox === true,
    boxName: typeof raw.boxName === 'string' ? raw.boxName : '',
    visitLost: raw.visitLost === true
  };
}

/**
 * 把存档里的 `applied` 收成合法形状。
 *
 * 它只是"昨晚实际发生了什么"的一份缓存，坏掉时退化成 `null` 就够了。
 * **不要**在它为空的时侯拿选项声明的数值去补 —— 那正是这个字段存在的理由（见 v7 → v8 的注释）。
 */
function normalizeApplied(raw: unknown): AppliedEffect | null {
  if (!isObject(raw)) return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  return {
    cash: num(raw.cash),
    health: num(raw.health),
    mood: num(raw.mood),
    stamina: num(raw.stamina),
    shelter: num(raw.shelter),
    gotBox: raw.gotBox === true
  };
}

/** v0（无 version 字段的裸档）→ v1：补齐 seed / stats / 订单计数等 */
export function migrateV0ToV1(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    if (typeof run.seed !== 'number') run.seed = save.savedAt >>> 0;
    if (!isObject(run.stats)) {
      run.stats = { health: 100, mood: 70, stamina: 100, shelter: 100 };
    }
    if (typeof run.deliveredOrders !== 'number') run.deliveredOrders = 0;
    if (!run.phase) run.phase = 'organize';
    if (typeof run.day !== 'number') run.day = 0;
    if (!run.identityId) run.identityId = 'default';
    if (!run.disasterId) run.disasterId = 'cold_snap';
    if (typeof run.cash !== 'number') run.cash = 0;
    run.zones = asArray<RunState['zones'][number]>(run.zones);
    run.log = asArray<string>(run.log);
    run.boxesToUnpack = asArray<RunState['boxesToUnpack'][number]>(run.boxesToUnpack);
  }
  save.meta = { ...createMetaProfile(), ...save.meta };
  save.meta.version = SAVE_VERSION;
  return save;
}

export function serialize(save: SaveGame): string {
  return JSON.stringify(save);
}

export function deserialize(raw: string | null): SaveGame | null {
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadSave(storage: StorageLike = resolveStorage()): SaveGame | null {
  return deserialize(storage.getItem(STORAGE_KEY));
}

export function writeSave(save: SaveGame, storage: StorageLike = resolveStorage()): void {
  try {
    storage.setItem(STORAGE_KEY, serialize(save));
  } catch {
    // 配额满/隐私模式：静默失败，内存态继续玩，不打断
  }
}

export function clearSave(storage: StorageLike = resolveStorage()): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 落盘调度器：合并 300ms 内的连续动作成一次写盘，同时提供 flush()
 * 给 pagehide/visibilitychange 用 —— 关标签页那一刻也必须无损。
 */
export interface SaveScheduler {
  schedule(save: SaveGame): void;
  flush(): void;
  dispose(): void;
  readonly pending: boolean;
}

export function createSaveScheduler(
  storage: StorageLike = resolveStorage(),
  delayMs: number = SAVE_DEBOUNCE_MS
): SaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty: SaveGame | null = null;

  const writeNow = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (dirty) {
      writeSave(dirty, storage);
      dirty = null;
    }
  };

  return {
    schedule(save) {
      dirty = save;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(writeNow, delayMs);
    },
    flush: writeNow,
    dispose() {
      writeNow();
    },
    get pending() {
      return dirty !== null;
    }
  };
}

export { createMemoryStorage };
