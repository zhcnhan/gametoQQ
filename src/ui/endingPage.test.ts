/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「最后一页」的守卫（`ui/endingPage.ts`）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 这一组拦的是什么
 *
 * 这一页只有三样东西可能悄悄坏掉，而**三样都不会报错**：
 *
 *  ① **格子数**：活到最后必须是整张（14 天）；没撑住必须**只印到停下的前一天**。
 *     少印一天，玩家读到的是"我少活了一天"；多印一天，读到的是"我活到了我并没活到的那天"。
 *     这一页全部的意思是"你活到了哪儿"，所以格数是它唯一的事实。
 *  ② **同一份存档必须画出同一张日历**。刻痕是"那一天有多难"的视觉，
 *     而一旦它每次刷新都变，"这一页是这一局留下的"这层意思当场就没了 ——
 *     所以那三句"随机的"必须钉住（同一个 `(seed, day)` 永远是同一个高度）。
 *  ③ **撕口与账对得上**：短过口粮的天数决定撕几格，撕口在**末尾**。
 *     这一条对应的产品判断是"越到后面越撑不住"——
 *     随机挑几天来撕的话，视觉说的就是另一件事。
 */
import { describe, expect, it } from 'vitest';
import { SURVIVAL_DAYS } from '../data/disaster';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';
import { endingPageHtml, endingPageOf } from './endingPage';

function mountHtml(html: string): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  asElement(root).innerHTML = html;
  return root;
}

describe('★ 格数就是"你活到了哪儿"', () => {
  it('★ 活到最后：整张十四天，一格不少', () => {
    const page = endingPageOf(true, SURVIVAL_DAYS, 0, 20261007);
    expect(page.printed).toBe(SURVIVAL_DAYS);
    expect(page.day).toHaveLength(SURVIVAL_DAYS);
  });

  it('★★ 没撑住：只印到停下的**前**一天（第 3 天停下 → 印 2 格）', () => {
    expect(endingPageOf(false, 3, 0, 1).printed).toBe(2);
    expect(endingPageOf(false, 1, 0, 1).printed).toBe(0);
  });

  it('★★ 没印出来的那些天是**留白**，不是灰格子（"没做好"与"不存在"不是一件事）', () => {
    const root = mountHtml(endingPageHtml(endingPageOf(false, 5, 0, 7)));
    const cal = root.querySelectorAll('.ending-calendar')[0];
    expect(cal?.attributes?.['data-printed']).toBe('4');
    expect(cal?.attributes?.['data-blank']).toBe(String(SURVIVAL_DAYS - 4));
    // 印出来的格子只有 4 个 —— 一条"没活到的日子"的痕迹都不该有
    expect(root.querySelectorAll('.ending-day')).toHaveLength(4);
  });

  it('★ 第一天就停下：一张白纸（这不是 bug，这一局的 `printed` 就是 0）', () => {
    const page = endingPageOf(false, 1, 0, 3);
    expect(page.printed).toBe(0);
    expect(page.day).toHaveLength(0);
    expect(mountHtml(endingPageHtml(page)).querySelectorAll('.ending-day')).toHaveLength(0);
  });

  it('★ 手改过的档也不许印出超过十四天的格子', () => {
    expect(endingPageOf(false, 99, 0, 1).printed).toBe(SURVIVAL_DAYS);
    expect(endingPageOf(true, 99, 0, 1).day).toHaveLength(SURVIVAL_DAYS);
  });
});

describe('★★ 同一个存档画出同一张日历（"这是这一局留下的"全靠这一条）', () => {
  it('★ 同样的参数算两次，逐格完全一样', () => {
    const a = endingPageOf(false, 9, 3, 20261007);
    const b = endingPageOf(false, 9, 3, 20261007);
    expect(a.day).toEqual(b.day);
    expect(a.head).toBe(b.head);
    expect(a.note).toBe(b.note);
  });

  it('★ 换一个种子，刻痕会变（不然它就不是这一局的日历了）', () => {
    const a = endingPageOf(true, SURVIVAL_DAYS, 0, 1).day.map((d) => d.tick);
    const b = endingPageOf(true, SURVIVAL_DAYS, 0, 2).day.map((d) => d.tick);
    expect(a).not.toEqual(b);
  });

  it('★ 刻痕永远落在 0.34..1（CSS 拿它当高度比，越界会撑破那一格）', () => {
    for (const seed of [0, 1, 20261007, 4294967295]) {
      for (const d of endingPageOf(true, SURVIVAL_DAYS, 0, seed).day) {
        expect(d.tick).toBeGreaterThanOrEqual(0.34);
        expect(d.tick).toBeLessThanOrEqual(1);
      }
    }
  });

  it('★ 画出来的 `--tick` 与算出来的那个数一致（界面不许自己再算一遍）', () => {
    const page = endingPageOf(false, 9, 2, 20261007);
    const root = mountHtml(endingPageHtml(page));
    const cells = root.querySelectorAll('.ending-day');
    page.day.forEach((d, i) => {
      expect(cells[i]?.attributes?.['style']).toContain(`--tick:${d.tick.toFixed(3)}`);
    });
  });
});

describe('★ 撕口说的是"越到后面越撑不住"', () => {
  it('★★ 撕开的格子数跟着"短过口粮的天数"走，而且都在末尾', () => {
    /*
     * ⚠ 判据刻意写成"**末尾连续、数量对得上**"，而不是某个写死的列表：
     * 第一版写的是 `expect(torn).toEqual([6, 7, 8])`，而 `printed = 9` 时
     * 末尾三格本来就是 7/8/9 —— 我那个期望值是自己算错的。
     * 这一页要守的性质只有两条：**数量**（= 短过口粮的天数）与**位置**（在末尾）。
     */
    const page = endingPageOf(false, 10, 3, 5); // printed = 9
    const torn = page.day.filter((d) => d.torn).map((d) => d.day);
    expect(torn).toHaveLength(3);
    expect(torn).toEqual(page.day.slice(-3).map((d) => d.day));
  });

  it('★ 一次都没短过：一格都不撕（"没撕"与"撕了 0 格"在画面上是同一件事，在判据上不是）', () => {
    const page = endingPageOf(true, SURVIVAL_DAYS, 0, 5);
    expect(page.day.some((d) => d.torn)).toBe(false);
  });

  it('★ 短得再多也只撕六格（撕光了就读不出"写过的天数还在"）', () => {
    const page = endingPageOf(false, 14, 99, 5);
    expect(page.day.filter((d) => d.torn)).toHaveLength(6);
  });

  it('★ 撕口在 HTML 里真的成了 `is-torn`（算出来了但没画，等于没做）', () => {
    const root = mountHtml(endingPageHtml(endingPageOf(false, 10, 3, 5)));
    expect(root.querySelectorAll('.ending-day.is-torn')).toHaveLength(3);
  });
});

describe('★ 三句话按结局换', () => {
  it('★ 生还与没撑住说的不是同一句话（三种结局各有各的说法）', () => {
    const survived = endingPageOf(true, SURVIVAL_DAYS, 0, 1);
    const stopped = endingPageOf(false, 5, 0, 1);
    const firstDay = endingPageOf(false, 1, 0, 1);
    const heads = [survived.head, stopped.head, firstDay.head];
    expect(new Set(heads).size, '三种结局说了同一句话').toBe(3);
    expect(survived.note).not.toBe(stopped.note);
    expect(mountHtml(endingPageHtml(firstDay)).querySelectorAll('.ending-day')).toHaveLength(0);
  });

  it('★★ 那一页不重复"这一局的读数"（撑过几天 / 缺过几件上面几段已经说过了）', () => {
    /*
     * §10.1A 欠账①：只改数字的机制必须同时有非数字表达 ——
     * 而"非数字表达"**不等于把数字再抄一遍**。
     *
     * ⚠ 这里刻意**不查**裸数字：这一页的两句话里有一句必须说"写过的 N 天都还在"
     * 才是人话（第一版把那条也当成了"重复读数"，把一句正常的话判成了错）。
     * 所以查的是**上面那几段用过的那几个计数词**，不是数字本身。
     */
    const text = allText(mountHtml(endingPageHtml(endingPageOf(false, 10, 3, 5))));
    expect(text).not.toContain('撑过');
    expect(text).not.toContain('硬撑');
    expect(text).not.toContain('缺过');
    expect(text).not.toContain('件');
  });
});
