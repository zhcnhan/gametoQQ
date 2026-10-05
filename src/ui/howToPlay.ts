/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「怎么玩」—— 开局页那一段带活例的说明（2026-10，为"发给朋友试玩"做的）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它为什么必须存在
 *
 * 试玩评估时确认的最大缺口：**核心动作"贴胶带"没有任何交互式教学**。
 * 玩家手上只有一句空态提示（`ui/OrganizeScreen.ts:434` 的
 * "还没有胶带。把左边那个「＋」拖到某一行上，就有了。"），
 * 而"整理 = 贴一张写了清单的胶带"这层意思**只写在 `title` 里** ——
 * 手机上根本没有 hover。于是第一局的真实体验是"我要干嘛"。
 *
 * ## ⚠ 它必须绕开的那条铁则：§5「整理期完全静默」
 *
 * 整理期是这一作的禅时刻，**任何弹窗都会毁掉它**。所以：
 *
 *  ① 这一段只在**开局页**出现（还没进整理期），而且**不是弹窗** ——
 *     它就是页面上一段普通正文，玩家可以不看、可以划过去；
 *  ② 例子用的是**一条已经贴好、写好清单的现成胶带**（M5 工单第四组第 4 条
 *     定的口径：看见 → 模仿 → 自建），不是"第一次进整理页时弹一个遮罩";
 *  ③ 措辞一律用**游戏里真实存在的词**（"外出扫货""回家整理""顺手位"），
 *     因为这一段的作用就是让那些词在第一次遇到时不陌生。
 *
 * ## ★★ 那个例子是**真的货架**，不是另画一张图
 *
 * 这是这个文件里唯一一个需要守住的技术决定：示例的 DOM 直接复用
 * `ui/OrganizeScreen.ts` 那一套类名（`.shelf-row` / `.row-tape` /
 * `.row-cells` / `.slot` / `.slot-count` / `.slot.is-empty`），
 * 一个字节的新几何都不写。
 *
 * 理由：另画一张示意图的话，它**会漂** —— 改一个格子尺寸或换一套图标，
 * 图还停在旧样子，而没有任何东西会报错（`windowThemes` 的 `fall` 名单
 * 手抄漂了 21 场，就是同一种错误的另一个版本）。
 * 复用之后，"示例长得像游戏"这件事是**结构上成立**的，不是靠人盯着。
 * 另外那几种几何（`.row-cells` 的 `--cols`、`.slot` 的 `aspect-ratio`）
 * 都已经有窄屏规则，示例跟着一起对。
 *
 * ⚠ 因此这里**刻意不写**任何 `.slot` / `.shelf-row` 的尺寸或颜色 ——
 * 要加样式就加 `.howto-*` 前缀的容器样式。
 *
 * ## 谁给它输入
 *
 * 无输入。它说的是**这一作的玩法**（不是这一局的），
 * 所以灾难名 / 天数 / 品类都**不出现**在这一段里 ——
 * 那些由开局页其余几块与顶栏的先知栏说（`ui/prophetBar.ts`）。
 * 这也是它能做成纯函数、且不需要 `store` 的原因。
 */
import { getItemDef } from '../data/items';
import { ZONE_COLORS } from '../data/palette';
import { itemIconSvg } from '../fx/icons';

/** 示例格子里放什么（真 id —— 图标由 `itemIconSvg` 与游戏里同一份表给，表在 `src/data/items.ts`） */
const DEMO_SLOTS: readonly { itemId: string; count: number }[] = [
  { itemId: 'compressed_biscuit', count: 3 },
  { itemId: 'water_big', count: 1 },
  { itemId: 'canned_corned_beef', count: 1 },
  { itemId: 'rice_small', count: 1 },
  { itemId: 'instant_rice', count: 1 }
];

/**
 * 示例那条胶带的颜色。
 *
 * ★ 取的是**色板里的第三项**（藏青），不是第一项（朱红）。
 * 色板首项是玩家自己贴第一张胶带时会拿到的默认色，看起来更"真"——
 * 但 §5A 那条红线说朱红**只表示警告与重要**。开局页的一张示意图用朱红，
 * 会在玩家还没见过任何警告之前先把那个颜色的意思用掉。
 * 取第三项还顺带避开赭黄（`--warm`，那是"安全/暖"的一侧）。
 */
const DEMO_TAPE_COLOR: string = ZONE_COLORS[3] ?? '#3F5E7A';

/**
 * 那一段的 HTML。
 *
 * 结构：一句它回答什么问题 → 一个**真货架**的活例（一条贴了胶带的、
 * 一条没贴的）→ 四步活下来要轮流做的那四件事 → 两个术语的当场解释。
 */
export function howToPlayHtml(): string {
  return `
    <section class="block howto" data-howto>
      <h2 class="block-title">怎么玩</h2>
      <p class="block-note">
        你是重生回灾难前七天的人。<b>买回来，贴上手写的胶带，然后靠它活过十四天。</b>
      </p>
      ${demoShelfHtml()}
      <ol class="howto-steps">
        <li><b>外出扫货</b>：白天出门买东西，一天只有几点行动点，用完就回家。</li>
        <li><b>回家整理</b>：把买回来的东西拖到格子里放好。</li>
        <li><b>贴胶带</b>：把胶带拖到<b>某一行</b>上，再写下这一行收什么 —— 比如"主食"。</li>
        <li><b>等它来</b>：灾难那天之后，每天要从家里取东西。
          胶带贴得对不对、东西拿不拿得到，都在那一天见分晓。</li>
      </ol>
      <p class="block-note">
        两个词先说清楚：<b>顺手位</b>是货架右上角那个按钮，标了的那几块，
        体力见底那天还够得到；<b>箱子</b>是买回来还没拆的，拆了才有格子放。
      </p>
    </section>
  `;
}

/**
 * 活例：一块两行的货架，上一行贴了胶带、下一行没贴。
 *
 * ★ 为什么是**两行**而不是一行：这一段要教的正是"贴与没贴的**区别**"。
 * 只给一条贴好的，玩家看见的是一个装饰；给出两条并排，
 * 那个色条与格子上的同色描边才读得出"这一行归这张胶带管"。
 *
 * ★★ **它是这一整段唯一说得出名字的一段内容**，所以它必须过读屏 ——
 * 一开始这里只按"点不动的东西不要做成按钮"处理，整块给了 `aria-hidden`，
 * 于是图里所有格子对读屏都是**不存在**的，而下面那句图注还在讲
 * "上面那一行贴了、下面那一行没贴" —— 读屏用户听到的是一句指不到东西的话。
 * 现在整块报成一张**图**（`role="img"` + `aria-label` 一句把画面说完），
 * 里面那些装饰性的格子仍然是 `aria-hidden`（它们是这张图的像素，不是控件）。
 * ★ 图注与 `aria-label` 说的是同一件事，两处都要改就别只改一处。
 */
function demoShelfHtml(): string {
  const filled = DEMO_SLOTS.map(slotHtml).join('');
  const empty = `<span class="slot is-empty" aria-hidden="true"></span>`;
  return `
    <figure class="howto-figure" role="img" aria-label="示意：一块两行的货架。上面那一行贴了胶带，写的是主食，格子上多一圈同色的边；下面那一行没贴。">
      <div class="howto-shelf">
        <div class="shelf-rows">
          <div class="shelf-row is-taped" style="--zone:${DEMO_TAPE_COLOR}">
            <span class="row-tape" aria-hidden="true"></span>
            <span class="row-cells" style="--cols:${DEMO_SLOTS.length + 1}">${filled}${empty}</span>
          </div>
          <div class="shelf-row">
            <span class="row-tape" aria-hidden="true"></span>
            <span class="row-cells" style="--cols:${DEMO_SLOTS.length + 1}">${empty.repeat(DEMO_SLOTS.length + 1)}</span>
          </div>
        </div>
      </div>
      <figcaption class="howto-caption">
        上面那一行贴了胶带（写的是"主食"），下面那一行没贴。
        <b>贴过的行，格子会多一圈同色的边</b> —— 那就是"这几格归它管"。
      </figcaption>
    </figure>
  `;
}

/**
 * 一个格子（与 `ui/OrganizeScreen.ts:997` 的 `slotHtml` 同一套类名）。
 *
 * ⚠ 这里**不用 `<button>`**：图里那几格点不动，做成按钮会让键盘与读屏
 * 把它当成真能操作的控件（而点了什么都不会发生 = §4A 说的"死按钮"）。
 * 所以它是 `<span>` + `aria-hidden`，由下面的 `figcaption` 统一说明。
 *
 * ★ `data-demo-item` 是给守卫用的锚点（`ui/howToPlay.test.ts` 拿它逐个
 * 去 `getItemDef` 里核）：写错一个物品 id 时图标位是空的，而**不报错**。
 */
function slotHtml(slot: { itemId: string; count: number }): string {
  const def = getItemDef(slot.itemId);
  return `<span class="slot" data-demo-item="${slot.itemId}" aria-hidden="true">
    <span class="slot-icon">${itemIconSvg(def.icon)}</span>
    ${slot.count > 1 ? `<span class="slot-count">×${slot.count}</span>` : ''}
  </span>`;
}
