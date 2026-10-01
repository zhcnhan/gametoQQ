/**
 * 全部数据模型定义 —— 直接采用策划案 §7，逐字对应。
 * 唯一改动：RunState 增加 `seed`（提示词 0 硬性要求"seed 存进存档"，§7 遗漏）。
 *
 * 本文件属于 model/，必须是纯类型/纯逻辑，不碰任何浏览器 API（DOM、定时器、音频）。
 */

// ============ 静态表（data/ 的静态表都用这里的类型） ============

export type CategoryId = 'food' | 'water' | 'medicine' | 'fuel' | 'warmth' | 'tool' | 'luxury';

export interface ItemDef {
  id: string; // 'canned_beans'
  name: string; // '黄豆罐头'
  category: CategoryId;
  icon: string; // emoji 或 svg key
  unitWeight: number; // kg/件
  slotSize: number; // 占用槽位数（1=小件, 2=大瓶, 4=整袋米）
  stackLimit: number; // 单槽堆叠上限
  perishable: boolean;
  shelfLifeDays?: number; // 保质期（perishable=true 必填）
  nutrition: Partial<{ food: number; water: number; health: number; comfort: number }>;
  basePrice: number;
  tags: string[]; // 供玩家分区规则引用：'canned','drink','medkit'...
}

export interface DisasterProfile {
  id: 'cold_snap' | 'heat_wave' | 'flood' | 'epidemic';
  name: string;
  calendar: DayForecast[]; // 先知日历：逐日强度曲线
  dailyDrain: Partial<Record<CategoryId, number>>; // 每日额外消耗权重
  priorityCategories: CategoryId[]; // 寒潮→['fuel','warmth']
  windowScene: string; // 窗外渲染主题 key
  /**
   * 灾难期腐坏倍率 —— 相对策划案 §7 的**新增字段**，理由见 src/meta/deferred.ts 的 D-03。
   *
   *   1   = 真实保质期，不动
   *   > 1 = 加速腐坏（过一天算更多天，寿命变短）—— 热浪 / 洪水 / 疫情
   *   < 1 = 延长（过一天算更少天，寿命变长）—— 寒潮：室外本身就是冷库
   *
   * 只在 `day >= 0`（灾难已登陆）时生效；囤货期永远是真实速度。
   * 用**必填**而不是可选：将来加进第 2、第 3 个灾难时，忘记想"这场怎么处理腐坏"
   * 会直接编译不过 —— 这条设计决定（"腐坏是灾难的属性"）需要被类型系统记住。
   */
  spoilRate: number;
}

export interface DayForecast {
  day: number;
  severity: number;
  hint: string;
}

/**
 * 身份天赋规则（相对 §7 的一处新增，理由）：
 * §7 的 `perk` 是 string，例如 '加油站夜班：燃料价格 -20%' —— 那是写给策划案读者看的注释，
 * 不是可执行的规则，systems/ 没法据此算折扣。要让天平真的倾斜就必须结构化。
 * 处理：`perk` 原样保留（继续当 UI 展示文案），另加 `perkRule` 给 systems 执行。
 */
export type PerkRule =
  | { kind: 'none' }
  /** 指定品类打折：rate = 0.15 表示便宜 15% */
  | { kind: 'categoryDiscount'; categories: CategoryId[]; rate: number };

export interface IdentityDef {
  // 随机身份
  id: string;
  name: string;
  /** 一句话人设，开局卡上显示 */
  tagline: string;
  startCash: number;
  vehicleCapacity: number;
  /**
   * 单趟手提上限（kg）—— 相对 §7 的新增，理由：
   * §6.2 的"三约束"点名了「背负重」，但 §7 的 IdentityDef 只给了 vehicleCapacity，落不了地。
   * 按已拍板的分工：carryLimit 决定"一次能从货架搬多少上车"（0 行动点，纯物理闸门），
   * vehicleCapacity 决定"这一整天总共能带回家多少"。
   */
  carryLimit: number;
  perk: string; // '加油站夜班：燃料价格 -20%'
  perkRule: PerkRule;
}

export interface NpcDef {
  id: string;
  name: string;
  archetype: string; // '楼上王阿姨'
  requestPool: string[]; // 求援订单模板 id 列表
}

export interface HelpRequestDef {
  // 订单模板
  id: string;
  demands: { itemId: string; count: number }[];
  validUntilDay: number; // 当日有效，不用实时秒表（见 §4A）
  rewards: { trust?: number; intel?: string; barter?: { itemId: string; count: number }[] };
  declineTrust: number; // 婉拒的关系变化（负值）
}

/** 囤货期点位（§6.2：MVP 取 3 个 —— 超市 / 药店 / 五金店） */
export type ShopId = 'supermarket' | 'pharmacy' | 'hardware';

export interface ShopOfferDef {
  itemId: string;
  /** 库存基数：当天实际库存会在 base±1 之间种子化抖动 */
  stock: number;
}

export interface ShopDef {
  id: ShopId;
  name: string;
  /** 一句话点位描述（点位列表上显示） */
  blurb: string;
  /** 价格系数：同一件物资在五金店比超市贵 */
  priceFactor: number;
  offers: ShopOfferDef[];
}

// ============ 运行时状态（model/） ============

/**
 * 某点位"今天"的一行货（种子化生成后落盘）。
 * 为什么必须落盘而不是每次现算：库存要在玩家回家整理、刷新页面之后仍然是同一批 ——
 * 现算会让 RNG 游标被渲染/刷新次数影响，"同 seed 同结果"当场失效。
 */
export interface ShopStockLine {
  itemId: string;
  /** 当天单价（已含点位系数与身份折扣） */
  price: number;
  /** 今天还剩几件 */
  stock: number;
}

export interface ShopDayStock {
  shopId: string;
  /** 这份库存属于哪一天（囤货期为负），用于读档后校验是否该换天 */
  day: number;
  lines: ShopStockLine[];
}

export interface ItemBatch {
  /**
   * 到期日（绝对天）。null = 不易腐。
   *
   * 它在阶段 C 有了真正的消费者：`model/spoil.ts` 把日历天换算成"腐坏意义上的虚拟天"
   * 再和这里比。换算倍率来自 `DisasterProfile.spoilRate` —— 所以"什么时候会坏"
   * 是**灾难**说了算，不是物资本身（这条立场的完整说明见 src/meta/deferred.ts 的 D-03）。
   */
  expiresAtDay: number | null;
  count: number;
}

export interface ItemStack {
  itemId: string;
  batches: ItemBatch[]; // 按批次记录保质期，FEFO 取 batches[0]
}

/**
 * 待拆箱（相对 §7 的 `boxesToUnpack: ItemStack[][]` 的一处模型变更，理由如下）：
 * §7 用"二维数组 + 下标"当箱子身份，一旦空箱被摘除，后面所有箱子的下标全部位移 ——
 * 玩家手里那件物资的"来处"就会指向另一个箱子（串箱），"放回原处"必然放错。
 * 而且 M1 采购要按箱型补货（同一天可能补两批同型箱），也必须区分"箱型"与"这一箱"。
 * 故：箱子升级为带稳定 id + 箱型 defId 的对象。
 */
export interface UnpackBox {
  id: string; // 'box_1'，整局唯一且不随摘箱变化
  defId: string; // 箱型：data/boxes.ts 的 BoxDef.id
  items: ItemStack[]; // items[0] 是下一个被摸出来的
}

export interface Slot {
  stack: ItemStack | null;
}

export interface Zone {
  // ★ 引擎1核心：玩家自定义分区
  id: string;
  name: string; // 玩家命名
  color: string;
  autoAccept?: { categories?: CategoryId[]; tags?: string[] }; // 可选规则
}

export interface Shelf {
  id: string;
  roomId: string;
  /**
   * DEFERRED(D-02): `kind` 目前**只被文案读**（"冰箱 C"、"放回 冰箱 原位"），
   * 没有任何玩法逻辑依赖它。§8 写的「冰箱 1 个（腐坏减速）」要等阶段 C 才有落点，
   * 而它真正有意义还要等到 M3 出现热浪这种"会让食物烂掉"的灾难。
   */
  kind: 'shelf' | 'fridge' | 'cabinet' | 'floor';
  w: number;
  h: number; // 格子矩阵
  slots: Slot[][]; // [row][col]
  zoneId: string | null;

  /**
   * 「顺手位」标记：`1` = 门口那块（伸手就够到），`null` = 普通货架。
   * **全屋唯一**（§12.3 v0.7.1 玩家拍板）——标第二块时旧的那块自动让位，
   * 不存在"次顺手"。字段保留 number 类型是为存档兼容与 `HANDY_SLOTS` 的统一钳制。
   *
   * ★ 这里清偿了 D-06。§5 写的是「应急货架（门口 / 最顺手位）放急救品」，而"门口"是
   * 玩家心里的一个位置，不是一个由系统派发的数值 —— 所以落地方式不是给货架写死一个
   * `accessRank: 0.8`，而是**让玩家自己指认哪一块是顺手位**。
   *
   * 为什么是"标记"而不是"拖动排序"：整理页的货架是网格，长按拖动会和滚动打架，
   * 而 §4A 要求每一个动作都能被中途打断。"点一下把它标成顺手位"说的是同一件事，
   * 却不需要一个新手势。
   */
  handyRank: number | null;
}

export type GamePhase =
  | 'prologue' // 开局三选一身份 + 灾难揭晓
  | 'stockpile_shop' // 囤货期：外出扫货
  | 'organize' // 囤货期：回家整理（禅）
  | 'night' // 夜间事件
  | 'survival_day' // 生存期：每日结算 + 事件
  | 'help_request' // 求援订单弹窗
  | 'ending'; // 结算

// ============ 夜间事件（§6.2「夜间小事件」） ============

/**
 * 一个选项的数值后果。全部字段可选 —— 因为**"什么都不做"必须是一条合法路径**
 * （§4A：玩家随时可能被领导叫走，不允许有任何强制选择）。
 */
export interface NightEffect {
  cash?: number;
  health?: number;
  mood?: number;
  stamina?: number;
  shelter?: number;
  /** 顺手带回家的一箱货（箱型 id，见 data/boxes.ts）。会用当前天算批次到期日 */
  boxDefId?: string;
}

/**
 * 选项**实际**生效的后果（不是它声明的那些）。
 *
 * 两个数字会不一样，而且这是刻意的：现金支出走"有多少给多少"（见 `applyNightEffect`），
 * 所以「转他 80」落在一个只有 25 元的人身上，只扣 25。
 * 摘要与结果文案必须报**真数** —— 否则界面会告诉玩家一件根本没发生的事，这比数值本身更糟。
 */
export interface AppliedEffect {
  cash: number;
  health: number;
  mood: number;
  stamina: number;
  shelter: number;
  gotBox: boolean;
}

export interface NightOption {
  /** 按钮上的字。手机竖屏，一行放得下为准（≤ 8 字） */
  label: string;
  /**
   * 选完那一刻看到的一句话，说清发生了什么。不许有台词腔（§11）。
   *
   * 可以写 `{spentCash}` —— 它会被替换成**实际花掉的现金**（正数）。
   * 例：「你转过去 {spentCash}。他回了一串谢谢。」
   * 这是唯一一个占位符，因为现金是唯一一个"声明值可能不等于实际值"的字段。
   */
  outcome: string;
  effect: NightEffect;
  /**
   * 这个选项必须**给得起钱**才成立（买货那一类）。
   * 不写 = 有多少给多少（人情那一类）：钱不够时照样执行，只是结果文案会说出真相。
   */
  requireFullCash?: boolean;
}

export interface NightEventDef {
  id: string;
  /** 睡前读到的处境，1~2 句 */
  text: string;
  options: NightOption[];
}

/**
 * 今晚的状态。
 * `choice === null` = 还在选；`NIGHT_SLEEP`（见 data/nightEvents.ts）= 直接睡；其余为 options 下标。
 */
export interface NightState {
  eventId: string;
  choice: number | null;
  /**
   * 决定之后填：这一晚**实际**发生了什么。
   *
   * 落盘的理由是 §4A：刷新回来要能复现"你已经决定过、结果是这样"，
   * 而不是按选项声明的数值重算一遍 —— 那样会算错（见 `AppliedEffect` 的注释）。
   */
  applied: AppliedEffect | null;
}

/**
 * 硬撑的档位（§12.3 v0.6）。
 *
 * 分档的理由：连续硬撑的第 1 天和第 5 天不是一回事。不分档的话，玩家看到的只是一个
 * 恒定的"每天掉几点"，既看不出自己正在下沉，也不知道再不好转会怎样。
 * 具体的代价表在 data/survival.ts 的 `HARD_PRESS_TIERS`。
 */
export type HardPressLevel = 'none' | 'straining' | 'failing' | 'collapsing';

/** 最近一次生存期结算的快照（"今天发生了什么"）。下一次结算覆盖它 */
export interface SurvivalSnapshot {
  health: number;
  mood: number;
  stamina: number;
  shelter: number;
  /** 今天的缺口件数（0 = 全都吃上了） */
  shortage: number;
  /** 今天坏掉的件数 */
  spoiled: number;
  /**
   * 今天的取用是从哪儿翻出来的。
   *
   * `fromBoxes > 0` 只有一个意思：**货架上不够了**，只能去撕还没拆的纸箱。
   * 这是"没整理"在日报上唯一看得见的一行 —— §5 说整理决定的是"活得漂亮"而不是
   * "能不能活"，所以它的形式是**数字**，不是惩罚（策划案 §5 引擎①：游戏不评判对错）。
   */
  fromShelves: number;
  fromBoxes: number;
  /**
   * 有货、但今天**没力气翻到**的件数（体力跌破 `EXHAUSTED_STAMINA` 时才会出现）。
   *
   * 与 `shortage` 分开记是必须的：一个是"屋里没有"，一个是"有却拿不动"，
   * 界面要说清是哪一种，玩家才知道明天该拆箱还是该歇着。
   */
  unreachable: number;
  /** 今天的翻找劳作吃掉了多少体力（正数 = 消耗）。整理质量越差这个数越大（§6.4「乱 → 翻找耗时」） */
  workCost: number;
  /** 今天是不是在硬撑（体力 / 健康 / 心情跌破线，见 data/survival.ts 的三条阈值） */
  hardPress: boolean;
  /** 今天是硬撑里的哪一档（`'none'` = 没在硬撑）。界面按它决定说"硬撑"还是"快垮了" */
  hardPressLevel: HardPressLevel;
  /** 今天自动用掉的补给件数（0 = 没动）。医疗 → 健康，保暖 → 庇护所 */
  usedMedicine: number;
  usedWarmth: number;
}

/** 生存期累计账（阶段 C）。结算页（阶段 E）要用，所以必须落盘，不能只活在内存里 */
export interface SurvivalState {
  /** 累计腐坏损耗（件） */
  spoiled: number;
  /** 累计"没能凑齐当天消耗"的天数。**结算页不再显示它**，改用下面的 shortagePieces */
  shortageDays: number;
  /**
   * 累计短了多少件口粮（**真的没有**，不含"有货但拿不动"）。
   *
   * 为什么需要它，而不是只用上面的天数：天数的粒度太粗 —— 缺 1 件和缺 5 件都记成一天，
   * 于是"7 天里有 7 天短了口粮"读起来像"七天没吃上饭"，而实际上可能只是每天少半瓶水。
   * 件数才是玩家能对上账的那个数。
   */
  shortagePieces: number;
  /**
   * 累计"有货、但没力气翻出来"的件数。
   *
   * 刻意与 `shortagePieces` 分开：一个是**没囤够**，一个是**没整理**。
   * 混在一起的话，结算页就说不清这一局到底栽在哪 —— 而"栽在哪"正是它唯一该回答的问题。
   */
  unreachablePieces: number;
  /**
   * 累计"在硬撑"的天数。结算页读它给评语（0 天 = 从容，接近全程 = 一路硬撑）。
   * 单独记一个累计值而不是每次回扫 `run.log`：日志是给人看的，不是查询用的。
   */
  hardPressDays: number;
  /**
   * **连续**硬撑的天数（好转的第二天就归零）。
   *
   * 与上面的累计值是两件事：累计值回答"这一局过得怎么样"，连续值回答
   * "你现在掉到哪一档了" —— 档位只看连续值，因为"硬撑一下就好"和
   * "已经第五天爬不起来"对身体的含义完全不同。
   */
  hardPressStreak: number;
  /**
   * 上一次"以物易物"发生在第几天（`-99` = 从来没换过）。
   *
   * 它只用来限制频率（每 2 天一次），不是玩法数值 —— 所以不从 `run.log` 里反查：
   * 日志是给人看的，不是查询用的。
   */
  lastTradeDay: number;
  /**
   * 最近一次结算的增量。
   * 落盘的理由是 §4A「恢复即续玩」：刷新回来必须还能看见"今天掉了哪些点"，
   * 否则玩家只能靠记忆对比昨天和今天的四维，而那个对比正是生存期的全部张力。
   */
  last: SurvivalSnapshot;
}

/**
 * 今天的求援订单（§6.5）。
 *
 * 刻意只有 `defId` 一个字段 —— 结果（交付 / 婉拒 / 凑不齐）当场就落成了
 * `trust`、库存与日志，不需要再存一份"刚才发生了什么"。
 * 多存一份状态，就多一处可能与事实不符的地方。
 */
export interface HelpRequestState {
  defId: string;
}

export interface RunState {
  // 当局存档
  phase: GamePhase;
  /**
   * 囤货期为负（-7..-1，M1 的 7 天），0 = D-Day（灾难降临日，只演出不操作），生存期为 1..7。
   * M0 的旧档把 day 恒写成 0 表示"整理中"，迁移时按"囤货期最后一天"处理（v3 → v4）。
   */
  day: number;
  identityId: string;
  disasterId: string;
  cash: number;
  shelves: Shelf[];
  zones: Zone[];
  boxesToUnpack: UnpackBox[]; // 待拆箱队列（引擎3）
  stats: { health: number; mood: number; stamina: number; shelter: number };
  trust: Record<string, number>; // npcId → 关系值
  deliveredOrders: number;
  log: string[]; // 日报流水（每条自带 'D-7 · ' 前缀，阶段 E 的日报按前缀分组）

  /** 种子游标：一切随机都从这里续着往下走（提示词 0 硬性要求 seed 落盘） */
  seed: number;

  // ———————— M1 囤货期（阶段 A） ————————

  /** 当天剩余行动点（每天重置为 ACTION_POINTS_PER_DAY） */
  actionPoints: number;
  /**
   * 当天已经"搬上车"的总重量（kg）—— 受车载容量约束，回家时清零。
   * 注意它与 boxesToUnpack 不冗余：箱子是"已经买到的货"，carLoad 只回答"今天还能再装几公斤"。
   */
  carLoad: number;
  /** 当天各点位的库存快照（种子化生成，随存档落盘） */
  shopStocks: ShopDayStock[];
  /** 今天已经进过哪几个店门（只用于界面标记"今天去过了"，不禁止再去） */
  visitedShopIds: string[];
  /**
   * 正站在哪个点位的货架前（null = 在外面的点位列表上）。
   * 落盘的理由是 §4A「恢复即续玩」：刷新后必须回到同一个货架前，而不是退回点位列表让玩家再点一次。
   */
  currentShopId: string | null;

  // ———————— M1 夜间（阶段 B） ————————

  /**
   * 今晚的夜间事件（§6.2）。
   * `null` = 今晚没事 —— 包括"还没入夜"与"今晚抽空了"两种情况，因为
   * "此刻是否在夜里"由 `phase === 'night'` 负责，这个字段只回答"今晚是哪件事、选到哪一步了"。
   */
  night: NightState | null;

  // ———————— M1 生存期（阶段 C） ————————

  /**
   * 生存期累计账。
   * 刻意**不**存"今天是否已结算"—— 结算只发生在 `startSurvival` / `advanceSurvivalDay`
   * 这两个命令内部（day 一变就结算一次），所以重复点、刷新、读档都不会重算。
   * 用状态而不是标志位来保证幂等，比多存一个布尔量可靠。
   */
  survival: SurvivalState;

  // ———————— M1 求援订单（阶段 D，§6.5） ————————

  /**
   * 今天门口站着谁（`null` = 今天没人来）。
   *
   * 用 `phase === 'help_request'` 表示"正在处理"，用这个字段表示"来处理的是哪一单"。
   * 分开的理由与 `night` 完全一样：刷新回来要精确恢复成"第 N 天 + 王阿姨站在门口"，
   * 而不是退回日报、让玩家再等一次门响。
   */
  helpRequest: HelpRequestState | null;

  // ———————— M1 结局（平衡改造，§12.3 v0.5 修订） ————————

  /**
   * 这一局是怎么结束的。`null` = 还没结束。
   *
   *  - `'survived'`  = 撑满了 `SURVIVAL_DAYS` 天
   *  - `'collapsed'` = 健康归零，没撑住
   *
   * 必须落盘而不是从 `day` 推：撑满 7 天和"第 7 天倒下"的 `day` 都是 7，
   * 没有这个字段就分不出两种结局，结算页会给出完全相反的评语。
   */
  outcome: 'survived' | 'collapsed' | null;
}

export interface MetaProfile {
  // 跨局存档
  version: number;
  identityLevels: Record<string, number>;
  codex: { items: string[]; disasters: string[]; npcs: string[] };
  bestSurvivalDays: Record<string, number>; // 每灾难最佳纪录
}

export interface SaveGame {
  meta: MetaProfile;
  run: RunState | null;
  // —— 云备份（§4A）——
  savedAt: number; // 本地最后写入时间戳
  syncVersion: number; // 单调递增，云端冲突时取大者
  deviceId: string; // 匿名设备标识，迁移码绑定用
}

// ============ 位置辅助类型（纯逻辑用，非存档结构） ============

export interface SlotPos {
  row: number;
  col: number;
}
