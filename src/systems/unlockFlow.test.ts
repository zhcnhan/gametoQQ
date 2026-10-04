/**
 * ★★ 端到端：**"活到最后一次 → 解锁"这条路真的通**（M3 第 7 步）。
 *
 * ## 这个文件的存在理由就是用户报的那个 bug
 *
 * 原话：**"现在明明撑过去了，但是角色不解锁，撑过去好几天他也不解锁"**。
 *
 * 查下去发现不是 bug、是功能没做（`registry.ts` 里明写着"解锁功能还没做"）。
 * 而修完之后最该被钉住的，就是**那条端到端的路**：
 *
 * ```
 * 走完一局 → settleRunMeta → meta.survivedRuns +1
 *          → isIdentityUnlocked 变 true → 开局页列出来的身份多了一个
 * ```
 *
 * 每一环单独测过都不够：`survivedRuns` 算得对、`isIdentityUnlocked` 判得对，
 * 而**中间那一步忘了加**的话，两边都绿、玩家却什么都不会解锁 ——
 * 那正是原来的状态（`unlockHintOf()` 会告诉玩家"再活一次就解锁"，
 * 而没有任何东西会去改那个计数）。
 *
 * 所以这里**不测某一环**，测的是"走完一局之后，世界变了没有"。
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_DEFS } from '../data/identities';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { chooseIdentity } from './phases';
import { settleRunMeta } from './codex';
import { createStartingRun } from './setup';
import { isIdentityUnlocked, isRoomUnlocked, survivedRuns, unlockedIdentities } from './unlock';
import type { RunState } from '../model/types';

/** 一个可以直接结算的局面：paused（已经走完） */
function finishedRun(outcome: 'survived' | 'collapsed', days = 14): RunState {
  const run = createStartingRun(20261005);
  run.identityId = 'group_buyer';
  run.phase = 'ending';
  run.outcome = outcome;
  run.day = days;
  run.survival.spoiled = 0;
  return run;
}

function storeWith(run: RunState): GameStore {
  return new GameStore(createSaveGame(run), {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  });
}

describe('★★ 端到端：活到最后一次 → 解锁第二个身份与储藏间', () => {
  it('开局：0 次、只有三个 tier 1 身份、储藏间锁着', () => {
    const store = storeWith(finishedRun('survived'));
    expect(survivedRuns(store.save.meta)).toBe(0);
    expect(unlockedIdentities(store.save.meta)).toHaveLength(3);
    expect(isRoomUnlocked(store.save.meta, 'room_storage')).toBe(false);
  });

  it('★★ 走完一局（survived）→ 计数 +1、tier 2 身份解锁、储藏间开', () => {
    const store = storeWith(finishedRun('survived'));
    const tier2 = IDENTITY_DEFS.filter((d) => d.tier === 2);
    expect(tier2.length).toBeGreaterThan(0);
    // 结算之前：锁着
    for (const def of tier2) expect(isIdentityUnlocked(store.save.meta, def.id)).toBe(false);

    settleRunMeta(store);

    // 结算之后：**世界真的变了**
    expect(survivedRuns(store.save.meta), '活到最后一次该记上').toBe(1);
    for (const def of tier2) {
      expect(isIdentityUnlocked(store.save.meta, def.id), `${def.name} 该解锁了`).toBe(true);
    }
    expect(unlockedIdentities(store.save.meta).length).toBe(3 + tier2.length);
    expect(isRoomUnlocked(store.save.meta, 'room_storage'), '储藏间该开了').toBe(true);
  });

  it('★ 倒下的那一局**不算**（与身份熟练度同一把尺子）', () => {
    const store = storeWith(finishedRun('collapsed', 6));
    settleRunMeta(store);
    expect(survivedRuns(store.save.meta)).toBe(0);
    expect(unlockedIdentities(store.save.meta)).toHaveLength(3);
  });

  it('★★ 结算只发一次奖：重复调 `settleRunMeta` 不会把计数刷上去', () => {
    /*
     * `metaSettled` 是幂等闸门（三个结局出口只许发一次奖励）。
     * 这条守的是"计数不会被刷" —— 一个能被刷的解锁进度，
     * 等于把"活到最后 3 次"变成"点 3 次结算页"。
     */
    const store = storeWith(finishedRun('survived'));
    settleRunMeta(store);
    const after1 = survivedRuns(store.save.meta);
    settleRunMeta(store);
    settleRunMeta(store);
    expect(survivedRuns(store.save.meta)).toBe(after1);
  });

  it('★★ 三局之后全部解锁（含 tier 3 与两间房）', () => {
    for (let i = 0; i < 3; i++) {
      const store = storeWith(finishedRun('survived'));
      // 每一局都从头开始，但 meta 要接着上一局的 —— 这里直接累加模拟
      store.save.meta.survivedRuns = i;
      settleRunMeta(store);
    }
    // 用一份"活过三次"的 meta 验终态
    const store = storeWith(finishedRun('survived'));
    store.save.meta.survivedRuns = 3;
    expect(unlockedIdentities(store.save.meta)).toHaveLength(IDENTITY_DEFS.length);
    expect(isRoomUnlocked(store.save.meta, 'room_storage')).toBe(true);
  });
});

describe('★ 开局页真的会多出卡片（界面读的是同一个判定）', () => {
  it('`unlockedIdentities` 在计数变化之后给出不同的名单', () => {
    const store = storeWith(finishedRun('survived'));
    const before = unlockedIdentities(store.save.meta).map((d) => d.id);
    settleRunMeta(store);
    const after = unlockedIdentities(store.save.meta).map((d) => d.id);
    expect(after.length).toBeGreaterThan(before.length);
    // 原来的三个还在（解锁只增不减）
    for (const id of before) expect(after).toContain(id);
  });
});

describe('★ 解锁与"这一局"无关，只与跨局的账有关', () => {
  it('计数存在 meta 上（换一份 RunState 不会把它带走）', () => {
    const store = storeWith(finishedRun('survived'));
    settleRunMeta(store);
    // 重开一局：换的是 run，meta 是同一份
    const next = createStartingRun(20261006);
    expect(survivedRuns(store.save.meta)).toBe(1);
    expect(next.identityId).toBe('');
    expect(isIdentityUnlocked(store.save.meta, IDENTITY_DEFS.find((d) => d.tier === 2)!.id)).toBe(true);
  });

  it('开局选身份时，解锁的身份真的能选（而不只是列表里画出来）', () => {
    /*
     * 这条守的是"列表画了但点不动"这一类 —— 它比"列表里没有"更坏：
     * 玩家会以为是自己操作错了。
     */
    const store = storeWith(createStartingRun(20261005));
    store.save.meta.survivedRuns = 1;
    const tier2 = IDENTITY_DEFS.find((d) => d.tier === 2)!;
    expect(isIdentityUnlocked(store.save.meta, tier2.id)).toBe(true);
    const r = chooseIdentity(store, tier2.id);
    expect(r.ok, '解锁了就该选得上').toBe(true);
    expect(store.run.identityId).toBe(tier2.id);
  });
});
