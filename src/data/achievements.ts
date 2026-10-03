/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  成就表（§10B.2）—— "承认你做到了什么"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它与图鉴的分工（§10B.1 那条"职责不许重叠"，是整章最要紧的一句）
 *
 * > **图鉴只负责"记录你见过什么"，成就负责"承认你做到了什么"，
 * > 而身份与家负责"给你下一次不同的起点"。**
 * > 三者职责不许重叠 —— 图鉴不发光、成就才发光；成就不改数值、身份才改。
 *
 * 所以这个文件里**只有定义**，没有任何"给玩家好处"的字段。想加 `reward` 之前
 * 请先读下面那三条纪律的第 ③ 条。
 *
 * ## 三条纪律（§10B.2 原文，每一条都有理由）
 *
 * ① **判定只读已有数据。** 除「先见之明」那一小撮，不许为了成就新增埋点 ——
 *    埋点一多，"成就"就会变成"策划想要的另一套 KPI"，而这游戏不需要那个；
 * ② **达成的演出要克制但"帅"**：沿用 §5A 的纸墨朱红，一枚**朱红印章**
 *    盖在日报/结算页上；
 * ③ ★ **成就只解锁、不给数值增益。** 这是硬约束：一旦成就加数值，
 *    最早的成就就成了永久优势，后开的局再也追不上 ——
 *    这与 §4A 的"不催进度"直接冲突。
 *
 * ## 为什么条件写成函数而不是"字段 + 阈值"的声明式数据
 *
 * 试过声明式（`{ kind: 'codexTagComplete', tag: 'canned' }`），放弃的原因是
 * **它把判据的复杂度搬到了求值器里**：七八种 kind 会让 `evaluate()` 变成
 * 一个巨大的 switch，而加一条新成就就要同时改两处（表 + 求值器）——
 * 那正是 §10B.5 想消除的"加内容要动代码"。
 * 写成纯函数之后，加一条成就 = 在下面加一个对象，**别处一个字都不用改**。
 *
 * 代价说清楚：条件**不可序列化**，所以它不能像 `ItemDef` 那样从 JSON 来。
 * 这是有意的取舍 —— 成就的判据本来就是代码（它要读 `RunState` 与 `MetaProfile`
 * 的十几个字段），硬把它塞进数据只会造出一门只有它能用的表达式语言。
 */
import { ITEM_DEFS } from './items';
import { SURVIVAL_DAYS, getDisasterDef, hasDisasterDef } from './disaster';
import { NPC_DEFS } from './npcs';
import type { CategoryId, CodexState, MetaProfile, RunState } from '../model/types';

/** 成就的分类。它决定图鉴/成就页上的分组标题，也是"这批成就偏哪一类"的自查口径 */
export type AchievementKind = 'codex' | 'survival' | 'organize' | 'extreme' | 'hidden';

export const ACHIEVEMENT_KIND_LABELS: Record<AchievementKind, string> = {
  codex: '图鉴',
  survival: '生存',
  organize: '整理',
  extreme: '极端',
  hidden: '隐藏'
};

export const ACHIEVEMENT_KIND_ORDER: readonly AchievementKind[] = [
  'codex',
  'survival',
  'organize',
  'extreme',
  'hidden'
];

/**
 * 判定一条成就时能看到的全部东西。
 *
 * ★ 注意这里**没有 `store`**，也没有任何"现在几点""第几局"之类的东西。
 * 成就必须能从"这一局的账 + 生涯的账"里完全推出来 —— 这样它才是**可重放的**：
 * 同一个存档每次读出来判定结果都一样，而"读档会不会重复发成就"这种问题
 * 根本不会出现（`systems/achievements.ts` 的幂等就是这么来的）。
 */
export interface AchievementContext {
  /** 这一局（结算时读；`unlockable` 类成就要它） */
  run: RunState;
  /** 生涯账本：图鉴 / 成就 / 累计数 */
  meta: MetaProfile;
  /** 这一局**已经**点亮的图鉴三页（= 生涯 ∪ 本局，见 `settleRunMeta` 的合并顺序） */
  codex: CodexState;
}

export interface AchievementDef {
  id: string;
  /** 章名。手机竖屏一行放得下为准（≤ 10 字） */
  name: string;
  kind: AchievementKind;
  /**
   * 一句话说清**判据**，给玩家看的。
   *
   * ★ 它必须写"怎么才算达成"而不是"你真棒"。成就页上一行"未解锁"配一句
   * 模糊的赞美，等于没告诉玩家还能去做什么 —— 而收集欲正是靠那个做起来的
   * （同 §10B.2 对图鉴的要求：「未点亮的那一格要看得见轮廓与从哪儿来的提示」）。
   */
  hint: string;
  /** 判定。只会被调用一次（解锁那一刻），所以它可以是"贵"的 */
  when: (ctx: AchievementContext) => boolean;
}

// ——————————————————————————————————————————————————————————————
// 小工具：判定里反复用到的几件事
// ——————————————————————————————————————————————————————————————

/** 这一局有没有**求援订单被交付过**（人情账变正 = 给过东西出去） */
function helpedAnyone(run: RunState): boolean {
  return NPC_DEFS.some((npc) => (run.trust[npc.id] ?? 0) > 0);
}

/**
 * 这一场灾难"最缺的那几类"里，全部物资的 id。
 *
 * ★ 直接读灾难定义（唯一真相），不另抄一份快照 —— 见「先见之明」的注释。
 * id 认不出时退回空集：**成就判定绝不许抛异常**（它跑在结算页的渲染路径上，
 * 一个手改过的档会让整个结算页白屏 —— 那比少发一个成就严重得多）。
 */
function priorityItemIdsOf(disasterId: string): string[] {
  if (!hasDisasterDef(disasterId)) return [];
  const categories: readonly CategoryId[] = getDisasterDef(disasterId).priorityCategories;
  return ITEM_DEFS.filter((d) => categories.includes(d.category)).map((d) => d.id);
}

/**
 * 上面那个函数的**测试出口**（`achievements.test.ts` 用它逐场对账）。
 *
 * 为什么要专门开一个口而不是把 `priorityItemIdsOf` 直接导出：
 * 它是内部实现细节，名字不带前缀导出会让人以为它是给界面用的 API。
 * 而这个口是给测试的，名字里就写着 —— 后来者不会误用。
 */
export const priorityItemIdsOf_测试用 = priorityItemIdsOf;

// ——————————————————————————————————————————————————————————————
// 成就表
// ——————————————————————————————————————————————————————————————

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  // ———————— 图鉴类 ————————
  {
    id: 'a_canned_connoisseur',
    name: '罐头鉴赏家',
    kind: 'codex',
    hint: '点亮图鉴里全部带 canned 标签的物资',
    when: ({ codex }) => {
      const all = ITEM_DEFS.filter((d) => d.tags.includes('canned')).map((d) => d.id);
      return all.length > 0 && all.every((id) => codex.items.includes(id));
    }
  },
  {
    id: 'a_drink_full',
    name: '有水就行',
    kind: 'codex',
    hint: '点亮图鉴里全部带 drink 标签的物资',
    when: ({ codex }) => {
      const all = ITEM_DEFS.filter((d) => d.tags.includes('drink')).map((d) => d.id);
      return all.length > 0 && all.every((id) => codex.items.includes(id));
    }
  },
  {
    id: 'a_medkit_full',
    name: '药箱齐了',
    kind: 'codex',
    hint: '点亮图鉴里全部带 medkit 标签的物资',
    when: ({ codex }) => {
      const all = ITEM_DEFS.filter((d) => d.tags.includes('medkit')).map((d) => d.id);
      return all.length > 0 && all.every((id) => codex.items.includes(id));
    }
  },
  {
    id: 'a_all_disasters',
    name: '都见过了',
    kind: 'codex',
    hint: '灾难图鉴点亮 4 场',
    /*
     * ★ 口径写成"≥4"而不是"= 全部"：灾难表会一路涨到 §10B.3.2 的 112~116 场，
     * 写死"全部"的那一天，这条成就就会变成**永远拿不到**（D-16 那一类错误）。
     * 4 是"现在这张表的全部"，也是将来"新手能凑齐的第一档"。
     */
    when: ({ codex }) => codex.disasters.length >= 4
  },
  {
    id: 'a_all_npcs',
    name: '这栋楼都认识了',
    kind: 'codex',
    hint: '关系图鉴点亮全部人物',
    when: ({ codex }) => NPC_DEFS.length > 0 && NPC_DEFS.every((n) => codex.npcs.includes(n.id))
  },

  // ———————— 生存类 ————————
  {
    id: 'a_silent_winter',
    name: '不发一言的冬天',
    kind: 'survival',
    hint: `零求援活过 ${SURVIVAL_DAYS} 天`,
    when: ({ run }) =>
      run.outcome === 'survived' && run.day >= SURVIVAL_DAYS && !helpedAnyone(run)
  },
  {
    id: 'a_no_shortage',
    name: '一件没短',
    kind: 'survival',
    hint: `活过 ${SURVIVAL_DAYS} 天，而且前后一件口粮都没缺`,
    when: ({ run }) => run.outcome === 'survived' && run.survival.shortagePieces === 0
  },
  {
    id: 'a_never_unreachable',
    name: '伸手就够得到',
    kind: 'survival',
    hint: '整局没有一件东西是"在屋里却没力气翻出来"的',
    when: ({ run }) => run.outcome === 'survived' && run.survival.unreachablePieces === 0
  },
  {
    id: 'a_composed',
    name: '一路从容',
    kind: 'survival',
    hint: '整局体力从没掉到 50 以下，也没硬撑过一天',
    /*
     * 判据用 `minStamina`（历史最低）而不是 `stats.stamina`（此刻）——
     * 理由见 `SurvivalState.minStamina`：只看最后一天会把
     * "中途连续三天趴在 0 上、最后睡回来了"记成"一路从容"。
     * 这条成就的全部价值就在于"**从来没有**"，所以它必须看历史最低。
     */    when: ({ run }) => run.outcome === 'survived' && run.survival.minStamina >= 50 && run.survival.hardPressDays === 0
  },

  // ———————— 整理类 ————————
  {
    id: 'a_spotless',
    name: '一尘不染',
    kind: 'organize',
    hint: `归位率与临期优先双双 1.00，活过 ${SURVIVAL_DAYS} 天`,
    /*
     * `cleanDays` 是"每天结算时两率都满、且一件没缺"的天数（见 `SurvivalState.cleanDays`）。
     * 用它而不是"结算时现算一次"，理由写在那条字段的注释里：
     * 现算只能回答"你**最后**摆得怎么样"。
     */
    when: ({ run }) => run.outcome === 'survived' && run.survival.cleanDays >= SURVIVAL_DAYS
  },
  {
    id: 'a_all_handy',
    name: '门口那一块',
    kind: 'organize',
    hint: '一整期没让突发事件得手过一次',
    /*
     * 判据：走完 + **一次"受创"都没有**（`emergencyHurtCount === 0`）。
     *
     * ★ 注意它**不是**"标了顺手位"—— 标一下只是一个动作，而这条成就要的是结果：
     * 那几件急用的东西**每一次**都真的在够得到的地方。
     * 用它而不是 `last.emergencyResolved`：后者是今天的快照，
     * 会把"前面三次都受创、最后一次恰好化解"记成满分（见 `SurvivalState.emergencyHurtCount`）。
     */
    when: ({ run }) => run.outcome === 'survived' && run.survival.emergencyHurtCount === 0
  },

  // ———————— 极端类 ————————
  {
    id: 'a_storekeeper',
    name: '仓库管理员',
    kind: 'extreme',
    hint: '生涯累计把 300 件东西搬上货架',
    /*
     * ★ 口径是**跨局累计**（`meta.totalShelved`），不是单局。
     * 理由：一屋 72 格，单局上架 300 件在现在的空间下根本做不到，
     * 而那会让这条成就变成"挂着但永远拿不到"（D-16 那一类）。
     * 描述里必须写"累计"两个字 —— 否则玩家会以为它是一局的事。
     */
    when: ({ meta }) => meta.totalShelved >= 300
  },
  {
    id: 'a_full_house',
    name: '一格不剩',
    kind: 'extreme',
    hint: '结算时屋里还剩 200 件以上，而且撑过来了',
    when: ({ run, meta }) => run.outcome === 'survived' && meta.totalShelved >= 200
  },

  // ———————— 隐藏类（唯一的埋点增量，§10B.2 点名的） ————————
  {
    id: 'a_foresight',
    name: '先见之明',
    kind: 'hidden',
    hint: '在灾难来之前就囤下过这一场最缺的那类东西，并且撑过去了',
    /*
     * ## 这条是全案**唯一**允许新增的那一点埋点（§10B.2 原文点名）
     *
     * 判据分两半，两半都读**已有**的账：
     *  ① 生涯买过这一场的**刚需品类**里的一件东西（`meta.everBoughtItemIds`，
     *     在 `buyCart` 里顺手记 —— 那是玩家真实做过的一个动作）；
     *  ② 这一局撑过去了。
     *
     * ★ **刚需品类直接读灾难定义**（`getDisasterDef(...).priorityCategories`），
     * 不另抄一份快照。理由：两份说法一定会漂（§2.8 那条教训），
     * 而且"这一场最缺什么"本来就只有一个真相来源 —— 灾难表。
     * 存档里的 id 认不出时 `getDisasterDef` 会抛异常，所以先问 `hasDisasterDef`。
     *
     * ★ 为什么不含"在 D-7 就买"这个时间条件：那需要逐笔记"第几天买的什么"，
     * 而纪律① 把埋点增量卡得很死。好在**囤货期一结束就再也没有采购这条路**，
     * 所以"买过"天然就是"灾难来之前买的"—— 这个条件不需要记，它由设计保证。
     */
    when: ({ run, meta }) => {
      if (run.outcome !== 'survived') return false;
      const wanted = new Set(priorityItemIdsOf(run.disasterId));
      return meta.everBoughtItemIds.some((id) => wanted.has(id));
    }
  },
  {
    id: 'a_stubborn',
    name: '就是不认输',
    kind: 'hidden',
    hint: '在同一个灾难上倒下过，后来又走完了它',
    /*
     * 它奖励"输得起"这件事。
     *
     * ## ★ 这一条的描述我改了口径（原文写的是"倒下三次，第四次站住了"）
     *
     * §10B.2 的例子里写的是"三次"。但"精确数到三次"需要**逐局流水**
     * （每一局怎么结束的），而纪律① 明说不许为了成就新增埋点。
     * 现有账本能回答的是"这一场**曾经**停在中间过"（`bestSurvivalDays`
     * 停在一个小于满期的值 = 那一局倒下了），加上"这一局走完了"。
     *
     * 所以我做了两件事，而不是硬凑"三次"：
     *  ① 判据用那两半（诚实：它确实奖励了"输过又站起来"）；
     *  ② **把描述也改成判据说的那件事**，不再写"三次"。
     *
     * 为什么宁可改描述也不加埋点：一个写着"三次"、实际一次就发的成就，
     * 是**界面在骗玩家**——而"屏幕报一件没发生的事"在这个项目里被明令禁止过
     * （见 `AppliedEffect` 的注释）。宁可少一点戏剧性，也不许文案与事实不符。
     */
    when: ({ run, meta }) => {
      if (run.outcome !== 'survived') return false;
      const prev = meta.bestSurvivalDays[run.disasterId] ?? 0;
      // 上一次纪录停在中间 = 那一局倒在半路
      return prev > 0 && prev < SURVIVAL_DAYS;
    }
  }
];

/** 按 id 找一条成就 */
export function findAchievement(id: string): AchievementDef | null {
  return ACHIEVEMENT_DEFS.find((a) => a.id === id) ?? null;
}

/** 一种分类下的全部成就 */
export function achievementsOfKind(kind: AchievementKind): AchievementDef[] {
  return ACHIEVEMENT_DEFS.filter((a) => a.kind === kind);
}

/** 成就总数（成就页的"已达成 / 总数"读它） */
export function achievementTotal(): number {
  return ACHIEVEMENT_DEFS.length;
}
