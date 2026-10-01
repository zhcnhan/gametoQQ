/**
 * 结算界面（§9.6：生存天数 / 整理评分 / 图鉴解锁）。
 *
 * ★ M1 阶段 A 的边界：囤货期第 7 天过完 → day 走到 0 = **D-Day**，
 * 状态机把 phase 推到 `ending`。按已拍板，阶段 A 在这里**停住**：
 * 演出灾难揭晓 + 给"整理成果"的最小体检，并明确写出生存期尚未实装。
 * 阶段 C/D/E 会在这同一个界面上把生存天数、应急可达率、数字日报补齐。
 */
import { getDisasterDef } from '../data/disaster';
import { dayLabel, hintAt } from '../model/calendar';
import { computeOrganizeScore, gradeLabel, toPercent } from '../model/score';
import type { GameStore } from '../state/store';
import { householdTotals } from '../systems/organize';
import type { Screen } from './Router';

export interface EndingScreenProps {
  onRestart: () => void;
}

export class EndingScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly props: EndingScreenProps;

  constructor(root: HTMLElement, store: GameStore, props: EndingScreenProps) {
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
    const disaster = getDisasterDef(run.disasterId);
    const score = computeOrganizeScore(run.shelves, run.zones);
    const totals = householdTotals(run);
    const placement = toPercent(score.placement);
    const fefo = toPercent(score.fefo);

    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar">
          <div class="title">
            <h1>${dayLabel(0)} · ${escapeHtml(disaster.name)}登陆</h1>
            <p class="sub">${escapeHtml(hintAt(disaster, 0))}</p>
          </div>
        </header>
        <main class="scroll">
          <section class="block">
            <h2 class="block-title">${dayLabel(run.day)} · 囤货期结束</h2>
            <p class="block-note">
              你从 D-7 一路走到了这里。外面的世界从今天起不再按小时算 ——
              它只在你点"过一天"的时候流动。
            </p>
            <div class="stat-grid">
              <div class="stat"><i>现金余额</i><b>${run.cash}</b></div>
              <div class="stat"><i>囤到</i><b>${totals.pieces} 件</b></div>
              <div class="stat"><i>总重</i><b>${totals.weight.toFixed(1)}kg</b></div>
              <div class="stat"><i>还没拆</i><b>${run.boxesToUnpack.length} 箱</b></div>
            </div>
          </section>

          <section class="block">
            <h2 class="block-title">整理体检</h2>
            <div class="score-rows">
              ${this.scoreRow('归位率', placement, '你自己给胶带写的清单，东西有没有照放')}
              ${this.scoreRow('临期优先', fefo, '同架按到期日排好没有 —— 越快到期的越靠前，也越先被用掉')}
              <!-- DEFERRED(D-05): §6.3 的第三个维度「应急可达率」还没做。
                   它卡在 D-06（Shelf 没有"离门多近"这个信息）上，不是卡在算分公式上。 -->
              <div class="score-row is-pending">
                <span class="score-row-name">应急可达率</span>
                <span class="score-row-value">随生存期实装</span>
              </div>
            </div>
            ${
              score.tidyShelfIds.length > 0
                ? `<p class="block-note">有 ${score.tidyShelfIds.length} 块货架做到了「整整齐齐」。${
                    score.tidyShelfIds.length === run.shelves.length ? '整个房间都是。' : ''
                  }</p>`
                : '<p class="block-note">还没有一块货架做到「整整齐齐」。</p>'
            }
          </section>

          <section class="block">
            <h2 class="block-title">接下来</h2>
            <p class="block-note strong">
              生存期（每日消耗 / 腐坏 / 求援订单 / 数字日报）将在下一阶段实装。
            </p>
            <p class="block-note">
              现在你可以重开一局，换一个身份、换一套整理思路 ——
              这一局的物资会清空，但你已经学会怎么码货了。
            </p>
          </section>
        </main>
        <footer class="dock">
          <div class="dock-tools">
            <button class="btn btn-primary" data-action="restart">再来一局</button>
          </div>
        </footer>
      </div>
    `;
  }

  private scoreRow(name: string, percent: number, explain: string): string {
    return `
      <div class="score-row">
        <span class="score-row-name">${escapeHtml(name)}</span>
        <span class="score-row-bar"><i style="--fill:${percent / 100}"></i></span>
        <span class="score-row-value">${percent}%<em>${escapeHtml(gradeLabel(percent / 100))}</em></span>
        <span class="score-row-explain">${escapeHtml(explain)}</span>
      </div>
    `;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
    if (action === 'restart') this.props.onRestart();
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
