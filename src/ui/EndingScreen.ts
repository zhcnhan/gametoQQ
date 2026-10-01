/**
 * 结算界面（§9.6：生存天数 / 整理评分 / 图鉴解锁）。
 *
 * ★ M1 的结局有**两种**，界面必须把它们说清楚（§12.3 v0.5 修订）：
 *
 *   · `outcome === 'survived'`  —— 撑满了 7 天；
 *   · `outcome === 'collapsed'` —— 健康归零，走到第 N 天停下来了；
 *   · `outcome === null`        —— 老档（阶段 A 时期"囤货期走完就结束"），按"囤货期结束"说。
 *
 * 三种都说成"你撑过去了"是最糟的处理：那会让"没撑住"变成一个没有重量的结局。
 *
 * 图鉴解锁（§9.6 第三项）属 M2，这里仍然只有生存天数 + 整理评分。
 */
import { SURVIVAL_DAYS, getDisasterDef } from '../data/disaster';
import { NPC_DEFS } from '../data/npcs';
import { dayLabel, hintAt } from '../model/calendar';
import { computeOrganizeScore, gradeLabel, toPercent } from '../model/score';
import type { RunState } from '../model/types';
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
    const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack);
    const totals = householdTotals(run);
    const placement = toPercent(score.placement);
    const fefo = toPercent(score.fefo);
    const collapsed = run.outcome === 'collapsed';
    const survived = run.outcome === 'survived';
    // 倒下的那天就是"走到哪儿"；撑满时 run.day 正好等于 SURVIVAL_DAYS
    const lasted = Math.max(0, run.day);

    const title = survived
      ? `撑过 ${SURVIVAL_DAYS} 天`
      : collapsed
        ? `第 ${lasted} 天 · 停在这里`
        : `${dayLabel(0)} · ${escapeHtml(disaster.name)}登陆`;
    const sub = survived
      ? `${escapeHtml(disaster.name)}过去了`
      : collapsed
        ? `${escapeHtml(disaster.name)} · 没撑住`
        : escapeHtml(hintAt(disaster, 0));
    const verdict = survived
      ? '你撑过来了。这不是运气 —— 是那些箱子、那些胶带、和几十次弯腰换来的。'
      : collapsed
        ? '没撑住。但你大概已经知道自己缺的是哪一样了 —— 下一局从那儿补。'
        : '囤货期结束了。';

    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar">
          <div class="title">
            <h1>${title}</h1>
            <p class="sub">${sub}</p>
          </div>
        </header>
        <main class="scroll">
          <section class="block">
            <h2 class="block-title">这一局</h2>
            <p class="block-note strong${collapsed ? ' is-collapsed' : ''}">${escapeHtml(verdict)}</p>
            <div class="stat-grid">
              <div class="stat"><i>撑过</i><b>${lasted} 天</b></div>
              <div class="stat"><i>硬撑过</i><b>${run.survival.hardPressDays} 天</b></div>
              <div class="stat"><i>没凑齐</i><b>${run.survival.shortagePieces} 件</b></div>
              <div class="stat"><i>最后剩下</i><b>${totals.pieces} 件</b></div>
            </div>
            <p class="block-note">${escapeHtml(
              runStory({
                survived,
                lasted,
                hardPressDays: run.survival.hardPressDays,
                shortPieces: run.survival.shortagePieces,
                unreachablePieces: run.survival.unreachablePieces
              })
            )}</p>
            ${trustNote(run) ? `<p class="block-note">${escapeHtml(trustNote(run))}</p>` : ''}
          </section>

          <section class="block">
            <h2 class="block-title">整理体检</h2>
            <div class="score-rows">
              ${this.scoreRow('归位率', placement, '你自己给胶带写的清单，东西有没有照放 —— 它决定每天找东西要花多少体力')}
              ${this.scoreRow('临期优先', fefo, '同架按到期日排好没有 —— 越快到期的越靠前，也越先被用掉')}
              <!-- DEFERRED(D-05): §6.3 的第三个维度「应急可达率」还没做。
                   它卡在 D-06（Shelf 没有"离门多近"这个信息）上，不是卡在算分公式上。 -->
              <div class="score-row is-pending">
                <span class="score-row-name">应急可达率</span>
                <span class="score-row-value">随 M2 实装</span>
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
            <p class="block-note">
              换一个身份、换一套整理思路再来一次 —— 这一局的物资会清空，但你已经知道
              "东西放在哪"到底值多少体力了。
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

/**
 * 把四个孤立的数字讲成一句话。
 *
 * 它存在的原因很具体：结算页曾经出现过一组自相矛盾的格子 —— **「撑过 7 天 · 断粮 7 天」**。
 * 数据其实没错（每天确实都短了点东西，但没短到垮掉），错的是没人把它们串起来。
 * 玩家看到四个互不相干的数，只能自己猜；而结算页只该回答一个问题：**这一局栽在哪。**
 */
function runStory(input: {
  survived: boolean;
  lasted: number;
  hardPressDays: number;
  shortPieces: number;
  unreachablePieces: number;
}): string {
  const { survived, lasted, hardPressDays, shortPieces, unreachablePieces } = input;

  if (!survived) {
    // 没撑住的时候，"缺的是吃的"和"缺的是力气"是两种完全不同的死法，必须分开说
    if (unreachablePieces > shortPieces) {
      return `走到第 ${lasted} 天就没撑住。屋里其实还有东西 —— 是没能翻出来。`;
    }
    if (shortPieces > 0) {
      return `走到第 ${lasted} 天就没撑住。前后一共短了 ${shortPieces} 件口粮，缺口是从那时候开始的。`;
    }
    return `走到第 ${lasted} 天就没撑住。奇怪的是吃的不缺 —— 是别的先垮了。`;
  }

  if (hardPressDays === 0 && shortPieces === 0 && unreachablePieces === 0) {
    return '一路都没短过什么。你甚至没怎么动过最后那点余粮。';
  }

  const parts: string[] = [];
  if (hardPressDays > 0) parts.push(`有 ${hardPressDays} 天在硬撑`);
  if (shortPieces > 0) parts.push(`前后短了 ${shortPieces} 件口粮`);
  if (unreachablePieces > 0) parts.push(`还有 ${unreachablePieces} 件明明在屋里、却没力气翻出来`);

  const head = parts.join('，');
  if (hardPressDays > 0) return `${head}。撑是撑过来了，但后半程不轻松。`;
  return `${head}。没到伤筋动骨的地步。`;
}

/**
 * 关系的一句话总结（§6.5 的人情）。
 *
 * §6.7 的"关系图鉴"属 M2，M1 只做这一行 —— 但这一行必须有：
 * 人情是这个局里唯一会**跨天累积**、又会影响别的东西的数值（它决定「去敲个门」开不开），
 * 不显示出来，玩家就永远不知道那次婉拒到底付了什么代价。
 *
 * 全是 0 时不显示 —— 一个从没和人来往过的局，不该被硬塞一句"人情：0"。
 */
function trustNote(run: RunState): string {
  const rows = NPC_DEFS.map((npc) => ({ name: npc.name, value: run.trust[npc.id] ?? 0 })).filter(
    (r) => r.value !== 0
  );
  if (rows.length === 0) return '';
  const parts = rows.map((r) => `${r.name} ${r.value > 0 ? '+' : ''}${r.value}`);
  return `这一片还剩下多少人情：${parts.join(' · ')}`;
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
