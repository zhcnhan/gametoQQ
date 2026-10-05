/**
 * ★★ 「窗外那一条」真的画出来了吗（2026-10 用户："任何东西都要让我有感知"）
 *
 * ## 它守的是**一整维的接线**
 *
 * `DisasterProfile.windowScene` 这一维从 M3 生成出来那天起就是死的：
 * 116 个 key、**零个渲染读点**。配色表（`data/windowThemes.ts`）写好了也不算数 ——
 * "写了 ≠ 生效了"是这个项目最贵的一类错（D-32）。
 *
 * 所以这一组只问两件事：
 *  ① 生存期与整理页**真的渲染出了那条带子**，而且带的是**这一场**的渐变；
 *  ② 换一场之后，那条带子**真的不一样**（这才是"让我有感知"的判据）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getDisasterDef } from '../data/disaster';
import { disasterTintOf, windowGradientOf } from '../data/windowThemes';
import { makeStack, setSlotStack } from '../model/shelf';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createOrganizeSession } from '../systems/organize';
import { createStartingRun } from '../systems/setup';
import { OrganizeScreen } from './OrganizeScreen';
import { SurvivalScreen } from './SurvivalScreen';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 一份"正在生存期、有日报"的局面（某一灾难） */
function survivalStore(disasterId: string): GameStore {
  const run = createStartingRun(20261007, { disasterId });
  run.identityId = 'group_buyer';
  run.phase = 'survival_day';
  run.day = 3;
  return new GameStore(createSaveGame(run), stubScheduler());
}

function mountSurvival(disasterId: string): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new SurvivalScreen(asElement(root), survivalStore(disasterId), {
    onStart: () => undefined,
    onNext: () => undefined,
    onTrade: () => false
  }).mount();
  return root;
}

/** 整理页（囤货期）—— 玩家 7 天里绝大部分时间在这一屏 */
function mountOrganize(disasterId: string): FakeElement {
  const run = createStartingRun(20261007, { disasterId });
  run.identityId = 'group_buyer';
  run.phase = 'organize';
  // 铺一件货，免得空屋让版面走另一条路
  const shelf = run.shelves[0];
  if (shelf) run.shelves[0] = setSlotStack(shelf, { row: 0, col: 0 }, makeStack('canned_beans', 3, null));
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new OrganizeScreen(asElement(root), new GameStore(createSaveGame(run), stubScheduler()), createOrganizeSession(), {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined
  }).mount();
  return root;
}

/** 那条带子上的 `--sky`（= 这一场的窗外渐变） */
function bandStyle(root: FakeElement): string {
  const band = root.querySelectorAll('.window-band')[0];
  return band?.attributes?.['style'] ?? '';
}

afterEach(() => {
  installFakeWindow(new FakeDocument());
});

describe('★★ 窗外那一条：两种屏都要画，而且**换一场就不一样**', () => {
  it('★ 生存期：带子存在，而且带的是**这一场**的渐变', () => {
    const root = mountSurvival('cold_snap');
    const style = bandStyle(root);
    expect(style, '生存期没有渲染窗外那一条').not.toBe('');
    expect(style).toContain(windowGradientOf(getDisasterDef('cold_snap')));
  });

  it('★ 整理页：带子也在（囤货那 7 天里玩家基本都在这一屏）', () => {
    const root = mountOrganize('heat_wave');
    expect(bandStyle(root)).toContain(windowGradientOf(getDisasterDef('heat_wave')));
  });

  it('★★ 换一场，那一条**真的不一样**（这就是"让我有感知"的判据）', () => {
    const cold = bandStyle(mountSurvival('cold_snap'));
    const heat = bandStyle(mountSurvival('heat_wave'));
    const flood = bandStyle(mountSurvival('flood_urban'));
    expect(new Set([cold, heat, flood]).size, '三场拿到了同一条带子').toBe(3);
  });

  it('★ 顶栏那一枚灾难标记：名字对得上，而且颜色与带子**同源**', () => {
    const root = mountSurvival('flood_urban');
    const tag = root.querySelectorAll('.disaster-tag')[0];
    expect(tag?.textContent).toBe('洪水');
    expect(tag?.attributes?.['style']).toContain(disasterTintOf(getDisasterDef('flood_urban')));
    // 名字也在正文里出现过（标题那一行写着这一场）
    expect(allText(root)).toContain('洪水');
  });

  it('★ 那一条是**零台词**的（§6.6）：它不带任何文案', () => {
    const root = mountSurvival('cold_snap');
    const band = root.querySelectorAll('.window-band')[0];
    expect(band?.textContent ?? '', '带子里出现了文字 —— 这一层不说话').toBe('');
    expect(band?.attributes?.['aria-hidden']).toBe('true');
  });
});
