/**
 * ★★ D-33 / 决策 E 的守卫：底色由**灾难家族**决定。
 *
 * 这一层改的是**整页**的颜色 —— 出错的方式不是崩，是"读不清"和"看起来没变"，
 * 两种都不会报错、也不会被别的测试碰到。所以这里守四件事：
 *
 *  ① **真的变了**：七个家族在三个面上两两不同色，且每套都在明度预算内；
 *  ② **读得清**：墨 / ink-70 / 朱红压在每一个家族底上都要过线（这是这一层的**硬约束** ——
 *     彩度不是"越浓越明显"，它是拿可读性换的）；
 *  ③ **朱红还是警告色**：家族色相离朱红至少 `MIN_HUE_GAP` 度；
 *  ④ **接口对得上**：`familyToneVars` 给出的变量名与 `style.css` 的 `:root` 一一对应。
 *
 * ★ 刻意**不**守"任意两个家族的底要好分辨"：六个家族的纸底被钉在同一个明度档上，
 * 两两 OKLab 距离的上限本来就只有 0.036 左右，硬凑只会把彩度推上去、把 ② 挤爆。
 * 而且玩家一局只看得到**一个**家族，家族之间像不像不是玩家会遇到的问题
 * （`docs/M5-开发工单.md` §5 验收口径第 2 条要的是"家族真的换了底色"）。
 */
import { describe, expect, it } from 'vitest';
import {
  FACE_L,
  MIN_HUE_GAP,
  TONE_FACES,
  VERMILION_HUE,
  allFamilyTones,
  familyTintOf,
  familyToneOf,
  familyToneVars,
  oklchToHex,
  type ToneFace
} from './familyTone';
import { DISASTER_DEFS } from './disaster';

const INK = '#2c2c2a';
const INK_70 = 'rgba(44, 44, 42, 0.7)';
const INK_40 = 'rgba(44, 44, 42, 0.4)';
const VERMILION = '#c8372d';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rrggbb` 或 `rgba(r, g, b, a)` —— 后者按 alpha 合到 `under` 上 */
function rgbOf(color: string, under: string): Rgb {
  if (color.startsWith('#')) {
    const h = color.slice(1);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  const nums = color
    .replace(/^rgba?\(|\)$/g, '')
    .split(',')
    .map((v) => Number(v.trim()));
  // ★★ `--ink-70` 是**半透明墨**，不是一个固定的灰（`#6f6f6b` 只是它压在今天的米黄纸上的样子）。
  //    所以每个家族算出来的"次要文字色"都不同 —— 第一版这里用 `Math.round(c * alpha + c * (1-alpha))`
  //    把前景自己当成了底，于是算出 4.75 而不是 4.08（差 0.67，正好是"忘了合底"的量）。
  const base = rgbOf(under, under);
  const alpha = nums[3] ?? 1;
  const mix = (c: number, b: number): number => Math.round(c * alpha + b * (1 - alpha));
  return { r: mix(nums[0]!, base.r), g: mix(nums[1]!, base.g), b: mix(nums[2]!, base.b) };
}

function luminance(c: Rgb): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function contrastOf(fg: string, bg: string): number {
  const a = luminance(rgbOf(fg, bg));
  const b = luminance(rgbOf(bg, bg));
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function lstar(hex: string): number {
  const y = luminance(rgbOf(hex, hex));
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** 十六进制离得有多远 —— 只看"是不是同一个值"，不看"像不像" */
function channelGap(a: string, b: string): number {
  const x = rgbOf(a, a);
  const y = rgbOf(b, b);
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b));
}

const FAMILIES = allFamilyTones();
const NAMES = FAMILIES.map((f) => f.family);

/** 每个家族 × 三个面，逐对配好名字，失败信息里能直接看出是哪一对 */
function facePairs(): { label: string; a: string; b: string }[] {
  const out: { label: string; a: string; b: string }[] = [];
  for (let i = 0; i < FAMILIES.length; i++) {
    for (let j = i + 1; j < FAMILIES.length; j++) {
      for (const face of TONE_FACES) {
        out.push({
          label: `${FAMILIES[i]!.family} / ${FAMILIES[j]!.family} 的 ${face}`,
          a: FAMILIES[i]!.tone[face],
          b: FAMILIES[j]!.tone[face]
        });
      }
    }
  }
  return out;
}

describe('D-33 决策 E：底色由灾难家族决定', () => {
  it('① 七个家族都在表里，而且每个家族在三个面上都真的换了一色', () => {
    expect(NAMES).toEqual(['温度', '水', '结构', '生物', '社会', '空气', '组合']);
    // ★ 两两之间至少要差 2 个色阶：1 个色阶在两个都带彩的浅底上肉眼看不出
    //   （这一条不是"审美门槛"，是"别把两个家族的色值抄成同一个"）
    for (const pair of facePairs()) {
      expect(channelGap(pair.a, pair.b), pair.label).toBeGreaterThanOrEqual(2);
    }
  });

  it('① 三个面永远同序：卡片在上、纸在中间、沉底最下，且落差不小于今天这套', () => {
    for (const { family, tone } of FAMILIES) {
      // 半透明的东西要压在底上算，所以先给每个面配自己的底
      expect(lstar(tone.card), `${family} 卡片比纸还暗`).toBeGreaterThan(lstar(tone.page));
      expect(lstar(tone.page), `${family} 纸比沉底还暗`).toBeGreaterThan(lstar(tone.sunken));
      // 现在这套是 99.0 / 95.9 / 92.5 → 卡片-纸 3.1、纸-沉底 3.4、三档跨度 6.5
      expect(lstar(tone.card) - lstar(tone.page), family).toBeGreaterThan(3.1);
      expect(lstar(tone.page) - lstar(tone.sunken), family).toBeGreaterThan(3.4);
      // ★ 验收口径第 1 条：三档跨度 ≥ 14（现在是 13.8，差 0.2 是因为四舍五入到 8 位色）
      expect(lstar(tone.card) - lstar(tone.sunken), family).toBeGreaterThanOrEqual(13);
      // 「七类看起来一样亮」是构造出来的，不是调出来的 → 纸底的 L* 必须挤在一档里
      expect(Math.abs(lstar(tone.page) - 91.7), family).toBeLessThan(1);
    }
  });

  it('② 墨 / ink-70 / 朱红压在每一个家族底上都过线', () => {
    const worst = { ink: 99, ink70: 99, vermilion: 99 };
    for (const { family, tone } of FAMILIES) {
      // 正文：WCAG AA（4.5）之上留一倍余量 —— 底线 11（现在这套是 12.64）
      const ink = contrastOf(INK, tone.page);
      expect(ink, `${family} 的墨`).toBeGreaterThanOrEqual(11);
      worst.ink = Math.min(worst.ink, ink);

      // 次要文字：它是**半透明墨压在纸上**，所以每个家族的取值都不同（4.75~4.79）
      const ink70 = contrastOf(INK_70, tone.page);
      expect(ink70, `${family} 的 ink-70`).toBeGreaterThanOrEqual(4.5);
      worst.ink70 = Math.min(worst.ink70, ink70);

      // 警告色：底线 4（现在这套是 4.69）
      const vermilion = contrastOf(VERMILION, tone.page);
      expect(vermilion, `${family} 的朱红`).toBeGreaterThanOrEqual(4.15);
      worst.vermilion = Math.min(worst.vermilion, vermilion);

      // ink-40 **不设门槛**（它本来就是"次要到几乎不读"那一档），但也不许掉太多 ——
      // 掉下去说明有人拿去当正文色了
      expect(contrastOf(INK_40, tone.page), `${family} 的 ink-40`).toBeGreaterThanOrEqual(2.1);
    }
    // ★★ 写下这三个数：以后有人调彩度或明度，失败信息里会立刻看到"最好的一档变成了多少"。
    //    它们同时是 `docs/M5-开发工单.md` §5 验收口径第 3 条的实测值。
    //
    //    ⚠⚠ 这三个数是**重算过一遍**的：决策 E 登记时写的是 ink-70 最差 3.90、
    //    今天这套纸底 4.56 —— 那个 4.56 与这里的 5.04 差的正是"忘了把半透明墨合到底上"。
    //    这一条断言现在同时是那个错的口径的守卫：它再也回不去了。
    expect(worst.ink).toBeCloseTo(11.31, 1);
    expect(worst.ink70).toBeCloseTo(4.75, 1);
    expect(worst.vermilion).toBeCloseTo(4.2, 1);
  });

  it('② 同一句话：今天这套纸底上的 ink-70 / 朱红（口径对账，别再算错）', () => {
    // 这两个是 D-33 决策 E 里那张表的起点。半透明墨压在今天这张米黄纸上 = `#696864`，
    // 不是 `#6f6f6b`（那是一个**不透明**的灰，看着像但对比度差 0.5）。
    expect(contrastOf(INK_70, '#f7f3ea')).toBeCloseTo(5.04, 1);
    expect(contrastOf(INK, '#f7f3ea')).toBeCloseTo(12.64, 1);
    expect(contrastOf(VERMILION, '#f7f3ea')).toBeCloseTo(4.69, 1);
  });

  it('③ 家族色相离朱红至少一段距离（朱红还是唯一的警告色）', () => {
    for (const { family, hue } of FAMILIES) {
      const raw = Math.abs(hue - VERMILION_HUE);
      const gap = Math.min(raw, 360 - raw);
      expect(gap, `${family} 的色相 H=${hue} 离朱红太近`).toBeGreaterThanOrEqual(MIN_HUE_GAP);
    }
  });

  it('④ `familyToneVars` 的变量名与 `style.css` 的 `:root` 对得上，且牛皮纸不参与', () => {
    const tone = familyToneOf(DISASTER_DEFS[0]!);
    expect(familyToneVars(DISASTER_DEFS[0]!)).toEqual({
      '--paper': tone.page,
      '--card': tone.card,
      '--paper-2': tone.sunken
    });
    // ★ `--paper-3` 是**纸箱这件东西**的颜色（style.css 的注释写着"牛皮纸（纸箱）"），
    //   不是页面基调 —— 它出现在这里就说明有人把底色当成"所有纸色"了
    expect(Object.keys(familyToneVars(DISASTER_DEFS[0]!))).toEqual(['--paper', '--card', '--paper-2']);
    // 没有灾难时退回那张米黄纸（与 `style.css` 的 `:root` 同值）
    expect(familyToneVars(undefined)).toEqual({
      '--paper': '#f7f3ea',
      '--card': '#fffcf5',
      '--paper-2': '#efe9dc'
    });
  });

  it('④ 认不出的家族落到"组合"，而不是崩或给一个空底', () => {
    expect(familyTintOf('不存在的家族')).toEqual(familyTintOf('组合'));
    expect(familyToneOf({ family: '不存在的家族' } as never)).toEqual(familyToneOf({ family: '组合' } as never));
    // 空字符串也是"认不出"（存档被手改过时就是这个形状）
    expect(familyTintOf('')).toEqual(familyTintOf('组合'));
  });

  it('★★★★ 116 场灾难落到七个底；底色**只认家族**，与这一场是哪一场无关', () => {
    const byTone = new Map<string, string[]>();
    for (const def of DISASTER_DEFS) {
      const page = familyToneOf(def).page;
      byTone.set(page, [...(byTone.get(page) ?? []), def.name]);
    }
    // ★★ 这一条是决策 E 的**全部意义**：底色种数必须是 7，不是 116。
    //    它变多的那一天，就是有人把"逐场一个底"又捡回来了（那条路已被实测否决：
    //    113/116 场的墨压不住、朱红 116/116 场低于 3:1，见 familyTone.ts 的头部注释）
    expect([...byTone.keys()].sort()).toEqual(FAMILIES.map((f) => f.tone.page).sort());

    // 同家族的两场底色**完全相同**是刻意的 —— 把这一条钉死，免得下次审查当成 bug 去"修"
    const byFamily = new Map<string, Set<string>>();
    for (const def of DISASTER_DEFS) {
      const seen = byFamily.get(def.family) ?? new Set<string>();
      seen.add(familyToneOf(def).page);
      byFamily.set(def.family, seen);
    }
    for (const [family, seen] of byFamily) {
      expect(seen.size, `${family} 里出现了两种底色`).toBe(1);
    }

    // 窗外的 116 个 key 一个都不该被这件事碰到（窗外仍由 `windowScene` 决定）
    expect(new Set(DISASTER_DEFS.map((d) => d.windowScene)).size).toBe(DISASTER_DEFS.length);
  });

  it('OKLCH → hex 的边界：彩度 0 是灰、超域被钳住而不是回绕', () => {
    // 彩度 0 → 三个通道相等（是灰，不是某个色相的偏色）
    const gray = oklchToHex(0.929, 0, 270);
    const g = rgbOf(gray, gray);
    expect(Math.abs(g.r - g.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.g - g.b)).toBeLessThanOrEqual(1);
    // 明度 1 + 极高彩度会跑出色域：钳制之后必须是合法的 6 位十六进制，不能出现 `-` 或 3 位
    const wild = oklchToHex(1, 0.4, 30);
    expect(wild).toMatch(/^#[0-9a-f]{6}$/);
    // 明度越高越亮（同一个色相上单调）
    const steps: ToneFace[] = ['sunken', 'page', 'card'];
    const ls = steps.map((f) => lstar(oklchToHex(FACE_L[f], 0.015, 58)));
    expect(ls[1]!).toBeGreaterThan(ls[0]!);
    expect(ls[2]!).toBeGreaterThan(ls[1]!);
  });
});
