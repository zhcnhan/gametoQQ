/**
 * 样式层次的守卫脚本（`src/style.css` 的"看久了累、不高级"那条修法）。
 *
 * ## 为什么是脚本而不是单测
 *
 * 这件事本来该是一条 vitest 用例，但**vitest 读不到 src/style.css 的原文**：
 * `import.meta.glob('../style.css', { query: '?raw' })` 会匹配到键、
 * 内容却是**空串**（`?raw`、`as: 'raw'`、`../**\/*.css` 三种写法都试过，全是 0 长度）——
 * vitest 对 `.css` 有自己的资产处理，抢在 `?raw` 之前。
 * 与其为一条断言去装 jsdom / 改构建配置，不如让 `pnpm run build` 顺手跑这个脚本：
 * **它拦的是"后来者一个 border: 2px 把层次又抹平"**，而那件事必须有人拦。
 *
 * 用法：`node scripts/check-style.mjs`（已挂在 `npm run build` 前面）。
 *
 * ## 它守什么（背景）
 *
 * M2 收尾时把全站边框数了一遍：**13 类元素用 2px 以上的纯墨粗边框**，
 * 剩下 8 类也不过 1.5px —— 整个界面只有"响"和"比较响"两档、**没有安静的那一档**，
 * 满屏都在喊；再加上"每张卡片右下都有 3~4px 实心墨影"，同一种重量铺满整块屏幕。
 * 玩家的原话是"看久了有点疲劳，一点都不高级"。
 *
 * 修法是分三档（2.5px 锚点 / 1.5px 内容行 / 1px 控件）+ 影子只给真正浮起来的东西，
 * **色相一个都没动**（§5A 的纸底 / 墨色 / 朱红是拍板的）。
 * 这个脚本钉住那个成果。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '..', 'src', 'style.css');
const css = readFileSync(cssPath, 'utf8');
/** 末尾补一个换行：这个文件在 git 里是 CRLF，末尾有可能缺换行，会让"读末尾"的检查漏掉一条规则 */
const cssText = css.endsWith('\n') ? css : `${css}\n`;

/*
 * 两处 TypeScript 源码的原文。第 ⑤ 条守卫要看它们 ——
 * "手势归我们"这条约定**跨三个文件**（这个 CSS 决定让不让，drag.ts 决定接不接得住，
 * OrganizeScreen.ts 决定把哪一块容器交给它滚），只查 CSS 只能看见三分之一。
 */
const dragSrc = readFileSync(join(here, '..', 'src', 'ui', 'drag.ts'), 'utf8');
const organizeSrc = readFileSync(join(here, '..', 'src', 'ui', 'OrganizeScreen.ts'), 'utf8');

const failures = [];
const note = (message) => failures.push(message);

/** 字符偏移 → 行号（报错信息里要说清"哪一行"，不然等于没报） */
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** 去掉注释，免得注释里引用的示例规则被当成真规则数进来 */
const code = cssText.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 把 `选择器 { 声明 }` 逐块解析出来。
 *
 * ★ 刻意**不用**"逐行记住上一个选择器"那种写法 —— 第一版就是那样，
 * 结果把 `border-width` 这类覆盖也当成了粗边框声明，账算成 17 类（真值是 15 类，
 * 而且含了很多来自逗号选择器列表的错配）。花括号配对是这里唯一稳的读法：
 * 它同时正确处理 ① 逗号选择器列表 ② 嵌套的 `@media` ③ 多条声明写在一行。
 *
 * 简化假设（对这份样式表成立）：字符串与 data-URI 里没有裸的 `{` `}`。
 * `--paper-noise` 那条 data-URI 用的是 `%3C` / `%3E` 转义，所以不会破坏配对。
 */
function eachRule(source, visit) {
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = -1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      if (depth === 0) {
        selectorStart = selectorStart;
        bodyStart = i + 1;
      }
      depth += 1;
      continue;
    }
    if (ch !== '}') continue;
    depth -= 1;
    if (depth !== 0) continue;
    const selector = source.slice(selectorStart, bodyStart - 1).trim();
    const body = source.slice(bodyStart, i);
    visit(selector, body);
    selectorStart = i + 1;
  }
}

/** 逗号选择器列表 → 单个类名（只取 `.xxx` 那部分，忽略伪类 / 后代选择器） */
function selectorNames(selector) {
  const names = [];
  for (const part of selector.split(',')) {
    const m = /\.([a-zA-Z][\w-]*)/.exec(part.trim());
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * 结构性色块：它们**不是"一排排重复出现的内容"**，所以不参与"粗边框种类数"的账。
 *
 * 这一条是量法修正，不是放水：真正造疲劳的是**同一种重量被重复铺满屏幕**
 * （24 个格子、一屏 7 行货、3 张卡并排）。而下面这几个各只有一处、而且承担的是
 * "把屏幕切成几块"的结构职责 —— 把它们数进去，等于逼着页面失去骨架：
 *
 *   · topbar / dock —— 页面上下两条边（一个顶栏、一个底栏，各一处）；
 *   · drawer-body   —— 纸胶带抽屉（浮层，本来就该重）；
 *   · calendar-strip —— 开局那一根日历条（一屏一处）。
 */
const STRUCTURAL = new Set(['topbar', 'dock', 'drawer-body', 'calendar-strip']);

/**
 * 解一遍层叠：每个元素**最终生效**的 border 与 box-shadow 是什么。
 *
 * ★ 这一版才是对的。第一版是"只要有一条规则写了粗边框就算它响" ——
 * 可 CSS 是**层叠**的：后面那条 `border: 1.5px` 才是生效值。
 * 于是它把"已经被降级的元素"也报成响的（13 类里有 9 类是假账），
 * 一个满嘴假账的守卫比没有守卫更糟：人会学会忽略它。
 *
 * 只做本文件真正用到的两件事：
 *  · 按源码顺序记下每个类**最后一次**出现的 `border`（简写）或 `border-*`（单边）；
 *  · 同样记下最后一次 `box-shadow`。
 * `@media` 里的规则也一起算（它们同样是样式表的一部分），
 * 不做"这个视口下到底哪条生效"的精确求解 —— 对"数一数种类"这件事够用。
 */
function resolveCascade(source) {
  const border = new Map(); // 类名 → { full?: string, sides: Set<string>, setAt: number }
  const shadow = new Map();
  let order = 0;

  eachRule(source, (selector, body) => {
    order += 1;
    const names = selectorNames(selector);
    if (names.length === 0) return;

    const full = /(?:^|;)\s*border\s*:\s*([^;]+)/.exec(body);
    const sides = [...body.matchAll(/(?:^|;)\s*border-(top|bottom|left|right|width|color|style)\s*:\s*([^;]+)/g)];
    const sh = /(?:^|;)\s*box-shadow\s*:\s*([^;]+)/.exec(body);

    for (const name of names) {
      if (full || sides.length > 0) {
        const prev = border.get(name) ?? { sides: new Set(), setAt: -1 };
        // 简写会重置单边；单边只覆盖自己那一边 —— 但这里只关心"宽度 + 颜色"的整体印象，
        // 所以记简写值；没有简写时用最后一次 border-width / border-color 组合
        const next = {
          full: full ? full[1].trim() : prev.full,
          sides: new Set([...prev.sides, ...sides.map((m) => `${m[1]}:${m[2].trim()}`)]),
          setAt: order
        };
        if (full) next.sides = new Set();
        border.set(name, next);
      }
      if (sh) shadow.set(name, sh[1].trim());
    }
  });

  return { border, shadow };
}

/** 某元素最终生效的 border 里，宽度是不是 2px 以上、颜色是不是纯墨 */
function isLoudBorder(entry) {
  if (!entry) return false;
  const text = entry.full ?? [...entry.sides].join(';');
  const width = /(?:^|[:\s])(2|2\.5|3)px/.exec(text);
  if (!width) return false;
  // 颜色：简写里直接看；没有简写时看 border-color 那一边
  const hasInkColor = /var\(--ink\)/.test(text);
  return hasInkColor;
}

const { border: resolvedBorder, shadow: resolvedShadow } = resolveCascade(code);

// ———————— ① 粗边框不许失控（只数重复出现的内容，且只数**最终生效**的） ————————
const loud = new Set();
for (const [name, entry] of resolvedBorder) {
  if (STRUCTURAL.has(name)) continue;
  if (isLoudBorder(entry)) loud.add(name);
}
const LOUD_MAX = 9;
if (loud.size > LOUD_MAX) {
  note(
    `最终生效的"2px 以上纯墨边框"有 ${loud.size} 类（上限 ${LOUD_MAX}）：${[...loud].sort().join(', ')}\n` +
      `    → 超了就退回"满屏都在喊"。降一档（内容行 1.5px var(--ink-40) / 控件 1px）即可。\n` +
      `    → 如果新加的这一类确实是"结构性色块"（一屏只有一处、负责切分屏幕），把它加进 STRUCTURAL。`
  );
}

// ———————— ② 实心墨影只给真正浮起来的东西（同样只看最终生效值） ————————
/**
 * 允许带实心墨影的类。
 *
 * ★ 三个"例外"都写清理由，因为这个名单一旦变成"随手往里加"的垃圾桶，
 * 守卫就没了：
 *
 *  · `tape-drop` —— **拖拽幽灵的一部分**：它就是那段跟着手指走的胶带
 *    （`.drag-ghost` 的子元素）。守卫按类名匹配、看不到父子关系，所以要显式列。
 *    排一排的胶带**不许**带影子；
 *  · `tape-chip` —— 只有 `.is-lifted`（**被拿起来的那一张**）带影子。
 *    同样：常态那一排不带（`.tape-chip` 的基样式里没有 `box-shadow`）；
 *  · `add-picks` —— 「加哪一种？」那个**锚定弹层**。它是浮在工具栏上方的一小块
 *    （`position: absolute; bottom: 100%`），与抽屉同一类东西 ——
 *    而它**同时只有一个**（点开才有），所以不会出现"一排东西同时浮起来"。
 *    它原来挤在工具栏那一行里，那条路已经因为窄屏重叠被删掉了。
 */
const SHADOW_OK = new Set([
  'drag-ghost',
  'drawer-body',
  'zone-tape',
  'tape-slot',
  'shelf-card',
  'identity-card',
  'tape-drop',
  'tape-chip',
  'add-picks'
]);
const shadowed = new Set();
for (const [name, value] of resolvedShadow) {
  if (SHADOW_OK.has(name)) continue;
  if (value === 'none' || !/var\(--ink/.test(value)) continue;
  shadowed.add(name);
}
if (shadowed.size > 0) {
  note(
    `最终仍有实心墨影、但不该有的元素：${[...shadowed].sort().join(', ')}\n` +
      `    → "看起来浮起来"只能给真正浮起来的东西（拖拽幽灵 / 抽屉 / 锚点卡片）。\n` +
      `    → 成排出现的卡片（商店、纸箱、夜间选项）带影子 = 一排东西同时浮起来，那个隐喻就没有意义了。`
  );
}

// ———————— ③ 层次覆盖块必须在文件最末尾 ————————
// 同权重下 CSS 靠"后来者赢"，那片覆盖块一旦被挪到前面，就会被
// `.good { border: 2px … }` 这类简写盖掉（实测过，所以这条是硬要求）。
const tail = code.slice(-2400);
const tailChecks = [
  // 注意选择器**可以是多行的**（`.good,` `.trade-item,` `.box,` … `{`），
  // 所以这里用"从 `.good,` 到 `{` 之间不能出现 `}`"来表达，而不是写死接哪一行
  [/\.good,[^{}]*\{\s*\r?\n\s*border:\s*1\.5px/, '内容行降级（.good → 1.5px 次黑）'],
  [/\r?\n\s*border:\s*1px solid var\(--ink-40\)/, '控件降级（→ 1px）'],
  [/\.btn-primary\s*\{\s*\r?\n\s*border-color:\s*transparent/, '实心按钮去边框（.btn-primary）'],
  [
    /\.box,[^{}]*\.shop-card,[^{}]*\.night-option[^{}]*\{\s*\r?\n\s*box-shadow:\s*none/,
    '影子收敛（.box / .shop-card / .night-option）'
  ]
];
for (const [re, label] of tailChecks) {
  if (!re.test(tail)) {
    note(`样式表末尾缺少「${label}」那条规则 —— 层次覆盖块被挪走或被覆盖了。`);
  }
}

// ———————— ④ 色相没被动过，也没有漏网的纯白 ————————
for (const [value, label] of [
  ['--paper: #f7f3ea', '纸底'],
  ['--ink: #2c2c2a', '墨色'],
  ['--vermilion: #c8372d', '朱红']
]) {
  if (!cssText.includes(value)) note(`§5A 拍板的${label}（${value}）被改了 —— 色相不该在"做层次"时被动。`);
}
const strayWhite = code.split('\n').filter((l) => /^\s*background:\s*#fff\s*;/.test(l));
if (strayWhite.length > 0) {
  note(`还有 ${strayWhite.length} 处硬编码 background:#fff —— 纯白在纸底上不是纸，用 var(--card)。`);
}

// ———————— ⑤ 可拖拽元素必须"管住浏览器的默认手势"，而且不许被选走 ————————
/*
 * ★★ 这一条修过**四次**，四次的原因各不相同（值得读完再改）。
 *
 * **第一次（写这条守卫的原因）**：格子原来没设 `touch-action`，浏览器按默认策略
 * 认为"这块区域可以滚动页面"，于是手指按住并移动几像素后会**接管**手势去滚动，
 * 同时发 `pointercancel` —— 我们这边收到就按"被打断"收尾。
 * 玩家报的"手机上拖拽完全不跟手、拖出极小的范围就断"正是这个，
 * 而拖拽诊断日志把它量成了"每约 6px 一次 cancelDrag"。
 *
 * **第二次（2026-10 玩家报的"划不动"）**：`none` 的意思不只是"别抢我的拖拽"，
 * 它是"**这块区域永远不参与滚动**"。而整理页上格子几乎铺满整块可滚区 ——
 * 于是能滚的地方只剩货架卡之间的缝，手指落在格子上就一动不动。
 * 玩家原话："我很难划到下面的格子和其他的架子（除非手指刚好放在货架边缘）"。
 *
 * **第三次（2026-10 玩家报的"正常的拖动又不正常了"）**：`manipulation` 让浏览器
 * 接管纵向手势去滚，可它照样会发 `pointercancel` —— 而我们的长按计时器还活着，
 * 300ms 一到 `beginDrag` 照常开拖。玩家看到的是一个不跟手的幽灵。
 *
 * **第四次（2026-10 玩家报的"方向是反的 / 两层逻辑"）**：第三次的修法是
 * `none` + **我们自己滚**（`drag.ts` 的 `takeOverScroll` 往 `roomEl.scrollTop` 写），
 * 而 `.room-scroll` 当时带着 `-webkit-overflow-scrolling: touch` ——
 * 那块区域是**合成层滚动容器**，浏览器自己也在滚。同一次滑动上两层同时存在，
 * 我们看到的 `scrollTop` 取决于合成器此刻的进度，于是方向时对时反。
 * 玩家原话："好像跟正常的上滑下拉是两层逻辑（**他们俩都存在**）"。
 * → 修法是"把滚动整个交回浏览器"（`pan-y`、一次都不写 `scrollTop`）。
 *
 * **第五次（2026-10 玩家一小时后报的"从箱子里拖出东西，出一个极小的范围就消失"）**：
 * 第四次那个修法**方向对了、代价错了** —— `pan-y` 的语义是"允许浏览器纵向滚
 * 这块区域"，而浏览器一旦接管纵向手势就发 `pointercancel`，把**拖拽**一起收掉。
 * 长按成立、幽灵刚出来，手指一往下挪就没了。拖拽是整理页的**主操作**，
 * 这个代价换不起。
 *
 * ## 所以现在的口径是「**这一块像素上，同一时刻只允许有一层逻辑**」（别再往回改）
 *
 * 第五次是**第四次与第三次的合成**，而不是回到第三次：
 *  · 滚动归我们（`.slot` / `.box` 是 `touch-action: none`，
 *    `scrollHost` / `takeOverScroll` 都在，`touchmove` 按着手势 `preventDefault`）；
 *  · **同时**把合成层那一行摘掉（第 ④ 条）—— 第三次之所以失败，
 *    是因为那两层叠在了一起，**不是因为"自己滚"这个决定错了**。
 *
 * ## 真正要守的是七条
 *
 *  ① `.slot` / `.box` **显式**写着 `touch-action: none` ——
 *     "没写"会让浏览器在**任何方向**上接管（第一次那个 bug）；
 *     写 `pan-y` / `manipulation` 会让浏览器**纵向**接管并发 `pointercancel`
 *     （第五次那个 bug：拖一点点就消失）；
 *  ② 既然滚动归我们，**手势层必须真的在滚**：`drag.ts` 里要有 `takeOverScroll`、
 *     `scrollHost`、以及 `touchmove` 的 `preventDefault` —— 三条缺一条，
 *     竖向滑动就会变成"谁都不管"（手指落在格子上划不动，第二次那个 bug）；
 *  ③ `.slot` / `.box` 上写着 `user-select: none`：拖拽起手就是一次按住并移动，
 *     不写它的后果是"从箱子里拖出东西的时候会复制粘贴箱子的名字"（玩家 2026-10 原话）；
 *  ④ 被滚的那块容器**不许**带 `-webkit-overflow-scrolling: touch` ——
 *     它就是"合成层滚动容器"的开关，而**主线程拦不住合成器**。
 *     这一条单独看很无辜（这行在 2026 年前后的移动端文章里到处都是），
 *     但它正是第四次那个 bug 的**另一半**：有它，我们写不写 `scrollTop` 都会有两层。
 *  ⑤ 滚动容器身上要有 `data-scroll-host` 标记：手势层靠它回答"往哪儿滚"
 *     （见 `drag.ts` 的 `resolveScrollHost`）。★ 用**标记**而不是
 *     `scrollHeight > clientHeight`，是因为假 DOM 算不出后者 ——
 *     而算不出的判据等于"这条分支永远没被测过"。
 *  ⑥ `.tape-chip` 也必须是 `none`：它同样是拖拽起点，理由与 `.slot` 一模一样
 *     （原来写的是 `pan-x pan-y`，那正是第五次那个 bug 的形状）。
 *  ⑦ ★★ **`.room-scroll` 自己也必须是 `none`** —— 这一条是第七次才补上的，
 *     而它才是"滑动还是反的"那个 bug 的**最后一层**。
 *
 *     前面六条全绿的时候玩家还在报"滑动还是反的"，真无头 Chrome 里量出来的
 *     原因是：`touch-action` **只对它被声明的那块像素生效、不继承**。
 *     格子（`.slot`）写着 `none`，而格子**之间的缝 / 货架卡的内边距 / 卡片之间**
 *     那些像素仍然是 `auto` —— 于是同一块屏幕上真有两个写着相反方向的写者：
 *        · 落在格子上 → 我们接管，`scrollTop = before + deltaY`（+160，跟手）
 *        · 落在缝里   → 浏览器原生滚动（-160，与手指相反，日志里 `pointercancel`）
 *     玩家撞上哪一层决定他看到哪个方向，这就是它为什么能活过前两轮修复。
 *
 *     ⚠ 这一条**不能靠"格子上写了 none"顶上**：`.slot` 是 `.room-scroll` 的孙子，
 *       而 `touch-action` 不是继承属性 —— 只要容器自己还是 `auto`，
 *       缝里的那些像素就永远归浏览器。
 *
 *     ★ 复验办法（**这是唯一能证明它有效的证据**，别再靠读代码推断）：
 *       `npx vite-node scripts/_probe-scroll-two-writers.ts`（需要 dev 服务在跑，
 *       `APP_URL` 默认 `http://127.0.0.1:5199/`；`VIEWPORTS=375x667`）。
 *       它派发**真触摸事件**，逐 40px 记 `scrollTop`，四格都要"与手指同向"
 *       （格子上/缝里 × 往下/往上）。撤掉这一行的话，"缝里"那两格会立刻翻成反向。
 */
for (const cls of ['room-scroll', 'slot', 'box', 'tape-chip']) {
  /*
   * ⚠ 用"这条长规则里有没有出现这个属性"而不是"值等于某个字符串"：
   *   一个类在样式表里有多条规则（基样式 + 窄屏档），只认某一种写法会误报。
   * ⚠ 选择器部分不许跨过 `{` / `}`：窄屏档里 `.box { … }` 嵌在
   *   `@media (…) { … }` 内，贪心匹配会从媒体查询的 `{` 一路吃到 `.box` 的 `{`。
   */
  const rules = new RegExp(`\\.${cls}(?![\\w-])[^{}]*\\{[^}]*\\}`, 'gs');
  const bodies = code.match(rules) ?? [];
  const touchRule = bodies.find((b) => /touch-action\s*:/.test(b)) ?? '';
  const hit = /touch-action\s*:\s*([a-z-]+)/.exec(touchRule);
  if (!hit) {
    note(
      `.${cls} 没有写 touch-action —— 触摸设备上从这个元素起手的拖拽会被浏览器抢去滚动，\n` +
        `    表现为"完全不跟手、拖一点点就断"，而且不会有任何报错。`
    );
  } else if (hit[1] !== 'none') {
    note(
      `.${cls} 的 touch-action 是 ${hit[1]}，不是 none。\n` +
        `    · 写 pan-y / manipulation：浏览器会**纵向接管**这次手势并发 pointercancel,\n` +
        `      把长按起手的拖拽在几个像素内收掉（玩家 2026-10 报的\n` +
        `      "从箱子里拖出东西，出一个极小的范围就会消失"）；\n` +
        `    · 写别的值或不写：浏览器会在**任何方向**上接管（"拖一点点就断"）。\n` +
        `    代价一侧是"滚得爽"，另一侧是"拖不动"——拖拽是这一屏的主操作。\n` +
        `    口径见 src/style.css 的 .slot 那一大段。`
    );
  }
  if (!bodies.some((b) => /user-select\s*:\s*none/.test(b)) && cls !== 'tape-chip') {
    note(
      `.${cls} 上没有 user-select: none —— 从它起手拖动 = 一次文本选择，\n` +
        `    松手后剪贴板里就躺着那一格/那个箱子的名字（玩家 2026-10 报的"复制粘贴箱子的名字"）。\n` +
        `    （main.ts 的剪贴板守卫是第二道防线，但"选不中"必须在这里就成立。）`
    );
  }
}

/*
 * ★ ②的守卫：**手势层必须真的在滚**（第五次定稿）。
 *
 * ★★ 这一条**翻过两次方向**，两次都是跟着口径走，不是跟着守卫走：
 *  · 最初（第三次）：要求有 `takeOverScroll` / `scrollHost` / `touchmove`；
 *  · 第四次改成反例（那三条一起构成"两层逻辑"）；
 *  · 第五次（现在）又要求它们回来 —— 因为把滚动交回浏览器的代价是
 *    **拖拽被 `pointercancel` 收掉**，而那个毛病比"滚得爽"重。
 * ★ 关键区别：这一次**同时**要求第 ④ 条（合成层那一行不在）——
 *    第四次失败的原因是两层叠在一起，不是"自己滚"这个决定。
 *
 * ⚠ 探针必须跑在**去掉注释之后的源码**上。这几个词全都会出现在说明性注释里
 * （那正是它们的价值：后人要能查到为什么这么定），直接对整个文件做正则会把
 * 解释本身判成违规 —— 而这会逼着后人删掉解释，比不设守卫更糟。
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const dragCode = stripComments(dragSrc);
const organizeCode = stripComments(organizeSrc);
const TAKEOVER_SIGNS = [
  [
    'takeOverScroll（手势层写 scrollTop 的那一个函数）',
    () => /function\s+takeOverScroll\s*\(/.test(dragCode),
    '没有它，手指落在格子上时竖向滑动**谁都不管**：浏览器被 `touch-action: none` 挡住了，\n' +
      '    我们也不写 `scrollTop` —— 玩家报的"很难划到下面的格子和其他的架子"就是它。'
  ],
  [
    'scrollHost（这次手势滚哪一块容器）',
    () => /\bscrollHost\b/.test(dragCode),
    '接管滚动总要有人回答"滚谁"。'
  ],
  [
    'touchmove 的 preventDefault（手势进行中按掉原生滚动）',
    () => /addEventListener\(\s*'touchmove'/.test(dragCode) || /handleTouchMove/.test(dragCode),
    '没有它，一次拖拽会同时把页面也往上拽（iOS 的橡皮筋能穿过 `touch-action`），\n' +
      '    玩家看到幽灵与页面一起动。'
  ],
  [
    'data-scroll-host（滚动容器的标记）',
    () => /data-scroll-host/.test(organizeCode),
    '手势层靠这个属性找容器（见 `resolveScrollHost`）。★ 它是**属性**而不是尺寸判据，\n' +
      '    因为假 DOM 算不出 `scrollHeight > clientHeight` —— 算不出的判据等于没被测过。'
  ]
];
for (const [label, probe, why] of TAKEOVER_SIGNS) {
  if (!probe()) {
    note(
      `ui/drag.ts 或 ui/OrganizeScreen.ts 里找不到 ${label} —— 接管滚动的那一套不完整了。\n` +
        `    ${why}\n` +
        `    口径：**这一块像素上，同一时刻只允许有一层逻辑** —— 滚动归手势层，\n` +
        `    但合成层那一行必须摘掉（第 ④ 条）。见 src/style.css 的 .slot 那一大段。`
    );
  }
}
/*
 * ⚠ 这里**刻意不**设"`OrganizeScreen.ts` 里不许出现 scrollTop"这一条守卫。
 *
 * 它看起来像是同一件事的判据，其实不是：`renderRoom` 里有合法的一对
 * "重绘前记下 `roomEl.scrollTop`、重绘后写回去"（`:840` / `:874`）——
 * 中间是一次 `innerHTML` 整块换，不记的话每次放下东西都会跳回顶部。
 * 那对读写发生在**重绘的同步过程里**，不与任何手势并行，
 * 所以它不是"第二层滚动"。
 *
 * 判"有没有第二层"要看的是**并行的那一条链路**：接管滚动的函数、传进来的滚动宿主、
 * 以及 `touchmove` 的 `preventDefault`（上面三条），
 * 外加被滚容器的 `-webkit-overflow-scrolling`（下面 ④）。
 * 抓 `scrollTop` 这个字符串会把这个合法的写法一起误报 ——
 * 而**误报会让人开始改守卫**，那比漏报更贵。
 */

/*
 * ★ ④：被滚的那几块容器不许带 `-webkit-overflow-scrolling: touch`。
 *
 * 这一行在移动端文章里到处都是（"开启惯性滚动"），所以它**看起来完全无害** ——
 * 但它把这块区域提升成合成层滚动容器，滚动从此由合成器驱动。
 * 第四次那个 bug 的两半里，一半是"我们自己写 scrollTop"，另一半就是它。
 *
 * ★ 第五次之后名单里多了 `.dock-boxes`：纸箱那一叠自己也成了滚动容器
 * （它现在是 `data-scroll-host`，手势层会往它的 `scrollTop` 写），
 * 于是它带着这一行的话会**原地复发**同一个 bug。
 * ★ 第六次（M5）它不再是 `data-scroll-host` 了（见下面 ⑤ 那一段），
 * 但**它仍然是一块能滚的区域**，所以这一条对它照样成立：只要它还可能被谁滚，
 * 带上 `-webkit-overflow-scrolling` 就是在给自己准备一次"方向反了"。
 * 顺手也守住 `.slot` 自己：格子不是滚动容器，带上它只会让祖先里多一个合成层。
 */
for (const cls of ['room-scroll', 'dock-boxes', 'slot']) {
  const rules = new RegExp(`\\.${cls}(?![\\w-])[^{}]*\\{[^}]*\\}`, 'gs');
  const bodies = code.match(rules) ?? [];
  if (bodies.some((b) => /-webkit-overflow-scrolling\s*:\s*touch/.test(b))) {
    note(
      `.${cls} 上又出现了 -webkit-overflow-scrolling: touch —— 它把这块区域变成\n` +
        `    **合成层滚动容器**，滚动由合成器驱动，而**主线程拦不住合成器**。\n` +
        `    2026-10 玩家报的"方向是反的"正是它与"我们自己写 scrollTop"叠出来的两层。\n` +
        `    这条在移动端文章里到处都是、单独看完全无害，所以必须由守卫记着。`
    );
  }
}

/*
 * ★ ⑤：滚动容器身上要有 `data-scroll-host` —— 守卫**两侧**都要看。
 *
 * 只看 `OrganizeScreen.ts` 里有没有这个字符串是不够的：真正会出事的局面是
 * "模板里给容器加了类名、却忘了加标记"，于是 `resolveScrollHost` 返回 `null`、
 * 竖向滑动悄悄退化成"什么都不做"。所以这一条同时要求：
 *  · `style.css` 里那个类的规则在（容器存在）；
 *  · `OrganizeScreen.ts` 里 `class="… <那个类> …"` 的那个标签上带着标记。
 *    ★ 判据是"**同一个标签**里两个都在"，不是"两个字符串都在文件里" ——
 *      后者在把标记加到错误的元素上时照样会绿。
 *
 * ★★ **第六次（M5）：`.dock-boxes` 从名单里拿掉了** —— 这是一个取舍，不是疏漏。
 *
 * 它从第五次开始带着 `data-scroll-host`，理由是"它自己 `overflow-y: auto`"。
 * 结果是屏幕上**同时有两个能滚的窗口**：手指落在纸箱上动的是纸箱那一栏，
 * 推到货架上动的才是整页。玩家报的原话是"滑动方向是反的"—— 他看到的不是方向错了，
 * 是**滚的东西不一样**。于是全屏只留 `.room-scroll` 一处滑动（那段注释在
 * `OrganizeScreen.ts:247` 一带）。
 *
 * 代价要说清：手指落在**纸箱上**的竖向滑动不再滚 `.dock-boxes`（`.box` 自己
 * `touch-action: none`）；缝里、四个按钮上、手里那块牌子上都还能滚。
 * "纸箱那一栏一滚就朝反方向跳"这个毛病，比"少一个滚动入口"重得多。
 *
 * ⚠ 这一条因此**不能**笼统地写成"每个滚动容器都要注册"：那样会把手势层逼回两层逻辑。
 */
for (const cls of ['room-scroll']) {
  const tagRe = new RegExp(`<[a-z]+[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'g');
  const tags = organizeSrc.match(tagRe) ?? [];
  if (tags.length === 0) {
    note(
      `OrganizeScreen.ts 里找不到带 class="${cls}" 的标签 —— 守卫无法确认它是不是滚动容器。\n` +
        `    若这个类被改名了，请把这一条一起改（守卫读错了地方会比不设守卫更糟）。`
    );
  } else if (!tags.some((t) => /\bdata-scroll-host\b/.test(t))) {
    note(
      `class="${cls}" 的那个标签上没有 data-scroll-host —— 手势层找不到它，\n` +
        `    于是落在里面的竖向滑动**谁都不管**（浏览器被 touch-action: none 挡住，我们也不知道滚谁）。\n` +
        `    标记写在容器自己身上，见 drag.ts 的 resolveScrollHost。`
    );
  }
}

// ———————— ⑥ 覆盖层必须"不吃指针事件" ————————
/*
 * `.drag-ghost` 上必须有 `pointer-events: none`。
 *
 * 玩家报过一个很反直觉的现象："把 A 正正好好放在 B 上反而判定不到，
 * 边缘一圈就能交换"。机制是：幽灵跟着指针、**正好在指针底下**，
 * 而 `elementFromPoint` 命中的是最上层元素 —— 幽灵当时**是可命中的**，
 * 于是被命中的是幽灵而不是格子；只有指针偏到幽灵外面才轮到下面的格子。
 *
 * ★ 关键知识点：`pointer-events` **不是继承属性**。
 * 幽灵挂在 `pointer-events: none` 的 `.fx-layer` 里并**不能**让它免于命中 ——
 * 它必须**自己**写这一条。我第一版就是漏了它（漏的原因正是以为会继承）。
 *
 * 落点判定、悬停预览、`data-drop` 检测全都依赖 `elementFromPoint`，
 * 所以这条一旦被删，整个拖拽都会退回"放不下去"，而且不会有任何报错。
 */
const POINTER_EVENTS_NONE_REQUIRED = ['drag-ghost'];
for (const cls of POINTER_EVENTS_NONE_REQUIRED) {
  const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*pointer-events\\s*:\\s*none`, 's');
  if (!rule.test(code)) {
    note(
      `.${cls} 缺少 pointer-events: none —— 它会挡住底下的格子，\n` +
        `    表现为"正正好好放上去反而判定不到、边缘一圈才行"。\n` +
        `    注意：pointer-events 不是继承属性，光靠父层 .fx-layer 的 none 不管用。`
    );
  }
}

// ———————— ⑦ `scripts/*.mjs` 必须是纯 JS（TS 语法会在运行期炸，而 tsc 看不见） ————————

/**
 * ## 它拦的是哪一类错（同一个坑我踩了四次）
 *
 * `scripts/*.mjs` 是**纯 JavaScript**，但它们常常 import `src/` 的 TS 模块
 * 并靠 `vite-node` 跑。于是写 TS 语法（`as const`、`x: string[]`、
 * `interface`、`new Set<string>()`）时：
 *
 *   · `tsc --noEmit` **看不见** —— `tsconfig.json` 的 `include` 只有
 *     `["src", "vite.config.ts"]`，而 `scripts/` 不在里面（那是刻意的：
 *     脚本用 `node:` 前缀的 import，纳进来就得引 `@types/node`，而本项目零依赖）；
 *   · 于是它一路过掉 typecheck，直到**真的跑那个脚本**才以
 *     `RollupError: Expected ',', got 'ident'` 的形式炸出来，
 *     而报错只给一个字符偏移（`pos: 901`），要自己 `slice` 才看得到现场。
 *
 * 踩过的四次：`type ContentKind` 的 import、`as const`、`new Set<string>()`、
 * 以及一次类型标注。**每一次都发生在"刚写完一个新脚本、还没跑过"的时候**，
 * 而每一次的代价都是"跑一次、看报错、改、再跑"。所以它值得从
 * "我记得别写"变成"机器记得"。
 *
 * ## 判据：先剥掉字符串与注释，再找 TS 专有语法
 *
 * ★ 顺序不能反。"先找关键词再除掉注释"会把**注释里举例的 TS 写法**
 * 也判成违规（本文件上面那段就写着 `as const`），那就成了一条会自己咬人的守卫。
 */
function stripCommentsAndStrings(text, state = { inStr: null, inBlock: false }) {
  let out = '';
  let inLine = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      out += ' ';
      continue;
    }
    if (state.inBlock) {
      if (c === '*' && next === '/') {
        state.inBlock = false;
        i++;
      }
      out += ' ';
      continue;
    }
    if (state.inStr) {
      if (c === '\\') {
        out += '  ';
        i++;
      } else {
        if (c === state.inStr) state.inStr = null;
        out += ' ';
      }
      continue;
    }
    if (c === '/' && next === '/') {
      inLine = true;
      i++;
      out += '  ';
      continue;
    }
    if (c === '/' && next === '*') {
      state.inBlock = true;
      i++;
      out += '  ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      state.inStr = c;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

/** `.mjs` 里不该出现的 TS 专有语法（写成"报什么错、怎么改"） */
const TS_IN_MJS = [
  [/\bas\s+const\b/g, '`as const` 是 TS 语法', '改成普通数组 / 对象；类型靠 JSDoc 或不写'],
  [/\bsatisfies\s+[A-Z]/g, '`satisfies` 是 TS 语法', '同上'],
  [/\binterface\s+[A-Z]/g, '`interface` 是 TS 语法', '改用注释说明形状'],
  [
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$[]/g,
    '变量声明带了类型标注',
    '去掉 `: 类型`'
  ],
  [/\bnew\s+[A-Za-z_$][\w$]*\s*</g, '泛型实例化（`new Set<string>()`）', '去掉 `<...>`'],
  [/\btype\s+[A-Za-z_$][\w$]*\s*=/g, '`type X = …` 是 TS 语法', '改用注释或 JSDoc'],
  /*
   * ★ 泛型**类型实参**：`x.reduce<Record<string, number>>(…)` / `.map<Foo>(…)`。
   *
   * 这一条是补的，而且是**真的漏了一次**才补的：我在 `make-save.mjs` 里写了
   * `shelves.reduce<Record<string, number>>(…)`，而上面那六条一条都没抓到 ——
   * 它们只认 `new X<…>`（实例化），不认"调用一个方法时给它类型实参"。
   * 结果是 `vite-node` 抛 `'const' declarations must be initialized`，
   * 报错指向一个字符偏移，看不出是哪一行。
   *
   * 判据：`标识符.标识符<` 后面**紧跟**一个大写字母或 `{`（类型实参的样子）。
   * ⚠ 中间**不许有空格**：`run.day > SURVIVAL_DAYS` 这种比较会被
   * `\s*<` 误伤（我第一版就是那么写的，它把 `stress.mjs` 里一行普通的
   * 范围比较报成了泛型）—— **"小于号"与"泛型"的区别就在这里**。
   */
  [
    /\.\w+<(?:\{|[A-Z])/g,
    '泛型类型实参（`x.reduce<Record<string, number>>(…)`）',
    '去掉 `<...>`：`.mjs` 是纯 JS，类型靠注释'
  ]
];

const scriptsDir = join(here);
const scriptNames = readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs'));
for (const name of scriptNames) {
  const raw = readFileSync(join(scriptsDir, name), 'utf8');
  const rawLines = raw.split('\n');
  /*
   * ★ 剥注释/字符串的**状态必须跨行传递**。逐行独立剥会让多行块注释的
   * 中间行被当成代码 —— 我第一版就是那么写的，于是**这份守卫自己那份文档注释里**
   * 的 `const a = [1, 2] as const;` 与 `let b: string[] = [];` 被报成了违规。
   * 那种守卫比没有守卫更坏：它会逼着后来者去改一段根本没问题的注释。
   */
  const state = { inStr: null, inBlock: false };
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const body = stripCommentsAndStrings(line, state);
    if (body.trim().length === 0) continue;
    for (const [re, what, how] of TS_IN_MJS) {
      re.lastIndex = 0;
      if (!re.test(body)) continue;
      note(
        `scripts/${name}:${i + 1} 写了 TS 语法（${what}）：${line.trim()}\n` +
          `      → ${how}。\n` +
          `      ⚠ tsc 看不见 scripts/（不在 tsconfig 的 include 里），所以这行会一路过掉类型检查，\n` +
          `        直到真的跑这个脚本时才以 RollupError 炸出来（报错只给字符偏移，很难查）。`
      );
    }
  }
}

// ———————— ⑧ ★ 用到的 CSS 变量必须真的被定义过 ————————

/**
 * `var(--typo)` 不会报错，它**静默失效** —— 那条声明被丢掉，
 * 元素退回继承（或者干脆没有颜色/间距）。
 *
 * 我自己刚踩过一次：给新加的一行写了 `color: var(--ink-90)`，而本项目
 * 只有 `--ink-70 / --ink-40 / --ink-16 / --ink-08` 四档。
 * 屏幕上看起来"差别不大"，所以它**不会被眼睛发现** —— 而那正是
 * 值得让机器记着的那一类。
 *
 * ## 判据里有两条"故意放过"
 *
 *  ① `var(--x, fallback)` —— 有兜底值，读不到也不会坏事；
 *  ② ★ **内联设过的变量**（`style="--zone:red"` / `style.setProperty('--x', …)`）。
 *     这一条不能靠一张豁免名单：名单会过期，而"哪几个变量是内联的"
 *     是能从源码里**扫出来**的。所以本守则顺手扫一遍 `src/`，
 *     把代码里真的设置过的变量名收集起来。
 *
 *     ★ 这个假阳性是我第一版就撞上的：`--zone` 与 `--swatch` 都定义在
 *     `ui/zoneSheet.ts` 的内联 style 里，样式表里读它们是对的。
 *     **会误报的守卫活不过一周** —— 人一旦开始无视它，它就等于没有。
 */
const definedVars = new Set();
for (const m of code.matchAll(/(--[\w-]+)\s*:/g)) definedVars.add(m[1]);

/** 代码里内联设置过的 CSS 变量（`style="--x:…"` 与 `setProperty('--x', …)`） */
const inlineVars = new Set();
{
  const srcDir = join(here, '..', 'src');
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|css)$/.test(e.name)) {
        const text = readFileSync(p, 'utf8');
        for (const m of text.matchAll(/--[\w-]+\s*:/g)) inlineVars.add(m[0].replace(/\s*:$/, ''));
        for (const m of text.matchAll(/setProperty\(\s*['"](--[\w-]+)['"]/g)) inlineVars.add(m[1]);
      }
    }
  };
  walk(srcDir);
}

const undefinedVars = new Map();
for (const m of code.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
  const name = m[1];
  const hasFallback = m[2] === ',';
  if (hasFallback || definedVars.has(name) || inlineVars.has(name)) continue;
  undefinedVars.set(name, (undefinedVars.get(name) ?? 0) + 1);
}
if (undefinedVars.size > 0) {
  const list = [...undefinedVars.entries()].map(([n, c]) => `${n}（${c} 处）`).join('、');
  note(
    `样式表用了没定义过的 CSS 变量：${list}\n` +
      `    \`var()\` 读不到变量时**不报错**，那条声明被静默丢掉、元素退回继承 ——\n` +
      `    屏幕上"看起来差别不大"，所以只能靠这道守卫发现。\n` +
      `    已定义：${[...definedVars].sort().join(' ')}\n` +
      `    内联设置过（不算错）：${[...inlineVars].sort().join(' ')}`
  );
}

// ———————— ⑨ ★「飘着的东西」的类名必须与数据对得上（M4） ————————

/**
 * ## 它拦的是哪一类错
 *
 * `windowThemes.ts` 给每一场灾难定了一个 `fall`（snow / ash / rain / dust / none），
 * 而 `ui/windowBand.ts` 把 `windowScene` 作为类名挂在带子上，
 * 由 CSS 按 `.window-band.is-<scene> .window-band-fall` 决定画什么形状。
 *
 * **这中间有一层手写的名单**（CSS 不读 TS），所以它天然会漂：
 *  · 加一场雨类灾难，忘了往 CSS 名单里加 → **那一场的窗外没有雨**（静默）；
 *  · 改一场的 `fall`，CSS 名单没跟着改 → 画出来的是**另一种东西**（静默）。
 *
 * 两种都不会报错，只会让"看起来不一样"这件事悄悄少一点 ——
 * 所以在这里对账：**数据里说有雪的每一场，CSS 里都必须有线**。
 *
 * ⚠ vitest 读不到 `.css` 原文（§3.1），所以这条只能在这里跑。
 */
import { DISASTER_DEFS } from '../src/data/disaster.ts';
import { windowThemeOf } from '../src/data/windowThemes.ts';

const fallClasses = (kind) => {
  const names = DISASTER_DEFS.filter((d) => windowThemeOf(d).fall === kind).map((d) => `.window-band.is-${d.windowScene}`);
  return names;
};
const missingFall = [];
for (const kind of ['snow', 'ash', 'rain', 'dust']) {
  for (const cls of fallClasses(kind)) {
    /*
     * 判据：该场那一组**选择器列表**里必须有它的类名。
     *
     * ⚠ 第一版写的是"类名之后 400 字内出现 `window-band-fall {`"，而它**误报**：
     * 第一组只有 9 个选择器，第二组从 400 字之外才开始 —— 于是名单明明是对的，
     * 守卫却说它们没有线（`_regen-fall-css.ts` 刚生成完就被它判红）。
     * 现在改成"类名后面不许出现 `}`（= 还在同一个选择器列表里）"，
     * 长度不再参与判断。
     */
    const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}(?=[,\\s])[^}]*\\{`);
    if (!re.test(cssText)) missingFall.push(`${cls}（fall=${kind}）`);
  }
}
if (missingFall.length > 0) {
  note(
    `这些场次的「飘着的东西」在 CSS 里没有对应的类：\n      ${missingFall.join('\n      ')}\n` +
      `    → 它们的窗外会少一层形状（雪 / 灰 / 雨 / 尘），而**不会报错**。\n` +
      `    → 名单在 style.css 的 .window-band-fall 那几组选择器里，按 fall 类型分组。`
  );
}

// ———————— ⑩ ★★ CSS 注释必须配平（M4，2026-10：一个 `/*` 吞掉了 300 行） ————————

/**
 * ## 它拦的是哪一类错（这次真的踩了，而且**静默**得可怕）
 *
 * 用户在开局页怎么也看不到那条「窗外」的带子。查下去发现：
 * **注释开启符被吃掉了一个** —— 于是从那一行往下的**整块 CSS 都成了注释**，
 * 而 Chrome 对"多余的注释关闭符"的做法是**把它自己当语法错误的起点、
 * 把后面当作声明继续读**，结果就是那一大段规则
 * （含 `.window-band` 与 116 条 `.window-band.is-*`）**一条都没生效**。
 *
 * 页面上没有任何报错、构建也照样通过、`getComputedStyle` 只报
 * `height: 0px`（看起来像"没写样式"而不是"注释坏了"）。
 * 这正是纪律里 §2.9 那条记过的坑 —— 而**当时没有守卫**。
 *
 * 判据：全局扫一遍，注释开启符与关闭符必须严格交替且**配平**；
 * 另外禁止开启符出现在另一个注释内部（嵌套注释是 CSS 里最常见的自伤方式）。
 *
 * ⚠ 扫描时必须**跳过字符串**（`content: '/*'` 那种）——
 * 这份样式表里目前没有，但守卫要经得起将来加一条。
 */
{
  const problems = [];
  let depth = 0;
  let openAt = -1;
  let inString = null;
  for (let i = 0; i < cssText.length; i++) {
    const ch = cssText[i];
    const next = cssText[i + 1];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = ch;
      continue;
    }
    if (ch === '/' && next === '*') {
      if (depth > 0) {
        problems.push(`第 ${lineOf(cssText, i)} 行的 \`/*\` 出现在另一个注释内部（CSS 注释不能嵌套）`);
      }
      depth += 1;
      openAt = i;
      i++;
      continue;
    }
    if (ch === '*' && next === '/') {
      depth -= 1;
      if (depth < 0) {
        problems.push(
          `第 ${lineOf(cssText, i)} 行有一个**多余的** \`*/\`（没有与之配对的 \`/*\`）——\n` +
            `      浏览器会把它当语法错误、并把后面一大段规则当作声明继续读，` +
            `于是那些规则**一条都不生效**，而且不报任何错。`
        );
        depth = 0;
      }
      i++;
    }
  }
  if (depth > 0) {
    problems.push(
      `第 ${lineOf(cssText, openAt)} 行的 \`/*\` **没有闭合** —— 从那里往下的整块 CSS 都被吃掉了。`
    );
  }
  if (problems.length > 0) {
    note(
      `样式表的注释不配平（共 ${problems.length} 处）：\n      ${problems.join('\n      ')}\n` +
        `    → 后果特别隐蔽：页面不报错、构建通过，只是那一整段规则**静默失效**。\n` +
        `    → 移动大段 CSS 之后扫一遍配平（纪律 §2.9）。`
    );
  }
}

// ———————— 报账 ————————
if (failures.length > 0) {
  console.error('[check-style] 样式层次出问题了：\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n  背景见 scripts/check-style.mjs 开头的注释（"看久了累、不高级"那条修法）。`);
  process.exit(1);
}

console.info(
  `[check-style] 层次正常：内容粗边框 ${loud.size} 类（≤${LOUD_MAX}）、越界的实心墨影 0 类、色相未动；` +
    `${scriptNames.length} 个 .mjs 脚本都是纯 JS。`
);
