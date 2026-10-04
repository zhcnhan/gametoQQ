/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  房间表（§10.2.4 第 3 件：「搬更大的家」）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它解决的是 D-08 / D-22
 *
 * 原来"家"是**写死的 1 房间 × 3 块家具**：`ROOM_ID` 一个常量、
 * `createStartingShelves` 里一个三元数组。房间名只出现在文案里，
 * 而 `Shelf.roomId` 存着却**没有任何地方读它** —— 也就是说"多房间"
 * 在地基上留了位置，可惜**没留全**。
 *
 * ## 房间的两个属性
 *
 * | 属性 | 它管什么 |
 * | --- | --- |
 * | `capacity` | 这间房**最多放几块**家具 —— 它是"搬更大的家"真正的约束 |
 * | `unlockAt` | 要**活到最后几次**才解锁（0 = 开局就有） |
 *
 * ★ 为什么容量长在**房间**上，而不是长在"家"上：
 * 因为 §10.2.4 的奖励是"**多一间房**"，而玩家立刻能感觉到的差别是
 * "新那间空着，能放三块"。一个"全屋上限 +1"的数字不会给人这种感觉。
 *
 * ★ 顺手位**刻意不在这里**：它是**全屋唯一**的（§12.3 v0.7.1 玩家拍板），
 * 所以它不能是"每间房一个"的属性。见 `model/types.ts` 的 `Shelf.handyRank`。
 */
import type { FurnitureKind } from '../model/types';

/** 房间定义 */
export interface RoomDef {
  id: string;
  /** 界面上的名字（"客厅"、"储藏间"） */
  label: string;
  /** 这间房**最多放几块**家具 */
  capacity: number;
  /**
   * 要**活到最后几次**才解锁（`0` = 开局就有）。
   *
   * 与身份的解锁用**同一把尺子**（`survivedRuns`）——
   * 两套解锁系统用两个不同的数字，玩家就永远说不清"我还差几局"。
   */
  unlockAt: number;
  /** 一句话说清它值得解锁在哪儿（界面要显示） */
  why: string;
  /**
   * 开局时就在这间房里的家具（`kind` 列表，按顺序）。
   *
   * ★ 只对 `unlockAt === 0` 的房间有意义。后解锁的房间**开局是空的** ——
   * 那是"新那间空着，能放三块"这句话的落地。
   */
  startingFurniture: readonly FurnitureKind[];
}

/** 客厅：老 `ROOM_ID` 就是它，名字沿用（存档里存着这个字符串） */
export const LIVING_ROOM_ID = 'room_living';

export const ROOM_DEFS: readonly RoomDef[] = [
  {
    id: LIVING_ROOM_ID,
    label: '客厅',
    // 开局 3 块 + 还能再加 3 块。上限不是随手取的：
    // 6 块 × 24 格 = 144 格，而 §10.2.6 的目标是"单局上架 300 件"——
    // 所以光靠客厅**到不了**，玩家终究要解锁第二间房。那是设计。
    capacity: 6,
    unlockAt: 0,
    why: '一开始就有。三块家具 + 三块的空位',
    startingFurniture: ['shelf', 'shelf', 'fridge']
  },
  {
    id: 'room_storage',
    label: '储藏间',
    /*
     * 三块。比客厅小，而且**只有货架**（没有冰箱）——
     * 那是刻意的：它奖励的是"能放更多"，不是"更好的家具"。
     * 把最好的家具塞进新房间，会让旧房间在解锁那一刻变成累赘。
     */
    capacity: 3,
    unlockAt: 1,
    why: '活到最后一次就能开。三块空位，适合堆耐放的东西',
    startingFurniture: []
  }
];

const BY_ID = new Map(ROOM_DEFS.map((r) => [r.id, r]));

export function hasRoomDef(roomId: unknown): roomId is string {
  return typeof roomId === 'string' && BY_ID.has(roomId);
}

/**
 * 取一间房的定义。认不出的 id **退回客厅**，不抛异常。
 *
 * 为什么是"退回"而不是"抛"：`roomId` 存在存档里（可手改、可来自旧版本、
 * 将来还可能来自 mod）。一块认不出房间的家具**不该让整局打不开** ——
 * 与 `furnitureDefOf` 认不出 kind 时退回普通货架是同一条纪律。
 *
 * ⚠ 退回客厅有一个副作用值得知道：一块本该在"储藏间"的家具会挤进客厅，
 * 于是客厅可能超出容量。`systems/home.ts` 的 `capacityCheck()` 会把这种情况
 * 报出来（只报，不删 —— **玩家的一块家具不该因为我们的数据错了而消失**）。
 */
export function roomDefOf(roomId: string | undefined): RoomDef {
  return (roomId ? BY_ID.get(roomId) : undefined) ?? ROOM_DEFS[0]!;
}

/** 全部房间的 id，按表里的顺序（界面按它排列） */
export function allRoomIds(): string[] {
  return ROOM_DEFS.map((r) => r.id);
}
