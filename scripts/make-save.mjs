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
import { getIdentityDef } from '../src/data/identities';
import { CATEGORY_ORDER } from '../src/data/items';
import { createCursor } from '../src/model/rng';
import { makeStack, setSlotStack } from '../src/model/shelf';
import { createSaveGame, serialize } from '../src/state/save';
import { rollShopStocks } from '../src/systems/shop';
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

// ───────── ⑤ 空房间：储藏间刚解锁、还没放东西（用户报的那一屏） ─────────
{
  /*
   * ★ 这一份是为了**复现用户看到的那一屏**：
   *
   * > "储藏间现在就是一个横条上面写着 0/3 呢，啥用没有啊。就一个分格线"
   *
   * 那是"活过 1 次、储藏间刚解锁、还没往里放东西"的状态 —— 而它在
   * 三个老档里**一个都复现不出来**（`big-house` 的储藏间已经有一块了）。
   * 一个复现不出来的状态就没法验收、也没法写测试，所以补这一份。
   *
   * `survivedRuns = 1`：刚好解锁储藏间，而 tier 3 的身份还锁着 ——
   * 顺带能看到"解锁清单里还剩什么"。
   */
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.phase = 'organize';
  run.day = FIRST_STOCKPILE_DAY;
  run.cash = 900; // 够加 9 块家具 —— 这一屏的下一步动作要当场做得了
  run.actionPoints = 3;
  run.boxesToUnpack = makeBoxes(createCursor(run.seed), 5, run.day);

  const kb = write('empty-room', run, { survivedRuns: 1 });
  console.log(`[make-save] empty-room ${run.shelves.length} 块（客厅满 3/6、储藏间空 0/3） / ${kb}KB   位置：整理期 D-7、活过 1 次`);
}

// ───────── ⑥ 行级胶带：一块货架贴两种颜色（用户拍板 2026-10 的验收位） ─────────
{
  /*
   * ★ 这一份是为了**一眼看到行级胶带**。
   *
   * 用户的要求是"给一行使用、可以给多行使用、并且给贴胶带的这一行上色"——
   * 而这三件事在老档里**一个都看不出来**（它们全是"整块贴一张"，
   * 所以每一行颜色相同，看起来与改之前一模一样）。
   * 一份"每行颜色都一样"的档验不了这个功能，所以补这一份。
   *
   * 它摆的是"同一个架上三种情况"：贴主食的两行、贴随便的一行、没贴的一行 ——
   * 一眼就能看出颜色是**跟着行**走的。
   */
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.phase = 'organize';
  run.day = FIRST_STOCKPILE_DAY;
  run.cash = 900;
  run.actionPoints = 3;
  run.boxesToUnpack = makeBoxes(createCursor(run.seed), 12, run.day);

  run.zones = [
    { id: 'zone_food', name: '主食', color: '#C8372D', autoAccept: { categories: ['food', 'water'] } },
    { id: 'zone_tool', name: '工具', color: '#4A6FA5', autoAccept: { categories: ['tool', 'fuel'] } },
    { id: 'zone_open', name: '随便', color: '#6B8E5A' }
  ];
  /*
   * 逐行贴：shelf_a 的第 0~1 行主食、第 2 行工具、第 3 行没贴 ——
   * 一块架子上同时出现三种状态，验收时最好看。
   */
  const plan = {
    shelf_a: ['zone_food', 'zone_food', 'zone_tool', null],
    shelf_b: ['zone_food', 'zone_open', 'zone_open', null],
    shelf_c: ['zone_tool', 'zone_tool', null, null]
  };
  run.shelves = run.shelves.map((s) => {
    const rows = plan[s.id];
    return rows ? { ...s, zoneIds: rows } : s;
  });

  const kb = write('rows', run);
  console.log(
    `[make-save] rows      ${run.shelves.length} 块家具 / 3 张胶带按行贴 / ${kb}KB   位置：整理期 D-7（看行级颜色）`
  );
}

// ───────── ⑦ 看商店：钱多、点位全开（第 VI 轮重排之后的点位库存） ─────────
{
  /*
   * ★ 这一份是为了**逛商店**。
   *
   * 第 VI 轮把 9 个点位的库存整个重排了一遍（让每一件物资都至少有一家店在卖，
   * 同时把"矿泉水在 7 家卖"那类重复压下去）。那件事的效果只有在**站在店里**
   * 才看得出来 —— 而且要看的是"这家有什么别人没有的"。
   *
   * 现金给到 2000：那够把最贵的几件买一遍（太阳能板 210、滤水器 165、
   * 急救包 145、羽绒睡袋 160），否则"买不起"会挡住验收。
   * 行动点给满，不然一天只够跑几家。
   */
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.phase = 'stockpile_shop';
  run.day = FIRST_STOCKPILE_DAY;
  run.cash = 2000;
  run.actionPoints = 6;
  run.boxesToUnpack = makeBoxes(createCursor(run.seed), 6, run.day);
  const kb = write('shop-tour', run);
  console.log(`[make-save] shop-tour 现金 2000 / 行动点 6 / ${kb}KB   位置：囤货期 D-7（逛 9 个点位）`);
}

// ───────── ⑧ 站在店里 + 门口那件事还没决定（购物篮与事件同时在的那一屏） ─────────
{
  /*
   * ★ 这一份是为了**底栏那一屏**：门口那件事还没决定，而人已经站在店里。
   *
   * 用户报过「买东西怎么没有那个装回车里的按钮了」—— 那正是底栏里
   * `if (run.dayEvent)` 那条分支把购物篮（含「搬回车上」）整个吃掉的地方
   * （见 `src/ui/ShopScreen.ts` 的 `renderDock`）。另外八份夹具全是
   * `dayEvent = null` + `currentShopId = null`，屏幕上**到不了**这一屏。
   *
   * 库存走真实的 `rollShopStocks`（价格、库存、属于哪一天都是它算的）。
   * ★ 别手拼 `lines` —— 我第一版少写了 `day` 字段，读档时那份库存被当成
   * "过期的"重新生成，于是夹具里的价格与屏幕上的价格不是一回事。
   *
   * 门口那件事**刻意钉死**成 `d_queue_aunt`（排队）：这一份要的是那一屏的
   * 布局，不是"随机到了哪个事件"—— `rollDayEvent` 对着这个种子完全可能
   * 返回 null，那就没有这一屏可看了。
   */
  const run = freshRun();
  run.identityId = 'group_buyer';
  run.phase = 'stockpile_shop';
  run.day = FIRST_STOCKPILE_DAY;
  run.cash = 2000;
  run.actionPoints = 6;
  run.boxesToUnpack = makeBoxes(createCursor(run.seed), 6, run.day);
  run.shopStocks = rollShopStocks(getIdentityDef('group_buyer'), createCursor(run.seed), run.day, run.disasterId);
  run.currentShopId = 'supermarket';
  run.dayEvent = { defId: 'd_queue_aunt', shopId: 'supermarket', choice: null, applied: null };
  const kb = write('day-event', run);
  console.log(
    `[make-save] day-event 站在超市 / 门口那件事还没决定 / ${kb}KB   位置：囤货期 D-7（购物篮与事件同时在）`
  );
}

console.log(`\n[make-save] 写好了 → ${outDir}`);
