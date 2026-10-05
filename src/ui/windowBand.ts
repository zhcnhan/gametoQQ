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
 * 顶栏底下那一条光带的 HTML。
 *
 * @param run 这一局（只要 `disasterId`，但传整个 run 是为了调用点写起来一致 ——
 *   这一层已经有五六个地方在读 `run.*` 了）
 */
export function windowBandHtml(run: RunState): string {
  const disaster = getDisasterDef(run.disasterId);
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
export function disasterTagHtml(run: RunState): string {
  const disaster = getDisasterDef(run.disasterId);
  return `<span class="disaster-tag" style="--tint:${disasterTintOf(disaster)}">${disaster.name}</span>`;
}
