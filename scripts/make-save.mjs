/**
 * 造测试存档（手工工具，不是单测）。
 *
 * ## 为什么它住在 scripts/ 而不是 src/
 *
 * 它要写文件，得用 node 的 `fs`；而本项目**故意不引 `@types/node`**
 * （零依赖是这套代码的一条纪律），所以任何 `import 'node:fs'` 的东西
 * 一进 `tsconfig.json` 的 `include` 就会让 `npm run typecheck` 失败。
 * 于是：生成器放这里（由 `vite-node` 跑，运行时不需要类型声明），
 * 而"生成的档确实是合法存档"那件事交给 `src/tools/saveFixtures.test.ts` 验收。
 *
 * 跑法：`npm run make-save`
 * 输出：`src/tools/save-100boxes.txt` / `save-good.txt` / `save-messy.txt`（一行 JSON）
 *
 * ## 为什么用真实代码路径造档
 *
 * `createStartingRun` / `generateBoxStacks` / `serialize` 都是游戏自己用的那几个函数 ——
 * 手拼 JSON 迟早会在字段改名时悄悄失效，而那种失效要到玩家粘进去报错才发现。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { BOX_DEFS } from '../src/data/boxes';
import { FIRST_STOCKPILE_DAY } from '../src/data/disaster';
import { CATEGORY_ORDER } from '../src/data/items';
import { createCursor } from '../src/model/rng';
import { makeStack, setSlotStack } from '../src/model/shelf';
import { createSaveGame, serialize } from '../src/state/save';
import { createStartingRun, addFurniture, generateBoxStacks, nextBoxSeq } from '../src/systems/setup';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'tools');

/** 造 `count` 个箱子，三种箱型轮着来；内容走真实的 `generateBoxStacks`（所以种子化、可复现） */
function makeBoxes(cursor, count, day) {
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const def = BOX_DEFS[i % BOX_DEFS.length];
    if (!def) break;
    boxes.push({ id: `box_${nextBoxSeq(boxes)}`, defId: def.id, items: generateBoxStacks(cursor, def, day) });
  }
  return boxes;
}

/**
 * 把 `count` 件某物资铺到货架上（塞满一格换下一格）。
 * @returns 实际放下的件数 —— 货架不够时会少放，调用方必须看到真实数字
 */
function shelveItem(run, itemId, count, stackLimit) {
  let left = count;
  for (let si = 0; si < run.shelves.length && left > 0; si++) {
    const shelf = run.shelves[si];
    if (!shelf) continue;
    for (let r = 0; r < shelf.h && left > 0; r++) {
      for (let c = 0; c < shelf.w && left > 0; c++) {
        const cur = run.shelves[si];
        if (!cur || cur.slots[r]?.[c]?.stack) continue;
        const take = Math.min(left, stackLimit);
        run.shelves[si] = setSlotStack(cur, { row: r, col: c }, makeStack(itemId, take, null));
        left -= take;
      }
    }
  }
  return count - left;
}

function write(name, run, metaPatch = {}) {
  /*
   * ★ 三处刻意"钉死"的随机/时间，都是为了**可复现**。
   * 实测过程：钉之前连续两次生成哈希不一致，diff 出来只有 `savedAt` 一个字段在变 ——
   * 所以别再猜，改了就跑两次比哈希。
   *
   *  1. `savedAt` —— `createSaveGame` 里写的是 `Date.now()`；
   *  2. 不调 `touch()` —— 它也会写 savedAt、还递增 syncVersion；
   *  3. `deviceId` —— `createSaveGame` 用它生成随机设备号（`dev_xxxxxxxxxx`）。
   *
   * 这三处在真实游戏里都是对的（设备号要真随机、时间戳要当次的），
   * 但对手工工具来说"字节可复现"更重要：版本控制里存着、diff 干净、
   * 出了差异一眼能看出是**结构变了**而不是噪音变了。
   *
   * `metaPatch` 用来摆出"跨局进度"（例：活过 3 次 → 身份与房间全解锁）——
   * 那些数只存在于 meta 上，不在 `run` 里。
   */
  const save = createSaveGame(run);
  Object.assign(save.meta, metaPatch);
  save.deviceId = 'dev_fixture';
  save.savedAt = 0;
  const text = serialize(save);
  writeFileSync(join(outDir, `save-${name}.txt`), text, 'utf8');
  return Math.round((text.length / 1024) * 10) / 10;
}

/** 每次从同一份干净开局起手，避免三份互相污染；种子固定，所以每次生成结果一样 */
function freshRun(seed = 20261001) {
  return createStartingRun(seed);
}

// ─────────────────────────── ① 一百箱未拆 ───────────────────────────
{
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.phase = 'organize';
  run.day = FIRST_STOCKPILE_DAY;
  run.cash = 900;
  run.actionPoints = 3;
  run.boxesToUnpack = makeBoxes(createCursor(run.seed), 100, run.day);
  const pieces = run.boxesToUnpack.reduce(
    (n, b) => n + b.items.reduce((m, s) => m + s.batches.reduce((k, x) => k + x.count, 0), 0),
    0
  );
  const kb = write('100boxes', run);
  console.log(`[make-save] 100boxes  100 箱 / ${pieces} 件 / ${kb}KB   位置：整理期 D-7`);
}

// ────────────────── ② 好档：铺满 14 天口粮（看"活下去"） ──────────────────
{
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.phase = 'survival_day';
  run.day = 0;
  run.boxesToUnpack = [];

  // 三块货架共 72 格。燃料一件 4kg、一格只叠 2 → 要 15 格；主食/饮水各 5 格
  const food = shelveItem(run, 'canned_beans', 30, 6);
  const water = shelveItem(run, 'mineral_water', 30, 6);
  const fuel = shelveItem(run, 'fuel_can', 30, 2);
  const med = shelveItem(run, 'bandage', 6, 10);
  const quilts = shelveItem(run, 'quilt', 2, 1);

  run.zones = [
    { id: 'zone_all', name: '全收', color: '#000000', autoAccept: { categories: [...CATEGORY_ORDER] } }
  ];
  run.shelves = run.shelves.map((s, i) => ({ ...s, zoneId: 'zone_all', handyRank: i === 0 ? 1 : null }));

  const kb = write('good', run);
  console.log(
    `[make-save] good      主 ${food} / 水 ${water} / 燃 ${fuel} / 药 ${med} / 被 ${quilts} / ${kb}KB   位置：D-Day`
  );
  if (food < 30 || water < 30 || fuel < 30) {
    console.error('[make-save] 警告：货架装不下这批货，"好档"不成立');
    process.exitCode = 1;
  }
}

// ───────────── ③ 乱档：同一批货全堆纸箱（看"不整理会死"） ─────────────
{
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.phase = 'survival_day';
  run.day = 0;
  run.boxesToUnpack = [
    {
      id: 'box_1',
      defId: 'box_staple',
      items: [
        ...Array.from({ length: 4 }, () => makeStack('instant_noodles', 8, null)),
        ...Array.from({ length: 5 }, () => makeStack('mineral_water', 6, null))
      ]
    },
    {
      id: 'box_2',
      defId: 'box_mixed',
      items: [
        ...Array.from({ length: 15 }, () => makeStack('fuel_can', 2, null)),
        makeStack('bandage', 4, null),
        makeStack('quilt', 1, null),
        makeStack('quilt', 1, null)
      ]
    }
  ];
  const kb = write('messy', run);
  console.log(`[make-save] messy     2 箱 / ${kb}KB   位置：D-Day（货架全空、没贴胶带）`);
}

// ───────── ④ 大房子：两间房、六块家具、活过三次（验"多房间 + 加家具"） ─────────
{
  /*
   * ★ 这一份是给"看多房间到底长什么样"用的。
   *
   * 多房间与"加家具"都要先把客厅加满（6 块 = 600 元）才看得见，
   * 而普通档在 D-7 只有几百块、还要留钱囤货 —— **人工走查根本走不到那一屏**。
   * 而走查的意义恰恰是"看那一屏"。
   *
   * 所以这一份直接把状态摆到位的**之后**：6 块家具（客厅满）+ 1 块（储藏间），
   * 外加 `survivedRuns = 3`（所有身份与房间都解锁）。
   * 它还留着 300 元，够再加三块 —— 那样能一路看到"储藏间 3/3 满"。
   */
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.phase = 'organize';
  run.day = FIRST_STOCKPILE_DAY;
  run.cash = 300;
  run.actionPoints = 3;
  run.boxesToUnpack = makeBoxes(createCursor(run.seed), 3, run.day);

  /*
   * 家具用 `addFurniture` 造 —— 与游戏里那条路**同一个函数**。
   * 手写一个 shelves 数组更快，但那样造出来的档可能是一个
   * 游戏里到不了的状态（id 撞车、房间超额），而验收会用错的东西做判断。
   */
  let shelves = run.shelves;
  // 客厅还能再放 3 块 → 先填满客厅
  for (let i = 0; i < 3; i++) shelves = addFurniture(shelves, i === 0 ? 'cabinet' : 'shelf');
  // 再放 1 块进储藏间（需要它已解锁）
  shelves = addFurniture(shelves, 'cabinet', { roomId: 'room_storage' });
  run.shelves = shelves;

  run.zones = [
    { id: 'zone_all', name: '全收', color: '#000000', autoAccept: { categories: [...CATEGORY_ORDER] } }
  ];
  run.shelves = run.shelves.map((s, i) => ({ ...s, zoneId: 'zone_all', handyRank: i === 0 ? 1 : null }));

  const kb = write('big-house', run, { survivedRuns: 3 });
  const byRoom = run.shelves.reduce((acc, s) => {
    acc[s.roomId] = (acc[s.roomId] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[make-save] big-house ${run.shelves.length} 块（${Object.entries(byRoom)
      .map(([r, n]) => `${r} ${n}`)
      .join('，')}） / ${kb}KB   位置：整理期 D-7、活过 3 次`
  );
}

console.log(`\n[make-save] 写好了 → ${outDir}`);
