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
 */
import { getDisasterDef } from '../data/disaster';
import { disasterTintOf, windowGradientOf } from '../data/windowThemes';
import type { RunState } from '../model/types';

/**
 * 这一屏属于哪一场 —— 调用点可以给整个 `RunState`，也可以只给一个 id。
 *
 * ## 为什么参数要收两种（这不是"顺手宽松"，是被九屏的真实形状逼出来的）
 *
 * 九个屏幕里，多数手里有 `store`（于是有 `store.run`），
 * 但 **`PrologueScreen` 手里只有 `props`**（它连 store 都没有 —— 那一屏
 * 只用 `meta` 与 `disasterId` 两个输入，刻意不拿 store）。
 *
 * 我第一版把九个调用点统一写成 `windowBandHtml(this.store.run)`，
 * 于是 `tsc` 在开局页那一屏当场报 `Property 'store' does not exist` ——
 * **而那一屏恰恰是用户报"没看到"的那一屏**。所以这里收两种输入：
 * 调用点给什么就用什么，不给它加一个"为了调这个函数而引入 store"的假依赖。
 */
function disasterIdOf(run: RunState | string): string {
  return typeof run === 'string' ? run : run.disasterId;
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
 * 所以现在只有一个入口，而 `ui/windowScreen.test.ts` 会遍历**全部九屏**，
 * 一屏没有带子就红。
 *
 * ## 放的位置：顶栏与正文之间
 *
 * 它必须在**状态栏之下、正文之上** —— 那是"抬头看见窗外"的位置。
 * 所以调用点一律插在 `</header>` 之后、`<main>` 之前。
 *
 * @param run 这一局（或只给 `disasterId` —— 见 `disasterIdOf` 的注释）
 */
export function windowBandHtml(run: RunState | string): string {
  const disaster = getDisasterDef(disasterIdOf(run));
  const gradient = windowGradientOf(disaster);
  const tint = disasterTintOf(disaster);
  return `
    <div class="window-band is-${disaster.windowScene}" style="--sky:${gradient}; --tint:${tint}" aria-hidden="true">
      <i class="window-band-glass"></i>
      <i class="window-band-fall"></i>
    </div>
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
