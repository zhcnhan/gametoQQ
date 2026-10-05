/**
 * ★★ D-33 / 决策 E：**底色由灾难家族决定**（`docs/囤货末世-游戏策划案.md` §12A 的「决策 E」）
 *
 * ## 它换掉了什么
 *
 * §5A 立的底是一张与灾难无关的米黄纸（`--paper: #f7f3ea`，L* 95.9，三档跨度只有 6.5）。
 * 于是 116 场灾难里玩家看到的是**同一张纸** —— 用户那句"一点都不灾难"是准的。
 * 这一层让**页面底**跟着 `DisasterProfile.family` 走：它说"你在应付哪一类事"。
 *
 * ## 为什么底色是按**家族**（7 类）而不是按**这一场**（116 场）
 *
 * 这是量出来的结论，不是省事（`scripts/_probe-d33-*.ts`，一次性探针，已删）：
 *
 * | 做法 | 实测 |
 * | --- | --- |
 * | 页面底直接取这一场的代表色（`disasterTintOf`） | 墨压上去中位 **2.3 : 1**，**113 / 116 场低于 4.5:1** = 正文不可读；朱红最差 **1.01 : 1**、**116 / 116 场低于 3:1** = 警告色等于没有 |
 * | 往白里提出 116 个逐场底色 | 按「色相 6° / 饱和 4% / 明度 2 个 L*」量化后 **18 组撞车、涉及 100 场**，完全同色 **60 场** |
 *
 * 两条路都不通：前者是功能失效（不是审美），后者凑出来的区分度**低于**
 * 窗外那一条带子本来就有的。所以**逐场的视觉身份交给"形"**（`windowThemes` 的 116 组
 * 窗外渐变 + `fall` 决定的飘落形状），**底色只承担家族**。
 *
 * ★★ 推论：同一家族的两场**底色完全相同**是**刻意**的。别回头去凑"逐场一个底"。
 *
 * ## 三条纪律
 *
 *  · **明度定死**：三个面的 OKLCH 明度（`FACE_L`）写死成常量，只有色相与彩度随家族变 ——
 *    于是"七类看起来一样亮"这件事由构造保证，不靠事后调；
 *  · **朱红与暖黄不参与**：它们是 §5A 的语义红线（警告 / 安全），永远是原值；
 *  · **色相离朱红至少 `MIN_HUE_GAP` 度**：朱红 `#c8372d` 的 OKLCH 色相约 29.5°。
 *    「结构」取 58° 就是为了这一条（曾经想取 32°，与朱红只差 2.5° ——
 *    玩家会把"这类灾难"读成"警告"）。
 *
 * ## 想知道哪一场是什么家族
 *
 * 看 `DisasterProfile.family`（温度 25 / 水 16 / 结构 16 / 生物 16 / 社会 16 / 组合 15 / 空气 12）。
 * 界面拿到的是内联 CSS 变量（见 `familyToneVars`）。
 */
import type { DisasterProfile } from '../model/types';

/** 三个面：正文底 / 卡片 / 沉底。★ 这三个名字就是这套底色要说的三件事 */
export const TONE_FACES = ['page', 'card', 'sunken'] as const;
export type ToneFace = (typeof TONE_FACES)[number];

/** 这一场家族配色算出来的三个色值 */
export type FamilyTone = Readonly<Record<ToneFace, string>>;

/**
 * 家族 → (色相, 彩度)，单位是 OKLCH 的度与 0~0.4 的彩度。
 *
 * ⚠ 改这里的任何一个数之前先跑 `familyTone.test.ts` ——
 * 它逐家族断言"墨压纸底 ≥ 11、ink-70 ≥ 4.5、朱红 ≥ 4.15、色相离朱红 ≥ 25°、
 * 七个家族的底不能撞"，并把**实测出来的最差值**也钉住。
 *
 * ★ 彩度为什么这么低（0.75%~1.8%）：再往上加，`--ink-70`（次要文字色，
 * `rgba(44,44,42,0.7)`）压在纸底上就往下掉 —— 现在是 4.75~4.80，
 * 再掉就穿 4.5 了。彩度不是"越浓越明显"，它是**拿可读性换的**。
 * ⚠ 算它的时候**必须先按 alpha 合到那个家族的纸底上**（合出来是 `#616566` 这类值）；
 * 拿一个不透明的灰当它算，全表会低约 0.5 —— 决策 E 的初版就是这么错的。
 */
/**
 * ★★ **彩度也是轴，不只是色相。**
 *
 * 七个家族里有三个落在冷色区（温度 245 / 组合 270 / 社会 295）—— 那是玩家
 * 一局只看得到**一个**家族时无所谓、而"这七张底看起来是不是七张"要说清楚的地方。
 * 光靠色相分不开：`温度`(0.018) 与 `组合`(0.0075) 的色相只差 25°，而 OKLab 距离
 * 只有 **0.011**（勉强可辨）；把组合压成一张**几乎无彩的灰**(0.0075) 之后，
 * 两者差的是"有没有颜色"这件事，而不是"偏哪一边"。
 *
 * ⚠ 别反过来把 `组合` 的彩度提到与社会同档 —— 270 与 295 在 OKLab 上只差
 * 0.006（比 JND 还小），那样两张底就真的是同一张了。
 *
 * ★ 实测最接近的一对仍是 `结构`(58°/0.015) 与 `空气`(88°/0.012)：OKLab 距离 **0.0078**。
 * 这是**已知且接受**的 —— 六个家族的纸底被钉在同一个明度档上，两两距离的天花板
 * 本来就只有 0.036；再拉开只有"提彩度"一条路，而那正是拿 `--ink-70` 换的。
 * 玩家一局只看得到一个家族，所以这一对像不像不是玩家会遇到的问题。
 */
const FAMILY_TINT: Readonly<Record<string, { hue: number; chroma: number }>> = {
  温度: { hue: 245, chroma: 0.018 }, // 冷蓝灰：冷了、下雪了
  水: { hue: 195, chroma: 0.018 }, // 青灰：潮了、进水了
  结构: { hue: 58, chroma: 0.015 }, // 暖褐灰：塌了、断了
  生物: { hue: 120, chroma: 0.014 }, // 灰绿：霉了、生虫了
  社会: { hue: 295, chroma: 0.016 }, // 灰紫：人祸
  空气: { hue: 88, chroma: 0.012 }, // 土黄灰：呛人
  组合: { hue: 270, chroma: 0.0075 } // 中性偏冷：两件事一起（★ 见下方"彩度也是轴"）
};

/**
 * 三个面的 OKLCH 明度。★★ 这三个数是这一层的全部"性格"。
 *
 * 现在这套的纸底 L* 95.9、卡片 99.0、纸-2 92.5 —— **三档跨度只有 6.5**，
 * 那正是"奶油风"的量。新的一套纸底 L* **91.8**、三档跨度 **13.8**
 * （`check-style.mjs` 第 ⑧ 条只数"内容粗边框 ≤ 9 类"、**不验对比度**，
 *  所以这一条由 `familyTone.test.ts` 自己守）。
 *
 * ⚠ 这三个数**不是白的明度**：OKLCH 的 L 是感知明度，0.929 大约就是 sRGB 的 L* 91.8。
 */
export const FACE_L: Readonly<Record<ToneFace, number>> = {
  page: 0.929,
  card: 0.968,
  sunken: 0.849
};

/** 卡片面永远是纸的 55% 彩度：越上层的面越淡，否则卡片看起来像贴在纸上的一张亮贴纸 */
const CARD_CHROMA = 0.55;
/** 沉底面比纸略浓（1.2 倍），它是"凹陷 / 次要"那一层 */
const SUNKEN_CHROMA = 1.2;

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/**
 * OKLCH → `#rrggbb`。
 *
 * ★ 为什么用 OKLCH 而不是 HSL：HSL 的 `l` 与**感知**明度差得很远
 * （同一 `l` 的两个色相，人眼看到的亮暗可以差一档），而我们这里要的恰恰是
 * "七个家族看起来一样亮"。OKLCH 的 L 就是感知明度，用它才能把这件事**构造**出来。
 *
 * 超色域时直接钳制 —— 我们用的彩度很低（≤ 0.018），实际上不会碰到边界。
 */
export function oklchToHex(l: number, chroma: number, hue: number): string {
  const h = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(h);
  const b = chroma * Math.sin(h);

  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const to = (v: number): string => {
    const n = Math.round(Math.min(255, Math.max(0, linearToSrgb(v) * 255)));
    return n.toString(16).padStart(2, '0');
  };

  return (
    '#' +
    to(+4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc) +
    to(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc) +
    to(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc)
  );
}

/** 这个家族在 OKLCH 上的色相与彩度 */
export function familyTintOf(family: string): { hue: number; chroma: number } {
  // 认不出的家族 → 落到"组合"这一档（与 `windowThemeOf` 的兜底同一个口径：加内容时不崩）
  return FAMILY_TINT[family] ?? FAMILY_TINT['组合']!;
}

/** 这一场该用哪一套底 */
export function familyToneOf(disaster: DisasterProfile): FamilyTone {
  const t = familyTintOf(disaster.family);
  return {
    page: oklchToHex(FACE_L.page, t.chroma, t.hue),
    card: oklchToHex(FACE_L.card, t.chroma * CARD_CHROMA, t.hue),
    sunken: oklchToHex(FACE_L.sunken, t.chroma * SUNKEN_CHROMA, t.hue)
  };
}

/** 七个家族的底色（测试与探针用；界面走 `familyToneOf`） */
export function allFamilyTones(): { family: string; hue: number; chroma: number; tone: FamilyTone }[] {
  return Object.keys(FAMILY_TINT).map((family) => {
    const t = familyTintOf(family);
    return { family, hue: t.hue, chroma: t.chroma, tone: familyToneOf({ family } as DisasterProfile) };
  });
}

/** 朱红 `#c8372d` 在 OKLCH 上的色相 —— 底色的色相离它至少要 `MIN_HUE_GAP` 度 */
export const VERMILION_HUE = 29.5;
export const MIN_HUE_GAP = 25;

/** 没有灾难时的兜底底色（= 现在这套米黄纸，认不出灾难时至少不崩） */
const FALLBACK_TONE: FamilyTone = { page: '#f7f3ea', card: '#fffcf5', sunken: '#efe9dc' };

/**
 * ★★ **整套底色的唯一入口**：把这一场的家族色写成 CSS 变量。
 *
 * 为什么是**内联变量**而不是给 `<body>` 挂一个类名：底色只有三个变量，
 * 而 `style.css` 里有 **343 处** `var(--paper…)` —— 挂类名要在 CSS 里再抄一份
 * 7 个家族的映射表，那份表**没有第二个读者**却会被抄错
 * （`windowThemes` 的 `fall` 名单就抄错过 21 场，见 M4 那次守卫）。
 * 内联变量让"算"与"用"只有一处。
 *
 * ⚠ **`--paper-3` 不在里面**：它是牛皮纸色，说的是"纸箱"这件**东西**的颜色，
 * 不是页面基调（`style.css` 的注释写着"牛皮纸（纸箱）"）。灾难不该改纸箱的颜色。
 * ⚠ 变量名要与 `style.css` 的 `:root` 一一对上；漏一个的表现是"某一层还是米黄的"
 * —— 不会有任何报错。`familyTone.test.ts` 逐名对账。
 */
export function familyToneVars(disaster: DisasterProfile | undefined): Record<string, string> {
  const tone = disaster ? familyToneOf(disaster) : FALLBACK_TONE;
  return {
    '--paper': tone.page,
    '--card': tone.card,
    '--paper-2': tone.sunken
  };
}
