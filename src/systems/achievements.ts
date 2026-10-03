/**
 * 成就结算（§10B.2 / §10B.1 的第二层）—— "承认你做到了什么"。
 *
 * ## 它在元进程链条里的位置
 *
 * ```
 * 单局 → 图鉴 → 成就 → 身份 / 家
 *        （见过）  （做到）  （下一次不同的起点）
 * ```
 *
 * 上一个环节是 `systems/codex.ts` 的 `settleRunMeta`（它把这一局该点亮的
 * 图鉴项写进 meta）。**成就必须排在它后面**：好几条成就的判据要读
 * "图鉴点亮了什么"（罐头鉴赏家 / 有水就行 / 都见过了），而图鉴的合并
 * 就发生在 `settleRunMeta` 里。顺序反了，那些成就永远慢一局才发。
 *
 * ## 三条不能破的纪律（§10B.2）
 *
 * ① **判定只读已有数据**，不许为成就新增埋点（唯一的例外是「先见之明」，
 *    那一笔的账记在 `MetaProfile.everBoughtItemIds`，而且记的是玩家
 *    真实做过的一个动作：买过）；
 * ② **成就不给数值增益**。这个文件里没有、也不许有改任何数值的代码；
 * ③ **幂等**：解锁过的成就再判一次不会重复发（`unlockAchievements` 只返回
 *    **这一次新解锁的**，写盘前先写 meta）。
 *
 * ## 它为什么是纯函数（不吃 store）
 *
 * 判定需要的全部输入都在 `{ run, meta, codex }` 里 —— 这让"重复结算会不会
 * 重复发奖"这个问题根本不会出现：同一个存档判多少次，结果都一样。
 * 写盘那一半交给 `systems/codex.ts`（它已经持有"先写 metaSettled 再发奖"
 * 那条顺序约束），避免两处各自 persist 造成两次落盘。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 */
import {
  ACHIEVEMENT_DEFS,
  ACHIEVEMENT_KIND_ORDER,
  achievementsOfKind,
  findAchievement,
  type AchievementContext,
  type AchievementDef,
  type AchievementKind
} from '../data/achievements';
import type { MetaProfile, RunState } from '../model/types';

export { ACHIEVEMENT_KIND_LABELS, ACHIEVEMENT_KIND_ORDER, achievementTotal, achievementsOfKind } from '../data/achievements';
export type { AchievementDef, AchievementKind } from '../data/achievements';

/** 一次成就结算的结果 */
export interface AchievementVerdict {
  /** 这一次**新**解锁的（已经解锁过的不会再出现在这里） */
  fresh: AchievementDef[];
  /** 解锁之后的全集（按表里的顺序）—— 成就页直接读它 */
  unlocked: AchievementDef[];
}

/**
 * 判定并解锁：算出这一局达成了哪些成就，返回新解锁的。
 *
 * **就地改 `meta`**（与 `settleRunMeta` 改 meta 的方式一致：meta 不属于 run，
 * 所以不走 `store.commit`）。调用方负责落盘。
 *
 * @param codex 合并之后的图鉴（= 生涯 ∪ 本局）。调用方必须在 `settleRunMeta` 之后传它
 */
export function unlockAchievements(meta: MetaProfile, run: RunState, codex: AchievementContext['codex']): AchievementVerdict {
  const have = new Set(meta.achievements);
  const ctx: AchievementContext = { run, meta, codex };
  const fresh: AchievementDef[] = [];

  for (const def of ACHIEVEMENT_DEFS) {
    if (have.has(def.id)) continue;
    /*
     * 判定包一层 try —— 成就**绝不允许**把结算页弄崩。
     *
     * 判据读的是存档里的 id（`everBoughtItemIds`、`codex.*`）与这一局的盘面，
     * 而存档可以被手改、云备份可以合并来一份别的版本。一个抛出去的异常会让
     * 玩家看不到结算页 —— 那比少发一个成就严重得多。
     * 判据认不出就当成"没达成"（方向是偏严的），并且**不静默**：
     * 控制台留一条，让开发期能看见。
     */
    let hit = false;
    try {
      hit = def.when(ctx);
    } catch (error) {
      /*
       * 认不出就当成"没达成"（方向是偏严的），而且**不静默**。
       *
       * ★ 这条日志在测试里也会响（`achievements.test.ts` 故意喂了一个
       * `trust: null` 的坏档来验证"不崩"）。那是**预期的**，不是噪音：
       * 那说明防线的确被走到了。看到它时不用去查测试，去看是谁在喂坏档。
       */
      console.warn(`[成就] 判据抛异常，按未达成处理：${def.id}`, error);
      hit = false;
    }
    if (!hit) continue;
    have.add(def.id);
    fresh.push(def);
  }

  if (fresh.length > 0) {
    // 排序后落盘：不然"解锁顺序"会随判定顺序而变，存档 diff 全是噪音
    // （与 `settleRunMeta` 合并 codex 时同一个做法）
    meta.achievements = [...have].sort();
  }

  return { fresh, unlocked: orderedUnlocked(meta) };
}

/** 已经解锁的成就，按表里的原始顺序排好（成就页要稳定顺序，不能随解锁先后跳） */
export function orderedUnlocked(meta: MetaProfile): AchievementDef[] {
  const have = new Set(meta.achievements);
  return ACHIEVEMENT_DEFS.filter((a) => have.has(a.id));
}

/**
 * 某一条解锁了没有。
 *
 * 认不出的 id 返回 false —— 存档里可能留着**这个版本已经没有的**成就
 * （内容调整过、或者从更新的版本降级回来），界面据此把它当"未解锁"画，
 * 而不是崩掉。
 */
export function isUnlocked(meta: MetaProfile, id: string): boolean {
  return findAchievement(id) !== null && meta.achievements.includes(id);
}

/** 分类进度：`{ 已解锁, 总数 }`。成就页的分组标题读它 */
export function progressOfKind(meta: MetaProfile, kind: AchievementKind): { have: number; total: number } {
  const all = achievementsOfKind(kind);
  return { have: all.filter((a) => meta.achievements.includes(a.id)).length, total: all.length };
}

/**
 * 已经达成、但**这个版本已经不认**的成就 id。
 *
 * 它存在的理由与开发纪律 §2.13 同一类：**不许有来历不明的状态**。
 * 成就 id 被改名或删掉之后，老存档里会留一条谁也认不出的记录 ——
 * 那本身无害，但它会让"成就页显示 N 项"与"meta 里存了 M 项"对不上，
 * 而那种对不上正是最容易被误判成 bug 的东西。所以留一个查询口，
 * 让测试和将来的迁移都能看见它。
 */
export function unknownUnlocked(meta: MetaProfile): string[] {
  return meta.achievements.filter((id) => findAchievement(id) === null);
}

/** 按分类分组（成就页按它渲染） */
export function groupByKind(defs: readonly AchievementDef[]): { kind: AchievementKind; defs: AchievementDef[] }[] {
  return ACHIEVEMENT_KIND_ORDER.map((kind) => ({
    kind,
    defs: defs.filter((d) => d.kind === kind)
  })).filter((group) => group.defs.length > 0);
}
