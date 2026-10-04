/**
 * ★★ 「翻乱相邻货架」（§6.4 的滚雪球）—— 清偿 D-11。
 *
 * ## 它在设计上是什么
 *
 * §6.4 原文写的是：「乱 → 翻找耗时、**翻乱相邻货架（滚雪球）**、可能误食过期品」。
 * 两头早就落地了（翻找耗时 → 体力劳作 + 心情惩罚；误食 → 腐坏机制），
 * 中间这一条原来**刻意没做**，理由是"它会自我放大，玩家掉进去就爬不出来"。
 *
 * ## 为什么现在做，以及怎么让它不失控
 *
 * D-11 自己写着"再叠一层之前，得先拿'体力见底'这条链做一轮真实手感验证" ——
 * 而那轮验证已经跑过好几轮走测了。但"验证过"不等于"可以随便加一层"，
 * 所以这个实现有三条**刻意的收敛**：
 *
 *  ① **它只在你从货架上取过东西的那天发生**（`taken > 0`）——
 *     "翻找"这个动作是前提。没取东西的一天，屋子不会自己乱。
 *     ★ 这条同时把它与"灾难磨损"分开：后者是外力，前者是你自己翻的；
 *  ② **它把东西挪到**同一行的另一个位置，**不跨架、不跨行** ——
 *     所以最坏情况下玩家只需在那一行里挪几下，而不是面对一屋子乱账；
 *  ③ **它的量由整理质量决定**（不是独立的随机数）：乱得越狠，翻乱得越多。
 *     这条最重要 —— 玩家能学到"**我把这一行分好，明天就不会被翻乱**"，
 *     而那正是 §10.1A 要的"整理本身是个决定"。
 *
 * ## 它为什么是"滚雪球"（自我放大），以及那个放大在哪一步合成
 *
 * 这条链是：**乱 → 取用时翻找 → 那几行更乱 → 归位率更低 → 明天翻得更狠**。
 * 而它有**两个自然的刹车**，所以不会失控：
 *  · 每一行最多被翻乱到"整行乱序"为止（不会越翻越乱，只会维持乱）；
 *  · 玩家随时可以点「按保质期排」一次收回（那是整理页的现成按钮）。
 */
import { findZone, isOffZone, readingOrder, rowZoneId, setSlotStack } from './shelf';
import type { RunState, Shelf, Zone } from './types';

/** 一天最多翻乱几处 —— 上限存在的理由是"不许一天之内把一屋子毁掉" */
export const SCATTER_MAX_PER_DAY = 4;

/**
 * 今天该翻乱几处。
 *
 * 判据全部来自**已经算出来的结算值**，不引入新的随机来源：
 *
 * | 输入 | 含义 | 为什么算进来 |
 * | --- | --- | --- |
 * | `taken <= 0` | 今天没从货架上取东西 | 没翻找，就不会乱 |
 * | `placement >= 1` | 归位率满分 | ★ **全都归位了就没有可翻乱的** —— 见下 |
 * | `unreachable` | 有东西翻不出来 | "翻得狠"的直接证据 |
 * | `placement < 0.7 / 0.4` | 归位率低 | 乱得越狠，越容易被翻乱 |
 *
 * 返回值是**处数**（0~`SCATTER_MAX_PER_DAY`）。
 *
 * ## ★★ `placement >= 1` 那一行是补上的，而且它是我第一版的设计错误
 *
 * 第一版没有它，于是**中途补救那一局（完全整理好、归位率 1.0）每天照样被翻乱 4~6 件** ——
 * 实测：
 *
 * ```
 * 补救（已整理好）  翻乱=[4,5,4,3,2,0,6,5,4,3,2,0,2,2]
 * ```
 *
 * 那正好**违背这条机制存在的理由**。这条机制要教的是
 * "**你分好这一行，明天就不会被翻乱**"；而如果连满分盘面都会被翻乱，
 * 玩家学到的就是"整理没用，反正都会乱"—— 那是最坏的一种反馈。
 *
 * ⚠ 而且它不只是"手感"问题：`placement >= 1` 是成就「整整齐齐」的门槛
 * （见 `survival.ts` 里 `cleanDays` 的判据），一个满分盘面被自己翻乱，
 * 会让那条成就变成运气。
 */
export function scatterCountFor(input: { taken: number; unreachable: number; placement: number }): number {
  if (input.taken <= 0) return 0;
  // ★ 全都归位了：没有"乱"可翻。这条同时保住了成就与教学
  if (input.placement >= 1) return 0;
  let n = 1;
  // 有翻不出来的东西：那是"翻了很久"的证据
  if (input.unreachable > 0) n += 1;
  // 归位率越低越容易翻乱。两档而不是线性：档位是玩家能记住的说法
  if (input.placement < 0.7) n += 1;
  if (input.placement < 0.4) n += 1;
  return Math.min(SCATTER_MAX_PER_DAY, n);
}

export interface ScatterResult {
  shelves: Shelf[];
  /** 被挪动了几件（0 = 没乱） */
  moved: number;
  /** 被翻乱的那几行的标签，供日志用（例：`货架 A 第 2 行`） */
  rows: string[];
}

/**
 * 把 `rows` 里指定几行的东西**在同一行内挪位**。
 *
 * 做法刻意笨：把那一行有东西的格子按阅读顺序取出来，**旋转一位**
 * （第一件挪到最后）。理由：
 *  · 旋转保证"真的变了"（不会转一圈回到原样），而且**确定性**——
 *    同 seed 同结果，与项目其它地方一致；
 *  · 不引入新的库存、不销毁东西、不跨行 —— 所以**它不可能造成物资损失**。
 *    这一点比"看起来更乱"重要：一个会丢东西的机制会让玩家再也不敢整理。
 *
 * ★ 它**不碰胶带**（`zoneIds` 原样）—— 翻乱翻的是位置，不是规矩。
 * 这也让"乱"的后果停在"归位率掉了"，而不是"你的分区被删了"。
 */
export function scatterRows(shelf: Shelf, rows: readonly number[], rng: () => number): ScatterResult {
  let next = shelf;
  let moved = 0;
  const touched: string[] = [];

  for (const row of rows) {
    if (row < 0 || row >= shelf.h) continue;
    const occupied: { col: number; stack: NonNullable<ReturnType<typeof occupiedStackAt>> }[] = [];
    for (let col = 0; col < shelf.w; col++) {
      const stack = occupiedStackAt(next, row, col);
      if (stack) occupied.push({ col, stack });
    }
    // 一件或没有：没什么可翻的
    if (occupied.length <= 1) continue;

    /*
     * 旋转**一位**，方向由 `rng` 决定（左旋或右旋）。
     * 用 `rng` 而不是 `Math.random`：项目纪律要求一切随机走种子化 RNG，
     * 而"同 seed 同结果"是回放与探针的地基。
     */
    const left = rng() < 0.5;
    const order = left ? [...occupied.slice(1), occupied[0]!] : [occupied[occupied.length - 1]!, ...occupied.slice(0, -1)];
    for (let i = 0; i < occupied.length; i++) {
      const from = order[i]!;
      const to = occupied[i]!;
      next = setSlotStack(next, { row, col: to.col }, from.stack);
    }
    moved += occupied.length;
    touched.push(`第 ${row + 1} 行`);
  }

  return { shelves: next ? [next] : [], moved, rows: touched };
}

/** 取一格的堆（抽出来只是为了让上面那段读起来短一点） */
function occupiedStackAt(shelf: Shelf, row: number, col: number) {
  const slot = shelf.slots[row]?.[col];
  return slot?.stack ?? null;
}

/**
 * 挑出"该被翻乱"的那几行 —— 规则是**先挑最乱的行**。
 *
 * 「最乱」的判据与界面上那三个指标同一个口径：这一行里有多少件
 * **不在这行胶带的清单里**（`isOffZone`）。所以玩家在整理页看到的"不在这张胶带的清单里"
 * 的墨点，就是这里被挑中的原因 —— 两个地方读的是同一条规则。
 *
 * ⚠ 没有胶带的行也算候选（它们同样"乱"），但**排在后面**：
 * 一行有胶带却没按清单放，比一行干脆没立规矩更该出后果。
 */
export function messiestRows(run: RunState, limit: number): { shelfId: string; label: string; row: number }[] {
  const scored: { shelfId: string; label: string; row: number; score: number; taped: boolean }[] = [];

  for (const shelf of run.shelves) {
    for (const pos of readingOrder(shelf)) {
      if (pos.col !== 0) continue; // 逐行只算一次
      const zone = findZone(run.zones, rowZoneId(shelf, pos.row));
      let off = 0;
      let total = 0;
      for (let col = 0; col < shelf.w; col++) {
        const stack = occupiedStackAt(shelf, pos.row, col);
        if (!stack) continue;
        total += 1;
        if (isOffZone(zone, stack)) off += 1;
      }
      if (total === 0) continue;
      scored.push({
        shelfId: shelf.id,
        label: shelf.kind,
        row: pos.row,
        score: total > 0 ? off / total : 0,
        taped: zone !== null
      });
    }
  }

  return scored
    .sort((a, b) => {
      // 乱的优先；同为乱，**有胶带的优先**（立了规矩没守，比没立规矩更该有后果）
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.taped) - Number(a.taped);
    })
    .slice(0, limit)
    .map(({ shelfId, label, row }) => ({ shelfId, label, row }));
}

/** 一行现在贴着哪张胶带（日志里想说人话时用） */
export function rowZoneName(zones: readonly Zone[], shelf: Shelf, row: number): string {
  return findZone(zones, rowZoneId(shelf, row))?.name ?? '';
}
