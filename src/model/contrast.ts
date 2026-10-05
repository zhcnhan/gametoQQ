/**
 * 反差层（§6.6「数字自己说话」，零台词）。
 *
 * 四条数字，两两成对：
 *
 *     外面 -23°C   ←→   屋里 13°C        温度的反差
 *     你的余粮 5 天 ←→   街区平均 2 天     库存的反差
 *
 * 这一层**一句话都不写**（§6.6 的小标题就是"零台词"）。它的力量来自
 * 让玩家自己把两个数字摆在一起看，所以这里只提供数，不提供形容词 ——
 * 一旦写上"你比邻居强多了"，它就变成了炫耀，而炫耀是这个游戏一直躲的东西。
 *
 * model/ 层纪律：纯函数，不碰任何浏览器 API。
 */
import { SURVIVAL_DAYS } from '../data/disaster';
import { EXHAUSTED_REACH, dailyDrainOf } from '../data/survival';
import { countCategory } from './consume';
import { countInPlace } from './shelf';
import type { DisasterProfile, RunState } from './types';

/**
 * 屋内温度（°C），由庇护所决定。
 *
 * 庇护所不是一个抽象的耐久条 —— 它就是"这屋子还能不能保住热"。
 * 满值约 18°C（还算个家），掉到 0 时约 -2°C（和外面差不多，屋子已经不成屋子了）。
 */
export function indoorTemp(shelter: number): number {
  const clamped = Math.max(0, Math.min(100, shelter));
  return Math.round(-2 + (clamped / 100) * 20);
}

/**
 * 你的余粮还能撑几天 = 各品类里最先见底的那一个能撑几天。
 *
 * 取**最小值**而不是总和：水和米各剩十份是够的，但只够到水先断的那天。
 * 这也是界面上那句"还能撑 N 天"的口径，两处必须一致。
 *
 * ⚠ **它的分母是全屋**（货架 ∪ 还没拆的纸箱），所以它对"搬运"恒等不变 ——
 * 把 30 罐从纸箱搬到贴好胶带的架上，这个数**一个都不动**（那是 W-08 的起因）。
 * 想知道"够得着的"有多少天，看 `handyDays`。
 */
export function supplyDays(run: RunState, disaster: DisasterProfile): number {
  const needs = dailyDrainOf(disaster);
  let min = Number.POSITIVE_INFINITY;
  for (const { category, need } of needs) {
    if (need <= 0) continue;
    const stock = countCategory(run.shelves, run.boxesToUnpack, category);
    min = Math.min(min, Math.floor(stock / need));
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * ★★ **随手够得到几天**（M4 工单 W-08）。
 *
 * ## 它补的是哪一个洞
 *
 * 「你的余粮 N 天」那一格的输入是"货架 ∪ **纸箱**的件数 ÷ 日耗" ——
 * 所以把 30 罐从纸箱搬到**贴好胶带的架上**，那一格**一个数都不变**。
 * 也就是说：**「搬上架」「贴胶带」「标顺手位」这三个动作，在日报上完全不可见。**
 *
 * 这一格数的是"**体力见底那天也够得到的那部分**"能撑几天 ——
 * 判据是 `isInPlaceFor`：**顺手位那块架子** ∪ **贴了明确收它的清单的那一行**。
 * 两者是同一类东西（都让取用不必翻），只是强度不同。
 *
 * ## 那三个动作各自换来一截（这是这一格存在的全部理由）
 *
 * | 状态 | 够得到 |
 * | --- | --- |
 * | 全堆在纸箱里 | **0 天**（箱底的东西要翻，而翻不动） |
 * | 搬上架、什么都没写 | 只有"半份"那条底 → 不够一天 |
 * | **贴了收它的清单** | 那一行不用翻 → 满份 |
 * | **标了顺手位** | 连走都不用走 → 满份，而且是最先兑现的那一块 |
 *
 * ## 口径：逐日往下走，而不是"总量 ÷ 日耗"
 *
 * 差在哪儿：顺手位上那一块**每天用掉一点就会少一点**，而"够得到"又取决于
 * 当天还剩几件。所以这里一天一天地扣，扣到哪一天凑不齐为止 ——
 * 与生存期结算同一套算术，只是把"全屋"换成了"够得着的那一份"。
 *
 * ## 三条刻意的边界
 *
 *  1. **只数货架**：纸箱里的东西不在明面上，翻箱要力气 —— 所以搬进箱子的货
 *     在这格里是 0 天。这正是要它做的事；
 *  2. **按体力见底来算**（`exhausted = true`）：这一格回答的不是"今天够不够"
 *     （那由日报的"该吃该烧的都凑齐了"回答），而是"**最糟的那天够不够**"。
 *     按最好的那天算，它永远等于「你的余粮」，那一格就白加了；
 *  3. **不是预测，是读数**：它假设之后什么都不变（不吃药、不添被、不再整理）。
 *     所以它读起来像"你现在这个样子能撑几天"，而不是"你会活几天"——
 *     与这一层"只给数、不给形容词"的纪律一致（§6.6 零台词）。
 */
export function handyDays(run: RunState, disaster: DisasterProfile): number {
  const needs = dailyDrainOf(disaster).filter((n) => n.need > 0);
  if (needs.length === 0) return 0;
  const left = new Map<string, number>();
  /** 其中**写明放哪儿**（顺手位 ∪ 贴了清单的行）的那一份 —— 逐日扣，见下面的注释 */
  const reach = new Map<string, number>();
  for (const { category } of needs) {
    left.set(category, countCategory(run.shelves, [], category));
    reach.set(category, countInPlace(run.shelves, run.zones, category));
  }

  for (let day = 1; day <= SURVIVAL_DAYS; day++) {
    for (const { category, need } of needs) {
      const have = left.get(category) ?? 0;
      const inPlace = Math.min(reach.get(category) ?? 0, have);
      /*
       * 当天真的能拿到的量：**一半的底 + 还写明放哪儿的那些**。
       *
       * ★ 这里逐日重算，不拿开局快照 —— 我第一版拿的就是快照，而它当场造出一个
       * 假读数：标着 5 天货的架子 + 另一块架子上堆满的货 → 快照让后面那几天
       * **全按"不用翻"算**，"随手够得到"报出 14 天；而实际上第 6 天起
       * 就得翻别的架子上那两件。**快照会把别处的货偷偷算进"够得到"**，
       * 而那恰好是这一格存在的理由的反面。
       */
      const reachable = Math.min(need, Math.max(0, Math.ceil(need * EXHAUSTED_REACH)) + inPlace);
      if (reachable < need) return day - 1;
      /*
       * 存量与"写明放哪儿的那一份"一起往下扣。
       *
       * 扣的顺序与结算是同一个意思（归位的先出）：当天吃掉的那些先来自
       * 够得到的那一块，不够的部分才轮到要翻的 —— 所以 `reach` 每天最多减一个 `need`。
       */
      left.set(category, have - need);
      reach.set(category, Math.max(0, inPlace - need));
    }
  }
  return SURVIVAL_DAYS;
}

/**
 * 街区平均还剩几天粮。
 *
 * ## ★ 下标与取值（那个 `0` 是哨兵，不是曲线上的点）
 *
 * ```
 * 下标：  0    1    2    3    4    5    6    7    8 ... 13
 * 取值：  0    3    2    2    1    1    1    0    0 ...  0
 *         ↑
 *         哨兵：**灾难前**（day ≤ 0）读它。"灾难还没来，街区平均 0 天"读起来别扭，
 *         但这个数只在生存期的日报里出现，所以它永远不会被玩家看到 ——
 *         它的作用只是"别让 day ≤ 0 读到 undefined"。
 * ```
 *
 * 所以**曲线本身从下标 1 开始**，而它是单调不增的（整条街只会越来越空）。
 * `contrast.test.ts` 里那条"覆盖整个生存期"的用例犯过一次错：
 * 它从下标 0 开始查单调，于是把哨兵那个 0 当成了曲线起点，
 * 报出"第 1 天比第 0 天还多"。**是断言错了，不是数据错了。**
 *
 * ## 它是一张手写表，而这是拍板的
 *
 * 它**不是**从你的库存推出来的 —— 恰恰相反，它是一条独立的基准线，作用是让你的数字有参照物。
 * 曲线是：灾难头一两天，多数人还端着（家里总有点存货）；
 * 之后迅速见底（没囤的人开始化雪、啃饼干）；第五天起，整条街基本只剩零星几家还亮着灯。
 *
 * ★ 拍板（M3）：**街区不做模拟，只做参照物。** 这一层的全部作用是
 * "让玩家自己把两个数字摆在一起看"（§6.6 的小标题就是"零台词"）。
 * 真去模拟一个街区，需要跨局世界状态、会随玩家行为漂移、
 * 还得在 116 场灾难下都合理 —— 而它换来的只是"那个参照数字更真一点"。
 * **代价与收益不成比例。**
 *
 * ★ 但清账时修掉了它真正的毛病：原来只有 **9 个数**，而生存期是 **14 天** ——
 * 第 10~14 天全返回最后一档（0），那五天里这个数字**不再有任何信息量**：
 * 它既不变化、也不解释任何事，只是每天印一个 0 在玩家旁边。
 */
const DISTRICT_DAYS: readonly number[] = [0, 3, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];

export function districtDays(day: number): number {
  if (day <= 0) return DISTRICT_DAYS[0] ?? 0;
  return DISTRICT_DAYS[Math.min(day, DISTRICT_DAYS.length - 1)] ?? 0;
}
