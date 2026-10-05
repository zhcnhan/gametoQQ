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
import { DISASTER_DEFS } from '../data/disaster';
import { FURNITURE_DEFS, furnitureDefOf, spoilFactorOf } from '../data/furniture';
import { createMetaProfile } from '../state/save';
import { addFurniture, createStartingRun, createStartingShelves, rowsFor, SHELF_IDS } from './setup';
import { addFurnitureToHome } from './home';
import { ROOM_ID } from '../model/shelf';
import type { FurnitureKind, MetaProfile, RunState } from '../model/types';

/** 一个刚开档的跨局账本（`addFurnitureToHome` 只读它来算"哪间房还有位置"） */
function emptyMeta(): MetaProfile {
  return createMetaProfile();
}

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
    // 0.72 × 4 排 = 2.88 → 2 排（向下取整，见 `setup.ts` 的 `rowsFor`）
    const after = addFurniture([], 'fridge', { spoilFactor: 0.72 });
    expect(after[0]!.h).toBe(Math.floor(furnitureDefOf('fridge').h * 0.72));
    // 再小也至少留一排 —— 一格都没有不是难度，是卡死（§4A）
    const tiny = addFurniture([], 'fridge', { spoilFactor: 0.01 });
    expect(tiny[0]!.h).toBeGreaterThanOrEqual(1);
  });

  it('★ 向下取整：`capacityFactor` 只要小于 1，就**必须真的少掉至少一排**', () => {
    /*
     * 这条是一次实测抓出来的：凌汛（`capacityFactor: 0.9`）× 4 排 = 3.6，
     * 而第一版用的是 `Math.round` —— 它把 3.6 抬回 4，于是**这一场开局一格都没少**。
     *
     * 那是 D-32 那一整类错误（"写了 ≠ 生效了"）在一个更小的尺度上重演：
     * 数据写了、校验器认它、维度签名把它算成"用到第 14 维"，而玩家那边什么都没发生。
     * 所以口径是：**一个"乘了但没变"的乘数比"没写"更坏**。
     */
    const def = furnitureDefOf('shelf'); // 4 排
    for (const factor of [0.99, 0.9, 0.8, 0.75, 0.7, 0.55, 0.5]) {
      expect(rowsFor(def.h, factor), `factor=${factor} 没让货架变矮`).toBeLessThan(def.h);
    }
    // 而 round 会放过的那一档，正是 0.9（3.6 → 4）—— 这条防的就是它
    expect(Math.round(def.h * 0.9)).toBe(def.h);
    expect(rowsFor(def.h, 0.9)).toBeLessThan(def.h);
  });

  it('★ 取整方向改了，**结果变了的正好是那 10 场**（名单写死，不是"应该没事"）', () => {
    /*
     * 改取整方式是"牵一发动全身"的动作，所以这条不靠推理，靠**算**：
     * 把表里 43 场真正用到的乘数逐个过一遍 `floor` 与 `round`，把分家的点出来。
     *
     * 实测（`scripts/_probe-rounding.ts`）：43 场里**10 场**的结果变了，
     * 而且全都朝"更矮一排"那个方向 —— 它们本来就被 `round` 悄悄抬回去了：
     *
     * | 乘数 | ×4 排 | round（旧） | floor（新） |
     * | --- | --- | --- | --- |
     * | 0.65 | 2.6 | 3 | 2 |
     * | 0.70 / 0.72 | 2.8 / 2.88 | 3 | 2 |
     * | 0.90 | 3.6 | **4（= 一排都没少）** | 3 |
     *
     * ★ 名单**写死在这里**是刻意的：它让"取整方式被改回去"当场红，
     * 而不是安静地少砍 10 场的空间（那 10 场里有 `地震` / `爆管` / `地陷`
     * —— 全是"屋子塌了一块"那一类，最不该被抹掉空间代价的）。
     * 改这一行之前请先读 `systems/setup.ts` 的 `rowsFor`。
     */
    const CHANGED = [
      '爆管',
      '凌汛',
      '连雨',
      '冻土融化',
      '白蚁',
      '腐生菌',
      '地震火灾',
      '地震寒潮',
      '地震',
      '地陷'
    ];
    const full = furnitureDefOf('shelf').h;
    const actuallyChanged: string[] = [];
    for (const d of DISASTER_DEFS) {
      const factor = d.capacityFactor;
      if (typeof factor !== 'number' || factor >= 1 || factor < 0.5) continue;
      if (rowsFor(full, factor) !== Math.max(1, Math.round(full * factor))) actuallyChanged.push(d.name);
    }
    expect(actuallyChanged.sort()).toEqual([...CHANGED].sort());
    // 而"乘了但没变"那一条不变量：每一场都真的少掉至少一排
    for (const name of CHANGED) {
      const def = DISASTER_DEFS.find((d) => d.name === name)!;
      expect(rowsFor(full, def.capacityFactor ?? 1), `${name} 没让货架变矮`).toBeLessThan(full);
    }
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

/**
 * ★★ 生产路径：**买来的家具也要吃灾难的空间限制**（M4 W-01 顺手修的那条真 bug）
 *
 * ## 原来的样子（这条用例存在的全部理由）
 *
 * `addFurniture` 的签名里一直有 `opts.spoilFactor`，注释还写着"与开局那三块
 * 用**同一把尺子**" —— 而 `systems/home.ts` 调它时**从来没传过**。
 * 于是每一次加家具都走 `?? 1`，**买来的家具永远满高**。
 *
 * 为什么它今天才发作：在 M4 之前实机每一局都是寒潮，而寒潮的 `capacityFactor`
 * 恰好是 1 —— "买来的拿满高"与"开局的拿满高"两条路**结果一致**，
 * 这个 bug 被"只有一场灾难"挡着。W-01 一让 43 场生效，它就变成：
 * **100 元能把灾难吃掉的那一排空间买回来。**
 *
 * ## 为什么这一组走 `addFurnitureToHome` 而不是 `addFurniture`
 *
 * 因为错在**调用点**：`addFurniture` 自己一直是对的（上面那条 `spoilFactor: 0.72`
 * 的用例一直是绿的）。所以守护必须站在**生产路径**上 —— 站在函数本身上，
 * 这条 bug 修不修都是绿的。
 */
describe('★★ 生产路径：买来的家具不许把灾难吃掉的空间买回来', () => {
  /** 一个空屋 + 指定灾难的 run（就够 `addFurnitureToHome` 用） */
  function runWith(disasterId: string): RunState {
    return createStartingRun(20261001, { disasterId });
  }

  it('★ 洪水局（capacityFactor 0.8）：新买的家具比寒潮局矮', () => {
    const flood = addFurnitureToHome(emptyMeta(), runWith('flood_urban'), 'shelf');
    const cold = addFurnitureToHome(emptyMeta(), runWith('cold_snap'), 'shelf');
    expect(flood.added).toBe(true);
    expect(cold.added).toBe(true);
    const floodNew = flood.shelves[flood.shelves.length - 1]!;
    const coldNew = cold.shelves[cold.shelves.length - 1]!;
    expect(floodNew.h, '买的家具没吃 capacityFactor —— 100 元把灾难吃掉的空间买回来了').toBeLessThan(coldNew.h);
  });

  it('★ 新家具的排数与**开局那几块**用同一把尺子（同一场里必须一致）', () => {
    const run = runWith('flood_urban');
    const bought = addFurnitureToHome(emptyMeta(), run, 'shelf');
    const newShelf = bought.shelves[bought.shelves.length - 1]!;
    const starting = run.shelves[0]!;
    // 开局那块与买来的那块都是 shelf，同一场的容量乘数下排数必须一样
    expect(newShelf.h).toBe(starting.h);
  });

  it('★ 寒潮局照旧满高（这条修的是"没传参数"，不是"一律砍矮"）', () => {
    const run = runWith('cold_snap');
    const bought = addFurnitureToHome(emptyMeta(), run, 'shelf');
    const newShelf = bought.shelves[bought.shelves.length - 1]!;
    expect(newShelf.h).toBe(furnitureDefOf('shelf').h);
  });

  it('★ `unusableShelfIds` **不**作用在新家具上（灾难罚不了你花钱买的地方）', () => {
    /*
     * 边界：那一维说的是"这一场这块**本来就有**的地方没了"。
     * 而玩家花钱新加的一块不欠那笔账 —— 否则"加家具"在那一场里会随机失效，
     * 玩家完全读不懂（他刚花 100 元，货架却不见了）。
     *
     * ⚠ 验的是**两件事互不牵连**，而不是"新那块必须满高"：
     * 表里 31 场写了 `unusableShelfIds` 的灾难**同时**都写了 `capacityFactor`
     * （内涝就是 0.85 + 摘 shelf_a），所以新那块照旧吃容量乘数、只是不会消失。
     * 两个作用要分开断言，否则这条会退化成"看一个新货架有多高"。
     */
    const run = runWith('waterlog_slow'); // capacityFactor 0.85 + 摘掉 shelf_a
    expect(run.shelves.map((s) => s.id)).not.toContain('shelf_a'); // 开局确实被摘了
    const bought = addFurnitureToHome(emptyMeta(), run, 'shelf');
    const newShelf = bought.shelves[bought.shelves.length - 1]!;
    // ① 它**在**（没被 unusableShelfIds 顺手删掉）
    expect(bought.added).toBe(true);
    expect(bought.shelves.length).toBe(run.shelves.length + 1);
    // ② 而它照旧吃容量乘数（与开局那几块同一把尺子）
    expect(newShelf.h).toBe(Math.round(furnitureDefOf('shelf').h * 0.85));
    // ③ 对照：把「摘块」这件事单独拿出来 —— `addFurniture` 完全不知道 `unusableShelfIds`，
    //    所以哪怕容量乘数是 1，新那块也不会被"摘掉"（它压根不在那张名单里）
    const added = addFurniture(run.shelves, 'shelf', { spoilFactor: 1 });
    expect(added[added.length - 1]!.h).toBe(furnitureDefOf('shelf').h);
  });
});
