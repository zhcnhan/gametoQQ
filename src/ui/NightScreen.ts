/**
 * 夜间界面（§6.2 夜间小事件 / §9 界面清单）。
 *
 * 分层纪律：只读 `store.run.night`，写操作全部通过 props 回调交给 systems/phases 的命令。
 *
 * 三个刻意的设计：
 *  1. **两段式**：先选（`choice === null`），再看后果 + 关灯。玩家必须看得见代价，
 *     否则"数值交换"这件事就不成立 —— 而这里的所有选项都是交换，没有白拿的好处。
 *  2. **「关灯睡觉」是常驻出口，不是选项**。它不属于任何一条事件（存进存档是 NIGHT_SLEEP），
 *     所以永远都在，位置永远固定。§4A：玩家随时可能被领导叫走，任何界面都得有一条"不参与"的路。
 *  3. **四维与现金常驻在下方**。选之前就能看到自己现在什么状态，选之后能立刻看到变化 ——
 *     这两次读数发生在一个屏幕里，不需要玩家记住。
 */
import { NIGHT_SLEEP, findNightEvent } from '../data/nightEvents';
import { playSfx } from '../fx/audio';
import { dayLabel } from '../model/calendar';
import type { NightOption } from '../model/types';
import type { GameStore } from '../state/store';
import { NO_EFFECT, cashCost, describeEffect, resolveOutcome } from '../systems/night';
import type { Screen } from './Router';

export interface NightScreenProps {
  /** 决定今晚怎么办；choice 为选项下标，或 NIGHT_SLEEP（直接睡） */
  onChoose: (choice: number) => void;
  /** 关灯，跨到第二天。必须先做过决定 */
  onSleep: () => void;
}

export class NightScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly props: NightScreenProps;

  constructor(root: HTMLElement, store: GameStore, props: NightScreenProps) {
    this.root = root;
    this.store = store;
    this.props = props;
  }

  private readonly onClickBound = (e: MouseEvent): void => this.onClick(e);

  mount(): void {
    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar" data-head></header>
        <main class="scroll" data-main></main>
        <footer class="dock" data-dock></footer>
      </div>
    `;
    this.root.addEventListener('click', this.onClickBound);
    this.render();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClickBound);
  }

  render(): void {
    const run = this.store.run;
    const night = run.night;
    const def = night ? findNightEvent(night.eventId) : null;

    // 兜底：存档自愈（state/save.ts 的 normalizeNight）保证走到这里的 night 一定认得出事件。
    // 万一还是空的，就直接跨天，绝不把玩家关在夜里。
    if (!night || !def) {
      this.props.onSleep();
      return;
    }

    const choice = night.choice;
    const decided = choice !== null;
    const option = choice !== null && choice !== NIGHT_SLEEP ? def.options[choice] : null;
    // 实际发生了什么（不是选项声明的那些）。老档没有这份记录时退化成"无变化"。
    const applied = night.applied ?? NO_EFFECT;

    this.query('[data-head]').innerHTML = `
      <div class="topbar-row">
        <div class="title">
          <h1>${decided ? '关灯前' : '夜里'}</h1>
          <p class="sub">${dayLabel(run.day)} · ${decided ? '已经决定了' : '睡前还有一件事'}</p>
        </div>
      </div>
    `;

    this.query('[data-main]').innerHTML = `
      <section class="block">
        <p class="night-text">${escapeHtml(def.text)}</p>
        ${
          decided
            ? `<p class="night-outcome">${escapeHtml(
                option ? resolveOutcome(option, applied) : '你把灯关了。这件事留到明天再说。'
              )}</p>
               ${this.deltasHtml(describeEffect(applied))}`
            : `<div class="night-options">
                 ${def.options.map((opt, index) => this.optionHtml(opt, index)).join('')}
               </div>`
        }
      </section>
      <section class="block">
        ${this.metersHtml()}
      </section>
    `;

    this.query('[data-dock]').innerHTML = `
      <div class="dock-tools">
        ${
          decided
            ? `<button class="btn btn-primary" data-action="sleep">睡吧</button>`
            : `<button class="btn" data-action="sleep">关灯睡觉</button>`
        }
      </div>
    `;
  }

  /**
   * 一个选项按钮。
   *
   * 两种"钱不够"在这里是**分开**的，因为它们是两件事：
   *  · 买货（`requireFullCash`）→ 置灰，并写明还差多少。买不起就是买不起；
   *  · 人情（不写这个字段）→ 照旧可点，只提示一句"你只有 N"。帮得少也是帮。
   *
   * 把它们混成一种，要么让人情变得势利，要么让买货变得可疑。
   */
  private optionHtml(opt: NightOption, index: number): string {
    const run = this.store.run;
    const short = Math.max(0, cashCost(opt) - run.cash);
    const blocked = Boolean(opt.requireFullCash) && short > 0;
    const note = blocked ? `还差 ${short} 元` : short > 0 ? `你只有 ${run.cash}，能给多少给多少` : '';
    return `<button class="night-option" data-choice="${index}"${blocked ? ' disabled' : ''}>
      <b>${escapeHtml(opt.label)}</b>
      ${note ? `<em class="night-option-note">${escapeHtml(note)}</em>` : ''}
    </button>`;
  }

  /** 选完之后的数值变化。空数组（"直接睡"）时不渲染 —— 非要显示一行"无变化"反而像在评价玩家 */
  private deltasHtml(summary: string[]): string {
    if (summary.length === 0) return '';
    return `<div class="night-deltas">${summary
      .map((text) => `<span class="delta">${escapeHtml(text)}</span>`)
      .join('')}</div>`;
  }

  /**
   * 四维 + 现金 + 待拆箱：让这次"交换"能立刻被读到。
   *
   * ⚠ 标签与另外两屏**逐字一致**（`待拆纸箱`，不是 `待拆`）——
   * 同一样东西在三个屏幕上三个叫法，玩家会以为它们是三件事
   * （2026-10 用户要求把这类"同一件事两个词"的文案清一遍）。
   */
  private metersHtml(): string {
    const run = this.store.run;
    const stats = run.stats;
    const boxes = run.boxesToUnpack.length;
    const pieces = run.boxesToUnpack.reduce(
      (sum, box) => sum + box.items.reduce((n, stack) => n + stack.batches.reduce((m, b) => m + b.count, 0), 0),
      0
    );
    return `
      <div class="stat-grid">
        <div class="stat"><i>健康</i><b>${stats.health}</b></div>
        <div class="stat"><i>心情</i><b>${stats.mood}</b></div>
        <div class="stat"><i>体力</i><b>${stats.stamina}</b></div>
        <div class="stat"><i>庇护所</i><b>${stats.shelter}</b></div>
        <div class="stat"><i>现金</i><b>${run.cash}</b></div>
        <div class="stat"><i>待拆纸箱</i><b>${boxes} 箱 / ${pieces} 件</b></div>
      </div>
    `;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const optionEl = target.closest<HTMLElement>('[data-choice]');
    if (optionEl) {
      const index = Number(optionEl.dataset['choice']);
      if (!Number.isInteger(index)) return;
      playSfx('pick');
      this.props.onChoose(index);
      return;
    }

    if (target.closest('[data-action="sleep"]')) {
      const night = this.store.run.night;
      if (night && night.choice === null) {
        // 还没选 → 这个按钮就是"什么都不做"的出口（存进存档是 NIGHT_SLEEP）
        this.props.onChoose(NIGHT_SLEEP);
        return;
      }
      playSfx('return');
      this.props.onSleep();
    }
  }

  private query<T extends HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`缺少必需节点：${selector}`);
    return el;
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
