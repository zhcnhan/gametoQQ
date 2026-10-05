/**
 * ★★ D-33 / 决策 E 的**屏幕级**那一半：整页底色真的被挂到 `<body>` 上了吗。
 *
 * `familyTone.test.ts` 守的是"算出来的七个底对不对"，这一份守的是**它有没有被用**。
 * 两件事分开守是有原因的：底色是**整页**的属性，而挂它的地方（`ui/Router.ts` 的
 * `render()`）在屏与屏之间**不会重设** —— 一旦某一次换页漏掉，玩家看到的是
 * "刚才还是冷蓝、点一下变回米黄"，而那一屏与上一屏的代码各自都是对的。
 * 这种错没有断言根本看不出来（算色值的测试照样全绿）。
 *
 * 所以这里问三件事：
 *  ① 挂上去了没有（三个变量 + `data-disaster-family`）；
 *  ② 换一场灾难之后**跟着换**（这是"灾难决定配色"的全部意义）；
 *  ③ 同一个 Router 连着 render 两次，值不漂（幂等；`render()` 每帧都会被调）。
 */
import { describe, expect, it } from 'vitest';
import { getDisasterDef } from '../data/disaster';
import { familyToneOf } from '../data/familyTone';
import { Router, type Screen, type ScreenKey } from './Router';
import { FakeDocument, installFakeWindow } from './fakeDom';

/** 什么都不做的空屏：这一份用例只关心 Router 自己在 render 开头做的那件事 */
function stubScreen(): Screen {
  return { mount: () => undefined, render: () => undefined, dispose: () => undefined };
}

function harness(disasterId: string) {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const router = new Router(
    host as unknown as HTMLElement,
    (): ScreenKey => 'prologue',
    () => stubScreen(),
    () => getDisasterDef(disasterId)
  );
  const body = doc.body;
  return {
    router,
    /** `<body>` 上那个变量的当前值 */
    varOf: (name: string): string => body.style.getPropertyValue(name),
    family: (): string | undefined => body.dataset['disasterFamily']
  };
}

describe('D-33：换页那一刻把这一场的底色挂到 body 上', () => {
  it('① 三个变量都挂上了，值就是这一场家族的三个色', () => {
    const h = harness('cold_snap');
    h.router.render();

    const disaster = getDisasterDef('cold_snap');
    const tone = familyToneOf(disaster);
    expect(h.varOf('--paper')).toBe(tone.page);
    expect(h.varOf('--card')).toBe(tone.card);
    expect(h.varOf('--paper-2')).toBe(tone.sunken);
    expect(h.family()).toBe(disaster.family);

    // ★ 纸箱那个牛皮纸色**不许**被改（它说的是"纸箱"这件东西，不是页面基调）
    expect(h.varOf('--paper-3')).toBe('');
  });

  it('② 换一场灾难 → 底色跟着换；同一家族的两场底色**相同**（刻意的）', () => {
    // 挑一场**另一个家族**的（热浪是"温度"、寒潮是"温度"以外的第一场用洪水）
    const cold = harness('cold_snap');
    cold.router.render();
    const coldPaper = cold.varOf('--paper');

    const other = harness('flood_urban');
    other.router.render();
    expect(getDisasterDef('flood_urban').family, '这一条要一场别的家族才验得出来').not.toBe(
      getDisasterDef('cold_snap').family
    );
    expect(other.varOf('--paper'), '换了家族却没换底').not.toBe(coldPaper);
    expect(other.family()).toBe(getDisasterDef('flood_urban').family);

    // 同一个家族的另一场（热浪）：底色一模一样 —— 这是 by design，
    // "逐场一个底"已被实测否决（见 `data/familyTone.ts` 的头部注释）
    const heat = harness('heat_wave');
    heat.router.render();
    expect(getDisasterDef('heat_wave').family).toBe(getDisasterDef('cold_snap').family);
    expect(heat.varOf('--paper'), '同家族的两场底色不该不同').toBe(coldPaper);
  });

  it('③ 连着 render 不漂，也不残留上一个家族的名字', () => {
    const h = harness('cold_snap');
    h.router.render();
    const first = h.varOf('--paper');
    h.router.render();
    h.router.render();
    expect(h.varOf('--paper')).toBe(first);

    // 同一个文档上换一个 Router（= 换一局）之后，家族名要跟着新那一局
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const router = new Router(
      host as unknown as HTMLElement,
      (): ScreenKey => 'prologue',
      () => stubScreen(),
      () => getDisasterDef('riot_curfew')
    );
    router.render();
    expect(doc.body.dataset['disasterFamily']).toBe(getDisasterDef('riot_curfew').family);
    expect(doc.body.style.getPropertyValue('--paper')).toBe(familyToneOf(getDisasterDef('riot_curfew')).page);
  });

  it('④ 拿不到灾难时退回那张米黄纸，并且不留下假的家族名', () => {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const router = new Router(
      host as unknown as HTMLElement,
      (): ScreenKey => 'pending',
      () => stubScreen(),
      () => undefined
    );
    router.render();
    expect(doc.body.style.getPropertyValue('--paper')).toBe('#f7f3ea');
    expect(doc.body.style.getPropertyValue('--card')).toBe('#fffcf5');
    expect(doc.body.style.getPropertyValue('--paper-2')).toBe('#efe9dc');
    expect(doc.body.dataset['disasterFamily']).toBeUndefined();
  });
});
