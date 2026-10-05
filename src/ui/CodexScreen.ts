/**
 * 图鉴界面（§9 界面清单第 7 条 / 补 D-16 / §10B.2）。
 *
 * ## 它在补什么
 *
 * M2 把图鉴的**账**做实了（`MetaProfile.codex` 三页 + `systems/codex.ts` 的幂等结算），
 * 但**没有界面** —— D-16 把后果记了两条：
 *
 *  ① 玩家看不到"还有多少没见过的"，收集目标只有结算页那一行数；
 *  ② 一批物资在当前内容下**永远点不亮**（`hot_water_bag_gift` 当时不在任何箱子的池子里），
 *     而**没有界面就没人会发现** —— 图鉴上永远空着一格，谁也不知道为什么。
 *
 * ## §10B.2 对这条界面唯一强调的一件事
 *
 * > **未点亮的那一格要看得见轮廓与"从哪儿来"的提示** —— 这是收集类界面最重要的一条：
 * > 玩家需要知道"还差什么、去哪儿找"，否则收集欲无从下手。
 * > 「哪儿来」直接从注册表推导（见 §10B.5），不手写。
 *
 * 所以每张卡都带一行来源，而那行字是 `registry.sourcesOfItem()` **算出来的** ——
 * 内容一变它跟着变，不需要任何人记得回来补一句（手写的话，忘掉是默认结局）。
 *
 * ## 三页的分母一律走注册表
 *
 * **不写死数字**。结算页那边原来写的是 `disasters: 1, // M2 只有寒潮`，
 * 多灾难一落地它就成了假账；而"点亮的比总数还多"这种进度条
 * 会让玩家以为界面坏了。注册表的 `countOfKind` 是按表算的，加内容自己会跟上。
 *
 * ## 三页的 id 清单也一律走注册表
 *
 * ★ 这里刻意**不 import 八张表** —— 那正是 §10B.5 第 1 件要消除的东西
 * （"图鉴界面会 import 八张表，将来加第九张就要改界面"）。
 * 想加一页内容时，改动只发生在 `data/registry.ts` 的 `TABLES` 那一行。
 */
import { BOX_DEFS } from '../data/boxes';
import { SHOP_DEFS } from '../data/shops';
import { CATEGORY_LABELS, CATEGORY_ORDER, hasItemDef, getItemDef } from '../data/items';
import {
  DISASTER_TIER_GATES,
  disasterTopTier,
  getDisasterDef,
  hasDisasterDef
} from '../data/disaster';
import { findNpc } from '../data/npcs';
import { countOfKind, entriesOfKind, sourcesOfItem } from '../data/registry';
import { TIER_LABELS } from '../model/types';
import type { CategoryId, CodexPage } from '../model/types';
import type { GameStore } from '../state/store';
import { bestOf, CODEX_PAGE_LABELS, CODEX_PAGES, disasterName } from '../systems/codex';
import { disasterProgressOf } from '../systems/setup';
import {
  ACHIEVEMENT_KIND_LABELS,
  achievementTotal,
  groupByKind
} from '../systems/achievements';
import { ACHIEVEMENT_DEFS } from '../data/achievements';
import { windowBandHtml } from './windowBand';
import type { Screen } from './Router';

export interface CodexScreenProps {
  /** 返回上一屏（哪一屏由装配层决定：可能是结算页，也可能是开局页） */
  onClose: () => void;
}

/** 一页里的一条（点亮的画内容，没点亮的画轮廓 + 来源） */
interface Card {
  id: string;
  name: string;
  /** 第二行：品类 / 家族 / 身份那种"它是什么" */
  meta: string;
  /**
   * 物资的品类（只有物资页有）。它单独一格而不是从 `meta` 里切字符串 ——
   * 分组靠切字符串是最脆的一种写法：改一下 `meta` 的展示格式，分组就悄悄空了。
   */
  category: CategoryId | null;
  /** 来源提示。**空串永远不该出现** —— 没有来源要明确说出来，见 `describeSources` */
  source: string;
  lit: boolean;
}

/** 两张名字表：模块加载时取一次，省得每次渲染都查一遍 */
const SHOP_NAMES: Record<string, string> = Object.fromEntries(SHOP_DEFS.map((s) => [s.id, s.name]));
const BOX_NAMES: Record<string, string> = Object.fromEntries(BOX_DEFS.map((b) => [b.id, b.name]));

export class CodexScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly props: CodexScreenProps;
  private page: CodexPage = 'items';

  constructor(root: HTMLElement, store: GameStore, props: CodexScreenProps) {
    this.root = root;
    this.store = store;
    this.props = props;
  }

  private readonly onClickBound = (e: MouseEvent): void => this.onClick(e);

  mount(): void {
    this.root.addEventListener('click', this.onClickBound);
    this.render();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClickBound);
  }

  render(): void {
    const meta = this.store.save.meta;
    const totals = this.totals();
    const litTotal = CODEX_PAGES.reduce((n, page) => n + meta.codex[page].length, 0);
    const grandTotal = CODEX_PAGES.reduce((n, page) => n + totals[page], 0);

    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar">
          <div class="title">
            <h1>图鉴</h1>
            <p class="sub">点亮 ${litTotal} / ${grandTotal}</p>
          </div>
          <button class="btn btn-quiet" data-action="close">返回</button>
        </header>
        ${windowBandHtml(this.store.run)}
        <main class="scroll">
          <nav class="codex-tabs">
            ${CODEX_PAGES.map(
              (page) => `
                <button class="codex-tab${page === this.page ? ' is-on' : ''}" data-page="${page}">
                  ${CODEX_PAGE_LABELS[page]}<em>${meta.codex[page].length} / ${totals[page]}</em>
                </button>
              `
            ).join('')}
          </nav>
          ${this.pageHtml(this.page)}
          ${this.achievementsHtml()}
        </main>
      </div>
    `;
  }

  /** 三页各自的"一共有多少可以点"。**问注册表**，不写死数字（见文件头） */
  private totals(): Record<CodexPage, number> {
    return {
      items: countOfKind('item'),
      disasters: countOfKind('disaster'),
      npcs: countOfKind('npc')
    };
  }

  private pageHtml(page: CodexPage): string {
    const lit = new Set(this.store.save.meta.codex[page]);
    const cards = this.cardsOf(page, lit);
    if (cards.length === 0) {
      return `<section class="block"><p class="block-note">这一页还是空的。</p></section>`;
    }

    // 物资按品类分组（§10B.2 明说"按 category 分组"）—— 那正是玩家整理时的心智分组
    if (page === 'items') {
      return CATEGORY_ORDER.map((category) => {
        const group = cards.filter((c) => c.category === category);
        if (group.length === 0) return '';
        const on = group.filter((c) => c.lit).length;
        return `
          <section class="block">
            <h2 class="block-title">${CATEGORY_LABELS[category]}<em class="codex-count">${on} / ${group.length}</em></h2>
            <div class="codex-grid">${group.map((c) => cardHtml(c)).join('')}</div>
          </section>
        `;
      }).join('');
    }

    return `
      <section class="block">
        <div class="codex-grid">${cards.map((c) => cardHtml(c)).join('')}</div>
      </section>
    `;
  }

  private cardsOf(page: CodexPage, lit: Set<string>): Card[] {
    if (page === 'items') {
      return entriesOfKind('item').map((entry) => {
        // 认不出的 id 退化成"来源不明"的一格，绝不让图鉴崩在一条旧数据上
        const def = hasItemDef(entry.id) ? getItemDef(entry.id) : null;
        return {
          id: entry.id,
          name: def?.name ?? entry.id,
          meta: def ? `${CATEGORY_LABELS[def.category]} · ${TIER_LABELS[def.tier]}` : '',
          category: def?.category ?? null,
          source: describeSources(sourcesOfItem(entry.id)),
          lit: lit.has(entry.id)
        };
      });
    }
    if (page === 'disasters') {
      /*
       * ★★ 灾难那一页的"从哪儿来"是**算出来的**，不是一句话（用户 2026-10 报的）。
       *
       * 原来这里写死 `source: '开局时揭晓'` —— 在一个只有寒潮的版本里那句话是对的，
       * 而 116 场能被抽到之后它当场变成假话：图鉴里那些**从没碰到过**的灾难
       * 也写着"开局时揭晓"，而它们的真实状态是"**还没放出来**"
       * （tier 阶梯没到，见 `data/disaster.ts` 的 `DISASTER_TIER_GATES`）。
       *
       * 而这一页的规矩本来就是"来源必须从数据推导，不手写"（见 `describeSources`），
       * 所以这里补的正是那条规矩欠下的一笔：
       *   · 打过 → **你在这一场里活到过第几天**（比"打过"更有信息量）；
       *   · 放出来了、还没碰到 → "还没在这一场里活过"；
       *   · 还没放出来 → **还差什么**（与开局页那一行同一套口径）。
       */
      const meta = this.store.save.meta;
      const progress = disasterProgressOf(meta);
      const litDisasters = lit;
      return entriesOfKind('disaster').map((entry) => {
        const def = hasDisasterDef(entry.id) ? getDisasterDef(entry.id) : null;
        const on = litDisasters.has(entry.id);
        return {
          id: entry.id,
          name: def?.name ?? entry.id,
          meta: def ? `${def.family} · ${def.level}` : '',
          category: null,
          source: on
            ? `活到过 D+${bestOf(meta, entry.id)}`
            : def
              ? disasterSourceHint(def.tier, progress)
              : '这一场不在表里了',
          lit: on
        };
      });
    }
    return entriesOfKind('npc').map((entry) => {
      const def = findNpc(entry.id);
      return {
        id: entry.id,
        name: def?.name ?? entry.id,
        meta: def?.blurb ?? '',
        category: null,
        source: '在门口遇见的',
        lit: lit.has(entry.id)
      };
    });
  }

  /**
   * 成就段（§10B.2）。
   *
   * 未解锁的画成**空印**（虚线方框 + 一行判据），解锁的画成**朱红印章**。
   * 这就是 §10B.1 那句"图鉴不发光、成就才发光"在界面上的落法：
   * 图鉴是墨色卡片，"做到过"的东西才盖朱红。
   *
   * 未解锁的也**必须写出判据**（`def.hint`）—— 与图鉴那条"要看得见从哪儿来"同一个道理：
   * 一行"未解锁"配一句模糊的赞美，等于没告诉玩家还能去做什么。
   */
  private achievementsHtml(): string {
    const meta = this.store.save.meta;
    const unlocked = new Set(meta.achievements);
    const groups = groupByKind(ACHIEVEMENT_DEFS);

    return `
      <section class="block">
        <h2 class="block-title">成就<em class="codex-count">${unlocked.size} / ${achievementTotal()}</em></h2>
        ${groups
          .map(
            (group) => `
              <p class="seal-group">${ACHIEVEMENT_KIND_LABELS[group.kind]}</p>
              <div class="seal-grid">
                ${group.defs
                  .map((def) => {
                    const on = unlocked.has(def.id);
                    /*
                     * ★★ 等级决定这一枚印章长什么样（2026-10 用户要的
                     * "难度低的和难度高的都用不同的炫酷特效标记，分等级"）。
                     *
                     * 三档在**同一个隐喻**里拉开分量（§5A 的纸墨朱红不许动）：
                     *
                     * | 档 | 印面 | 记号 | 特效 |
                     * | --- | --- | --- | --- |
                     * | 常 | 单圈细线 | 一个「印」 | 无 |
                     * | 罕 | 双圈 | 「印」+ 角标 | 落印时压一下 |
                     * | 极 | 双圈 + 实心朱红 | 实心印 + 角标 | 落印时压一下 + 一圈金边涟漪 |
                     *
                     * ⚠ **不做循环播放的动画**：一整页几十枚印章同时闪会变成噪音，
                     * 而 §5A 的克制纪律（"安静的那一档"）刚在 M2 花过一轮才立起来。
                     * 所以"炫"只出现在**落印那一瞬间**。
                     */
                    const rank = def.rank;
                    return `
                      <div class="seal is-${rank}${on ? ' is-on' : ''}">
                        <span class="seal-mark">${on ? '印' : ''}</span>
                        <span class="seal-body">
                          <b>${escapeHtml(def.name)}</b>
                          ${def.disaster ? `<u class="seal-tag">${escapeHtml(disasterName(def.disaster))}</u>` : ''}
                          <i>${escapeHtml(def.hint)}</i>
                        </span>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            `
          )
          .join('')}
      </section>
    `;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const el = target.closest<HTMLElement>('[data-page], [data-action]');
    if (!el) return;
    const page = el.dataset['page'];
    if (page && (CODEX_PAGES as readonly string[]).includes(page)) {
      this.page = page as CodexPage;
      this.render();
      return;
    }
    if (el.dataset['action'] === 'close') this.props.onClose();
  }
}

// ——————————————————————————————————————————————————————————————
// 渲染小工具
// ——————————————————————————————————————————————————————————————

/**
 * ★ 一场**还没打过**的灾难，它在图鉴上该写什么（用户 2026-10 报的那句假话）。
 *
 * 三种状态，一句话各自说清：
 *
 *  · 这一档已经放出来了（能抽到）→ "还没在这一场里活过" —— 它随时可能来；
 *  · 还没放出来 → **还差什么**（与开局页那一行、与 `DISASTER_TIER_GATES`
 *    同一套口径：两个条件取更近的那个）；
 *  · 连那一档都没解锁 → 这一档的门槛。
 *
 * ★ 为什么不直接列"要撑过 N 次"就完事：tier 4 那一档有**两个**条件
 * （撑过 5 次 **或** 图鉴里见过 8 场），只报一个会让另一个条件白写。
 */
function disasterSourceHint(tier: number, progress: { survivedRuns: number; seenDisasters: number }): string {
  const top = disasterTopTier(progress);
  if (tier <= top) return '还没在这一场里活过';
  // 从"现在这一档 + 1"逐档往上找，找到第一个能放它出来的门槛
  for (const t of [1, 2, 3, 4] as const) {
    if (t <= top || t < tier) continue;
    const gate = DISASTER_TIER_GATES[t];
    const needRuns = Math.max(0, gate.need - progress.survivedRuns);
    const needSeen = gate.seen === null ? null : Math.max(0, gate.seen - progress.seenDisasters);
    if (needSeen !== null && needSeen < needRuns) return `图鉴里再点亮 ${needSeen} 场灾难才会出现`;
    return `再撑到最后 ${needRuns} 次才会出现`;
  }
  return '还没在这一场里活过';
}

/**
 * 一张卡。**没点亮的也要画**（§10B.2 的硬要求）：灰色轮廓 + 一行来源。
 *
 * 为什么未点亮的卡上要写名字：一个"？？？"的格子不给任何线索，
 * 玩家只能靠运气撞。写上名字 + 来源之后，目标就变成可执行的了
 * （"原来超市不卖它，得去粮油批发站"）。
 */
function cardHtml(card: Card): string {
  return `
    <div class="codex-card${card.lit ? ' is-on' : ''}">
      <span class="codex-name">${escapeHtml(card.name)}</span>
      ${card.meta ? `<span class="codex-meta">${escapeHtml(card.meta)}</span>` : ''}
      <span class="codex-source">${escapeHtml(card.source)}</span>
    </div>
  `;
}

/**
 * "从哪儿来"那句话（§10B.2 要求它从注册表推导，不手写）。
 *
 * ★ "还没有来源"必须**说出来**，不能留空 —— 留空与"我懒得写"在界面上长得一样，
 * 而那正是 D-16 能藏那么久的原因（`hot_water_bag_gift` 谁都拿不到，
 * 但没人看得出哪里不对）。写成一句明确的话之后，将来真出现这种内容，
 * 玩家与开发者都会当场看见。
 */
function describeSources(sources: { shops: string[]; boxes: string[] }): string {
  const parts: string[] = [];
  if (sources.shops.length > 0) {
    parts.push(`${sources.shops.map((id) => SHOP_NAMES[id] ?? id).join('、')}在卖`);
  }
  if (sources.boxes.length > 0) {
    parts.push(`${sources.boxes.map((id) => BOX_NAMES[id] ?? id).join('、')}开得出`);
  }
  return parts.length > 0 ? parts.join('；') : '还没有来源';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
