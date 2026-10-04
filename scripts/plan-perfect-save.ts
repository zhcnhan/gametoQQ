/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  完美档的**布局计算器**（`scripts/make-perfect-save.ts` 的行分配来源）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么要单独有个"算"的脚本
 *
 * 手算行布局我改了**七版**，每一版都错在不同的地方：`燃料罐` 一格只放 2、
 * `一包蜡烛` 一格放 3、蜡烛的品类是 `fuel` 不是 `light`、`牛奶` 的品类是
 * `water` 不是 `food`……而**每一版都得跑一遍生成器才知道错**。
 *
 * 那个循环的形状是"**猜一个数字 → 跑 → 报错 → 再猜**"。停下来的办法不是更仔细地猜，
 * 而是把那个数字**从物品表里读出来**：`ceil(count / stackLimit)` 就是格数，
 * 而 `stackLimit` 一直躺在 `ItemDef` 里。
 *
 * ## 它做什么
 *
 *  ① 按"段"（一个段 = 一张胶带 + 一串货）算出每段的格数；
 *  ② 按 6 格一行**切段**，切不下就报 `✗`；超过 4 行也报。
 *
 * 跑法：`npx vite-node scripts/plan-perfect-save.ts`
 * （改完布局先跑它，再去跑 `make-perfect-save.ts` —— 这样报错发生在这里，
 * 而不是发生在"生成器抛异常"那里。）
 */
import { getItemDef } from '../src/data/items';

type Want = { itemId: string; count: number };
type Seg = { zone: string; wants: Want[] };

/** 每行 6 格（`SHELF_W`） */
const ROW = 6;

/** 一段占几格 */
function slotsOf(wants: Want[]): number {
  return wants.reduce((n, w) => n + Math.ceil(w.count / getItemDef(w.itemId).stackLimit), 0);
}

/** 把一个"段"切成若干行（每行不超过 6 格）；同一种货可以跨行 */
function cutIntoSegments(seg: Seg): Want[][] {
  const rows: Want[][] = [];
  let current: Want[] = [];
  let used = 0;

  const flush = (): void => {
    if (current.length > 0) rows.push(current);
    current = [];
    used = 0;
  };

  for (const want of seg.wants) {
    const limit = getItemDef(want.itemId).stackLimit;
    let left = want.count;
    while (left > 0) {
      const room = ROW - used;
      if (room <= 0) {
        flush();
        continue;
      }
      // 这一行还能放几件（受剩余空间与 stackLimit 共同限制）
      const fits = Math.min(left, room * limit);
      current.push({ itemId: want.itemId, count: fits });
      used += Math.ceil(fits / limit);
      left -= fits;
      if (left > 0) flush();
    }
  }
  flush();
  return rows;
}

/**
 * 计划：**按段声明**（一个段 = 一张胶带 + 一串货）。
 * 段的顺序就是它在货架上行序；切行由脚本负责。
 */
const SHELVES: { shelfId: string; handy?: boolean; segments: Seg[] }[] = [
  {
    shelfId: 'shelf_a',
    segments: [
      {
        zone: '主食',
        wants: [
          { itemId: 'canned_corned_beef', count: 12 },
          { itemId: 'instant_noodles', count: 8 },
          { itemId: 'compressed_biscuit', count: 8 },
          { itemId: 'pork_luncheon', count: 8 },
          { itemId: 'canned_fish', count: 8 }
        ]
      },
      { zone: '主食', wants: [{ itemId: 'rice_bag', count: 4 }] },
      {
        zone: '饮水',
        wants: [
          { itemId: 'water_pouch', count: 8 },
          { itemId: 'coconut_water', count: 8 }
        ]
      }
    ]
  },
  {
    shelfId: 'shelf_b',
    handy: true,
    segments: [
      { zone: '燃料', wants: [{ itemId: 'fuel_can', count: 12 }, { itemId: 'fuel_can', count: 2 }] },
      {
        zone: '燃料',
        wants: [
          { itemId: 'candle_pack', count: 6 },
          { itemId: 'hexamine_tablet', count: 6 },
          { itemId: 'charcoal_bag', count: 3 }
        ]
      },
      { zone: '保暖', wants: [{ itemId: 'heat_pack', count: 12 }] },
      { zone: null, wants: [] }
    ]
  },
  {
    shelfId: 'shelf_2',
    segments: [
      { zone: '医疗', wants: [{ itemId: 'bandage', count: 10 }, { itemId: 'ors_powder', count: 6 }, { itemId: 'cold_medicine', count: 8 }] },
      { zone: '工具', wants: [{ itemId: 'multi_tool', count: 1 }, { itemId: 'hand_crank_light', count: 1 }] }
    ]
  },
  {
    shelfId: 'shelf_c',
    segments: [
      { zone: '主食', wants: [{ itemId: 'egg_tray', count: 2 }, { itemId: 'cabbage', count: 2 }] },
      { zone: '饮水', wants: [{ itemId: 'milk', count: 4 }] },
      { zone: '饮水', wants: [{ itemId: 'juice_box', count: 8 }] }
    ]
  },
  {
    shelfId: 'shelf_1',
    segments: [{ zone: '保暖', wants: [{ itemId: 'quilt', count: 2 }] }, { zone: '工具', wants: [{ itemId: 'multi_tool', count: 1 }, { itemId: 'hand_crank_light', count: 1 }] }]
  }
];

console.log('每段占几格（由 stackLimit 现算）：\n');
for (const shelf of SHELVES) {
  const rows: string[] = [];
  for (const seg of shelf.segments) {
    const cut = cutIntoSegments(seg);
    for (const row of cut) {
      const parts = row.map((w) => {
        const d = getItemDef(w.itemId);
        const s = Math.ceil(w.count / d.stackLimit);
        return `${d.name} ${w.count}件/${d.stackLimit}→${s}格`;
      });
      const n = slotsOf(row);
      rows.push(`    ${seg.zone.padEnd(4)} ${String(n).padStart(2)} 格  ${parts.join(' + ')}${n > 6 ? '  ✗ 超过 6 格' : ''}`);
    }
  }
  console.log(`${shelf.shelfId}${shelf.handy ? '（顺手位）' : ''}  共 ${rows.length} 行：`);
  for (const r of rows) console.log(r);
  if (rows.length > 4) console.log(`  ✗ ${shelf.shelfId} 需要 ${rows.length} 行，而货架只有 4 行`);
  console.log('');
}
