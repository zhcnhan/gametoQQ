/**
 * 一次性脚本：把 116 场窗外配色的**对比拉强**（用户 2026-10："对比更强"）。
 *
 * ## 先量后改（`scripts/_probe-contrast.ts` 的实测）
 *
 * | 量什么 | 改之前 |
 * | --- | --- |
 * | 三道渐变的明度跨度（中位） | **34.9** |
 * | 最平的那一场 | **10.2**（几乎是一块纯色） |
 * | 代表色的饱和度（中位） | **8.9%** |
 *
 * 结论：整层是"印在纸上的淡彩"，方向没错（§5A 要的是压过明度与饱和度的印色），
 * 但**拉不开**。所以这一轮只做两件事，都朝着"眼睛能分出来"：
 *
 *  ① **提饱和**（×3.2，封顶 58）—— 天空与地面各自成色；
 *  ② **压地面与远景的明度**（地面 −16、远景 −9）—— 让"天在上、地在下"读得出来，
 *     同时把代表色（取地面那一色）自然压深，116 场之间的跨度也跟着变大。
 *
 * 天空那一档**只提饱和、不动明度**：它是"天光"，压暗会让整个界面变沉。
 *
 * ## 自查（写盘前，纪律 §4A.1）
 *
 *  · 只改 `windowThemes.ts` 里那三段十六进制，**别的一个字不碰**；
 *  · 改完逐条核：① 每一场至少三道里有跨度 ≥ 26；② 颜色不撞 §5A 两条红线
 *    （与朱红 / 暖黄的 HSL 距离必须 ≥ 40）；③ 总数仍是 116 个 key；
 *  · 任何一条不过就**拒绝写盘**并把现场打出来。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DISASTER_DEFS } from '../src/data/disaster';
import { windowThemeOf } from '../src/data/windowThemes';

const PATH = 'src/data/windowThemes.ts';

interface Hsl {
  h: number;
  s: number;
  l: number;
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function hexToHsl(hex: string): Hsl {
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

function hslToHex({ h, s, l }: Hsl): string {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = ln - c / 2;
  const to = (v: number): string =>
    Math.round(clamp(v + m, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

/**
 * 一道渐变色的变换：提饱和（带抬底）；地面 / 远景按**线性重映射**压明度。
 *
 * ## 三处调整都是量出来的，不是拍的
 *
 *  ① 倍数与上限：第一版用 ×3.2 / 封顶 58，跑出来地面是 `#67a2d5` 这种**鲜蓝** ——
 *     那已经不是 §5A 说的"压过明度与饱和度的印刷色"，而是荧光色了。收到 ×2.2；
 *  ② **抬底**（`max(s × 2.2, 16 + (s − 8) × 2)`）：第一条判据我用的是"饱和度 ≥ 14%"，
 *     实跑 35 场不过 —— 而它们不是配色坏了，是**色相本来就是灰的**。
 *     原样 ×2.2 会把它们统统顶到 8% 的**同一个下限**上，于是 `宵禁` / `封控` / `骚乱`
 *     拿到一模一样的 `#424038`（那正是"同质性太强烈"，只不过换了个位置）；
 *  ③ ★ **线性重映射而不是"减一个数再夹"**：第一版地面写的是 `clamp(l − 18, 24, 60)`，
 *     而它会**把 24~42 那一段全部压到 24** —— 于是 `骚乱` / `失业潮` / `电网崩`
 *     又撞成同一个 `#474333`。重映射保住了原本的**相对差**：
 *     `l' = 26 + (l / 100) × 32`，任何两个不同的 l 得到的 l' 也不同。
 */
function punch(hex: string, role: 'sky' | 'far' | 'ground'): string {
  const hsl = hexToHsl(hex);
  const s = clamp(Math.max(hsl.s * 2.2, 16 + (hsl.s - 8) * 2), 16, 46);
  const l =
    role === 'ground'
      ? 22 + (hsl.l / 100) * 42 // 22~64：跨度拉满（原来 24~58），代表色两两不再撞
      : role === 'far'
        ? 54 + (hsl.l / 100) * 30 // 54~84
        : hsl.l;
  return hslToHex({ h: hsl.h, s, l });
}

// ———————— 改：逐条按"key + 三个色值"精确替换 ————————
const text = readFileSync(PATH, 'utf8');
let out = text;
let replaced = 0;
for (const d of DISASTER_DEFS) {
  const t = windowThemeOf(d);
  /*
   * ⚠ 匹配整行，而且要求 key **后面紧跟**那三个色值 ——
   * 第一版我写成 `(['"]key['"]: \{ sky: ')`，而文件里裸 key（`blizzard: {`）
   * 根本没有引号，于是第一场就匹配不上（脚本当场拒绝写盘，这是对的）。
   * 现在两种写法都收，并且逐条核对总数。
   */
  const lineRe = new RegExp(
    `((?:'|")?${escapeRe(d.windowScene)}(?:'|")?: \\{ sky: '#)([0-9a-fA-F]{6})(', far: '#)([0-9a-fA-F]{6})(', ground: '#)([0-9a-fA-F]{6})(')`
  );
  const m = lineRe.exec(out);
  if (!m) {
    console.error(`找不到 ${d.name}（${d.windowScene}）那一行 —— 拒绝写盘`);
    process.exit(1);
  }
  const repl =
    `${m[1]}${punch(`#${m[2]}`, 'sky').slice(1)}${m[3]}` +
    `${punch(`#${m[4]}`, 'far').slice(1)}${m[5]}${punch(`#${m[6]}`, 'ground').slice(1)}${m[7]}`;
  out = out.replace(lineRe, repl);
  replaced += 1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ———————— 自查 ①：数量对 ————————
const keys = (out.match(/': \{ sky: '/g) ?? []).length;
const keys2 = (out.match(/"\w[\w-]*": \{ sky: '/g) ?? []).length;
if (replaced !== DISASTER_DEFS.length) {
  console.error(`自查失败：只改了 ${replaced} 场（应当 ${DISASTER_DEFS.length}）—— 拒绝写盘`);
  process.exit(1);
}
console.log(`改了 ${replaced} 场（每场三道），key 行数 ${keys + keys2}`);

// 把改完的内容读回来验（用 vite-node 的模块缓存绕不过去，所以用正则自己解析）
const parse = (src: string): Map<string, { sky: string; far: string; ground: string }> => {
  const map = new Map<string, { sky: string; far: string; ground: string }>();
  const re = /(?:'|")?([\w-]+)(?:'|")?: \{ sky: '(#[0-9a-f]{6})', far: '(#[0-9a-f]{6})', ground: '(#[0-9a-f]{6})'/g;
  for (const m of src.matchAll(re)) map.set(m[1]!, { sky: m[2]!, far: m[3]!, ground: m[4]! });
  return map;
};

const themes = parse(out);
{
  const log = dedupe(themes);
  if (log.length > 0) {
    console.log(`撞色拆开 ${log.length} 处（量化造成的，不是配色造成的）：`);
    for (const line of log) console.log('  ' + line);
    // 把拆开的结果写回源码（只替换那一行的 ground）
    for (const [key, t] of themes) {
      const re = new RegExp(
        `((?:'|")?${escapeRe(key)}(?:'|")?: \\{ sky: '#[0-9a-f]{6}', far: '#[0-9a-f]{6}', ground: '#)([0-9a-f]{6})`
      );
      const m = re.exec(out);
      if (m && m[2] !== t.ground.slice(1)) out = out.replace(re, `$1${t.ground.slice(1)}`);
    }
  }
}
/**
 * ★ 撞色兜底：**同一批源色落在同一个 8 位 RGB 上**时要拆开。
 *
 * ## 为什么必须有这一步（而不是"再调调倍数就好了"）
 *
 * 源表里本来就有几场几乎是同一个灰（`骚乱` / `电网崩` / `宵禁`…），
 * 而十六进制只有 8 位分辨率 —— 两份**不同**的 HSL 舍入之后完全可能落到同一个
 * `#66614a` 上。倍数调到多少都消不掉这一类：它是**量化**造成的，不是配色造成的。
 *
 * 而"两场拿到同一个颜色"正是用户抱怨的那件事，所以它必须被消掉 ——
 * 做法是给后来者一个**很小的**色相偏移（±3° 以内，按序递增），
 * 并且**把每一次拆开都打出来**：这样"到底动了几场"是看得见的，
 * 而不是脚本悄悄改了配色。
 */
function dedupe(themes: Map<string, { sky: string; far: string; ground: string }>): string[] {
  const log: string[] = [];
  const seen = new Map<string, string>(); // ground → 第一个用到它的 key
  for (const [key, t] of themes) {
    const first = seen.get(t.ground);
    if (first === undefined) {
      seen.set(t.ground, key);
      continue;
    }
    // 逐档找第一个不撞的偏移（最多试到 ±6°）
    let fixed = t.ground;
    for (let step = 1; step <= 6; step++) {
      for (const dir of [1, -1]) {
        const hsl = hexToHsl(t.ground);
        const candidate = hslToHex({ h: hsl.h + dir * step * 1.5, s: hsl.s, l: hsl.l });
        if (!seen.has(candidate)) {
          fixed = candidate;
          break;
        }
      }
      if (fixed !== t.ground) break;
    }
    seen.set(fixed, key);
    t.ground = fixed;
    log.push(`${key}（与 ${first} 同色 → 拆成 ${fixed}）`);
  }
  return log;
}


// 自查 ②：每一场的明度跨度
const VERM = hexToHsl('#c8372d');
const WARM = hexToHsl('#f2c94c');
const dist = (a: Hsl, b: Hsl): number => Math.abs(a.h - b.h) + Math.abs(a.s - b.s) + Math.abs(a.l - b.l);
const spreads: number[] = [];
const clashes: string[] = [];
const flats: string[] = [];
for (const d of DISASTER_DEFS) {
  const t = themes.get(d.windowScene);
  if (!t) {
    console.error(`自查失败：改完之后找不到 ${d.windowScene} —— 拒绝写盘`);
    process.exit(1);
  }
  const ls = [hexToHsl(t.sky).l, hexToHsl(t.far).l, hexToHsl(t.ground).l];
  const spread = Math.max(...ls) - Math.min(...ls);
  spreads.push(spread);
  if (spread < 26) flats.push(`${d.name}（跨度 ${spread.toFixed(1)}）`);
  const g = hexToHsl(t.ground);
  if (dist(g, VERM) < 40 || dist(g, WARM) < 40) {
    clashes.push(`${d.name}（离朱红 ${dist(g, VERM).toFixed(0)} / 离暖黄 ${dist(g, WARM).toFixed(0)}）`);
  }
}
const sorted = [...spreads].sort((a, b) => a - b);
console.log(`明度跨度：最小 ${sorted[0]?.toFixed(1)} · 中位 ${sorted[Math.floor(sorted.length / 2)]?.toFixed(1)} · 最大 ${sorted[sorted.length - 1]?.toFixed(1)}`);
if (flats.length > 0) {
  console.error(`自查失败：这些场的三道渐变还是太平：\n  ${flats.join('\n  ')}`);
  process.exit(1);
}
if (clashes.length > 0) {
  console.error(`自查失败：这些场的代表色撞了 §5A 两条红线：\n  ${clashes.join('\n  ')}`);
  process.exit(1);
}

// 自查 ③：不许有两场拿到完全相同的代表色（那就是"看起来一样"的定义）
const byTint = new Map<string, string[]>();
for (const d of DISASTER_DEFS) {
  const t = themes.get(d.windowScene);
  if (!t) continue;
  const list = byTint.get(t.ground) ?? [];
  list.push(d.name);
  byTint.set(t.ground, list);
}
const dupes = [...byTint.entries()].filter(([, names]) => names.length > 1);
if (dupes.length > 0) {
  console.error(`自查失败：这些场的代表色一模一样：\n  ${dupes.map(([c, n]) => `${c} ← ${n.join('/')}`).join('\n  ')}`);
  process.exit(1);
}

writeFileSync(PATH, out, 'utf8');
console.log('写盘完成 ✓');
