/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  情报（§6.5 的第三种回报）—— 2026-10 清偿 D-13
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它是什么，以及为什么是这个形状
 *
 * 情报 = **先知日历里"还没到的那些天"的预告**（`DayForecast.hint`）。
 *
 * 设计上排除过两种更"漂亮"的形状，理由都写在这里，免得以后有人重新想一遍：
 *
 *  · **不是"揭示刚需品类"** —— 那个在开局页已经完整显示了
 *    （`最要紧的是 燃料 和 保暖。`），而且"只有先知知道这件事"正是身份设定；
 *  · **不是"揭示强度曲线"** —— 那条曲线也是画着的（开局页的 `cal-bars`）。
 *
 * 真正没给玩家的**只有每一天的 `hint`**。所以情报盖住的就是它。
 *
 * ## 它买到的决定
 *
 * "哪一天最难"直接改变采购与整理的排期：知道 D+3 最难，就会把那天的
 * 药和燃料先备在手边 —— 而不是等日报当天告诉你。
 *
 * ## 可见性规则（一句话）
 *
 * 已经过去的天不用藏（写日志里也有），**没到的天按情报数量依次解锁**。
 */
import { getDisasterDef } from '../data/disaster';
import type { DisasterProfile, RunState } from '../model/types';

/** 一条已经能看到的预告 */
export interface RevealedForecast {
  day: number;
  hint: string;
  severity: number;
  /** 已经过去了吗（过去的天一定可见） */
  past: boolean;
}

/**
 * 现在能看到**哪几天**的预告。
 *
 * 规则：**过去的天全都能看**（那一页日报本来就写过），
 * 还没到的天按 `run.intel` 的条数**从近到远**依次揭开。
 *
 * ⚠ 它返回"看得见什么"，不返回"藏了什么" —— 界面只需要前者，
 * 而把"藏"这件事也暴露出去，迟早会有人拿它来画一个"未知"的格子，
 * 那个空格子会剧透"这里还有几天"（其实本身也是信息，但没必要）。
 */
export function revealedForecasts(run: RunState, disaster?: DisasterProfile): RevealedForecast[] {
  const def = disaster ?? getDisasterDef(run.disasterId);
  const future = def.calendar.filter((d) => d.day > run.day);
  const visible = new Set(future.slice(0, Math.max(0, run.intel)).map((d) => d.day));

  return def.calendar
    .filter((d) => d.day <= run.day || visible.has(d.day))
    .map((d) => ({ day: d.day, hint: d.hint, severity: d.severity, past: d.day <= run.day }))
    .sort((a, b) => a.day - b.day);
}

/**
 * 还能挣多少条情报。
 *
 * 上限是**还没到的天数** —— 再多的情报也没有东西可揭了。
 * 界面用它决定要不要把"情报"当成一个有价值的回报来展示。
 */
export function intelCapacity(run: RunState, disaster?: DisasterProfile): number {
  const def = disaster ?? getDisasterDef(run.disasterId);
  return def.calendar.filter((d) => d.day > run.day).length;
}

/** 现在这条情报有用吗（有还没到的天可以揭） */
export function intelIsUseful(run: RunState, disaster?: DisasterProfile): boolean {
  return intelCapacity(run, disaster) > 0;
}
