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
  /**
   * 灾难 id。
   *
   * ## ★ 为什么从字面量联合类型改成了 `string`（与 `ShopId` 同一条理由）
   *
   * 原来是 `'cold_snap' | 'heat_wave' | 'flood' | 'epidemic'` ——
   * 它顺便限制了"最多 4 场灾难"，而 §10B 要把灾难扩到 **12~16 场**。
   * 每加一场都要改这个类型 = 违背"加内容 = 加一行数据"。
   *
   * 约束改由两道守：`data/disaster.ts` 的 `hasDisasterDef()`（运行期，
   * 存档自愈用它）+ `scripts/check-content.mjs`（构建期）。
   */
  id: string;
  name: string;
  calendar: DayForecast[]; // 先知日历：逐日强度曲线
  dailyDrain: Partial<Record<CategoryId, number>>; // 每日额外消耗权重
  /**
   * 逐日**外界温度**（°C）。**必填**，理由是 D-15：
   *
   * 它原来是一张写死在 `data/disaster.ts` 里的 `COLD_SNAP_TEMPS` 常量表，
   * 只覆盖寒潮 —— 于是"再加一场灾难"就必须再写一张表，而"加内容 = 加一行数据"
   * 这条规矩当场失效（D-15 记的就是这件事）。
   *
   * 挪进 `DisasterProfile` 之后，**每一场灾难自带自己的温度曲线**，
   * 而这正是 §6.6 反差层要的东西：寒潮的 -30 与热浪的 +41 是同一套渲染的两个极端。
   *
   * 用**必填**而不是可选，与 `spoilRate` 同一个理由：
   * 加第 2 场灾难时忘记想"这场外界是什么温度"会直接编译不过。
   */
  temperatures: Record<number, number>;
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
  /**
   * 每年/每天/每秒的腐坏倍率。
   *
   * 只在 `day >= 0`（灾难已登陆）时生效；囤货期永远是真实速度。
   */
  spoilRate: number;

  // ———————— §10B.3.1 的 L2 影响维度（全部可选，不写 = 1 / 0） ————————
  /*
   * ## 为什么这些字段必须是"可选 + 默认 1"而不是必填
   *
   * 寒潮（唯一的存量灾难）不需要它们 —— 强制必填会逼着给寒潮编一堆 1，
   * 而那些 1 会掩盖"寒潮真的没有这条影响"这个事实。
   * 所以：**不写 = 这一维在这场上不起作用**，而不是"值等于 1"。
   *
   * ## 为什么它们值得存在（用户的原话）
   *
   * "灾难是要跟其他所有一切做衔接的……多角度全方位影响的。"
   * 只靠消耗/腐坏/刚需/温度那 4 维，一百场灾难会写成"十二种 × 八种数值"。
   * 这 8 个字段把灾难从"数字变了"推进到"**生活方式变了**"：
   * 屋子坏得更快、睡不安稳、搬得更少、门开得少、什么都贵、碰上的人不一样。
   *
   * 每一项都标了它在代码里的**唯一读点** —— 加维度时照着那个点接就行，
   * 不要在多处各算一份（那正是"两份状态各自漂移"的老毛病）。
   */

  /** 屋子每天额外掉多少庇护所（负数 = 更坏）。读点：`systems/survival.ts` 的日结算 */
  shelterDecayPerDay?: number;
  /** 睡觉回复体力的**乘数**（0.6 = 只回六成）。读点：`data/survival.ts` 的 `sleepRecoverAt` */
  restEfficiency?: number;
  /** 单趟搬运上限的**乘数**（0.7 = 高温/风雪里一趟少提三成）。读点：`systems/shop.ts` 的 `buildCartView` */
  carryFactor?: number;
  /** 每天行动点增减（-1 = 天黑得早，一天少做一件事）。读点：`systems/phases.ts` 的 `endDay` */
  actionPointDelta?: number;
  /** 商店库存乘数（0.5 = 大半货架空着）。读点：`systems/shop.ts` 的 `rollShopStocks` */
  shopSupplyFactor?: number;
  /** 这一场关掉的点位（不开门）。读点：`systems/shop.ts` 的 `rollShopStocks` 与界面 */
  closedShopIds?: string[];
  /** 全局涨价加成（0.35 = 本来就贵三成五）。读点：`systems/shop.ts` 的 `rollShopStocks` */
  priceSurcharge?: number;
  /**
   * 事件池权重：`{ 标签: 倍数 }`。读点：`systems/shop.ts` 的 `rollDayEvent`。
   *
   * 它让"这一场会碰上什么事"跟着灾难走（寒潮多"冷"、骚乱多"人"）。
   * 没写标签的事件按 1 倍算 —— 所以只写想强调的那几个标签就行。
   */
  eventPoolWeights?: Record<string, number>;
  /** 有人来敲门的概率乘数（1.3 = 邻居来得更勤）。读点：`systems/help.ts` 的 `rollHelpRequest` */
  npcVisitFactor?: number;
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

/**
 * 囤货期点位 id。
 *
 * ## ★ 为什么从字面量联合类型改成了 `string`（§10B：内容要能海量扩展）
 *
 * 原来是 `'supermarket' | 'pharmacy' | 'hardware'`。那在只有 3 家店时是优点
 * （拼错 id 编译不过），但 §10B 要把点位扩到十几个（农贸市场 / 加油站 / 母婴店 /
 * 五金批发 / 黑市 / 诊所 / 学校 / 药房仓库……），**每加一家都要来改这个类型** ——
 * 那就违背了"加内容 = 加一行数据，不动代码"这条从 M0 起就立着的规矩
 * （见 `src/data/shops.ts` 文件头与 §10B.5）。
 *
 * 换成 `string` 之后，**约束改由两道守住**：
 *  ① `data/shops.ts` 的 `isShopId()` —— 运行期的真相来源（存档自愈要用它）；
 *  ② `scripts/check-content.mjs` —— 构建期的静态校验（悬空引用要在提交前拦住）。
 *
 * ★ 这不是"放松类型"，是**把校验从编译器搬到更合适的地方**：
 * 编译器只能管"代码里写死的字面量"，而店铺将来会是**数据**（甚至来自 mod），
 * 那种 id 编译器本来就管不到。
 */
export type ShopId = string;

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
  /**
   * 进这家店花几点行动点。不写 = 1（§6.2 的原口径：1 行动点 = 进一个店门）。
   *
   * §10B 要扩点位，而"多一家店"如果只是"多一个能买同样东西的地方"，
   * 那它只是多一次点击。让远的地方（郊区仓库 / 批发市场 / 黑市）
   * **花 2 点但更便宜**，"跑几个点位"的取舍才继续成立。
   */
  actionCost?: number;
  /**
   * 这家店**最划算**的品类/标签（用于界面提示与内容校验时的自查）。
   *
   * §6.2 的设计口径是"点位之间必须不重合"，否则行动点设计塌掉。
   * 把"我的专长是什么"写成数据，是为了让 `check-content.mjs` 能查出
   * "新加这家店和另一家完全重合"——那种店是纯冗余。
   */
  specialty?: string[];
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

/**
 * 一块家具（货架 / 冰箱 / 柜子 / 地板堆）。
 *
 * `DEFERRED(D-22): 房间与货架是写死的「1 房间 3 家具」，「搬更大的家」要求它变成数据`
 * —— 见 `docs/囤货末世-游戏策划案.md` §10B.4 / §10B.9 与 `src/meta/deferred.ts` 的 D-22。
 *
 * 注意 `roomId` 字段**已经存在**，但房间里只有一间、且没有任何东西按它分组 ——
 * 也就是说"多房间"这件事在地基上留了位置，可惜**没留全**：
 * `handyRank`（"门口那一块"，全屋唯一）依赖"只有一个门"这个前提，
 * 多房间下它的语义必须重新定义。这是 D-22 里最容易被漏掉的一条。
 */
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
  /**
   * 今天有没有碰上突发事件（§5 的另一半，M2 §12 拍板 v0.9）。
   *
   * `null` = 今天没事 —— 突发事件是**低频**的（约三成日子），
   * 参照夜间事件 60% 的松弛节奏再往下降：它要像意外，不能像日程。
   * 事件的正文与选项不进快照，它们由 `data/emergencies.ts` 按 id 查 ——
   * 存文案等于给存档塞一份会过期的副本。
   */
  emergencyId: string | null;
  /** 急用的那几件在不在顺手位。true = 自己化解了，一点健康都没掉 */
  emergencyResolved: boolean;
  /** 没化解时受创的件数（按缺货口径）。它只用于叙事，四维的账已经算在 deltas 里 */
  emergencyLost: number;
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
   * 「安全感」连续达标天数（M2 §12 拍板 v0.9）。
   *
   * 达标 = 当天结算里**没有**出现缺口、没有翻不出来的货、也没在硬撑 ——
   * 也就是"今天该拿到的都拿到了"。它是一个只回答"连着几天"的数，
   * 断一天就归零；生涯最好那一条存在 `MetaProfile.bestSafeStreak`。
   *
   * 为什么放在夜间/日报语境而不是整理期弹出：§5 的「整理期完全静默」不动，
   * 快照只出现在玩家已经看完今天发生了什么之后。
   */
  safeStreak: number;
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

// ============ 白天随机事件（§6.2 / D-10） ============

/**
 * 一个白天事件给某个品类加的**限购**：这家店今天这个品类最多卖你几件。
 *
 * 它是"限购"这条事件的落点，而且是**按品类**记的 ——
 * 邻居抢的是米面油，不会连绷带一起限。
 *
 * ★ `max` 是"**今天这家店这个品类总共**能卖你几件"，是一件**全程**的上限，
 * 不是"下一次结账最多几件"。所以判定时必须减去今天已经买走的量
 * （`RunState.shopBoughtToday`）—— 否则玩家可以分批结账把限购绕过去，
 * 而"每人限购两袋"这句话就成了一句空话。
 */
export interface ShopLimit {
  shopId: string;
  category: CategoryId;
  /** 今天这个品类在这家店最多能买几件（含玩家已经买走的） */
  max: number;
}

/**
 * 今天已经买走的件数（`shopId|itemId` → 件数）。
 *
 * 它存在的唯一理由就是上面那条限购的语义：限购必须是**全程**上限。
 * 不记这个账的话，"限购 2 件"在玩家眼里等于"每次结账最多 2 件"——
 * 分两趟结账就买到了 4 件。那是机制漏了，不是玩家狡猾。
 *
 * 刻意按 `itemId` 而不是品类记：界面要能逐行显示"这件还能买几件"，
 * 而品类层面的汇总随时可以从它算出来。存细的、算粗的，不会算错。
 */
export type ShopBoughtToday = Record<string, number>;

/**
 * 正在等玩家决定的一个白天事件（§6.2「物价波动 / 限购 / 插队大妈 / 黑市商人」）。
 *
 * 为什么它落在 `RunState` 而不是 `ShopDayStock`：事件的判定发生在**进店那一下**
 * （`enterShop`），而那一刻是玩家动作、要落盘；库存是每天生成一次的静态快照。
 * 混在一起会让"改库存"和"发生了一件事"共用一条生命周期。
 *
 * `choice === null` = 还在看；`applied` 的语义与夜间事件完全一致（见 `AppliedEffect`）——
 * 界面不许拿选项声明的数值去显示，那正是 v7→v8 修掉的那个 bug。
 */
export interface DayEventState {
  defId: string;
  /** 这件事发生在哪家店（黑市商人之类的事件只在特定点位出现） */
  shopId: string;
  choice: number | null;
  applied: DayEffectApplied | null;
}

/**
 * 白天事件选项**实际**生效的后果。和 `AppliedEffect` 分开写，因为两边的字段不一样：
 * 白天动的是价格、库存、限购与现金，不动四维（那是生存期的事）。
 */
export interface DayEffectApplied {
  /** 现金变化（负数 = 花掉）。同夜间：给不起就按有多少给多少，摘要报真数 */
  cash: number;
  /** 今天全城物价倍率的变化（正数 = 涨价） */
  priceUp: number;
  /** 这次事件削掉了哪些店的库存：itemId → 件数 */
  stockCut: { shopId: string; itemId: string; count: number }[];
  /** 这次事件加上的限购 */
  limits: ShopLimit[];
  /**
   * 四维里白天**唯二**会被动的两项。
   *
   * 健康与庇护所不在这个列表里，而且那不是遗漏：它们只由生存期的结算
   * （`data/survival.ts`）负责。在囤货期凭空扣健康没有下游 —— 灾难还没来，
   * 也没有任何一条日报会解释那几点是怎么掉的。
   * 体力与心情不一样：它们本来就是"今天过得顺不顺"的容器，囤货期读得到也用得上。
   */
  stamina: number;
  mood: number;
  /** 顺手带回家的一箱货（箱型 id） */
  gotBox: boolean;
  /** 带回来的那箱叫什么（`gotBox` 为真时填，界面直接读它，不用再查一次表） */
  boxName: string;
  /**
   * 当场拿到手的货：`材料名 ×件数`。
   *
   * 它是"抢购"这类选项的**可见凭据** —— 没有它，玩家读完"你把架子上的主食拿掉一半"
   * 却发现家里什么都没多，只会认为这个事件坏了（M2 第一版就是这样）。
   * 重量也照实记进了 `carLoad`，所以界面上两处都会动。
   */
  grabbed: { itemId: string; count: number }[];
  /** 这一趟白跑了（插队大妈那类）：true = 这家店今天不用看了 */
  visitLost: boolean;
}

/**
 * 被拒进店这一类事件的出口：`DayEventState.choice` 用的哨兵值。
 * 与夜间事件同一个套路 —— "不参与"永远是一条合法路径（§4A）。
 */
/**
 * 白天事件的一个选项能给玩家什么。
 *
 * ## ★ 一条硬约束：每个选项都必须至少有一个"落到玩家身上"的效果
 *
 * 字段分两类，由 `systems/shop.ts` 的 `PLAYER_FACING_EFFECT_KEYS` 声明，
 * 并由 `dayEvent.test.ts` 强制：
 *
 * | 落到玩家身上（可选） | 只改商店（**不可单独成项**） |
 * | --- | --- |
 * | `cash` 现金 | `stockCut` 店里货架变少 |
 * | `stamina` / `mood` 四维 | `limit` 今天限购 |
 * | `boxDefId` 家里多一箱 | |
 * | `grab` 当场拿到货 | |
 * | `visitLost` 这一趟结束（明确的"不参与"） | |
 *
 * 为什么要有这条约束：M2 第一批白天事件里，四个选项里有三个**什么都没发生** ——
 * "先抢一轮"只把商店的货架削掉了（玩家一件货都没拿到），"照原计划买"更是纯亏。
 * 玩家的原话是"我抢了东西买了东西……家里的东西并没有增长啊"。
 * 那不是数值 bug，是**数据结构没拦住"写一个没有后果的选项"**。
 *
 * 另一半同样重要：**文案不许承诺效果给不出的东西**。
 * 上面那批的文案写的是"你把架子上的主食拿掉一半"—— 玩家读到的是"我拿到了"。
 * `grab` 就是为它生的：真抢到了，就真给货。
 */
export type DayOptionEffect = {
  cash?: number;
  /** 涨价：0.15 = 今天全城贵 15% */
  priceUp?: number;
  /**
   * 只改商店：这场混乱让店里的货架变少了。
   * ⚠ 它**不能单独构成一个选项** —— 玩家不会因为"别人把货抢走了"得到任何东西。
   * 文案只许说店里的货架，绝不许说"我抢到了"（那是 `grab`）。
   */
  stockCut?: { category: CategoryId; count: number };
  /**
   * 只改商店：这家店今天这个品类最多卖你几件。
   *
   * ⚠ 两条纪律，都是被玩家当场抓出来的：
   *  1. 它**不能单独构成一个选项**。"按限购买"给玩家的东西只有一条限制，
   *     玩家的原话是"限购两件跟我有鸡毛关系，我两件东西也没买到啊"——
   *     限购是**处境**，只能当事件的背景，不能当成奖励发；
   *  2. 光调高上限（通融）也不构成一个选项：那只是"你能买得更多"，
   *     还得再花一笔钱才真的有货。所以那种选项必须配 `cash` 或 `grab`。
   */
  limit?: { category: CategoryId; max: number };
  /**
   * 当场拿到货：趁乱拿的东西直接进待拆队列。
   *
   * 重量会照实记进当天的车载（`carLoad`）—— 不记的话玩家会出现
   * "车上负重没变、家里却多了东西"的错觉（黑市那一箱原来就是这样，玩家当场看出来了）。
   */
  grab?: { category: CategoryId; count: number };
  /** 顺手带回家的一箱货（箱型 id） */
  boxDefId?: string;
  stamina?: number;
  mood?: number;
  /**
   * 这一趟白跑了。用于"插队大妈"——但你也可以不排，所以它只能是**某个选项**的后果，
   * 不能是事件本身的后果（§4A：任何界面都得有一条"不参与"的路）。
   */
  visitLost?: boolean;
};

export interface DayOption {
  /** 按钮上的字，≤ 8 字（手机竖屏一行放得下） */
  label: string;
  /** 选完那一刻看到的一句话。可以写 `{spentCash}`，同夜间事件 */
  outcome: string;
  effect: DayOptionEffect;
  /** 必须给得起钱才成立（买货那一类），不写 = 有多少给多少 */
  requireFullCash?: boolean;
}

export interface DayEventDef {
  id: string;
  /** 门前读到的处境，1~2 句 */
  text: string;
  /**
   * 这条事件只在哪几个点位出现。不写 = 哪个点位都可能碰上。
   * 黑市商人只在五金店后巷那种事，由它表达 —— 而不是在文案里暗示。
   */
  onlyShops?: readonly string[];
  /**
   * 事件主题标签（§10B.3.1 的 L2 维度"事件池权重"要用它）。
   *
   * 灾难可以用 `eventPoolWeights: { 冷: 3, 邻居: 2 }` 把**某一类事**的出场率抬高 ——
   * 寒潮局多碰上"冷"、骚乱局多碰上"人与人"。没有标签就没法做这件事，
   * 只能按 id 一条条列（那在数百条内容时不可维护）。
   *
   * 可选：存量事件不写也能跑（权重按 1 倍算），
   * 但**新内容必须写** —— `check-content.mjs` 会提示覆盖率。
   */
  tags?: readonly string[];
  options: readonly DayOption[];
}

// ============ 突发事件（生存期，§5） ============

/**
 * 一个突发事件的"要什么"。
 *
 * 与夜间/白天事件的**根本区别**：它不是选项题，是**检查题** ——
 * §5 写的是「应急货架（门口/最顺手位）放急救品 → 突发事件不掉健康」，
 * 落点就是这里：玩家没法在事情发生的那一刻再决定一次，他早就在整理期决定过了。
 * 这正是"应急可达率从分数变成战力"的那一环（M2 §12 拍板 v0.9）。
 */
export interface EmergencyDef {
  id: string;
  /** 陈述处境的 1~2 句。不写台词腔、不煽情（§11） */
  text: string;
  /** 要哪个品类 */
  category: CategoryId;
  /** 顺手位上要有几件才算化解 */
  needOnHandy: number;
  /** 没化解时按缺货口径受创的件数（1 = 一份缺货的疼） */
  lost: number;
  /** 这一条要不要消耗掉化解用的那几件（"炉子熄了"要真的烧掉一罐燃料） */
  consumes?: boolean;
}

/**
 * 各类事件的**近期抽取记录**（每类一个数组，**最新在前**）。
 *
 * ## 它解决什么
 *
 * M2 走测的反馈原话是"生存期的借用事件太重复太多了"。
 * 账算下来确实如此：求援订单池只有 6 单，每天 45% 有人敲门，
 * 而每次是**均匀随机** —— 同一个 NPC 前后两次问同一件事的概率是 50%。
 * 夜间事件（6 条 / 60%）同理，一局 7 个晚上会撞见重复。
 *
 * ## 为什么是"压权重"而不是"禁掉"
 *
 * 池子小的时候硬禁会把"下一抽"变成确定的，玩家第二次就能预测 —— 那比重复更糟。
 * 这里只把最近出过的那几条权重压到 15%，所以间隔被拉开而随机性还在。
 *
 * 存 id 而不是存"今天抽到的是第几条"：事件表加内容时下标会漂，
 * 而 id 不会（这也是存档里到处都是 id 的原因）。
 */
export interface EventHistory {
  /** 夜间事件（`data/nightEvents.ts`） */
  night: string[];
  /** 求援订单（`data/helpRequests.ts`） */
  help: string[];
  /** 白天事件（`data/dayEvents.ts`） */
  day: string[];
  /** 突发事件（`data/emergencies.ts`） */
  emergency: string[];
}

/** 每类各留最近几条。4 条够拉开间隔，又不会让"从没出过的"永远排不上 */
export const EVENT_HISTORY_KEEP = 4;

/**
 * 手里那件物资的**来处**（§4A：刷新或被杀进程时，它要能回到这里）。
 *
 * 定义在 `model/` 而不是 `systems/organize.ts`，因为**它现在要落盘**：
 * `RunState` 引用了它，而 `model/` 不许反向依赖 `systems/`。
 */
export type HeldOrigin =
  | { kind: 'none' }
  | { kind: 'box'; boxId: string }
  | { kind: 'shelf'; shelfId: string; pos: SlotPos };

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

  /**
   * 今天全城的物价倍率（1 = 原价）。逐日上行的"物价波动"落在它身上。
   *
   * 它修的是 M1 的一个隐性空洞（D-03：寒潮是天然冷库 → 腐坏恒 0 → "早买 vs 晚买"失去意义）。
   * 腐坏那条路被拍板关掉了，所以"晚买会贵"必须由另一条路来兑现 ——
   * 而它恰好是 §6.2 本来就要的「物价波动」。
   */
  shopPriceFactor: number;
  /** 今天生效的限购（来自白天事件）。换天清零 */
  shopLimits: ShopLimit[];
  /**
   * 今天已经买走的件数（`shopId|itemId` → 件数）。换天清零。
   *
   * 它只服务一件事：让**限购**成为全程上限而不是"每次结账的上限"（见 `ShopLimit`）。
   */
  shopBoughtToday: ShopBoughtToday;
  /**
   * 正等着玩家决定的一个白天事件（null = 没有）。
   * 与 `night` / `helpRequest` 同一个套路：存的是"发生了哪件事、选到哪一步"。
   */
  dayEvent: DayEventState | null;

  /**
   * 各类事件的近期抽取记录。**它只服务一件事：让同一件事别隔天又来一次。**
   * 见 `EventHistory` 的注释（含"为什么是压权重而不是禁掉"）。
   */
  eventHistory: EventHistory;

  // ———————— 整理（M0 起，v15 落盘） ————————

  /**
   * **手里正捏着的那件物资**（§4A：整理到一半的状态必须完整保留）。
   *
   * ## ★ 它为什么必须落盘（这是被一个真 bug 逼出来的）
   *
   * 它原来只活在 `OrganizeSession` 里（纯内存）。而"拿起一件"这个动作会把物资
   * **从格子/箱子里移走**，所以一旦这时刷新页面：
   *
   *   格子里没有了 + 会话没了 = **那件物资凭空消失**。
   *
   * 这直接违反本项目的核心承诺"杀进程损失 = 0"，也与 §4A 写明的
   * "整理到一半的状态完整保留（手里捏着的物资回到原位即可）"不符 ——
   * `organize.ts` 里当时甚至有一条注释**声称**已经这么做了，但实际是丢掉了。
   * 玩家报的原话就是"手里拿着东西时刷新页面，这件物资会丢"。
   *
   * ## 语义
   *
   * 落盘的是"手里有什么 + 它从哪来"，于是刷新后有两种选择：
   *  · **原样保持"拿在手里"**（实现选的是这条 —— 它最贴近 §4A 的"回到同一个状态"）；
   *  · 或者按 `heldFrom` 送回原处。
   * 两条都不丢件。选前者是因为刷新后"手里还捏着刚才那件"比"东西自己跑回箱子里"
   * 更符合玩家的心理模型，也与 `currentShopId` 那条"恢复即续玩"的先例一致。
   *
   * 与 `heldFrom` 成对使用：`held === null` 时 `heldFrom` 必须是 `{ kind: 'none' }`。
   */
  held: ItemStack | null;
  /** `held` 的来处（`held` 为 null 时无意义） */
  heldFrom: HeldOrigin;

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

  // ———————— M2 跨局结算（§6.7 图鉴 / §9.6） ————————

  /**
   * 这一局的成果有没有已经记进 `MetaProfile`。`null` = 还没记。
   *
   * ★ 为什么必须有这个字段（三个出口，只允许发一次奖励）：
   * 结局有**三条**路 —— 撑满 14 天（`advanceSurvivalDay`）、健康归零
   * （`settleAndMaybeEnd`）、以及**读档自愈**（`normalizeRun` 发现 health ≤ 0 补结局）。
   * 结算页每渲染一次就发一次奖励的话，玩家反复刷新结算页就能把图鉴与纪录刷满 ——
   * 那不是上瘾循环，那是记账错误。所以发放时**先写这个字段再发**，
   * 而且由命令层（`systems/codex.ts` 的 `settleRunMeta`）独占这一段逻辑。
   */
  metaSettled: { at: number; outcome: 'survived' | 'collapsed' } | null;
}

/**
 * 图鉴（§6.7「保留：物资图鉴、灾难图鉴、关系图鉴」/ §9.6 第三项）。
 *
 * 三个数组都是**已点亮 id 的集合**，顺序不重要（比较一律先排序，见 systems/codex.ts）。
 * 用三个平铺数组而不是一个 `Unlocked[]`：§7 原本就是这么写的，
 * 而且界面也要按这三个分页显示 —— 一份数据只服务一个读者。
 */
export interface CodexState {
  items: string[];
  disasters: string[];
  npcs: string[];
}

/** 图鉴三页的名字。界面与结算页共用，避免两处各写一份中文 */
export type CodexPage = keyof CodexState;

export interface MetaProfile {
  // 跨局存档
  version: number;
  identityLevels: Record<string, number>;
  codex: CodexState;
  bestSurvivalDays: Record<string, number>; // 每灾难最佳纪录
  /**
   * 「安全感」连续达标天数（M2 §12 拍板 v0.9）。
   *
   * 它是**跨局**的：M1 评审确认"当前死亡/通关都零遗产，是上瘾循环的断点"，
   * 而这个数就是那份遗产里最便宜、最像"我今天过得不错"的一条。
   * 单局内的连击走 `SurvivalState.safeStreak`（那里才是它会归零的地方），
   * 这里存的是**生涯最好**的那一条 —— 两者刻意不共用一份数据：
   * 一个回答"你现在连着几天了"，一个回答"你最好连着过几天"。
   */
  bestSafeStreak: number;
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
