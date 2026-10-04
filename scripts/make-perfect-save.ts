/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  完美档（`__tunhuo.load('perfect')` / `'perfect-survival'`）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么要单独造一份
 *
 * 用户的原话是"给我个完美档" —— 而仓库里已有的 `good` **不是完美档**：
 * 它只贴了**一张"全收"胶带**（空清单的两义性让归位率失去意义）、没排 FEFO、
 * 也没进生存期。用那种档当"完美长什么样"的参照物会骗人。
 *
 * ## "完美"在这套代码里不是形容词，是一组可算的量
 *
 * | 量 | 满分条件 | 读点 |
 * | --- | --- | --- |
 * | 归位率 | 每一堆都在**明确接收它**的那一行上（`zoneListedFor`） | `model/shelf.ts` 的 `placementRate` |
 * | 临期优先 | 每组胶带内按到期日升序 | `fefoRate` / `isGroupFEFO` |
 * | 应急可达率 | 该灾难的应急品类（寒潮 = 燃料 ∪ 保暖 ∪ 医疗）**全在顺手位** | `model/score.ts` 的 `emergencyRate` |
 * | 待拆箱 | **0 个**（纸箱会进归位率的**分母**） | `placementRate` |
 * | 整整齐齐 | 某一块货架**每一行都贴了胶带**，且行内东西都在清单上 | `isShelfTidy` |
 *
 * 所以这一份是照着那五条**构造**出来的，而不是"摆得好看"。
 *
 * ## 它同时要"够活满 14 天"
 *
 * 寒潮的日耗是食物 2 + 水 2 + 燃料 2（`dailyDrainOf`），14 天 → 各 28 件。
 * 所以货量是按这个数配的：**它既是满分盘面，也是一个真能通关的档**。
 *
 * ★ 一条刻意的设计：**每块货架只贴 1~2 种胶带**（而不是一行一个花样），
 * 因为那是玩家真会做的事（"这块架子放主食"），也让"整整齐齐"这个徽章
 * 在**一条规矩执行到底**的意义上成立，而不是靠十六张贴纸堆出来。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FIRST_STOCKPILE_DAY, SURVIVAL_DAYS, getDisasterDef } from '../src/data/disaster';
import { dailyDrainOf } from '../src/data/survival';
import { CATEGORY_ORDER, getItemDef } from '../src/data/items';
import { createCursor } from '../src/model/rng';
import { fefoSorted, makeStack, setSlotStack } from '../src/model/shelf';
import { createSaveGame, serialize } from '../src/state/save';
import { addFurniture, createStartingRun } from '../src/systems/setup';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'tools');

/** 人话颜色，与 `save-rows.txt` 里那三张同一套色板 */
const COLOR = {
  staple: '#C8372D',
  drink: '#4A6FA5',
  fuel: '#B4763A',
  med: '#6B8E5A',
  warmth: '#8A5FA5',
  tool: '#5A6B7A'
};

const ZONES = [
  { id: 'z_staple', name: '主食', color: COLOR.staple, autoAccept: { categories: ['food'] } },
  { id: 'z_drink', name: '饮水', color: COLOR.drink, autoAccept: { categories: ['water'] } },
  { id: 'z_fuel', name: '燃料', color: COLOR.fuel, autoAccept: { categories: ['fuel'] } },
  { id: 'z_med', name: '医疗', color: COLOR.med, autoAccept: { categories: ['medicine'] } },
  { id: 'z_warm', name: '保暖', color: COLOR.warmth, autoAccept: { categories: ['warmth'] } },
  { id: 'z_tool', name: '工具', color: COLOR.tool, autoAccept: { categories: ['tool'] } }
];

/**
 * 一块货架的**逐行计划**：每行贴哪张胶带、放哪几堆（`count` 是总件数，会按 `stackLimit` 切）。
 *
 * ★ 写成"行 → 清单"而不是"清单 → 行"，是因为**胶带的粒度就是行**
 * （用户 2026-10 拍板的那件事）。这个形状让"每一行都贴了"这件事在数据里就是显然的。
 */
type RowPlan = { zone: string | null; items: { itemId: string; count: number; expiresOffset?: number }[] };

/** 按行计划铺货；返回新的 shelves。到期日 = `day + offset`（默认 +40，保证活得过 14 天） */
function layOut(run, shelfId: string, rows: RowPlan[]): void {
  const index = run.shelves.findIndex((s) => s.id === shelfId);
  const shelf = run.shelves[index];
  if (!shelf) throw new Error(`没有 ${shelfId}`);
  let next = shelf;

  rows.forEach((plan, row) => {
    if (row >= shelf.h) throw new Error(`${shelfId} 只有 ${shelf.h} 行，计划里却有第 ${row + 1} 行`);
    let col = 0;
    for (const want of plan.items) {
      const def = getItemDef(want.itemId);
      let left = want.count;
      while (left > 0) {
        if (col >= shelf.w) throw new Error(`${shelfId} 第 ${row + 1} 行放不下（还差 ${left} 件 ${def.name}）`);
        const take = Math.min(left, def.stackLimit);
        const expires = run.day + (want.expiresOffset ?? 40);
        next = setSlotStack(next, { row, col }, makeStack(want.itemId, take, def.perishable ? expires : null));
        left -= take;
        col += 1;
      }
    }
  });

  // 胶带：按行贴（`null` = 这一行不贴）
  next = { ...next, zoneIds: rows.map((p) => p.zone) };
  run.shelves[index] = next;
}

/** 顺手位：全屋唯一，标在第一块上（寒潮的应急品类都在这一块） */
function markHandy(run, shelfId: string): void {
  run.shelves = run.shelves.map((s) => ({ ...s, handyRank: s.id === shelfId ? 1 : null }));
}

function write(name, run, metaPatch = {}) {
  const save = createSaveGame(run);
  Object.assign(save.meta, metaPatch);
  save.deviceId = 'dev_fixture';
  save.savedAt = 0;
  const text = serialize(save);
  writeFileSync(join(outDir, `save-${name}.txt`), text, 'utf8');
  return Math.round((text.length / 1024) * 10) / 10;
}

function freshRun(seed = 20261001) {
  return createStartingRun(seed);
}

/**
 * 把**一块已经造好的盘面**铺成满分。
 *
 * ## ★★ 为什么必须"只造一次、两份档共用"（这条踩过）
 *
 * `addFurniture` 生成的 id 来自 `model/shelf.ts` 里一个**模块级递增计数器**
 * （`nextShelfId` 的 `idSeq += 1`）。所以同一个进程里第二次造盘面时，
 * 新家具的 id 会变成 `shelf_3` / `shelf_4` —— 而我按 `shelf_1` / `shelf_2` 铺货，
 * 于是第二份档报"没有 shelf_2"。
 *
 * 这个坑值得记住，因为它**只在"同一个进程里造两次"时出现**：
 * 分成两个脚本跑就永远不会遇到，而合并成一个脚本（为了共用代码）立刻撞上。
 *
 * ## 铺法
 *
 * ⚠ `shelf_a` **每一行都贴了胶带** —— 那是「整整齐齐」徽章的前提
 * （`isShelfTidy` 逐行要求有 zone）。其余货架只铺一部分行、空行不贴：
 * 徽章问的是"你有没有把**某一块**完全管好"，不是"全部都要"。
 */
function layOutPerfect(run: RunState): void {
  /*
   * ── 布局一览（每行 6 格） ──
   *
   * ★★ 数字全部来自**实读** `ItemDef`（上限在括号里），不是估的 ——
   * 我第一版按印象写，于是"14 件燃料罐 = 一行"这种错当场被生成器拦下
   * （`燃料罐` 一格只放 2，14 件要 7 格 > 6）。
   *
   * | 货架 | 行 | 内容 | 格数 |
   * | --- | --- | --- | --- |
   * | `shelf_a`（**逐行都贴** → 拿「整整齐齐」） | 1 | 咸牛肉 12(8) + 泡面 8(8) + 压缩饼干 8(10) + 午餐肉 8(6) | 6 |
   * | | 2 | 豆豉鲮鱼 8(8) | 1 |
   * | | 3 | 大米 4(1) | 4 |
   * | | 4 | 应急饮用水 8(8) + 椰子水 8(8) | 2 |
   * | `shelf_b`（**顺手位**：燃料 + 保暖） | 1 | 燃料罐 12(2) | 6 |
   * | | 2 | 燃料罐 2(2) + 蜡烛 6(3) + 固体燃料块 6(6) + 木炭 3(1) | 6 |
   * | | 3 | 暖宝宝 12(12) | 1 |
   * | | 4 | （不贴） | 0 |
   * | `shelf_2` | 1 | 绷带 10(10) + 补液盐 6(10) + 感冒药 8(8) | 3 |
   * | | 2 | 工具钳 1(1) + 手摇手电 1(1) | 2 |
   * | `shelf_c`（**冰箱** → 鲜食） | 1 | 鸡蛋 2(2) + 白菜 2(2) | 2 |
   * | | 2 | 牛奶 4(4) | 1 |
   * | | 3 | 利乐包果汁 8(8) | 1 |
   * | `shelf_1` | 1 | 棉被 2(1) | 2 |
   * | | 2 | 工具钳 1(1) + 手摇手电 1(1) | 2 |
   *
   * 燃料合计 12+2+6+6+3 = **29 件 ≥ 28**（14 天 × 2/天）。
   *
   * ★ 块数是**省着用**的：客厅 6 块的上限只用了 4 块、储藏间一块没放 ——
   * 完美盘面不需要更多空间，而"用更少的地方放得更好"正是这个游戏想奖励的东西。
   */
  layOut(run, 'shelf_a', [
    {
      zone: 'z_staple',
      items: [
        { itemId: 'canned_corned_beef', count: 12 },
        { itemId: 'instant_noodles', count: 8 },
        { itemId: 'compressed_biscuit', count: 8 },
        { itemId: 'pork_luncheon', count: 8 }
      ]
    },
    { zone: 'z_staple', items: [{ itemId: 'canned_fish', count: 8 }] },
    { zone: 'z_staple', items: [{ itemId: 'rice_bag', count: 4 }] },
    {
      zone: 'z_drink',
      items: [
        { itemId: 'water_pouch', count: 8 },
        { itemId: 'coconut_water', count: 8 }
      ]
    }
  ]);

  /*
   * ── `shelf_c`：冰箱 → 鲜食（腐坏乘数 0.4，这就是它值得占地方的地方） ──
   * ⚠ 寒潮里 `spoilRate 0.5` 让腐坏基本不发生，所以它不破坏满分；
   * 而在别的灾难（热浪 2.4 / 霉雨 3.0）里，这一块就是"冰箱救了命"的现场。
   *
   * ⚠ `milk` 的品类是 **water 不是 food** —— 夹具必须按**真实品类**贴胶带，
   * 否则归位率会静默掉下去，而屏幕上"看起来"是贴对了的。
   */
  layOut(run, 'shelf_c', [
    { zone: 'z_staple', items: [{ itemId: 'egg_tray', count: 2 }, { itemId: 'cabbage', count: 2 }] },
    { zone: 'z_drink', items: [{ itemId: 'milk', count: 4 }] },
    { zone: 'z_drink', items: [{ itemId: 'juice_box', count: 8 }] },
    { zone: null, items: [] }
  ]);

  /*
   * ── `shelf_b`：**顺手位** —— 寒潮的三个应急品类（燃料 ∪ 保暖 ∪ 医疗）**全在这一块** ──
   *
   * ★★ 这一块的每一行都是**被两个约束同时逼出来的**：
   *  · 应急可达率的分母是**全屋**的应急件数 → 所以应急物资**一件都不能放在别处**
   *    （我犯过两次：把两块保暖放在备用货架上 → 95%，把那两件放回顺手位 → 94%，
   *    因为第二版又把蜡烛放去了非顺手位）。
   *  · 燃料要 ≥ 28 件（14 天 × 2/天），而 `燃料罐` 一格只放 2 → 它独占 6 格。
   *
   * | 行 | 胶带 | 内容 |
   * | --- | --- | --- |
   * | 1 | 燃料 | 燃料罐 12 |
   * | 2 | 燃料 | 燃料罐 2 + 固体燃料块 6 + 木炭 2 + 蜡烛 6 |
   * | 3 | 保暖 | 暖宝宝 12 + 棉被 2 |
   * | 4 | 医疗 | 绷带 10 + 感冒药 8 |
   *
   * 燃料合计 12+2+6+2+6 = **28 件**（正好够）。
   */
  layOut(run, 'shelf_b', [
    { zone: 'z_fuel', items: [{ itemId: 'fuel_can', count: 12 }] },
    {
      zone: 'z_fuel',
      items: [
        { itemId: 'fuel_can', count: 2 },
        { itemId: 'hexamine_tablet', count: 6 },
        { itemId: 'charcoal_bag', count: 2 },
        { itemId: 'candle_pack', count: 6 }
      ]
    },
    { zone: 'z_warm', items: [{ itemId: 'heat_pack', count: 12 }, { itemId: 'quilt', count: 1 }] },
    {
      zone: 'z_med',
      items: [
        { itemId: 'bandage', count: 10 },
        { itemId: 'ors_powder', count: 6 },
        { itemId: 'cold_medicine', count: 8 }
      ]
    }
  ]);

  /*
   * `shelf_2`：**非应急**的余量 + 备用工具。
   *
   * ⚠ 这一块**不能放应急物资**（燃料 / 保暖 / 医疗）：应急可达率的分母是全屋，
   * 所以放一件在这儿就把那一栏往下拉（实测 100 → 94）。
   * 羊毛毯与羽绒服的品类是 `warmth` —— 也就是**应急品类**，所以它们只能上顺手位，
   * 而顺手位的 20 格已经被燃料与药品占满 → 这一局**不放它们**（那是一个真取舍：
   * 你要应急可达率 100%，就得把格子留给应急的东西）。
   */
  layOut(run, 'shelf_2', [
    { zone: 'z_tool', items: [{ itemId: 'solar_panel', count: 1 }] },
    {
      zone: 'z_tool',
      items: [
        { itemId: 'multi_tool', count: 1 },
        { itemId: 'hand_crank_light', count: 1 }
      ]
    },
    { zone: null, items: [] },
    { zone: null, items: [] }
  ]);

  /*
   * `shelf_1`：那一床多出来的棉被 —— ⚠ 它**不能**放这儿：`棉被` 的品类是 `warmth`，
   * 而保暖是应急品类，放在非顺手位会把应急可达率拉下来。
   * 所以这一块只放**工具**（`tool` 不是应急品类），其余行空着不贴。
   */
  layOut(run, 'shelf_1', [
    {
      zone: 'z_tool',
      items: [
        { itemId: 'multi_tool', count: 1 },
        { itemId: 'hand_crank_light', count: 1 }
      ]
    },
    { zone: null, items: [] },
    { zone: null, items: [] },
    { zone: null, items: [] }
  ]);

  markHandy(run, 'shelf_b');

  // 每一组胶带内按到期日升序 —— 这是"临期优先 100%"的**唯一**来路，不能省
  run.shelves = run.shelves.map((s) => fefoSorted(s));
}

/** 造一份满分的**基础** `run`（家具与货架 id 只在这一处生成一次） */
function freshPerfectRun() {
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.day = FIRST_STOCKPILE_DAY;
  run.cash = 700;
  run.actionPoints = 3;
  run.boxesToUnpack = [];
  run.intel = 3;

  /*
   * 家具：客厅**只加两块**（开局已有 `shelf_a` / `shelf_b` / `shelf_c` = 冰箱）。
   *
   * ★ 刻意**不**往储藏间放空架子 —— 那会是"为了看起来大而摆的家具"，
   * 而完美盘面的主张恰恰是"用更少的地方放得更好"。
   * `survivedRuns: 5` 让储藏间**解锁但空着**，那一屏因此也能看到（真实状态，不是摆设）。
   */
  run.shelves = addFurniture(addFurniture(run.shelves, 'shelf'), 'shelf');
  run.zones = ZONES.map((z) => ({ ...z }));
  layOutPerfect(run);
  return run;
}

/*
 * ★★ **盘面只造一次**：`addFurniture` 的 id 来自一个模块级递增计数器
 * （`model/shelf.ts` 的 `nextShelfId`），所以同一个进程里造第二次会得到
 * `shelf_3` / `shelf_4` 而不是 `shelf_1` / `shelf_2` —— 而铺货是按 id 写的。
 * 这个坑**只在"一个进程里造两份档"时出现**（分成两个脚本跑就永远不会遇到）。
 *
 * 所以：造一份，落两档。两份的**盘面保证一模一样**，差别只在 phase / day。
 */
const baseRun = freshPerfectRun();

// ───────────────────── ① 完美档（整理期，看盘面） ─────────────────────
{
  const run = structuredClone(baseRun);
  run.phase = 'organize';
  const kb = write('perfect', run, { survivedRuns: 5 });
  const stacks = run.shelves.reduce((n, s) => n + s.slots.flat().filter((slot) => slot.stack).length, 0);
  const zoned = run.shelves.reduce((n, s) => n + s.zoneIds.filter(Boolean).length, 0);
  console.log(
    `[make-save] perfect           ${run.shelves.length} 块 / ${stacks} 堆 / ${zoned} 行贴了胶带 / ${kb}KB   位置：整理期 D-7、活过 5 次`
  );
}

// ───────────── ② 完美档（生存期 D-Day，看那 14 天怎么走） ─────────────
{
  const run = structuredClone(baseRun);
  run.phase = 'survival_day';
  run.day = 0;
  const kb = write('perfect-survival', run, { survivedRuns: 5 });
  const need = dailyDrainOf(getDisasterDef('cold_snap'))
    .map((d) => `${d.category} ${d.need}/天`)
    .join('，');
  console.log(
    `[make-save] perfect-survival  同一份盘面 / ${kb}KB   位置：D-Day（日耗 ${need}，够 ${SURVIVAL_DAYS} 天）`
  );
}

console.log(`\n[make-save] 完美档写好 → ${outDir}`);
void CATEGORY_ORDER;
void createCursor;
