/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  解锁系统（§10.2.1 的第四层：身份 / 家）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它补的是那个"撑过去好几天也不解锁"的缺口
 *
 * 用户的原话是"现在明明撑过去了，但是角色不解锁，撑过去好几天他也不解锁"。
 * 查下去发现**不是 bug、是功能没做**：`data/registry.ts` 里明写着
 *
 * > 更高层的等解锁功能做出来才算"可达"，而**解锁功能还没做** ——
 * > 所以这里返回 false，让图鉴与校验器都能看见这笔账
 *
 * 全项目**没有任何地方写"已解锁"状态**；`unlockHintOf()` 只产生那句提示文字。
 * 所以界面把"再活到最后一次就解锁"写在卡片上，点了却没有反应。
 *
 * ## ★ 设计决定：解锁状态**算出来**，不落盘
 *
 * 那 5 个身份原来锁着，是因为"没人判断过玩家够不够格"。
 * 所以最自然的修法是**按进度算**，而不是新增一份"已解锁列表"：
 *
 * | 做法 | 代价 |
 * | --- | --- |
 * | 存一份 `unlockedIdentities: string[]` | 多一份**会漂**的真相：成就那边改了、这边忘了同步，玩家会看到"达成了但没解锁" |
 * | **按进度算**（本文件） | 老档自动正确 —— 一个已经活到最后三次的玩家，更新后立刻该有的都有 |
 *
 * 这条与成就系统的口径一致（`systems/achievements.ts` 的判定是纯函数，
 * 吃 `{run, meta, codex}`）。**解锁是"你做到了什么"的函数，不是一份记录。**
 *
 * ## 唯一的尺子：`survivedRuns`
 *
 * 活到最后**几次**（累计，不是连续）。身份、房间、灾难都用它 ——
 * 三套解锁系统用三个不同的数字，玩家就永远说不清"我还差几局"。
 *
 * `MetaProfile.bestSurvivalDays` 也能算出"活过几次"，但它记的是**纪录**，
 * 而"活过几次"是一个**计数**。二者在"纪录被刷新"时会分家
 * （原来活过 3 次、最长 12 天；这次活到 14 天但只多了一次），
 * 所以计数要单独记（这正是存档 v18 加它的理由）。
 */
import { IDENTITY_DEFS, getIdentityDef } from '../data/identities';
import { ROOM_DEFS } from '../data/rooms';
import type { IdentityDef, MetaProfile } from '../model/types';

/**
 * 活到最后的**累计次数**。
 *
 * ★ 这是全部解锁条件唯一的输入。0 = 一次都没有。
 */
export function survivedRuns(meta: MetaProfile): number {
  const n = meta.survivedRuns;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 这个身份解锁了吗。
 *
 * `tier` 就是"要活到最后几次"：`tier 1` → 开局就能选，`tier 2` → 一次，
 * `tier 3` → 三次。**不是另一张表** —— 两处各写一份解锁条件，
 * 迟早会出现"卡片说三次、判定按两次"。
 *
 * ⚠ 这条把 `tier` 的含义**钉死**了：它从此不只表示"上手难度"，
 * 也直接就是解锁门槛。`identity.test.ts` 里有一条用例核对
 * "tier 1 恰好三个"与"高 tier 不许全面强于低 tier"，与这里互补。
 */
export function isIdentityUnlocked(meta: MetaProfile, identityId: string): boolean {
  const def = IDENTITY_DEFS.find((d) => d.id === identityId);
  if (!def) return false;
  return survivedRuns(meta) >= identityTierNeed(def.tier);
}

/** 这个身份要活到最后几次才解锁（与 `unlockHintOf` 的那句话必须一致） */
export function identityTierNeed(tier: number): number {
  if (tier <= 1) return 0;
  if (tier === 2) return 1;
  return 3;
}

/** 开局页该列出来的身份（按表里的顺序） */
export function unlockedIdentities(meta: MetaProfile): IdentityDef[] {
  return IDENTITY_DEFS.filter((d) => isIdentityUnlocked(meta, d.id));
}

/** 还锁着的身份（界面要列它们，玩家才知道有什么可追） */
export function lockedIdentities(meta: MetaProfile): IdentityDef[] {
  return IDENTITY_DEFS.filter((d) => !isIdentityUnlocked(meta, d.id));
}

/**
 * 某间房解锁了吗。
 *
 * ★ 客厅永远解锁（`unlockAt: 0`）—— 一条"玩家连一间房都没有"的状态
 * 不该存在，那会让整理页无从渲染。所以这里不查表也知道最低是 1 间。
 */
export function isRoomUnlocked(meta: MetaProfile, roomId: string): boolean {
  const def = ROOM_DEFS.find((r) => r.id === roomId);
  if (!def) return false;
  return survivedRuns(meta) >= def.unlockAt;
}

/** 现在能用哪几间房（按表里的顺序 = 界面排列顺序） */
export function unlockedRoomIds(meta: MetaProfile): string[] {
  return ROOM_DEFS.filter((r) => isRoomUnlocked(meta, r.id)).map((r) => r.id);
}

/** 还锁着的房间（含"怎么解锁"那句话，界面直接读） */
export function lockedRooms(meta: MetaProfile): { id: string; label: string; need: number; why: string }[] {
  return ROOM_DEFS.filter((r) => !isRoomUnlocked(meta, r.id)).map((r) => ({
    id: r.id,
    label: r.label,
    need: r.unlockAt,
    why: r.why
  }));
}

/**
 * 下一个能解锁的东西是什么（界面用它说"你还差几局、差的是什么"）。
 *
 * ★ 为什么给"最近的那一个"而不是全部：玩家需要的是一个**可执行的目标**。
 * 一次列出五个待解锁项，等于一条都不给。
 */
export function nextUnlock(meta: MetaProfile): { label: string; need: number; have: number; hint: string } | null {
  const have = survivedRuns(meta);
  const candidates: { label: string; need: number; hint: string }[] = [];

  for (const def of IDENTITY_DEFS) {
    const need = identityTierNeed(def.tier);
    if (need > have) candidates.push({ label: `身份「${def.name}」`, need, hint: getIdentityDef(def.id).tagline });
  }
  for (const room of ROOM_DEFS) {
    if (room.unlockAt > have) candidates.push({ label: `「${room.label}」`, need: room.unlockAt, hint: room.why });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.need - b.need);
  const best = candidates[0]!;
  return { ...best, have };
}
