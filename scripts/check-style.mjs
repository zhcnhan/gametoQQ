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

const failures = [];
const note = (message) => failures.push(message);

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
 * ★ 两个新加的（2026-10，胶带拖拽）都写清理由，因为这个名单一旦变成
 * "随手往里加"的垃圾桶，守卫就没了：
 *
 *  · `tape-drop` —— **拖拽幽灵的一部分**：它就是那段跟着手指走的胶带
 *    （`.drag-ghost` 的子元素）。守卫按类名匹配、看不到父子关系，所以要显式列。
 *    排一排的胶带**不许**带影子；
 *  · `tape-chip` —— 只有 `.is-lifted`（**被拿起来的那一张**）带影子。
 *    同样：常态那一排不带（`.tape-chip` 的基样式里没有 `box-shadow`）。
 */
const SHADOW_OK = new Set([
  'drag-ghost',
  'drawer-body',
  'zone-tape',
  'tape-slot',
  'shelf-card',
  'identity-card',
  'tape-drop',
  'tape-chip'
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

// ———————— ⑤ 可拖拽元素必须"不许浏览器抢手势" ————————
/*
 * `.slot` / `.box` 上必须有 `touch-action: none`。
 *
 * 这不是可选项：浏览器默认认为"这块区域可以滚动页面"，于是手指按住并移动几像素后
 * 会**接管**手势去滚动，同时发 `pointercancel` —— 我们这边收到就按"被打断"收尾。
 * 玩家报的"手机上拖拽完全不跟手、拖出极小的范围就断"正是这个，
 * 而拖拽诊断日志把它量成了"每约 6px 一次 cancelDrag"。
 *
 * 它极易被后来者当"多余的样式"删掉，而删掉之后**没有任何东西会报错**，所以在这里钉住。
 */
const TOUCH_ACTION_REQUIRED = ['slot', 'box'];
for (const cls of TOUCH_ACTION_REQUIRED) {
  const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*touch-action\\s*:\\s*none`, 's');
  if (!rule.test(code)) {
    note(
      `.${cls} 缺少 touch-action: none —— 触摸设备上从这个元素起手的拖拽会被浏览器抢去滚动，\n` +
        `    表现为"完全不跟手、拖一点点就断"，而且不会有任何报错。`
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
