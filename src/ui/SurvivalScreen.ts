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
import { CATEGORY_LABELS, getItemDef } from '../data/items';
import { STAMINA_RECOVER, dailyDrainOf, moodFromPlacement, organizeQuality } from '../data/survival';
import { playSfx } from '../fx/audio';
import { itemIconSvg } from '../fx/icons';
import { hintAt, dayLabel, severityAt } from '../model/calendar';
import { countByItem, countCategory } from '../model/consume';
import { computeOrganizeScore } from '../model/score';
import type { HardPressLevel, RunState, SurvivalSnapshot } from '../model/types';
import type { GameStore } from '../state/store';
import { householdTotals } from '../systems/organize';
import { TRADE_COST_PIECES, tradeCooldownLeft } from '../systems/trade';
import type { Screen } from './Router';

export interface SurvivalScreenProps {
  /** D-Day：开始撑（day 0 → 1 并结算 D+1） */
  onStart: () => void;
  /** 过一天（结算新的一天） */
  onNext: () => void;
  /** 以物易物：把选好的三件交出去换一箱。返回是否成交（失败时界面保留已选，让玩家改） */
  onTrade: (picks: { itemId: string; count: number }[]) => boolean;
}

export class SurvivalScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly props: SurvivalScreenProps;
  /**
   * 换箱时选中的物资 → 件数。它只是界面上的草稿草稿，**不进存档** ——
   * 落盘的是命令执行后的结果，半途而废的选择没必要占用 schema。
   */
  private readonly picks = new Map<string, number>();

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
    const quality = organizeQuality(score.placement, score.fefo);
    const moodBonus = moodFromPlacement(score.placement);

    return `
      <section class="block">
        <h2 class="block-title">今天</h2>
        <p class="block-note">
          ${
            last.shortage > 0
              ? last.unreachable > 0
                ? `<b>缺 ${last.shortage} 件</b> —— 其中 ${last.unreachable} 件是没力气翻出来的。`
                : `<b>缺 ${last.shortage} 件</b> —— 没能凑齐。`
              : '该吃该烧的都凑齐了。'
          }
          ${last.spoiled > 0 ? `坏掉 ${last.spoiled} 件。` : ''}
        </p>
        ${last.hardPress ? `<p class="press-line">${escapeHtml(hardPressLine(last.hardPressLevel))}</p>` : ''}
        ${last.usedMedicine > 0 || last.usedWarmth > 0 ? `<p class="block-note">${escapeHtml(supplyText(last))}</p>` : ''}
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

      ${this.tradeHtml(run)}

      <section class="block">
        <h2 class="block-title">这一切跟你的整理有关</h2>
        <p class="block-note">
          归位率 ${Math.round(score.placement * 100)}%（心情 ${moodBonus >= 0 ? '+' : ''}${moodBonus}）
          · 临期优先 ${Math.round(score.fefo * 100)}%
        </p>
        <p class="block-note">
          ${
            last.fromBoxes > 0
              ? `货架上取了 ${last.fromShelves} 件，另外 <b>${last.fromBoxes} 件是从没拆的纸箱里翻出来的</b>。`
              : last.fromShelves > 0
                ? `今天要的 ${last.fromShelves} 件全在货架上，伸手就够到了。`
                : '今天什么也没能拿到 —— 屋里已经翻不出东西了。'
          }
        </p>
        <p class="block-note">
          翻找耗掉 ${last.workCost} 点体力，睡一觉回来 ${STAMINA_RECOVER} 点。
          ${last.workCost > STAMINA_RECOVER ? '<b>今天是净亏的。</b>' : ''}
        </p>
        ${
          last.unreachable > 0
            ? `<p class="press-line">有 ${last.unreachable} 件东西明明就在屋里，今天却没力气翻出来。</p>`
            : ''
        }
        <p class="block-note">${escapeHtml(qualityNote(quality))}</p>
      </section>
    `;
  }

  // ———————— 救急出口：以物易物（§12.3 v0.6）————————

  /**
   * 只在硬撑时才出现。日子过得去的时候连"你还不能换"都不说 ——
   * 那等于在暗示玩家先去硬撑一下。这个门应该是在他真正走投无路时才被想起来的。
   *
   * 反过来，冷却中的时候要显出来并说明还得等几天：他得知道这个门存在，只是今天敲不开。
   */
  private tradeHtml(run: RunState): string {
    if (!run.survival.last.hardPress) return '';
    const left = tradeCooldownLeft(run);
    return `
      <section class="block">
        <h2 class="block-title">去敲个门</h2>
        <p class="block-note">
          拿三件东西，换邻居一箱粮油。他挑，你给 —— 箱子里装着什么，他自己也说不准。
        </p>
        ${
          left > 0
            ? `<p class="press-line">上次刚换过。再过 ${left} 天，你才好意思再去。</p>`
            : `<div data-trade>${this.tradePickerHtml()}</div>`
        }
      </section>
    `;
  }

  private tradePickerHtml(): string {
    const run = this.store.run;
    const picked = [...this.picks.values()].reduce((n, c) => n + c, 0);
    const rows = countByItem(run.shelves, run.boxesToUnpack)
      .map(({ itemId, count }) => {
        const def = getItemDef(itemId);
        const chosen = this.picks.get(itemId) ?? 0;
        const left = count - chosen;
        const canAdd = picked < TRADE_COST_PIECES && left > 0;
        // 已经选过的堆必须一直能点（点一下收回一件）—— 它是唯一的撤销方式
        const disabled = !canAdd && chosen === 0;
        return `<li>
          <button class="trade-item${chosen > 0 ? ' is-chosen' : ''}${left <= 0 ? ' is-out' : ''}"
                  data-pick="${itemId}"${disabled ? ' disabled' : ''}>
            <span class="trade-icon">${itemIconSvg(def.icon)}</span>
            <b>${escapeHtml(def.name)}</b>
            <em>×${left}</em>
            ${chosen > 0 ? `<span class="trade-chosen">给了 ${chosen}</span>` : ''}
          </button>
        </li>`;
      })
      .join('');

    return `
      <ul class="trade-list">${rows || '<li class="block-note">屋里已经拿不出什么了。</li>'}</ul>
      <div class="trade-foot">
        <span class="trade-count">凑齐 ${picked}/${TRADE_COST_PIECES}</span>
        <button class="btn btn-primary" data-action="trade-confirm"${
          picked === TRADE_COST_PIECES ? '' : ' disabled'
        }>交给他</button>
      </div>
    `;
  }

  /** 点一下加一件；点已经选过的那一堆就是收回一件 */
  private togglePick(itemId: string): void {
    const chosen = this.picks.get(itemId) ?? 0;
    if (chosen > 0) {
      if (chosen === 1) this.picks.delete(itemId);
      else this.picks.set(itemId, chosen - 1);
      return;
    }
    const picked = [...this.picks.values()].reduce((n, c) => n + c, 0);
    if (picked >= TRADE_COST_PIECES) return;
    const run = this.store.run;
    const have = countByItem(run.shelves, run.boxesToUnpack).find((s) => s.itemId === itemId)?.count ?? 0;
    if (have <= 0) return;
    this.picks.set(itemId, 1);
  }

  /** 局部重绘：整页重绘会把滚动位置弹回顶部，而玩家正看着清单在挑东西 */
  private refreshTrade(): void {
    const host = this.root.querySelector('[data-trade]');
    if (host) host.innerHTML = this.tradePickerHtml();
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

    const pickEl = target.closest<HTMLElement>('[data-pick]');
    if (pickEl) {
      const itemId = pickEl.dataset['pick'];
      if (!itemId) return;
      this.togglePick(itemId);
      playSfx('pick');
      this.refreshTrade();
      return;
    }

    const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
    if (action === 'start') {
      playSfx('place');
      this.props.onStart();
    } else if (action === 'next') {
      playSfx('preview');
      this.props.onNext();
    } else if (action === 'trade-confirm') {
      const picks = [...this.picks.entries()].map(([itemId, count]) => ({ itemId, count }));
      // 成交才清空草稿；被拒时留着，让玩家改一下再试，而不是从头挑一遍
      if (this.props.onTrade(picks)) {
        this.picks.clear();
        this.refreshTrade();
      }
    }
  }

  private query<T extends HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`缺少必需节点：${selector}`);
    return el;
  }
}

/**
 * 硬撑那一行的话。三档三种说法 —— 玩家必须知道自己正在下沉的哪一层，
 * 否则"分档"就只是数据里的三个字符串。两档更重的都要**明说多烧了什么**，
 * 因为那才是他明天会在库存表上看到的差别。
 */
function hardPressLine(level: HardPressLevel): string {
  switch (level) {
    case 'straining':
      return '今天是在硬撑。没力气的时候，做什么都慢一拍。';
    case 'failing':
      return '撑不住已经好几天了。今天起，身体每天要多烧一份口粮。';
    case 'collapsing':
      return '快垮了。多烧的不止一份 —— 再这样下去，撑不到寒潮过去。';
    default:
      return '';
  }
}

/** 自动补给的一行说明。写"都是自动的"是因为玩家会问"我什么时候用的药" */
function supplyText(last: SurvivalSnapshot): string {
  const parts: string[] = [];
  if (last.usedMedicine > 0) parts.push(`用了 ${last.usedMedicine} 件药`);
  if (last.usedWarmth > 0) parts.push(`添了 ${last.usedWarmth} 件保暖`);
  return `${parts.join('，')} —— 这两样都是自己动的，不用你操心。`;
}

/**
 * 整理质量的一句话评语。
 *
 * 三档的分界跟体力劳作的公式是同一条线（见 data/survival.ts 的 workCostOf），
 * 所以玩家看到的话和身上的体力是一回事 —— 这里不能说一套、数值算另一套。
 */
function qualityNote(quality: number): string {
  if (quality >= 0.8) return '东西都在你自己划的区里，闭着眼也拿得到 —— 今天没在"找东西"上花力气。';
  if (quality >= 0.5) return '大致知道在哪，但偶尔还得翻两下。';
  if (quality > 0) return '东西散着放，找一件要挪三件。';
  return '货架基本没派上用场，今天全靠翻箱子。';
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
