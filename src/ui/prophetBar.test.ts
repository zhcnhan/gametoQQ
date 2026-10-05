/**
 * ★★ 「大先知」那一条（D-33 / 决策 E 的第 ① ② 层）
 *
 * ## 它守的是哪两笔账
 *
 * 用户在 2026-10 说：
 *
 * > "日历的先知作用挪到最上面去，毕竟我们可是有优越感的大先知，
 * >  能预支灾难的！也让他更显眼一点，能介绍更多"
 *
 * 而在这之前，`DisasterProfile.calendar`（每场 22 条 `{ day, severity, hint }`）
 * **只在开局页出现过一次** —— 选完身份就再也见不到了，而"能预支灾难"
 * 的价值恰恰在后面那 7 天（按日历排采购）。这与 `windowScene` 是同一类错：
 * **数据早就在表里，一个渲染读点都没有**。
 *
 * 所以这一组问四件事：
 *  ① 那一行**说得出这一场、今天是第几天**（不是写死的"寒潮"）；
 *  ② 倒计时**按日历算**，"哪几天最难"只在**点开之后**（§6.1：日历是规划乐趣）；
 *  ③ 换一场 / 换一天，那一行**真的不一样**（"让我有感知"的判据）；
 *  ④ 展开 / 收起真的把 `hidden` 与 `aria-expanded` 一起翻了
 *    （两个属性分家的表现是"看起来开着、读屏说关着"，而屏幕上没有异常）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getDisasterDef } from '../data/disaster';
import { CATEGORY_LABELS } from '../data/items';
import { severityAt } from '../model/calendar';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';
import { countdownLabel, prophetBarHtml, prophetDetailHtml, prophetViewOf, toggleProphet } from './prophetBar';

afterEach(() => {
  installFakeWindow(new FakeDocument());
});

/** 把一段产品代码生成的 HTML 挂进一棵假体树（屏幕级测试里那些屏也是这么做的） */
function mountHtml(html: string): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  asElement(root).innerHTML = html;
  return root;
}

function barAt(disasterId: string, day: number | null): FakeElement {
  return mountHtml(prophetBarHtml(disasterId, day));
}

describe('★★ 先知栏：那一行说得出"这一场 + 今天"', () => {
  it('★ 念的是**这一场**的名字，不是写死的寒潮', () => {
    expect(allText(barAt('cold_snap', -3))).toContain('寒潮');
    expect(allText(barAt('heat_wave', -3))).toContain('热浪');
    const flood = allText(barAt('flood_urban', -3));
    expect(flood).toContain('洪水');
    expect(flood, '三场里混进了别的名字').not.toContain('寒潮');
  });

  it('★★ 倒计时按日历算：D-7 → "还有 7 天"，D-3 → "还有 3 天"，过了那天不报天数', () => {
    const week = barAt('cold_snap', -7).querySelectorAll('.run-bar-days')[0];
    expect(week?.textContent).toBe('还有 7 天');
    // `data-days` 是**算好的那个数**：CSS 用它、测试也读它（不许两处各算一遍）
    expect(week?.attributes?.['data-days']).toBe('-7');

    expect(barAt('cold_snap', -3).querySelectorAll('.run-bar-days')[0]?.textContent).toBe('还有 3 天');
    expect(barAt('cold_snap', 0).querySelectorAll('.run-bar-days')[0]?.textContent).toBe('D-Day');
    expect(barAt('cold_snap', 4).querySelectorAll('.run-bar-days')[0]?.textContent).toBe('已经在里面了');
  });

  it('★ 强度写的是**那一天**的值（不是 D-Day 的峰值），而那条测量线是**还剩多少**', () => {
    const disaster = getDisasterDef('cold_snap');
    const late = barAt('cold_snap', -2).querySelectorAll('.run-bar')[0];
    const expected = Math.round(severityAt(disaster, -2) * 100);
    expect(allText(late)).toContain(`强度 ${expected}`);

    // 还剩 2 天 → 2/7 ≈ 0.286（★ 这条线是**倒着走**的：满格 = 刚开局、见底 = D-Day）
    expect(late?.attributes?.['style']).toContain('--remain:0.286');
    expect(barAt('cold_snap', -7).querySelectorAll('.run-bar')[0]?.attributes?.['style']).toContain(
      '--remain:1.000'
    );
    // D-Day 见底；生存期也是 0（"离那天还有多远"这件事已经问完了）
    expect(barAt('cold_snap', 0).querySelectorAll('.run-bar')[0]?.attributes?.['style']).toContain(
      '--remain:0.000'
    );
    expect(barAt('cold_snap', 3).querySelectorAll('.run-bar')[0]?.attributes?.['style']).toContain(
      '--remain:0.000'
    );
  });

  it('★★ 换一天 / 换一场，那一行**真的不一样**（这就是"让我有感知"的判据）', () => {
    const week = allText(barAt('cold_snap', -7));
    const eve = allText(barAt('cold_snap', -1));
    expect(week, '第七天与前一天读起来一样').not.toBe(eve);
    expect(allText(barAt('flood_urban', -7))).not.toBe(week);
  });

  it('★★ "这一场最要紧的两类"在**常驻那一行**就看得见（用户要的"能介绍更多"）', () => {
    const disaster = getDisasterDef('flood_urban');
    const text = allText(barAt('flood_urban', -3));
    for (const category of disaster.priorityCategories) {
      expect(text, `先知栏没念出「${CATEGORY_LABELS[category]}」`).toContain(CATEGORY_LABELS[category]);
    }
  });

  it('★ 手里没有 `run` 的那两屏（开局页 / 兜底页）**不写倒计时**，但其余照旧', () => {
    const text = allText(barAt('cold_snap', null));
    expect(text, '没有 day 时编了一个天数').not.toContain('还有');
    expect(text, '没有 day 时连名字都没了').toContain('寒潮');
    // 而且它仍然要有强度与展开按钮 —— 先知栏在开局页也成立
    expect(text).toContain('强度');
    expect(allText(barAt('cold_snap', null))).toContain('先知日历');
    expect(countdownLabel(0)).toBe('D-Day');
  });
});

describe('★★ 逐日"哪几天最难"：只在点开之后（§6.1 日历是规划乐趣）', () => {
  it('★★ 常驻那一行**不许**剧透逐日文案 —— 要问才给', () => {
    const disaster = getDisasterDef('cold_snap');
    const barText = allText(barAt('cold_snap', -3));
    for (const forecast of disaster.calendar) {
      if (!forecast.hint) continue;
      expect(barText, `常驻那一行把「${forecast.hint}」贴在脸上了`).not.toContain(forecast.hint);
    }
  });

  it('★★ 展开层里 22 天一天不少，今天那行标出来，强度 ≥ 75 的标成"难"', () => {
    const disaster = getDisasterDef('cold_snap');
    const root = mountHtml(prophetDetailHtml('cold_snap', -3));
    const rows = root.querySelectorAll('.prophet-day');
    expect(rows.length).toBe(disaster.calendar.length);
    expect(rows.length).toBe(22);

    // 逐日文案全在（这就是"能介绍更多"的那一列）
    const text = allText(root);
    for (const forecast of disaster.calendar) {
      expect(text, `展开层缺了 ${forecast.day} 那天的文案`).toContain(forecast.hint);
    }

    const today = rows.filter((r) => r.classList.contains('is-today'));
    expect(today.length, '今天那一行没标出来（或者标了两行）').toBe(1);
    expect(today[0]?.textContent).toContain('D-3');

    // `is-hard` 的数量必须与数据对得上 —— 手写阈值会漂，这里逐行对账
    const hard = rows.filter((r) => r.classList.contains('is-hard')).length;
    expect(hard).toBe(disaster.calendar.filter((f) => f.severity >= 0.75).length);
    expect(hard, '这一场一天的强度都没到 75，用例失去了意义').toBeGreaterThan(0);
  });

  it('★ 默认是收着的（`hidden`），而且它自己的类名/属性找得到（不给按钮留 id 字符串）', () => {
    const root = mountHtml(prophetDetailHtml('cold_snap', -3));
    const detail = root.querySelectorAll('.prophet-detail')[0];
    expect(detail?.attributes?.['data-prophet']).toBe('detail');
    expect(detail?.getAttribute('hidden'), '展开层默认就摊开了').toBe('');

    const bar = barAt('cold_snap', -3).querySelectorAll('[data-action="prophet"]')[0];
    expect(bar?.attributes?.['aria-expanded'], '初始就该是收着的').toBe('false');
  });
});

describe('★★ 展开 / 收起：`hidden` 与 `aria-expanded` 必须一起翻', () => {
  /** 两段 HTML 拼成一个屏内布局（`windowBandHtml` 里就是这么拼的） */
  function mountPanel(disasterId: string, day: number): FakeElement {
    return mountHtml(prophetBarHtml(disasterId, day) + prophetDetailHtml(disasterId, day));
  }

  it('★★ 点两下回到原样，中间那一下两个属性一起翻', () => {
    const root = mountPanel('cold_snap', -3);
    const detail = (): string | null => root.querySelectorAll('.prophet-detail')[0]?.getAttribute('hidden') ?? null;
    const toggle = (): FakeElement | undefined => root.querySelectorAll('[data-action="prophet"]')[0];

    expect(detail()).toBe(''); // 收着
    toggleProphet(asElement(root));
    expect(detail(), '点了之后没展开').toBeNull();
    expect(toggle()?.attributes?.['aria-expanded']).toBe('true');
    expect(toggle()?.classList.contains('is-open')).toBe(true);

    toggleProphet(asElement(root));
    expect(detail()).toBe('');
    expect(toggle()?.attributes?.['aria-expanded']).toBe('false');
    expect(toggle()?.classList.contains('is-open')).toBe(false);
  });

  it('★ 找不到展开层时**不抛异常**（兜底页也可能被人拼错）', () => {
    const root = mountHtml('<div class="run-bar"></div>');
    expect(() => toggleProphet(asElement(root))).not.toThrow();
  });
});

describe('★ 口径：算一次就够（两处各算一遍的那种错）', () => {
  it('★★ `prophetViewOf` 报的剩余量与倒计时，与写进 HTML 的是同一份', () => {
    for (const day of [-7, -4, -1, 0, 3, 9]) {
      const view = prophetViewOf('cold_snap', day);
      const root = barAt('cold_snap', day);
      const style = root.querySelectorAll('.run-bar')[0]?.attributes?.['style'] ?? '';
      expect(style, `第 ${day} 天的剩余量与视图对不上`).toContain(`--remain:${view.remain.toFixed(3)}`);
      const days = root.querySelectorAll('.run-bar-days')[0];
      if (view.countdown) expect(days?.textContent).toBe(view.countdown.label);
    }
  });

  it('★ 剩余量永远落在 0..1（手改过的档也不许给出越界的 `--remain`）', () => {
    expect(prophetViewOf('cold_snap', -30).remain).toBe(1);
    expect(prophetViewOf('cold_snap', 99).remain).toBe(0);
    expect(prophetViewOf('cold_snap', null).remain).toBe(0);
  });

  it('★ 认不出的灾难 id 会当场炸（不静默给一场假的）', () => {
    expect(() => prophetViewOf('not_a_disaster', -3)).toThrow();
  });
});
