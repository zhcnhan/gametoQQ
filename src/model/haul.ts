/**
 * 第 7 维（搬运惩罚）的**位置**那一半：东西压在最里头那块，取出来要多花力气。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  它补的是哪一笔账
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 在这一版之前，`carryFactor` **只是一条纯数值**：`systems/shop.ts:363` 拿它乘
 * 手提上限（"这一趟少拎两公斤"）。它改的是"你一趟能拿多少"，**不碰"东西放在哪"** ——
 * 于是 17 个灾难维度里，真正改"该放哪儿"的只有 #2 / #3 / #14 三个
 * （见 `docs/囤货末世-实施记录.md` 的分维对账表第 3 行）。
 *
 * 这个文件让第 7 维也改"该放哪儿"：**屋里越靠里的一块，取用越费体力**，
 * 而"费多少"由这一场的 `carryFactor` 决定 —— 平时（factor ≥ 1）一分不多花，
 * 搬不动的天气里最里头那块要多花一成五。
 *
 * ## 它让哪个决定不同
 *
 * 以前"重型货放哪儿"只影响**临期优先率**（冰箱怕断电、怕晒），
 * 而那是"坏不坏"，不是"拿不拿得动"。现在多了一条轴：
 * **同样是一袋米，压在门口那块和压在最里头那块，每天的体力账不一样。**
 * 于是"新买的柜子放哪儿""要不要把米挪到门口那块"第一次有了答案。
 *
 * ## 三条口径（改这个文件前先读这三条）
 *
 * 1. **只在 `carryFactor < 1` 时生效。** 平时摆哪儿都不额外费劲 ——
 *    这是"平时不用管"的保证，也是三条永久回归探针的前提
 *    （它们的灾难没有搬运惩罚，所以这条路对它们是恒等的）。
 * 2. **按"存量在哪"算，不按"今天从哪拿的"算。** 这一层刻意做成纯函数、
 *    只吃 `shelves`：算的是"你把东西放在了哪儿"。理由不是省事，是**能被验证** ——
 *    "每件货从哪块货架取的"拿不到独立证据（那要改消耗层的接口），
 *    而"存量分布没变"是可以在测试里断死的（灾难不改归属）。
 *    ⚠ 代价：它会随着消耗而漂移（深处的东西吃完了，乘数自己降下来）。
 *    那不是 bug，是"你把重的堆在里头"的自然收敛；但它确实不是逐件的精确账。
 * 3. **箱子算最顺手（第 0 层）**：纸箱卸在门口，`refillFromBoxes` 一直先填它。
 *    所以"还没拆的箱子"不会因为这条轴被二次惩罚 —— 那已经由归位率收过一次了。
 */

import type { Shelf } from './types';
import { countStacks } from './shelf';

/** 最里头那块最多多花几成体力（0.15 = 一成五）。见下面"为什么是 15%" */
export const HAUL_PREMIUM_MAX = 0.15;

/**
 * 要多少搬运惩罚才把上面那个上限**吃满**。
 *
 * `carryFactor` 被 `disasterModifiersOf` 夹在 0.5~1，所以 1 − 0.5 = 0.5 是它的全程。
 * 取 0.5 意味着"最糟的那一场（0.5）吃满一成五，0.75 那一档吃七成五"。
 */
export const HAUL_FULL_RAMP = 0.5;

/**
 * 为什么是 15%，而不是 30% 或 5%
 *
 * 标尺是**身份天赋**：`warehouse_porter`（装卸工，全案最省力的那个身份）
 * 是 20%。这条轴一上来就压过最省力的身份，会让"选谁"变得不重要 ——
 * 所以它必须**明显小于 20%**，同时要大到能在日报上被看见（一成五 = 6 件货那天的 1.4 点体力）。
 *
 * 而"最里头"和"门口"之间的落差也必须是**渐变的**（见 `haulIndex`）：
 * 一栋三块的屋子，只有最里头那块吃满，中间那块吃一半 ——
 * 否则"把东西往里塞"与"塞到最里面"是同一种惩罚，玩家学不到"越深越贵"这件事。
 */
const PREMIUM_GAP = HAUL_PREMIUM_MAX / 2;

/**
 * 这一场的搬运惩罚有多严重：`carryFactor >= 1` → 0；`<= 0.5` → 1（吃满）。
 */
export function haulRamp(carryFactor: number): number {
  if (!Number.isFinite(carryFactor)) return 0;
  const short = 1 - carryFactor;
  if (short <= 0) return 0;
  return Math.min(1, short / HAUL_FULL_RAMP);
}

/**
 * 这块家具在第几层：**0 = 最顺手（门口）**，越大越靠里。
 *
 * ★ 用 `run.shelves` 里的**顺序**，不是几何坐标 —— 理由是那份顺序是**冻结的**：
 * 家具只增不减（`systems/furniture.ts`），所以"第几块"不会因为别处改动而变；
 * 而两个货架在屏幕上的左右先后是 CSS 的事，改一次布局就会让存档里的位置含义漂移，
 * 那正是"界面与命令层算出不同的数"那一类最难查的 bug。
 *
 * 玩家加一块新家具时，它接在最后 —— 也就是**新买的那块天生在最里头**。
 * 这是有意的：加空间不是免费的好事，你得决定把什么挪过去。
 */
export function haulIndexOfShelves(shelves: readonly Shelf[]): Map<string, number> {
  const out = new Map<string, number>();
  shelves.forEach((shelf, index) => {
    out.set(shelf.id, index);
  });
  return out;
}

/**
 * 第 `index` 层的取用乘数（1 = 不额外费劲）。
 *
 * 第 0 层永远是 1 —— 门口那块不该被罚。第二层起每层加 `PREMIUM_GAP × ramp`，
 * 到最里头那一层恰好吃满 `HAUL_PREMIUM_MAX × ramp`。
 */
export function haulFactorAt(index: number, carryFactor: number): number {
  const ramp = haulRamp(carryFactor);
  if (ramp <= 0) return 1;
  const depth = Math.max(0, Math.min(2, index));
  return 1 + PREMIUM_GAP * depth * ramp;
}

/**
 * 全屋的取用乘数 = 每块家具的乘数按**它占了多少件货**加权平均。
 *
 * 没货（或一块家具都没有）→ 1：没有东西要搬，就没有搬运。这一条同时兜住了
 * 空屋子、满箱子的局（`taken === 0` 时劳作成本本来就是 0，乘数是多少都不影响）。
 */
export function haulFactorOfShelves(shelves: readonly Shelf[], carryFactor: number): number {
  if (haulRamp(carryFactor) <= 0) return 1;
  let stacks = 0;
  let weighted = 0;
  shelves.forEach((shelf, index) => {
    const count = countStacks(shelf);
    if (count <= 0) return;
    stacks += count;
    weighted += count * haulFactorAt(index, carryFactor);
  });
  return stacks <= 0 ? 1 : weighted / stacks;
}

/**
 * 这一趟为了"从深处取"多花的体力（0 = 没多花）。
 *
 * 单独报出来而不是并进 `workCost`：§10.1A 要求"只改数字的机制必须同时有非数字表达"，
 * 而日报要说的是"**最深那块**让你多花了 N 点"—— 不是"体力莫名其妙多了"。
 * @param workBase 没算位置那一刻的劳作成本（`workCostOf` 的输出）
 * @param factor 全屋取用乘数
 */
export function workHauledOf(workBase: number, factor: number): number {
  if (!Number.isFinite(workBase) || !Number.isFinite(factor)) return 0;
  const extra = workBase * (factor - 1);
  return extra <= 0 ? 0 : Math.round(extra * 10) / 10;
}

/**
 * 这一块货架"最里头"那件事该怎么说 —— **界面与日报共用同一句话**。
 *
 * 共用的理由不是省字，是**两边说法必须一致**：整理页说"最里头那块"，
 * 日报说"往里走那几步"，玩家就得自己把两句话对起来 ——
 * 而这类机制最怕的就是"两个地方各说各的"（§2.19）。
 *
 * 返回 `null` = 这块架子不该挂任何东西：它在门口（index 0）、
 * 或者这一场根本没有搬运惩罚（乘数恒为 1）。
 *
 * @param index 这块家具在第几层（见 `haulIndexOfShelves`）
 * @param carryFactor 这一场的搬运惩罚
 */
export function farShelfNote(index: number, carryFactor: number): string | null {
  if (index <= 0) return null;
  /*
   * ★ 百分比**从 `haulFactorAt` 反算**，不在这里重写一遍深浅公式。
   *
   * 这条不是洁癖：两处各写一遍的表现是"挂着的牌子说 8%、实际多花 15%"，
   * 而两个数各自都算得出来，所以谁也不会报错 —— 只有玩家觉得这块架子
   * 好像没牌子上说的那么贵。所以这里只负责把乘数翻译成人话。
   */
  const factor = haulFactorAt(index, carryFactor);
  if (factor <= 1) return null;
  const percent = Math.round((factor - 1) * 100);
  const deep = index >= 2;
  return `${deep ? '最里头这块' : '靠里这块'}：取东西多花 ${percent}% 力气`;
}
