/**
 * 一次性探针：116 场窗外配色的**对比度分布**（用户 2026-10："对比更强"）。
 *
 * 要量三件事，都要数字：
 *  ① 每场内部三道渐变之间的**明度差**（下界决定"像不像一块天空"，
 *     太小就退化成一块纯色）；
 *  ② 116 场**互相之间**的代表色差（太小 = 两场看起来一样）；
 *  ③ 朱红 / 暖黄两条红线的**接近程度**（改强之后最容易撞上的地方）。
 *
 * 用 HSL 明度（L）做尺子：它是"看起来深还是浅"最直接的那个量，
 * 而这一层要的正是"眼睛能分出来"。
 */
import { DISASTER_DEFS } from '../src/data/disaster';
import { disasterTintOf, windowThemeOf } from '../src/data/windowThemes';

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.replace(/./g, (c) => c + c) : v, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

const rows = DISASTER_DEFS.map((d) => {
  const t = windowThemeOf(d);
  const sky = hexToHsl(t.sky);
  const far = hexToHsl(t.far);
  const ground = hexToHsl(t.ground);
  const spread = Math.max(sky.l, far.l, ground.l) - Math.min(sky.l, far.l, ground.l);
  return { name: d.name, sky, far, ground, spread, tint: hexToHsl(disasterTintOf(d)) };
});

const spreads = rows.map((r) => r.spread).sort((a, b) => a - b);
const pct = (p: number): number => spreads[Math.min(spreads.length - 1, Math.floor(spreads.length * p))] ?? 0;
console.log('══ ① 每场内部：三道渐变的明度跨度 ══');
console.log(`  最小 ${spreads[0]?.toFixed(1)} · 25% ${pct(0.25)?.toFixed(1)} · 中位 ${pct(0.5)?.toFixed(1)} · 最大 ${spreads[spreads.length - 1]?.toFixed(1)}`);

console.log('\n══ ② 116 场互相之间：代表色的明度跨度 ══');
const tints = rows.map((r) => r.tint.l).sort((a, b) => a - b);
console.log(`  最浅 ${tints[tints.length - 1]?.toFixed(1)} · 最深 ${tints[0]?.toFixed(1)} · 跨度 ${(tints[tints.length - 1]! - tints[0]!).toFixed(1)}`);
const sat = rows.map((r) => r.tint.s).sort((a, b) => a - b);
console.log(`  代表色饱和度：最低 ${sat[0]?.toFixed(1)} · 中位 ${sat[Math.floor(sat.length / 2)]?.toFixed(1)} · 最高 ${sat[sat.length - 1]?.toFixed(1)}`);

console.log('\n══ ③ 两条红线（§5A）：最近的几场 ══');
const VERM = hexToHsl('#c8372d');
const WARM = hexToHsl('#f2c94c');
const diff = (a: { h: number; s: number; l: number }, b: { h: number; s: number; l: number }): number =>
  Math.abs(a.h - b.h) + Math.abs(a.s - b.s) + Math.abs(a.l - b.l);
const nearVerm = [...rows].sort((a, b) => diff(a.tint, VERM) - diff(b.tint, VERM)).slice(0, 3);
const nearWarm = [...rows].sort((a, b) => diff(a.tint, WARM) - diff(b.tint, WARM)).slice(0, 3);
console.log(`  离朱红最近：${nearVerm.map((r) => `${r.name}(差 ${diff(r.tint, VERM).toFixed(0)})`).join(' / ')}`);
console.log(`  离暖黄最近：${nearWarm.map((r) => `${r.name}(差 ${diff(r.tint, WARM).toFixed(0)})`).join(' / ')}`);

console.log('\n══ 结论 ══');
console.log(`三道渐变的明度跨度中位数 = ${pct(0.5)?.toFixed(1)}，代表色饱和度中位数 = ${sat[Math.floor(sat.length / 2)]?.toFixed(1)}%。`);
console.log('（改之前的基线：跨度 34.9 / 最平 10.2 / 饱和度 8.9%。）');
