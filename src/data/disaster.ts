/**
 * 灾难静态表（§8：MVP 灾难 1 个 —— 寒潮；§6.1 先知日历的载体）。
 *
 * 日历覆盖 D-7 .. D+7 共 15 天，与 model/types.ts 里 RunState.day 的编号一致：
 *   负数 = 囤货期（灾难还没来，hint 是"先知预告"的口气，克制、1~2 句）
 *   0    = D-Day（寒潮登陆）
 *   正数 = 生存期（hint 转成"今天的处境 + 需求暗示"，阶段 C 直接读它）
 *
 * severity 取 0..1 的连续值：M1 阶段 C 的每日消耗加成、阶段 M2 的窗外天气渲染
 * 都直接乘这个数，不用再做一次映射。
 */
import type { DayForecast, DisasterProfile } from '../model/types';

export const STOCKPILE_DAYS = 7; // 囤货期天数（§8：7 天）
export const SURVIVAL_DAYS = 7; // 生存期目标天数（§8：撑过 7 天）

/** 囤货期第一天（也是先知日历的起点） */
export const FIRST_STOCKPILE_DAY = -STOCKPILE_DAYS;

const COLD_SNAP_CALENDAR: readonly DayForecast[] = [
  { day: -7, severity: 0, hint: '多云。日历往后翻七页，才是那场寒潮。' },
  { day: -6, severity: 0, hint: '气温正常。但超市的货架已经开始变薄了。' },
  { day: -5, severity: 0, hint: '邻市降温了。本地还算暖和。' },
  { day: -4, severity: 0, hint: '气象台说，今年冬天来得早。' },
  { day: -3, severity: 0, hint: '小区群里在传：听说要下大雪。' },
  { day: -2, severity: 0, hint: '米面货架空了一半。今天还能买到。' },
  { day: -1, severity: 0, hint: '气温开始往下掉。晚上风变大。' },
  { day: 0, severity: 0.55, hint: '寒潮登陆。气温 -18°C。' },
  { day: 1, severity: 0.7, hint: '-20°C。水管冻住了，今天要烧 2 份燃料。' },
  { day: 2, severity: 0.65, hint: '-19°C。窗户上结了整片冰花。' },
  { day: 3, severity: 0.8, hint: '-23°C。楼道里能听见风声。' },
  { day: 4, severity: 0.9, hint: '-26°C。外面没人了。' },
  { day: 5, severity: 0.88, hint: '-25°C。雪压在窗台上，像一层棉。' },
  { day: 6, severity: 0.95, hint: '-28°C。水管修不好了，只能靠化雪。' },
  { day: 7, severity: 1, hint: '-30°C。撑到今天，就是撑过去了。' }
];

export const DISASTER_DEFS: readonly DisasterProfile[] = [
  {
    id: 'cold_snap',
    name: '寒潮',
    calendar: [...COLD_SNAP_CALENDAR], // §7 的类型是可变数组，这里展开一份给它
    // §8：每日基础消耗 食物 2 / 水 2，「燃料 2」是寒潮独有的加成 —— 正是这里的 dailyDrain
    dailyDrain: { fuel: 2 },
    priorityCategories: ['fuel', 'warmth'],
    windowScene: 'blizzard'
  }
];

const DISASTER_BY_ID: ReadonlyMap<string, DisasterProfile> = new Map(DISASTER_DEFS.map((d) => [d.id, d]));

export function getDisasterDef(disasterId: string): DisasterProfile {
  const def = DISASTER_BY_ID.get(disasterId);
  if (!def) throw new Error(`未知灾难 id: ${disasterId}`);
  return def;
}

/** M1 只用寒潮，开局固定给它（§8） */
export const M1_DISASTER_ID = 'cold_snap';
