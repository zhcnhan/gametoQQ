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
    windowScene: 'blizzard',
    /**
     * 寒潮是**天然冷库**：室外 -18°C 到 -30°C，放东西出去只会冻得更久。
     *
     * DEFERRED(D-03): 这条设计有一个直接后果 —— **M1 全程不会发生任何腐坏**。
     * 于是「临期优先」百分比、冰箱、以及日报里的损耗行，在当前里程碑里全是装饰。
     * 这是玩家明确拍板的（"寒潮延长保质期，腐坏压力交给未来的灾难"），
     * 不是漏做 —— 所以任何人都不许"顺手把它改成 1 让数字好看一点"。
     * `spoilRate` 真正的用武之地是 M3 的热浪（>1，会让粮仓变成坟场）。
     */
    spoilRate: 0.5
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

/**
 * 每天的**外界温度**（°C）。服务于 §6.6 的反差层：「外界温度 vs 屋内温度，数字自己说话」。
 *
 * 为什么不从 `severity` 换算：寒潮的温度曲线**不是** severity 的线性函数 ——
 * 中间（D+1）回过一次暖（-19°C 对 0.65，而 -23°C 对 0.80），最后三天再压下去。
 * 硬换算出来的数会和日历里那句「-19°C。窗户上结了整片冰花」对不上，
 * 而玩家是会把两句话对照着读的。
 *
 * 囤货期那七天给的是正常冬天的气温，这样"回落"才有参照 ——
 * 反差层要的不只是"今天很冷"，而是"和上周比冷了多少"。
 *
 * DEFERRED(D-15): 这张表是**手写的**，而且只覆盖寒潮。多灾难（M3）时要按
 * `disasterId` 拆成几份，或者干脆把它并进 `DayForecast` —— 那时再改类型才有必要。
 */
const COLD_SNAP_TEMPS: ReadonlyMap<number, number> = new Map([
  [-7, 6],
  [-6, 4],
  [-5, 2],
  [-4, 1],
  [-3, 0],
  [-2, -2],
  [-1, -5],
  [0, -18],
  [1, -20],
  [2, -19],
  [3, -23],
  [4, -26],
  [5, -25],
  [6, -28],
  [7, -30]
]);

/** 这一天外面多少度。日历覆盖不到的日子夹到最后一档 —— 寒潮不会自己停 */
export function outdoorTemp(day: number): number {
  const clamped = Math.max(FIRST_STOCKPILE_DAY, Math.min(7, Math.round(day)));
  return COLD_SNAP_TEMPS.get(clamped) ?? -30;
}
