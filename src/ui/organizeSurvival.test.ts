/*
 * ★★ 整理页的两种形状（W-09 / M4 决策 B，2026-10）。
 *
 * ## 为什么需要这一份
 *
 * 整理页 `ui/OrganizeScreen.ts` 是**两段流程共用**的一屏：囤货期的日常，
 * 以及生存期"回家整理"的那段插曲（用户口径："可以自由回去，并且做出操作也会有影响"）。
 * 两边共用同一个组件、同一套命令，差别只在 dock：
 *
 *  · 囤货期 → 「再去采购 / 过一天」，**有**「加家具」；
 *  · 生存期 → 「回日报」，**没有**「加家具」（用户明确要求闭合这个入口）。
 *
 * 而"没有加家具"这件事**坏了不会报错** —— 它坏了的表现是玩家在生存期
 * 能花 100 块搬一块货架进来，那既不是崩溃也不是红字，只是口径被悄悄改掉了。
 * 所以它必须有一条渲染断言钉住。
 *
 * ## 这一份验的是"接线"，不是规则
 *
 * 命令那一侧（AP 花掉、不够时拒绝、`isSurvivalOrganize` 的判据）在
 * `systems/phases.test.ts` 里验。这里只验**这一屏真的按那个判据变了形状**：
 * 判据算对了但界面没读它，是同一个 bug 的另一半。
 */
import { describe, expect, it } from 'vitest';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { createOrganizeSession } from '../systems/organize';
import { GO_HOME_AP_COST } from '../systems/phases';
import { createStartingRun } from '../systems/setup';
import { OrganizeScreen } from './OrganizeScreen';
import { __resetGesturesForTest } from './drag';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function saveStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

interface Ctx {
  store: GameStore;
  root: FakeElement;
  screen: OrganizeScreen;
  /** 点一下某个 `data-action`。假体的 dispatch 不冒泡，所以从 root 派发并指 target */
  click(action: string): void;
}

/**
 * 挂一屏整理页。
 *
 * `phase` / `day` 就是这一份要区分的那两个输入 —— 它们正是 `isSurvivalOrganize`
 * 的判据（`phase === 'organize' && day >= 0`）。
 */
function mount(opts: { phase: 'stockpile_shop' | 'survival_day' | 'organize'; day: number }): Ctx {
  __resetGesturesForTest();
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  root.place(0, 0, 1000, 900);
  const store = new GameStore(createSaveGame(createStartingRun(20261001)), saveStub());
  store.run.phase = opts.phase;
  store.run.day = opts.day;
  store.run.actionPoints = 3;
  const screen = new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined,
    onBackToSurvival: () => undefined
  });
  screen.mount();
  return {
    store,
    root,
    screen,
    click(action) {
      const btn = root.querySelectorAll(`[data-action="${action}"]`)[0];
      if (!btn) throw new Error(`dock 里没有 ${action}`);
      root.dispatch('click', { target: btn });
    }
  };
}

/** 囤货期的整理页（`phase` 是 `organize`、日历还在负数那一段） */
function stockpile(): Ctx {
  return mount({ phase: 'organize', day: -3 });
}
/** 生存期那次整理（`phase` 也是 `organize`，但这一天已经跨过去了） */
function survivalTrip(): Ctx {
  return mount({ phase: 'organize', day: 4 });
}

describe('★★ 整理页的两种形状（W-09 决策 B）', () => {
  it('★★ 生存期**不渲染**「加家具」，囤货期照常渲染', () => {
    expect(stockpile().root.querySelectorAll('[data-add-furniture]'), '囤货期该有').toHaveLength(1);
    /*
     * ★ 断言的是"那个 host 节点不存在"，不是"按钮被 disable" ——
     * 用户的口径是**闭合这个入口**（"不要花现金加家具"），
     * 而一个灰按钮仍然在说"这件事存在，只是条件没满足"。
     */
    expect(survivalTrip().root.querySelectorAll('[data-add-furniture]'), '生存期该没有').toHaveLength(0);
  });

  it('★ 生存期那一屏里一个"加家具"的字样都不许有', () => {
    const ctx = survivalTrip();
    // 反证点：把 `alt: addFurnitureHtml` 里那句 `isSurvivalOrganize` 判断去掉，这条会红
    expect(ctx.root.innerHTML).not.toContain('加家具');
    expect(ctx.root.innerHTML).not.toContain('toggle-add');
  });

  it('★ 生存期给的是「回日报」，不是「再去采购 / 过一天」', () => {
    const ctx = survivalTrip();
    expect(ctx.root.querySelectorAll('[data-action="back-survival"]')).toHaveLength(1);
    expect(ctx.root.querySelectorAll('[data-action="go-out"]'), '生存期商店是关的').toHaveLength(0);
    expect(ctx.root.querySelectorAll('[data-action="end-day"]'), '跨天只能在日报那一屏做').toHaveLength(0);
  });

  it('★ 囤货期的形状一字未动：两个按钮都在，没有「回日报」', () => {
    const ctx = stockpile();
    expect(ctx.root.querySelectorAll('[data-action="go-out"]')).toHaveLength(1);
    expect(ctx.root.querySelectorAll('[data-action="end-day"]')).toHaveLength(1);
    expect(ctx.root.querySelectorAll('[data-action="back-survival"]')).toHaveLength(0);
  });

  it('★ 点「回日报」调的是 onBackToSurvival 那一条路', () => {
    __resetGesturesForTest();
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    root.place(0, 0, 1000, 900);
    const store = new GameStore(createSaveGame(createStartingRun(20261001)), saveStub());
    store.run.phase = 'organize';
    store.run.day = 4;
    let calls = 0;
    const screen = new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
      onRestart: () => undefined,
      onGoOut: () => undefined,
      onEndDay: () => undefined,
      onBackToSurvival: () => {
        calls += 1;
      }
    });
    screen.mount();
    root.dispatch('click', { target: root.querySelectorAll('[data-action="back-survival"]')[0] });
    expect(calls).toBe(1);
  });

  it('★ D-Day 当天（day === 0）就已经是生存期的形状了', () => {
    /*
     * `isSurvivalOrganize` 用的是 `day >= 0` 而不是 `day >= 1`：
     * D-Day 那天灾难刚登陆、第一顿还没吃，但玩家已经站在生存期里了。
     * 判据写成 `>= 1` 的话，那一屏会掉回囤货期的形状 ——
     * dock 里冒出「再去采购」，而商店在生存期是关的。
     */
    const ctx = mount({ phase: 'organize', day: 0 });
    expect(ctx.root.querySelectorAll('[data-add-furniture]')).toHaveLength(0);
    expect(ctx.root.querySelectorAll('[data-action="back-survival"]')).toHaveLength(1);
  });

  it('★ 生存期回去整理这一屏，行动点的数还是账上那个（界面不该自己造一个）', () => {
    const ctx = survivalTrip();
    ctx.store.run.actionPoints = GO_HOME_AP_COST - 1;
    ctx.screen.render();
    /*
     * 这一条是"界面别自己算行动点"的守卫：整理页里唯一读 AP 的地方是
     * "再去采购"那个按钮的可用性，而生存期它根本不渲染。
     * 所以这里断言的是**这一屏没有偷偷把 AP 改掉** ——
     * 改掉的话，回日报之后"今天还能回去几次"会与日报上写的对不上。
     */
    expect(ctx.store.run.actionPoints).toBe(GO_HOME_AP_COST - 1);
  });
});

/*
 * ★★ 纸箱那一栏能折叠（2026-10 玩家要求）。
 *
 * ## 玩家原话与它真正要解决的问题
 *
 * > "让下面那个箱子的一栏可以被折叠展开"
 *
 * 他给的是做法，问题是**手机上一屏装不下**："顶栏 + 纸箱栏 + 三块货架 + 工具条"，
 * 而工具条（dock）是固定的、不随内容滚 —— 被它吃掉的高度**没有任何办法找回来**。
 * 所以折叠的意义不是"界面更干净"，而是**把高度还给 `.room-scroll`**：
 * 折起来之后玩家能看到下面那块货架。
 *
 * ## 为什么要有守卫
 *
 * 这件事坏掉的形状是"点了一下没反应"—— 不报错、不红字，只是那个按钮
 * 永远停在同一个状态。而它有两个各自独立、都能单独坏掉的一半：
 *  ① `boxesOpen` 那个开关有没有被点击翻转（`case 'toggle-boxes'` 在不在）；
 *  ② 翻转之后**那一栏的 HTML 有没有跟着换**（`boxHost.innerHTML` 那一次赋值）。
 * 只验①的话，一个"翻转了但没重画"的实现照样全绿。所以两条分开写。
 */
describe('★★ 纸箱那一栏能折叠（玩家要求，2026-10）', () => {
  it('默认是展开的 —— 拆箱是整理页最常做的事', () => {
    const ctx = stockpile();
    expect(ctx.root.querySelectorAll('[data-action="toggle-boxes"]')).toHaveLength(1);
    // 展开态给的是"收起"这个出口，而且箱子本身那一段标题在
    expect(ctx.root.innerHTML).toContain('还没拆的箱子');
    expect(ctx.root.innerHTML).toContain('收起');
  });

  it('★ 点一下变成折起来的摘要（并且给出"展开"这个出口）', () => {
    const ctx = stockpile();
    ctx.click('toggle-boxes');
    // ② 那一栏真的换了：标题没了，摘要来了
    expect(ctx.root.innerHTML).not.toContain('还没拆的箱子');
    expect(ctx.root.innerHTML).toContain('纸箱');
    expect(ctx.root.innerHTML).toContain('展开');
    // 而且那个按钮还在（否则就再也展不开了 —— 一个单向的门）
    expect(ctx.root.querySelectorAll('[data-action="toggle-boxes"]')).toHaveLength(1);
  });

  it('★ 再点一下能展开回来（可逆，不是单向的门）', () => {
    const ctx = stockpile();
    ctx.click('toggle-boxes');
    ctx.click('toggle-boxes');
    expect(ctx.root.innerHTML).toContain('还没拆的箱子');
    expect(ctx.root.innerHTML).toContain('收起');
  });

  it('★★ 折起来时那一栏的高度**真的还回去了**（挂了 is-folded 这个类）', () => {
    /*
     * 这才是折叠的全部意义（见上面那段"玩家原话"）。
     * `is-folded` 是 `style.css` 里唯一一处把 `.dock-boxes` 的
     * `max-height` / `overflow` 解除掉的地方 —— 少了这个类，
     * 屏幕上会显示摘要，但那一栏仍然占着原来那么高，"折叠"等于白折。
     */
    const ctx = stockpile();
    const host = ctx.root.querySelectorAll('[data-boxes]')[0];
    expect(host, '找不到纸箱那一栏的 host（data-boxes）').toBeDefined();
    expect(host!.classList.contains('is-folded')).toBe(false);
    ctx.click('toggle-boxes');
    expect(ctx.root.querySelectorAll('[data-boxes]')[0]!.classList.contains('is-folded')).toBe(true);
  });

  it('★ 折叠状态不许偷偷进存档（它是一次会话里的事）', () => {
    /*
     * 与 `addOpen`（加家具那个展开）同一条纪律：界面长什么样**不是存档的一部分**。
     * 它坏掉的表现很隐蔽 —— 玩家折起箱子、关掉页面、明天回来发现
     * 箱子还是折着的，而他完全不记得自己折过。
     */
    const ctx = stockpile();
    const before = JSON.stringify(ctx.store.run);
    ctx.click('toggle-boxes');
    expect(JSON.stringify(ctx.store.run)).toBe(before);
  });
});
