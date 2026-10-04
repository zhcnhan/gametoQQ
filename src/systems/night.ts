/**
 * 夜间事件（§6.2「夜间小事件」）—— **纯逻辑部分**。
 *
 * 这个文件只回答两个问题：
 *   1. 今晚有没有事？（`rollNight`，种子化）
 *   2. 选完之后世界变成什么样？（`applyNightEffect`）
 *
 * 它**不碰 store**。命令（`chooseNightOption` / `sleep`）放在 `systems/phases.ts` ——
 * 因为它们要和 `endDay` 一起维护状态机，放在同一处才不会出现"两个文件各推一次日历"的裂缝。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 */
import { getBoxDef } from '../data/boxes';
import { NIGHT_EVENT_DEFS, NIGHT_SLEEP, nightEventWeight } from '../data/nightEvents';
import { nextFloat, pickEventAvoidingRecent, type RngCursor } from '../model/rng';
import type { AppliedEffect, NightEffect, NightEventDef, NightOption, RunState } from '../model/types';
import { generateBoxStacks, nextBoxSeq } from './setup';

/**
 * 有事件的夜晚占比。
 * 已拍板：约 60% 的天有事 —— 有些夜晚直接跳过，节奏更松弛，也让事件显得更像"意外"
 * 而不是"每晚的例会"。种子化决定，同 seed 同结果。
 */
export const NIGHT_EVENT_CHANCE = 0.6;

/**
 * 今晚有事吗？有则返回事件 id，没有返回 null。消耗一次 RNG。
 *
 * @param recent 最近几晚出过的事件 id（**最新在前**，见 `RunState.eventHistory`）。
 *   紧邻的上一条会被**排除** —— "连着两晚是同一件事"是重复感最强的一种，
 *   而池子里还剩 5 条可选，随机性一点没少。理由写在 `model/rng.ts` 的
 *   `pickEventAvoidingRecent` 上。
 * @param phase ★ 现在是不是**囤货期**（2026-10 加）。
 *
 * ## ★★ 为什么夜间事件要分阶段
 *
 * 用户的原话：
 *
 * > "不是囤货期庇护所会掉，而是囤货期间有一些不属于囤货这一
 * >  我作为先知安全期惬意且安详的事件与任务与描述"
 *
 * 囤货期是**先知视角的安全期**：灾难还没来，玩家知道它要来，而世界还是正常的。
 * 而这一池子里原来混着"半夜冻醒、温度贴 9°C""呼出的气能看见""阳台的水结成冰"
 * "天花板往下坠" —— 那些是**灾难已经发生之后**的日子，在囤货期读起来完全不对。
 *
 * 现在按 `NightEventDef.when` 分池：
 *  · 囤货期只抽 `平时` 与 `预兆`（预兆就是"风声" —— 那正是先知该听到的）；
 *  · 生存期抽全部（包括 `平时` 与 `预兆`，它们在后半段读起来是"想起以前"）。
 *
 * ★ 缺省值 `phase = false` 是**故意**的：老的调用点（与测试）不传就得到
 * "全部池子"，也就是**原来那个行为**。新行为只在你显式说"我在囤货期"时生效。
 */
export function rollNight(cursor: RngCursor, recent: readonly string[] = [], phase = false): string | null {
  if (nextFloat(cursor) >= NIGHT_EVENT_CHANCE) return null;
  // （这一行被"临时忽略阶段"验证过会红 —— 见 night.test.ts 的那条 ★★）
  const pool = phase ? NIGHT_EVENT_DEFS.filter((d) => d.when !== '灾后') : NIGHT_EVENT_DEFS;
  /*
   * ★ 池子空了的兜底：**宁可抽到一条灾后，也不要一个没有夜晚的游戏**。
   * 内容写歪（比如所有条目都被标成 `灾后`）时，这一条能保住可玩性。
   * 而"囤货期一条事件都没有"是个**安静**的失败 —— 玩家只会觉得这一周很无聊。
   */
  const safe = pool.length > 0 ? pool : NIGHT_EVENT_DEFS;
  return pickEventAvoidingRecent(cursor, safe, recent, nightEventWeight)?.id ?? null;
}

/**
 * 取第 `choice` 个选择对应的选项。
 * `NIGHT_SLEEP` 与越界下标都返回 null —— 调用方据此走"什么都不做"的分支（后果为空）。
 *
 * ★ **必须是非负整数**：压测（`scripts/stress.mjs`）抓到一个字符串下标 `"0"` 的坏法 ——
 * `def.options["0"]` 在 JS 里**能取到**是对的（数组下标本来就会转成字符串），
 * 于是选项被执行、效果生效；可 `run.night.choice = "0"` 存进档之后，
 * 读档那边的 `Number.isInteger("0")` 是 **false** → `choice` 被归成 `null` →
 * **同一晚能再选一次、效果翻倍**（实测现金 900→850→800）。
 *
 * 界面传的永远是数字，所以这不是玩家能碰到的 bug；但"存进去的和读出来的判定不一致"
 * 是存档类 bug 最常见的形状，所以在**入口**就要求整数。
 */
export function optionAt(def: NightEventDef, choice: number): NightOption | null {
  if (choice === NIGHT_SLEEP) return null;
  if (!Number.isInteger(choice) || choice < 0) return null;
  return def.options[choice] ?? null;
}

const STAT_MIN = 0;
const STAT_MAX = 100;

/** 四维状态都夹在 0..100；现金夹在 ≥ 0（不给人欠债，M1 不做负债玩法） */
function shiftStat(value: number, delta: number): number {
  return Math.max(STAT_MIN, Math.min(STAT_MAX, value + delta));
}

/** 什么也没发生的后果。`NIGHT_SLEEP`（直接睡）与读档兜底都用它 */
export const NO_EFFECT: AppliedEffect = { cash: 0, health: 0, mood: 0, stamina: 0, shelter: 0, gotBox: false };

/**
 * 把选项后果落到状态上，并返回**实际生效**的数值。
 *
 * 它**只做加法**：夜间的选项效果一律是"交换"，不做条件判定 ——
 * §6.2 的夜间是"可选行动"，不是"必须解决的难题"，弄成条件链会变成考试。
 *
 * 四维在这里被扣掉的点数，都能在生存期里补回来：体力靠睡觉、心情靠归位、健康靠自动用药、
 * 庇护所靠自动添被（见 systems/survival.ts 的 autoSupply 与 data/survival.ts 的常量）。
 * 所以不要因为它"看起来只降不升"就在这里加恢复项 —— 恢复属于生存期的结算，
 * 不属于夜里的一个选项。
 *
 * ## 为什么必须返回实际值（而不是让界面去读选项声明的数）
 *
 * 现金的封顶从一开始就是对的（`Math.max(0, …)` 不给人欠债），错的是**摘要**：
 * 它拿选项里那个 -80 去显示，于是兜里只有 25 元的人在界面上看到「现金 -80」，
 * 而实际上只扣了 25。屏幕报了一件没发生的事 —— 这比数值本身更糟，
 * 因为它让玩家没法信任任何一次读数。
 *
 * 现在口径统一成：**花不起的部分不会凭空消失，但也不会假装花掉了**。
 * 真实变化从这里返回出去，摘要（`describeEffect`）与结果文案（`resolveOutcome`）都用它。
 */
export function applyNightEffect(run: RunState, effect: NightEffect, cursor: RngCursor): AppliedEffect {
  const applied: AppliedEffect = { ...NO_EFFECT };

  /*
   * ★★ 囤货期**只涨不跌**（2026-10 用户反馈）。
   *
   * 用户的原话：
   *
   * > "不是囤货期庇护所会掉，而是囤货期间有一些不属于囤货这一
   * >  我作为先知安全期惬意且安详的事件与任务与描述"
   *
   * 机制上的原因：生存期的四维账是**闭合**的（每天被灾难磨损、被保暖品/医疗品
   * 自动补），而**囤货期不结算** —— 那套账整个不跑。于是囤货期一旦有选项扣了
   * 庇护所（实测只有一条：`n_tripped_breaker` 的"裹紧被子睡" -5），它就是
   * **单向的**：掉了没有磨损来对照、也没有自动补。玩家看到的是
   * "我家在自己变冷"，而灾难还没登门。
   *
   * 现在的口径：
   *  · **跌的部分在囤货期不生效**（`Math.max(地板, 结果)`，地板 = D-Day 起点）；
   *  · **涨的部分照给**（换灯泡、封胶带都是"我把屋子弄好了"，该有回报）；
   *  · **生存期一个字没动** —— 那里"掉下去就回不来"正是压力所在。
   *
   * ⚠ 判据用 `run.phase`，不用"第几天"：`day <= 0` 与 phase 是两套口径，
   * 混用迟早会在某个中间状态上分家。
   */
  const peacetime = run.phase === 'stockpile_shop' || run.phase === 'organize' || run.phase === 'night';
  /**
   * 囤货期：**往下走的效果不生效**，往上走的照给。
   *
   * 一句话就是上面这句。而我在这里改错过**三次**，三次都值得记下来 ——
   * 因为每一次都是一个"听起来很合理、在边界上完全不同"的形状：
   *
   *  ① `Math.max(起点, 结果)` —— 庇护所 80 时"扣 5 点"变成"**涨 20 点**"；
   *  ② "只要要跌就冻住" —— 体力本来只有 3 时"扣 25 点"变成"一点都不掉"，
   *     于是**生存期的夹取语义在囤货期被悄悄换掉了**；
   *  ③ 又想"跌不过起点" —— 可**起点是满值 100**，于是"80 + 3 = 83"会被
   *     抬到 100（`applied.shelter = 20`，凭空涨 20）。
   *
   * 三次的根子是同一个：我一直在试图让它**相对于起点**做事，
   * 而这周的状态本来就是"完整"的 —— 所以不需要相对任何东西，
   * 只需要"别往下走"。
   *
   * ⚠ 判据用 `run.phase`，不用"第几天"：两套口径混用迟早会在某个中间状态上分家。
   */
  const peacetimeDelta = (delta: number): number => (peacetime && delta < 0 ? 0 : delta);

  if (effect.cash) {
    const next = Math.max(0, run.cash + effect.cash);
    applied.cash = next - run.cash;
    run.cash = next;
  }
  if (effect.health) {
    applied.health = shiftStat(run.stats.health, peacetimeDelta(effect.health)) - run.stats.health;
    run.stats.health += applied.health;
  }
  if (effect.mood) {
    applied.mood = shiftStat(run.stats.mood, peacetimeDelta(effect.mood)) - run.stats.mood;
    run.stats.mood += applied.mood;
  }
  if (effect.stamina) {
    applied.stamina = shiftStat(run.stats.stamina, peacetimeDelta(effect.stamina)) - run.stats.stamina;
    run.stats.stamina += applied.stamina;
  }
  if (effect.shelter) {
    applied.shelter = shiftStat(run.stats.shelter, peacetimeDelta(effect.shelter)) - run.stats.shelter;
    run.stats.shelter += applied.shelter;
  }
  if (effect.boxDefId) {
    const def = getBoxDef(effect.boxDefId);
    // 批次到期日以**当前天**为基准，与白天采购一致（同一套 FEFO 尺子）
    run.boxesToUnpack.push({
      id: `box_${nextBoxSeq(run.boxesToUnpack)}`,
      defId: def.id,
      items: generateBoxStacks(cursor, def, run.day)
    });
    applied.gotBox = true;
  }

  return applied;
}

/**
 * 后果的人话摘要，给界面显示。**读的是实际生效值**（见 applyNightEffect）。
 * 返回空数组 = 什么都没变（"直接睡"就是这种情况），界面据此不渲染数值行。
 */
export function describeEffect(applied: AppliedEffect): string[] {
  const parts: string[] = [];
  const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
  if (applied.cash) parts.push(`现金 ${signed(applied.cash)}`);
  if (applied.health) parts.push(`健康 ${signed(applied.health)}`);
  if (applied.mood) parts.push(`心情 ${signed(applied.mood)}`);
  if (applied.stamina) parts.push(`体力 ${signed(applied.stamina)}`);
  if (applied.shelter) parts.push(`庇护所 ${signed(applied.shelter)}`);
  if (applied.gotBox) parts.push('带回来一箱货');
  return parts;
}

/**
 * 把结果文案里的 `{spentCash}` 换成实际花掉的现金（正数）。
 *
 * 有了它，「转他 80」在钱够时读作"你转过去 80"，在只剩 25 时读作"你转过去 25" ——
 * 同一句话，两种处境，都不用另写一条事件。
 */
export function resolveOutcome(option: NightOption, applied: AppliedEffect): string {
  return option.outcome.replace('{spentCash}', String(Math.abs(applied.cash)));
}

/** 这个选项要花多少现金（正数；不是支出则为 0）。界面与命令层都用它判断买不买得起 */
export function cashCost(option: NightOption): number {
  return Math.max(0, -(option.effect.cash ?? 0));
}
