/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  身份熟练度（§10B.3）—— "给你下一次不同的起点"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它在元进程链条里的位置
 *
 * ```
 * 单局 → 图鉴 → 成就 → 身份 / 家
 *        （见过）（做到）（下一次不同的起点）
 * ```
 *
 * 上一个环节是成就（`systems/achievements.ts`）。而这一环是**唯一一个真的改数值的**，
 * 所以 §10B.3 专门划了那条边界：
 *
 * > ★ 这一条与 §10B.2 的"成就不给数值"看似冲突，其实分工清楚：
 * > **成就是勋章（不给数值），身份熟练度是开局参数（给数值但只在开局生效）。**
 * > 写清这条边界，是为了防止后来者把两者混成一个系统。
 *
 * ## 三条硬约束（§10B.3 原文）
 *
 * ① `identityLevels` 的含义定为**熟练度**：用同一身份通关会升它的等级（1~3）；
 * ② 等级**只改开局条件**（例如"搬运工 Lv2：车载容量 +1"），
 *    **不改单局中的任何公式** —— 否则平衡会随身份等级漂移，探针全部失效；
 * ③ 升级条件要**看得出来**（界面要说清"再活到最后一次就升级"），
 *    否则它就是一个玩家永远不知道存在的隐藏数值。
 *
 * ## 为什么"只改开局"这一条是硬约束而不是洁癖
 *
 * §12 有三条**永久回归探针**（好档活 / 乱档倒 / 中途补救有用），它们的前提是
 * "同一份货 + 同一个身份 = 同一个结果"。一旦等级改到单局公式里（比如"Lv3 的
 * 每件物资更轻"），那些探针的结论就只对"某个等级"成立 ——
 * 而**没有任何测试会发现**，因为探针里用的身份永远是 1 级。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 */
import { getIdentityDef, hasIdentityDef } from '../data/identities';
import { MAX_IDENTITY_LEVEL, clampIdentityLevel } from '../data/identityLevels';
import type { IdentityDef, MetaProfile } from '../model/types';

export { MAX_IDENTITY_LEVEL } from '../data/identityLevels';

/**
 * 每一级给的**开局加成**。
 *
 * ## 为什么是这三个数、为什么这么小
 *
 *  · **+40 现金 / +3kg 车载 / +1kg 单趟** —— 大约是基准值的 4%、5%、5%；
 *  · 理由是 §6.2 的"三约束"（现金 / 车载 / 负重）本身就是**紧的**：
 *    两个身份的开局现金 780~1150 而 14 天刚需约 700~810，余裕只有一成上下。
 *    一个"每级 +10%"的加成就足以把"要不要少买两罐燃料"这个决定抹平 ——
 *    而那个决定是寒潮局唯一的核心取舍。
 *  · 所以加成的目标不是"变强"，而是**让同一个身份的第二次玩起来稍微松一点**：
 *    它奖励的是熟练，不是碾压。
 *
 * ★ 这三个数只在这里定义一次。任何"等级加多少"的读法都必须走 `applyIdentityLevel`，
 * 不许在别处再写一遍 —— 否则调平衡时一定会漏掉一处（§2.8 的老毛病）。
 */
export const LEVEL_BONUS_PER_STEP = {
  startCash: 40,
  vehicleCapacity: 3,
  carryLimit: 1
} as const;

/** 一个身份的开局参数（已经把熟练度算进去的那一份） */
export interface IdentityStart {
  identityId: string;
  /** 开局现金（含等级加成） */
  startCash: number;
  /** 车载容量 kg（含等级加成） */
  vehicleCapacity: number;
  /** 单趟手提上限 kg（含等级加成） */
  carryLimit: number;
  /** 这一局用的是几级（界面要说清"你正在用 Lv2"） */
  level: number;
  /** 升到下一级还差几次（已经满级时是 0） */
  toNext: number;
}

/**
 * 读一个身份当前的熟练度等级。
 *
 * 没记录 = **1 级**（不是 0）：一个从没活到最后的身份也是能用的，
 * 它的开局参数就是 `IdentityDef` 里写的那一份。
 *
 * ★ 清洗（越界、NaN、认不出的 id）统一走 `data/identityLevels.ts` ——
 * 那是**唯一**一处定义"合法等级"的地方，存档自愈与这里读的是同一份规则。
 * 在这里再写一遍 `Math.max(1, ...)` 就会有两份会漂的口径（§2.8）。
 */
export function levelOf(meta: MetaProfile, identityId: string): number {
  return clampIdentityLevel(meta.identityLevels[identityId]);
}

/**
 * 这个身份这一局的**开局参数**（把熟练度算进去）。
 *
 * ★ 它是"等级 → 数值"的**唯一换算点**。命令层与界面都必须走它 ——
 * 这样将来调 `LEVEL_BONUS_PER_STEP` 时只需要改一个地方，
 * 而不会出现"界面显示 +3 但实际只加了 1"这种对不上的账。
 *
 * 认不出的身份 id：退回 **0 + 空加成**，并且**不抛异常** ——
 * 它跑在开局界面的渲染路径上，一个手改过的档不该让开局页白屏
 * （与 `settleRunMeta` 里成就判定那条"绝不允许把界面弄崩"同一个口径）。
 */
export function identityStartOf(meta: MetaProfile, identityId: string): IdentityStart {
  if (!hasIdentityDef(identityId)) {
    return { identityId, startCash: 0, vehicleCapacity: 0, carryLimit: 0, level: 1, toNext: MAX_IDENTITY_LEVEL - 1 };
  }
  const def: IdentityDef = getIdentityDef(identityId);
  const level = levelOf(meta, identityId);
  const steps = level - 1;
  return {
    identityId,
    startCash: def.startCash + steps * LEVEL_BONUS_PER_STEP.startCash,
    vehicleCapacity: def.vehicleCapacity + steps * LEVEL_BONUS_PER_STEP.vehicleCapacity,
    carryLimit: def.carryLimit + steps * LEVEL_BONUS_PER_STEP.carryLimit,
    level,
    // 已经满级时是 0（界面据此说"已满"而不是"还要 0 次"）
    toNext: level >= MAX_IDENTITY_LEVEL ? 0 : 1
  };
}

/** 这个身份的开局参数（吞掉 def，只给数值 —— 界面与命令层用这个） */
export function startNumbersOf(meta: MetaProfile, identityId: string): {
  startCash: number;
  vehicleCapacity: number;
  carryLimit: number;
  level: number;
} {
  const s = identityStartOf(meta, identityId);
  return { startCash: s.startCash, vehicleCapacity: s.vehicleCapacity, carryLimit: s.carryLimit, level: s.level };
}

/**
 * 这一局用这个身份**活到了最后** → 熟练度升一级。
 *
 * ## 升级条件（口径要写清，否则玩家永远不知道自己在追什么）
 *
 * **活到最后一天**（`outcome === 'survived'`）才算。倒下的那一局不算 ——
 * 理由是它让这个数有意义：如果倒下也算，那"熟练度"量的就是**玩过几次**，
 * 而 §10B.3 写的是"用同一身份**通关**会升它的等级"。两个字不一样。
 *
 * ## 幂等
 *
 * 它由 `settleRunMeta` 调用，而那一处已经有 `run.metaSettled` 守着
 * （三个结局出口只发一次奖）。所以这里**不需要自己再守一道** ——
 * 重复加一道会让"谁负责幂等"变得说不清，而那是这类 bug 的温床。
 *
 * @returns 升级之后的新等级；没升级则返回当前等级
 */
export function raiseIdentityLevel(meta: MetaProfile, identityId: string): number {
  const current = levelOf(meta, identityId);
  if (current >= MAX_IDENTITY_LEVEL) return current;
  const next = current + 1;
  meta.identityLevels[identityId] = next;
  return next;
}

/**
 * 一个身份要"开出来"需要什么条件（§10B.3 的身份分批）。
 *
 * ★ 与灾难的 `tier` 同一个形状、同一套理由：`tier` 是内容分层，
 * 它决定"这个身份什么时候该被玩家撞上"。**现在还没有任何代码按它过滤**
 * （与 `ContentTier` 的边界说明一致）—— 但它必须先在数据里，
 * 否则等身份表涨到 16 个时就没人说得清"哪几个是新玩家一开局就该看到的"。
 *
 * 判据刻意做成函数而不是"等级 ≥ N"的声明式数据：解锁条件里混着
 * 图鉴进度、成就、与"撑过某场灾难"三种账，声明式会把复杂度搬到求值器里
 * （与 `AchievementDef.when` 同一个取舍，理由见那边的注释）。
 */
export interface IdentityUnlock {
  /** 一句话说清怎么才能选到它（界面上未解锁的卡要写这句） */
  hint: string;
  when: (meta: MetaProfile) => boolean;
}

/**
 * 一个身份"怎么才能选到它"。
 *
 * ★ 界面上未解锁的卡必须写出**这一句**（§10B.2 对图鉴的同一条道理：
 * "未点亮的那一格要看得见轮廓与从哪儿来的提示"）。而这句话只能有**一个来源** ——
 * 写在界面里的话，等解锁条件一改（M3 的第 7 步"搬更大的家"就会加一条），
 * 界面会继续说旧的规则，而**没有任何报错**。
 *
 * 判据**现在还没有任何代码按它过滤**（与 `ContentTier` 的边界说明一致）。
 * 它落在这里是为了把"M3 之后怎么解锁"这件事先钉成文字 ——
 * 而那正是将来实现解锁时唯一需要照着做的东西。
 */
export function unlockHintOf(identityId: string): string {
  if (!hasIdentityDef(identityId)) return '这个身份这个版本还不认识';
  const tier = getIdentityDef(identityId).tier;
  if (tier <= 1) return '开局就能选';
  if (tier === 2) return '用任意身份活到最后一次就解锁';
  return '活到最后三次就解锁';
}

/** 存档里那个身份的记录是否合法（自愈用：认不出的身份 id 要丢掉） */
export { sanitizeIdentityLevels } from '../data/identityLevels';
