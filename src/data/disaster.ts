/**
 * 灾难静态表（§8：MVP 灾难 1 个 —— 寒潮；§6.1 先知日历的载体）。
 *
 * 日历覆盖 D-7 .. D+14 共 22 天（§12.3 v0.7：生存期 7 → 14），与 model/types.ts 里 RunState.day 的编号一致：
 *   负数 = 囤货期（灾难还没来，hint 是"先知预告"的口气，克制、1~2 句）
 *   0    = D-Day（寒潮登陆）
 *   正数 = 生存期（hint 转成"今天的处境 + 需求暗示"，阶段 C 直接读它）
 *
 * severity 取 0..1 的连续值：M1 阶段 C 的每日消耗加成、阶段 M2 的窗外天气渲染
 * 都直接乘这个数，不用再做一次映射。
 */
import type { DayForecast, DisasterProfile } from '../model/types';

export const STOCKPILE_DAYS = 7; // 囤货期天数（§8：7 天）
/**
 * 生存期目标天数（§12.3 v0.7：7 → **14**）。
 *
 * 7 天的窗口在数学上杀不死人：崩溃曲线（体力 −15/天 → 第 5 天才见底 → 缺口 + 硬撑
 * − 医药兜底 ≈ −13 健康/天）从 100 走到 0 需要 **约 13 天**跑道，而窗口只剩 2 天 ——
 * 玩家实测"任何时候一直点过一天就能通关"，正是这条账。
 * 14 天让整条 v0.6 的硬撑阶梯（1~2 / 3~4 / 5 天起）真正走完，也把采购从"现金管够"
 * 变成"14 天刚需 ≈ 全部预算"（燃料 28 罐是最大的一笔，见 items.ts 的 v0.7 调价）。
 */
export const SURVIVAL_DAYS = 14; // 生存期目标天数（§12.3 v0.7）

/** 囤货期第一天（也是先知日历的起点） */
export const FIRST_STOCKPILE_DAY = -STOCKPILE_DAYS;

const COLD_SNAP_CALENDAR: readonly DayForecast[] = [
  { day: -7, severity: 0, hint: '多云，6°C。寒潮还在七天之外。' },
  { day: -6, severity: 0, hint: '4°C。超市的货架开始变薄了。' },
  { day: -5, severity: 0, hint: '2°C。邻市降温了，本地还算暖和。' },
  { day: -4, severity: 0, hint: '1°C。气象台说，今年冬天来得早。' },
  { day: -3, severity: 0, hint: '0°C。小区群里在传要下大雪。' },
  { day: -2, severity: 0, hint: '-2°C。米面货架空了一半，今天还买得到。' },
  { day: -1, severity: 0, hint: '-5°C。风大了，晚上会更冷。' },
  { day: 0, severity: 0.55, hint: '-18°C。寒潮登陆。' },
  { day: 1, severity: 0.7, hint: '-20°C。水管冻住了，今天要烧 2 份燃料。' },
  { day: 2, severity: 0.65, hint: '-19°C。窗户上结了一层冰花。' },
  { day: 3, severity: 0.8, hint: '-23°C。楼道里有风声。' },
  { day: 4, severity: 0.9, hint: '-26°C。街上没有人。' },
  { day: 5, severity: 0.88, hint: '-25°C。雪积在窗台上，有十几厘米厚。' },
  { day: 6, severity: 0.95, hint: '-28°C。水管修不好了，只能化雪。' },
  { day: 7, severity: 1, hint: '-30°C。广播说，寒潮主力还没过境。' },
  { day: 8, severity: 0.98, hint: '-30°C。原来说撑七天就过去了，现在没人再提这个数。' },
  { day: 9, severity: 0.95, hint: '-31°C。窗缝里的冰又厚了一指。' },
  { day: 10, severity: 0.9, hint: '-29°C。雪停了半天，又下起来。' },
  { day: 11, severity: 0.96, hint: '-32°C。楼下的雪没过膝盖。' },
  { day: 12, severity: 0.98, hint: '-33°C。风声很大，整栋楼都在响。' },
  { day: 13, severity: 1, hint: '-35°C。温度计上没见过的数。' },
  { day: 14, severity: 1, hint: '-36°C。撑到今天，就是撑过去了。' }
];

export const DISASTER_DEFS: readonly DisasterProfile[] = [
  {
    id: 'cold_snap',
    name: '寒潮',
    calendar: [...COLD_SNAP_CALENDAR], // §7 的类型是可变数组，这里展开一份给它
    /**
     * 逐日外界温度。**这是那次"手写常量表"的搬迁结果（D-15）** ——
     * 原来它是文件上方的一张 `COLD_SNAP_TEMPS` 常量，只覆盖寒潮；
     * 现在每一场灾难自带自己的曲线，`outdoorTemp(day, disasterId)` 按场次读。
     */
    temperatures: {
      [-7]: 6, [-6]: 4, [-5]: 2, [-4]: 1, [-3]: 0, [-2]: -2, [-1]: -5,
      [0]: -18, [1]: -20, [2]: -19, [3]: -23, [4]: -26, [5]: -25, [6]: -28,
      [7]: -30, [8]: -30, [9]: -31, [10]: -29, [11]: -32, [12]: -33, [13]: -35, [14]: -36
    },
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

/**
 * 这个灾难 id 认不认识。
 *
 * `getDisasterDef` 对未知 id **抛异常**，所以任何"从存档里读出来的 id"
 * 都必须先用它问一句 —— 否则一个手改过的档会在开局或结算时炸在深处。
 * 与 `hasItemDef` / `hasIdentityDef` / `hasDayEvent` 是同一套路。
 */
export function hasDisasterDef(disasterId: unknown): boolean {
  return typeof disasterId === 'string' && DISASTER_BY_ID.has(disasterId);
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
 * ★ **它现在读的是"当前那场灾难"的 `temperatures`，不再是写死的寒潮常量**（D-15）。
 * 这一点对 §10B 的上百场灾难是必需的：热浪的 +41°C 与寒潮的 -36°C
 * 走的是同一个读者（界面的"外界"那一栏），只是各自带着自己的曲线。
 *
 * `disasterId` 省略时按寒潮算 —— 那是 M1 唯一的灾难，也是所有老测试的口径。
 */
export function outdoorTemp(day: number, disasterId: string = M1_DISASTER_ID): number {
  const clamped = Math.max(FIRST_STOCKPILE_DAY, Math.min(SURVIVAL_DAYS, Math.round(day)));
  const temps = DISASTER_BY_ID.get(disasterId)?.temperatures;
  if (!temps) return 0;
  return temps[clamped] ?? temps[SURVIVAL_DAYS] ?? 0;
}
