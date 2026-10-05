/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「最后一页」—— 结算页最后那一张日历
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 用户要的那件事
 *
 * 它是 M5 工单「第四组：体验与无障碍」的第 3 条（那一版工单在 2026-10
 * 重写过一次，做完的条目只留在 `docs/M5-开发工单.md` §3 与实施记录里），
 * 原文写的是：
 *
 * > **结局"最后一页"演出**（死局：撕掉的日历；生还：翻过来的春天）
 *
 * 在那之前，熬过十四天的全部回报是**一屏数字**（撑过 N 天 / 硬撑了 N 天 /
 * 缺过 N 件 / 最后剩下 N 件）。数字一个都不少，但**没有一件事是"演"出来的** ——
 * 而这一局最贵的东西恰恰不是数字：是那十四天。
 *
 * ## ★★ 它为什么必须"挂在纸上"，而不是做一段动画
 *
 * 这一作的底子是**一本手写台账**（§5A：纸底 / 墨色 / 朱红）。
 * 所以"最后一页"不是特效，是**台账的最后一页**：
 *
 *   · **活到最后** → 那张日历**翻过来**了：格子是完整的，每一格上有一道
 *     深浅不同的刻痕（那一天过得怎么样），底下是订书钉、边角有一点卷；
 *   · **没撑住** → 那张日历**被撕掉了一截**：写过的天数还在（只是末尾几格
 *     被撕开了口子），而**后面那些天根本没印出来** —— 没活到那儿，就没有那一天。
 *
 * ★ 最后那一条是这一页唯一"有想法"的地方：**不是把没活到的日子画成灰的**，
 * 而是**根本不画**。灰格子说的是"这一天没做好"，缺格子说的是"这一天不存在" ——
 * 而这一局里玩家最该被说清楚的就是后者。
 *
 * ## 零美术资源（工单原话："纯 CSS + 已有的纸纹基底，不需要新美术资源"）
 *
 * 撕口是 `mask-image: repeating-linear-gradient(...)` 的锯齿（有意做成**粗齿**：
 * 细齿在高分屏上会糊成一片灰边），刻痕就是几根 `<i>` 的高度，
 * 纸张本身用 `--paper-2` + 一个 `repeating-linear-gradient` 的极淡横纹
 * （横纹 = 印刷纸的观感，也是这一作每个"卡片"都在用的那一层）。
 *
 * ⚠ **不做动画**：这一页是玩家看完数字之后停在上面的一屏（§4A 说界面不许抢戏）。
 * 唯一的动效是 `@media (prefers-reduced-motion: reduce)` 下会被关掉的
 * 那一下淡入 —— 它只负责"这一页是刚翻过来的"，不负责庆祝。
 *
 * ## 口径：它说的还是这一局的事实
 *
 * 格子数 = `SURVIVAL_DAYS`（14）；刻痕的深浅来自**这一局的 seed 与天数**
 * （同一个存档刷新多少次都是同一张日历 —— 见下面 `tickOf` 里那段注释）；
 * 哪几格被撕开由 `shortageDays / shortagePieces` 决定，
 * 也就是"这一局哪几天短了口粮"这个**已经记在档里**的事实，
 * 不是另掷一次骰子。
 */
import { SURVIVAL_DAYS } from '../data/disaster';

/** 一张日历的逐格形状（纯数据，测试直接对着它断言） */
export interface EndingDay {
  /** 第几天（1 起数，`SURVIVAL_DAYS` 止） */
  day: number;
  /** 刻痕高度 0..1（那一天过得怎么样 —— 只做视觉，没有第二个人读它） */
  tick: number;
  /** 这一格是不是被撕开的（短过口粮的那几天在末尾） */
  torn: boolean;
}

/** 那一页要说的话（三句，全部按结局与这一局的账算出来） */
export interface EndingPage {
  /** 标题，例如「日历翻过去了」/「日历撕到这里」 */
  head: string;
  /** 底下那一句 */
  note: string;
  day: EndingDay[];
  /** 活到了第几天（算出来的格数，免得界面自己再数一遍） */
  printed: number;
}

/**
 * 刻痕高度：`(seed, day)` → 0.34..1.00。
 *
 * ★★ 这里**刻意不用** `model/rng.ts` 的游标：那个游标是**游戏状态**
 * （`RunState.seed`，每次消耗都要落盘、影响后续玩法）。结算页只是画一张图，
 * 去推进游标会让"刷新一次结算页"与"不刷新"产生**不同的存档状态** ——
 * 而那种错要等下一次读档才看得见。
 *
 * 所以这里用一条纯函数：同一个 seed 同一天，永远是同一个高度；
 * 不让任何东西被这次渲染改掉。（`Math.imul` 那个 32 位混合是 mulberry32
 * 的最后一轮，distribution 够画一张图。）
 */
function tickOf(seed: number, day: number): number {
  let t = (seed ^ Math.imul(day + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return 0.34 + unit * 0.66;
}

/**
 * 把这一局的账算成一张日历。
 *
 * @param survived     结局是不是"活到了最后"
 * @param lasted       活到了第几天（`run.survival.days` 一类，1 起数）
 * @param shortageDays 短过口粮的天数（`run.survival.shortageDays`）
 * @param seed         这一局的种子（只用来决定刻痕深浅）
 */
export function endingPageOf(
  survived: boolean,
  lasted: number,
  shortageDays: number,
  seed: number
): EndingPage {
  /*
   * 印出来的天数：
   *  · 活到最后 → 整张（14 天）；
   *  · 没撑住 → 只印到停下的**前**一天。停在第 1 天就是一张白纸 ——
   *    那不是 bug，那正是这一局的样子（而"一张白纸"比"一格灰格子"狠得多）。
   */
  const printed = survived ? SURVIVAL_DAYS : Math.max(0, Math.min(SURVIVAL_DAYS, lasted - 1));

  /*
   * 撕开的格子：按"短过口粮的天数"算，**从末尾往前撕**。
   *
   * ★ 从末尾撕而不是随便挑几天：日历是被翻旧、被扯坏的，
   * 撕口在末尾才读得出"越到后面越撑不住"。位置随天数走（不掷骰子），
   * 所以同一个存档每次刷新都是同一条撕口。
   */
  const tornCount = Math.max(0, Math.min(6, shortageDays));

  const day: EndingDay[] = [];
  for (let d = 1; d <= printed; d++) {
    day.push({
      day: d,
      tick: tickOf(seed, d),
      torn: tornCount > 0 && d > printed - tornCount
    });
  }

  return {
    head: survived ? '日历翻过去了' : printed > 0 ? '日历撕到这里' : '日历还是白的',
    note: survived
      ? `十四天，一天不落。每一格上是那一天的刻痕 —— 深的那些天不好过。`
      : printed > 0
        ? `写过的 ${printed} 天都还在。后面那些天没印出来 —— 你没活到那儿。`
        : '第一天就停下了。这一页没来得及写。',
    day,
    printed
  };
}

/**
 * 那一页的 HTML（结算页正文最后一段）。
 *
 * ⚠ 它**只画纸与格子**，一个数字都不写 —— 撑过几天 / 缺过几件那些
 * 上面几段已经说过了，这里再说一遍就是两张账（§10.1A 欠账①：
 * 只改数字的机制必须同时有非数字表达，而**非数字表达不等于把数字再抄一遍**）。
 */
export function endingPageHtml(page: EndingPage): string {
  const cells = page.day
    .map(
      (d) =>
        `<i class="ending-day${d.torn ? ' is-torn' : ''}" style="--tick:${d.tick.toFixed(3)}" aria-hidden="true"></i>`
    )
    .join('');
  /*
   * 没印出来的那些天：**留白**，但把"本该有多少天"说出来（`data-blank`），
   * 因为这一页的另一半意思正是"那里本来还有日子"。
   */
  const blank = SURVIVAL_DAYS - page.printed;
  return `
    <section class="block ending-page" data-ending-page>
      <h2 class="block-title">${page.head}</h2>
      <div class="ending-calendar" role="img"
        aria-label="这一局的日历：${page.printed} 天写过了，剩下 ${blank} 天没印出来"
        data-printed="${page.printed}" data-blank="${blank}">
        <div class="ending-grid">${cells}</div>
      </div>
      <p class="block-note">${page.note}</p>
    </section>
  `;
}
