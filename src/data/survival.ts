/**
 * 生存期数值（§8「MVP 刻意压简，先求闭环」+ M1 平衡改造）。
 *
 * 集中放一个文件，是为了让"数值平衡"这件事将来只需要改一处 ——
 * §8 只给了「每日基础消耗 食物 2 / 水 2 / 燃料(寒潮) 2」一行，
 * 其余全是按"能跑通闭环"定的初始值。**这些数字都还没有经过一轮完整的手感验证**，
 * 第一次调平衡时请直接改这里，不要去 systems/ 里找。
 *
 * ## 一条贯穿始终的原则：代价都是可逆的缓慢下降，但**累积起来会要命**
 *
 * §12.3 原本写的是「弹尽粮绝不死人，永远留逆转口」。M1 手测后发现这句话被执行成了
 * "一直点过一天就能撑满 7 天" —— 生存期没有任何张力，整理也就没有意义。
 * 玩家已授权修订（见策划案 §12.3 的 v0.5 标注），改成：
 *
 *   · 每一步都有代价、都能爬回来，**但健康归零这一局就停在这里**；
 *   · 支撑你活下去的是**两件事**：囤够了 + 拿得到。
 *     后者由整理质量决定 —— 这就是 §5「整理即战力」在数值上的落点。
 *
 * ## 整理质量怎么变成体力
 *
 * §6.4 原文：「分区正确 + FEFO 排好 → 自动、无损耗、心情+」「乱 → 翻找耗时」。
 * "翻找耗时"落成的就是这里的 `workCostOf()`：一天要从屋里翻出 6 件货，
 * 东西在自己划的区里就是伸手拿，埋在一堆纸箱里就是翻箱倒柜 ——
 * 后者一天能耗掉不止一整觉的体力。
 */
import type { CategoryId, DisasterProfile, HardPressLevel, ItemDef, SurvivalSnapshot } from '../model/types';

/**
 * D-Day 的四维起点。
 *
 * ★ 它住在这儿（`data/`）而不是 `systems/setup.ts`，因为 **`data/` 不能依赖
 * `systems/`**（分层），而下面那条"囤货期的地板"（`PEACETIME_FLOOR`）需要它。
 * 放 setup 里会形成 `data/survival ⇄ systems/setup` 的循环依赖 ——
 * 那种循环在打包器里**通常也能跑**（两个都是常量），所以它不会报错、
 * 只会在某次改动顺序之后变成一个很难查的 `undefined`。
 */
export const STARTING_STATS = { health: 100, mood: 70, stamina: 100, shelter: 100 } as const;

/** `SurvivalState.last` 的零值（D-Day 还没结算过时用它） */
export const EMPTY_SURVIVAL_SNAPSHOT: SurvivalSnapshot = {
  health: 0,
  mood: 0,
  stamina: 0,
  shelter: 0,
  shortage: 0,
  spoiled: 0,
  fromShelves: 0,
  fromBoxes: 0,
  unreachable: 0,
  workCost: 0,
  // M4 W-06：零值 = "这个身份没有翻找省力的天赋"，也正是绝大多数身份的值
  workSaved: 0,
  hardPress: false,
  hardPressLevel: 'none',
  usedMedicine: 0,
  usedWarmth: 0,
  emergencyId: null,
  emergencyResolved: false,
  emergencyLost: 0,
  // D-11 的翻乱：零值就是"没乱"，而绝大多数日子的正常值正是 0
  scattered: 0,
  scatteredRows: []
};

/** `SurvivalState.lastTradeDay` 的"从来没换过"。用一个不可能的天数，省掉一个可空字段 */
export const NEVER_TRADED = -99;

/** §8：每日基础消耗（件）。灾难独有的加成由 `DisasterProfile.dailyDrain` 叠加 */
export const BASE_DRAIN: Readonly<Partial<Record<CategoryId, number>>> = { food: 2, water: 2 };

// ———————— 体力：整理质量的直接代价（§6.4「乱 → 翻找耗时」） ————————

/** 睡一觉恢复的体力 */
export const STAMINA_RECOVER = 12;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ★★ 囤货期的四维**只涨不跌**（2026-10 用户反馈）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 用户的原话：
 *
 * > "不是囤货期庇护所会掉，而是囤货期间有一些不属于囤货这一
 * >  我作为先知安全期惬意且安详的事件与任务与描述"
 *
 * ## 为什么原来是"只跌不涨"
 *
 * 生存期的四维账是**闭合**的：每天被灾难磨损，同时被保暖品 / 医疗品自动补回来
 * （`sleepRecoverAt`、`WARMTH_TRIGGER`、`shelterOf` 那一套）。
 * 而**囤货期不结算** —— 那套账整个不跑。
 *
 * 于是囤货期的夜里一旦有选项扣了庇护所（实测只有一条：`n_tripped_breaker` 的
 * "裹紧被子睡" -5），它就是**单向的**：掉了没有磨损来对照、也没有自动补。
 * 玩家看到的是"我家在自己变冷"，而灾难还没登门 —— 与"先知的安全期"正好相反。
 *
 * ## 这条规则做什么
 *
 * 结算时把四维**往下取整到"不低于 D-Day 的起点"**：
 *  · 掉的部分**不生效**（这一周世界还没坏，你的家是完整的）；
 *  · **涨的部分照给**（换灯泡、封胶带、擦水珠都是"我把屋子弄好了"，那该有回报）。
 *
 * ★ 为什么不干脆把那些负向选项删掉：
 *  · "吃了一罐鼓盖的黄豆，健康 -2"是**玩家自己选的代价**（`n_can_dented`），
 *    删掉它那条决定就变浅了；
 *  · 而按起点取整既保住了那个选择的形状，又保住了"安全期不会更冷"这件事。
 *
 * ⚠ 它**只对囤货期生效**（调用点见 `systems/night.ts` 的 `applyNightEffect`）。
 * 生存期的账一个字没动 —— 那里"掉下去就回不来"正是压力所在。
 *
 * ★ 落地形式最后是"**往下走的效果不生效**"（`peacetimeDelta`），而不是"地板值" ——
 * 我先按地板写了三版，每一版都在"读数已经低于起点"时出问题（详见那里的注释）。
 * 所以 `STARTING_STATS` 现在只由 `systems/setup.ts` 用，不再是这里的一部分。
 */

// ———————— 庇护所的下游（§12.3 v0.7） ————————

/**
 * 庇护所跌破这条线 = **睡不踏实**，睡觉只回一半体力。
 *
 * 这之前庇护所是个**没有下游的数字**：每天被磨损、被棉被修回来，不参与任何判定 ——
 * 棉被（warmth）在 §8 里挂着"寒潮刚需"的名头，实际囤了毫无用途。
 * 接上睡眠之后，因果才闭合：屋子冷 → 睡不好 → 体力回不满 → 第二天更翻不动。
 *
 * 刻意用**阈值**而不是线性衰减：阈值是玩家能记住的一句话（"庇护所别让它掉下 40"），
 * 线性公式 nobody 能在脑子里算。也刻意不碰健康 —— 屋子冷不该直接伤人，
 * 它伤的是你明天还有没有力气。
 */
export const SHELTER_SLEEP_LINE = 40;

/** 今晚能睡回多少体力。判定用的是**入夜前**的庇护所值（见 systems/survival.ts 的调用位置） */
export function sleepRecoverAt(shelter: number): number {
  return shelter < SHELTER_SLEEP_LINE ? STAMINA_RECOVER / 2 : STAMINA_RECOVER;
}

/**
 * 体力跌破这条线 = **翻不动了**。
 *
 * 这是"整理差"唯一会滚成雪球的地方，也是它必须存在的原因：
 * 没有它的话，不整理最多让人累一点，但永远活得下去，生存期就退化成了"点过一天"。
 * 有了它，一条能走完的因果链才成立：
 *
 *   东西堆在箱子里 → 每天多花两倍体力 → 体力见底 → 翻不动 → 少吃到东西 → 健康掉
 *
 * 注意它**不是判死**：好档与中档的体力都远在这条线上（实测 7 天下限 64），
 * 只有真正没整理的人会掉进来，而且一旦开始补整理，第二天就能爬回去。
 */
export const EXHAUSTED_STAMINA = 30;
/** 翻不动的那一天，能取到的比例。刻意不是 0 —— 饿死人不该由"累"来完成 */
export const EXHAUSTED_REACH = 0.5;

/** 整理质量里归位率占的权重，其余归临期优先率（§6.4 两句话：分区正确、FEFO 排好） */
export const QUALITY_PLACEMENT_WEIGHT = 0.6;

/** 每取一件货的体力成本：整理质量满时这么多… */
export const WORK_PER_ITEM_EASY = 1.5;
/** …质量归零时这么多。这两个数的差直接决定"整理有没有意义"，必须拉得开 */
export const WORK_PER_ITEM_HARD = 4.5;

/**
 * 整理质量（0..1）= 归位率 × 0.6 + 临期优先率 × 0.4。
 *
 * 单独抽出来是因为**三个地方要读同一个数**（体力劳作、日报叙事、结算评分），
 * 各算一套权重迟早会不一致。
 */
export function organizeQuality(placement: number, fefo: number): number {
  return clamp01(placement) * QUALITY_PLACEMENT_WEIGHT + clamp01(fefo) * (1 - QUALITY_PLACEMENT_WEIGHT);
}

/**
 * 当天的翻找劳作 = 件数 × 每件成本。正数，单位是体力。
 *
 * 举例（一天 6 件：主食 2 + 饮水 2 + 燃料 2）：
 *   · 全归位 + FEFO 排好（质量 1.0）→ 9.0  → 睡一觉 +12，净 +3
 *   · 一半归位（质量 0.5）           → 18.0 → 净 -6
 *   · 全堆在纸箱里（质量 0）         → 27.0 → 净 -15（第 6 天就会掉进硬撑）
 */
export function workCostOf(placement: number, fefo: number, pieces: number): number {
  const quality = organizeQuality(placement, fefo);
  const perItem = WORK_PER_ITEM_HARD - (WORK_PER_ITEM_HARD - WORK_PER_ITEM_EASY) * quality;
  return round1(perItem * Math.max(0, pieces));
}

// ———————— 硬撑（§12.3 v0.5 修订） ————————

/** 四维里任意一项跌破这条线 → 这一整天都在硬撑。三条线分开写，因为三者的崩法不一样 */
export const HARD_PRESS_STAMINA = 40;
export const HARD_PRESS_HEALTH = 45;
export const HARD_PRESS_MOOD = 25;

/** 今天算不算硬撑。只看「不能做事的三种状态」，不看庇护所 —— 屋子冷不会让人垮，没柴烧才会 */
export function isHardPress(stats: { health: number; mood: number; stamina: number }): boolean {
  return stats.stamina < HARD_PRESS_STAMINA || stats.health < HARD_PRESS_HEALTH || stats.mood < HARD_PRESS_MOOD;
}

/**
 * 硬撑分三档（§12.3 v0.6）。
 *
 * 为什么要分档：连续硬撑的第 1 天和第 5 天不是一回事。不分档的话，玩家看到的只是
 * 一个恒定的"每天掉几点"，既看不出自己正在下沉，也不知道再不好转会怎样 ——
 * 而"硬撑"只有变成一条**看得见的下坡**，清理货架这件事才有分量。
 *
 * 判档用 `streak` = **到今天为止已经连续硬撑了几天**（读的是进入当天时的值）：
 *
 *   streak 0~1 → 今天是第 1~2 天 → `straining`「硬撑」
 *   streak 2~3 → 今天是第 3~4 天 → `failing`「撑不住」
 *   streak 4+  → 今天是第 5 天起  → `collapsing`「快垮了」
 */
export const HARD_PRESS_FAIL_STREAK = 2;
export const HARD_PRESS_COLLAPSE_STREAK = 4;

export interface HardPressTier {
  level: HardPressLevel;
  /** 界面上叫它什么。玩家要能一眼看出自己现在在哪一档 */
  name: string;
  mood: number;
  health: number;
  stamina: number;
  /**
   * 这一天**额外多消耗**的件数。
   *
   * 它才是"不痛不痒"的解药：光掉四维只会让人难受，掉到见底也还能爬起来；
   * 而多烧一份食物，是真的在你最缺的时候把库存往下拽 —— 这才叫难度。
   */
  extraDrain: Partial<Record<CategoryId, number>>;
}

/** 从轻到重。下标即严重度，`hardPressTier()` 按它取 */
export const HARD_PRESS_TIERS: readonly HardPressTier[] = [
  { level: 'straining', name: '硬撑', mood: 4, health: 3, stamina: 2, extraDrain: {} },
  { level: 'failing', name: '撑不住', mood: 8, health: 6, stamina: 3, extraDrain: { food: 1 } },
  { level: 'collapsing', name: '快垮了', mood: 12, health: 10, stamina: 4, extraDrain: { food: 2, fuel: 1 } }
];

/**
 * 连续硬撑 `streak` 天时，今天的档位。
 *
 * 注意它回答的是"**如果**今天还硬撑，会是哪一档" —— 是否真的在硬撑由 `isHardPress` 判定。
 * 拆成两步是因为它们的取值时机不同：档位要在**当天消耗之前**就知道（额外消耗要加上去），
 * 而"今天算不算硬撑"要看结算之后的状态。
 */
export function hardPressTier(streak: number): HardPressTier {
  if (streak >= HARD_PRESS_COLLAPSE_STREAK) return HARD_PRESS_TIERS[2] as HardPressTier;
  if (streak >= HARD_PRESS_FAIL_STREAK) return HARD_PRESS_TIERS[1] as HardPressTier;
  return HARD_PRESS_TIERS[0] as HardPressTier;
}

// ———————— 自动补给：让"囤了却没用"的品类真的有用 ————————

/**
 * 医疗品自动用（清偿 D-09：健康曾经只减不增）。
 *
 * 读 `ItemDef.nutrition.health` —— 绷带 2 / 感冒药 3，乘这个系数就是回血值。
 * 这同时清偿了 D-07 的一半：`nutrition` 终于有消费者了。
 * 做法是**自动**而不是加一个"用药"按钮：§4A 要求生存期不产生新的操作负担。
 */
export const MEDICINE_HEAL_FACTOR = 3;
/** 健康低于这条线才去开药箱（小磕小碰不值得动库存） */
export const MEDICINE_TRIGGER = 70;

/**
 * 保暖品自动用（§8 把寒潮刚需写成 fuel + warmth，但 warmth 原本零消耗 —— 囤了完全没用）。
 * 读 `ItemDef.nutrition.comfort` —— 棉被 3，乘这个系数就是庇护所回复值。
 */
export const SHELTER_PER_COMFORT = 4;
/** 庇护所低于这条线才去添被 */
export const WARMTH_TRIGGER = 60;

/** 一件医疗品能回多少健康（读 nutrition.health，没写就不回） */
export function healOf(item: ItemDef): number {
  return (item.nutrition.health ?? 0) * MEDICINE_HEAL_FACTOR;
}

/** 一件保暖品能回多少庇护所（读 nutrition.comfort，没写就不回） */
export function shelterOf(item: ItemDef): number {
  return (item.nutrition.comfort ?? 0) * SHELTER_PER_COMFORT;
}

// ———————— 其余 ————————

/** 庇护所每天被灾难磨损 = 灾难强度 × 这个数（寒潮强度 0.55~1.0 → 每天 -4.4 ~ -8） */
export const SHELTER_WEAR_PER_SEVERITY = 8;

/** 缺货一天的代价（缺口越大越疼，但有上限，避免一次断粮直接判死） */
export const SHORTAGE_HEALTH = 6;
export const SHORTAGE_MOOD = 8;
export const SHORTAGE_STAMINA = 5;
/** 缺货疼痛的封顶倍率：缺口是 1 件还是 10 件，最多差这么多倍 */
export const SHORTAGE_MAX_STACK = 3;

/** 每天的心情修正上限，防止心情在长局里被单一因子拉爆或砸穿 */
export const MOOD_DELTA_CAP = 12;

/**
 * 当天的**品类效率**（维度 13，§10B.3.1 的 L3）。
 *
 * ## 它与"刚需排序"（维度 3）为什么是两件事
 *
 *  · `priorityCategories` 回答"**什么最值钱**"——界面按它标注、顺手位按它建议；
 *  · 本函数回答"**同样的投入能换回多少**"——实际消耗与恢复的效果。
 *
 * 一件东西可以既是这一场最刚需的、又打了折 —— 那正是"这一场不好过"的表达，
 * 也是洪水那条"到处是水，但没有一口能直接喝"的来源。
 *
 * ## 为什么做成函数（而不是在消耗处直接读 `disaster.categoryEfficiency ?? 1`）
 *
 * 与 `disasterModifiersOf` 同一条理由：**默认值只写一次、坏值只挡一次**。
 * 散着写 `?? 1` 的地方迟早会有一处写成 `?? 0`，而 0 会让整个品类凭空消失 ——
 * 那是 D-20 的同一种形状（一个坏值污染整份存档）。
 *
 * 区间取 `[0.5, 1.5]`：设计上"这一场这个东西更不管用"最狠到打对折、
 * "更管用"最多到一点五倍。更极端的值会让"够不够"完全由这一维决定，
 * 而灾难不该单靠一个乘数就把一局说死。
 */
export function categoryEfficiencyOf(disaster: DisasterProfile, category: CategoryId): number {
  const raw = disaster.categoryEfficiency?.[category];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.max(0.5, Math.min(1.5, raw));
}

/**
 * 当天要消耗的品类与件数。
 * ⚠ 消耗按**件数**，不读 `ItemDef.nutrition` —— 已拍板（见策划案 §6.4 与 §8 的拍板标注）：
 * 燃料走件数消耗，其余品类一并沿用同一把尺子，避免"半袋大米"这种需要拆分的算法。
 * `nutrition` 里真正被读的只有 `health` 与 `comfort` 两个键，都用在**自动补给**上（见上）。
 *
 * ★ 维度 13（品类效率）落在这里。它**乘在件数上**，而且有两道闸：
 *
 *  1. **四舍五入**：效率本身就是"一件顶几件"的近似，保留小数会让
 *     `consumeCategory`（按件取）对不上账；
 *  2. **向下不破 1**：`Math.max(1, …)` —— 效率再高也不该让某个品类变成"不用吃"。
 *     那一天会让"囤够了"这件事在一整个维度上失去意义（§4A 承诺任何界面
 *     都得有一条能走的路，而"不用囤也能活"比"卡住"更糟：它让玩法消失）。
 *
 * 🚧 尚未接线：同维度的另一半是"恢复类"（`healOf` / `shelterOf`，即
 * 这一场里药品与保暖**更管用**）。目前只在消耗侧生效 —— 因为恢复侧要动
 * `autoSupply` 的取用逻辑，而那属于"同一维的两半分两次做"，留给 5d 之后。
 * 这一行注释就是那笔账，别让它变成"已经做完了"的错觉。
 */
export function dailyDrainOf(disaster: DisasterProfile): { category: CategoryId; need: number }[] {
  const merged = new Map<CategoryId, number>();
  for (const [category, need] of Object.entries(BASE_DRAIN) as [CategoryId, number][]) {
    merged.set(category, (merged.get(category) ?? 0) + need);
  }
  for (const [category, need] of Object.entries(disaster.dailyDrain) as [CategoryId, number][]) {
    merged.set(category, (merged.get(category) ?? 0) + need);
  }
  return [...merged.entries()]
    .map(([category, need]) => ({
      category,
      // 维度 13：同一个品类在这一场更管用 / 更不管用
      need: Math.max(1, Math.round(need * categoryEfficiencyOf(disaster, category)))
    }))
    .filter((line) => line.need > 0);
}

/**
 * 归位率带来的心情修正 —— 这是"整理即战力"在生存期的**软性**兑现：
 * 东西都在自己该在的地方，闭着眼也拿得到；满屋翻找则会一天天磨掉耐心。
 *
 * 为什么不给硬性惩罚（比如"没归位就多消耗一件"）：那会让玩家在整理期被迫做减法，
 * 与 §5 引擎①「游戏不评判对错」相冲。心情与体力是代价，不是判罚。
 * 体力的那一半见 `workCostOf()` —— 它同样不阻断任何操作，只是让你更累。
 */
export function moodFromPlacement(placement: number): number {
  if (placement >= 0.8) return 4;
  if (placement >= 0.5) return 1;
  if (placement > 0) return -2;
  return -4;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * 四维与劳作都是**一位小数**的口径（`deltas` / `workCost` 都走它）。
 *
 * ★ 导出它是因为"在哪一层乘身份天赋"这件事需要**两处都按同一个口径收尾**
 * （`systems/survival.ts` 的日报、`systems/help.ts` 的凑订单成本）。
 * 一处 `round1`、一处裸乘的表现是同一件活在两屏上差 0.1 点 ——
 * 玩家不会为此报 bug，但账永远对不上。
 */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
