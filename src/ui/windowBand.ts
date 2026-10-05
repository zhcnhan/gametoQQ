/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「窗外」那一条光带 —— 让**这一局是哪一场**一眼看得出来
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它补的是哪一笔账（用户的原话）
 *
 * > "各个灾难没有让我感觉到不同，同质性太强烈了（即便有数值变化我也感觉不出来，
 * >  哪怕你改改某些配色也是好的啊）"
 * >
 * > "加一条铁则，任何东西都要让我有感知"
 *
 * `DisasterProfile.windowScene` 这一维从 M3 生成出来那天起就是死的
 * （116 个 key、零个渲染读点），配色表见 `data/windowThemes.ts`。
 * 这个文件是它的**第一个也是唯一的渲染点**。
 *
 * ## 为什么是一条"光带"而不是一整块背景
 *
 * §5A 定的底是**纸**（`--paper`）—— 整屏铺一层天空会把"手账"变成"风景画"，
 * 而且纸墨的层次（M2 花一整轮立起来的那三档边框）会全部被压掉。
 * 所以这里只在**顶栏底下压一条 34px 的光带**：它像手账页眉上随手画的一道天光，
 * 占的地方极小，而"今天是什么天"这件事每天都会撞进眼睛里。
 *
 * ## 三条纪律
 *
 *  ① **零依赖、零图片**：只用一个 `linear-gradient` + 两条 `repeating-linear-gradient`
 *     画窗棂，外加一个 CSS 类表示"飘着的东西"（雪 / 灰 / 雨 / 尘）；
 *  ② **不碰纸墨朱红的语义**：颜色全部来自 `disasterTintOf` / `windowThemeOf`
 *     （它们在数据层就避开了朱红与暖黄，`windowThemes.test.ts` 钉着）；
 *  ③ **数值进样式属性和 class，不进文案**：这一层不说话（§6.6 零台词）。
 *
 * ## ★ 它现在还捎带着「先知日历」那一条（D-33 / 决策 E）
 *
 * 用户要"日历的先知作用挪到最上面去"（见 `ui/prophetBar.ts` 的文件头）。
 * 那一条**没有**自己开第二个入口，而是挂在这里 —— 理由与上面第 64 行那段
 * 一模一样：九屏各写各的 `innerHTML`，多一个入口就是"再记得手工加第九次"。
 * 于是"每一屏都有带子"与"每一屏都有先知栏"由**同一条守卫**一起问
 * （`ui/windowBand.test.ts` 逐屏核对两样东西）。
 */
import { getDisasterDef } from '../data/disaster';
import { disasterTintOf, windowGradientOf } from '../data/windowThemes';
import type { RunState } from '../model/types';
import { prophetBarHtml, prophetDetailHtml } from './prophetBar';

/**
 * 画那一条要什么 —— 三种写法都收，因为**九屏手里握着的东西本来就不同**：
 *
 *   · `RunState`   —— 七个屏（手里有 store）；
 *   · `disasterId` —— 开局页（那一屏刻意不拿 store，只用 `meta` 与 `disasterId`）；
 *   · `{ disasterId, day? }` —— 兜底页（它连 run 都读不出来，但 disasterId 与
 *     day 是两个单独的字段；硬塞一个假的 `RunState` 进去会诱使后来的人
 *     "顺手读 run 的别的字段"，而那个假对象里没有）。
 *
 * ## 为什么参数要收三种（这不是"顺手宽松"，是被九屏的真实形状逼出来的）
 *
 * 我第一版把九个调用点统一写成 `windowBandHtml(this.store.run)`，
 * 于是 `tsc` 在开局页那一屏当场报 `Property 'store' does not exist` ——
 * **而那一屏恰恰是用户报"没看到"的那一屏**。所以这里收"调用点手里真有的东西"，
 * 不给它加一个"为了调这个函数而引入 store"的假依赖。
 *
 * ★ 三种都收进**一个入口**是刻意的：多开一个入口 = 再记得手工加第九次
 * （这正是当年带子漏掉七屏的形状）。
 */
export type BandInput = RunState | string | { disasterId: string; day?: number | undefined };

/** 这一屏属于哪一场（三种输入统一读成 id） */
function disasterIdOf(run: BandInput): string {
  return typeof run === 'string' ? run : run.disasterId;
}

/**
 * 这一屏知道"今天第几天"吗 —— 知道就说，不知道就 `null`（**不编一个数**）。
 *
 * 开局页只拿得到 `disasterId`。`prophetBarHtml` 收到 `null` 时不写倒计时，
 * 强度曲线与"最要紧的两类"照旧 —— 先知栏在开局页仍然成立。
 * ⚠ 判据是 `typeof run.day === 'number'`，不是 `'day' in run`：
 * 对象上有一个 `day: undefined` 的键（`PendingScreen` 传的就是这种）
 * 与"没有 day"是同一件事，而 `in` 会把前者算成"知道"。
 */
function dayOf(run: BandInput): number | null {
  if (typeof run === 'string') return null;
  const day = (run as { day?: number | undefined }).day;
  return typeof day === 'number' ? day : null;
}

/**
 * ★★ **每一屏**的"窗外"（M4，2026-10：用户连着两轮报"没看到"）。
 *
 * ## 那两轮是怎么来的（值得记，因为它是一个接线缺口，不是缓存问题）
 *
 * 我第一版只把带子加进了**整理页与生存期**两屏，而用户当时停在**开局页**
 * （`phase=prologue`）—— 于是他跑 `__tunhuo.why()` 得到的是
 * "带子：★ 不在 DOM 里"，而那句话在界面上读起来与"这个功能没做"一模一样。
 *
 * ★ 真正的错不在于"漏了一屏"，而在于**接线方式**：九个屏幕各写各的
 * `innerHTML`，而带子靠**逐个手加** —— 那种做法一定会漏（九处里我漏了七处）。
 * 所以现在只有一个入口，而 `ui/windowBand.test.ts` 会遍历**全部九屏**，
 * 一屏没有带子就红。
 *
 * ## 放的位置：顶栏与正文之间
 *
 * 它必须在**状态栏之下、正文之上** —— 那是"抬头看见窗外"的位置。
 * 所以调用点一律插在 `</header>` 之后、`<main>` 之前。
 * ★ 先知栏（`prophetBarHtml`）与它的展开层（`prophetDetailHtml`）跟着一起返回，
 * 于是它们自动落在同一个位置、自动每一屏都有。
 *
 * @param run 这一局（或只给 `disasterId` —— 见 `BandInput` 的注释）
 */
export function windowBandHtml(run: BandInput): string {
  const disaster = getDisasterDef(disasterIdOf(run));
  const gradient = windowGradientOf(disaster);
  const tint = disasterTintOf(disaster);
  return `
    <div class="window-band is-${disaster.windowScene}" style="--sky:${gradient}; --tint:${tint}" aria-hidden="true">
      <i class="window-band-glass"></i>
      <i class="window-band-fall"></i>
    </div>
    ${prophetBarHtml(disasterIdOf(run), dayOf(run))}
    ${prophetDetailHtml(disasterIdOf(run), dayOf(run))}
  `;
}

/**
 * ★ 灾难名那一枚小标记（朱红印章旁边那个"这一场是什么"）。
 *
 * 它比光带更进一步：光带告诉你"外面什么天"，这一枚告诉你"**这是哪一场**"，
 * 而且用的是**同一份颜色**（`disasterTintOf`）—— 两处同源，
 * 所以玩家会把"那条天光"与"那枚标记"连成一件事。
 */
export function disasterTagHtml(run: RunState | string): string {
  const disaster = getDisasterDef(disasterIdOf(run));
  return `<span class="disaster-tag" style="--tint:${disasterTintOf(disaster)}">${disaster.name}</span>`;
}
