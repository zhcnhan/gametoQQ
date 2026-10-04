/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  文档互链守卫 —— `docs/*.md` 里指向仓库内文件的链接，必须真的存在
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么需要它
 *
 * M4 收尾时做了一次文档整理：把工单从实施记录抽成 `docs/M4-开发工单.md`，
 * 并在四处加了跨文档引用。**那类引用是最容易悄悄失效的东西** ——
 * 文件名改一个字、文件被搬走，链接就指着空气，而**没有任何测试会红**。
 *
 * 这与纪律 §2.16（手工抄的数会飘走）是同一个形状：**引用也是一种手工抄写**。
 * 区别只是它抄的是"那个文件叫什么"。
 *
 * ## 判据（刻意保守，宁可不报也不误报）
 *
 * 只检查两类：
 *  ① `[文字](相对路径.md)` —— 同目录或 `../` 的相对 md 链接；
 *  ② 反引号里的 `docs/xxx.md`、`scripts/xxx.mjs` 这类**带扩展名的仓库内路径**。
 *
 * 刻意**不**检查：
 *  · `http(s)://` 外链（离线时无法验证，而且它们本来就该由人看）；
 *  · 纯锚点 `#xxx`、以及指向目录的链接；
 *  · 反引号里那些**示例性的**路径（例如 `src/tools/save-*.txt` 这种带通配的）——
 *    带 `*` 或 `{}` 的一律跳过。
 *
 * ## 怎么故意让它失败一次（纪律 §0.2）
 *
 * 把任意一个文档里的 `M4-开发工单.md` 改成 `M4-开发工单X.md`，跑
 * `node scripts/check-docs.mjs`，它必须报出"找不到"并退出码 1。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DOCS_DIR = 'docs';

/** 收集所有待查文档（`docs/*.md` + 仓库根的 `*.md`） */
function markdownFiles() {
  const out = [];
  for (const name of readdirSync(DOCS_DIR)) {
    if (name.endsWith('.md')) out.push(join(DOCS_DIR, name));
  }
  for (const name of readdirSync('.')) {
    if (!name.endsWith('.md')) continue;
    if (!statSync(name).isFile()) continue;
    out.push(name);
  }
  return out;
}

/** 带通配/占位符的一律不查（它们是示例，不是引用） */
const WILDCARD = /[*?{}<>]/;

/**
 * 反引号里的"仓库内路径"：以常见源码/文档目录开头，且带扩展名。
 *
 * ⚠ 这里必须**排除带说明文字的那种**（例如 "见 `docs/囤货末世-实施记录.md` 的 §5"）——
 * 那种写法里文件名后面跟着中文，很容易被贪婪正则连进去。
 * 第一版就是这样：它把 `scripts/foo.mjs` 与后面的说明一起吃了，
 * 于是报出一堆"路径不存在"。判据里的 `[^\s`（）]*` 就是为它加的。
 */
const INLINE_PATH = /`((?:docs|src|scripts|content)\/[A-Za-z0-9_./\u4e00-\u9fa5-]*\.(?:md|mjs|ts|json|txt|css))`/g;

/**
 * markdown 链接 `[文字](目标)`。
 * ⚠ 文字部分不许含 `[` `]`（否则会把"见 [`a.md`](b.md)"这种整段吃进去）。
 */
const MD_LINK = /\[[^\]\[]*\]\(([^)\s]+)\)/g;

/**
 * ★★ 先把**行内代码块**剥掉，再找引用 —— 这一步是补上的，而且它差点让这条守卫自杀。
 *
 * 文档在**解释这条守卫本身**的时候会举例子，例如
 * "第一版按仓库根解析 → `docs/a.md` 里的 `[x](b.md)` 被当成…"。
 * 那些 `b.md` / `docs/a.md` **是例子，不是引用**，
 * 而守卫第一版把它们当真了 —— 于是纪律文档一改（加了 §3.6.1 这一节），
 * 门禁立刻红出 5 条假账。
 *
 * 剥法：
 *  · `` ``…`` ``（双反引号，用来在文档里写单反引号）整体丢掉；
 *  · `` `…` ``（单反引号）**留下内容**、只去掉引号标记
 *    —— 因为反引号路径的引用就写在那里面，不能一起丢。
 *
 * ⚠ 两个的**顺序不能反**：先剥双的，否则 `` ``…`` `` 会被单反引号的正则
 * 从中间切开，留下一对孤儿反引号。
 */
function stripInlineCode(text) {
  return text.replace(/``[\s\S]*?``/g, '').replace(/`([^`]*)`/g, '$1');
}

const problems = [];
let checked = 0;
/** 反引号路径单独计数 —— 剥掉反引号之后 `INLINE_PATH` 就匹配不到了，见下面的适配 */
let inlineChecked = 0;

for (const file of markdownFiles()) {
  const raw = readFileSync(file, 'utf8');
  /*
   * ★ 两遍扫描，因为两个正则要的文本形态不同：
   *  · 反引号路径（`` `docs/a.md` ``）必须在**带反引号的原文**上匹配；
   *  · markdown 链接必须在**剥掉行内代码之后**的文本上匹配
   *    （否则文档里"举例"的 `[x](b.md)` 会被当成真链接，见 `stripInlineCode` 的注释）。
   * ⚠ 第一版只跑了一遍剥过的文本 —— 于是反引号那一类**一条都没检查到**，
   * 而计数从 53 掉到 12 就是那个信号（**计数变小 = 覆盖变小**，值得当成断言看）。
   */
  const text = stripInlineCode(raw);
  const base = dirname(file);

  /**
   * 两类引用用**两套解析规则**，而且这一点我两头都错过一次：
   *
   *  · **markdown 链接**（`[文字](b.md)`）→ 按**文档所在目录**解析（markdown 的语义）。
   *    第一版按仓库根解析，于是 `docs/a.md` 里的 `[x](b.md)` 被当成 `<根>/b.md`，一片假账；
   *  · **反引号里的路径**（`` `docs/a.md` ``）→ 按**仓库根**解析。
   *    它是"这个仓库里的哪个文件"的写法，不是链接；而且文档里写的
   *    `src/data/disaster.ts` 显然指仓库根下的那个。
   *    第二版我把两类混用了，于是 `docs/` 里的文档被解析成 `docs/docs/…`。
   */
  const check = (raw, kind) => {
    if (WILDCARD.test(raw)) return;
    if (/^https?:\/\//.test(raw)) return;
    if (raw.startsWith('#')) return;
    const target = raw.split('#')[0];
    if (target === '') return;
    const abs = kind === '反引号路径' ? resolve(target) : resolve(base, target);
    checked += 1;
    if (kind === '反引号路径') inlineChecked += 1;
    if (existsSync(abs)) return;
    problems.push(`${file}：${kind} 指向 \`${target}\`，而 ${abs} 不存在`);
  };

  for (const m of raw.matchAll(INLINE_PATH)) check(m[1], '反引号路径');
  for (const m of text.matchAll(MD_LINK)) check(m[1], 'markdown 链接');
}

if (problems.length > 0) {
  console.error(`[check-docs] ✗ ${problems.length} 个引用指向不存在的路径：`);
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}

/*
 * ★ 报告里把两类分开写：`inlineChecked` 是"反引号路径"那一类的条数。
 * 第一版只报总数，于是"反引号那一类一条都没查到"这件事**看不出来** ——
 * 直到我发现计数从 53 掉到 12。**覆盖变小必须是一个显眼的数**。
 */
console.log(
  `[check-docs] 全部合格：${markdownFiles().length} 份文档、${checked} 个仓库内引用` +
    `（其中反引号路径 ${inlineChecked} 个）都能找到。`
);
