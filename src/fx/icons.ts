/**
 * 图标总入口：**手写线稿（17 件）+ 组合式生成（新键）**。
 *
 * 全部 24×24、stroke=currentColor，跟着 CSS 的颜色走（§5A 的纸底 / 墨色 / 朱红）。
 *
 * ## 这一版的结构（以及为什么是"新老共存"而不是"把手写的也重构成生成器"）
 *
 * 下面 `ITEM_ICONS` 那 17 张手写图是**玩家验收过的**（"每件都认得出"）。
 * 任务书上给了两条路：把它们抽成"基础轮廓 + 空变体轴"，或者让它们继续走手写。
 * **选后者**，理由只有一条但足够：
 *
 * > 重构它们的收益是"整齐"，风险是"玩家认不出来了"。
 * > 而已经被真实验收过的像素，是这个项目里最贵的东西。
 *
 * 生成器（`iconShapes.ts`）只服务**新键**。这不是过渡期的妥协，而是长期的正确分工：
 * 手写表回答"这一件长什么样"，生成器回答"这一类怎么派生出无数件"。
 * 将来 §5A 的淡彩真进来了，两边的产出都是同一套 `<svg>` 字符串，键名一个字都不用动。
 *
 * 这一版同时**清偿了 D-21**（一物一手绘的产能瓶颈）—— 它原本登记在这里，
 * 现在换成了组合式生成，欠账登记册里那条已改为 done（附残留说明）。
 *
 * ## 判别规则（写在这里，因为它决定 `hasIcon` 的真假）
 *
 * `icon` 是 `string`，打错一个字母不会有任何类型报错。所以生成器**只认
 * `基础词-…` 这种形态的键**（`can-corned-beef`），而且基础词必须是白名单里的
 * 罐/瓶/盒/袋/箱/坛/散装七个之一。于是：
 *   · 手写键（`can` / `rice` / `cocoa_tin`）**永远走手写表** —— 注意 `can` 只有一段，
 *     正好落在"生成器不认单段键"这条规则外面，不会被生成器抢走；
 *   · 打错的键（`cna-beef`、`can_beef`）两边都不认 → 空串 → `hasIcon` 为假 → 测试红。
 *
 * ## 这一版解决的两个问题（都来自玩家反馈）
 *
 *  1. **「根本分辨不出是啥」** —— 原来的图标有几个轮廓太像：牛奶 vs 矿泉水都是圆角柱，
 *     大米 vs 面粉都是袋子，医疗箱 vs 救援箱都是箱子。改法是给每个品类**一个不同的外轮廓**
 *     （瓶子/袋子/罐子/板条箱/被子/圆盒），并让内部细节在 20px 下也读得出来；
 *  2. **「难看」** —— 原来全是一根细线勾出来的空壳子。§5A 要的是 BG3 那种"厚"：
 *     线稿 + 淡彩。这里用 `fill="currentColor" fill-opacity="0.12"` 给主轮廓铺一层墨色淡影，
 *     再把**关键的那一小块**（煤油罐的 X、火柴盒的擦火面、书页）实心填上。
 *     纯 SVG、无图片、无新依赖 —— 将来换成图像生成的淡彩图标时，键名不用动。
 *
 * 一条纪律：**新物资一定要有自己的键**。奢侈品原来借用了 can / toolbox / quilt 的图标，
 * 于是"可可粉铁罐"和"黄豆罐头"长得一模一样 —— 图鉴里那是致命的。
 */
import { isGeneratableKey, shapePartsOf } from './iconShapes';

/** 主轮廓的淡影浓度。0.12 是"看得见厚度、但不变成色块"的位置 */
const FILL = 'fill="currentColor" fill-opacity="0.12"';

const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

const ITEM_ICONS: Record<string, string> = {
  // ———————— 主食 ————————
  /** 黄豆罐头：扁圆柱 + 一圈罐盖压边 */
  can: `<ellipse cx="12" cy="7.4" rx="6.6" ry="2.6" ${FILL}/><path d="M5.4 7.4v9.4c0 1.5 3 2.6 6.6 2.6s6.6-1.1 6.6-2.6V7.4"/><path d="M5.4 7.4c0 1.5 3 2.6 6.6 2.6s6.6-1.1 6.6-2.6"/>`,
  /** 泡面：碗 + 三缕卷面 + 一双筷子 */
  noodles: `<path d="M4.6 11.4h14.8l-1.5 7.9a2 2 0 0 1-2 1.6H8.1a2 2 0 0 1-2-1.6Z" ${FILL}/><path d="M3.4 11.4h17.2"/><path d="M8.6 8.6c.9-1.6 2.1 1.4 3-.1.9-1.5 2.1 1.4 3-.1"/><path d="M15.4 3.4 14 8.8M18.4 4 17 9.4"/>`,
  /** 大米：米袋（上面扎口）+ 四粒米 */
  rice: `<path d="M8.2 7.6h7.6l1.5 11.2a2 2 0 0 1-2 2.2H8.7a2 2 0 0 1-2-2.2Z" ${FILL}/><path d="M9.6 7.6 11 4.4h2l1.4 3.2"/><path d="M11.4 13.2h1.2M13.4 15.4h1.2M11.4 17.4h1.2M13.4 11.4h1.2"/>`,
  /** 面粉：立式口袋（对角折口 + 中缝） */
  flour: `<path d="M7.4 8.2h9.2l1.4 11a1.9 1.9 0 0 1-1.9 2.1H7.9A1.9 1.9 0 0 1 6 19.2Z" ${FILL}/><path d="M7.4 8.2 9.8 4.6h4.4l2.4 3.6"/><path d="M12 8.2v13"/>`,

  // ———————— 饮水 ————————
  /** 矿泉水：瓶子（肩 + 两道腰线 + 瓶盖） */
  water: `<path d="M9.6 3.2h4.8v2.6c2 1.4 2.6 2.8 2.6 4.6v8.4a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-8.4c0-1.8.6-3.2 2.6-4.6Z" ${FILL}/><path d="M8.4 5.8h7.2"/><path d="M8.4 13.2h7.2M8.4 16h7.2"/>`,
  /** 牛奶：利乐砖（屋脊顶 + 斜折角） */
  milk: `<path d="M6.6 8.6h10.8v11.6a1.8 1.8 0 0 1-1.8 1.8H8.4a1.8 1.8 0 0 1-1.8-1.8Z" ${FILL}/><path d="M6.6 8.6 9.6 3.6h4.8l3 5"/><path d="M9.6 3.6v5M14.4 3.6v5"/>`,

  // ———————— 医疗 ————————
  /** 绷带：卷起来的绷带（外圈 + 卷芯 + 拉出来的一头） */
  bandage: `<circle cx="11" cy="12" r="6.2" ${FILL}/><circle cx="11" cy="12" r="2.1"/><path d="M17.2 12h3.2"/><path d="M9.2 10.4h3.6M9.2 13.6h3.6"/>`,
  /** 感冒药：两粒胶囊并排（每粒中缝 + 一半实心） */
  pill: `<rect x="2.6" y="7.4" width="18.8" height="4.6" rx="2.3" ${FILL}/><path d="M12 7.4v4.6"/><rect x="6.2" y="13.2" width="11.6" height="4.4" rx="2.2"/><path d="M12 13.2v4.4"/><path d="M2.6 9.7h9.4" stroke-opacity="0.55"/>`,

  // ———————— 燃料 / 保暖 ————————
  /** 燃料罐：扁方罐 + 提手 + 危险标记（那个 X 是实心填的，一眼认得出） */
  fuel: `<path d="M5.6 8.2h9.2l3.6 3.6v8.2a1.9 1.9 0 0 1-1.9 1.9H7.5a1.9 1.9 0 0 1-1.9-1.9Z" ${FILL}/><path d="M9.8 8.2V4.6h3.4"/><rect x="9" y="13.6" width="5.2" height="4.4" rx="0.8" fill="currentColor" fill-opacity="0.75" stroke="none"/><path d="M10.2 14.8l2.8 2.4M13 14.8l-2.8 2.4" stroke="#f7f3ea" stroke-width="1.2"/>`,
  /** 棉被：叠好的被褥（菱形绗缝 + 折边） */
  quilt: `<path d="M3.4 9.6h17.2v8.8a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2Z" ${FILL}/><path d="M3.4 13.4h17.2"/><path d="M7.4 9.6 9.4 6.2h5.2l2 3.4"/><path d="M6.6 11.4l1.4 1.4M11.2 11.4l1.4 1.4M15.8 11.4l1.4 1.4M8.8 15.4l1.4 1.4M13.4 15.4l1.4 1.4"/>`,

  // ———————— 工具 ————————
  /** 电池：圆柱形（正极小凸头 + 两道电量纹） */
  battery: `<rect x="3" y="7.6" width="15.4" height="8.8" rx="1.6" ${FILL}/><path d="M20.6 10.4v3.2"/><path d="M6.4 10.6v2.8M9.4 10.6v2.8"/>`,
  /** 工具箱：提手箱（箱盖线 + 两个搭扣） */
  toolbox: `<rect x="3" y="9.6" width="18" height="9.8" rx="1.8" ${FILL}/><path d="M9 9.6V7.8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.8"/><path d="M3 13.8h18"/><path d="M7.6 13.8v2.4M16.4 13.8v2.4"/>`,

  // ———————— 奢侈品（各自一个键，绝不借用主食 / 工具的图标） ————————
  /** 可可粉铁罐：高方罐 + 盖沿 + 标签框 */
  cocoa_tin: `<path d="M6.6 8.4h10.8v10.4a2 2 0 0 1-2 2H8.6a2 2 0 0 1-2-2Z" ${FILL}/><path d="M5.6 5.2h12.8v3.2H5.6z"/><rect x="9" y="12.4" width="6" height="4" rx="0.8"/>`,
  /** 一条烟：立着的烟盒 + 露出三支 */
  cigarettes: `<rect x="6.2" y="8.4" width="11.6" height="12.4" rx="1.4" ${FILL}/><path d="M8.6 8.4V4.8h2.2v3.6M12.6 8.4V4.8h2.2v3.6"/><path d="M6.2 13.2h11.6"/>`,
  /** 半袋咖啡豆：口袋 + 三颗豆（中间一道裂纹） */
  coffee_beans: `<path d="M7.6 8.6h8.8l1.2 10.6a1.9 1.9 0 0 1-1.9 2.1H8.3a1.9 1.9 0 0 1-1.9-2.1Z" ${FILL}/><path d="M7.6 8.6 10 5h4l2.4 3.6"/><ellipse cx="10.6" cy="14.4" rx="1.5" ry="2"/><path d="M10.6 12.6v3.6M14.4 12.2a1.5 2 0 1 0 0 3.6"/>`,
  /** 一本画册：合着的书 + 书脊 + 一条书签 */
  picture_book: `<path d="M5.4 4.6h11.2a2 2 0 0 1 2 2v12.8H7.4a2 2 0 0 1-2-2Z" ${FILL}/><path d="M18.6 19.4H7.4a2 2 0 0 0-2 2h13.2"/><path d="M14.6 4.6v7l-2-1.4-2 1.4v-7"/>`,
  /** 印花的暖水袋：圆肚 + 螺纹盖 + 一道提带 */
  hot_water_bag_gift: `<path d="M12 8.4c3.6 0 6.2 2.6 6.2 6s-2.6 6.4-6.2 6.4-6.2-3-6.2-6.4 2.6-6 6.2-6Z" ${FILL}/><path d="M10 4.6h4v3.8h-4z"/><path d="M10.8 3.4h2.4"/><path d="M8.6 15.2h6.8" stroke-opacity="0.6"/>`
};

const UI_ICONS: Record<string, string> = {
  box: '<path d="M3.4 8.6 12 4.2l8.6 4.4v9L12 22l-8.6-4.4Z"/><path d="M3.4 8.6 12 13l8.6-4.4"/><path d="M12 13v9"/>',
  sort: '<path d="M4 7h13M4 12h9M4 17h5"/><path d="M18 14.4 21 17.4l-3 3"/>',
  tag: '<path d="M12.6 3.4H20V10.8L10.6 20.2a1.6 1.6 0 0 1-2.3 0L3.8 15.7a1.6 1.6 0 0 1 0-2.3Z"/><circle cx="16.2" cy="7.4" r="1.3"/>',
  hand: '<path d="M8 12V6.4a1.5 1.5 0 0 1 3 0V12m0-.6V5a1.5 1.5 0 0 1 3 0v6.4m0-.8V7a1.5 1.5 0 0 1 3 0v8.4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.6-3.8L5.6 16a1.6 1.6 0 0 1 2.6-1.9"/>',
  check: '<path d="M5 13.2 9.6 18 19 7.4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  warning: '<path d="M12 4.6 21 20H3Z"/><path d="M12 10v4.4"/><path d="M12 17.4h.01"/>',
  crush: '<path d="M3.4 17.4 12 13l8.6 4.4"/><path d="M3.4 12.6 12 8.2l8.6 4.4"/>'
};

export function iconSvg(key: string, className = 'ico'): string {
  const body = ITEM_ICONS[key] ?? UI_ICONS[key] ?? generatedBody(key);
  if (!body) return '';
  return `<svg class="${className}" ${SVG_ATTRS} aria-hidden="true">${body}</svg>`;
}

/**
 * 把键交给组合式生成器，拿回一段 `<svg>` 内容（认不出的键 → 空串）。
 *
 * 为什么要"手写优先、生成兜底"这个顺序，而不是反过来：手写表是**验收过的名单**，
 * 万一同名的生成结果出现了（比如以后有人把基础词表加宽），也应该让验收过的那张赢 ——
 * 否则会静默地换掉一张玩家已经认熟的图，而没有任何测试会红。
 */
function generatedBody(key: string): string {
  if (!isGeneratableKey(key)) return '';
  const parts = shapePartsOf(key);
  return parts ? parts.outline + parts.pattern + parts.accent : '';
}

export function itemIconSvg(iconKey: string): string {
  return iconSvg(iconKey, 'ico ico-item');
}

/**
 * 这个图标键有没有画出来。`icons.test.ts` 用它守两件事：
 *
 *  1. **物资表里的每个 icon 键都必须真的存在** —— 打错一个字母，
 *     屏幕上就是**一块空白**，而这种错在构建与类型检查里都不会报（`icon` 是 string）；
 *  2. **奢侈品不许借用别人的图标** —— 原来"可可粉铁罐"用的是 `can`、
 *     "一条烟"和"一本画册"都用 `toolbox`，于是它们和黄豆罐头长得一模一样。
 *     图鉴里那是致命的：玩家分不出自己点亮的是哪一件。
 *
 * 手写与生成两条路都算"存在"：组合式生成器的产出是**由构造保证**的，
 * 不需要在表里登记，所以这里不能只看 `ITEM_ICONS`。
 */
export function hasIcon(key: string): boolean {
  return ITEM_ICONS[key] !== undefined || UI_ICONS[key] !== undefined || generatedBody(key) !== '';
}

/** 物资图标（不含 UI 图标）的键。测试用它反查"有没有两个品类画得一样" */
export const ITEM_ICON_KEYS: readonly string[] = Object.keys(ITEM_ICONS);

/**
 * 手写表与生成器**有没有抢同一个键**。
 *
 * 两者本来是不可能重叠的（生成器要求"基础词 + 至少一段"，手写键都是单段或下划线），
 * 但这个前提是**隐含的**：以后给基础词表加上 `rice`、或者写一个 `bag-xxx` 的手写键，
 * 就会悄悄出现"同一件货有两张图、以手写那张为准"。测试用它把这条隐含前提钉住。
 */
export function iconKeyOverlaps(): string[] {
  return ITEM_ICON_KEYS.filter((key) => isGeneratableKey(key));
}
