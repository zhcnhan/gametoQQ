import { describe, expect, it } from 'vitest';
import { ZONE_COLORS } from '../data/palette';
import { getItemDef } from '../data/items';
import { getStack, placementRate, rowZoneId } from '../model/shelf';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { applyZone, assignZone, createOrganizeSession, deleteZone, placeHeld, takeFromBox } from './organize';
import { createStartingRun } from './setup';

/**
 * ★ 粒度从「一块货架」变成「一行」（用户拍板 2026-10）。
 *
 * 老用例里满篇是 `shelf.zoneId`，而现在一行一个。为了不让这些用例
 * 退化成"逐行写四遍"，这里给两个读法：
 *
 *  · `rowZones(shelf)` —— 这块货架每一行的胶带 id（没贴是 null）；
 *  · `onlyZone(shelf)` —— **整块贴着同一张**时返回它的 id，否则 null。
 *    它正是老 `zoneId` 的语义（`applyZone` 不给 `rows` 时默认整块），
 *    所以用它改那些用例是**保义**的，不是把断言放松了。
 */
function rowZones(shelf: { h: number } & Parameters<typeof rowZoneId>[0]): (string | null)[] {
  return Array.from({ length: shelf.h }, (_, row) => rowZoneId(shelf, row));
}

function onlyZone(shelf: { h: number } & Parameters<typeof rowZoneId>[0]): string | null {
  const ids = new Set(rowZones(shelf));
  return ids.size === 1 ? ([...ids][0] ?? null) : null;
}

/**
 * 分区 = 纸胶带：一张胶带（名字 + 颜色）可以贴到任意多**行**上；
 * 同名即同一张；撕下最后一行 = 这张胶带自己消失。
 */
function setup(seed = 20261001) {
  const run = createStartingRun(seed);
  const store = new GameStore(createSaveGame(run), {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  });
  const session = createOrganizeSession();
  const boxId = run.boxesToUnpack[0]!.id;
  return { store, session, boxId };
}

function putOnShelf(store: GameStore, session: ReturnType<typeof createOrganizeSession>, boxId: string, shelfId: string) {
  takeFromBox(store, session, boxId);
  const shelf = store.run.shelves.find((s) => s.id === shelfId)!;
  for (let r = 0; r < shelf.h; r++) {
    for (let c = 0; c < shelf.w; c++) {
      if (getStack(shelf, { row: r, col: c }) === null) {
        placeHeld(store, session, shelfId, { row: r, col: c });
        return;
      }
    }
  }
}

describe('胶带（分区）行为能力', () => {
  it('① 贴上一段胶带**并写好清单** → 这架物资算归位，归位率 100%', () => {
    const { store, session, boxId } = setup();
    putOnShelf(store, session, boxId, 'shelf_a');
    expect(placementRate(store.run.shelves, store.run.zones)).toBe(0);

    // 现在货架上是什么，清单就得写什么 —— 否则 §12 v0.8 之后归位率仍是 0
    const onShelf = new Set(
      store.run.shelves.flatMap((shelf) =>
        shelf.slots.flatMap((row) => row.map((slot) => slot.stack?.itemId).filter((id): id is string => Boolean(id)))
      )
    );
    const categories = [...new Set([...onShelf].map((id) => getItemDef(id).category))];
    const res = applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]!, categories });
    expect(res.ok).toBe(true);
    expect(store.run.zones.length).toBe(1);
    expect(onlyZone(store.run.shelves[0]!)).toBe(store.run.zones[0]!.id);
    expect(placementRate(store.run.shelves, store.run.zones)).toBe(1);
  });

  it('①b ★ §12 v0.8：只贴胶带、不写清单 → 归位率仍是 0（loophole 已修）', () => {
    const { store, session, boxId } = setup();
    putOnShelf(store, session, boxId, 'shelf_a');
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });

    expect(store.run.zones[0]?.autoAccept).toBeUndefined();
    expect(placementRate(store.run.shelves, store.run.zones)).toBe(0);
  });

  it('② 换了块货架输同名 → 复用同一张胶带，不再造重名分区（修掉的老缺陷）', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });
    applyZone(store, 'shelf_b', { name: '主食区', color: ZONE_COLORS[2]! });

    expect(store.run.zones.length).toBe(1);
    expect(store.run.zones[0]!.name).toBe('主食区');
    // 颜色以先贴的那张为准，两架保持一致（否则同一张胶带两个色，玩家会懵）
    expect(store.run.zones[0]!.color).toBe(ZONE_COLORS[0]!);
    expect(onlyZone(store.run.shelves[0]!)).toBe(onlyZone(store.run.shelves[1]!));
  });

  it('③ 点已有胶带就贴到这架（不新建）', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });
    const zoneId = store.run.zones[0]!.id;
    expect(assignZone(store, 'shelf_b', zoneId).ok).toBe(true);
    expect(store.run.zones.length).toBe(1);
    expect(onlyZone(store.run.shelves[1]!)).toBe(zoneId);
  });

  it('④ 撕下 → 这架变"还没贴"；没人用这张胶带了，它自己消失', () => {
    const { store, session, boxId } = setup();
    putOnShelf(store, session, boxId, 'shelf_a');
    const onShelf = new Set(
      store.run.shelves.flatMap((shelf) =>
        shelf.slots.flatMap((row) => row.map((slot) => slot.stack?.itemId).filter((id): id is string => Boolean(id)))
      )
    );
    const categories = [...new Set([...onShelf].map((id) => getItemDef(id).category))];
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]!, categories });
    expect(placementRate(store.run.shelves, store.run.zones)).toBe(1);

    const res = assignZone(store, 'shelf_a', null);
    expect(res.ok).toBe(true);
    expect(store.run.zones.length).toBe(0); // 孤儿胶带自动回收
    expect(onlyZone(store.run.shelves[0]!)).toBeNull();
    expect(placementRate(store.run.shelves, store.run.zones)).toBe(0);
    const ev = res.events.find((e) => e.type === 'zoneRemoved');
    expect(ev && 'name' in ev ? ev.name : '').toBe('主食区');
  });

  it('⑤ 两架共用一张胶带时撕掉其中一架 → 胶带还在，另一架还贴着', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });
    assignZone(store, 'shelf_b', store.run.zones[0]!.id);
    assignZone(store, 'shelf_a', null);

    expect(store.run.zones.length).toBe(1);
    expect(onlyZone(store.run.shelves[0]!)).toBeNull();
    expect(onlyZone(store.run.shelves[1]!)).toBe(store.run.zones[0]!.id);
  });

  it('⑥ 直接换贴另一张 → 旧胶带若成孤儿同样被回收', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });
    applyZone(store, 'shelf_b', { name: '饮水区', color: ZONE_COLORS[3]! });
    // 把 shelf_a 换成"饮水区"
    applyZone(store, 'shelf_a', { name: '饮水区', color: ZONE_COLORS[3]! });

    expect(store.run.zones.length).toBe(1);
    expect(store.run.zones[0]!.name).toBe('饮水区');
    expect(onlyZone(store.run.shelves[0]!)).toBe(onlyZone(store.run.shelves[1]!));
  });

  it('⑦ 改这张胶带的名字/颜色（带 zoneId）→ 不换 id，其他贴着它的架子一起变', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });
    const id = store.run.zones[0]!.id;
    applyZone(store, 'shelf_b', { name: '主食区', color: ZONE_COLORS[0]! }); // 先贴上同一张
    applyZone(store, 'shelf_a', { zoneId: id, name: '救命层', color: ZONE_COLORS[3]! });

    expect(store.run.zones.length).toBe(1);
    expect(store.run.zones[0]!.id).toBe(id);
    expect(store.run.zones[0]!.name).toBe('救命层');
    expect(store.run.zones[0]!.color).toBe(ZONE_COLORS[3]!);
    expect(onlyZone(store.run.shelves[1]!)).toBe(id); // 另一架自动跟着改名
  });

  it('⑦b 不带 zoneId 写另一个名字 → 这是"换一张"：旧的没人用就回收', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });
    applyZone(store, 'shelf_a', { name: '救命层', color: ZONE_COLORS[3]! });

    expect(store.run.zones.map((z) => z.name)).toEqual(['救命层']);
    expect(onlyZone(store.run.shelves[0]!)).toBe(store.run.zones[0]!.id);

    // 但若"主食区"还贴在别的架子上，就不能回收
    const { store: store2 } = setup();
    applyZone(store2, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });
    applyZone(store2, 'shelf_b', { name: '主食区', color: ZONE_COLORS[0]! });
    applyZone(store2, 'shelf_a', { name: '救命层', color: ZONE_COLORS[3]! });
    expect(store2.run.zones.map((z) => z.name).sort()).toEqual(['主食区', '救命层']);
    expect(onlyZone(store2.run.shelves[1]!)).toBe(store2.run.zones.find((z) => z.name === '主食区')!.id);
  });

  it('⑧ 空名字被拒；新贴的胶带不带 autoAccept 规则（M0 不评判对错）', () => {
    const { store } = setup();
    expect(applyZone(store, 'shelf_a', { name: '   ', color: ZONE_COLORS[0]! }).ok).toBe(false);
    applyZone(store, 'shelf_a', { name: '主食区', color: ZONE_COLORS[0]! });
    expect(store.run.zones[0]).not.toHaveProperty('autoAccept');
  });

  it('⑨ 非法货架 / 不存在的胶带一律被拒，不崩', () => {
    const { store } = setup();
    expect(applyZone(store, 'shelf_zzz', { name: 'x', color: ZONE_COLORS[0]! }).ok).toBe(false);
    expect(assignZone(store, 'shelf_a', 'zone_不存在').ok).toBe(false);
    expect(deleteZone(store, 'zone_不存在').ok).toBe(false);
  });
});
