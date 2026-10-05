/**
 * 灾难静态表（§8：MVP 灾难 1 个 —— 寒潮；§6.1 先知日历的载体）。
 *
 * 日历覆盖 D-7 .. D+14 共 22 天（§12.3 v0.7：生存期 7 → 14），与 model/types.ts 里 RunState.day 的编号一致：
 *   负数 = 囤货期（灾难还没来，hint 是"先知预告"的口气，克制、1~2 句）
 *   0    = D-Day（寒潮登陆）
 *   正数 = 生存期（hint 转成"今天的处境 + 需求暗示"，阶段 C 直接读它）
 *
 * severity 取 0..1 的连续值：M1 阶段 C 的每日消耗加成、阶段 M2 的窗外天气渲染
 * 都直接乘这个数，不用再做一次映射。
 */
import type { CategoryId, ContentTier, DayForecast, DisasterProfile } from '../model/types';

export const STOCKPILE_DAYS = 7; // 囤货期天数（§8：7 天）
/**
 * 生存期目标天数（§12.3 v0.7：7 → **14**）。
 *
 * 7 天的窗口在数学上杀不死人：崩溃曲线（体力 −15/天 → 第 5 天才见底 → 缺口 + 硬撑
 * − 医药兜底 ≈ −13 健康/天）从 100 走到 0 需要 **约 13 天**跑道，而窗口只剩 2 天 ——
 * 玩家实测"任何时候一直点过一天就能通关"，正是这条账。
 * 14 天让整条 v0.6 的硬撑阶梯（1~2 / 3~4 / 5 天起）真正走完，也把采购从"现金管够"
 * 变成"14 天刚需 ≈ 全部预算"（燃料 28 罐是最大的一笔，见 items.ts 的 v0.7 调价）。
 */
export const SURVIVAL_DAYS = 14; // 生存期目标天数（§12.3 v0.7）

/** 囤货期第一天（也是先知日历的起点） */
export const FIRST_STOCKPILE_DAY = -STOCKPILE_DAYS;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ★ 开局的**灾难阶梯**（M4 决策 A，2026-10 用户拍板）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它解的是哪笔账
 *
 * 116 场灾难从 M3 起就躺在表里，而**实机每一局都是寒潮** ——
 * 因为 `systems/setup.ts` 把 `M1_DISASTER_ID` 写死了。于是：
 *
 *  · `capacityFactor`（**43 场**写了）与 `unusableShelfIds`（**31 场**写了）
 *    **一场都没生效过**，而那两维是 17 个维度里仅有的两个会改变
 *    "什么东西该放哪儿"的其中之一；
 *  · 寒潮是 L1 教学灾难（只用 4 维、不写空间维度），所以几十场写了空间代价的
 *    灾难，玩家永远碰不到。
 *
 * ## 为什么不是"开局随便抽一场"
 *
 * 用户 2026-10 在三个选项里选了**按 tier 阶梯放量**：第一局固定寒潮
 * （它是唯一的 L1，是教学关），之后**撑得越久、见过得越多，池子越大**。
 * 理由是"一局就想让玩家看懂 200 件物资，结果是他一件也记不住"
 * （见 `model/types.ts` 的 `ContentTier`）—— 灾难比物资重得多，
 * 一开局就把 106 场 L3 困境局摊在面前，等于把教学关删掉。
 *
 * ## 阶梯的形状（每一档都写清"它凭什么解锁"）
 *
 * | 进哪一档 | 条件 | 这时池子里有几场 |
 * | --- | --- | --- |
 * | tier 1（只有寒潮） | 还没撑过任何一局 | 1 |
 * | tier ≤ 2 | 撑到最后 1 次 | 33 |
 * | tier ≤ 3 | 撑到最后 3 次 | 110 |
 * | tier ≤ 4 | 撑到最后 5 次 **或** 图鉴里见过 8 场 | 116 |
 *
 * ★ 两个条件**取更宽的那个**（`Math.max`），而不是"都满足"：
 * 一个只走完 3 次但每局都撞上不同家族的玩家，见过的世界比一个
 * 反复刷同一场 5 次的玩家宽 —— 门槛要认这件事。
 *
 * ★ 而 tier 4 那条"见过 8 场"是**图鉴上看得见的进度**，
 * 与「见过 4 场」那条成就（`a_all_disasters`）同一把尺子，
 * 所以玩家不必猜"我还差什么"。
 *
 * ## 口径边界（写给下一个改这里的人）
 *
 * · **门槛只读两个数**：`survivedRuns`（撑过几次）与 `codex.disasters.length`
 *   （见过几场）。都用现成的字段 —— 不新增存档字段，也就不需要迁移；
 * · 它**不改单局里的任何公式**（与 §10B.3 "等级只改开局条件"同一条纪律）：
 *   阶梯只决定**抽到哪一场**，而那一场内部的规则一个字都不动；
 * · 所以三条永久回归探针**不受它影响** —— 它们自己钉死灾难 id
 *   （见 `systems/setup.ts` 的 `createStartingRun` 参数）。
 */
export const DISASTER_TIER_GATES: Readonly<Record<ContentTier, DisasterTierGate>> = {
  1: { need: 0, seen: 0, why: '开局就是它 —— 唯一的 L1，教学关' },
  2: { need: 1, seen: null, why: '撑到最后一次' },
  3: { need: 3, seen: null, why: '撑到最后三次' },
  4: { need: 5, seen: 8, why: '撑到最后五次，或图鉴里见过八场' }
};

/**
 * 阶梯的一档：两个条件取**更宽**的那个（见上面 `DISASTER_TIER_GATES` 的注释）。
 */
export interface DisasterTierGate {
  /** 撑到最后几次 */
  need: number;
  /**
   * 图鉴里见过几场；**`null` = 这一档不看他**。
   *
   * ⚠ 这一格我连着写错两次，两个错都值得留着（§2.17 那一类：
   * 数字本身没错，错在它被当成"没有条件"用了）：
   *
   *  ① 先写 `0` —— 而 `0 >= 0` 对一个刚开档的玩家**恒真**，
   *     于是全新档直接开到 tier 3（110 场），"第一局固定寒潮"当场失效；
   *  ② 再改 `-1` —— 照样恒真（`0 >= -1`）。**任何数字都会在某个进度上成立**，
   *     所以"不生效"这件事根本不能用一个数表示，只能是 `null`。
   *
   * 发现方式：一次性探针（`scripts/_probe-disaster-ladder.ts`）打印每一档的
   * 池子大小 —— 它第一行就报"全新档 → 池子 110 场"。**没跑那个探针的话，
   * 这个错会一路走到玩家面前**（每一局都是随机的，而玩家以为第一局是寒潮）。
   */
  seen: number | null;
  /** 界面/文档里那句话 */
  why: string;
}

/** 算阶梯只需要这两个数 —— 收成一个结构，是为了让调用点不必造一整个 MetaProfile */
export interface DisasterProgress {
  /** `MetaProfile.survivedRuns` */
  survivedRuns: number;
  /** `MetaProfile.codex.disasters.length` */
  seenDisasters: number;
}

/** 现在最高能抽到哪一档（1~4） */
export function disasterTopTier(progress: DisasterProgress): ContentTier {
  let top: ContentTier = 1;
  for (const tier of [1, 2, 3, 4] as const) {
    const gate = DISASTER_TIER_GATES[tier];
    const seenOk = gate.seen !== null && progress.seenDisasters >= gate.seen;
    if (progress.survivedRuns >= gate.need || seenOk) top = tier;
  }
  return top;
}

/**
 * 这一局**能抽到**哪些灾难（按表里的顺序）。
 *
 * ★ 池子永远非空：tier 1 那一档就是寒潮，所以第一局必然抽到它。
 * 这也是"第一局固定寒潮"这句话的**实现方式** —— 它不是一句特判，
 * 而是阶梯第一档只有一场这个事实。
 */
export function disasterPool(progress: DisasterProgress): readonly DisasterProfile[] {
  const top = disasterTopTier(progress);
  return DISASTER_DEFS.filter((d) => d.tier <= top);
}

/** 还锁着几场（开局页要报"还有 N 场没见过"这种话时用它） */
export function lockedDisasterCount(progress: DisasterProgress): number {
  return DISASTER_DEFS.length - disasterPool(progress).length;
}

const COLD_SNAP_CALENDAR: readonly DayForecast[] = [
  { day: -7, severity: 0, hint: '多云，6°C。寒潮还在七天之外。' },
  { day: -6, severity: 0, hint: '4°C。超市的货架开始变薄了。' },
  { day: -5, severity: 0, hint: '2°C。邻市降温了，本地还算暖和。' },
  { day: -4, severity: 0, hint: '1°C。气象台说，今年冬天来得早。' },
  { day: -3, severity: 0, hint: '0°C。小区群里在传要下大雪。' },
  { day: -2, severity: 0, hint: '-2°C。米面货架空了一半，今天还买得到。' },
  { day: -1, severity: 0, hint: '-5°C。风大了，晚上会更冷。' },
  { day: 0, severity: 0.55, hint: '-18°C。寒潮登陆。' },
  { day: 1, severity: 0.7, hint: '-20°C。水管冻住了，今天要烧 2 份燃料。' },
  { day: 2, severity: 0.65, hint: '-19°C。窗户上结了一层冰花。' },
  { day: 3, severity: 0.8, hint: '-23°C。楼道里有风声。' },
  { day: 4, severity: 0.9, hint: '-26°C。街上没有人。' },
  { day: 5, severity: 0.88, hint: '-25°C。雪积在窗台上，有十几厘米厚。' },
  { day: 6, severity: 0.95, hint: '-28°C。水管修不好了，只能化雪。' },
  { day: 7, severity: 1, hint: '-30°C。广播说，寒潮主力还没过境。' },
  { day: 8, severity: 0.98, hint: '-30°C。原来说撑七天就过去了，现在没人再提这个数。' },
  { day: 9, severity: 0.95, hint: '-31°C。窗缝里的冰又厚了一指。' },
  { day: 10, severity: 0.9, hint: '-29°C。雪停了半天，又下起来。' },
  { day: 11, severity: 0.96, hint: '-32°C。楼下的雪没过膝盖。' },
  { day: 12, severity: 0.98, hint: '-33°C。风声很大，整栋楼都在响。' },
  { day: 13, severity: 1, hint: '-35°C。温度计上没见过的数。' },
  { day: 14, severity: 1, hint: '-36°C。撑到今天，就是撑过去了。' }
];

export const DISASTER_DEFS: readonly DisasterProfile[] = [
  {
    id: 'cold_snap',
    name: '寒潮',
    /**
     * §10B.3.2 的家族与层级。
     *
     * ★ 寒潮是 **L1**，而这个标签是被校验器逼着改对的 —— 值得写下这段经过：
     *
     * 我原来写的是 `L2`，理由是"`tier` 与 `level` 是两件事，别混"。
     * 那句话本身没错（`tier` 回答"什么时候该被玩家撞上"、寒潮是 1），
     * 但它当时被我用来**解释一个假标签**：本场一个 L2 维度都没用
     * （下面那 8 个字段一个都没写），而它自己的 `notes` 里就写着
     * "用到维度 1/2/3/4，共 4 个 —— 它是全部灾难的**下限样板**（L1）"。
     * **两个字段互相矛盾，而且没有任何东西会发现。**
     *
     * 直到 5b 的维度签名校验上线，它第一件事就是把这个矛盾报了出来。
     * 所以现在改成 L1 是**说真话**：`check-registry.mjs` 按层级核对维度数
     * （L1 ≥4 / L2 ≥6 / L3 ≥10 / L4 ≥15），而寒潮恰好是 L1 那 4 维的样板。
     *
     * ★ 教训（值得记）：**一个不允许被如实标注的层级，只会逼出一个假标签。**
     * 那条"tier 与 level 是两件事"的解释在事后读起来像是为假标签找的理由 ——
     * 而它当时看起来完全合理。这正是"注释里不许把'应该'写成'已经'"那条的变体。
     */
    family: '温度',
    level: 'L1',
    tier: 1,
    axis: '冷与消耗：燃料是唯一的硬通货，而零下的室外反而让东西放得住',
    counterIntuitive:
      '越冷的东西越不容易坏。这一场最大的敌人是消耗，不是腐坏 —— 所以"多囤"在别处是安全感，在这里是赔钱',
    decisions: [
      '燃料是最大的一笔开销（14 天刚需约占预算六成），少买两罐就能多一床棉被',
      '室外是天然冷库，鲜食可以晚点吃，但屋里那点空间要留给不经冻的东西',
      '顺手位放燃料还是放药：寒潮掉的是庇护所，突发事件要的就是这两样'
    ],
    notes: '用到维度 1/2/3/4，共 4 个 —— 它是全部灾难的**下限样板**（§10B.3.1 的 L1）。',
    calendar: [...COLD_SNAP_CALENDAR], // §7 的类型是可变数组，这里展开一份给它
    /**
     * 逐日外界温度。**这是那次"手写常量表"的搬迁结果（D-15）** ——
     * 原来它是文件上方的一张 `COLD_SNAP_TEMPS` 常量，只覆盖寒潮；
     * 现在每一场灾难自带自己的曲线，`outdoorTemp(day, disasterId)` 按场次读。
     */
    temperatures: {
      [-7]: 6, [-6]: 4, [-5]: 2, [-4]: 1, [-3]: 0, [-2]: -2, [-1]: -5,
      [0]: -18, [1]: -20, [2]: -19, [3]: -23, [4]: -26, [5]: -25, [6]: -28,
      [7]: -30, [8]: -30, [9]: -31, [10]: -29, [11]: -32, [12]: -33, [13]: -35, [14]: -36
    },
    // §8：每日基础消耗 食物 2 / 水 2，「燃料 2」是寒潮独有的加成 —— 正是这里的 dailyDrain
    dailyDrain: { fuel: 2 },
    priorityCategories: ['fuel', 'warmth'],
    windowScene: 'blizzard',
    /**
     * 寒潮是**天然冷库**：室外 -18°C 到 -30°C，放东西出去只会冻得更久。
     *
     * ★ **`0.5` 这个数不许改**（这笔账原编号是 `D-03`，已经清偿，
     * 但那条规矩留着）。玩家明确拍板的是"寒潮延长保质期，腐坏压力交给未来的灾难" ——
     * 所以任何人都不许"顺手把它改成 1 让数字好看一点"。
     * `deferred.test.ts` 里有一条用例钉着这个字面量。
     *
     * 当年它带来一个后果：**M1 全程不会发生任何腐坏**，于是「临期优先」百分比、
     * 冰箱、日报里的损耗行在那个里程碑里全是装饰。那笔账的清偿条件是"多灾难落地"，
     * 而它已经落地了 —— 116 场里有八十多场 `spoilRate > 1`
     * （霉雨 3.0、森林虫灾 2.6、热浪 2.4……），腐坏在那些场次里是真的会吃人的。
     *
     * 而**冰箱在寒潮里依然是零收益**：全屋本来就是冷库。那不是 bug ——
     * 一件家具的价值随灾难变，正是 §10.2.4 说的"同一个整理动作、新的策略维度"。
     */
    spoilRate: 0.5,
    /**
     * ★ 寒潮的**逐日物价曲线**：这份数据是**原样搬过来的历史**。
     *
     * 它原来住在 `data/dayEvents.ts` 里叫 `DAY_PRICE_FACTOR` ——
     * 那张表名义上是"全游戏的物价曲线"，实际上只有寒潮在用（D-19）。
     * 116 场灾难落地之后，另外 115 场都得有自己的曲线，
     * 所以默认值改成"按这一场自己的严重度算"（见 `data/dayEvents.ts`）。
     *
     * ★ **寒潮这一份必须留着，而且一个字都不改**：它是本项目唯一被玩家
     * 看过、玩过、调过的物价曲线（M2 的"早买还是晚买"这个博弈就是它撑起来的）。
     *
     * 我试过用严重度把它拟合出来，最大偏差 **0.29** —— 拟合不上的原因是
     * **寒潮的严重度曲线本身是抖的**（0.55→0.80→1.0→0.96→1.0），
     * 而下面这条物价曲线是**肉眼调平的**。
     *
     * 教训值得留给后来者：**"把它算出来"不一定比"把它写下来"好。**
     * 一条已经调过、被玩过的曲线是**数据**，不是**算法的输出**。
     */
    priceCurve: {
      [-7]: 0.95,
      [-6]: 0.95,
      [-5]: 0.98,
      [-4]: 0.98,
      [-3]: 1.0,
      [-2]: 1.05,
      [-1]: 1.12,
      [0]: 1.25,
      [1]: 1.4,
      [2]: 1.5,
      [3]: 1.6,
      [4]: 1.7,
      [5]: 1.8,
      [6]: 1.9,
      [7]: 2.0,
      [8]: 2.0,
      [9]: 2.05,
      [10]: 2.05,
      [11]: 2.1,
      [12]: 2.1,
      [13]: 2.15,
      [14]: 2.2
    }
  },
  // ═══ 生成内容 灾难-水 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "flood_urban",
    name: "洪水",
    family: "水",
    level: "L3",
    tier: 2,
    axis: "水与污染：到处是水但没有一口能喝，低处的东西全完了",
    temperatures: {
      [0]: 20,
      [3]: 19,
      [7]: 18,
      [11]: 18,
      [14]: 19,
      [-7]: 24,
      [-4]: 23,
      [-1]: 22
    },
    spoilRate: 1.8,
    dailyDrain: {
      water: 2,
      medicine: 1
    },
    priorityCategories: ["water", "medicine"],
    windowScene: "rain-flood",
    shelterDecayPerDay: -3,
    restEfficiency: 0.7,
    carryFactor: 0.6,
    actionPointDelta: 0,
    shopSupplyFactor: 0.55,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      water: 3,
      neighbor: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      warmth: 0.6
    },
    capacityFactor: 0.8,
    healthRiskPerDay: 1,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "雨下了一整夜。气象台说上游来水了。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "河水涨了半米。河边的步道封了。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "连续第四天有雨。地下通道开始积水。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "水文站发了洪水蓝色预警。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "一楼的住户开始往楼上搬东西。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "雨没停。排水口开始往外冒水。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "江面离警戒线还差二十厘米。"
      },
      {
        day: 0,
        severity: 1,
        hint: "凌晨决了堤。一楼进水到小腿。"
      },
      {
        day: 1,
        severity: 1,
        hint: "水没过台阶。一楼的人全搬上来了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "自来水停了。公告说水厂被淹。"
      },
      {
        day: 3,
        severity: 1,
        hint: "楼下漂着垃圾桶和一把椅子。"
      },
      {
        day: 4,
        severity: 1,
        hint: "雨小了。水没退，停在原地。"
      },
      {
        day: 5,
        severity: 1,
        hint: "有人划着充气垫出去买药。"
      },
      {
        day: 6,
        severity: 1,
        hint: "来了两小时电，又断了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "水退了一掌深。泥留在了路上。"
      },
      {
        day: 8,
        severity: 1,
        hint: "水退到脚踝。空气里一股腥味。"
      },
      {
        day: 9,
        severity: 1,
        hint: "超市在清一楼的货，整车拉走。"
      },
      {
        day: 10,
        severity: 1,
        hint: "自来水来了，通知说要烧开再喝。"
      },
      {
        day: 11,
        severity: 1,
        hint: "墙角开始长霉点。"
      },
      {
        day: 12,
        severity: 1,
        hint: "路上能走车了。店还关着一半。"
      },
      {
        day: 13,
        severity: 1,
        hint: "晒了一天太阳，被子还是潮的。"
      },
      {
        day: 14,
        severity: 1,
        hint: "水全退了。墙上的水印还在。"
      }
    ],
    counterIntuitive: "到处是水，但没有一口能直接喝；水最多的一场，恰恰是饮用水最金贵的一场",
    decisions: ["水源被污染后，干净水要按 14 天囤，但它又重又占地方", "低处的格子等于没有，整理时东西该往高处码，顺手位也得跟着搬家", "棉被吸了潮就不顶用，保暖品类在这一场近乎作废，预算要不要全挪给水", "邻居来往比平常勤，换东西方便，但每次开门都意味着分东西出去"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/14/15，共 14 个。spoilRate 1.8 的理由：湿度 90% 以上，干货吸潮霉变。首次使用：capacityFactor 砍掉低处空间、categoryEfficiency 首次废掉整个保暖品类、closedShopIds 关掉五金店。"
  },
{
    id: "drought_dry",
    name: "断水",
    family: "水",
    level: "L3",
    tier: 2,
    axis: "供水与体力：水每天只来两小时，取水的队伍吃的是你的力气，不是你的钱",
    temperatures: {
      [0]: 13,
      [3]: 12,
      [7]: 11,
      [11]: 10,
      [14]: 12,
      [-7]: 16,
      [-4]: 15,
      [-1]: 14
    },
    spoilRate: 0.9,
    dailyDrain: {
      water: 3
    },
    priorityCategories: ["water", "food"],
    windowScene: "dry-tap",
    shelterDecayPerDay: -0.5,
    restEfficiency: 0.75,
    carryFactor: 0.8,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["wholesale"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      queue: 3,
      supply: 2,
      people: 2
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      food: 0.8
    },
    healthRiskPerDay: 1,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "16°C。水厂贴了检修通知，停水两天。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "16°C。水压比平时小，三楼开始抱怨。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "15°C。检修说比预计复杂，再等等。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "15°C。超市的桶装水搬空了三层货架。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "14°C。物业在群里发了储水提醒。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "14°C。来水两小时，队伍从楼下排到路口。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "13°C。水车进了小区，一人两桶。"
      },
      {
        day: 0,
        severity: 1,
        hint: "13°C。管网降压运行，改定时供水。"
      },
      {
        day: 1,
        severity: 1,
        hint: "13°C。早六点到八点有水。水桶排了一排。"
      },
      {
        day: 2,
        severity: 1,
        hint: "12°C。取水的队伍里有人插队，吵了一架。"
      },
      {
        day: 3,
        severity: 1,
        hint: "12°C。药店开始限购生理盐水。"
      },
      {
        day: 4,
        severity: 1,
        hint: "11°C。洗澡改成了三天一次。"
      },
      {
        day: 5,
        severity: 1,
        hint: "11°C。老人攒的塑料瓶全装满了水。"
      },
      {
        day: 6,
        severity: 1,
        hint: "11°C。水车改成了一天一趟。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。有人半夜偷接消防栓，被带走了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "10°C。泡面开始滞销，饼干卖得快。"
      },
      {
        day: 9,
        severity: 1,
        hint: "10°C。来水那天是浑的，接了半缸泥。"
      },
      {
        day: 10,
        severity: 1,
        hint: "10°C。理发店挂出了免洗快剪。"
      },
      {
        day: 11,
        severity: 1,
        hint: "10°C。供水时间缩到一小时。"
      },
      {
        day: 12,
        severity: 1,
        hint: "11°C。井盖边上排着桶，那是口老井。"
      },
      {
        day: 13,
        severity: 1,
        hint: "11°C。你数了数存水，还够五天。"
      },
      {
        day: 14,
        severity: 1,
        hint: "12°C。水压回来了。龙头响了一阵。"
      }
    ],
    counterIntuitive: "断水的时候最先贬值的恰恰是要水的饭：挂面、燕麦、奶粉这些平日最便宜的口粮，每吃一顿都在偷你的存水，于是压缩饼干和罐头这类不用水的饭第一次成为硬通货，主食的贵贱在这一场整个反过来",
    decisions: ["水太重，多囤一箱水就要少带两袋米，车载的每一公斤都在水和饭之间摇摆", "每天两小时供水，排队取水吃的是体力和行动点，今天自己去还是花钱请人捎", "挂面燕麦这些便宜饭都在偷水，是提前改吃贵一点的干粮，还是省着水继续吃便宜的"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/13/15，共 14 个。spoilRate 0.9 的理由：空气干燥，东西反而比平时略耐放，与同族的洪水 1.8 正好相反。与已有水灾难不撞：洪水是水多但不能喝，本场是水少且取水难；主打 13（food 0.8）让主食内部贵贱反转，这是洪水没动过的维度。"
  },
{
    id: "chem_spill",
    name: "污染",
    family: "水",
    level: "L2",
    tier: 2,
    axis: "水源与信任：水龙头还在流，但你不知道这一批干不干净",
    temperatures: {
      [0]: 15,
      [3]: 15,
      [7]: 14,
      [11]: 14,
      [14]: 15,
      [-7]: 18,
      [-4]: 17,
      [-1]: 16
    },
    spoilRate: 1.2,
    dailyDrain: {
      water: 2,
      medicine: 1
    },
    priorityCategories: ["water", "tool"],
    windowScene: "river-smell",
    shelterDecayPerDay: -1.5,
    shopSupplyFactor: 0.8,
    closedShopIds: ["market"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      supply: 3,
      panic: 2,
      limit: 2
    },
    npcVisitFactor: 1.1,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "18°C。上游的河颜色不太对，钓鱼的人收竿了。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "18°C。新闻说化工厂例行检修。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "17°C。河边有死鱼翻上来，管理处在捞。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "17°C。自来水有点土腥味，物业说达标。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "16°C。桶装水的订购电话打不进去了。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "16°C。超市贴了告示：瓶装水限购两提。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "15°C。检测车停在小区门口，排了队。"
      },
      {
        day: 0,
        severity: 1,
        hint: "15°C。通告：水源地检出超标，暂停饮用。"
      },
      {
        day: 1,
        severity: 1,
        hint: "15°C。水还在流。没人用它做饭。"
      },
      {
        day: 2,
        severity: 1,
        hint: "15°C。药店的止泻药卖空了一面墙。"
      },
      {
        day: 3,
        severity: 1,
        hint: "14°C。学校停了直饮水，孩子自带水壶。"
      },
      {
        day: 4,
        severity: 1,
        hint: "14°C。滤水壶的到货通知排到了下周。"
      },
      {
        day: 5,
        severity: 1,
        hint: "14°C。有人半夜去郊外拉井水，一桶二十。"
      },
      {
        day: 6,
        severity: 1,
        hint: "14°C。处理工艺加了一道，味道还在。"
      },
      {
        day: 7,
        severity: 1,
        hint: "14°C。瓶装水队伍从超市排到了路口。"
      },
      {
        day: 8,
        severity: 1,
        hint: "14°C。食堂改用桶装水做饭，菜价涨了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "14°C。检测报告贴出来了，指标在降。"
      },
      {
        day: 10,
        severity: 1,
        hint: "14°C。洗澡的人家多了，说是可以了。"
      },
      {
        day: 11,
        severity: 1,
        hint: "15°C。仍有住户只喝桶装水。"
      },
      {
        day: 12,
        severity: 1,
        hint: "15°C。河里的鱼又出现了，没人钓。"
      },
      {
        day: 13,
        severity: 1,
        hint: "15°C。限购改成了五提，队伍短了一半。"
      },
      {
        day: 14,
        severity: 1,
        hint: "15°C。水厂通告：指标连续三天达标。"
      }
    ],
    counterIntuitive: "水龙头还有水，反而是这一场最危险的地方：来水的时候你不知道这一批带没带味道，烧开了喝和只用存水成了每天都要下的赌注；而平时最不起眼的滤芯滤壶，在这一场比整箱矿泉水还难买，工具第一次在水的灾难里变成刚需",
    decisions: ["烧开了喝还是只用存水：每烧开一壶都在赌市政的处理，每用存水都在吃老本", "滤芯滤壶平时没人多看一眼，现在比水还难买，要不要专程去抢", "瓶装水限购一人两瓶，是天天去排队，还是多花钱从别的渠道进一箱"],
    notes: "用到维度 1/2/3/4/5/9/10/11/12，共 9 个（L2）。spoilRate 1.2 的理由：轻度受潮，超市囤积的鲜货周转慢。与洪水不撞：洪水是水多且脏、低处全泡，本场水在流但不可信，且刚需排序里 tool 第一次排进前二，是全批唯一把净水工具抬成刚需的场。"
  },
{
    id: "waterlog_slow",
    name: "内涝",
    family: "水",
    level: "L3",
    tier: 2,
    axis: "排水与时间：水不深，但它不走，半个月都退不干净",
    temperatures: {
      [0]: 18,
      [3]: 18,
      [7]: 17,
      [11]: 17,
      [14]: 18,
      [-7]: 20,
      [-4]: 19,
      [-1]: 19
    },
    spoilRate: 2.2,
    dailyDrain: {
      medicine: 1,
      fuel: 1
    },
    priorityCategories: ["medicine", "warmth"],
    windowScene: "still-water",
    shelterDecayPerDay: -2,
    restEfficiency: 0.8,
    carryFactor: 0.75,
    shopSupplyFactor: 0.7,
    closedShopIds: ["gas_station"],
    priceSurcharge: 0.25,
    eventPoolWeights: {
      supply: 2,
      queue: 2,
      people: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      warmth: 0.7,
      tool: 1.2
    },
    capacityFactor: 0.85,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 1.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "20°C。雨断断续续下了三天，下水道开始冒泡。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "20°C。低洼路口积了脚踝深的水。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "19°C。排水泵开了一夜，水位没动。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "19°C。地下车库进水，车都挪上了坡。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "19°C。雨又来了，比上一场大。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "18°C。一楼住户开始往二楼借住。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "19°C。市政发了内涝黄色预警。"
      },
      {
        day: 0,
        severity: 1,
        hint: "18°C。暴雨一夜，水漫过了路牙。"
      },
      {
        day: 1,
        severity: 1,
        hint: "18°C。水到小腿深，走得动的只有卡车。"
      },
      {
        day: 2,
        severity: 1,
        hint: "18°C。雨停了。水一点没退。"
      },
      {
        day: 3,
        severity: 1,
        hint: "18°C。积水发浑，冒小泡。"
      },
      {
        day: 4,
        severity: 1,
        hint: "18°C。孩子被大人背着去上学。"
      },
      {
        day: 5,
        severity: 1,
        hint: "17°C。一楼墙面返潮，踢脚线全黑了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "17°C。看皮肤病的人排到了诊所门口。"
      },
      {
        day: 7,
        severity: 1,
        hint: "17°C。水退了半只脚踝。雨又下了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "17°C。水泵抽了三天，水回来大半。"
      },
      {
        day: 9,
        severity: 1,
        hint: "17°C。巷子里的水绿了，蚊子多了。"
      },
      {
        day: 10,
        severity: 1,
        hint: "17°C。路面露出水线，泥有半指厚。"
      },
      {
        day: 11,
        severity: 1,
        hint: "17°C。低处的门打不开，木头胀了。"
      },
      {
        day: 12,
        severity: 1,
        hint: "18°C。晒被子的人占满了所有阳台。"
      },
      {
        day: 13,
        severity: 1,
        hint: "18°C。能过电动车了，水剩在沟里。"
      },
      {
        day: 14,
        severity: 1,
        hint: "18°C。水全退进下水道。泥印到膝盖高。"
      }
    ],
    counterIntuitive: "水浅到膝盖，反而是最坏的深度：它让人误以为还能照常过日子，于是大人蹚水上班、孩子蹚水上学，这一场掉的健康几乎全是自己蹚出来的；而你的物资一件没少，只是低处那块货架半个月都擦不干，等于带着一半的房子过完一整局",
    decisions: ["贴地的货架废了半个月，把东西全码到高处屋子会挤到转不开身，还是扔掉一部分换空间", "蹚水出门会掉健康，不出去会断补给，这一趟值不值每天都要重新算", "棉被湿了干不了，是烧燃料烘干，还是把这笔预算挪给治皮肤病的药"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/12/13/14/15，共 14 个。spoilRate 2.2 的理由：湿度长期 90% 以上，仅次于霉雨。与洪水不撞：洪水是快水，决堤、进水、退去，本场是慢水，不深、不走、泡满 14 天；主打 14（摘掉 shelf_a）+15（1.5 的健康风险全是蹚出来的），刚需里 warmth 第一次排进前二。"
  },
{
    id: "typhoon_land",
    name: "台风",
    family: "水",
    level: "L2",
    tier: 2,
    axis: "风与提前量：灾难还没登陆，货架先空了",
    temperatures: {
      [0]: 24,
      [3]: 22,
      [7]: 21,
      [11]: 22,
      [14]: 24,
      [-7]: 28,
      [-4]: 28,
      [-1]: 26
    },
    spoilRate: 1.3,
    fridgeDead: true,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "tool"],
    windowScene: "typhoon-edge",
    shelterDecayPerDay: -2.5,
    carryFactor: 0.7,
    shopSupplyFactor: 0.5,
    closedShopIds: ["weekend_flea", "market"],
    eventPoolWeights: {
      panic: 3,
      supply: 3,
      queue: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "28°C。远洋台风在编号，路径图上一条虚线。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "28°C。虚线拐了个弯，指向这边。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "28°C。超市的矿泉水面堆高了一倍。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "27°C。胶带和手电摆到了收银台边上。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "27°C。露天摊位收到了撤离通知。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "27°C。泡面只剩两排，价签还没换。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "26°C。风提前到了，雨一阵一阵。"
      },
      {
        day: 0,
        severity: 1,
        hint: "24°C。台风登陆。楼在晃，窗上胶带拉出哨音。"
      },
      {
        day: 1,
        severity: 1,
        hint: "23°C。风眼过境，安静半小时，又来了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "22°C。风小了。楼下的树躺了三棵。"
      },
      {
        day: 3,
        severity: 1,
        hint: "22°C。街上没人，卷帘门凹了一排。"
      },
      {
        day: 4,
        severity: 1,
        hint: "22°C。窗户破的那家在往外搬东西。"
      },
      {
        day: 5,
        severity: 1,
        hint: "21°C。来电了。冰柜里的东西先处理。"
      },
      {
        day: 6,
        severity: 1,
        hint: "21°C。菜场用帆布棚重新支了起来。"
      },
      {
        day: 7,
        severity: 1,
        hint: "21°C。补货车还在路上，店里空着。"
      },
      {
        day: 8,
        severity: 1,
        hint: "21°C。路面清出一条道，电动车能过。"
      },
      {
        day: 9,
        severity: 1,
        hint: "22°C。玻璃店门口排起了队。"
      },
      {
        day: 10,
        severity: 1,
        hint: "22°C。粮油价回到了灾前。"
      },
      {
        day: 11,
        severity: 1,
        hint: "22°C。外围云系又下了一天雨。"
      },
      {
        day: 12,
        severity: 1,
        hint: "23°C。小区修屋顶，敲了一整天。"
      },
      {
        day: 13,
        severity: 1,
        hint: "23°C。倒下的树被锯成段拉走了。"
      },
      {
        day: 14,
        severity: 1,
        hint: "24°C。补货的第一个早晨，货是齐的。"
      }
    ],
    counterIntuitive: "台风是全游戏唯一提前七天就看得见的灾难，于是它先杀的不是房子是货架：抢购比风早到四十八小时，等你确定要囤的时候，囤货期实际只剩五天；而真正该出门的是台风走后的第一个上午，补给没到、队伍没排起来，那是半个月里唯一一次货全而且没人的时刻",
    decisions: ["抢购比风早到两天，现在就照原价扫货，还是赌它转向、等最后一天捡便宜", "窗户要钉板：全钉死屋里黑，不钉玻璃会进屋，钉哪几扇", "台风走后第一个上午是货全没人的窗口，要不要拿仅剩的体力赌它"],
    notes: "用到维度 1/2/3/4/5/7/9/11，共 8 个（L2）。spoilRate 1.3 的理由：断电加返潮，冷藏先坏。与寒潮不撞：寒潮是来了才知道多冷，本场是提前看得见、比的是提前量；主打 11（panic:3 全案最高）与 9（两家露天点位最先关），'囤货期被抢购压缩'是它独有的节奏。"
  },
{
    id: "flash_flood",
    name: "山洪",
    family: "水",
    level: "L3",
    tier: 3,
    axis: "预警与通路：从下雨到进水只有四个小时，货是满的，路先没了",
    temperatures: {
      [0]: 16,
      [3]: 15,
      [7]: 16,
      [11]: 17,
      [14]: 18,
      [-7]: 22,
      [-4]: 21,
      [-1]: 20
    },
    spoilRate: 1.6,
    dailyDrain: {
      water: 2,
      fuel: 1
    },
    priorityCategories: ["fuel", "tool"],
    windowScene: "mud-runoff",
    shelterDecayPerDay: -2,
    restEfficiency: 0.7,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.75,
    closedShopIds: ["wholesale", "gas_station"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      supply: 3,
      people: 3,
      queue: 2
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      tool: 1.3
    },
    capacityFactor: 0.85,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。上游山区连着下雨，河水是黄的。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "22°C。气象台提了句山区暴雨，没人当回事。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "21°C。进山的班车停运两天了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "21°C。上游水库说水位可控，放了一次水。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "21°C。雨云停在山那边，闪电看得见。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "20°C。山里的雨下了一夜，信号断了。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "20°C。短信来了：山洪预警，低处撤离。"
      },
      {
        day: 0,
        severity: 1,
        hint: "16°C。四个小时。水从山上下来，漫过桥面。"
      },
      {
        day: 1,
        severity: 1,
        hint: "16°C。桥断了。进出只剩北边一条土路。"
      },
      {
        day: 2,
        severity: 1,
        hint: "15°C。水退得很快，街上全是泥和石头。"
      },
      {
        day: 3,
        severity: 1,
        hint: "15°C。上游冲下来的箱子堆在坡下，有人翻。"
      },
      {
        day: 4,
        severity: 1,
        hint: "15°C。土路通了半天，又被塌方断了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "15°C。绕北路的班车一天只有一趟。"
      },
      {
        day: 6,
        severity: 1,
        hint: "16°C。店是好的，货是齐的，人到不了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "16°C。救援的冲锋舟在河面上来回。"
      },
      {
        day: 8,
        severity: 1,
        hint: "16°C。抢修队进了山，电时断时续。"
      },
      {
        day: 9,
        severity: 1,
        hint: "16°C。捡东西的人和买东西的人在同一条街。"
      },
      {
        day: 10,
        severity: 1,
        hint: "16°C。土路铺了钢板，三轮车能过了。"
      },
      {
        day: 11,
        severity: 1,
        hint: "17°C。桥的便道通了，只走人不走车。"
      },
      {
        day: 12,
        severity: 1,
        hint: "17°C。第一批补货车排队过便桥。"
      },
      {
        day: 13,
        severity: 1,
        hint: "18°C。菜价回到灾前，就是晚了一天。"
      },
      {
        day: 14,
        severity: 1,
        hint: "18°C。新桥墩打下去，老桥还躺着。"
      }
    ],
    counterIntuitive: "预警只有四个小时，抢购根本来不及发生，所以这一场的货架是满的、店是好的，没的是路：现金在这里最没用，行动点和搬运力才值钱；而水退之后满地是上游冲下来的箱子和家具，捡东西第一次比买东西划算，只是每一件都得用手提回去",
    decisions: ["货是满的路是断的，绕北边土路出门要多花一个行动点，值不值得每天跑一趟", "水退后满街是被冲下来的货，捡的不要钱但耗体力，买的省力气但要现金", "桥要修半个月，补给进不来也出不去，前三天就要定下节奏：省着过，还是去捡"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/13/14，共 14 个。spoilRate 1.6 的理由：泥水浸泡过的地方返潮，但整体比城市洪水干得快。与洪水不撞：洪水在城市里慢慢涨、退得慢，本场在山区来得快、去得快、路断得久；货满路断与骚乱的店关人乱是两种完全不同的买不到；本批唯一用到维度 8 的场。"
  },
{
    id: "saline_intrusion",
    name: "咸潮",
    family: "水",
    level: "L3",
    tier: 3,
    axis: "水质与金属：龙头里出来的是咸水，能喝的只够喝，剩下的连锅都洗不得",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 8,
      [11]: 8,
      [14]: 9,
      [-7]: 14,
      [-4]: 13,
      [-1]: 12
    },
    spoilRate: 1.5,
    dailyDrain: {
      water: 3,
      medicine: 1
    },
    priorityCategories: ["water", "tool", "medicine"],
    windowScene: "salt-tide",
    shelterDecayPerDay: -3,
    restEfficiency: 0.7,
    carryFactor: 0.6,
    actionPointDelta: 0,
    shopSupplyFactor: 0.65,
    closedShopIds: ["market"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      water: 3,
      limit: 2,
      queue: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      tool: 0.6,
      food: 0.85
    },
    healthRiskPerDay: 1,
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。江口的潮位比往年高，上游来水却少。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "13°C。自来水喝着有点咸，物业说是错觉。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "13°C。菜场的水产摊早早收了，说水不行。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "12°C。烧水壶底结了层白霜。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "12°C。学校的直饮水贴了暂停使用的条。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "11°C。超市的桶装水开始限购，一人一提。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "11°C。龙头里的水，洗手都发涩。"
      },
      {
        day: 0,
        severity: 1,
        hint: "10°C。通报：咸潮上溯，氯化物超标。"
      },
      {
        day: 1,
        severity: 1,
        hint: "10°C。水还在流，洗过的锅一夜返锈。"
      },
      {
        day: 2,
        severity: 1,
        hint: "9°C。五金店的塑料桶卖到了货架空。"
      },
      {
        day: 3,
        severity: 1,
        hint: "9°C。有人开车去城北接水，来回两小时。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。楼下的铁栏杆上全是红锈点。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。送水车一天来一趟，一人一桶。"
      },
      {
        day: 6,
        severity: 1,
        hint: "8°C。衣服晒干后发硬，没人愿意洗头。"
      },
      {
        day: 7,
        severity: 1,
        hint: "8°C。罐头的铁皮盖开始起锈。"
      },
      {
        day: 8,
        severity: 1,
        hint: "8°C。诊所里拉肚子的人多了起来。"
      },
      {
        day: 9,
        severity: 1,
        hint: "8°C。有人用纱布接雨水，说比自来水强。"
      },
      {
        day: 10,
        severity: 1,
        hint: "8°C。菜场的菜蔫得快，摊主一天浇几遍。"
      },
      {
        day: 11,
        severity: 1,
        hint: "8°C。上游放了一波水，咸味淡了些。"
      },
      {
        day: 12,
        severity: 1,
        hint: "8°C。水厂公告说在调工艺，味道还重。"
      },
      {
        day: 13,
        severity: 1,
        hint: "8°C。你数了数存水，还够四天。"
      },
      {
        day: 14,
        severity: 1,
        hint: "9°C。氯化物指标回落，龙头水能喝了。"
      }
    ],
    counterIntuitive: "这一场最先报废的不是食物，是你的金属家伙：铁皮罐头的盖子、锅、工具沾上咸水就开始返锈，于是「能盛水的容器」比水本身更难保住；而淡水在这里是耗材，喝只是它一半的用途，另一半要拿去冲洗。",
    decisions: ["龙头还有水，但它只能喝、不能洗：是买桶装水来喝、用自来水凑合洗，还是两样都省着用", "铁器沾咸水就锈，锅和工具要么天天擦干上油，要么直接封进库房不动", "送水车一天一趟，自己开车去城北接水要花掉半天，这笔行动点值不值"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/12/13/15/16，共 14 个。取 -3 的庇护所衰减与 0.45 的物价：盐雾腐蚀外墙与金属设施，同时淡水成了限购品。与洪水、断水都不撞：洪水是水多不能喝且低处全完，断水是水少且取水吃体力，本场水在流、量也够，坏的是「水以外的金属」。它是全案唯一一场让 categoryEfficiency 同时打 tool 与 food 的。"
  },
{
    id: "dam_release",
    name: "泄洪",
    family: "水",
    level: "L3",
    tier: 2,
    axis: "通知与排程：水位按通知上的小时表准时上涨，整理这件事第一次可以排到最后一刻",
    temperatures: {
      [0]: 14,
      [3]: 13,
      [7]: 12,
      [11]: 11,
      [14]: 12,
      [-7]: 18,
      [-4]: 17,
      [-1]: 16
    },
    spoilRate: 1.4,
    dailyDrain: {
      food: 1,
      fuel: 1
    },
    priorityCategories: ["warmth", "food"],
    windowScene: "release-gate",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.8,
    carryFactor: 0.75,
    actionPointDelta: 0,
    shopSupplyFactor: 0.7,
    closedShopIds: ["community_store"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      queue: 3,
      supply: 2,
      neighbor: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      warmth: 0.6
    },
    healthRiskPerDay: 1,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "18°C。上游水库的水位离汛限只差一米。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "17°C。泄洪通知贴在了河堤的公告栏上。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "17°C。通知写了时间：四天后上午开始放水。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "16°C。河边的钓鱼人收竿，说水要来了。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "16°C。一楼的住户开始往高处摞箱子。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "16°C。低处的车位空了一半，车都开走了。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "16°C。广播说按通知的时间来，不会提前。"
      },
      {
        day: 0,
        severity: 1,
        hint: "14°C。上午九点，水进了低处的巷子。"
      },
      {
        day: 1,
        severity: 1,
        hint: "14°C。水到腰。二楼以下的人全搬走了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "13°C。水位停在警戒线下，一直没动。"
      },
      {
        day: 3,
        severity: 1,
        hint: "13°C。有人趁水停着，划板去取自家东西。"
      },
      {
        day: 4,
        severity: 1,
        hint: "13°C。通知说明天开始退水，也是准时的。"
      },
      {
        day: 5,
        severity: 1,
        hint: "12°C。水退了半米，墙上的水印露出来。"
      },
      {
        day: 6,
        severity: 1,
        hint: "12°C。低处的店在洗地，货全搬空了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "12°C。路能走了，泥浆厚得推不动车。"
      },
      {
        day: 8,
        severity: 1,
        hint: "12°C。第一批补货车在路口卸货。"
      },
      {
        day: 9,
        severity: 1,
        hint: "11°C。菜价回到灾前，就是品类少了一半。"
      },
      {
        day: 10,
        severity: 1,
        hint: "11°C。泡过水的家具都堆在门口晒。"
      },
      {
        day: 11,
        severity: 1,
        hint: "11°C。有人说这次比上一回轻。"
      },
      {
        day: 12,
        severity: 1,
        hint: "12°C。堤上开始拆临时挡板。"
      },
      {
        day: 13,
        severity: 1,
        hint: "12°C。一楼的墙皮一碰就掉。"
      },
      {
        day: 14,
        severity: 1,
        hint: "12°C。水退干净了。低处的货架还得晒几天。"
      }
    ],
    counterIntuitive: "泄洪是全案唯一一场允许你拖延的灾难：水什么时候到写在通知上，于是把东西一直留在低处、到最后一小时才收，反而最省力；反过来，提前几天搬空的人要搬两趟，第二趟还得跟封路抢时间。",
    decisions: ["水位什么时候到是写明的，东西是现在就搬上去，还是排到最后半天收", "水只停两天，退了就回来，值不值得为这两天把整个屋子翻一遍", "低处的店先清空，买不到平时的货，要不要趁涨价前多囤一份"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/12/13/15，共 13 个。刚需里第一次把 warmth 排第一：泡过水的屋子先失温，吃的排在第二。与洪水不撞：洪水是没通知的决堤，本场是所有时间点都提前写在通知上的放水；与山洪也不撞：山洪是四小时预警、路先断，本场是四天预告、路还在。它逼出的是「排程」这条别处没有的取舍。"
  },
{
    id: "barrier_lake",
    name: "堰塞湖",
    family: "水",
    level: "L3",
    tier: 3,
    axis: "悬置的威胁：山上多了一个湖，什么时候塌没人知道，撤离包要一直放在门口",
    temperatures: {
      [0]: 17,
      [3]: 16,
      [7]: 15,
      [11]: 15,
      [14]: 16,
      [-7]: 20,
      [-4]: 19,
      [-1]: 18
    },
    spoilRate: 1.7,
    dailyDrain: {
      fuel: 2,
      water: 1
    },
    priorityCategories: ["medicine", "fuel"],
    windowScene: "dam-lake",
    shelterDecayPerDay: -1,
    restEfficiency: 0.6,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.8,
    closedShopIds: ["wholesale"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      panic: 3,
      neighbor: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      luxury: 0.7
    },
    capacityFactor: 0.75,
    healthRiskPerDay: 0.5,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "20°C。上游山体滑了一坡，河道被堵住了。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "19°C。堵出来的水已经漫过了旧桥面。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "19°C。直升机在山谷上绕，撒了标尺。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "18°C。通知说撤离路线要走北边的坡。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "18°C。群里在传照片，水已经没到树腰。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "18°C。有人把行李打包好，放在门口。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "18°C。喇叭车绕了一圈，说随时可能溃口。"
      },
      {
        day: 0,
        severity: 1,
        hint: "17°C。水没下来。所有人又等了一天。"
      },
      {
        day: 1,
        severity: 1,
        hint: "17°C。上游开始挖导流渠，机器声没停过。"
      },
      {
        day: 2,
        severity: 1,
        hint: "16°C。门口那个包，今天又拎回去放好。"
      },
      {
        day: 3,
        severity: 1,
        hint: "16°C。有人忍不住搬回楼上，来回两趟。"
      },
      {
        day: 4,
        severity: 1,
        hint: "16°C。雨又下了一天，水位还在涨。"
      },
      {
        day: 5,
        severity: 1,
        hint: "15°C。通知把撤离区往外扩了一条街。"
      },
      {
        day: 6,
        severity: 1,
        hint: "15°C。有人在楼下搭了临时床，不敢上楼。"
      },
      {
        day: 7,
        severity: 1,
        hint: "15°C。导流渠挖通了，水开始慢慢往下走。"
      },
      {
        day: 8,
        severity: 1,
        hint: "15°C。水位一天掉了半米，观察哨还在。"
      },
      {
        day: 9,
        severity: 1,
        hint: "15°C。专家上山测了两次，说短期内稳。"
      },
      {
        day: 10,
        severity: 1,
        hint: "16°C。撤离的通知撤了一半，只留两个组。"
      },
      {
        day: 11,
        severity: 1,
        hint: "16°C。有人把东西搬回来，又开始理货。"
      },
      {
        day: 12,
        severity: 1,
        hint: "16°C。山上还在排水，河道里水是浑的。"
      },
      {
        day: 13,
        severity: 1,
        hint: "16°C。你数了数，门口那个包还在。"
      },
      {
        day: 14,
        severity: 1,
        hint: "16°C。警戒没撤，日子照过。"
      }
    ],
    counterIntuitive: "悬在头顶的水伤的不是房子，是「整理」这件事本身：随时可能要撤，于是把货码整齐、把库房理好都成了随时会白费的功夫，这一场是唯一一场你越勤快越亏的灾难，最划算的做法是把东西保持在「一提就能带走」的乱。",
    decisions: ["随时可能撤，东西一直摊在外面方便带走，还是照常码进柜子", "撤离包要装什么：药和燃料是硬的，装上它们就带不了别的", "通知一直没来，邻居有人搬回了楼上，跟不跟"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16，共 16 个，是全批维度最多的一场。取 scoreWeights.placement:3（这一场理得整齐是负收益，「顺手位」的评分口径要反过来）+ capacityFactor 0.75 + actionPointDelta -1。与地震不撞：地震是地方没了、修不完，本场地方都在、也没坏，只是随时可能没；与骚乱不撞：骚乱是出不去，本场是「随时要走」。"
  },
{
    id: "pipe_burst",
    name: "爆管",
    family: "水",
    level: "L3",
    tier: 3,
    axis: "抢修与排序：干管一段接一段地爆，修好一处又破一处，先修哪一片，哪一片先来水",
    temperatures: {
      [0]: 18,
      [3]: 17,
      [7]: 16,
      [11]: 15,
      [14]: 16,
      [-7]: 21,
      [-4]: 20,
      [-1]: 19
    },
    spoilRate: 1.4,
    dailyDrain: {
      water: 4
    },
    priorityCategories: ["water", "medicine", "food"],
    windowScene: "main-burst",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.8,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["community_store", "hardware"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      water: 3,
      queue: 2,
      people: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      food: 0.7
    },
    capacityFactor: 0.7,
    healthRiskPerDay: 1.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "21°C。老城一段干管爆了，半条街停水。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "20°C。抢修队挖开路面，泥堆得半人高。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "20°C。同一天，另一个片区又爆了一处。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "19°C。供水短信说老管网集中出问题。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "19°C。桶装水一上午搬空了两排货架。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "18°C。临街的店自己拉管子接水。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "18°C。广播说还要爆，让各家先储水。"
      },
      {
        day: 0,
        severity: 1,
        hint: "17°C。夜里三处干管同时炸，水漫到路中央。"
      },
      {
        day: 1,
        severity: 1,
        hint: "17°C。抢修点排到路口，送水车停在广场。"
      },
      {
        day: 2,
        severity: 1,
        hint: "16°C。上午修好的一处，下午又破了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "16°C。先修哪一片，告示贴在了工地边。"
      },
      {
        day: 4,
        severity: 1,
        hint: "16°C。送水车一天两趟，一人一桶。"
      },
      {
        day: 5,
        severity: 1,
        hint: "15°C。高层的人提水上楼，一层一趟。"
      },
      {
        day: 6,
        severity: 1,
        hint: "15°C。挖开的路面塌了一角，围挡加长。"
      },
      {
        day: 7,
        severity: 1,
        hint: "15°C。龙头里先出来的是黄水，要放十分钟。"
      },
      {
        day: 8,
        severity: 1,
        hint: "16°C。有人守在抢修点，等第一股清水。"
      },
      {
        day: 9,
        severity: 1,
        hint: "16°C。五金店的水桶脱销了。"
      },
      {
        day: 10,
        severity: 1,
        hint: "16°C。送水点设了三处，还是不够分。"
      },
      {
        day: 11,
        severity: 1,
        hint: "16°C。修好的片区，水压还是低。"
      },
      {
        day: 12,
        severity: 1,
        hint: "16°C。路面回填一半，另一半还封着。"
      },
      {
        day: 13,
        severity: 1,
        hint: "16°C。最后两处爆点开始接新管。"
      },
      {
        day: 14,
        severity: 1,
        hint: "16°C。水压回来了。送水车开走了。"
      }
    ],
    counterIntuitive: "全城爆管的时候，最先被牺牲的不是没水的人，是接在支线末端的人：抢修队要保主干、要让多数人尽快恢复，最靠里的几片被排到最后，半个月都不见水。这一场真正拉开差距的是你家那条支管接在哪根干管上，而不是你囤了多少水。",
    decisions: ["主干先通还是支线先通，抢修队只有一队人，先修哪一段等于决定哪几片先来水", "送水车一天两趟固定停在广场，是多走两公里去接，还是在自家等爆点先修", "桶装水和存水都在掉，是花钱从别的片区买，还是接雨水省着用", "混过的水带泥，烧开也只能凑合，这一批是喝还是留着洗"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/13/14/15，共 15 个（L3）。与断水不撞：断水是管网整体降压、每天定时来水、全城一起排队；本场是全城干管多点连续爆裂，来水按片区先后分批，主角是抢修顺序本身。categoryEfficiency 取 food 0.7：没水做饭，挂面这类要水的口粮被打折，干粮当道。用 closedShopIds 关沿街小店与五金店，用 capacityFactor 0.7 让塌陷路面占掉空间，两者一起把签名与断水拉开。healthRiskPerDay 1.5 对应混水与腹泻。priorityCategories 用 water/medicine/food，与咸潮的 water/tool/medicine 不是同一组。"
  },
{
    id: "sewer_back",
    name: "返污",
    family: "水",
    level: "L3",
    tier: 2,
    axis: "密封与卫生：脏水从楼下漫上来，东西一件没少，但你不敢用",
    temperatures: {
      [0]: 19,
      [3]: 19,
      [7]: 18,
      [11]: 18,
      [14]: 19,
      [-7]: 22,
      [-4]: 21,
      [-1]: 20
    },
    spoilRate: 2,
    dailyDrain: {
      medicine: 2,
      water: 1
    },
    priorityCategories: ["medicine", "food", "tool"],
    windowScene: "sewer-back",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.7,
    carryFactor: 0.7,
    actionPointDelta: 0,
    shopSupplyFactor: 0.6,
    closedShopIds: ["community_store", "market"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      supply: 2,
      limit: 2,
      people: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      food: 0.65
    },
    healthRiskPerDay: 2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。雨连着下了三天，井盖开始冒泡。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "21°C。楼下的花坛里积了一洼黑水。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "20°C。一楼的住户说地漏返味。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "20°C。物业通了一次下水道，掏出一堆头发。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "19°C。楼道里有股味道，散不掉。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "19°C。有人家的地漏里冒出了脏水。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "19°C。物业通知：先别用洗衣机。"
      },
      {
        day: 0,
        severity: 1,
        hint: "19°C。半夜返水，一楼厨房进了两指深。"
      },
      {
        day: 1,
        severity: 1,
        hint: "19°C。脏水漫到楼梯口，垫了砖头过。"
      },
      {
        day: 2,
        severity: 1,
        hint: "18°C。水退了，地上留了一层黑泥。"
      },
      {
        day: 3,
        severity: 1,
        hint: "18°C。楼下堆着的米袋底部是湿的。"
      },
      {
        day: 4,
        severity: 1,
        hint: "18°C。纸箱全软了，一搬就破。"
      },
      {
        day: 5,
        severity: 1,
        hint: "18°C。有人把敞口的东西全扔了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "18°C。罐头和密封桶被搬到了高处。"
      },
      {
        day: 7,
        severity: 1,
        hint: "18°C。诊所门口排了队，多是拉肚子和皮炎。"
      },
      {
        day: 8,
        severity: 1,
        hint: "18°C。楼道里点了艾条，味道混在一起。"
      },
      {
        day: 9,
        severity: 1,
        hint: "18°C。下水道通了，小区撒了消毒粉。"
      },
      {
        day: 10,
        severity: 1,
        hint: "18°C。又下了一天雨，地漏重新冒泡。"
      },
      {
        day: 11,
        severity: 1,
        hint: "18°C。有人把家具搬到楼下晒，没人敢坐。"
      },
      {
        day: 12,
        severity: 1,
        hint: "19°C。消毒粉撒了第二遍。"
      },
      {
        day: 13,
        severity: 1,
        hint: "19°C。井盖换了新的，味道淡了。"
      },
      {
        day: 14,
        severity: 1,
        hint: "19°C。楼道洗过一遍，墙角的黑印还在。"
      }
    ],
    counterIntuitive: "这一场丢的不是物资，是「容器」：敞口的米袋、纸箱、散装调料在你没注意的时候已经不能用了，反而是铁皮罐头和密封桶一路升值，包装第一次比里面装的东西值钱。",
    decisions: ["敞口的东西沾过脏水，是立刻扔掉止损，还是洗一洗接着吃", "全屋消毒要烧掉燃料再搭上一天，这几天不做会不会更麻烦", "密封桶和罐头是这一场最硬的货，要不要趁高价卖掉一部分换药"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/12/13/15，共 13 个。healthRiskPerDay 取 2：污水在不看玩家做什么的情况下每天扣健康，是这一场「不敢用」这条轴的量化。与污染不撞：污染是水源能不能信，本场水源没问题，是水本身进了屋；与内涝不撞：内涝是水在街上不走，本场是水在家里停过一夜之后留下的东西。"
  },
{
    id: "ice_jam",
    name: "凌汛",
    family: "水",
    level: "L3",
    tier: 3,
    axis: "冰与水：河被冰堵住，水从上面漫出来，气温还在一路往下掉",
    temperatures: {
      [0]: -6,
      [3]: -9,
      [7]: -11,
      [11]: -13,
      [14]: -14,
      [-7]: 2,
      [-4]: 0,
      [-1]: -3
    },
    spoilRate: 0.8,
    dailyDrain: {
      fuel: 2,
      food: 1
    },
    priorityCategories: ["warmth", "fuel", "food"],
    windowScene: "ice-jam",
    shelterDecayPerDay: -2,
    restEfficiency: 0.6,
    carryFactor: 0.55,
    actionPointDelta: 0,
    shopSupplyFactor: 0.55,
    closedShopIds: ["gas_station", "market"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      cold: 3,
      queue: 2
    },
    npcVisitFactor: 0.7,
    capacityFactor: 0.9,
    healthRiskPerDay: 1.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "2°C。河面上开始结薄冰，一踩就破。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "0°C。上游来的冰块堵在了桥墩下。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-3°C。水位一夜涨了三十厘米。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-6°C。冰坝又厚了一层，水往岸上漫。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-9°C。河边的小路结了冰，没人敢走。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "-11°C。堤上的抽水泵冻住了。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "-13°C。通知让低处的人先把东西搬上来。"
      },
      {
        day: 0,
        severity: 1,
        hint: "-14°C。凌晨冰坝过水，低处一片白。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-14°C。水面上又结了新冰，越堵越高。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-14°C。水停在原地，表面冻成了硬壳。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-14°C。有人在冰面上滑倒，摔断了手腕。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-13°C。破冰船在河道里来回撞冰。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-13°C。水管冻裂了两处，楼里停水。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-12°C。冰坝被炸开一个口子，水开始走。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-12°C。退下去的水在路面上冻成镜面。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-11°C。有人撒了融雪的盐，一条道能走。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-11°C。河面上的冰块堆在岸边，堆成一堵墙。"
      },
      {
        day: 10,
        severity: 1,
        hint: "-11°C。送煤的车绕了远路，烧的省着点。"
      },
      {
        day: 11,
        severity: 1,
        hint: "-12°C。师傅说水管得等化了再补。"
      },
      {
        day: 12,
        severity: 1,
        hint: "-12°C。冰坝拆得差不多了。"
      },
      {
        day: 13,
        severity: 1,
        hint: "-13°C。河面开了一段，水流通了。"
      },
      {
        day: 14,
        severity: 1,
        hint: "-14°C。冰还在。日子照过。"
      }
    ],
    counterIntuitive: "水会结冰，冰会把水位抬得更高，于是这一场的水不是慢慢涨的，是一段一段往上跳；而真正难缠的是水退下去之后冻在地面上的那层壳，从那天起，走路本身就要花掉你半个行动点。",
    decisions: ["地面结成冰壳，出门要花掉更多体力，是少出门还是先磨一双防滑的鞋底", "水管冻裂了，补要等开冻，这半个月是烧水喝还是直接买桶装水", "冰面看着硬了，抄近路能省一半时间，赌不赌它没冻透"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/12/14/15，共 13 个。spoilRate 取 0.8 是全族唯一的「低于 1」：结冰与零下让东西反而放得住，与洪水 1.8、内涝 2.2 正好是两端。搬运惩罚 0.55 是全案最低之一：冰面滑，一趟提不了多少。与寒潮不撞：寒潮是干冷、腐坏变慢、主打燃料；本场是「水结冰再漫上来」，第 14 维的容量损失与第 7 维的搬运惩罚是寒潮完全没有的。"
  },
{
    id: "acid_rain",
    name: "酸雨",
    family: "水",
    level: "L3",
    tier: 3,
    axis: "户外与暴露：雨不进屋，但放在外面的一切都在被慢慢吃掉",
    temperatures: {
      [0]: 18,
      [3]: 18,
      [7]: 17,
      [11]: 17,
      [14]: 18,
      [-7]: 21,
      [-4]: 20,
      [-1]: 19
    },
    spoilRate: 1.3,
    dailyDrain: {
      water: 1,
      medicine: 1
    },
    priorityCategories: ["tool", "luxury"],
    windowScene: "acid-rain",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.85,
    carryFactor: 0.75,
    actionPointDelta: 0,
    shopSupplyFactor: 0.75,
    closedShopIds: ["weekend_flea"],
    priceSurcharge: 0.2,
    eventPoolWeights: {
      water: 2,
      market: 2
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      tool: 1.25
    },
    capacityFactor: 0.85,
    healthRiskPerDay: 0.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "21°C。预报说这周的雨偏酸，出门打伞。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "20°C。晾在外面的衣服干了发黄。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "19°C。楼道里的铁架子起了锈。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "18°C。有人的电动车车漆起了泡。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "18°C。花坛的叶子边缘焦了一圈。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "18°C。物业通知：把阳台上的东西收进来。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "18°C。外面晾的被子收回来是滑的。"
      },
      {
        day: 0,
        severity: 1,
        hint: "18°C。雨下了整夜，窗玻璃上全是点。"
      },
      {
        day: 1,
        severity: 1,
        hint: "18°C。楼道里的铁门关不严了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "18°C。车棚的顶棚开始漏。"
      },
      {
        day: 3,
        severity: 1,
        hint: "18°C。书放在窗边，页脚发脆。"
      },
      {
        day: 4,
        severity: 1,
        hint: "18°C。有人把阳台上的纸箱全搬进了屋。"
      },
      {
        day: 5,
        severity: 1,
        hint: "18°C。屋里的地方被阳台的东西占了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "17°C。雨水顺着外墙淌，墙皮一块块掉。"
      },
      {
        day: 7,
        severity: 1,
        hint: "17°C。五金店的塑料布卖空了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "17°C。有人用油布把手推车盖了起来。"
      },
      {
        day: 9,
        severity: 1,
        hint: "17°C。雨小了一阵，屋檐还在滴。"
      },
      {
        day: 10,
        severity: 1,
        hint: "17°C。晾在外面的东西，没人再往外放。"
      },
      {
        day: 11,
        severity: 1,
        hint: "18°C。雨还在下，比前几天细。"
      },
      {
        day: 12,
        severity: 1,
        hint: "18°C。检测站说这周的雨基本达标了。"
      },
      {
        day: 13,
        severity: 1,
        hint: "18°C。墙上的锈迹擦不掉，只能刷一层。"
      },
      {
        day: 14,
        severity: 1,
        hint: "18°C。雨停了。收进来的东西晾了一屋子。"
      }
    ],
    counterIntuitive: "酸雨是唯一一场屋里屋外差别最大的灾难：下雨时出门没什么风险，真正报废的是你留在阳台、楼道、车棚里的东西，损失不用看你今天去过哪，只看你把东西放在了哪。",
    decisions: ["阳台上的东西收进来会占满屋子、不收就一直被雨吃，先收哪一部分", "外墙和铁架要刷一层涂料才挡得住，这笔钱从工具里挪还是从口粮里挪", "雨看着不大，出门一趟值不值，代价要等回来之后才显出来"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/12/13/14/15，共 14 个。categoryEfficiency 取 tool:1.25（全案唯一大于 1 的品类效率）：补漏、遮盖、涂层的工具在这一场比平时更管用。与返污不撞：返污是水进屋、容器先废，本场是水不进屋子、只要是敞在户外的就废；与沙暴也不撞：沙暴伤的是屋里的空气与身体，本场伤的是露在外面的物件。"
  },
{
    id: "long_rain",
    name: "连雨",
    family: "水",
    level: "L3",
    tier: 2,
    axis: "屋顶与睡觉的地方：雨不淹路、不挡门，专找你房顶上的那个破口",
    temperatures: {
      [0]: 19,
      [3]: 20,
      [7]: 21,
      [11]: 21,
      [14]: 20,
      [-7]: 17,
      [-4]: 17,
      [-1]: 18
    },
    spoilRate: 2.6,
    dailyDrain: {
      medicine: 2,
      water: 1
    },
    priorityCategories: ["warmth", "medicine", "food"],
    windowScene: "roof-drip",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.5,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.8,
    closedShopIds: ["weekend_flea"],
    priceSurcharge: 0.25,
    eventPoolWeights: {
      limit: 2,
      neighbor: 2
    },
    npcVisitFactor: 0.9,
    capacityFactor: 0.9,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "17°C。雨从周末起就没停过。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "17°C。屋顶的排水管开始往下淌水。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "18°C。天花板上出现了一小片水印。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "18°C。水印一天大一圈，下面摆了盆。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "19°C。楼上那户漏得厉害，来借梯子。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "19°C。被子摸着是潮的，睡下去更凉。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "19°C。雨没停。盆不够用了。"
      },
      {
        day: 0,
        severity: 1,
        hint: "20°C。半夜漏得最凶，你把床挪了半米。"
      },
      {
        day: 1,
        severity: 1,
        hint: "20°C。天花板泡软了一块，掉下一点灰。"
      },
      {
        day: 2,
        severity: 1,
        hint: "20°C。睡前要先把床上的湿气烘一烘。"
      },
      {
        day: 3,
        severity: 1,
        hint: "20°C。有人上房顶铺塑料布，滑了一跤。"
      },
      {
        day: 4,
        severity: 1,
        hint: "20°C。药店的感冒药和膏药卖得快。"
      },
      {
        day: 5,
        severity: 1,
        hint: "21°C。地板缝里往外渗水。"
      },
      {
        day: 6,
        severity: 1,
        hint: "21°C。修屋顶的师傅排到了下周。"
      },
      {
        day: 7,
        severity: 1,
        hint: "21°C。有人拿塑料布和砖压住了漏点。"
      },
      {
        day: 8,
        severity: 1,
        hint: "21°C。雨小了一点，漏水没停。"
      },
      {
        day: 9,
        severity: 1,
        hint: "21°C。你把床垫架高了两块砖。"
      },
      {
        day: 10,
        severity: 1,
        hint: "21°C。晾在外面的全收进来了，屋里更挤。"
      },
      {
        day: 11,
        severity: 1,
        hint: "21°C。墙面开始返碱，白花花的一片。"
      },
      {
        day: 12,
        severity: 1,
        hint: "21°C。雨停了半天，屋顶还在滴。"
      },
      {
        day: 13,
        severity: 1,
        hint: "20°C。屋顶的塑料布被风掀起了一角。"
      },
      {
        day: 14,
        severity: 1,
        hint: "20°C。雨终于小了。屋里的东西还是潮的。"
      }
    ],
    counterIntuitive: "这一场里真正撑不住的是房子，不是你的货：雨不淹路、不挡门，只找房顶上那个破口，于是你囤得再全也要先有一个能睡着的地方，而这一场睡觉补回来的体力是全案最少的，修屋顶要花的又恰恰是那份体力。",
    decisions: ["漏点在卧室上方，力气先花在修屋顶，还是先花在把货挪到干处", "塑料布和桶是应急的，一次买够还是每天补一点", "睡不好会一直掉体力，是搬到没漏的楼下去挤，还是守着屋子"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/14/15，共 14 个。restEfficiency 取 0.5（全案最低），shelterDecayPerDay 取 -3.5（并列全案最低），两者叠加就是为了让「睡」成为这一场的主题。与霉雨不撞：霉雨是东西留不住、腐坏最快，本场腐坏也快，但主线是庇护所与休息；与内涝不撞：内涝是水在街上不走，本场水在屋里的天花板上。它是全案唯一一场把 unusableShelfIds 用在「漏水那块地」上的。"
  },
{
    id: "tsunami",
    name: "海啸",
    family: "水",
    level: "L3",
    tier: 4,
    axis: "撤与回：水是一堵按分钟推进的墙，先撤出去的人若在天亮前折返，正好撞上后面的浪",
    temperatures: {
      [0]: 21,
      [3]: 20,
      [7]: 19,
      [11]: 19,
      [14]: 20,
      [-7]: 24,
      [-4]: 23,
      [-1]: 22
    },
    spoilRate: 3,
    fridgeDead: true,
    dailyDrain: {
      water: 3,
      medicine: 1
    },
    priorityCategories: ["water", "fuel", "medicine"],
    windowScene: "tsunami-wall",
    shelterDecayPerDay: -4,
    restEfficiency: 0.45,
    carryFactor: 0.5,
    actionPointDelta: -1,
    shopSupplyFactor: 0.4,
    closedShopIds: ["market", "community_store", "gas_station"],
    priceSurcharge: 0.8,
    eventPoolWeights: {
      panic: 3,
      water: 2,
      people: 2
    },
    npcVisitFactor: 1.4,
    categoryEfficiency: {
      medicine: 1.2
    },
    capacityFactor: 0.55,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 3,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "24°C。远海地震，预警广播报了三分钟。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "24°C。海边的浴场拉了警戒线，人还站着。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "23°C。渔港开始收船，巷子里堆着网。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "23°C。超市的水和饼干整箱往外搬。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "22°C。广播让低处的人把东西搬上楼。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "22°C。海面比平时静，退潮退得很远。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "21°C。通知说今晚到，让沿海的人撤。"
      },
      {
        day: 0,
        severity: 1,
        hint: "21°C。水墙推上岸，第一排房子只剩屋顶。"
      },
      {
        day: 1,
        severity: 1,
        hint: "20°C。第二波比第一波高，退水把折返的人卷走。"
      },
      {
        day: 2,
        severity: 1,
        hint: "20°C。水退了。街上全是淤泥和碎木头。"
      },
      {
        day: 3,
        severity: 1,
        hint: "20°C。有人回低处找东西，被拦在卡口。"
      },
      {
        day: 4,
        severity: 1,
        hint: "20°C。海水灌过的井，抽出来还是咸的。"
      },
      {
        day: 5,
        severity: 1,
        hint: "19°C。安置点在体育馆，铺位排到走廊。"
      },
      {
        day: 6,
        severity: 1,
        hint: "19°C。清淤的车一天来三趟，路还没通。"
      },
      {
        day: 7,
        severity: 1,
        hint: "19°C。沿海的路面塌了几段，绕行很久。"
      },
      {
        day: 8,
        severity: 1,
        hint: "19°C。有人下到露出来的海床捡东西。"
      },
      {
        day: 9,
        severity: 1,
        hint: "19°C。水车停在安置点门口，排了长队。"
      },
      {
        day: 10,
        severity: 1,
        hint: "20°C。开裂的房子拉了封条，不许进。"
      },
      {
        day: 11,
        severity: 1,
        hint: "20°C。海边的店还是关着，货进不来。"
      },
      {
        day: 12,
        severity: 1,
        hint: "20°C。第一批补货车到了，只卸了一半。"
      },
      {
        day: 13,
        severity: 1,
        hint: "20°C。有人搬回没塌的房子，先擦地。"
      },
      {
        day: 14,
        severity: 1,
        hint: "20°C。海水退了十天，地里还是白的。"
      }
    ],
    counterIntuitive: "海啸到岸前，海水会先退得干干净净，露出平时看不到的海床，下滩去捡东西的人最多，而它正好是第一波浪前的最后几分钟。等水退了，先撤出去的人若在天亮前折返，又正好接上更大的第二波。这一场最该克制的是回去这个念头，而不是没带够东西。",
    decisions: ["海水先退是撤离的最后信号，是立刻往高处走，还是回屋再拿一趟东西", "第一波退了天亮前不能回，是留在安置点，还是回去看一眼没塌的房子", "沿海的店全关了，油和药只够带一样，撤离车上先装哪样"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16，共 16 个（L3）。spoilRate 3.0 与 shelterDecayPerDay -4 是全族最重：海水倒灌、断电断链同时到位。与同族全部场次不撞：洪水是内河漫堤、水在城里慢慢涨，本场是海面推来的水墙，涨得快退得也快；它与泄洪、山洪的区别在于没有通知也没有上游，唯一的提前量来自先知日历。第一次把 healthRiskPerDay 封到 3，也第一次把 categoryEfficiency 抬到 medicine 1.2，对应外伤与感染。刚需组合 water/fuel/medicine 全族唯一，撤离要油、海水不能喝、伤者要药。"
  },
{
    id: "reservoir_break",
    name: "溃坝",
    family: "水",
    level: "L3",
    tier: 3,
    axis: "洪水与分钟：洪峰不是慢慢涨上来的，它是一堵按分钟推进的泥墙",
    temperatures: {
      [0]: 19,
      [3]: 18,
      [7]: 17,
      [11]: 16,
      [14]: 17,
      [-7]: 22,
      [-4]: 21,
      [-1]: 20
    },
    spoilRate: 2.4,
    dailyDrain: {
      water: 2,
      medicine: 1
    },
    priorityCategories: ["water", "warmth", "medicine"],
    windowScene: "dam-wall",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.6,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["gas_station", "hardware", "market"],
    priceSurcharge: 0.6,
    eventPoolWeights: {
      water: 3,
      supply: 2,
      neighbor: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      warmth: 0.55
    },
    capacityFactor: 0.6,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 2.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。上游连日暴雨，水库的水位在涨。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "21°C。水库开始泄洪，河道的水是浑的。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "21°C。下游的村口立了撤离的牌子。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "20°C。坝上在查渗漏，车灯晃了一夜。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "20°C。广播让河道两边的人先往高处走。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "19°C。有人把家具搬上车，路堵了一阵。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "19°C。通知说坝体不稳，随时可能垮。"
      },
      {
        day: 0,
        severity: 1,
        hint: "18°C。凌晨坝垮了。水头十分钟到了镇口。"
      },
      {
        day: 1,
        severity: 1,
        hint: "18°C。泥水漫过一层楼，退得也快。"
      },
      {
        day: 2,
        severity: 1,
        hint: "17°C。第一波退了，有人下到河道里。"
      },
      {
        day: 3,
        severity: 1,
        hint: "17°C。第二次放水，河道里又是一堵墙。"
      },
      {
        day: 4,
        severity: 1,
        hint: "17°C。救援的冲锋舟在下游来回找人。"
      },
      {
        day: 5,
        severity: 1,
        hint: "17°C。水退了，街上留下半米厚的泥。"
      },
      {
        day: 6,
        severity: 1,
        hint: "16°C。泥浆泡过的地方，踩上去陷脚。"
      },
      {
        day: 7,
        severity: 1,
        hint: "16°C。有人清淤，有人翻找被冲走的东西。"
      },
      {
        day: 8,
        severity: 1,
        hint: "16°C。上游的水库还在放，河道没干。"
      },
      {
        day: 9,
        severity: 1,
        hint: "16°C。断了的桥只剩两头的桥台。"
      },
      {
        day: 10,
        severity: 1,
        hint: "17°C。安置点挤满了下游几个村的人。"
      },
      {
        day: 11,
        severity: 1,
        hint: "17°C。清淤的车陷在泥里，又拖了半天。"
      },
      {
        day: 12,
        severity: 1,
        hint: "17°C。有人回屋住，先把墙脚铲一遍。"
      },
      {
        day: 13,
        severity: 1,
        hint: "17°C。新的坝址在勘，老的还张着口。"
      },
      {
        day: 14,
        severity: 1,
        hint: "17°C。河道里的水清了，泥还在两岸。"
      }
    ],
    counterIntuitive: "溃坝的洪峰不是慢慢涨上来的，前面是浪头、后面跟着泥浆，泥水的密度大，会游泳的人在里头反而浮不起来。更麻烦的是第一波退得又快又干净，会诱使下游的人提前下到河道，随后库容没排空的第二次放水正好收走这批人。这一场里，退得快不代表结束了。",
    decisions: ["撤离只有往高处这一条路，车装满了开不快，是弃车步行还是赌路没断", "第一波退了有人下河道捡东西，跟不跟，跟了就要赌第二次放水", "泥水泡过的粮食和药还能不能用，扔了心疼，留着赌生病"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/13/14/15，共 15 个（L3）。与泄洪不撞：泄洪是按通知的准时放水、水位慢慢到、主角是排程；本场是坝体垮塌、洪峰按分钟推进，且主角是库容未排空的第二波。与山洪不撞：山洪是山区泥石流、路先断，本场是平原下游的泥水墙，主角是撤离与第二波。categoryEfficiency 取 warmth 0.55：泥水浸透的衣物不顶用，取暖这件事被削弱。刚需组合 water/warmth/medicine 全族唯一，海水与泥水都不能喝、湿身要保温、外伤要药。"
  },
  // ═══ 生成内容 灾难-水 止 ═══,
  // ═══ 生成内容 灾难-温度 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "heat_wave",
    name: "热浪",
    family: "温度",
    level: "L2",
    tier: 2,
    axis: "高温与腐坏：水喝得快，东西烂得快，而夜里才是活动时间",
    temperatures: {
      [0]: 41,
      [3]: 42,
      [7]: 42,
      [11]: 41,
      [14]: 40,
      [-7]: 34,
      [-4]: 36,
      [-1]: 39
    },
    spoilRate: 2.4,
    dailyDrain: {
      water: 3,
      medicine: 1
    },
    priorityCategories: ["water", "medicine"],
    windowScene: "heat-haze",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: 0,
    shopSupplyFactor: 0.85,
    closedShopIds: [],
    priceSurcharge: 0.25,
    eventPoolWeights: {
      heat: 3,
      water: 2
    },
    npcVisitFactor: 0.7,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "34°C。新闻说是十年最早的连续高温。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "35°C。超市的矿泉水开始整箱卖。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "36°C。天气预报把高温预警升到橙色。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "36°C。小区公告栏贴了节电通知。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "37°C。夜里十二点还有 31°C。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "38°C。药店的藿香正气水断货了。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "39°C。路面温度实测 52°C。"
      },
      {
        day: 0,
        severity: 1,
        hint: "41°C。柏油路软了，楼道里没人开窗。"
      },
      {
        day: 1,
        severity: 1,
        hint: "41°C。电梯停在低层，有人被困过。"
      },
      {
        day: 2,
        severity: 1,
        hint: "42°C。冰箱不停机，电表转得飞快。"
      },
      {
        day: 3,
        severity: 1,
        hint: "42°C。楼下的树叶子卷了边。"
      },
      {
        day: 4,
        severity: 1,
        hint: "42°C。后半夜才降到 29°C，能睡一会。"
      },
      {
        day: 5,
        severity: 1,
        hint: "42°C。有人把凉席搬进了地下室。"
      },
      {
        day: 6,
        severity: 1,
        hint: "41°C。自来水管里出来的是温水。"
      },
      {
        day: 7,
        severity: 1,
        hint: "42°C。菜场下午三点就收了摊。"
      },
      {
        day: 8,
        severity: 1,
        hint: "41°C。风扇开到最大，风是热的。"
      },
      {
        day: 9,
        severity: 1,
        hint: "41°C。楼下的猫一整天没挪地方。"
      },
      {
        day: 10,
        severity: 1,
        hint: "40°C。晚上十点还有 34°C。"
      },
      {
        day: 11,
        severity: 1,
        hint: "41°C。冰箱里的肉提前吃完了。"
      },
      {
        day: 12,
        severity: 1,
        hint: "40°C。物业在楼下发了两箱水。"
      },
      {
        day: 13,
        severity: 1,
        hint: "40°C。凌晨下了一点雨，十分钟就停了。"
      },
      {
        day: 14,
        severity: 1,
        hint: "40°C。预报说明天降到 35°C。"
      }
    ],
    counterIntuitive: "夜里比白天好过，活动该挪到晚上；冰箱在这个温度下成了耗电大户，冷藏的不如趁早吃掉",
    decisions: ["饮水要按 14 天压满，药品也要备中暑的量，但现金只够囤一样的一半", "鲜食在这一场烂得飞快，罐头耐放却太重，车载装不了多少", "白天出门搬得少还掉状态，行动点该花在出门还是在家守着"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/12，共 11 个。spoilRate 2.4 的理由：持续 40°C 以上，鲜食按小时坏。与寒潮不撞：寒潮动燃料与保暖、腐坏变慢，本场动水与药品、腐坏加快，刚需排序与腐坏方向都相反。"
  },
{
    id: "qiulaohu",
    name: "秋老虎",
    family: "温度",
    level: "L3",
    tier: 2,
    axis: "电网与鲜食：热只来十天，全城冷库与卖场同时过载，鲜食最便宜的窗口正是最存不住的窗口",
    temperatures: {
      [0]: 33,
      [3]: 35,
      [7]: 32,
      [11]: 28,
      [14]: 26,
      [-7]: 22,
      [-4]: 25,
      [-1]: 29
    },
    spoilRate: 2.3,
    dailyDrain: {
      medicine: 1
    },
    priorityCategories: ["food", "water", "medicine"],
    windowScene: "late-summer-heat",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.8,
    carryFactor: 0.9,
    shopSupplyFactor: 0.6,
    closedShopIds: ["market"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      heat: 3,
      supply: 2,
      market: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      food: 0.8
    },
    healthRiskPerDay: 1,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。预报说这波热还要回升十天。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "24°C。菜市场的鲜菜一下多了起来。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "25°C。有人趁便宜腌一缸菜。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "26°C。冷库的车一趟趟往卖场送。"
      },
      {
        day: -3,
        severity: 0.35,
        hint: "27°C。卖场的冷柜整夜不停机。"
      },
      {
        day: -2,
        severity: 0.4,
        hint: "28°C。有人把鲜肉改成了咸肉。"
      },
      {
        day: -1,
        severity: 0.6,
        hint: "29°C。预报说十天里都是三十度以上。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "33°C。鲜肉放到下午就变了味。"
      },
      {
        day: 1,
        severity: 1,
        hint: "34°C。全城的冷库都排满了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "35°C。卖场到下午就少一半货。"
      },
      {
        day: 3,
        severity: 1,
        hint: "35°C。冰袋和泡沫箱被抢空。"
      },
      {
        day: 4,
        severity: 1,
        hint: "34°C。有人把鲜货当天做成酱肉。"
      },
      {
        day: 5,
        severity: 1,
        hint: "34°C。冷库的电表走得比平时快。"
      },
      {
        day: 6,
        severity: 1,
        hint: "33°C。做熟的东西放不住一顿。"
      },
      {
        day: 7,
        severity: 1,
        hint: "32°C。菜场只开一上午。"
      },
      {
        day: 8,
        severity: 1,
        hint: "31°C。冰箱塞得关不上门。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "30°C。邻居来敲门，问要不要分半只鸡。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "29°C。鲜食的价开始往上走。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "28°C。晒的干货一天就返潮。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "27°C。预报说夜里会转凉。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "26°C。风里有了秋天的意思。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "26°C。一夜之间降了七度。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "热的不是气温，是时机。鲜食最便宜的那十天，也是全城冷库和卖场一起满负荷、最先顶不住的十天；这时候买得越多，越是在跟整座城的冷源抢位置。",
    decisions: ["鲜食最便宜也最存不住，预算要不要整块挪给耐放的东西", "全城冷库过载，自家冰箱整夜开机，电费与损耗只能保一头", "邻居分菜是人情，接了就欠一份，要不要把鲜肉当天全吃掉"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 14 个，属 L3。主打维度 13（categoryEfficiency.food 0.8：全城冷链过载，鲜食效率一起下滑）与 9（关掉农贸市场，卖场到下午就断货）。与热浪不撞：热浪是持续 41°C、腐坏 2.4、水药刚需、靠夜间活动；本场只有十天高位、腐坏 2.3，主线是全城冷库与卖场同时顶不住的囤鲜时机，刚需里食物排在第一。"
  },
{
    id: "daochunhan",
    name: "倒春寒",
    family: "温度",
    level: "L3",
    tier: 2,
    axis: "季节错位：供暖停了才降温，取暖物资与菜价一起往上顶",
    temperatures: {
      [0]: 1,
      [3]: -2,
      [7]: -4,
      [11]: -3,
      [14]: 0,
      [-7]: 12,
      [-4]: 10,
      [-1]: 6
    },
    spoilRate: 0.85,
    dailyDrain: {
      fuel: 2
    },
    priorityCategories: ["fuel", "warmth", "medicine"],
    windowScene: "late-frost-window",
    shelterDecayPerDay: -1.2,
    restEfficiency: 0.8,
    carryFactor: 0.85,
    shopSupplyFactor: 0.5,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      cold: 3,
      market: 2
    },
    categoryEfficiency: {
      warmth: 0.7,
      food: 0.8
    },
    healthRiskPerDay: 1.2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "12°C。供暖期结束，物业贴了停暖通知。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "10°C。五金店的煤和取暖器早就下架。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "8°C。气象台说有一股冷空气要下来。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "6°C。晚上得加一床被子。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "4°C。有人翻出去年的暖手宝。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "2°C。预报把降温幅度改成了十度。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "0°C。窗上结了霜，暖气片是凉的。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "1°C。冷空气到了，暖气片还是凉的。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-2°C。取暖的东西早就下架了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-3°C。楼道里有人在生小炭炉。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-4°C。夜里被冻醒了两回。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-4°C。有人的水管在夜里冻裂。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-3°C。有人把冬天的棉衣又翻出来。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-3°C。超市的暖贴上架就被买光。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-2°C。大棚里的菜苗开始冻坏。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-1°C。菜价一天抬了一档。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "0°C。早春的菜地冻坏了一片。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "1°C。药店的感冒药卖得快。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "2°C。预报说冷空气快走了。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "3°C。中午能开一会儿窗。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "4°C。屋里的墙角还留着霜印。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "5°C。回暖了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场最贵的不是冷，是季节没对上。最需要取暖的一周，恰是全年最买不到取暖物资的一周：供暖停了，货架也按春天收起，钱再多也只能换别人手里的旧存货；城里的大棚和早春菜一起冻坏，菜价跟着抬头。",
    decisions: ["供暖停了，取暖物资只能从邻居手里换，价格由对方定，要不要接受", "大棚冻坏菜价抬头，预算要不要往耐放的粮上挪", "水管冻裂过一次就会再裂，修它花的体力和时间从哪一项里扣"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/13/15，共 12 个，属 L3。主打维度 9（shopSupplyFactor 0.5 且关五金店：供暖与取暖物资按季节下架，恰在最需要时断供）与 13（categoryEfficiency 打 warmth 0.7 与 food 0.8：停暖让取暖失效，早春作物冻坏让菜价抬头）。与寒潮不撞：寒潮是正当季极寒、燃料是常规刚需；本场温度只到零下四度，压力来自季节错位加全城停暖、农业受损。"
  },
{
    id: "dongyu",
    name: "冻雨",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "通行与摔伤：损失不在温度，在路面变成镜子",
    temperatures: {
      [0]: -2,
      [3]: -4,
      [7]: -5,
      [11]: -4,
      [14]: -2,
      [-7]: 3,
      [-4]: 2,
      [-1]: 0
    },
    spoilRate: 0.9,
    dailyDrain: {
      fuel: 1,
      medicine: 1
    },
    priorityCategories: ["fuel", "tool", "warmth"],
    windowScene: "ice-glaze",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.7,
    carryFactor: 0.5,
    actionPointDelta: -1,
    shopSupplyFactor: 0.7,
    closedShopIds: ["gas_station"],
    priceSurcharge: 0.25,
    eventPoolWeights: {
      cold: 3,
      queue: 2
    },
    npcVisitFactor: 0.8,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "3°C。雨夹雪，路面开始发亮。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "2°C。有人摔了一跤，膝盖蹭破了。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "1°C。气象台发了道路结冰预警。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "0°C。台阶上结了薄薄一层冰。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-1°C。有人往路上撒盐，撒完又冻上。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-2°C。医院说摔伤的人多了。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-3°C。公交车全都减了速。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-4°C。一夜之间，路成了镜子。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-4°C。出小区要扶着栏杆一步步挪。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-5°C。送菜的车进不来，摊位空了一半。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-5°C。有人在鞋上绑了布条再出门。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-5°C。拎东西走路根本腾不出手扶墙。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-4°C。小区门口开始有人扶着走。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-4°C。树枝上挂着的冰把枝头压断了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-4°C。有人干脆一整天没出门。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-3°C。药店的跌打药卖空了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-3°C。路面撒了沙，走起来稳一点。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-2°C。中午化了一点，傍晚又冻上。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-2°C。有人开始互相搀扶着去买菜。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "-2°C。车流少了，路反而更滑。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "-1°C。太阳出来，冰面开始发软。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "0°C。路化开了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "温度表停在零下四五度，看着不吓人，可这一场的伤害全在通行上。真正让人亏的不是冷，是『一趟变半趟』：手里拎着东西就走不稳，于是每次出门的搬运量腰斩，而行动点还少一个。反过来，工具（防滑的东西）在这里比厚衣服值钱。",
    decisions: ["手里拎东西就没法扶墙，搬运量是不是要主动砍掉一半换安全", "行动点少一个，是分两天各跑一趟，还是攒成一天冒险一次", "修被冰压断的树枝与檐口要不要今天做，工具花在这里还是留给屋顶"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12，共 12 个。主打维度 7（carryFactor 0.5，全案最低档，把『拎东西』变成危险动作）与 8（行动点 -1）。与寒潮不撞：寒潮的低温是主线且腐坏变慢到 0.5，本场温度只有零下四度，主线是路面结冰导致的搬运与通行坍缩，刚需也从燃料保暖挪到了燃料+工具+保暖。"
  },
{
    id: "baoxue",
    name: "暴雪",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "封门与二次账：雪把水源带来，又把燃料的账翻了一倍",
    temperatures: {
      [0]: -10,
      [3]: -12,
      [7]: -13,
      [11]: -12,
      [14]: -9,
      [-7]: 1,
      [-4]: -2,
      [-1]: -6
    },
    spoilRate: 0.6,
    dailyDrain: {
      fuel: 3
    },
    priorityCategories: ["fuel", "warmth", "water"],
    windowScene: "snow-blocked-door",
    shelterDecayPerDay: -3,
    restEfficiency: 0.65,
    carryFactor: 0.55,
    actionPointDelta: -1,
    eventPoolWeights: {
      cold: 3,
      supply: 2
    },
    categoryEfficiency: {
      warmth: 0.8
    },
    capacityFactor: 0.85,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "1°C。气象台把暴雪预警升到橙色。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "0°C。超市的米面和电池开始整箱走。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-1°C。风把雪吹得打在脸上疼。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-3°C。楼下的车已经找不到了。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-4°C。物业通知扫雪车进不来。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-5°C。楼道里堆了从阳台扫下来的雪。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-6°C。有人说这场雪要下三天。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-10°C。门被雪堵住了，只推开一道缝。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-11°C。雪堆到一层楼窗台那么高。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-12°C。水管冻住了，得化雪才有水。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-12°C。化一锅雪要烧掉不少燃料。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-13°C。屋里冷到哈气结在窗上。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-13°C。有人把雪装进桶里搬进屋化。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-12°C。为了省燃料，一天只化一次水。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-12°C。厚衣服湿了就不保暖，晾不干。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-11°C。邻居来敲门，问能不能借点柴。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-11°C。有人的阳台被雪压出了裂缝。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-10°C。铲雪的队伍清到了楼门口。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-10°C。雪停了，风还很大。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "-9°C。路上能过人了，店还关着。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "-9°C。开始化雪，屋檐上挂了冰凌。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "-8°C。门能全开了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "暴雪是这一族里最不缺水的灾难，可它偏偏让水变成最贵的东西。雪就在门外，取之不尽，但每一口能喝的水都要先烧掉一份燃料。于是『水』和『燃料』这两笔账在这一场被绑成了一笔：你省下的水，是用燃料换的。",
    decisions: ["雪就在门口，但化它的燃料是硬约束，一天化几次要定量", "厚衣服湿了不保暖又晾不干，换洗与省燃料只能选一头", "阳台积着半人高的雪，压塌的风险与出门清雪的花费怎么权衡"],
    notes: "用到维度 1/2/3/4/5/6/7/8/11/13/14，共 11 个。主打维度 1（dailyDrain.fuel 3，比寒潮的 2 多一份，多的那份是化雪的钱）与 13（categoryEfficiency.warmth 0.8：湿衣服失效）。与寒潮不撞：寒潮是干冷，腐坏最慢、水还能正常取用；本场把水源与燃料绑在一起，还动了搬运与空间（积雪占地方）。"
  },
{
    id: "hanluwind",
    name: "寒露风",
    family: "温度",
    level: "L3",
    tier: 2,
    axis: "体感与作业：温度表看着还行，风把体感压下去十度，也把区域的庄稼和海上的船一起停下",
    temperatures: {
      [0]: 12,
      [3]: 11,
      [7]: 10,
      [11]: 11,
      [14]: 12,
      [-7]: 16,
      [-4]: 15,
      [-1]: 14
    },
    spoilRate: 1.1,
    dailyDrain: {
      fuel: 1
    },
    priorityCategories: ["water", "warmth"],
    windowScene: "cold-wind-field",
    shelterDecayPerDay: -1.2,
    restEfficiency: 0.7,
    carryFactor: 0.6,
    shopSupplyFactor: 0.8,
    eventPoolWeights: {
      cold: 2,
      market: 2,
      supply: 2
    },
    categoryEfficiency: {
      food: 0.75
    },
    healthRiskPerDay: 1,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "16°C。风起来了，预报说要刮一阵。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "15°C。晾的衣服被吹得满地跑。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "14°C。气温不高，站一会儿手就凉。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "13°C。气象台说这是寒露风。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "12°C。风把路边的小树吹得歪着。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "12°C。晚上睡觉能听见风一直响。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "12°C。风连着刮，一天比一天硬。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "12°C。预报说体感只有两三度。"
      },
      {
        day: 1,
        severity: 1,
        hint: "11°C。走在风里，脸被吹得发紧。"
      },
      {
        day: 2,
        severity: 1,
        hint: "11°C。拎东西逆着风走，几步就得歇。"
      },
      {
        day: 3,
        severity: 1,
        hint: "10°C。地里的晚稻灌浆被打断。"
      },
      {
        day: 4,
        severity: 1,
        hint: "10°C。近海的船几天没下水。"
      },
      {
        day: 5,
        severity: 1,
        hint: "10°C。晾在阳台的菜干被吹没了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。风把路口的广告牌刮倒了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "11°C。菜场里的海货少了一半。"
      },
      {
        day: 8,
        severity: 1,
        hint: "11°C。有人缩在楼道里避风。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "11°C。嘴唇吹得开裂，喝水也不解。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "11°C。有人拿冻坏的菜喂了牲口。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "12°C。气象台说风要转小了。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "12°C。风还是大，只是不那么冷了。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "12°C。楼下的树停住了晃动。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "12°C。风停了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "温度表停在十度出头，谁看都觉得不冷，可风把体感压到两三度。真正被停下的却是地里的庄稼和海上的船：作物错过了那几天，近海作业几天不出海，菜价与海货一起紧。这一场逼你按风的大小排活，而不是按温度排。",
    decisions: ["温度看着还行，实际风里站不住，出门的窗口要按风来挑", "晾在外面的东西留不住，菜干和衣服都会被吹走，要不要全收回来", "逆风拎东西走几步就喘，搬运量照常估还是砍掉三成"],
    notes: "用到维度 1/2/3/4/5/6/7/9/11/13/15，共 11 个，属 L3。主打维度 13（categoryEfficiency.food 0.75：区域作物受风减产）与 9（shopSupplyFactor 0.8：近海作业停下，菜与海货一起紧）。与热浪不撞：热浪是高温高湿、腐坏最快；本场温度只有十度出头、腐坏接近真实，压力在风造成的体感与区域作业停摆。与倒春寒不撞：那是停暖与取暖断供，本场是风对作物与海上作业的影响。"
  },
{
    id: "huannuan",
    name: "回暖",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "解冻反噬：化雪升温是好事，但室外冷藏失效、路面成泥",
    temperatures: {
      [0]: 2,
      [3]: 5,
      [7]: 7,
      [11]: 8,
      [14]: 9,
      [-7]: -6,
      [-4]: -4,
      [-1]: -1
    },
    spoilRate: 2,
    dailyDrain: {
      medicine: 1
    },
    priorityCategories: ["medicine", "warmth", "tool"],
    windowScene: "thaw-mud",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.85,
    carryFactor: 0.7,
    shopSupplyFactor: 0.75,
    closedShopIds: ["weekend_flea"],
    priceSurcharge: 0.2,
    eventPoolWeights: {
      supply: 2,
      market: 2
    },
    categoryEfficiency: {
      warmth: 0.7,
      food: 0.85
    },
    capacityFactor: 0.85,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "-6°C。预报说要连续回暖一周。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "-4°C。屋檐开始往下滴水。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-3°C。路口的雪被踩成了黑泥。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-1°C。放在阳台的东西开始化冻。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "0°C。室外的天然冰柜不管用了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "1°C。楼道里一天到晚都是湿的。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "2°C。墙根渗出水，腻子开始起皮。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "2°C。冻了一冬的东西，全开始坏。"
      },
      {
        day: 1,
        severity: 1,
        hint: "3°C。阳台的肉有了味，只能扔掉。"
      },
      {
        day: 2,
        severity: 1,
        hint: "4°C。棉衣吸了潮，穿着更冷。"
      },
      {
        day: 3,
        severity: 1,
        hint: "5°C。路面成了泥，鞋底越走越重。"
      },
      {
        day: 4,
        severity: 1,
        hint: "5°C。有一块地方进了水，东西泡着。"
      },
      {
        day: 5,
        severity: 1,
        hint: "6°C。屋角开始发霉。"
      },
      {
        day: 6,
        severity: 1,
        hint: "6°C。有人把存粮搬到高处。"
      },
      {
        day: 7,
        severity: 1,
        hint: "7°C。墙皮一块一块往下掉。"
      },
      {
        day: 8,
        severity: 1,
        hint: "7°C。霉味在屋里散不掉。"
      },
      {
        day: 9,
        severity: 1,
        hint: "7°C。泥路上陷了半只鞋。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "8°C。有人开始咳嗽，说屋里太潮。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "8°C。晒了两天，墙角还是湿的。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "8°C。路干了一段，又化出一段。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "9°C。水退了，地上留着泥印。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "9°C。天晴了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "回升的温度是这场灾难最坏的部分。冷的时候，室外就是一个免费的大冰箱，你的囤货一分电不花地存着；一化冻，这个冰箱断电了，而你的冰箱早就装不下。于是『天变暖』在这一场等于『库房到期』，能救的东西要抢着吃或抢着挪。",
    decisions: ["室外冷藏失效，冻货要么赶紧吃掉要么加工，节奏得重排", "棉衣吸了潮反而不保暖，保暖品在这一场价值打了折，预算往哪挪", "泥路走一趟脚上挂两斤泥，搬运量要不要按路况重估"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/13/14（含 unusableShelfIds）/15，共 13 个。主打维度 2（spoilRate 2.0：外面转暖，室内外冷藏链同时断）与 13（warmth 0.7 受潮失效）。与洪水不撞：洪水是外部进水导致低处空间作废，本场是内部化冻与返潮，且腐坏方向由冷转热、保暖品类因受潮而失效。"
  },
{
    id: "ganrefeng",
    name: "干热风",
    family: "温度",
    level: "L3",
    tier: 2,
    axis: "火险与水源：风把地里的水和城里的水一起抽走，一边喝水不解，一边全城起火",
    temperatures: {
      [0]: 36,
      [3]: 38,
      [7]: 39,
      [11]: 37,
      [14]: 34,
      [-7]: 26,
      [-4]: 28,
      [-1]: 31
    },
    spoilRate: 1.8,
    dailyDrain: {
      water: 2,
      medicine: 1
    },
    priorityCategories: ["water", "medicine", "warmth"],
    windowScene: "dry-hot-wind",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.75,
    carryFactor: 0.65,
    shopSupplyFactor: 0.75,
    closedShopIds: ["gas_station"],
    priceSurcharge: 0.25,
    eventPoolWeights: {
      heat: 3,
      supply: 2,
      water: 2
    },
    categoryEfficiency: {
      water: 0.75
    },
    healthRiskPerDay: 1.2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "26°C。风是热的，吹在身上像烤箱门。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "27°C。湿度不到两成，晾什么都快。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "28°C。晾出去的毛巾十分钟就硬了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "29°C。皮肤一整天都是绷的。"
      },
      {
        day: -3,
        severity: 0.35,
        hint: "30°C。有人一天喝了六瓶水还是渴。"
      },
      {
        day: -2,
        severity: 0.4,
        hint: "31°C。嘴唇和鼻腔开始出血。"
      },
      {
        day: -1,
        severity: 0.6,
        hint: "33°C。风把地里的水汽全抽走了。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "36°C。空气干得嗓子发紧。"
      },
      {
        day: 1,
        severity: 1,
        hint: "37°C。城里连着两处着了火。"
      },
      {
        day: 2,
        severity: 1,
        hint: "38°C。河沟的水位一天降一截。"
      },
      {
        day: 3,
        severity: 1,
        hint: "39°C。有人用桶去接绿化带的水。"
      },
      {
        day: 4,
        severity: 1,
        hint: "39°C。全城禁了野外用火。"
      },
      {
        day: 5,
        severity: 1,
        hint: "39°C。润喉的东西卖光了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "38°C。水厂的进水口快露出来。"
      },
      {
        day: 7,
        severity: 1,
        hint: "38°C。有人半夜起来喝水。"
      },
      {
        day: 8,
        severity: 1,
        hint: "37°C。毛巾擦完脸，脸更干。"
      },
      {
        day: 9,
        severity: 1,
        hint: "37°C。有人咳了起来，说是嗓子裂了。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "36°C。风还在吹，一点雨都没有。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "36°C。夜里能凉一点，还是干。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "35°C。嘴唇上的口子结了痂。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "35°C。风里有一点潮气了。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "34°C。湿度回到四成。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场最磨人的不是热，是干。四十度的湿热会把人放倒，三十几度的干热却让人一直清醒着难受：水喝下去像泼在沙地上，怎么喝都不解。风还同时拉起了两条线：地里的水和城里的水一起被抽走，一边是水源见底，一边是草木干燥到一点就着。",
    decisions: ["水按平常量囤根本不够，但它又重又占地方，加到多少是个赌", "全城火险，补水与防火抢同一份水，优先给哪边", "风把布、纸、药都吹得又干又脆，哪些存货要提前收进屋里"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/13/15，共 12 个，属 L3。主打维度 15（healthRiskPerDay 1.2：干燥对黏膜与呼吸道的持续损伤）与 13（categoryEfficiency.water 0.75：水源蒸发，喝的水更不经用）。与热浪不撞：热浪是 41°C 湿热、腐坏 2.4、压力在夜间活动；本场温度略低但湿度极低、腐坏 1.8，主线是喝不解渴与全城火险。与秋老虎不撞：那是全城冷链过载，本场是全城水源与火险。"
  },
{
    id: "shuangdong",
    name: "霜冻",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "供水系统被冻坏：冷只是背景，断水才是主角",
    temperatures: {
      [0]: 0,
      [3]: -3,
      [7]: -5,
      [11]: -4,
      [14]: -1,
      [-7]: 8,
      [-4]: 6,
      [-1]: 3
    },
    spoilRate: 0.7,
    dailyDrain: {
      fuel: 2,
      water: 1
    },
    priorityCategories: ["water", "fuel", "medicine"],
    windowScene: "frozen-pipe",
    shelterDecayPerDay: -2,
    restEfficiency: 0.7,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["gas_station"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      cold: 3,
      market: 2
    },
    categoryEfficiency: {
      water: 0.7
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "8°C。预报说夜里会降到零下。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "6°C。有人给水管包了一层旧棉。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "4°C。早上窗上结了霜。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "2°C。有人的水管冻住了一截。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "0°C。物业通知夜里可能停水。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-2°C。水管冻裂，楼道里淌着水。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-3°C。停水了，说在抢修。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-4°C。水阀冻住，全楼没水。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-5°C。最冷的一天，也是最缺水的一天。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-5°C。有人下楼去接消防栓的水。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-5°C。水管修好，一夜过去又冻上。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-4°C。化冻的水是黄的，要先放掉。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-4°C。有人攒了一浴缸的水。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-4°C。爆过的那截管子还在漏。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-3°C。水压上不来，高层没水。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-3°C。有人开始烧雪水。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-3°C。五金店的水管配件卖光了。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-2°C。修理工说配件三天后才到。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-2°C。水泵冻坏了一台。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "-1°C。白天化一点，晚上又冻。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "-1°C。开始回暖，管子不再响。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "0°C。水管通了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场冷得并不狠，可它把『水』这条线掐断了。真正的问题不是温度，是水在最冷的那几天没了来源：管子冻裂，全楼停水，而你手里的水要么太沉搬不动，要么太少撑不过去。在这里，水不是靠钱买的，是靠一周前有没有把缸灌满。",
    decisions: ["水管冻裂前把水缸灌满，占掉的空间与撑住的天数怎么换算", "化冻的水要放掉一段才清，那一段是扔掉还是留着他用", "修管子的配件三天后才到，这三天的水量必须提前定死"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/13（water 0.7），共 12 个。主打维度 9（关掉加油站，把供应端掐死）与 13（同样是水，在这里更不管用）。与寒潮不撞：寒潮靠燃料保暖、水还能正常取用；本场温度只到零下五度，主线是供水系统的物理损坏，且腐坏方向温和（0.7 对 0.5 之外还叠加了断水）。早霜已并作本场的强度档变体，属于同一内核的轻档，因此不再单独立场。"
  },
{
    id: "jingfengkuere",
    name: "静风酷热",
    family: "温度",
    level: "L2",
    tier: 2,
    axis: "风没了：热量散不出去，夜里也不降温，睡觉本身在掉状态",
    temperatures: {
      [0]: 40,
      [3]: 42,
      [7]: 43,
      [11]: 42,
      [14]: 40,
      [-7]: 33,
      [-4]: 35,
      [-1]: 38
    },
    spoilRate: 2.6,
    dailyDrain: {
      water: 3,
      medicine: 1
    },
    priorityCategories: ["water", "medicine", "luxury"],
    windowScene: "still-heat-haze",
    shelterDecayPerDay: -1.8,
    restEfficiency: 0.5,
    carryFactor: 0.75,
    priceSurcharge: 0.3,
    eventPoolWeights: {
      heat: 3,
      people: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "33°C。预报说高温还要加上无风。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "35°C。一丝风都没有，树叶不动。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "36°C。电扇开到最大，吹的是热风。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "37°C。楼下连一点阴凉都没有。"
      },
      {
        day: -3,
        severity: 0.35,
        hint: "38°C。有人把凉席铺在了地板上。"
      },
      {
        day: -2,
        severity: 0.4,
        hint: "39°C。气象台说这是静风高温。"
      },
      {
        day: -1,
        severity: 0.6,
        hint: "39°C。热散不出去，晚上也不降。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "40°C。静风，体感比四十度还高。"
      },
      {
        day: 1,
        severity: 1,
        hint: "41°C。风扇吹不动空气，只是在转。"
      },
      {
        day: 2,
        severity: 1,
        hint: "42°C。夜里最低也有三十三度。"
      },
      {
        day: 3,
        severity: 1,
        hint: "43°C。有人在楼道里睡，那儿有点风。"
      },
      {
        day: 4,
        severity: 1,
        hint: "43°C。冰箱不停机，压缩机一直在响。"
      },
      {
        day: 5,
        severity: 1,
        hint: "42°C。有人开始头晕，说站不住。"
      },
      {
        day: 6,
        severity: 1,
        hint: "42°C。冰镇的东西端出门就不凉了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "42°C。树荫也不顶用，空气是烫的。"
      },
      {
        day: 8,
        severity: 1,
        hint: "41°C。有人拿湿毛巾裹着头。"
      },
      {
        day: 9,
        severity: 1,
        hint: "41°C。凉茶和冰袋卖光了。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "41°C。天黑之后热度还挂在天上。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "41°C。有人整夜开着冰箱门乘凉。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "40°C。还是没风。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "40°C。窗外的旗子动了动。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "40°C。起了点风。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场和热浪差的不是温度，是『风』。四十度加三级风还能忍，四十度加一丝风都没有就成了熬人：热量散不出去，夜里也不降，睡觉这件事本身在掉状态。于是真正的对策不是白天躲，是抢在下半夜那点温差里把觉睡掉。",
    decisions: ["夜里只比白天凉一点点，睡觉窗口要不要整个挪到后半夜", "冰镇类的东西端出去就不凉，预算要不要投在它们上面", "冰箱整夜不停机，电与存货损耗只能保一头"],
    notes: "用到维度 1/2/3/4/5/6/7/10/11，共 9 个。主打维度 6（restEfficiency 0.5，全案最低，把『睡觉』变成一场亏本的买卖）与 10（物价加成）。为什么 L2：压力落在消耗、休息、搬运与物价。与热浪不撞：热浪有风、白天最热、腐坏 2.4；本场静风、夜里不降温、腐坏 2.6，且休息效率是全案最低。自评这是本批最薄的一场，它与热浪的底色最接近。"
  },
{
    id: "shileng",
    name: "湿冷",
    family: "温度",
    level: "L3",
    tier: 2,
    axis: "潮湿削掉保暖：衣服是湿的就不挡寒，烘干还要另烧一份燃料",
    temperatures: {
      [0]: 5,
      [3]: 4,
      [7]: 3,
      [11]: 3,
      [14]: 4,
      [-7]: 9,
      [-4]: 8,
      [-1]: 7
    },
    spoilRate: 1.3,
    dailyDrain: {
      medicine: 1,
      fuel: 1
    },
    priorityCategories: ["medicine", "fuel", "tool"],
    windowScene: "cold-drizzle",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    shopSupplyFactor: 0.8,
    priceSurcharge: 0.2,
    eventPoolWeights: {
      cold: 3,
      market: 2
    },
    categoryEfficiency: {
      warmth: 0.75
    },
    healthRiskPerDay: 1.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "9°C。雨下了起来，不大，不停。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "8°C。衣服晾三天还是潮的。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "7°C。湿气往骨头里钻。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "7°C。有人说湿冷比零下还难受。"
      },
      {
        day: -3,
        severity: 0.35,
        hint: "6°C。被子摸上去是凉的。"
      },
      {
        day: -2,
        severity: 0.4,
        hint: "5°C。取暖器烤不干屋里的潮。"
      },
      {
        day: -1,
        severity: 0.6,
        hint: "5°C。雨还在下，一天比一天冷。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "5°C。冷雨连着下，屋里屋外一样潮。"
      },
      {
        day: 1,
        severity: 1,
        hint: "4°C。厚衣服穿着也是潮的。"
      },
      {
        day: 2,
        severity: 1,
        hint: "4°C。有人开始咳嗽，止不住。"
      },
      {
        day: 3,
        severity: 1,
        hint: "4°C。取暖要先把屋子烤干，燃料翻倍。"
      },
      {
        day: 4,
        severity: 1,
        hint: "3°C。墙根渗水，被褥返潮。"
      },
      {
        day: 5,
        severity: 1,
        hint: "3°C。关节疼的人起不来床。"
      },
      {
        day: 6,
        severity: 1,
        hint: "3°C。感冒药和止咳药卖得快。"
      },
      {
        day: 7,
        severity: 1,
        hint: "3°C。有人把被子拿到楼道里烘。"
      },
      {
        day: 8,
        severity: 1,
        hint: "3°C。炉子烧了一夜，屋子还是凉的。"
      },
      {
        day: 9,
        severity: 1,
        hint: "3°C。潮衣贴身穿，容易着凉。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "3°C。药店的感冒灵断了货。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "4°C。雨小了一阵，又下起来。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "4°C。有人开始烧炭，屋里不敢关窗。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "4°C。雨停了半天，潮气还在。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "4°C。出太阳了，被子终于能晒。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场的温度只有三五度，比下雪的场次高得多，却更伤人。湿冷会让保暖品失效一截：衣服是湿的就不挡寒，而把它烘干又要烧掉另一份燃料。于是『保暖』在这里成了双份支出，一件用来穿，一份用来把穿的那件弄干。",
    decisions: ["衣服湿了不保暖，烘干要多烧燃料，换洗频率要不要降下来", "冷雨里的咳嗽拖不得，药品预算要不要压在感冒这一类上", "炭炉取暖不敢关窗，通风与保温只能选一个"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/13（warmth 0.75）/15（1.5），共 12 个。主打维度 13（保暖品类因受潮打折）与 15（湿冷对身体的持续损耗）。与寒潮不撞：寒潮是干冷极寒、腐坏最慢，本场温度只到三五度、腐坏偏快（1.3），压力在潮湿对保暖品与健康的双重削弱。"
  },
{
    id: "fenfeng",
    name: "焚风",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "来不及：温度几小时涨十几度，每种应对都慢半拍",
    temperatures: {
      [0]: 30,
      [3]: 38,
      [7]: 41,
      [11]: 39,
      [14]: 33,
      [-7]: 18,
      [-4]: 20,
      [-1]: 24
    },
    spoilRate: 2.4,
    dailyDrain: {
      water: 2,
      medicine: 1
    },
    priorityCategories: ["food", "medicine", "luxury"],
    windowScene: "foehn-wall",
    shelterDecayPerDay: -2,
    restEfficiency: 0.7,
    carryFactor: 0.7,
    priceSurcharge: 0.35,
    eventPoolWeights: {
      heat: 3,
      panic: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      food: 0.7
    },
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "18°C。山那边的风翻过来，先热了一层。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "20°C。预报说这风会越来越热。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "22°C。一小时里升了三度。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "24°C。有人还穿着早上出门的衣服。"
      },
      {
        day: -3,
        severity: 0.35,
        hint: "26°C。风是烫的，带着一股干味。"
      },
      {
        day: -2,
        severity: 0.4,
        hint: "28°C。晾的东西一小时就干透了。"
      },
      {
        day: -1,
        severity: 0.6,
        hint: "30°C。有人说这风要压下来。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "30°C。一夜之间升了十几度。"
      },
      {
        day: 1,
        severity: 1,
        hint: "34°C。冰箱跟不上升温的速度。"
      },
      {
        day: 2,
        severity: 1,
        hint: "38°C。冻着的东西开始化，一件接一件。"
      },
      {
        day: 3,
        severity: 1,
        hint: "40°C。鲜货在半天之内陆续变质。"
      },
      {
        day: 4,
        severity: 1,
        hint: "41°C。有人在楼道里分快坏的东西。"
      },
      {
        day: 5,
        severity: 1,
        hint: "41°C。冰柜结了厚霜，效率掉了一截。"
      },
      {
        day: 6,
        severity: 1,
        hint: "40°C。熟食放不住一顿。"
      },
      {
        day: 7,
        severity: 1,
        hint: "40°C。有人一天之内把肉全做成了卤味。"
      },
      {
        day: 8,
        severity: 1,
        hint: "39°C。风吹得窗户关不严。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "39°C。有人在楼下吵，说谁占了楼道。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "38°C。还有东西在陆续变坏。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "37°C。风小了一点，温度也退了一点。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "36°C。化掉的东西差不多清完了。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "35°C。屋里终于不那么热。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "33°C。风停了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场最贵的不是热，是『快』。温度在几小时里涨十几度，快到每种应对都慢半拍：等到你想起把冻货挪走，它已经开始化了；等到你想起要处理鲜食，它已经变味了。核心不是怎么降温，是怎么在反应过来之前先动手。",
    decisions: ["温度几小时涨十几度，冻货要么先吃要么现做，等不了", "处理鲜食要花掉一整天，行动点全押上去还是保一部分", "邻居来分东西说明大家都在抢时间，门开不开要先定下来"],
    notes: "用到维度 1/2/3/4/5/6/7/10/11/12/13（food 0.7）/16（fefo 2），共 12 个。主打维度 2 与 13 的组合（骤热让鲜食迅速失效）与 16（临期优先从加分项变成保命项）。与热浪不撞：热浪是持续高温、压力在水与药；本场是短时暴升、压力在『来不及』，腐坏更快（2.4）但持续时间短，且 NPC 因抢时间而更活跃。"
  },
{
    id: "jihan_extreme",
    name: "极寒",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "暴露即损毁：室外没遮没挡的东西，一晚上全冻坏",
    temperatures: {
      [0]: -35,
      [3]: -40,
      [7]: -42,
      [11]: -38,
      [14]: -30,
      [-7]: -15,
      [-4]: -20,
      [-1]: -28
    },
    spoilRate: 0.35,
    dailyDrain: {
      fuel: 3,
      food: 1
    },
    priorityCategories: ["fuel", "warmth", "medicine"],
    windowScene: "deep-freeze-outdoor",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.5,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.55,
    closedShopIds: ["gas_station"],
    eventPoolWeights: {
      cold: 4,
      supply: 3
    },
    npcVisitFactor: 0.5,
    categoryEfficiency: {
      warmth: 0.65
    },
    healthRiskPerDay: 2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "-15°C。预报说有一股极地空气要南下。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "-18°C。有人给窗子加了第二层塑料膜。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-20°C。超市的煤和暖贴被整箱搬走。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-22°C。楼道的暖气管烧得发烫。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-25°C。晚归的人呼出的气结在围巾上。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-27°C。小区通知把水管放空防冻。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-30°C。夜里能听见窗户在响。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-35°C。放在阳台的东西一夜就冻裂了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-38°C。手套摘下来两分钟就没知觉。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-40°C。水管冻裂，电池也放不出电。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-41°C。外面没有一样东西是软的。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-42°C。最冷的一天，白天和夜里一样黑。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-41°C。有人把化开的雪水又冻回桶里。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-40°C。暖气烧到最旺，屋里还是十来度。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-40°C。燃气压力不够，锅炉反复熄火。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-39°C。有人一天只出一次门，办完所有事。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "-38°C。邻居来敲门，问能不能匀点燃料。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-37°C。售水点排起队，水管还没通。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-36°C。预报说这波冷要到头了。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "-34°C。中午的太阳晒着也不暖。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "-32°C。开始有车能打着火了。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "-30°C。风小了些。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "极寒里最先坏的不是人和食物，是电和水。零下四十度之下，水管、电池、电线比身体先扛不住，于是『有没有取暖设备』变得不重要，『取暖还有没有电』才重要。这一场真正冻住的不是某个人，是整个系统。",
    decisions: ["燃料只够把一间屋子烧暖，是集中住进一间还是各守各的屋", "水管和电比人先坏，是先把水缸灌满还是先备足取暖的燃料", "户外的东西冻坏了拿不回来，冻硬的口粮要不要现在就处理"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/11/12/13/15，共 13 个。主打维度 1（dailyDrain.fuel 3：极寒把取暖变成持续的硬支出）与 13（categoryEfficiency.warmth 0.65：零下四十度里保暖品效能在下降）。与常规温度家族不撞：寒潮只到零下十几度且以腐坏变慢为唯一重点，本场温度压到零下四十二度、腐坏压到 0.35，主线是户外暴露物与基础设施先坏，刚需也从燃料保暖挪到燃料+保暖+药。"
  },
{
    id: "redome_heat",
    name: "热穹顶",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "热被扣住：白天存的热夜里放不出去，一天比一天难受",
    temperatures: {
      [0]: 43,
      [3]: 46,
      [7]: 46,
      [11]: 45,
      [14]: 42,
      [-7]: 30,
      [-4]: 34,
      [-1]: 38
    },
    spoilRate: 2.8,
    dailyDrain: {
      water: 3,
      medicine: 1
    },
    priorityCategories: ["water", "medicine", "tool"],
    windowScene: "heat-dome-night",
    shelterDecayPerDay: -2.2,
    restEfficiency: 0.55,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["market"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      heat: 4,
      people: 2
    },
    npcVisitFactor: 1.1,
    healthRiskPerDay: 2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "30°C。预报说有个热穹顶压过来。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "32°C。一丝风都没有，树叶不动。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "34°C。夜里开窗也没有凉气进来。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "36°C。便利店的水开始成箱走。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "37°C。有人说这次的热要压好几天。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "39°C。晚上十点还有三十八度。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "41°C。凌晨四点最低也有三十七度。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "43°C。白天和夜里几乎没差。"
      },
      {
        day: 1,
        severity: 1,
        hint: "44°C。空调外机不停，电表走得飞快。"
      },
      {
        day: 2,
        severity: 1,
        hint: "45°C。有人整夜坐在楼道里。"
      },
      {
        day: 3,
        severity: 1,
        hint: "46°C。夜里最低还有四十度。"
      },
      {
        day: 4,
        severity: 1,
        hint: "46°C。睡一整晚像出了一趟门。"
      },
      {
        day: 5,
        severity: 1,
        hint: "46°C。冰袋和凉席当天就卖光。"
      },
      {
        day: 6,
        severity: 1,
        hint: "45°C。有人说头晕，站不住。"
      },
      {
        day: 7,
        severity: 1,
        hint: "45°C。楼道比屋里还闷。"
      },
      {
        day: 8,
        severity: 1,
        hint: "44°C。有人把床挪到了地板上。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "43°C。药店的藿香正气水断了货。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "43°C。夜里的温度只降了两度。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "42°C。预报说热穹顶开始移走。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "42°C。后半夜总算有了点风。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "41°C。凌晨能开窗了。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "40°C。夜里开始降温。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "热穹顶的热是被扣住的。它最强的时候不是第一天，是连着几天之后：白天存进墙体和路面的热，夜里放不出去，第二天再叠一层，于是最难受的是第四第五天。人在前两天就把水和体力用掉大半，剩下的几天最难熬。",
    decisions: ["夜里也不降温，睡觉窗口要不要整个挪到凌晨那三个钟头", "空调整夜不停，电费和存货损耗只能保一头", "白天出门等于风险，采买要不要全押在后半夜一次跑完"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/15，共 13 个。主打维度 6（restEfficiency 0.55：夜里不放热，睡觉本身在掉状态）与 11（eventPoolWeights 里 heat 权重 4）。与常规温度家族不撞：热浪白天最热、有风、腐坏 2.4，静风酷热的主线是『风没了』；本场是热穹顶，热被逐日累积、峰值出现在第四第五天，腐坏更高（2.8），刚需为水+药+工具，且物价加成更高。"
  },
{
    id: "ice_age",
    name: "冰河期",
    family: "温度",
    level: "L4",
    tier: 4,
    axis: "季节被抹掉：温度连着几十天单向后退，年历不再说明任何事",
    temperatures: {
      [0]: -9,
      [3]: -16,
      [7]: -22,
      [11]: -24,
      [14]: -20,
      [-7]: 5,
      [-4]: 2,
      [-1]: -3
    },
    spoilRate: 0.4,
    dailyDrain: {
      fuel: 3,
      food: 2
    },
    priorityCategories: ["fuel", "food", "warmth"],
    windowScene: "endless-winter-slide",
    shelterDecayPerDay: -4,
    restEfficiency: 0.45,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["gas_station", "market"],
    priceSurcharge: 0.6,
    eventPoolWeights: {
      cold: 4,
      dark: 2,
      limit: 2
    },
    npcVisitFactor: 0.4,
    categoryEfficiency: {
      food: 0.6,
      warmth: 0.7
    },
    capacityFactor: 0.8,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 2.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "5°C。预报说未来一季都会偏冷。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "3°C。有人还穿着秋天的外套。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "1°C。菜市场的菜价抬了一档。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-1°C。早上第一次结了薄冰。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-4°C。有人说冷空气一波接一波。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-6°C。供暖提前开了，说怕烧不够。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-8°C。预报把它改成了长期趋势。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-9°C。这一天才刚刚开始往回退。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-12°C。温度一天比一天低，没有回头。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-15°C。有人把水缸灌满防冻。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-17°C。菜地里的东西全冻实了。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-19°C。煤和柴的价格翻了一倍。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-21°C。有人把不用的房间门封死。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-22°C。白天也升不到零下十五度。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-23°C。树木在夜里冻得裂开。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-24°C。最冷的一天，回暖没有迹象。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-24°C。有人一天只吃两顿省燃料。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-23°C。燃料店的存货见底。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-22°C。有人在楼道里烧起了旧纸板。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "-21°C。温度不再往下掉了。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "-21°C。中午能见到一点太阳。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "-20°C。还没回暖，但不再更冷。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "冰河期看着是更长的冷，真正的变化是它没有尽头。别的寒潮你还能算日子，这一场算不了：温度连着几十天往下走，于是先扛过这几天再说的策略直接崩掉。真正管用的不是多囤燃料，是把每天的消耗压到最低，让它撑得比灾难更久。",
    decisions: ["看不出头，囤货的周期该按一季还是一年算", "燃料与食物都在慢慢见底，每天的定量要不要现在就压低", "有的房间已经不打算再用，是封起来省热还是留作储藏"],
    notes: "用到维度 1~15，共 15 个。本场未使用维度 17（specialMechanics），因为引擎尚未实现该字段，写了会静默失效；L4 由 1~16 维中的 15 个达成。主打维度 6（restEfficiency 0.45：长期低温下休息本身在掉状态）与 14（capacityFactor 0.8 加摘掉 shelf_b：积雪与冻损让可用空间缩水）。与常规温度家族不撞：寒潮是几天内的极寒、暴雪是降水事件，本场主线是『季节被抹掉』，数十天单向降温让囤货周期失去意义，腐坏压到 0.4 而日耗与空间同时吃紧。"
  },
{
    id: "volcanic_winter",
    name: "火山冬天",
    family: "温度",
    level: "L4",
    tier: 4,
    axis: "光照与温度双杀：火山灰遮住太阳，白天也亮不起来",
    temperatures: {
      [0]: -2,
      [3]: -6,
      [7]: -9,
      [11]: -10,
      [14]: -7,
      [-7]: 8,
      [-4]: 6,
      [-1]: 2
    },
    spoilRate: 0.5,
    dailyDrain: {
      fuel: 2,
      water: 1
    },
    priorityCategories: ["food", "warmth", "water"],
    windowScene: "ash-dimmed-sky",
    shelterDecayPerDay: -3,
    restEfficiency: 0.55,
    carryFactor: 0.5,
    actionPointDelta: -1,
    shopSupplyFactor: 0.4,
    closedShopIds: ["market", "wholesale"],
    priceSurcharge: 0.7,
    eventPoolWeights: {
      dark: 4,
      supply: 3,
      limit: 2
    },
    npcVisitFactor: 0.7,
    categoryEfficiency: {
      water: 0.6,
      food: 0.7
    },
    capacityFactor: 0.75,
    unusableShelfIds: ["shelf_c"],
    healthRiskPerDay: 2.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "8°C。远处那座火山喷了，灰往上飘。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "6°C。天一直是灰的，太阳只剩个红点。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "4°C。阳台上落了一层灰，擦不完。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "2°C。中午的天和傍晚一样暗。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "0°C。有人说灰会把太阳挡上很久。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-1°C。白天不敢开窗，灰往里钻。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-1°C。街上有人戴起了口罩和帽子。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-2°C。白天也黑，路灯整天亮着。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-3°C。灰落进敞口的水缸，水变浑了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-4°C。白天的温度升不起来。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-5°C。有人烧水前先滤一遍灰。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-6°C。温度比昨天又低了两度。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-7°C。中午的天，像是傍晚。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-8°C。有人分不清是早上还是下午。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-9°C。最暗的一天，白天也开着灯。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-9°C。灰还在落，屋顶积了薄薄一层。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-9°C。太阳好几天没露过面。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-8°C。有人开始咳嗽，说嗓子发紧。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-8°C。灰薄了一些，天透出一点亮。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "-8°C。供暖的煤快没了。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "-7°C。太阳能透过来一点点了。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "-7°C。天还灰着，但分得清白天。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场的低温和别的冷灾难不一样，它是从天上来的。火山灰遮住太阳，白天也亮不起来，于是白天干活夜里休息这条作息先垮；与此同时，灰落进所有敞口的水，把能喝的水变成要处理的东西。冷只是副产品。",
    decisions: ["太阳被遮住，白天和夜里分不清，作息要按钟表还是按光亮重排", "灰落进敞口的水，饮水要不要全部改成先滤再烧", "天一直灰着，出门的次数压到最低还是照常换取消息"],
    notes: "用到维度 1~15，共 15 个。本场未使用维度 17（specialMechanics），因为引擎尚未实现该字段，写了会静默失效；L4 由 1~16 维中的 15 个达成。主打维度 11（eventPoolWeights 里 dark 权重 4：日照消失压过温度）与 13（categoryEfficiency.water 0.6：灰落进敞口水源）。与常规温度家族不撞：寒潮与暴雪只有冷，本场是光照与温度双杀，事件池以 dark 为主，供应端 shopSupplyFactor 压到 0.4、并同时关掉市场与批发两条大宗渠道。"
  },
{
    id: "polar_vortex",
    name: "极地涡旋",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "窗口极窄：冷来得快走得也快，能做的事只在四十八小时里",
    temperatures: {
      [0]: -8,
      [3]: -18,
      [7]: -20,
      [11]: -10,
      [14]: 2,
      [-7]: 12,
      [-4]: 9,
      [-1]: 4
    },
    spoilRate: 0.8,
    dailyDrain: {
      fuel: 2
    },
    priorityCategories: ["fuel", "tool", "warmth"],
    windowScene: "vortex-swing",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.6,
    carryFactor: 0.75,
    actionPointDelta: 0,
    shopSupplyFactor: 0.7,
    closedShopIds: ["gas_station"],
    priceSurcharge: 0.25,
    eventPoolWeights: {
      cold: 4,
      panic: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      fuel: 0.7
    },
    healthRiskPerDay: 1.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "12°C。预报说北边的冷空气要甩下来。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "10°C。有人开始给窗户贴密封条。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "7°C。超市的取暖器卖得很快。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "4°C。温度一天掉了好几度。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "0°C。气象台把预警升到了橙色。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "-3°C。有人说最冷也就这两天。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "-6°C。预报说四十八小时里到最低。"
      },
      {
        day: 0,
        severity: 0.95,
        hint: "-8°C。一夜之间，路面全冻住了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-14°C。早上还在十度，现在零下十四。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-18°C。水管在最冷的时候冻裂了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-20°C。最冷的一天，风也最大。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-18°C。有人一夜没睡，守着锅炉。"
      },
      {
        day: 5,
        severity: 0.95,
        hint: "-15°C。温度开始往上走了。"
      },
      {
        day: 6,
        severity: 0.9,
        hint: "-10°C。有人说冷空气走得也快。"
      },
      {
        day: 7,
        severity: 0.85,
        hint: "-4°C。中午能见到一点太阳。"
      },
      {
        day: 8,
        severity: 0.8,
        hint: "0°C。冻裂的水管还在漏。"
      },
      {
        day: 9,
        severity: 0.75,
        hint: "2°C。有人把没喝完的水倒掉防冻。"
      },
      {
        day: 10,
        severity: 0.7,
        hint: "5°C。楼道的暖气管凉了下来。"
      },
      {
        day: 11,
        severity: 0.65,
        hint: "7°C。预报说下一波还早。"
      },
      {
        day: 12,
        severity: 0.6,
        hint: "9°C。化开的冰从屋檐往下滴。"
      },
      {
        day: 13,
        severity: 0.55,
        hint: "10°C。有人在楼下晾起了被子。"
      },
      {
        day: 14,
        severity: 0.5,
        hint: "11°C。回暖了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "极地涡旋和普通寒潮最大的不同是它短。冷空气从北边甩下来，三五天就过去，所以你面对的不是熬一个冬天，是在四十八小时里把该做的事全做完。真正会吃亏的，是把它当成慢性灾难、慢慢来的人。",
    decisions: ["冷只来两天，是把两天的活压进四十八小时，还是分开慢慢来", "水管会在这个窗口里冻裂，防冻处理优先还是囤燃料优先", "窗口过去就是回暖，多买的取暖物资要不要现在就出手"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15，共 14 个。主打维度 8（actionPointDelta 0：窗口外不受罚，窗口内必须一次做完）与 12（npcVisitFactor 1.3：抢购让邻居来得更勤）。与常规温度家族不撞：寒潮是长时间维持的极寒，本场是短促的极地涡旋，温度曲线先崩后弹（三天内到零下二十再回正），刚需为燃料+工具+保暖，且它是本批唯一不扣行动点的一场。"
  },
{
    id: "super_heat",
    name: "超级热浪",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "白天整体作废：五十度，柏油融化，白天的时间被清零",
    temperatures: {
      [0]: 46,
      [3]: 49,
      [7]: 50,
      [11]: 49,
      [14]: 46,
      [-7]: 34,
      [-4]: 38,
      [-1]: 42
    },
    spoilRate: 3,
    dailyDrain: {
      water: 3,
      medicine: 1
    },
    priorityCategories: ["water", "medicine", "luxury"],
    windowScene: "melting-asphalt",
    shelterDecayPerDay: -2,
    restEfficiency: 0.5,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      heat: 4,
      water: 3
    },
    npcVisitFactor: 1,
    categoryEfficiency: {
      tool: 0.6
    },
    capacityFactor: 0.85,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "34°C。预报说未来十天要破纪录。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "36°C。路边的小树开始打蔫。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "38°C。便利店的冰水卖空了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "40°C。有人把车停进了地下车库。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "42°C。路上的行人都贴着墙走阴凉。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "44°C。气象台发了红色预警。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "46°C。有人说这次能到五十度。"
      },
      {
        day: 0,
        severity: 0.95,
        hint: "46°C。中午的柏油路开始发软。"
      },
      {
        day: 1,
        severity: 1,
        hint: "48°C。鞋底踩在路面上会陷一点。"
      },
      {
        day: 2,
        severity: 1,
        hint: "49°C。方向盘烫得握不住。"
      },
      {
        day: 3,
        severity: 1,
        hint: "50°C。白天完全不能出门。"
      },
      {
        day: 4,
        severity: 1,
        hint: "50°C。有人把门窗全关死，拉着帘。"
      },
      {
        day: 5,
        severity: 1,
        hint: "50°C。车里的温度计早就顶格了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "49°C。冰箱在白天几乎降不下温。"
      },
      {
        day: 7,
        severity: 1,
        hint: "49°C。有人开始在后半夜去买东西。"
      },
      {
        day: 8,
        severity: 1,
        hint: "48°C。白天街上一个人都没有。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "48°C。药店的解暑药断了货。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "47°C。有人中暑被抬去了诊所。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "47°C。预报说高温要退一点了。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "46°C。傍晚总算能出门走走。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "46°C。柏油重新变硬了。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "46°C。夜里有风了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "超级热浪里，关键不是白天有多热，是白天变得完全没用。五十度之下，采买、干活、出门全停摆，能用的时间只剩后半夜；于是提前囤好的价值被放到最大，囤得少的人在白天没有任何补救的机会。",
    decisions: ["白天完全作废，采买和干活全压到后半夜，一次跑完还是分两晚", "冰箱在白天降不下温，存货要不要在夜里统一处理", "解暑的药和中暑的风险，药品预算留多少"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15，共 15 个。主打维度 2（spoilRate 3.0：全案并列最高，五十度下冷链全断）与 14（capacityFactor 0.85 加摘掉 shelf_a）。与常规温度家族不撞：热浪温度 41 度、有风、腐坏 2.4；本场到 50 度、柏油融化，白天的时间被整体清零，刚需是水+药+奢侈品，事件池 heat 4 配 water 3。"
  },
{
    id: "permafrost_thaw",
    name: "冻土融化",
    family: "温度",
    level: "L4",
    tier: 4,
    axis: "地基与空气双杀：地面塌下去，同时从土里冒出甲烷",
    temperatures: {
      [0]: 0,
      [3]: -2,
      [7]: -3,
      [11]: -1,
      [14]: 2,
      [-7]: 6,
      [-4]: 4,
      [-1]: 2
    },
    spoilRate: 1.6,
    dailyDrain: {
      fuel: 1,
      medicine: 1
    },
    priorityCategories: ["tool", "medicine", "water"],
    windowScene: "sinking-ground",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.6,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      limit: 3,
      supply: 3,
      panic: 2
    },
    npcVisitFactor: 0.6,
    categoryEfficiency: {
      tool: 0.6,
      food: 0.8
    },
    capacityFactor: 0.7,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "6°C。预报说今年化冻比往年早。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "5°C。院子里有一小块地陷了下去。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "4°C。墙根新裂了一道缝。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "4°C。有人发现井水有点发浑。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "3°C。路面上出现了一个坑。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "2°C。有人闻到地库里有股怪味。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "2°C。气象台说今年会冻得很浅。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "0°C。门口的地面开始下沉。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-1°C。有一条路裂开，车得绕行。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-2°C。屋子的墙出现了一道斜缝。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-2°C。有人的地基一边高一边低。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-3°C。管线被错动的土压断了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-3°C。地库里的怪味更重了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-3°C。有人拿检测仪测屋里的气。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-3°C。一处院子塌出了半米深的坑。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-2°C。工具店的支撑设备卖光了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-2°C。有人在墙边顶上了木撑。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-2°C。地基的事修不完。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-1°C。温度降回去一点，土重新冻硬。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "0°C。塌陷的地方不再扩大了。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "1°C。有人开始填那些坑。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "2°C。地面稳住了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "永久冻土融化最反直觉的地方，是它发生在不算冷的时候。土里的冰一化，地基就松，房子歪、路面沉，而气温看着还在零度上下，谁都不觉得是大事。同时冻土里封了很久的甲烷冒出来，闻不到也咳不出来，却一直在。这一场的敌人有两个，都在脚下和空气里。",
    decisions: ["地基还在动，是拿工具顶着继续住，还是先把东西挪到硬地上", "屋里的气闻不出来，要不要花钱买检测设备", "管线被错动的土压断，修它花的体力和时间从哪一项里扣"],
    notes: "用到维度 1~15，共 15 个。本场未使用维度 17（specialMechanics），因为引擎尚未实现该字段，写了会静默失效；L4 由 1~16 维中的 15 个达成。主打维度 14（capacityFactor 0.7 加摘掉 shelf_b：地基塌陷让空间作废）与 15（healthRiskPerDay 2：甲烷与粉尘在屋里持续掉健康）。与常规温度家族不撞：温度只在零度上下，压力来自地面结构失稳与空气，接近结构/空气家族而非冷热。"
  },
{
    id: "hail_storm",
    name: "冰雹",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "连续过境：冰雹不是一阵，是几轮接着来，间隙只够抢修，修完又被砸一遍",
    temperatures: {
      [0]: 2,
      [3]: -2,
      [7]: -3,
      [11]: 1,
      [14]: 6,
      [-7]: 14,
      [-4]: 12,
      [-1]: 8
    },
    spoilRate: 1.3,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["tool", "medicine", "food"],
    windowScene: "hail-crater",
    shelterDecayPerDay: -3,
    restEfficiency: 0.65,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["market"],
    eventPoolWeights: {
      panic: 3,
      supply: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      tool: 0.7
    },
    capacityFactor: 0.8,
    unusableShelfIds: ["shelf_c"],
    healthRiskPerDay: 1.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。预报说这几天午后都有强对流。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。有人把车开进了车库。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "10°C。天边积起了厚厚的云。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "8°C。气象台发了冰雹橙色预警。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "6°C。有人开始往窗上贴胶带。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "4°C。风起来了，云压得很低。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "2°C。预报说冰雹有鸡蛋那么大。"
      },
      {
        day: 0,
        severity: 0.95,
        hint: "2°C。第一阵冰雹砸了下来。"
      },
      {
        day: 1,
        severity: 1,
        hint: "0°C。屋顶被砸出了好几个洞。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-2°C。第二阵又来了，砸了一整夜。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-3°C。有人趁着间隙上了屋顶。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-3°C。油布刚铺好，第三阵就来了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-3°C。冰粒堆在路边，像一层石子。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-2°C。有人被冰雹砸伤了胳膊。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-2°C。屋顶漏了，屋里的东西受潮。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-1°C。五金店的防水布卖光了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "0°C。这一轮过去，天还是没开。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "1°C。碎玻璃和冰粒还没清完。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "2°C。第四场对流云还在远处。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "3°C。云散了，太阳出来。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "4°C。白天开始化冰。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "6°C。路上的冰全化了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "冰雹砸的全是搬不走的东西，而这一场真正难的是它一轮接一轮：上一阵砸穿的屋顶还没补，下一阵又来。修与不修都亏，能动的只有把怕砸的东西提前收进屋。",
    decisions: ["第一阵过去只有几个钟头，抢修屋顶和遮车只能选一样", "怕砸的东西收进屋又占地方，哪些必须收、哪些可以赌", "冰雹砸伤会一轮轮出现，药品里给外伤留多少"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/11/12/13/14（含 unusableShelfIds）/15，共 14 个，属 L3。主打维度 5（shelterDecayPerDay -3：屋顶被多轮砸穿，遮蔽在持续损失）与 8（actionPointDelta -1：一轮砸完一轮补，行动被抢修吃掉）。与冻雨、暴雪不撞：那是结冰与降水，本场是多轮颗粒打击，空隙只够抢修。"
  },
{
    id: "super_thunderstorm",
    name: "超级雷暴",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "按天累积：雷暴一轮接一轮，断电一次比一次长，积水一次比一次深",
    temperatures: {
      [0]: 14,
      [3]: 13,
      [7]: 13,
      [11]: 15,
      [14]: 17,
      [-7]: 20,
      [-4]: 19,
      [-1]: 17
    },
    spoilRate: 1.6,
    fridgeDead: true,
    dailyDrain: {
      water: 1,
      food: 1
    },
    priorityCategories: ["food", "water", "tool"],
    windowScene: "supercell-rain",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.65,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["gas_station"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      water: 3,
      panic: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      water: 0.7
    },
    healthRiskPerDay: 1.2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "20°C。预报说这几天每天有雷暴。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "19°C。天闷得厉害，一丝风都没有。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "18°C。有人把充电宝都充满了电。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "17°C。云压得很低，远处在打闪。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "16°C。气象台发了雷电黄色预警。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "15°C。有人说这几天雨会一轮接一轮。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "14°C。风把广告牌吹得直晃。"
      },
      {
        day: 0,
        severity: 0.95,
        hint: "14°C。第一声响雷在头顶炸开。"
      },
      {
        day: 1,
        severity: 1,
        hint: "13°C。雨下成一片，看不清对面。"
      },
      {
        day: 2,
        severity: 1,
        hint: "13°C。停电了，整栋楼都黑了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "13°C。第二场飑线过境，水又深了一截。"
      },
      {
        day: 4,
        severity: 1,
        hint: "13°C。楼道和地下车库进了水。"
      },
      {
        day: 5,
        severity: 1,
        hint: "13°C。电来了两个小时，又断了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "13°C。冻货开始化，一层比一层软。"
      },
      {
        day: 7,
        severity: 1,
        hint: "14°C。有人把冰箱里的东西往外搬。"
      },
      {
        day: 8,
        severity: 1,
        hint: "14°C。第三场雨把积水顶到脚踝。"
      },
      {
        day: 9,
        severity: 1,
        hint: "14°C。水泵停了，高层没水。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "15°C。还有雷声，一阵一阵。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "15°C。雨小了一些。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "16°C。第四轮的云散开了。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "17°C。天开了，太阳照下来。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "17°C。水退了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "雷暴真正掐断的不是电，是冰箱。而这一场厉害在次数：飑线一轮接一轮，每停一次电，冻货就化掉一层，积水就深一截。囤满冷冻柜，在连续的雷暴季里是负债。",
    decisions: ["每停一次电冻货就化一层，是一天内全吃掉还是分批保", "积水一次比一次深，排水和看守哪件先做", "水泵停过几回，蓄的水要按天还是按顿分发"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15，共 14 个，属 L3。主打维度 2（spoilRate 1.6：断电一次次叠加，冷冻链反复中断）与 11（eventPoolWeights.water 3）。与台风不撞：台风是风压与降水，本场是连续雷暴导致的断电与积水按天累积。与冰雹不撞：冰雹是颗粒打击露天物，本场是电与水。"
  },
{
    id: "tornado",
    name: "龙卷",
    family: "温度",
    level: "L4",
    tier: 4,
    axis: "灾后十五天：过境只在几分钟，之后是路径清理、断电、断路与安置一直拖下去",
    temperatures: {
      [0]: 22,
      [3]: 21,
      [7]: 21,
      [11]: 23,
      [14]: 25,
      [-7]: 26,
      [-4]: 25,
      [-1]: 24
    },
    spoilRate: 1.9,
    fridgeDead: true,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["medicine", "tool", "fuel"],
    windowScene: "tornado-path",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.55,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market", "hardware"],
    priceSurcharge: 0.55,
    eventPoolWeights: {
      panic: 4,
      people: 3
    },
    npcVisitFactor: 1.4,
    categoryEfficiency: {
      tool: 0.5
    },
    capacityFactor: 0.6,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "26°C。预报说这几天有强对流，可能出龙卷。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "25°C。闷热，天上压着厚厚的云。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "24°C。有人开始收拾应急包。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "24°C。气象台发了龙卷预警。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "23°C。远处传来像火车一样的声音。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "22°C。有人躲进了地下室。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "22°C。云底压得很低，还打着转。"
      },
      {
        day: 0,
        severity: 0.95,
        hint: "22°C。一条街上的房子被抹平了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "22°C。隔两栋的房子玻璃都没碎。"
      },
      {
        day: 2,
        severity: 1,
        hint: "21°C。电断了，通讯也断了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "21°C。路被断树和碎料堵住。"
      },
      {
        day: 4,
        severity: 1,
        hint: "21°C。有人在废墟里找自己的东西。"
      },
      {
        day: 5,
        severity: 1,
        hint: "21°C。路边全是散落的木板和瓦。"
      },
      {
        day: 6,
        severity: 1,
        hint: "22°C。邻居来敲门，问有没有多的药。"
      },
      {
        day: 7,
        severity: 1,
        hint: "22°C。没塌的屋子开始收留别家的人。"
      },
      {
        day: 8,
        severity: 1,
        hint: "22°C。停着的车被掀翻了两辆。"
      },
      {
        day: 9,
        severity: 1,
        hint: "23°C。救援的人在清理主路。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "23°C。断了的水还没接上。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "23°C。有人把没塌的屋子让给邻居。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "24°C。云早就散了，天一直晴。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "24°C。废墟里有了味道。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "25°C。路清出来了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "龙卷真正留下的不是那几分钟，是过境之后的十五天。路径上的街区断电、断路、满地碎料，最缺的是能清理和支撑的工具；而这条路径只有几百米宽，隔两栋的邻居毫发无损。准备得够不够和住得巧不巧，是两件分开的事。",
    decisions: ["路径外的邻居毫发无损，找他们换东西是眼下最实际的路子", "停水停电能撑几天，要不要把物资往没塌的一侧集中", "被埋在墙下的人要不要去帮，帮了花的体力从哪扣"],
    notes: "用到维度 1~15，共 15 个，属 L4。本场未使用维度 17（specialMechanics），因为引擎尚未实现该字段，写了会静默失效；L4 由 1~16 维中的 15 个达成。主打维度 5（shelterDecayPerDay -3.5：过境后的十五天里遮蔽持续损失）与 14（capacityFactor 0.6 加摘掉 shelf_a：路径内的整块空间没了）。与地震不撞：地震是余震反复，本场是一次过境后的长尾清理、断电、断路与安置，且带有明显的路径内外差别。"
  },
{
    id: "polar_night",
    name: "极夜",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "作息崩坏：长期没有日照，情绪和体力一起往下掉",
    temperatures: {
      [0]: -16,
      [3]: -20,
      [7]: -22,
      [11]: -20,
      [14]: -17,
      [-7]: -5,
      [-4]: -8,
      [-1]: -12
    },
    spoilRate: 0.45,
    dailyDrain: {
      fuel: 2,
      food: 1
    },
    priorityCategories: ["medicine", "luxury", "food"],
    windowScene: "no-sun-days",
    shelterDecayPerDay: -2,
    restEfficiency: 0.4,
    carryFactor: 0.8,
    actionPointDelta: -1,
    shopSupplyFactor: 0.75,
    closedShopIds: ["weekend_flea"],
    priceSurcharge: 0.2,
    eventPoolWeights: {
      dark: 4,
      people: 2
    },
    npcVisitFactor: 0.7,
    categoryEfficiency: {
      luxury: 0.6
    },
    healthRiskPerDay: 2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "-5°C。预报说太阳要很多天不露面。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "-8°C。天亮的样子和傍晚没区别。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-10°C。有人一下午都以为是晚上。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-12°C。路灯一整天亮着。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "-14°C。有人白天补觉，越睡越沉。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "-15°C。屋里分不清是几点。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "-16°C。有人整夜醒着，白天睡不踏实。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-16°C。太阳没有升起来。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-18°C。有人说已经好几天没见光了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-20°C。楼里的人都蔫着，话很少。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-20°C。有人开始添置能照亮的灯。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-21°C。白天和夜里是同一个颜色。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-22°C。有人睡了一整天还是累。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-22°C。最冷的一天，也是最长的一夜。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-22°C。有人在楼道里点着灯待着。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-22°C。提神和安眠的东西都卖得快。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-21°C。有人开始记不住是星期几。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-21°C。情绪低的人多了起来。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-20°C。预报说太阳快回来了。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "-19°C。天边有一丝亮光。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "-18°C。有人守在东边的窗子。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "-17°C。太阳露出来了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "极夜里最缺的不是吃的，是白天。太阳连着几十天不升起，人的作息整个乱掉：白天睡不着，夜里醒着，体力和情绪一起往下掉。于是能定住作息的那点灯，和让人好受的那点东西，比多囤一袋米更有用。",
    decisions: ["白天睡不着夜里醒着，作息要不要靠灯强行定回来", "能让人好受的东西和能顶饿的粮，预算往哪边多给", "长期没光，是缩减活动只维持基本作息，还是照常安排"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15，共 14 个。主打维度 6（restEfficiency 0.4：作息崩坏，休息效率全案最低）与 13（categoryEfficiency.luxury 0.6：能让人好受的东西也被磨掉）。与常规温度家族不撞：温度只到零下二十度，压力是长期无日照造成的作息与情绪，事件池以 dark 为主，刚需是药+奢侈品+食。"
  },
{
    id: "freezing_rain_storm",
    name: "冻雨暴",
    family: "温度",
    level: "L3",
    tier: 3,
    axis: "叠冰压垮：一层压一层的冰，把头顶的户外设施拖塌",
    temperatures: {
      [0]: -2,
      [3]: -3,
      [7]: -4,
      [11]: -2,
      [14]: 0,
      [-7]: 1,
      [-4]: 0,
      [-1]: -1
    },
    spoilRate: 0.7,
    fridgeDead: true,
    dailyDrain: {
      fuel: 1,
      medicine: 1
    },
    priorityCategories: ["tool", "warmth", "medicine"],
    windowScene: "ice-load-collapse",
    shelterDecayPerDay: -3,
    restEfficiency: 0.6,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.55,
    closedShopIds: ["gas_station", "community_store"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      cold: 3,
      queue: 3
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      tool: 0.65
    },
    capacityFactor: 0.75,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "1°C。预报说有一场冻雨要来。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "0°C。雨落在栏杆上，结了一层薄冰。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-1°C。路面上起了一层亮壳。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-1°C。有人给车玻璃除冰，刮不动。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "-2°C。树枝上的冰又厚了一层。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "-2°C。气象台发了冻雨橙色预警。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "-2°C。有人说电线在往下坠。"
      },
      {
        day: 0,
        severity: 0.95,
        hint: "-2°C。停着的车被一层冰封住了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-3°C。门口的台阶成了一面冰坡。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-3°C。有几棵树被冰压断了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-3°C。电线断了，一片小区停了电。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-4°C。最重的一天，屋檐挂了冰凌。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-4°C。有人的太阳能板被压裂了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-4°C。出门要扶着栏杆挪。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-4°C。送菜的车进不来，货架空了一半。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-3°C。有人在鞋上绑了布条。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-3°C。维修的人说电线要换一截。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "-2°C。冰还在，太阳没出来。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "-2°C。中午化了一点，傍晚又冻住。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "-2°C。雨停了，冰开始松动。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "-1°C。屋檐的冰凌掉了下来。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "0°C。路上的冰化开了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "冻雨暴和普通降雪的分界在重量。雪是松的，冰是实心的，一层雨落下来冻成一层冰，再一层压一层，电线、树、屋檐最后都是被压垮的，不是被冻坏的。于是这一场最该防的不是冷，是那些挂在头顶、你看不见的东西。",
    decisions: ["头上的冰凌随时会掉，是先清屋檐还是先顾地面", "电线被冰压断，是等维修还是自己想办法临时接", "出门要扶栏杆走，搬运量要不要主动砍一半换安全"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15，共 15 个。主打维度 14（capacityFactor 0.75 加摘掉 shelf_b：冰压塌棚架，可用空间缩水）与 9（同时关掉加油站与社区店）。与常规温度家族不撞：与冻雨相比，冻雨的压力是路滑与搬运，本场是叠冰压垮头顶设施（电线、树、屋檐），事件池以 cold 配 queue 为主，还叠加了停电与断供。"
  },
  // ═══ 生成内容 灾难-温度 止 ═══,
  // ═══ 生成内容 灾难-生物 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "mold_rain",
    name: "霉雨",
    family: "生物",
    level: "L3",
    tier: 2,
    axis: "湿与霉：东西不是不够，是留不住",
    temperatures: {
      [0]: 20,
      [3]: 21,
      [7]: 22,
      [11]: 22,
      [14]: 21,
      [-7]: 18,
      [-4]: 18,
      [-1]: 19
    },
    spoilRate: 3,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["food", "medicine"],
    windowScene: "damp-wall",
    shelterDecayPerDay: -2,
    restEfficiency: 0.7,
    carryFactor: 0.75,
    actionPointDelta: 0,
    shopSupplyFactor: 0.7,
    priceSurcharge: 0.2,
    eventPoolWeights: {
      water: 3,
      supply: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      food: 0.7,
      warmth: 0.7
    },
    scoreWeights: {
      fefo: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "18°C。雨从昨天起就没停过。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "18°C。晾在阳台的衣服三天没干。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "18°C。墙上开始有水汽，摸着是凉的。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "19°C。米袋底下有点潮。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "19°C。鞋柜里长了白毛。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "20°C。有人说这雨要下一整周。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "20°C。纸箱摸上去是软的。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "20°C。厨房角落的霉斑一天扩了一圈。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "21°C。面粉结块了，掰开里面有丝。"
      },
      {
        day: 2,
        severity: 1,
        hint: "21°C。屋里有股闷味，开窗也一样。"
      },
      {
        day: 3,
        severity: 1,
        hint: "22°C。挂面放了两天就发黏。"
      },
      {
        day: 4,
        severity: 1,
        hint: "22°C。棉被摸着是潮的，盖着不暖。"
      },
      {
        day: 5,
        severity: 1,
        hint: "22°C。罐头是这一场里唯一不坏的。"
      },
      {
        day: 6,
        severity: 1,
        hint: "22°C。药盒上的字洇开了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "22°C。冰箱门一开一关，里面也是潮的。"
      },
      {
        day: 8,
        severity: 1,
        hint: "22°C。有人说吃点霉的会拉肚子。"
      },
      {
        day: 9,
        severity: 1,
        hint: "22°C。地板缝里冒出了小蘑菇。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "22°C。雨小了一阵，屋里反而更闷。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "22°C。开始有人把东西搬到楼道里晾。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "21°C。雨停了半天，又下起来。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "21°C。天气预报说明天转晴。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "21°C。早上出了太阳。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场不是「不够吃」，是「留不住」。 你囤得越多，坏掉的绝对量越大；而最耐放的东西（罐头）偏偏最重，车载一次装不了几件",
    decisions: ["东西烂得比平常快三倍，临期优先在这一场从「加分项」变成「保命项」", "主食的消耗反而更快（受潮结块的只能先吃），但囤粮这件事本身在这一场更不值", "棉被吸了潮就不顶用，保暖品要不要现在就换成更耐放的"],
    notes: "用到维度 1/2/3/4/5/6/7/9/10/11/12/13/16，共 13 个。主打维度 2（spoilRate 3 。 全案最快，与寒潮的 0.5 正好是对立的两端）与 13（categoryEfficiency 打主食 0.7：能吃的变少，于是「够不够」的账要在更短的周期里重算）。与热浪不撞：热浪的腐坏倍率 2.4 且主线是水与药，本场 3.0 且主线是「湿度让所有干货失效」，并且它第一次让 categoryEfficiency 作用在 food 上（热浪打的是 water/medicine 的消耗）。"
  },
{
    id: "rat_infest",
    name: "鼠患",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "仓储与食品链一起爆鼠：批发货场、菜场后仓、小区垃圾站，货在源头就被咬穿",
    temperatures: {
      [0]: 13,
      [3]: 12,
      [7]: 12,
      [11]: 13,
      [14]: 14,
      [-7]: 14,
      [-4]: 14,
      [-1]: 13
    },
    spoilRate: 1.9,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["food", "tool", "medicine"],
    windowScene: "warehouse-rats",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.55,
    closedShopIds: ["wholesale", "market", "community_store"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      supply: 3,
      market: 2,
      panic: 2
    },
    npcVisitFactor: 0.7,
    categoryEfficiency: {
      food: 0.6,
      tool: 0.8
    },
    healthRiskPerDay: 1.5,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。批发货场的墙角堆了一排空米袋。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "14°C。菜场后仓的挂面被咬穿了一箱。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "13°C。垃圾站旁的老鼠白天跑了出来。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "13°C。批发商说这周全城的货要过筛。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "12°C。小区垃圾站三天没清，边上踩出一圈。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "12°C。有人在货场下了整片鼠药。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "13°C。靠墙的米袋被咬穿，粉洒了半尺高。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "13°C。货场一夜咬坏了几十袋。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "12°C。菜场的米面区开始按箱卖。"
      },
      {
        day: 2,
        severity: 1,
        hint: "12°C。批发站关门，说货被咬得没法发。"
      },
      {
        day: 3,
        severity: 1,
        hint: "12°C。社区小店的货架空了一整排。"
      },
      {
        day: 4,
        severity: 1,
        hint: "12°C。有人把整箱货垫高，离地半米。"
      },
      {
        day: 5,
        severity: 1,
        hint: "12°C。垃圾清运停了，鼠开始往楼里走。"
      },
      {
        day: 6,
        severity: 1,
        hint: "12°C。墙根的水泥缝被啃出了洞。"
      },
      {
        day: 7,
        severity: 1,
        hint: "12°C。药店的鼠药和粘板一起卖空。"
      },
      {
        day: 8,
        severity: 1,
        hint: "12°C。灭鼠后安静了几天，又吵起来。"
      },
      {
        day: 9,
        severity: 1,
        hint: "13°C。批发站复秤，退回去的货堆成山。"
      },
      {
        day: 10,
        severity: 1,
        hint: "13°C。有人家的米缸爬进了老鼠。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "13°C。全城的垃圾站开始集中清运。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "13°C。货场的鼠洞被灌了水泥。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "13°C。包装换成铁皮箱，进货慢了一半。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "14°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场最贵的是包装，不是粮食。鼠咬走的量很少，但破口的整批货进不了正规渠道，批发商只收未拆封的箱子。损失发生在纸箱上，粮袋里往往还剩大半。",
    decisions: ["垃圾站没人清，是先把自家垃圾找出路，还是先堵家里的墙缝", "批发断了，是去零售高价补货，还是靠现有存货压着吃", "撒药能压鼠，但药会被猫和鸟带走，先保货还是先保天敌", "货要垫高离墙才躲得开鼠道，垫高费时间，先垫哪一层架"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 9：closedShopIds 一次关掉 wholesale、market、community_store 三家，把压力抬到『食品链在源头就断』的尺度；维度 13 打 food 0.6 与 tool 0.8，被咬破的货和用来封堵的工具一起掉效率。与霉雨不撞：霉雨是湿度让干货从内部结块（spoilRate 3、动 warmth），本场是外力咬穿包装、沿仓储与垃圾线扩散，还叠加鼠药与鼠传病的健康风险。与菌痢不撞：菌痢盯水里的菌，本场盯货架与批发通路。"
  },
{
    id: "outbreak_flu",
    name: "疫情",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "人际传染：有人病了，人就不敢来了，医疗最先见底",
    temperatures: {
      [0]: 6,
      [3]: 6,
      [7]: 5,
      [11]: 6,
      [14]: 7,
      [-7]: 9,
      [-4]: 8,
      [-1]: 7
    },
    spoilRate: 1.1,
    dailyDrain: {
      medicine: 2,
      food: 1
    },
    priorityCategories: ["medicine", "warmth", "luxury"],
    windowScene: "closed-doors",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["clinic", "market", "weekend_flea"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      panic: 3,
      people: 2
    },
    npcVisitFactor: 0.5,
    categoryEfficiency: {
      medicine: 0.6
    },
    healthRiskPerDay: 1.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "9°C。附近门诊排起了队，说是流感。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "8°C。学校提前放假，家长在群里问。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "8°C。药店的感冒药开始限购。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "7°C。单位让有症状的别来上班。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "7°C。楼下诊所挂上了停诊的牌子。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "6°C。超市里的人都戴上了口罩。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "6°C。邻居敲门借药，你没开门。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "6°C。对面楼两户人家窗子一直关着。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "5°C。诊所的队伍排到了马路上。"
      },
      {
        day: 2,
        severity: 1,
        hint: "5°C。敲门的人少了，都隔着门说话。"
      },
      {
        day: 3,
        severity: 1,
        hint: "5°C。药店的退烧药一早卖空。"
      },
      {
        day: 4,
        severity: 1,
        hint: "5°C。楼道里有人咳嗽，走得很急。"
      },
      {
        day: 5,
        severity: 1,
        hint: "5°C。有户人家门口贴了张纸，谢客。"
      },
      {
        day: 6,
        severity: 1,
        hint: "5°C。市场只留一个口进出。"
      },
      {
        day: 7,
        severity: 1,
        hint: "6°C。你在家待到第五天，米见了底。"
      },
      {
        day: 8,
        severity: 1,
        hint: "6°C。有人把药挂在门口换口粮。"
      },
      {
        day: 9,
        severity: 1,
        hint: "6°C。诊所贴出通知，只收重症。"
      },
      {
        day: 10,
        severity: 1,
        hint: "6°C。楼道里两户人家没再开门。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "6°C。菜场的摊位空了一半。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "7°C。街上的人慢慢多起来了。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "7°C。药店补货了，队还是长。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "7°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "热闹在这一场是负资产。串门越多，链条拉得越长，把门关上的那户反而撑得久。另一个反直觉是，最缺的不是药，是敢去药店和诊所这件事，门都关着，队排到街上。",
    decisions: ["邻居敲门借药，开门可能把病带进来，开还是不开", "医疗优先，但诊所已经排到街上，是排队等还是靠家里的存货扛", "人都不敢来往之后消息也断了，要不要冒险出门换一次消息"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 12：npcVisitFactor 0.5 是全案最低，把『没人来』写成压力轴，与骚乱的 1.4 正好相反；维度 9 一次关掉 clinic、market、weekend_flea 三家。维度 13 打 medicine 0.6：药在这一场自己也难保住。与霉雨不撞：霉雨是东西留不住，本场是『人不敢来、医疗先崩』，压力完全在人际与供给。"
  },
{
    id: "dysentery_water",
    name: "菌痢",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "水里有菌，喝下去就病，饮水与医疗一起紧",
    temperatures: {
      [0]: 22,
      [3]: 21,
      [7]: 21,
      [11]: 22,
      [14]: 23,
      [-7]: 24,
      [-4]: 23,
      [-1]: 22
    },
    spoilRate: 1.7,
    dailyDrain: {
      water: 1,
      medicine: 1
    },
    priorityCategories: ["water", "tool", "luxury"],
    windowScene: "brown-tap",
    shelterDecayPerDay: -1,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    shopSupplyFactor: 0.55,
    closedShopIds: ["market", "clinic"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      water: 3,
      panic: 2
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      water: 0.6
    },
    healthRiskPerDay: 2,
    scoreWeights: {
      emergency: 2,
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "24°C。水管里放出来的水有点发黄。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "23°C。楼下有人说喝了水在拉肚子。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "23°C。物业通知，水要烧开再喝。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "22°C。超市的瓶装水开始限购。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "22°C。诊所来了好几个上吐下泻的。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "22°C。有人说净水片能顶一阵。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "21°C。桶装水订不到，得自己去搬。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "21°C。一整天跑了七八趟厕所。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "21°C。瓶装水的货架空了一排。"
      },
      {
        day: 2,
        severity: 1,
        hint: "22°C。诊所门口排满了人，打点滴。"
      },
      {
        day: 3,
        severity: 1,
        hint: "22°C。有人把水烧了又烧，还是不放心。"
      },
      {
        day: 4,
        severity: 1,
        hint: "22°C。菜场的卤味摊全撤了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "22°C。净水片限购，一次只卖两板。"
      },
      {
        day: 6,
        severity: 1,
        hint: "22°C。你把每桶水都滤一遍才敢用。"
      },
      {
        day: 7,
        severity: 1,
        hint: "22°C。有人脱水，被送到了诊所。"
      },
      {
        day: 8,
        severity: 1,
        hint: "23°C。楼下开始发消毒片。"
      },
      {
        day: 9,
        severity: 1,
        hint: "23°C。水里的味道淡了些。"
      },
      {
        day: 10,
        severity: 1,
        hint: "23°C。诊所的补液盐卖完了。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "23°C。说水源那边查出了原因。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "23°C。水管冲洗了一遍，水清了。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "23°C。还有人不敢喝自来水。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "23°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场里多喝水成了陷阱：拉肚子要补水，可当地的水正是病源，喝得多的人反而先躺下。净水的东西比水本身更金贵，它决定你手里的水能不能入口。",
    decisions: ["水要省着喝又要烧开喝，燃料和存水的账得一起算", "补液和净水都在抢，先保能喝的水，还是先保能止泻的药", "菜场的熟食看着省事，但这一场里生冷是最危险的一口"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 14 个（L3）。主打维度 15：healthRiskPerDay 2，喝不干净的水会持续掉健康；维度 13 打 water 0.6，水这一场自身掉效率。与藻华不撞：藻华是水有味、要过滤与烧开（打 water 0.5 且盯 fuel），本场是水里带菌、盯的是医疗与补液的连锁，健康风险更高。"
  },
{
    id: "wasp_swarm",
    name: "胡蜂",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "全城蜂害：屋檐、工地、晾晒面全成了高危区，户外作业与晾晒一起停",
    temperatures: {
      [0]: 30,
      [3]: 31,
      [7]: 32,
      [11]: 31,
      [14]: 30,
      [-7]: 28,
      [-4]: 28,
      [-1]: 29
    },
    spoilRate: 1.6,
    dailyDrain: {
      medicine: 1,
      food: 1
    },
    priorityCategories: ["medicine", "tool"],
    windowScene: "wasp-city",
    shelterDecayPerDay: -1,
    restEfficiency: 0.75,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.7,
    closedShopIds: ["weekend_flea", "community_store"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      people: 3,
      queue: 2,
      panic: 2
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      tool: 1.2
    },
    healthRiskPerDay: 1.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "28°C。全城的屋檐下开始出现泥巢。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "28°C。园林工人被蜇，清扫停在半路。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "29°C。晾在楼下的被子没人敢收。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "29°C。工地停了高处的活，说蜂太多。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "30°C。诊所一天来了十几个被蜇的。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "30°C。抗过敏药开始限购。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "31°C。窗台的作业面全部清空。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "31°C。清晨五点才有人出门干活。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "31°C。被蜇的人排到了诊所门口。"
      },
      {
        day: 2,
        severity: 1,
        hint: "32°C。晾衣杆空了三天，衣服堆在屋里。"
      },
      {
        day: 3,
        severity: 1,
        hint: "32°C。喷剂和长杆一起卖断货。"
      },
      {
        day: 4,
        severity: 1,
        hint: "31°C。城里的快递停了午后那趟。"
      },
      {
        day: 5,
        severity: 1,
        hint: "31°C。有人自己捅巢，被蜇进了医院。"
      },
      {
        day: 6,
        severity: 1,
        hint: "31°C。全城组了清巢队，排期到一周后。"
      },
      {
        day: 7,
        severity: 1,
        hint: "31°C。蜂在楼道灯罩下又做了新巢。"
      },
      {
        day: 8,
        severity: 1,
        hint: "30°C。烟熏压在巢边，人得躲出去半天。"
      },
      {
        day: 9,
        severity: 1,
        hint: "30°C。重体力的活全挪到了天黑后。"
      },
      {
        day: 10,
        severity: 1,
        hint: "30°C。被蜇的人还在增加，孩子居多。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "30°C。天凉了点，蜂不那么爱动。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "30°C。专业队一天摘掉几十个巢。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "30°C。晾衣杆重新挂上，先看一圈天。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "29°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "蜂不追人，它守巢。真正停摆的不是野外，是窗台、晾衣杆和一切高过头的作业面。于是这场灾难把户外按高度分了层：蹲着干的活能干，一抬手就得停。",
    decisions: ["全城清巢要排队一周，是自己动手还是等专业的", "晾晒全停，衣服在屋里阴干，还是冒险挂出去一趟", "抗过敏药和驱蜂装备抢同一份钱，先买哪样", "白天的活干不了，是趁清晨那几个小时抢工，还是整天空着"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 7：carryFactor 0.55，把『户外按高度封闭』写成搬运与作业的硬约束；维度 15 取 1.5 承接蜇伤与就医潮，维度 13 反向取 tool 1.2，防护与驱蜂工具比平时更管用。与疫情不撞：疫情是人际传染、人不敢来；本场是人照来、但户外干不了活。与蝇蛆不撞：蝇蛆盯卫生与水，本场盯户外作业面。原来的胡蜂只写了『阳台和楼道』，本场抬到全城的屋檐、工地、晾晒面与清巢队。"
  },
{
    id: "mosquito_swarm",
    name: "蚊虫",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "全城虫媒疫情：被叮的每一下都在换健康，水和药一起吃紧",
    temperatures: {
      [0]: 30,
      [3]: 31,
      [7]: 31,
      [11]: 30,
      [14]: 29,
      [-7]: 29,
      [-4]: 29,
      [-1]: 30
    },
    spoilRate: 1.7,
    dailyDrain: {
      medicine: 1,
      water: 1
    },
    priorityCategories: ["medicine", "water"],
    windowScene: "dengue-city",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.55,
    closedShopIds: ["clinic", "community_store"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      panic: 3,
      water: 2,
      people: 2
    },
    npcVisitFactor: 0.6,
    categoryEfficiency: {
      medicine: 0.6,
      water: 0.7
    },
    healthRiskPerDay: 2.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "29°C。社区开始登记发热的人。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "29°C。楼下积水里有了孑孓。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "30°C。附近医院报了几例蚊媒病。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "30°C。全城在清积水，一处一处倒。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "31°C。纱窗和蚊帐涨了价。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "31°C。发热门诊排起了长队。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "30°C。有人把敞口的储水桶盖上了。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "30°C。病例数一天比一天多。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "31°C。退烧药和补液盐一起限购。"
      },
      {
        day: 2,
        severity: 1,
        hint: "31°C。小区门口贴了防蚊的通知。"
      },
      {
        day: 3,
        severity: 1,
        hint: "31°C。有人在白天就开始点蚊香。"
      },
      {
        day: 4,
        severity: 1,
        hint: "31°C。医院只收重症，轻症回家隔离。"
      },
      {
        day: 5,
        severity: 1,
        hint: "31°C。全城喷药，晚上味道很大。"
      },
      {
        day: 6,
        severity: 1,
        hint: "31°C。储水的人家开始一群群地倒水。"
      },
      {
        day: 7,
        severity: 1,
        hint: "30°C。孩子发烧，家里不敢出门。"
      },
      {
        day: 8,
        severity: 1,
        hint: "30°C。驱蚊水兑着用，还是不够。"
      },
      {
        day: 9,
        severity: 1,
        hint: "30°C。喷药车一天绕城两趟。"
      },
      {
        day: 10,
        severity: 1,
        hint: "30°C。病例涨得慢了，诊所还在忙。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "30°C。天凉了，蚊子少了些。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "29°C。积水清完一轮，孑孓少多了。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "29°C。医院开始腾出普通病房。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "29°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "防蚊药很快被抢空，真正压住疫情的是把水倒掉。蚊子繁殖的地方，正是你为了防断水囤起来的那些水。囤水和防蚊在这一场里互相拆台。",
    decisions: ["囤的水要盖严，敞口的水桶是蚊子的窝，先处理哪一处", "全城在清积水，自家储水正是病媒源头，要不要倒掉一部分", "门诊排不上，是靠家里的退烧药扛，还是去挤定点医院", "纱窗和蚊帐都缺货，先护孩子睡的那间，还是先护白天的活动区"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 15：healthRiskPerDay 2.5，把『被叮的每一下都在换健康』写成全城虫媒病；维度 13 同时打 medicine 0.6 与 water 0.7，药与水一起吃紧；维度 8 取 -1，病人多、行动被压。与疫情不撞：疫情是人际传染、npcVisitFactor 0.5，本场是人来不来都挡不住、病媒在环境里；与胡蜂不撞：胡蜂占白天户外，本场是全天候的病媒扩散。原蚊虫只写『夜里睡不好』，本场抬到全城登革热式的疫情。"
  },
{
    id: "termite_damage",
    name: "白蚁",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "成片木结构被从里面啃空，房屋与货架一起失稳，能放货的地方先塌",
    temperatures: {
      [0]: 25,
      [3]: 26,
      [7]: 26,
      [11]: 25,
      [14]: 24,
      [-7]: 24,
      [-4]: 24,
      [-1]: 25
    },
    spoilRate: 1.3,
    dailyDrain: {
      tool: 1,
      warmth: 1
    },
    priorityCategories: ["warmth", "tool", "medicine"],
    windowScene: "hollow-blocks",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.7,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["hardware", "market", "wholesale"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      supply: 3,
      neighbor: 2,
      panic: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      tool: 0.7
    },
    capacityFactor: 0.7,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 0.5,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "24°C。一整片老楼的木门框一按就软。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "24°C。屋里的木地板踩上去发空。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "25°C。有人家的货架腿断了，货撒一地。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "25°C。鉴定的人进了三栋木结构楼。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "26°C。整排木货架的背板一抠就掉。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "26°C。师傅说这几栋得整片治。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "25°C。街道通知靠墙那排柜子先清空。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "25°C。凌晨一栋楼的木楼梯塌了半截。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "26°C。两栋楼贴了腾空的告示。"
      },
      {
        day: 2,
        severity: 1,
        hint: "26°C。货架塌了两排，东西挤到地上。"
      },
      {
        day: 3,
        severity: 1,
        hint: "26°C。治蚁要闷药，人和货都得撤。"
      },
      {
        day: 4,
        severity: 1,
        hint: "25°C。五金店的水泥和角铁卖空了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "25°C。有人把木家具全搬到了空地。"
      },
      {
        day: 6,
        severity: 1,
        hint: "25°C。地板撬开一块，底下全是空的。"
      },
      {
        day: 7,
        severity: 1,
        hint: "25°C。剩下的货架都改成了铁脚。"
      },
      {
        day: 8,
        severity: 1,
        hint: "25°C。又查出三栋楼有虫道。"
      },
      {
        day: 9,
        severity: 1,
        hint: "24°C。能放货的地方少了一整片。"
      },
      {
        day: 10,
        severity: 1,
        hint: "24°C。木头的东西都垫高了，靠不住墙。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "24°C。药闷过一遍，地上还是落木屑。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "24°C。新的塌点没再出现。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "24°C。腾空的楼还没让人回去。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "24°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "白蚁啃空的是房子的承重，不是你的货。货一件没少，能放货的地方先塌了；而楼里最先出事的是靠墙、近地那圈木结构，正好是全楼码货的位置。",
    decisions: ["成片楼要腾空，是搬走还是留人守货，风险怎么摊", "货架塌了一整块，东西要往剩下地方挤，先搬重的还是先搬吃的", "治蚁要整片闷药，人和货都得撤两天，撤到哪", "木家具扔了没处放东西，留着靠不住，怎么选"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 capacityFactor 与 unusableShelfIds）/15/16，共 16 个（L3）。主打维度 14 与维度 5：摘掉一整块 shelf_a、capacityFactor 0.7，并把 shelterDecayPerDay 压到 -3.5，让『成片建筑的承重』一起垮；维度 13 打 tool 0.7。与地震不撞：地震是一次性崩塌、损失立刻可见，本场是从内部掏空的慢性损失、以天为单位累积。与原白蚁不撞：原白蚁只写『你家货架和家具』，本场抬到成片木结构建筑群与街道腾空。"
  },
{
    id: "fly_maggot",
    name: "蝇蛆",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "垃圾清运停摆，城区卫生先崩，厨余在楼里发酵，存粮跟着一起废",
    temperatures: {
      [0]: 31,
      [3]: 32,
      [7]: 32,
      [11]: 31,
      [14]: 30,
      [-7]: 30,
      [-4]: 30,
      [-1]: 31
    },
    spoilRate: 3.2,
    dailyDrain: {
      food: 1,
      medicine: 1,
      water: 1
    },
    priorityCategories: ["food", "medicine", "water"],
    windowScene: "garbage-city",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.65,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market", "weekend_flea", "community_store"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      market: 3,
      supply: 2,
      panic: 2
    },
    npcVisitFactor: 0.6,
    categoryEfficiency: {
      food: 0.55,
      medicine: 0.7
    },
    healthRiskPerDay: 2.5,
    scoreWeights: {
      emergency: 3,
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "30°C。清运车两天没来，垃圾桶满了。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "30°C。菜场后面的烂菜叶堆成了小山。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "31°C。垃圾站的味道飘进了整条街。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "31°C。楼道里有人开始往下扔厨余。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "32°C。一袋厨余放一夜，袋口全是蛆。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "32°C。物业说清运车只够跑一半的线。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "31°C。纱窗上落的苍蝇，擦一层又来一层。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "31°C。垃圾桶一掀，底下全是蛆在动。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "32°C。菜场的熟食摊全撤了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "32°C。诊所来了好几个闹肚子的。"
      },
      {
        day: 3,
        severity: 1,
        hint: "32°C。垃圾堆到了花坛边，占了一条道。"
      },
      {
        day: 4,
        severity: 1,
        hint: "32°C。剩饭不敢留，一顿一扔。"
      },
      {
        day: 5,
        severity: 1,
        hint: "32°C。灭蝇的药水和消毒水都卖空。"
      },
      {
        day: 6,
        severity: 1,
        hint: "31°C。厨房的东西全盖上了罩子。"
      },
      {
        day: 7,
        severity: 1,
        hint: "31°C。有人一天拎三趟垃圾下楼。"
      },
      {
        day: 8,
        severity: 1,
        hint: "31°C。冷库里的肉也不敢多放。"
      },
      {
        day: 9,
        severity: 1,
        hint: "31°C。环卫的人来查了一趟垃圾站。"
      },
      {
        day: 10,
        severity: 1,
        hint: "30°C。临时清运点排起了长队。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "30°C。清运车开始加班跑。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "30°C。垃圾站冲了一遍，味淡了。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "30°C。屋里打了两天药，蝇少了。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "30°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场真正吃掉存粮的不是人，是苍蝇。清运一停，厨余在楼道里发酵，蝇在楼里繁殖，你囤在家里的粮跟着一起废掉。断供反而是次要的那一头。",
    decisions: ["垃圾没处扔，堆楼道会招蝇，是走远路去城边倒，还是先堆着", "厨余是蝇源，一天两趟拎出去要花行动点，先清厨余还是先补货", "被蝇沾过的吃食只能扔，先吃新鲜的还是先把冰箱腾空", "消毒水和药抢同一份钱，先买消毒还是先买药"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 2：spoilRate 3.2，全城垃圾在高温里成片发酵；维度 9 一次关掉 market、weekend_flea、community_store 三家，把『清运停摆』写成整条供给的塌方；维度 15 取 2.5 承接肠道病。与霉雨不撞：霉雨靠湿度让干货从内部结块，本场靠清运停摆把病菌带到整片城区；与菌痢不撞：菌痢盯水源，本场盯垃圾与厨余这条线。原蝇蛆只写『楼下垃圾桶』，本场抬到城区卫生体系崩、清运线瘫痪。"
  },
{
    id: "tick_grass",
    name: "蜱虫",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "区域蜱传病流行，户外作业与采集全面受限，上山整片被封",
    temperatures: {
      [0]: 23,
      [3]: 24,
      [7]: 24,
      [11]: 23,
      [14]: 22,
      [-7]: 22,
      [-4]: 22,
      [-1]: 23
    },
    spoilRate: 1.2,
    dailyDrain: {
      medicine: 1
    },
    priorityCategories: ["medicine", "warmth"],
    windowScene: "tick-field",
    shelterDecayPerDay: -1,
    restEfficiency: 0.8,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["community_store", "hardware"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      people: 3,
      supply: 2,
      panic: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      medicine: 0.7
    },
    healthRiskPerDay: 2.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。郊外的草没人割，长得没过膝盖。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "22°C。有人上山采野菜，回来腿上起了红点。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "23°C。卫生院报了几例蜱传病。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "23°C。放牧的人被咬后发烧，住了院。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "24°C。郊野公园拉了警戒线。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "24°C。村里通知上山要扎紧裤脚。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "23°C。孩子从草地回来，身上摸到一只。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "23°C。被咬的地方不疼，第二天才红。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "24°C。卫生院多了几个发烧的病人。"
      },
      {
        day: 2,
        severity: 1,
        hint: "24°C。驱虫药水开始限购。"
      },
      {
        day: 3,
        severity: 1,
        hint: "24°C。采野菜和捡柴的活全停了。"
      },
      {
        day: 4,
        severity: 1,
        hint: "24°C。出门都换上了长衣长裤。"
      },
      {
        day: 5,
        severity: 1,
        hint: "23°C。有人被咬后住进了城里医院。"
      },
      {
        day: 6,
        severity: 1,
        hint: "23°C。草深的地方不让进了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "23°C。家里在翻找有没有带回来的蜱。"
      },
      {
        day: 8,
        severity: 1,
        hint: "23°C。放牧改成了圈养，草料不够。"
      },
      {
        day: 9,
        severity: 1,
        hint: "23°C。镊子和酒精卖得很快。"
      },
      {
        day: 10,
        severity: 1,
        hint: "22°C。有人发烧几天了，还没退。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "22°C。天凉了，草里的蜱少了。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "22°C。郊外的草被割短了一段。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "22°C。被咬的人退了烧，还在观察。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "22°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "蜱咬的那口不疼不痒，被咬的人当天照常出门，把病带到下一片草地。真正的传染源不是蜱，是不知道自己被咬的人。",
    decisions: ["郊外能挖野菜也能捡柴，去还是不去，值不值得裹严一身", "被咬当天没感觉，是每天回来自查一遍，还是先做手头的事", "驱虫药快用完，是省着喷，还是把上山趟数压掉", "牲畜圈起来费草料，放出去有风险，圈还是放"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 15：healthRiskPerDay 2.5 承接区域蜱传病，配合维度 8 的 actionPointDelta -1 与维度 7 的 carryFactor 0.6，把『上山』整片封掉；维度 13 轻打 medicine 0.7。与蚊虫不撞：蚊虫是全城蚊媒、病人多到行动点被压，本场是郊野与山货这条线被切断、入口在『被咬当天无感』。与原蜱虫不撞：原蜱虫只写『公园草地』，本场抬到区域流行的疫区与放牧采集全面受限。"
  },
{
    id: "algae_bloom",
    name: "藻华",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "水源起了藻，水有味不能直接喝，水和药一起吃紧",
    temperatures: {
      [0]: 27,
      [3]: 28,
      [7]: 29,
      [11]: 28,
      [14]: 27,
      [-7]: 25,
      [-4]: 25,
      [-1]: 26
    },
    spoilRate: 1.3,
    dailyDrain: {
      water: 1,
      fuel: 1
    },
    priorityCategories: ["water", "fuel", "medicine"],
    windowScene: "green-water",
    shelterDecayPerDay: -1,
    restEfficiency: 0.7,
    carryFactor: 0.75,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      water: 3,
      people: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      water: 0.5
    },
    healthRiskPerDay: 1.5,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "25°C。自来水有一股土腥味。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "25°C。河面上浮了一层绿色的膜。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "26°C。有人说水房的储水罐该洗了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "26°C。烧开的水还是有股味道。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "27°C。超市的瓶装水卖得比平时快。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "27°C。物业通知，水要先滤再烧。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "27°C。有人喝了水，说胃里不舒服。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "28°C。水龙头放出来的水发绿。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "28°C。桶装水订不到，得去远处拉。"
      },
      {
        day: 2,
        severity: 1,
        hint: "28°C。净水的滤芯换了一茬又一茬。"
      },
      {
        day: 3,
        severity: 1,
        hint: "29°C。烧水要烧得更久，味才淡。"
      },
      {
        day: 4,
        severity: 1,
        hint: "29°C。有人开始上吐下泻，去了诊所。"
      },
      {
        day: 5,
        severity: 1,
        hint: "29°C。瓶装水限购，一人两瓶。"
      },
      {
        day: 6,
        severity: 1,
        hint: "29°C。有人说烧开的水喝着放心些。"
      },
      {
        day: 7,
        severity: 1,
        hint: "28°C。河边的取水口被封了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "28°C。水里的味越来越重。"
      },
      {
        day: 9,
        severity: 1,
        hint: "28°C。诊所来了几个脱水的人。"
      },
      {
        day: 10,
        severity: 1,
        hint: "28°C。居民排队接净化车的水。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "27°C。上游开始清理水面。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "27°C。水里的绿淡了些，味还在。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "27°C。还有人只喝自己滤过的水。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "27°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "水一烧开就没味，于是喝得更多。可藻毒素不怕热，烧掉的只是味，不是毒。这一场里越觉得水干净的人，越可能先倒下。",
    decisions: ["烧开只去味不去毒，是继续烧，还是去找别的水源", "水和燃料同时紧，是省水还是省火，两笔账一起算", "水有味，是跑远路打新水，还是在家滤一遍凑合"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 14 个（L3）。主打维度 13：categoryEfficiency 打 water 0.5，是全案最低的水效；维度 1 的 dailyDrain 同时吃 water 与 fuel，把『烧开』写成一条燃料账；维度 15 取 1.5 承接藻毒的持续风险。与 disaster-10 的菌痢不撞：菌痢是水里带菌、盯医疗与补液的连锁（healthRiskPerDay 2），本场盯的是水要滤要烧带来的燃料吃紧，健康风险更低但水效更差。与霉雨不撞：霉雨是空气湿、东西受潮，本场是水源本身起藻。"
  },
{
    id: "saprophyte",
    name: "腐生菌",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "包装与容器材料全面失效：装东西的家什比里面的东西先烂，供应链级损失",
    temperatures: {
      [0]: 25,
      [3]: 26,
      [7]: 26,
      [11]: 25,
      [14]: 24,
      [-7]: 24,
      [-4]: 24,
      [-1]: 25
    },
    spoilRate: 2.4,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["food", "tool", "luxury"],
    windowScene: "packaging-fail",
    shelterDecayPerDay: -3,
    restEfficiency: 0.8,
    carryFactor: 0.75,
    actionPointDelta: 0,
    shopSupplyFactor: 0.5,
    closedShopIds: ["hardware", "wholesale"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      supply: 3,
      market: 2,
      neighbor: 2
    },
    npcVisitFactor: 1,
    categoryEfficiency: {
      tool: 0.55,
      food: 0.75
    },
    capacityFactor: 0.7,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 0.5,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "24°C。仓库里的纸箱一摞摞塌下来。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "24°C。木托盘的角一按就碎。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "25°C。米袋底下黏在架上，揭不开。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "25°C。真空包装没破，封口先烂了。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "26°C。铁皮盒的接缝锈得发黑。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "26°C。批发商说这周退回来一整批货。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "25°C。塑料桶的内壁开始发毛。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "25°C。一批罐头没吃，盖子先锈穿。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "26°C。仓库的货架整排往下掉。"
      },
      {
        day: 2,
        severity: 1,
        hint: "26°C。散装的干货反而没大碍。"
      },
      {
        day: 3,
        severity: 1,
        hint: "26°C。装东西的桶比里面的东西先坏。"
      },
      {
        day: 4,
        severity: 1,
        hint: "25°C。五金店的密封罐卖空了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "25°C。有人把粮全换进了玻璃罐。"
      },
      {
        day: 6,
        severity: 1,
        hint: "25°C。整批货的包装在同时失效。"
      },
      {
        day: 7,
        severity: 1,
        hint: "25°C。批发站改了只收散装的路子。"
      },
      {
        day: 8,
        severity: 1,
        hint: "25°C。玻璃和陶器一下成了硬通货。"
      },
      {
        day: 9,
        severity: 1,
        hint: "24°C。坏掉的容器清了满满一车。"
      },
      {
        day: 10,
        severity: 1,
        hint: "24°C。有人开始用布把容器擦干。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "24°C。锈蚀的势头慢了下来。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "24°C。新的包装换成了铁皮和玻璃。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "24°C。退回去的货还是压在仓库。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "24°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场先报废的是包装，不是食物。罐头没坏，罐盖先锈穿；真空袋没漏，封口先黏烂。散装的干货反而因为常翻动损失更小，于是囤得越久越亏，装着不动的那些最先烂。",
    decisions: ["容器比内容物先坏，是先抢救吃的，还是先找能装的罐子", "整批货的包装在失效，是赶紧转手换现货，还是自己重新分装", "密封罐和干燥剂都被抢，是省着囤，还是把现有容器重新擦一遍"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/14（含 capacityFactor 与 unusableShelfIds）/15/16，共 15 个（L3）。主打维度 13：categoryEfficiency 打 tool 0.55，全族最低，把『装东西的家什自己失效』写成供应链级损失；维度 14 摘掉 shelf_b、capacityFactor 0.7，维度 5 取 -3 承接材料在成片腐蚀。与霉雨不撞：霉雨是湿度让干货从内部结块、可食的变少，本场是黏菌分解包装与容器、能吃的东西往往还在却不安全；与原腐生菌不撞：原场只写『表面黏菌腐蚀容器』，本场抬到整条供应链的包装与容器材料一起失效。"
  },
{
    id: "locust_swarm",
    name: "蝗灾",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "绿色的东西在一周内消失：绿化带、菜地和饲料一起被啃光",
    temperatures: {
      [0]: 29,
      [3]: 30,
      [7]: 31,
      [11]: 30,
      [14]: 29,
      [-7]: 26,
      [-4]: 27,
      [-1]: 28
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["food", "tool"],
    windowScene: "locust-sky",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.85,
    carryFactor: 0.75,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["market", "wholesale"],
    priceSurcharge: 0.55,
    eventPoolWeights: {
      market: 3,
      supply: 3,
      panic: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      food: 0.6
    },
    healthRiskPerDay: 0.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "26°C。田边有人说起北边起了蝗。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "27°C。菜市场的菜价开始往上走。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "28°C。郊外的绿地上落了一层蝗。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "28°C。菜农说一宿吃掉半亩菜。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "29°C。绿化带的花和叶只剩杆。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "29°C。有人在楼下点了烟熏。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "30°C。鲜菜摊空了一半，摆的是干货。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "30°C。蝗群压过来，路灯下黑了一层。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "31°C。全日光下，路上踩得发黏。"
      },
      {
        day: 2,
        severity: 1,
        hint: "31°C。农田成片变黄，一眼望到头。"
      },
      {
        day: 3,
        severity: 1,
        hint: "31°C。运菜的货车停在城外不敢进。"
      },
      {
        day: 4,
        severity: 1,
        hint: "31°C。肉蛋开始涨，因为饲料先没了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "31°C。有人囤耐放的，把鲜菜往外转。"
      },
      {
        day: 6,
        severity: 1,
        hint: "30°C。全城在喷药，风一吹又回来。"
      },
      {
        day: 7,
        severity: 1,
        hint: "30°C。绿化带补种的通知贴了出来。"
      },
      {
        day: 8,
        severity: 1,
        hint: "30°C。菜价是平时的三倍。"
      },
      {
        day: 9,
        severity: 1,
        hint: "29°C。蝗群往南走了，留一地光杆。"
      },
      {
        day: 10,
        severity: 1,
        hint: "29°C。补种的菜还要等一个多月。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "29°C。干货和罐头卖得最快。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "29°C。运菜的车开始从外地进来。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "29°C。菜价没降，货架满了一点。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "28°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "蝗虫不吃你囤的干粮，它吃的是喂牲畜和补城里鲜食的那一层。于是最先空的是菜，最后才是米；而肉蛋比菜更早涨价，因为饲料断在更前面。",
    decisions: ["绿化带和菜地一起被啃，去抢最后一批鲜菜，还是换成耐放的", "蝗群怕风不怕药，等风向变，还是继续喷药", "饲料断供让肉蛋先涨，是趁高价出存货，还是留着自用"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 10：priceSurcharge 0.55 把『鲜食层被吃掉』写成物价跳涨；维度 13 打 food 0.6，鲜菜与饲料一起失效；维度 9 关掉 market 与 wholesale，本地鲜食的进货通路断在源头。与粮食霉变不撞：霉变的粮还在、毒素进了链条，本场是绿色的作物整片消失、能吃的东西从地里就没了；与森林虫灾不撞：森林虫灾啃的是木材与山货，本场啃的是菜与饲料。"
  },
{
    id: "livestock_plague",
    name: "畜疫",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "能下蛋能产肉的都在被扑杀：防疫清的是整片，不问这一头",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 9,
      [11]: 10,
      [14]: 11,
      [-7]: 12,
      [-4]: 11,
      [-1]: 10
    },
    spoilRate: 1.3,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["food", "medicine", "warmth"],
    windowScene: "cull-line",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.8,
    carryFactor: 0.8,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market", "wholesale", "community_store"],
    priceSurcharge: 0.7,
    eventPoolWeights: {
      supply: 3,
      panic: 3,
      market: 2
    },
    npcVisitFactor: 0.7,
    categoryEfficiency: {
      food: 0.55
    },
    healthRiskPerDay: 1.5,
    scoreWeights: {
      emergency: 3,
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "12°C。附近养殖场报了几头病畜。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "11°C。防疫的人进场，先拉了警戒线。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "10°C。整片栏舍开始清空，活的不放出来。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "10°C。镇上设了进出城的消毒点。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "9°C。市场里的肉摊关了一半。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "9°C。冷柜前的人排起了队。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "10°C。肉价一天一个价，早上又涨了。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "10°C。城外几个养殖区全封了。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "9°C。散养的活禽也上了名单。"
      },
      {
        day: 2,
        severity: 1,
        hint: "9°C。鸡蛋在货架上一天就空了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "9°C。有人说肉不够，只能多备豆制品。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。防疫的车一趟趟往城外开。"
      },
      {
        day: 5,
        severity: 1,
        hint: "10°C。奶粉和蛋奶一样限购。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。冷库的肉被统一登记。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。饲料也停了，留下的牲畜在掉膘。"
      },
      {
        day: 8,
        severity: 1,
        hint: "10°C。肉价是平时的两倍多。"
      },
      {
        day: 9,
        severity: 1,
        hint: "10°C。有人开始学着自己腌肉保存。"
      },
      {
        day: 10,
        severity: 1,
        hint: "11°C。防疫的人说还要再清一轮。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "11°C。城里的肉摊慢慢开了几个。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "11°C。补栏的种畜还没到位。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "11°C。蛋价没落，货架还是空的。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "11°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "防疫清的是整片，不问这头有没有病。于是最先清空的是最集中、最规范的大场；能撑久一点的，反而是自家散养的那几只。而城里人只看到肉价一天一涨。",
    decisions: ["肉蛋一天一个价，是趁早买满冷冻，还是把钱留给耐放的替代品", "散养的活禽可能留着，也可能带病，杀还是留", "防疫队进场要封路，是抢在封路前补一趟货，还是在家等通知", "饲料和药抢同一份钱，先保吃还是先保病"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 10：priceSurcharge 0.7，全族最高，把『肉蛋断供』写成价格与限购；维度 13 打 food 0.55，肉蛋奶整类掉效率；维度 9 关掉 market、wholesale、community_store 三家。与疫情不撞：疫情是人际传染病，本场是畜间疫、人不会得、但餐桌先空；与蝗灾不撞：蝗灾从鲜菜与饲料那头断，本场从肉蛋奶这头清。"
  },
{
    id: "red_tide",
    name: "赤潮",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "海还在，海里的东西不能吃：近海赤潮，海产被检测整片拦下",
    temperatures: {
      [0]: 26,
      [3]: 27,
      [7]: 28,
      [11]: 27,
      [14]: 26,
      [-7]: 24,
      [-4]: 25,
      [-1]: 26
    },
    spoilRate: 1.9,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "water"],
    windowScene: "red-sea",
    shelterDecayPerDay: -1,
    restEfficiency: 0.85,
    carryFactor: 0.8,
    actionPointDelta: 0,
    shopSupplyFactor: 0.55,
    closedShopIds: ["market", "weekend_flea"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      market: 3,
      water: 3,
      supply: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      food: 0.6,
      water: 0.7
    },
    healthRiskPerDay: 1,
    scoreWeights: {
      emergency: 2,
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "24°C。近岸的水面上起了大片的红。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "25°C。渔港说当天的鱼先不收了。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "26°C。海货摊上的货越摆越少。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "26°C。抽检的船出去了一整天。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "27°C。码头上腥味重，贝类先停卖。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "27°C。有人在退前几天买的冻虾。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "28°C。海货的价格一天翻了一倍。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "28°C。整片近海拉起警戒线。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "28°C。渔港的秤停了一整天。"
      },
      {
        day: 2,
        severity: 1,
        hint: "28°C。冷库里的存鱼被逐批抽检。"
      },
      {
        day: 3,
        severity: 1,
        hint: "27°C。海带和紫菜也跟着停卖。"
      },
      {
        day: 4,
        severity: 1,
        hint: "27°C。有人转去买河鲜和淡水鱼。"
      },
      {
        day: 5,
        severity: 1,
        hint: "27°C。河鲜价跟着涨，货也不够。"
      },
      {
        day: 6,
        severity: 1,
        hint: "27°C。近海的水色还是红的。"
      },
      {
        day: 7,
        severity: 1,
        hint: "27°C。有批货检测没过，整批退港。"
      },
      {
        day: 8,
        severity: 1,
        hint: "26°C。卖海产的摊位空了一排。"
      },
      {
        day: 9,
        severity: 1,
        hint: "26°C。有人开始囤罐头和干货。"
      },
      {
        day: 10,
        severity: 1,
        hint: "26°C。水也跟着涨，说沿海水厂在查。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "26°C。红潮淡了些，检测还没过。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "26°C。渔港的船开始有限度出海。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "26°C。海货慢慢回摊，价格还高。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "26°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "赤潮不是海里没鱼，是鱼还活着但没人敢收。抽检一天不放过，渔港就一天不能开秤。于是这一场最贵的是那张检测单，不是鱼本身。",
    decisions: ["海货全停卖，是囤冷冻海产赌检测通过，还是换内陆的东西", "海边还能捡到没死的贝类，捡还是不捡", "水和海产同时涨价，先保饮水还是先保吃的"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 14 个（L3）。主打维度 13：categoryEfficiency 同时打 food 0.6 与 water 0.7，海产与沿海供水一起掉效率；维度 15 取 1，承接藻毒的持续风险；维度 9 关掉 market 与 weekend_flea，海产通路断在检测这一关。与藻华不撞：藻华是城市水源起藻、盯燃料与滤水，本场是近海的渔获被整片拦下、盯的是海货与沿海供水，且压力落在物价而非烧水。与粮食霉变不撞：霉变是粮还在毒素进了链，本场是海里的东西被判定不能吃。"
  },
{
    id: "forest_pest",
    name: "森林虫灾",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "山变秃，是虫干的：成片山林被啃，木材、柴火、山货一起断",
    temperatures: {
      [0]: 24,
      [3]: 25,
      [7]: 26,
      [11]: 25,
      [14]: 24,
      [-7]: 22,
      [-4]: 23,
      [-1]: 24
    },
    spoilRate: 1.4,
    dailyDrain: {
      fuel: 1,
      food: 1
    },
    priorityCategories: ["fuel", "food", "tool"],
    windowScene: "bare-hills",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.8,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["hardware", "weekend_flea"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      supply: 3,
      market: 2,
      people: 2
    },
    npcVisitFactor: 1,
    categoryEfficiency: {
      fuel: 0.6,
      food: 0.8
    },
    healthRiskPerDay: 1,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。山上的松树成片发黄。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "23°C。林子里落了一层绿虫。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "24°C。护林的人说这片得整片治。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "24°C。山下堆着被啃秃的枝叶。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "25°C。进山捡柴的路封了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "25°C。木材的价格一天一涨。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "26°C。山货摊上的菌子先没了。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "26°C。从高处看，山露出了一片土黄。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "26°C。护林队一天清掉一车枯木。"
      },
      {
        day: 2,
        severity: 1,
        hint: "26°C。纸和木料跟着一起涨。"
      },
      {
        day: 3,
        severity: 1,
        hint: "25°C。柴火断了，有人改烧煤和电。"
      },
      {
        day: 4,
        severity: 1,
        hint: "25°C。山外的木材车排到了路口。"
      },
      {
        day: 5,
        severity: 1,
        hint: "25°C。放养的蜂场也挪了地方。"
      },
      {
        day: 6,
        severity: 1,
        hint: "25°C。山脚下的空气里全是药味。"
      },
      {
        day: 7,
        severity: 1,
        hint: "25°C。能捡的枯木都得登记。"
      },
      {
        day: 8,
        severity: 1,
        hint: "24°C。有人上山偷偷捡枯木。"
      },
      {
        day: 9,
        severity: 1,
        hint: "24°C。补种的苗要等好几年。"
      },
      {
        day: 10,
        severity: 1,
        hint: "24°C。山货的价格没降下来。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "24°C。虫口淡了，秃的地方还秃着。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "24°C。木材从外地调，价高还慢。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "24°C。山脚下的路重新开了。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "24°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "虫灾过后山是秃的，但最直接断掉的不是木材，是柴火和山货这些过去不花钱的东西。城里人靠山省下的那部分开销，这一场要全额用钱买回来，而且正赶上物价在涨。",
    decisions: ["山封了，柴火和山货都断了，是花钱买燃料还是省着烧", "枯木还能捡，但林区在喷药，捡还是不去", "木材和纸一起涨价，先囤燃料还是先囤能当柴烧的东西"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个（L3）。主打维度 13：categoryEfficiency 打 fuel 0.6 与 food 0.8，柴火与山货一起失效；维度 10 取 0.45 承载木材与纸的连带涨价；维度 9 关掉 hardware 与 weekend_flea。与蝗灾不撞：蝗灾啃的是菜与饲料，落点在餐桌鲜食；森林虫灾啃的是林子，落点在燃料、木料与山货。与赤潮不撞：赤潮盯海产与沿海供水，本场盯山林与山货。"
  },
{
    id: "grain_mold",
    name: "粮食霉变",
    family: "生物",
    level: "L3",
    tier: 3,
    axis: "粮还在，毒素进了供应链：全城粮库受潮霉变，看着完好的也不能吃",
    temperatures: {
      [0]: 24,
      [3]: 24,
      [7]: 25,
      [11]: 24,
      [14]: 23,
      [-7]: 22,
      [-4]: 23,
      [-1]: 23
    },
    spoilRate: 3.5,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["food", "medicine", "luxury"],
    windowScene: "mold-silo",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.75,
    carryFactor: 0.75,
    actionPointDelta: 0,
    shopSupplyFactor: 0.55,
    closedShopIds: ["wholesale", "market"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      supply: 3,
      market: 2,
      panic: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      food: 0.6
    },
    healthRiskPerDay: 2,
    scoreWeights: {
      fefo: 3,
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。粮库的墙角返了潮。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "23°C。有人买的米闻着有股味。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "23°C。一批粮被单独堆在仓库一角。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "24°C。批发站开始一天的抽检。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "24°C。米袋里结了小团，掰开是黄的。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "25°C。有人说洗一洗还能吃。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "25°C。整仓的粮开始按批退。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "24°C。低价粮忽然多了起来。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "24°C。诊所来了几个吃坏肚子的。"
      },
      {
        day: 2,
        severity: 1,
        hint: "25°C。货架上的散粮换成了新包装。"
      },
      {
        day: 3,
        severity: 1,
        hint: "25°C。有人把粮全换成了罐头。"
      },
      {
        day: 4,
        severity: 1,
        hint: "24°C。抽检的队伍排到了库房外。"
      },
      {
        day: 5,
        severity: 1,
        hint: "24°C。米价没跌，能吃的贵了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "24°C。仓库开始整片通风晾晒。"
      },
      {
        day: 7,
        severity: 1,
        hint: "24°C。有人开始挑明显没霉的囤。"
      },
      {
        day: 8,
        severity: 1,
        hint: "23°C。洗过的粮还是有味。"
      },
      {
        day: 9,
        severity: 1,
        hint: "23°C。罐头和真空装涨得最凶。"
      },
      {
        day: 10,
        severity: 1,
        hint: "23°C。毒素的检测说洗煮都不行。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "23°C。退回的粮堆在城边的仓。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "23°C。新到的粮贵，量也少。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "23°C。有人把陈粮全拿去换了货。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "23°C。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "霉粮的毒素洗不掉、煮不掉，长了毛的那块掐掉，整袋照样有问题。于是这一场里看着完好的粮比明显发霉的更危险，因为它会直接进锅，而发霉的至少一眼能看出来。",
    decisions: ["低价粮看着正常，是赌一把买进来，还是只认有抽检的", "受潮的粮晒一晒还能吃，晒还是直接扔", "毒素进了供应链，是提前换成罐头这类耐放的，还是省着吃现有的"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 14 个（L3）。主打维度 2：spoilRate 3.5，全族最快，把『粮还在但留不住』推到极端；维度 15 取 2 承接毒素的持续风险；维度 13 打 food 0.6，粮这一场自己掉效率。与霉雨不撞：霉雨是环境湿度让家里的干货受潮，本场是粮库与供应链里的毒素，压力落在抽检、退货与『看得见的合格』上。与蝗灾不撞：蝗灾是绿色的东西整片消失，本场是粮还在、但不能吃。"
  },
  // ═══ 生成内容 灾难-生物 止 ═══,
  // ═══ 生成内容 灾难-社会 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "riot_curfew",
    name: "骚乱",
    family: "社会",
    level: "L3",
    tier: 2,
    axis: "通行与供给：门开不开不由你说了算，街上不安全，店早早关了",
    temperatures: {
      [0]: 11,
      [3]: 10,
      [7]: 9,
      [11]: 9,
      [14]: 10,
      [-7]: 14,
      [-4]: 13,
      [-1]: 12
    },
    spoilRate: 1.4,
    fridgeDead: true,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["food", "medicine"],
    windowScene: "riot-street",
    shelterDecayPerDay: -2,
    restEfficiency: 0.75,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      people: 3,
      panic: 2,
      supply: 2
    },
    npcVisitFactor: 1.4,
    categoryEfficiency: {
      tool: 0.7
    },
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。城南有个路口封了半天，群里在传。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "13°C。超市的米面区排起了长队。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "13°C。有家店提前两小时拉下了卷帘门。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "12°C。公交改道，三条线停运。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "12°C。公司让提前下班，说别走大路。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "11°C。两家便利店被搬空了货架。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "11°C。晚上八点，主街上几乎没人。"
      },
      {
        day: 0,
        severity: 0.75,
        hint: "11°C。夜里开始宵禁，喇叭车绕了两圈。"
      },
      {
        day: 1,
        severity: 0.85,
        hint: "10°C。五金店和农贸市场都没开门。"
      },
      {
        day: 2,
        severity: 0.9,
        hint: "10°C。楼下的车被砸了两辆，没人管。"
      },
      {
        day: 3,
        severity: 0.95,
        hint: "10°C。物业把大门锁了，进出要登记。"
      },
      {
        day: 4,
        severity: 0.9,
        hint: "9°C。有人在楼道里换东西，声音压得很低。"
      },
      {
        day: 5,
        severity: 0.95,
        hint: "9°C。远处有玻璃碎的声音，断断续续。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。超市只开半天，队伍排到马路对面。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。夜里有人挨家敲门，问有没有多的吃的。"
      },
      {
        day: 8,
        severity: 1,
        hint: "10°C。公告说要按楼栋轮流出小区。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "11°C。楼下停了两辆没牌子的车，一整天没动。"
      },
      {
        day: 10,
        severity: 1,
        hint: "11°C。药店只在早上开一小时。"
      },
      {
        day: 11,
        severity: 1,
        hint: "12°C。有人开始拿东西换药。"
      },
      {
        day: 12,
        severity: 0.95,
        hint: "12°C。宵禁提前到七点。"
      },
      {
        day: 13,
        severity: 0.9,
        hint: "13°C。街上清得很快，风一吹就没人。"
      },
      {
        day: 14,
        severity: 0.85,
        hint: "13°C。今天没听见喇叭车。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "出不去这件事让存粮变得更耐用 。 囤得多不再只是安全感，而是「你根本买不回来」；反过来，药店那点存货比什么都金贵，因为被打伤这件事在这一场里是常态",
    decisions: ["行动点少了一个，今天该出门碰运气，还是在家把东西理到随手能拿", "街上不安全，工具在混乱里更容易丢或坏，要不要带上", "邻居来得更勤，给出去的是口粮、换回来的是消息，这笔账怎么算"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/16，共 14 个。主打维度 12（NPC 行为：npcVisitFactor 1.4 。 全案第一次让「人来得更勤」成为主要压力）与 16（分数口径：emergency 权重 2，因为这一场里「急用的够不够得到」比摆得整齐重要）。与已有四场都不撞：寒潮动燃料保暖且腐坏变慢、热浪动水与药且腐坏加快、洪水废掉保暖与低处空间、大停电动行动点与冰箱；本场动的是**通行与供给**，而且它是唯一一场把「NPC 来得更勤」当压力写的。"
  },
{
    id: "supply_cut",
    name: "断供",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "外来的货进不来，存量成了唯一来源",
    temperatures: {
      [0]: 13,
      [3]: 12,
      [7]: 12,
      [11]: 13,
      [14]: 14,
      [-7]: 16,
      [-4]: 15,
      [-1]: 14
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["food", "water", "warmth"],
    windowScene: "empty-shelves",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.8,
    carryFactor: 0.7,
    shopSupplyFactor: 0.4,
    closedShopIds: ["wholesale", "market"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      supply: 4,
      queue: 2
    },
    npcVisitFactor: 0.5,
    categoryEfficiency: {
      food: 0.8
    },
    healthRiskPerDay: 1,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "16°C。物流园的车少了一半，公告说在调度。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "15°C。超市的米面区一天比一天薄。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "15°C。批发市场的门口贴了暂停营业。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "14°C。邻市的货车下不了高速，堵在匝道。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "13°C。群里说外地的仓也空了，没人辟谣。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "13°C。便利店的牛奶柜空了，只剩饮料。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "12°C。公告说进货要等通知，日期没给。"
      },
      {
        day: 0,
        severity: 0.8,
        hint: "12°C。批发和农贸同时关了门。"
      },
      {
        day: 1,
        severity: 0.85,
        hint: "12°C。货架补不上，标签还挂在那里。"
      },
      {
        day: 2,
        severity: 0.9,
        hint: "11°C。社区小店开始按人头卖米。"
      },
      {
        day: 3,
        severity: 0.92,
        hint: "11°C。有人用两瓶酒换了一袋面粉。"
      },
      {
        day: 4,
        severity: 0.95,
        hint: "11°C。仓库的存粮被人一车车拉走。"
      },
      {
        day: 5,
        severity: 0.95,
        hint: "10°C。外卖停了，说是没货可送。"
      },
      {
        day: 6,
        severity: 0.98,
        hint: "10°C。主食的消耗比平常快了一成。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。蜡烛和电池也买不到了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "10°C。有人开始把存粮往外搬，去换药。"
      },
      {
        day: 9,
        severity: 0.98,
        hint: "11°C。运货的车在路口排了一夜。"
      },
      {
        day: 10,
        severity: 0.97,
        hint: "11°C。公告说市面恢复要看下周。"
      },
      {
        day: 11,
        severity: 0.96,
        hint: "12°C。小店的面粉涨了一倍，还得抢。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "12°C。隔壁楼有人拿金饰换了米。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "13°C。第一批外地的车进了城。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "13°C。货架慢慢有了东西。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场里现金会先失效，因为它买不到不存在的货；平时最占地方、最没用的贵重品，反而成了唯一能换来主食的东西。",
    decisions: ["补货的路断了，主食要按 14 天压满，还是留钱等市面恢复", "批发和农贸都关了，剩下的社区小店溢价高，值不值得去", "没人来敲门了，想换东西得自己上门，人情这张牌要不要先打"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 14 个。主打维度 9（shopSupplyFactor 0.4 全族最低，且关掉批发与农贸两条进货线）与 10（priceSurcharge 0.5）。与骚乱不撞：骚乱是门外不安全、人要躲；本场是门外没货、出门也买不到，价格与库存一起塌，NPC 反而来得更少（npcVisitFactor 0.5）。"
  },
{
    id: "panic_buy",
    name: "抢购潮",
    family: "社会",
    level: "L3",
    tier: 2,
    axis: "还没出事，货先没了，提前量被一口吃掉",
    temperatures: {
      [0]: 12,
      [3]: 11,
      [7]: 11,
      [11]: 12,
      [14]: 13,
      [-7]: 15,
      [-4]: 14,
      [-1]: 13
    },
    spoilRate: 1.8,
    dailyDrain: {
      water: 1
    },
    priorityCategories: ["food", "water", "luxury"],
    windowScene: "rush-hour-shop",
    shelterDecayPerDay: -1,
    restEfficiency: 0.85,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["supermarket", "weekend_flea"],
    priceSurcharge: 0.6,
    eventPoolWeights: {
      panic: 4,
      queue: 3,
      market: 2
    },
    npcVisitFactor: 1.5,
    categoryEfficiency: {
      food: 0.7
    },
    healthRiskPerDay: 1,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "15°C。新闻说有一波物资紧张，超市人多了。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "14°C。米面区的推车一辆接一辆。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "14°C。矿泉水整箱往外搬，货架空了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "13°C。结账的队伍排到了货架中间。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "13°C。有人一次买了十袋面，装了两趟。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "12°C。速食和罐头被搬空，只剩调料。"
      },
      {
        day: -1,
        severity: 0.8,
        hint: "12°C。晚上九点超市还在补货，人还在。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "12°C。开门十分钟，米面就没了。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "11°C。两个人为了最后一箱水吵起来。"
      },
      {
        day: 2,
        severity: 1,
        hint: "11°C。奢侈品柜的烟酒也被扫空。"
      },
      {
        day: 3,
        severity: 1,
        hint: "11°C。超市改成每人限买两份。"
      },
      {
        day: 4,
        severity: 1,
        hint: "11°C。货架空了一半，补货的车没来。"
      },
      {
        day: 5,
        severity: 1,
        hint: "10°C。有人拿抢来的货在楼道里加价卖。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。收银台只收现金，不找零。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。方便面和蜡烛一起没了。"
      },
      {
        day: 8,
        severity: 0.97,
        hint: "10°C。冷藏柜的鲜食没人要，价签还在。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "11°C。有人开始退货，说抢多了。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "11°C。小店的货被搬空后关了门。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "11°C。二手群里粮食的价格翻了一倍。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "12°C。补货的车来了，队伍又排起来。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "12°C。货架慢慢满了，人少了一半。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "13°C。今天没人再抢。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场里现金和货架同时失灵：真的灾难还没来，能买的东西先没了，于是「晚点再买」这个选项在灾难开始之前就已经作废。",
    decisions: ["行动点少一个，是挤进人堆抢一箱主食，还是把钱换成更轻便的贵重品", "超市只收现金不找零，零钱要不要提前换整", "奢侈品被抢空后反而好出手，要不要拿它去换别人手里的粮"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 8（actionPointDelta -1：抢购把行动点耗在排队上）与 12（npcVisitFactor 1.5 全族最高，货架前全是人）。与骚乱不撞：骚乱发生在灾难之后、街上不安全；本场发生在灾难之前，门开着、街也安全，被吃掉的是「提前量」和货架本身。spoilRate 1.8：抢回家的鲜食在拥堵里挤坏得快。"
  },
{
    id: "community_lockdown",
    name: "封控",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "出不去小区，活动半径缩到楼里",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 9,
      [11]: 10,
      [14]: 11,
      [-7]: 13,
      [-4]: 12,
      [-1]: 11
    },
    spoilRate: 1.3,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["food", "tool", "warmth"],
    windowScene: "sealed-gate",
    shelterDecayPerDay: -2,
    restEfficiency: 0.9,
    carryFactor: 0.85,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["market"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      neighbor: 3,
      limit: 3
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      warmth: 1.2
    },
    healthRiskPerDay: 1,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "13°C。小区门口开始查出入证。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。公告说要减少外出，先劝不强制。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "12°C。快递只送到大门外，得自己下来拿。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "11°C。居委会在门口登记每户人数。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "11°C。侧门被锁了，只剩正门能走。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "10°C。公告说非必要不出楼栋。"
      },
      {
        day: -1,
        severity: 0.8,
        hint: "10°C。晚上有人敲门，登记家里几口人。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "10°C。早上大门被拦住，出入要证明。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "9°C。楼下的出口只留一个，排着队。"
      },
      {
        day: 2,
        severity: 1,
        hint: "9°C。院墙外的菜场开着，人过不去。"
      },
      {
        day: 3,
        severity: 1,
        hint: "9°C。有人隔着栏杆从外面递东西进来。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。每户发一张出门条，两天用一次。"
      },
      {
        day: 5,
        severity: 1,
        hint: "10°C。楼里的人开始互相借东西。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。楼道里堆了各家退回来的纸箱。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。电梯里贴了新的出入时间表。"
      },
      {
        day: 8,
        severity: 0.98,
        hint: "10°C。有人翻墙出去，被劝了回来。"
      },
      {
        day: 9,
        severity: 0.96,
        hint: "10°C。补给送到小区门口，要排队领。"
      },
      {
        day: 10,
        severity: 0.94,
        hint: "11°C。院里的空地成了换东西的地方。"
      },
      {
        day: 11,
        severity: 0.92,
        hint: "11°C。公告说还要再封一周。"
      },
      {
        day: 12,
        severity: 0.88,
        hint: "11°C。有人把阳台的菜搬到了楼道里。"
      },
      {
        day: 13,
        severity: 0.84,
        hint: "12°C。出门条改成了一天一次。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "12°C。门口不查了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场考验的是「货离你有多近」，不是「货有多少」：市面还在、东西也还在，但都被挡在小区外面，囤在别处等于没囤。",
    decisions: ["行动点少一个，是去门口碰运气，还是在家把楼里能用的东西清点一遍", "门的开与关不归你决定，出门的时间要提前算好", "邻居都被关在一起，来往更勤，分东西还是换东西要想清楚"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 12（npcVisitFactor 1.3：全楼被关在一起，人来往反而更勤）与 13（categoryEfficiency 保暖 1.2：待在家里，取暖的效用被放大）。与骚乱不撞：骚乱是街上不安全、店关了；本场街上没事、店也开着，只是你出不去，压力来自活动半径而不是危险。与配给登记不撞：配给登记是能出去但买不多，本场是买得到但过不去。"
  },
{
    id: "ration_registry",
    name: "配给登记",
    family: "社会",
    level: "L3",
    tier: 2,
    axis: "限购加实名，买得到但买不多",
    temperatures: {
      [0]: 9,
      [3]: 8,
      [7]: 8,
      [11]: 9,
      [14]: 10,
      [-7]: 12,
      [-4]: 11,
      [-1]: 10
    },
    spoilRate: 1.4,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "water", "tool"],
    windowScene: "ration-counter",
    shelterDecayPerDay: -1,
    restEfficiency: 0.75,
    carryFactor: 0.75,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["wholesale"],
    priceSurcharge: 0.2,
    eventPoolWeights: {
      limit: 4,
      queue: 2
    },
    npcVisitFactor: 0.8,
    scoreWeights: {
      emergency: 2
    },
    healthRiskPerDay: 0.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "12°C。上了新系统，买米要刷身份证。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "11°C。超市贴出限购通知，每人两份。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "11°C。登记要排号，早上发了五十个。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "10°C。有人拿着全家的证件来登记。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "10°C。价格没涨，但货架一次只放一点。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "9°C。居委会说配额按人头，不按户。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "9°C。登记处排到了街角，有人凌晨就来。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "9°C。今天起买粮油都要实名登记。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "8°C。一份米够吃三天，多的买不到。"
      },
      {
        day: 2,
        severity: 0.95,
        hint: "8°C。有人借邻居的证件多买了一份。"
      },
      {
        day: 3,
        severity: 1,
        hint: "8°C。登记的队伍比昨天长了半条街。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。药店的常用药也开始限购。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。有人把配额的号拿到群里倒卖。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。队伍里有人站不动，蹲在路边。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。公告说配额下周调低一成。"
      },
      {
        day: 8,
        severity: 0.97,
        hint: "10°C。登记本上的字写满了，换了新本。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "10°C。有户人家的配额被停了三天。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "10°C。大家开始按顿数分着吃。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "11°C。限购的牌子多了两行字。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "11°C。登记处挪到了小区里面。"
      },
      {
        day: 13,
        severity: 0.78,
        hint: "12°C。配额恢复到了原来的量。"
      },
      {
        day: 14,
        severity: 0.72,
        hint: "12°C。不用再排队登记了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "配给把「买得多」这条策略整条删掉了：货架上有货、价钱也不贵，但每家每天只有一份，于是决定成败的不是钱，是你有几口人能去登记。",
    decisions: ["限购按户算，家里人多的一份不够分，要不要分开登记", "买得到但买不多，天数要按配额重新算一遍", "登记要排号，行动点只剩两个，今天去还是明天去"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/15/16，共 14 个。主打维度 11（eventPoolWeights limit:4，限购事件主导）与 10（priceSurcharge 0.2：配额制下价格被压住，痛点不是贵而是少）。与骚乱不撞：骚乱是供给塌了、价格飞涨；本场供给还在、价格也稳，被限住的是「每户能买多少」。与抢购潮不撞：抢购潮发生在灾难前、靠抢；本场是灾难后、靠登记与配额。"
  },
{
    id: "exodus_wave",
    name: "出城潮",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "邻居都走了，帮手也没了",
    temperatures: {
      [0]: 12,
      [3]: 11,
      [7]: 11,
      [11]: 12,
      [14]: 13,
      [-7]: 15,
      [-4]: 14,
      [-1]: 13
    },
    spoilRate: 1.5,
    dailyDrain: {
      fuel: 2
    },
    priorityCategories: ["fuel", "water", "tool"],
    windowScene: "moving-vans",
    shelterDecayPerDay: -2,
    restEfficiency: 0.7,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.7,
    closedShopIds: ["gas_station", "market"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      people: 3,
      supply: 2
    },
    npcVisitFactor: 0.2,
    categoryEfficiency: {
      tool: 1.2
    },
    healthRiskPerDay: 0.5,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "15°C。楼下开始有人往车上搬行李。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "14°C。群里说往南边去的人越来越多。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "14°C。加油站排起了队，油枪不够用。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "13°C。对门那户天没亮就走了，灯黑着。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "13°C。幼儿园空了，老师也走了大半。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "12°C。小区里停了半数的车，车位空出来。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "12°C。剩下的人互相留了电话，说有事喊。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "12°C。半夜又走了一车人，车灯照了很远。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "11°C。五金店的师傅走了，东西坏了没人修。"
      },
      {
        day: 2,
        severity: 0.95,
        hint: "11°C。加油站白天关了半天门。"
      },
      {
        day: 3,
        severity: 1,
        hint: "11°C。楼道里积了快递，没人送了。"
      },
      {
        day: 4,
        severity: 1,
        hint: "11°C。剩下的几户把能帮的活排了个班。"
      },
      {
        day: 5,
        severity: 1,
        hint: "11°C。有人搬不动大件，站在楼梯口发愁。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。有户人家走后没锁门，被人搬空。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。工具成了硬通货，借出去要打欠条。"
      },
      {
        day: 8,
        severity: 0.98,
        hint: "10°C。有人想走但车没油了，只能留下。"
      },
      {
        day: 9,
        severity: 0.96,
        hint: "11°C。留下的几户拼着用一台发电机。"
      },
      {
        day: 10,
        severity: 0.94,
        hint: "11°C。街上比前几天安静，店关了一半。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "11°C。有人说南边也不好过，走的想回。"
      },
      {
        day: 12,
        severity: 0.86,
        hint: "12°C。开始有人回来了，车位又满了些。"
      },
      {
        day: 13,
        severity: 0.82,
        hint: "12°C。回来的邻居带了消息，也带回了些货。"
      },
      {
        day: 14,
        severity: 0.74,
        hint: "13°C。楼里的人比前几天多了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场最缺的资源是「帮你搭把手的人」：东西还在、店也半开着，但你一个人搬不动、修不了、也守不住，于是人手比物资先见底。",
    decisions: ["邻居走了，重活没人帮，是花钱雇人还是把活拆小了慢慢干", "油站关了，剩下的油要留给出城的车还是留给自己用", "留下的人少了，抢东西的也少了，要不要趁这时候多出门一趟"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 12（npcVisitFactor 0.2 全族最低：人都走了，没人再来）+ 13（categoryEfficiency 工具 1.2：帮手没了，全靠自己手上的工具）。与骚乱不撞：骚乱人扎堆、来得更勤；本场正好相反，人一走空，压力变成「没人搭手」。与封控不撞：封控是你出不去，本场是别人都出去了。"
  },
{
    id: "strike_halt",
    name: "罢工",
    family: "社会",
    level: "L3",
    tier: 2,
    axis: "物流与清洁停摆，垃圾和水先出问题",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 9,
      [11]: 10,
      [14]: 11,
      [-7]: 13,
      [-4]: 12,
      [-1]: 11
    },
    spoilRate: 1.6,
    dailyDrain: {
      water: 1
    },
    priorityCategories: ["water", "warmth", "luxury"],
    windowScene: "piled-trash",
    shelterDecayPerDay: -2,
    restEfficiency: 0.65,
    carryFactor: 0.7,
    shopSupplyFactor: 0.6,
    closedShopIds: ["community_store", "market"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      supply: 3,
      queue: 2
    },
    npcVisitFactor: 0.6,
    healthRiskPerDay: 2,
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "13°C。收垃圾的车今天没来，垃圾堆着。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。物流园的人没到齐，货停在路边。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "12°C。楼下的垃圾箱满了，往外溢。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "11°C。快递和外卖都停了，说送不了。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "11°C。送水的车没来，说在协调。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "10°C。垃圾堆了两天，味道散开了。"
      },
      {
        day: -1,
        severity: 0.75,
        hint: "10°C。公告说清洁还要停几天。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "10°C。周边三条街的垃圾都没人运。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "9°C。楼道的垃圾桶溢了，有人自己往远搬。"
      },
      {
        day: 2,
        severity: 0.95,
        hint: "9°C。送水的车来了一趟，只够几户。"
      },
      {
        day: 3,
        severity: 1,
        hint: "9°C。有人把垃圾往空地上倒，没人管。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。下水道返了味，楼上楼下都闻得到。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。桶装水的价格涨了，还得抢。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。有人开始烧垃圾，烟飘了半条街。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。清洁恢复了半天，只清了主要街道。"
      },
      {
        day: 8,
        severity: 0.97,
        hint: "10°C。送煤的车绕了远路，还要加钱。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "10°C。有户人家自己把垃圾运到了城外。"
      },
      {
        day: 10,
        severity: 0.92,
        hint: "10°C。楼道里敢开窗的人少了。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "11°C。送水的班次恢复了一半。"
      },
      {
        day: 12,
        severity: 0.86,
        hint: "11°C。物流的车开始进城，货慢慢有了。"
      },
      {
        day: 13,
        severity: 0.82,
        hint: "12°C。收垃圾的车回来了，清了一整天。"
      },
      {
        day: 14,
        severity: 0.74,
        hint: "12°C。楼下清干净了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场最难的不是补货，是「扔不出去」：垃圾停运之后，家里堆的废料反过来成了卫生隐患，你囤得越多、产生的垃圾越多，越先出问题。",
    decisions: ["垃圾没人收，攒着还是想办法自己运出去", "送水车停了，桶装水的余量要按天重算", "取暖的送货停了，钱要不要挪去买能烧的散煤"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/15/16，共 13 个。主打维度 15（healthRiskPerDay 2：垃圾与污水带来的卫生风险，不看玩家做什么）+ 2（spoilRate 1.6：没有清运，鲜食与垃圾一起坏）。与骚乱不撞：骚乱是人和供给的混乱；本场没人闹事，城市在正常地「停摆」，压力来自清洁与物流的停。"
  },
{
    id: "requisition",
    name: "征用",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "官方征用物资，私人囤积被抽走",
    temperatures: {
      [0]: 9,
      [3]: 8,
      [7]: 8,
      [11]: 9,
      [14]: 10,
      [-7]: 12,
      [-4]: 11,
      [-1]: 10
    },
    spoilRate: 1.3,
    dailyDrain: {
      fuel: 1
    },
    priorityCategories: ["fuel", "water", "luxury"],
    windowScene: "requisition-notice",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.7,
    carryFactor: 0.7,
    shopSupplyFactor: 0.55,
    closedShopIds: ["hardware", "wholesale"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      supply: 4,
      limit: 2
    },
    npcVisitFactor: 1.5,
    categoryEfficiency: {
      food: 0.8
    },
    healthRiskPerDay: 0.5,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "12°C。公告说要统一征用部分物资。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "11°C。居委会开始登记各家的大件。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "11°C。有人把油和工具挪到了楼上。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "10°C。征用的清单贴出来，写得很细。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "10°C。上门的人清点了冰箱和储物间。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "9°C。有人报少了数量，被对了一遍。"
      },
      {
        day: -1,
        severity: 0.78,
        hint: "9°C。第一批被拉走，是整箱的燃料。"
      },
      {
        day: 0,
        severity: 0.88,
        hint: "9°C。今天起按栋征用，挨家挨户登记。"
      },
      {
        day: 1,
        severity: 0.92,
        hint: "8°C。大件工具被列进清单，拉走了几件。"
      },
      {
        day: 2,
        severity: 0.95,
        hint: "8°C。散装的粮食留下了，整袋的被收了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "8°C。有人把东西拆开，装进了不同的柜子。"
      },
      {
        day: 4,
        severity: 1,
        hint: "8°C。上门的人说下周还要清一次。"
      },
      {
        day: 5,
        severity: 1,
        hint: "8°C。批发站被征用，货不往零售走了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "8°C。有人拿到一张收据，说以后补偿。"
      },
      {
        day: 7,
        severity: 1,
        hint: "8°C。楼里安静，没人愿意开门。"
      },
      {
        day: 8,
        severity: 0.98,
        hint: "9°C。清单加了一项，是桶装水。"
      },
      {
        day: 9,
        severity: 0.96,
        hint: "9°C。有人把燃料分装在饮料瓶里。"
      },
      {
        day: 10,
        severity: 0.94,
        hint: "9°C。被征走的货装了两车，走了。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "10°C。补偿的事没人再提。"
      },
      {
        day: 12,
        severity: 0.86,
        hint: "10°C。征用的频率低了，说是够了。"
      },
      {
        day: 13,
        severity: 0.82,
        hint: "11°C。剩下没被抽走的，反倒够撑一阵。"
      },
      {
        day: 14,
        severity: 0.72,
        hint: "11°C。今天没人上门。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "被抽走的东西里，最先走的不是吃的，是「看得见的整件」：登记的人按件清点，散装、拆开、藏起来的反而留下了，于是这一场里囤得越整齐越吃亏。",
    decisions: ["登记要报数量，是如实报还是少报", "大件的油和工具最容易被抽走，要不要提前拆散", "上门的人来得更勤，配合还是想办法周旋"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 14 个。主打维度 12（npcVisitFactor 1.5：上门的人来得最勤）+ 9（shopSupplyFactor 0.55 + 关掉五金与批发：大宗货先被抽走）。与骚乱不撞：骚乱是混乱里被抢；本场有秩序、有清单、有登记，被拿走是「按规矩」的。与出城潮不撞：出城潮是人走空了没人来；本场是人不断地找上门。"
  },
{
    id: "curfew_order",
    name: "宵禁",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "几点之后，街上不许有人",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 8,
      [11]: 8,
      [14]: 9,
      [-7]: 13,
      [-4]: 12,
      [-1]: 11
    },
    spoilRate: 1.4,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["food", "water", "medicine"],
    windowScene: "curfew-street",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.7,
    carryFactor: 0.75,
    actionPointDelta: -1,
    shopSupplyFactor: 0.65,
    closedShopIds: ["market"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      dark: 3,
      limit: 3
    },
    npcVisitFactor: 0.7,
    categoryEfficiency: {
      tool: 0.8
    },
    healthRiskPerDay: 0.5,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "13°C。公告说入夜后主街要清场，先劝不强制。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。晚十点后路口设了岗，拦下几辆车。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "12°C。小区贴了张纸，写着晚上几点关大门。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "11°C。晚上街上几乎没人，只有路灯亮着。"
      },
      {
        day: -3,
        severity: 0.45,
        hint: "11°C。超市把营业时间缩到了白天。"
      },
      {
        day: -2,
        severity: 0.6,
        hint: "10°C。有人晚归被登记了名字，第二天被找上。"
      },
      {
        day: -1,
        severity: 0.78,
        hint: "10°C。公告说入夜后不许上街，违规要罚。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "10°C。今晚起七点后清场，喇叭车绕了两圈。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "9°C。白天店里全挤满，结账要排很久。"
      },
      {
        day: 2,
        severity: 0.94,
        hint: "9°C。有人白天没买到，晚上出不去。"
      },
      {
        day: 3,
        severity: 0.97,
        hint: "9°C。办证只开到下午三点，去晚就关。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。几件事都压进白天，一天跑不过来。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。夜里静得反常，街上看不见人。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。有人白天请了假，专门去排队办事。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。清场时间提前到了六点。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。白天的队伍从店门口排到路口。"
      },
      {
        day: 9,
        severity: 0.98,
        hint: "9°C。有人把东西托给白天出门的邻居带。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "10°C。公告说宵禁还要持续一周。"
      },
      {
        day: 11,
        severity: 0.92,
        hint: "10°C。白天的时间被办事和买货撑着。"
      },
      {
        day: 12,
        severity: 0.88,
        hint: "10°C。有人晚上翻墙出去，被劝了回来。"
      },
      {
        day: 13,
        severity: 0.84,
        hint: "11°C。清场时间往后挪了一个钟头。"
      },
      {
        day: 14,
        severity: 0.76,
        hint: "11°C。今晚街上有了人。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "宵禁之下所有事都挤进白天那几个能出门的钟头，于是这几天里真正吃紧的是白天，而不是夜里。",
    decisions: ["几点之前必须回楼，白天的行动点要按宵禁时段重排", "夜里不许上街，缺的东西要么白天买够，要么撑到明天", "店和窗口只在白天开，几件事挤在一起，先办哪件"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 8（actionPointDelta -1：能出门的时段被宵禁切掉一半）与 12（npcVisitFactor 0.7：夜里不许有人走动，串门几乎停了）。与骚乱不撞：骚乱是街上不安全、门被砸；本场街上没有冲突，压力是「几点之后不许有人」的时间管制，夜里街上清空。与封控不撞：封控是出不去小区，本场是白天还能出门、只是夜里被清空。"
  },
{
    id: "comms_blackout",
    name: "通信中断",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "订不了、问不到、叫不应",
    temperatures: {
      [0]: 11,
      [3]: 10,
      [7]: 10,
      [11]: 11,
      [14]: 12,
      [-7]: 14,
      [-4]: 13,
      [-1]: 12
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["food", "medicine", "fuel"],
    windowScene: "dead-signal",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.7,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["weekend_flea"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      panic: 3,
      market: 3
    },
    npcVisitFactor: 1.2,
    healthRiskPerDay: 0.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。手机没信号了，说是在抢修。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "13°C。外卖和下单的软件都打不开。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "13°C。有人站在楼下喊人，声音传不远。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "12°C。公告贴在墙上，说网络还要几天。"
      },
      {
        day: -3,
        severity: 0.42,
        hint: "12°C。问路的人变多了，只能当面打听。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "11°C。超市的补货单下不出去，货停在仓里。"
      },
      {
        day: -1,
        severity: 0.72,
        hint: "11°C。有人骑车挨家传话，说晚上开会。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "11°C。全城信号断了大半天，谁也联络不上。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "10°C。有人上门问消息，一天来了好几拨。"
      },
      {
        day: 2,
        severity: 0.94,
        hint: "10°C。叫车、叫修、叫医生都叫不来。"
      },
      {
        day: 3,
        severity: 0.97,
        hint: "10°C。买东西只能走店，不能下单了。"
      },
      {
        day: 4,
        severity: 1,
        hint: "10°C。有人走一天，只为当面问一句话。"
      },
      {
        day: 5,
        severity: 1,
        hint: "10°C。消息靠嘴传，越传越走样。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。药没订到，只能自己去城里找。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。有人夜里举着手机找信号，走很远。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。托人捎的话，有几句没传到。"
      },
      {
        day: 9,
        severity: 0.98,
        hint: "9°C。有人开始写纸条，挨家门口塞。"
      },
      {
        day: 10,
        severity: 0.96,
        hint: "9°C。信号断断续续，通一次算一次。"
      },
      {
        day: 11,
        severity: 0.93,
        hint: "10°C。修好了一部分，还要排队用。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "10°C。能打通的人多了，消息对得上了。"
      },
      {
        day: 13,
        severity: 0.86,
        hint: "11°C。信号恢复了大半，下单也通了。"
      },
      {
        day: 14,
        severity: 0.78,
        hint: "11°C。手机能用了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "断网之后最值钱的是走路能到的那几个人：下单、叫车、叫医生这些远程手段一起作废，剩下的只有面对面，平时最省事的东西这一场全用不上。",
    decisions: ["消息断了，缺什么得挨家当面问，行动点要按走的路算", "叫不来人，独自办不了的事要提前合并成一趟", "有人在门口传话，是跟着走还是自己核实"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/15/16，共 14 个。主打维度 11（panic:3 + market:3：消息断了，恐慌与市场事件一起变多）与 12（npcVisitFactor 1.2：电话打不通，人只能上门问）。与谣言不撞：谣言是消息太多、真假难分；本场是消息根本发不出去，压力来自「联络不上」。与断供不撞：断供是真的没货；本场货在仓里，缺的是把它订出来的那条线。"
  },
{
    id: "black_market",
    name: "黑市",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "明面上限价，暗地里换东西",
    temperatures: {
      [0]: 9,
      [3]: 8,
      [7]: 8,
      [11]: 9,
      [14]: 10,
      [-7]: 12,
      [-4]: 11,
      [-1]: 10
    },
    spoilRate: 1.4,
    dailyDrain: {
      fuel: 1
    },
    priorityCategories: ["food", "luxury", "fuel"],
    windowScene: "back-alley-trade",
    shelterDecayPerDay: -1,
    restEfficiency: 0.75,
    carryFactor: 0.8,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market", "community_store"],
    priceSurcharge: 0.6,
    eventPoolWeights: {
      market: 4,
      supply: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      luxury: 1.3
    },
    healthRiskPerDay: 0.5,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "12°C。公告把米价按住了，店里的米却没货。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "11°C。楼下有人小声问，要不要换点米。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "11°C。价签没变，货架一直是空的。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "10°C。有人拿两包烟，换回了一袋面。"
      },
      {
        day: -3,
        severity: 0.42,
        hint: "10°C。巷子深处聚了人，摆着东西换。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "9°C。金饰和手表开始有人收，价压得低。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "9°C。明面上买不到，暗地里能凑齐。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "9°C。限价单贴了一墙，换东西的人更多了。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "8°C。有人上门收货，出价比店里高。"
      },
      {
        day: 2,
        severity: 0.94,
        hint: "8°C。药也能在黑市上换到，价钱翻倍。"
      },
      {
        day: 3,
        severity: 0.97,
        hint: "8°C。有人拿家电换油，说留着没用。"
      },
      {
        day: 4,
        severity: 1,
        hint: "8°C。查价的来了，摊子一下就散了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "8°C。明面上的价越压越低，货越少。"
      },
      {
        day: 6,
        severity: 1,
        hint: "8°C。有人专门收消息，知道哪条巷有货。"
      },
      {
        day: 7,
        severity: 1,
        hint: "8°C。换东西不问价，只问拿什么抵。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。有人把囤的奢侈品拿出来出手。"
      },
      {
        day: 9,
        severity: 1,
        hint: "9°C。黑市上的米比前一天又贵了一成。"
      },
      {
        day: 10,
        severity: 0.98,
        hint: "9°C。有人换到货，有人空手回来。"
      },
      {
        day: 11,
        severity: 0.96,
        hint: "9°C。店里的货回来了一些，限价还在。"
      },
      {
        day: 12,
        severity: 0.93,
        hint: "10°C。黑市的价格开始往下走。"
      },
      {
        day: 13,
        severity: 0.9,
        hint: "10°C。巷子里的摊子少了一半。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "10°C。今天不用再绕后巷了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场里钱最不好使：明面上限价的东西买不到，暗地里的东西不收钱、只收货，于是你囤的贵重品比现金管用得多。",
    decisions: ["明面上限价买不到，暗地里的货要不要多花钱去拿", "黑市只收货不收钱，值钱的物件要不要拿出来抵", "收货的人来得勤，是换一点还是留着自己用"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 10（priceSurcharge 0.6：明面限价、暗地加价）与 13（categoryEfficiency 奢侈 1.3：贵重品在黑市里最不经花、也最管用）。与抢购潮不撞：抢购潮是灾难前公开抢购；本场是灾难后明面限价与暗地交易并存。与配给登记不撞：配给登记是买得到但买不多、价格被压低；本场是明面买不到、暗地都要加价。"
  },
{
    id: "shelter_overload",
    name: "避难所超载",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "有地方去，但一个铺位三个人",
    temperatures: {
      [0]: 8,
      [3]: 7,
      [7]: 7,
      [11]: 8,
      [14]: 9,
      [-7]: 11,
      [-4]: 10,
      [-1]: 9
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["water", "medicine", "warmth"],
    windowScene: "packed-shelter",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.5,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.75,
    priceSurcharge: 0.25,
    eventPoolWeights: {
      people: 4,
      neighbor: 2
    },
    npcVisitFactor: 1.5,
    capacityFactor: 0.5,
    healthRiskPerDay: 1.5,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "11°C。体育馆门口开始登记，安排铺位。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "10°C。一个铺位挤了两个人，行李堆在过道。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "10°C。厕所排着队，水龙头一起用。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "9°C。又进来一批人，铺位不够分了。"
      },
      {
        day: -3,
        severity: 0.42,
        hint: "9°C。晚上有人打呼，隔壁铺的人翻来覆去。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "8°C。一个铺位三个人，行李只能抱在怀里。"
      },
      {
        day: -1,
        severity: 0.72,
        hint: "8°C。公告说还要再收一批，先到先得。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "8°C。今天人最多，过道也睡了人。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "7°C。有人咳嗽，一晚上没停。"
      },
      {
        day: 2,
        severity: 0.94,
        hint: "7°C。水不够用，洗漱要轮流。"
      },
      {
        day: 3,
        severity: 0.97,
        hint: "7°C。有人的东西在铺位上不见了。"
      },
      {
        day: 4,
        severity: 1,
        hint: "7°C。发了感冒药，说人挤着容易病。"
      },
      {
        day: 5,
        severity: 1,
        hint: "7°C。有人搬到了走廊，说睡不下。"
      },
      {
        day: 6,
        severity: 1,
        hint: "8°C。暖气不够，靠得近的人暖一点。"
      },
      {
        day: 7,
        severity: 1,
        hint: "8°C。铺位重新分了一次，还是挤。"
      },
      {
        day: 8,
        severity: 1,
        hint: "8°C。有人在门口等空位，等了一整天。"
      },
      {
        day: 9,
        severity: 1,
        hint: "8°C。分饭的队伍排到了楼外。"
      },
      {
        day: 10,
        severity: 0.98,
        hint: "8°C。有几户自己走了，空出两个铺。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "9°C。新来的人少了，铺位宽松了些。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "9°C。能每个人一个铺位了。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "9°C。有人陆陆续续搬回自己家。"
      },
      {
        day: 14,
        severity: 0.76,
        hint: "9°C。今天人少了一半。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "避难所里最先不够用的不是吃的，是能自己待着的地方：一个铺位三个人，你带来的东西没处放，连觉都睡不成，囤得再全也施展不开。",
    decisions: ["铺位只有一半，东西是随身带着还是寄存在门口", "人挤在一起，吃的和水按人头分，自家存货要不要拿出来", "夜里睡不安稳，白天要不要补觉，行动点怎么排"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/14（capacityFactor）/15/16，共 15 个。主打维度 14（capacityFactor 0.5：可用的空间只有一半）与 6（restEfficiency 0.5：挤在一起睡不好）。与封控不撞：封控是出不去、人在自己家；本场是有地方去、但地方不够，人全被塞进同一处。与骚乱不撞：骚乱是街上危险、来的人要抢；本场来的人也是逃难的，不是来抢的，压力是空间与休息。"
  },
{
    id: "fuel_ration",
    name: "燃油配给",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "车还在，油是按周给的",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 9,
      [11]: 10,
      [14]: 11,
      [-7]: 13,
      [-4]: 12,
      [-1]: 11
    },
    spoilRate: 1.3,
    dailyDrain: {
      fuel: 1
    },
    priorityCategories: ["fuel", "food", "tool"],
    windowScene: "ration-gas",
    shelterDecayPerDay: -1,
    restEfficiency: 0.8,
    carryFactor: 0.5,
    actionPointDelta: -1,
    shopSupplyFactor: 0.7,
    closedShopIds: ["gas_station"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      supply: 3,
      limit: 2
    },
    npcVisitFactor: 0.6,
    categoryEfficiency: {
      fuel: 0.5
    },
    healthRiskPerDay: 0.5,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "13°C。加油站贴了通知，按车牌限量。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。加一次油要排很久，还只给半箱。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "12°C。公告说油按周配给，凭本加。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "11°C。有人一次加了两个桶，被拦下来。"
      },
      {
        day: -3,
        severity: 0.42,
        hint: "11°C。车停得多了，跑一趟要算油。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "10°C。有人搭邻居的车去买东西。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "10°C。油站排到街口，半天才轮到。"
      },
      {
        day: 0,
        severity: 0.84,
        hint: "10°C。今天起按周发票，一周就这点。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "9°C。有人加了油不敢开，留着应急。"
      },
      {
        day: 2,
        severity: 0.94,
        hint: "9°C。车还在，油不够，只能少跑。"
      },
      {
        day: 3,
        severity: 0.97,
        hint: "9°C。有人拼车进城，一车捎三家的货。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。一趟要办的几件事，全得合并。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。有人的配额用完了，只能走路。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。油票被人拿去加价倒卖。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。有人在家门口自己存了一小桶。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。走路的多了，路上车少了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "9°C。搬重东西只能借车，要记人情。"
      },
      {
        day: 10,
        severity: 0.98,
        hint: "10°C。公告说配额下周减半。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "10°C。有人把车停着不动，省着油。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "10°C。油站每天限时开，队伍更长了。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "11°C。配额恢复了一点，加一次能跑几天。"
      },
      {
        day: 14,
        severity: 0.76,
        hint: "11°C。今天加油没排太久。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "车还在、路也通，可它动不了：油按周给，一趟出门要把几件事全塞进去，于是这一场最缺的不是货，是能跑的次数。",
    decisions: ["一周只有这点油，出门一次要把几件事合并", "油票能换东西，是留着自己用还是拿出去换粮", "车闲着不烧油，重活要不要改成用人力一趟趟搬"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 7（carryFactor 0.5：车动得少，一趟能运的少）+ 13（categoryEfficiency 燃油 0.5：油怎么用都不够）。与出城潮不撞：出城潮是人和车一起走空；本场车和人都在，动不了是因为油按周给。与征用不撞：征用是按清单把货抽走；本场没被抽，是自己手里的油不够跑。"
  },
{
    id: "unemployment",
    name: "失业潮",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "工资断了，钱只出不进",
    temperatures: {
      [0]: 11,
      [3]: 10,
      [7]: 10,
      [11]: 11,
      [14]: 12,
      [-7]: 14,
      [-4]: 13,
      [-1]: 12
    },
    spoilRate: 1.4,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["food", "luxury", "tool"],
    windowScene: "idle-factory-gate",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.65,
    carryFactor: 0.8,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["community_store"],
    priceSurcharge: 0.15,
    eventPoolWeights: {
      market: 3,
      neighbor: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      luxury: 0.6
    },
    healthRiskPerDay: 0.5,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。厂门口贴了停工通知，工资先不发。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "13°C。上班的人少了一半，车间空了。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "13°C。有人的班排不上了，只能在家。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "12°C。群里有人问哪里还招短工。"
      },
      {
        day: -3,
        severity: 0.42,
        hint: "12°C。有人把家里不用的东西拿出来卖。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "11°C。东西不好卖，压价也没人要。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "11°C。公告说下月工资还要再拖。"
      },
      {
        day: 0,
        severity: 0.82,
        hint: "11°C。今天起大半的人没有活干。"
      },
      {
        day: 1,
        severity: 0.88,
        hint: "10°C。有人开始接零活，一天一结。"
      },
      {
        day: 2,
        severity: 0.92,
        hint: "10°C。市场上卖东西的多，买的人少。"
      },
      {
        day: 3,
        severity: 0.96,
        hint: "10°C。东西越卖越便宜，还是卖不动。"
      },
      {
        day: 4,
        severity: 1,
        hint: "10°C。有人上门问，要不要收他家的旧货。"
      },
      {
        day: 5,
        severity: 1,
        hint: "10°C。手头没现金，便宜东西也买不起。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。有人拿工具换粮，说留着也生不了钱。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。街上闲逛的人多了起来。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。有几户开始退租，往更小的房子搬。"
      },
      {
        day: 9,
        severity: 0.98,
        hint: "9°C。有人靠帮人跑腿换两顿饭。"
      },
      {
        day: 10,
        severity: 0.96,
        hint: "9°C。公告说复工还没有准信。"
      },
      {
        day: 11,
        severity: 0.93,
        hint: "10°C。有厂子招人，只要几个。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "10°C。东西的价格开始稳住，不再往下走。"
      },
      {
        day: 13,
        severity: 0.86,
        hint: "11°C。有人回了原来的班，工资补了一部分。"
      },
      {
        day: 14,
        severity: 0.78,
        hint: "11°C。今天不少人重新去上班了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场里东西会越来越便宜，你却越来越买不起：价格跟着没有工资的人一起往下走，可决定你能不能过下去的是手上的现金，不是货价。",
    decisions: ["工资断了，手里的现金要按周重新分，先保吃还是先保用", "东西越来越便宜却卖不动，闲钱要不要现在换成耐放的货", "邻居上门收旧货，值钱的物件是趁早出手还是留着"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 10（priceSurcharge 0.15：没人有钱买，价格反而往下走）与 13（categoryEfficiency 奢侈 0.6：奢侈品没人接盘，最不值钱）。与配给登记不撞：配给登记是货少、价稳、限购；本场是货不缺、价降、没人买得起。与黑市不撞：黑市是暗地加价；本场是明面降价、有价无市。"
  },
{
    id: "security_vacuum",
    name: "治安真空",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "管的人没了，规则由最近的那群人定",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 9,
      [11]: 10,
      [14]: 11,
      [-7]: 13,
      [-4]: 12,
      [-1]: 11
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["tool", "medicine", "water"],
    windowScene: "no-law-street",
    shelterDecayPerDay: -2,
    restEfficiency: 0.6,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.55,
    closedShopIds: ["market"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      people: 3,
      panic: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      tool: 1.3
    },
    healthRiskPerDay: 1.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "13°C。巡逻的车少了，路口没人站岗。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。有人夜里听见砸门声，没见人来。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "12°C。几家店提前关门，说守不住。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "11°C。楼里几户凑钱请人看门。"
      },
      {
        day: -3,
        severity: 0.42,
        hint: "11°C。有人说看见陌生人挨家敲门。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "10°C。有户人家被翻窗，东西少了一半。"
      },
      {
        day: -1,
        severity: 0.72,
        hint: "10°C。公告停了，管事的人也不露面了。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "10°C。今天起街上没人管，各管各。"
      },
      {
        day: 1,
        severity: 0.92,
        hint: "9°C。有人拿着工具在楼下转了一夜。"
      },
      {
        day: 2,
        severity: 0.96,
        hint: "9°C。几栋楼自己定了规矩，谁人多谁说了算。"
      },
      {
        day: 3,
        severity: 1,
        hint: "9°C。有人上门收东西，说不交就不好看。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。有人把家当搬到了楼上锁起来。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。楼下聚了一伙人，晚上不走。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。有人结伴出门，一个人不敢走远。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。有楼自己排了班，轮着守夜。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。被翻过的那户，东西一直没找回来。"
      },
      {
        day: 9,
        severity: 0.98,
        hint: "9°C。有人把值钱的都换成了能防身的东西。"
      },
      {
        day: 10,
        severity: 0.96,
        hint: "10°C。街口几个楼联合设了点。"
      },
      {
        day: 11,
        severity: 0.94,
        hint: "10°C。有人的伤一直没好，药也不够。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "10°C。来的外人少了，夜里安静了些。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "11°C。有人说管事的人回来了。"
      },
      {
        day: 14,
        severity: 0.78,
        hint: "11°C。今天路上有人巡逻了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "管的人一走，规则不是消失，是被离你最近的那群人接了过去：谁人多谁定规矩，你囤的东西在他们眼里就成了可以分的。",
    decisions: ["没人管了，东西是留着还是换成能防身的东西", "楼里自己定规矩，出人守夜还是出物顶上", "一个人不敢走远，出门要结伴，行动点按人头摊"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 12（npcVisitFactor 1.3：来的不再是邻居，是来收东西的人）+ 13（categoryEfficiency 工具 1.3：能防身的工具这一场最有价值）。与骚乱不撞：骚乱是明面上的打砸，街上乱；本场没有骚乱，是管事的人退场后留下的空位，秩序被身边人接管。与巡逻不撞：巡逻是有人管、要登记；本场是没人管，规矩反过来。"
  },
{
    id: "return_wave",
    name: "返乡潮",
    family: "社会",
    level: "L3",
    tier: 3,
    axis: "外来的人涌进来，本地的货不够分",
    temperatures: {
      [0]: 11,
      [3]: 10,
      [7]: 10,
      [11]: 11,
      [14]: 12,
      [-7]: 14,
      [-4]: 13,
      [-1]: 12
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "water", "fuel"],
    windowScene: "crowded-station",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.75,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["market", "community_store"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      people: 4,
      queue: 2
    },
    npcVisitFactor: 1.5,
    categoryEfficiency: {
      food: 0.7
    },
    healthRiskPerDay: 1,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。车站里人多了，说外面也不好过。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "13°C。有人拖着行李回来，说是来找活干。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "13°C。小区里多了不少陌生面孔。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "12°C。超市的米面一到就空。"
      },
      {
        day: -3,
        severity: 0.42,
        hint: "12°C。有人在门口打听哪里能租到房。"
      },
      {
        day: -2,
        severity: 0.55,
        hint: "11°C。菜市场的人比平时多了一倍。"
      },
      {
        day: -1,
        severity: 0.72,
        hint: "11°C。有人开始在楼道里打地铺。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "11°C。今天起回来的人更多，货架一天空两次。"
      },
      {
        day: 1,
        severity: 0.9,
        hint: "10°C。买米要排队，每人限两份。"
      },
      {
        day: 2,
        severity: 0.94,
        hint: "10°C。有人在车站附近支了摊，卖吃的。"
      },
      {
        day: 3,
        severity: 0.97,
        hint: "10°C。本地的货不够分，价钱跟着涨。"
      },
      {
        day: 4,
        severity: 1,
        hint: "10°C。有户人家多了三口人住进来。"
      },
      {
        day: 5,
        severity: 1,
        hint: "10°C。水和电都不够用，晚上常停。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。有人开始和本地人抢活干。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。货架补了又空，店家也发愁。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。租房的价钱涨了，一间挤好几口。"
      },
      {
        day: 9,
        severity: 1,
        hint: "9°C。有人待不下去，买了车票又走。"
      },
      {
        day: 10,
        severity: 0.98,
        hint: "9°C。公告说会调货过来，让大家别挤。"
      },
      {
        day: 11,
        severity: 0.96,
        hint: "10°C。调来的货到了，队伍短了些。"
      },
      {
        day: 12,
        severity: 0.92,
        hint: "10°C。离开的人多了一些，街上的摊少了。"
      },
      {
        day: 13,
        severity: 0.87,
        hint: "11°C。买东西不用再抢，货架能撑到晚上。"
      },
      {
        day: 14,
        severity: 0.78,
        hint: "11°C。今天人少了些。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "涌进来的人不是来抢的，是来花钱的：本地货架被正常买搬空，比被抢空还快，因为你没有理由拦一笔正常的买卖。",
    decisions: ["外来的人多了，吃住都要分，自家的存货要不要拿出来", "货来得快、空得也快，补货的日子要提前算", "租房和找活的人多起来，出手存货换现金值不值"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 12（npcVisitFactor 1.5：来的人最勤，但大多是外来的生面孔）+ 9（shopSupplyFactor 0.45 并关掉农贸与社区店：本地的货被分薄）。与出城潮不撞：出城潮是本地人走空、没人来；本场正好相反，是人往里涌。与抢购潮不撞：抢购潮是本城人自己抢；本场是外来人口把本地货分薄，靠的是新增的人。"
  },
  // ═══ 生成内容 灾难-社会 止 ═══,
  // ═══ 生成内容 灾难-空气 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "sandstorm_air",
    name: "沙暴",
    family: "空气",
    level: "L3",
    tier: 2,
    axis: "空气与呼吸：出不了门，屋里也在慢慢耗你",
    temperatures: {
      [0]: 26,
      [3]: 28,
      [7]: 29,
      [11]: 27,
      [14]: 24,
      [-7]: 20,
      [-4]: 21,
      [-1]: 23
    },
    spoilRate: 1.2,
    dailyDrain: {
      water: 2,
      medicine: 1
    },
    priorityCategories: ["water", "medicine"],
    windowScene: "sand-haze",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.65,
    carryFactor: 0.6,
    actionPointDelta: 0,
    shopSupplyFactor: 0.6,
    closedShopIds: ["weekend_flea"],
    priceSurcharge: 0.25,
    eventPoolWeights: {
      cold: 2,
      supply: 2,
      neighbor: 2
    },
    npcVisitFactor: 0.6,
    categoryEfficiency: {
      water: 0.8
    },
    healthRiskPerDay: 2,
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "20°C。北边来的风，天是黄的。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "21°C。能见度不到五百米，车都开了雾灯。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "22°C。阳台上落了一层土，扫不干净。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "23°C。学校停课，家长在楼下接孩子。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "24°C。口罩又开始限购了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "25°C。窗户缝里能摸到细沙。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "26°C。气象台说后面几天会更糟。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "26°C。中午天暗下来，路灯全亮着。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "27°C。外面看不清对面的楼。"
      },
      {
        day: 2,
        severity: 1,
        hint: "28°C。窗台上一天能扫出半盆土。"
      },
      {
        day: 3,
        severity: 1,
        hint: "28°C。嗓子干，喝水也不解。"
      },
      {
        day: 4,
        severity: 1,
        hint: "29°C。有人用胶带把窗缝贴了一圈。"
      },
      {
        day: 5,
        severity: 1,
        hint: "29°C。空气里有股土腥味，进屋也散不掉。"
      },
      {
        day: 6,
        severity: 1,
        hint: "29°C。夜里咳醒了两回。"
      },
      {
        day: 7,
        severity: 1,
        hint: "28°C。楼下的车都成了土黄色。"
      },
      {
        day: 8,
        severity: 1,
        hint: "28°C。药店的止咳药卖完了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "27°C。风小了半天，土还悬在空中。"
      },
      {
        day: 10,
        severity: 1,
        hint: "27°C。门口的垫子早就没用了。"
      },
      {
        day: 11,
        severity: 0.95,
        hint: "27°C。有人说再撑几天就过去了。"
      },
      {
        day: 12,
        severity: 0.9,
        hint: "26°C。能看见一点天了，还是黄的。"
      },
      {
        day: 13,
        severity: 0.85,
        hint: "25°C。路上开始有人，都戴着口罩。"
      },
      {
        day: 14,
        severity: 0.8,
        hint: "24°C。风转向了。撑过今天就算过去了。"
      }
    ],
    counterIntuitive: "最难受的地方是「屋里」。门窗关死之后，细沙照样从缝里进来，所以这一场是唯一一场你待在家里也每天掉健康的灾难；而水反而更不经喝，因为嗓子一直在干",
    decisions: ["出门一趟能补货，但吸进去的那点土会在后面几天找回来", "窗缝要用胶带封死（费工具）还是留着透气（继续掉健康）", "水的消耗比平常快两成，按 14 天囤的量其实只够 11 天"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 13 个。主打维度 15（healthRiskPerDay 2 。 「不看玩家做了什么也在掉血」的唯一一场，而且它必须小：2 × 14 = 28 点健康，是「拖不起」而不是「必死」）。healthRiskPerDay 的读点在日结算的④.5，进硬撑快照之前。与洪水不撞：洪水是「低处的东西完了」（空间），本场是「屋里的空气完了」（身体）。"
  },
{
    id: "toxic_fog",
    name: "毒雾",
    family: "空气",
    level: "L3",
    tier: 3,
    axis: "高度与楼层：雾沉在低处，住得越低越待不住，值钱的东西却在高处",
    temperatures: {
      [0]: 16,
      [3]: 15,
      [7]: 15,
      [11]: 16,
      [14]: 17,
      [-7]: 18,
      [-4]: 18,
      [-1]: 17
    },
    spoilRate: 1.3,
    dailyDrain: {
      medicine: 1,
      water: 1
    },
    priorityCategories: ["medicine", "food"],
    windowScene: "low-fog",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.6,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.65,
    closedShopIds: ["weekend_flea"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      dark: 2,
      supply: 2,
      people: 2
    },
    npcVisitFactor: 0.7,
    categoryEfficiency: {
      tool: 0.8
    },
    capacityFactor: 0.8,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 2.2,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "18°C。预报说城郊起雾，傍晚会往城里挪。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "18°C。路口的雾比楼上厚，走路要打灯。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "17°C。低洼处的雾到中午都不散。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "17°C。有人说一层楼道里十米外看不见。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "16°C。口罩又限购了，药店排起队。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "16°C。气象台说这股雾要压三天。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "15°C。楼下比五楼闷，有人往楼上搬。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "15°C。雾沉在低处，一层最浓。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "16°C。住得低的人夜里咳得多。"
      },
      {
        day: 2,
        severity: 1,
        hint: "16°C。超市的水和药被人整箱搬。"
      },
      {
        day: 3,
        severity: 1,
        hint: "17°C。有人把铺盖搬到了顶层楼道。"
      },
      {
        day: 4,
        severity: 1,
        hint: "17°C。雾不散，低处比楼上更呛。"
      },
      {
        day: 5,
        severity: 1,
        hint: "17°C。搬一箱东西上六楼，歇了三回。"
      },
      {
        day: 6,
        severity: 1,
        hint: "16°C。一层开始有人往外借住。"
      },
      {
        day: 7,
        severity: 1,
        hint: "16°C。楼上的人说屋里还行。"
      },
      {
        day: 8,
        severity: 1,
        hint: "15°C。药店的止咳糖浆卖空了。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "15°C。中午雾薄了一点，傍晚又厚。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "16°C。有人在高层的窗口挂了湿布。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "16°C。预报说后天有风，雾会散。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "17°C。低处先见亮，楼上还是灰的。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "17°C。风起了，雾一层层往下退。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "17°C。能看见对面楼的顶了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "雾是往下沉的，所以住得越高越安全，可高层也最难把成箱的东西搬上去。这一场逼你在『住得高』和『搬得动』之间挑：想要干净空气就得放弃搬运效率，而最先不能住人的是最低那层。",
    decisions: ["低处的储物区不能用，东西要往高楼层挤，而一趟只能搬那么点", "行动点少一个，是今天多搬一趟，还是把药先补足", "楼层低的人来借宿，给的是床位和空气，换回来的是消息还是负担"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 capacityFactor 与 unusableShelfIds）/15/16，共 16 个，属 L3。主打维度 14（低处那一格货架摘掉 + capacityFactor 0.8：把『高度』做成空间损失）与 15（healthRiskPerDay 2.2）。与沙暴不撞：沙暴是均匀的『屋里也掉血』且主线在水，本场是『暴露随高度变化』，低处与高处取值相反，还额外动了空间与搬运。与烟霾不撞：烟霾的轴是距离失效，本场是高度。"
  },
{
    id: "smoke_haze",
    name: "烟霾",
    family: "空气",
    level: "L3",
    tier: 2,
    axis: "距离与能见度：火在几百公里外，本地没火没灰，空气却比火场还差",
    temperatures: {
      [0]: 30,
      [3]: 31,
      [7]: 30,
      [11]: 28,
      [14]: 26,
      [-7]: 24,
      [-4]: 26,
      [-1]: 28
    },
    spoilRate: 1.5,
    dailyDrain: {
      water: 1,
      medicine: 1
    },
    priorityCategories: ["medicine", "tool"],
    windowScene: "smoke-drift",
    shelterDecayPerDay: -2,
    restEfficiency: 0.7,
    carryFactor: 0.7,
    actionPointDelta: 0,
    shopSupplyFactor: 0.6,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      dark: 2,
      supply: 2,
      market: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      tool: 0.7
    },
    healthRiskPerDay: 1.8,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "24°C。北边山火的消息传了两天。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "26°C。天边有点发灰，以为是阴天。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "28°C。空气里有股焦味，关窗也闻得到。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "29°C。能见度降了，远处的楼看不清。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "30°C。口罩限购，一家只卖两个。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "30°C。气象台说烟要飘过来几天。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "31°C。中午的天是橙色的。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "31°C。太阳成了一个红点。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "31°C。街上的人都戴上了口罩。"
      },
      {
        day: 2,
        severity: 1,
        hint: "30°C。屋里也有烟味，窗帘关不严。"
      },
      {
        day: 3,
        severity: 1,
        hint: "30°C。嗓子发干，喝水压不下去。"
      },
      {
        day: 4,
        severity: 1,
        hint: "30°C。山火还在烧，风往这边吹。"
      },
      {
        day: 5,
        severity: 1,
        hint: "29°C。晾在阳台的衣服沾了灰。"
      },
      {
        day: 6,
        severity: 1,
        hint: "29°C。有人开始买空气净化器。"
      },
      {
        day: 7,
        severity: 1,
        hint: "28°C。夜里被烟味呛醒。"
      },
      {
        day: 8,
        severity: 1,
        hint: "28°C。药店的润喉药卖完了。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "28°C。预报说风向要转。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "27°C。天边亮出来一条，还是灰的。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "26°C。能见度好了一点。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "26°C。有风了，烟味淡下去。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "25°C。能看清对面的楼了。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "24°C。天蓝回来了一点。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "火在几百公里外，本地既没有火也没有灰，可空气质量读数比火场边上还高。于是『离得远』在这条线上不等于安全：这一场真正被抢空的不是食物，是口罩和水。",
    decisions: ["口罩耗得比平时快，出门一趟值不值，按能见度还是按喉咙排", "屋里也在飘烟，封窗（费工具）还是开窗透气，两头的账怎么算", "净化器耗电，夜里开还是关，电量和睡眠只能保一样"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 12 个，属 L3。主打维度 11（eventPoolWeights 里 dark 2 与 market 2：能见度与抢购同时抬头）与 15（healthRiskPerDay 1.8）。与沙暴不撞：沙暴是本地扬沙、水更不经喝；本场是外地烟源、主抢口罩与净化，暗线是距离失效。与毒雾不撞：毒雾的轴是高度，本场是能见度与呼吸道。"
  },
{
    id: "chem_leak_air",
    name: "化工泄漏",
    family: "空气",
    level: "L3",
    tier: 3,
    axis: "时机与风：泄漏只发一次，风一转向，安全的地方就不再安全",
    temperatures: {
      [0]: 14,
      [3]: 14,
      [7]: 15,
      [11]: 16,
      [14]: 16,
      [-7]: 16,
      [-4]: 16,
      [-1]: 15
    },
    spoilRate: 1.2,
    dailyDrain: {
      medicine: 2
    },
    priorityCategories: ["medicine", "water", "tool"],
    windowScene: "chemical-plume",
    shelterDecayPerDay: -3,
    restEfficiency: 0.55,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market", "hardware"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      panic: 3,
      people: 2,
      queue: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      tool: 0.6
    },
    healthRiskPerDay: 2.5,
    scoreWeights: {
      emergency: 4
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "16°C。城郊那家化工厂贴了检修通知。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "16°C。新闻里提了一句管道老化。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "15°C。有人说厂里的夜班停了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "15°C。风向是往北的，城这边没味。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "14°C。群里开始传一张厂区的照片。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "14°C。预报说午后要转南风。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "14°C。有人把窗关死了，说别开。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "14°C。半夜厂区响了警报，风正对着城。"
      },
      {
        day: 1,
        severity: 1,
        hint: "15°C。空气里有股刺鼻的甜味。"
      },
      {
        day: 2,
        severity: 1,
        hint: "15°C。物业在群里喊关窗，别出门。"
      },
      {
        day: 3,
        severity: 1,
        hint: "16°C。风向变了，城东的人开始往外走。"
      },
      {
        day: 4,
        severity: 1,
        hint: "16°C。几个小区在组织撤离。"
      },
      {
        day: 5,
        severity: 1,
        hint: "16°C。有人以为安全了，把窗打开。"
      },
      {
        day: 6,
        severity: 1,
        hint: "16°C。风又转回来，开窗那栋最先呛。"
      },
      {
        day: 7,
        severity: 1,
        hint: "15°C。药店的湿毛巾和胶带卖光了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "15°C。厂区那边说有第二次放空。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "15°C。风向稳了，往北去了。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "16°C。味淡了，还是不敢开窗。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "16°C。通报说泄漏源止住了。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "16°C。有人回了低楼层，还是不放心。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "16°C。空气测了几回，说正常了。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "16°C。今天开了一次窗。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "泄漏只发生一次，但这一场的时间观是反的：最危险的不是泄漏那一刻，而是风转向之后你以为已经安全、把窗打开的那半天。真正该囤的不是药，是能封窗的胶带和能判断风向的东西。",
    decisions: ["关窗还是通风，味重的时候拿什么挡住窗缝，工具够不够", "撤还是留，走的人多路就堵，留守的补给能不能撑到风转", "急救的东西先补，还是先备封窗的材料，时间与行动点怎么分"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 12 个，属 L3。主打维度 16（scoreWeights emergency 4：这一场里急用的够不够得到压倒一切，全批权重最高）与 12（npcVisitFactor 1.3 加 panic 3：撤离压力让人来得更勤）。与沙暴不撞：沙暴持续且均匀，本场是一次性事件加风向反转，靠关窗时机而非戴口罩。与烟霾不撞：烟霾是远处持续飘，本场是本地突发一次。"
  },
{
    id: "dust_air",
    name: "粉尘",
    family: "空气",
    level: "L3",
    tier: 2,
    axis: "全城扬尘：工地与塌方把灰扬到每个角落，真正被吃掉的是水",
    temperatures: {
      [0]: 25,
      [3]: 26,
      [7]: 25,
      [11]: 24,
      [14]: 23,
      [-7]: 22,
      [-4]: 23,
      [-1]: 24
    },
    spoilRate: 1.4,
    dailyDrain: {
      water: 2
    },
    priorityCategories: ["tool", "food"],
    windowScene: "dust-plume",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.7,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["weekend_flea"],
    priceSurcharge: 0.25,
    eventPoolWeights: {
      supply: 2,
      neighbor: 2
    },
    categoryEfficiency: {
      tool: 0.6,
      water: 0.8
    },
    healthRiskPerDay: 1.8,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。城东那片工地开始大面积拆楼。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "23°C。风一过，阳台就是一层灰。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "24°C。工地没盖防尘网，居民在投诉。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "24°C。晾的被子收晚了，全是土。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "25°C。有段基坑塌了，扬起来一片。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "25°C。有人说灰里带着水泥味。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "25°C。预报说这两天没雨，灰落不下。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "25°C。半座城罩在灰里，看不清对面。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "25°C。早上擦的桌子，中午又是一层。"
      },
      {
        day: 2,
        severity: 1,
        hint: "25°C。扫一遍地，盆里半盆灰。"
      },
      {
        day: 3,
        severity: 1,
        hint: "24°C。塌方的土堆到了路边。"
      },
      {
        day: 4,
        severity: 1,
        hint: "24°C。口罩挡得住大口，挡不住细的。"
      },
      {
        day: 5,
        severity: 1,
        hint: "24°C。擦窗的水一天要换四五回。"
      },
      {
        day: 6,
        severity: 1,
        hint: "24°C。有人说水管里接出来是黄水。"
      },
      {
        day: 7,
        severity: 1,
        hint: "24°C。拖把洗三遍水还是浑的。"
      },
      {
        day: 8,
        severity: 1,
        hint: "23°C。工地那边堆成了小山。"
      },
      {
        day: 9,
        severity: 1,
        hint: "23°C。有人开始用湿布贴窗缝。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "23°C。风小了，灰还悬着。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "23°C。预报说夜里有一场小雨。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "23°C。雨下了半宿，路上泥成一片。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "23°C。空气里的灰少多了。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "23°C。桌子擦一遍就干净了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "扬尘最重的地方不是工地，是整座城。塌方和工地把灰扬到每个角落，真正被消耗掉的是水：灰落在每一样东西上，一天要擦几遍。而这一场里最该省着用的水，恰恰是让屋里还能住人的那份。",
    decisions: ["水是拿来喝的还是拿来擦的，一天擦几遍要定量", "窗缝糊上就不通风，屋里的灰少一点，呼吸差一点，怎么选", "塌方封了几条路，绕行更远，搬运量要不要跟着重估"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/13/15，共 13 个，属 L3。主打维度 13（categoryEfficiency.water 0.8：水被挪去清洁）与 15（healthRiskPerDay 1.8：扬尘对呼吸道的持续损伤）。与沙暴不撞：沙暴是外地来沙、主线是能见度与嗓子，本场是塌方与工地扬尘笼罩全城，清洁耗水与呼吸道一起压。与烟霾不撞：烟霾是外地烟源、主抢口罩，本场是本地土方与灰。"
  },
{
    id: "acid_mist",
    name: "酸雾",
    family: "空气",
    level: "L3",
    tier: 3,
    axis: "腐蚀与设备：伤人有限，伤工具和布料最狠，放着不动也在坏",
    temperatures: {
      [0]: 11,
      [3]: 11,
      [7]: 12,
      [11]: 13,
      [14]: 13,
      [-7]: 14,
      [-4]: 13,
      [-1]: 12
    },
    spoilRate: 1.2,
    dailyDrain: {
      tool: 1,
      medicine: 1
    },
    priorityCategories: ["tool", "warmth"],
    windowScene: "acid-haze",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.7,
    carryFactor: 0.5,
    actionPointDelta: -1,
    shopSupplyFactor: 0.55,
    closedShopIds: ["hardware", "weekend_flea"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      market: 2,
      supply: 2,
      queue: 2
    },
    npcVisitFactor: 0.7,
    categoryEfficiency: {
      tool: 0.6,
      warmth: 0.7
    },
    capacityFactor: 0.85,
    healthRiskPerDay: 1.2,
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。预报说这几天有酸性的雾。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "13°C。晾在外面的铁架子泛了红点。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "12°C。车把手摸上去有点涩。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "12°C。阳台上放的工具，一天就锈。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "11°C。有人说布面衣服放着也发脆。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "11°C。五金店的防锈油卖得快。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "11°C。雾里有股说不上来的酸味。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "11°C。一夜下来，外面的铁全花了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "12°C。带出去的钳子，回来拉不动。"
      },
      {
        day: 2,
        severity: 1,
        hint: "12°C。有人把工具全搬进了屋。"
      },
      {
        day: 3,
        severity: 1,
        hint: "12°C。雨衣的边角一搓就破。"
      },
      {
        day: 4,
        severity: 1,
        hint: "13°C。窗户的合页锈住了，推不动。"
      },
      {
        day: 5,
        severity: 1,
        hint: "13°C。晾的衣服越晾越脆。"
      },
      {
        day: 6,
        severity: 1,
        hint: "13°C。有人给门锁上了油，两天又涩。"
      },
      {
        day: 7,
        severity: 1,
        hint: "13°C。菜刀放厨房台上，刃口起了斑。"
      },
      {
        day: 8,
        severity: 1,
        hint: "13°C。五金店的东西也锈了，没法买。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "13°C。有人说这雾对皮肤也不好。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "13°C。雾薄了，东西还是在坏。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "13°C。预报说有一股干空气要下来。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "13°C。锈斑不再新长，旧的擦不掉。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "13°C。风干了，雾散了。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "14°C。今天带东西出去没再锈。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "酸雾伤的不是人，是你的工具。铁器、拉链、布面在雾里放一天就锈、就脆，于是这一场的损耗记在装备上：你可以不出门，但放在阳台的工具照样在坏，越是不能用的东西越占地方。",
    decisions: ["工具和布料耐用度下降，带出门的和留在家里的要分开摆", "能防锈的油和胶要省着用，还是先把最要紧的几件护起来", "坏掉的东西占着位置，清出去还是留着等修，空间怎么腾"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 capacityFactor）/15/16，共 16 个，属 L3。主打维度 13（categoryEfficiency 同时打 tool 0.6 与 warmth 0.7：装备与布料一起失效）与 1（dailyDrain.tool 1：全批唯一把工具写进每日消耗的场次）。与沙暴不撞：沙暴伤呼吸道、主线是健康与水，本场伤装备、healthRiskPerDay 只有 1.2，方向相反。与化工泄漏不撞：那是急性一次性，本场是慢性持续腐蚀。"
  },
{
    id: "haze_still",
    name: "雾霾",
    family: "空气",
    level: "L3",
    tier: 2,
    axis: "静稳与心情：不下雨不刮风恰恰是最糟，晾不干也提不起劲",
    temperatures: {
      [0]: 1,
      [3]: 1,
      [7]: 2,
      [11]: 3,
      [14]: 3,
      [-7]: 4,
      [-4]: 3,
      [-1]: 2
    },
    spoilRate: 0.9,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["medicine", "warmth", "luxury"],
    windowScene: "grey-still",
    shelterDecayPerDay: -1,
    restEfficiency: 0.65,
    carryFactor: 0.75,
    actionPointDelta: 0,
    shopSupplyFactor: 0.75,
    priceSurcharge: 0.2,
    eventPoolWeights: {
      dark: 2,
      market: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      warmth: 0.8
    },
    healthRiskPerDay: 1.4,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "4°C。这几天没风，天一直是灰的。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "3°C。晾在屋里的衣服两天没干。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "3°C。看不见太阳，也不知道几点。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "2°C。空气里有股闷味，开窗也散不掉。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "1°C。楼下老人说嗓子发紧。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "1°C。预报说静稳天气还要一周。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "1°C。口罩又限购了，药店排着队。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "1°C。一整天没见太阳，天是铅灰的。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "1°C。屋里比外面还闷，人提不起劲。"
      },
      {
        day: 2,
        severity: 1,
        hint: "2°C。衣服晾不干，柜子里全是潮的。"
      },
      {
        day: 3,
        severity: 1,
        hint: "2°C。有人整天不想说话。"
      },
      {
        day: 4,
        severity: 1,
        hint: "2°C。被子泛潮，盖着不暖。"
      },
      {
        day: 5,
        severity: 1,
        hint: "2°C。药店的清肺药卖得快。"
      },
      {
        day: 6,
        severity: 1,
        hint: "2°C。窗上蒙了一层灰，擦也不顶用。"
      },
      {
        day: 7,
        severity: 1,
        hint: "3°C。有人把除湿的东西摆了一屋。"
      },
      {
        day: 8,
        severity: 1,
        hint: "3°C。太阳还是没出来。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "3°C。预报说有一股冷空气在路上。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "3°C。风起了点，灰被吹高了一层。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "3°C。晾了三天的衣服终于半干。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "3°C。天边亮了一点。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "3°C。看见太阳的边了。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "4°C。今天出了太阳。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "静稳意味着没有风，没有风就散不掉，所以不下雨也不刮风这种看着最省心的天气，恰恰是这一场最糟的条件。更别扭的是：晾不干的衣服让人更冷，你越想保暖越保暖不了；待在屋里越闷，越提不起劲。",
    decisions: ["衣服晾不干，收进柜子还是挂在外面，潮气往哪放", "看不见太阳，作息乱了，行动点怎么排", "闷得慌有人来串门，接待还是关门，情绪与消耗怎么算"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/13/15/16，共 15 个，属 L3。主打维度 6（restEfficiency 0.65 与心情：把『静稳』写成睡眠与动力一起下降）与 13（categoryEfficiency warmth 0.8：潮气让保暖打折）。与沙暴不撞：沙暴是能见度差加健康掉血，本场几乎见不到沙，压力是闷、潮、没太阳。与毒雾不撞：本场雾是均匀的灰，没有高度差。花粉已并作本族的季节性变体，挂在本场（雾霾），因此不再单独立场。"
  },
{
    id: "swamp_gas",
    name: "沼气场",
    family: "空气",
    level: "L3",
    tier: 3,
    axis: "低处与明火：下水道返上来的气，让点火做饭变成一次赌博",
    temperatures: {
      [0]: 23,
      [3]: 24,
      [7]: 24,
      [11]: 23,
      [14]: 22,
      [-7]: 20,
      [-4]: 21,
      [-1]: 22
    },
    spoilRate: 1.6,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["fuel", "tool"],
    windowScene: "sewer-gas",
    shelterDecayPerDay: -2,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: 0,
    shopSupplyFactor: 0.6,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      people: 2,
      panic: 2,
      supply: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      fuel: 0.7
    },
    capacityFactor: 0.75,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1.6,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "20°C。小区里一股下水道的味，散不掉。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "21°C。物业说化粪池该清了。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "22°C。低层的楼道里味最重。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "23°C。有人说厨房的管道在返气。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "24°C。点灶火苗发蓝，有人关掉了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "24°C。预报说这几天没风，气散不掉。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "23°C。楼道里贴了纸，说别用明火。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "23°C。半夜有人开煤气取暖，出了事。"
      },
      {
        day: 1,
        severity: 1,
        hint: "22°C。一楼开始有人往外搬。"
      },
      {
        day: 2,
        severity: 1,
        hint: "22°C。下水道水位涨了，味更冲。"
      },
      {
        day: 3,
        severity: 1,
        hint: "22°C。有人改吃冷食，不敢开火。"
      },
      {
        day: 4,
        severity: 1,
        hint: "22°C。底层的储物间不让待了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "21°C。楼道的灯都换成了防爆的。"
      },
      {
        day: 6,
        severity: 1,
        hint: "21°C。有户人家的地板缝里往外冒气。"
      },
      {
        day: 7,
        severity: 1,
        hint: "21°C。低处的东西往楼上搬，一趟趟来。"
      },
      {
        day: 8,
        severity: 1,
        hint: "21°C。有人把炉子搬到了院子里烧。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "22°C。味小了点，还是不敢点。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "22°C。物业在往井里灌水。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "22°C。风起了，味散得快。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "22°C。低层的味淡下去了。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "22°C。有人回了一层，先开窗。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "22°C。今天敢开火了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场里最不该用的东西是燃料：有火就有气爆的风险，于是能加热从优点变成了隐患，你得改吃冷的。而低处的储物间不能久待，偏偏那也是你平时放东西最多的地方，得先把它清出来。",
    decisions: ["开火做饭还是改吃冷食，燃料的用法整个翻转", "低处那格储物区要腾空，东西往哪挪，摆放顺序重排", "楼道里的气从哪来判定不了，是今天搬东西还是先测一测"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 capacityFactor 与 unusableShelfIds）/15/16，共 16 个，属 L3。主打维度 13（categoryEfficiency fuel 0.7：燃料从优势变隐患，全批唯一打燃料的场次）与 16（scoreWeights placement 3：摆放决定安全，低处的东西要挪）。与沙暴不撞：沙暴是外部扬沙、屋里掉血；本场的气来自地下，且核心是明火风险与低处禁住。与毒雾不撞：毒雾的雾在地面以上分层，本场的气从管道往上冒、还带动火风险。"
  },
{
    id: "ammonia_leak",
    name: "氨泄漏",
    family: "空气",
    level: "L3",
    tier: 2,
    axis: "时间窗：眼睛和喉咙先替你报警，能忍的那几个小时才是撤退窗口",
    temperatures: {
      [0]: 5,
      [3]: 5,
      [7]: 6,
      [11]: 7,
      [14]: 7,
      [-7]: 8,
      [-4]: 7,
      [-1]: 6
    },
    spoilRate: 1.1,
    dailyDrain: {
      medicine: 2,
      water: 1
    },
    priorityCategories: ["medicine", "water", "luxury"],
    windowScene: "ammonia-leak",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.55,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["wholesale", "community_store"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      panic: 3,
      queue: 2,
      people: 2
    },
    npcVisitFactor: 1.4,
    categoryEfficiency: {
      water: 0.7
    },
    healthRiskPerDay: 2.3,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "8°C。城东那个冷库在检修管道。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "7°C。有人说冷库的阀门有点漏。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "6°C。厂里把夜班改成了白班。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "6°C。风是往北的，城这边没味。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "5°C。群里传了一张冷库的照片。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "5°C。预报说夜里要转东南风。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "5°C。有住户把窗都关死了。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "5°C。凌晨一声闷响，街上开始有味。"
      },
      {
        day: 1,
        severity: 1,
        hint: "6°C。眼睛和喉咙先受不了，有人跑了出来。"
      },
      {
        day: 2,
        severity: 1,
        hint: "6°C。有人觉得适应了，回屋拿东西。"
      },
      {
        day: 3,
        severity: 1,
        hint: "7°C。风没转，味顺着巷子往里灌。"
      },
      {
        day: 4,
        severity: 1,
        hint: "7°C。卫生站免费发水和纱布。"
      },
      {
        day: 5,
        severity: 1,
        hint: "7°C。有人用水一遍遍冲眼睛。"
      },
      {
        day: 6,
        severity: 1,
        hint: "7°C。能忍的窗口过了，重的都送走了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "7°C。药店的生理盐水、眼药水空了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "7°C。厂区那边说还没堵上。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "7°C。风向转了，往空地去了。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "7°C。味淡了，人还是不敢回低处。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "7°C。通报说阀门关上了。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "7°C。有人回屋，先开窗通了半天。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "7°C。空气测了几回，说没事了。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "7°C。今天敢开窗吃饭了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "泄漏最狠的头几个小时，你的眼睛和喉咙会先替你报警，于是这一场比的是在还能忍的时候撤退，而不是等味道散了再走。真等到不觉得难受了，窗口已经过了，回去拿东西的那一趟最要命。",
    decisions: ["眼睛还在流泪的时候走，还是等适应了再说，窗口只有几小时", "水要留着冲眼睛还是留着喝，冲洗的消耗按什么定量", "回头取东西的风险与损失怎么权衡，什么该丢下"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 12 个，属 L3。主打维度 15（healthRiskPerDay 2.3：急性高值，但它的读点是时间窗）与 13（categoryEfficiency water 0.7：水被挪去冲洗，喝的那份就紧）。与化工泄漏不撞：那是本地一次突发加风向反转，本场是冷库急性泄漏加撤退窗口；两者 closedShopIds 与 categoryEfficiency 打的品类都不同（tool 对 water）。与沙暴不撞：沙暴是慢性，本场是急性。"
  },
{
    id: "mold_spore",
    name: "霉孢子",
    family: "空气",
    level: "L3",
    tier: 2,
    axis: "室内更浓：孢子是墙里长出来的，关窗比开窗更糟，屋里的空气比屋外差",
    temperatures: {
      [0]: 24,
      [3]: 24,
      [7]: 23,
      [11]: 22,
      [14]: 22,
      [-7]: 21,
      [-4]: 22,
      [-1]: 23
    },
    spoilRate: 2.6,
    dailyDrain: {
      medicine: 1
    },
    priorityCategories: ["medicine", "food", "warmth"],
    windowScene: "spore-wall",
    shelterDecayPerDay: -2,
    restEfficiency: 0.6,
    carryFactor: 0.8,
    actionPointDelta: 0,
    shopSupplyFactor: 0.65,
    priceSurcharge: 0.3,
    eventPoolWeights: {
      supply: 2,
      neighbor: 2,
      water: 2
    },
    npcVisitFactor: 0.85,
    categoryEfficiency: {
      food: 0.7,
      warmth: 0.75
    },
    healthRiskPerDay: 1.9,
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "21°C。下了半个月的雨，墙角发潮。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "22°C。有人开始打喷嚏，说像过敏。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "23°C。柜子背面长了一层绿毛。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "23°C。屋里的味比屋外重。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "24°C。有人把床搬到了厅里。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "24°C。预报说潮气还要压几天。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "23°C。晾的衣服上落了黑点。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "23°C。墙根一片一片地黑。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "23°C。关着窗，屋里的味更冲。"
      },
      {
        day: 2,
        severity: 1,
        hint: "23°C。开窗一天，反而好受一点。"
      },
      {
        day: 3,
        severity: 1,
        hint: "22°C。有人咳到夜里睡不着。"
      },
      {
        day: 4,
        severity: 1,
        hint: "22°C。药店的抗过敏药卖光了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "22°C。床垫翻过来，背面全是斑。"
      },
      {
        day: 6,
        severity: 1,
        hint: "22°C。有人把被褥搬到楼下晒。"
      },
      {
        day: 7,
        severity: 1,
        hint: "22°C。晒过的当天晚上还是痒。"
      },
      {
        day: 8,
        severity: 1,
        hint: "22°C。墙角的霉擦了又长。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "22°C。有人说这股味吸久了头疼。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "22°C。天晴了一点，屋里的斑没退。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "22°C。风进来了，味散了些。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "22°C。潮气下去，喷嚏少了。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "22°C。墙上的斑干了，不敢擦。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "22°C。今天没怎么打喷嚏。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "屋外的空气反而更干净：孢子是屋里的墙面返潮长出来的，你把窗关得越严，浓度越高。于是这一场第一次让通风变成保命动作，而平时最安全的躲在家里在这里是反着算的，躲得越严越糟。",
    decisions: ["关窗躲潮还是开窗放孢子，屋里屋外两个浓度要挑一头", "食物和衣物受潮效率下降，哪一批先处理，临期账重排", "被褥搬到楼下晒要不要搭上一天，行动点怎么挪"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 12 个，属 L3。主打维度 2（spoilRate 2.6）与 13（categoryEfficiency food 0.7 与 warmth 0.75：受潮让吃的和盖的一起打折）。与沙暴不撞：沙暴是外面的沙进来导致屋里难受，本场是屋里自己长出孢子、开窗反而更好，方向正好相反。与雾霾不撞：雾霾是静稳散不掉且看不见太阳，本场主线是霉与过敏。"
  },
{
    id: "coal_smoke",
    name: "烟尘",
    family: "空气",
    level: "L3",
    tier: 2,
    axis: "逆温与排放：冷到要烧煤，逆温层又把全城的烟扣在城里，越冷越憋",
    temperatures: {
      [0]: -2,
      [3]: -3,
      [7]: -3,
      [11]: -2,
      [14]: -1,
      [-7]: 2,
      [-4]: 1,
      [-1]: 0
    },
    spoilRate: 0.8,
    dailyDrain: {
      medicine: 1
    },
    priorityCategories: ["medicine", "luxury"],
    windowScene: "coal-smoke",
    shelterDecayPerDay: -1.8,
    restEfficiency: 0.65,
    carryFactor: 0.7,
    shopSupplyFactor: 0.7,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      cold: 3,
      market: 2,
      supply: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      warmth: 0.85
    },
    healthRiskPerDay: 2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "2°C。天冷了，小区里开始烧煤取暖。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "1°C。早上推开窗，外面一层灰白。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "0°C。楼下几个烟囱一起冒。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "0°C。预报说这几天风小，烟散不掉。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-1°C。有人说喉咙一早就发紧。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-2°C。空气里有一股煤味，压得很低。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-2°C。天越冷，烟囱越多。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "-2°C。灰白的一层压在城上，散不掉。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "-3°C。白天夜里都是那股煤味。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-3°C。开窗比关窗还呛。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-3°C。楼道里也是一股烟。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-3°C。有人戴两层口罩出门。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-3°C。药店的止咳药卖得快。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-3°C。窗台擦三遍还是黑的。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-3°C。有人越烧越冷，说风被挡住了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-2°C。煤堆在楼道里，味更重。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "-2°C。预报说冷空气快走了。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "-2°C。有人家的烟囱堵了，满屋烟。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "-1°C。白天能看见一点太阳。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "-1°C。烧的人少了一些。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "-1°C。空气清爽了一点。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "-1°C。今天开窗不呛了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场里没有躲开的选项：越冷就烧得越多，逆温层又把全城的烟扣在城区上方散不掉，于是外面和屋里一样呛，你越想取暖，呼吸越差。少烧一点、多穿一件才是唯一的路。",
    decisions: ["少烧点煤多穿衣服，保暖与呼吸只能选一头", "开窗放烟还是关窗保温，屋里的味和温度对着干", "逆温几天不散，煤堆在楼道里方便也危险，囤多少要重新算"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15，共 13 个，属 L3。主打维度 15（healthRiskPerDay 2：逆温层把全城排放锁住，健康风险抬到本族高位）与 13（categoryEfficiency.warmth 0.85：取暖本身在制造污染）。与雾霾不撞：雾霾是静稳无风、看不见太阳，且没冷到要烧煤；本场有冷有风，核心是逆温锁住全城煤烟。与沙暴不撞：沙暴是外部沙尘、封窗可缓解，本场封窗只会加重。"
  },
{
    id: "low_pressure",
    name: "低气压",
    family: "空气",
    level: "L3",
    tier: 3,
    axis: "恢复变慢：空气不脏也不稀，卡住的是体力回血，睡一觉也缓不过来",
    temperatures: {
      [0]: 3,
      [3]: 3,
      [7]: 4,
      [11]: 5,
      [14]: 5,
      [-7]: 6,
      [-4]: 5,
      [-1]: 4
    },
    spoilRate: 0.7,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["food", "fuel", "medicine"],
    windowScene: "thin-air",
    shelterDecayPerDay: -1,
    restEfficiency: 0.45,
    carryFactor: 0.5,
    actionPointDelta: -1,
    shopSupplyFactor: 0.8,
    priceSurcharge: 0.15,
    eventPoolWeights: {
      cold: 2,
      supply: 2
    },
    npcVisitFactor: 0.7,
    healthRiskPerDay: 0.8,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "6°C。高原上的气压表低了，人有点闷。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "5°C。有人爬两层楼就喘。"
      },
      {
        day: -5,
        severity: 0.22,
        hint: "4°C。预报说低气压还要压几天。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "4°C。睡了一夜，起来还是累。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "3°C。干活的人说使不上劲。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "3°C。有人开始头晕，坐着缓。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "3°C。气压又降了一点。"
      },
      {
        day: 0,
        severity: 0.85,
        hint: "3°C。走一段路要歇两回。"
      },
      {
        day: 1,
        severity: 0.95,
        hint: "3°C。夜里睡得沉，醒了还是乏。"
      },
      {
        day: 2,
        severity: 1,
        hint: "4°C。搬一趟东西，半天缓不过来。"
      },
      {
        day: 3,
        severity: 1,
        hint: "4°C。有人说饭都吃不下。"
      },
      {
        day: 4,
        severity: 1,
        hint: "4°C。药店的氧气罐被人问了几回。"
      },
      {
        day: 5,
        severity: 1,
        hint: "4°C。干活的人一天只做半天的量。"
      },
      {
        day: 6,
        severity: 1,
        hint: "5°C。有人整天躺着，还是没力气。"
      },
      {
        day: 7,
        severity: 1,
        hint: "5°C。东西囤了，没人搬得动。"
      },
      {
        day: 8,
        severity: 1,
        hint: "5°C。有人把重活分成三天做。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "5°C。气压慢慢往回爬。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "5°C。有人能一口气上到三楼了。"
      },
      {
        day: 11,
        severity: 0.85,
        hint: "5°C。预报说气压要回来了。"
      },
      {
        day: 12,
        severity: 0.8,
        hint: "5°C。干活不再那么喘。"
      },
      {
        day: 13,
        severity: 0.75,
        hint: "5°C。睡一觉能缓过来大半。"
      },
      {
        day: 14,
        severity: 0.7,
        hint: "5°C。今天爬楼没歇。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "空气一点不脏，读数也正常，可这一场里最贵的是恢复：同样的睡眠只能回一半体力，于是你越省着用力越要放弃出门，囤再多也搬不回来。真正被卡住的不是呼吸，是回血速度。",
    decisions: ["体力回不满，是少出门攒着，还是冒险跑一趟换补给", "搬运量腰斩，一次能带的不多，先带什么", "重活分成几天做，行动点怎么切才不空转"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9/10/11/12/15/16，共 14 个，属 L3。主打维度 6（restEfficiency 0.45：全批最低，恢复速度本身就是压力）与 7（carryFactor 0.5：缺力导致搬运腰斩）。与沙暴不撞：沙暴空气脏、健康持续掉，本场健康风险只有 0.8，压力在体力与恢复。与烟霾不撞：本场没有烟也没有能见度问题。"
  },
  // ═══ 生成内容 灾难-空气 止 ═══,
  // ═══ 生成内容 灾难-组合 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "blackout_winter",
    name: "大停电",
    family: "组合",
    level: "L3",
    tier: 2,
    axis: "冷与黑：寒潮的温度叠加断电，存货变成了限期任务",
    temperatures: {
      [0]: -18,
      [3]: -21,
      [7]: -24,
      [11]: -27,
      [14]: -29,
      [-7]: 4,
      [-4]: 0,
      [-1]: -8
    },
    spoilRate: 1.6,
    fridgeDead: true,
    dailyDrain: {
      fuel: 3,
      food: 1
    },
    priorityCategories: ["fuel", "food"],
    windowScene: "dark-city",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.55,
    carryFactor: 0.8,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["supermarket"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      cold: 3,
      dark: 2,
      neighbor: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      medicine: 0.8
    },
    healthRiskPerDay: 1.5,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "4°C。气象台挂了寒潮蓝色预警。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "2°C。电网公司发了负荷预警。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "0°C。窗上结了今年第一回霜。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-2°C。隔壁楼昨晚停了一小时电。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-5°C。五金店的蜡烛和电池卖空了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-6°C。物业通知各楼栋轮流限电。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "-8°C。风很大，电线在响。"
      },
      {
        day: 0,
        severity: 1,
        hint: "-18°C。凌晨两点，全城的灯一起灭了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-19°C。没有电。电梯停在了半层。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-20°C。冰箱里的东西开始化，得先吃掉。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-21°C。手机信号时有时无。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-22°C。屋里 3°C，呼吸有白气。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-22°C。邻居来敲门，问有没有蜡烛。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-23°C。水管冻住了，要烧雪水。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-24°C。来电了四十分钟，又灭了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-25°C。楼道里有人生了炭盆。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-26°C。冰箱空了，要坏的都吃完了。"
      },
      {
        day: 10,
        severity: 1,
        hint: "-27°C。夜里能听见远处的发电机。"
      },
      {
        day: 11,
        severity: 1,
        hint: "-27°C。手露在外面十分钟就发麻。"
      },
      {
        day: 12,
        severity: 1,
        hint: "-28°C。有电的楼收留了几个老人。"
      },
      {
        day: 13,
        severity: 1,
        hint: "-29°C。天很晴，电还没有来。"
      },
      {
        day: 14,
        severity: 1,
        hint: "-29°C。凌晨来电了。灯亮时没人说话。"
      }
    ],
    counterIntuitive: "冰箱里的存货变成了限期任务，两天内吃不完就全坏；没电的夜反而让邻居走得更勤",
    decisions: ["前 48 小时先清空冰箱吃掉要坏的，还是保燃料熬更冷的夜", "行动点只剩两个，出门摸黑找燃料，还是在家把东西理好", "邻居来得勤，人情能换回款，但每次开门都要分东西出去"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15，共 14 个。spoilRate 1.6 的理由：室外虽冷但冰箱停机，室内冷藏链断裂。首次使用维度 8（行动点 -1）；食物反升为刚需（必须吃掉要坏的），刚需排序与寒潮相反，故不与寒潮撞车。"
  },
{
    id: "heat_blackout",
    name: "酷暑断电",
    family: "组合",
    level: "L3",
    tier: 2,
    axis: "热与暗：停电让电扇空调同时停摆，屋里比屋外更闷，冰箱成了唯一在贬值的存货",
    temperatures: {
      [0]: 39,
      [3]: 40,
      [7]: 41,
      [11]: 41,
      [14]: 40,
      [-7]: 36,
      [-4]: 37,
      [-1]: 38
    },
    spoilRate: 2.6,
    fridgeDead: true,
    dailyDrain: {
      water: 3,
      medicine: 1
    },
    priorityCategories: ["water", "fuel", "medicine"],
    windowScene: "heat-blackout",
    shelterDecayPerDay: -1.8,
    restEfficiency: 0.5,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["supermarket"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      heat: 3,
      dark: 3,
      water: 2
    },
    npcVisitFactor: 1.25,
    categoryEfficiency: {
      food: 0.65
    },
    healthRiskPerDay: 1.2,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "36°C。气象台发了高温橙色预警。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "37°C。超市的矿泉水整箱往外搬。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "37°C。电网贴了错峰用电的通知。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "38°C。隔壁楼昨晚跳了几次闸。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "38°C。风扇卖到了断货。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "39°C。药店的藿香正气水没了。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "39°C。物业说这几天可能要限电。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "40°C。午后整片小区停了电。"
      },
      {
        day: 1,
        severity: 1,
        hint: "41°C。电扇不转，屋里比外面闷。"
      },
      {
        day: 2,
        severity: 1,
        hint: "41°C。冰箱停了，肉开始化。"
      },
      {
        day: 3,
        severity: 1,
        hint: "41°C。有人整夜坐在楼道里。"
      },
      {
        day: 4,
        severity: 1,
        hint: "41°C。龙头里出来的是温水。"
      },
      {
        day: 5,
        severity: 1,
        hint: "40°C。邻居来问有没有冰。"
      },
      {
        day: 6,
        severity: 1,
        hint: "41°C。冰箱里的东西当天吃完。"
      },
      {
        day: 7,
        severity: 1,
        hint: "42°C。白天没人出门。"
      },
      {
        day: 8,
        severity: 1,
        hint: "42°C。电还是没来。"
      },
      {
        day: 9,
        severity: 1,
        hint: "41°C。楼下分了两桶水。"
      },
      {
        day: 10,
        severity: 1,
        hint: "41°C。有人把床搬进了地下室。"
      },
      {
        day: 11,
        severity: 1,
        hint: "41°C。菜场下午就收了摊。"
      },
      {
        day: 12,
        severity: 0.95,
        hint: "40°C。天很晴，电迟迟没来。"
      },
      {
        day: 13,
        severity: 0.9,
        hint: "40°C。温度计晒得烫手。"
      },
      {
        day: 14,
        severity: 0.85,
        hint: "40°C。半夜来电了，没人开灯。"
      }
    ],
    counterIntuitive: "有电时热只是难受，断电之后热才开始伤人：电扇停转，屋里比屋外更闷，而冰箱里那点凉意是全屋唯一在快速贬值的存货，越早吃掉越值。这一场真正该抢的不是水，是冰箱。",
    decisions: ["冰箱停机的头一天，是把要坏的先吃掉，还是留着解暑", "行动点少一个，出门找水和在家守着存货只能挑一头", "邻居来问有没有冰，人情能换东西，但每次开门都要分出去"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15，共 14 个。热轴贡献 1/2/13（水消耗、腐坏加快、food 降效），电轴贡献 8/9/11（行动点 -1、关超市、dark 事件）。与热浪不撞：热浪腐坏 2.4、carry 0.7 且不关店；本场 2.6、carry 0.65 且关超市。与大停电不撞：那场是 cold+dark 主线、刚需是燃料食物，本场是 heat+water 主线、刚需是水与药品。"
  },
{
    id: "flood_epidemic",
    name: "洪水疫情",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "水与病：能取到的水都不能直接喝，收治病人的诊所却最先关门",
    temperatures: {
      [0]: 22,
      [3]: 21,
      [7]: 20,
      [11]: 20,
      [14]: 21,
      [-7]: 25,
      [-4]: 24,
      [-1]: 23
    },
    spoilRate: 2.2,
    dailyDrain: {
      water: 2,
      medicine: 2
    },
    priorityCategories: ["medicine", "water", "food"],
    windowScene: "flood-outbreak",
    shelterDecayPerDay: -3,
    restEfficiency: 0.65,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["clinic", "market"],
    priceSurcharge: 0.55,
    eventPoolWeights: {
      water: 3,
      panic: 3,
      neighbor: 2
    },
    npcVisitFactor: 0.65,
    categoryEfficiency: {
      medicine: 0.55
    },
    capacityFactor: 0.8,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 2,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "25°C。雨停了，水还没退。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "24°C。一楼的住户在清淤泥。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "23°C。社区发了消毒片，一户两片。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "23°C。有人开始拉肚子，去了诊所。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "22°C。诊所门口贴了分诊的牌子。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "22°C。物业通知喝水必须烧开。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "21°C。食堂停了，说有人吃坏肚子。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "22°C。通报：水里检出致病菌。"
      },
      {
        day: 1,
        severity: 1,
        hint: "21°C。诊所改成只收发热的。"
      },
      {
        day: 2,
        severity: 1,
        hint: "21°C。药店的止泻药卖空了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "20°C。有人把家具搬到楼下晒。"
      },
      {
        day: 4,
        severity: 1,
        hint: "20°C。楼道里一股消毒水味。"
      },
      {
        day: 5,
        severity: 1,
        hint: "20°C。邻居来换水，隔着门递。"
      },
      {
        day: 6,
        severity: 1,
        hint: "20°C。接水点排起了长队。"
      },
      {
        day: 7,
        severity: 1,
        hint: "20°C。诊所关了一半的门。"
      },
      {
        day: 8,
        severity: 1,
        hint: "20°C。又下了一天雨，地又湿了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "20°C。有人开始发低烧。"
      },
      {
        day: 10,
        severity: 1,
        hint: "21°C。消毒片不够，按楼栋发。"
      },
      {
        day: 11,
        severity: 1,
        hint: "21°C。送水车一天来两趟。"
      },
      {
        day: 12,
        severity: 1,
        hint: "21°C。发热的人被隔在活动室。"
      },
      {
        day: 13,
        severity: 1,
        hint: "21°C。水里的菌数在往下走。"
      },
      {
        day: 14,
        severity: 1,
        hint: "21°C。水能喝了，药还紧着。"
      }
    ],
    counterIntuitive: "水退下去的那几天比进水时更危险：传染刚起步，而收治病人的诊所恰恰是最先关门的那个。于是这一场最缺的不是药本身，是把药送进去、把水烧开的干净水。",
    decisions: ["诊所关了门，药要么去更远的地方找，要么靠邻居换", "低处的格子进了脏水等于没有，东西往高处码时顺手位也得重排", "干净水又重又占地方，消毒用的水和喝的水只能先顾一头"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。水轴贡献 5/14（建筑衰减、低处空间作废），疫轴贡献 9/13/15/16（关诊所与市场、med 降效、健康债、急救权重）。与洪水不撞：洪水刚需是水+药且不关诊所；本场关的是诊所、npc 掉到 0.65（隔离不串门）、加 healthRisk 2 与 emergency:3。与疫情不撞：疫情是 pure med 缺货，本场把洪水的水源污染叠上来。"
  },
{
    id: "quake_fire",
    name: "地震火灾",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "裂与烧：地震先把路和管拆了，火才起来，能取到的水第一优先是浇火",
    temperatures: {
      [0]: 21,
      [3]: 20,
      [7]: 19,
      [11]: 19,
      [14]: 20,
      [-7]: 24,
      [-4]: 23,
      [-1]: 22
    },
    spoilRate: 2,
    dailyDrain: {
      medicine: 2,
      water: 1
    },
    priorityCategories: ["medicine", "tool", "food"],
    windowScene: "quake-fire",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.55,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.4,
    closedShopIds: ["hardware", "supermarket"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      panic: 3,
      people: 2,
      supply: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      tool: 1.3,
      food: 0.7
    },
    capacityFactor: 0.7,
    unusableShelfIds: ["shelf_c"],
    healthRiskPerDay: 1.5,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "24°C。凌晨晃了一下，碗柜响了。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "23°C。墙上有道细缝，物业来看了。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "23°C。有人把煤气罐搬到了楼下。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "22°C。燃气公司来查了管线。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "22°C。老楼的通知写着结构待定。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "21°C。夜里又晃了两回。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "21°C。消防车在小区里转了一圈。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "21°C。余震把燃气管扯断了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "20°C。三号楼起了火，烟很黑。"
      },
      {
        day: 2,
        severity: 1,
        hint: "20°C。路被塌下的墙堵了半条。"
      },
      {
        day: 3,
        severity: 1,
        hint: "19°C。消防车进不来，接了水管。"
      },
      {
        day: 4,
        severity: 1,
        hint: "19°C。能喝的水先去浇火。"
      },
      {
        day: 5,
        severity: 1,
        hint: "19°C。有人被烟呛得直咳。"
      },
      {
        day: 6,
        severity: 1,
        hint: "19°C。楼道里全是灰。"
      },
      {
        day: 7,
        severity: 1,
        hint: "19°C。水压不够，火压下去又起来。"
      },
      {
        day: 8,
        severity: 1,
        hint: "19°C。邻居搬到了空地上。"
      },
      {
        day: 9,
        severity: 1,
        hint: "19°C。超市的货架倒了一排。"
      },
      {
        day: 10,
        severity: 1,
        hint: "19°C。有人拿着撬棍在挖东西。"
      },
      {
        day: 11,
        severity: 1,
        hint: "19°C。火灭了两处，还剩一处。"
      },
      {
        day: 12,
        severity: 1,
        hint: "19°C。抢修队在断墙边拉线。"
      },
      {
        day: 13,
        severity: 1,
        hint: "20°C。灰落了，屋里还是呛。"
      },
      {
        day: 14,
        severity: 1,
        hint: "20°C。明火全灭了，水管还在漏。"
      }
    ],
    counterIntuitive: "把人困住的不是火，是地震先一步拆掉的那条路：路在的时候，火只是隔壁的事；路断了，水和药都到不了。这一场最缺的其实是能打通通道的工具，而不是灭火的水。",
    decisions: ["工具在这一场比水贵，撬棍是拿去挖人还是先清出通道", "低处和一面墙的货架都塌了，东西往哪儿码才不会被二次余震埋", "火没灭之前，水和药先供救火还是先留给被砸伤的人"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。震轴贡献 5/7/14（衰减、搬运、空间坍缩），火轴贡献 1/13/16（药与水消耗、tool 升值、placement 换口径）。与地震不撞：地震是纯空间损失、不关五金店；本场关五金店（工具最缺却关门）、tool 反而 1.3 升值、加火导致的水药消耗与 healthRisk 1.5。与洪水不撞：水是浇火用的，不是污染轴。"
  },
{
    id: "sandstorm_nodraw",
    name: "沙暴断水",
    family: "组合",
    level: "L3",
    tier: 2,
    axis: "尘与渴：断水逼你出门，沙暴又把你堵在屋里，屋顶接的雨水越攒越浑",
    temperatures: {
      [0]: 25,
      [3]: 24,
      [7]: 24,
      [11]: 25,
      [14]: 26,
      [-7]: 28,
      [-4]: 27,
      [-1]: 26
    },
    spoilRate: 1.9,
    dailyDrain: {
      water: 3,
      medicine: 1
    },
    priorityCategories: ["water", "tool", "food"],
    windowScene: "dust-drought",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.6,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      water: 3,
      limit: 3,
      supply: 2
    },
    npcVisitFactor: 0.6,
    categoryEfficiency: {
      water: 0.7,
      tool: 1.2
    },
    healthRiskPerDay: 2.2,
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "28°C。水库的水位又在往下走。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "27°C。供水时段缩到了每天两小时。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "26°C。天边起了一道黄线。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "26°C。风里开始有土味。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "25°C。能见度不到两条街。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "25°C。送水车说来不了。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "24°C。水龙头一天只来两小时。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "25°C。沙暴到了，屋里也进土。"
      },
      {
        day: 1,
        severity: 1,
        hint: "24°C。出门一趟回来满嘴沙。"
      },
      {
        day: 2,
        severity: 1,
        hint: "24°C。窗缝堵了，土还是进来。"
      },
      {
        day: 3,
        severity: 1,
        hint: "24°C。桶里的水见了底。"
      },
      {
        day: 4,
        severity: 1,
        hint: "23°C。有人把屋顶的雨水收着。"
      },
      {
        day: 5,
        severity: 1,
        hint: "24°C。雨水里有沙，越放越浑。"
      },
      {
        day: 6,
        severity: 1,
        hint: "24°C。口罩和水分着两天用。"
      },
      {
        day: 7,
        severity: 1,
        hint: "24°C。白天出不去，晚上也难出门。"
      },
      {
        day: 8,
        severity: 1,
        hint: "25°C。排队接水的人戴着口罩。"
      },
      {
        day: 9,
        severity: 1,
        hint: "25°C。风小了一阵，又起了。"
      },
      {
        day: 10,
        severity: 1,
        hint: "25°C。屋里地上扫出一堆土。"
      },
      {
        day: 11,
        severity: 1,
        hint: "25°C。水车来了，一人一桶。"
      },
      {
        day: 12,
        severity: 1,
        hint: "25°C。有人开始咳，说是进了土。"
      },
      {
        day: 13,
        severity: 1,
        hint: "26°C。风弱了，天还是黄的。"
      },
      {
        day: 14,
        severity: 1,
        hint: "26°C。沙落了，水的账还没完。"
      }
    ],
    counterIntuitive: "这一场最难受的地方是屋顶那点雨水：断水逼你攒水，沙暴又让每一次下雨都夹着土，于是你越勤快地接，手里的水越不能喝。真正的取水口在风里，不在雨里。",
    decisions: ["出门接水要顶沙，行动点少一个，一趟够不够撑过一天", "口罩和滤水的工具抢同一份钱，先买哪样决定你能出门还是能喝水", "屋顶接的雨水一天比一天浑，是留着沉淀还是直接倒掉"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。尘轴贡献 7/15/13（搬运、健康债、water 降效），水轴贡献 1/9/11（水消耗、关市场、limit 事件）。与沙暴不撞：沙暴是空气主轴、水质不是问题；本场把断水叠上，npc 掉到 0.6、加 limit 事件与 tool 1.2。与断水不撞：断水是排队取水，本场是取水口本身在沙里，carry 压到 0.55。"
  },
{
    id: "riot_roadblock",
    name: "骚乱封路",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "人与路：人来得更勤，路又走不通，离你最近的店反而最先空",
    temperatures: {
      [0]: 19,
      [3]: 18,
      [7]: 18,
      [11]: 19,
      [14]: 20,
      [-7]: 22,
      [-4]: 21,
      [-1]: 20
    },
    spoilRate: 1.7,
    dailyDrain: {
      food: 1,
      fuel: 1
    },
    priorityCategories: ["food", "fuel", "tool"],
    windowScene: "blocked-street-riot",
    shelterDecayPerDay: -2,
    restEfficiency: 0.6,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.4,
    closedShopIds: ["market", "wholesale"],
    priceSurcharge: 0.6,
    eventPoolWeights: {
      people: 3,
      panic: 3,
      supply: 2
    },
    npcVisitFactor: 1.5,
    categoryEfficiency: {
      food: 0.75
    },
    healthRiskPerDay: 1.2,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "22°C。主路上围了栏杆，车绕行。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "21°C。菜场的进货少了一半。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "20°C。有人说前面几个路口封了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "20°C。超市的货架空了一层。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "19°C。夜里有人在街上喊。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "19°C。邻居把门反锁了。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "18°C。公告说主干道暂时不通。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "19°C。街口堵了，人越聚越多。"
      },
      {
        day: 1,
        severity: 1,
        hint: "18°C。最近的店先空了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "18°C。补货车被拦在了城外。"
      },
      {
        day: 3,
        severity: 1,
        hint: "18°C。有人隔着栏杆吵架。"
      },
      {
        day: 4,
        severity: 1,
        hint: "18°C。楼下的门市提前关了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "18°C。走远两条街才买到米。"
      },
      {
        day: 6,
        severity: 1,
        hint: "18°C。夜里又有玻璃碎的声音。"
      },
      {
        day: 7,
        severity: 1,
        hint: "18°C。有人结伴才敢出门。"
      },
      {
        day: 8,
        severity: 1,
        hint: "19°C。栏杆加高了一层。"
      },
      {
        day: 9,
        severity: 1,
        hint: "19°C。批发市场的门开着，货没到。"
      },
      {
        day: 10,
        severity: 1,
        hint: "19°C。有人在楼栋里登记谁家有多的。"
      },
      {
        day: 11,
        severity: 1,
        hint: "19°C。主路清了一半，路口还站着人。"
      },
      {
        day: 12,
        severity: 1,
        hint: "19°C。补货车进了城，排了很久。"
      },
      {
        day: 13,
        severity: 1,
        hint: "20°C。路通了，货还是少。"
      },
      {
        day: 14,
        severity: 1,
        hint: "20°C。街口空了，货架慢慢填上。"
      }
    ],
    counterIntuitive: "封路挡住了补货车，也挡住了更远街区的人：这一场离你最近的店最先空，因为最先到的人只够搬空最近的货架。走远反而可能买到东西，前提是你敢走。",
    decisions: ["最近的店已经空了，是走远两条街，还是在家等补货车", "行动点少一个，出门一趟既要绕路又要提防人群，值不值", "邻居来敲门换东西，接了是人情也多了暴露，隔不隔"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。人轴贡献 11/12/15（people 与 panic 事件、npc 1.5、健康债），路轴贡献 9/10（关批发与市场、涨价）。与骚乱不撞：骚乱关的是市场、npc 1.4、没说路断；本场加批发也关、npc 顶到 1.5、加 fuel 消耗（绕路烧油）与 emergency 权重。与本族酷暑断电不撞：那场是 heat+dark，本场无热无暗。"
  },
{
    id: "typhoon_nowater",
    name: "台风停水",
    family: "组合",
    level: "L3",
    tier: 2,
    axis: "风与水：风把屋顶掀了，也把水泵房灌了，风停的第二天才是没水喝的一天",
    temperatures: {
      [0]: 24,
      [3]: 23,
      [7]: 23,
      [11]: 24,
      [14]: 25,
      [-7]: 27,
      [-4]: 26,
      [-1]: 25
    },
    spoilRate: 1.8,
    dailyDrain: {
      water: 3,
      fuel: 1
    },
    priorityCategories: ["water", "tool", "medicine"],
    windowScene: "typhoon-dry-tap",
    shelterDecayPerDay: -3,
    restEfficiency: 0.55,
    carryFactor: 0.6,
    actionPointDelta: 0,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market", "gas_station"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      water: 3,
      supply: 3,
      queue: 2
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      water: 0.7
    },
    capacityFactor: 0.85,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 1.5,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "27°C。台风预警挂到了黄色。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "26°C。超市的水和电池被人整箱买走。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "26°C。风把楼下的广告牌吹倒了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "25°C。雨点打在窗上，风越来越大。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "25°C。物业通知把阳台的东西收进屋。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "24°C。半夜风最大，窗户一直在响。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "24°C。水厂说泵站进了水。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "24°C。台风登陆，街上没人。"
      },
      {
        day: 1,
        severity: 1,
        hint: "23°C。风停了，水压没了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "23°C。龙头里一滴水也没有。"
      },
      {
        day: 3,
        severity: 1,
        hint: "23°C。送水车停在路口，队伍很长。"
      },
      {
        day: 4,
        severity: 1,
        hint: "23°C。有人提桶去隔壁小区接水。"
      },
      {
        day: 5,
        severity: 1,
        hint: "23°C。超市开门，水架是空的。"
      },
      {
        day: 6,
        severity: 1,
        hint: "24°C。抢修队挖开路面的管子。"
      },
      {
        day: 7,
        severity: 1,
        hint: "24°C。水管里出来的是黄的。"
      },
      {
        day: 8,
        severity: 1,
        hint: "24°C。有人把浴缸先放满了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "24°C。送水车一天来两趟。"
      },
      {
        day: 10,
        severity: 1,
        hint: "24°C。邻居来问有没有多的桶。"
      },
      {
        day: 11,
        severity: 1,
        hint: "25°C。水压回来了一半。"
      },
      {
        day: 12,
        severity: 1,
        hint: "25°C。高层还停水，往下打水。"
      },
      {
        day: 13,
        severity: 1,
        hint: "25°C。通知说还要烧开再喝。"
      },
      {
        day: 14,
        severity: 1,
        hint: "25°C。水清了，泵站还在修。"
      }
    ],
    counterIntuitive: "这一场最缺水的日子不是刮风那两天，是风停的第二天：台风时你躲在家里不消耗，等风一停，水泵房的电还没恢复，水箱也见了底，才轮到所有人一起排队。风最大时最安全，风停了才要出门。",
    decisions: ["风还没停的时候把浴缸和桶放满，还是等通知说停水再抢", "行动点不减但队伍很长，排队接水占掉半天值不值", "桶和容器在这一场比水先缺，先囤容器还是先囤水"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 15 个。风轴贡献 5/14（建筑与低处受损），水轴贡献 1/9/11/13（水消耗、关市场与加油站、supply 与 queue、water 降效）。行动点刻意留 0（与台风不同、与断水不同）。与台风不撞：台风关的是周末集市与市场、主打 panic；本场关市场与加油站、主打 supply+queue 且 healthRisk 1.5。与断水不撞：断水是逐步降压，本场是一次性停摆且叠加风损。"
  },
{
    id: "cold_epidemic",
    name: "寒潮疫情",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "暖与隔：取暖要把窗封死，防传染要把窗打开，两个动作在同一间屋里互相拆台",
    temperatures: {
      [0]: -8,
      [3]: -10,
      [7]: -11,
      [11]: -10,
      [14]: -8,
      [-7]: 2,
      [-4]: 0,
      [-1]: -4
    },
    spoilRate: 0.8,
    dailyDrain: {
      fuel: 3,
      medicine: 2
    },
    priorityCategories: ["warmth", "medicine", "food"],
    windowScene: "cold-quarantine",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["pharmacy", "community_store"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      cold: 3,
      panic: 2,
      limit: 2
    },
    npcVisitFactor: 0.7,
    categoryEfficiency: {
      medicine: 0.55
    },
    healthRiskPerDay: 1.8,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "2°C。寒潮预警挂了，还带一条流感通报。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "0°C。社区开始发口罩，一人两个。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-2°C。有人说诊所里发热的人多了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-4°C。楼道里开始有人咳嗽。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-5°C。药店门口的队排到了街边。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-6°C。物业通知屋里要多通风。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-7°C。窗上结了霜，还是得留一条缝。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-8°C。寒潮到了，发热的人也在涨。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-10°C。屋里烧着炉子，窗不敢开。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-10°C。诊所改成只收发热的。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-11°C。有人咳了一夜。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-11°C。邻居隔着门放下一包药。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-11°C。药店的退烧药断了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-10°C。屋里暖，人多，咳声密。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-10°C。有人把老人单独挪到了一间。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-10°C。通风和取暖只能选一个。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-9°C。楼道里喷了消毒水。"
      },
      {
        day: 10,
        severity: 1,
        hint: "-9°C。送药的志愿者来了两趟。"
      },
      {
        day: 11,
        severity: 1,
        hint: "-8°C。发热的人开始退烧。"
      },
      {
        day: 12,
        severity: 1,
        hint: "-8°C。诊所重新开门。"
      },
      {
        day: 13,
        severity: 1,
        hint: "-8°C。窗户能开大一点了。"
      },
      {
        day: 14,
        severity: 1,
        hint: "-7°C。天冷，屋里安静了。"
      }
    ],
    counterIntuitive: "要取暖就得把窗缝堵死，要防传染就得把窗打开，这两个动作在同一间屋里互相拆台：你越舍得烧燃料，屋里的人越聚得紧，传染也越顺。这一场省燃料和省药是同一笔账，省哪头都亏。",
    decisions: ["封窗保暖和开窗通风只能选一样，家中有人发热时怎么排", "药店断了退烧药，是冒着冷去更远的地方找，还是靠邻居换", "行动点少一个，白天补觉还是出门找药，体力本身也是药"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。寒轴贡献 1/2（燃料消耗、腐坏变慢），疫轴贡献 9/13/15/16（关药店与便利店、med 降效、健康债、急救权重）。与寒潮不撞：寒潮刚需是燃料+保暖、腐坏 0.5、不关店；本场腐坏 0.8、加药刚需、关药店（最需要药却买不到）。与疫情不撞：疫情是常温、不烧燃料；本场把寒潮的燃料账压上来，npc 掉到 0.7（隔离）。"
  },
{
    id: "flood_riot",
    name: "洪水骚乱",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "水与乱：水还没退，抢东西的人先来了，等水退时货架上剩下的不是泡坏的，是被搬走的",
    temperatures: {
      [0]: 21,
      [3]: 20,
      [7]: 20,
      [11]: 21,
      [14]: 22,
      [-7]: 24,
      [-4]: 23,
      [-1]: 22
    },
    spoilRate: 2.3,
    dailyDrain: {
      water: 2,
      medicine: 1
    },
    priorityCategories: ["food", "water", "tool"],
    windowScene: "flood-riot",
    shelterDecayPerDay: -3,
    restEfficiency: 0.55,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.4,
    closedShopIds: ["market", "community_store", "supermarket"],
    priceSurcharge: 0.65,
    eventPoolWeights: {
      water: 3,
      people: 3,
      panic: 2
    },
    npcVisitFactor: 1.45,
    categoryEfficiency: {
      warmth: 0.6
    },
    capacityFactor: 0.75,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1.8,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "24°C。水还在街上，退了半掌。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "23°C。一楼的店都关了门。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "22°C。有人趟水去搬东西。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "22°C。夜里有人在水边转。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "21°C。楼下的仓库被撬了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "21°C。邻居说昨天有人抢水。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "21°C。公告说低处不要单独去。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "21°C。水没退，抢东西的先来了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "20°C。货架倒了，东西散了一地。"
      },
      {
        day: 2,
        severity: 1,
        hint: "20°C。店门开着，人比货多。"
      },
      {
        day: 3,
        severity: 1,
        hint: "20°C。有人结伴守着楼道口。"
      },
      {
        day: 4,
        severity: 1,
        hint: "20°C。送水车迟了，围着的人更多。"
      },
      {
        day: 5,
        severity: 1,
        hint: "20°C。水退了半米，泥留在了路上。"
      },
      {
        day: 6,
        severity: 1,
        hint: "20°C。有人趁夜搬空了对门的库房。"
      },
      {
        day: 7,
        severity: 1,
        hint: "20°C。楼栋里排了班守夜。"
      },
      {
        day: 8,
        severity: 1,
        hint: "20°C。能走的路多了，人也散了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "20°C。第一批货卸在了路口。"
      },
      {
        day: 10,
        severity: 1,
        hint: "21°C。有人拿工具去换水。"
      },
      {
        day: 11,
        severity: 1,
        hint: "21°C。水位在降，店在慢慢开。"
      },
      {
        day: 12,
        severity: 1,
        hint: "21°C。货架填了一半。"
      },
      {
        day: 13,
        severity: 1,
        hint: "21°C。守夜的班撤了。"
      },
      {
        day: 14,
        severity: 1,
        hint: "22°C。水全退了，门口还留着木板。"
      }
    ],
    counterIntuitive: "水退之后你才发现，被泡坏的货没那么多，被人搬走的更多：抢的人比水走得快，也走得早。这一场真正该防的不是水，是水还没有退完的那几个小时。",
    decisions: ["低处还泡着水，是现在就去搬货，还是等人多了一起去更安全", "货架被抢空，剩下的是工具和零件，要不要拿工具去换水换粮", "夜里要不要排班守楼口，守夜的人第二天出不了门"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。水轴贡献 5/13/14（建筑衰减、warmth 失效、空间作废），乱轴贡献 9/11/12（连关三家店、people 事件、npc 1.45）。与洪水不撞：洪水 npr 1.2、只关五金店；本场连关超市市场与便利店、npc 1.45、涨价 0.65。与骚乱不撞：骚乱是干地、关市场、npc 1.4；本场把水的空间损失叠上来。"
  },
{
    id: "heat_blackout_fire",
    name: "火烤断电",
    family: "组合",
    level: "L4",
    tier: 4,
    axis: "热与暗与火：火和热在抢同一桶水，而断电让水泵停摆，你要决定先给谁",
    temperatures: {
      [0]: 42,
      [3]: 43,
      [7]: 44,
      [11]: 43,
      [14]: 42,
      [-7]: 38,
      [-4]: 39,
      [-1]: 40
    },
    spoilRate: 3,
    fridgeDead: true,
    dailyDrain: {
      water: 3,
      medicine: 2
    },
    priorityCategories: ["water", "medicine", "fuel"],
    windowScene: "fire-heat-blackout",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.45,
    carryFactor: 0.5,
    actionPointDelta: -1,
    shopSupplyFactor: 0.4,
    closedShopIds: ["supermarket", "hardware", "gas_station"],
    priceSurcharge: 0.7,
    eventPoolWeights: {
      heat: 3,
      dark: 2,
      panic: 3,
      water: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      food: 0.6,
      medicine: 0.7
    },
    capacityFactor: 0.6,
    unusableShelfIds: ["shelf_c"],
    healthRiskPerDay: 2.5,
    scoreWeights: {
      fefo: 3,
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "38°C。高温红色预警，电网也在提醒。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "39°C。林区挂了火险最高的牌子。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "39°C。有人往楼顶搬了水箱。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "40°C。消防通道被杂物占了。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "40°C。小区外的山坡干得发白。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "41°C。电网说要拉闸限电。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "42°C。风大，天边有烟。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "44°C。火从坡上过来了，电也断了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "43°C。消防泵没电，接不上水。"
      },
      {
        day: 2,
        severity: 1,
        hint: "43°C。水先浇火，喝的排在后面。"
      },
      {
        day: 3,
        severity: 1,
        hint: "42°C。屋里比外面更闷，电扇不转。"
      },
      {
        day: 4,
        severity: 1,
        hint: "42°C。冰箱停了，肉在化。"
      },
      {
        day: 5,
        severity: 1,
        hint: "42°C。有人整夜守在楼下的水桶边。"
      },
      {
        day: 6,
        severity: 1,
        hint: "42°C。烟压下来，楼道里看不清。"
      },
      {
        day: 7,
        severity: 1,
        hint: "42°C。火压下去一处，又起一处。"
      },
      {
        day: 8,
        severity: 1,
        hint: "42°C。水和药都不够两头用。"
      },
      {
        day: 9,
        severity: 1,
        hint: "42°C。有人把老人挪到了河堤上。"
      },
      {
        day: 10,
        severity: 1,
        hint: "42°C。送水车来了一趟，围了很多人。"
      },
      {
        day: 11,
        severity: 1,
        hint: "42°C。电没来，火还在冒烟。"
      },
      {
        day: 12,
        severity: 1,
        hint: "42°C。风转了向，火往回退。"
      },
      {
        day: 13,
        severity: 1,
        hint: "42°C。火线撤了，人还在咳。"
      },
      {
        day: 14,
        severity: 1,
        hint: "42°C。明火灭了，电还没有。"
      }
    ],
    counterIntuitive: "三条轴里最致命的一条不是火，是停电：没有电就没有水泵，火没水浇，热也没法降，火和热在同一桶水前排队。所以这一场你要决定的不是买什么，是先给火还是先给人。",
    decisions: ["同一桶水要先浇火还是先喝，给错一次就有一头失控", "行动点只剩一个，出门找水还是在楼里清出防火带", "冰箱里的东西当天吃完，还是留一点给被烟呛到的人"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个，L4 用 1~16 凑满。热轴贡献 1/2/13，电轴贡献 8/9/11，火轴贡献 5/14/15/16。三轴各有分工：热压水与腐坏、电压行动点与商店、火压空间与健康。与酷暑断电不撞：那场 L3 只两条轴、fire 未上线；本场关三家店、capacity 0.6、healthRisk 2.5、fefo:3。与大停电不撞：那场是 cold+dark 无火。"
  },
{
    id: "quake_cold",
    name: "地震寒潮",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "裂与寒：房子漏风又降温，补墙和取暖抢同一份体力",
    temperatures: {
      [0]: -12,
      [3]: -15,
      [7]: -16,
      [11]: -15,
      [14]: -12,
      [-7]: 0,
      [-4]: -3,
      [-1]: -7
    },
    spoilRate: 0.7,
    dailyDrain: {
      fuel: 3,
      food: 1
    },
    priorityCategories: ["warmth", "fuel", "tool"],
    windowScene: "quake-cold",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.5,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["hardware", "wholesale"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      cold: 3,
      supply: 3,
      neighbor: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      tool: 1.25,
      warmth: 0.7
    },
    capacityFactor: 0.65,
    unusableShelfIds: ["shelf_c"],
    healthRiskPerDay: 1.5,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "0°C。寒潮预警和一条余震消息同时来。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "-1°C。老楼的墙上多了道新缝。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-3°C。有人先用胶带把门窗缝贴上。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-5°C。夜里又晃了一下，窗户在响。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-6°C。煤和胶带都涨了价。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-8°C。屋里的温度比外面高不了多少。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-10°C。物业说墙上的洞暂时没人修。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-12°C。余震把外墙扯开了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-14°C。屋里灌风，炉子烧不热。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-15°C。有人先补窗，有人先烧炭。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-16°C。补墙的料不够，先堵了主屋。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-16°C。水管冻裂，屋里进了冰。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-16°C。抢修的和取暖的抢同一份柴。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-16°C。有人把床挪到了没裂缝的一间。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-16°C。墙补了一半，风小了一点。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-15°C。邻居来借工具和炭。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-15°C。外面零下，屋里也在零下。"
      },
      {
        day: 10,
        severity: 1,
        hint: "-15°C。送炭的车来了一趟。"
      },
      {
        day: 11,
        severity: 1,
        hint: "-14°C。裂缝堵住了大半。"
      },
      {
        day: 12,
        severity: 1,
        hint: "-13°C。屋里能烧热一小块地方。"
      },
      {
        day: 13,
        severity: 1,
        hint: "-13°C。余震停了，墙还敞着一道。"
      },
      {
        day: 14,
        severity: 1,
        hint: "-12°C。天回暖了一点，人还没缓过来。"
      }
    ],
    counterIntuitive: "修房子和取暖抢的不是钱，是同一份体力：墙上的洞补上之前，烧多少燃料都是白烧，热气顺着裂缝就走。可补洞的那几个小时，恰好又冷得伸不出手，于是越冷越修不动，越修不动越冷。",
    decisions: ["柴先烧来取暖，还是先用来烧水拌补墙的料，两者都要火", "低处和一面墙的货架都塌了，剩下的空间先放柴还是先放工具", "邻居来借工具和炭，借出去自己的墙就晚一天补，借不借"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。震轴贡献 5/7/14（衰减、搬运、空间损失），寒轴贡献 1/2（燃料消耗、腐坏变慢）。与地震不撞：地震不烧燃料、warmth 无害；本场 warmth 0.7（漏风失效）、关五金店与批发、cold 事件为主。与寒潮不撞：寒潮不关店、不损失空间、腐坏 0.5；本场腐坏 0.7、capacity 0.65、tool 1.25。"
  },
{
    id: "mold_blackout",
    name: "霉雨断电",
    family: "组合",
    level: "L3",
    tier: 2,
    axis: "潮与暗：断电最要命的不是黑，是不能再烘干，越勤快洗东西坏得越快",
    temperatures: {
      [0]: 25,
      [3]: 24,
      [7]: 24,
      [11]: 25,
      [14]: 26,
      [-7]: 28,
      [-4]: 27,
      [-1]: 26
    },
    spoilRate: 2.8,
    fridgeDead: true,
    dailyDrain: {
      medicine: 1,
      fuel: 1
    },
    priorityCategories: ["food", "warmth", "tool"],
    windowScene: "mold-blackout",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["supermarket", "hardware"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      dark: 3,
      water: 2,
      market: 2
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      food: 0.6,
      warmth: 0.6
    },
    capacityFactor: 0.8,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1.5,
    scoreWeights: {
      fefo: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "28°C。雨下了三天，墙面发潮。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "27°C。晾在阳台的衣服两天没干。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "26°C。有人说昨晚跳了好几次闸。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "26°C。米缸的盖子内侧起了水珠。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "25°C。干货开始返潮，饼干软了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "25°C。除湿机开着，电表走得快。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "25°C。物业说可能要拉闸。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "25°C。停电了，除湿机停了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "24°C。屋里潮得能拧出水。"
      },
      {
        day: 2,
        severity: 1,
        hint: "24°C。面粉结了块，衣服有霉点。"
      },
      {
        day: 3,
        severity: 1,
        hint: "24°C。有人把粮食摊在地上晾。"
      },
      {
        day: 4,
        severity: 1,
        hint: "24°C。晾了一夜的鞋还是湿的。"
      },
      {
        day: 5,
        severity: 1,
        hint: "24°C。墙角长出了黑毛。"
      },
      {
        day: 6,
        severity: 1,
        hint: "24°C。干货按天数一件件坏。"
      },
      {
        day: 7,
        severity: 1,
        hint: "24°C。有人想生火烘干，柴不够。"
      },
      {
        day: 8,
        severity: 1,
        hint: "24°C。米袋底部的米发了霉。"
      },
      {
        day: 9,
        severity: 1,
        hint: "24°C。有人开始咳，说屋里太潮。"
      },
      {
        day: 10,
        severity: 1,
        hint: "24°C。电来了一小时，又断了。"
      },
      {
        day: 11,
        severity: 1,
        hint: "25°C。晒了半天，被子还是潮的。"
      },
      {
        day: 12,
        severity: 1,
        hint: "25°C。有人把粮食搬到了楼道。"
      },
      {
        day: 13,
        severity: 1,
        hint: "25°C。霉味在屋里散不掉。"
      },
      {
        day: 14,
        severity: 1,
        hint: "26°C。天晴了，电还没来。"
      }
    ],
    counterIntuitive: "断电在霉雨天里最要命的不是黑，是不能再烘干：除湿机和烘干机一停，水汽就只能留在屋里，而霉是靠水汽繁殖的。所以你越勤快地洗衣服、摊开晾，东西坏得越快，这一场该做的是少洗、少开门。",
    decisions: ["除湿机和烘干机停了，是生火烘干还是干脆少洗少用", "干货按天数一件件坏，是先吃掉要坏的还是摊开赌天晴", "低处的格子返潮最重，东西往高处码时顺手位怎么排"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。潮轴贡献 2/5/13/16（腐坏 2.8、建筑返潮、food 与 warmth 双降效、fefo:3），电轴贡献 8/9/11（行动点 -1、关超市与五金、dark 事件）。与霉雨不撞：霉雨不关店、npc 0.9、腐坏靠环境；本场关超市与五金、腐坏 2.8、warmth 也降效（衣物潮）。与大停电不撞：那场是 cold+dark、腐坏 1.6；本场是水汽主轴、腐坏 2.8。"
  },
{
    id: "sandstorm_riot",
    name: "沙暴骚乱",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "尘与人：沙暴把能见度压到一条街，也把巡逻的人压回屋里，谁都看不清谁在门口",
    temperatures: {
      [0]: 23,
      [3]: 23,
      [7]: 22,
      [11]: 23,
      [14]: 24,
      [-7]: 26,
      [-4]: 25,
      [-1]: 24
    },
    spoilRate: 2,
    dailyDrain: {
      medicine: 1,
      water: 2
    },
    priorityCategories: ["water", "medicine", "tool"],
    windowScene: "dust-riot",
    shelterDecayPerDay: -2,
    restEfficiency: 0.55,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["market", "weekend_flea"],
    priceSurcharge: 0.6,
    eventPoolWeights: {
      people: 3,
      panic: 2,
      supply: 2
    },
    npcVisitFactor: 1.4,
    categoryEfficiency: {
      medicine: 0.7
    },
    healthRiskPerDay: 2.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "26°C。天边是黄的，风也起来了。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "25°C。街上的人比平时少。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "24°C。超市的面粉被人搬走几袋。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "24°C。能见度越来越差。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "23°C。有人说昨晚门市被砸了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "23°C。邻居把铁门加固了。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "22°C。公告说风大时别出门。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "23°C。沙暴到了，巡逻的人也躲了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "22°C。看不清谁在街上走。"
      },
      {
        day: 2,
        severity: 1,
        hint: "22°C。货架在风里又空了一排。"
      },
      {
        day: 3,
        severity: 1,
        hint: "22°C。有人趁乱搬走了门口的货。"
      },
      {
        day: 4,
        severity: 1,
        hint: "22°C。屋里积土，人也不敢开窗。"
      },
      {
        day: 5,
        severity: 1,
        hint: "22°C。排队的人戴着口罩，看不清脸。"
      },
      {
        day: 6,
        severity: 1,
        hint: "23°C。夜里有人敲门，没看清是谁。"
      },
      {
        day: 7,
        severity: 1,
        hint: "23°C。楼栋里排了班轮流看门。"
      },
      {
        day: 8,
        severity: 1,
        hint: "23°C。风小了点，街上多了人。"
      },
      {
        day: 9,
        severity: 1,
        hint: "23°C。丢东西的在楼下对账。"
      },
      {
        day: 10,
        severity: 1,
        hint: "23°C。有人拿工具去换水。"
      },
      {
        day: 11,
        severity: 1,
        hint: "23°C。能见度回来了。"
      },
      {
        day: 12,
        severity: 1,
        hint: "24°C。货架慢慢填上。"
      },
      {
        day: 13,
        severity: 1,
        hint: "24°C。天还是灰的。"
      },
      {
        day: 14,
        severity: 1,
        hint: "24°C。沙落了，谁家少了什么也说不清。"
      }
    ],
    counterIntuitive: "沙暴不只是挡了你的路，它还替趁乱的人挡了目击：能见度压到一条街时，巡逻的躲了，你隔着面罩看不清对面是谁，许多损失是在白天大大方方发生的。这一场最贵的不是口罩，是认识你的邻居。",
    decisions: ["风大时看不远，货物放门口还是立刻收进屋", "口罩挡住的不只是土，也挡住了熟人的脸，认人要怎么做", "巡逻的人少了，是自家排班看门还是把货藏得更深"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。尘轴贡献 7/13/15（搬运、medicine 降效、健康债 2.5），乱轴贡献 9/11/12（关市场与集市、people 事件、npc 1.4）。与沙暴不撞：沙暴 npr 0.6（没人出门）、关周末集市；本场 npr 1.4、连关市场、加 people 与 panic。与骚乱不撞：骚乱不涉空气、healthRisk 无；本场健康债 2.5 是主压。"
  },
{
    id: "cold_sandstorm",
    name: "寒潮沙暴",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "冷与尘：口罩和取暖费从同一个口袋掏，冷先把呼吸道磨薄，尘再补上一记",
    temperatures: {
      [0]: -6,
      [3]: -8,
      [7]: -9,
      [11]: -8,
      [14]: -6,
      [-7]: 1,
      [-4]: -1,
      [-1]: -4
    },
    spoilRate: 0.9,
    dailyDrain: {
      fuel: 3,
      medicine: 1
    },
    priorityCategories: ["warmth", "fuel", "water"],
    windowScene: "cold-dust",
    shelterDecayPerDay: -2,
    restEfficiency: 0.55,
    carryFactor: 0.6,
    actionPointDelta: 0,
    shopSupplyFactor: 0.55,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      cold: 3,
      limit: 2,
      supply: 2
    },
    npcVisitFactor: 0.55,
    categoryEfficiency: {
      medicine: 0.8
    },
    healthRiskPerDay: 2.2,
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "1°C。寒潮预警和沙尘预报一起来了。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "0°C。口罩和取暖器都开始涨价。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "-2°C。风里带了土，天变黄了。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "-3°C。有人堵了窗缝，屋里还是进土。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "-4°C。出门一趟，鼻子里全是灰。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "-5°C。柴和口罩在同一天涨价。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "-5°C。风把土刮得看不见路。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "-6°C。冷和沙一起来了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "-8°C。屋里烧着炉子，窗不敢开。"
      },
      {
        day: 2,
        severity: 1,
        hint: "-8°C。有人咳得停不下来。"
      },
      {
        day: 3,
        severity: 1,
        hint: "-9°C。口罩一天换两个也不够。"
      },
      {
        day: 4,
        severity: 1,
        hint: "-9°C。柴烧得快，土还是进得来。"
      },
      {
        day: 5,
        severity: 1,
        hint: "-9°C。有人在屋里也戴上了口罩。"
      },
      {
        day: 6,
        severity: 1,
        hint: "-9°C。邻居来借柴，顺带要了两个口罩。"
      },
      {
        day: 7,
        severity: 1,
        hint: "-9°C。窗缝堵死了，屋里还是有一层土。"
      },
      {
        day: 8,
        severity: 1,
        hint: "-9°C。风把院里的柴吹得到处都是。"
      },
      {
        day: 9,
        severity: 1,
        hint: "-8°C。有人咳了几天，去看了医生。"
      },
      {
        day: 10,
        severity: 1,
        hint: "-8°C。送柴的车戴着头灯进城。"
      },
      {
        day: 11,
        severity: 1,
        hint: "-7°C。风小了，天还是黄的。"
      },
      {
        day: 12,
        severity: 1,
        hint: "-7°C。能开一小会儿窗了。"
      },
      {
        day: 13,
        severity: 1,
        hint: "-7°C。屋里扫出一层细土。"
      },
      {
        day: 14,
        severity: 1,
        hint: "-6°C。天晴了，柴也快见底。"
      }
    ],
    counterIntuitive: "防尘的口罩和取暖的燃料在同一笔钱里抢，但真正贵的是顺序：先买燃料能熬过夜，先买口罩能熬过白天，两者都缺的那几天恰好是风最硬的时候。而这一场冷和尘是加法的，冷把气管先磨薄，尘只负责让它更疼。",
    decisions: ["预算只够一样，先买燃料过夜还是先买口罩出门", "风把院里的柴吹散，是冒着沙去捡还是眼看着烧完", "屋顶和窗缝都堵了土还是进得来，清扫要占掉多少行动点"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。寒轴贡献 1/2（燃料、腐坏变慢），尘轴贡献 13/15（medicine 0.8、健康债 2.2）。行动点刻意留 0（冷与尘都不直接断腿，压的是钱与健康）。与寒潮不撞：寒潮无健康债、无尘、npr 高；本场 npr 0.55、healthRisk 2.2。与沙暴不撞：沙暴是常温、npr 0.6；本场烧 3 份燃料、腐坏 0.9。"
  },
{
    id: "blackout_riot",
    name: "停电骚乱",
    family: "组合",
    level: "L3",
    tier: 3,
    axis: "黑与人：黑暗没让人看不清路，是让人看不见彼此在做什么，来的人比有电时更勤",
    temperatures: {
      [0]: 15,
      [3]: 14,
      [7]: 14,
      [11]: 15,
      [14]: 16,
      [-7]: 18,
      [-4]: 17,
      [-1]: 16
    },
    spoilRate: 2,
    fridgeDead: true,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "fuel", "medicine"],
    windowScene: "black-riot",
    shelterDecayPerDay: -2,
    restEfficiency: 0.5,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["supermarket", "market"],
    priceSurcharge: 0.55,
    eventPoolWeights: {
      dark: 3,
      people: 3,
      panic: 2
    },
    npcVisitFactor: 1.5,
    categoryEfficiency: {
      tool: 0.8
    },
    healthRiskPerDay: 1.8,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "18°C。电费单和一条治安消息一起到。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "17°C。小区门口多了几个人守着。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "16°C。超市的货架被搬得快。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "16°C。有人说主路那边打起来了。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "15°C。物业把大门的灯换成应急灯。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "15°C。夜里有人挨家问有没有吃的。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "14°C。电网说要拉闸。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "15°C。全黑了，楼下有人吵起来。"
      },
      {
        day: 1,
        severity: 1,
        hint: "14°C。没有灯，看不清谁在门口。"
      },
      {
        day: 2,
        severity: 1,
        hint: "14°C。冰箱停了，肉在化。"
      },
      {
        day: 3,
        severity: 1,
        hint: "14°C。夜里敲门的人比往常多。"
      },
      {
        day: 4,
        severity: 1,
        hint: "14°C。有人举着手电在楼道里转。"
      },
      {
        day: 5,
        severity: 1,
        hint: "14°C。邻居结伴守住了楼口。"
      },
      {
        day: 6,
        severity: 1,
        hint: "14°C。超市提前关了门，货没了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "14°C。手电和蜡烛成了硬货。"
      },
      {
        day: 8,
        severity: 1,
        hint: "15°C。有人趁黑搬走了外面的东西。"
      },
      {
        day: 9,
        severity: 1,
        hint: "15°C。来电了十分钟，又灭了。"
      },
      {
        day: 10,
        severity: 1,
        hint: "15°C。楼栋里排了守夜的班。"
      },
      {
        day: 11,
        severity: 1,
        hint: "15°C。街上安静了一点。"
      },
      {
        day: 12,
        severity: 1,
        hint: "15°C。电来得勤了一些。"
      },
      {
        day: 13,
        severity: 1,
        hint: "16°C。夜里能看清路了。"
      },
      {
        day: 14,
        severity: 1,
        hint: "16°C。电稳住了，门口的岗还留着。"
      }
    ],
    counterIntuitive: "黑暗真正的作用不是遮住路，是遮住见证：有灯的时候，谁进了楼道、谁搬了东西都有人看着；一停电，来的人反而比有电时更勤，因为没人看得见。这一场手电和蜡烛不是照明，是给邻居看的证明。",
    decisions: ["把手电和蜡烛拿出来当照明，还是当给邻居看的证明", "夜里敲门的人变多，开门分东西还是装没人", "冰箱停了要尽快吃掉，但分给守夜的人就意味着自己少吃一顿"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。电轴贡献 8/9（行动点 -1、关超市与市场），人轴贡献 11/12/15（dark+people 事件、npc 1.5 顶格、健康债 1.8）。与骚乱不撞：骚乱是白天默认、关市场、npc 1.4；本场加 dark 事件、连关超市、npc 1.5。与大停电不撞：大停电是 cold+dark、刚需是燃料食物、腐坏 1.6；本场无寒潮、腐坏 2.0、把 people 轴拉满（npc 1.5 与大停电的 1.3 不同）。"
  },
  // ═══ 生成内容 灾难-组合 止 ═══,
  // ═══ 生成内容 灾难-结构 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "earthquake_structure",
    name: "地震",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "空间与结构：有几块地方你再也放不了东西了",
    temperatures: {
      [0]: 7,
      [3]: 6,
      [7]: 5,
      [11]: 5,
      [14]: 6,
      [-7]: 10,
      [-4]: 9,
      [-1]: 8
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["medicine", "tool"],
    windowScene: "cracked-wall",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.6,
    carryFactor: 0.55,
    actionPointDelta: 0,
    shopSupplyFactor: 0.45,
    closedShopIds: ["wholesale"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      supply: 3,
      people: 2
    },
    npcVisitFactor: 0.8,
    capacityFactor: 0.72,
    unusableShelfIds: ["shelf_c"],
    healthRiskPerDay: 1,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "10°C。凌晨有一次小震，床晃了两下。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "9°C。群里在传断裂带的图，没人当真。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "9°C。超市的矿泉水又有人整箱搬。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "8°C。物业来检查了外墙，说没事。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "8°C。又晃了一次，这次是白天。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "7°C。有人开始在车里睡。"
      },
      {
        day: -1,
        severity: 0.7,
        hint: "7°C。架子上有东西掉下来，摔了一个碗。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "7°C。凌晨那一下很长，墙上有道裂缝。"
      },
      {
        day: 1,
        severity: 1,
        hint: "6°C。余震一整天没停，人都下楼了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "6°C。冰箱倒了，门打不开。"
      },
      {
        day: 3,
        severity: 0.95,
        hint: "6°C。楼下那间屋子裂得厉害，不让进。"
      },
      {
        day: 4,
        severity: 1,
        hint: "5°C。批发站的仓库塌了一角，拉走了货。"
      },
      {
        day: 5,
        severity: 1,
        hint: "5°C。楼道里的扶手松了，走的时候要扶墙。"
      },
      {
        day: 6,
        severity: 0.95,
        hint: "5°C。余震变成一天几次，习惯了那种晃。"
      },
      {
        day: 7,
        severity: 0.9,
        hint: "5°C。五金店排队，都在买锤子和钉子。"
      },
      {
        day: 8,
        severity: 0.9,
        hint: "6°C。阳台的窗户关不严了，风往里灌。"
      },
      {
        day: 9,
        severity: 0.85,
        hint: "6°C。有人在楼下空地上搭了棚子。"
      },
      {
        day: 10,
        severity: 0.8,
        hint: "6°C。药店的绷带和云南白药都空了。"
      },
      {
        day: 11,
        severity: 0.8,
        hint: "6°C。楼里通了电，水管还没修好。"
      },
      {
        day: 12,
        severity: 0.75,
        hint: "6°C。余震少了，一天一两次。"
      },
      {
        day: 13,
        severity: 0.7,
        hint: "6°C。远处有工程车的声音，一直在响。"
      },
      {
        day: 14,
        severity: 0.65,
        hint: "6°C。没人再提余震。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "这一场最大的损失不是东西没了，是「地方没了」。裂掉的那间屋子再也放不了东西，而你的物资一件没少，只是没处放；于是「理得有多紧」比「囤了多少」重要得多",
    decisions: ["有一整块家具不能用了，东西要挤到剩下的地方去", "批发站塌了，大宗粮油这条路断了，剩下几天只能靠零售", "裂缝那一侧的墙还在漏风，修它要花掉本来留给燃料的时间"],
    notes: "用到维度 1/2/3/4/5/6/7/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 14 个。主打维度 14（unusableShelfIds 摘掉一整块 + capacityFactor 0.72 砍排 。 全案第一次让「空间本身」成为损失，而不是数值）。与洪水不撞：洪水也是空间，但它是「低处进水」（连续的小一圈 + 保暖作废），本场是「结构坏了」（整块没了 + 修墙的压力）。"
  },
{
    id: "aftershock_structure",
    name: "余震",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "修缮与回退：结构在持续恶化，今天补的明天又被推回去",
    temperatures: {
      [0]: 8,
      [3]: 7,
      [7]: 6,
      [11]: 6,
      [14]: 7,
      [-7]: 11,
      [-4]: 10,
      [-1]: 10
    },
    spoilRate: 1.6,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["food", "medicine", "fuel"],
    windowScene: "after-shock",
    shelterDecayPerDay: -4,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: 0,
    shopSupplyFactor: 0.7,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      supply: 3,
      people: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      tool: 0.7
    },
    capacityFactor: 0.8,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1.5,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "11°C。凌晨晃了一下，桌上的杯子挪了位。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "10°C。群里有张墙缝的照片，没人转发。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "10°C。超市的矿泉水和电池走得比平时快。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "10°C。昨天补的那道缝，今天看着又长了。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "9°C。物业在楼下贴了张告示，说小震正常。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "9°C。半夜又晃两下，有人披衣下了楼。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "8°C。架子上的东西往里挪了挪，怕掉。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "8°C。一天里晃了十几次，墙皮开始往下掉。"
      },
      {
        day: 1,
        severity: 1,
        hint: "7°C。刚钉好的木板，下午就松了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "7°C。冰箱门自己开了，地上碎了一地。"
      },
      {
        day: 3,
        severity: 1,
        hint: "7°C。五金店的锤子和膨胀螺丝卖光了。"
      },
      {
        day: 4,
        severity: 1,
        hint: "6°C。楼下那面墙补了塌，塌了又补。"
      },
      {
        day: 5,
        severity: 1,
        hint: "6°C。有人干脆把碗全收到地上放。"
      },
      {
        day: 6,
        severity: 1,
        hint: "6°C。楼上掉下来一块，砸穿了阳台的棚。"
      },
      {
        day: 7,
        severity: 1,
        hint: "6°C。楼道扶手又松了，没人再修。"
      },
      {
        day: 8,
        severity: 0.95,
        hint: "6°C。药店的绷带和消毒水见了底。"
      },
      {
        day: 9,
        severity: 0.95,
        hint: "6°C。水管裂了一处，接水的桶摆了一排。"
      },
      {
        day: 10,
        severity: 0.9,
        hint: "6°C。今天小震断断续续，一天没停过。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "6°C。有人把床挪到了承重墙边上。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "6°C。远处有工程车的声音，来评估房子的。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "7°C。晃得少了，一天才两三次。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "7°C。墙上的裂缝还在。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "余震里最亏的是勤劳。每修一次，下一次晃动就把它推回去一点，投入的时间与工具在账上留不下痕迹。反倒是那些一次没修、直接把东西挪到地面的人，损失最小。修，在这一场是一种负收益。",
    decisions: ["墙体一直在恶化，是继续投工投料去补，还是干脆放弃那面墙把东西挪走", "行动点没被扣，但每补一次都要占掉当天的时间，这笔投入值不值", "工具在余震里修了又坏，要不要把工具留给固定的地方而不是反复上墙"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。主打维度 5（shelterDecayPerDay -4，全档最狠，把『修』本身变成负收益）与 15（healthRiskPerDay 1.5，持续落物带来的健康损耗）。与地震不撞：地震是一次性大震加整块空间作废、主线是『地方没了』；本场房子没塌，主线是『补了也白补』，且多了工具效率打折与健康持续掉血两条地震没有的机制。"
  },
{
    id: "landslide_cut",
    name: "塌方",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "进货通道：唯一那条能过货的山路被埋了",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 9,
      [11]: 10,
      [14]: 11,
      [-7]: 13,
      [-4]: 12,
      [-1]: 11
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "water", "fuel"],
    windowScene: "blocked-slope",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.7,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.4,
    closedShopIds: ["wholesale", "community_store"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      supply: 4,
      queue: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      food: 0.8
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "13°C。进山那条路上落了些碎石，车慢了点。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。有人说后山在往下掉土。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "12°C。店里的米面补货比平时晚了一天。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "11°C。雨下了一夜，路上开始积泥。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "11°C。货车司机说山口不好走，可能绕路。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "10°C。批发站的大车今天没进来。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "10°C。路政的车停在山口，拉了警戒线。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "10°C。山塌了，那条唯一的进货路被埋了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "9°C。超市的菜架空了一半，补不上。"
      },
      {
        day: 2,
        severity: 1,
        hint: "9°C。批发站门口排着队，都没货。"
      },
      {
        day: 3,
        severity: 1,
        hint: "9°C。有人试着从老路绕，多走两个小时。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。粮油店贴了张纸，说卖完即止。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。菜价一天一个数，翻着往上涨。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。清理队进山了，说至少一周。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。有人趁乱抬价，一袋米加了不少。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。社区店的小包装先空了，只剩大件。"
      },
      {
        day: 9,
        severity: 1,
        hint: "9°C。去隔壁镇的路也堵，绕不过去。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "9°C。抢修的人在坡上打桩，进度很慢。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "10°C。进山的车队排了很长，进不来。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "10°C。路通了一条便道，只能过小车。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "10°C。补货的车终于进来了，店又摆满了。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "11°C。路清得差不多了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "断路最直接的变化不是东西变少，是每趟搬运的单价变了。同样跑一趟，以前能拉十斤，现在要绕要爬，真正到手只剩一半。于是这一场里最保值的是近，最不值钱的是又便宜又远。",
    decisions: ["唯一的进货路断了，是花钱从私人手里买高价货，还是把预算压到能自给的部分", "行动点被扣、搬运量也降了，要不要为了省一趟而只买最顶饱的东西", "绕路要多花两小时，这笔时间从休息里扣还是从整理里扣"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13，共 13 个。主打维度 9（shopSupplyFactor 0.4 加一次关两家店，进货通道被物理切断）与 7（carryFactor 0.55，路况把每趟运力压下去）。与地震不撞：地震断的是批发站的一角（单点），本场断的是整条进货通道，且带有绕路与清障的动作点成本；也与其它水家族断路（山洪、台风）不撞，那些是水位导致，本场是山体结构位移。"
  },
{
    id: "condemned_building",
    name: "封楼",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "全城封控：建筑安全评估把成片楼栋封掉，围挡把街道切成互不相通的几段",
    temperatures: {
      [0]: 6,
      [3]: 6,
      [7]: 5,
      [11]: 6,
      [14]: 7,
      [-7]: 9,
      [-4]: 8,
      [-1]: 7
    },
    spoilRate: 1.6,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["medicine", "tool", "warmth"],
    windowScene: "sealed-district",
    shelterDecayPerDay: -3,
    restEfficiency: 0.55,
    carryFactor: 0.5,
    actionPointDelta: -1,
    shopSupplyFactor: 0.55,
    closedShopIds: ["community_store", "market"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      neighbor: 3,
      people: 2,
      limit: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      tool: 0.7
    },
    capacityFactor: 0.5,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 1.5,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "9°C。居委会发通知，要给全城老楼做评估。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "8°C。第一批评估队进了隔壁小区，逐栋贴标。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "8°C。有栋楼贴了红标，当天有人往外搬。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "7°C。评估扩到整片街区，围挡立到路口。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "7°C。公告说红标楼一律封，住户要按期清空。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "6°C。商业街两头立了围挡，车只能绕行。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "6°C。楼下开始登记，搬走的东西要报备。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "6°C。评估结果下来，成片的楼被判了红标。"
      },
      {
        day: 1,
        severity: 1,
        hint: "6°C。几条街一起封，围挡把商业街切开。"
      },
      {
        day: 2,
        severity: 1,
        hint: "6°C。楼里断水断电，人只拿最要紧的东西。"
      },
      {
        day: 3,
        severity: 1,
        hint: "6°C。常去的店在围挡里侧，走不进去。"
      },
      {
        day: 4,
        severity: 1,
        hint: "6°C。安置点按登记顺序排，早去的先挑。"
      },
      {
        day: 5,
        severity: 1,
        hint: "6°C。绕围挡多走半小时，出门次数少了。"
      },
      {
        day: 6,
        severity: 1,
        hint: "5°C。轻的家当先搬走，重的留在屋里。"
      },
      {
        day: 7,
        severity: 1,
        hint: "5°C。这一段围挡里只剩两家店还开着。"
      },
      {
        day: 8,
        severity: 1,
        hint: "5°C。评估还在继续，新的红标天天在贴。"
      },
      {
        day: 9,
        severity: 1,
        hint: "5°C。办事要安全证明，跑手续比搬家费时。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "6°C。围挡外侧的店开到很晚，里侧全关。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "6°C。有人按围挡分区拼单，凑够一趟再买。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "6°C。剩下的家当慢慢往安置点挪。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "6°C。有几栋复核后摘了红标，人能回去。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "7°C。封控还没全撤。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "全城封街之后，离得近不等于够得着。同一座城里，你家和商店之间隔着几道围挡，就等于隔了几座城。于是决定这一场日子好坏的，不是你家在城南还是城北，是你这块围挡里还剩几家店。",
    decisions: ["整栋楼被判红标，是先去办安置登记还是先把轻的家当搬走", "围挡把商业街切成几段，常去的店进不去，是改买这一段里的还是绕远", "行动点被绕行与跑手续吃掉，搬家与采购怎么排先后"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。主打维度 14（capacityFactor 0.5 加 shelf_a 失能，成片封楼让可用货位与安置点同时缩水）、8（actionPointDelta -1 与 carryFactor 0.5，绕围挡与搬家双重占用）与 9（shopSupplyFactor 0.55 加关两家店，围挡把商业街切成互不相通的几段）。与地震不撞：地震是单点破坏，本场结构大多完好，损失来自全城评估后的封控与可达性。承重裂已并作本场的强度档变体（同一内核的轻档），因此不再单独立场。"
  },
{
    id: "bridge_collapse",
    name: "桥隧断",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "跨江桥群与主干桥隧集体封闭：对岸还在营业，绕行成本成为每天都要付的账",
    temperatures: {
      [0]: 12,
      [3]: 11,
      [7]: 11,
      [11]: 12,
      [14]: 13,
      [-7]: 15,
      [-4]: 14,
      [-1]: 13
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["water", "fuel", "luxury"],
    windowScene: "closed-bridges",
    shelterDecayPerDay: -2,
    restEfficiency: 0.68,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["market", "gas_station"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      market: 3,
      supply: 2,
      queue: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      fuel: 0.8
    },
    healthRiskPerDay: 0.8,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "15°C。跨江的几座桥一起限了重，大车排队。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "14°C。桥面养路队连夜作业，封了一条道。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "14°C。对岸的市场照常开，人比这边多。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "13°C。群里说桥墩的病害不止一处。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "13°C。主干桥开始轮流封，过一次要等很久。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "12°C。桥下装了监测仪，数据一天一公示。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "12°C。绕城的车流把高速堵成了停车场。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "12°C。几座跨江桥与主隧先后封了，全线不通。"
      },
      {
        day: 1,
        severity: 1,
        hint: "11°C。河这边的店半天就被搬空。"
      },
      {
        day: 2,
        severity: 1,
        hint: "11°C。对岸的货再便宜，也运不过河。"
      },
      {
        day: 3,
        severity: 1,
        hint: "11°C。有人摆渡运货，一趟按人头收钱。"
      },
      {
        day: 4,
        severity: 1,
        hint: "11°C。绕城多跑四十公里，油钱翻倍。"
      },
      {
        day: 5,
        severity: 1,
        hint: "11°C。这边的菜价自己涨，对岸没动。"
      },
      {
        day: 6,
        severity: 1,
        hint: "11°C。过河的车堵在渡口，排到天黑。"
      },
      {
        day: 7,
        severity: 1,
        hint: "11°C。河两侧像两个市场，价差越拉越大。"
      },
      {
        day: 8,
        severity: 1,
        hint: "11°C。这边的店只进耐放的，鲜货断了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "11°C。有人拼一趟过江，凑人头摊船费。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "12°C。抢修队在桥墩下打桩，工期按月算。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "12°C。便桥先通人，一次只放一队。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "12°C。过桥要预约，号排在几天后。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "13°C。一辆货车能过了，只是绕得很远。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "13°C。桥群还没修完。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "桥群一封，河这边的价格就不再由对岸决定。对岸再便宜也运不过来，这边涨不涨只看这边困了多少人和还剩多少货。于是同一座城，隔一条河的两侧会像两个市场一样各涨各的。",
    decisions: ["过江的桥全封了，是花钱坐摆渡一趟趟运，还是改吃这边耐放的东西", "行动点被绕行吃掉，是集中一趟过江把货带够，还是分几次轻装过", "这边物价被单独抬高，是现在就吃进一批，还是等便桥搭起来"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 9（shopSupplyFactor 0.5 加关掉市场与加油站，桥隧集体封闭把两侧拆成两个市场）与 10（priceSurcharge 0.5，涨不涨只由本地存量决定）。与地震不撞：地震损失在自家楼上，本场自家完好，压力全在可达性与市场分割；与塌方、隧道堵不撞：那两场断的是进货的货流，本场断的是买货的人的路，货隔着河摆着。"
  },
{
    id: "subway_collapse",
    name: "地铁塌",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "地下通路：地面的路好好的，断的是看不见的那条货运线",
    temperatures: {
      [0]: 7,
      [3]: 6,
      [7]: 6,
      [11]: 7,
      [14]: 8,
      [-7]: 10,
      [-4]: 9,
      [-1]: 8
    },
    spoilRate: 1.4,
    fridgeDead: true,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["water", "fuel", "luxury"],
    windowScene: "sunken-subway",
    shelterDecayPerDay: -3,
    restEfficiency: 0.65,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["supermarket"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      supply: 3,
      dark: 2
    },
    npcVisitFactor: 0.8,
    scoreWeights: {
      fefo: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "10°C。地铁说有一站漏水，临时限流。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "9°C。早高峰多等了半小时，站里全是人。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "9°C。有段隧道渗水，列车开得很慢。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "8°C。通勤的人改坐公交，公交挤不上。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "8°C。地铁封了一个出入口，拉了围挡。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "7°C。有人说地下在塌，官方只说检修。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "7°C。那一段彻底停运，站台清空了。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "7°C。半夜一段隧道塌了，灌进好多水。"
      },
      {
        day: 1,
        severity: 1,
        hint: "6°C。全线停运，地下的路断了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "6°C。货车走的也是地下通道，全堵在地面。"
      },
      {
        day: 3,
        severity: 1,
        hint: "6°C。超市的补货慢了两天，货架空着。"
      },
      {
        day: 4,
        severity: 1,
        hint: "6°C。地面上的路被绕行的车塞满了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "6°C。有人把货扛到地铁口，靠人力转运。"
      },
      {
        day: 6,
        severity: 1,
        hint: "6°C。地下先断了电，抽水机也停了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "6°C。地上看着好好的，地下口子越冲越大。"
      },
      {
        day: 8,
        severity: 1,
        hint: "6°C。补给跟不上，便利店只开半天。"
      },
      {
        day: 9,
        severity: 1,
        hint: "7°C。通勤的人每天多走两公里，都累。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "7°C。抢修的队从地面往下打，进度很慢。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "7°C。地面开始塌陷，封了好几条街。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "7°C。有一条线恢复了一小段，只开白天。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "8°C。货车能走地面的大路了，绕得远。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "8°C。地下还在修。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "地面看起来一切正常，塌的是看不见的那条线。人多走地下，货也走地下，所以这一场最先空掉的是货架，而不是路。你站在完好的人行道上，却买不到东西。",
    decisions: ["补货线断在地上，是去跑更远的店，还是靠家里现有的撑过去", "行动点被扣在绕路上，搬运与出门的次数怎么分配", "地下断电视而不见，要不要把手电与备电的份量提前留出来"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/16，共 13 个。主打维度 9（shopSupplyFactor 0.5 加关掉超市）与 11（供应权重 3 加黑暗 2，物流断供与地下断电并行）。与地震不撞：地震的断裂在住宅本身，本场断在地下物流网络，对玩家的直接损伤是货架先空而不是屋子先塌；也与塌方不撞，塌方是山路的可见阻断，本场是看不见的地下通路。"
  },
{
    id: "post_fire",
    name: "连烧",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "城区连烧数日：火线跨街区推进，烟、消防水与断电一起压过来",
    temperatures: {
      [0]: 13,
      [3]: 12,
      [7]: 12,
      [11]: 13,
      [14]: 14,
      [-7]: 16,
      [-4]: 15,
      [-1]: 14
    },
    spoilRate: 2,
    fridgeDead: true,
    dailyDrain: {
      water: 1,
      medicine: 1
    },
    priorityCategories: ["water", "medicine", "tool"],
    windowScene: "burning-district",
    shelterDecayPerDay: -3.5,
    restEfficiency: 0.6,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["community_store", "supermarket"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      panic: 3,
      water: 2,
      supply: 2
    },
    npcVisitFactor: 1.2,
    categoryEfficiency: {
      medicine: 0.7
    },
    capacityFactor: 0.5,
    unusableShelfIds: ["shelf_c"],
    healthRiskPerDay: 2.5,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "16°C。城西一片仓库起了火，风大压不住。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "15°C。烟飘到城北，楼道里能闻到焦味。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "15°C。消防说水压不够，火线往东推。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "14°C。又有两处飞火落下来，点着了棚子。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "14°C。整片街区的电停了，水泵也停了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "13°C。火线跨过主干道，人往河边退。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "13°C。连夜疏散，几个街区的人往外走。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "13°C。城区大火连烧数日，白天看不见太阳。"
      },
      {
        day: 1,
        severity: 1,
        hint: "12°C。没烧到的楼被消防水泡了，一层层湿。"
      },
      {
        day: 2,
        severity: 1,
        hint: "12°C。烟往风的下游走，那边的街区先呛。"
      },
      {
        day: 3,
        severity: 1,
        hint: "12°C。低洼的几片积了水，退不下去。"
      },
      {
        day: 4,
        severity: 1,
        hint: "12°C。断电断水一起停，能住的楼少了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "12°C。泡过的存货开始有味，得往外扔。"
      },
      {
        day: 6,
        severity: 1,
        hint: "12°C。烟熏过的墙擦不掉，屋里待不住。"
      },
      {
        day: 7,
        severity: 1,
        hint: "12°C。水渍让靠地的货全报废，往上搬。"
      },
      {
        day: 8,
        severity: 1,
        hint: "13°C。几片街区封了，进不去也出不来。"
      },
      {
        day: 9,
        severity: 1,
        hint: "13°C。风一转，新的街区开始冒烟。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "13°C。清理队按街区分片评估损失。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "13°C。剩下能住的地方挤了太多人。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "13°C。有人把没熏到的货挪到更远的地方。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "14°C。火势小了一些，烟还没散。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "14°C。还能住的地方不多。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "连烧几天之后，最先不能住的是没着火的那几片。消防水往低处走，烟往风的下游走，火线之外的两样东西把没烧到的地方也清了场。于是这一场里，离火最近和离火最远，可能一样住不了。",
    decisions: ["连烧几天，转移是按离火远近走还是按烟与水渍的方向走", "几片街区被封，东西是往没烧到的片区挪，还是清掉换现金", "断电断水一起停，防潮与通风的投入从哪一项里挤"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。主打维度 14（capacityFactor 0.5 加 shelf_c 失能，几片街区一起不能用）与 15（healthRiskPerDay 2.5，烟与水渍带来的持续健康损耗）。与地震不撞：地震是结构开裂导致的失能与落物，本场是火线推进后的烟熏与水渍，损失主要按街区面积算；与洪水不撞，洪水是外部进水，本场是灭火的内涝加烟；与燃气管爆燃不撞，那场是管网级的多个爆点，本场是一条火线连烧推进。"
  },
{
    id: "garage_collapse",
    name: "地下停用",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "地下空间整体停用：车库、人防与地下商业一起关停，通路与仓储同时没了",
    temperatures: {
      [0]: 9,
      [3]: 9,
      [7]: 8,
      [11]: 9,
      [14]: 10,
      [-7]: 12,
      [-4]: 11,
      [-1]: 10
    },
    spoilRate: 1.7,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "water", "tool"],
    windowScene: "sealed-underground",
    shelterDecayPerDay: -2.5,
    restEfficiency: 0.66,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["wholesale"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      supply: 3,
      queue: 2,
      dark: 2
    },
    npcVisitFactor: 0.8,
    categoryEfficiency: {
      fuel: 0.8
    },
    capacityFactor: 0.5,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1,
    scoreWeights: {
      fefo: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "12°C。地下车库的入口渗水，摆了几个沙袋。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "11°C。人防通道在检修，说是年头太久了。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "11°C。地下商业街顶棚有块板鼓了起来。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "10°C。监测说地下几层的沉降数据不对。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "10°C。车库开始限流，车只能进不能出。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "9°C。人防口拉起警戒线，不让再下去。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "9°C。有人连夜把地下的存货往上搬。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "9°C。地下几层同时出问题，评估说要全停。"
      },
      {
        day: 1,
        severity: 1,
        hint: "8°C。车库、人防、地下商业一起关了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "8°C。存在下面的东西，一时半会拿不出来。"
      },
      {
        day: 3,
        severity: 1,
        hint: "8°C。地面车位不够，车全堵在路边。"
      },
      {
        day: 4,
        severity: 1,
        hint: "8°C。地下商业关了，这片的店没了大半。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。有人从通风口往下看，底下进不去。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。搬上来的东西把楼道堆满了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。地下通路断了，过街要走地面绕。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。封闭的日子越拖，下面的货坏得越多。"
      },
      {
        day: 9,
        severity: 1,
        hint: "9°C。批发与仓储一起停，补货慢了下来。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "9°C。评估的人说停用期按周算，不是按天。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "9°C。家里堆不下，只能挑耐放的留下。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "10°C。有人租了地面的小仓，价钱很高。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "10°C。地下还封着，清理队开始抽水。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "10°C。地下的门还没开。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "地下空间一封，里面东西的损失是按封了多少天算的，不是按有没有进水。没泡到水的那些，只要拿不出来，一样会过期。于是这一场里最该先救的不是最值钱的，是最不耐放的。",
    decisions: ["地下库房整体停用，捞得上来的东西先搬耐放的还是先搬值钱的", "车和车位一起没了，是走路多跑几趟还是花钱请车", "通路也断了，绕地面要多花行动点，出门次数怎么砍"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。主打维度 14（capacityFactor 0.5 加 shelf_b 失能，车库与人防整层报废）与 7（carryFactor 0.55，车与地下通路一起失效）。与地震不撞：地震废掉的是居住空间的货位，本场废掉的是车、人防与地下商业这一整层，叠加了车失效带来的运力下降；与封楼不撞，封楼是人被要求离场，本场是人还在原地但少了一整层地下。"
  },
{
    id: "ground_settle",
    name: "地陷",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "全城地面沉降带：路、管线与货架一起失效，没有一处地面是平的",
    temperatures: {
      [0]: 11,
      [3]: 11,
      [7]: 10,
      [11]: 11,
      [14]: 12,
      [-7]: 14,
      [-4]: 13,
      [-1]: 12
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["water", "medicine", "tool"],
    windowScene: "settling-belt",
    shelterDecayPerDay: -3,
    restEfficiency: 0.7,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.7,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.35,
    eventPoolWeights: {
      queue: 2,
      neighbor: 2
    },
    npcVisitFactor: 1,
    categoryEfficiency: {
      tool: 0.7
    },
    capacityFactor: 0.7,
    healthRiskPerDay: 1.2,
    scoreWeights: {
      placement: 4
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。几处路面鼓包，养路的来量了标高。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "13°C。老城区的墙缝连成一条线，绕着街区走。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "13°C。几户人家发现门框卡住，推不开。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "12°C。供水管在两条街外爆了，抢修干了整夜。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "12°C。沉降的数据一天一更新，范围在扩。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "11°C。有人发现桌面上放不住圆的东西。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "11°C。公告说城里拉出了几段沉降带。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "11°C。全城地面沉降带连片，路和管子一起裂。"
      },
      {
        day: 1,
        severity: 1,
        hint: "11°C。货架全歪了，上层的东西往下滑。"
      },
      {
        day: 2,
        severity: 1,
        hint: "11°C。按重量分层的码放全乱，得重码。"
      },
      {
        day: 3,
        severity: 1,
        hint: "11°C。管道裂得多，水得提前接好存着。"
      },
      {
        day: 4,
        severity: 1,
        hint: "11°C。几条主路塌了边，绕行成了常态。"
      },
      {
        day: 5,
        severity: 1,
        hint: "11°C。有人找来垫片，塞在架子腿下面。"
      },
      {
        day: 6,
        severity: 1,
        hint: "11°C。垫过之后还是斜，找平成了每天的活。"
      },
      {
        day: 7,
        severity: 1,
        hint: "11°C。五金店的垫片和水平尺卖光了。"
      },
      {
        day: 8,
        severity: 1,
        hint: "11°C。有的楼两头沉得不一样，门彻底卡死。"
      },
      {
        day: 9,
        severity: 1,
        hint: "11°C。沉降带边缘的人开始往没沉的地方挪。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "11°C。注浆的队进场，一段一段补。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "11°C。施工围了半个城，进出都绕。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "12°C。注过浆的路暂时不沉了。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "12°C。货架按新的倾角重新码了一遍。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "12°C。沉降带还在。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "全城沉降最麻烦的不是哪一栋塌了，是找不着一条水平线。同一间屋子，这头比那头低几厘米，门推不开、柜子站不住、水流向一个角。于是这一场里最值钱的手艺不是搬，是垫平。",
    decisions: ["地面整个斜了，码放要从按重量分层改成按重心与倾角设计", "管子也在裂，是先把水与燃料转进容器还是先找地方垫平货架", "行动点被绕行与找平吃掉，出门与整理怎么排先后", "沉降带还在扩，是把东西挪到还没沉的那片还是原地加固"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14/15/16，共 16 个。主打维度 16（placement 4，把码放原则整个推翻）、14（capacityFactor 0.7，倾角让有效货位缩水）与 8（actionPointDelta -1，绕行与找平双重占用）。与地震不撞：地震是突然的破坏与整块失能，本场结构大多完好、只是找不平，损失在于规则失效而不是地方没了；与采空塌陷不撞，那是地下空洞连片下陷带裂口，本场是全城缓沉与倾斜。"
  },
{
    id: "tunnel_blocked",
    name: "隧道堵",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "唯一干线：城里进货只剩隧道这一条货运干线，堵了就没有第二条路",
    temperatures: {
      [0]: 8,
      [3]: 7,
      [7]: 7,
      [11]: 8,
      [14]: 9,
      [-7]: 11,
      [-4]: 10,
      [-1]: 9
    },
    spoilRate: 1.4,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["water", "warmth", "tool"],
    windowScene: "tunnel-plug",
    shelterDecayPerDay: -2,
    restEfficiency: 0.72,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["wholesale"],
    priceSurcharge: 0.45,
    eventPoolWeights: {
      queue: 3,
      supply: 3
    },
    npcVisitFactor: 1,
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "11°C。城里进货唯一靠隧道，今天堵了一阵。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "10°C。货车只能改走地面，绕了好远。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "10°C。有人说隧道顶上有块混凝土掉了下来。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "9°C。唯一的货运道封了一条，车流慢一半。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "9°C。送货的司机说进不来，让再等等。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "8°C。超市补货晚了两天，菜架先空。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "8°C。夜里隧道彻底封了，两头排着长队。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "8°C。隧道里塌了，这条唯一的货运干线断了。"
      },
      {
        day: 1,
        severity: 1,
        hint: "7°C。货车全堵在隧道口，卸不了货。"
      },
      {
        day: 2,
        severity: 1,
        hint: "7°C。没有第二条路，轻货先没了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "7°C。米面还撑得住，鲜货早就没了。"
      },
      {
        day: 4,
        severity: 1,
        hint: "7°C。有人从隧道口倒货，靠小推车拉。"
      },
      {
        day: 5,
        severity: 1,
        hint: "7°C。批发站门口排着队，进不了货。"
      },
      {
        day: 6,
        severity: 1,
        hint: "7°C。物价往上走，先涨的是常买的。"
      },
      {
        day: 7,
        severity: 1,
        hint: "7°C。绕高速要多跑一天，运费翻倍。"
      },
      {
        day: 8,
        severity: 1,
        hint: "8°C。隧道那头堵成长龙，一动不动。"
      },
      {
        day: 9,
        severity: 1,
        hint: "8°C。小推车成了抢手货，一趟拉一点。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "8°C。抢修队进了隧道，说里面还在掉。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "8°C。只清出一条窄道，一次过一辆车。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "9°C。货车慢慢能过了，还是排着长队。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "9°C。补货的车陆续进来，货架慢慢满上。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "9°C。隧道通了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "隧道一堵，最先没货的不是便宜的重货，是那些靠频繁补货的轻货。唯一一条货运线断掉，一天一补的东西先空，而耐放的米面反而还能撑。于是这一场里，常用的比耐放的先消失。",
    decisions: ["唯一货运线断了，是去隧道口排队等货，还是靠现有的扛过去", "轻货先空，常买的东西要不要提前用耐放的替代品顶上", "物价在涨，是趁现在补一批耐放的，还是留着现金等通车"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12，共 12 个。主打维度 9（shopSupplyFactor 0.45 加关掉批发站，唯一一条进城货运干线被切断）与 11（队列与供应权重各 3）。本轮强化点：明确写成唯一货运干线，没有第二条路可选。与塌方不撞：塌方断的是山路且带清障与绕路，本场断的是隧道这条唯一干线，读点是轻货先空而不是空间或路况。"
  },
{
    id: "grid_collapse",
    name: "电网崩",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "没有时间的停电：电不按点回来，所有等着来电才能做的事都挤到同一刻",
    temperatures: {
      [0]: 9,
      [3]: 8,
      [7]: 7,
      [11]: 8,
      [14]: 9,
      [-7]: 12,
      [-4]: 11,
      [-1]: 10
    },
    spoilRate: 2.2,
    fridgeDead: true,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "medicine", "water"],
    windowScene: "no-power-city",
    shelterDecayPerDay: -2,
    restEfficiency: 0.6,
    carryFactor: 0.7,
    actionPointDelta: -1,
    shopSupplyFactor: 0.5,
    closedShopIds: ["supermarket", "gas_station"],
    priceSurcharge: 0.5,
    eventPoolWeights: {
      dark: 3,
      supply: 2,
      queue: 2
    },
    npcVisitFactor: 0.9,
    categoryEfficiency: {
      food: 0.8
    },
    capacityFactor: 0.8,
    healthRiskPerDay: 1.5,
    scoreWeights: {
      fefo: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "12°C。城区几处变电站跳闸，晚了半小时来电。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "11°C。超市的电池和蜡烛走得比平时快。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "11°C。检修车在主干线杆上待了一整天。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "10°C。几个片区轮流停电，表排得很密。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "10°C。群里说电网的备件要等外面调。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "9°C。有人把冰箱里的东西往冰柜外挪。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "9°C。夜里又停了两回，楼道里点着蜡烛。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "9°C。几座变电所同时出问题，城区大面积停。"
      },
      {
        day: 1,
        severity: 1,
        hint: "8°C。电不给时间表，只说还在抢修。"
      },
      {
        day: 2,
        severity: 1,
        hint: "8°C。冰箱化冻，肉和水产先坏。"
      },
      {
        day: 3,
        severity: 1,
        hint: "8°C。超市和加油站关门，收银也停了。"
      },
      {
        day: 4,
        severity: 1,
        hint: "8°C。有人拎着桶去取水，电梯全停了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "7°C。手机没电，联络全靠碰面。"
      },
      {
        day: 6,
        severity: 1,
        hint: "7°C。楼道里堆着接水的桶，走路要侧身。"
      },
      {
        day: 7,
        severity: 1,
        hint: "7°C。有人把没坏的菜先分吃完，不留着。"
      },
      {
        day: 8,
        severity: 1,
        hint: "8°C。药店的冷藏药也保不住了。"
      },
      {
        day: 9,
        severity: 1,
        hint: "8°C。抢修的队按片区推，先通的就是医院。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "8°C。便利店点着灯营业，只收现金。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "8°C。有一半片区来电，另一半还黑着。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "9°C。来电断断续续，一天要停好几回。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "9°C。冷柜重新插上，先扔了一批化冻的。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "9°C。电稳了些。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "停电真正的变化是取消了等一会儿这件事。平时断电都按小时算，东西可以拖到来电；这次电不给时间表，所有等电才能做的事都挤到同一刻，行动点成了最先见底的物资。",
    decisions: ["电不按点回来，冰箱里的东西是现在就集中处理还是赌它今天会来", "行动点被手电、抬水、找电占满，日常采购与整理怎么砍", "加油站与超市关门，是去更远的店还是靠现有库存撑到恢复"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14/15/16，共 16 个。主打维度 2（spoilRate 2.2，冰箱停摆让腐坏加速）与 8（actionPointDelta -1，抬水与找电把行动点吃掉）与 9（shopSupplyFactor 0.5 加关掉超市与加油站）。与地铁塌不撞：地铁塌断的是地下货运线，本场断的是电与冷藏，直接损失在存货腐坏与行动点；与大停电不撞，那是寒潮加断电的组合场，本场是孤立的电网崩溃，温度不是压力源。"
  },
{
    id: "mining_subsidence",
    name: "采空塌",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "地下的空，塌到地面来：老采空区连片下沉，裂口追着街巷走",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 9,
      [11]: 10,
      [14]: 11,
      [-7]: 13,
      [-4]: 12,
      [-1]: 11
    },
    spoilRate: 1.6,
    dailyDrain: {
      food: 1,
      medicine: 1
    },
    priorityCategories: ["tool", "medicine", "water"],
    windowScene: "caved-mine-zone",
    shelterDecayPerDay: -3,
    restEfficiency: 0.65,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.65,
    closedShopIds: ["hardware"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      supply: 2,
      people: 2,
      panic: 2
    },
    npcVisitFactor: 1,
    categoryEfficiency: {
      tool: 0.7
    },
    capacityFactor: 0.6,
    unusableShelfIds: ["shelf_a"],
    healthRiskPerDay: 1.5,
    scoreWeights: {
      placement: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "13°C。老矿区边上多了几道细缝，横在田埂上。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。有人翻出旧图，说不清哪块下面是空的。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "12°C。一口老井的水位掉了，井底见了泥。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "11°C。路边一段护栏歪了，底下是空的。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "11°C。有人量了自家地基，说比上月低了。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "10°C。社区开始登记沿线的老房子。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "10°C。夜里地底闷响了几声，人往外站了站。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "10°C。采空区连片下塌，街上裂出好几道口。"
      },
      {
        day: 1,
        severity: 1,
        hint: "9°C。裂口两侧拉起警戒线，人不让靠近。"
      },
      {
        day: 2,
        severity: 1,
        hint: "9°C。没裂的那片挤进来很多人，屋子住不下。"
      },
      {
        day: 3,
        severity: 1,
        hint: "9°C。地基在沉，架子开始往一边倒。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。修好的路第二天又裂开，没人再修。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。有人拿旧矿图对着街看，越看越怕。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。自来水时断时续，管线也歪了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。五金店的钢管和垫片先卖光。"
      },
      {
        day: 8,
        severity: 1,
        hint: "9°C。塌陷往边上扩，又有一条街划了线。"
      },
      {
        day: 9,
        severity: 1,
        hint: "9°C。有人把东西从裂口那侧搬到院子里。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "9°C。地质的队来了，开始一段段灌浆。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "10°C。灌浆把整条街围起来，进出绕远。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "10°C。灌过的那段稳住，新的裂口还在找。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "10°C。划线以内的房子不许再住人。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "11°C。塌陷慢下来了。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "采空塌陷最反常识的一点是，裂口反而是安全的。有裂缝的地方会被围起来，没人敢住；看着完好、地下同样被挖空的那片，因为看不出问题，人反而全挤过去。塌陷区里最挤的地方，往往是还没轮到塌的那块。",
    decisions: ["地面出现连片裂缝，是往没裂的片区挪还是留在原地加固", "底下还在掏空，修路的投入要不要省下来换成能随身带走的物资", "旧矿图看不清范围，选新住处时怎么判断地下有没有洞"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。主打维度 14（capacityFactor 0.6 加 shelf_a 失能，裂口把可用库位切掉）与 5（shelterDecayPerDay -3，地基持续下沉）与 15（healthRiskPerDay 1.5，塌陷带边上的持续风险）。与地震不撞：地震是一次大震后的整体失能，本场是地下空洞连片缓塌、裂口跟着街巷走；与地陷不撞，地陷是全城找不平与倾斜，本场是采空区局部塌坑与地面裂口。"
  },
{
    id: "gas_main_blast",
    name: "燃气爆",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "管网级的火，一次几十个点：爆燃沿管线成片发生，不是一栋楼烧起来",
    temperatures: {
      [0]: 13,
      [3]: 12,
      [7]: 12,
      [11]: 13,
      [14]: 14,
      [-7]: 16,
      [-4]: 15,
      [-1]: 14
    },
    spoilRate: 1.8,
    dailyDrain: {
      water: 1,
      medicine: 1
    },
    priorityCategories: ["water", "medicine", "luxury"],
    windowScene: "gas-main-blast",
    shelterDecayPerDay: -3,
    restEfficiency: 0.55,
    carryFactor: 0.65,
    actionPointDelta: -1,
    shopSupplyFactor: 0.55,
    closedShopIds: ["community_store", "weekend_flea"],
    priceSurcharge: 0.4,
    eventPoolWeights: {
      panic: 3,
      water: 2,
      neighbor: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      medicine: 0.7
    },
    capacityFactor: 0.62,
    unusableShelfIds: ["shelf_c"],
    healthRiskPerDay: 2,
    scoreWeights: {
      emergency: 3
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "16°C。有小区闻到燃气味，维修来看了一圈。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "15°C。主干管在连夜检漏，说有几处老。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "15°C。群里说调压站的压力这两天不稳。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "14°C。又有一处井盖冒气，拉了警戒线。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "14°C。检修说这段管网得整段换，来不及。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "13°C。有人把自家燃气阀关了，改用电磁炉。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "13°C。夜里一处管子漏气，整栋撤了出去。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "13°C。管网上几十个点先后爆燃，成片起火。"
      },
      {
        day: 1,
        severity: 1,
        hint: "12°C。几条街的楼被掀了顶，窗全没了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "12°C。燃气还没排空，警戒线越拉越宽。"
      },
      {
        day: 3,
        severity: 1,
        hint: "12°C。水和电一起停，救火的水接不上。"
      },
      {
        day: 4,
        severity: 1,
        hint: "12°C。离调压站近的几栋伤得最重。"
      },
      {
        day: 5,
        severity: 1,
        hint: "12°C。熏过和震过的楼，评估说先别住。"
      },
      {
        day: 6,
        severity: 1,
        hint: "12°C。药不够用，伤口感染的人多了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "12°C。有人把没坏的家当往没爆的那侧挪。"
      },
      {
        day: 8,
        severity: 1,
        hint: "13°C。管网一段段排空，进度很慢。"
      },
      {
        day: 9,
        severity: 1,
        hint: "13°C。社区店和集市全关了，没地方买东西。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "13°C。燃气公司进场换管，围挡连成一片。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "13°C。能住的楼挤了太多人，水更不够。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "13°C。部分片区通了气，重新逐户打火试。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "14°C。没通气的楼改用电磁炉，电又不够。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "14°C。警戒线撤了大半。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "燃气管网爆燃不挑楼，挑管段。同一条街上，离调压站近的几栋先炸，隔一条巷子的反而没事。哪栋楼危险这个问题没有答案，只有哪一段管子在服役有答案。",
    decisions: ["成片爆燃后水与电一起停，是先去找临时供水点还是先处理家里的存货", "燃气管网还没排空，是搬去远一点的亲戚家还是留在原地待命", "药品效率下降，常用的应急药是现在就补齐还是等路通"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。主打维度 15（healthRiskPerDay 2，爆燃后的烟尘与外伤）与 9（shopSupplyFactor 0.55 加关掉社区店与集市）与 14（capacityFactor 0.62 加 shelf_c 失能，几栋楼不能再住）。与火灾不撞：火灾是一条火线连烧推进，本场是管网级的多个独立爆点同时发生，伤的是管线沿线的楼栋；与地震不撞，地震是地动，本场是燃气泄漏引发的爆炸。"
  },
{
    id: "roof_span_collapse",
    name: "大跨塌",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "雪压塌的不是一处，是所有大跨度建筑：场馆、卖场、厂房、车站的屋顶成片落下",
    temperatures: {
      [0]: 1,
      [3]: 1,
      [7]: 2,
      [11]: 3,
      [14]: 4,
      [-7]: 4,
      [-4]: 3,
      [-1]: 2
    },
    spoilRate: 1.4,
    dailyDrain: {
      food: 1,
      warmth: 1
    },
    priorityCategories: ["tool", "warmth", "medicine"],
    windowScene: "span-roof-collapse",
    shelterDecayPerDay: -3,
    restEfficiency: 0.6,
    carryFactor: 0.55,
    actionPointDelta: -1,
    shopSupplyFactor: 0.45,
    closedShopIds: ["supermarket", "wholesale", "market"],
    priceSurcharge: 0.55,
    eventPoolWeights: {
      cold: 2,
      supply: 3,
      queue: 2
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      warmth: 0.8
    },
    capacityFactor: 0.6,
    unusableShelfIds: ["shelf_b"],
    healthRiskPerDay: 1.5,
    scoreWeights: {
      placement: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "4°C。雪下了一天一夜，屋檐挂起了冰柱。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "3°C。气象说这轮雪要下满一周。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "2°C。有场馆顶上的雪厚了一尺，没人清。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "1°C。市场的大棚被雪压得往下弯。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "1°C。车站的雨棚开始滴水，缝里渗雪水。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "1°C。有人说雪得趁早扫，别等更厚。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "1°C。夜里雪还在下，屋外一片白。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "1°C。雪压塌了成片的大跨度屋顶，一处接一处。"
      },
      {
        day: 1,
        severity: 1,
        hint: "1°C。体育馆、大卖场、批发市场的顶落了。"
      },
      {
        day: 2,
        severity: 1,
        hint: "2°C。中间的柱子少，塌得最快。"
      },
      {
        day: 3,
        severity: 1,
        hint: "2°C。货架被压在下面，进去也拿不出来。"
      },
      {
        day: 4,
        severity: 1,
        hint: "2°C。超市和批发站一起停，补货没了。"
      },
      {
        day: 5,
        severity: 1,
        hint: "2°C。小体量的店还行，就是人挤得厉害。"
      },
      {
        day: 6,
        severity: 1,
        hint: "2°C。有人在楼顶扫雪，怕下一个轮到自己。"
      },
      {
        day: 7,
        severity: 1,
        hint: "2°C。取暖的东西先涨，厚衣服也涨。"
      },
      {
        day: 8,
        severity: 1,
        hint: "2°C。清理队先清车站，卖场排在后头。"
      },
      {
        day: 9,
        severity: 1,
        hint: "3°C。雪化成水，塌过的地方开始结冰。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "3°C。有人从塌口往外刨货，多半压坏了。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "3°C。结构队开始查其余大跨屋顶的荷载。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "3°C。又有一处顶加了支撑，只让出不让进。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "4°C。雪停了，屋顶上的雪还得一点点清。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "4°C。大卖场还封着。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "雪压塌的不是民房，是那些中间没有柱子的大空间。场馆、卖场、批发市场、车站，平时是城里存货最集中的地方，也正好是最扛不住积雪的形状。塌的是屋顶，断的是货。",
    decisions: ["大跨度卖场与批发市场一起封停，是去小体量的店找替代还是靠库存撑", "屋顶还在积雪，是组织人去扫还是禁止上楼避免二次垮塌", "取暖类物资效率打折，是把预算压在燃料上还是换成更厚的衣物"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14（含 unusableShelfIds）/15/16，共 16 个。主打维度 9（shopSupplyFactor 0.45 加一次关三家大店，大跨商业建筑成片垮塌）与 14（capacityFactor 0.6 加 shelf_b 失能）与 11（cold 2 与 supply 3）。与暴雪不撞：暴雪是天气持续压低气温与出行，本场是积雪把大跨度建筑的屋顶成片压垮，直接后果在货运与仓储；与车库塌不撞，那场停的是地下整层，本场塌的是地面上大空间。"
  },
{
    id: "hub_paralysis",
    name: "货运停",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "货场与码头停了，城里的货是最后一批：进来的卸不下，出去的装不上",
    temperatures: {
      [0]: 11,
      [3]: 10,
      [7]: 10,
      [11]: 11,
      [14]: 12,
      [-7]: 14,
      [-4]: 13,
      [-1]: 12
    },
    spoilRate: 1.7,
    dailyDrain: {
      food: 1,
      water: 1
    },
    priorityCategories: ["food", "fuel", "tool"],
    windowScene: "dead-hub",
    shelterDecayPerDay: -2,
    restEfficiency: 0.7,
    carryFactor: 0.6,
    actionPointDelta: -1,
    shopSupplyFactor: 0.4,
    closedShopIds: ["wholesale", "market"],
    priceSurcharge: 0.6,
    eventPoolWeights: {
      supply: 4,
      queue: 3
    },
    npcVisitFactor: 1.1,
    categoryEfficiency: {
      food: 0.8
    },
    capacityFactor: 0.75,
    healthRiskPerDay: 1,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "14°C。货场的龙门吊出了故障，卸货慢了下来。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "13°C。码头的泊位检修，靠港的船排队。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "13°C。进城的货车在货场外排了几公里。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "12°C。有人发现货运系统的调度停了一半。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "12°C。货场只出不进，城里的补货在减。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "11°C。批发站说这周的新货要晚到。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "11°C。码头封了，船都停在锚地等。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "11°C。货场和码头一起瘫痪，进来的货卸不下。"
      },
      {
        day: 1,
        severity: 1,
        hint: "10°C。城里的货就是最后一批，卖完没补。"
      },
      {
        day: 2,
        severity: 1,
        hint: "10°C。大库房里堆着货，就是运不到店里。"
      },
      {
        day: 3,
        severity: 1,
        hint: "10°C。楼下的小店先空，大仓还满着。"
      },
      {
        day: 4,
        severity: 1,
        hint: "10°C。批发与集市关了，买菜要跑很远。"
      },
      {
        day: 5,
        severity: 1,
        hint: "10°C。货车堵在货场门口，司机不下来。"
      },
      {
        day: 6,
        severity: 1,
        hint: "10°C。价一天一个数，重货涨得最凶。"
      },
      {
        day: 7,
        severity: 1,
        hint: "10°C。有人托关系去库房门口等货。"
      },
      {
        day: 8,
        severity: 1,
        hint: "11°C。有人用小推车从货场往外倒货。"
      },
      {
        day: 9,
        severity: 1,
        hint: "11°C。耐放的先被抢，鲜货早就没了。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "11°C。吊机修好了，堆场开始一点点清。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "11°C。泊位开了一条，船按顺序靠港。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "12°C。第一批新货进城，先给了大店。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "12°C。货架的货慢慢补上，价还没落。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "12°C。货场还在清积压。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "货运枢纽一停，城里其实还有货，只是全卡在仓库和货场之间。大库房堆得满满，你家楼下的小店先空。于是这一场里最该找的不是货，是能打开那道门的关系。",
    decisions: ["货场停了，是去大库房门口等货还是把采购半径缩到步行范围", "批发与货场一起关，是提前吃进一批耐放的重货还是保持轻装", "运价与关店一起抬价，是趁现在补货还是留着现金等枢纽恢复"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/14/15/16，共 16 个。主打维度 9（shopSupplyFactor 0.4 加关掉批发与集市，枢纽停摆卡住整条货流）与 10（priceSurcharge 0.6，货到不了终端，价格由本地存量决定）与 11（supply 4 加 queue 3）。与隧道堵不撞：隧道堵断的是一条路，本场是货场与码头同时停，货在城里只是进不了终端；与塌方不撞，塌方断的是山区的进货路，本场断的是整个枢纽的接卸能力。"
  },
{
    id: "comm_tower_grid",
    name: "塔群倒",
    family: "结构",
    level: "L3",
    tier: 3,
    axis: "信息与调度一起断：手机没信号，支付、导航、叫货停在同一刻",
    temperatures: {
      [0]: 10,
      [3]: 9,
      [7]: 9,
      [11]: 10,
      [14]: 11,
      [-7]: 13,
      [-4]: 12,
      [-1]: 11
    },
    spoilRate: 1.5,
    dailyDrain: {
      food: 1
    },
    priorityCategories: ["medicine", "luxury", "food"],
    windowScene: "no-signal-city",
    shelterDecayPerDay: -1.5,
    restEfficiency: 0.7,
    carryFactor: 0.75,
    actionPointDelta: -1,
    shopSupplyFactor: 0.6,
    closedShopIds: ["gas_station", "weekend_flea"],
    priceSurcharge: 0.3,
    eventPoolWeights: {
      people: 3,
      neighbor: 2,
      queue: 2
    },
    npcVisitFactor: 1.3,
    categoryEfficiency: {
      tool: 0.8
    },
    healthRiskPerDay: 0.8,
    scoreWeights: {
      emergency: 2
    },
    calendar: [
      {
        day: -7,
        severity: 0.1,
        hint: "13°C。几个片区的手机信号时有时无。"
      },
      {
        day: -6,
        severity: 0.15,
        hint: "12°C。运营商说有几座塔的基座在松动。"
      },
      {
        day: -5,
        severity: 0.2,
        hint: "12°C。有人发现扫码付不了，改用现金。"
      },
      {
        day: -4,
        severity: 0.3,
        hint: "11°C。导航开始飘，送货的车找不到门。"
      },
      {
        day: -3,
        severity: 0.4,
        hint: "11°C。又有两座塔的拉线断了，围了起来。"
      },
      {
        day: -2,
        severity: 0.5,
        hint: "10°C。群里开始贴纸条，说有事当面讲。"
      },
      {
        day: -1,
        severity: 0.65,
        hint: "10°C。夜里信号断了大半，电话打不出去。"
      },
      {
        day: 0,
        severity: 0.9,
        hint: "10°C。成片的通信塔倒了，城区没信号。"
      },
      {
        day: 1,
        severity: 1,
        hint: "9°C。手机成了个砖头，支付和导航全停。"
      },
      {
        day: 2,
        severity: 1,
        hint: "9°C。调度的车和货都靠嘴喊，效率降了。"
      },
      {
        day: 3,
        severity: 1,
        hint: "9°C。问事只能上门，每件事都要跑一趟。"
      },
      {
        day: 4,
        severity: 1,
        hint: "9°C。人都挤到同一个开着门的地方。"
      },
      {
        day: 5,
        severity: 1,
        hint: "9°C。有人把要换的东西写在纸上贴楼道。"
      },
      {
        day: 6,
        severity: 1,
        hint: "9°C。加油要现金，没带钱的车走不了。"
      },
      {
        day: 7,
        severity: 1,
        hint: "9°C。集市的摊主只认现钱，不收扫码。"
      },
      {
        day: 8,
        severity: 1,
        hint: "10°C。补货的车找不到路，货到晚了两天。"
      },
      {
        day: 9,
        severity: 1,
        hint: "10°C。有人开始互相捎话，传一条要半天。"
      },
      {
        day: 10,
        severity: 0.95,
        hint: "10°C。通信车开进城，先保证急救调度。"
      },
      {
        day: 11,
        severity: 0.9,
        hint: "10°C。几座塔临时架起来，只覆盖几个片区。"
      },
      {
        day: 12,
        severity: 0.85,
        hint: "11°C。信号断断续续，能发消息不能打电话。"
      },
      {
        day: 13,
        severity: 0.8,
        hint: "11°C。支付慢慢恢复，扫码还是时好时坏。"
      },
      {
        day: 14,
        severity: 0.75,
        hint: "11°C。信号还没全回来。撑到今天就算过去了。"
      }
    ],
    counterIntuitive: "通信塔群倒了之后，最先出问题的不是消息，是分流。平时消息帮你把人群摊开，谁缺什么自己知道；信号一断，所有人只能朝同一个开着门的地方去。于是城里最先空的不是货，是那几个还开着的地方。",
    decisions: ["没有信号，消息靠人传，是花时间结伴去打听还是按老经验自己判断", "移动支付停摆，现金和以物换物怎么分配手上的预算", "调度断了，抢修与补货都靠现场，要不要改去更近但更小的点位"],
    notes: "用到维度 1/2/3/4/5/6/7/8/9（含 closedShopIds）/10/11/12/13/15/16，共 15 个。主打维度 12（npcVisitFactor 1.3，人被逼着碰面，来访更勤）与 8（actionPointDelta -1，每件事都要亲自跑一趟）与 11（people 3）。与地震不撞：地震是结构破坏的直接损伤，本场塔倒本身不伤人，损失落在信息、调度与支付；与社会的通信中断不撞，那场是服务与订单中断，本场是通信塔这一结构成片倒塌。"
  },
  // ═══ 生成内容 灾难-结构 止 ═══
];

const DISASTER_BY_ID: ReadonlyMap<string, DisasterProfile> = new Map(DISASTER_DEFS.map((d) => [d.id, d]));

export function getDisasterDef(disasterId: string): DisasterProfile {
  const def = DISASTER_BY_ID.get(disasterId);
  if (!def) throw new Error(`未知灾难 id: ${disasterId}`);
  return def;
}

/**
 * 这个灾难 id 认不认识。
 *
 * `getDisasterDef` 对未知 id **抛异常**，所以任何"从存档里读出来的 id"
 * 都必须先用它问一句 —— 否则一个手改过的档会在开局或结算时炸在深处。
 * 与 `hasItemDef` / `hasIdentityDef` / `hasDayEvent` 是同一套路。
 */
export function hasDisasterDef(disasterId: unknown): boolean {
  return typeof disasterId === 'string' && DISASTER_BY_ID.has(disasterId);
}

/** M1 只用寒潮，开局固定给它（§8） */
export const M1_DISASTER_ID = 'cold_snap';

/**
 * 每天的**外界温度**（°C）。服务于 §6.6 的反差层：「外界温度 vs 屋内温度，数字自己说话」。
 *
 * 为什么不从 `severity` 换算：寒潮的温度曲线**不是** severity 的线性函数 ——
 * 中间（D+1）回过一次暖（-19°C 对 0.65，而 -23°C 对 0.80），最后三天再压下去。
 * 硬换算出来的数会和日历里那句「-19°C。窗户上结了整片冰花」对不上，
 * 而玩家是会把两句话对照着读的。
 *
 * ★ **它现在读的是"当前那场灾难"的 `temperatures`，不再是写死的寒潮常量**（D-15）。
 * 这一点对 §10B 的上百场灾难是必需的：热浪的 +41°C 与寒潮的 -36°C
 * 走的是同一个读者（界面的"外界"那一栏），只是各自带着自己的曲线。
 *
 * `disasterId` 省略时按寒潮算 —— 那是 M1 唯一的灾难，也是所有老测试的口径。
 */
export function outdoorTemp(day: number, disasterId: string = M1_DISASTER_ID): number {
  const clamped = Math.max(FIRST_STOCKPILE_DAY, Math.min(SURVIVAL_DAYS, Math.round(day)));
  const temps = DISASTER_BY_ID.get(disasterId)?.temperatures;
  if (!temps) return 0;
  return temps[clamped] ?? temps[SURVIVAL_DAYS] ?? 0;
}

// ——————————————————————————————————————————————————————————————
// §10B.3.1 的 L2 影响维度：**唯一读点**
// ——————————————————————————————————————————————————————————————

/**
 * 把灾难的影响维度读成一组"带默认值的乘数"。
 *
 * 原来是"L2 那 8 维"，M3 的 5e 把 **L3 的四维（13~16）**也收了进来 ——
 * 收进来的理由是这一层存在的第二个理由（见下 ③）：**可读点唯一**。
 * L3 各维的取值口径不同（一个是按品类的映射、一个是空间乘数、
 * 一个是每日扣血、一个是评分权重），如果各自散在读点处做默认值与夹取，
 * "不写 = 中性"这条约定就会有四份实现、四份可能写错的地方。
 *
 * ## 为什么要有这层（而不是各处直接读 `disaster.carryFactor ?? 1`）
 *
 * 三条理由，每条都对应本项目踩过的坑：
 *
 *  ① **默认值只写一次。** 散着写 `?? 1` 的地方迟早会有一处写成 `?? 0`
 *     （那会让整个品类凭空消失）；
 *  ② **防御坏值。** 存档可以被手改、灾难表将来可以来自数据甚至 mod，
 *     一个 `NaN` 乘数会污染整份存档（M2 的 D-20 就是这么来的）。
 *     这里统一做 `Number.isFinite` + 区间夹取；
 *  ③ **可读点唯一。** 加一个维度时只需要在类型里加字段、在这里加一行、
 *     在**一个**调用点接上 —— 而不是全项目搜"哪里该改"。
 *
 * ★ 约定：**不写 = 这一维在这场上不起作用**（乘数 1 / 增量 0），
 * 而不是"值等于 1"。寒潮不写这些字段是有意义的 —— 它真的没有这些影响。
 */
export interface DisasterModifiers {
  /** 屋子每天额外掉的庇护所（≤ 0） */
  shelterDecayPerDay: number;
  /** 睡觉回体力的乘数 */
  restEfficiency: number;
  /** 单趟搬运上限的乘数 */
  carryFactor: number;
  /** 每天行动点增减 */
  actionPointDelta: number;
  /** 商店库存乘数 */
  shopSupplyFactor: number;
  /** 关掉的点位 */
  closedShopIds: readonly string[];
  /** 全局涨价加成 */
  priceSurcharge: number;
  /** 事件池权重 */
  eventPoolWeights: Readonly<Record<string, number>>;
  /** 有人来敲门的概率乘数 */
  npcVisitFactor: number;

  // ———————— §10B.3.1 的 L3 影响维度（第 13~16 维） ————————
  /** 每件东西在这一场更管用 / 更不管用（按品类；只列想改的那些，其余是 1） */
  categoryEfficiency: Readonly<Partial<Record<CategoryId, number>>>;
  /** 可用空间的乘数（0.8 = 低处那一成格子用不了）。读点：`systems/setup.ts` 铺货架时 */
  capacityFactor: number;
  /** 这一场用不了的家具（按 `Shelf.id`）。与 `capacityFactor` 是两个粒度 */
  unusableShelfIds: readonly string[];
  /** 硬扛的代价：每天不看玩家做了什么就扣这么多健康（0~3）。读点：`systems/survival.ts` 的日结算 */
  healthRiskPerDay: number;
  /** 评分口径：这一局看什么（键是 `model/score.ts` 的分项名，默认权重 1） */
  scoreWeights: Readonly<Record<string, number>>;
}

const IDENTITY_MODIFIERS: DisasterModifiers = {
  shelterDecayPerDay: 0,
  restEfficiency: 1,
  carryFactor: 1,
  actionPointDelta: 0,
  shopSupplyFactor: 1,
  closedShopIds: [],
  priceSurcharge: 0,
  eventPoolWeights: {},
  npcVisitFactor: 1,
  categoryEfficiency: {},
  capacityFactor: 1,
  unusableShelfIds: [],
  healthRiskPerDay: 0,
  scoreWeights: {}
};

/** 夹取一个乘数；认不出就退回默认值。`lo`/`hi` 是设计区间，防手改档与生成离群值 */
function factor(value: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(lo, Math.min(hi, value));
}

/**
 * 当前这一场的 L2 影响维度。
 *
 * `disasterId` 认不出（例如手改过的档）时返回一整套中性值 ——
 * **灾难不认识不该让游戏崩**，而"没有额外影响"是最保守的退路。
 */
export function disasterModifiersOf(disasterId: string | undefined): DisasterModifiers {
  const def = disasterId ? DISASTER_BY_ID.get(disasterId) : undefined;
  if (!def) return IDENTITY_MODIFIERS;
  const closed = Array.isArray(def.closedShopIds) ? def.closedShopIds.filter((s) => typeof s === 'string') : [];
  const unusable = Array.isArray(def.unusableShelfIds)
    ? def.unusableShelfIds.filter((s) => typeof s === 'string')
    : [];
  const weights: Record<string, number> = {};
  if (def.eventPoolWeights && typeof def.eventPoolWeights === 'object') {
    for (const [tag, w] of Object.entries(def.eventPoolWeights)) {
      const v = factor(w, 1, 0, 10);
      if (v !== 1) weights[tag] = v;
    }
  }
  /*
   * 品类效率（维度 13）：逐品类夹到 [0.5, 1.5]，且**只留下真正改了的那些**。
   *
   * "只留非 1 的"与 `eventPoolWeights` 同一个做法：让"这一场动了哪几个品类"
   * 一眼可数（维度签名读的就是这份结果）。
   */
  const efficiency: Partial<Record<CategoryId, number>> = {};
  if (def.categoryEfficiency && typeof def.categoryEfficiency === 'object') {
    for (const [category, value] of Object.entries(def.categoryEfficiency)) {
      const v = factor(value, 1, 0.5, 1.5);
      if (v !== 1) efficiency[category as CategoryId] = v;
    }
  }
  /** 评分权重：只留非 1 的，理由同品类效率 */
  const scoreWeights: Record<string, number> = {};
  if (def.scoreWeights && typeof def.scoreWeights === 'object') {
    for (const [key, value] of Object.entries(def.scoreWeights)) {
      const v = factor(value, 1, 0, 10);
      if (v !== 1) scoreWeights[key] = v;
    }
  }
  return {
    // 庇护所衰减只取"更坏"的方向：正数会让灾难变成修房子，那不是这个字段的语义
    shelterDecayPerDay: Math.min(0, factor(def.shelterDecayPerDay, 0, -4, 0)),
    restEfficiency: factor(def.restEfficiency, 1, 0.4, 1.2),
    carryFactor: factor(def.carryFactor, 1, 0.5, 1),
    actionPointDelta: Math.round(factor(def.actionPointDelta, 0, -1, 1)),
    shopSupplyFactor: factor(def.shopSupplyFactor, 1, 0.4, 1),
    closedShopIds: closed,
    priceSurcharge: factor(def.priceSurcharge, 0, 0, 0.8),
    eventPoolWeights: weights,
    npcVisitFactor: factor(def.npcVisitFactor, 1, 0, 1.5),
    // ———— L3（13~16） ————
    categoryEfficiency: efficiency,
    /*
     * 空间只取"更小"的方向（≤ 1）：一个 > 1 的空间乘数等于"这一场屋子变大了"，
     * 而那是**奖励** —— 灾难不该发奖励。要表达"这一场屋子更大"请用 tier 与身份，
     * 不要用灾难字段（§10B.0 的主轴是"更大的空间才是奖励"，
     * 但那个奖励来自元进程，不是来自灾难表）。
     */
    capacityFactor: factor(def.capacityFactor, 1, 0.5, 1),
    unusableShelfIds: unusable,
    /*
     * 健康风险上限写 **3**：设计上它是"硬扛的代价"，不是"这一局结束得有多快"。
     * 3 分 × 14 天 = 42 点健康，那已经是"整局都在漏血"的强度了；
     * 再高就不是难度，而是替玩家把这一局判掉（§12.3：代价都可逆、都能爬回来）。
     */
    healthRiskPerDay: factor(def.healthRiskPerDay, 0, 0, 3),
    scoreWeights
  };
}
