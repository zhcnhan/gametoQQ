/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  屋子进水：**从下往上**吃掉空间（M4 W-05 的地基）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它补的是哪一笔
 *
 * `systems/setup.ts` 的 `createStartingShelves` 早就会按灾难的 `capacityFactor`
 * 铺出**矮一排**的架子，注释里写着叙事："**进水 / 结冰 / 塌方都是从下往上吃掉空间**"。
 * 但那件事**只在开局那一刻**发生 —— 进去之后，这一局的屋子就再也不会变小了。
 *
 * 于是 M4 的验收第 2 条（"让一类事件动你家里的摆放"）落在这里：
 * **让水位在局中涨一次**。它改变的是玩家已经做过的决定 ——
 * "低处放什么"第一次成为可后悔的决定。
 *
 * ## 数据约定（★ 这里最容易搞反，所以写在最前面）
 *
 * `Shelf.slots` 是 `[row][col]`，而 **row 0 是屏幕上最上面那一排**：
 *  · `readingOrder()`（`model/shelf.ts`）从 `r = 0` 往右读；
 *  · `ui/OrganizeScreen.ts` 的渲染循环 `for (let row = 0; row < shelf.h; row++)`
 *    按顺序 push，而 `.shelf-rows` 是普通 `flex-direction: column`（**没有 `column-reverse`**）；
 *  · `createShelf` 的 `zoneIds` 与 `slots` 同长同序。
 *
 * 所以"**从下往上**"在数据上 = 砍 `slots` 的**尾部**（下标最大的那些行）。
 * 这与 `rowsFor()` 的形状也一致 —— 它就是让 `slots.length` 变小。
 *
 * ⚠ 反过来说：**`slots.length` 是"这块家具有几排"的唯一真相**（`h` 由它反推，
 * 见 `state/save.ts` 的规范化）。砍行必须同时截 `slots` 与 `zoneIds`，
 * 只改 `h` 会让三者的长度对不上，而 `isInside` 只查 `h` —— 那是"放得进去、
 * 东西却不见了"那一类静默 bug 的温床。
 *
 * ## 它不销毁任何东西
 *
 * 被淹的那些行里的货**不蒸发**，而是**装成箱**进待拆队列（由 systems 层装箱，
 * 因为箱型表在 `data/boxes` 里，而 model/ 不允许反向依赖 data/ 的表）。
 * 理由不是心软，是反馈：整批货凭空消失，玩家只会认为存档坏了；
 * 装成一箱则是"你昨晚把泡了的东西捞进一个箱子" —— 一个**看得见**的后果，
 * 而且箱子里的东西是系统替你选的，所以它确实是一次损失（§10.1A 第 1 条：
 * 只改数字的机制必须同时有非数字的表达，这里的那一半是**箱子数**与**排数**）。
 */
import type { ItemStack, Shelf, Zone } from './types';

/**
 * 一次最多淹掉几排。
 *
 * 为什么要有这个上限：`slots.length` 的下限是 1（见下），但"每块家具只剩一排"
 * 会让整理这件事当场退化 —— 那时玩家能做的决定只剩"这一件放哪一格"，
 * 而 §10.1A 要的恰恰是更多维度的决定。
 */
export const HOME_SINK_MAX_ROWS = 2;

export interface SinkShelvesResult {
  /** 砍完之后的货架（**新的数组**，按 id 与入参一一对应） */
  shelves: Shelf[];
  /** 从被淹的行里捞出来的货。**不许丢** —— 调用方负责装箱 */
  salvaged: { shelfId: string; shelfLabel: string; stacks: ItemStack[] }[];
  /**
   * 每块**真的被砍了**的家具砍掉几排。
   *
   * 它与传入的 `count` 可能不同，而且这个差别是**故意的**：只剩一排的家具砍不动
   * （见下面的下限），所以"三块架子、一块是茶几"时，茶几那一块原样不动 ——
   * 物理上说得通（矮家具本来就淹不着），玩家也能从盘面上直接看出来。
   */
  rows: number;
  /** 被砍掉的行原本在哪几块家具上 */
  shelfIds: string[];
  /** 砍完之后**一行都不剩**的胶带。调用方要把它从 `run.zones` 里摘掉 */
  orphanZones: Zone[];
}

/**
 * 把每块家具的**底下 `count` 排**收掉，行里的货捞出来交给调用方。
 *
 * @param shelves 这一局的货架
 * @param zones   这一局的胶带（只用来算 `orphanZones`，不改它）
 * @param count   想砍几排
 * @param labelOf 给捞出来的货配一句人话（"货架 A"），由界面层的口径决定
 */
export function sinkShelves(
  shelves: readonly Shelf[],
  zones: readonly Zone[],
  count: number,
  labelOf: (shelf: Shelf, index: number) => string
): SinkShelvesResult {
  const rows = Math.max(0, Math.min(Math.trunc(count), HOME_SINK_MAX_ROWS));
  const salvaged: SinkShelvesResult['salvaged'] = [];
  const shelfIds: string[] = [];

  const next = shelves.map((shelf, index) => {
    /*
     * ★ 每块家具**至少留一排**。
     *
     * 留不下的原因是 `h ≥ 1` 这件事在别处被当成不变量用（`rowsFor()` 也保它），
     * 而 0 排的家具会让 `isInside` 恒假、`readingOrder` 返回空 —— 界面上是
     * 一块永远放不进东西的空壳，玩家只会认为它坏了。
     */
    const cut = Math.min(rows, Math.max(0, shelf.h - 1));
    if (cut <= 0) return shelf;
    shelfIds.push(shelf.id);
    const gone = shelf.slots.slice(shelf.h - cut);
    const stacks = gone
      .flatMap((row) => row.map((slot) => slot.stack))
      .filter((s): s is ItemStack => s !== null);
    if (stacks.length > 0) salvaged.push({ shelfId: shelf.id, shelfLabel: labelOf(shelf, index), stacks });
    return {
      ...shelf,
      h: shelf.h - cut,
      slots: shelf.slots.slice(0, shelf.h - cut),
      zoneIds: shelf.zoneIds.slice(0, shelf.h - cut)
    };
  });

  /*
   * 行没了，贴在那一行上的胶带也就没地方可贴了。
   *
   * ★ 这里**只报不改**：胶带表在 `run.zones` 上，删它要连存档与界面一起动，
   * 所以由 systems 层统一做。判断口径是"这张胶带在新盘面上**一次都没被引用**" ——
   * 它与 `deleteZone` 用的是同一把尺子（那边数的是"哪几块架子会一起松掉"）。
   */
  const alive = new Set<string>();
  for (const shelf of next) for (const id of shelf.zoneIds) if (id !== null) alive.add(id);
  const orphanZones = zones.filter((z) => !alive.has(z.id));

  return { shelves: next, salvaged, rows: shelfIds.length === 0 ? 0 : rows, shelfIds, orphanZones };
}
