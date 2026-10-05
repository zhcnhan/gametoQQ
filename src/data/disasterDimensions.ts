/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  灾难的「维度签名」（§10B.3.1）—— 用来机械地判"换皮"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它解决什么
 *
 * §10B.3.1 有一条**机械验收办法**（原文）：
 *
 * > 把全部灾难按 **17 个维度各自的取值**排成一个矩阵，
 * > **任意两场灾难如果只在前 4 个维度上不同，就必须合并或重写。**
 *
 * 它比任何"要注意内容质量"的散文有用得多 —— 因为"一百多场"退化的情况
 * 不是写得难看，而是**写着写着只剩数字在变**，而那种退化肉眼看不出来：
 * 每一场单看都合理，只有把它们排成矩阵才看得出"这 20 场是同一个东西"。
 *
 * ## 为什么这份清单必须只有一处
 *
 * 上面那条判据要问"这一场用了哪几维"。而"有几维、每维叫什么"如果散在
 * 校验脚本、生成提示词、文档三处，它们**一定会漂** —— 漂了之后
 * "只在前 4 维不同"这句话就从"查换皮"变成"查一个过时的名单"，
 * 而它**不会报错**，只会安静地放过换皮内容（§2.8 的老毛病）。
 *
 * 所以这里把 17 维写成**可执行的清单**：每一项都带"怎么从
 * `DisasterProfile` 里读它"，于是"这一场用了几维"是**算出来的**，
 * 而不是谁来数的。
 *
 * ## 分层的口径
 *
 * §10B.3.1 把前 4 维（消耗 / 腐坏 / 刚需 / 温度）定为 **L1**：
 * 只靠它们，一百场会写成"同一件事的不同数字"。所以"只在前 4 维不同"
 * 就是"还停在 L1"的同义语 —— 那正是要判不合格的那一类。
 *
 * ★ **而那 4 维里只有 3 维算数**（决策 C，2026-10 用户拍板）：第 4 维（外界温度）
 * 的唯一读点是反差层那一栏，**不改变任何玩法数值**，所以它标成 `display` ——
 * 签名里留着，但不进"用到几维"、也不参与"只在 L1 上不同"这条判据。
 * 在此之前 116 场**每一场都白送一维**，把这条判据的灵敏度整体稀释掉了。
 */
import type { DisasterProfile } from '../model/types';

/** 一维：编号、名字、以及**怎么从灾难定义里稳定地读出它的值** */
export interface DisasterDimension {
  /** §10B.3.1 表里的编号（1~17），报错信息里要用它 */
  no: number;
  /** 中文名（与策划案那张表逐字一致，免得两处对不上） */
  label: string;
  /** 这一维属于哪一层（L1 是"只改数字"的那四维） */
  tier: 'L1' | 'L2' | 'L3' | 'L4';
  /**
   * ★ **这一维只是表现，不改任何玩法数值**（决策 C，2026-10 用户拍板）。
   *
   * 它不进 `usedDimensions` —— 也就是**不算"这一场用到了几维"**。
   * 为什么必须有这个标记，而不是干脆把这一维从清单里删掉：
   *
   *  · 它仍然是**玩家看得见的一维**（`ui/SurvivalScreen` 的「室内 / 室外」那一栏），
   *    所以"两场只在温度上不同"仍然该算相似，`disasterSignature` 必须留着它；
   *  · 但它的值是**类型必填**的，于是 116 场**每一场都白送一维** ——
   *    把"用到几维"整体抬高 1。那会稀释 §10B.3.1 那条换皮判据的灵敏度：
   *    一场只写了 3 个真维度的灾难，报出来是 4 维，看起来"够 L1 了"。
   *
   * 有标记之后，"用到几维"是**算出来的**而不是数出来的（与本文件开头那条同一个道理）：
   * `Math.max` 不用手写，`check-registry` 的门槛也不必再迁就它。
   */
  display?: boolean;
  /**
   * 读值。**必须归一化**：不写与写中性值（1 / 0 / 空数组）要得到同一个结果 ——
   * 否则"这一场没写 `carryFactor`"与"写了 `carryFactor: 1`"会被当成两场不同的灾难，
   * 而它们对玩家是同一件事。
   */
  read: (d: DisasterProfile) => unknown;
}

/** 乘数类：`undefined` 与 `1` 等价（不写 = 这一维不起作用） */
const factor = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 1);
/** 增量类：`undefined` 与 `0` 等价 */
const delta = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** 列表类：排序 + 去重，顺序不算差异 */
const list = (v: readonly string[] | undefined): string => (v && v.length > 0 ? [...new Set(v)].sort().join(',') : '');
/** 映射类：按键排序后串起来 */
const map = (v: Record<string, number> | Partial<Record<string, number>> | undefined): string => {
  if (!v) return '';
  const keys = Object.keys(v).sort();
  return keys.length === 0 ? '' : keys.map((k) => `${k}=${v[k as keyof typeof v]}`).join(',');
};

/**
 * 17 个影响维度的清单，编号与 §10B.3.1 那张表**逐条对应**。
 *
 * ★ 顺序就是编号顺序。加一维时请同时改三处：`model/types.ts` 的字段、
 * 这里的一行、以及策划案那张表 —— 而 `disasterDimensions.test.ts`
 * 会守着"17 这个数字"与"每一项都读得出值"。
 */
export const DISASTER_DIMENSIONS: readonly DisasterDimension[] = [
  { no: 1, label: '每日消耗', tier: 'L1', read: (d) => map(d.dailyDrain) },
  { no: 2, label: '腐坏速度', tier: 'L1', read: (d) => d.spoilRate },
  { no: 3, label: '刚需排序', tier: 'L1', read: (d) => [...(d.priorityCategories ?? [])].sort().join(',') },
  /*
   * ★ 第 4 维（外界温度）**只是表现**（决策 C）：它的唯一读点是反差层那一栏，
   * 没有任何玩法数值挂在上面。所以它算 `display` —— 签名里留着（"两场只在温度上
   * 不同"仍然不该算换皮），但不进"用到几维"。理由写在上面的 `display` 字段注释里。
   */
  { no: 4, label: '外界温度', tier: 'L1', display: true, read: (d) => map(d.temperatures) },

  { no: 5, label: '庇护所衰减', tier: 'L2', read: (d) => delta(d.shelterDecayPerDay) },
  { no: 6, label: '休息效率', tier: 'L2', read: (d) => factor(d.restEfficiency) },
  { no: 7, label: '搬运惩罚', tier: 'L2', read: (d) => factor(d.carryFactor) },
  { no: 8, label: '行动点修正', tier: 'L2', read: (d) => delta(d.actionPointDelta) },
  /*
   * 第 9 维在那张表里是两件事（`shopSupplyFactor` / `closedShopIds`）。
   * 这里**合成一维**并串起来 —— 合成之后"货架空一半"与"关掉五金店"
   * 才算同一个维度上的不同取值；分开数会凭空多出一维，
   * 而那会让"用了几维"这个数虚高（正是这条判据不能忍的）。
   */
  { no: 9, label: '商店供应', tier: 'L2', read: (d) => `${factor(d.shopSupplyFactor)}|${list(d.closedShopIds)}` },
  { no: 10, label: '物价加成', tier: 'L2', read: (d) => delta(d.priceSurcharge) },
  { no: 11, label: '事件池权重', tier: 'L2', read: (d) => map(d.eventPoolWeights) },
  /*
   * 第 12 维同样是两件事（`npcVisitFactor` / `npcPoolIds`）。
   * ★ `npcPoolIds` 现在**还没有字段** —— 那是有意的：把这一维按"现有字段"
   * 数成 1 个会比实际少，而按表数成 2 个又读不到值。所以这里只读
   * `npcVisitFactor`，并在注释里点明缺的那一半（它属于 M3 之后的活）。
   */
  { no: 12, label: 'NPC 行为', tier: 'L2', read: (d) => factor(d.npcVisitFactor) },

  { no: 13, label: '品类效率', tier: 'L3', read: (d) => map(d.categoryEfficiency) },
  { no: 14, label: '空间限制', tier: 'L3', read: (d) => `${factor(d.capacityFactor)}|${list(d.unusableShelfIds)}` },
  { no: 15, label: '健康风险', tier: 'L3', read: (d) => delta(d.healthRiskPerDay) },
  { no: 16, label: '分数口径', tier: 'L3', read: (d) => map(d.scoreWeights as Record<string, number> | undefined) },

  /*
   * ★★ 第 17 维（独有机制）：**编号留着，字段删了**（2026-10，D-35）。
   *
   * 它原来的 `read` 读的是 `d.specialMechanics` —— 一个**引擎零读取、
   * 数据 0 场填写**的字段，而 `data/disaster.ts` 里有四条 `notes` 自己写着
   * "本场未使用维度 17，因为引擎尚未实现该字段，写了会静默失效"。
   * 那就是一根**电线接到一半的插头**：谁按表写一次 `specialMechanics: ['mask']`，
   * 校验器会放过它（它只查 key 认不认识），而玩家那一场什么都不会发生。
   *
   * 所以字段连同校验器里那半张表一起删了，**这一维只剩一个编号**：
   * `read` 恒返回 `''`（= 它自己的中性值），于是
   *   · `usedDimensions` 永远不数它 —— L4 的 14 维下限现在必须由 1~16 维凑出来，
   *     而 116 场里那四场 L4 的 `notes` 写的就是"用到维度 1~15，L4 由 1~16 维中的 15 个达成"，
   *     所以这个数本来就成立（守卫逐场验过）；
   *   · `disasterSignature` 里它也对所有场次**恒等** —— 不留"两场只在机制名上不同"
   *     这种无法验证的差异。
   *
   * ⚠ **"编号留着"不是偷懒**：`no` 是写进策划案 §10B.3.1 那张表、
   * 也被 `notes` 与生成提示词引用的**对外编号**。删掉它会把这 17 变成 16，
   * 让四场灾难的 `notes`、`docs/M3-灾难生成工单.md` 与 `docs/归档/` 里的引用
   * 一起对不上 —— 那是**改历史**，而这里要的是**别撒谎**。
   * 维度表里留一行空位，比让引用漂移便宜得多。
   *
   * 真要实现它，得先回答"一种机制该怎么落成数据"：按 §10B.5 的规矩
   * （数据不许驱动代码分支），它不能是一个名字数组，而应该落到**已有的读数**上
   * （像 `fridgeDead` 那样成为某一维的一个取值）。方案登记在 D-35。
   */
  { no: 17, label: '独有机制', tier: 'L4', read: () => '' }
];

/** 前 4 维的编号（"只在这几维上不同"= 还停在 L1） */
export const L1_DIMENSION_NOS: readonly number[] = DISASTER_DIMENSIONS.filter((d) => d.tier === 'L1').map((d) => d.no);

/**
 * 只算表现、不算"用到"的那几维（决策 C 之前是空的）。
 *
 * ★ 它单独导出来，是因为**有两个读者**：`usedDimensions`（判"用了几维"）
 * 与 `sameButL1`（判"只在 L1 上不同"）。两处都用同一个集合，
 * 才会出现"把某一维标成表现之后，换皮判据跟着一起变准"这件事 ——
 * 一处改、一处忘，判据就会分成两把尺子（§2.19 的形状）。
 */
export const DISPLAY_ONLY_NOS: readonly number[] = DISASTER_DIMENSIONS.filter((d) => d.display === true).map(
  (d) => d.no
);

/** 这一维是不是只算表现（不进"用到几维"） */
export function isDisplayOnly(no: number): boolean {
  return DISPLAY_ONLY_NOS.includes(no);
}

/**
 * 这一场灾难**用到了**哪些维度。
 *
 * 判据是"读出来的值不等于该维的中性值"。中性值由 `read` 的归一化保证：
 * 不写 `carryFactor` 与写 `1` 都读到 `1`，而 `1` 正是这一维的中性值。
 *
 * ★ 所以中性值必须写在这里、而且要写对 —— 写错一个，"这一场用了几维"
 * 就会多算或少算一维，而它是"换皮判据"的输入。
 */
const NEUTRAL: Readonly<Record<number, unknown>> = {
  1: '', // 无额外消耗
  2: 1, // 真实腐坏速度（注意：1 是中性，0.5 与 2.4 都算"用了这一维"）
  3: '', // 无刚需标注
  4: '', // 没有温度表 —— ⚠ 实际上它**是必填**的，所以这一格永远读不到（见 `display`）
  5: 0,
  6: 1,
  7: 1,
  8: 0,
  9: '1|', // 库存正常 + 不关店
  10: 0,
  11: '',
  12: 1,
  13: '',
  14: '1|',
  15: 0,
  16: '',
  17: '' // ★ 恒等于中性值（字段已删，见第 17 维那一段注释）
};

/**
 * 这一场**真的用到了**哪些维度（返回编号，升序）。
 *
 * ★ 不含 `display` 的那几维 —— 它们只是表现，不改变任何玩法数值。
 * 116 场每一场都白送一维的那笔账（决策 C）就是在这里还掉的：
 * 以前这个数**整体虚高 1**，于是"这场只写了两三个真维度"会被报成"用了四维"。
 */
export function usedDimensions(d: DisasterProfile): number[] {
  return DISASTER_DIMENSIONS.filter((dim) => {
    if (dim.display === true) return false;
    const value = dim.read(d);
    return value !== NEUTRAL[dim.no];
  }).map((dim) => dim.no);
}

/**
 * 这一场的**维度签名**：把 17 维的取值串成一个可比较的字符串。
 *
 * 两场签名相同 = 它们在玩家能感受到的每一个维度上都一样（只有文案与日历不同）——
 * 那就是"换皮"的定义。
 */
export function disasterSignature(d: DisasterProfile): string {
  return DISASTER_DIMENSIONS.map((dim) => `${dim.no}:${String(dim.read(d))}`).join('|');
}

/**
 * 只在前 4 维（而且**只在那 3 个真维度**）上不同 → 判不合格（§10B.3.1 的机械验收办法）。
 *
 * 返回一个说明字符串（合格则返回 null），调用方直接把它变成报错信息。
 *
 * ★ 判据里剔掉了 `display` 的那几维（决策 C）：在此之前，**任何**两场灾难
 * 只要温度曲线不一样，就会被算成"差了一个 L1 之外的维度"从而逃过这条判据 ——
 * 而温度是纯表现，它救不了"这两场其实是同一件事"。剔掉之后判据才真的在守内容。
 */
export function sameButL1(a: DisasterProfile, b: DisasterProfile): string | null {
  if (disasterSignature(a) === disasterSignature(b)) {
    return `「${a.name}」与「${b.name}」在全部 17 维上完全相同（换皮）`;
  }
  const differs = DISASTER_DIMENSIONS.filter(
    (dim) => dim.display !== true && dim.read(a) !== dim.read(b)
  ).map((dim) => dim.no);
  if (differs.length === 0) return null;
  const beyondL1 = differs.filter((no) => !L1_DIMENSION_NOS.includes(no));
  if (beyondL1.length === 0) {
    return (
      `「${a.name}」与「${b.name}」只在第 ${differs.join('/')} 维上不同，` +
      `全部落在 L1（消耗 / 腐坏 / 刚需）—— §10B.3.1 判这一对必须合并或重写`
    );
  }
  return null;
}
