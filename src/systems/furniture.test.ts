/**
 * 加一块家具的测试（§10.2.4 "新货架 / 新家具类型"）。
 *
 * ## 它守的三条都是"不报错的错"
 *
 * 这个函数的失败方式很讨厌：它不会抛异常，也不会让任何屏幕变红 ——
 * 它只会让**东西放到别处**、让**一块家具永远看不见**、或者让玩家
 * **在毫无察觉的情况下丢掉顺手位**。所以每条约束都要有一条用例。
 */
import { describe, expect, it } from 'vitest';
import { FURNITURE_DEFS, furnitureDefOf, spoilFactorOf } from '../data/furniture';
import { addFurniture, createStartingShelves, SHELF_IDS } from './setup';
import { ROOM_ID } from '../model/shelf';
import type { FurnitureKind } from '../model/types';

describe('家具表与类型的双向一致', () => {
  it('★ 每一种 `FurnitureKind` 都必须有定义（类型加了一种、表里忘了加）', () => {
    /*
     * 这一条防的是"类型里加了 `'safe'`，而 `FURNITURE_DEFS` 里没有" ——
     * 那时 `furnitureDefOf('safe')` 会**静默退回普通货架**，
     * 于是一种新家具变成了旧家具，而且没有任何东西会报错。
     */
    const ALL: FurnitureKind[] = ['shelf', 'fridge', 'cabinet', 'floor'];
    const defined = new Set(FURNITURE_DEFS.map((d) => d.kind));
    const missing = ALL.filter((k) => !defined.has(k));
    expect(missing, `这些 kind 在 FURNITURE_DEFS 里没有定义`).toEqual([]);
  });

  it('反过来：表里不许有类型之外的家具（认不出的 kind 会退回货架）', () => {
    const ALL = new Set(['shelf', 'fridge', 'cabinet', 'floor']);
    const extra = FURNITURE_DEFS.map((d) => d.kind).filter((k) => !ALL.has(k));
    expect(extra).toEqual([]);
  });

  it('每一种都有中文名，而且名字互不相同（界面按它说话）', () => {
    const labels = FURNITURE_DEFS.map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.length).toBeGreaterThan(0);
  });

  it('尺寸是正数（0 格的家具是一片看不见的空气）', () => {
    for (const d of FURNITURE_DEFS) {
      expect(d.w, d.kind).toBeGreaterThan(0);
      expect(d.h, d.kind).toBeGreaterThan(0);
    }
  });
});

describe('addFurniture：加一块家具', () => {
  it('加一块：数量 +1，种类与尺寸照表来', () => {
    const before = createStartingShelves(ROOM_ID, 'cold_snap');
    const after = addFurniture(before, 'fridge');
    expect(after).toHaveLength(before.length + 1);
    const added = after[after.length - 1]!;
    expect(added.kind).toBe('fridge');
    expect(added.w).toBe(furnitureDefOf('fridge').w);
    expect(added.h).toBe(furnitureDefOf('fridge').h);
  });

  it('★ 不改入参（配合原子存档：任何中间状态都能整份写盘）', () => {
    const before = createStartingShelves(ROOM_ID, 'cold_snap');
    const len = before.length;
    addFurniture(before, 'cabinet');
    expect(before).toHaveLength(len);
  });

  it('★ id 唯一 —— 重名会让东西放到别处，而且不报错', () => {
    let shelves = createStartingShelves(ROOM_ID, 'cold_snap');
    for (let i = 0; i < 8; i++) shelves = addFurniture(shelves, i % 2 === 0 ? 'fridge' : 'cabinet');
    const ids = shelves.map((s) => s.id);
    expect(new Set(ids).size, `id 有重复：${ids.join(', ')}`).toBe(ids.length);
  });

  it('★ 优先复用给定 id 池里**还没被占用**的名字（点名进 `SHELF_IDS` 那种）', () => {
    // 开局三块已经用掉 shelf_a/b/c；池子给全，第四块应当拿到一个新名字
    const before = createStartingShelves(ROOM_ID, 'cold_snap');
    const after = addFurniture(before, 'cabinet', { ids: SHELF_IDS });
    const used = before.map((s) => s.id);
    expect(used).toContain('shelf_a');
    // 新那块不能跟任何一块重名（它要么用了池子里剩下的，要么自己生成了一个）
    const ids = after.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('★ 池子用尽时也要保证不重名（自己生成一个，而不是硬塞同名）', () => {
    // 池子里只有一个名字，而已经被占用 → 必须另生成
    const before = createStartingShelves(ROOM_ID, 'cold_snap');
    const after = addFurniture(before, 'shelf', { ids: ['shelf_a'] });
    const ids = after.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('★ `handyRank` 一律 null：新家具不许自己抢"门口那一块"', () => {
    /*
     * 顺手位是**全屋唯一**的（§12.3 v0.7.1 玩家拍板）。
     * 买了冰箱就把门口顶掉，玩家会在毫无察觉的情况下丢掉应急可达率 ——
     * 而那一项是结算页上三个维度之一。
     */
    const before = createStartingShelves(ROOM_ID, 'cold_snap').map((s, i) =>
      i === 0 ? { ...s, handyRank: 1 } : s
    );
    const after = addFurniture(before, 'fridge');
    expect(after[after.length - 1]!.handyRank).toBeNull();
    // 原来那块也不受影响
    expect(after[0]!.handyRank).toBe(1);
  });

  it('认不出的 kind 退回普通货架（存档可手改、可来自 mod）', () => {
    const after = addFurniture([], '这个家具不存在' as FurnitureKind);
    expect(after[0]!.kind).toBe('shelf');
  });

  it('★ 灾难的空间限制照旧生效（与开局那三块用同一把尺子）', () => {
    // 洪水：capacityFactor 0.72 → 4 排变 3 排
    const after = addFurniture([], 'fridge', { spoilFactor: 0.72 });
    expect(after[0]!.h).toBe(Math.round(furnitureDefOf('fridge').h * 0.72));
    // 再小也至少留一排 —— 一格都没有不是难度，是卡死（§4A）
    const tiny = addFurniture([], 'fridge', { spoilFactor: 0.01 });
    expect(tiny[0]!.h).toBeGreaterThanOrEqual(1);
  });

  it('放在指定的房间（将来 `rooms` 变数据时由调用方给）', () => {
    const after = addFurniture([], 'shelf', { roomId: 'room_study' });
    expect(after[0]!.roomId).toBe('room_study');
    // 不给就落在默认那间 —— 认不出的房间 = 一块玩家永远看不见的家具
    expect(addFurniture([], 'shelf')[0]!.roomId).toBe(ROOM_ID);
  });

  it('新家具**真的是空的**（不能带上别人的货）', () => {
    const after = addFurniture(createStartingShelves(ROOM_ID, 'cold_snap'), 'cabinet');
    const added = after[after.length - 1]!;
    for (const row of added.slots) for (const slot of row) expect(slot.stack).toBeNull();
  });

  it('★ 加冰箱真的会让"整屋腐坏"变慢（机制接得上，不只是多了一块板）', () => {
    /*
     * 这条把 `addFurniture` 与 `spoilFactorOf` 连起来验一次 ——
     * 否则"加了一块 kind='fridge' 的家具"完全可能只是加了一块**普通货架**
     * （kind 写对了但没有任何东西读它，那正是 D-02 原来的样子）。
     */
    expect(spoilFactorOf(addFurniture([], 'fridge')[0]!.kind)).toBeLessThan(1);
    expect(spoilFactorOf(addFurniture([], 'cabinet')[0]!.kind)).toBeLessThan(1);
    expect(spoilFactorOf(addFurniture([], 'shelf')[0]!.kind)).toBe(1);
  });
});
