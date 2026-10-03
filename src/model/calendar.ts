/**
 * 先知日历纯逻辑（§6.1：日历是规划乐趣的来源，也是倒计时的压力来源）。
 * 纯函数，不碰 DOM，可单测。
 */
import { SURVIVAL_DAYS } from '../data/disaster';
import type { DayForecast, DisasterProfile, GamePhase } from './types';

/** 取某一天的天象条目；日历没覆盖到的那天返回 null（不抛异常，界面自己兜底） */
export function forecastFor(disaster: DisasterProfile, day: number): DayForecast | null {
  return disaster.calendar.find((f) => f.day === day) ?? null;
}

/** 某天的强度 0..1；查不到视为 0（灾前 / 灾后余波） */
export function severityAt(disaster: DisasterProfile, day: number): number {
  return forecastFor(disaster, day)?.severity ?? 0;
}

/** 当天需求暗示文案（界面用；查不到给一句中性话，不显示空白） */
export function hintAt(disaster: DisasterProfile, day: number): string {
  return forecastFor(disaster, day)?.hint ?? '日历上没有这一天。';
}

/** 是否处于囤货期（未变天） */
export function isStockpileDay(day: number): boolean {
  return day < 0;
}

/** 是否处于生存期 */
export function isSurvivalDay(day: number): boolean {
  return day > 0;
}

/** 天数标签：'D-7' / 'D-Day' / 'D3' —— 全游戏统一，避免各处各写一套 */
export function dayLabel(day: number): string {
  if (day === 0) return 'D-Day';
  return day < 0 ? `D${day}` : `D+${day}`;
}

/** 囤货期还剩几天（第 0 天返回 0，生存期返回负数表示"已经晚了"） */
export function daysUntilDisaster(day: number): number {
  return Math.max(0, -day);
}

/** 生存期是否已经走完目标天数（§8：撑过 7 天） */
export function isSurvivalComplete(day: number): boolean {
  return day >= SURVIVAL_DAYS;
}

/** 日历条的绘制数据：只留 D-7..D+7，给界面画强度曲线 */
export function calendarBars(disaster: DisasterProfile): DayForecast[] {
  return [...disaster.calendar].sort((a, b) => a.day - b.day);
}

/**
 * 阶段 → 人话（顶栏/日报共用）。
 * 刻意把"整理"也写清楚：§4.2 的节拍器靠玩家自己感知，界面别添乱。
 */
export const PHASE_LABELS: Record<GamePhase, string> = {
  prologue: '开局',
  stockpile_shop: '外出扫货',
  organize: '回家整理',
  night: '夜里',
  survival_day: '生存',
  help_request: '求援',
  ending: '结算'
};
