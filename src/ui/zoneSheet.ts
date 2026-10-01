/**
 * 胶带抽屉（引擎① 自建秩序）。
 *
 * 心智模型：一张胶带 = 一个分区 = 名字 + 颜色，可以贴到任意多块货架上。
 * 交互只做三件事：贴上一张已有胶带 / 撕一段新的贴上 / 把这架上的撕下来。
 *
 * 两个刻意的设计：
 *  1. **不做全屏遮罩**：抽屉只占下半屏，遮罩层透明，货架始终看得见 ——
 *     分区是空间概念，编辑时把空间藏起来玩家就失去参照（这是上一版的病根）。
 *  2. **贴完就收起**：动作完成即关闭，让玩家立刻看到货架上多出来的那条胶带。
 */
import { DEFAULT_ZONE_COLOR, ZONE_COLORS, ZONE_COLOR_NAMES } from '../data/palette';
import { findZone } from '../model/shelf';
import type { Shelf, Zone } from '../model/types';
import type { ZoneInput } from '../systems/organize';
import { shelfLabel } from './labels';

export interface ZoneSheetHost {
  getShelves(): Shelf[];
  getZones(): Zone[];
  /** 返回是否成功（失败时抽屉不关，让玩家看到提示条上的原因） */
  apply(shelfId: string, input: ZoneInput): boolean;
  assign(shelfId: string, zoneId: string | null): boolean;
}

export class ZoneSheet {
  private readonly root: HTMLElement;
  private readonly host: ZoneSheetHost;
  private readonly onClose: (() => void) | null;
  private shelfId: string | null = null;
  private name = '';
  private color: string = DEFAULT_ZONE_COLOR;

  constructor(root: HTMLElement, host: ZoneSheetHost, onClose?: () => void) {
    this.root = root;
    this.host = host;
    this.onClose = onClose ?? null;
    this.root.className = 'zone-drawer';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => {
      const target = e.target;
      if (target instanceof HTMLInputElement) this.name = target.value;
    });
  }

  get isOpen(): boolean {
    return this.shelfId !== null;
  }

  get currentShelfId(): string | null {
    return this.shelfId;
  }

  open(shelfId: string): void {
    this.shelfId = shelfId;
    const shelf = this.host.getShelves().find((s) => s.id === shelfId) ?? null;
    const zone = shelf ? findZone(this.host.getZones(), shelf.zoneId) : null;
    // 这架已经贴着胶带 → 输入框就是"这张胶带的编辑器"（预填它现在的名字与颜色）
    this.name = zone?.name ?? '';
    this.color = zone?.color ?? this.pickFreeColor();
    this.root.hidden = false;
    this.render();
    const input = this.root.querySelector<HTMLInputElement>('input[data-zone-name]');
    if (input && !zone) {
      // 没贴胶带时顺手聚焦，少点一次（不 hard-focus，手机上弹不弹键盘交给系统）
      window.setTimeout(() => input.focus({ preventScroll: true }), 60);
    }
  }

  close(): void {
    if (this.shelfId === null) return;
    this.shelfId = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.onClose?.();
  }

  /** 外部状态变了（别的命令提交过）时刷新列表；不会丢掉玩家正在输入的名字 */
  refresh(): void {
    if (!this.isOpen) return;
    const input = this.root.querySelector<HTMLInputElement>('input[data-zone-name]');
    if (input) this.name = input.value;
    this.render();
  }

  private pickFreeColor(): string {
    const used = new Set(this.host.getZones().map((z) => z.color));
    return ZONE_COLORS.find((c) => !used.has(c)) ?? DEFAULT_ZONE_COLOR;
  }

  private usageCount(zoneId: string): number {
    return this.host.getShelves().filter((s) => s.zoneId === zoneId).length;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const hit = target.closest<HTMLElement>('[data-zone-act]');
    if (!hit || !this.shelfId) return;
    const act = hit.dataset['zoneAct'];
    const shelfId = this.shelfId;

    switch (act) {
      case 'close':
        this.close();
        return;
      case 'color': {
        // 只改色块选中态，不重建 DOM —— 否则输入框焦点和键盘会被顶掉
        const color = hit.dataset['color'];
        if (!color) return;
        this.color = color;
        this.root.querySelectorAll<HTMLElement>('.swatch').forEach((el) => {
          el.classList.toggle('is-active', el.dataset['color'] === color);
        });
        return;
      }
      case 'save': {
        const editing = this.currentZone();
        // 已贴胶带 → 改这张（改名/改色，其他贴着它的货架一起变）；没贴 → 写一段新的
        const input: ZoneInput = editing
          ? { name: this.name, color: this.color, zoneId: editing.id }
          : { name: this.name, color: this.color };
        if (this.host.apply(shelfId, input)) this.close();
        return;
      }
      case 'assign': {
        const zoneId = hit.dataset['zoneId'];
        if (!zoneId) return;
        if (this.host.assign(shelfId, zoneId)) this.close();
        return;
      }
      case 'detach': {
        const zone = this.currentZone();
        if (!zone) return;
        const others = this.usageCount(zone.id) - 1;
        const message =
          others > 0
            ? `从这架撕下「${zone.name}」？另外 ${others} 块货架还贴着它。`
            : `从这架撕下「${zone.name}」？没有别的货架在用它，这张胶带会一起撕掉。`;
        if (!window.confirm(message)) return;
        if (this.host.assign(shelfId, null)) this.close();
        return;
      }
      default:
        return;
    }
  }

  private currentZone(): Zone | null {
    if (!this.shelfId) return null;
    const shelf = this.host.getShelves().find((s) => s.id === this.shelfId);
    return shelf ? findZone(this.host.getZones(), shelf.zoneId) : null;
  }

  private render(): void {
    if (!this.shelfId) return;
    const shelves = this.host.getShelves();
    const index = shelves.findIndex((s) => s.id === this.shelfId);
    const shelf = index >= 0 ? (shelves[index] as Shelf) : null;
    if (!shelf) {
      this.close();
      return;
    }
    const zones = this.host.getZones();
    const current = findZone(zones, shelf.zoneId);

    const swatches = ZONE_COLORS.map((color) => {
      const active = color === this.color ? ' is-active' : '';
      return `<button class="swatch${active}" data-zone-act="color" data-color="${color}" style="--swatch:${color}" aria-label="${ZONE_COLOR_NAMES[ZONE_COLORS.indexOf(color)] ?? ''}"></button>`;
    }).join('');

    const tapeList = zones.length
      ? zones
          .map((zone) => {
            const used = this.usageCount(zone.id);
            const isCurrent = current?.id === zone.id;
            const here = shelves.some((s) => s.id === this.shelfId && s.zoneId === zone.id);
            const word = here ? (used > 1 ? `这架已贴 · 共 ${used} 架` : '这架已贴') : used > 1 ? `${used} 架在用` : '贴着 1 架';
            return `<button class="tape-slot${isCurrent ? ' is-current' : ''}" data-zone-act="assign" data-zone-id="${zone.id}" style="--zone:${zone.color}">
              <span class="tape-slot-name">${escapeHtml(zone.name)}</span>
              <span class="tape-slot-meta">${word}</span>
            </button>`;
          })
          .join('')
      : '<p class="zone-empty">还没撕过胶带。写下你要给这片区域定的名字，贴上去就是你的第一条规矩。</p>';

    const currentBlock = current
      ? `<div class="tape-current" style="--zone:${current.color}">
           <span class="tape-chip">${escapeHtml(current.name)}</span>
           <span class="tape-current-meta">这架贴着它 · ${this.usageCount(current.id)} 架在用</span>
           <button class="mini mini-danger" data-zone-act="detach">撕下来</button>
         </div>`
      : `<p class="zone-empty">这架还没贴胶带 —— 贴了才按分区算「归位率」。</p>`;

    this.root.innerHTML = `
      <div class="drawer-blocker" data-zone-act="close"></div>
      <div class="drawer-body">
        <header class="drawer-head">
          <h3>给 ${shelfLabel(shelf, index)} 贴胶带</h3>
          <button class="mini" data-zone-act="close">收起</button>
        </header>
        ${currentBlock}
        <div class="field">
          <span>已有胶带（点一下贴到这架）</span>
          <div class="tape-list">${tapeList}</div>
        </div>
        <div class="field">
          <span>${current ? '改这段胶带（改名 / 换色，贴着它的架子一起变）' : '撕一段新胶带'}</span>
          <div class="tape-new">
            <input type="text" maxlength="8" placeholder="写上名字，比如 救命层" data-zone-name value="${escapeHtml(this.name)}" />
            <div class="swatches">${swatches}</div>
            <button class="btn btn-primary" data-zone-act="save">${current ? '改这段胶带' : '贴到这架'}</button>
          </div>
        </div>
      </div>
    `;
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
