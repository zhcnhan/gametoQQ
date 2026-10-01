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
import { dailyDrainOf } from '../data/survival';
import { countCategory } from './consume';
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
 * 街区平均还剩几天粮（下标 = 天）。
 *
 * 它**不是**从你的库存推出来的 —— 恰恰相反，它是一条独立的基准线，作用是让你的数字有参照物。
 * 曲线是：灾难头一两天，多数人还端着（家里总有点存货）；
 * 之后迅速见底（没囤的人开始化雪、啃饼干）；第五天起，整条街基本只剩零星几家还亮着灯。
 *
 * DEFERRED(D-14): 这条曲线是**手写的常数**，不是模拟出来的。
 * 真正的"街区"要等 M2 的跨局世界状态；M1 只需一个能让玩家读出自己位置的参照物。
 */
const DISTRICT_DAYS: readonly number[] = [0, 3, 2, 2, 1, 1, 0, 0, 0];

export function districtDays(day: number): number {
  if (day <= 0) return DISTRICT_DAYS[0] ?? 0;
  return DISTRICT_DAYS[Math.min(day, DISTRICT_DAYS.length - 1)] ?? 0;
}
