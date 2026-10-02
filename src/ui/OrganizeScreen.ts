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
import { dayLabel } from '../model/calendar';
import { getStack, isOffZone, stackCount } from '../model/shelf';
import type { ItemStack, Shelf, SlotPos, Zone } from '../model/types';
import type { GameStore } from '../state/store';
import {
  applyZone,
  assignZone,
  buildView,
  inventoryTotals,
  placeHeld,
  pickupFromShelf,
  returnHeld,
  sortAllByFEFO,
  swapSlots,
  takeFromBox,
  tapSlot,
  toggleHandy,
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
  /** 还有行动点时再出门一次（M1 新增；由 systems/phases 的 goOut 命令完成） */
  onGoOut: () => void;
  /** 过一天（M1 新增；由 systems/phases 的 endDay 命令完成） */
  onEndDay: () => void;
}

interface DragState {
  active: boolean;
  source: 'shelf' | 'box' | 'hand';
  /**
   * 手里拿的是**一叠的一部分**（`placeHeld` 把放不下的留在手里）。
   *
   * 它只影响一件事：落点。这时玩家在"继续放同一件东西"的流程里，
   * 所以指针底下若是**别的**物资，该就近找空格（合并会失败、交换更荒唐），
   * 而不是像正常拖拽那样把它当成交换目标。见 `pickDropSlot`。
   */
  partial: boolean;
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
  private drag: DragState = { active: false, source: 'shelf', partial: false };

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
          <div class="topbar-row">
            <div class="title">
              <h1>囤货台账</h1>
              <p class="sub" data-sub></p>
            </div>
            <div class="topbar-tools">
              <button class="mini" data-action="mute" data-mute-label>静音</button>
              <button class="mini" data-action="restart">重开</button>
            </div>
          </div>
          <div class="score" data-score></div>
        </header>
        <main class="room-scroll" data-room></main>
        <footer class="dock">
          <div class="dock-hand" data-hand data-drop="return"></div>
          <div class="dock-boxes" data-boxes></div>
          <div class="dock-tools">
            <button class="btn" data-action="sort">${iconSvg('sort')}<span>按保质期排</span></button>
            <button class="btn" data-action="go-out"><span>再去采购</span></button>
            <button class="btn btn-primary" data-action="end-day"><span>过一天</span></button>
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
    this.sheet = new ZoneSheet(
      sheetEl,
      {
        getShelves: () => this.store.run.shelves,
        getZones: () => this.store.run.zones,
        apply: (shelfId: string, input: ZoneInput) => {
          const result = applyZone(this.store, shelfId, input);
          this.consume(result);
          return result.ok;
        },
        assign: (shelfId: string, zoneId: string | null) => {
          const result = assignZone(this.store, shelfId, zoneId);
          this.consume(result);
          return result.ok;
        }
      },
      () => this.clearEditHighlight()
    );

    // 只挂一个委托监听（顶栏指标卡 / 货架按钮 / 底部工具都从这里走），少一层心智负担
    this.root.addEventListener('click', this.onClickBound);

    this.render();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClickBound);
    this.clearLongPressBindings();
  }

  render(): void {
    /*
     * ★ 兜底：任何一次重绘都顺手清掉"游离的拖拽幽灵"。
     *
     * 幽灵是 `fx-layer` 里一个独立元素，不进 DOM 树状重绘，所以它只能靠
     * 手势结束（`endGhost`）来收。只要那条路有一条我没覆盖到的分支
     * （玩家反馈的"卡住了，得点一下原格子才好"），幽灵就会一直贴在屏幕上。
     *
     * 与其指望我把所有分支都找齐，不如在这儿兜住：**重绘 = 屏幕重来一遍**，
     * 那幽灵就没有理由跨过一次重绘活下来。就算真有漏网的分支，
     * 玩家看到的也只是"它消失了"，而不是"它卡在那儿不动"。
     */
    if (this.ghost !== null) this.endGhost();
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
    const run = this.store.run;
    const totals = inventoryTotals(run);
    const boxes = view.boxes.length;
    // 天数用 D-7 / D-Day / D+3 这套统一写法（model/calendar.dayLabel），不各写各的
    this.subEl.textContent = `${dayLabel(run.day)} · 在家整理 · 待拆 ${boxes} 箱 · 在库 ${totals.pieces} 件`;
  }

  private renderScore(view: OrganizeView): void {
    const p = Math.round(view.score.placement * 100);
    const f = Math.round(view.score.fefo * 100);
    const e = Math.round(view.score.emergency * 100);
    const capacity = this.store.run.shelves.reduce((n, s) => n + s.w * s.h, 0);
    const handyCount = this.store.run.shelves.filter((s) => s.handyRank !== null).length;
    // 全中文台账。术语解释放 title（鼠标）＋点一下弹提示（手机没 hover，只能点）
    this.scoreEl.innerHTML = `
      <button class="score-item" data-action="explain" data-explain="归位率：你自己给胶带写的清单，东西有没有照放。只有被某张清单明确写进去的东西才算归位；贴了胶带但没写清单，和没贴一样是 0。" title="你自己给胶带写的清单，东西有没有照放。只有被清单明确写进去的才算归位；没写清单就不算。">
        <i>归位率</i><b>${p}%</b>
      </button>
      <button class="score-item" data-action="explain" data-explain="临期优先：同一块货架有没有按到期日排好，快到期的排在前面，也先被用掉" title="同一块货架有没有按到期日排好">
        <i>临期优先</i><b>${f}%</b>
      </button>
      <button class="score-item" data-action="explain" data-explain="应急可达率：这场寒潮要用的东西（燃料和药）有多少放在顺手位上${handyCount === 0 ? '。你还没标过顺手位，点货架右上角的「顺手位」，全屋只有这一块' : ''}。体力见底那天，只有顺手位上的东西还够得到。" title="急用的东西有多少放在顺手位上">
        <i>应急可达</i><b>${e}%</b>
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
        cells.push(this.slotHtml(shelf.id, { row, col }, stack, zone));
      }
    }
    return `
      <section class="shelf-card" data-shelf-card="${shelf.id}" style="--zone:${zone?.color ?? 'transparent'}">
        <div class="shelf-head">
          <span class="zone-tape"></span>
          <h2 class="shelf-title" data-shelf-title data-shelf="${shelf.id}" data-action="edit-zone" title="点一下给这架贴胶带">
            ${shelfLabel(shelf, index)}
            <em class="zone-name${zone ? '' : ' is-none'}">${zone ? escapeHtml(zone.name) : '还没贴'}</em>
          </h2>
          ${tidy ? '<span class="tidy-badge">整整齐齐</span>' : ''}
          <button class="tape-btn${shelf.handyRank !== null ? ' is-handy' : ''}"
                  data-action="toggle-handy" data-shelf="${shelf.id}"
                  title="${shelf.handyRank !== null ? '门口就是这块。再点一下撤下，可以换别的架' : '把这块标成门口的顺手位（全屋只有这一块）'}">
            ${shelf.handyRank !== null ? '门口这块' : '顺手位'}
          </button>
          <button class="tape-btn" data-action="edit-zone" data-shelf="${shelf.id}" aria-label="给这架贴胶带">
            ${iconSvg('tag')}<span>贴标签</span>
          </button>
        </div>
        <div class="shelf-grid" style="--cols:${shelf.w}">${cells.join('')}</div>
      </section>
    `;
  }

  private slotHtml(shelfId: string, pos: SlotPos, stack: ItemStack | null, zone: Zone | null): string {
    const attrs = `data-slot data-shelf="${shelfId}" data-row="${pos.row}" data-col="${pos.col}"`;
    if (!stack) return `<button class="slot is-empty" ${attrs} aria-label="空格"></button>`;
    const def = getItemDef(stack.itemId);
    const count = stackCount(stack);
    const day = this.store.run.day;
    const soon = isExpiringSoon(stack, day);
    // 中性信息点：白描一个墨色小圈，不用朱红（§5A：朱红 = 警告/重要）。
    // 没贴胶带的货架 isOffZone 恒为 false —— "我不分类"不点名。
    const off = isOffZone(zone, stack);
    const label = `${stackLabel(stack)}，${expiryText(stack, day)}${off ? '，不在这张胶带的清单里' : ''}`;
    return `<button class="slot${soon ? ' is-soon' : ''}" ${attrs} aria-label="${label}" title="${label}">
      <span class="slot-icon">${itemIconSvg(def.icon)}</span>
      ${count > 1 ? `<span class="slot-count">×${count}</span>` : ''}
      ${soon ? `<span class="slot-soon" aria-hidden="true"></span>` : ''}
      ${off ? '<span class="slot-off" aria-hidden="true"></span>' : ''}
    </button>`;
  }

  private renderDock(view: OrganizeView): void {
    const hand = view.held;
    const handHtml = hand
      ? `<div class="hand-item">
           <span class="hand-icon">${itemIconSvg(getItemDef(hand.itemId).icon)}</span>
           <span class="hand-text">${escapeHtml(stackLabel(hand))}<em>${escapeHtml(expiryText(hand, this.store.run.day))}</em></span>
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

    // 行动点用完了就不该再给一个"点了没反应"的按钮（§4A 无死按钮）
    const goOut = this.dockEl.querySelector<HTMLButtonElement>('[data-action="go-out"]');
    if (goOut) {
      const canGoOut = this.store.run.actionPoints > 0;
      goOut.disabled = !canGoOut;
      goOut.title = canGoOut ? `今天还能出门 ${this.store.run.actionPoints} 次` : '今天的行动点用完了';
    }
  }

  // ———————— 手势绑定 ————————

  private bindRoomGestures(): void {
    this.clearLongPressBindings();
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
      this.longPressDetachers.push(attachLongPress(el, () => this.sheet.open(shelfId)));
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

  private readonly onClickBound = (e: MouseEvent): void => this.onDelegatedClick(e);

  /**
   * 长按监听器挂在 window 上，不会随货架重绘自动消失 —— 每次重绘都要先把上一批摘掉。
   * （M0 时期货架只重绘几次，泄漏看不出来；M1 每次放好一件都会重绘，必须收干净。）
   */
  private longPressDetachers: (() => void)[] = [];

  private clearLongPressBindings(): void {
    for (const detach of this.longPressDetachers) detach();
    this.longPressDetachers = [];
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
        if (shelfId) this.openZoneDrawer(shelfId);
        return;
      case 'toggle-handy':
        if (shelfId) this.consume(toggleHandy(this.store, shelfId));
        return;
      case 'sort':
        this.consume(sortAllByFEFO(this.store, this.session));
        return;
      case 'return':
        this.consume(returnHeld(this.store, this.session));
        return;
      case 'mute': {
        setMuted(!isMuted());
        const label = this.root.querySelector('[data-mute-label]');
        if (label) label.textContent = isMuted() ? '已静音' : '静音';
        return;
      }
      case 'go-out':
        this.props.onGoOut();
        return;
      case 'end-day':
        this.props.onEndDay();
        return;
      case 'restart':
        if (window.confirm('重开一局会清空这一局的所有进度（物资、分区、现金），确定吗？')) this.props.onRestart();
        return;
      default:
        return;
    }
  }

  // ———————— 拖拽 ————————

  /**
   * 手里那件是不是"上一步没放下的一部分"。
   *
   * `placeHeld` 在一格塞不下时会把剩下的留在手里，而且**来处仍然是那块货架**
   * （所以光看 `session.heldFrom` 分不出"刚拿起来"和"没放下"）。
   * 这里记一个会话级的标记：`placed.partial` 置真，下一件被拿起来（`picked`）时清掉。
   * 它唯一的读者是 `pickDropSlot`（决定"占用格算不算合法落点"）。
   */
  private holdingPartial = false;

  /**
   * 这一趟拖拽**从哪儿起的**（`null` = 从纸箱里拖出来的，没有货架来源）。
   *
   * 它只服务一件事：**拖拽落在一个被别的物资占着的格子上时，走"两格互换"
   * （`swapSlots`，手保持空）而不是"放上去、被换的进手里"**。
   * 后者是点选-点放的语义（手里本来就有东西要安置），玩家明确要求把这两条路拆开。
   *
   * 必须连**货架**一起记：跨货架互换时只知道行列会写到错的架子上。
   */
  private dragOrigin: { shelfId: string; pos: SlotPos } | null = null;

  private beginDrag(source: DragState['source']): void {
    if (!this.session.held) return;
    this.drag = { active: true, source, partial: this.holdingPartial };
    // 从货架拖起时记下来源；从"没放下的一部分"继续时，来源就是手里那件的来处
    const origin = this.session.heldFrom;
    this.dragOrigin = origin.kind === 'shelf' ? { shelfId: origin.shelfId, pos: origin.pos } : null;
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
      // 三个记号各说一件事：会放（虚线）/ 会换（实线 + 角标）/ 这是吸附（半透明 + 虚线角标）
      slot.classList.add(stack && !sameItem ? 'is-hover-swap' : 'is-hover');
      if (slot.dataset['snap'] === '1') slot.classList.add('is-hover-snap');
      playSfx('preview');
    }
  }

  private endDrag(point: { x: number; y: number }): void {
    const wasActive = this.drag.active;
    const slot = this.hoverEl ?? this.pickDropSlot(point);
    this.endGhost();
    if (!wasActive || !this.session.held) {
      this.drag = { active: false, source: 'shelf', partial: false };
      return;
    }
    this.drag = { active: false, source: 'shelf', partial: false };

    if (slot) {
      const shelfId = slot.dataset['shelf'];
      const row = Number(slot.dataset['row']);
      const col = Number(slot.dataset['col']);
      if (shelfId) {
        /*
         * ★ 这里分成两条路（玩家要求"独立开"）：
         *
         *  · **拖拽 A 落在 B 上** → 两格互换，手保持空（`swapSlots`）；
         *  · **手里拿着东西点格子** → 放上去，被换的那件进手里（`placeHeld`）。
         *
         * 判据：这一趟是从**货架的某一格**拖起来的（`dragOrigin` 有值）、
         * 手里拿的不是"没放下的一半"（那是在继续放同一件）、
         * 而且落点那一格上压着**别的**物资。
         */
        const target = getStack(this.shelfById(shelfId), { row, col });
        const held = this.session.held;
        const origin = this.dragOrigin;
        const sameSlot =
          origin !== null &&
          origin.shelfId === shelfId &&
          origin.pos.row === row &&
          origin.pos.col === col;
        const canSwap =
          origin !== null &&
          !this.drag.partial &&
          target !== null &&
          held !== null &&
          target.itemId !== held.itemId &&
          !sameSlot;
        if (canSwap && origin) {
          this.consume(
            swapSlots(this.store, { shelfId: origin.shelfId, pos: origin.pos }, { shelfId, pos: { row, col } })
          );
          return;
        }
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
      this.hoverEl.classList.remove('is-hover', 'is-hover-swap', 'is-hover-snap');
      this.hoverEl = null;
    }
    // 清掉吸附标记：`nearestLegalSlot` 每次都会给当次选中的格子打上 `data-snap`，
    // 不在这里清的话，上一帧那个格子的标记会留到下一次（它的 class 已经被移除，
    // 但下一帧如果它又被选中，判断会读到陈旧状态）
    this.roomEl.querySelectorAll<HTMLElement>('[data-slot][data-snap]').forEach((el) => {
      delete el.dataset['snap'];
    });
  }

  /**
   * 落点判定：**指针正下方那一格优先，不行就吸附到同架最近的合法落点**（玩家选的口径 3）。
   *
   * ## 三段，按优先级
   *
   *  ① **指针底下就是格子** → 就用它。这是精确操作（"我要放这一格"）；
   *  ② 指针底下是**货架卡**、但不是格子（卡片的留白、标签行、格子之间的缝）
   *     → 吸附到同架**离指针最近的合法落点**，并在悬停预览上标明"这是吸附，不是精确命中"；
   *  ③ 指针在货架卡之外（别的卡片、底部操作台、页面空白）→ 不吸附。
   *
   * ## 为什么 ② 要有，而且要有"预览"
   *
   * M2 走测反馈："拖动放进格子和交互的判定特别奇怪，好像是错位的" ——
   * 原来的实现只认①，松在格子和格子之间的**那道 3px 缝**上就等于没放，
   * 玩家看到的是"我明明对着格子松手了，东西还在手上"。
   * ③ 这个边界同样重要：松在货架**外面**不该被吸进来 ——
   * 那是"我要放下"和"我要拿走/放回"的分界。
   *
   * ## 什么情况下不吸附到"占用格"
   *
   * 只一种：**手里拿的是上一步没放下的一部分**（`DragState.partial`）。
   * 那时玩家在"继续放同一件"的流程里，落点指向别的物资没有意义
   * （合并会失败、交换更荒唐）—— 这时②的候选里只留空格。
   */
  private pickDropSlot(point: { x: number; y: number }): HTMLElement | null {
    const el = document.elementFromPoint(point.x, point.y);
    if (!(el instanceof HTMLElement)) return null;

    const held = this.session.held;
    const exact = el.closest<HTMLElement>('[data-slot]');
    // ① 精确命中
    if (exact) {
      if (!held) return exact;
      const shelfId = exact.dataset['shelf'];
      const stack = shelfId
        ? getStack(this.shelfById(shelfId), {
            row: Number(exact.dataset['row']),
            col: Number(exact.dataset['col'])
          })
        : null;
      // 叠在自己那一堆上 → 合并，正常落点
      if (!stack || stack.itemId === held.itemId) return exact;
      // 手里是"没放下的一部分" → 占用格不是合法落点，交给下面去吸附空格
      if (!this.drag.partial) return exact;
    }

    // ② 指针在货架卡里但不是格子 → 吸附到同架最近的合法落点
    const card = el.closest<HTMLElement>('[data-shelf-card]');
    const shelfId = card?.dataset['shelfCard'];
    if (!shelfId) return null; // ③ 货架之外，不吸附
    return this.nearestLegalSlot(shelfId, point);
  }

  /**
   * 同架离指针最近的**合法落点**。
   *
   * "合法"= 空格，或者（非 partial 时）装着**别的**物资的格子（那是交换目标）。
   * 返回的元素带 `data-snap="1"`，供悬停预览区分"精确命中"与"吸附"。
   */
  private nearestLegalSlot(shelfId: string, point: { x: number; y: number }): HTMLElement | null {
    const shelf = this.shelfById(shelfId);
    const held = this.session.held;
    const candidates: HTMLElement[] = [];
    this.roomEl.querySelectorAll<HTMLElement>(`[data-slot][data-shelf="${shelfId}"]`).forEach((el) => {
      const row = Number(el.dataset['row']);
      const col = Number(el.dataset['col']);
      const stack = getStack(shelf, { row, col });
      if (stack) {
        // 占用格：只有"非 partial"且不是同一件物资时才是合法落点（会交换）
        if (this.drag.partial) return;
        if (held && stack.itemId === held.itemId) return;
      }
      candidates.push(el);
    });
    if (candidates.length === 0) return null;

    let best: HTMLElement | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const dist = Math.hypot(rect.left + rect.width / 2 - point.x, rect.top + rect.height / 2 - point.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
    if (best !== null) best.dataset['snap'] = '1';
    return best;
  }

  /**
   * 打开胶带抽屉。刻意做两件事：把目标货架滚到房间区顶部（抽屉只占下半屏，
   * 货架必须露在上面）、给它加虚线高亮 —— 分区是空间概念，编辑时必须看得见那块区域。
   */
  private openZoneDrawer(shelfId: string): void {
    if (this.sheet.isOpen && this.sheet.currentShelfId === shelfId) return;
    this.clearEditHighlight();
    this.sheet.open(shelfId);
    const card = this.roomEl.querySelector<HTMLElement>(`[data-shelf-card="${shelfId}"]`);
    if (card) {
      card.scrollIntoView({ block: 'start' });
      card.classList.add('is-editing');
    }
  }

  private clearEditHighlight(): void {
    this.roomEl.querySelectorAll('.shelf-card.is-editing').forEach((el) => el.classList.remove('is-editing'));
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
          // 新拿起来的一件：它不可能是"上一步没放下的那件"
          this.holdingPartial = false;
          break;
        case 'placed':
          playSfx('place');
          this.pendingFocus = { shelfId: ev.shelfId, pos: ev.pos };
          after.push(() => this.wordOn(slotSelector(ev.shelfId, ev.pos), 'place'));
          this.holdingPartial = ev.partial;
          if (ev.partial) showToast(this.fxLayer, '这一格塞满了，剩下的还在手里');
          break;
        case 'swapped':
          playSfx('preview');
          this.pendingFocus = { shelfId: ev.shelfId, pos: ev.pos };
          // **两个格子都要有反馈**：交换是 A 去 B、B 去 A，只动落点那一个的话，
          // 屏幕上只有一边有动静，玩家会怀疑"另一件到底动没动"
          after.push(() => this.wordOn(slotSelector(ev.shelfId, ev.pos), 'swap'));
          after.push(() => this.wordOn(slotSelector(ev.from.shelfId, ev.from.pos), 'swap'));
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
        case 'handyChanged':
          playSfx('pick');
          // 说清它在哪个顺位 —— "顺手位"是个位置概念，不报顺位等于没说完
          showToast(
            this.fxLayer,
            ev.rank === null ? '从顺手位撤下' : '门口这块，急用的东西放这儿'
          );
          break;
        case 'zoneUpdated':
          break;
        case 'zoneRemoved':
          showToast(this.fxLayer, `已撕下「${ev.name}」`);
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
