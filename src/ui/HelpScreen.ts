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
import { inspectRequest, searchCost } from '../systems/help';
import type { Screen } from './Router';

export interface HelpScreenProps {
  /** 从货架凑单交付 */
  onFulfill: () => void;
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
    const stamina = Math.round(run.stats.stamina);
    const tooTired = stamina < cost;

    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar">
          <div class="title">
            <h1>有人敲门</h1>
            <p class="sub">${dayLabel(run.day)} · ${escapeHtml(npc.name)}</p>
          </div>
        </header>
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
                  ? `<b>还差 ${info.missing} 件</b> —— 现在去凑，多半要当着他的面翻箱倒柜。`
                  : tooTired
                    ? '<b>你今天翻不动了。</b>'
                    : '东西都在手边的话，几下就能凑齐。'
              }
            </p>
          </section>
        </main>
        <footer class="dock">
          <div class="dock-tools">
            <button class="btn btn-primary" data-action="fulfill">从货架凑单</button>
            <button class="btn" data-action="decline">婉拒</button>
          </div>
        </footer>
      </div>
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
    const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
    if (action === 'fulfill') {
      playSfx('place');
      this.props.onFulfill();
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
