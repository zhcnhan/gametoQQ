/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「怎么玩」那一段的守卫（`ui/howToPlay.ts`）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 这一组拦的是什么
 *
 * 那段引导里最贵的东西**不是文字，是那个示例货架**：它复用整理页真实的类名
 * （`.shelf-row` / `.row-tape` / `.row-cells` / `.slot`），所以它长得像游戏、
 * 而且窄屏规则会自动跟上。反过来说，一旦有人：
 *
 *  · 把类名写成 `.shelfrow` / `.slot-icon-wrap` 这类**看起来对**的名字 →
 *    屏幕上就是一个**没有样式的空盒子**，不报错、构建通过、测试也全绿；
 *  · 或者为了让示例"更好看"给格子加一句内联 `width` / `background` →
 *    示例与游戏从此**各走各的**（这就是 `windowThemes` 的 `fall` 名单
 *    手抄漂了 21 场那种错的同一个形状）。
 *
 * 所以这一组对着**代码里的类名清单**断言，而不是对着截图。
 *
 * ## 另一条硬约束：这一页不许提灾难名
 *
 * `ui/PrologueScreen.test.ts` 里有一条**整页**断言：热浪局的那一页
 * 不许出现"寒潮"两个字（`allText(root)`）。"怎么玩"这一段是那一页的第一段，
 * 所以它**只能讲通用玩法** —— 一旦有人顺手写一句"寒潮里要囤燃料"，
 * 那条整页断言就会红，而红的地方离肇事处很远。
 * 这里就地钉一条更窄的：它说的不是任何一场具体的灾难。
 */
import { describe, expect, it } from 'vitest';
import { DISASTER_DEFS } from '../data/disaster';
import { getItemDef } from '../data/items';
import { FakeDocument, allText, asElement, installFakeWindow, type FakeElement } from './fakeDom';
import { howToPlayHtml } from './howToPlay';

function mountHtml(html: string): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  asElement(root).innerHTML = html;
  return root;
}

const HOWTO = mountHtml(howToPlayHtml());

/**
 * 示例必须用的类名 —— 与 `ui/OrganizeScreen.ts` 里那几处**逐字一致**
 * （行号写在这里，将来对不上时能一眼找到该比对的地方）：
 *
 *  · `.shelf-row` / `.row-tape` / `.row-cells` / `--cols` → `OrganizeScreen.ts:909-916`
 *  · `.slot` / `.slot-icon` / `.slot-count` / `.slot.is-empty` → `OrganizeScreen.ts:997-1014`
 */
const REAL_CLASSES = ['shelf-rows', 'shelf-row', 'row-tape', 'row-cells', 'slot', 'slot-icon'];

describe('★ 示例复用的是**真货架**的类名，不是另画一张图', () => {
  it('★★ 整理页那一套类名一个不少（写错一个字母 = 屏幕上是个没样式的空盒子）', () => {
    const html = howToPlayHtml();
    for (const cls of REAL_CLASSES) {
      /*
       * ⚠ 判据是"类名以**独立的词**出现在某个 `class="…"` 里"，
       * 不是 `toContain('class="shelf-rows ')` —— 第一版那个写法在
       * `class="shelf-rows">`（类名后面直接跟着 `>` 或换行）上就误报了。
       */
      const inClassAttr = [...html.matchAll(/class="([^"]*)"/g)].some((m) =>
        (m[1] ?? '').split(/\s+/).includes(cls)
      );
      expect(inClassAttr, `示例里少了 .${cls} —— 它就不再是"真货架"了`).toBe(true);
    }
  });

  it('★ 示例给的是**贴与没贴两行**（只给一条贴好的，玩家看见的是一个装饰）', () => {
    expect(HOWTO.querySelectorAll('.shelf-row')).toHaveLength(2);
    expect(HOWTO.querySelectorAll('.shelf-row.is-taped')).toHaveLength(1);
    expect(HOWTO.querySelectorAll('.row-tape')).toHaveLength(2);
  });

  it('★ 有货的格子会数件数、空格子留在那儿（跟游戏里一样）', () => {
    // 5 个有货 + 1 个空
    expect(HOWTO.querySelectorAll('.slot.is-empty')).toHaveLength(7); // 上行 1 + 下行 6
    const packed = HOWTO.querySelectorAll('.slot').filter((el) => el.attributes?.['aria-hidden'] === 'true');
    expect(packed.length).toBeGreaterThan(0);
    // ×3 那一格：件数只在 >1 时出现
    expect(allText(HOWTO)).toContain('×3');
  });

  it('★★ 那几格**不是按钮**（点不动的东西做成 `<button>` 就是 §4A 说的死按钮）', () => {
    expect(howToPlayHtml()).not.toContain('<button');
    for (const el of HOWTO.querySelectorAll('.slot')) {
      expect(el.tagName).not.toBe('BUTTON');
    }
  });

  it('★ 胶带颜色**不是朱红**（§5A：朱红只表示警告与重要）', () => {
    const html = howToPlayHtml();
    expect(html.toLowerCase()).not.toContain('#c8372d');
    // 但确实写了一个色板里的颜色
    expect(html).toMatch(/--zone:#[0-9a-fA-F]{6}/);
  });

  it('★★ 示例里放的每一件东西都是**真物品**（假 id 会让图标位空着，且不报错）', () => {
    const html = howToPlayHtml();
    const ids = [...html.matchAll(/data-demo-item="([^"]+)"/g)].map((m) => m[1]);
    // 这一条同时防止"将来有人把 data-demo-item 删掉、于是这条守卫悄悄不再检查任何东西"
    expect(ids.length, '示例里没有 data-demo-item —— 这条守卫会静默失效').toBeGreaterThan(0);
    for (const id of ids) {
      expect(() => getItemDef(id ?? ''), `示例里写了不存在的物品 id: ${id}`).not.toThrow();
    }
  });
});

describe('★ 它讲的是通用玩法，不是这一局', () => {
  it('★★ 一百多场灾难，哪一个名字都不许出现在这一段里', () => {
    /*
     * 理由见文件头：开局页有一条整页断言"热浪局不许出现寒潮"。
     * 灾难名一旦漏进这一段，那条断言会红在一个离肇事处很远的地方。
     */
    const text = allText(HOWTO);
    for (const def of DISASTER_DEFS) {
      expect(text, `"怎么玩"里写了灾难名「${def.name}」`).not.toContain(def.name);
    }
  });

  it('★ 四步里每一步都点名了游戏里真实存在的词（不然玩家到那一步还是不认识）', () => {
    const text = allText(HOWTO);
    for (const word of ['外出扫货', '回家整理', '胶带', '行动点', '顺手位', '箱子']) {
      expect(text, `引导里少了「${word}」这个词`).toContain(word);
    }
  });

  it('★ 说了"活过几天"，但没写死数字（天数由顶栏的先知栏说）', () => {
    const text = allText(HOWTO);
    expect(text).toContain('十四天');
    // 不出现 `D-3` / `D-Day` 这类只有具体一场才有的记号
    expect(text).not.toContain('D-Day');
    expect(text).not.toMatch(/D[+-]\d/);
  });
});
