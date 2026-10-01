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
      '结算页那一行现在写着"随生存期实装"。整理品质目前只有两维（归位率 / 临期优先率），' +
      '§9.6 承诺的三项百分制少了一项。',
    plan: '阶段 C/D',
    markedIn: ['ui/EndingScreen.ts'],
    status: 'open'
  },
  {
    id: 'D-06',
    kind: 'code',
    title: '`Shelf` 没有位置概念（"门口" / "最顺手位"）',
    impact:
      '§5 写的「应急货架（门口/最顺手位）放急救品 → 突发事件不掉健康」和 D-05 的应急可达率' +
      '都落不了地 —— 它们缺的是"这块架子离门多近"这个数据，不是算分公式。' +
      '加字段时要想清楚：是给 Shelf 加一个 accessRank，还是做成玩家可拖动的"顺手顺序"（更有味道，也更贵）。',
    plan: '阶段 C/D 定方案',
    markedIn: ['model/types.ts'],
    status: 'open'
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
      '§6.2 给扫货写了"随机事件：文本 1~2 句，选项 2~3 个"，目前**一条都没有** ——' +
      '白天采购是纯数值操作，没有任何变数。夜间事件（阶段 B）已经把"文本 + 选项"那套' +
      '数据结构和界面跑通了，白天的事件可以直接复用同一套，成本不高。',
    plan: 'M1 阶段 C 之后 / 或随 M3 的内容扩张一起做',
    markedIn: ['systems/shop.ts'],
    status: 'open'
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
    id: 'D-13',
    kind: 'code',
    title: '§6.5 的「情报」回报还没做',
    impact:
      '§6.5 写交付后获得「人情 / 情报 / 以物易物」三种回报。阶段 D 做了两种：' +
      '人情（trust，已在结算页显示）与以物易物（thanks：现金或一箱货）。**情报没有做** ——' +
      '它需要一个能被追加的先知日历（"提前知道 D+5 会到 -30°C"这种），' +
      '而 M1 的 `DisasterProfile.calendar` 是静态表，没有"玩家得知之后往里补一条预告"的位置。' +
      '硬做的话只能塞进 log，那它就成了一句没有作用的文本。',
    plan: 'M2（与先知日历的动态化一起做）',
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
