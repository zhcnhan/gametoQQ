/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  开发欠账登记册（Deferred Work Register）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么要有这个文件
 *
 * 《囤货末世》里有好几处**刻意先不做**的东西：它们的模型已经就位、界面已经画出来、
 * 数字已经在算 —— 但因为里程碑范围或已拍板的设计决定，它们在当前版本里是**空转**的。
 *
 * 最典型的例子是「腐坏」：玩家明确拍板"寒潮是天然冷库（spoilRate 0.5）"，
 * 于是 M1 全程不会有任何东西烂掉，连带「临期优先」百分比、冰箱、日报的损耗行
 * 全都变成了装饰。**这是正确的设计决定，不是漏做** —— 但它极其容易被后来的
 * 开发者（人或 AI）误判成 bug，然后"好心"把 spoilRate 改成 1 让数字好看一点，
 * 一举把玩家的设计意图抹掉。
 *
 * 所以这里把每一笔欠账都**写死成数据**，并由 `meta/deferred.test.ts` 守护：
 *
 *   · 代码里出现 `DEFERRED(D-xx)` 标记 → 必须在本表登记（不许有来历不明的标记）
 *   · 本表登记为 `open` 且 `kind: 'code'` 的条目 → 必须在 `markedIn` 列出的文件里
 *     真的找到那个标记（不许表格里写一套、代码里是另一套）
 *   · 标记为 `done` 的条目 → 代码里**不许**再留标记（做完了要收干净）
 *
 * 换句话说：这个文件不是说明书，是**被测试盯着的数据**。
 *
 * ## 每轮开发要做的两件事
 *
 *   1. **开工时读一遍** `open` 的条目，确认自己要碰的东西有没有踩在欠账上；
 *   2. **收工时更新它** —— 新产生的欠账要登记并埋标记；清偿掉的要改成 `done`
 *      并删掉代码里的标记，否则测试会红。
 *
 * 用户已授权 AI 在每一轮开发中维护本文件（含新增条目）。
 */

export type DeferredKind =
  /** 代码欠账：`markedIn` 里的文件必须含有 `DEFERRED(D-xx)` 标记 */
  | 'code'
  /** 流程欠账：验收口径、范围调整这类，代码里没有标记可埋 */
  | 'process';

export type DeferredStatus = 'open' | 'done';

export interface DeferredItem {
  /** 稳定 id，形如 `D-01`。代码注释里用 `DEFERRED(D-01): ...` 引用它 */
  id: string;
  kind: DeferredKind;
  /** 一句话说清是什么事 */
  title: string;
  /** **现在**的影响：这笔账悬着会导致什么。写给三个月后的自己看 */
  impact: string;
  /** 什么时候清偿：阶段名 / 里程碑 / `未定` */
  plan: string;
  /** kind='code' 必需：相对 `src/` 的路径，这些文件的源码里必须有对应标记 */
  markedIn: string[];
  status: DeferredStatus;
  /** status='done' 时填：清偿于哪个提交 / 里程碑 */
  resolvedIn?: string;
}

export const DEFERRED_ITEMS: readonly DeferredItem[] = [
  {
    id: 'D-01',
    kind: 'code',
    title: '腐坏机制未实现：`ItemBatch.expiresAtDay` 没有消费者',
    impact:
      '已清偿。阶段 C 补上了消费者：`model/spoil.ts` 按 `DisasterProfile.spoilRate` 把日历天' +
      '换算成虚拟天，每日结算里真的会清掉过期批次（货架与未拆纸箱一起算）。' +
      '注意机制通了 ≠ M1 会坏东西，见 D-03。',
    plan: '阶段 C',
    markedIn: [],
    status: 'done',
    resolvedIn: 'M1 阶段 C —— 新增 model/spoil.ts，按 DisasterProfile.spoilRate 换算虚拟天做腐坏结算'
  },
  {
    id: 'D-02',
    kind: 'code',
    title: '冰箱（`Shelf.kind === "fridge"`）没有任何玩法效果',
    impact:
      '§8 写的「冰箱 1 个（腐坏减速）」未实现 —— 它现在是一块**名字不同的货架**，' +
      '玩家换成三块普通货架也完全不影响任何数值。即使阶段 C 把腐坏做出来，' +
      '在寒潮这个"天然冷库"的灾难下它依然没有存在感。',
    plan: '阶段 C 落到字段；真正产生价值要等 M3 的多灾难（热浪 / 洪水）',
    markedIn: ['model/types.ts', 'systems/setup.ts'],
    status: 'open'
  },
  {
    id: 'D-03',
    kind: 'code',
    title: '寒潮 spoilRate = 0.5 → M1 全程不会发生腐坏',
    impact:
      '腐坏机制**已经实现**（model/spoil.ts + 每日结算里真的会清掉过期批次），' +
      '但寒潮是天然冷库，M1 全程没有任何东西会坏 —— 于是「临期优先」百分比、' +
      '冰箱、日报里的腐坏行在本里程碑里**全是装饰**（实测 7 天 `survival.spoiled` 恒为 0）。' +
      '这是玩家拍板的设计（"其他灾难保持真实，个别灾难可以延长"），不是 bug ——' +
      '任何人都不许为了让数字好看而把 0.5 改成 1。',
    plan: 'M3（热浪 spoilRate > 1 时，这套机制才真正吃紧）',
    markedIn: ['data/disaster.ts'],
    status: 'open'
  },
  {
    id: 'D-04',
    kind: 'process',
    title: 'M1 验收清单第 3 条：「乱档 vs 好档，有可感知差异」',
    impact:
      '已改口径并清偿。腐坏那一版受 D-03 影响在 M1 不可能通过（寒潮全程零腐坏）；' +
      'M1 平衡改造把"可感知差异"换成了**体力轨迹** —— 同样的 60 件货实测：' +
      '全上架并贴胶带的档 7 天体力恒 100、心情涨到 98、0 天硬撑；' +
      '全堆在纸箱里的档体力从 100 掉到 0、第 5 天起硬撑 3 天、健康掉 45，' +
      '最后两天还因为"翻不动"每天少拿 3 件。腐坏那条挪到 M3。',
    plan: 'M1 平衡改造',
    markedIn: [],
    status: 'done',
    resolvedIn: 'M1 平衡改造 —— data/survival.ts 的 workCostOf 与 EXHAUSTED_STAMINA'
  },
  {
    id: 'D-05',
    kind: 'code',
    title: '§6.3 第三个维度「应急可达率」未实现',
    impact:
      '已清偿（M1 阶段 F）。口径：**该灾难的应急物资里，有多大比例放在顺手位上**' +
      '（应急品类 = 灾难的 `priorityCategories` ∪ 医疗 —— 寒潮那天，一罐燃料比一卷绷带更救命）。' +
      '分母算全屋、含还没拆的纸箱：躺在箱底的那卷绷带当然不在顺手位，它要翻。' +
      '它也不只是被印在结算页上：体力见底的那天，顺手位上的东西是你唯一还够得到的。',
    plan: 'M1 阶段 F',
    markedIn: [],
    status: 'done',
    resolvedIn: 'M1 阶段 F —— model/score.ts 的 emergencyRate + Shelf.handyRank'
  },
  {
    id: 'D-06',
    kind: 'code',
    title: '`Shelf` 没有位置概念（"门口" / "最顺手位"）',
    impact:
      '**已全部清偿**。两段：① M1 阶段 F 落地了 `Shelf.handyRank`（由玩家自己指认门口那块，' +
      '全屋唯一，radio 语义）；② M2 补上了 §5 的另一半「突发事件不掉健康」—— ' +
      '`data/emergencies.ts` + `systems/survival.ts` 的 `settleEmergency()`：' +
      '顺手位上有该品类的急救品就自己化解（不消耗库存），没有才按缺货口径受创。' +
      '实测（14 天口粮 30/30/30，跨 3 个 seed）：标了顺手位体力下限 88，没标 81 —— ' +
      '代价看得见，但两种摆法都撑得过 14 天，§5 引擎①「不整理也能活」没有被推翻。',
    plan: 'M1 阶段 F + M2',
    markedIn: [],
    status: 'done',
    resolvedIn:
      'M1 阶段 F —— Shelf.handyRank + 整理页的「顺手位」标记；M2 —— systems/survival.ts 的 settleEmergency + data/emergencies.ts'
  },
  {
    id: 'D-07',
    kind: 'code',
    title: '`ItemDef.slotSize` 与 `nutrition` 的大部分仍然没有参与计算',
    impact:
      '**一半已清偿**（M1 平衡改造）：`nutrition.health` 与 `nutrition.comfort` 有了消费者 ——' +
      '每日结算会自动用药（回血 = health × 3）与自动添被（庇护所 = comfort × 4）。' +
      '**仍然悬着的两件**：① `slotSize` —— 槽位矩阵实际是"一格一栈"，大米（slotSize 4）' +
      '和电池占同样一格；② `nutrition.food / water` —— 每日消耗按**件数**（已拍板，见 §6.4），' +
      '所以吃罐头和吃大米在数值上仍然完全等价。要么让它们真的生效，要么从 §7 里删掉。',
    plan: '未定（slotSize 要改槽位规则，food/water 要改消耗口径，两个都还没到该动的时点）',
    markedIn: ['data/items.ts'],
    status: 'open'
  },
  {
    id: 'D-08',
    kind: 'code',
    title: '§8 的「2 房间 × 3 货架」只做了 1 房间 3 块家具',
    impact:
      '空间压力比策划案小（72 格）。7 天采购下来大约装到 8 成，还没出现"放不下"的紧张感 ——' +
      '也就是生存期少了一个"货架不够用"的决策点。',
    plan: '未定（看生存期是否需要这个压力）',
    markedIn: ['systems/setup.ts'],
    status: 'open'
  },
  {
    id: 'D-09',
    kind: 'code',
    title: '健康没有恢复途径（四维里唯一只减不增的那个）',
    impact:
      '已清偿（M1 平衡改造）。每日结算的最后一步会自动开药箱：健康跌破 70 就按 FEFO 取一件医疗品，' +
      '回血量 = `ItemDef.nutrition.health` × 3（绷带 +6 / 感冒药 +9），补到线上就停、每天最多 2 件。' +
      '这同时清偿了 D-07 的一半 —— `nutrition` 终于有消费者了。' +
      '**仍未做的另一半**：「急救品放顺手位 → 突发事件不掉健康」（§5）卡在 D-06 的货架位置信息上。',
    plan: 'M1 平衡改造',
    markedIn: [],
    status: 'done',
    resolvedIn: 'M1 平衡改造 —— systems/survival.ts 新增 autoSupply()，读 ItemDef.nutrition.health 自动用药'
  },
  {
    id: 'D-10',
    kind: 'code',
    title: '白天的随机事件还没做（§6.2「物价波动 / 限购 / 插队大妈 / 黑市商人」）',
    impact:
      '**已清偿（M2）**。落地分两处，因为「物价波动」和另外三条的形状不一样：' +
      '① 有得选的三条（插队大妈 / 抢购 / 限购 / 黑市商人）在 `data/dayEvents.ts`，' +
      '接入点是 `enterShop`——扣完行动点之后掷一次，掷中就挂 `RunState.dayEvent`，' +
      '界面先讲那件事、货架等处理完再画（结构与夜间事件同源）；' +
      '② 「物价波动」**没有选项**（玩家没法"决定"物价），所以它落在' +
      '`dayPriceFactor(day)` 的逐日上行曲线上（灾前 0.95 → D+14 的 2.2），' +
      '顺带修掉了 M1 的一个隐性空洞：D-03 让"早买 vs 晚买"失去意义（腐坏恒 0），' +
      '而"晚买更贵"把这个博弈用另一条路救了回来。' +
      '实测：`rollDayEvent` 约六成的店门有事；黑市商人只在五金店后巷（`onlyShops`）。',
    plan: 'M2',
    markedIn: [],
    status: 'done',
    resolvedIn: 'M2 —— data/dayEvents.ts + systems/shop.ts 的 rollDayEvent / resolveDayEvent / dayPriceFactor'
  },
  {
    id: 'D-11',
    kind: 'code',
    title: '§6.4 的「翻乱相邻货架（滚雪球）」刻意没做',
    impact:
      '§6.4 写「乱 → 翻找耗时、翻乱相邻货架（滚雪球）、可能误食过期品（健康-）」。' +
      '两头已经落地：翻找耗时 → **体力劳作 + 心情惩罚**（M1 平衡改造把"耗时"从软性的心情' +
      '落成了硬性的体力，并在体力见底时让当天的取用打折，见 data/survival.ts）；' +
      '误食过期品 → 腐坏机制本身（寒潮不发作，见 D-03）。' +
      '只有"翻乱相邻货架"这条**仍然刻意没做** —— 它会自我放大，玩家掉进去就爬不出来。' +
      '但要注意：M1 平衡改造新增的「体力见底 → 取用打折 → 更没力气」**已经是一条能滚起来的链**，' +
      '所以再叠一层之前，得先拿它做一轮真实手感验证。',
    plan: '未定（先验证"体力见底"这条链的疼度，再决定要不要再加一层）',
    markedIn: ['model/consume.ts'],
    status: 'open'
  },
  {
    id: 'D-15',
    kind: 'code',
    title: '外界温度表（`COLD_SNAP_TEMPS`）是手写的，而且只覆盖寒潮',
    impact:
      '§6.6 的反差层要"外界温度 vs 屋内温度"，但 §7 的 `DayForecast` 里只有 `severity` 与一句文本。' +
      '温度没有从 `severity` 换算 —— 寒潮的曲线不是它的线性函数（D+1 回过暖），' +
      '硬换算出来的数会和日历里那句「-19°C。窗户上结了整片冰花」对不上。' +
      '代价是：多灾难（M3）时这张表要按 `disasterId` 拆成几份，或者干脆并进 `DayForecast`。',
    plan: 'M3 多灾难时处理（那时才值得动 §7 的类型）',
    markedIn: ['data/disaster.ts'],
    status: 'open'
  },
  {
    id: 'D-14',
    kind: 'code',
    title: '「街区平均余粮」是一条手写常数，不是模拟出来的',
    impact:
      '§6.6 的反差数字要求"你的余粮天数 vs 街区平均余粮天数"。M1/M2 只做了一个能让玩家读出' +
      '自己位置的参照物 —— `DISTRICT_DAYS` 是一条手写的递减曲线（[0,3,2,2,1,1,0,0,0]），' +
      '**没有**任何模拟。真正的"街区"要等 M3 的跨局世界状态 —— M2 落的是跨局存档的那一半' +
      '（图鉴与最佳纪录，见 `systems/codex.ts`），"街区"这一半没动。' +
      '它现在的风险是：如果玩家只囤了 1 天粮，这句对比会变成讽刺而不是激励 —— 但那也算说真话。',
    plan: 'M3（与跨局世界状态一起做）',
    markedIn: ['model/contrast.ts'],
    status: 'open'
  },
  {
    id: 'D-13',
    kind: 'code',
    title: '§6.5 的「情报」回报还没做',
    impact:
      '§6.5 写交付后获得「人情 / 情报 / 以物易物」三种回报。阶段 D 做了两种：' +
      '人情（trust，已在结算页显示）与以物易物（thanks：现金或一箱货）。**情报没有做** ——' +
      '它需要一个能被追加的先知日历（"提前知道 D+5 会到 -30°C"这种），' +
      '而 M1 的 `DisasterProfile.calendar` 是静态表，没有"玩家得知之后往里补一条预告"的位置。' +
      '硬做的话只能塞进 log，那它就成了一句没有作用的文本。' +
      'M2 落的是**另一条**（跨局世界状态的图鉴与 meta 闭环），本条随之顺延 —— 见 D-18。',
    plan: 'M3（与先知日历的动态化一起做，见 D-18）',
    markedIn: ['data/helpRequests.ts'],
    status: 'open'
  },
  {
    id: 'D-12',
    kind: 'process',
    title: '§12.3「弹尽粮绝不死人」已由玩家授权修订（v0.5）',
    impact:
      'M1 手测发现原条款被执行成了"不管什么时候，一直点过一天就能撑满 7 天"——' +
      '生存期没有任何张力，"整理"也就没有意义。玩家授权改写为：' +
      '**每一步的代价都可逆、都能爬回来，但健康归零这一局就停在这里**（结算页给 collapsed 结局）。' +
      '配套补上了「整理质量 → 体力 → 取用 → 健康」的完整因果链（见 D-04）。' +
      '第二轮手测又发现"硬撑"虽然疼，玩家却没有一个可以做的决定，于是补了两条（v0.6）：' +
      '硬撑按**连续天数**分三档并加重每日消耗（第 3 天起主食 +1，第 5 天起主食 +2、燃料 +1）；' +
      '并落实了本条承诺的"交易/救济"—— 硬撑时可用三件东西换一箱粮油（systems/trade.ts，每 2 天一次）。',
    plan: 'M1 平衡改造',
    markedIn: [],
    status: 'done',
    resolvedIn: 'M1 平衡改造 —— 策划案 §12.3 的 v0.5 标注 + systems/phases.ts 的 settleAndMaybeEnd'
  },

  // ———————— M2 新登记的欠账（D-16 起） ————————

  {
    id: 'D-16',
    kind: 'code',
    title: '图鉴只有账本，没有界面；而且有一批物资在当前内容下永远点不亮',
    impact:
      'M2 把图鉴的**账**做实了（`MetaProfile.codex` 三页 + `systems/codex.ts` 的幂等结算 + ' +
      '结算页的"本局新点亮 X 项"），但**没有独立的图鉴界面**（§9 界面清单第 7 条）。' +
      '后果有两个：① 玩家看不到"还有多少没见过的"，收集目标只有结算页那一行数；' +
      '② `ITEM_DEFS` 里已经有了图鉴点不亮的东西 —— `hot_water_bag_gift`（印花暖水袋）' +
      '**不在任何箱子的池子里**，所以它现在是一个纯粹的占位：图鉴上永远空一格。' +
      '这不是 bug，是"内容没跟上账本"，但不能就这么悬着。',
    plan: 'M3（随内容扩张一起：图鉴界面 + 补齐哪些物资从哪儿来）',
    markedIn: ['systems/codex.ts'],
    status: 'open'
  },
  {
    id: 'D-17',
    kind: 'code',
    title: '物价波动与限购不写进日报，「这店今天为什么贵」事后查不到',
    impact:
      'M2 的物价逐日上行（`dayPriceFactor`）与限购（`ShopLimit`）都只活在**当天**：' +
      '换天时被清零（这是对的，它们本来就该只活一天），但它们**没有在 `run.log` 里留痕**。' +
      '于是玩家在生存期回翻日报时，看不到"D+3 那天物价涨到 1.5 倍"这件事 ——' +
      '而那一局的取舍（早买还是晚买）正是被它决定的。日志是给人看的账，缺了这一段，' +
      '玩家只能凭记忆解释自己当时为什么那么买。',
    plan: 'M3（与日报的复盘视图一起做：把逐日物价与当天生效的限购记进 log）',
    markedIn: ['data/dayEvents.ts'],
    status: 'open'
  },
  {
    id: 'D-18',
    kind: 'process',
    title: 'M2 没有动「情报」与「街区」这两条（它们其实都卡在同一件事上）',
    impact:
      '**这是一条范围说明，不是一笔新欠账** —— 真正的代码欠账仍是 D-13（情报）与 D-14（街区）。' +
      'M2 把手上的力气放在了跨局存档的那一半（图鉴 / 最佳纪录 / 最佳连击，见 systems/codex.ts），' +
      '而"先知日历能追加预告"与"街区余粮是模拟出来的"是另一半，两条都要**动态世界状态**，' +
      '在 M2 的范围里做不完。登记它是为了让接手者看清：M2 交付的是"跨局记住你做过什么"，' +
      '不是"世界会随你变化" —— 后者一条都没动。',
    plan: 'M3（与 D-13 / D-14 一起做）',
    markedIn: [],
    status: 'done',
    resolvedIn: 'M2 范围说明 —— 实际欠账见 D-13（data/helpRequests.ts）与 D-14（model/contrast.ts）'
  },
  {
    id: 'D-19',
    kind: 'code',
    title: '逐日物价曲线是手写的，而且只覆盖寒潮（与 D-15 同一类问题）',
    impact:
      'M2 为补 D-03 留下的空洞（腐坏恒 0 让"早买 vs 晚买"失去意义）加了' +
      '`DAY_PRICE_FACTOR`：灾前 0.95 → D-Day 1.25 → D+14 2.2，单调不减。' +
      '它和 D-15 的外界温度表是同一类手写表，代价也一样：**只覆盖寒潮**，' +
      '而且当灾难不止一种时会需要按 `disasterId` 拆成几份' +
      '（热浪的抢购曲线不该和寒潮长得一样）。现在只有一场灾难，所以它是对的；' +
      '多灾难落地时必须重新想这张表 —— 那时再改类型才有必要。',
    plan: 'M3（多灾难时处理，与 D-15 一起）',
    markedIn: ['data/dayEvents.ts'],
    status: 'open'
  },
  {
    id: 'D-20',
    kind: 'process',
    title: '命令层对"非法参数"不设防 —— 压测报出 114 类发现，但绝大多数界面造不出来',
    impact:
      '`scripts/stress.mjs`（六套件压测 / 模糊测试）跑出一批严重发现，最大的一族是' +
      '**一个 NaN 参数会污染整份存档**：给 `buyCart` 的件数传 NaN 时，' +
      '`buildCartView` 里的比较对 NaN 全为 false（`line.count <= 0` 不成立、' +
      '`count < line.count` 也不成立），于是三约束全部放行 —— ' +
      '现金被写成 NaN、箱内批次件数变成 NaN，之后每一次读数都带着它。' +
      '同类还有：坐标传小数（`row=0.5`）时 `isInside` 判为"在界内"、' +
      '`setSlotStack` 静默返回原货架 —— **放置报成功但物资消失**；' +
      '`splitStack` 在巨数输入下不守恒。\n\n' +
      '★★ **可达性判断（这决定了要不要现在修，也是本次归档的重点）**：' +
      '界面**造不出**这些值 —— 件数来自 `+` / `-` 按钮（整数），' +
      '坐标来自 `data-row` / `data-col`（整数）。所以它们是**接线层不设防**，' +
      '不是玩家能碰到的 bug。真正的风险是"将来界面或逻辑漂移、开始传坏值"——' +
      '而那时有压测能立刻发现。\n\n' +
      '但项目把"自愈"承诺得很重（手改存档 / 云备份合并都是真实场景），' +
      '而 S3 报出的 100+ 种"坏档自愈后继续玩时崩溃"说明自愈**还没有名副其实**：' +
      '`normalizeRun` 不重建 `stats`、不校验 `itemId` / `identityId` / `disasterId`，' +
      '于是读档"成功"了，玩两步就抛异常。\n\n' +
      '另一条值得单独记：夜间选项下标传字符串 `"0"` 时，`Number.isInteger("0")` 为 false →' +
      '读档把 `choice` 归 null → **同一晚能再选一次、效果翻倍**。' +
      '界面不会传字符串，但它说明"存档里存的下标"没做类型兜底。',
    plan:
      '分两步，第一步性价比明显更高：\n' +
      ' ① **命令层入口加参数守卫**（件数 `Number.isInteger` 且 > 0、坐标 `Number.isInteger`）——' +
      '约十行，能把 P0 里最大那一族整族关掉；\n' +
      ' ② **让"自愈"名副其实**（`normalizeRun` 重建 `stats`、校验各种 id）——' +
      '这是更大的活，与云备份合并一起做更合适。\n\n' +
      '完整清单：跑 `npx vite-node scripts/stress.mjs` 生成 `scripts/stress-results.json`' +
      '（不入库，每次内容不同）。',
    markedIn: [],
    status: 'done',
    resolvedIn:
      'M2 收尾 · 第一步已做（同一 seed、同一规模实测：**114 类 / 24688 次 → 34 类 / 114 次**）。' +
      '实际改的比原计划多，因为"自愈"那一族（100+ 种"读档成功、玩两步就崩"）' +
      '追下去发现根因只有四个 id 没校验，属于"几行能修"的范围：\n' +
      ' · `systems/shop.ts` 的 `buildCartView`：件数要求 `Number.isInteger` 且 > 0（挡住 NaN 污染存档），' +
      '并把**同一品类的多行合并**（挡住"重复行绕过库存 / 限购"）；\n' +
      ' · `model/shelf.ts` 的 `isInside`：坐标要求整数（挡住"`row=0.5` 放置报成功但物资消失"）；\n' +
      ' · `model/shelf.ts` 的 `splitStack` 与 `model/consume.ts` 的 `consumeCategory`：' +
      '件数要求正整数（挡住"整堆被销毁"与"整个品类被清空"）；\n' +
      ' · `systems/night.ts` 的 `optionAt`：下标要求非负整数（挡住"字符串下标 `"0"` 存档后同一晚能再选一次"）；\n' +
      ' · `state/save.ts` 的 `normalizeRun`：补上 `disasterId` / `identityId` / 物资 id /' +
      '`stats` / `cash` / `trust` / 货架结构的校验与重建（这一条关掉了 30 类坏档崩溃）。\n\n' +
      '★ **残留（写在这里免得被忘掉）**：剩下的 34 类里有 **约 82/114 次是压测工具自己的问题**' +
      '（它给命令层传 `"aaaa…"` / `"__proto__"` 这类垃圾 id、以及变异出空货架后 `rint(-1)`），' +
      '产品**正确地拒绝了**那些输入。真正剩下的产品侧观察只有三条，且都不可由界面触发：' +
      '`dropStack` 接受 0 件空堆（货架上留"幽灵堆"）、白天事件未处理时命令层不拦结账' +
      '（纯靠界面遮挡）、以及 `splitStack` 的巨型数字输入仍在浮点精度边缘。' +
      '压测工具自身那批误报值得单独清理一次（让它只报真问题）。'
  }
];

export function openDeferred(): DeferredItem[] {
  return DEFERRED_ITEMS.filter((item) => item.status === 'open');
}

export function findDeferred(id: string): DeferredItem | null {
  return DEFERRED_ITEMS.find((item) => item.id === id) ?? null;
}

/** 代码注释里引用的标记格式：`DEFERRED(D-01): 说明` */
export const DEFERRED_MARKER = /DEFERRED\((D-\d+)\)/g;
