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
import type { RunState } from '../model/types';
import { createMetaProfile, createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createOrganizeSession } from '../systems/organize';
import { createStartingRun } from '../systems/setup';
import { CodexScreen } from './CodexScreen';
import { EndingScreen } from './EndingScreen';
import { HelpScreen } from './HelpScreen';
import { NightScreen } from './NightScreen';
import { OrganizeScreen } from './OrganizeScreen';
import { PendingScreen } from './PendingScreen';
import { PrologueScreen } from './PrologueScreen';
import { ShopScreen } from './ShopScreen';
import { SurvivalScreen } from './SurvivalScreen';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 一屏一份"能挂起来"的最小局面（`phase` 决定 Router 会造哪一屏） */
function storeAt(disasterId: string, phase: RunState['phase'], day: number): GameStore {
  const run = createStartingRun(20261007, { disasterId });
  run.identityId = 'group_buyer';
  run.phase = phase;
  run.day = day;
  return new GameStore(createSaveGame(run), stubScheduler());
}

const noop = (): void => undefined;

/** ———————— 九个屏幕各自的挂载器（这一组要**逐个**挂一遍） ———————— */

function mountPrologue(): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new PrologueScreen(asElement(root), {
    disasterId: 'cold_snap',
    meta: createMetaProfile(),
    onConfirm: noop,
    onRestart: noop
  }).mount();
  return root;
}

function mountShop(): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = storeAt('cold_snap', 'stockpile_shop', -7);
  store.commit((draft) => {
    draft.currentShopId = 'supermarket';
  });
  new ShopScreen(asElement(root), store, { onGoHome: noop }).mount();
  return root;
}

function mountNight(): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = storeAt('cold_snap', 'night', -3);
  store.commit((draft) => {
    draft.night = { eventId: 'n_night_shift', choice: null, applied: null };
  });
  new NightScreen(asElement(root), store, { onChoose: noop, onSleep: noop }).mount();
  return root;
}

function mountHelp(): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = storeAt('cold_snap', 'help_request', 4);
  store.commit((draft) => {
    draft.helpRequest = { defId: 'q_wang_medicine' };
  });
  new HelpScreen(asElement(root), store, { onFulfill: noop, onDecline: noop, onLeave: noop }).mount();
  return root;
}

function mountEnding(): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  const store = storeAt('cold_snap', 'ending', 14);
  store.commit((draft) => {
    draft.outcome = 'survived';
  });
  new EndingScreen(asElement(root), store, { onRestart: noop, onOpenCodex: noop }).mount();
  return root;
}

function mountCodex(): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new CodexScreen(asElement(root), storeAt('cold_snap', 'survival_day', 3), { onClose: noop }).mount();
  return root;
}

function mountPending(): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new PendingScreen(asElement(root), {
    title: '这一局读不出来',
    note: '存档里的进度状态这个版本不认识。',
    disasterId: 'cold_snap',
    onRestart: noop
  }).mount();
  return root;
}

/** 一份"正在生存期、有日报"的局面（某一灾难） */
function survivalStore(disasterId: string): GameStore {
  return storeAt(disasterId, 'survival_day', 3);
}

function mountSurvival(disasterId: string): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  new SurvivalScreen(asElement(root), survivalStore(disasterId), {
    onStart: () => undefined,
    onNext: () => undefined,
    onTrade: () => false,
        onGoOrganize: () => undefined
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
    onEndDay: () => undefined,
        onBackToSurvival: () => undefined
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

/**
 * ★★ **全部九屏**都要有那条带子（这一组是这次 bug 的直接产物）
 *
 * ## 它是怎么来的
 *
 * 我第一版只把带子加进了**整理页与生存期**两屏，而用户当时停在**开局页**
 * （`phase=prologue`）—— 他跑 `__tunhuo.why()` 得到的输出是
 * "带子：★ 不在 DOM 里（这一份构建没有它）"，于是那一刻他合理地认为
 * **这个功能根本没做**（而他连着两轮报的都是这件事）。
 *
 * ★ 真正的错在**接线方式**：九个屏幕各写各的 `innerHTML`，带子靠逐个手加 ——
 * 九处里我漏了七处。所以这条用例**逐个挂载每一屏**，一屏没有带子就红，
 * 而不是"再记得手工加第七次"。
 */
describe('★★ 每一屏都要有「窗外」—— 九屏逐屏核对（漏过七处的那次）', () => {
  /** 一屏一个挂载器：返回它的根，用例只关心 `.window-band` 在不在 */
  const MOUNTERS: { name: string; mount: () => FakeElement }[] = [
    { name: '开局页 prologue', mount: () => mountPrologue() },
    { name: '扫货 shop', mount: () => mountShop() },
    { name: '整理 organize', mount: () => mountOrganize('cold_snap') },
    { name: '夜间 night', mount: () => mountNight() },
    { name: '生存期 survival', mount: () => mountSurvival('cold_snap') },
    { name: '求援 help', mount: () => mountHelp() },
    { name: '结算 ending', mount: () => mountEnding() },
    { name: '图鉴 codex', mount: () => mountCodex() },
    { name: '兜底 pending', mount: () => mountPending() }
  ];

  for (const { name, mount: mountIt } of MOUNTERS) {
    it(`★ ${name}：有那条带子`, () => {
      const root = mountIt();
      const bands = root.querySelectorAll('.window-band');
      expect(bands.length, `${name} 没有渲染「窗外」那条带子`).toBeGreaterThan(0);
      // 而且它得带对了这一场的渐变（不能是个空壳）
      expect(bands[0]?.attributes?.['style'] ?? '', `${name} 的带子没有渐变`).toContain('linear-gradient');
    });
  }
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
