/**
 * ★★ 日报里那一框突发事件的两个表达（M4 第五组）。
 *
 * ## 为什么这两句话各自值得一条守卫
 *
 * 第五组这一批要回答的是玩家那句原话：**"顺手位有没有又怎么样呢"**。
 * 顺手位本身早就能标了（W-06 让它随身份破例到两块），缺的是**反馈**：
 *
 *  1. **反事实**（`emergencyHtml` 里"那一格要是空的"那一行）说
 *     "这块地方**本来**会替你挡掉什么" —— 没有它，化解只是"今天没事"，
 *     而玩家读不出"没事"是因为运气还是因为自己摆对了；
 *  2. **累计**（`safetyHtml` 的"门口那块替你把 N 次意外挡在了门外"）说
 *     "它**到底**起过作用没有" —— 上面那个应急率百分比回答的是**现在**
 *     摆得怎么样（一个状态），而这个问题问的是一段历史。
 *     一个 100% 的应急率如果整局没抽到过突发事件，玩家一次都没感受到它。
 *
 * ## 两条判据拦的都是"看起来对了"的写法
 *
 *  · 反事实**只在化解时**出现。没化解时那件事已经发生、框里印的就是实扣的
 *    那几个数，再说一遍"本来会扣多少"是把话说两遍 —— 而且那一刻玩家要看的
 *    是损失，不是"你本可以"；
 *  · 累计只在 `> 0` 时出现，措辞**不是**"成功化解 N 次"。
 *    那是记分牌口径（§5 引擎①：只陈述，不夸），会让人去刷次数。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { EMPTY_SURVIVAL_SNAPSHOT } from '../data/survival';
import { createStartingRun } from '../systems/setup';
import { SurvivalScreen } from './SurvivalScreen';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';
import type { SurvivalSnapshot } from '../model/types';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 一份"正在生存期、刚走完一天"的局面，日报快照按参数拼 */
function mountLast(last: Partial<SurvivalSnapshot>, savedCount = 0): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');

  const run = createStartingRun(20261009);
  run.identityId = 'group_buyer';
  run.phase = 'survival_day';
  run.day = 4;
  run.survival.last = { ...EMPTY_SURVIVAL_SNAPSHOT, ...last };
  run.survival.emergencySavedCount = savedCount;
  const store = new GameStore(createSaveGame(run), stubScheduler());
  new SurvivalScreen(asElement(root), store, {
    onStart: () => undefined,
    onNext: () => undefined,
    onTrade: () => false,
    onGoOrganize: () => undefined
  }).mount();
  return root;
}

/** 页面上的全部文字（fake DOM 没有 `innerText`，逐节点拼） */
function allText(root: FakeElement): string {
  return root.querySelectorAll('*').map((el) => el.textContent).join('\n');
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('★★ 日报里突发事件的两种说法（M4 第五组）', () => {
  it('★ 化解了：说出"那一格要是空的会怎样"，并说清东西是被用掉还是还在', () => {
    const eaten = allText(
      mountLast({ emergencyId: 'e_barter_ask', emergencyResolved: true, emergencyLost: 0, emergencyGift: { itemId: 'lamp_oil', count: 1, where: 'shelf' } })
    );
    expect(eaten).toContain('那一格要是空的');
    // ★ `consumes: true` 的那条要明说"用掉了" —— 不说玩家会去找那一罐
    expect(eaten).toContain('用掉了');
    // 别人回的东西也要落在这一框里（不然只有"给出去"没有"换回来"）
    expect(eaten).toContain('煤油');
  });

  it('★ 没化解：只说实扣的数，不再说"本来会……"', () => {
    const hurt = allText(mountLast({ emergencyId: 'e_barter_ask', emergencyResolved: false, emergencyLost: 2 }));
    // 实扣的数在（健康/心情/体力三行）
    expect(hurt).toContain('健康');
    /*
     * 反事实**不该**出现在没化解的那一档：那件事已经发生了，
     * 框里印的就是真扣的数，再说"那一格要是空的会怎样"是把话说两遍。
     */
    expect(hurt).not.toContain('那一格要是空的');
  });

  it('★ 挡下过才有那一行：0 次时一个字都不显示', () => {
    /*
     * §5 引擎①：只陈述，不夸。"挡下过 0 次"是一条没有信息量的句子，
     * 而且它读起来像在提醒玩家"你什么都没挡住"—— 那正是最容易变成
     * 责备的写法。
     */
    expect(allText(mountLast({}, 0))).not.toContain('挡在了门外');
    const some = allText(mountLast({}, 3));
    expect(some).toContain('挡在了门外');
    expect(some).toContain('3 次');
    // ★ 措辞不能变成记分牌（"成功化解 N 次"会让人去刷次数）
    expect(some).not.toContain('成功化解');
  });
});
