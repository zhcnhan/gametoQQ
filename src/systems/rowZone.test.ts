/**
 * ★★ 行级胶带的守护测试（用户拍板 2026-10）。
 *
 * 用户的原话：
 *
 * > "记得改一下胶带那个东西的机制，变成给一行使用，而且可以给多行使用，
 * >  并且可以给贴胶带的这一行上色，与之相关的机制数值也调整。"
 *
 * 三件事，逐条钉住：
 *
 * | 要求 | 守它的用例 |
 * | --- | --- |
 * | 给**一行**使用 | "只贴一行 → 只有那一行的堆算归位" |
 * | 一张胶带可以贴**多行** | "同一张胶带贴两块货架的各两行" |
 * | 给这一行**上色** | "一块货架上同时出现两种颜色" |
 * | **数值跟着调** | 归位率 / 临期优先的分母都变成"按行分组" |
 *
 * ## 为什么这一组必须存在（而不只是"改完看着对"）
 *
 * 这次改动跨了四层（类型 → 命令 → 界面 → 存档），而**大部分改错都是静默的**：
 *  · 忘了改 `placementRate` 里的 `findZone` → 贴了行但归位率不动，**不报错**；
 *  · `{ ...s, zoneId: … }` 这种旧写法在 v19 之后只是多一个废弃键 →
 *    分区根本没贴上，而类型检查**不会红**（我是靠"好档撑不过 14 天"才发现的）；
 *  · `zoneIds` 数组比行数短 → 越界写入被 JS 静默丢掉。
 *
 * 所以这一组里的每一条都在回答"玩家贴了行之后，**数字与世界变了没有**"。
 */
import { describe, expect, it } from 'vitest';
import { ZONE_COLORS } from '../data/palette';
import { getItemDef } from '../data/items';
import {
  fefoGroups,
  fefoRate,
  findZone,
  isGroupFEFO,
  onlyZoneIdOf,
  placementRate,
  rowZoneId,
  setRowZoneId,
  zoneIdsOf
} from '../model/shelf';
import { createShelf, dropStack, makeStack } from '../model/shelf';
import type { Shelf, Zone } from '../model/types';

const RED = ZONE_COLORS[0] as string;
const BLUE = ZONE_COLORS[3] as string;

/** 一张收主食的胶带，和一张空清单的胶带 */
const ZONES: Zone[] = [
  { id: 'z_food', name: '主食', color: RED, autoAccept: { categories: ['food'] } },
  { id: 'z_open', name: '随便', color: BLUE }
];

/** 6×4 的架子，第 0 行放罐头（主食）、第 1 行放电池（工具） */
function twoRowShelf(): Shelf {
  let s = createShelf('s1', 'room_living', 'shelf', 6, 4);
  s = dropStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 1, null)) as Shelf;
  s = dropStack(s, { row: 1, col: 0 }, makeStack('battery', 1, null)) as Shelf;
  return s;
}

describe('★ 存取：一行一个位置', () => {
  it('新货架默认**每一行都没贴**（不是"整块没贴"，是四行都 null）', () => {
    const s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    expect(s.zoneIds).toHaveLength(4);
    expect(s.zoneIds).toEqual([null, null, null, null]);
  });

  it('★★ 越界行号一律当"没贴"，而且**不抛异常**（这一行跑在渲染路径上）', () => {
    const s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    expect(rowZoneId(s, 99)).toBeNull();
    expect(rowZoneId(s, -1)).toBeNull();
  });

  it('★★ `zoneIds` 比行数短时，写第 3 行仍然**真的写得进去**', () => {
    /*
     * 老档的 `zoneIds` 可能是迁移补的、比行数短。而 `next[row] = x` 在
     * 数组长度不够时是**静默无效**的（JS 数组会拉长，但中间是 empty）——
     * 所以 `setRowZoneId` 必须先补长度。
     */
    const s = { ...createShelf('s1', 'room_living', 'shelf', 6, 4), zoneIds: [null] };
    const next = setRowZoneId(s, 3, 'z_food');
    expect(next).toHaveLength(4);
    expect(next[3]).toBe('z_food');
    // 中间那两行是补出来的 null，不是 undefined
    expect(next[1]).toBeNull();
    expect(next[2]).toBeNull();
  });

  it('`setRowZoneId` 返回**新数组**（不改入参 —— 存档是原子的）', () => {
    const s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    const before = [...s.zoneIds];
    setRowZoneId(s, 0, 'z_food');
    expect(s.zoneIds).toEqual(before);
  });

  it('`zoneIdsOf` 去重：同一张胶带贴三行只报一次', () => {
    let s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    s.zoneIds = ['z_food', 'z_food', 'z_open', null];
    expect(zoneIdsOf(s)).toEqual(['z_food', 'z_open']);
  });

  it('`onlyZoneIdOf`：整块一张时给出它，一行没贴或贴了两张都给 null', () => {
    const bare = createShelf('s1', 'room_living', 'shelf', 6, 4);
    expect(onlyZoneIdOf(bare)).toBeNull();
    const all = { ...bare, zoneIds: ['z_food', 'z_food', 'z_food', 'z_food'] };
    expect(onlyZoneIdOf(all)).toBe('z_food');
    const mixed = { ...bare, zoneIds: ['z_food', 'z_food', 'z_open', 'z_open'] };
    expect(onlyZoneIdOf(mixed), '两张胶带时没有唯一答案').toBeNull();
  });
});

describe('★★ 归位率：分母真的细到行了', () => {
  it('★★ 只贴**第 0 行**（主食那行）→ 2 堆里只有 1 堆算归位', () => {
    /*
     * 这是"给一行使用"最直接的可观察后果。
     * 老口径下贴一整块 = 两行都算，归位率会是 1；现在只贴一行就是 1/2。
     */
    const s = twoRowShelf();
    const tapped = { ...s, zoneIds: ['z_food', null, null, null] };
    // 第 0 行是罐头（主食，被清单接收）；第 1 行是电池（不在清单里）
    expect(placementRate([tapped], ZONES)).toBeCloseTo(1 / 2, 5);
  });

  it('★★ 同样的两行都贴上**同一张**胶带 → 仍然只有 1 堆算归位（电池不在主食清单里）', () => {
    const s = twoRowShelf();
    const tapped = { ...s, zoneIds: ['z_food', 'z_food', null, null] };
    // 电池那一行贴了主食胶带，但清单不接收它 → 不算归位
    expect(placementRate([tapped], ZONES)).toBeCloseTo(1 / 2, 5);
  });

  it('★ 没贴的行**不会**因为旁边那行贴了就算归位（逐行各查各的）', () => {
    const s = twoRowShelf();
    const none = { ...s, zoneIds: [null, null, null, null] };
    expect(placementRate([none], ZONES)).toBe(0);
  });

  it('★ 一张胶带贴到**两块货架**的不同行上，两处都算（"可以给多行使用"）', () => {
    /*
     * 两块架子都是"第 0 行罐头、第 1 行电池"（`twoRowShelf` 造的），
     * 所以两边的第 0 行都贴上主食胶带 —— 那两堆都算归位。
     *
     * ⚠ 我第一版把 b 的胶带贴在**第 1 行**（电池），于是只有 1 堆算，
     * 断言写 2/4 却拿到 1/4。**那是测试写错了，不是代码错了** ——
     * 而我先怀疑的是代码（去读了一遍 `placementRate`）。
     * 记在这里：断言与自己的布局对不上时，先数一遍布局。
     */
    const a = twoRowShelf();
    const b = { ...twoRowShelf(), id: 's2' };
    const t1 = { ...a, zoneIds: ['z_food', null, null, null] };
    const t2 = { ...b, zoneIds: ['z_food', null, null, null] };
    // 两块架子的第 0 行各一堆罐头（都算），两堆电池都不算 → 2/4
    expect(placementRate([t1, t2], ZONES)).toBeCloseTo(2 / 4, 5);
  });

  it('★ 空清单的行仍然算"没归位"（v0.8 那个 loophole 没有被这次改动带回来）', () => {
    const s = twoRowShelf();
    const open = { ...s, zoneIds: ['z_open', 'z_open', null, null] };
    expect(placementRate([open], ZONES)).toBe(0);
  });
});

describe('★★ 临期优先：分母变成"按胶带分组"', () => {
  it('★ `fefoGroups` 把同一张胶带的多行并成一组，没贴的行各自一组', () => {
    const s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    s.zoneIds = ['z_food', 'z_food', 'z_open', null];
    const groups = fefoGroups(s);
    // z_food（两行）一组、z_open 一组、null 一行一组
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.zoneId === 'z_food')?.rows).toEqual([0, 1]);
    expect(groups.find((g) => g.zoneId === null)?.rows).toEqual([3]);
  });

  it('★★ 同一组跨越两行时要**整体**按到期日升序（第 1 行的货比第 2 行先到期才算对）', () => {
    /*
     * 这条守的是"FEFO 为什么不逐行各排各的"：
     * 同一张胶带的两行是一个整理单位，而 FEFO 的意义就是先拿快到期的 ——
     * 第 1 行放 9 号到期、第 2 行放 3 号到期，取用时就是错的。
     */
    let s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    s.zoneIds = ['z_food', 'z_food', null, null];
    s = dropStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 1, 9)) as Shelf;
    s = dropStack(s, { row: 1, col: 0 }, makeStack('canned_beans', 1, 3)) as Shelf;
    const g = fefoGroups(s).find((x) => x.zoneId === 'z_food')!;
    expect(isGroupFEFO(s, g.rows), '9 号在前、3 号在后 → 这一组没排好').toBe(false);
  });

  it('★ 两行顺序反过来就对了（证明上一条判的是顺序，不是"有两行"）', () => {
    let s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    s.zoneIds = ['z_food', 'z_food', null, null];
    s = dropStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 1, 3)) as Shelf;
    s = dropStack(s, { row: 1, col: 0 }, makeStack('canned_beans', 1, 9)) as Shelf;
    const g = fefoGroups(s).find((x) => x.zoneId === 'z_food')!;
    expect(isGroupFEFO(s, g.rows)).toBe(true);
  });

  it('★ 一块货架现在会贡献**多个组**（分母从"几块架子"变成"几组格子"）', () => {
    let s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    s.zoneIds = ['z_food', 'z_open', null, null];
    s = dropStack(s, { row: 0, col: 0 }, makeStack('canned_beans', 1, 9)) as Shelf;
    s = dropStack(s, { row: 1, col: 0 }, makeStack('battery', 1, null)) as Shelf;
    // 两组都有货：主食那组排好了（只有一件），随便那组也排好了
    expect(fefoRate([s])).toBe(1);

    // 把主食那组弄乱（加一件更早到期的到它后面）→ 1/2
    let bad = dropStack(s, { row: 0, col: 1 }, makeStack('canned_beans', 1, 2)) as Shelf;
    expect(fefoRate([bad]), '一组乱 → 两组里对了一组').toBeCloseTo(1 / 2, 5);
  });

  it('★ 空组不算分母（一行没放东西不是"排好了"，也不是"没排"）', () => {
    const s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    // 一件货都没有 → 没有非空组 → 0（沿用 M1 那条"全空给 0"的修正）
    expect(fefoRate([s])).toBe(0);
  });
});

describe('★★ 上色：一块货架上可以同时有两种颜色', () => {
  it('★★ 每一行各查各的胶带 → 颜色跟着行', () => {
    const s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    s.zoneIds = ['z_food', 'z_food', 'z_open', null];
    const colors = Array.from({ length: s.h }, (_, row) => findZone(ZONES, rowZoneId(s, row))?.color ?? null);
    expect(colors).toEqual([RED, RED, BLUE, null]);
  });

  it('★ 界面渲染读的就是这两个函数（`rowZoneId` + `findZone`），不是整块的某个字段', () => {
    /*
     * 这条是一条**结构性**的守护：它证明"颜色可以从行算出来"。
     * 界面（`OrganizeScreen.shelfHtml`）用的正是这两个函数 ——
     * 如果哪天有人把渲染改回读一个整块字段，这一条不会红，
     * 但那已经不在本文件的射程内了（它靠 `check-style` 与人工走查）。
     */
    const s = createShelf('s1', 'room_living', 'shelf', 6, 4);
    s.zoneIds = [null, 'z_open', null, null];
    expect(findZone(ZONES, rowZoneId(s, 1))?.name).toBe('随便');
    expect(rowZoneId(s, 0)).toBeNull();
  });
});

describe('★ 物资表没被写死（上色用的是调色板，不是新造的颜色）', () => {
  it('测试里用的颜色都来自 `ZONE_COLORS`', () => {
    expect(ZONE_COLORS).toContain(RED);
    expect(ZONE_COLORS).toContain(BLUE);
  });

  it('清单接收判定没变（分类仍然走 `getItemDef`）', () => {
    expect(getItemDef('canned_beans').category).toBe('food');
    expect(getItemDef('battery').category).not.toBe('food');
  });
});
