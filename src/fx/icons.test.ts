/**
 * 图标的守护测试。
 *
 * 图标这件事有两个**构建期与类型期都发现不了**的坏法，只能靠测试盯：
 *
 *  1. 物资表里 `icon` 打错一个字母 → 屏幕上那块是**空白**（`iconSvg` 返回空串），
 *     而 `icon` 是 `string`，类型检查不会报；
 *  2. 两件物资**画得一模一样** —— 原来"可可粉铁罐"借用 `can`、
 *     "一条烟"与"一本画册"都借用 `toolbox`，于是它们和黄豆罐头在界面上无法分辨。
 *     图鉴里这是致命的：玩家分不出自己点亮的是哪一件。
 *
 * 第二组（`组合式生成的图标`）守的是 `fx/iconShapes.ts` 那套组合式生成器本身
 * —— 它就是用来清偿"一物一手绘"那笔欠账（登记册里的 D-21）的东西。
 * 它的失效方式很阴：生成器里漏参数化某一个轴（比如"内胆纹样"没接进输出），
 * 类型检查、构建、以后加的 100 件物资**全都不会报**，只是那几十张图慢慢变成同一张。
 * 所以必须在这里、在键名清单上，把"两两不同"钉死。
 *
 * 这一组里有两类断言，**分工不同，别把它们看成一回事**：
 *   · 比**图片字符串**、比**签名**的（打在 40 个新键上）—— 守"今天这 40 件货
 *     在货架上分得开"；
 *   · 比**变体空间**的（打在参数空间上）—— 守"明天再加一百件货也分得开"。
 * 两类都要有：只有前者时，"某个轴其实没接进输出"可能因为那 40 个键恰好在别的轴上
 * 就不同而被漏掉（这个坑真踩过，见下面色带那一条的注释）。
 */
import { describe, expect, it } from 'vitest';
import { ITEM_DEFS } from '../data/items';
import { ICON_BASES, SHAPE_BUILDERS, shapeVariantsOf, signatureFor, stateSpaceOf } from './iconShapes';
import { ITEM_ICON_KEYS, hasIcon, iconKeyOverlaps, itemIconSvg } from './icons';

describe('物资图标', () => {
  it('★ 物资表里的每个 icon 键都真的画出来了（打错字母 = 屏幕上空白）', () => {
    const missing = ITEM_DEFS.filter((d) => !hasIcon(d.icon)).map((d) => `${d.id} → ${d.icon}`);
    expect(missing).toEqual([]);
  });

  it('★ 每个物资都有自己独立的图标键（不许两件货长得一样）', () => {
    const byIcon = new Map<string, string[]>();
    for (const def of ITEM_DEFS) {
      const list = byIcon.get(def.icon) ?? [];
      list.push(def.name);
      byIcon.set(def.icon, list);
    }
    const shared = [...byIcon.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([icon, names]) => `${icon} 被 ${names.length} 件货共用：${names.join(' / ')}`);
    expect(shared).toEqual([]);
  });

  it('渲染出来的是真 SVG，而且带得动"淡影填充"（§5A 的厚度）', () => {
    const svg = itemIconSvg('can');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
    // 至少有一半图标用了 fill-opacity 那层淡影 —— 那是这一版"看起来厚"的来源
    const filled = ITEM_ICON_KEYS.filter((key) => itemIconSvg(key).includes('fill-opacity'));
    expect(filled.length).toBeGreaterThan(ITEM_ICON_KEYS.length / 2);
  });

  it('认不出的键返回空串，而不是抛异常（手改过的档不能让界面崩）', () => {
    expect(itemIconSvg('这个键不存在')).toBe('');
  });
});

/**
 * 这批键**一个都不能少**，而且是**字面写死**的。
 *
 * 为什么不从 `ITEM_DEFS` 里读：那 40 件物资由另一个人在合并（任务书明令不许碰
 * `data/items.ts`）。如果测试从表里取键，那么在两组改动合到一起之前，
 * 这组测试会在**两种情况下都变绿**：生成器坏了，或者物资还没进来。
 * 写死之后它的含义就唯一了 —— "这 40 个键现在必须画得出 40 张不同的图"，
 * 与内容表合并到哪一步无关。键名本身也就在这份测试里留了档。
 */
const NEW_ICON_KEYS: readonly string[] = [
  // ———————— food ————————
  'can-corned-beef',
  'can-fish-blackbean',
  'can-peach-syrup',
  'can-veg-mixed',
  'can-congee-eight',
  'box-biscuit-pressed',
  'box-energy-bar',
  'bag-oat-rolled',
  'bag-noodle-dried',
  'bag-rice-small',
  'bag-cornmeal',
  'bag-vermicelli',
  'box-rice-selfheat',
  'bag-sausage-ham',
  'bag-egg-vacuum',
  'bag-pork-dried',
  'bag-dumpling-frozen',
  'bag-bread-toast',
  'carton-egg-tray',
  'misc-cabbage',
  'bag-potato',
  'jar-kimchi',
  'jar-peanut-butter',
  'jar-honey',
  'bag-sugar',
  'bag-salt',
  'bottle-plastic-oil',
  'can-milk-powder',
  'can-baby-formula',
  'box-chocolate-dark',
  // ———————— water ————————
  'bottle-plastic-big',
  'carton-water-case',
  'bottle-cola-big',
  'carton-juice',
  'can-soda',
  'carton-coconut',
  'box-electrolyte',
  'can-tea-leaves',
  'bag-drink-orange',
  'bag-water-pouch'
];

describe('组合式生成的图标（`fx/iconShapes.ts`，它清偿的是登记册里的 D-21）', () => {
  it('键名清单本身有 40 条且不重复（写错一条这份守护就名不副实）', () => {
    expect(NEW_ICON_KEYS.length).toBe(40);
    expect(new Set(NEW_ICON_KEYS).size).toBe(40);
  });

  it('★ 40 个新键**每一个**都画出了非空 SVG（漏一个 = 货架上一块空白）', () => {
    const blank = NEW_ICON_KEYS.filter((key) => itemIconSvg(key).trim() === '');
    expect(blank).toEqual([]);
  });

  it('★ 40 张图**两两不同**（比字符串，直接可靠）', () => {
    const rendered = NEW_ICON_KEYS.map((key) => [key, itemIconSvg(key)] as const);
    const bySvg = new Map<string, string[]>();
    for (const [key, svg] of rendered) {
      const list = bySvg.get(svg) ?? [];
      list.push(key);
      bySvg.set(svg, list);
    }
    const twins = [...bySvg.values()]
      .filter((keys) => keys.length > 1)
      .map((keys) => `这些键画出了同一张图：${keys.join(' / ')}`);
    expect(twins).toEqual([]);
    // 顺带钉住"不同"的规模：40 条键必须产出 40 条不同的字符串，
    // 否则上面那条断言可以靠"大家都画同一个空壳"通过（空壳也各不相同就怪了）
    expect(new Set(rendered.map(([, svg]) => svg)).size).toBe(40);
  });

  it('★ 同一个轮廓内部的变体签名两两不同（不同轮廓本来外形就不一样，不算撞）', () => {
    // 按**基础轮廓**分组再比：`can` 与 `bag` 就算签名一样，外形也天差地别。
    // 真正要盯的是"同一类里两件货参数完全相同"—— 那才是"漏参数化某个轴"的样子。
    const byBaseThenSignature = new Map<string, string[]>();
    for (const key of NEW_ICON_KEYS) {
      const sig = signatureFor(key);
      expect(sig, `${key} 求不出签名`).not.toBeNull();
      const base = key.split('-')[0];
      const label = `${base} ${sig?.form}/${sig?.pattern}/${sig?.band}/${sig?.mark}`;
      const list = byBaseThenSignature.get(label) ?? [];
      list.push(key);
      byBaseThenSignature.set(label, list);
    }
    const twins = [...byBaseThenSignature.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([label, keys]) => `签名 ${label} 被这些键共用：${keys.join(' / ')}`);
    expect(twins).toEqual([]);
  });

  it('每个轮廓的变体空间都够大（撞图只可能来自推导写错，不是空间不够）', () => {
    const tight = ICON_BASES.filter((base) => stateSpaceOf(base) < 100);
    expect(tight).toEqual([]);
  });

  it('★ 生成的图仍然是 24×24 的 currentColor 线稿（§5A 的硬约束，不能被生成器改掉）', () => {
    const bad = NEW_ICON_KEYS.filter((key) => {
      const svg = itemIconSvg(key);
      return (
        !svg.startsWith('<svg') ||
        !svg.includes('viewBox="0 0 24 24"') ||
        !svg.includes('stroke="currentColor"') ||
        !svg.includes('fill="none"') ||
        // 生成器一旦写出写死的颜色（比如某个纹样手滑写了十六进制），
        // 图标就不再跟着 CSS 变色了 —— 这在手机上就是"选中的格子图标还是黑的"
        /#[0-9a-f]{3,6}/i.test(svg)
      );
    });
    expect(bad).toEqual([]);
  });

  it('每一个基础轮廓都有装配函数（加了词表却忘了写实现 = 一整类物资全空白）', () => {
    expect([...SHAPE_BUILDERS].sort()).toEqual([...ICON_BASES].sort());
  });

  it('★ 色带位置与标记形状**真的画进了图里**（只改签名不改输出 = 假参数化）', () => {
    // 这一条是**故意让它失败一次之后补上的**，来由值得写清楚：
    //
    // 我先把"标记形状"这个轴压平成常量跑了一次，结果 40 键那两条断言**全绿** ——
    // 因为那 40 个键恰好两两在体型或纹样上就不一样，根本轮不到色带与标记去分。
    // 也就是说：**这两条断言并没有在守色带与标记**，它们是"看起来在守"。
    //
    // 而色带与标记是设计上真实存在的变体轴（同一类物资里迟早会出现"体型与纹样
    // 都撞了、只剩色带能分"的两件货）。所以这里对**变体空间**做断言：
    // 同一轮廓、同一体型与纹样之下，四个标记形状必须产出四段不同的图形，
    // 三个色带位置必须产出三段不同的图形 —— 否则那个轴就是白设的。
    const broken: string[] = [];
    // 遍历**全部**轮廓，不是只遍历这 40 个键用到的那些：色带与标记是"留给后面
    // 几百件物资"的兜底手段，只在今天用到的轮廓上验，等于将来加一类就重新赌一次
    for (const base of ICON_BASES) {
      const variants = shapeVariantsOf(base);
      expect(variants.length, `${base} 的变体空间是空的`).toBeGreaterThan(0);
      // 遍历顺序是 form → pattern → mark → band（见 shapeVariantsOf 的注释），
      // 所以前 12 个正好是"同一体型、同一纹样"下的 3 个色带位置 × 4 个标记形状
      const twelve = variants.slice(0, 12);
      const distinctAccents = new Set(twelve.map((p) => p.accent));
      if (distinctAccents.size < 12) {
        broken.push(`${base}：同一体型纹样下的 12 个"色带 × 标记"只画出了 ${distinctAccents.size} 种`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('参数空间里没有"画出来是空的"格子（漏接一个轴只会让**恰好落在那一格**的物资空白）', () => {
    // 内胆的第 0 格**本来就该是空的**（"这个体型不铺内胆"是一个语义槽，见
    // `CAN_PATTERNS[0]` 的注释），所以这里只要求轮廓与色带恒在、
    // 内胆要么是空串要么是一段真图形 —— 不允许出现 `undefined` 拼进字符串那种
    // "看着有、其实什么都没有"的半成品。
    const broken: string[] = [];
    for (const base of ICON_BASES) {
      const variants = shapeVariantsOf(base);
      expect(variants.length).toBeGreaterThan(0);
      variants.forEach((parts, i) => {
        const label = `${base} 的第 ${i} 个变体`;
        if (!parts.outline.trim()) broken.push(`${label}没有轮廓`);
        if (!parts.accent.trim()) broken.push(`${label}没有色带与标记`);
        if (parts.pattern.includes('undefined')) broken.push(`${label}的内胆拼进了 undefined`);
        if (parts.outline.includes('undefined') || parts.accent.includes('undefined')) {
          broken.push(`${label}拼进了 undefined`);
        }
      });
    }
    expect(broken).toEqual([]);
  });

  it('手写表与生成器不抢同一个键（抢了就会静默换掉一张验收过的图）', () => {
    expect(iconKeyOverlaps()).toEqual([]);
  });
});

