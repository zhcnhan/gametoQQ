/**
 * 生存期界面（§6.4 生存期每日结算 / §9 界面清单第 5 条"每日日报"的最简版）。
 *
 * 分层纪律：只读；写操作（两个命令）通过 props 交给 systems/phases。
 *
 * 这一屏要回答的问题只有一个：**"我还撑得住几天？"**
 * 所以信息的排布顺序是：今天发生了什么 → 还剩多少、够几天 → 四维 → 这一切跟我的整理有什么关系。
 * 最后一节（"来自整理"）是刻意留的：§5 的立场是"整理即战力"，
 * 玩家必须在生存期看到自己的整理**真的在变成数字**，否则整理就只是仪式。
 *
 * D-Day 是特例：`day === 0` 时灾难刚落地，还没有结算过任何一天，所以那一屏只负责"揭晓 + 盘点"。
 */
import { getDisasterDef } from '../data/disaster';
import { CATEGORY_LABELS } from '../data/items';
import { dailyDrainOf, moodFromPlacement } from '../data/survival';
import { hintAt, dayLabel, severityAt } from '../model/calendar';
import { countCategory } from '../model/consume';
import { computeOrganizeScore } from '../model/score';
import { playSfx } from '../fx/audio';
import type { GameStore } from '../state/store';
import { householdTotals } from '../systems/organize';
import type { Screen } from './Router';

export interface SurvivalScreenProps {
  /** D-Day：开始撑（day 0 → 1 并结算 D+1） */
  onStart: () => void;
  /** 过一天（结算新的一天） */
  onNext: () => void;
}

export class SurvivalScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly props: SurvivalScreenProps;

  constructor(root: HTMLElement, store: GameStore, props: SurvivalScreenProps) {
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
    const disaster = getDisasterDef(run.disasterId);
    const day = run.day;
    const severity = severityAt(disaster, day);
    const sub =
      day === 0
        ? escapeHtml(hintAt(disaster, day))
        : `${escapeHtml(disaster.name)} · 强度 ${severity.toFixed(2)} · ${escapeHtml(hintAt(disaster, day))}`;

    this.query('[data-head]').innerHTML = `
      <div class="topbar-row">
        <div class="title">
          <h1>${dayLabel(day)}</h1>
          <p class="sub">${sub}</p>
        </div>
      </div>
    `;

    this.query('[data-main]').innerHTML = day === 0 ? this.ddayHtml() : this.dayHtml();
    this.query('[data-dock]').innerHTML = `
      <div class="dock-tools">
        ${
          day === 0
            ? `<button class="btn btn-primary" data-action="start">开始撑</button>`
            : `<button class="btn btn-primary" data-action="next">过一天</button>`
        }
      </div>
    `;
  }

  // ———————— D-Day：揭晓 + 盘点 ————————

  private ddayHtml(): string {
    const run = this.store.run;
    const totals = householdTotals(run);
    const disaster = getDisasterDef(run.disasterId);
    const needs = dailyDrainOf(disaster);

    return `
      <section class="block">
        <p class="night-text">日历上那一天到了。窗外开始下雪，风速比预报的更大。</p>
        <p class="block-note">
          从明天起，每天要消耗 ${needs.map((n) => `${CATEGORY_LABELS[n.category]} ${n.need}`).join('、')}。
          你囤的东西会开始被检验 —— 摆在哪里、排得怎么样，都会变成数字。
        </p>
      </section>
      <section class="block">
        <h2 class="block-title">你囤到的</h2>
        <div class="stat-grid">
          <div class="stat"><i>总计</i><b>${totals.pieces} 件</b></div>
          <div class="stat"><i>总重</i><b>${totals.weight.toFixed(1)}kg</b></div>
          <div class="stat"><i>还没拆</i><b>${run.boxesToUnpack.length} 箱</b></div>
          <div class="stat"><i>现金</i><b>${run.cash}</b></div>
        </div>
      </section>
    `;
  }

  // ———————— D+1..D+7：结算日报 ————————

  private dayHtml(): string {
    const run = this.store.run;
    const disaster = getDisasterDef(run.disasterId);
    const last = run.survival.last;
    const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack);
    const moodBonus = moodFromPlacement(score.placement);

    return `
      <section class="block">
        <h2 class="block-title">今天</h2>
        <p class="block-note">
          ${
            last.shortage > 0
              ? `<b>缺 ${last.shortage} 件</b> —— 没能凑齐。`
              : '该吃该烧的都凑齐了。'
          }
          ${last.spoiled > 0 ? `坏掉 ${last.spoiled} 件。` : ''}
        </p>
        ${this.stockHtml(disaster)}
      </section>

      <section class="block">
        <h2 class="block-title">四维</h2>
        <div class="stat-grid">
          ${this.statHtml('健康', run.stats.health, last.health)}
          ${this.statHtml('心情', run.stats.mood, last.mood)}
          ${this.statHtml('体力', run.stats.stamina, last.stamina)}
          ${this.statHtml('庇护所', run.stats.shelter, last.shelter)}
        </div>
      </section>

      <section class="block">
        <h2 class="block-title">这一切跟你的整理有关</h2>
        <p class="block-note">
          归位率 ${Math.round(score.placement * 100)}%（心情 ${moodBonus >= 0 ? '+' : ''}${moodBonus}）
          · 临期优先 ${Math.round(score.fefo * 100)}%
        </p>
        <p class="block-note">
          ${
            score.placement >= 0.8
              ? '东西都在你自己划的区里，闭着眼也拿得到。'
              : score.placement >= 0.5
                ? '大致知道在哪，但偶尔还得翻两下。'
                : '满屋翻找本身就在磨你的耐心。'
          }
        </p>
      </section>
    `;
  }

  /** "还剩多少 / 够几天" —— 这一节是整屏最实用的信息 */
  private stockHtml(disaster: ReturnType<typeof getDisasterDef>): string {
    const run = this.store.run;
    const rows = dailyDrainOf(disaster)
      .map(({ category, need }) => {
        // 必须把没拆的纸箱算进来：否则玩家会看着"主食 0 件"却明明有一箱没拆
        const stock = countCategory(run.shelves, run.boxesToUnpack, category);
        const days = need > 0 ? Math.floor(stock / need) : Number.POSITIVE_INFINITY;
        const tight = stock < need;
        return `
          <li class="stock-row${tight ? ' is-tight' : ''}">
            <b>${CATEGORY_LABELS[category]}</b>
            <span>${stock} 件</span>
            <em>${this.daysText(stock, days, need)}</em>
          </li>
        `;
      })
      .join('');
    return `<ul class="stock-list">${rows}</ul>`;
  }

  private daysText(stock: number, days: number, need: number): string {
    if (stock <= 0) return '已经没了';
    if (stock < need) return `今天就不够（差 ${need - stock} 件）`;
    if (!Number.isFinite(days)) return '够用';
    return `还能撑 ${days} 天`;
  }

  private statHtml(name: string, value: number, delta: number): string {
    const tone = delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : '';
    const sign = delta > 0 ? '+' : '';
    return `
      <div class="stat">
        <i>${escapeHtml(name)}</i>
        <b>${value}${delta === 0 ? '' : `<em class="${tone}">${sign}${delta}</em>`}</b>
      </div>
    `;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
    if (action === 'start') {
      playSfx('place');
      this.props.onStart();
    } else if (action === 'next') {
      playSfx('preview');
      this.props.onNext();
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
