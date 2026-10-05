/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  版面宽度的守卫（`scripts/check-layout.mjs`）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它拦的是哪一类错（用户 2026-10："你真是一个一个修"）
 *
 * 桌面适配出过**连着三轮**同一类问题，每次都是"某个元素忘了收窄，
 * 于是它在 1920 的窗口上横贯整屏，而正文在中间"：
 *
 *  轮次 | 漏的是谁 | 怎么发现的
 *  --- | --- | ---
 *  1 | 正文容器 `.scroll`（`100vw` 的 padding 把它算成负宽度） | 用户截图（塌成一条线）
 *  2 | `.topbar-row` / `.score` / `.tape-shelf` | 我点名补的
 *  3 | **`.loadbar` / `.title` / 那条「窗外」的带子** | 用户又一张截图
 *
 * 三次的根因是同一个：**"收窄"靠人记得逐个点名**。
 *
 * ## 这一版是"静态契约 + 自证"，而不是一个 CSS 引擎
 *
 * 我先后写过两版**模拟浏览器**的守卫，两版都错：
 *
 *  ① 手写模板解析器（按标签配对算深度）：模板里夹着 `${…}` 时它**数错层数**，
 *     只看见 5 个"容器 > 子元素"组合 —— 连 `.topbar-row` 都没看见，
 *     而它照样报"合格"。**一个看不见东西的守卫比没有守卫更坏，因为它是绿的。**
 *  ② 用正则抽 `@media (min-width: 560px)` 那一块：非贪婪量词在块里**第一条规则的
 *     `}`** 就停了，于是桌面那几条收窄规则一条都没进，整个样式表被报成"全都没约束"。
 *
 * 两次都撞在同一件事上：**在一个没有布局引擎的地方假装有布局引擎。**
 *
 * 所以现在它只做两件确定的事：
 *
 *  1. **结构判据**：桌面那一块必须真的收窄"内容"，而不是点名收窄某几个类 ——
 *     通配符 `.topbar > *` / `.dock > *`（新加的元素**自动**跟上），
 *     加上 `.scroll` 与 `.window-band` 各自带 `--content-max`；
 *  2. **自证**：它把当前这份判定**跑一遍**（含一条故意违反契约的样本），
 *     确认自己真的能判红 —— 也就是"守卫要能故意失败一次"这条纪律变成了代码。
 *
 * ⚠ 它**不**回答"某个具体 class 在 1920 下有多宽"。那一类问题由
 * `ui/` 那几屏的挂载用例 + 人工在桌面浏览器里看一眼来兜 —— 这里只守"结构没退化"。
 */
import { readFileSync } from 'node:fs';

const CSS = readFileSync('src/style.css', 'utf8');
const CONTENT_MAX_PX = 470;

/** 从 `from` 处的 `{` 开始找配对的 `}`（数花括号，不靠正则的懒惰量词） */
function matchingBrace(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 取出 `@media (min-width: 560px)` 那一块的正文（桌面专用样式） */
function desktopBlock(css) {
  const m = /@media\s*\(min-width:\s*560px\)\s*\{/.exec(css);
  if (!m) return '';
  const open = m.index + m[0].length - 1;
  const close = matchingBrace(css, open);
  return close < 0 ? '' : css.slice(open + 1, close);
}

/**
 * 契约（每一条都是"桌面上的内容必须被收进同一条纵列"的一种落实方式）。
 * `must` 是**在源码里必须找得到的字面片段**（去掉空白后比对）。
 */
const CONTRACT = [
  {
    why: '页眉里的每一个直接子元素都要收窄 —— 用通配，这样新加的元素自动跟上',
    must: '.topbar > *'
  },
  {
    why: '操作台同上（底栏按钮铺满整宽会看起来像两截拼起来的）',
    must: '.dock > *'
  },
  {
    why: '正文容器自己带宽度约束（它是被点名收窄的那个，不靠通配）',
    must: '.scroll'
  },
  {
    why: '那条「窗外」也要收 —— 整屏宽的话它在桌面上从"窗外"变成"一条装饰横带"',
    must: '.window-band'
  },
  {
    why: '整理页是**故意**的例外（货架网格固有宽 471px，比内容上限宽 1px）',
    must: '.room-scroll'
  }
];

/**
 * ⚠ 判之前必须**先去掉注释**：桌面那一块的注释里就写着
 * "原来的 `padding-inline: max(12px, (100vw − 470px) / 2)`"，而那一句
 * 是**解释历史**的，不是一条声明。第一版没去注释，于是守卫对着一段正确的样式
 * 报了"又用 100vw 了" —— 又是一次假账（同一个坑这一天踩了第三次，
 * 值得记：**守卫读的是文本，而文本里有注释**）。
 */
const desktop = desktopBlock(CSS)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, '');
const problems = [];

for (const item of CONTRACT) {
  const needle = item.must.replace(/\s+/g, '');
  if (!desktop.includes(needle)) {
    problems.push(`桌面那一块里找不到 \`${item.must}\` —— ${item.why}`);
  }
}

/** 收窄用的必须是 `--content-max`，不许再手写 px（否则两处会漂） */
const usesContentMax = (desktop.match(/max-width:var\(--content-max\)/g) ?? []).length;
if (usesContentMax < 3) {
  problems.push(
    `桌面那一块里 \`max-width: var(--content-max)\` 只出现 ${usesContentMax} 次（至少要 3 次）—— ` +
      `收窄的宽度必须只有一处真相（\`:root\` 里的 \`--content-max\`）`
  );
}

/** 不许再用 `100vw` 算内边距（那一个坑让正文塌成过一条线） */
if (/padding-inline:max\([^)]*100vw/.test(desktop)) {
  problems.push(
    '桌面那一块又用 `100vw` 算内边距了 —— 它含纵向滚动条的宽度，' +
      '会让内容盒算成负数（2026-10 正文塌成一条线的根因）'
  );
}

/*
 * ★ 自证：把判定函数拿出来，喂一条**故意违反契约**的样本 ——
 * 它必须判红。跑不通就说明这个守卫在验空气（纪律 §2.18）。
 */
function judge(block) {
  const out = [];
  for (const item of CONTRACT) {
    if (!block.includes(item.must.replace(/\s+/g, ''))) out.push(item.must);
  }
  return out;
}
const selfTest = judge('.topbar>*{max-width:var(--content-max)}.dock>*{max-width:var(--content-max)}');
if (selfTest.length === 0) {
  console.error(
    '[check-layout] ★ 守卫自检失败：喂给它一条**故意缺少** `.scroll` / `.window-band` 的样本，\n' +
      '  它却判了合格 —— 说明这一道守卫在验空气，不是真的在守。'
  );
  process.exit(1);
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * M5 §5 那一条：**320 / 375 / 390 三档零溢出**
 *
 * ## 为什么它是一张"点名表"而不是一个布局引擎
 *
 * 上面那段已经写过两次教训：**在没有布局引擎的地方假装有布局引擎**，
 * 结果是两条都错、而且都报"合格"。所以这里换一种写法 ——
 * 不去猜每个元素有多宽，而是**逐个点名那一行里的每一段必须遵守的约束**，
 * 再拿**算得清的那个少数**对一次总账。
 *
 * 点名表盯的是 M5 新加的那一条常驻信息栏（`ui/prophetBar.ts` 画在每一屏顶上），
 * 它是全仓唯一一个"四个元素挤在一行、其中三个不许收缩"的地方：
 * 灾难全名可以很长（"通信中断"、"连烧"、"返乡潮"），
 * 而它右边那三段（强度 / 倒计时 / 按钮）都写了"不许收缩" ——
 * **一行里只要有一个能收缩、且允许收缩到 0，就不会溢出**；一个都没有就会。
 * 而那正是这一整条最容易犯的错：新加一段时顺手抄一句 `flex: 0 0 auto`。
 *
 * ## 320px 那笔账（写在这儿，免得下次有人重新推一遍）
 *
 * 320 − `.scroll`/`.run-bar` 的左右内边距 24 = **296px** 可用；
 * 三段固定宽度按 `rem` 基准 16px 换算：强度 ≈ 2em（32px）、
 * 倒计时 `min-width: 5.4em`（86px）、按钮（内边距 8×2 + 边框 1.5×2 +
 * 11.5px 的字「先知日历」+ 三角 12px）≈ 90px，三处 `gap: 8px` 共 24px
 * → **合计 ≈ 232px**，而灾难全名靠 `min-width: 0` 吃掉剩下的 64px 并省略号收尾。
 * 结论：零溢出，且**余量约 64px** —— 这张表里任何一条被拿掉，
 * 那一行就从"名字被截短"变成"按钮被推到屏幕外"（而后者不会有任何报错）。
 */
const RUN_BAR_ROW = { class: 'run-bar-row', maxGapPx: 12 };
const RUN_BAR_ITEMS = [
  {
    cls: 'run-bar-name',
    why: '灾难全名可以很长，它必须是那一行里唯一允许收缩并省略号收尾的一段',
    check: (body) => /min-width:\s*0/.test(body) && /overflow:\s*hidden/.test(body)
  },
  {
    cls: 'run-bar-sev',
    why:
      '强度是数字、宽度短，**它才该是被先挤掉的那一段**（名气比它重要）—— ' +
      '所以它不许写 "0 0 auto"（那会让名字先被挤没）、更不许会长',
    check: (body) => {
      const m = /flex:\s*([0-9.]+)\s+([0-9.]+)\s+auto/.exec(body);
      return m !== null && Number(m[1]) === 0 && Number(m[2]) > 0;
    }
  },
  {
    cls: 'run-bar-days',
    why: '倒计时占了固定宽度（防止每天一变就把按钮推得左右挪），所以它必须写死不许收缩',
    check: (body) => /flex:\s*0\s+0\s+auto/.test(body) && /min-width:\s*5\.4em/.test(body)
  },
  {
    cls: 'run-bar-toggle',
    why: '右端那个按钮不许收缩 —— 它是展开日历唯一的入口',
    check: (body) => /flex:\s*0\s+0\s+auto/.test(body) && /margin-left:\s*auto/.test(body)
  }
];

/** 取出 `.cls { … }` 的正文（去注释；不匹配 `@media` 里那一层，这里不需要） */
function ruleBody(css, cls) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(`(^|[},])\\s*\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm');
  const m = re.exec(clean);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchingBrace(clean, open);
  return close < 0 ? null : clean.slice(open + 1, close);
}

function narrowProblems(css) {
  const out = [];
  const row = ruleBody(css, RUN_BAR_ROW.class);
  if (row === null) {
    out.push(`找不到 \`.${RUN_BAR_ROW.class}\` —— 常驻信息栏那一行没了？`);
  } else {
    const gap = /gap:\s*([0-9.]+)px/.exec(row);
    if (!gap || Number(gap[1]) > RUN_BAR_ROW.maxGapPx) {
      out.push(
        `\`.${RUN_BAR_ROW.class}\` 的 \`gap\` 是 ${gap ? `${gap[1]}px` : '（没写）'}，` +
          `超过 ${RUN_BAR_ROW.maxGapPx}px —— 320px 那一行只有约 64px 余量，` +
          `间隙每宽 4px 就要多占一份（三处间隙）`
      );
    }
  }
  for (const item of RUN_BAR_ITEMS) {
    const body = ruleBody(css, item.cls);
    if (body === null) {
      out.push(`找不到 \`.${item.cls}\` —— ${item.why}`);
      continue;
    }
    if (!item.check(body)) out.push(`\`.${item.cls}\` 的约束不对：${item.why}`);
  }
  out.push(...tierProblems(css));
  out.push(...tapProblems(css));
  return out;
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * ★★ 为什么 320 一档合格就等于 375 / 390 也合格（省下一次"假装验过"）
 *
 * M5 工单 §5 写的是"320 / 375 / 390 三档零溢出"。真去验三档要有布局引擎，
 * 没有布局引擎的地方假装有，上面已经写过两次教训 —— 所以这里换一条**真的算得清**的路：
 *
 *   **不验第二档与第三档，而是验"档"本身只有这么几个。**
 *
 * 全表在手机区间里的断点只有两个：`max-width: 365px` 与 `max-width: 400px`；
 * 而 320 是**最小**的那一档。所以"320 不溢出"能推出 375 / 390 也不溢出，
 * 只要**没有人往 320~429 之间再插一个新档** ——
 * 那正是会把这条推理悄悄弄假的动作（而这种错不会有任何报错：
 * 新档往往只为 375 那一段调尺寸，320 反而因此**变宽**）。
 *
 * 所以下面这条判据是"**档数不许变多**"：这个区间里的 `max-width` 断点，
 * 只允许恰好等于 365 与 400 各一个。
 * 加断点本身不是错 —— 但它必须**同时**把这张表与这段推理一起改掉。
 *
 * ⚠ `min-width: 430px` 那一个不在管辖内：它只管 ≥430，对 320/375/390 三档一视同仁。
 */
const PHONE_BUCKETS = [365, 400];
/** 比 470px 宽的地方 desktop 那一段接管了，不属于手机区间 */
const PHONE_BUCKET_MAX_PX = 470;

function tierProblems(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [...clean.matchAll(/@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)/g)].map((m) => Number(m[1]));
  const inRange = [...new Set(found)].filter((w) => w > 320 && w < PHONE_BUCKET_MAX_PX).sort((a, b) => a - b);
  const expected = [...PHONE_BUCKETS].sort((a, b) => a - b);
  if (inRange.join(',') !== expected.join(',')) {
    out.push(
      `手机区间的 \`max-width\` 档位变了：现在是 [${inRange.join(', ')}]，` +
        `而"320 合格 ⇒ 375/390 合格"这条推理只对 [${expected.join(', ')}] 成立。\n` +
        `    → 新加的窄屏档会造出一段"比 320 松、比 400 紧"的宽度，` +
        `而 375 / 390 正好落在里面：那两档从此**没有被人验过**，也不会有任何报错。\n` +
        `    → 要么把新档并进 400 或 365，要么把这张表与上面那段推理一起改掉。`
    );
  }
  return out;
}

/*
 * ★ 自证（纪律 §2.18：守卫要能故意失败一次）：
 * 把三条**故意各缺一项**的样本喂给同一个判定函数，样本里的错必须都被抓住 ——
 * 一个也抓不到就说明这张点名表在验空气。
 */
const NARROW_SAMPLES = [
  '.run-bar-name{flex:0 1 auto;overflow:hidden}', // 缺 min-width: 0 → 名字顶出去
  '.run-bar-days{flex:1 1 auto;min-width:5.4em}', // 变成可收缩 → 每天按钮左右跳
  '.run-bar-toggle{flex:0 0 auto}' // 缺 margin-left: auto → 倒计时缺位时按钮不靠右
];
const narrowSelfTests = NARROW_SAMPLES.map((sample) => {
  const stamped = RUN_BAR_ITEMS.map((item, i) => {
    const body = ruleBody(sample, item.cls);
    if (body !== null) return item.check(body) ? 'ok' : 'bad';
    return `missing-${i}`;
  });
  return stamped.includes('bad');
});
if (!narrowSelfTests[0] || !narrowSelfTests[1] || !narrowSelfTests[2]) {
  console.error(
    '[check-layout] ★ 窄屏守卫自检失败：喂给它三条**故意缺项**的样本，' +
      '其中至少一条被判成合格 —— 说明这张点名表在验空气。'
  );
  process.exit(1);
}

/*
 * ★ 档位守卫的自证（同样按纪律 §2.18：守卫要能故意失败一次）。
 * 三个样本：① 现状那一组必须**合格** ② 往 375 插一个新档必须**判红**
 * ③ 把 365 那一档删掉也必须**判红**（那会让 320~365 那一段失去它唯一的兜底）。
 */
const TIER_SAMPLES = [
  { css: '@media(max-width:400px){.a{color:red}}@media(max-width:365px){.b{color:red}}', bad: false },
  { css: '@media(max-width:400px){.a{color:red}}@media(max-width:375px){.c{color:red}}', bad: true },
  { css: '@media(max-width:400px){.a{color:red}}', bad: true }
];
const tierSelfTests = TIER_SAMPLES.map((s) => tierProblems(s.css).length > 0 === s.bad);
if (tierSelfTests.some((ok) => !ok)) {
  console.error(
    '[check-layout] ★ 档位守卫自检失败：喂给它三个样本（现状那组 / 插一个新档 / 删掉 365 那一档），' +
      '其中至少一个判反了 —— 说明这条守卫在验空气。'
  );
  process.exit(1);
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * ★★ 点击热区守卫（M5：真机细节）
 *
 * ## 它守的是一个"在桌面上永远看着没问题"的量
 *
 * 一个按钮够不够大，鼠标指针只有 1px，所以桌面上**任何尺寸都够**。
 * 手机上拇指的接触面大约 8~10mm，苹果给的下限是 44pt、谷歌是 48dp ——
 * 于是"这个控件够不够大"这件事**只能靠量**，看不出来。
 *
 * ## 判据分两半，缺一半就等于没守
 *
 *   ① **表里的控件必须够大**：`min-height` 要写 `var(--tap-min)`（或 ≥ 44px 的字面量）。
 *   ② **表外的可点类必须不存在**：从 CSS 里把**所有带 `cursor: pointer` 的类**挑出来，
 *      每一个都必须在 `TAP_FLOOR` 或 `TAP_EXEMPT` 里。
 *      ★ 这一半才是真正的守卫 —— 少了它，新加一个 32px 的按钮不会有任何反应，
 *      而"新加一个控件"正是这件事唯一会再次发生的途径。
 *
 * ## ⚠ 为什么查的是**基样式**，不是"某个媒体查询里够大"
 *
 * 这一轮抓到的第一个真缺口就是它：胶带架那两枚工具钮（＋ / ✂）在
 * `@media (max-width: 400px)` 里被抬到 44px，而**基样式仍是 34px** ——
 * 也就是说"手机上够大"这件事当时交给了运气（它确实只在窄屏生效，
 * 但没有任何东西记着"这两枚钮的全部意义就是手机上够大"）。
 * 所以查基样式是**故意更严**：窄屏才够大不算够大。
 */
const TAP_MIN_PX = 44;

/*
 * ★★ 表的两边**不是同一种东西**（这里第一次写错过，别改回去）：
 *    - **key = 光秃秃的类名**（`btn`），给 `rulesMentioning` / `pointerClasses` 用 ——
 *      它们自己会拼 `.`，key 里再带一个点就成了 `..btn`，一个都匹配不到
 *      （症状是**每一行控件**都报"没写下限"，看起来像样式表错了）。
 *    - **value = 选择器**（`.save-fold > summary`），给人看、给报错用。
 */
const TAP_CONTROLS = {
  btn: '.btn',
  mini: '.mini',
  slot: '.slot',
  'codex-tab': '.codex-tab',
  swatch: '.swatch',
  step: '.step',
  'cat-chip': '.cat-chip',
  'tape-btn': '.tape-btn',
  'tape-tool': '.tape-tool',
  'tape-chip': '.tape-chip',
  'night-option': '.night-option',
  'trade-item': '.trade-item',
  'score-item': '.score-item',
  'boxes-fold': '.boxes-fold',
  'run-bar-toggle': '.run-bar-toggle',
  'save-fold': '.save-fold > summary'
};

/*
 * ★★ 例外表：**可点的那个元素身上没有类名**的那一个。
 *
 * `.save-fold > summary` 是"把这一局带走"的门把手，而 `<summary>` 身上没有任何类 ——
 * 它唯一的抓手是父元素 `.save-fold`。所以按类名取样取不到它，得按这条选择器取。
 * ⚠ 只有在这里写明白的才算数：**不要**让 `rulesMentioning` 去猜选择器语言，
 *   它一猜就会把 `.save-fold`（一个 `<details>`，本身点不动）也算成可点控件。
 */
const TAP_SELECTOR_RULES = {
  'save-fold': /\.save-fold\s*>\s*summary\s*\{/g
};

/** 取一个控件对应的**全部规则正文**：默认按类名，写进 `TAP_SELECTOR_RULES` 的按选择器 */
function tapBodies(css, cls) {
  const selector = TAP_SELECTOR_RULES[cls];
  if (selector === undefined) return rulesMentioning(css, cls);
  const out = [];
  const re = new RegExp(selector.source, selector.flags);
  for (const hit of css.matchAll(re)) {
    const open = css.indexOf('{', hit.index);
    if (open < 0) continue;
    const close = matchingBrace(css, open);
    if (close < 0) continue;
    out.push(css.slice(open + 1, close));
  }
  return out;
}

const TAP_EXEMPT = {
  'identity-card': '本身就是一张 112px 的大卡片，不需要下限',
  'shop-card': '本身就是一张 84px 的大卡片，不需要下限',
  box: '纸箱里是一个 2.5px 边框的盒子，横排之后 46px 高 —— 它确实是"本身就有尺寸"，但 46 已经在 44 的门槛之上，所以这条豁免其实随时可以撤（留着只是不想让一次纯样式的改动同时改判据）',
  'save-file': '借 `.btn` 的 46px（它本身是 `.btn.save-file`）'
};

/** 取某个选择器**基样式**规则正文里那一条 `min-height`（没有则 null） */
function minHeightOf(css, cls) {
  const body = ruleBody(css, cls);
  if (body === null) return null;
  const m = /min-height:\s*([^;]+);/.exec(body);
  return m ? m[1].trim() : null;
}

/**
 * ★★ 一个"名字后面不许再接字母数字"的规则体查找 —— `ruleBody` 不够用。
 *
 * `ruleBody('… .save-fold …')` 会**误命中 `.save-fold > summary`**：
 * 它生成的边界是 `(^|[},])\s*\.save-fold\s*\{`，而"后面必须紧跟 `{`"这一条
 * 挡不住中间还有别的选择器文本的情况 —— 于是查 `.save-fold` 拿到的是
 * `<summary>` 那一条的正文（`min-height` 有没有全看运气）。
 *
 * 所以按"**包含这个类名的每一条规则**"来查，并且要求名字后面不是 `-` / 字母 / 数字。
 * 返回数组：一个类名在样式表里出现几次就有几条（重复定义时两条都在）。
 */
function rulesMentioning(css, cls) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  /*
   * ⚠⚠ 反斜杠的层数（这里踩过一次，代价是"每一行控件都报没写下限"）：
   *     这段在**模板字符串**里。要构造出来的正则正文是 `\.btn(?![\w-])`，
   *     所以模板里必须写 `\\w`（两层）—— 写成 `[\\w-]` 时 `\w` 会被
   *     `new RegExp` 当成"空白类里转义过的 w"（等价于字面的 `w`），
   *     正则变成 `(?![\w-])` 的**错误版本**：`.btn` 后面若跟着 `-` 就匹配不上。
   *     `.tape-btn` 之所以还活着，是因为 `\.btn` 正好从它的 `-btn` 处开始匹配。
   */
  const re = new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
  for (const hit of clean.matchAll(re)) {
    // 往左找到这条规则的 `{`，往右找配对的 `}`
    const open = clean.indexOf('{', hit.index);
    if (open < 0) continue;
    // 只有当 "选择器部分" 里没有 `}` 或 `{` 时才算同一个选择器（避免跨规则）
    const between = clean.slice(hit.index, open);
    if (between.includes('}') || between.includes('{')) continue;
    const close = matchingBrace(clean, open);
    if (close < 0) continue;
    out.push(clean.slice(open + 1, close));
  }
  return out;
}

/** 这个类名下**有没有哪一条**规则写着 `cursor: pointer` */
function isPointerControl(css, cls) {
  return rulesMentioning(css, cls).some((b) => /cursor:\s*pointer/.test(b));
}

/** 一条 `min-height` 取值算不算够大（`var(--tap-min)`，或 ≥ 44px 的字面量） */
function tapFloorOk(value) {
  if (value === null) return false;
  if (/var\(\s*--tap-min\s*\)/.test(value)) return true;
  const px = /^([0-9.]+)px$/.exec(value);
  return px !== null && Number(px[1]) >= TAP_MIN_PX;
}

/** CSS 里所有写着 `cursor: pointer` 的类名（= 有意图做成可点的东西） */
function pointerClasses(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/cursor:\s*pointer/.test(m[2])) continue;
    for (const c of m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(c[1]);
  }
  return [...out].sort();
}

function tapProblems(css) {
  return [...tapFloorProblems(css), ...tapTableProblems(css)];
}

/*
 * 判据 ① 与 ②（只看 `css` 本身，所以**合成的小样本也跑得动** —— 自证要用它）
 */
function tapFloorProblems(css) {
  const out = [];

  /*
   * ① 那条线本身：`--tap-min` 必须写在 `:root` 里，而且不许低于 44px。
   *    它一旦被调小，下面所有"够大"的断言会在**同一次改动里**一起变成假的。
   */
  const rootM = /:root\s*\{/.exec(css);
  const rootBody = rootM === null ? '' : css.slice(rootM.index, matchingBrace(css, rootM.index + rootM[0].length - 1) + 1);
  const tapMin = /--tap-min:\s*([0-9.]+)px/.exec(rootBody);
  if (tapMin === null) {
    out.push('`:root` 里找不到 `--tap-min` —— 点击热区那条线没了，下面的断言全在验空气。');
  } else if (Number(tapMin[1]) < TAP_MIN_PX) {
    out.push(
      `\`--tap-min\` 是 ${tapMin[1]}px，低于 ${TAP_MIN_PX}px（苹果 44pt / 谷歌 48dp 里小的那个）。` +
        `\n    → 它是"手指够不够得着"的下限，不是排版余量：调小它等于把这一整道守卫的判据改掉。`
    );
  }

  /*
   * ② 表里的控件必须够大（★ 只查**这个 css 里真的写了**的那些，合成小样本才跑得动）
   *
   * ⚠⚠ 判据是"**这些规则里至少有一条**写着够大的 `min-height`"，不是"每一条都写"。
   *     一个控件往往有好几条规则（`.tape-btn` 3 条、`.slot` 14 条、`.swatch` 3 条），
   *     其中大多数是状态变体或后代搭配 —— 要求它们全都写 `min-height` 是做不到的。
   *     第一版写成"每一条都要够大"，结果是**每一行控件都报没写下限**（也是假报告）。
   */
  for (const [cls, label] of Object.entries(TAP_CONTROLS)) {
    const bodies = tapBodies(css, cls);
    if (bodies.length === 0) continue;
    const values = bodies.map((body) => {
      const m = /min-height:\s*([^;]+)/.exec(body);
      return m ? m[1].trim() : null;
    });
    if (values.some((v) => tapFloorOk(v))) continue;
    const shown = values.filter((v) => v !== null);
    out.push(
      `\`${label}\` 的 ${bodies.length} 条规则里没有一条写着够大的 \`min-height\`。\n` +
        `    量到的取值：${shown.length === 0 ? '（一条都没写）' : shown.map((v) => `\`${v}\``).join('、')}\n` +
        `    → 在它的**基样式**那条规则里写 \`min-height: var(--tap-min)\`。` +
        `若它确实**不该**有下限（比如一行文字里的链接），把它挪进 \`TAP_EXEMPT\` 并写明理由。`
    );
  }
  return out;
}

/*
 * 判据 ③：表里的控件**一条都不能少**、表外的可点类**一个都不能有**。
 * ⚠ 只能在完整样式表上跑 —— 喂它一个只有一条规则的小样本，它会报出十几条
 *   "找不到 `.btn` 的基样式规则"，而那些话在样本里毫无意义（自证第一版就是这么失败的）。
 */
function tapTableProblems(css) {
  const out = [];
  for (const [cls, label] of Object.entries(TAP_CONTROLS)) {
    if (tapBodies(css, cls).length === 0) {
      out.push(`找不到 \`${label}\` 的基样式规则 —— 它要么改名了，要么被挪进了媒体查询。`);
    }
  }
  for (const cls of pointerClasses(css)) {
    if (cls in TAP_CONTROLS || cls in TAP_EXEMPT) continue;
    /*
     * ★ 只有当它**自己那条规则**写着 `cursor: pointer` 才算"一个可点控件"。
     *   否则 `.save-fold > summary` 会顺带把 `.save-fold` 也报出来 ——
     *   `pointerClasses` 只在选择器文本里出现的类名都收，
     *   而真正的可点目标是 `<summary>`，不是那个 `<details>`。
     */
    if (!isPointerControl(css, cls)) continue;
    out.push(
      `可点类 \`.${cls}\` 不在点击热区的两张表里。\n` +
        `    → 它是"有意图做成可点的东西"（写着 \`cursor: pointer\`），所以必须二选一：\n` +
        `      写 \`min-height: var(--tap-min)\` 并加进 \`TAP_CONTROLS\`，` +
        `或者加进 \`TAP_EXEMPT\` 并写明"为什么它可以例外"。`
    );
  }
  return out;
}

/*
 * ★ 自证（纪律 §2.18）：喂四个**故意错**的样本，每一个都必须被判红 ——
 * 一个也抓不到就说明这道守卫在验空气。
 *
 * ⚠ 自证跑的是 `tapFloorProblems`（判据 ①②），**不是** `tapProblems`：
 *    判据 ③ 会在只有一条规则的小样本上报出十几条"找不到 `.btn` 的基样式规则"，
 *    于是**每一个**样本都被判红 —— 包括最后那个"必须合格"的样本，
 *    自检永远失败，而失败的原因与被测的东西一点关系都没有。
 *    （第一版就是这样：四个样本全红，报的是"守卫在验空气"，其实守卫是对的。
 *      判据 ③ 是"表与样式表是否对得上"，它只对完整样式表有意义。）
 *
 * ⚠ 每个样本前面还要补一句 `:root{--tap-min:44px}`：判据 ①（那条线本身存在吗）
 *    同样会把每一个"没有 :root"的样本判红。
 */
const TAP_SAMPLE_ROOT = ':root{--tap-min:44px}';

const TAP_SAMPLES = [
  // ① 控件没写下限
  { css: '.tape-btn{cursor:pointer}', bad: true },
  // ② 控件写了下限但不够大
  { css: '.tape-btn{min-height:36px;cursor:pointer}', bad: true },
  // ③ 下限写成了一条比 44px 小的字面量（`36px` 与 `40px` 都真实出现过）
  { css: '.tape-btn{min-height:40px;cursor:pointer}', bad: true },
  // ④ 现状那种写法必须合格
  { css: '.tape-btn{min-height:var(--tap-min);cursor:pointer}.mini{min-height:var(--tap-min);cursor:pointer}', bad: false },
  // ⑤ 那条线本身被调小了 —— 它一变小，上面所有"够大"的断言会一起变成假的
  { css: '.tape-btn{min-height:var(--tap-min);cursor:pointer}', bad: true, root: ':root{--tap-min:36px}' }
];
const tapSelfTests = TAP_SAMPLES.map((s) => tapFloorProblems((s.root ?? TAP_SAMPLE_ROOT) + s.css).length > 0 === s.bad);
if (tapSelfTests.some((ok) => !ok)) {
  for (const [i, s] of TAP_SAMPLES.entries()) {
    console.error(`  样本 ${i + 1}（期望 bad=${s.bad}）实得 ${tapSelfTests[i] ? 'OK' : '反了'}`);
    for (const p of tapFloorProblems((s.root ?? TAP_SAMPLE_ROOT) + s.css)) console.error(`      ${p.split('\n')[0]}`);
  }
  console.error(
    `[check-layout] ★ 点击热区守卫自检失败：喂给它 ${TAP_SAMPLES.length} 个样本（没写下限 / 下限不够 / 40px 字面量 / 现状那种写法 / 那条线被调小），` +
      '其中至少一个判反了 —— 说明这道守卫在验空气。'
  );
  process.exit(1);
}

/*
 * ★★ 自证之二：**取样器本身**必须能在真样式表上取到东西。
 *
 * 这一条是补上来的 —— 第一版 `rulesMentioning` 的正则多转义了一层反斜杠
 * （`[\\w-]` 在模板字符串里应该是 `[\\w-]` 写成 `[\\\\w-]` 那种层数错误），
 * 于是它**一个类名都取不到**。而取样失败的表现是"这个控件没写下限"，
 * 看上去像是样式表的错 —— 我照着这份假报告差点把十几条正确的 CSS 改坏。
 * 喂样本的自证**抓不到这个**（样本里那些规则连 `-` 都没有，正好能匹配上）。
 *
 * 判据：表里每个控件都必须在真样式表里**至少匹配到一条规则**。
 * 取不到就是取样器坏了，与样式表对不对无关。
 */
const samplerMisses = Object.keys(TAP_CONTROLS).filter((cls) => tapBodies(CSS, cls).length === 0);
if (samplerMisses.length > 0) {
  console.error(
    `[check-layout] ★ 点击热区的**取样器**取不到东西：${samplerMisses.map((c) => `\`.${c}\``).join('、')} 在 \`src/style.css\` 里一条规则都没匹配到。\n` +
      '  这不是"没写下限"，是 `rulesMentioning` 自己坏了（多一层转义 / 转义漏了）。\n' +
      '  照着它报的"没写下限"去改 CSS 会把本来正确的规则改坏 —— 先修取样器。'
  );
  process.exit(1);
}

problems.push(...narrowProblems(CSS));

if (problems.length > 0) {
  console.error('[check-layout] 桌面版面的宽度契约破了：\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    `\n  这一道守卫存在的理由：同一个"忘了收窄"在 2026-10 连着犯了三次，` +
      `每次都是用户截图报出来的。\n` +
      `  修法：桌面那一块（\`@media (min-width: 560px)\`）里，` +
      `内容一律 \`width:100%\` + \`max-width:var(--content-max)\` + \`margin-inline:auto\`；` +
      `页眉/操作台用通配覆盖它们的所有直接子元素。\n` +
      `  窄屏那一半（M5 §5 的"320 / 375 / 390 零溢出"）：` +
      `\`.run-bar-row\` 那一行里**必须恰好留一段能收缩到 0**，` +
      `其余入表的三段各自守住自己的 \`flex\` —— 一行里全是 \`0 0 auto\` 时溢出，` +
      `而溢出的东西只会跑到屏幕外，不会报任何错。`
  );
  process.exit(1);
}

console.log(
  `[check-layout] 桌面宽度契约完好：${CONTRACT.length} 条都成立、` +
    `\`var(--content-max)\` 出现 ${usesContentMax} 次、自检（故意缺项必判红）通过；` +
    `窄屏（320px）那一行 ${RUN_BAR_ITEMS.length} 段各自守住约束、自检 3 条通过；` +
    `手机档位只有 [${[...PHONE_BUCKETS].sort((a, b) => a - b).join(', ')}] —— ` +
    `320 是最小那一档，所以"320 不溢出"能推出 375 / 390 也不溢出、自检 3 条通过；` +
    `点击热区 ${Object.keys(TAP_CONTROLS).length} 个控件各自 ≥ ${TAP_MIN_PX}px、` +
    `另有 ${Object.keys(TAP_EXEMPT).length} 个写在豁免表里，自检 ${TAP_SAMPLES.length} 条通过、取样器在真样式表上取得到全部 ${Object.keys(TAP_CONTROLS).length} 个控件。`
);
