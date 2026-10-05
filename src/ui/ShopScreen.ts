/**
 * 囤货主界面（§9.2：地图点位列表 / 现金 / 负重 / 车载容量 / 剩余天数）。
 *
 * 分层纪律：只读 `buildCartView()` 的结果，写操作全部调用 systems/shop 的命令函数。
 *
 * 两个刻意的设计：
 *  1. **点位列表与货架同页**：点了点位就在同页展开货架，不做页面跳转 ——
 *     手机上少一次转场，就少一次"我刚才点哪了"的犹豫。
 *  2. **购物篮不落盘**：它在内存里。刷新丢掉购物篮、回到货架前，是 §4A 认可的行为
 *     （和"手里捏着的物资回到原位即可"同一条）。真正要活下来的是"我站在哪家店"，那个已经进存档。
 */
import { getIdentityDef } from '../data/identities';
import { findDayEvent } from '../data/dayEvents';
import { getItemDef } from '../data/items';
import { SHOP_DEFS, getShopDef } from '../data/shops';
import { playSfx } from '../fx/audio';
import { itemIconSvg } from '../fx/icons';
import { showToast } from '../fx/popup';
import { dayLabel, daysUntilDisaster } from '../model/calendar';
import type { DayEffectApplied } from '../model/types';
import type { GameStore } from '../state/store';
import {
  priceStressOf,
  buildCartView,
  buyCart,
  describeDayEffect,
  enterShop,
  findShopStock,
  leaveShop,
  purchaseLimitOf,
  resolveDayEvent,
  resolveDayOutcome,
  type ShopResult
} from '../systems/shop';
import { startNumbersOf } from '../systems/identity';
import { windowBandHtml } from './windowBand';
import type { Screen } from './Router';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「今天贵了多少」怎么画（铁则 §10.1A：只改数字的机制必须有非数字表达）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它补的是哪一笔账
 *
 * `priceSurcharge` 是 116 场灾难里 **90 场**都写了的那一维，从 M4 W-01 起真的生效了 ——
 * 而玩家看不到它：扫货页只报一个绝对价，**没有参照物**，"这一场物价贵 40%"
 * 在屏幕上等于不存在。用户的原话是"任何东西都要让我有感知"。
 *
 * ## 为什么是一个"斜纹条"而不是一个数字
 *
 * 数字（`贵 40%`）只有**读过才知道**，而这一屏玩家要在一堆商品之间**扫**。
 * 所以给三件东西：
 *
 *  · 一个**长度随涨幅变化的朱红斜纹条**（10% 一档，封顶 5 档）—— 扫一眼就知道哪件最贵；
 *  · 一个**箭头方向**（↑ 贵 / ↓ 便宜）—— 不用读数字就知道往哪边偏；
 *  · 数字本身（`贵 40%`）—— 想精确算账的人有得算。
 *
 * ★ 参照物写的是"**平常价**"（= 去掉灾难加成与事件加成之后的价），
 * 而不是"昨天"，因为 `dayPriceFactor` 是这一场逐日曲线的一部分、
 * 人人如此天天如此 —— 拿它当"贵了"的参照会让每一天都报"贵了"。
 */
/**
 * 涨幅 → 计量条的宽度（px）。
 *
 * ★★ 阶梯是**递增**的，不是等差的 —— 这一点改过一次：
 * 第一版写 `Math.ceil(percent / 10)` 封顶 5，于是"贵 200%"与"贵 300%"
 * **都是 `--stress:5`**，屏幕上一模一样。等差的读法只有在涨幅总是
 * 10~50% 时才成立，而实测这一场灾难的自然涨幅就有 233%（`flood_urban`）——
 * 也就是说**大多数时候玩家看到的都是封顶的那一档**，那个条等于没在报数。
 *
 * 换成递增阶梯之后：涨幅越大，条越长，而且长得多。封顶仍在（5 档 = 34px），
 * 因为"贵一倍"和"贵两倍"在**决策上**是同一件事（都不买），
 * 但在**观感上**必须不一样 —— 那正是这套东西存在的理由。
 */
const STRESS_PX = [4, 8, 14, 22, 34] as const;

function stressWidthOf(percent: number): number {
  const level = Math.min(STRESS_PX.length, Math.max(1, Math.ceil(Math.abs(percent) / 20)));
  return STRESS_PX[level - 1] as number;
}

function priceHtml(price: { base: number; percent: number }): string {
  if (price.percent === 0) return `${price.base} 元`;
  const up = price.percent > 0;
  return (
    `${price.base} 元` +
    `<span class="price-stress${up ? ' is-up' : ' is-down'}" style="--stress:${stressWidthOf(price.percent)}px"` +
    ` aria-label="比平常价${up ? '贵' : '便宜'} ${Math.abs(price.percent)}%">` +
    `<i class="price-meter" aria-hidden="true"></i>` +
    `<b>${up ? '↑' : '↓'}${up ? '贵' : '便宜'} ${Math.abs(price.percent)}%</b>` +
    `</span>`
  );
}

/** 店门口那个标记（参数是这家店**最贵那一件**的涨幅；≤0 则不画） */
function priceStressFlagHtml(peak: number): string {
  if (peak <= 0) return '';
  return (
    `<span class="shop-pricey" style="--stress:${stressWidthOf(peak)}px"` +
    ` aria-label="今天比平常贵 ${peak}%">今天贵 ${peak}%</span>`
  );
}

export interface ShopScreenProps {
  /** 回家整理（把 phase 推到 organize，由 systems/phases 的命令完成） */
  onGoHome: () => void;
}

export class ShopScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly props: ShopScreenProps;
  /** 购物篮：itemId → 件数（内存态，刻意不落盘） */
  private readonly cart = new Map<string, number>();
  private headEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private dockEl!: HTMLElement;
  private fxLayer!: HTMLElement;

  constructor(root: HTMLElement, store: GameStore, props: ShopScreenProps) {
    this.root = root;
    this.store = store;
    this.props = props;
  }

  mount(): void {
    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar" data-head></header>
        ${windowBandHtml(this.store.run)}
        <main class="scroll" data-main></main>
        <footer class="dock" data-dock></footer>
      </div>
      <div class="fx-layer" data-fx></div>
    `;
    this.headEl = this.query('[data-head]');
    this.mainEl = this.query('[data-main]');
    this.dockEl = this.query('[data-dock]');
    this.fxLayer = this.query('[data-fx]');
    this.root.addEventListener('click', this.onClickBound);
    this.render();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClickBound);
  }

  render(): void {
    const scrollTop = this.mainEl.scrollTop;
    this.renderHead();
    this.renderMain();
    this.renderDock();
    this.mainEl.scrollTop = scrollTop;
  }

  // ———————— 顶栏：三约束实时可见 ————————

  private renderHead(): void {
    const run = this.store.run;
    const identity = run.identityId ? getIdentityDef(run.identityId) : null;
    /*
     * ★ §10B.3：容量要**含熟练度加成**，而这一句以前直接读 `identity.vehicleCapacity`。
     *
     * 现在两处都走 `startNumbersOf(meta, id)` —— 与 `buildCartView`（命令层）
     * 用的**同一个换算点**。两边各算一份的话，会出现"顶栏说还能装 20kg、
     * 结账说只能装 18kg"这种最难查的账（本项目在限购那一处吃过同一个亏）。
     */
    const capacity = identity ? startNumbersOf(this.store.save.meta, identity.id).vehicleCapacity : 0;
    const fill = capacity > 0 ? Math.min(1, run.carLoad / capacity) : 0;
    const left = daysUntilDisaster(run.day);

    this.headEl.innerHTML = `
      <div class="topbar-row">
        <div class="title">
          <h1>外出扫货</h1>
          <p class="sub">
            ${dayLabel(run.day)} · 离灾难还有 ${left} 天 · 行动点 ${run.actionPoints}
          </p>
        </div>
        <div class="topbar-tools">
          <span class="pill">现金 <b>${run.cash}</b></span>
        </div>
      </div>
      <div class="loadbar">
        <span class="loadbar-fill" style="--fill:${fill}"></span>
        <span class="loadbar-text">车里 ${run.carLoad} / ${capacity} kg</span>
      </div>
    `;
  }

  // ———————— 主区：点位列表 or 货架 ————————

  private renderMain(): void {
    const run = this.store.run;
    /*
     * ★★ 门口那件事现在是**一张卡片**，不再独占整屏 —— 货架照常画在下面。
     *
     * ## 用户的原话（2026-10 走测）
     *
     * > "有的时候事件会导致不能进商店，耽误我买东西……本来行动点就宝贵，
     * >  调整一下，事件发生也不影响正常采购"
     *
     * 原来是 `if (event) { 画事件; return; }` —— 事件把货架整个顶掉了，
     * 玩家必须处理完再重新进一次店。而行动点是这一局最贵的资源
     * （§6.2 的三约束之一），"重进一次"等于白扣一点。
     *
     * ⚠ 这不是"把事件做小一点"，是**改掉一个错误的假设**：
     * 原来那句注释写的是"它发生在门口，所以这一屏先只讲那件事" ——
     * 而"门口那件事"与"进店买东西"本来就是**可以同时成立**的两件事。
     * 两段式（先看事件、再看后果）仍然保留，只是不再占用整屏。
     */
    const event = run.dayEvent;
    const banner =
      event && run.currentShopId && findDayEvent(event.defId)
        ? this.dayEventHtml(findDayEvent(event.defId), event.choice, event.applied)
        : '';
    this.mainEl.innerHTML = banner + (run.currentShopId ? this.goodsHtml(run.currentShopId) : this.shopListHtml());
  }

  /**
   * 门口那件事（**卡片**）。
   *
   * 两段式与夜间一致：先给选项，选完再看后果。
   * 但它不再独占整屏 —— 见 `renderMain` 的注释。
   */
  private dayEventHtml(def: ReturnType<typeof findDayEvent>, choice: number | null, applied: DayEffectApplied | null): string {
    if (!def) return '';
    const decided = choice !== null;
    const option = decided ? def.options[choice as number] : null;
    const summary = applied ? describeDayEffect(applied) : [];
    return `
      <section class="block event-card">
        <p class="event-card-tag">门口那件事</p>
        <p class="night-text">${escapeHtml(def.text)}</p>
        ${
          decided && option && applied
            ? `<p class="night-outcome">${escapeHtml(resolveDayOutcome(option, applied))}</p>
               ${
                 summary.length > 0
                   ? `<div class="night-deltas">${summary
                       .map((text) => `<span class="delta">${escapeHtml(text)}</span>`)
                       .join('')}</div>`
                   : ''
               }
               ${this.lootHtml(applied)}
               ${applied.visitLost ? '<p class="block-note">这一趟到此为止。</p>' : ''}`
            : decided
              ? '<p class="block-note">这件事已经过去了。</p>'
              : `<div class="night-options">${def.options
                  .map((opt, index) => {
                    const cost = Math.max(0, -(opt.effect.cash ?? 0));
                    const blocked = Boolean(opt.requireFullCash) && cost > this.store.run.cash;
                    return `<button class="night-option" data-day-choice="${index}"${blocked ? ' disabled' : ''}>
                      <b>${escapeHtml(opt.label)}</b>
                      ${blocked ? `<em class="night-option-note">还差 ${cost - this.store.run.cash} 元</em>` : ''}
                    </button>`;
                  })
                  .join('')}</div>`
        }
      </section>
    `;
  }

  /**
   * 「这趟到底到没到手」—— 玩家当场问出来的那一行。
   *
   * 原来的反馈只有一个「货架少了 4 件」的标签，而那是**商店**的账；
   * 玩家的原话是"我抢了东西买了东西……家里的东西并没有增长啊"。
   * 抢回来的货现在真的进待拆队列了（`grab`），所以这里要把**具体到手的件数**
   * 摊在屏幕上：没到手就明说"这趟什么也没拿到"，到手了就报件数 ——
   * 一句"拿到了 2 件"比四个数值标签都管用。
   */
  private lootHtml(applied: DayEffectApplied): string {
    const pieces = applied.grabbed.reduce((n, g) => n + g.count, 0);
    const atHome = this.store.run.boxesToUnpack.length;
    if (pieces > 0) {
      return `<p class="block-note warm">这 ${pieces} 件已经在待拆箱里了（现在 ${atHome} 箱），回家就能拆。</p>`;
    }
    if (applied.gotBox) {
      return `<p class="block-note warm">${escapeHtml(applied.boxName)}已经在待拆箱里了（现在 ${atHome} 箱）。</p>`;
    }
    if (applied.visitLost) return '';
    return '<p class="block-note">这一趟没拿到货。</p>';
  }

  private shopListHtml(): string {
    const run = this.store.run;
    const cards = SHOP_DEFS.map((shop) => {
      const visited = run.visitedShopIds.includes(shop.id);
      const stock = findShopStock(run, shop.id);
      const left = stock ? stock.lines.filter((l) => l.stock > 0).length : 0;
      const total = stock ? stock.lines.length : shop.offers.length;
      /*
       * ★★ 进店**之前**就要看得见"今天这家贵"（铁则：只改数字的机制必须有非数字表达）。
       *
       * 用户口径是"任何东西都要让我有感知"，而"哪家贵"这件事如果只在店里才看得见，
       * 玩家就已经把行动点花掉了 —— 那时知道也晚了。所以卡片上给一个**朱红斜纹标记**。
       */
      const peak = stock
        ? Math.max(0, ...stock.lines.map((l) => priceStressOf(run, l).percent))
        : 0;
      const flag = priceStressFlagHtml(peak);
      return `
        <button class="shop-card${visited ? ' is-visited' : ''}${peak > 0 ? ' is-pricey' : ''}" data-shop="${shop.id}"
          aria-label="去${shop.name}，${left} 种有货${peak > 0 ? `，今天比平常贵 ${peak}%` : ''}">
          <span class="shop-card-head">
            <span class="shop-name">${escapeHtml(shop.name)}</span>
            ${flag}
            ${visited ? '<span class="shop-flag">今天去过</span>' : ''}
          </span>
          <span class="shop-blurb">${escapeHtml(shop.blurb)}</span>
          <span class="shop-meta">${left === 0 ? '今天什么都卖完了' : `还有 ${left} / ${total} 种有货`}</span>
        </button>
      `;
    }).join('');

    return `
      <section class="block">
        <h2 class="block-title">今天去哪</h2>
        <div class="shop-list">${cards}</div>
      </section>
    `;
  }

  private goodsHtml(shopId: string): string {
    const run = this.store.run;
    const shop = getShopDef(shopId);
    const stock = findShopStock(run, shopId);
    if (!stock) return '<section class="block"><p class="block-note">这家店今天没开门。</p></section>';

    const rows = stock.lines
      .map((line) => {
        const item = getItemDef(line.itemId);
        const count = this.cart.get(line.itemId) ?? 0;
        // 限购只影响"还能加几件"，不改库存本身 —— 库存是"店里还剩多少"，
        // 限购是"今天最多卖你几件"，两件事分开显示，玩家才对得上账
        const limit = purchaseLimitOf(run, shopId, line.itemId);
        const available = Number.isFinite(limit) ? Math.min(line.stock, limit) : line.stock;
        const soldOut = available <= 0;
        const capped = Number.isFinite(limit) && limit < line.stock;
        const price = priceStressOf(run, line);
        return `
          <li class="good${soldOut ? ' is-out' : ''}">
            <span class="good-icon">${itemIconSvg(item.icon)}</span>
            <span class="good-text">
              <b>${escapeHtml(item.name)}</b>
              <em>${priceHtml(price)} · ${item.unitWeight}kg · ${
                soldOut
                  ? capped
                    ? '限购买满了'
                    : '卖完了'
                  : capped
                    ? `限购，还能买 ${available}`
                    : `剩 ${line.stock}`
              }</em>
            </span>
            <span class="stepper">
              <button class="step" data-action="dec" data-item="${line.itemId}" aria-label="少一件" ${count <= 0 ? 'disabled' : ''}>−</button>
              <b class="step-count">${count}</b>
              <button class="step" data-action="inc" data-item="${line.itemId}" aria-label="多一件" ${soldOut || count >= available ? 'disabled' : ''}>+</button>
            </span>
          </li>
        `;
      })
      .join('');

    return `
      <section class="block">
        <div class="block-head">
          <h2 class="block-title">${escapeHtml(shop.name)}</h2>
          <button class="mini" data-action="back">换一家</button>
        </div>
        <p class="block-note">${escapeHtml(shop.blurb)}</p>
        <ul class="goods">${rows}</ul>
      </section>
    `;
  }

  // ———————— 底栏：购物车与三约束体检 ————————

  private renderDock(): void {
    const run = this.store.run;
    const shopId = run.currentShopId;
    // 门口有事的时候底栏只剩两条路：「回家整理」与（选完之后）「换一家」。
    // 购物车这时候是空的，不该出现 —— 一个点不动的按钮比没有按钮更糟
    if (run.dayEvent) {
      const decided = run.dayEvent.choice !== null;
      this.dockEl.innerHTML = `
        <div class="dock-tools">
          ${
            decided
              ? `<button class="btn btn-primary" data-action="back">换一家</button>`
              : `<button class="btn" data-action="leave-event">先不进去</button>`
          }
          <button class="btn" data-action="home">回家整理</button>
        </div>
      `;
      return;
    }
    if (!shopId) {
      this.dockEl.innerHTML = `
        <div class="dock-tools">
          <button class="btn btn-primary" data-action="home">回家整理</button>
        </div>
      `;
      return;
    }

    const view = buildCartView(run, shopId, this.cartLines());
    if (!view) {
      this.dockEl.innerHTML = `
        <div class="dock-tools">
          <button class="btn btn-primary" data-action="home">回家整理</button>
        </div>
      `;
      return;
    }

    const problem = view.problems[0];
    const note = view.notes[0];
    this.dockEl.innerHTML = `
      <div class="cart-bar">
        <div class="cart-sum">
          <b>购物篮 ${view.pieces} 件</b>
          <em>${view.cost} 元 · ${view.weight}kg / 一趟上限 ${view.carryLimit}kg</em>
        </div>
      </div>
      ${
        problem
          ? `<p class="cart-line is-problem">${escapeHtml(problem)}</p>`
          : note
            ? `<p class="cart-line">${escapeHtml(note)}</p>`
            : `<p class="cart-line">还能再装 ${roundLeft(view.capacityLeft, view.weight)}kg 上车</p>`
      }
      <div class="dock-tools">
        <button class="btn btn-primary" data-action="load" ${view.canLoad ? '' : 'disabled'}>搬回车上</button>
        <button class="btn" data-action="home">回家整理</button>
      </div>
    `;
  }

  // ———————— 交互 ————————

  private readonly onClickBound = (e: MouseEvent): void => this.onClick(e);

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('button[disabled]')) return;

    const shopCard = target.closest<HTMLElement>('[data-shop]');
    if (shopCard) {
      const shopId = shopCard.dataset['shop'];
      if (shopId) {
        this.cart.clear();
        this.consume(enterShop(this.store, shopId));
      }
      return;
    }

    const hit = target.closest<HTMLElement>('[data-action]');
    const dayChoice = target.closest<HTMLElement>('[data-day-choice]');
    if (dayChoice) {
      const index = Number(dayChoice.dataset['dayChoice']);
      if (!Number.isInteger(index)) return;
      this.cart.clear();
      this.consume(resolveDayEvent(this.store, index));
      return;
    }
    if (!hit) return;
    switch (hit.dataset['action']) {
      case 'inc':
        this.stepItem(hit.dataset['item'], 1);
        return;
      case 'dec':
        this.stepItem(hit.dataset['item'], -1);
        return;
      case 'back':
        this.cart.clear();
        this.consume(leaveShop(this.store));
        return;
      case 'leave-event':
        // "先不进去"：不处理那件事，直接退回点位列表（行动点照扣，那是进门的价钱）
        this.cart.clear();
        this.consume(leaveShop(this.store));
        return;
      case 'load': {
        const shopId = this.store.run.currentShopId;
        if (!shopId) return;
        const result = buyCart(this.store, shopId, this.cartLines());
        if (result.ok) this.cart.clear();
        this.consume(result);
        return;
      }
      case 'home':
        this.props.onGoHome();
        return;
      default:
        return;
    }
  }

  private stepItem(itemId: string | undefined, delta: number): void {
    const shopId = this.store.run.currentShopId;
    if (!itemId || !shopId) return;
    const stock = findShopStock(this.store.run, shopId)?.lines.find((l) => l.itemId === itemId);
    if (!stock) return;
    const next = Math.max(0, Math.min(stock.stock, (this.cart.get(itemId) ?? 0) + delta));
    if (next === 0) this.cart.delete(itemId);
    else this.cart.set(itemId, next);
    playSfx('preview');
    this.render();
  }

  private cartLines(): { itemId: string; count: number }[] {
    return [...this.cart.entries()].map(([itemId, count]) => ({ itemId, count }));
  }

  private consume(result: ShopResult): void {
    for (const ev of result.events) {
      switch (ev.type) {
        case 'rejected':
          playSfx('reject');
          showToast(this.fxLayer, ev.reason, 'warn');
          break;
        case 'enteredShop':
        case 'leftShop':
          playSfx('pick');
          break;
        case 'loaded':
          playSfx('place');
          showToast(this.fxLayer, `${ev.boxName} · ${ev.pieces} 件 ${ev.weight}kg 已搬上车`);
          break;
        case 'dayEventHit':
          // 门口那件事的表现交给这一屏自己（它要在同一屏里把处境读完），
          // 这里只补一个"有事了"的听觉提示
          playSfx('preview');
          break;
        case 'dayEventResolved':
          if (ev.visitLost) {
            playSfx('reject');
            showToast(this.fxLayer, '这趟白跑了', 'warn');
          } else {
            playSfx('pick');
          }
          break;
      }
    }
    this.render();
  }

  private query<T extends HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`缺少必需节点：${selector}`);
    return el;
  }
}

function roundLeft(capacityLeft: number, weight: number): number {
  return Math.round(Math.max(0, capacityLeft - weight) * 100) / 100;
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
