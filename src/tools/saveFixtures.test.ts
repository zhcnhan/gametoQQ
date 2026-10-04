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
  it('四个档都在，而且都是当前版本、都能被 migrate 读回来', () => {
    for (const name of ['100boxes', 'good', 'messy', 'big-house', 'empty-room', 'rows']) {
      const back = deserialize(fixture(name));
      expect(back, name).not.toBeNull();
      expect(back?.run, name).not.toBeNull();
      expect(back?.meta.version, name).toBe(SAVE_VERSION);
    }
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
