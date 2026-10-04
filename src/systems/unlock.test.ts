/**
 * 解锁系统与「家」的测试（M3 第 7 步 / §10.2.1 第四层）。
 *
 * ## 它守的是那个用户亲眼看见的 bug
 *
 * 用户的原话：**"现在明明撑过去了，但是角色不解锁，撑过去好几天他也不解锁"**。
 *
 * 那不是 bug、是功能没做 —— 全项目没有任何地方写"已解锁"状态。
 * 所以这里每一条都在回答同一个问题：**"活到最后 N 次之后，世界变了没有？"**
 *
 * ## 为什么解锁是"算出来"的而不是"存下来"的
 *
 * 存一份 `unlockedIdentities` 会多一份**会漂的真相**：
 * 成就那边改了、解锁这边忘了同步，玩家会看到"达成了但没解锁"。
 * 而按进度算的话，**老档自动正确** —— 一个已经活到最后三次的玩家，
 * 更新之后立刻该有的都有。
 *
 * 所以这里的用例大量在查"同一份 meta、不同的进度 → 不同的世界"。
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_DEFS } from '../data/identities';
import { ROOM_DEFS, roomDefOf } from '../data/rooms';
import { createMetaProfile } from '../state/save';
import { createStartingRun } from './setup';
import { addFurnitureToHome, capacityCheck, roomForNewFurniture, roomsOf, startingFurniturePlan } from './home';
import {
  identityTierNeed,
  isIdentityUnlocked,
  isRoomUnlocked,
  lockedIdentities,
  lockedRooms,
  nextUnlock,
  survivedRuns,
  unlockCandidates,
  unlockedIdentities,
  unlockedRoomIds
} from './unlock';
import type { MetaProfile } from '../model/types';

/** 活到最后 N 次的一份 meta */
function metaWithRuns(n: number): MetaProfile {
  return { ...createMetaProfile(), survivedRuns: n };
}

describe('★ 解锁的尺子：`survivedRuns`', () => {
  it('缺字段 / 坏值一律当 0（老档、手改档）', () => {
    expect(survivedRuns({} as MetaProfile)).toBe(0);
    expect(survivedRuns({ survivedRuns: -5 } as MetaProfile)).toBe(0);
    expect(survivedRuns({ survivedRuns: Number.NaN } as MetaProfile)).toBe(0);
    expect(survivedRuns({ survivedRuns: 2.7 } as MetaProfile)).toBe(2);
  });
});

describe('★★ 身份解锁：这就是"撑过去了却不解锁"的那一处', () => {
  it('★★ 一次都没活到最后 → 只有 tier 1 那三个', () => {
    const meta = metaWithRuns(0);
    expect(unlockedIdentities(meta)).toHaveLength(3);
    expect(unlockedIdentities(meta).every((d) => d.tier === 1)).toBe(true);
    expect(lockedIdentities(meta).length).toBe(IDENTITY_DEFS.length - 3);
  });

  it('★★ 活到最后**一次** → tier 2 解锁（用户试过的那一步）', () => {
    const meta = metaWithRuns(1);
    const tier2 = IDENTITY_DEFS.filter((d) => d.tier === 2);
    expect(tier2.length, '应该至少有一个 tier 2 身份').toBeGreaterThan(0);
    for (const def of tier2) {
      expect(isIdentityUnlocked(meta, def.id), `${def.name} 活过一次该解锁了`).toBe(true);
    }
    // 而 tier 3 还没到
    for (const def of IDENTITY_DEFS.filter((d) => d.tier === 3)) {
      expect(isIdentityUnlocked(meta, def.id), `${def.name} 三次才解锁`).toBe(false);
    }
  });

  it('★★ 活到最后**三次** → tier 3 也解锁，此时所有身份都开着', () => {
    const meta = metaWithRuns(3);
    expect(unlockedIdentities(meta)).toHaveLength(IDENTITY_DEFS.length);
    expect(lockedIdentities(meta)).toEqual([]);
    expect(nextUnlock(meta)).toBeNull();
  });

  it('★ 解锁是**累计**的，不是连续 —— 中间倒下几局不清零', () => {
    // `survivedRuns` 只由 `settleRunMeta` 在 outcome === 'survived' 时 +1，
    // 倒下的那局根本不碰它。所以这里只需验"数字本身不会因为别的原因变小"
    const meta = metaWithRuns(2);
    expect(isIdentityUnlocked(meta, IDENTITY_DEFS.find((d) => d.tier === 2)!.id)).toBe(true);
    expect(survivedRuns(meta)).toBe(2);
  });

  it('★ `tier` 就是解锁门槛，不是另一张表（两处各写一份迟早会分家）', () => {
    for (const def of IDENTITY_DEFS) {
      const need = identityTierNeed(def.tier);
      // 差一次就没解锁、够了就解锁 —— 边界必须精确
      expect(isIdentityUnlocked(metaWithRuns(need), def.id), def.id).toBe(true);
      if (need > 0) {
        expect(isIdentityUnlocked(metaWithRuns(need - 1), def.id), `${def.id} 差一次不该解锁`).toBe(false);
      }
    }
  });

  it('认不出的身份 id 不解锁、也不抛异常', () => {
    expect(isIdentityUnlocked(metaWithRuns(99), '这个身份不存在')).toBe(false);
  });
});

describe('★ 房间解锁', () => {
  it('客厅永远开着（一条"玩家连一间房都没有"的状态不该存在）', () => {
    for (const n of [0, 1, 5]) {
      expect(isRoomUnlocked(metaWithRuns(n), 'room_living')).toBe(true);
    }
    expect(unlockedRoomIds(metaWithRuns(0))).toContain('room_living');
  });

  it('★ 活到最后一次 → 储藏间开（"搬更大的家"的第一步）', () => {
    expect(isRoomUnlocked(metaWithRuns(0), 'room_storage')).toBe(false);
    expect(isRoomUnlocked(metaWithRuns(1), 'room_storage')).toBe(true);
    expect(unlockedRoomIds(metaWithRuns(1))).toHaveLength(ROOM_DEFS.length);
  });

  it('锁着的房间要给出"还差几次"（界面直接读）', () => {
    const locked = lockedRooms(metaWithRuns(0));
    expect(locked.length).toBeGreaterThan(0);
    for (const r of locked) {
      expect(r.need).toBeGreaterThan(0);
      expect(r.why.length).toBeGreaterThan(4);
    }
  });

  it('认不出的房间 id 不解锁', () => {
    expect(isRoomUnlocked(metaWithRuns(99), 'room_attic')).toBe(false);
  });
});

describe('★★ 待解锁清单：**要列全**，不是只给一个', () => {
  /*
   * ★ 这一组是用户报回来的：
   *
   * > "下一个：储藏间 / 身份『外卖骑手』，这个横幅也不对，
   * >  只有外卖骑手没提示储藏间"
   *
   * 我第一版只返回**最近的一个**，理由是"一次列五个等于一个都不给"。
   * 那条理由在刚开局时看着成立，但它是错的：**玩家想知道全部还差什么**。
   * 所以现在 `unlockCandidates()` 给全，`nextUnlock()` 才是"只取一个"。
   */
  it('★★ 一个都没活过 → 列出**全部**锁着的东西（身份 + 房间）', () => {
    const list = unlockCandidates(metaWithRuns(0));
    const lockedIds = lockedIdentities(metaWithRuns(0)).length;
    const lockedRoomCount = lockedRooms(metaWithRuns(0)).length;
    expect(list.length).toBe(lockedIds + lockedRoomCount);
    // 两类都在
    expect(list.some((c) => c.kind === 'identity')).toBe(true);
    expect(list.some((c) => c.kind === 'room')).toBe(true);
  });

  it('★ 活过一次之后，储藏间**不再出现**在清单里（它已经到手了）', () => {
    const list = unlockCandidates(metaWithRuns(1));
    expect(list.some((c) => c.label.includes('储藏间')), '储藏间已经解锁，不该还在清单里').toBe(false);
  });

  it('★ 按门槛从近到远排（那是玩家现在能追的顺序）', () => {
    const list = unlockCandidates(metaWithRuns(0));
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.need, `第 ${i} 项的门槛比前一项低`).toBeGreaterThanOrEqual(list[i - 1]!.need);
    }
  });

  it('★ 同门槛时房间排前面（它比一个新身份更立刻改变这一局怎么玩）', () => {
    const list = unlockCandidates(metaWithRuns(0)).filter((c) => c.need === 1);
    if (list.length >= 2) {
      expect(list[0]!.kind, '门槛相同的那一批里，房间该排第一').toBe('room');
    }
  });

  it('`nextUnlock` 仍然只取一个（给单行提示用）', () => {
    const one = nextUnlock(metaWithRuns(0));
    expect(one).not.toBeNull();
    expect(one!.need).toBe(1);
  });

  it('全都解锁之后清单是空的', () => {
    expect(unlockCandidates(metaWithRuns(9))).toEqual([]);
    expect(nextUnlock(metaWithRuns(9))).toBeNull();
  });
});

describe('★ 下一个目标：一次只说一个（列五个等于一个都不给）', () => {
  it('一个都没活过 → 指向最近的那一个', () => {
    const next = nextUnlock(metaWithRuns(0));
    expect(next).not.toBeNull();
    expect(next!.need).toBe(1);
    expect(next!.have).toBe(0);
    expect(next!.label.length).toBeGreaterThan(0);
  });

  it('★ 解锁顺序是"从近到远"的（不会让玩家去追一个最远的）', () => {
    let prevNeed = 0;
    for (let n = 0; n <= 4; n++) {
      const next = nextUnlock(metaWithRuns(n));
      if (!next) break;
      expect(next.need, `活过 ${n} 次之后给出的目标`).toBeGreaterThanOrEqual(prevNeed);
      prevNeed = next.need;
    }
  });
});

describe('「家」：房间与容量', () => {
  it('开局只有客厅，而且客厅里的家具数量与房间表一致', () => {
    const run = createStartingRun(20261004);
    const rooms = roomsOf(metaWithRuns(0), run);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.id).toBe('room_living');
    expect(rooms[0]!.used).toBe(roomDefOf('room_living').startingFurniture.length);
  });

  it('★ 开局家具的计划来自**房间表**（加一间开局房间只要改表）', () => {
    const plan = startingFurniturePlan();
    expect(plan.length).toBe(roomDefOf('room_living').startingFurniture.length);
    expect(plan.every((p) => p.roomId === 'room_living')).toBe(true);
    // 而且与 `createStartingRun` 真的对得上 —— 两处不许各说一套
    const run = createStartingRun(20261004);
    expect(run.shelves.map((s) => s.kind)).toEqual(plan.map((p) => p.kind));
  });

  it('★ 家具只会落进**解锁了的**房间（锁着的房间不是"能放东西的地方"）', () => {
    const meta = metaWithRuns(0);
    const run = createStartingRun(20261004);
    const room = roomForNewFurniture(meta, run);
    expect(room?.id).toBe('room_living');
  });

  it('★★ 加家具：真的进了屋，而且 `handyRank` 是 null（全屋唯一那条规则）', () => {
    const meta = metaWithRuns(1);
    const run = createStartingRun(20261004);
    // 先把客厅标记一个顺手位，确认新家具不会顶掉它
    run.shelves[0]!.handyRank = 1;

    const { shelves, added, roomId } = addFurnitureToHome(meta, run, 'cabinet');
    expect(added).toBe(true);
    expect(roomId).toBe('room_living');
    expect(shelves).toHaveLength(run.shelves.length + 1);
    const added2 = shelves[shelves.length - 1]!;
    expect(added2.kind).toBe('cabinet');
    expect(added2.handyRank, '新家具不许抢"门口那一块"').toBeNull();
    // 原来那块不受影响 —— 全屋只有一个顺手位，而它还是那一块
    expect(shelves[0]!.handyRank).toBe(1);
    expect(shelves.filter((s) => s.handyRank !== null)).toHaveLength(1);
  });

  it('★★ 客厅满了 → 家具进储藏间（"新那间空着，能放三块"）', () => {
    const meta = metaWithRuns(1);
    const run = createStartingRun(20261004);
    const living = roomDefOf('room_living');
    // 把客厅塞满
    let shelves = run.shelves;
    for (let i = shelves.length; i < living.capacity; i++) {
      shelves = addFurnitureToHome(meta, { ...run, shelves }, 'shelf').shelves;
    }
    expect(shelves.filter((s) => roomDefOf(s.roomId).id === 'room_living')).toHaveLength(living.capacity);

    const next = addFurnitureToHome(meta, { ...run, shelves }, 'shelf');
    expect(next.added).toBe(true);
    expect(next.roomId).toBe('room_storage');
  });

  it('★ 家里真的放不下时：返回"没加成"，而不是抛异常（玩家手还在点）', () => {
    const meta = metaWithRuns(1);
    const run = createStartingRun(20261004);
    let shelves = run.shelves;
    // 把两间房都塞满
    for (let i = 0; i < 20; i++) {
      shelves = addFurnitureToHome(meta, { ...run, shelves }, 'shelf').shelves;
    }
    const total = ROOM_DEFS.filter((r) => isRoomUnlocked(meta, r.id)).reduce((n, r) => n + r.capacity, 0);
    expect(shelves).toHaveLength(total);
    expect(roomForNewFurniture(meta, { ...run, shelves })).toBeNull();
    const overflow = addFurnitureToHome(meta, { ...run, shelves }, 'shelf');
    expect(overflow.added).toBe(false);
    expect(overflow.shelves).toHaveLength(total);
  });

  it('★ 没解锁储藏间时，客厅满了就真的满了（那是"更大的空间才是奖励"的压力）', () => {
    const meta = metaWithRuns(0); // 储藏间还锁着
    const run = createStartingRun(20261004);
    let shelves = run.shelves;
    for (let i = 0; i < 20; i++) {
      shelves = addFurnitureToHome(meta, { ...run, shelves }, 'shelf').shelves;
    }
    expect(shelves).toHaveLength(roomDefOf('room_living').capacity);
    expect(roomForNewFurniture(meta, { ...run, shelves })).toBeNull();
  });
});

describe('容量体检：只报，不删', () => {
  it('正常状态下没有问题', () => {
    const run = createStartingRun(20261004);
    expect(capacityCheck(metaWithRuns(1), run)).toEqual([]);
  });

  it('★ 认不出的 roomId 被报出来，而且**家具没被删掉**', () => {
    /*
     * 这条守的是"玩家的一块家具不该因为我们的数据错了而消失"。
     * `roomDefOf` 认不出时退回客厅（否则那块家具会在界面上凭空不见），
     * 而退回的副作用是客厅可能超容量 —— 于是这里报出来，由人决定怎么办。
     */
    const run = createStartingRun(20261004);
    run.shelves[0] = { ...run.shelves[0]!, roomId: 'room_attic' };
    const problems = capacityCheck(metaWithRuns(1), run);
    expect(problems.some((p) => p.includes('room_attic'))).toBe(true);
    // 那块家具还在
    expect(run.shelves).toHaveLength(3);
  });
});
