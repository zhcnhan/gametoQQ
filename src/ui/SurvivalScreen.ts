/**
 * 生存期界面（§6.4 生存期每日结算 / §9 界面清单第 5 条"每日日报"的最简版）。
 *
 * 分层纪律：只读；写操作（两个命令）通过 props 交给 systems/phases。
 *
 * 这一屏要回答的问题只有一个：**"我还撑得住几天？"**
 * 所以信息的排布顺序是：今天发生了什么 → 还剩多少、够几天 → 身体与状态 → 这一切跟我的整理有什么关系。
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
import { iconSvg, itemIconSvg } from '../fx/icons';
import { hintAt, dayLabel, severityAt } from '../model/calendar';
import { countByItem, countCategory } from '../model/consume';
import { districtDays, handyDays, indoorTemp, supplyDays } from '../model/contrast';
import { computeOrganizeScore } from '../model/score';
import type { DisasterProfile, HardPressLevel, RunState, SurvivalSnapshot } from '../model/types';
import { revealedForecasts } from '../systems/intel';
import type { GameStore } from '../state/store';
import { isShutOut } from '../systems/help';
import { householdTotals } from '../systems/organize';
import { GO_HOME_AP_COST } from '../systems/phases';
import {
  TRADE_COST_PIECES,
  TRADE_MAX_CASH_PIECES,
  cashPriceOf,
  pickCashFor,
  tradeCooldownLeft,
  type TradeIntent
} from '../systems/trade';
import { disasterTagHtml, windowBandHtml } from './windowBand';
import type { Screen } from './Router';

export interface SurvivalScreenProps {
  /** D-Day：开始生存（day 0 → 1 并结算 D+1） */
  onStart: () => void;
  /** 过一天（结算新的一天） */
  onNext: () => void;
  /** 回家整理（M4 决策 B：花 1 个行动点，由 systems/phases 的 goOrganize 完成） */
  onGoOrganize: () => void;
  /**
   * 以物易物：把选好的（两件货 + 一件的钱，或三件货）交出去换一箱。
   *
   * ★ 交出去的是**一单意图**（`TradeIntent`）而不是"顶哪一件"——
   * 那条规矩住在 systems/trade 的 `pickCashFor`，界面只回答"开关开没开"。
   * 返回是否成交（失败时界面保留已选，让玩家改）。
   */
  onTrade: (intent: TradeIntent) => boolean;
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

  private cashOn = false;

  private readonly onClickBound = (e: MouseEvent): void => this.onClick(e);

  mount(): void {
    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar" data-head></header>
        ${/* ★ 顶栏底下那一条"窗外"（用户 2026-10："任何东西都要让我有感知"）——
             它让"这一局是哪一场"在**每一屏**上都看得见，而此前只有数字不同。
             颜色全部来自 `data/windowThemes.ts`，见 `ui/windowBand.ts` 的注释。 */ ''}
        ${windowBandHtml(this.store.run)}
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
        ${disasterTagHtml(run)}
      </div>
    `;

    this.query('[data-main]').innerHTML = day === 0 ? this.ddayHtml() : this.dayHtml();
    this.query('[data-dock]').innerHTML = `
      <div class="dock-tools">
        ${this.goOrganizeHtml(run)}
        ${
          day === 0
            ? `<button class="btn btn-primary" data-action="start">开始生存</button>`
            : `<button class="btn btn-primary" data-action="next">过一天</button>`
        }
      </div>
    `;
  }

  /**
   * 「回家整理」那个按钮（M4 决策 B：生存期可以自由回去整理）。
   *
   * ## 用户的口径
   *
   * > "可以自由回去，并且做出操作也会有影响，只是不能通过商店补货了"
   *
   * 所以这个入口**不限次数**，代价只有行动点（见 `systems/phases.ts` 的 `goOrganize`）。
   *
   * ## ★ 为什么行动点不够时是"灰掉 + 写出差多少"，而不是藏起来
   *
   * §4A 说"不许有死按钮"—— 而它的意思是**不许有"点了不知道为什么没反应"的按钮**。
   * 一个灰按钮配一句"今天剩 0 点"，说的是同一件事，而且它比"按钮凭空消失"
   * 多告诉玩家两件重要的事：**这条路存在**，以及**它是怎么算的**。
   *
   * ★ 与整理页的"再去采购"（`ui/OrganizeScreen.ts` 的 `renderDock`）是同一套做法，
   * 两处都是"资源不够 → 灰掉 + 说明"，不要一处藏一处灰。
   */
  private goOrganizeHtml(run: RunState): string {
    const can = run.actionPoints >= GO_HOME_AP_COST;
    const note = can
      ? `花 ${GO_HOME_AP_COST} 个行动点`
      : `今天剩 ${run.actionPoints} 点，不够了`;
    return `
      <button class="btn" data-action="go-organize"${can ? '' : ' disabled'}>${iconSvg('box')}<span>回家整理</span><em class="btn-note">${escapeHtml(note)}</em></button>
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
          <div class="stat"><i>待拆纸箱</i><b>${run.boxesToUnpack.length} 箱</b></div>
          <div class="stat"><i>现金</i><b>${run.cash}</b></div>
        </div>
      </section>
      ${/*
        ★ 温度那一块**从 D-Day 就显示**（用户 2026-10 反馈"外面里面那个我没看到"）。
        原来整个反差层都挂在 `dayHtml()` 里，而 D-Day 走的是 `ddayHtml()` ——
        于是玩家在**灾难落地那一屏**上看不到"室外多少度、室内多少度"，
        而那一屏恰恰是这一层最该说话的地方（§6.6：数字自己说话）。
        余粮那一半仍然只在 D+1 起显示：D-Day 还没结算过，天数没有意义。
      */ ''}
      ${this.tempHtml(run)}
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
          ${
            /*
             * ★ 翻乱（§6.4 的滚雪球，D-11）：说**做了什么**，不说"归位率掉了 X%"。
             * 后者是分数口径，而玩家刚才做的事是"翻找"——
             * 因果要连在一起他才知道下次该怎么改。
             */
            last.scattered > 0
              ? `<span class="scatter-line">翻找的时候把 ${escapeHtml(last.scatteredRows.join('、'))} 翻乱了。</span>`
              : ''
          }
        </p>
        ${last.hardPress ? `<p class="press-line is-${last.hardPressLevel}">${escapeHtml(hardPressLine(last.hardPressLevel))}</p>` : ''}
        ${emergencyHtml(last)}
        ${coldHouseNote(run)}
        ${last.usedMedicine > 0 || last.usedWarmth > 0 ? `<p class="block-note">${escapeHtml(supplyText(last))}</p>` : ''}
        ${this.intelHtml(run)}
        ${this.marketHtml(run)}
        ${this.stockHtml(disaster)}
      </section>

      ${this.safetyHtml(run)}

      <section class="block">
        <h2 class="block-title">身体与状态</h2>
        <div class="stat-grid">
          ${this.statHtml('健康', run.stats.health, last.health)}
          ${this.statHtml('心情', run.stats.mood, last.mood)}
          ${this.statHtml('体力', run.stats.stamina, last.stamina)}
          ${this.statHtml('庇护所', run.stats.shelter, last.shelter)}
        </div>
      </section>

      ${this.tradeHtml(run)}

      ${this.tempHtml(run)}

      ${this.contrastHtml(disaster, run)}

      <section class="block">
        <h2 class="block-title">这一切跟你的整理有关</h2>
        <p class="block-note">
          归位率 ${Math.round(score.placement * 100)}%（心情 ${moodBonus >= 0 ? '+' : ''}${moodBonus}）
          · 快到期的先吃 ${Math.round(score.fefo * 100)}%
          · 急用的够不够得着 ${Math.round(score.emergency * 100)}%
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
          <div class="stat"><i>快到期的先吃</i><b>${Math.round(score.fefo * 100)}%</b></div>
          <div class="stat"><i>顺手位</i><b>${Math.round(handy * 100)}%</b></div>
        </div>
        ${note ? `<p class="block-note">${escapeHtml(note)}</p>` : ''}
      </section>
    `;
  }

  /**
   * 室内 / 室外温度（§6.6：「数字自己说话」最原始的那一对）。
   *
   * ★ 单独抽成一个方法，因为它**两屏都要用**：D-Day（`ddayHtml`）与日报（`dayHtml`）。
   * 两处各写一遍的话，迟早会出现"日报改了口径、D-Day 还是旧的"。
   */
  private tempHtml(run: RunState): string {
    return `
      <section class="block">
        <h2 class="block-title">室内 / 室外</h2>
        <div class="contrast-pair">
          <div class="contrast-cell"><i>室外</i><b>${outdoorTemp(run.day, run.disasterId)}°C</b></div>
          <div class="contrast-cell is-warm"><i>室内</i><b>${indoorTemp(run.stats.shelter)}°C</b></div>
        </div>
      </section>
    `;
  }

  /**
   * 反差层剩下的那一块：「你 / 整条街」（§6.6「数字自己说话」，零台词）。
   *
   * ## ★★ 这一块在 2026-10 被用户点名重写过，改的是**"这一栏到底在比什么"**
   *
   * 用户的原话：
   *
   * > "外面里面为啥不能叫室内室外呢，类似的尴尬文案你给我全部改了！！！"
   *
   * 他说得对，而且比"换个词"更根本 —— 原来那一块是这么排的：
   *
   * ```
   * 外面 / 里面            ← 区块标题
   *   外面 -23°C │ 屋里 13°C
   *   你的余粮 5 天 │ 街区平均 2 天     ← 这一行跟"里面/外面"毫无关系
   * ```
   *
   * 两个毛病：① 标题写"里面"，格子却写"屋里"（**同一件事两个词**）；
   * ② 第二行比的是"你 vs 街区"，与"室内 / 室外"根本不是一回事，
   * 却被塞在同一个标题底下 —— 玩家读到的标题对不上底下的数。
   *
   * 所以现在拆成两块，**每块的标题就是它底下那两个数在比什么**：
   * 温度归 `tempHtml`（室内 / 室外），天数归这里（你 / 整条街）。
   *
   * ## 措辞的三处口径（同一次改的）
   *
   *  · **"你的余粮" → "你的存货"**：这个数数的是**七个品类加总**（主食/饮水/燃料/…），
   *    而"余粮"在中文里专指粮食 —— 一个把燃料算进去的数叫"余粮"是不准的；
   *  · **"随手够得到" → "不用翻就拿到"**："随手/顺手"在这款游戏里已经是**专有名词**
   *    （`Shelf.handyRank`，全屋唯一那一块），而这一格数的是"顺手位 **∪** 贴了清单的行" ——
   *    用专有名词去描述一个更宽的集合，会让玩家以为它说的就是那块架子；
   *  · **"要翻才拿得到"保留**：它把"够不到"翻译成**一个动作**（翻），
   *    与 §6.4「乱 → 翻找耗时」是同一种说法。
   */
  private contrastHtml(disaster: DisasterProfile, run: RunState): string {
    const total = supplyDays(run, disaster);
    const handy = handyDays(run, disaster);
    // 差为 0（整批货还躺在纸箱里、或恰好全部都在明面上）时不显示差值那一行
    const reachRow =
      total - handy > 0
        ? `<div class="contrast-pair is-reach">
             <div class="contrast-cell"><i>不用翻就拿到</i><b>${handy} 天</b></div>
             <div class="contrast-cell"><i>要翻才拿得到</i><b>${total - handy} 天</b></div>
           </div>`
        : '';
    return `
      <section class="block">
        <h2 class="block-title">你 / 整条街</h2>
        <div class="contrast-pair">
          <div class="contrast-cell"><i>你的存货</i><b>${total} 天</b></div>
          <div class="contrast-cell"><i>街区平均</i><b>${districtDays(run.day)} 天</b></div>
        </div>
        ${reachRow}
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
    /*
     * ★★ 现金那一件只花**这件东西今天的价钱**，而它是从已经挑好的那几件里
     * 挑**最贵的那个**算的（`pickCashFor`）。
     *
     * 为什么不让玩家自己指哪一件用钱顶：那个做法要给每一行加一个"用钱顶"的开关，
     * 而玩家在"三件里挑三件"这件事上**不是**在挑"哪一件付钱"——
     * 他挑的是"割哪三样肉"。多一层开关只会让本想好的决定变复杂。
     * 代价是贵一点：退掉的那一件是**你自己挑的最贵的那件**。
     */
    const cash = this.cashAmount();
    const need = this.needPieces();
    const canPickCash = picked > 0;
    const rows = countByItem(run.shelves, run.boxesToUnpack)
      .map(({ itemId, count }) => {
        const def = getItemDef(itemId);
        const chosen = this.picks.get(itemId) ?? 0;
        const left = count - chosen;
        const canAdd = picked < need && left > 0;
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

    /*
     * ★★ 这件东西还没挑出来之前（`picks` 是空的）**不给开**这个开关。
     *
     * 第一版让它一直可点，于是玩家能在清单空着的时候打开它 —— 那一件挑不出来，
     * 命令收到的 `cashOn` 落空，最后回一句"要凑满 3 件"。玩家会读成"钱这条路走不通"。
     * 现在按钮灰着，并**说清为什么**（§4A：不许有死按钮），因为差额在挑好之前算不出来。
     */
    const cashBtn = `
      <button class="trade-cash${this.cashOn ? ' is-on' : ''}" data-action="trade-cash"
              aria-pressed="${this.cashOn ? 'true' : 'false'}"${canPickCash ? '' : ' disabled'}>
        ${
          !canPickCash
            ? `先挑要给的东西 —— 钱只能顶掉其中一件`
            : this.cashOn
              ? `用钱顶一件：付 <b>${cash} 元</b>（按你挑的最贵那件算）`
              : `也可以拿钱顶一件 —— 退一件，按你挑的最贵那件折价`
        }
      </button>`;

    return `
      <ul class="trade-list">${rows || '<li class="block-note">屋里已经拿不出什么了。</li>'}</ul>
      ${cashBtn}
      ${cashNoteHtml(cash, run.cash)}
      <div class="trade-foot">
        <span class="trade-count">凑齐 ${picked}/${need}</span>
        <button class="btn btn-primary" data-action="trade-confirm"${
          picked === need && (cash === 0 || cash <= run.cash) ? '' : ' disabled'
        }>交给他</button>
      </div>
    `;
  }

  /**
   * 现金顶掉的那一件值多少 —— 在已经挑好的那几件里取**最贵的**；一件都没挑时是 0。
   *
   * ★ "一件都没挑"与"挑好了但付不起"是两种不同的状态，界面要分开说，
   * 所以价钱（`cashAmount`）与差额（`run.cash` 减它）两个数都要拿到手。
   */
  private cashAmount(): number {
    if (!this.cashOn) return 0;
    const id = pickCashFor(this.store.run, this.picks);
    return id === null ? 0 : cashPriceOf(this.store.run, id);
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
    if (picked >= this.needPieces()) return;
    const run = this.store.run;
    const have = countByItem(run.shelves, run.boxesToUnpack).find((s) => s.itemId === itemId)?.count ?? 0;
    if (have <= 0) return;
    this.picks.set(itemId, 1);
  }

  /**
   * 这一单还要几件货（开着"用钱顶一件"时少一件）。
   *
   * ★ 所有"凑齐几件"的判断都必须走这里。写死 `TRADE_COST_PIECES` 的地方会与
   * 渲染出来的 `凑齐 N/M` 对不上 —— 玩家看到"凑齐 2/2"而按钮是灰的，
   * 或者反过来点得下去然后被命令拒绝。
   */
  private needPieces(): number {
    return this.cashOn ? TRADE_COST_PIECES - TRADE_MAX_CASH_PIECES : TRADE_COST_PIECES;
  }

  /**
   * 开关"用钱顶一件"。
   *
   * ★ 清单空着时**不开**：那一件挑不出来，命令收到的开关会落空
   * （判据与按钮的 `disabled` 同源，见 `tradePickerHtml`）。
   *
   * ★★ 打开时**必须退掉多出来的那一件**：额度从三件缩到两件，
   * 而已经挑满三件的玩家会卡在一个"凑齐 3/2、按钮永远是灰的、又不知道要退哪一件"
   * 的死局里 —— 那正是 §4A 说的死按钮。退的顺序是**从后往前**
   * （`picks` 是 Map，顺序 = 玩家点选的顺序），即先退他最后挑的那一件。
   */
  private toggleCash(): void {
    if (!this.cashOn && this.picks.size === 0) return;
    this.cashOn = !this.cashOn;
    const need = this.needPieces();
    let picked = [...this.picks.values()].reduce((n, c) => n + c, 0);
    while (picked > need) {
      const keys = [...this.picks.keys()];
      const last = keys[keys.length - 1];
      if (last === undefined) break;
      const count = this.picks.get(last) ?? 1;
      picked -= count;
      this.picks.delete(last);
    }
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
  /**
   * ★★ 「先知日历上还剩下什么」—— 情报（§6.5 的第三种回报，D-13）。
   *
   * ## 为什么它长这样
   *
   * 情报买到的不是数字，是**消息**：日历上还没到的那些天的预告。
   * 所以这一块显示的是"**你已经知道哪几天**"，而不是"你有 3 条情报"——
   * 后者是一个抽象的库存，前者才是玩家真正拿到手的东西。
   *
   * ⚠ 还没揭开的天**不画空位**：画了就等于告诉他"这里还有几天"，
   * 而那本身也是情报。所以它只报已有的，不报缺的。
   */
  private intelHtml(run: RunState): string {
    const known = revealedForecasts(run).filter((f) => !f.past);
    if (known.length === 0) return '';
    const lines = known
      .map(
        (f) =>
          `<li class="intel-item"><b>${dayLabel(f.day)}</b><span>${escapeHtml(f.hint)}</span></li>`
      )
      .join('');
    return `
      <div class="intel-box">
        <p class="intel-title">你事先知道的</p>
        <ul class="intel-list">${lines}</ul>
      </div>
    `;
  }

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
    } else if (action === 'go-organize') {
      playSfx('place');
      this.props.onGoOrganize();
    } else if (action === 'next') {
      playSfx('preview');
      this.props.onNext();
    } else if (action === 'trade-cash') {
      playSfx('pick');
      this.toggleCash();
      this.refreshTrade();
    } else if (action === 'trade-confirm') {
      const picks = [...this.picks.entries()].map(([itemId, count]) => ({ itemId, count }));
      // 成交才清空草稿；被拒时留着，让玩家改一下再试，而不是从头挑一遍
      if (this.props.onTrade({ picks, cashOn: this.cashOn })) {
        this.picks.clear();
        this.cashOn = false;
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
  // ★ "撑过去，X 就过去了"里的 X 是**这一场**的名字（M4 决策 A）——
  //   写死"寒潮"在 116 场都能被抽到之后会当场撒谎，而这一句是最后一天的收尾
  if (day >= SURVIVAL_DAYS) return `最后一天了。撑过去，${disaster.name}就过去了。`;
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
 * ★★ 突发事件的**框**（2026-10 用户："把那些事件任务也弄得显眼一点，
 * 哪怕是不同的给个框也行啊，注意设计美学"）。
 *
 * ## 它补的是哪一笔账
 *
 * 在加框之前，一件突发事件与"消耗 主食 2"那类流水**长得一模一样** ——
 * 都只是 `run.log` 里的一行、或者正文里一段普通的话。
 * 而它是这一局里**最该被读到**的东西：它决定"你的整理有没有救到你"。
 * 更糟的是它可能整局都不出现（约三成日子），所以它一出现就必须被抓住。
 *
 * ## 三处设计上的讲究
 *
 *  ① **顶上那一行小字是"这是什么"**：`突发` / `已解决` / `未解决`。
 *     它让"今天有件特别的事"在读者扫一眼时就成立 —— 而在此之前，
 *     玩家要读完那两句才知道那是件事。
 *     ⚠ 措辞改过一版：原来是"接住了 / 没接住"，用户 2026-10 的反馈是
 *     **"这个用词太尴尬了"** —— 改成"已解决 / 未解决"（中性、也准：
 *     它说的就是"这件事解决了没有"，而不是"你手快不快"）；
 *  ② **框的形状分三档**（`is-resolved` / `is-hurt`）：
 *     已解决画**暖黄**（§5A 里"安全 / 窗内"那一档），
 *     未解决画**实心朱红左边**（朱红是警告那一档）。
 *     两档的颜色语义都是既有纪律里的，不是新发明的；
 *  ③ **零评测**（§5 引擎①）：框里只说"发生了什么、靠什么化解的"，
 *     不写"干得漂亮"，也不写"你该早点整理"。
 */
function emergencyHtml(last: SurvivalSnapshot): string {
  if (!last.emergencyId) return '';
  const def = findEmergency(last.emergencyId);
  if (!def) return '';
  const resolved = last.emergencyResolved;
  const body = resolved
    ? `${escapeHtml(def.text)}顺手位上有，用上了。`
    : `${escapeHtml(def.text)}${
        def.needOnHandy > 1
          ? `顺手位上不够 ${def.needOnHandy} 件${CATEGORY_LABELS[def.category]}。`
          : `顺手位上没有${CATEGORY_LABELS[def.category]}。`
      }`;
  return `
    <div class="event-frame is-emergency ${resolved ? 'is-resolved' : 'is-hurt'}">
      <span class="event-kind">${resolved ? '突发 · 已解决' : '突发 · 未解决'}</span>
      <p class="event-text">${body}</p>
    </div>
  `;
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

/**
 * 开着"用钱顶一件"而现金不够时的那一行说明（`cash` 是那一件今天的价钱）。
 *
 * ★ 与「加家具」同一条界面纪律（见 `OrganizeScreen.addFurnitureHtml` 的注释）：
 * **钱不够时不灰按钮，只说差多少** —— 玩家需要知道自己差多少，
 * 而不是面对一个点不动的按钮。命令层仍然会兜一道
 * （`tradeForBox` 那句"现金不够：这一件折 N 元，你还有 M 元"），
 * 但玩家不该靠点一下才知道。
 *
 * 价钱是 0（没挑东西 / 开关没开）时什么都不说 —— 那两件事由按钮自己的文案管。
 */
function cashNoteHtml(cash: number, wallet: number): string {
  if (cash <= 0 || cash <= wallet) return '';
  return `<p class="press-line is-cash-short">现金不够：这一件折 <b>${cash} 元</b>，你还有 <b>${wallet} 元</b>，还差 <b>${cash - wallet} 元</b>。</p>`;
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
