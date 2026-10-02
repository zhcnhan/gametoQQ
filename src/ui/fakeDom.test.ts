/**
 * 假 DOM 的自检。
 *
 * 它是屏幕级测试的地基 —— 地基错一点点，上面的断言就全在验错的东西。
 * 所以这里单独把"解析 HTML / 命中测试 / closest / 定时器"这几件事钉住。
 */
import { describe, expect, it } from 'vitest';
import { FakeDocument, installFakeWindow } from './fakeDom';

describe('假 DOM 自检', () => {
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
