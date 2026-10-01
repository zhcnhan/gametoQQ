/**
 * 分区编辑弹层（引擎① 自建秩序：玩家给货架起名、选色、声明接收什么）。
 * 纯粹的表现层，所有写操作都通过回调转交给 systems/。
 */
import { CATEGORY_LABELS } from '../data/items';
import { DEFAULT_ZONE_COLOR, ZONE_COLORS, ZONE_COLOR_NAMES } from '../data/palette';
import { findZone } from '../model/shelf';
import type { CategoryId, Shelf, Zone } from '../model/types';
import type { ZoneInput } from '../systems/organize';
import { shelfLabel } from './labels';

const CATEGORY_ORDER: CategoryId[] = ['food', 'water', 'medicine', 'fuel', 'warmth', 'tool', 'luxury'];

export interface ZoneSheetHost {
  getShelves(): Shelf[];
  getZones(): Zone[];
  /** 保存（新建或改名改色）并把该分区指派给货架 */
  apply(shelfId: string, input: ZoneInput): void;
  assign(shelfId: string, zoneId: string | null): void;
  removeZone(zoneId: string): void;
}

export class ZoneSheet {
  private readonly root: HTMLElement;
  private readonly host: ZoneSheetHost;
  private shelfId: string | null = null;
  private name = '';
  private color: string = DEFAULT_ZONE_COLOR;
  private categories: CategoryId[] = [];

  constructor(root: HTMLElement, host: ZoneSheetHost) {
    this.root = root;
    this.host = host;
    this.root.className = 'sheet';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.dataset['zoneName'] !== undefined) {
        this.name = target.value;
      }
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
    this.name = zone?.name ?? '';
    this.color = zone?.color ?? DEFAULT_ZONE_COLOR;
    this.categories = [...(zone?.autoAccept?.categories ?? [])];
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.shelfId = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  /** 外部状态变了（新建分区等）时刷新列表；不会丢掉玩家正在输入的名字 */
  refresh(): void {
    if (!this.isOpen) return;
    const input = this.root.querySelector<HTMLInputElement>('input[data-zone-name]');
    if (input) this.name = input.value;
    this.render();
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const hit = target.closest<HTMLElement>('[data-zone-act]');
    if (!hit || !this.shelfId) return;
    const act = hit.dataset['zoneAct'];
    switch (act) {
      case 'close':
        this.close();
        return;
      case 'color': {
        const color = hit.dataset['color'];
        if (color) {
          this.color = color;
          this.render();
        }
        return;
      }
      case 'cat': {
        const cat = hit.dataset['cat'] as CategoryId | undefined;
        if (!cat) return;
        this.categories = this.categories.includes(cat)
          ? this.categories.filter((c) => c !== cat)
          : [...this.categories, cat];
        this.render();
        return;
      }
      case 'save': {
        const shelfId = this.shelfId;
        this.host.apply(shelfId, { name: this.name, color: this.color, categories: this.categories });
        this.render();
        return;
      }
      case 'clear': {
        this.host.assign(this.shelfId, null);
        this.name = '';
        this.categories = [];
        this.render();
        return;
      }
      case 'assign': {
        const zoneId = hit.dataset['zoneId'];
        if (zoneId) this.host.assign(this.shelfId, zoneId);
        this.render();
        return;
      }
      case 'delete': {
        const zoneId = hit.dataset['zoneId'];
        if (zoneId) this.host.removeZone(zoneId);
        this.render();
        return;
      }
      default:
        return;
    }
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

    const swatches = ZONE_COLORS.map((color, i) => {
      const active = color === this.color ? ' is-active' : '';
      return `<button class="swatch${active}" data-zone-act="color" data-color="${color}" style="--swatch:${color}" aria-label="${ZONE_COLOR_NAMES[i] ?? ''}"></button>`;
    }).join('');

    const chips = CATEGORY_ORDER.map((cat) => {
      const active = this.categories.includes(cat) ? ' is-active' : '';
      return `<button class="chip${active}" data-zone-act="cat" data-cat="${cat}">${CATEGORY_LABELS[cat]}</button>`;
    }).join('');

    const zoneList = zones.length
      ? zones
          .map((zone) => {
            const isCurrent = current?.id === zone.id ? ' is-current' : '';
            return `<div class="zone-row${isCurrent}">
              <span class="zone-dot" style="--zone:${zone.color}"></span>
              <span class="zone-row-name">${escapeHtml(zone.name)}</span>
              <button class="mini" data-zone-act="assign" data-zone-id="${zone.id}">指派到这架</button>
              <button class="mini mini-danger" data-zone-act="delete" data-zone-id="${zone.id}">删</button>
            </div>`;
          })
          .join('')
      : '<p class="zone-empty">还没有分区。给这架起个名字，它就是你的第一条规矩。</p>';

    this.root.innerHTML = `
      <div class="sheet-backdrop" data-zone-act="close"></div>
      <div class="sheet-body">
        <header class="sheet-head">
          <h3>分区 · ${shelfLabel(shelf, index)}</h3>
          <button class="mini" data-zone-act="close">关闭</button>
        </header>
        <label class="field">
          <span>叫什么</span>
          <input type="text" maxlength="8" placeholder="救命层 / 快乐水专区" data-zone-name value="${escapeHtml(this.name)}" />
        </label>
        <div class="field">
          <span>纸胶带颜色</span>
          <div class="swatches">${swatches}</div>
        </div>
        <div class="field">
          <span>本区接收（不选＝全接收）</span>
          <div class="chips">${chips}</div>
        </div>
        <div class="field">
          <span>已有分区</span>
          <div class="zone-list">${zoneList}</div>
        </div>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-zone-act="save">${current ? '保存修改' : '命名并指派'}</button>
          <button class="btn" data-zone-act="clear">取消分区</button>
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
