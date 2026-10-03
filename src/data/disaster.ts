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
import type { CategoryId, DayForecast, DisasterProfile } from '../model/types';

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
     * DEFERRED(D-03): 这条设计有一个直接后果 —— **M1 全程不会发生任何腐坏**。
     * 于是「临期优先」百分比、冰箱、以及日报里的损耗行，在当前里程碑里全是装饰。
     * 这是玩家明确拍板的（"寒潮延长保质期，腐坏压力交给未来的灾难"），
     * 不是漏做 —— 所以任何人都不许"顺手把它改成 1 让数字好看一点"。
     * `spoilRate` 真正的用武之地是 M3 的热浪（>1，会让粮仓变成坟场）。
     */
    spoilRate: 0.5
  },
  // ═══ 生成内容 disaster-00 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
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
  // ═══ 生成内容 disaster-00 止 ═══
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
