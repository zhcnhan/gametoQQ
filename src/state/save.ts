/**
 * 存档读写（§4A：每个动作完成即写 localStorage，debounce ≤ 300ms）。
 *
 * 职责边界：
 *  - 只负责"序列化 / 校验 / 迁移 / 落盘节流"，不认识任何玩法规则；
 *  - 不直接摸 window，介质由 state/storage.ts 注入。
 */
import { BOX_DEFS } from '../data/boxes';
import { hasItemDef } from '../data/items';
import { findDayEvent, hasDayEvent } from '../data/dayEvents';
import { FIRST_STOCKPILE_DAY, M1_DISASTER_ID, SURVIVAL_DAYS, hasDisasterDef } from '../data/disaster';
import { findEmergency, hasEmergency } from '../data/emergencies';
import { IDENTITY_DEFS, hasIdentityDef } from '../data/identities';
import { findHelpRequestDef } from '../data/helpRequests';
import { NIGHT_SLEEP, findNightEvent, hasNightEvent } from '../data/nightEvents';
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
  Zone,
  EventHistory
} from '../model/types';
import { HANDY_SLOTS } from '../model/shelf';
import { EVENT_HISTORY_KEEP } from '../model/types';
import { emptyEventHistory } from '../systems/setup';
import { sanitizeIdentityLevels, clampIdentityLevel } from '../data/identityLevels';
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
 *  - v14：事件近期记录 —— `RunState.eventHistory`（夜间 / 求援 / 白天 / 突发事件各留最近 4 条）。
 *        它解决的是 M2 走测反馈的"同一个 NPC 隔天又问同一件事"：求援池 6 单、每天 45%、
 *        均匀随机 → 同一个 NPC 前后两次问同一件事的概率是 50%。
 *  - v15：手里那件物资落盘（`RunState.held` / `heldFrom`）——
 *        修掉"手里拿着东西时刷新页面，这件物资凭空消失"。
 *  - v16：M3 第 2 步「成就系统」（§10B.2）——
 *        ① `MetaProfile` 增加 `achievements`（已解锁 id）、`totalShelved`（生涯累计上架件数）、
 *           `everBoughtItemIds`（生涯买过的物资，成就「先见之明」唯一的埋点增量）；
 *        ② `SurvivalState` 增加 `cleanDays` / `minStamina` / `emergencyHurtCount` ——
 *           三条成就的判据需要"整局一直怎样"，而快照只回答"最后一天怎样"。
 *  - v17：M3 第 3 步「身份熟练度」（§10B.3）—— `RunState` 增加 `identityLevel`
 *        （这一局用的等级，开局时从 `meta.identityLevels` **快照**下来）。
 *        老档补 **1**，那正好是它们当时的真实情况（那时还没有等级这回事）。
 */
export const SAVE_VERSION = 18;
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
    bestSafeStreak: 0,
    survivedRuns: 0,
    achievements: [],
    totalShelved: 0,
    everBoughtItemIds: []
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
  if (declared < 14) save = migrateV13ToV14(save);
  if (declared < 15) save = migrateV14ToV15(save);
  if (declared < 16) save = migrateV15ToV16(save);
  if (declared < 17) save = migrateV16ToV17(save);
  if (declared < 18) save = migrateV17ToV18(save);
  return normalizeRun(save);
}

/**
 * v16 → v17：M3 第 3 步「身份熟练度」（§10B.3）—— `RunState.identityLevel`。
 *
 * ## 为什么补 1 而不是"按 meta 现算一遍"
 *
 * 老档在那个时刻**用的就是 1 级**：`identityLevels` 那时还从来没有写入方
 * （它是 M0 就存在、一直空转的字段），所以每一个老档的熟练度都是 1。
 * 补 1 = 说真话。
 *
 * ★ 而"按 `meta.identityLevels` 现算"在这里是**错的**，有两个具体理由：
 *  ① 那时那张表必然是空的，算出来也是 1 —— 多写一段代码得到同一个结果；
 *  ② 更要紧的是**语义**：`identityLevel` 是"这一局用的等级"的**快照**。
 *     按 meta 现算等于把一个"当时的事实"换成一个"现在算出来的数" ——
 *     而两者会在玩家后来练高熟练度之后**分叉**（旧档会被追认成高等级，
 *     于是同一份存档的历史变了）。快照一旦能被追溯修改，它就不是快照了。
 */
export function migrateV16ToV17(save: SaveGame): SaveGame {
  const run = save.run;
  if (run && typeof run.identityLevel !== 'number') run.identityLevel = 1;
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v17 → v18：M3 第 7 步「解锁系统」（§10.2.1 第四层）。
 *
 * ## 老档补的是 `survivedRuns: 0`，而这是一个**会让玩家少拿东西**的选择

 * 值得说清为什么还是这么补：
 *
 *  · `bestSurvivalDays` 那张表**不能**用来反推"活过几次"。
 *    它记的是**每一场灾难的最好成绩**，而"活过几次"是一个**计数** ——
 *    两者在"纪录被刷新"时会分家：原来活过 3 次、最长 12 天；
 *    这次活到 14 天但只多了一次。从纪录反推只会得到一个瞎猜的数；
 *  · 反推的另一个问题是**它对不上玩家的记忆**。玩家记得自己"活过好几次"，
 *    而我们从纪录里推出一个 2 —— 于是他看到"再活到最后一次就解锁"
 *    这句话，却发现没有任何变化。**一个撒谎的进度比一个归零的进度更坏**；
 *  · 补 0 的代价是**具体且一次性的**：一个老玩家要再活到最后一次
 *    才能看到第二个身份。而这个项目在 v18 之前**根本没有解锁功能** ——
 *    也就是说"他本来就没有解锁过任何东西"，补 0 是**说真话**。
 *
 * ★ 这与 `migrateV16ToV17` 补 `identityLevel: 1` 是同一条纪律：
 * **补的值必须等于"那个时刻真实发生的事"**，而不是"现在能算出什么"。
 */
export function migrateV17ToV18(save: SaveGame): SaveGame {
  if (typeof save.meta.survivedRuns !== 'number' || !Number.isFinite(save.meta.survivedRuns)) {
    save.meta.survivedRuns = 0;
  }
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v15 → v16：M3 第 2 步「成就系统」（§10B.2）。
 *
 * ## 老档补的都是"空"，而且**每一项都不反推** —— 但每一项的理由不一样
 *
 *  · `meta.achievements` 补空。**绝不反推**：M3 之前根本没有成就这个账本，
 *    而其中好几条的判据（比如「罐头鉴赏家」要"点亮全部 canned"）在老档上
 *    其实**真的成立**。反推的话，一个从没听说过成就的玩家会在读档那一刻
 *    收到一堆解锁 —— 那不是在奖励他，那是在告诉他"你之前那些局白打了"。
 *    成就的语义是"你在**有账本之后**做到了"，与图鉴同一条口径；
 *  · `totalShelved` 补 0（同上）。它不反推还有第二个理由：反推要遍历
 *    老档的全部货架去数件数，而那数出来的是"**现在**有多少"，
 *    不是"生涯上架过多少"——**那是个错的数**，错的数比没有数更糟；
 *  · `everBoughtItemIds` 补空（同上）。
 *
 * ## `SurvivalState` 的三个累计值：跟着 `normalizeRun` 一起补
 *
 * `cleanDays` / `minStamina` / `emergencyHurtCount` 在 `normalizeRun` 里补默认值
 * （`0` / `100` / `0`），所以这里不用重复处理 —— 那条路径**所有**版本的档都会走。
 * 刻意不在这里也写一遍：两份补值逻辑迟早会漂（§2.8）。
 *
 * ★ 老档正卡在 `ending` 时会怎样：`metaSettled` 已经非空，所以 `settleRunMeta`
 * 会直接返回 null、不重发图鉴 —— **但成就要在那一刻补判一次**。
 * 这是刻意的：一个 M3 之前打完的档，它的成果确实达到了某些成就的条件，
 * 而"补发"在这里是对的（成就与图鉴不同：图鉴要"见过"这个动作，
 * 而成就的判据是**从这一局的账里算出来的**，账还在，算得出来就该认）。
 * 代价是这些老档会一次性收到若干解锁 —— 演出会告诉玩家发生了什么，不会静默。
 */
export function migrateV15ToV16(save: SaveGame): SaveGame {
  save.meta = normalizeMeta(save.meta);
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v13 → v14：事件近期记录（`RunState.eventHistory`）。
 *
 * 老档补成空的四类数组。**刻意不反推**：老档的 log 里确实留着"哪一晚出了哪件事"，
 * 拿它去补一份"最近 4 条"看起来可行，但那是**另一种语义的账**——
 * log 记的是发生过什么，这份记的是"抽签时要避开什么"，而老档的那几天早就过去了。
 * 补空数组的效果是老档头几次抽取不避开任何东西，这没有代价。
 */
export function migrateV13ToV14(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) run.eventHistory = emptyEventHistory();
  save.meta.version = SAVE_VERSION;
  return save;
}

/**
 * v14 → v15：**手里那件物资开始落盘**。
 *
 * ## 为什么改这个（这是一个真数据丢失 bug）
 *
 * "手里正捏着的那件"原来只活在内存（`OrganizeSession`），而"拿起来"会把物资
 * **从格子/箱子里移走** —— 于是拿起来之后刷新页面：
 *
 *     格子里没有了 ＋ 会话没了 = **那件物资凭空消失**
 *
 * 这直接违反本项目的核心承诺"杀进程损失 = 0"，也与 §4A 写明的
 * "整理到一半的状态完整保留（手里捏着的物资回到原位即可）"不符。
 * 玩家报的原话是"手里拿着东西时刷新页面，这件物资会丢"。
 *
 * ## 迁移策略：补空
 *
 * 老档没有这个字段，补 `null` + `{ kind: 'none' }`。
 * **刻意不反推**：老档里"玩家当时手里有没有东西"这个信息**根本没有被记录过**，
 * 所以补空是唯一诚实的选择（凭空补一件物资等于发道具）。
 * 代价是：一个"正拿着东西"的老档读了之后手是空的 —— 但老档在那个瞬间
 * 本来就会丢件（那就是这个 bug），所以迁移不会让情况变坏。
 */
export function migrateV14ToV15(save: SaveGame): SaveGame {
  const run = save.run;
  if (run) {
    run.held = null;
    run.heldFrom = { kind: 'none' };
  }
  save.meta.version = SAVE_VERSION;
  return save;
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
    identityLevels: sanitizeIdentityLevels(meta.identityLevels),
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
        : 0,
    /*
     * 活到最后的累计次数（v18）。与 `totalShelved` 一样是**计数**，
     * 所以清洗方式也相同：非数字/负数/NaN 一律补 0，不反推。
     */
    survivedRuns:
      typeof meta.survivedRuns === 'number' && Number.isFinite(meta.survivedRuns)
        ? Math.max(0, Math.round(meta.survivedRuns))
        : 0,
    // 成就（v16）：三件都补"空"，而且**每一项都刻意不反推**，理由与 codex 那句相同 ——
    // 老档走过的局没有这个账本，凭空补一份等于告诉玩家他达成过一些他从没达成过的事
    achievements: strList(meta.achievements),
    totalShelved:
      typeof meta.totalShelved === 'number' && Number.isFinite(meta.totalShelved)
        ? Math.max(0, Math.round(meta.totalShelved))
        : 0,
    everBoughtItemIds: strList(meta.everBoughtItemIds)
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
      // v16 的三个累计值：这一处是"从更早的版本一路补上来"的路径，
      // 默认值必须与 `systems/setup.ts` 的开局值一致（否则同一种状态会有两个真值）
      cleanDays: 0,
      minStamina: 100,
      emergencyHurtCount: 0,
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

  /*
   * ———————— ★★ 三个 id 与"箱内物资"的校验（压测逼出来的） ————————
   *
   * `scripts/stress.mjs` 的 S3（存档破坏）报了 100+ 种**"读档成功、玩两步就崩"**：
   * 按报错文本归因，绝大多数只来自四处 ——
   *
   *     x32  未知物资 id    at getItemDef      ← 箱内 / 货架上有一个不认识的 itemId
   *     x32  未知灾难 id    at getDisasterDef  ← run.disasterId 不认识
   *     x16  未知身份 id    at getIdentityDef  ← run.identityId 不认识
   *     x5   Cannot read … 'map'  at cloneShelf ← 货架结构坏了
   *
   * 这三个 `getXxxDef` 对未知 id **抛异常**（这是对的：程序内部的错要响），
   * 所以**从存档读进来的 id 必须先问一句认不认识** ——
   * 项目本来就有 `hasItemDef` / `hasIdentityDef` / `hasDayEvent` 这套，
   * 夜里、白天事件、求援单都做了，只有这三处漏了。
   *
   * 处理口径与既有的 `normalizeHelpRequest` 一致：**认不出就退回一个安全值**
   * （身份回退到第一个真身份、灾难回退到 M1 的寒潮），
   * 而不是让玩家卡在一个一读就炸的档上。宁可开新局，也不给一个"读得进去、玩不了"的档。
   */
  if (!hasDisasterDef(run.disasterId)) run.disasterId = M1_DISASTER_ID;
  if (!hasIdentityDef(run.identityId)) {
    const fallback = IDENTITY_DEFS[0];
    if (fallback) run.identityId = fallback.id;
  }
  /*
   * §10B.3 的熟练度等级：夹到 1~3。
   *
   * 与身份 id 那条同一个道理 —— 一个手改过的档可能写着 `identityLevel: 99`，
   * 而它会被 `LEVEL_BONUS_PER_STEP` 直接乘进去（99 级 = 开局多拿 3920 元、
   * 车载 +294kg，那一局直接把三约束全废掉）。所以**读进来的那一份也要夹**，
   * 与运行期写入用同一个区间（`clampIdentityLevel` 是唯一的定义处）。
   */
  run.identityLevel = clampIdentityLevel(run.identityLevel);
  /*
   * 四维：**重建**成"四个 0..100 的有限数"。
   *
   * 压测抓到两种坏法，都是"读档成功、玩两步就崩"：
   *  · 整个 `stats` 对象缺失 → 任何读它的地方直接 `Cannot read properties of undefined`；
   *  · `stats` 里是字符串 / NaN / 999 → 结算一路带着它，四维被污染成 999。
   *
   * 运行期的写入本来就有 `clamp(…, 0, 100)`（见 `systems/survival.ts`），
   * 所以这里只是把"从存档进来的那一份"也拉到同一个范围 —— 与运行期口径一致，
   * 不是新增一套规则。缺失字段的回落取**开局的四维**（`createStartingRun` 的
   * `{ health: 100, mood: 70, stamina: 100, shelter: 100 }`）——
   * 用"别的数字"就等于凭空发明一套新规则。
   */
  const rawStats = isObject(run.stats) ? (run.stats as Record<string, unknown>) : {};
  const stat = (key: string, fallback: number): number => {
    const v = rawStats[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fallback;
  };
  run.stats = {
    health: stat('health', 100),
    mood: stat('mood', 70),
    stamina: stat('stamina', 100),
    shelter: stat('shelter', 100)
  };
  /*
   * 现金与信任值也要拉回合法范围。
   *
   * 压测报了两条同源发现：手改过的档能让 `run.cash` 变成 NaN 或负数、
   * 让 `run.trust.npc_xxx` 变成 NaN —— 之后**每一次结算都带着它**（现金为负 -50 出现了 172 次）。
   * 运行期的写入本来就有下限（"不给人欠债，M1 不做负债玩法"），
   * 这里只是把从存档进来的那一份也拉回同一口径；认不出的信任值直接丢掉。
   */
  if (typeof run.cash !== 'number' || !Number.isFinite(run.cash)) run.cash = 0;
  run.cash = Math.max(0, Math.round(run.cash));
  const rawTrust = isObject(run.trust) ? (run.trust as Record<string, unknown>) : {};
  const trust: Record<string, number> = {};
  for (const [npcId, value] of Object.entries(rawTrust)) {
    if (typeof value === 'number' && Number.isFinite(value)) trust[npcId] = Math.max(0, Math.round(value));
  }
  run.trust = trust;
  /** 认不出的物资：从箱内剔除（保留箱子本身，玩家还能拆剩下的） */
  for (const box of run.boxesToUnpack) {
    box.items = asArray<unknown>(box.items).filter(
      (st): st is ItemStack => isObject(st) && typeof st.itemId === 'string' && hasItemDef(st.itemId)
    );
  }
  /**
   * 货架：认不出的物资摘掉、坏掉的尺寸与行结构补齐。
   *
   * 压测报了 `货架 a slots 行数 0 ≠ h=undefined` —— 手改过的档可以让 `w` / `h` 变成
   * 非数字甚至丢失，而 `slots` 的形状与它们不匹配。所有读写都要遍历 `slots`，所以
   * **形状不一致就会在深处炸**（`cloneShelf` 对它 `.map` 那一条就是这么来的）。
   *
   * 处理：从 `slots` 的**实际形状**反推 `w` / `h`（而不是相信那两个字段），
   * 再按它重建出一块规整的货架 —— 物资该留的留下、认不出的摘掉。
   * 不丢弃整块货架：丢掉它等于把玩家的东西一起扔掉。
   */
  run.shelves = run.shelves.filter((shelf): shelf is Shelf => isObject(shelf) && Array.isArray(shelf.slots));
  for (const shelf of run.shelves) {
    const srcRows = asArray<unknown>(shelf.slots);
    const w = srcRows.reduce((n: number, row) => Math.max(n, asArray<unknown>(row).length), 0);
    const h = srcRows.length;
    if (w <= 0 || h <= 0) {
      // 完全空的货架：给一个最小可用尺寸，至少不会在遍历时炸
      shelf.w = Number.isInteger(shelf.w) && shelf.w > 0 ? shelf.w : 1;
      shelf.h = Number.isInteger(shelf.h) && shelf.h > 0 ? shelf.h : 1;
      shelf.slots = Array.from({ length: shelf.h }, () =>
        Array.from({ length: shelf.w as number }, () => ({ stack: null }))
      );
      continue;
    }
    const fixed: Shelf['slots'] = [];
    for (let r = 0; r < h; r++) {
      const rawRow = asArray<unknown>(srcRows[r]);
      const row: Shelf['slots'][number] = [];
      for (let c = 0; c < w; c++) {
        const raw = rawRow[c];
        const slot = isObject(raw) ? raw : {};
        const stack = (slot as { stack?: unknown }).stack;
        const good =
          isObject(stack) && typeof stack.itemId === 'string' && hasItemDef(stack.itemId) && Array.isArray(stack.batches);
        row.push({ stack: good ? (stack as unknown as ItemStack) : null });
      }
      fixed.push(row);
    }
    shelf.w = w;
    shelf.h = h;
    shelf.slots = fixed;
  }

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

  /*
   * ———————— v15：手里那件物资 ————————
   *
   * 两条兜底，都是"宁可手空着，也不许界面或算法读到半截数据"：
   *  ① `held` 必须是能认出来的堆（有 itemId + batches 数组），否则丢弃；
   *     它的形状与 `ItemStack` 一致，界面对它的用法与格子里那件完全一样；
   *  ② `heldFrom` 必须是三种已知形态之一，否则退回 `{ kind: 'none' }` ——
   *     来处不明只会让"拖拽时判不判互换"保守一点，不会丢件。
   *
   * 注意**不做"来处还在不在"的校验**：那件事交给 `systems/organize.ts` 的
   * `restoreOrganizeSession()`。存档层不认识货架与箱子的语义（见文件头的职责边界）。
   */
  const heldRaw: unknown = run.held;
  run.held =
    isObject(heldRaw) && typeof heldRaw.itemId === 'string' && Array.isArray(heldRaw.batches)
      ? (heldRaw as unknown as ItemStack)
      : null;
  const fromRaw: unknown = run.heldFrom;
  const from = isObject(fromRaw) ? (fromRaw as { kind?: unknown; shelfId?: unknown; boxId?: unknown; pos?: unknown }) : null;
  if (!run.held) {
    run.heldFrom = { kind: 'none' };
  } else if (from?.kind === 'box' && typeof from.boxId === 'string') {
    run.heldFrom = { kind: 'box', boxId: from.boxId };
  } else if (from?.kind === 'shelf' && typeof from.shelfId === 'string' && isObject(from.pos)) {
    const pos = from.pos as { row?: unknown; col?: unknown };
    run.heldFrom = {
      kind: 'shelf',
      shelfId: from.shelfId,
      pos: { row: Math.max(0, Math.round(Number(pos.row) || 0)), col: Math.max(0, Math.round(Number(pos.col) || 0)) }
    };
  } else {
    run.heldFrom = { kind: 'none' };
  }

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

  // ———————— M2 事件近期记录（v14） ————————
  // 只留**认得出的 id**：事件表改过名字之后，一条陈旧的 id 会让"避开它"永远不生效
  // （那条事件现在叫别的名字了），而"记录里有一个不存在的 id"本身也没人会发现
  const historyRaw = (isObject(run.eventHistory) ? run.eventHistory : {}) as Partial<
    Record<keyof EventHistory, unknown>
  >;
  const strList = (v: unknown, known: (id: string) => boolean): string[] =>
    asArray<unknown>(v)
      .filter((x): x is string => typeof x === 'string' && known(x))
      .slice(0, EVENT_HISTORY_KEEP);
  run.eventHistory = {
    night: strList(historyRaw.night, hasNightEvent),
    help: strList(historyRaw.help, (id) => findHelpRequestDef(id) !== null),
    day: strList(historyRaw.day, hasDayEvent),
    emergency: strList(historyRaw.emergency, hasEmergency)
  };

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
    /*
     * v16 的三个累计值。它们的默认值必须**保守**，因为"补一个大的上去"
     * 会直接发成就（见 `migrateV15ToV16` 的说明）：
     *   · `cleanDays` 补 0（"你一直摆得很好"是最不该白送的那一条）；
     *   · `minStamina` 补 **100**（= "从没累过"，这是它在开局时的真值；
     *     补 0 的话「一路从容」会白送给每一个老档）；
     *   · `emergencyHurtCount` 补 0（同上，这条偏松，但它本来就是个计数）。
     */
    cleanDays: Math.max(0, num(survival.cleanDays)),
    minStamina: Math.min(100, Math.max(0, num(survival.minStamina) || 100)),
    emergencyHurtCount: Math.max(0, Math.round(num(survival.emergencyHurtCount))),
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
    grabbed: asArray<unknown>(raw.grabbed).filter(
      (g): g is DayEffectApplied['grabbed'][number] =>
        isObject(g) && typeof g.itemId === 'string' && typeof g.count === 'number'
    ),
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
