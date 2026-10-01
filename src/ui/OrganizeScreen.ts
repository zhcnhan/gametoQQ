/**
 * 整理界面（M0 唯一界面）。
 *
 * 分层纪律：本文件**只读** buildView() 的结果；写操作一律调用 systems/organize 的命令函数，
 * 命令返回的 OrganizeEvent 才是表现层的输入（音效 / 拟声字 / 压扁动画）。
 */
import { getItemDef } from '../data/items';
import { initAudio, isMuted, playSfx, setMuted } from '../fx/audio';
import { iconSvg, itemIconSvg } from '../fx/icons';
import { showToast, spawnCrushGhost, spawnSfxWord, spawnTidyTag } from '../fx/popup';
import { getStack, stackCount } from '../model/shelf';
import type { ItemStack, Shelf, SlotPos } from '../model/types';
import type { GameStore } from '../state/store';
import {
  applyZone,
  assignZone,
  buildView,
  deleteZone,
  inventoryTotals,
  placeHeld,
  pickupFromShelf,
  returnHeld,
  sortAllByFEFO,
  takeFromBox,
  tapSlot,
  type CommandResult,
  type OrganizeSession,
  type OrganizeView,
  type ZoneInput
} from '../systems/organize';
import { attachLongPress, attachPointerGesture } from './drag';
import { expiryText, isExpiringSoon, shelfLabel, stackLabel } from './labels';
import { ZoneSheet } from './zoneSheet';

export interface OrganizeScreenProps {
  /** 重开一局（由 main 负责换一份 RunState） */
  onRestart: () => void;
}

interface DragState {
  active: boolean;
  source: 'shelf' | 'box' | 'hand';
}

export class OrganizeScreen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly session: OrganizeSession;
  private readonly props: OrganizeScreenProps;

  private roomEl!: HTMLElement;
  private dockEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private subEl!: HTMLElement;
  private fxLayer!: HTMLElement;
  private sheet!: ZoneSheet;

  /** 刚放下的格子：重绘后给它一个"接住"的小动画 */
  private pendingFocus: { shelfId: string; pos: SlotPos } | null = null;
  private hoverEl: HTMLElement | null = null;
  private ghost: HTMLElement | null = null;
  private drag: DragState = { active: false, source: 'shelf' };

  constructor(root: HTMLElement, store: GameStore, session: OrganizeSession, props: OrganizeScreenProps) {
    this.root = root;
    this.store = store;
    this.session = session;
    this.props = props;
  }

  mount(): void {
    this.root.innerHTML = `
      <div class="screen">
        <header class="topbar">
          <div class="title">
            <h1>囤货台账</h1>
            <p class="sub" data-sub></p>
          </div>
          <div class="score" data-score></div>
        </header>
        <main class="room-scroll" data-room></main>
        <footer class="dock">
          <div class="dock-hand" data-hand data-drop="return"></div>
          <div class="dock-boxes" data-boxes></div>
          <div class="dock-tools">
            <button class="btn" data-action="sort">${iconSvg('sort')}<span>按保质期排</span></button>
            <button class="btn" data-action="mute"><span data-mute-label>静音</span></button>
            <button class="btn btn-quiet" data-action="restart">重开一局</button>
          </div>
        </footer>
      </div>
      <div class="fx-layer" data-fx></div>
    `;

    this.roomEl = this.query('[data-room]');
    this.dockEl = this.query('.dock');
    this.scoreEl = this.query('[data-score]');
    this.subEl = this.query('[data-sub]');
    this.fxLayer = this.query('[data-fx]');

    const sheetEl = document.createElement('div');
    this.root.appendChild(sheetEl);
    this.sheet = new ZoneSheet(sheetEl, {
      getShelves: () => this.store.run.shelves,
      getZones: () => this.store.run.zones,
      apply: (shelfId: string, input: ZoneInput) => this.consume(applyZone(this.store, shelfId, input)),
      assign: (shelfId: string, zoneId: string | null) => this.consume(assignZone(this.store, shelfId, zoneId)),
      removeZone: (zoneId: string) => this.consume(deleteZone(this.store, zoneId))
    });

    // 只挂一个委托监听（顶栏指标卡 / 货架按钮 / 底部工具都从这里走），少一层心智负担
    this.root.addEventListener('click', (e) => this.onDelegatedClick(e));

    this.render();
  }

  render(): void {
    const view = buildView(this.store, this.session);
    this.renderSub(view);
    this.renderScore(view);
    this.renderRoom(view);
    this.renderDock(view);
    this.applyFocus();
    this.sheet.refresh();
  }

  // ———————— 渲染 ————————

  private renderSub(view: OrganizeView): void {
    const totals = inventoryTotals(this.store.run);
    const boxes = view.boxes.length;
    this.subEl.textContent = `第 ${this.store.run.day} 天 · 整理中 · 待拆 ${boxes} 箱 · 在库 ${totals.pieces} 件`;
  }

  private renderScore(view: OrganizeView): void {
    const p = Math.round(view.score.placement * 100);
    const f = Math.round(view.score.fefo * 100);
    const capacity = this.store.run.shelves.reduce((n, s) => n + s.w * s.h, 0);
    // 全中文台账。术语解释放 title（鼠标）＋点一下弹提示（手机没 hover，只能点）
    this.scoreEl.innerHTML = `
      <button class="score-item" data-action="explain" data-explain="归位率：物资有没有放在它自己那块分区里" title="物资有没有放在它自己那块分区里">
        <i>归位率</i><b>${p}%</b>
      </button>
      <button class="score-item" data-action="explain" data-explain="临期优先：同架按到期日排好没有 —— 越快到期的越靠前，也越先被用掉" title="同架按到期日排好没有：越快到期的越靠前，也越先被用掉">
        <i>临期优先</i><b>${f}%</b>
      </button>
      <button class="score-item" data-action="explain" data-explain="已上架：占了 ${view.score.stacks} 个格子，全房间一共 ${capacity} 格" title="已占用 ${view.score.stacks} 个格子，全房间共 ${capacity} 格">
        <i>已上架</i><b>${view.score.stacks}</b>
      </button>
    `;
  }

  private renderRoom(view: OrganizeView): void {
    const scrollTop = this.roomEl.scrollTop;
    this.roomEl.innerHTML = view.shelves
      .map((shelf, index) => this.shelfHtml(shelf, index, view))
      .join('');
    this.roomEl.scrollTop = scrollTop;
    this.bindRoomGestures();
  }

  private shelfHtml(shelf: Shelf, index: number, view: OrganizeView): string {
    const zone = view.zones.find((z) => z.id === shelf.zoneId) ?? null;
    const tidy = view.tidyShelfIds.includes(shelf.id);
    const cells: string[] = [];
    for (let row = 0; row < shelf.h; row++) {
      for (let col = 0; col < shelf.w; col++) {
        const stack = getStack(shelf, { row, col });
        cells.push(this.slotHtml(shelf.id, { row, col }, stack));
      }
    }
    return `
      <section class="shelf-card" data-shelf-card="${shelf.id}" style="--zone:${zone?.color ?? 'transparent'}">
        <div class="shelf-head">
          <span class="zone-tape"></span>
          <h2 class="shelf-title" data-shelf-title data-shelf="${shelf.id}">
            ${shelfLabel(shelf, index)}
            <em class="zone-name${zone ? '' : ' is-none'}">${zone ? escapeHtml(zone.name) : '未分区'}</em>
          </h2>
          ${tidy ? '<span class="tidy-badge">整整齐齐</span>' : ''}
          <button class="mini" data-action="edit-zone" data-shelf="${shelf.id}">分区</button>
        </div>
        <div class="shelf-grid" style="--cols:${shelf.w}">${cells.join('')}</div>
      </section>
    `;
  }

  private slotHtml(shelfId: string, pos: SlotPos, stack: ItemStack | null): string {
    const attrs = `data-slot data-shelf="${shelfId}" data-row="${pos.row}" data-col="${pos.col}"`;
    if (!stack) return `<button class="slot is-empty" ${attrs} aria-label="空格"></button>`;
    const def = getItemDef(stack.itemId);
    const count = stackCount(stack);
    const soon = isExpiringSoon(stack);
    const label = `${stackLabel(stack)}，${expiryText(stack)}`;
    return `<button class="slot${soon ? ' is-soon' : ''}" ${attrs} aria-label="${label}" title="${label}">
      <span class="slot-icon">${itemIconSvg(def.icon)}</span>
      ${count > 1 ? `<span class="slot-count">×${count}</span>` : ''}
      ${soon ? `<span class="slot-soon" aria-hidden="true"></span>` : ''}
    </button>`;
  }

  private renderDock(view: OrganizeView): void {
    const hand = view.held;
    const handHtml = hand
      ? `<div class="hand-item">
           <span class="hand-icon">${itemIconSvg(getItemDef(hand.itemId).icon)}</span>
           <span class="hand-text">${escapeHtml(stackLabel(hand))}<em>${escapeHtml(expiryText(hand))}</em></span>
         </div>
         <button class="mini" data-action="return">放回</button>`
      : `<div class="hand-item"><span class="hand-icon is-empty">${iconSvg('hand')}</span><span class="hand-text">空手<em>点纸箱拆箱，点格子放置</em></span></div>`;

    const boxes = view.boxes
      .map((box) => {
        const def = box.top ? getItemDef(box.top.itemId) : null;
        const isEmpty = box.items.length === 0;
        return `<button class="box${isEmpty ? ' is-empty' : ''}" data-box="${box.id}" data-drop="box" aria-label="${escapeHtml(box.name)}，还有 ${box.total} 件">
          <span class="box-icon">${iconSvg('box')}</span>
          <span class="box-name">${escapeHtml(box.name)}</span>
          <span class="box-count">${box.total} 件</span>
          ${def ? `<span class="box-peek">${itemIconSvg(def.icon)}</span>` : ''}
        </button>`;
      })
      .join('');

    this.dockEl.querySelector('[data-hand]')?.classList.toggle('has-item', hand !== null);
    const handHost = this.dockEl.querySelector('[data-hand]');
    if (handHost) handHost.innerHTML = handHtml;
    const boxHost = this.dockEl.querySelector('[data-boxes]');
    if (boxHost) {
      boxHost.innerHTML = boxes || '<p class="box-empty-hint">箱子都拆完了。货架归你管。</p>';
      this.bindBoxGestures();
    }
  }

  // ———————— 手势绑定 ————————

  private bindRoomGestures(): void {
    this.roomEl.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
      const shelfId = el.dataset['shelf'];
      const row = Number(el.dataset['row']);
      const col = Number(el.dataset['col']);
      if (!shelfId) return;
      const pos: SlotPos = { row, col };
      attachPointerGesture(el, {
        onTap: () => this.consume(tapSlot(this.store, this.session, shelfId, pos)),
        onDragStart: () => {
          if (!this.session.held) this.consume(pickupFromShelf(this.store, this.session, shelfId, pos));
          this.beginDrag('shelf');
        },
        onDragMove: (point) => this.moveDrag(point),
        onDragEnd: (point) => this.endDrag(point)
      });
    });

    this.roomEl.querySelectorAll<HTMLElement>('[data-shelf-title]').forEach((el) => {
      const shelfId = el.dataset['shelf'];
      if (!shelfId) return;
      // §6.3：长按货架标题进入分区编辑（也保留了右上角的"分区"按钮，鼠标党不用长按）
      attachLongPress(el, () => this.sheet.open(shelfId));
    });
  }

  private bindBoxGestures(): void {
    this.dockEl.querySelectorAll<HTMLElement>('[data-box]').forEach((el) => {
      const boxId = el.dataset['box'];
      if (!boxId) return;
      attachPointerGesture(el, {
        onTap: () => this.consume(takeFromBox(this.store, this.session, boxId)),
        onDragStart: () => {
          if (!this.session.held) this.consume(takeFromBox(this.store, this.session, boxId));
          this.beginDrag('box');
        },
        onDragMove: (point) => this.moveDrag(point),
        onDragEnd: (point) => this.endDrag(point)
      });
    });
  }

  private onDelegatedClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    initAudio();
    const hit = target.closest<HTMLElement>('[data-action]');
    if (!hit) return;
    const action = hit.dataset['action'];
    const shelfId = hit.dataset['shelf'];
    switch (action) {
      case 'explain':
        showToast(this.fxLayer, hit.dataset['explain'] ?? '', 'ink');
        return;
      case 'edit-zone':
        if (shelfId) this.sheet.open(shelfId);
        return;
      case 'sort':
        this.consume(sortAllByFEFO(this.store, this.session));
        return;
      case 'return':
        this.consume(returnHeld(this.store, this.session));
        return;
      case 'mute': {
        setMuted(!isMuted());
        const label = this.dockEl.querySelector('[data-mute-label]');
        if (label) label.textContent = isMuted() ? '已静音' : '静音';
        return;
      }
      case 'restart':
        if (window.confirm('重开一局会清空当前这一间仓库，确定吗？')) this.props.onRestart();
        return;
      default:
        return;
    }
  }

  // ———————— 拖拽 ————————

  private beginDrag(source: DragState['source']): void {
    if (!this.session.held) return;
    this.drag = { active: true, source };
    const el = document.createElement('div');
    el.className = 'drag-ghost';
    const held = this.session.held;
    el.innerHTML = `${itemIconSvg(getItemDef(held.itemId).icon)}<span class="ghost-count">×${stackCount(held)}</span>`;
    this.fxLayer.appendChild(el);
    this.ghost = el;
  }

  private moveDrag(point: { x: number; y: number }): void {
    if (!this.drag.active) return;
    if (this.ghost) {
      this.ghost.style.left = `${point.x}px`;
      this.ghost.style.top = `${point.y}px`;
    }
    const slot = this.pickDropSlot(point);
    if (slot === this.hoverEl) return;
    this.clearHover();
    if (slot) {
      this.hoverEl = slot;
      const shelfId = slot.dataset['shelf'];
      const row = Number(slot.dataset['row']);
      const col = Number(slot.dataset['col']);
      const stack = shelfId ? getStack(this.shelfById(shelfId), { row, col }) : null;
      const sameItem = stack && this.session.held && stack.itemId === this.session.held.itemId;
      slot.classList.add(stack && !sameItem ? 'is-hover-swap' : 'is-hover');
      playSfx('preview');
    }
  }

  private endDrag(point: { x: number; y: number }): void {
    const wasActive = this.drag.active;
    const slot = this.hoverEl ?? this.pickDropSlot(point);
    this.endGhost();
    if (!wasActive || !this.session.held) {
      this.drag = { active: false, source: 'shelf' };
      return;
    }
    this.drag = { active: false, source: 'shelf' };

    if (slot) {
      const shelfId = slot.dataset['shelf'];
      const row = Number(slot.dataset['row']);
      const col = Number(slot.dataset['col']);
      if (shelfId) {
        this.consume(placeHeld(this.store, this.session, shelfId, { row, col }));
        return;
      }
    }
    const el = document.elementFromPoint(point.x, point.y);
    if (el instanceof HTMLElement && el.closest('[data-drop="return"]')) {
      this.consume(returnHeld(this.store, this.session));
      return;
    }
    // 丢在空地：留在手里，玩家可以再点一个格子放下去（点选-点放永远兜底）
    this.render();
  }

  private endGhost(): void {
    this.ghost?.remove();
    this.ghost = null;
    this.clearHover();
  }

  private clearHover(): void {
    if (this.hoverEl) {
      this.hoverEl.classList.remove('is-hover', 'is-hover-swap');
      this.hoverEl = null;
    }
  }

  /**
   * 吸附预览：优先用指针底下的格子；如果那格放不下（被别的物资占了），
   * 就找同架离指针最近的空格高亮 —— 这就是 §5 引擎②"拖到货架附近自动吸附"。
   */
  private pickDropSlot(point: { x: number; y: number }): HTMLElement | null {
    const el = document.elementFromPoint(point.x, point.y);
    if (!(el instanceof HTMLElement)) return null;
    const slot = el.closest<HTMLElement>('[data-slot]');
    if (!slot) return null;
    const held = this.session.held;
    if (!held) return slot;
    const shelfId = slot.dataset['shelf'];
    const row = Number(slot.dataset['row']);
    const col = Number(slot.dataset['col']);
    if (!shelfId) return null;
    const stack = getStack(this.shelfById(shelfId), { row, col });
    if (stack && stack.itemId !== held.itemId) {
      return this.nearestEmptySlot(shelfId, point) ?? slot;
    }
    return slot;
  }

  private nearestEmptySlot(shelfId: string, point: { x: number; y: number }): HTMLElement | null {
    const shelf = this.shelfById(shelfId);
    let best: HTMLElement | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    this.roomEl
      .querySelectorAll<HTMLElement>(`[data-slot][data-shelf="${shelfId}"]`)
      .forEach((el) => {
        const row = Number(el.dataset['row']);
        const col = Number(el.dataset['col']);
        if (getStack(shelf, { row, col })) return;
        const rect = el.getBoundingClientRect();
        const dist = Math.hypot(rect.left + rect.width / 2 - point.x, rect.top + rect.height / 2 - point.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      });
    return best;
  }

  private shelfById(shelfId: string): Shelf {
    const shelf = this.store.run.shelves.find((s) => s.id === shelfId);
    if (!shelf) throw new Error(`找不到货架 ${shelfId}`);
    return shelf;
  }

  // ———————— 事件 → 表现层 ————————

  private consume(result: CommandResult): void {
    const after: Array<() => void> = [];
    for (const ev of result.events) {
      switch (ev.type) {
        case 'rejected':
          playSfx('reject');
          showToast(this.fxLayer, ev.reason, 'warn');
          break;
        case 'boxOpened':
          playSfx('unbox');
          after.push(() => this.wordOn(`[data-box="${ev.boxId}"]`, 'unbox'));
          break;
        case 'boxEmptied': {
          // 立刻量位置：重绘之后这个箱子就不在了
          const rect = this.rectOf(`[data-box="${ev.boxId}"]`);
          if (rect) spawnCrushGhost(this.fxLayer, rect);
          playSfx('crush');
          showToast(this.fxLayer, `${ev.label} 拆空了`);
          break;
        }
        case 'picked':
          playSfx('pick');
          break;
        case 'placed':
          playSfx('place');
          this.pendingFocus = { shelfId: ev.shelfId, pos: ev.pos };
          after.push(() => this.wordOn(slotSelector(ev.shelfId, ev.pos), 'place'));
          if (ev.partial) showToast(this.fxLayer, '这一格塞满了，剩下的还在手里');
          break;
        case 'swapped':
          playSfx('preview');
          this.pendingFocus = { shelfId: ev.shelfId, pos: ev.pos };
          after.push(() => this.wordOn(slotSelector(ev.shelfId, ev.pos), 'swap'));
          break;
        case 'returned':
          playSfx('return');
          // 放回哪儿去了必须说清楚 —— 否则玩家不知道东西跑哪了（"名副其实"的一半靠这句话）
          showToast(this.fxLayer, `放回 ${ev.toWhere}`);
          break;
        case 'sorted':
          playSfx('sort');
          if (ev.changedShelves === 0) showToast(this.fxLayer, '这些货架已经排好了');
          break;
        case 'tidy':
          playSfx('tidy');
          after.push(() => this.tidyOn(ev.shelfId));
          break;
        case 'zoneUpdated':
          break;
      }
    }
    this.render();
    for (const fn of after) fn();
  }

  private applyFocus(): void {
    const focus = this.pendingFocus;
    this.pendingFocus = null;
    if (!focus) return;
    const el = this.roomEl.querySelector<HTMLElement>(slotSelector(focus.shelfId, focus.pos));
    if (!el) return;
    el.classList.add('is-just-placed');
    window.setTimeout(() => el.classList.remove('is-just-placed'), 180);
  }

  private wordOn(selector: string, action: Parameters<typeof spawnSfxWord>[2]): void {
    const el = this.root.querySelector<HTMLElement>(selector) ?? this.roomEl.querySelector<HTMLElement>(selector);
    const rect = el ? el.getBoundingClientRect() : null;
    if (!rect) return;
    spawnSfxWord(this.fxLayer, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, action);
  }

  private tidyOn(shelfId: string): void {
    const el = this.roomEl.querySelector<HTMLElement>(`[data-shelf-card="${shelfId}"]`);
    if (!el) return;
    spawnTidyTag(this.fxLayer, el.getBoundingClientRect());
  }

  private rectOf(selector: string): DOMRect | null {
    const el = this.root.querySelector<HTMLElement>(selector);
    return el ? el.getBoundingClientRect() : null;
  }

  private query<T extends HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`缺少必需节点：${selector}`);
    return el;
  }
}

function slotSelector(shelfId: string, pos: SlotPos): string {
  return `[data-slot][data-shelf="${shelfId}"][data-row="${pos.row}"][data-col="${pos.col}"]`;
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
