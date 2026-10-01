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
    title: '腐坏机制整体未实现：`ItemBatch.expiresAtDay` 没有消费者',
    impact:
      '没有任何地方拿到期日判断"这东西坏了"。§5 引擎④「同货架按保质期排好 = 零腐坏」因此没有抓手，' +
      '生存期日报里的「腐坏损耗」也永远是 0。FEFO 排序按钮目前只在"需要搬家"时有意义。',
    plan: '阶段 C（生存期每日结算）',
    markedIn: ['model/types.ts'],
    status: 'open'
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
      '「临期优先」百分比、冰箱、日报损耗行在当前里程碑里**全是装饰**。' +
      '这是玩家拍板的设计（"其他灾难保持真实，个别灾难可以延长"），不是 bug ——' +
      '任何人都不许为了让数字好看而把 0.5 改成 1。',
    plan: 'M3（热浪 spoilRate > 1 时，这套机制才真正吃紧）',
    markedIn: ['data/disaster.ts'],
    status: 'open'
  },
  {
    id: 'D-04',
    kind: 'process',
    title: 'M1 验收清单第 3 条作废：「乱档 vs 好档，腐坏损耗有可感知差异」',
    impact:
      '受 D-03 影响，M1 里腐坏恒为 0，这条验收项**在当前范围内不可能通过**。' +
      '不是没做，是范围变了。需要在验收时换成别的口径，否则会被误读成"没做完"。',
    plan: 'M1 验收改用「归位率 + 临期优先率」的存档差异；腐坏那条挪到 M3',
    markedIn: [],
    status: 'open'
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
    title: '`ItemDef.slotSize` 没有参与任何计算',
    impact:
      '大米（slotSize 4）和电池（slotSize 1）占同样一格，槽位矩阵实际是"一格一栈"。' +
      '§7 定义了这个字段却没人读它 —— 要么让它真的吃格子，要么从 §7 里删掉，现在这样悬着最差。',
    plan: '未定（需要先决定"整理的空间压力"要到什么程度）',
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
