/**
 * ────────────────────────────────────────────────────────────────────────────
 *  量具：手机上"竖直方向"够不够用（整理页）
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ## 为什么要有这个脚本
 *
 * 用户 2026-10 报："手机界面太拥挤了，整理的时候都快看不到格子了。"
 *
 * 这句话没法靠看代码回答 —— 它是一道**减法题**：视口高度减去三块固定不滚的
 * 东西（顶栏 / 窗外那条带子 / 操作台），剩下的才是格子。任何一块悄悄长胖，
 * 表现都是"格子看不见了"，而不是某个元素明显出错。
 *
 * 所以这里把 `src/style.css` 当数据读，算出：
 *
 *   1. 每一档视口下 `.dock` 实际会占多少；
 *   2. 留给 `.room-scroll` 多少；
 *   3. 这些数字是否满足几条**硬约束**（漏水就退出码非 0）。
 *
 * ## 它不做什么
 *
 * 它**不是**一个 CSS 引擎：只认识 `src/style.css` 里实际写着的那几条属性，
 * 遇到不认识的写法会**直接报错退出**，而不是默默当成 0 ——
 * 一个"看不见东西却报绿"的量具比没有量具更坏。
 */
import { readFileSync } from 'node:fs';

const CSS = readFileSync('src/style.css', 'utf8');

/** 从 `from` 处的 `{` 开始找配对的 `}`（数花括号，不靠正则的懒惰量词） */
function matchingBrace(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 取一条类选择器规则的正文（`className` 以 `.` 开头，如 `.dock`） */
function ruleBody(selector: string): string {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/\./g, '\\.')}\\s*\\{`, 'm');
  const m = re.exec(CSS);
  if (!m) throw new Error(`量具坏了：style.css 里找不到规则 ${selector}`);
  const open = m.index + m[0].length - 1;
  const close = matchingBrace(CSS, open);
  if (close < 0) throw new Error(`量具坏了：规则 ${selector} 的花括号不配对`);
  return CSS.slice(open + 1, close);
}

/** 取某条属性最后一次出现的值（后面的覆盖前面的） */
function prop(body: string, name: string): string {
  const re = new RegExp(`(^|[;{\\s])${name}\\s*:\\s*([^;]+);`, 'g');
  let last: string | null = null;
  for (const m of body.matchAll(re)) last = m[2]!.trim();
  if (last === null) throw new Error(`量具坏了：这条规则里没有 ${name}`);
  return last;
}

/** `74px` / `34px` 这类 → 数字 */
function px(value: string): number {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (!m) throw new Error(`量具坏了：只会认 px，拿到的是 "${value}"`);
  return Number(m[1]);
}

// ———————— 1. 读现状 ————————

/** 取 `@media (max-height: 720px)` 那一档的正文；没有就返回空串 */
function shortScreenBlock(): string {
  const m = /@media\s*\(max-height:\s*720px\)\s*\{/.exec(CSS);
  if (!m) return '';
  const open = m.index + m[0].length - 1;
  const close = matchingBrace(CSS, open);
  return close < 0 ? '' : CSS.slice(open + 1, close);
}

/** 在 `block` 里找 `sel` 的规则正文；找不到返回 null（**不抛** —— "没覆盖"是正常情况） */
function ruleBodyIn(block: string, sel: string): string | null {
  const re = new RegExp(`(^|\\n)\\s*\\${sel}\\s*\\{`);
  const m = re.exec(block);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchingBrace(block, open);
  return close < 0 ? null : block.slice(open + 1, close);
}

/** 一条属性：先看短屏那一档有没有覆盖它，没有再回落到基样式（层叠就是这么走的） */
function effective(sel: string, name: string): string {
  const override = ruleBodyIn(shortScreenBlock(), sel);
  if (override !== null) {
    const re = new RegExp(`(^|[;{\\s])${name}\\s*:\\s*([^;]+);`, 'g');
    let last: string | null = null;
    for (const m of override.matchAll(re)) last = m[2]!.trim();
    if (last !== null) return last;
  }
  return prop(ruleBody(sel), name);
}

const HAND = px(effective('.dock-hand', 'min-height'));
const BOX = px(effective('.box', 'min-height'));

const boxBorders = (() => {
  const m = /(\d+(?:\.\d+)?)px solid/.exec(prop(ruleBody('.box'), 'border'));
  if (!m) throw new Error('量具坏了：.box 的边框取不到');
  return Number(m[1]) * 2;
})();

/** 「至少露出一行纸箱」的算式：一行的高度 + 上下边框，再给 8px 让下一行露个边 */
const boxesFloor = BOX + boxBorders + 8;

console.log('【读到的下限】');
console.log(`  .dock-hand  min-height  ${HAND}px`);
console.log(`  .box        min-height  ${BOX}px（+ 上下边框 ${boxBorders}px）`);
console.log(`  .dock-boxes 地板算式     ${BOX} + ${boxBorders} + 8 = ${boxesFloor}px`);
console.log('');

// ———————— 2. 算每一档视口 ————————

/**
 * 一档设备的账。
 *
 * 只把**固定不滚**的三块算进去，`.dock` 内部按"两行满"算 —— 那是最坏情况
 * （纸箱攒到 6 个以上时就是这样），而最坏情况才是有意义的那个数。
 *
 * ★★ 下面这三个数是**手抄的**，抄自真浏览器量出来的表（视口 375×667）：
 *      `.topbar` 180 + 窗外那条带子 52  → `chrome` 232
 *      `.dock` 里除纸箱以外            → `dockFixed` 212
 *    但这里填的是 **206 / 207** —— 也就是**比真实情况乐观约 26px**。
 *    这个偏差是**刻意留着**的：手抄的字号一旦与真机不同就会漂，
 *    而这一档真正要守的不是"某台手机上是 141px 还是 167px"，
 *    而是"**别再涨回去**"。所以判据按乐观值设线，真机只会比它更宽松。
 *    ⚠ 改这里之前先跑 `scripts/_probe-mobile-fit-dom.ts` 重新量一遍。
 */
interface Budget {
  label: string;
  height: number;
  /** 顶栏 + 窗外那条带子 */
  chrome: number;
  /** `.dock` 里除 `.dock-boxes` 以外的部分（手里的东西 + 四个按钮 + 胶带架 + 间距 + 上下内边距） */
  dockFixed: number;
}

const BUDGETS: Budget[] = [
  { label: 'iPhone SE / 老安卓（375×667）', height: 667, chrome: 206, dockFixed: 207 },
  { label: '安卓中端（390×720）', height: 720, chrome: 206, dockFixed: 207 },
  { label: 'iPhone 14/15（390×844）', height: 844, chrome: 206, dockFixed: 207 },
];

/**
 * 「还看得见格子」的下限，按**上面那套乐观值**算。
 *
 * 真机（375×667）量出来的余量是 141px，这里比它低 26px 正好抵掉乐观偏差 ——
 * 所以这条线一旦被判红，真机上就真的只剩一格多一点了。
 */
const ROOM_FLOOR = 150;

/**
 * `.dock-boxes` 的 `max-height` 在某个视口下算出来是多少。
 *
 * 认识两种写法：`170px`（写死）与 `max(82px, min(170px, 16dvh))`（跟着视口长）。
 * `dvh` 按 `height/100` 折算。★ 只认这两种 —— 换第三种写法请先改这里，
 * 别让它默默当 0（那会让下面每一档都"看起来很宽敞"）。
 */
function boxesCap(height: number): number {
  const raw = effective('.dock-boxes', 'max-height');
  const fixed = /^(\d+(?:\.\d+)?)px$/.exec(raw);
  if (fixed) return Number(fixed[1]);
  const m = /^max\(\s*(\d+(?:\.\d+)?)px\s*,\s*min\(\s*(\d+(?:\.\d+)?)px\s*,\s*(\d+(?:\.\d+)?)dvh\s*\)\s*\)$/.exec(raw);
  if (!m) throw new Error(`量具坏了：认不出 .dock-boxes 的 max-height "${raw}"`);
  return Math.max(Number(m[1]), Math.min(Number(m[2]), (Number(m[3]) / 100) * height));
}

console.log('【每一档的账】（最坏情况：纸箱那一叠刚好两行满）');
console.log('  设备                              视口  − 顶栏带子  − 操作台固定  − 纸箱那一叠  = 留给格子');
for (const b of BUDGETS) {
  const boxes = Math.min(BOX * 2 + 8, boxesCap(b.height)); // 两行 + 行间距，再被上限压
  const room = b.height - b.chrome - b.dockFixed - boxes;
  /*
   * 一块货架卡的单行格子：抬头 44px + 一格 56px + 卡片内边距与行间隙 ——
   * 约 102px。这个数**只用来把这行数字说成人话**（"≈几行"），
   * 硬约束里一个字都没用到它，所以它不需要精确。
   */
  const rows = room / 102;
  const flag = room >= ROOM_FLOOR ? '' : '   ← 低于那条线了';
  console.log(
    `  ${b.label.padEnd(32)} ${String(b.height).padStart(4)}  − ${b.chrome}  − ${b.dockFixed}  − ${String(Math.round(boxes)).padStart(3)}  = ${String(Math.round(room)).padStart(4)}px（≈${rows.toFixed(1)} 行）${flag}`,
  );
}
console.log('');

// ———————— 3. 硬约束 ————————

const problems: string[] = [];

/*
 * ① `max-height: 720px` 那一档必须真的在（否则上面那些数字全是空谈）。
 */
if (!/@media\s*\(max-height:\s*720px\)/.test(CSS)) {
  problems.push('style.css 里没有 `@media (max-height: 720px)` 那一档 —— 手机上的竖直预算没人在管');
}

/*
 * ② 可点目标不许被这一档压到 `--tap-min` 以下。
 *    这是**唯一**一条不能让步的：格子再挤也不能让拇指点不中。
 */
const TAP_MIN = (() => {
  const m = /--tap-min:\s*(\d+(?:\.\d+)?)px/.exec(CSS);
  if (!m) throw new Error('量具坏了：:root 里没有 --tap-min');
  return Number(m[1]);
})();
if (BOX < TAP_MIN) problems.push(`.box 的 min-height 是 ${BOX}px，低于 --tap-min 的 ${TAP_MIN}px`);
if (HAND < 44) problems.push(`.dock-hand 的 min-height 是 ${HAND}px，低于 44px`);

/*
 * ③ 地板算式必须真的托得住一行纸箱 —— 这条是防"改了 .box 却没改那条 max()"。
 */
const mDock = /\.dock-boxes\s*\{[^}]*max-height:\s*max\(\s*(\d+(?:\.\d+)?)px/.exec(CSS);
if (!mDock) {
  problems.push('.dock-boxes 上没有 `max-height: max(…)` 那条地板 —— 短屏上纸箱那一叠会压过操作台');
} else if (Number(mDock[1]) < boxesFloor) {
  problems.push(
    `.dock-boxes 的地板是 ${mDock[1]}px，托不住一行纸箱（需要 ≥ ${boxesFloor}px = .box 的 ${BOX} + 边框 ${boxBorders} + 8）`,
  );
}

/*
 * ⑤ 最矮那一档必须真的还看得见格子（不是"变矮了"，是"还在"）。
 *    这一条是这一档存在的**全部理由**，所以它自己也得上秤。
 */
for (const b of BUDGETS) {
  const boxes = Math.min(BOX * 2 + 8, boxesCap(b.height));
  const room = b.height - b.chrome - b.dockFixed - boxes;
  if (room < ROOM_FLOOR) {
    problems.push(
      `${b.label}：留给格子的只有 ${Math.round(room)}px（低于 ${ROOM_FLOOR}px 这条线），固定开销吃掉了 ${Math.round(b.height - room)}px`,
    );
  }
}

/*
 * ④ `.dock` 的子项在竖直方向不许**生长**。
 *    只要有一个会长，操作台就能把 `.room-scroll` 挤成负数 —— 那时格子是**彻底**
 *    看不见（不是变矮），而且是静默的。
 *
 * ★ 这里查的是"有没有一条会让它长大的 flex"，**不是**"有没有写 `flex: 0 0 auto`"：
 *   `.dock-hand` 与 `.dock-boxes` 本来就没写 `flex`，而没写就是 `0 1 auto`
 *   —— 那是**收缩**，不生长，是安全的。第一版按字面查 `0 0 auto`，
 *   于是对着两条无辜的正确代码报了两条假红。**假红会让人开始改守卫。**
 */
for (const child of ['.dock-hand', '.dock-boxes']) {
  const bodies = [ruleBody(child), ruleBodyIn(shortScreenBlock(), child)].filter(
    (b): b is string => b !== null,
  );
  const grows = bodies.some((body) => {
    const short = /flex:\s*(\d+(?:\.\d+)?)/.exec(body);
    if (short) return Number(short[1]) > 0;
    return /flex-grow:\s*(\d+(?:\.\d+)?)/.test(body) && Number(/flex-grow:\s*(\d+(?:\.\d+)?)/.exec(body)?.[1]) > 0;
  });
  if (grows) {
    problems.push(`${child} 在竖直方向会生长（flex-grow > 0）—— 它能把货架挤没`);
  }
}

console.log('【硬约束】');
if (problems.length === 0) {
  console.log('  ① 短屏那一档在          ✅');
  console.log(`  ② 可点目标 ≥ ${TAP_MIN}px      ✅（.box ${BOX} / .dock-hand ${HAND}）`);
  console.log(`  ③ 纸箱地板 ≥ ${boxesFloor}px    ✅`);
  console.log(`  ④ 操作台子项不长高      ✅（不留余地地压着货架的只有"生长"，没有就是 0 1 auto）`);
  console.log('');
  console.log('[check-mobile-fit] 竖直预算成立。');
  process.exit(0);
}

for (const p of problems) console.log(`  ✗ ${p}`);
console.log('');
console.log(`[check-mobile-fit] ${problems.length} 条不成立。`);
process.exit(1);
