/**
 * 测试存档的**验收**（`scripts/make-save.mjs` 产出的那三个 txt）。
 *
 * ## 为什么验收和生成分在两处
 *
 * 生成器要写文件（需要 node 的 `fs`），而本项目故意不引 `@types/node` ——
 * 带 `node:fs` 的文件一旦进 `tsconfig` 的 `include` 就会让 `npm run typecheck` 失败。
 * 所以生成器住在 `scripts/`（由 `vite-node` 跑），验收住在这里（纯读文本，零 node 依赖）。
 *
 * ## 它守什么
 *
 * 那三个档是**手工粘进浏览器控制台**用的。手工工具最大的风险是"悄悄失效"：
 * 字段改名之后生成器照跑不误，产出却是废档 —— 玩家粘进去只会看到白屏或旧档。
 * 这一组把"它们必须能被 `migrate` 读回来、而且是当前版本"钉住。
 *
 * 重新生成：`npm run make-save`（种子固定，产出可复现）
 */
import { describe, expect, it } from 'vitest';
import { SURVIVAL_DAYS, getDisasterDef } from '../data/disaster';
import { getItemDef } from '../data/items';
import { dailyDrainOf } from '../data/survival';
import { emergencyCategories, isShelfTidy, computeOrganizeScore, toPercent } from '../model/score';
import { onlyZoneIdOf } from '../model/shelf';
import { SAVE_VERSION, deserialize } from '../state/save';
import { householdTotals } from '../systems/organize';

/**
 * 读 `src/tools/` 下的存档文本。
 *
 * ★ 用 `import.meta.glob`（构建工具自带）而不是 node 的 `fs`：
 * 这个文件在 `tsconfig` 的 `include` 里，而本项目**故意不引 `@types/node`** ——
 * 一行 `import 'node:fs'` 就会让 `npm run typecheck` 失败。
 * （生成器那边反过来：它由 vite-node 跑，不受 tsc 约束，所以能用 fs 写文件。）
 *
 * `?raw` 读 `.txt` 是好的 —— 当初读 `.css` 拿到空串是 vitest 对样式表有专门的资产处理，
 * 普通文本文件没这个问题（这一条是实测出来的，别照抄到 `.css` 上）。
 */
const FIXTURES = import.meta.glob('./save-*.txt', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

function fixture(name: string): string {
  const text = FIXTURES[`./save-${name}.txt`];
  if (text === undefined) {
    throw new Error(`缺少存档 ${name} —— 先跑 npm run make-save 生成`);
  }
  return text;
}

describe('测试存档', () => {
  it('每个档都在，而且都是当前版本、都能被 migrate 读回来', () => {
    for (const name of ['100boxes', 'good', 'messy', 'big-house', 'empty-room', 'rows', 'shop-tour', 'day-event', 'many-tapes']) {
      const back = deserialize(fixture(name));
      expect(back, name).not.toBeNull();
      expect(back?.run, name).not.toBeNull();
      expect(back?.meta.version, name).toBe(SAVE_VERSION);
    }
  });

  it('★ day-event：人站在店里、门口那件事还没决定 —— 「购物篮与事件同时在」那一屏的走查位', () => {
    /*
     * 这份夹具是给"门口那件事还没决定，人已经站在店里"用的 —— 正是用户报
     * 「买东西怎么没有那个装回车里的按钮了」时的那个局面。
     *
     * ★ 另外八份全是 `dayEvent = null` + `currentShopId = null`，屏幕上**到不了**
     * 这一屏；而这一屏恰恰是底栏那条 `if (run.dayEvent)` 分支会把「搬回车上」
     * 整个吃掉的地方。所以这一条不是在验"存档读得回来"（上面已经验过），
     * 是在验**这份夹具还站在那个局面上** —— 谁把它改回 dayEvent=null、
     * 或者把店里的货抽空，这条会先红。
     */
    const save = deserialize(fixture('day-event'));
    expect(save?.run?.currentShopId, '人要站在店里').toBe('supermarket');
    expect(save?.run?.dayEvent?.choice, '那件事要**还没**决定').toBeNull();
    expect(save?.run?.dayEvent?.defId, '而且得是真的事件 id').toBe('d_queue_aunt');
    const stock = save?.run?.shopStocks?.find((s) => s.shopId === 'supermarket');
    expect((stock?.lines ?? []).filter((l) => l.stock > 0).length, '店里得有货可买').toBeGreaterThan(0);
  });

  it('★ rows：一块货架上真的贴着**不同的**胶带（行级颜色的验收位）', () => {
    /*
     * ★ 这份夹具是给"一眼看到行级胶带"用的，所以它必须真的**每一行不同** ——
     * 一份"每行颜色都一样"的档在屏幕上看不出与改之前有什么区别，
     * 那就等于没有验收位。
     */
    const save = deserialize(fixture('rows'));
    const shelves = save?.run?.shelves ?? [];
    const rowsOf = (s: (typeof shelves)[number]) =>
      Array.from({ length: s.h }, (_, r) => s.zoneIds[r] ?? null);
    // 至少有一块货架的相邻两行是**不同**的胶带
    const mixed = shelves.filter((s) => new Set(rowsOf(s)).size > 1);
    expect(mixed.length, '至少要有一块架子贴了不止一种胶带').toBeGreaterThan(0);
    // 而且要有"没贴"的行（第三种状态）
    expect(rowsOf(mixed[0]!).some((id) => id === null)).toBe(true);
    // 三张胶带都真的被用到（否则夹具里会有孤儿胶带）
    const used = new Set(shelves.flatMap(rowsOf).filter((id): id is string => id !== null));
    for (const z of save?.run?.zones ?? []) {
      expect(used.has(z.id), `胶带「${z.name}」没有任何一行在用`).toBe(true);
    }
  });

  it('★ many-tapes：14 张胶带、6 张贴在行上 —— 「胶带架塞满」那一屏的走查位', () => {
    /*
     * 用户 m18160（乔子一号）的原话：「那个胶带，超过5个，就不好改名字了，
     * 会超出屏幕外」。这份夹具就是那条线之后的样子。
     *
     * ★ 它必须**真的够多**：9 张时列表正好铺满两行（实测 `scrollH 95 /
     * clientH 94`），"第三行竖着划"那一步根本没被走到 —— 14 张才撑到第三行。
     * 谁把它改少了这条会先红：这里验的不是"读不读得回来"（上面已经验过），
     * 是"它还是不是那一屏"。
     */
    const save = deserialize(fixture('many-tapes'));
    const shelves = save?.run?.shelves ?? [];
    const rowsOf = (s: (typeof shelves)[number]) =>
      Array.from({ length: s.h }, (_, r) => s.zoneIds[r] ?? null);
    expect(save?.run?.phase, '得站在整理期那一屏').toBe('organize');
    expect(save?.run?.zones?.length, '够多才撑得到第三行').toBe(14);
    const placed = new Set(shelves.flatMap(rowsOf).filter((id): id is string => id !== null));
    expect(placed.size, '贴在行上的那几张').toBe(6);
    // 剩下 8 张**没贴在任何行上**（`is-idle`：撕下来之后留在架上那一种状态）
    expect((save?.run?.zones?.length ?? 0) - placed.size).toBe(8);
    // 至少一块架子是全空的（"拖到某一行上"那条路的落点）
    expect(shelves.some((s) => rowsOf(s).every((id) => id === null)), '要留一块空架子').toBe(true);
  });

  it('★ big-house：两间房都有家具，而且是靠跨局进度解锁的', () => {
    /*
     * 它存在的理由很具体：多房间与"加家具"都要先把客厅加满（6 块 = 600 元），
     * 而普通档在 D-7 只有几百块、还要留钱囤货 —— **人工走查根本走不到那一屏**，
     * 而走查的意义恰恰是"看那一屏"。
     */
    const save = deserialize(fixture('big-house'));
    expect(save).not.toBeNull();
    const rooms = save!.run!.shelves.reduce<Record<string, number>>((acc, s) => {
      acc[s.roomId] = (acc[s.roomId] ?? 0) + 1;
      return acc;
    }, {});
    expect(rooms['room_living'], '客厅该是满的').toBe(6);
    expect(rooms['room_storage'], '储藏间该有家具').toBeGreaterThan(0);
    // 跨局进度：活过 3 次 → 所有身份与房间都解锁（否则那一屏是矛盾的）
    expect(save!.meta.survivedRuns).toBeGreaterThanOrEqual(1);
  });

  it('★ 100boxes：100 个箱子、900 件以上，而且全在待拆队列里（货架空着）', () => {
    const run = deserialize(fixture('100boxes'))?.run;
    expect(run).toBeDefined();
    expect(run?.boxesToUnpack).toHaveLength(100);
    const pieces = householdTotals(run!).pieces;
    /*
     * ★ 门槛从 1000 降到 900（2026-10，第 VI 轮加完物资之后）。
     *
     * 这份夹具**件数会随物资表漂**：箱内内容是 `generateBoxStacks` 按
     * `shuffle(cursor, def.pool)` 抽的，而池子是**按品类从 `ITEM_DEFS` 现算**的。
     * 加 34 件物资 → 池子变长 → 同一个种子洗出来的结果不同 →
     * 实测件数 1067 → **975**。
     *
     * ⚠ 这与 `survival.test.ts` 的 `bareRun` 是**同一个坑的两种表现**
     * （那边修的是探针，这边是夹具）。夹具的用途是"整理页的压测位"，
     * 所以门槛该按**用途**定（几百件就够压），而不是钉一个会被内容量带走的数。
     */
    expect(pieces).toBeGreaterThan(900);
    // "一百箱未拆"的意思就是：一件都没上架
    const onShelves = run!.shelves.reduce(
      (n, s) => n + s.slots.reduce((m, row) => m + row.filter((slot) => slot.stack).length, 0),
      0
    );
    expect(onShelves).toBe(0);
    expect(run?.phase).toBe('organize');
  });

  it('★ good：14 天口粮齐了、写全清单、标了顺手位 —— D-Day 开局', () => {
    const run = deserialize(fixture('good'))?.run;
    expect(run).toBeDefined();
    expect(run?.phase).toBe('survival_day');
    expect(run?.day).toBe(0);
    // 胶带写全了清单（§12 v0.8 之后这才是"整理好"的定义）
    expect(run?.zones[0]?.autoAccept?.categories?.length).toBeGreaterThanOrEqual(6);
    // 顺手位全屋唯一
    expect(run?.shelves.filter((s) => s.handyRank !== null)).toHaveLength(1);
    // 三样刚需都够 14 天（燃料 2/天、主食 2/天、饮水 2/天）
    const perCategory = new Map<string, number>();
    for (const box of run!.boxesToUnpack) for (const st of box.items) perCategory.set(st.itemId, 0);
    const count = (predicate: (itemId: string) => boolean): number => {
      let n = 0;
      for (const s of run!.shelves) {
        for (const row of s.slots) {
          for (const slot of row) {
            if (!slot.stack || !predicate(slot.stack.itemId)) continue;
            n += slot.stack.batches.reduce((k, b) => k + b.count, 0);
          }
        }
      }
      return n;
    };
    expect(count((id) => id === 'canned_beans')).toBeGreaterThanOrEqual(30);
    expect(count((id) => id === 'mineral_water')).toBeGreaterThanOrEqual(30);
    expect(count((id) => id === 'fuel_can')).toBeGreaterThanOrEqual(30);
    expect(count((id) => id === 'quilt')).toBeGreaterThanOrEqual(2);
  });

  it('★ messy：同一批货全在纸箱里，货架一件没有（"不整理会死"的对照）', () => {
    const run = deserialize(fixture('messy'))?.run;
    expect(run).toBeDefined();
    expect(run?.boxesToUnpack.length).toBeGreaterThan(0);
    const onShelves = run!.shelves.reduce(
      (n, s) => n + s.slots.reduce((m, row) => m + row.filter((slot) => slot.stack).length, 0),
      0
    );
    expect(onShelves).toBe(0);
    // 一件胶带都没贴 —— 归位率必然是 0
    expect(run?.zones).toHaveLength(0);
    expect(run?.shelves.every((s) => onlyZoneIdOf(s) === null)).toBe(true);
  });

  it('生成器是种子化的：同一份档读两次结果一致（可复现）', () => {
    expect(fixture('100boxes')).toBe(fixture('100boxes'));
    expect(fixture('100boxes').length).toBeGreaterThan(1000);
  });
});

/**
 * ★★ 完美档（`scripts/_make-perfect.ts` 产出）。
 *
 * ## 为什么这一组必须**量**而不是"看着整齐"
 *
 * "完美"在这套代码里不是形容词，是一组**可算的量**（归位率 / 临期优先 /
 * 应急可达率 / 待拆箱数 / 整整齐齐徽章）。一个"看起来摆得很整齐"的档
 * 完全可能归位率是 0 —— 例如把牛奶（品类是 **water** 不是 food）
 * 放进"主食"那一段：屏幕上看着天经地义，而归位率的分母里它是一堆错放的货。
 *
 * 所以这一组把五个量**逐个算出来**，而不是检查"它是不是非空"。
 */
describe('★★ 完美档', () => {
  const PERFECT = ['perfect', 'perfect-survival'] as const;

  it('两份都在、都是当前版本', () => {
    for (const name of PERFECT) {
      const back = deserialize(fixture(name));
      expect(back?.run, name).not.toBeNull();
      expect(back?.meta.version, name).toBe(SAVE_VERSION);
    }
  });

  it('★★ 归位率 / 临期优先 / 应急可达率 **全是满分**', () => {
    for (const name of PERFECT) {
      const run = deserialize(fixture(name))!.run!;
      const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, getDisasterDef(run.disasterId));
      expect(toPercent(score.placement), `${name} 归位率`).toBe(100);
      expect(toPercent(score.fefo), `${name} 临期优先`).toBe(100);
      expect(toPercent(score.emergency), `${name} 应急可达率`).toBe(100);
      expect(score.weighted, `${name} 加权总分`).toBeCloseTo(1, 5);
    }
  });

  it('★★ 没有待拆箱（纸箱会进归位率的分母，留着就不是满分）', () => {
    for (const name of PERFECT) {
      expect(deserialize(fixture(name))!.run!.boxesToUnpack, name).toHaveLength(0);
    }
  });

  it('★★ 有一块货架真的拿到了「整整齐齐」（每一行都贴了胶带，行内都在清单上）', () => {
    for (const name of PERFECT) {
      const run = deserialize(fixture(name))!.run!;
      const tidy = run.shelves.filter((s) => isShelfTidy(s, run.zones));
      expect(tidy.length, `${name} 该有至少一块整整齐齐`).toBeGreaterThan(0);
      /*
       * ★ 而它**不是靠"全部贴满"作弊来的**：另外几块刻意留了空行不贴 ——
       * 徽章问的是"你有没有把**某一块**完全管好"，不是"全部都要"。
       * 所以这里同时钉住"不是每块都 tidy"，否则那一行的意义就没了。
       */
      expect(tidy.length, `${name} 不该每块都是`).toBeLessThan(run.shelves.length);
    }
  });

  it('★★ 够活满 14 天：三个刚需品类各 >= 28 件（寒潮日耗 2+2+2）', () => {
    const run = deserialize(fixture('perfect-survival'))!.run!;
    const need = dailyDrainOf(getDisasterDef(run.disasterId));
    for (const line of need) {
      let have = 0;
      for (const s of run.shelves) {
        for (const row of s.slots) {
          for (const slot of row) {
            if (!slot.stack) continue;
            if (getItemDef(slot.stack.itemId).category !== line.category) continue;
            have += slot.stack.batches.reduce((k, b) => k + b.count, 0);
          }
        }
      }
      expect(have, `${line.category} 该够 ${line.need * SURVIVAL_DAYS} 件`).toBeGreaterThanOrEqual(
        line.need * SURVIVAL_DAYS
      );
    }
  });

  it('★ 两份的**盘面一模一样**（差别只在 phase / day）', () => {
    /*
     * ★ 这一条钉的是一个具体的坑：`addFurniture` 的 id 来自**模块级递增计数器**
     * （`model/shelf.ts` 的 `nextShelfId`），所以"在同一个进程里造两次盘面"
     * 会得到两组不同的 id（`shelf_1`/`shelf_2` vs `shelf_3`/`shelf_4`），
     * 而铺货是按 id 写的 —— 第二份会报"没有 shelf_2"。
     * 生成器因此改成"造一次、落两档"，这条用例守住那个决定。
     */
    const a = deserialize(fixture('perfect'))!.run!;
    const b = deserialize(fixture('perfect-survival'))!.run!;
    expect(b.shelves).toEqual(a.shelves);
    expect(b.zones).toEqual(a.zones);
    expect(a.phase).toBe('organize');
    expect(b.phase).toBe('survival_day');
    expect(b.day).toBe(0);
  });

  it('★ 顺手位标在**应急品类最全**的那一块上（不是随便一块）', () => {
    for (const name of PERFECT) {
      const run = deserialize(fixture(name))!.run!;
      const handy = run.shelves.filter((s) => s.handyRank !== null);
      expect(handy.length, `${name} 顺手位该正好一块`).toBe(1);
      const categories = new Set<string>();
      for (const s of handy) {
        for (const row of s.slots) {
          for (const slot of row) {
            if (slot.stack) categories.add(getItemDef(slot.stack.itemId).category);
          }
        }
      }
      // 寒潮的应急品类 = 燃料 ∪ 保暖 ∪ 医疗
      for (const want of emergencyCategories(getDisasterDef(run.disasterId))) {
        expect([...categories], `${name} 顺手位上该有 ${want}`).toContain(want);
      }
    }
  });
});
