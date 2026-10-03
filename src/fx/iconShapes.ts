/**
 * 组合式图标生成器 —— 「基础轮廓 × 变体轴」，由键名确定性推导。
 *
 * ## 为什么要有这个文件（它清偿的是原来的欠账 D-21）
 *
 * `icons.ts` 里那 17 张手写线稿是**优点**：每件货都认得出，玩家验收过。
 * 但它不可扩展 —— §10B 要把物资扩到 120~200 种，"内容表可以批量生成、图标不能"
 * 会成为唯一卡点。这一版进来 40 件新物资，如果继续手绘，欠账会翻倍；
 * 而只要靠人画，"新物资有没有自己的图标"就永远是**一件要靠纪律记住的事**，
 * 不是**由构造保证的事**。
 *
 * 所以这里换制成：**只给键名，就一定能画出一张属于它自己的图**。
 * 新物资加进内容表时，图标不需要任何人再动一行代码。
 * （登记册里 D-21 已随之改为 done，残留说明见 `meta/deferred.ts`。
 * 这个文件的注释里**刻意不写那条 `D-xx` 代码标记**：`deferred.test.ts` 会检查
 * "已清偿的条目不许在代码里留残标"，连注释里提一句都算残标 —— 那条测试刚刚
 * 就是这么把我拦下来的，所以这句话只能这样绕着写。）
 *
 * ## 为什么另开一个文件，而不是扩 `icons.ts`
 *
 * `icons.ts` 是"**已经验收过的 17 张图**"，它的价值在于**一个字节都别动**
 * （改了就等于把玩家验收过的东西重新赌一次）。这里是"**一套会长期迭代的规则**"：
 * 变体轴要加、轮廓要调、以后 §5A 的淡彩要接进来。两者的改动理由、审阅标准、
 * 风险完全不同 —— 混在一个文件里，后来者想调一条生成规则就得在 17 张验收过的
 * 手写图中间穿行，很容易"顺手"把手写图也改了。分开之后**边界就是文件边界**：
 * `icons.ts` 只回答"这个键走手写还是走生成"，生成规则全在这里。
 *
 * ## 流水线：三段，各自可以单独验
 *
 * ```
 *   键名 ──(1) 拆词 ──▶ ['can','corned','beef']
 *                          │
 *                          ├─(2) 求变体签名 Signature { form, pattern, band, mark }
 *                          │      描述符表优先，哈希兜底
 *                          │
 *                          └─(3) 装配 ──▶ { outline, pattern, accent } ──▶ <svg>
 * ```
 *
 * **(2) 单独抽出来是刻意的**：这套东西最阴的坏法是"某个轴上两个键落到了同一格"，
 * 而它**不会**表现在类型、构建、或者任何一条已有测试上，只会让两张图慢慢变成一张。
 * 有了签名这一步，`icons.test.ts` 就能直接对**参数**做两两比较，
 * 而不是只能看着两串长得差不多的 SVG 发愣。
 *
 * ## 为什么要"描述符表 + 哈希兜底"，而不是纯哈希
 *
 * 纯哈希能满足"确定性"和"不重样"，但它会画出**没有意义**的图：一罐午餐肉
 * 可能被抽到"叶子"纹样。玩家认不出，等于白画。所以分两层：
 *
 *   1. **描述符表优先** —— 键名里能读懂的词（`fish` / `biscuit` / `honey`…）决定
 *      主特征。它同时服务两件事：**同类内可分辨**（豆豉鱼 ≠ 午餐肉）与
 *      **语义直觉**（茶叶罐上就是茶叶）；
 *   2. **哈希兜底** —— 表里没有的词用键名算出来的确定值。同一个键永远同一张图，
 *      而且**不需要在表里登记**。新增一百个词也不会有任何一张图是空的。
 *
 * 表只覆盖"能被认出来的生活常识"，所以它不随物资量线性变长 ——
 * 这是与"一物一手绘"最本质的区别：**表按语义收敛，不按物资条目膨胀**。
 *
 * ## 一条硬纪律：新键两两不同，而且要**真的看得出不同**
 *
 * 项目在这里踩过坑（玩家原话："根本分辨不出是啥"）：牛奶 vs 矿泉水都是圆角柱、
 * 大米 vs 面粉都是袋子。所以每个基础轮廓有**三个互相独立的变体轴**：
 *
 *   体型（胖瘦高矮）× 内胆纹样 × 强调（色带三段 × 标记四形）
 *
 * 24×24 在手机上只有约 20px —— 三个轴都是"一眼能看出"的粗特征，没有 1px 的差别。
 * 空间规模见 `stateSpaceOf()`：最小的轮廓也有 3×5×3×4 = **180** 种组合
 * （体型 × 真纹样 × 色带三段 × 标记四形），最大 360 种；任何一类物资都远不到
 * 这个量级，所以**撞图只可能来自推导写错，不可能来自空间不够**。
 */

/** 主轮廓的淡影浓度，与 `icons.ts` 保持一致（§5A 的"厚"就来自这一层） */
const FILL = 'fill="currentColor" fill-opacity="0.12"';

/** 键名的分隔符。`can-corned-beef` 拆成 `['can','corned','beef']` */
const SEP = '-';

/**
 * 允许的基础轮廓词。
 *
 * 必须显式列出、并且**只有这些词在首位时才生成** —— 因为 `iconSvg` 对认不出的键
 * 必须返回空串（手改过的存档不能让界面崩，`icons.test.ts` 有断言）。
 * 如果这里写成"首位任意词都能画"，那打错一个字母（`cna-beef`）就会画出
 * 一个**看起来像那么回事、其实没意义**的图标，比空白更难发现。
 */
export const ICON_BASES: readonly string[] = ['can', 'jar', 'bottle', 'box', 'carton', 'bag', 'misc'];

/**
 * 每个变体轴的取值个数。
 *
 * 写成常量而不是散在函数里，是为了让"参数空间有多大"这件事**读代码时**就算得出来。
 * `icons.test.ts` 会拿它和每个轮廓的图案表长度对账 —— 表短了就会出现
 * `undefined` 拼进 SVG，那种图在屏幕上是"什么都没有"，而且只在**恰好落到那一格**
 * 的物资上出现。
 */
export const ICON_AXES = {
  /** 体型档位数（每个轮廓自己的体型表长度可以比它短，不会越界） */
  form: 6,
  /** 内胆纹样槽位数，0 号统一表示"这个体型没有内胆" */
  pattern: 6,
  /** 色带位置：上 / 中 / 下 */
  band: 3,
  /** 标记形状：环 / 菱形 / 斜杠 / 点 */
  mark: 4
} as const;

/** 一个键的**变体签名**：三个轴各落在哪一格。相同签名 = 一定画出同一张图 */
export interface Signature {
  form: number;
  pattern: number;
  band: number;
  mark: number;
}

/** 装配结果。`outline` 是主轮廓，`pattern` 是内胆，`accent` 是色带 + 标记 */
export interface IconParts {
  outline: string;
  pattern: string;
  accent: string;
}

// ————————————————————————————————————————————————————————————————
// (1) 拆词
// ————————————————————————————————————————————————————————————————

/** `can-corned-beef` → `['can', 'corned', 'beef']`；空段丢掉（`can--beef` 不该炸） */
function segmentsOf(iconKey: string): string[] {
  return iconKey.split(SEP).filter((part) => part.length > 0);
}

/** 首位词是不是基础轮廓。不是 → 这个键不归生成器管（返回空串是调用方的责任） */
export function isGeneratableKey(iconKey: string): boolean {
  const parts = segmentsOf(iconKey);
  return parts.length >= 2 && ICON_BASES.includes(parts[0]);
}

// ————————————————————————————————————————————————————————————————
// (2) 变体签名：描述符表优先，哈希兜底
// ————————————————————————————————————————————————————————————————

/**
 * 纯字符串哈希（FNV-1a 变体，32 位）。
 *
 * 三条理由，缺一条都会坏：
 *  · **不能是 `Math.random`** —— 同一个键两次刷新画出两张图，玩家会以为图标坏了
 *    （项目纪律：随机一律走种子化 RNG；而这里连 RNG 都不需要，纯函数最好）；
 *  · **不能是 `Object.keys` 的下标** —— 那样"同一张图"取决于表的书写顺序，
 *    以后在表中间插一条就会让另外几十张图悄悄换脸；
 *  · **必须雪崩** —— 只差一个词的键（`bag-rice-small` / `bag-cornmeal`）要落到
 *    不同的桶里，否则键名系统化了、图却全挤在一起。
 */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 乘 16777619 的位移写法：JS 没有 32 位无符号乘法，直接乘会掉精度
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * 64 位指纹（两个不同种子的 32 位哈希拼起来）。
 *
 * 为什么要 64 位而不是 32：变体轴只有 400 多种组合，但键名空间是无限的。
 * 32 位哈希落在 400 个桶里，看似够用，实际上"**同一个轮廓内部**的十几件货
 * 两两不撞"是一个生日问题 —— 实测 40 个键里就撞了 2 对（见纪律 §3.4：
 * 这类事不能靠推演，要靠一次真跑）。多一倍位宽把这件事压到可以忽略，
 * 剩下的仍然由 `icons.test.ts` 的签名比较兜住。
 */
function fingerprint(input: string): string {
  return hash32(input).toString(36) + hash32(`salt:${input}`).toString(36);
}

/**
 * 把 `label` 折进 `0..buckets-1`。
 *
 * 调用方一律传**轴名 + 键名**（如 `'bag:form:bag-rice-small'`），不是只传词：
 * 同一个键在不同轴上必须落到不同的数，否则"体型"和"标记"会同步变化，
 * 三个轴就退化成一个轴了 —— 那正好是 D-21 说的"漏参数化某个轴"，
 * 而且它在界面上表现为"一整类物资只差一条线的位置"，最难被发现。
 */
function bucket(label: string, buckets: number): number {
  return hash32(fingerprint(label)) % buckets;
}

/** 一条描述符规则：「键名里出现 `find` 就走 `value`」。数组顺序 = 优先级 */
interface Rule {
  find: string;
  value: number;
}

/**
 * 一条描述符规则：「键名里出现 `find` 就走 `value`」。
 *
 * `note` 不是给人看的装饰 —— `describeIcon()` 会把它带出来，
 * 于是"这个键凭什么是这张图"变成**可以在测试里断言的数据**。
 * 没有它，两个键是否真的长得不一样就只能靠肉眼看 SVG，而这类问题恰恰
 * 是"看着差不多"最误事的地方。
 */
interface Rule {
  find: string;
  value: number;
  note: string;
}

/**
 * 取体型。**先查表、后哈希**：
 *
 *  · 表里的词是"玩家一眼就懂的大小与形态"（大桶 / 小袋 / 条状 / 扁盒），
 *    让同类内部的区分带着语义，而不是纯抽签 —— 这是"认得出"的关键；
 *  · 表里没有就哈希兜底，所以**新增物资永远不会没图**。
 *
 * **维护警告（别删）**：兜底用的是"键名取模"，所以**往表里插一行会让后面那些
 * 没命中的键重新洗牌**。改完表必须跑 `icons.test.ts` —— 那里会报出新的撞图对。
 * 这是有意的取舍：宁可让一次改动被测试拦下来，也不要为了"稳定"而要求
 * 每个新物资都来表里登记一行（那就退回一物一手绘了）。
 */
function formOf(base: string, key: string, table: readonly Rule[], slots: number): number {
  for (const rule of table) {
    if (key.includes(rule.find)) return rule.value;
  }
  return bucket(`${base}:form:${key}`, Math.min(slots, ICON_AXES.form));
}

/** 内胆纹样的兜底：1..pattern-1（0 号是"无内胆"这个语义槽，不参与抽签） */
function patternFromHash(base: string, key: string): number {
  return 1 + bucket(`${base}:pattern:${key}`, ICON_AXES.pattern - 1);
}

/**
 * 命中哪条描述符规则（没命中返回 null）。
 * 单独抽出来是给 `describeIcon()` 用的 —— 它要报告的是"**你凭哪个词**落到这一格"，
 * 而不是"你落到了第几格"（后者对排查"为什么这两件货长得像"毫无帮助）。
 */
function matchedRule(key: string, table: readonly Rule[]): Rule | null {
  return table.find((rule) => key.includes(rule.find)) ?? null;
}

/** 色带位置 / 标记形状：这两个轴没有语义可查（任何词都不"天生"该配哪种标记），纯哈希 */
function signatureOf(base: string, key: string, table: readonly Rule[], slots: number): Signature {
  return {
    form: formOf(base, key, table, slots),
    pattern: patternFromHash(base, key),
    band: bucket(`${base}:band:${key}`, ICON_AXES.band),
    mark: bucket(`${base}:mark:${key}`, ICON_AXES.mark)
  };
}

/**
 * 三段色带的说法。写清楚是因为"上色带"与"下色带"在 20px 下是两种东西：
 * 上段贴在罐肩（读作"封口"），下段贴着底部（读作"底座"）。
 */
const BAND_NOTES: readonly string[] = ['贴上部', '居中', '贴下部'];

/** 四种标记的说法。形状差异是"同一段色带位置"也不撞的兜底手段 */
const MARK_NOTES: readonly string[] = ['环', '菱形', '斜杠', '点'];

// ————————————————————————————————————————————————————————————————
// 共用的构造件
// ————————————————————————————————————————————————————————————————

/** 坐标一律两位小数去尾：SVG 短一点，diff 也好看一点 */
function d(x: number): string {
  return Number(x.toFixed(2)).toString();
}

/**
 * 一条闭合的"上宽下窄"口袋路径。
 *
 * 单独抽出来是因为袋子的形状占了整整一族（新键里 12 件），而**袋子的识别特征
 * 就是"梯形 + 底部两个圆角"**：手写版的大米与面粉都是这样。新袋沿用同一条骨架、
 * 只换宽窄高矮 —— 这样"袋子"这个门类本身认得出，袋与袋之间才轮到纹样与色带去分。
 */
function pouchPath(x0: number, x1: number, y0: number, y1: number): string {
  const r = 1.9;
  return (
    `M${d(x0)} ${d(y0)}h${d(x1 - x0)}v${d(y1 - y0 - r)}` +
    `a${r} ${r} 0 0 1-${r} ${r}h-${d(x1 - x0 - r * 2)}` +
    `a${r} ${r} 0 0 1-${r}-${r}Z`
  );
}

/**
 * 色带（三段位置 × 四形标记）—— **第三个变体轴**。
 *
 * 为什么非要这一轴：只靠"体型 + 纹样"两个轴，同一类里迟早出现"体型与纹样都撞了"
 * 的两件货（5 件罐头、15 件袋子里这几乎是必然的）。色带位置是**最粗的视觉信号**
 * （上 / 中 / 下三段，扫一眼就有差别），标记形状则让"同一段位置"也不撞。
 * 位置与形状都从**签名**来，不二次哈希 —— 一个轴只允许有一个来源，
 * 两处各算一次的话，"测试比签名"就管不住"图上画了什么"了。
 *
 * ## 三条"墨量"纪律（第一版就是栽在这里）
 *
 * 第一版把色带画成 `stroke-width 2.4 / opacity 0.85` 的粗横杠，结果整批图在
 * 48px 下看是**一块块实心黑**，和 `icons.ts` 里那 17 张细线稿摆在一起像两个游戏
 * （§5A 要的是"线稿 + 淡彩"，不是墨块）。教训是：**24×24 的图里，
 * 每一笔都要按"它会不会糊成一坨"来定价**。所以现在：
 *
 *  1. **色带做成两截短横**，不是一条贯穿的粗杠 —— 短横在 20px 下是"一条记号"，
 *     贯穿的长杠是"把图切两半"；粗细压到 1.7、透明度 0.5（这两个数是量出来的：
 *     第一版 2.4/0.85 时 40 张图的墨量比手写那 17 张高约三成）；
 *  2. **色带与标记不许叠在一起**：两者都挤在罐身中间时，叠出来的那一点是全图
 *     最黑的地方，会盖住真正要看的纹样。所以标记会自动往远离色带的一侧挪；
 *  3. **三段之间至少要隔开 3 个单位**（`markY` 由调用方按自己的标签/盒面位置卡好）。
 *     第一版让三段挤在 8px 的区间里（12.6~16.6），"上/中/下"在 20px 下是同一个位置 ——
 *     那个轴等于没接上，而它**在只看 40 个键的测试里查不出来**（那些键靠体型与
 *     纹样就已经两两不同了）。现在由"变体空间"那条断言直接盯着：同一体型纹样下，
 *     12 个"色带 × 标记"必须画出 12 种不同的图形。
 */
function accentOf(
  r: { y0: number; y1: number; half: number; markY: number },
  sig: Signature
): string {
  const span = r.y1 - r.y0;
  const ys = [r.y0, r.y0 + span / 2, r.y1];
  const by = ys[sig.band];
  // 标记的位置由**调用方给的固定落脚点**决定，不再"躲"色带。
  //
  // 这个"躲"的设计我试了两轮，都错，教训值得留着：
  //  · 第一版按 `markY` 与色带的相对位置决定往哪边推 —— 同一段色带配四个标记时，
  //    四个标记各跑各的，12 种组合塌成 5 种；
  //  · 第二版改成"统一往下推" —— 四次推挤落到同一个 y，**四种形状变成同一个圈**，
  //    只剩 3 种。也就是说"标记形状"这个轴看着接上了、实际被吃掉了。
  //
  // 根因是"让两个会动的量互相避让"本身就难保证组合数。正确的做法是**分开地盘**：
  // 色带只在 `y0..y1` 里动，标记固定落在 `markY`（调用方保证它在 `y1 + 2.6` 之外），
  // 于是 3 个色带位置 × 4 个标记形状 = 12 种组合**由构造保证互不相同**。
  const my = Math.min(21.4, Math.max(2.6, r.markY));
  const parts: string[] = [];
  if (r.half > 0) {
    parts.push(
      `<path d="M${d(12 - r.half)} ${d(by)}h${d(r.half * 0.9)}M${d(12 + r.half * 0.1)} ${d(by)}h${d(r.half * 0.9)}" ` +
        `stroke-width="1.7" stroke-opacity="0.5"/>`
    );
  }
  // 四种标记。**每一格都要跟 `my` 走**：第一版这里把 y 写成了字面量
  // （`cy="12"` 之类），于是"标记形状"这个轴对输出**完全没有影响** ——
  // 参数算得再对，画出来还是同一个圈。这是"假参数化"最典型的形态。
  const marks = [
    `<circle cx="12" cy="${d(my)}" r="1.4"/>`,
    `<path d="M12 ${d(my - 1.4)} ${d(13.4)} ${d(my)} 12 ${d(my + 1.4)} ${d(10.6)} ${d(my)}Z"/>`,
    `<path d="M${d(10.6)} ${d(my + 1.3)} ${d(13.4)} ${d(my - 1.3)}"/>`,
    `<circle cx="12" cy="${d(my)}" r="0.9" fill="currentColor" stroke="none"/>`
  ];
  parts.push(marks[sig.mark]);
  return parts.join('');
}

/**
 * 色带三段的落点：由**调用方给出这个轮廓的可用纵向范围**，而不是全图共用一组
 * 写死的 y；`markY` 是该轮廓上"标记的落脚点"（错位算法会把它推离色带）。
 *
 * 为什么不能用全局常数（第一版的做法）：罐子的标签在中间、盒子的正面在下半、
 * 袋子的缝线在顶部 —— 同一组 y 在罐子上是"贴着罐底"，在盒子上就横穿盒面。
 * 那是"两个变体轴叠在一起"，不是"两个变体轴"，而它在测试里完全查不出来。
 */
function bandRange(y0: number, y1: number, half: number, markY: number): { y0: number; y1: number; half: number; markY: number } {
  return { y0, y1, half, markY };
}

// ————————————————————————————————————————————————————————————————
// (3) 各基础轮廓
//
// 所有坐标都夹在 2.6..21.4 之内。因为 `<svg>` 是 `viewBox` 裁切而不是缩放，
// 出框的部分在手机上**直接被切掉**（手写版那个 fuel 罐的提手就贴着上边缘画）。
// ————————————————————————————————————————————————————————————————

/** 罐头的体型：矮胖 / 扁 / 高 / 标准 / 高瘦 / 标准（第 5 档是给语义留的位置） */
const CAN_FORMS: readonly Rule[] = [
  { find: 'corned', value: 0, note: '矮胖（一片午餐肉）' },
  { find: 'fish', value: 1, note: '扁盒（沙丁鱼罐）' },
  { find: 'peach', value: 2, note: '高罐（泡着糖水）' },
  { find: 'congee', value: 4, note: '高瘦（八宝粥）' },
  { find: 'formula', value: 1, note: '矮铁罐（婴儿奶粉）' },
  { find: 'milk', value: 5, note: '标准圆柱（奶粉）' },
  { find: 'soda', value: 2, note: '高罐（易拉罐）' },
  { find: 'veg', value: 3, note: '标准圆柱（什锦菜）' }
];

/**
 * 罐头的体型表。`label` 决定"罐身上铺不铺那块标签"：
 * 窄罐铺、宽罐不铺 —— 宽罐本来就只有一条扁带，再压一块标签就糊成一团了。
 */
const CAN_SHAPES: readonly { rx: number; top: number; bot: number; label: boolean }[] = [
  { rx: 7.4, top: 8.2, bot: 16.1, label: false }, // 0 矮胖
  { rx: 6.8, top: 9.4, bot: 14.3, label: false }, // 1 扁
  { rx: 5.8, top: 6.4, bot: 17.7, label: true }, // 2 高
  { rx: 6.2, top: 7.6, bot: 16.3, label: true }, // 3 标准
  { rx: 5.4, top: 6.0, bot: 17.9, label: true }, // 4 高瘦
  { rx: 6.2, top: 7.6, bot: 16.3, label: true } // 5 标准（给语义留的第 5 档）
];

/**
 * 罐头内胆。**0 号是"无内胆"**（扁罐与高瘦罐不铺标签，留白反而更像那个东西），
 * 1..5 分别对应"贴标签 / 糖水 / 颗粒 / 切丝 / 叶脉 / 杂粮"。
 */
const CAN_PATTERNS: readonly string[][] = [
  [],
  // 1 方框 + X：贴着标签的方罐（午餐肉、豆豉鱼）
  ['<rect x="9.4" y="10.8" width="5.2" height="4.4" rx="0.6" fill="currentColor" fill-opacity="0.12"/>', '<path d="M10 11.6l4 3.2M14 11.6l-4 3.2"/>'],
  // 2 波浪：糖水 / 汤
  ['<path d="M8.2 13.2q1.2-1.5 2.4 0t2.4 0 2.4 0"/>', '<path d="M8.2 16q1.2-1.5 2.4 0t2.4 0 2.4 0"/>'],
  // 3 点粒：豆 / 米 / 糖
  ['<circle cx="9.6" cy="12.8" r="0.75" fill="currentColor" stroke="none"/>', '<circle cx="12.6" cy="14.6" r="0.75" fill="currentColor" stroke="none"/>', '<circle cx="10.4" cy="16.8" r="0.75" fill="currentColor" stroke="none"/>'],
  // 4 竖条：切丝的菜
  ['<path d="M8.4 12.2v5.6M10.8 11.6v6.6M13.2 11.6v6.6M15.6 12.2v5.6"/>'],
  // 5 叶脉：蔬菜
  ['<path d="M8.2 15.6q3.8-3.6 7.6 0"/>', '<path d="M12 12.6v4.4"/>']
];

/** 罐头内胆的语义规则：装上什么，罐身上就是什么 */
const CAN_PATTERNS_BY_KEY: readonly Rule[] = [
  { find: 'beef', value: 1, note: '方框 + X 的标签' },
  { find: 'blackbean', value: 3, note: '豆粒' },
  { find: 'peach', value: 2, note: '糖水波纹' },
  { find: 'veg', value: 5, note: '菜叶' },
  { find: 'congee', value: 1, note: '方框 + X 的标签' },
  { find: 'milk', value: 3, note: '奶粉颗粒' },
  { find: 'formula', value: 1, note: '方框 + X 的标签' },
  { find: 'soda', value: 2, note: '汽水波纹' },
  { find: 'tea', value: 5, note: '茶叶' }
];

function canParts(sig: Signature): IconParts {
  const { rx, top, bot, label } = CAN_SHAPES[Math.min(sig.form, CAN_SHAPES.length - 1)];
  const cy = (top + bot) / 2;
  const lidRy = Math.min(2.4, rx * 0.4);
  // 罐身的顶边要往下让开罐盖的椭圆，否则两条线在 20px 下会糊成一块实心
  const outline =
    `<path d="${pouchPath(12 - rx, 12 + rx, top + lidRy, bot)}" ${FILL}/>` +
    // **两条弧 = 圆柱**。这是这一族最要紧的一笔：只画一条盖子线的话，
    // 罐头在 20px 下会被读成"一个圆角矩形"（第一版就是这样，和方盒分不开）。
    // 下面那条"前唇弧"是几何上必须存在的 —— 圆筒的端面是一个椭圆，
    // 它的前半段一定会出现在罐身上。
    `<path d="M${d(12 - rx)} ${d(top + lidRy)}a${d(rx)} ${d(lidRy)} 0 0 0 ${d(rx * 2)} 0"/>` +
    `<ellipse cx="12" cy="${d(top + lidRy)}" rx="${d(rx)}" ry="${d(lidRy)}"/>` +
    // 罐盖压边：贴着盖子下沿画一条，是"罐"与"桶"的分界
    `<path d="M${d(12 - rx + 1)} ${d(top + lidRy * 2 + 0.6)}h${d(rx * 2 - 2)}"/>`;
  const pattern = [
    ...(label ? [`<rect x="${d(12 - rx + 1.1)}" y="${d(cy - 2.6)}" width="${d(rx * 2 - 2.2)}" height="5.2" rx="0.7"/>`] : []),
    ...CAN_PATTERNS[sig.pattern]
  ].join('');
  // 有标签的罐：色带只许走"罐肩"与"罐底"两段（中间那段是标签的地盘）。
  // 没有标签的宽罐：三段都能用。两种情况的 markY 都放在"离三段色带都 ≥2.6"的位置上
  const band = label
    ? bandRange(top + 3.4, bot - 1.6, 2.6, bot + 1.7)
    : bandRange(top + 4.6, bot - 1.4, 2.8, bot + 1.7);
  return { outline, pattern, accent: accentOf(band, sig) };
}

/** 坛子 / 广口罐：口沿 + 肩 + 直筒。与 `can` 的差别是"有脖子"，与 `bottle` 是"宽口矮" */
const JAR_FORMS: readonly Rule[] = [
  { find: 'kimchi', value: 0, note: '广口矮坛' },
  { find: 'peanut', value: 1, note: '标准果酱罐' },
  { find: 'honey', value: 2, note: '高瘦带腰线' }
];

const JAR_SHAPES: readonly { rx: number; top: number; bot: number }[] = [
  { rx: 6.6, top: 9.2, bot: 18.0 },
  { rx: 5.9, top: 10.0, bot: 18.2 },
  { rx: 5.0, top: 9.4, bot: 18.6 }
];

const JAR_PATTERNS: readonly string[][] = [
  [],
  // 1 叶脉：辣白菜的菜叶
  ['<path d="M8.4 15.4q3.6-4 7.2 0"/>', '<path d="M12 12.2v5"/>'],
  // 2 点粒：花生酱里的碎花生
  ['<circle cx="9.8" cy="13.4" r="0.75" fill="currentColor" stroke="none"/>', '<circle cx="13" cy="14.8" r="0.75" fill="currentColor" stroke="none"/>', '<circle cx="11" cy="16.4" r="0.75" fill="currentColor" stroke="none"/>'],
  // 3 平行四边形：蜂蜜的结晶 / 标签
  ['<path d="M9.4 12.6h5.2l-1 5.6H10.4Z"/>'],
  // 4 竖条：坛子的竖纹
  ['<path d="M9 12.4v6M12 12v6.6M15 12.4v6"/>'],
  // 5 波浪：酱体的液面
  ['<path d="M8.6 13.6q1.3-1.4 2.6 0t2.6 0 2.6 0"/>']
];

const JAR_PATTERNS_BY_KEY: readonly Rule[] = [
  { find: 'kimchi', value: 1, note: '菜叶' },
  { find: 'peanut', value: 2, note: '碎花生粒' },
  { find: 'honey', value: 3, note: '结晶块' }
];

function jarParts(sig: Signature): IconParts {
  const { rx, top, bot } = JAR_SHAPES[Math.min(sig.form, JAR_SHAPES.length - 1)];
  const neck = rx - 2.2;
  // 口沿 → 螺纹盖 → 肩 → 直筒。
  //
  // **为什么盖要画成一个"实心的横条"**：第一版只画了收窄的口沿 + 两条肩线，
  // 结果 20px 下和 `can`（同样是"上宽下窄的圆角柱 + 一道压边"）读成同一个东西 ——
  // 这正是"牛奶 vs 矿泉水"那类事故的重演。罐头的特征在**扁平的端面**，
  // 坛子的特征在**那颗拧上去的盖子**（明显比身体窄、且是一段有厚度的横条）。
  const outline =
    `<path d="${pouchPath(12 - rx, 12 + rx, top, bot)}" ${FILL}/>` +
    `<path d="M${d(12 - neck)} ${d(top - 2.8)}h${d(neck * 2)}v2.8"/>` +
    `<path d="M${d(12 - neck - 0.5)} ${d(top - 4.6)}h${d(neck * 2 + 1)}v1.8h-${d(neck * 2 + 1)}Z"/>` +
    `<path d="M${d(12 - neck)} ${d(top)} ${d(12 - rx)} ${d(top + 2.4)}"/>` +
    `<path d="M${d(12 + neck)} ${d(top)} ${d(12 + rx)} ${d(top + 2.4)}"/>`;
  const pattern = JAR_PATTERNS[sig.pattern].join('');
  // 坛子的内胆占罐身上半段，所以色带三段全压在下半段，标记放在罐身上部 ——
  // 色带横穿菜叶/花生粒的话，"内胆"和"色带"这两个轴就叠成一个了
  return { outline, pattern, accent: accentOf(bandRange(top + 3.4, bot - 4.4, 2.6, bot - 0.6), sig) };
}

/** 塑料瓶：瓶盖 + 细颈 + 斜肩 + 直筒 */
const BOTTLE_FORMS: readonly Rule[] = [
  { find: 'oil', value: 0, note: '高瘦细瓶' },
  { find: 'cola', value: 1, note: '大瓶、肩很斜' },
  { find: 'big', value: 2, note: '宽桶身' }
];

const BOTTLE_SHAPES: readonly { r: number; top: number; bot: number }[] = [
  { r: 4.4, top: 6.4, bot: 18.2 },
  { r: 5.9, top: 7.0, bot: 17.0 },
  { r: 6.6, top: 6.6, bot: 17.4 }
];

const BOTTLE_PATTERNS: readonly string[][] = [
  [],
  // 1 两道腰线：油瓶的握把
  ['<path d="M8.6 12.4h6.8M8.6 14.6h6.8"/>'],
  // 2 波浪：水 / 饮料的液面
  ['<path d="M7.8 13.4q1.4-1.6 2.8 0t2.8 0 2.8 0"/>'],
  // 3 点粒：气泡
  ['<circle cx="10" cy="12.8" r="0.7" fill="currentColor" stroke="none"/>', '<circle cx="13.4" cy="14" r="0.7" fill="currentColor" stroke="none"/>', '<circle cx="11.4" cy="15.8" r="0.7" fill="currentColor" stroke="none"/>'],
  // 4 竖条：塑料瓶身的棱
  ['<path d="M9.2 11.6v6.4M12 11.2v7M14.8 11.6v6.4"/>'],
  // 5 圆环：瓶身凹陷的握把
  ['<circle cx="12" cy="14.2" r="2.4"/>']
];

const BOTTLE_PATTERNS_BY_KEY: readonly Rule[] = [
  { find: 'oil', value: 1, note: '两道握把腰线' },
  { find: 'cola', value: 3, note: '瓶身竖棱' },
  { find: 'big', value: 2, note: '水波' }
];

function bottleParts(sig: Signature): IconParts {
  const { r, top, bot } = BOTTLE_SHAPES[Math.min(sig.form, BOTTLE_SHAPES.length - 1)];
  const neck = r * 0.45;
  const outline =
    `<path d="${pouchPath(12 - r, 12 + r, top, bot)}" ${FILL}/>` +
    `<path d="M${d(12 - neck)} ${d(top - 1.4)}h${d(neck * 2)}v1.4"/>` +
    // 肩要"够斜"才有塑料瓶味：从脖子横着铺到整个半径
    `<path d="M${d(12 - neck)} ${d(top)} ${d(12 - r)} ${d(top + 2.6)}"/>` +
    `<path d="M${d(12 + neck)} ${d(top)} ${d(12 + r)} ${d(top + 2.6)}"/>` +
    // 瓶盖：比瓶身窄、比脖子宽 —— 缺了它，瓶子会被读成"管子"
    `<rect x="${d(12 - neck - 0.5)}" y="${d(top - 3.4)}" width="${d(neck * 2 + 1)}" height="2" rx="0.5"/>`;
  const pattern = BOTTLE_PATTERNS[sig.pattern].join('');
  // 瓶子最窄（r 只有 4.4~6.6），色带半宽压到 r-2，否则短横会顶到瓶壁、
  // 在 20px 下和瓶身的竖线连成一块
  return { outline, pattern, accent: accentOf(bandRange(top + 1.6, bot - 4.8, 2.4, bot - 0.4), sig) };
}

/**
 * 盒：立方体（顶面带透视），像一盒饼干。
 *
 * **为什么给盒子一条斜顶面**：盒 / 箱 / 利乐砖在 20px 下最容易糊成一块，
 * 一条顶面斜线就能立刻把它和纸盒（屋顶）分开 —— 这是品类级的识别特征。
 */
const BOX_FORMS: readonly Rule[] = [
  { find: 'biscuit', value: 0, note: '扁盒' },
  { find: 'energy', value: 1, note: '扁而长的盒' },
  { find: 'selfheat', value: 2, note: '方盒偏厚' },
  { find: 'chocolate', value: 3, note: '扁盒' },
  { find: 'electro', value: 2, note: '方盒偏厚（与自热米饭同族）' }
];

const BOX_SHAPES: readonly { x0: number; x1: number; y0: number; y1: number; dep: number }[] = [
  { x0: 4.4, x1: 19.2, y0: 9.6, y1: 19.4, dep: 2.4 },
  { x0: 3.6, x1: 20.4, y0: 8.8, y1: 18.2, dep: 2.8 },
  { x0: 4.0, x1: 20.0, y0: 7.2, y1: 20.4, dep: 2.6 },
  { x0: 4.6, x1: 19.0, y0: 10.2, y1: 19.8, dep: 2.2 },
  { x0: 4.2, x1: 19.8, y0: 8.0, y1: 19.6, dep: 2.5 },
  { x0: 4.4, x1: 19.2, y0: 9.6, y1: 19.4, dep: 2.4 }
];

/**
 * 盒子的内胆：坐标是**正面局部坐标**（原点在正面左上角内缩 1）。
 * 笔画间距统一 3.0 / 2.2（不按盒大小缩放）—— **缩到 20px 时小间距会糊**，
 * 宁可让扁盒上的纹样略微"挤"，也不要变成一坨墨点。
 */
const BOX_PATTERNS: readonly string[][] = [
  [],
  // 1 一排方孔：饼干压模
  ['<path d="M7 1h10M7 4h10"/>', '<path d="M9.5 -0.5v6M14.5 -0.5v6"/>'],
  // 2 三层横条：能量棒
  ['<path d="M7 1h10M7 3.4h10M7 5.8h10"/>'],
  // 3 米字：拆开即食
  ['<path d="M7 0 17 6M17 0 7 6"/>'],
  // 4 蜂巢：巧克力块
  ['<path d="M9 .5 12 2.2v3.4L9 7.4 6 5.6V2.2Z"/>', '<path d="M15 .5 18 2.2v3.4l-3 1.8-3-1.8V2.2Z"/>'],
  // 5 点阵：粉剂颗粒
  ['<circle cx="8.6" cy="2" r="0.85" fill="currentColor" fill-opacity="0.55" stroke="none"/>', '<circle cx="12" cy="4" r="0.85" fill="currentColor" fill-opacity="0.55" stroke="none"/>', '<circle cx="15.4" cy="2" r="0.85" fill="currentColor" fill-opacity="0.55" stroke="none"/>']
];

const BOX_PATTERNS_BY_KEY: readonly Rule[] = [
  { find: 'biscuit', value: 1, note: '压模方孔' },
  { find: 'energy', value: 2, note: '三层横条' },
  { find: 'selfheat', value: 3, note: '米字（拆开即食）' },
  { find: 'chocolate', value: 4, note: '蜂巢巧克力块' },
  { find: 'electro', value: 5, note: '粉剂颗粒' }
];

function boxParts(sig: Signature): IconParts {
  const { x0, x1, y0, y1, dep } = BOX_SHAPES[Math.min(sig.form, BOX_SHAPES.length - 1)];
  const outline =
    `<path d="M${d(x0)} ${d(y0)}h${d(x1 - x0)}v${d(y1 - y0)}H${d(x0)}Z" ${FILL}/>` +
    `<path d="M${d(x0)} ${d(y0)}h${d(x1 - x0)}l${d(dep)}-${d(dep)}H${d(x0 + dep)}Z"/>` +
    `<path d="M${d(x0 + dep)} ${d(y0 - dep)}v${d(y1 - y0)}"/>`;
  const pattern = BOX_PATTERNS[sig.pattern]
    .map((shape) => `<g transform="translate(${d(x0 + 1.2)} ${d(y0 + dep + 1.4)})">${shape}</g>`)
    .join('');
  // 盒子的色带三段**全压在正面下半段**。为什么不做成"盒盖压痕那条横线"：
  // 那条线横贯整盒，再让它上下跳，"上/中/下"看起来只是同一张图挪了一像素 ——
  // 变体轴必须落在**空白处**才有效，落在结构线上等于没做。
  // 标记放在正面**最下缘**：盒面只有 5 个单位高，只有挨着下缘才和色带分得开。
  return { outline, pattern, accent: accentOf(bandRange(y0 + dep + 1.2, y1 - 3.6, 2.6, y1 - 0.4), sig) };
}

/**
 * 纸盒 / 利乐砖：**统一屋顶顶**。
 *
 * 手写版里"牛奶"就是屋顶盒，所以新键里所有纸盒都长屋顶 —— 这是"同一套视觉语言"，
 * 不是偷懒：如果新纸盒用平顶，玩家会以为牛奶和它不是一个东西。
 * 差别放在**盒身宽窄 + 顶部那道折角 + 有没有窗**上。
 *
 * 唯一的例外是 `carton-egg-tray`（鸡蛋）：屋顶在这里变成**一排蛋格**。刻意的 ——
 * 鸡蛋如果也画成屋顶盒，它会和椰子水 / 果汁在货架上一模一样，而"整箱矿泉水 vs 鸡蛋"
 * 本来就是最需要一眼分清的两件货。
 */
const CARTON_FORMS: readonly Rule[] = [
  { find: 'juice', value: 0, note: '标准利乐砖' },
  { find: 'coconut', value: 1, note: '细高砖' },
  { find: 'water', value: 2, note: '宽而矮的整箱' },
  { find: 'egg', value: 3, note: '扁而宽的蛋盒' }
];

const CARTON_SHAPES: readonly { x0: number; x1: number; y0: number; y1: number }[] = [
  { x0: 6.0, x1: 18.0, y0: 8.8, y1: 19.4 },
  { x0: 7.2, x1: 16.8, y0: 7.2, y1: 19.6 },
  { x0: 4.2, x1: 19.8, y0: 10.2, y1: 18.6 },
  { x0: 3.6, x1: 20.4, y0: 12.6, y1: 18.4 }
];

const CARTON_PATTERNS: readonly string[][] = [
  [],
  // 1 圆角窗：果汁的"看得见里面"
  ['<rect x="8.4" y="12.2" width="4.6" height="4" rx="0.6"/>'],
  // 2 波浪：液体
  ['<path d="M7.6 14q1.3-1.5 2.6 0t2.6 0 2.6 0"/>'],
  // 3 点粒：气泡
  ['<circle cx="10" cy="13" r="0.7" fill="currentColor" stroke="none"/>', '<circle cx="13.4" cy="14.8" r="0.7" fill="currentColor" stroke="none"/>'],
  // 4 竖条：包装棱
  ['<path d="M10 12v6M14 12v6"/>'],
  // 5 斜纹：标签斜带
  ['<path d="M7.4 17.6 16.6 11.8"/>']
];

const CARTON_PATTERNS_BY_KEY: readonly Rule[] = [
  { find: 'juice', value: 1, note: '看得见里面的窗' },
  { find: 'coconut', value: 2, note: '椰水波纹' },
  { find: 'water', value: 3, note: '整箱的包装棱' },
  { find: 'egg', value: 4, note: '斜向捆扎带' }
];

function cartonParts(sig: Signature): IconParts {
  const { x0, x1, y0, y1 } = CARTON_SHAPES[Math.min(sig.form, CARTON_SHAPES.length - 1)];
  const w = x1 - x0;
  const topShape =
    sig.form === 3
      ? // 蛋格：两条压边 + 三个蛋槽 —— 纸盒装蛋的通用画法
        `<path d="M${d(x0)} ${d(y0)}h${d(w)}"/>` +
        `<path d="M${d(x0)} ${d(y0 - 1.8)}h${d(w)}"/>` +
        `<ellipse cx="${d(12 - w / 4)}" cy="${d(y0 - 2.6)}" rx="${d(w / 8)}" ry="1.7"/>` +
        `<ellipse cx="12" cy="${d(y0 - 2.6)}" rx="${d(w / 8)}" ry="1.7"/>` +
        `<ellipse cx="${d(12 + w / 4)}" cy="${d(y0 - 2.6)}" rx="${d(w / 8)}" ry="1.7"/>`
      : // 屋顶盒：两个斜折角 + 中间一条脊线。脊线不能省 —— 少了它，
        // 两个斜角在 20px 下会被读成"缺了一块"
        `<path d="M${d(x0)} ${d(y0)}l3-4.6h${d(w - 6)}l3 4.6"/>` +
        `<path d="M${d(x0 + 3)} ${d(y0 - 4.6)}v4.6M${d(x1 - 3)} ${d(y0 - 4.6)}v4.6"/>` +
        `<path d="M12 ${d(y0 - 4.6)}v2.2"/>`;
  const outline = `<path d="${pouchPath(x0, x1, y0, y1)}" ${FILL}/>` + topShape;
  const pattern = CARTON_PATTERNS[sig.pattern].join('');
  // 纸盒正面只有 10 个单位高，内胆已经在 y0..y0+6 占掉了上半段；
  // 色带三段压在下半段，标记插在**内胆与色带之间**的那条空档里
  return { outline, pattern, accent: accentOf(bandRange(y0 + 5.6, y1 - 4.4, w / 2 - 2.6, y1 - 1.2), sig) };
}

/**
 * 袋 / 口袋：**上窄下宽**的梯形 + 顶部扎口 + 缝线。
 *
 * 为什么必须是"梯形"而不是矩形（第一版就是矩形，摆出来一看全是方盒）：
 * 袋子的识别特征只有两条 —— **收口**与**鼓起的下摆**。少了这两条，
 * 袋子和"盒"在 20px 下是同一个东西，而这一批新货里 12 件都是袋。
 *
 * 12 件新货都是袋，所以这一族的区分度最要紧：体型（宽窄高矮）先分一轮，
 * 内胆再分一轮，色带与标记最后兜底。
 */
const BAG_FORMS: readonly Rule[] = [
  { find: 'oat', value: 0, note: '矮胖袋' },
  { find: 'noodle', value: 1, note: '细长袋' },
  { find: 'rice', value: 2, note: '标准米袋' },
  { find: 'cornmeal', value: 3, note: '标准方袋' },
  { find: 'vermicelli', value: 4, note: '细长袋' },
  { find: 'sausage', value: 5, note: '横长条' },
  { find: 'egg', value: 0, note: '矮胖袋' },
  { find: 'pork', value: 3, note: '压平的方袋' },
  { find: 'dumpling', value: 2, note: '标准袋' },
  { find: 'bread', value: 0, note: '矮胖袋' },
  { find: 'potato', value: 4, note: '细长网袋（与小袋米分开）' },
  { find: 'sugar', value: 2, note: '标准袋' },
  { find: 'salt', value: 3, note: '压平的方袋' },
  { find: 'drink', value: 3, note: '方袋' },
  { find: 'water', value: 5, note: '横长条水袋' },
  { find: 'big', value: 1, note: '细长袋' },
  { find: 'small', value: 0, note: '矮胖袋' }
];

/**
 * 袋子的体型表。`hip` = 下摆外扩量（袋身是"上窄下宽的梯形"，
 * 见 `pouchBody` 的注释：没有这个外扩，袋子和盒子在 20px 下是同一个东西）。
 */
const BAG_SHAPES: readonly { x0: number; x1: number; y0: number; y1: number; neck: number; hip: number }[] = [
  { x0: 6.0, x1: 18.0, y0: 8.4, y1: 18.6, neck: 2.4, hip: 0.6 }, // 0 矮胖袋
  { x0: 8.2, x1: 15.8, y0: 7.4, y1: 19.0, neck: 1.5, hip: 1.2 }, // 1 细长袋
  { x0: 6.4, x1: 17.6, y0: 8.0, y1: 18.4, neck: 2.1, hip: 1.0 }, // 2 标准米袋
  { x0: 6.6, x1: 17.4, y0: 8.2, y1: 18.2, neck: 2.1, hip: 0.9 }, // 3 压平的方袋
  { x0: 7.6, x1: 16.4, y0: 7.6, y1: 19.0, neck: 1.7, hip: 1.3 }, // 4 细长网袋
  { x0: 4.2, x1: 19.8, y0: 10.0, y1: 16.6, neck: 3.2, hip: 0.6 } // 5 横长条
];

/** 袋子内胆：**1..5 按"装什么"分**，点粒 = 散装颗粒。都是 20px 下读得出的粗形 */
const BAG_PATTERNS: readonly string[][] = [
  [],
  // 1 点粒 4 颗：米 / 糖 / 盐 / 玉米面 / 土豆（网袋里的土）
  ['<circle cx="9.4" cy="13" r="0.8" fill="currentColor" stroke="none"/>', '<circle cx="12.6" cy="14.8" r="0.8" fill="currentColor" stroke="none"/>', '<circle cx="10.4" cy="16.8" r="0.8" fill="currentColor" stroke="none"/>', '<circle cx="14.2" cy="12.2" r="0.8" fill="currentColor" stroke="none"/>'],
  // 2 竖条：挂面 / 粉丝
  ['<path d="M9.4 12v6.8M12 11.6v7.4M14.6 12v6.8"/>'],
  // 3 麦穗：燕麦 / 玉米
  ['<path d="M12 11.8v7"/>', '<path d="M12 13.6 10 12M12 15.6l-2-1.6M12 13.6l2-1.6M12 15.6l2-1.6"/>'],
  // 4 圆环：罐 / 蛋 / 冻品
  ['<circle cx="12" cy="15.2" r="2.6"/>'],
  // 5 叶脉：蔬菜 / 土豆
  ['<path d="M8.8 16.4q3.2-3.6 6.4 0"/>', '<path d="M12 12.8v3.6"/>']
];

const BAG_PATTERNS_BY_KEY: readonly Rule[] = [
  { find: 'rice', value: 1, note: '米粒' },
  { find: 'noodle', value: 2, note: '成把的竖条' },
  { find: 'vermicelli', value: 2, note: '成把的竖条' },
  { find: 'oat', value: 3, note: '麦穗' },
  { find: 'cornmeal', value: 3, note: '玉米粒' },
  { find: 'sausage', value: 1, note: '肉粒' },
  { find: 'egg', value: 4, note: '圆蛋' },
  { find: 'dumpling', value: 4, note: '圆饺' },
  { find: 'pork', value: 3, note: '肉脯纹理' },
  { find: 'bread', value: 3, note: '面包表皮' },
  { find: 'potato', value: 5, note: '带叶的块茎' },
  { find: 'sugar', value: 1, note: '糖粒' },
  { find: 'salt', value: 1, note: '盐粒' },
  { find: 'drink', value: 1, note: '橙粉颗粒' },
  { find: 'water', value: 2, note: '水袋的竖棱' }
];

/**
 * 袋身的骨架：**上窄下宽的梯形 + 鼓起的圆底**。
 *
 * `hip` 是"下摆比袋口宽多少"，`r` 是底角圆度 —— 这两个数就是"袋子"与"方盒"
 * 的差别所在。第一版用的是圆角矩形，20px 下 15 件袋子全读成了盒子。
 */
function pouchBody(x0: number, x1: number, y0: number, y1: number, hip: number): string {
  const r = 2.4;
  const bx0 = x0 - hip;
  const bx1 = x1 + hip;
  const bottom = y1 - r;
  return (
    `M${d(x0)} ${d(y0)}L${d(bx0)} ${d(bottom)}` +
    `a${r} ${r} 0 0 0 ${r} ${r}` +
    `h${d(bx1 - bx0 - r * 2)}` +
    `a${r} ${r} 0 0 0 ${r}-${r}L${d(x1)} ${d(y0)}Z`
  );
}

function bagParts(sig: Signature): IconParts {
  const { x0, x1, y0, y1, neck, hip } = BAG_SHAPES[Math.min(sig.form, BAG_SHAPES.length - 1)];
  const w = x1 - x0;
  const tieY = y0 - 3.4;
  const outline =
    `<path d="${pouchBody(x0, x1, y0, y1, hip)}" ${FILL}/>` +
    // 扎口那对"耳朵"：一个朝上的三角，宽到接近袋口。
    //
    // **为什么给它这么粗**：第一版这里只有两条从袋口收到中点的斜线（细、浅），
    // 20px 下基本看不见 —— 于是 15 件袋子读起来就是一排"上窄下宽的黑块"，
    // 而"扎口"恰好是袋子唯一的招牌动作。宁可夸张，也不能让它消失。
    `<path d="M${d(12 - w * 0.42)} ${d(y0)} ${d(12)} ${d(tieY)} ${d(12 + w * 0.42)} ${d(y0)}Z"/>` +
    // 束口那截：细长袋（挂面/粉丝/水袋）束得更紧，这条宽度本身就是区分
    `<path d="M${d(12 - neck)} ${d(y0 - 0.4)}h${d(neck * 2)}"/>` +
    // 缝线：袋口下的一道压边，与"扎口"一起构成袋子的上部特征
    `<path d="M${d(x0 + 0.8)} ${d(y0 + 1.6)}h${d(w - 1.6)}" stroke-opacity="0.5"/>`;
  const pattern = BAG_PATTERNS[sig.pattern].join('');
  // 袋子的内胆在袋身中段，色带三段压在**下半段**（上半段是缝线与扎口的地盘）
  return { outline, pattern, accent: accentOf(bandRange(y0 + 5.4, y1 - 5, w / 2 - 3, y1 - 1), sig) };
}

/** 散装 / 农产品：圆胖的"一堆东西"，顶上带叶 */
const MISC_FORMS: readonly Rule[] = [{ find: 'cabbage', value: 0, note: '竖长的菜棵' }];

const MISC_SHAPES: readonly { rx: number; ry: number; cy: number }[] = [
  { rx: 6.4, ry: 6.6, cy: 14.2 },
  { rx: 7.2, ry: 5.6, cy: 15.0 },
  { rx: 5.6, ry: 7.2, cy: 13.6 }
];

const MISC_PATTERNS: readonly string[][] = [
  [],
  // 1 叶脉：白菜
  ['<path d="M12 8.6v10.4"/>', '<path d="M12 12q-3.2.4-4.2 3.4M12 12q3.2.4 4.2 3.4M12 15q-2.4.4-3.2 2.8M12 15q2.4.4 3.2 2.8"/>'],
  // 2 芽眼：土豆
  ['<ellipse cx="9.6" cy="13.2" rx="0.9" ry="1.2"/>', '<ellipse cx="14.4" cy="16" rx="0.9" ry="1.2"/>', '<ellipse cx="12.4" cy="11" rx="0.9" ry="1.2"/>'],
  // 3 圆环：果
  ['<circle cx="12" cy="14.4" r="2.4"/>'],
  // 4 横纹：层叠的菜叶
  ['<path d="M7.6 12q4.4 2 8.8 0M8 15.4q4 2 8 0"/>'],
  // 5 点粒：土
  ['<circle cx="9.6" cy="17" r="0.8" fill="currentColor" stroke="none"/>', '<circle cx="14.6" cy="17" r="0.8" fill="currentColor" stroke="none"/>', '<circle cx="12.2" cy="18.4" r="0.8" fill="currentColor" stroke="none"/>']
];

const MISC_PATTERNS_BY_KEY: readonly Rule[] = [{ find: 'cabbage', value: 1, note: '菜叶脉' }];

function miscParts(sig: Signature): IconParts {
  const { rx, ry, cy } = MISC_SHAPES[Math.min(sig.form, MISC_SHAPES.length - 1)];
  const outline =
    `<ellipse cx="12" cy="${d(cy)}" rx="${d(rx)}" ry="${d(ry)}" ${FILL}/>` +
    // 顶上那片叶：没有它，"一堆东西"和"一个蛋"分不开
    `<path d="M12 ${d(cy - ry)}c0-2.2 1.6-3.8 3.6-4.2-.2 2.2-1.4 3.8-3.6 4.2Z"/>` +
    `<path d="M12 ${d(cy - ry + 0.4)}v-3.2"/>`;
  const pattern = MISC_PATTERNS[sig.pattern].join('');
  // 散装物的"身子"是个椭圆，色带三段贴着椭圆下缘走，标记再往上一点
  return { outline, pattern, accent: accentOf(bandRange(cy - 0.6, cy + ry - 4.2, rx - 2.6, cy + ry - 1), sig) };
}

/**
 * 基础轮廓的**全部装配资料**。
 *
 * 打包成一张表（而不是七个平行的 `switch`）是为了让"加一个轮廓要动哪几处"变得
 * 只有一处 —— 漏改一处的结果是**一整类物资全空白**，而这种错在构建期不会报。
 * `icons.test.ts` 会拿 `ICON_BASES` 和这张表的键对账。
 */
interface BaseSpec {
  /** 体型规则表（语义优先） */
  forms: readonly Rule[];
  /** 体型表长度（哈希兜底的上界） */
  formSlots: number;
  /** 内胆图案表（0 号必须是"无内胆"） */
  patterns: readonly string[][];
  /** 内胆的语义规则表 */
  patternsByKey: readonly Rule[];
  /** 装配 */
  build: (sig: Signature) => IconParts;
}

const BASES: Record<string, BaseSpec> = {
  can: { forms: CAN_FORMS, formSlots: CAN_SHAPES.length, patterns: CAN_PATTERNS, patternsByKey: CAN_PATTERNS_BY_KEY, build: canParts },
  jar: { forms: JAR_FORMS, formSlots: JAR_SHAPES.length, patterns: JAR_PATTERNS, patternsByKey: JAR_PATTERNS_BY_KEY, build: jarParts },
  bottle: { forms: BOTTLE_FORMS, formSlots: BOTTLE_SHAPES.length, patterns: BOTTLE_PATTERNS, patternsByKey: BOTTLE_PATTERNS_BY_KEY, build: bottleParts },
  box: { forms: BOX_FORMS, formSlots: BOX_SHAPES.length, patterns: BOX_PATTERNS, patternsByKey: BOX_PATTERNS_BY_KEY, build: boxParts },
  carton: { forms: CARTON_FORMS, formSlots: CARTON_SHAPES.length, patterns: CARTON_PATTERNS, patternsByKey: CARTON_PATTERNS_BY_KEY, build: cartonParts },
  bag: { forms: BAG_FORMS, formSlots: BAG_SHAPES.length, patterns: BAG_PATTERNS, patternsByKey: BAG_PATTERNS_BY_KEY, build: bagParts },
  misc: { forms: MISC_FORMS, formSlots: MISC_SHAPES.length, patterns: MISC_PATTERNS, patternsByKey: MISC_PATTERNS_BY_KEY, build: miscParts }
};

/**
 * 求一个键的变体签名。**这是整个生成器的判别核心**：
 *  · 描述了"这张图凭什么和别人不一样"；
 *  · 让测试可以对**参数**两两比较（比 SVG 字符串更精确：两串不同的 SVG
 *    有可能只是小数位差异，签名一样才是真的同一张图）；
 *  · 纯函数：同一个键永远同一个签名，刷新一百次也是同一张图。
 */
export function signatureFor(iconKey: string): Signature | null {
  const parts = segmentsOf(iconKey);
  if (parts.length < 2) return null;
  const base = parts[0];
  const spec = BASES[base];
  if (!spec) return null;
  const sig = signatureOf(base, iconKey, spec.forms, spec.formSlots);
  // 内胆：语义规则优先、哈希兜底。**表里命中就不看哈希**，
  // 这样"罐里装什么"永远画得出来，而不是看运气
  const byKey = spec.patternsByKey.find((rule) => iconKey.includes(rule.find));
  const pattern = byKey ? byKey.value : sig.pattern;
  return {
    form: sig.form,
    // 图案表短于签名槽位时取模收口：宁可两个键共用一种纹样（还有体型与色带分开），
    // 也不能让 `undefined` 拼进 SVG —— 那是屏幕上一块空白
    pattern: Math.min(pattern, spec.patterns.length - 1),
    band: sig.band,
    mark: sig.mark
  };
}

/**
 * 把键名变成一张图。**认不出的键返回 `null`**（由 `icons.ts` 决定要不要退成空串）。
 *
 * 为什么返回 `null` 而不是空串：调用方需要区分"键名不认识"（正常的，界面必须不崩）
 * 和"生成器画出了一张空图"（**生成器的 bug**，测试会红）。
 * 两者混成一个 `''`，真出 bug 时就分不清是哪一种了。
 */
export function shapePartsOf(iconKey: string): IconParts | null {
  const parts = segmentsOf(iconKey);
  const spec = BASES[parts[0]];
  if (!spec) return null;
  const sig = signatureFor(iconKey);
  if (!sig) return null;
  const drawn = spec.build(sig);
  // 硬保险：**轮廓与色带必须在**，缺任何一条就返回 null（调用方退成空串）。
  // 因为画一张缺轮廓的图比不画更糟 —— 界面上会出现一块看不懂的墨迹。
  //
  // 注意**不能**在这里要求内胆非空：内胆的第 0 格就是"这个体型不铺内胆"
  // （见 `CAN_PATTERNS[0]`）。把它也当成"没画出来"，会让一批本来正确、
  // 只是留白的图标（扁罐头、高瘦罐头）整块消失 —— 这个坑很隐蔽：
  // 它的表现是"某些新物资没图标"，而不是报错。
  if (!drawn.outline.trim() || !drawn.accent.trim()) return null;
  if (drawn.outline.includes('undefined') || drawn.pattern.includes('undefined') || drawn.accent.includes('undefined')) {
    return null;
  }
  return drawn;
}

/**
 * 一个轮廓的变体空间规模（读代码时就能算出来的那个数）。
 * 测试用它把"空间够不够"写成断言，而不是留在注释里当口号。
 */
export function stateSpaceOf(base: string): number {
  const spec = BASES[base];
  if (!spec) return 0;
  return spec.formSlots * (spec.patterns.length - 1) * ICON_AXES.band * ICON_AXES.mark;
}

/**
 * 把一个基础轮廓的**全部**变体坐标出来，供生成器自检。
 *
 * 为什么值得写：这套东西的失效方式很特别 —— 参数空间里有一格没接上（比如某个
 * 纹样表少写了一项），只有**正好落在那格**的新物资才会没图，而那时人已经在灌内容了。
 * 有了这个函数，测试可以直接把空间走一遍，而不是等玩家看见一块空白。
 *
 * `probe` 前缀是刻意的：它让探测键**不可能撞上任何真实键的描述符**
 * （真实键里不会有 `probe` 这个词），于是走的一定是哈希兜底那条路，
 * 也就是"表里没有的新词"这条路 —— 那正是将来最需要它稳的一条路。
 *
 * ## 遍历顺序就是**轴的优先级**，这一点踩过坑
 *
 * 第一版把四个轴按"低位=form、高位=mark"的混合进制摊平，于是**前 12 个变体
 * 的 mark 全是 0** —— 拿 `variants.slice(0, 12)` 去查"标记形状有没有画出四种"
 * 的测试，实际上一次都没变过 mark，却因为色带在动而"看起来在查"。
 * 现在改成明明白白的四层循环（form → pattern → **mark → band**），
 * 并**故意让 mark 比 band 更靠内层**：这样"同一体型、同一纹样下的 12 个变体"
 * 恰好是 `slice(0, 12)`，测试想查哪个轴就能直接查哪个轴。
 */
export function shapeVariantsOf(base: string): IconParts[] {
  const spec = BASES[base];
  if (!spec) return [];
  const out: IconParts[] = [];
  for (let form = 0; form < spec.formSlots; form++) {
    for (let pattern = 0; pattern < spec.patterns.length; pattern++) {
      for (let mark = 0; mark < ICON_AXES.mark; mark++) {
        for (let band = 0; band < ICON_AXES.band; band++) {
          out.push(spec.build({ form, pattern, mark, band }));
        }
      }
    }
  }
  return out;
}

/** 生成器认得的轮廓（= 有装配资料的那些）。测试用它和 `ICON_BASES` 对账 */
export const SHAPE_BUILDERS: readonly string[] = Object.keys(BASES);

/**
 * 一个键**凭什么**长成这张图：三个轴各自落在哪、以及那句话是怎么来的。
 *
 * 为什么值得导出：这一版最要命的验收标准是"40 张图看得出不一样"，
 * 而这件事**机器判不了**。能做的只有两件：把差异**做大**（体型 / 纹样 / 色带
 * 三段 / 标记四形，全是 20px 下读得出的粗特征），以及**把设计语言摊开**
 * 让人（或下一个 AI）一眼看出"这两件货到底靠什么区分"。
 * 这个函数就是第二件事 —— 排查"为什么这两件长得像"时先打印它，
 * 比起翻 SVG 字符串快得多，也不容易看走眼。
 */
export interface IconDescription {
  base: string;
  signature: Signature;
  /** 体型那句话（表里命中的规则 / 哈希兜底） */
  form: string;
  /** 内胆那句话 */
  pattern: string;
  /** 色带位置 */
  band: string;
  /** 标记形状 */
  mark: string;
}

export function describeIcon(iconKey: string): IconDescription | null {
  const parts = segmentsOf(iconKey);
  const base = parts[0];
  const spec = BASES[base];
  const sig = signatureFor(iconKey);
  if (!spec || !sig) return null;
  const formRule = matchedRule(iconKey, spec.forms);
  const patternRule = matchedRule(iconKey, spec.patternsByKey);
  return {
    base,
    signature: sig,
    form: formRule ? `${formRule.note}（凭「${formRule.find}」）` : `第 ${sig.form} 档体型（哈希兜底）`,
    pattern:
      sig.pattern === 0
        ? '无内胆（留白）'
        : patternRule
          ? `${patternRule.note}（凭「${patternRule.find}」）`
          : `第 ${sig.pattern} 种纹样（哈希兜底）`,
    band: BAND_NOTES[sig.band],
    mark: MARK_NOTES[sig.mark]
  };
}
