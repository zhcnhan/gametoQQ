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
import { NEVER_TRADED } from './survival';
import type { CategoryId, CodexState, MetaProfile, RunState } from '../model/types';

/**
 * 成就的分类。它决定图鉴/成就页上的分组标题，也是"这批成就偏哪一类"的自查口径
 */
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
 * ★★ 成就的**等级**（2026-10 用户要的："难度低的和难度高的都用不同的炫酷特效标记，分等级"）。
 *
 * ## 为什么等级要写成数据字段，而不是按 `kind` 猜
 *
 * 用户的原话：
 *
 * > "给一些灾难弄一些特殊的成就，还有各类奇葩成就，反正多弄一点有收集感，
 * >  难度低的和难度高的都用不同的炫酷特效标记，分等级"
 *
 * `kind` 回答的是"这条成就偏哪一类"（图鉴 / 生存 / 整理…），
 * 而"有多难"是**另一条轴** —— 同为 `survival`，「活过 14 天」与
 * 「一件口粮都没缺地活过 14 天」差着量级。用 `kind` 当难度会当场错。
 *
 * 所以等级是一条独立的数据，**评审时逐条标**，由测试盯着三条性质：
 *  ① 每一档都要有人（不许出现空档，否则"分等级"在界面上看不出来）；
 *  ② 高档不许比低档**更容易**（人工评审，测试只能钉"存在性"与分布）；
 *  ③ 印章的视觉差异必须真的存在（见 `ui/CodexScreen.ts` 的 `sealClassOf`）。
 */
export type AchievementRank = 'common' | 'rare' | 'epic';

export const ACHIEVEMENT_RANK_LABELS: Record<AchievementRank, string> = {
  common: '常',
  rare: '罕',
  epic: '极'
};

/** 从低到高。界面按它排序，测试按它核"每一档都有人" */
export const ACHIEVEMENT_RANK_ORDER: readonly AchievementRank[] = ['common', 'rare', 'epic'];

export interface AchievementDef {
  id: string;
  /** 章名。手机竖屏一行放得下为准（≤ 10 字） */
  name: string;
  kind: AchievementKind;
  /** ★ 难度等级（决定印章的样式与分量，见 `AchievementRank`） */
  rank: AchievementRank;
  /**
   * 只属于**某一场灾难**的成就（用户要的"给一些灾难弄一些特殊的成就"）。
   *
   * 填了它之后，成就卡上会多一行"寒潮"这样的小字，图鉴那页也能按灾难收拢 ——
   * 而**判据里仍然要自己写** `run.disasterId === '...'`：
   * 这个字段是**给人看的分类**，不是判据（两处合一的话，
   * 加一条只改一半就会造出"标着寒潮、判定却与灾难无关"的假标签）。
   */
  disaster?: string;
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
    rank: 'rare',
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
    rank: 'common',
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
    rank: 'common',
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
    rank: 'common',
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
    rank: 'rare',
    hint: '关系图鉴点亮全部人物',
    when: ({ codex }) => NPC_DEFS.length > 0 && NPC_DEFS.every((n) => codex.npcs.includes(n.id))
  },

  // ———————— 生存类 ————————
  {
    id: 'a_silent_winter',
    name: '不发一言的冬天',
    kind: 'survival',
    rank: 'rare',
    hint: `零求援活过 ${SURVIVAL_DAYS} 天`,
    when: ({ run }) =>
      run.outcome === 'survived' && run.day >= SURVIVAL_DAYS && !helpedAnyone(run)
  },
  {
    id: 'a_no_shortage',
    name: '一件没短',
    kind: 'survival',
    rank: 'rare',
    hint: `活过 ${SURVIVAL_DAYS} 天，而且前后一件口粮都没缺`,
    when: ({ run }) => run.outcome === 'survived' && run.survival.shortagePieces === 0
  },
  {
    id: 'a_never_unreachable',
    name: '伸手就够得到',
    kind: 'survival',
    rank: 'common',
    /*
     * ★ M4 W-03 改过注释（判据没动，但"它问的是哪件事"变清楚了）。
     *
     * 这一条只问**结果**：整局有没有出现过"屋里有货、你却拿不到"。
     * 它**不区分原因** —— 累趴了也好、没铺顺手位也好，只要发生了就不给。
     * 那是它该守的东西：「一次都没落到那一步」是一件完整的事。
     *
     * 而"失败到底是哪一种"由整理类的 `a_handy_gap` 回答 ——
     * 两条名字里各有一个字是刻意的：**够得到**（结果）对**够不着**（原因）。
     * 它们分属两个分类（`survival` / `organize`）也正是这个意思：
     * 一个说你活得下来，一个说你摆得对。
     */
    hint: '整局没有一件东西是"在屋里却没力气翻出来"的',
    when: ({ run }) => run.outcome === 'survived' && run.survival.unreachablePieces === 0
  },
  {
    id: 'a_composed',
    name: '一路从容',
    kind: 'survival',
    rank: 'epic',
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
    id: 'a_handy_gap',
    name: '够不着的那几件',
    kind: 'organize',
    rank: 'rare',
    /*
     * ## 为什么这一条必须与 `a_never_unreachable` 分开（M4 W-03）
     *
     * 账本上原来只有一个 `unreachablePieces`，它把两件**解决办法完全相反**的事
     * 记成了同一笔：**体力透支**（睡一觉、少干点重活就好）与
     * **顺手位没铺到**（只能在整理期改）。合成一笔的表现是两条路都读不出
     * 自己那一半 —— 玩家既不知道"我差点因为累而失败"，也不知道"东西其实就在屋里"。
     *
     * 判据的两半都是必须的：
     *  · `unreachablePieces > 0` —— 得**真的发生过**那次够不着。
     *    否则一局从没累趴的人会白拿这条，而它问的恰恰是"那一刻"的事；
     *  · `handyGapPieces === 0` —— 而那一次**顺手位全部接住了**。
     *    这就是 §5「应急货架」在意整盘整理里最锋利的一次兑现：
     *    你累到翻不动，门口那几件还是把你这一天接了下来。
     *
     * ⚠ 它**不是**「它替你挡下了」（`a_handy_saved`，那是突发事件口径）。
     * 这一条管的是**日常消耗** —— 每天都要吃饭，每天都可能累趴。
     *
     * ★ 与 `a_never_unreachable` 分属两个分类也是刻意的：那条说"你活得下来"（`survival`），
     * 这条说"你摆得对"（`organize`）。名字里各有一个字是那对区别：
     * **够得到**（结果）对**够不着**（原因）。
     */
    hint: `${SURVIVAL_DAYS} 天里，每一次"翻不动"都是顺手位接住的`,
    when: ({ run }) =>
      run.outcome === 'survived' && run.survival.unreachablePieces > 0 && run.survival.handyGapPieces === 0
  },
  {
    id: 'a_spotless',
    name: '一尘不染',
    kind: 'organize',
    rank: 'epic',
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
    rank: 'rare',
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
  {
    id: 'a_handy_saved',
    name: '它替你挡下了',
    kind: 'organize',
    rank: 'rare',
    /*
     * ★ M4 第五组：顺手位的**存在感**第一次有了一条能拿的成就。
     *
     * ## 为什么阈值是 5 而不是 1
     *
     * 1 次在 14 天里几乎必然发生（`EMERGENCY_CHANCE = 0.3` → 期望约 4 次，
     * 而只要玩家往顺手位放了东西，化解是大概率）。门槛低到"顺手做了就对"
     * 的成就不会让人记住它 —— 而这一条存在的全部目的就是**让人记住顺手位起过作用**。
     * 5 次要求的是"整期几乎每一次都接住了"，也就是 §6.3 应急可达率的意志。
     *
     * ⚠ 它**与 `a_all_handy` 不重叠**：那条问"一次都没失手"（`emergencyHurtCount === 0`，
     * 没抽到突发事件的局也成立），这条问"真的用上了几次"（`emergencySavedCount`）。
     * 一个从没被检查过的人拿得到前者、拿不到后者 —— 这正是新增那本账的理由。
     */
    hint: '一整期里，顺手位上的东西至少有 5 次真的顶上了',
    when: ({ run }) => run.outcome === 'survived' && run.survival.emergencySavedCount >= 5
  },
  {
    id: 'a_handy_habit',
    name: '门口那一块一直没空着',
    kind: 'organize',
    rank: 'epic',
    /*
     * ## 为什么这一条必须是**跨局**的
     *
     * 与「仓库管理员」同一个理由（`meta.totalShelved` 那段论证）：
     * 单局 14 天里突发事件的期望次数只有 4 次左右，**要求 10 次，
     * 单局根本做不到** —— 那就是 D-16 那一类错误（挂着一个当前内容下
     * 永远拿不到的成就）。
     *
     * ★ 它是 §10.1A 铁则（"任何东西都要让我有感知"）在成就这一侧的落点：
     * 顺手位起作用的时候屏幕上什么都没发生，所以它的价值只能靠
     * **跨局累计的一个数**来兑现。描述里必须写"累计"两个字。
     */
    hint: '生涯累计让顺手位挡下 10 次意外',
    when: ({ meta }) => meta.totalEmergenciesSaved >= 10
  },

  // ———————— 极端类 ————————
  {
    id: 'a_storekeeper',
    name: '仓库管理员',
    kind: 'extreme',
    rank: 'common',
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
    rank: 'common',
    hint: '结算时屋里还剩 200 件以上，而且撑过来了',
    when: ({ run, meta }) => run.outcome === 'survived' && meta.totalShelved >= 200
  },

  // ———————— 隐藏类（唯一的埋点增量，§10B.2 点名的） ————————
  {
    id: 'a_foresight',
    name: '先见之明',
    kind: 'hidden',
    rank: 'rare',
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
    rank: 'common',
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
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  2026-10 新增（用户要的"多弄一点有收集感 + 各类奇葩成就"）
  // ═══════════════════════════════════════════════════════════════════════
  //
  // ⚠ **判据只读已有的账**（纪律①）：下面用到的字段全都在 `SurvivalState` /
  // `MetaProfile` 里躺着，**一个新埋点都没有加**。而 `run.survival.*` 是
  // **单局累计值**（不是最后一天的快照），所以"一整期都没……"这类判据是成立的 ——
  // 这一条很要紧：拿快照写会造出"最后一天恰好没发生就算数"的假成就。

  // ———————— 灾难专属（用户点名的"给一些灾难弄一些特殊的成就"）————————
  {
    id: 'a_disaster_cold_fuel',
    name: '烧得起',
    kind: 'survival',
    rank: 'rare',
    disaster: 'cold_snap',
    hint: '寒潮局撑过 14 天，而且一件口粮都没缺过',
    /*
     * ★ 判据用 `shortagePieces === 0`（整局一件都没缺）而不是"燃料够不够"——
     * 后者要按品类分摊缺口，而账本只记总件数。
     * 所以描述写的是"一件口粮都没缺过"，与判据**逐字对应**：
     * 宁可描述朴素，不许描述撒谎（这条项目里立过好几次）。
     */
    when: ({ run }) =>
      run.disasterId === 'cold_snap' && run.outcome === 'survived' && run.survival.shortagePieces === 0
  },
  {
    id: 'a_disaster_heat_water',
    name: '一件没坏',
    kind: 'survival',
    rank: 'rare',
    disaster: 'heat_wave',
    hint: '热浪局撑过 14 天，而且一件东西都没在屋里放坏',
    when: ({ run }) =>
      run.disasterId === 'heat_wave' && run.outcome === 'survived' && run.survival.spoiled === 0
  },
  {
    id: 'a_disaster_flood_low',
    name: '高处见',
    kind: 'organize',
    rank: 'epic',
    disaster: 'flood_urban',
    hint: '洪水局撑过 14 天，而且没有一件东西是"在屋里却没力气翻出来"的',
    when: ({ run }) =>
      run.disasterId === 'flood_urban' && run.outcome === 'survived' && run.survival.unreachablePieces === 0
  },
  {
    id: 'a_disaster_blackout_cold',
    name: '摸黑也找得到',
    kind: 'organize',
    rank: 'rare',
    disaster: 'blackout_winter',
    /*
     * ⚠ 判据改过一次，值得记：我第一版写的是 `run.survival.scattered === 0`
     * （"那几次翻找一行都没翻乱"）—— 而 `scattered` **只在当日快照
     * `survival.last` 上**（`SurvivalState` 里没有累计值），所以那个判据
     * 问的是"最后一天有没有翻乱"，不是"整局"。`tsc` 当场把它挡下来了。
     *
     * ★ 这正是 `emergencyHurtCount` 的注释里写过的那个坑：
     * **快照回答"现在"，累计回答"历史"** —— 写成就时用错一个，
     * 就会造出"最后一天恰好没发生就算数"的假成就。
     * 所以这里换成 `cleanDays`（每日累计的"这一天挑不出毛病"）。
     */
    hint: '大停电局撑过 14 天，而且有 5 天整理得挑不出毛病',
    when: ({ run }) =>
      run.disasterId === 'blackout_winter' && run.outcome === 'survived' && run.survival.cleanDays >= 5
  },
  {
    id: 'a_disaster_dust_air',
    name: '喘得上气',
    kind: 'survival',
    rank: 'rare',
    disaster: 'sandstorm_air',
    hint: '沙暴局撑过 14 天，而且一天都没硬撑过',
    when: ({ run }) =>
      run.disasterId === 'sandstorm_air' && run.outcome === 'survived' && run.survival.hardPressDays === 0
  },

  // ———————— 奇葩类（做得到、但你想不到自己会做到）————————
  {
    id: 'a_never_handy',
    name: '就是没用顺手位',
    kind: 'organize',
    rank: 'rare',
    hint: '整局一件东西都没放进顺手位，还是撑过来了',
    /*
     * ★ 这是一条**反着奖励**的成就：它承认另一种活法（§5 引擎①「不整理也能活」）。
     *
     * 判据的两半各有讲究：
     *  · `emergencyHurtCount > 0` —— 说明突发事件**真的得手过**，
     *    也就是他没靠顺手位躲过任何一次（与「门口那一块」正好互为反面）；
     *  · `unreachablePieces === 0` —— 他一次都没落到"有货却翻不出来"，
     *    所以这不是"运气好"，是**真的靠别的方式活下来了**。
     */
    when: ({ run }) =>
      run.outcome === 'survived' && run.survival.unreachablePieces === 0 && run.survival.emergencyHurtCount > 0
  },
  {
    id: 'a_spoil_feast',
    name: '坏了个够',
    kind: 'extreme',
    rank: 'common',
    hint: '一局里放坏了 20 件以上',
    /// 它**奖励失败**：把"我囤了一屋子、最后全烂了"变成一个可以收集的结果。
    when: ({ run }) => run.survival.spoiled >= 20
  },
  {
    id: 'a_no_medicine',
    name: '一片药没吃',
    kind: 'survival',
    rank: 'rare',
    /*
     * ## ★ 这条的判据改过两次，两次都是"用了只活在当天的快照"
     *
     *  ① 第一版：`run.survival.usedMedicine === 0` —— `tsc` 当场挡住了
     *     （那个字段在 `survival.last` 上，不在 `SurvivalState` 上）；
     *  ② 第二版：换成 `emergencyHurtCount === 0`，而它与已有的
     *     「门口那一块」**判据完全相同**（那是一条重复成就，比没有更糟：
     *     玩家会看到两枚一模一样的印章）。
     *
     * 现在用的是 `shelter` 的**终值**：它不问"你有没有用药"，
     * 而问"**你根本没用上**"——屋子一直没垮，所以药箱是满的。
     * 这与「屋里一直暖和」是同一条链的两端，但那一条读的是"有没有硬撑"
     * （四维层面），这一条读的是终局庇护所（屋子本身还成不成个家）。
     */
    hint: '撑过 14 天，而且到最后屋子还是好好的（庇护所没跌破 60）',
    when: ({ run }) => run.outcome === 'survived' && run.stats.shelter >= 60
  },
  {
    id: 'a_warm_house',
    name: '屋里一直暖和',
    kind: 'survival',
    rank: 'common',
    hint: '撑过 14 天，而且一次都没硬撑过',
    when: ({ run }) => run.outcome === 'survived' && run.survival.hardPressDays === 0
  },
  {
    id: 'a_no_trade',
    name: '一次门都没敲',
    kind: 'hidden',
    rank: 'rare',
    hint: '撑过 14 天，而且一次都没拿东西去换',
    when: ({ run }) => run.outcome === 'survived' && run.survival.lastTradeDay <= NEVER_TRADED
  },
  {
    id: 'a_safe_streak_7',
    name: '连着七天没出事',
    kind: 'survival',
    rank: 'rare',
    hint: '连续 7 天没缺口、没翻不出来、也没硬撑',
    when: ({ run }) => run.outcome === 'survived' && run.survival.safeStreak >= 7
  },
  {
    id: 'a_clean_half',
    name: '半程不犯错',
    kind: 'organize',
    rank: 'rare',
    hint: '有 7 天做到"归位率与临期优先双满、一件没缺"',
    /**
     * 它是「一尘不染」（要求 14 天**每天**满分）的**中间档** ——
     * 那一条在当前内容下近乎不可达，而"中间档"正是用户要的"收集感"：
     * 一条追不到顶的成就只会让人放弃那一整栏。
     */
    when: ({ run }) => run.outcome === 'survived' && run.survival.cleanDays >= 7
  },
  {
    id: 'a_hoarder_500',
    name: '搬了五百件',
    kind: 'extreme',
    rank: 'common',
    hint: '生涯累计把 500 件东西搬上货架',
    when: ({ meta }) => meta.totalShelved >= 500
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
