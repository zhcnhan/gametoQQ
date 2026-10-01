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
import { getItemDef } from '../data/items';
import { SHOP_DEFS, getShopDef } from '../data/shops';
import { playSfx } from '../fx/audio';
import { itemIconSvg } from '../fx/icons';
import { showToast } from '../fx/popup';
import { dayLabel, daysUntilDisaster } from '../model/calendar';
import type { GameStore } from '../state/store';
import {
  buildCartView,
  buyCart,
  enterShop,
  findShopStock,
  leaveShop,
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
    const shopId = this.store.run.currentShopId;
    this.mainEl.innerHTML = shopId ? this.goodsHtml(shopId) : this.shopListHtml();
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
    const shop = getShopDef(shopId);
    const stock = findShopStock(this.store.run, shopId);
    if (!stock) return '<section class="block"><p class="block-note">这家店今天没开门。</p></section>';

    const rows = stock.lines
      .map((line) => {
        const item = getItemDef(line.itemId);
        const count = this.cart.get(line.itemId) ?? 0;
        const soldOut = line.stock <= 0;
        return `
          <li class="good${soldOut ? ' is-out' : ''}">
            <span class="good-icon">${itemIconSvg(item.icon)}</span>
            <span class="good-text">
              <b>${escapeHtml(item.name)}</b>
              <em>${line.price} 元 · ${item.unitWeight}kg · ${soldOut ? '卖完了' : `剩 ${line.stock}`}</em>
            </span>
            <span class="stepper">
              <button class="step" data-action="dec" data-item="${line.itemId}" aria-label="少一件" ${count <= 0 ? 'disabled' : ''}>−</button>
              <b class="step-count">${count}</b>
              <button class="step" data-action="inc" data-item="${line.itemId}" aria-label="多一件" ${soldOut || count >= line.stock ? 'disabled' : ''}>+</button>
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
