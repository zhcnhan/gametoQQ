/**
 * 求援订单界面（§6.5 / §9 界面清单第 4 条"求援订单弹窗"）。
 *
 * 这一屏要回答的问题只有一个：**你给不给得起。**
 * 所以信息的排布是：谁站在门口 → 他要什么 → 你手上有多少 → 凑这一趟要多少力气 → 两个按钮。
 *
 * 三个刻意的设计：
 *  1. **凑得齐不齐，先算给你看**。按下去之前就该知道差几件 ——
 *     §6.5 说"整理得好 → 几下凑齐"，那得让玩家能自己判断，而不是按了才知道；
 *  2. **翻找成本明写出来**。它是这一屏唯一与"整理质量"直接挂钩的数字，
 *     也是 §6.5「炫耀感由效率表达」的落点：整理好的人看到的是 7 点，乱的人看到 22 点；
 *  3. **婉拒就是一个按钮**。无台词、无二次确认、无特写（§6.5）。
 *     给它加解释反而显得心虚。
 */
import { findHelpRequestDef } from '../data/helpRequests';
import { CATEGORY_LABELS } from '../data/items';
import { getNpcDef } from '../data/npcs';
import { playSfx } from '../fx/audio';
import { dayLabel } from '../model/calendar';
import type { GameStore } from '../state/store';
import { inspectRequest, quoteSources, searchCost, workSourceLabel, type SourceQuote, type WorkSource } from '../systems/help';
import { windowBandHtml } from './windowBand';
import type { Screen } from './Router';

export interface HelpScreenProps {
  /** 从货架凑单交付。`source` 是"这一趟只从哪一档翻"，由玩家在屏幕上选 */
  onFulfill: (source: WorkSource) => void;
  /** 婉拒（扣人情） */
  onDecline: () => void;
  /** 兜底：门口已经没人了，放玩家回日报。无副作用 */
  onLeave: () => void;
}

export class HelpScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly props: HelpScreenProps;

  constructor(root: HTMLElement, store: GameStore, props: HelpScreenProps) {
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
    const run = this.store.run;
    const def = run.helpRequest ? findHelpRequestDef(run.helpRequest.defId) : null;

    // 兜底：正常读档会被 save.ts 自愈掉，走不到这里。万一走到了，也绝不能把玩家关在门口
    if (!def) {
      this.props.onLeave();
      return;
    }

    const npc = getNpcDef(def.npcId);
    const info = inspectRequest(run, def);
    const cost = searchCost(run, def);
    const quotes = quoteSources(run, def);
    const stamina = Math.round(run.stats.stamina);
    const tooTired = stamina < cost;
    /*
     * ★★ M4 W-11：这一屏从"一个混合价"变成"三个明码标价"。
     *
     * 三档的价钱是**固定的每件单价**乘需求件数（`WORK_PER_ITEM_MARKED` 那一段），
     * 与那个混合价（`searchCost`，按全屋整理质量连续取值）不是同一个口径 ——
     * 所以两个数一起摆出来的时候必须**各自说清自己是什么**，否则玩家会以为
     * 其中一个是错的（两个数都"对"，只有口径不同）。
     */
    const markedQuote = quotes.find((q) => q.source === 'marked');
    const dockQuotes = quotes.filter((q) => q.source !== 'marked' && q.enough);

    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar">
          <div class="title">
            <h1>有人敲门</h1>
            <p class="sub">${dayLabel(run.day)} · ${escapeHtml(npc.name)}</p>
          </div>
        </header>
        ${windowBandHtml(this.store.run)}
        <main class="scroll">
          <section class="block">
            <p class="night-text">${escapeHtml(def.text)}</p>
          </section>

          <section class="block">
            <h2 class="block-title">他要什么</h2>
            <ul class="need-list">
              ${info.lines.map((line) => this.needHtml(line)).join('')}
            </ul>
            <p class="block-note">
              凑这一趟要花 ${cost} 点体力（你还有 ${stamina}）。
              ${
                info.missing > 0
                  ? `<b>还差 ${info.missing} 件。</b>现在凑，得当着面翻箱子。`
                  : tooTired
                    ? '<b>你今天翻不动了。</b>'
                    : '东西都在手上，几下就齐。'
              }
            </p>
          </section>

          <section class="block">
            <h2 class="block-title">从哪儿凑</h2>
            <ul class="where-list">
              ${quotes.map((q) => this.whereHtml(q)).join('')}
            </ul>
            <p class="block-note">
              价钱是每件的力气：划好的那行 <b>1.5</b>、上了架但没写清单 <b>3.3</b>、没拆的纸箱 <b>4.5</b>。
              上面 ${cost} 点是全屋混着算的。
            </p>
          </section>
        </main>
        <footer class="dock dock-stack">
          <button class="btn btn-primary" data-action="fulfill" data-source="marked"${
            markedQuote?.enough ? '' : ' disabled'
          }>从划好的那行拿<b>${markedQuote?.cost ?? 0} 点</b></button>
          ${dockQuotes
            .map(
              (q) =>
                `<button class="btn" data-action="fulfill" data-source="${q.source}">从${workSourceLabel(
                  q.source
                )}拿 ${q.cost} 点</button>`
            )
            .join('')}
          <button class="btn" data-action="decline">婉拒</button>
        </footer>
      </div>
    `;
  }

  /**
   * 一档来源在这一屏上长什么样。
   *
   * ★ 三档**都画**（哪怕不够），因为这一屏真正要回答的是"我这几件东西
   * 分别值多少力气" —— 把不够的那几档藏起来，玩家就永远看不到
   * "东西压在箱子里让这一单贵了三倍"这句话。不够的那一档明写"只有 N 件"。
   */
  private whereHtml(q: SourceQuote): string {
    const name = workSourceLabel(q.source);
    return `
      <li class="where-row${q.enough ? '' : ' is-short'}" data-where="${q.source}">
        <b class="where-name">${escapeHtml(name)}</b>
        <span class="where-have">${q.enough ? `${q.pieces} 件都凑得齐` : `只有 ${q.pieces} 件`}</span>
        <em class="where-cost">${q.cost} 点</em>
      </li>
    `;
  }

  private needHtml(line: { category: keyof typeof CATEGORY_LABELS; need: number; have: number }): string {
    const enough = line.have >= line.need;
    return `
      <li class="need-row${enough ? '' : ' is-short'}">
        <b>${escapeHtml(CATEGORY_LABELS[line.category])}</b>
        <span>要 ${line.need}</span>
        <em>你有 ${line.have}</em>
      </li>
    `;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLElement>('[data-action]');
    const action = button?.dataset['action'];
    if (action === 'fulfill') {
      /*
       * ⚠ 来源必须从**按钮自己**读，不能在 onClick 里重算一遍 ——
       * 玩家按下的是他在屏幕上看到的那个价钱，重算会让"看到的"与"付掉的"
       * 有机会分家（而那不会有任何报错）。
       */
      const source = button?.dataset['source'];
      if (source !== 'marked' && source !== 'shelf' && source !== 'box') return;
      playSfx('place');
      this.props.onFulfill(source);
    } else if (action === 'decline') {
      // 婉拒：一声轻响就够了，不给它任何"仪式感"（§6.5 去尴尬化）
      playSfx('return');
      this.props.onDecline();
    }
  }
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
