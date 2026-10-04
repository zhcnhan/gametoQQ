/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「家」的操作层（§10.2.4 的第三件：搬更大的家）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 它把三样东西接起来：
 *
 * | 来自 | 是什么 |
 * | --- | --- |
 * | `data/rooms.ts` | 房间表（容量 / 解锁门槛 / 开局家具） |
 * | `systems/unlock.ts` | 按进度算"现在能用哪几间" |
 * | `systems/setup.ts` 的 `addFurniture` | 真的往屋里加一块（纯函数） |
 *
 * ## ★ 顺手位为什么**不在这里**
 *
 * 用户拍板：**全屋只有一个**（§12.3 v0.7.1 那条规则不变）。
 * 所以"顺手位"不是每间房的属性，也不随房间数变化 ——
 * 它是 `Shelf.handyRank` 上一个**全屋唯一**的标记。
 * 多房间只是让"标哪一块"这个决定变难：现在你还要想"哪一间房的门口"。
 *
 * 本文件因此**一行都不碰 handyRank** —— 那是刻意的：
 * 把它写进来的话，下一个人会自然而然地以为"每间房可以各有各的顺手位"。
 */
import { ROOM_DEFS, allRoomIds, roomDefOf } from '../data/rooms';
import { addFurniture, SHELF_IDS } from './setup';
import { unlockedRoomIds } from './unlock';
import type { FurnitureKind, MetaProfile, RunState, Shelf } from '../model/types';

/** 一间房在界面上的样子 */
export interface RoomView {
  id: string;
  label: string;
  /** 这间房最多几块 */
  capacity: number;
  /** 现在几块 */
  used: number;
  /** 开局就有吗（`false` = 靠解锁拿到的） */
  starting: boolean;
  /** 这间房的家具（按 `shelves` 里的顺序 —— 界面按它排列） */
  shelves: Shelf[];
}

/**
 * 现在打开了的房间，以及每间里有什么。
 *
 * ★ 它**只列解锁了的房间**。锁着的房间不在这个列表里（界面另画一栏"还锁着什么"），
 * 因为一间空着的锁房在整理页上只会让人以为"这里能放东西"。
 */
export function roomsOf(meta: MetaProfile, run: Pick<RunState, 'shelves'>): RoomView[] {
  const open = new Set(unlockedRoomIds(meta));
  return ROOM_DEFS.filter((def) => open.has(def.id)).map((def) => {
    const shelves = run.shelves.filter((s) => roomDefOf(s.roomId).id === def.id);
    return {
      id: def.id,
      label: def.label,
      capacity: def.capacity,
      used: shelves.length,
      starting: def.unlockAt === 0,
      shelves
    };
  });
}

/**
 * 这块家具算在哪间房（认不出的 `roomId` 归到客厅）。
 *
 * 与 `roomDefOf` 的"退回客厅"是同一件事，但这里要的是**分组键**，
 * 所以必须返回同一个 id —— 否则一块 `roomId: 'room_attic'` 的家具
 * 会在界面上凭空消失（哪一组都不属于它）。
 */
export function roomKeyOf(shelf: Shelf): string {
  return roomDefOf(shelf.roomId).id;
}

/**
 * 现在能不能再加一块家具，落在哪间房。
 *
 * 返回 `null` = 每间房都满了。界面据此说"家里放不下了，去解锁新房间"——
 * 那是 §10.2.4 想要的**压力**（"更大的空间才是奖励"），
 * 而不是一句"操作失败"。
 */
export function roomForNewFurniture(
  meta: MetaProfile,
  run: Pick<RunState, 'shelves'>
): RoomView | null {
  const rooms = roomsOf(meta, run);
  // 按表的顺序：先填满客厅，再进储藏间（"新那间空着" → 旧那间堆满了才往里放）
  return rooms.find((r) => r.used < r.capacity) ?? null;
}

/**
 * 往家里加一块家具。加不下就原样返回（`added: false`）。
 *
 * ★ 为什么"加不下"是返回而不是抛：这是一个**玩法动作**，
 * 它会在"家里满了"这个正常状态下被调用（玩家的手还在点）。
 * 抛异常会让一次点击变成一次崩溃。
 */
export function addFurnitureToHome(
  meta: MetaProfile,
  run: RunState,
  kind: FurnitureKind
): { shelves: Shelf[]; added: boolean; roomId: string | null } {
  const room = roomForNewFurniture(meta, run);
  if (!room) return { shelves: run.shelves, added: false, roomId: null };
  /*
   * 交给 `setup.addFurniture` 去造 —— 它已经处理好了三件事
   * （id 唯一 / 认不出的房间退回客厅 / `handyRank` 一律 null），
   * 这里不重复实现。**顺手位全屋唯一这条约束就在那个函数里守着。**
   */
  const shelves = addFurniture(run.shelves, kind, { roomId: room.id, ids: SHELF_IDS });
  return { shelves, added: true, roomId: room.id };
}

/**
 * 开局那几块家具该怎么摆（房间表是**唯一真相**）。
 *
 * ★ 它替代了 `setup.ts` 里那个写死的 `['shelf','shelf','fridge']`。
 * 现在"开局有什么"由 `RoomDef.startingFurniture` 决定 ——
 * 加一间开局房间只要改表，不用改代码。
 */
export function startingFurniturePlan(): { roomId: string; kind: FurnitureKind }[] {
  const plan: { roomId: string; kind: FurnitureKind }[] = [];
  for (const def of ROOM_DEFS) {
    if (def.unlockAt !== 0) continue;
    for (const kind of def.startingFurniture) plan.push({ roomId: def.id, kind });
  }
  return plan;
}

/**
 * 容量体检：每间房有没有超（**只报，不删**）。
 *
 * 什么时候会超：`roomId` 认不出（退回客厅）时，一块本该在别处的家具
 * 会挤进客厅；或者将来房间容量被调小。
 *
 * ★ 为什么不自动删：**玩家的一块家具不该因为我们的数据错了而消失**。
 * 那与"存档自愈"是同一条纪律的另一面 —— 自愈只补"能算出来的默认值"，
 * 不替玩家做减法。所以这里返回给诊断用，由人决定。
 */
export function capacityCheck(meta: MetaProfile, run: Pick<RunState, 'shelves'>): string[] {
  const problems: string[] = [];
  for (const room of roomsOf(meta, run)) {
    if (room.used > room.capacity) {
      problems.push(
        `「${room.label}」放了 ${room.used} 块，超过容量 ${room.capacity} —— ` +
          `可能是某块家具的 roomId 认不出（它会退回客厅），或是容量被调小了`
      );
    }
  }
  // 认不出的 roomId 单独报一次（它是上面那个超容量的常见原因）
  const known = new Set(allRoomIds());
  for (const s of run.shelves) {
    if (!known.has(s.roomId)) {
      problems.push(`${s.id} 的 roomId「${s.roomId}」认不出 —— 它现在被算进客厅`);
    }
  }
  return problems;
}
