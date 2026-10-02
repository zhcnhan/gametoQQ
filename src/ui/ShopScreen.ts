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
  basePriceOf,
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
import type { Screen } from './Router';

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
    const capacity = identity ? identity.vehicleCapacity : 0;
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
    // 白天事件优先：它发生在**门口**，所以这一屏先只讲那件事，货架等处理完再画。
    // 与夜间事件同一个两段式 —— 玩家必须看得见后果，也需要一条"不参与"的路。
    const event = run.dayEvent;
    if (event && run.currentShopId) {
      const def = findDayEvent(event.defId);
      if (def) {
        this.mainEl.innerHTML = this.dayEventHtml(def, event.choice, event.applied);
        return;
      }
    }
    this.mainEl.innerHTML = run.currentShopId ? this.goodsHtml(run.currentShopId) : this.shopListHtml();
  }

  /**
   * 门口那件事。两段式与夜间一致：先只给选项（不看货架），
   * 选完再看后果 —— 然后把出口交给「换一家」或底部那条"回家整理"。
   *
   * 数值摘要读的是**实际生效值**（`event.applied`），不是选项声明的数：
   * 兜里只有 25 元的人点了"递包烟"，屏幕上必须写 25。
   */
  private dayEventHtml(def: ReturnType<typeof findDayEvent>, choice: number | null, applied: DayEffectApplied | null): string {
    if (!def) return '';
    const decided = choice !== null;
    const option = decided ? def.options[choice as number] : null;
    const summary = applied ? describeDayEffect(applied) : [];
    return `
      <section class="block">
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
      return `
        <button class="shop-card${visited ? ' is-visited' : ''}" data-shop="${shop.id}"
          aria-label="去${shop.name}，${left} 种有货">
          <span class="shop-card-head">
            <span class="shop-name">${escapeHtml(shop.name)}</span>
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
        return `
          <li class="good${soldOut ? ' is-out' : ''}">
            <span class="good-icon">${itemIconSvg(item.icon)}</span>
            <span class="good-text">
              <b>${escapeHtml(item.name)}</b>
              <em>${basePriceOf(run, line)} 元 · ${item.unitWeight}kg · ${
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
