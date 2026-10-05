/**
 * 生存期每日结算（§6.4 + M1 平衡改造 + M2 突发事件）。
 *
 * 一天只结算一次，结算只发生在这个文件里。顺序**不能改**：
 *
 *   ① 腐坏  —— 烂掉的不能吃。必须在消耗之前清，否则玩家会"吃到"当天已经过期的东西。
 *   ② 消耗  —— 按 `data/survival.dailyDrainOf()` 的品类与件数，走 `model/consume` 的 FEFO 取用。
 *   ③ 劳作  —— 把今天翻出来的货"搬"到桌上要花体力，成本由**整理质量**决定（§6.4「乱 → 翻找耗时」）。
 *   ④ 缺货  —— 没凑齐就扣健康 / 心情 / 体力。
 *   ⑤ 硬撑  —— 四维跌破线就进入硬撑，代价再叠一层（§12.3 v0.5 修订）。
 *   ⑥ 突发事件 —— §5 的另一半：顺手位上有急救品就自己化解，没有才按缺货口径受创（M2）。
 *   ⑦ 补给  —— 健康低自动开药箱、屋子冷自动添被（两个"囤了却没用"的品类在这里兑现）。
 *   ⑧ 落定  —— 一次性写回四维，并留一份增量快照给界面。
 *
 * ## 为什么 ③ 必须排在 ④ 之前
 *
 * 劳作算的是"你今天真的翻了多少件"，而翻出来的件数正是 ② 的结果。
 * 如果把它写在缺货判断之后，断粮那天反而会变成"最轻松的一天"（没东西可翻）。
 *
 * ## ⑥ 为什么排在 ⑦ 之前
 *
 * 突发事件的"没化解"按**缺货口径**受创（§5 的措辞就是"否则按缺货口径受创"），
 * 而缺货的账记在 ④。把它放在自动补给之前，意味着**药能救你，但不能免掉今天的伤** ——
 * 与 ⑤ 硬撑的判定位置是同一条道理（"药能把你救回来，但今天确实难受过"）。
 * 反过来放，会出现"磕破了手 → 自动吃药 → 屏幕上什么也没发生"这种事，
 * 那 §5 那句「突发事件不掉健康」就变成了不可见的常量。
 *
 * ## 关于 `health` 归零
 *
 * 这个文件只负责把数算对，**不判胜负**。归零 → `collapsed` 的判定在
 * `systems/phases.ts` 里做 —— 那样"什么算结束"就只有一处定义，存档层也不用猜。
 *
 * ## 关于 `settleSurvivalDay` 的**幂等性**
 *
 * 它自己不判断"今天算过没有"。幂等由调用方（`systems/phases.ts` 的
 * `startSurvival` / `advanceSurvivalDay`）保证 —— 那两个命令在推进 `day` 的同一次
 * `store.commit` 里调用它，所以"day 变了"就必然"刚算过"。
 * 用状态而不是标志位来保证幂等，比多存一个布尔量可靠。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 */
import { dayLabel, severityAt } from '../model/calendar';
import { consumeCategory } from '../model/consume';
import { countOnHandy } from '../model/shelf';
import { computeOrganizeScore } from '../model/score';
import { spoilEverything } from '../model/spoil';
import { messiestRows, rowZoneName, scatterCountFor, scatterRows } from '../model/scatter';
import { furnitureDefOf } from '../data/furniture';
import { EMERGENCY_DEFS, emergencyNoneWeight } from '../data/emergencies';
import { disasterModifiersOf, getDisasterDef } from '../data/disaster';
import { CATEGORY_LABELS, getItemDef } from '../data/items';
import {
  EXHAUSTED_REACH,
  EXHAUSTED_STAMINA,
  MEDICINE_TRIGGER,
  MOOD_DELTA_CAP,
  SHELTER_WEAR_PER_SEVERITY,
  SHORTAGE_HEALTH,
  SHORTAGE_MAX_STACK,
  SHORTAGE_MOOD,
  SHORTAGE_STAMINA,
  STAMINA_RECOVER,
  WARMTH_TRIGGER,
  sleepRecoverAt,
  dailyDrainOf,
  hardPressTier,
  healOf,
  isHardPress,
  moodFromPlacement,
  organizeQuality,
  round1,
  shelterOf,
  workCostOf
} from '../data/survival';
import { identityWorkFactor } from '../data/identities';
import { haulFactorOfShelves, workHauledOf } from '../model/haul';
import { nextFloat, type RngCursor } from '../model/rng';
import { recordEvent } from './setup';
import type { CategoryId, EmergencyDef, HardPressLevel, RunState } from '../model/types';

/** 每天最多自动用掉几件补给（医疗 / 保暖各算一份）。它只防"一次吃光库存"，不限制正常情况下按需取用 */
const SUPPLY_MAX_PER_DAY = 2;

/**
 * 今天有没有碰上突发事件？有则返回它，没有返回 null。消耗一次 RNG。
 *
 * 抽签池里混了一个"今天没事"的虚拟条目（`EMERGENCY_NONE_WEIGHT`）——
 * 一次抽签只有一个 RNG 消耗点，"某一天有没有事"因此只依赖一个数，
 * 回放与调试都更容易对账。
 *
 * ★ 权重**相等**的那些事件在这里是均匀的（每个权重都是 1，总权重 = 事件数）。
 * 不写成"按表里顺序逐个累加权重"是因为这张表的权重目前全等，
 * 加一层读不出来的通用机制只会让"到底几天有事"更难算。
 * 将来真要给某条事件调频率时，再把 `WEIGHT` 加进来。
 *
 * ★ 它是**纯函数**（只吃游标），所以调用方负责决定"这一天算不算"：
 * 只有真的结算了一天才会走到这里（见 `settleSurvivalDay`），
 * 于是"重复点过一天""刷新页面""读档"都不会多抽一次。
 *
 * @param recent 上一条刚出过的（最新在前，见 `RunState.eventHistory`）。
 *   它会被排除 —— **连着两天同一件突发事件**是最刺眼的一种重复。
 */
export function rollEmergency(cursor: RngCursor, recent: readonly string[] = []): EmergencyDef | null {
  // "没事"那一格的权重按**当次池子**反推（见 `emergencyNoneWeight`）——
  // 用固定权重的话，往表里加内容会顺手把频率改掉（M3 真的踩过：30% → 63%）
  const none = emergencyNoneWeight(EMERGENCY_DEFS.length);
  const total = none + EMERGENCY_DEFS.length;
  const roll = nextFloat(cursor) * total;
  if (roll < none) return null;
  let index = Math.min(EMERGENCY_DEFS.length - 1, Math.floor(roll - none));
  const last = recent[0];
  for (let step = 0; step < EMERGENCY_DEFS.length; step++) {
    const candidate = EMERGENCY_DEFS[index];
    if (!candidate) break;
    if (candidate.id !== last) return candidate;
    index = (index + 1) % EMERGENCY_DEFS.length;
  }
  return EMERGENCY_DEFS[index] ?? null;
}

/**
 * 突发事件的结果：化解了没有、丢了几件（按缺货口径）。
 *
 * 它就是 §5 那句话的落点：
 *
 *   > 应急货架（门口/最顺手位）放急救品 → 突发事件不掉健康
 *
 * 判定只有一条：**该品类在顺手位货架上有几件**（`countOnHandy`）。
 * 分母算全屋那句话在这里变成了"纸箱里的绷带不算"—— 箱底那卷确实没在门口。
 */
export interface EmergencyOutcome {
  def: EmergencyDef;
  resolved: boolean;
  /** 没化解时按缺货口径受创的件数（= `def.lost`；化解了就是 0） */
  lost: number;
  /** 化解时顺手位上有几件（用于日志与界面说清"是靠什么化解的"） */
  handyHave: number;
}

/**
 * 判定并结算一次突发事件（就地改 run）。
 *
 * 两条刻意的口径：
 *
 *  1. **化解不消耗库存**（除非 `def.consumes`）。§5 说的是「放急救品 → 不掉健康」——
 *     它奖励的是"放在顺手位"这个**整理动作**，不是"有存货"。若化解也要扣一件，
 *     那和"从箱子里翻出来用掉"就没有区别，而 §6.3 的应急可达率也就白算了。
 *     需要真烧掉的（"炉子熄了"）由 `consumes` 显式声明；
 *  2. **没化解时按缺货口径受创**，与 ④ 缺货**共用同一组常量**（`SHORTAGE_*`）。
 *     另造一套数字会让"突发事件"和"断粮"变成两种疼法，而玩家的账本只有一个。
 *     封顶同样共用 `SHORTAGE_MAX_STACK` —— 一次意外不该比断粮还狠。
 */
export function settleEmergency(run: RunState, def: EmergencyDef): EmergencyOutcome {
  const handyHave = countOnHandy(run.shelves, def.category);
  const resolved = handyHave >= def.needOnHandy;
  if (resolved) {
    if (def.consumes) {
      // 真要烧掉的那几种：从顺手位所在的货架按 FEFO 取。取不满就退化成"没化解"——
      // 但那不可能发生（上面刚数过），所以这里只做防御性处理
      const drawn = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, def.category, def.needOnHandy);
      run.shelves = drawn.shelves;
      run.boxesToUnpack = drawn.boxes;
    }
    return { def, resolved: true, lost: 0, handyHave };
  }
  return { def, resolved: false, lost: def.lost, handyHave };
}

export interface DrainLine {
  category: CategoryId;
  need: number;
  taken: number;
  /** 货架和纸箱里都翻遍了也没有 */
  shortage: number;
  /** 有货，但今天没力气翻到。与 shortage 分开记，界面才能说清是"没有"还是"拿不动" */
  unreachable: number;
  batches: { itemId: string; count: number; expiresAtDay: number | null; from: 'shelf' | 'box' }[];
  /** 其中有多少件是从**没拆的纸箱**里翻出来的（"整理得好"和"没整理"的体感差别就在这儿） */
  fromBoxes: number;
}

export interface SurvivalReport {
  day: number;
  severity: number;
  drains: DrainLine[];
  spoiled: { itemId: string; count: number }[];
  /** 今天坏掉的总件数 */
  spoiledToday: number;
  deltas: { health: number; mood: number; stamina: number; shelter: number };
  /** 结算后的整理体检（心情修正与体力劳作都是按它算的，界面要能解释"今天为什么这么累"） */
  placement: number;
  fefo: number;
  /** 整理质量（0..1）= 归位率 × 0.6 + 临期优先率 × 0.4 */
  quality: number;
  /** 今天的翻找劳作（体力，正数）。它同时也是 `deltas.stamina` 里被扣掉的那部分 */
  workCost: number;
  /**
   * ★ W-06：身份省下来的那一部分劳作（体力，正数，`0` = 没这个天赋）。
   *
   * 它是 §10.1A 那条铁则的落点：身份天赋**只改一个数字**，所以必须同时有
   * 非数字表达 —— 日报拿它写"装卸工的力气比一般人省，这一趟少花 N 点"。
   * 没有这条路，玩家只会觉得"这个身份好像没什么用"，而不会来报 bug。
   */
  workSaved: number;
  /**
   * ★ 维度 7 的位置那一半：为了"从靠里那块取"多花的体力（正数，`0` = 没多花）。
   *
   * 与 `workSaved` 成对：一个是"你挑的人替你省的"，一个是"这一场的天气 +
   * 你自己的摆法罚你的"。日报两句都要说 —— 只说省了多少，玩家会把
   * "搬不动的天气里我把米堆在最里头"这笔账记成别的（比如以为体力公式坏了）。
   */
  workHauled: number;
  fromShelves: number;
  fromBoxes: number;
  /** 有货但没力气翻到的件数（体力见底的那天才 > 0） */
  unreachable: number;
  hardPress: boolean;
  /** 今天是硬撑里的哪一档（`'none'` = 没在硬撑） */
  hardPressLevel: HardPressLevel;
  usedMedicine: number;
  usedWarmth: number;
  /** 今天碰上的突发事件（`null` = 没碰上）。事件的正文由 `data/emergencies.ts` 按 id 查 */
  emergencyId: string | null;
  /** 急用的那几件在不在顺手位。true = 自己化解了，一点健康都没掉（§5） */
  emergencyResolved: boolean;
  /** 没化解时受创的件数（按缺货口径） */
  emergencyLost: number;
  /**
   * ★ 今天被翻乱了几件（§6.4 的"翻乱相邻货架"，2026-10 清偿 D-11）。
   *
   * 0 = 没乱（多数日子都是 0 —— 它只在"你从货架上翻了东西"**而且**整理得差时才发生）。
   * 界面据此说一句"翻找把第 2 行翻乱了"，而**不说**"归位率掉了 X%"——
   * 后者是分数口径，前者是玩家刚才做的事。
   */
  scattered: number;
  /** 被翻乱的那几行的说法（例 `货架 A 第 2 行`），供日报直接印 */
  scatteredRows: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 收掉浮点尾巴，保留两位小数。
 *
 * 必须做，而且必须做在**写回四维之前**：劳作成本带一位小数（9.9 / 13.5 / 19.8），
 * 和一条小数的体力相加就会掉出 `4.799999999999997` 这种数字 —— 而四维是**直接印在界面上**的，
 * 玩家会看到它。数值本身是准的，错的只是显示，但屏幕上多一串 9 就是错。
 *
 * `+ 0` 是为了把 `-0` 归一成 `0`（`Math.round(-0.001 * 100) / 100` 会得到负零）。
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

/**
 * 结算生存期第 `run.day` 天。**就地修改 run**（调用方负责包在 store.commit 里）。
 *
 * @param cursor 供突发事件抽签用的 RNG 游标。**不传就认为今天不掷** ——
 *   这是刻意的默认值：结算的绝大多数调用点（单测、结算页预览）关心的是账怎么算，
 *   不是"今天有没有意外"。真正的命令层（`systems/phases.ts`）一律显式传游标，
 *   这样"同 seed 同事件序列"仍然只在一条路径上成立，不会因为某个调用点忘了传而漂移。
 * @returns 一份给界面看的报告 —— 表现层不认识规则，只显示这份报告。
 */
export function settleSurvivalDay(run: RunState, cursor?: RngCursor): SurvivalReport {
  const disaster = getDisasterDef(run.disasterId);
  const severity = severityAt(disaster, run.day);
  // 腐坏：**每个容器各算各的虚拟天**（灾难的 spoilRate × 家具的 spoilFactor）。
  // 冰箱 / 柜子在这里第一次真的起作用 —— 见 model/spoil.ts 与 data/furniture.ts。
  // ★ `fridgeDead`：断电那一场冰箱按 1 算（D-31 的另一半，M4 收尾）
  const sweep = spoilEverything(run.shelves, run.boxesToUnpack, run.day, disaster.spoilRate, {
    fridgeDead: disaster.fridgeDead === true
  });
  run.shelves = sweep.shelves;
  run.boxesToUnpack = sweep.boxes;
  run.survival.spoiled += sweep.total;

  // ② 消耗：FEFO 取用（归位货架优先）
  //    体力见底的人翻不动 —— 当天能取到的量打折。它不判死（还剩一半），
  //    但足以把"东西堆在箱子里"推成一条下坡路：翻不动 → 少吃 → 更没力气。
  const exhausted = run.stats.stamina < EXHAUSTED_STAMINA;
  //    硬撑的人烧得更多（§12.3 v0.6）。判档看的是**天亮时**的四维：
  //    昨天已经垮在线上的人，今天一睁眼就该知道自己还没缓过来。
  const dawnTier = isHardPress(run.stats) ? hardPressTier(run.survival.hardPressStreak) : null;
  const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, disaster);
  const drains: DrainLine[] = [];
  let shortageUnits = 0;
  /** 真的没有的那些（不含"有货但拿不动"）。它与 shortageUnits 分开累计，结算页要用它说清栽在哪 */
  let realShortageUnits = 0;
  let unreachableUnits = 0;
  let fromBoxes = 0;
  let takenPieces = 0;
  for (const { category, need: baseNeed } of dailyDrainOf(disaster)) {
    // 硬撑的额外消耗算进"今天需要多少"，而不是事后算成"少吃了一顿" ——
    // 账要记在需求侧，玩家才会在库存表上看到那一天多掉了一件
    const need = baseNeed + (dawnTier?.extraDrain[category] ?? 0);
    // 顺手位上的那些**不用翻** —— 体力见底的时候，它们是你唯一还够得到的东西。
    // 这就是 §5「应急货架（门口/最顺手位）」在数值上的落点，也是应急可达率的出口。
    //
    // ★ 这一行**刻意不看胶带**（W-08 讨论后的口径）：`countOnHandy` 只认顺手位。
    //   我一度把它换成"写明放哪儿的都算"（顺手位 ∪ 贴了清单的行），
    //   而那会把**顺手位在体力见底那天的唯一性**让给胶带 —— 于是"门口那一块"
    //   退化成可有可无。两者的分工要保住：
    //     · **胶带**管"取用顺序与归位"（每天省的是翻找，见 `workCostOf` 那三条链）；
    //     · **顺手位**管"最糟的那天够不够得着"（这一行）。
    //   而日报新加的那一格（`handyDays`）用得更宽 —— 它回答的是另一个问题
    //   （"你现在这个样子能撑几天"），所以它读 `isInPlaceFor`。
    //   两个问题不同，读数不同，注释写在这里免得下一个人把它们统一掉。
    const handy = countOnHandy(run.shelves, category);
    const reachable = exhausted
      ? Math.min(need, Math.max(0, Math.ceil(need * EXHAUSTED_REACH)) + handy)
      : need;
    const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, category, reachable);
    run.shelves = result.shelves;
    run.boxesToUnpack = result.boxes;
    const unreachable = need - reachable;
    drains.push({
      category,
      need,
      taken: result.taken,
      shortage: result.shortage,
      unreachable,
      batches: result.batches,
      fromBoxes: result.fromBoxes
    });
    shortageUnits += result.shortage + unreachable;
    realShortageUnits += result.shortage;
    unreachableUnits += unreachable;
    takenPieces += result.taken;
    fromBoxes += result.fromBoxes;
  }
  const fromShelves = takenPieces - fromBoxes;

  // ③ 劳作：整理质量的直接代价（§6.4「乱 → 翻找耗时」）
  const quality = organizeQuality(score.placement, score.fefo);
  /*
   * ★ W-06：身份的省力系数**必须在这里乘，不能塞进 `workCostOf`**。
   *
   * `data/survival.ts` 的 `workCostOf` 是 §6.4 的**基准账**（1.0→9.0 / 0.5→18.0 /
   * 0.0→27.0），三条永久回归探针照着它算 —— 把身份乘进去，那几个探针的前提
   * （"同一份货 = 同一个结果"）就没了。
   *
   * `workBase` 与 `workCost` 两个值都要留着：日报要说出"少花了多少"（§10.1A
   * 要求只改数字的机制同时有非数字表达），而那句话的数据源就是这两个的差。
   */
  const workFactor = identityWorkFactor(run.identityId);
  const workBase = workCostOf(score.placement, score.fefo, takenPieces);
  const workAfterIdentity = round1(workBase * workFactor);
  const workSaved = round1(workBase - workAfterIdentity);
  /*
   * 这一场的 L2 修正在这里拿下。
   *
   * `disasterModifiersOf` 是**唯一读点**（默认值、区间夹取、坏值防御都在那里）——
   * 这里只负责用。不要在这附近再写 `disaster.xxx ?? 1`，那会造出第二个真相。
   * 下面"睡一觉回多少"也读它的 `restEfficiency`，所以这个值本来就该在这里取。
   */
  const mods = disasterModifiersOf(run.disasterId);
  /*
   * ★ 维度 7 的位置那一半（`model/haul.ts`）：东西压在最里头那块，取出来多花力气。
   *
   * 它**必须在这里乘**，理由与上面身份那一乘逐字相同 —— `workCostOf` 是 §6.4 的
   * 基准账，探针照着它算。而它与身份那一乘的区别是"谁在罚你"：
   * 身份是**你挑的人**，搬运惩罚是**这一场的天气**。
   *
   * ★★ 两笔各自算在自己的基准上（`workSaved` 从 `workBase` 起算、
   * `workHauled` 从身份之后起算），最后才合成 `workCost`。
   * 合成一个乘数也能算出同样正确的**总数**，但日报就说不出"哪一笔是多少"了 ——
   * 而 §10.1A 要的正是那两个数各自有名字。
   */
  const haulFactor = haulFactorOfShelves(run.shelves, mods.carryFactor);
  const workHauled = workHauledOf(workAfterIdentity, haulFactor);
  const workCost = round1(workBase * workFactor * haulFactor);

  const deltas = { health: 0, mood: 0, stamina: 0, shelter: 0 };
  // 睡一觉回多少体力，看**入夜前**的庇护所（§12.3 v0.7）：屋子跌破 40 → 冷得睡不踏实，
  // 只回一半。判定必须在 wear 扣减之前 —— "昨晚睡在什么样的屋里"说的是结算前那个数。
  // ★ L2：再乘这一场的**休息效率**（大停电 0.55 = 睡着也冻醒，体力回不满）。
  const sleptRecover = Math.round(sleepRecoverAt(run.stats.shelter) * mods.restEfficiency);
  const sleptBadly = sleptRecover < STAMINA_RECOVER;
  deltas.stamina += sleptRecover - workCost;
  /*
   * 庇护所磨损 = 灾难强度造成的 + 这一场的额外衰减（L2）。
   * `shelterDecayPerDay` 是负数，所以这里是**减它**（= 加绝对值）：语义是"屋子坏得更快"。
   * 并进同一项再取整，避免两次取整各丢一点。
   */
  deltas.shelter -= Math.round(severity * SHELTER_WEAR_PER_SEVERITY - mods.shelterDecayPerDay);
  deltas.mood += moodFromPlacement(score.placement);

  // ④ 缺货：没凑齐就是没凑齐，缺口越大越疼（封顶见 SHORTAGE_MAX_STACK）
  if (shortageUnits > 0) {
    const pain = Math.min(SHORTAGE_MAX_STACK, shortageUnits);
    deltas.health -= SHORTAGE_HEALTH * pain;
    deltas.mood -= SHORTAGE_MOOD * pain;
    deltas.stamina -= SHORTAGE_STAMINA * pain;
    run.survival.shortageDays += 1;
  }
  // 累计件数（结算页读它）：天数会被"缺 1 件"和"缺 5 件"糊成同一个数，件数不会
  run.survival.shortagePieces += realShortageUnits;
  run.survival.unreachablePieces += unreachableUnits;

  /*
   * ④.5 **健康风险**（维度 15，§10B.3.1 的 L3）：硬扛的代价。
   *
   * ## 它与"缺货扣健康"（④）的区别，正是这一维存在的理由
   *
   * ④ 是**玩家做错了什么**的代价（没囤够）；这一维**不看玩家做了什么** ——
   * 屋子在漏、空气有毒、水里带菌，只要住在这儿就在掉血。
   * 所以它必须小（设计区间 0~3）：它制造的是"这一场拖不起"的压力，
   * 而不是替玩家把这一局结束掉。一个 6 分的日风险会在 14 天里扣掉 84 点健康 ——
   * 那不是难度，那是换一种方式告诉玩家"别玩了"。
   *
   * ## 为什么放在④之后、⑤（硬撑判定）之前
   *
   * ⑤ 用的是"④ 之后、⑥ 之前"的四维快照。健康风险是**今天真实发生的事**，
   * 所以它该进那个快照：一个原本勉强不算硬撑的人，因为屋里的毒气
   * 今天就掉进了"快垮了"那一档 —— 这是对的，而且是这一维最有戏的地方。
   *
   * 区间与坏值防御都在 `disasterModifiersOf`（唯一读点），这里只用。
   */
  if (mods.healthRiskPerDay > 0) {
    deltas.health -= mods.healthRiskPerDay;
  }

  // ⑤ 硬撑：判定用的是"④ 之后、⑥ 之前"的状态 —— 药能把你救回来，但今天确实难受过
  const shadow = {
    health: clamp(run.stats.health + deltas.health, 0, 100),
    mood: clamp(run.stats.mood + deltas.mood, 0, 100),
    stamina: clamp(run.stats.stamina + deltas.stamina, 0, 100)
  };
  const hardPress = isHardPress(shadow);
  const todayTier = hardPress ? hardPressTier(run.survival.hardPressStreak) : null;
  if (todayTier) {
    deltas.mood -= todayTier.mood;
    deltas.health -= todayTier.health;
    deltas.stamina -= todayTier.stamina;
    run.survival.hardPressDays += 1;
    run.survival.hardPressStreak += 1;
  } else {
    // 缓过来了就立刻归零。档位算的是**连续**天数：
    // "硬撑一下就好"和"已经第五天爬不起来"对身体的含义完全不同
    run.survival.hardPressStreak = 0;
  }
  deltas.mood = clamp(deltas.mood, -MOOD_DELTA_CAP, MOOD_DELTA_CAP);

  // ⑥ 突发事件（§5 的另一半）：顺手位上有急救品就自己化解，没有才按缺货口径受创。
  //    判定必须在 ⑦ 自动补给**之前** —— 药能把你救回来，但免不掉今天的伤（见文件头的顺序说明）
  const emergency = cursor ? rollEmergency(cursor, run.eventHistory.emergency) : null;
  let emergencyOutcome: EmergencyOutcome | null = null;
  if (emergency) {
    recordEvent(run, 'emergency', emergency.id);
    emergencyOutcome = settleEmergency(run, emergency);
    if (!emergencyOutcome.resolved) {
      const pain = Math.min(SHORTAGE_MAX_STACK, emergencyOutcome.lost);
      deltas.health -= SHORTAGE_HEALTH * pain;
      deltas.mood -= SHORTAGE_MOOD * pain;
      deltas.stamina -= SHORTAGE_STAMINA * pain;
      // 累计"没接住"的次数（v16，成就「门口那一块」读它）。
      // 不能用 last.emergencyResolved 代替：那是今天的快照，只回答"最后一天怎样"
      run.survival.emergencyHurtCount += 1;
    }
  }

  // ⑦ 自动补给：囤了却一直没有用途的两个品类在这里兑现（医疗 → 健康，保暖 → 庇护所）
  const supply = autoSupply(run, {
    health: run.stats.health + deltas.health,
    shelter: run.stats.shelter + deltas.shelter
  });
  deltas.health += supply.heal;
  deltas.shelter += supply.warmth;

  // ⑧ 落定四维（结尾统一收一次小数，见 round2 的注释）
  deltas.health = round2(deltas.health);
  deltas.mood = round2(deltas.mood);
  deltas.stamina = round2(deltas.stamina);
  deltas.shelter = round2(deltas.shelter);

  run.stats.health = clamp(round2(run.stats.health + deltas.health), 0, 100);
  run.stats.mood = clamp(round2(run.stats.mood + deltas.mood), 0, 100);
  run.stats.stamina = clamp(round2(run.stats.stamina + deltas.stamina), 0, 100);
  run.stats.shelter = clamp(round2(run.stats.shelter + deltas.shelter), 0, 100);

  // 「安全感」连击（§12 拍板 v0.9）：达标 = 今天该拿到的都拿到了。
  // 三条都是"今天过得顺不顺"的直接读数，而且**全部来自已经算完的账** ——
  // 不另立一套判定，玩家才能对着日报上的数字自己验证这个连击是不是真的。
  const safeToday =
    shortageUnits === 0 && unreachableUnits === 0 && !hardPress && emergencyOutcome?.resolved !== false;
  if (safeToday) run.survival.safeStreak += 1;
  else run.survival.safeStreak = 0;

  /*
   * 「整理得挑不出毛病」的天数（v16，成就「一尘不染」读它）。
   *
   * 判据 = 归位率 1.00 且 临期优先 1.00 且今天一件没缺。
   *
   * ★ 为什么在**每天结算时**数一笔，而不是结算页现算一次：
   * `score.placement` / `score.fefo` 读的是**此刻的盘面**，而玩家在 14 天里
   * 可以把东西搬来搬去。现算只能回答"你**最后**摆得怎么样"，
   * 这条成就问的是"你**一直**摆得怎么样" —— 两个问题不一样。
   *
   * 用 `score`（本函数开头已经算好的那份）而不是重算一遍：算两遍就会有两份
   * 可能不一致的数，而那正是 §2.8 那条"同一件事只留一个真相来源"的禁忌。
   */
  if (score.placement >= 1 && score.fefo >= 1 && shortageUnits === 0) {
    run.survival.cleanDays += 1;
  }
  // 最低体力（v16，成就「一路从容」读它）。它是"历史最低"，所以只往下走
  run.survival.minStamina = Math.min(run.survival.minStamina, run.stats.stamina);

  /*
   * ★★ 「翻乱相邻货架」（§6.4 的滚雪球）—— 2026-10 清偿 D-11。
   *
   * ## 位置很要紧：**必须在下面那份快照之前**
   *
   * 第一版把它放在函数最后，于是 `run.survival.last` 早就赋过值了 ——
   * 结果是"每天真的会发生翻乱，但日报永远看不到它"（诊断打出来是 `null`）。
   * 这一类"机制生效了但没接线"是最难发现的一种：数据在动、测试全绿、
   * 而界面上什么都没有。
   *
   * ## 三个输入都是**已经算好的**
   *
   * `fromShelves`（今天从货架上取了几件）/ `unreachableUnits`（有没有翻不出来）/
   * `score.placement`（归位率）—— 全部来自上面那段结算。
   *
   * ## ⚠ 它与 `placement` / `fefo` 两个报告值的关系
   *
   * 翻乱**会改变盘面**，所以它之后 `computeOrganizeScore` 会得到更低的数。
   * 而报告里那两个数应当是"**今天结算时**的成绩"（玩家照着它判断今天过得怎么样），
   * 不是"被翻乱之后的"。所以下面先把它们存进 `reportPlacement` / `reportFefo`。
   */
  const reportPlacement = score.placement;
  const reportFefo = score.fefo;
  let scattered = 0;
  const scatteredRows: string[] = [];
  const wanted = scatterCountFor({ taken: fromShelves, unreachable: unreachableUnits, placement: score.placement });
  if (wanted > 0 && cursor) {
    const targets = messiestRows(run, wanted);
    for (const target of targets) {
      const idx = run.shelves.findIndex((s) => s.id === target.shelfId);
      const shelf = run.shelves[idx];
      if (!shelf) continue;
      const result = scatterRows(shelf, [target.row], () => nextFloat(cursor));
      const movedShelf = result.shelves[0];
      if (!movedShelf || result.moved === 0) continue;
      run.shelves[idx] = movedShelf;
      scattered += result.moved;
      const zoneName = rowZoneName(run.zones, shelf, target.row);
      /*
       * ⚠ 这里**不能**用 `ui/labels.ts` 的 `shelfLabel` —— `systems/` 不许依赖 `ui/`
       * （分层纪律，见 AGENTS.md）。而这句话会进 `run.log`（存档里、日报上），
       * 所以它得有个人话的名字：直接取家具表里的 `label`。
       */
      scatteredRows.push(
        `${furnitureDefOf(shelf.kind).label} ${idx + 1}${zoneName ? `（${zoneName}）` : ''} 第 ${target.row + 1} 行`
      );
    }
  }

  // 落盘一份增量快照：刷新回来还要能看见"今天掉了哪些点"（§4A 恢复即续玩）
  run.survival.last = {
    health: deltas.health,
    mood: deltas.mood,
    stamina: deltas.stamina,
    shelter: deltas.shelter,
    shortage: shortageUnits,
    spoiled: sweep.total,
    fromShelves,
    fromBoxes,
    unreachable: unreachableUnits,
    workCost,
    workSaved,
    workHauled,
    hardPress,
    hardPressLevel: todayTier?.level ?? 'none',
    usedMedicine: supply.usedMedicine,
    usedWarmth: supply.usedWarmth,
    emergencyId: emergencyOutcome?.def.id ?? null,
    emergencyResolved: emergencyOutcome?.resolved ?? false,
    emergencyLost: emergencyOutcome?.lost ?? 0,
    scattered,
    scatteredRows
  };

  // ⑧ 报到日志里（阶段 E 的日报按 'D+3 · ' 前缀分组）
  const stamp = dayLabel(run.day);
  const eaten: string[] = [];
  const short: string[] = [];
  for (const line of drains) {
    const name = CATEGORY_LABELS[line.category];
    if (line.taken > 0) eaten.push(`${name} ${line.taken}`);
    if (line.shortage > 0) short.push(`${name} ${line.shortage}`);
  }
  run.log.push(`${stamp} · 消耗 ${eaten.join('、') || '无'}`);
  if (short.length > 0) run.log.push(`${stamp} · 缺 ${short.join('、')}`);
  // 这条日志是"没整理"的体感来源：货架空了，只能去撕箱子
  if (fromBoxes > 0) {
    run.log.push(`${stamp} · 其中 ${fromBoxes} 件是从没拆的纸箱里翻出来的（翻找花了 ${workCost} 点体力）`);
  } else if (workCost > 0) {
    run.log.push(`${stamp} · 翻找花了 ${workCost} 点体力`);
  }
  if (unreachableUnits > 0) {
    run.log.push(`${stamp} · 翻不动，少拿了 ${unreachableUnits} 件`);
  }
  // 没睡踏实要写进日志：它是三条体力流失路径（劳作 / 缺货 / 受冻）里唯一不写在
  // ④⑤ 里的，不记下来玩家只会看到"体力莫名少回了一半"
  if (sleptBadly) {
    run.log.push(`${stamp} · 屋里太冷，没睡踏实（体力只回了 ${sleptRecover}）`);
  }
  if (todayTier) {
    // 报的是**档位名**而不是"硬撑"两个字：玩家回头翻日志时，
    // "撑不住（连续第 3 天）"比"硬撑"能让他想起那几天是怎么过的
    run.log.push(
      `${stamp} · ${todayTier.name}（连续第 ${run.survival.hardPressStreak} 天）`
    );
  }
  if (supply.usedMedicine > 0) {
    run.log.push(`${stamp} · 用了 ${supply.usedMedicine} 件药（健康 +${supply.heal}）`);
  }
  if (supply.usedWarmth > 0) {
    run.log.push(`${stamp} · 添了 ${supply.usedWarmth} 件保暖（庇护所 +${supply.warmth}）`);
  }
  if (sweep.total > 0) {
    const names = sweep.losses.map((l) => `${getItemDef(l.itemId).name}×${l.count}`).join('、');
    run.log.push(`${stamp} · 坏了 ${names}`);
  }
  // 突发事件要写进日志，而且**两句话都写全**：化解了是靠什么化解的（顺手位），
  // 没化解是缺了什么。只写"今天出了件事"等于把一条可见的因果链藏起来。
  if (emergencyOutcome) {
    const name = CATEGORY_LABELS[emergencyOutcome.def.category];
    if (emergencyOutcome.resolved) {
      run.log.push(`${stamp} · ${emergencyOutcome.def.text}顺手位上有${name}，用上了。`);
    } else {
      run.log.push(
        `${stamp} · ${emergencyOutcome.def.text}顺手位上只有 ${emergencyOutcome.handyHave} 件${name}，不够。`
      );
    }
  }
  // 连击只在"达到 2 天以上"时才写：第一天就报会显得像在评价玩家，
  // 而 §5 引擎① 的纪律是"只陈述，不夸"
  if (safeToday && run.survival.safeStreak >= 2) {
    run.log.push(`${stamp} · 该拿到的都拿到了，连着第 ${run.survival.safeStreak} 天。`);
  }

  /*
   * ★★ 「翻乱相邻货架」已经在上面的快照之前做完了（见那段注释）。
   * 这里只把日志写上 —— 它要排在"消耗 / 坏掉 / 突发事件"那几行之后，
   * 因为那些是**今天发生的事**，而翻乱是它们的结果。
   */
  if (scattered > 0) {
    run.log.push(`${stamp} · 翻找的时候把 ${scatteredRows.join('、')} 翻乱了。`);
  }

  return {
    day: run.day,
    severity,
    drains,
    spoiled: sweep.losses,
    spoiledToday: sweep.total,
    deltas,
    placement: reportPlacement,
    fefo: reportFefo,
    quality,
    workCost,
    workSaved,
    workHauled,
    fromShelves,
    fromBoxes,
    unreachable: unreachableUnits,
    hardPress,
    hardPressLevel: todayTier?.level ?? 'none',
    usedMedicine: supply.usedMedicine,
    usedWarmth: supply.usedWarmth,
    emergencyId: emergencyOutcome?.def.id ?? null,
    emergencyResolved: emergencyOutcome?.resolved ?? false,
    emergencyLost: emergencyOutcome?.lost ?? 0,
    scattered,
    scatteredRows
  };
}

interface SupplyOutcome {
  usedMedicine: number;
  usedWarmth: number;
  heal: number;
  warmth: number;
}

/**
 * 自动补给：跌到触发线以下才动，补到线上就停 —— 不留"今天健康 69，一口气吃掉两件药"的浪费。
 *
 * 取货一律走 `consumeCategory`，所以它和吃饭烧火一样遵守 **FEFO**：
 * 快过期的绷带先被用掉。这不是顺手，而是必须 —— 否则"药箱最底层那卷过期的"就永远没人碰。
 */
function autoSupply(run: RunState, current: { health: number; shelter: number }): SupplyOutcome {
  const out: SupplyOutcome = { usedMedicine: 0, usedWarmth: 0, heal: 0, warmth: 0 };

  let health = current.health;
  while (out.usedMedicine < SUPPLY_MAX_PER_DAY && health < MEDICINE_TRIGGER) {
    const drawn = drawOne(run, 'medicine');
    if (!drawn) break;
    const heal = healOf(getItemDef(drawn.itemId));
    if (heal <= 0) break; // 这个品类里没有任何能回血的物资，别再空转
    out.usedMedicine += 1;
    out.heal += heal;
    health += heal;
  }

  let shelter = current.shelter;
  while (out.usedWarmth < SUPPLY_MAX_PER_DAY && shelter < WARMTH_TRIGGER) {
    const drawn = drawOne(run, 'warmth');
    if (!drawn) break;
    const warm = shelterOf(getItemDef(drawn.itemId));
    if (warm <= 0) break;
    out.usedWarmth += 1;
    out.warmth += warm;
    shelter += warm;
  }

  return out;
}

/** 从某品类里按 FEFO 取走 1 件，返回取到的那件（没货返回 null）。就地改 run 的货架与纸箱 */
function drawOne(run: RunState, category: CategoryId): { itemId: string } | null {
  const result = consumeCategory(run.shelves, run.zones, run.boxesToUnpack, category, 1);
  if (result.taken <= 0) return null;
  run.shelves = result.shelves;
  run.boxesToUnpack = result.boxes;
  const first = result.batches[0];
  return first ? { itemId: first.itemId } : null;
}
