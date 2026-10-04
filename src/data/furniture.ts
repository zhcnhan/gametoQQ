/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  家具类型表（§10.2.4 第 2 件：柜子 / 冰箱）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 这张表解决的是 D-02
 *
 * `Shelf.kind` 从 M1 起就存在，但**只被文案读**（"冰箱 C"、"放回 冰箱 原位"）——
 * §8 写的「冰箱 1 个（腐坏减速）」一直没落地，玩家把它换成三块普通货架
 * 也完全不影响任何数值。登记的清偿条件是"M3 的多灾难"，
 * 而那个条件**现在已经满足**（116 场灾难，其中一大半 `spoilRate > 1`）。
 *
 * ## 为什么"腐坏"是家具唯一值得先做的维度
 *
 * §10.2.4 说新家具类型的价值在于"同一个整理动作，出现了新的**策略维度**"。
 * 而家具能提供的策略维度只有三类：
 *
 *  ① **改变物品的状态**（腐坏速度）—— 冰箱 / 柜子。**这一层先做**；
 *  ② 改变取用成本（每次拿取多花体力）—— 抽屉、顶柜；
 *  ③ 改变容量（更多格子）。
 *
 * 第 ③ 类已经有"新货架"在做（`addShelf`），而第 ② 类要动取用路径与日报，
 * 与"腐坏"不是一个量级的改动。**先做 ①**：它只需要腐坏结算按家具读一个乘数，
 * 而那个乘数正好是让"临期优先"这个百分比第一次真的有意义的东西。
 *
 * ## 与灾难的关系（这一条决定了冰箱值不值）
 *
 * 最终的腐坏速度 = `灾难的 spoilRate × 家具的 spoilFactor`。
 *
 * ★ **寒潮里冰箱是"零收益"而不是"负收益"**：寒潮 `spoilRate = 0.5`，
 * 全屋本来就是冷库，而腐坏本来就慢到几乎不发生 —— 所以冰箱在那里的价值是 0。
 * 这是设计（§12.3 玩家拍板"寒潮是天然冷库"），**不是 bug**：
 * 一件家具的价值随灾难变，正是"同一个动作、新的策略维度"这句话的意思。
 *
 * ★ 家具只**减缓**腐坏，`spoilFactor` 一律 ≤ 1：没有一种家具会让东西坏得更快。
 * "让它坏得更快"是**灾难**的职责（`spoilRate`），两者不要混。
 *
 * ## 界线（`data/` 层的纪律）
 *
 * 本文件只有常量与纯函数，不 import `model/` 以外的东西，也不碰任何浏览器 API。
 */
import type { FurnitureKind } from '../model/types';

/** 家具类型的定义 */
export interface FurnitureDef {
  kind: FurnitureKind;
  /** 界面上的名字（"货架 A"、"冰箱 C" 里的那两个字） */
  label: string;
  /** 腐坏速度乘数。**必须落在 `[MIN, 1]`** —— 家具只减缓，不加速 */
  spoilFactor: number;
  /** 一句话说清它凭什么值得占一块地方（界面要显示，也是给后来者看的口径） */
  why: string;
  /** 这块家具的默认尺寸（宽 × 高，格） */
  w: number;
  h: number;
}

/**
 * 腐坏乘数的合法区间。
 *
 * 下限 **0.4** 不是随手取的：一件家具最多把腐坏减到四成。
 * 再低就会出现"囤一堆鲜肉放进冰箱，整个生存期不用管它"——
 * 那会让**临期优先**（§6.3 三个维度之一）在装上冰箱后失效，
 * 而"整理得对"这件事正是本作的核心。
 */
export const MIN_SPOIL_FACTOR = 0.4;

/**
 * 四种家具。
 *
 * 顺序有意义：它同时是**解锁顺序**（见 `systems/setup.ts` 的开局配置与
 * §10.2.4 的"新货架 → 新家具类型 → 更大的家"）——
 * 先给普通的，再给需要"想一下放什么"的。
 */
export const FURNITURE_DEFS: readonly FurnitureDef[] = [
  {
    kind: 'shelf',
    label: '货架',
    spoilFactor: 1,
    why: '最普通的一块。什么都能放，什么都不额外保护',
    w: 6,
    h: 4
  },
  {
    kind: 'fridge',
    label: '冰箱',
    /*
     * DEFERRED(D-31): 冰箱**严格支配**另外两种 —— 同价（`FURNITURE_PRICE` 100）、
     * 同格（24），而 `spoilFactor` 最低（0.4 < 0.75 < 1）。
     * 而下面那句 `why` 写的"装别的占地方"**在代码里不存在**（冰箱与货架一样是 24 格）。
     * 于是"三选一"里有**两个永远不会被选**的决定。详见 `src/meta/deferred.ts` 的 D-31。
     */
    spoilFactor: 0.4,
    why: '断电之后它仍然是个箱子：装鲜食能多撑一阵，装别的占地方',
    w: 6,
    h: 4
  },
  {
    kind: 'cabinet',
    label: '柜子',
    spoilFactor: 0.75,
    why: '关上门就不进潮气。防的是"受潮霉变"那一路灾难，比冰箱温和',
    w: 6,
    h: 4
  },
  {
    kind: 'floor',
    label: '地面',
    spoilFactor: 1,
    /*
     * DEFERRED(D-30): 这一种**玩家碰不到** —— 唯一的购买入口
     * `ui/OrganizeScreen.ts` 明确把它滤掉了，全仓没有第二个入口。
     * 而它是四种家具里**唯一在格数上有取舍的**（12 格、0 元），
     * 另外三种同价同格、只差 `spoilFactor`（见 D-31）。
     * 详见 `src/meta/deferred.ts` 的 D-30。
     */
    why: '不占家具位，但和纸箱一样什么保护都没有（留给"更大的家"用）',
    w: 6,
    h: 2
  }
];

const BY_KIND = new Map(FURNITURE_DEFS.map((d) => [d.kind, d]));

export function hasFurnitureDef(kind: unknown): kind is FurnitureKind {
  return typeof kind === 'string' && BY_KIND.has(kind as FurnitureKind);
}

/**
 * 取一种家具的定义。认不出的 kind **退回普通货架**，不抛异常。
 *
 * 为什么是"退回"而不是"抛"：`kind` 存在存档里，而存档可以被手改、
 * 可以来自旧版本、将来还可能来自 mod。一个认不出的家具类型不该让整局打不开 ——
 * 与 `normalizeRun` 的自愈是同一条纪律（见 `state/save.ts`）。
 */
export function furnitureDefOf(kind: string | undefined): FurnitureDef {
  return BY_KIND.get(kind as FurnitureKind) ?? FURNITURE_DEFS[0]!;
}

/**
 * 这一块家具在这一场灾难下的**实际腐坏速度乘数**。
 *
 * = 家具自己的 `spoilFactor`，夹到 `[MIN_SPOIL_FACTOR, 1]`。
 *
 * ⚠ 它**不含**灾难的 `spoilRate` —— 那个由调用方乘上去（`model/spoil.ts`）。
 * 分开的理由：这一层只管"家具能做什么"，"这一场有多糟"是灾难的事。
 * 两件事混在一个函数里，将来一定会有人想在这里读 `disasterId`。
 */
export function spoilFactorOf(kind: string | undefined): number {
  const raw = furnitureDefOf(kind).spoilFactor;
  if (!Number.isFinite(raw)) return 1;
  return Math.max(MIN_SPOIL_FACTOR, Math.min(1, raw));
}
