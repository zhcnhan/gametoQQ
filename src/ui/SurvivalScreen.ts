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
import { SURVIVAL_DAYS, getDisasterDef, outdoorTemp } from '../data/disaster';
import { findEmergency } from '../data/emergencies';
import { CATEGORY_LABELS, getItemDef } from '../data/items';
import { SHELTER_SLEEP_LINE, STAMINA_RECOVER, dailyDrainOf, moodFromPlacement, organizeQuality } from '../data/survival';
import { playSfx } from '../fx/audio';
import { itemIconSvg } from '../fx/icons';
import { hintAt, dayLabel, severityAt } from '../model/calendar';
import { countByItem, countCategory } from '../model/consume';
import { districtDays, indoorTemp, supplyDays } from '../model/contrast';
import { computeOrganizeScore } from '../model/score';
import type { DisasterProfile, HardPressLevel, RunState, SurvivalSnapshot } from '../model/types';
import type { GameStore } from '../state/store';
import { isShutOut } from '../systems/help';
import { householdTotals } from '../systems/organize';
import { TRADE_COST_PIECES, tradeCooldownLeft } from '../systems/trade';
import type { Screen } from './Router';

export interface SurvivalScreenProps {
  /** D-Day：开始生存（day 0 → 1 并结算 D+1） */
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
          <h1 class="is-stamp">${dayLabel(day)}</h1>
          <p class="sub">${sub}</p>
        </div>
      </div>
    `;

    this.query('[data-main]').innerHTML = day === 0 ? this.ddayHtml() : this.dayHtml();
    this.query('[data-dock]').innerHTML = `
      <div class="dock-tools">
        ${
          day === 0
            ? `<button class="btn btn-primary" data-action="start">开始生存</button>`
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
        <p class="night-text">日历上那一天到了。外面开始下雪，风比预报的大。</p>
        <p class="block-note">
          从明天起，每天要消耗 ${needs.map((n) => `${CATEGORY_LABELS[n.category]} ${n.need}`).join('、')}。
          你囤的东西每天会被取一次，摆在哪儿、排得怎么样，都会变成数字。
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
    const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, getDisasterDef(run.disasterId));
    const quality = organizeQuality(score.placement, score.fefo);
    const moodBonus = moodFromPlacement(score.placement);

    return `
      <section class="block">
        <h2 class="block-title">今天</h2>
        <p class="block-note">
          ${
            last.shortage > 0
              ? last.unreachable > 0
                ? `<b>缺 ${last.shortage} 件</b>，其中 ${last.unreachable} 件是没力气翻出来的。`
                : `<b>缺 ${last.shortage} 件</b>，没能凑齐。`
              : '该吃该烧的都凑齐了。'
          }
          ${last.spoiled > 0 ? `坏掉 ${last.spoiled} 件。` : ''}
        </p>
        ${last.hardPress ? `<p class="press-line is-${last.hardPressLevel}">${escapeHtml(hardPressLine(last.hardPressLevel))}</p>` : ''}
        ${emergencyHtml(last)}
        ${coldHouseNote(run)}
        ${last.usedMedicine > 0 || last.usedWarmth > 0 ? `<p class="block-note">${escapeHtml(supplyText(last))}</p>` : ''}
        ${this.marketHtml(run)}
        ${this.stockHtml(disaster)}
      </section>

      ${this.safetyHtml(run)}

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

      ${this.contrastHtml(disaster, run)}

      <section class="block">
        <h2 class="block-title">这一切跟你的整理有关</h2>
        <p class="block-note">
          归位率 ${Math.round(score.placement * 100)}%（心情 ${moodBonus >= 0 ? '+' : ''}${moodBonus}）
          · 临期优先 ${Math.round(score.fefo * 100)}%
          · 应急可达 ${Math.round(score.emergency * 100)}%
        </p>
        <p class="block-note">
          ${
            last.fromBoxes > 0
              ? `货架上取了 ${last.fromShelves} 件，另外 <b>${last.fromBoxes} 件是从没拆的纸箱里翻出来的</b>。`
              : last.fromShelves > 0
                ? `今天要的 ${last.fromShelves} 件全在货架上，伸手就够到了。`
                : '今天什么也没拿到，屋里翻不出东西了。'
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

      <section class="block">
        <h2 class="block-title">明天</h2>
        <p class="block-note">${escapeHtml(tomorrowHint(disaster, run.day))}</p>
      </section>
    `;
  }

  /**
   * 「安全感」快照（§12 拍板 v0.9）。
   *
   * ## 为什么它必须出现在这里，而不是整理期
   *
   * M1 评审的原话是：整理的正反馈要等 8 天后的生存期才兑现，**奖励延迟太长**。
   * 但 §5 又明说「整理期完全静默」—— 那条不能动。所以快照的落点只能是夜间/日报语境，
   * 也就是这一屏：玩家已经看完今天发生了什么之后，再给他三行中性陈述。
   *
   * ## 为什么是"三格中性陈述"而不是一个分数
   *
   * 三个数（归位率 / 临期优先 / 顺手位）各自回答一个具体问题，
   * 合起来正好是 §6.3 的三个维度。给一个复合分数会让玩家算不出它是怎么来的，
   * 而"我能不能自己验证这个数"是整理这件事唯一的学习路径。
   *
   * ## 连击的口径
   *
   * 只陈述，不夸（§5 引擎①）。达到 2 天以上才写那一行 ——
   * 第一天就报"连过 1 天"听起来像在发奖状。
   */
  private safetyHtml(run: RunState): string {
    const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, getDisasterDef(run.disasterId));
    const handy = score.emergency;
    const streak = run.survival.safeStreak;
    // 连击那一行与"为什么没连上"那一行互斥，而且**空的时候不渲染任何东西** ——
    // 一切都正常的日子不该被硬塞一句话（§5 引擎①：只陈述，不夸）
    const note =
      streak >= 2 ? `连着 ${streak} 天，该拿到的都拿到了。` : safetyNote(run, score.placement, score.emergency);
    return `
      <section class="block">
        <h2 class="block-title">今天屋里的样子</h2>
        <div class="stat-grid is-triple">
          <div class="stat"><i>归位率</i><b>${Math.round(score.placement * 100)}%</b></div>
          <div class="stat"><i>临期优先</i><b>${Math.round(score.fefo * 100)}%</b></div>
          <div class="stat"><i>顺手位</i><b>${Math.round(handy * 100)}%</b></div>
        </div>
        ${note ? `<p class="block-note">${escapeHtml(note)}</p>` : ''}
      </section>
    `;
  }

  /**
   * 反差层（§6.6「数字自己说话」，零台词）。
   *
   * 两对数字并排：外面的温度对屋里的温度，你的余粮对街区的余粮。
   * **不配任何形容词** —— 这一层的全部力量来自让玩家自己把两个数摆在一起看；
   * 一旦写下"你比邻居强多了"，它就变成炫耀，而炫耀是这个游戏一直躲开的东西。
   */
  private contrastHtml(disaster: DisasterProfile, run: RunState): string {
    return `
      <section class="block">
        <h2 class="block-title">外面 / 里面</h2>
        <div class="contrast-pair">
          <div class="contrast-cell"><i>外面</i><b>${outdoorTemp(run.day, run.disasterId)}°C</b></div>
          <div class="contrast-cell is-warm"><i>屋里</i><b>${indoorTemp(run.stats.shelter)}°C</b></div>
        </div>
        <div class="contrast-pair">
          <div class="contrast-cell"><i>你的余粮</i><b>${supplyDays(run, disaster)} 天</b></div>
          <div class="contrast-cell"><i>街区平均</i><b>${districtDays(run.day)} 天</b></div>
        </div>
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
    // §6.5 的「婉拒 → 后续交易关闭」。**必须显出来**：
    // 让玩家点了才发现没反应，等于把那一次婉拒的代价藏起来了
    if (isShutOut(run)) {
      return `
        <section class="block">
          <h2 class="block-title">去敲个门</h2>
          <p class="press-line">上次没给他，这会儿再去开口不太合适。</p>
        </section>
      `;
    }
    const left = tradeCooldownLeft(run);
    return `
      <section class="block">
        <h2 class="block-title">去敲个门</h2>
        <p class="block-note">
          拿三件东西，换邻居一箱粮油。品类不限，他自己挑。
        </p>
        ${
          left > 0
            ? `<p class="press-line">上次换过了。再过 ${left} 天再去。</p>`
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
  /**
   * 市场那一行（D-17 清偿）。
   *
   * ## ★ 它改过一版，因为第一版既看不懂又在说废话
   *
   * 第一版长这样：**「有钱也难买到 2.2 倍」**，而且**每天都出现**。
   * 用户的反馈是"有个奇怪的横幅，有钱也难买到 xx 倍是啥意思，说明白，
   * 文案不要这么让人看不懂还无说明"。
   *
   * 两条都是真问题，而且第二条更严重：
   *
   *  ① **它每天在报一个玩家改不了的事实。** 生存期**买不了东西**
   *     （`phase = survival_day`，商店只在囤货期开），所以"现在 2.2 倍"
   *     对玩家没有任何可操作性 —— 它只是每天印一遍同一句话；
   *  ② **"有钱也难买到"是形容词，不是数字。** §6.6 那条纪律是
   *     "数字自己说话"，而我在这里加了四个字的判词，却**没给参照物** ——
   *     2.2 倍是相对什么？玩家上一次看到原价是 D-7。
   *
   * ## 现在的口径：只在**真的有变化**时才说，而且说清"相对什么"
   *
   * 显示条件是 `run.shopPriceFactor !== 1`（囤货期被事件抬过价）
   * **或**有限购在生效 —— 那时玩家在下一个囤货日会真的多付钱，值得知道。
   * 一场都没发生过（`shopPriceFactor` 还是 1）就**一个字都不显示**。
   */
  private marketHtml(run: RunState): string {
    /*
     * `shopPriceFactor` 是**囤货期被事件抬上去的**那部分（`applyDayEffect` 里累乘）。
     * 它换天不清零 —— 所以它非 1 就代表"你之前碰上的那件事还在影响价格"。
     *
     * ★ 而 `dayPriceFactor`（这一场的逐日曲线）是**另一回事**：
     * 它由灾难本身决定，人人如此、天天如此，所以它不该单独成一条横幅。
     * 这一行要报的是"**比平常还贵**"，参照物就是这一场当天的正常价位。
     */
    const eventPrice = run.shopPriceFactor;
    const hasPriceNews = Math.abs(eventPrice - 1) > 0.001;
    const limits = run.shopLimits;
    if (!hasPriceNews && limits.length === 0) return '';

    const parts: string[] = [];
    if (hasPriceNews) {
      // 说清"比这一场的平常价"贵/便宜多少，而不是一个没有参照物的倍数
      const pct = Math.round((eventPrice - 1) * 100);
      parts.push(`之前那件事的影响还在：比这一场的平常价${pct > 0 ? '贵' : '便宜'} ${Math.abs(pct)}%`);
    }
    if (limits.length > 0) {
      const cats = limits.map((l) => CATEGORY_LABELS[l.category] ?? l.category).join('、');
      parts.push(`${cats}在限购（每个品类最多 ${limits[0]?.max ?? 0} 件）`);
    }
    parts.push('下一天出门时会按这个价结账');
    return `<p class="block-note market-line">${escapeHtml(parts.join(' · '))}</p>`;
  }

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
      return '快垮了。多烧的不止一份。';
    default:
      return '';
  }
}

/**
 * 受冻预警（§12.3 v0.7）。庇护所跌破 40 → 今晚睡觉只回一半体力。
 *
 * 必须在**结算之前**就出现在屏幕上，而不是等体力真的少回一半之后才在日志里补一句 ——
 * 预警是可行动的（"该添被了"），事后解释不是。它只读当前庇护所值，不进快照。
 */
function coldHouseNote(run: RunState): string {
  if (run.stats.shelter >= SHELTER_SLEEP_LINE) return '';
  const hint =
    countCategory(run.shelves, run.boxesToUnpack, 'warmth') > 0
      ? '屋里还有保暖的东西，今晚会自己添上。'
      : '屋里没有保暖的东西了。棉被在五金店，但今天下不了楼。';
  return `<p class="press-line is-cold">屋子太冷（庇护所 ${Math.round(run.stats.shelter)}），今晚睡觉只能回一半体力。${escapeHtml(hint)}</p>`;
}

/** 明日预告（§9 界面清单第 5 条的最后一项）。它让"今天要不要省着过"变成一个可以想的问题 */
function tomorrowHint(disaster: DisasterProfile, day: number): string {
  if (day >= SURVIVAL_DAYS) return '最后一天了。撑过去，寒潮就过去了。';
  return hintAt(disaster, day + 1);
}

/** 自动补给的一行说明。写"都是自动的"是因为玩家会问"我什么时候用的药" */
function supplyText(last: SurvivalSnapshot): string {
  const parts: string[] = [];
  if (last.usedMedicine > 0) parts.push(`用了 ${last.usedMedicine} 件药`);
  if (last.usedWarmth > 0) parts.push(`添了 ${last.usedWarmth} 件保暖`);
  return `${parts.join('，')}。这两样是自动用的，不用管。`;
}

/**
 * 整理质量的一句话评语。
 *
 * 三档的分界跟体力劳作的公式是同一条线（见 data/survival.ts 的 workCostOf），
 * 所以玩家看到的话和身上的体力是一回事 —— 这里不能说一套、数值算另一套。
 */
function qualityNote(quality: number): string {
  if (quality >= 0.8) return '东西都在你自己划的区里，闭着眼也拿得到。';
  if (quality >= 0.5) return '大致知道在哪，偶尔还得翻两下。';
  if (quality > 0) return '东西散着放，找一件要挪三件。';
  return '货架没派上用场，今天全靠翻箱子。';
}

/**
 * 突发事件的当天叙述（§5 的另一半，M2）。
 *
 * 两句话都要说清楚：**是什么事** + **靠什么化解的（或缺了什么）**。
 * 只写"今天出了件事"等于把一条可见的因果链藏起来 ——
 * 而 §5 那句话的力量恰恰在于"你之前在整理期做的那个决定救了今天的你"。
 *
 * 化解成功时用暖黄：它属于 M2 新增的正反馈（安全感 / 交付成功 / 图鉴点亮）那一类，
 * 是暖黄**第二次上岗**（§5A 限定暖黄只用于"安全 / 窗内"语义）。
 * 没化解时用中性的 press-line，不用朱红 —— 朱红专指警告，
 * 而"你没把药放在门口"不是一个需要报警的事，它是一个结果。
 */
function emergencyHtml(last: SurvivalSnapshot): string {
  if (!last.emergencyId) return '';
  const def = findEmergency(last.emergencyId);
  if (!def) return '';
  if (last.emergencyResolved) {
    return `<p class="block-note warm">${escapeHtml(def.text)}顺手位上有，用上了。</p>`;
  }
  return `<p class="press-line">${escapeHtml(def.text)}${
    def.needOnHandy > 1
      ? `顺手位上不够 ${def.needOnHandy} 件${CATEGORY_LABELS[def.category]}。`
      : `顺手位上没有${CATEGORY_LABELS[def.category]}。`
  }</p>`;
}

/**
 * 连击断掉时的那一句。**必须说清是哪一格拖住了** ——
 * 三个数里有一个掉下去，玩家才知道明天该动哪里；
 * 只写"今天没达标"是一句空话。
 */
function safetyNote(run: RunState, placement: number, emergency: number): string {
  const last = run.survival.last;
  if (last.shortage > 0) return `今天没凑齐 ${last.shortage} 件。`;
  if (last.unreachable > 0) return `有 ${last.unreachable} 件在屋里，没翻出来。`;
  if (last.hardPress) return '今天是在硬撑。';
  if (run.survival.safeStreak > 0) return `连着 ${run.survival.safeStreak} 天，该拿到的都拿到了。`;
  if (placement < 0.5) return '东西还没放进你自己写的清单里，每天找它们要多花力气。';
  if (emergency < 1) return '急用的那几件还不在顺手位上，出了事得现翻。';
  return '';
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
