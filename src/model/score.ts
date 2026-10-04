/**
 * 整理品质评分（策划案 §6.3 的三个可量化维度）。
 *
 * 三个维度问的是三个不同的问题，缺一个，"整理即战力"就有一块够不着：
 *   归位率   —— 你摆好了多少（东西在不在自己划的区里）
 *   临期优先 —— 你排好了多少（同一架上快到期的有没有靠前）
 *   应急可达 —— 急用的那些，在不在伸手就够得到的地方
 *
 * 纯逻辑，可单测。
 */
import { getItemDef } from '../data/items';
import { countCategory } from './consume';
import {
  countOnHandy,
  countStacks,
  fefoGroups,
  fefoRate,
  findZone,
  getStack,
  isGroupFEFO,
  placementRate,
  rowZoneId,
  zoneListedFor
} from './shelf';
import type { CategoryId, DisasterProfile, Shelf, UnpackBox, Zone } from './types';

export interface OrganizeScore {
  /** 归位率 0..1 */
  placement: number;
  /** FEFO 率 0..1 */
  fefo: number;
  /** 应急可达率 0..1（§6.3 第三维，M1 阶段 F 补齐） */
  emergency: number;
  /** 全房间物资堆数 */
  stacks: number;
  /** 已"整整齐齐"的货架 id（FEFO 达标 + 分区接收全部物资） */
  tidyShelfIds: string[];
  /**
   * 加权总分 0..1（维度 16「分数口径」）。
   *
   * ## 它与上面三个分量的关系，是说清楚"这一场看什么"
   *
   * 三个分量本身永远是那三个（归位率 / 临期优先 / 应急可达），
   * 而**灾难可以改它们的权重** —— 洪水那一场里"急用的东西够不够得到"
   * 比"摆得多整齐"重要得多。
   *
   * ★ 这个数**只用于结算页展示与分级**。它**不参与**每日结算里的任何计算
   * （那边读的是**单个分量**：`workCostOf(placement, fefo, …)`、
   * `moodFromPlacement(placement)`）—— 这条边界是刻意的：如果每日结算改读加权总分，
   * 那么"这一场权重怎么配"就会顺手改掉每天的体力开销与心情，
   * 而那属于**难度**，不属于"评分口径"。两个概念混在一起，
   * 探针（好档活 / 乱档倒）的结论就会随权重漂移。
   */
  weighted: number;
}

/**
 * 三个分量的**默认权重**（都为 1 = 不加权）。
 *
 * 维度 16 的取值就是在这个基础上覆盖：`scoreWeights: { emergency: 2 }`
 * 表示"这一场里应急可达率算双份"。
 */
export const DEFAULT_SCORE_WEIGHTS = { placement: 1, fefo: 1, emergency: 1 } as const;

/**
 * 把三个分量按权重合起来（维度 16）。
 *
 * 分母用**权重之和**，所以结果永远落在 0..1 —— 加权重不该让分数爆表，
 * 只该让"这一场更看哪一项"。
 *
 * ★ **一个越界的权重改变的是"分配"，不是"总分"**：`{ emergency: 3 }`
 * 意味着"另外两项各占四分之一、应急占四分之三"（分母是 1+1+3=5），
 * 而不是"总分变成 5 倍"。这条例子在测试里是显式断言过的 ——
 * 因为另一种理解（乘上去、再除以 3）会让任何一次加权都顺手把总分抬起来，
 * 而那等于偷偷改难度。
 */
export function weightedScore(
  parts: { placement: number; fefo: number; emergency: number },
  weights: Partial<Record<keyof typeof DEFAULT_SCORE_WEIGHTS, number>> = {}
): number {
  /*
   * ★ 先**只挑出有限数**，再夹取 —— 顺序不能反。
   * `Math.min(10, NaN)` 是 NaN，而 `NaN > 0` 为假 → 整条链会**静默返回 0 分**。
   * 那是"一个坏值改变了结论"，与 D-20 同一种形状。
   */
  const pick = (key: keyof typeof DEFAULT_SCORE_WEIGHTS): number => {
    const value = weights[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SCORE_WEIGHTS[key];
    return Math.max(0, Math.min(10, value));
  };
  const w = {
    placement: pick('placement'),
    fefo: pick('fefo'),
    emergency: pick('emergency')
  };
  const total = w.placement + w.fefo + w.emergency;
  if (!(total > 0)) return 0; // 全零权重是坏数据：退回 0 而不是 NaN（NaN 会一路印到结算页）
  const sum = parts.placement * w.placement + parts.fefo * w.fefo + parts.emergency * w.emergency;
  return Math.max(0, Math.min(1, sum / total));
}

/**
 * 单架是否"整整齐齐"：**每一行都属于某张会接收它的清单，而且每一组都排好了序**。
 *
 * ## 口径跟着胶带细到行（用户拍板 2026-10）
 *
 * 原来是"整架一个 zone + 整架排好序"。现在一块货架可以有几张胶带，
 * 所以判定变成**逐行**：某一行没贴胶带、或贴的那张清单不接收它上面的东西，
 * 这一架就不算整整齐齐。
 *
 * ★ 一条关键的后果：**一块货架只要有一行没贴，它就永远拿不到这个徽章**。
 * 那是对的 —— 徽章说的是"这一架我完全管好了"，而一行没立规矩就不是完全管好。
 * 想拿徽章就把它贴满（那是玩家自己的选择，不是系统的要求）。
 *
 * "明确接收"用的是 `zoneListedFor`（§12 v0.8 归位率修复），与归位率同一把尺子：
 * 贴了空清单的行既不算归位、也不该拿到"整整齐齐"的徽章 ——
 * 两处判定只要不一致，玩家就会看到"归位率 0% 但整整齐齐"这种自相矛盾的屏幕。
 */
export function isShelfTidy(shelf: Shelf, zones: readonly Zone[]): boolean {
  // 每一组（同一张胶带的多行 + 没贴胶带的行）都要排好序
  if (!fefoGroups(shelf).every((g) => isGroupFEFO(shelf, g.rows))) return false;
  for (let row = 0; row < shelf.h; row++) {
    const zone = findZone(zones, rowZoneId(shelf, row));
    if (!zone) return false;
    for (let col = 0; col < shelf.w; col++) {
      const stack = getStack(shelf, { row, col });
      if (!stack) continue;
      if (!zoneListedFor(zone, getItemDef(stack.itemId))) return false;
    }
  }
  return true;
}

/**
 * 什么算"应急物资"：该灾难的刚需 ∪ 急救品。
 *
 * 为什么不写死"急救品"：§5 说的是「应急货架（门口/最顺手位）放**急救品**」，
 * 但"什么算应急"是随灾难变的 —— 寒潮那天，一罐燃料比一卷绷带更救命
 * （炉子灭了是真的会出人命）。所以它跟着 `priorityCategories` 走，而不是写一张死表。
 */
export function emergencyCategories(disaster: DisasterProfile): CategoryId[] {
  return [...new Set<CategoryId>([...disaster.priorityCategories, 'medicine'])];
}

/**
 * 应急可达率：**该灾难的应急物资里，有多大比例放在顺手位上。**
 *
 * 分母算的是**全屋**（含还没拆的纸箱）—— 躺在纸箱底下的那卷绷带当然不在顺手位，
 * 它要翻。这和归位率的分母是同一个道理：纸箱里的东西是"还没安顿好"的。
 *
 * 屋里压根没有应急物资时返回 1（同 `placementRate` 的宽容规则）：
 * 手上没药，不该被判成"没放好"。
 */
export function emergencyRate(
  shelves: readonly Shelf[],
  boxes: readonly UnpackBox[],
  disaster: DisasterProfile
): number {
  let handy = 0;
  let total = 0;
  for (const category of emergencyCategories(disaster)) {
    handy += countOnHandy(shelves, category);
    total += countCategory(shelves, boxes, category);
  }
  return total === 0 ? 1 : handy / total;
}

/**
 * @param disaster 必填，不能省。少了它 `emergency` 只能编一个 1 出来，
 *   而那个假满分会被印到结算页上，也会漏进生存期结算 —— 宁可让调用点多写一个参数。
 */
export function computeOrganizeScore(
  shelves: readonly Shelf[],
  zones: readonly Zone[],
  boxes: readonly UnpackBox[],
  disaster: DisasterProfile
): OrganizeScore {
  // 归位率的分母包含还没拆的纸箱 —— 见 model/shelf.ts 的 placementRate
  const placement = placementRate(shelves, zones, boxes);
  const fefo = fefoRate(shelves);
  const emergency = emergencyRate(shelves, boxes, disaster);
  return {
    placement,
    fefo,
    emergency,
    stacks: shelves.reduce((sum, s) => sum + countStacks(s), 0),
    tidyShelfIds: shelves.filter((s) => isShelfTidy(s, zones)).map((s) => s.id),
    /*
     * 维度 16：权重直接读灾难定义。
     *
     * ★ 这里**刻意不经过 `disasterModifiersOf`**（与其余维度不同）：
     * 那一层的职责是"夹取乘数 / 挡坏值"，而权重是**评分口径**，
     * 它的默认值（1）与合法区间（0~10）已经在 `disasterModifiersOf` 里夹过了 ——
     * `model/` 不许 import `data/disaster.ts` 的**函数**会成环吗？不会（那是单向的），
     * 但 `model/` 只依赖 `DisasterProfile` 这个**类型**是本层的规矩。
     *
     * 所以：坏值（NaN / 负数）在这里**再也挡一次**，宁可写两行也不破层。
     * 挡的方向是"退回默认 1"—— 一个坏权重让某项失分，比抛异常好得多。
     */
    weighted: weightedScore({ placement, fefo, emergency }, cleanWeights(disaster.scoreWeights))
  };
}

/**
 * 把灾难给的权重整成"界面一定接得住"的形态：认不出的键丢掉、坏值退回 1。
 *
 * ★ 这里有一个**差点漏掉的坑**（第一次写就是这么错的，被测试当场抓到）：
 * 光判"是不是数字"不够 —— 还要判 `Number.isFinite`。一个 `NaN` 会让后面
 * `total > 0` 为假（`NaN > 0` 是 false），于是整条链**静默返回 0 分**：
 * 屏幕上会显示一个 0，而玩家完全不知道那是因为"这一场的某一维权重是 NaN"。
 *
 * 这和 D-20 是同一个形状：**一个坏值不该改变结论，只该被退回默认值。**
 */
function cleanWeights(raw: unknown): Partial<Record<keyof typeof DEFAULT_SCORE_WEIGHTS, number>> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Partial<Record<keyof typeof DEFAULT_SCORE_WEIGHTS, number>> = {};
  for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS) as (keyof typeof DEFAULT_SCORE_WEIGHTS)[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key] = Math.max(0, Math.min(10, value));
  }
  return out;
}

/** 0..1 → 0..100 整数，用于日报与结算界面 */
export function toPercent(ratio: number): number {
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

export function gradeLabel(ratio: number): string {
  const p = toPercent(ratio);
  if (p >= 100) return '整整齐齐';
  if (p >= 80) return '有条不紊';
  if (p >= 50) return '凑合能用';
  if (p > 0) return '翻箱倒柜';
  return '无从下手';
}
