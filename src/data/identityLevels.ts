/**
 * 身份**熟练度**的分层与自愈（§10B.3）。
 *
 * ## 为什么这个文件在 `data/` 而不在 `systems/`
 *
 * 它只有两件事：**上限**与**清洗**。两者都是"数据口径"，没有玩法逻辑 ——
 * 而位置是**被依赖关系逼出来的**，不是随手放的：
 *
 *  · `state/save.ts` 的自愈要用 `sanitizeIdentityLevels`；
 *  · 而 `systems/setup.ts` 已经 import 了 `state/save.ts`。
 *
 * 所以只要清洗函数住在 `systems/` 里，就会形成
 * `save → systems/identity → data/identities` 与 `systems/setup → save`
 * 之间那条容易被读成环的依赖。放进 `data/` 则两边都是单向的：
 * `save → data` 与 `systems → data`。
 *
 * ★ 这类"因为 import 方向而挪位置"的决定值得写下来：否则后来者会觉得
 * "一个 20 行的函数为什么单独一个文件"，然后好心地把它合进 systems/，
 * 再撞一次同样的环。
 *
 * ## 数值口径
 *
 * 等级 1~3（§10B.3）。**没记录 = 1 级**，不是 0 —— 一个从没活到最后的身份也是能用的，
 * 它的开局参数就是 `IdentityDef` 里写的那一份。
 */
import { hasIdentityDef } from './identities';

/** 熟练度上限（§10B.3：1~3） */
export const MAX_IDENTITY_LEVEL = 3;

/**
 * 把存档里的身份等级记录整成"界面一定接得住"的形态。
 *
 * 三条自愈规则，每条都有具体来源：
 *  ① **认不出的身份 id 丢掉** —— 内容会更名，旧档里留一条谁也认不出的记录
 *     没有任何读者（与 `codex` 丢掉未知 id 同一个口径）；
 *  ② **非有限数丢掉** —— 手改档、云备份合并都可能给出 `NaN` / 字符串；
 *  ③ **越界夹到 1~3** —— `0` 或 `99` 都夹回合法区间。
 *
 * ⚠ 与 `normalizeRun` 的同一个原则：**认不出就退回默认值，绝不抛异常**。
 * 这条路在 `migrate` 里，抛出去就是"整个存档读不出来"。
 */
export function sanitizeIdentityLevels(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!hasIdentityDef(id)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[id] = Math.max(1, Math.min(MAX_IDENTITY_LEVEL, Math.round(value)));
  }
  return out;
}

/** 读一个身份当前的等级（没记录 = 1，越界夹回 1~3） */
export function clampIdentityLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_IDENTITY_LEVEL, Math.round(value)));
}
