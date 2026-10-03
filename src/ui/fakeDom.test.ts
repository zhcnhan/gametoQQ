/**
 * 假 DOM 的自检。
 *
 * 它是屏幕级测试的地基 —— 地基错一点点，上面的断言就全在验错的东西。
 * 所以这里单独把"解析 HTML / 命中测试 / closest / 定时器"这几件事钉住。
 */
import { describe, expect, it } from 'vitest';
import { FakeDocument, installFakeWindow } from './fakeDom';

describe('假 DOM 自检', () => {
  it('★★ 逗号选择器是"或"，不是"与"（`closest("[data-page], [data-action]")` 必须命中）', () => {
    /*
     * ## 这条守的是一个**静默**的真 bug（M3 补图鉴界面时才发现）
     *
     * `parseSelector` 把 `[data-page], [data-action]` 拆成两个片段，
     * 而 `querySelectorAll` / `closest` 用 `every` 要求**全部命中** ——
     * 于是那串选择器要求元素**同时**有这两个属性，一个都匹配不到。
     *
     * 后果不是"选择器严格"，而是**事件委托整体失灵**：界面里
     * `target.closest('[data-page], [data-action]')` 永远返回 null，
     * 图鉴翻页与「返回」都点不动 —— 而**假体不报错**，测试只会看到
     * "点了没反应"，很容易被误判成界面写错了。
     *
     * CSS 里逗号是"或"（选择器列表）。真实浏览器与这里必须一致，
     * 否则屏幕级测试会替真实浏览器做出错误的判断。
     */
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    host.innerHTML =
      '<button class="tab" data-page="items"></button>' +
      '<button class="close" data-action="close"></button>' +
      '<button class="neither"></button>';

    // querySelectorAll：两组各自命中
    const hit = host.querySelectorAll('[data-page], [data-action]');
    expect(hit).toHaveLength(2);

    // closest：从叶子往上找，任一组命中即算命中
    const page = host.querySelector('[data-page="items"]');
    const close = host.querySelector('[data-action="close"]');
    const neither = host.querySelector('.neither');
    expect(page?.closest('[data-page], [data-action]')).toBe(page);
    expect(close?.closest('[data-page], [data-action]')).toBe(close);
    expect(neither?.closest('[data-page], [data-action]')).toBeNull();
  });

  it('解析 innerHTML：标签、有值属性、无值属性、类名、嵌套', () => {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    host.innerHTML =
      '<section class="shelf-card" data-shelf-card="shelf_a" style="--zone:red">' +
      '<button class="slot is-empty" data-slot data-shelf="shelf_a" data-row="0" data-col="1"></button>' +
      '<button class="slot" data-slot data-shelf="shelf_a" data-row="1" data-col="0"><span class="slot-count">×3</span></button>' +
      '</section>';

    const card = host.querySelector('[data-shelf-card]');
    expect(card).not.toBeNull();
    expect(card?.dataset['shelfCard']).toBe('shelf_a');
    expect(card?.classList.contains('shelf-card')).toBe(true);

    const slots = host.querySelectorAll('[data-slot]');
    expect(slots).toHaveLength(2);
    expect(slots[0]?.dataset['row']).toBe('0');
    expect(slots[0]?.dataset['col']).toBe('1');
    expect(slots[0]?.classList.contains('is-empty')).toBe(true);
    expect(slots[1]?.classList.contains('is-empty')).toBe(false);
    // 嵌套的子元素也进了索引（按属性找得到）
    expect(slots[1]?.querySelector('.slot-count')?.textContent).toBe('×3');
    // closest 能从子元素找到祖先
    expect(slots[1]?.querySelector('.slot-count')?.closest('[data-slot]')).toBe(slots[1]);
  });

  it('只会命中带 `[data-slot][data-shelf="x"]` 那些格子（组合选择器）', () => {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    host.innerHTML =
      '<button class="slot" data-slot data-shelf="shelf_a" data-row="0" data-col="0"></button>' +
      '<button class="slot" data-slot data-shelf="shelf_b" data-row="0" data-col="0"></button>';
    expect(host.querySelectorAll('[data-slot][data-shelf="shelf_a"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-slot][data-shelf="shelf_b"]')).toHaveLength(1);
  });

  it('★ 重新赋值 innerHTML 之后，旧元素不能再被查到（否则绑到"幽灵元素"上）', () => {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    host.innerHTML = '<button class="slot" data-slot data-shelf="shelf_a" data-row="0" data-col="0"></button>';
    const first = host.querySelector('[data-slot]');
    host.innerHTML = '<button class="slot" data-slot data-shelf="shelf_a" data-row="0" data-col="0"></button>';
    const second = host.querySelector('[data-slot]');
    expect(second).not.toBe(first);
    // 旧元素已经不在文档索引里了（`querySelectorAll` 不该再返回它）
    expect(doc.querySelectorAll('[data-slot]')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-slot]')[0]).toBe(second);
  });

  it('elementFromPoint：取含该点的**最深**元素（格子优于货架卡）', () => {
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const card = doc.createElement('section');
    doc.body.appendChild(card);
    card.place(0, 0, 300, 100);
    card.innerHTML = '<button class="slot" data-slot data-shelf="shelf_a" data-row="0" data-col="0"></button>';
    const slot = card.querySelector('[data-slot]');
    slot?.place(10, 10, 60, 60);

    expect(doc.elementFromPoint(40, 40)).toBe(slot);
    // 卡片留白处：命中的是卡片本身，没有格子
    expect(doc.elementFromPoint(250, 50)).toBe(card);
    // 完全在外的点
    expect(doc.elementFromPoint(500, 500)).toBeNull();
  });

  it('★ 命中测试尊重 pointer-events：祖先设 none → 整棵子树都不吃事件', () => {
    /*
     * 这一条模拟的正是玩家报的"把 A 正正好好放在 B 上反而判定不到"：
     * 拖拽幽灵跟着指针、正好在指针底下，而 `elementFromPoint` 命中的是最上层元素。
     * `.fx-layer` 本来是 `pointer-events: none`，但**一条针对 `.drag-ghost` 自身的
     * 规则会覆盖继承**，于是幽灵变成可命中、把底下的格子挡住了。
     */
    const doc = new FakeDocument();
    installFakeWindow(doc);
    const layer = doc.createElement('div');
    layer.pointerEvents = 'none';
    doc.body.appendChild(layer);
    const ghost = doc.createElement('div');
    ghost.pointerEvents = 'none'; // ← 幽灵自己也不吃（CSS 里已补上这一条）
    layer.appendChild(ghost);
    ghost.place(100, 100, 60, 60);

    // 幽灵底下有个"格子"
    const slot = doc.createElement('button');
    slot.classList.add('slot');
    doc.body.appendChild(slot);
    slot.place(100, 100, 60, 60);

    expect(doc.elementFromPoint(130, 130), '不可命中的幽灵不该挡住底下的格子').toBe(slot);

    /*
     * 反向：把幽灵改成可命中。
     *
     * 注意此时命中的**仍然是 slot** —— 因为假体的平局判定近似"深度优先、后者胜"，
     * 而 slot 是 body 的子树、比 layer 深一层，所以它仍然胜出。
     * 真实浏览器这里会由 z-index / 绘制顺序决定（幽灵在上层）。
     *
     * 所以这条反向断言**不验"谁盖住谁"**（假体在这一点上不可靠，我不装它能），
     * 只验**可命中性本身**：幽灵变成 auto 之后，它自己**是**一个可命中元素 ——
     * 这正是那个 bug 的开关。谁盖住谁留给真浏览器。
     */
    ghost.pointerEvents = 'auto';
    expect(doc.pointerEventsOf(ghost), '改成 auto 之后幽灵自己就变成可命中的了').toBe('auto');
    ghost.pointerEvents = 'none';
    expect(doc.pointerEventsOf(ghost)).toBe('none');
  });

  it('可控时钟：tick 同时推进定时器与 Date.now()', () => {
    const doc = new FakeDocument();
    const win = installFakeWindow(doc);
    const before = Date.now();
    let fired = false;
    win.setTimeout(() => {
      fired = true;
    }, 500);
    win.tick(400);
    expect(fired).toBe(false);
    win.tick(200);
    expect(fired).toBe(true);
    expect(Date.now() - before).toBe(600);
  });
});
