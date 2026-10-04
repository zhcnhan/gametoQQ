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
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../data/items';
import { DEFAULT_ZONE_COLOR, ZONE_COLORS, ZONE_COLOR_NAMES } from '../data/palette';
import { findZone, firstZoneIdOf, rowZoneId } from '../model/shelf';
import type { CategoryId, Shelf, Zone } from '../model/types';
import type { ZoneInput } from '../systems/organize';
import { shelfLabel } from './labels';

export interface ZoneSheetHost {
  getShelves(): Shelf[];
  getZones(): Zone[];
  /** 返回是否成功（失败时抽屉不关，让玩家看到提示条上的原因） */
  apply(shelfId: string, input: ZoneInput): boolean;
  assign(shelfId: string, zoneId: string | null, rows?: number[]): boolean;
  /**
   * 只改这张胶带**自己**（名字 / 颜色 / 清单），不动"它贴在哪几行"。
   *
   * ★ 从**胶带架**上轻点进来时用这一条：那时没有"从哪块架子"这回事
   * （这张胶带可能贴在好几块架子上），所以"保存"只能是这个意思。
   * 没有它的话，那条路上的保存会拿 `null` 去调 `apply` —— 失败、而抽屉照样关掉，
   * 玩家看到的是"改了名字但没生效"。
   */
  updateZone(zoneId: string, input: { name: string; color: string; categories: CategoryId[] }): boolean;
}

export class ZoneSheet {
  private readonly root: HTMLElement;
  private readonly host: ZoneSheetHost;
  private readonly onClose: (() => void) | null;
  private shelfId: string | null = null;
  private name = '';
  private color: string = DEFAULT_ZONE_COLOR;
  /**
   * 这张胶带收哪些品类。空数组 = **还没写清单**。
   *
   * ★ §12 v0.8：空清单**不再**等于"什么都收 + 归位率恒满"。
   * 老口径让"贴一张空胶带"成为最优解（引擎① 的决策乐趣被绕过），
   * 现在空清单的胶带归位率是 0 —— 胶带本身不给分，清单才给分。
   */
  private categories: CategoryId[] = [];
  /**
   * 这次要贴**哪几行**（用户拍板 2026-10：胶带的粒度是一行，而且可以贴多行）。
   *
   * ## ★★ 默认从"全选"改成"**没贴过的那几行**"（2026-10 走测反馈）
   *
   * 我原来默认全选，理由是"给整块架子立规矩仍然是一次点击"。用户实测之后说：
   *
   * > "不要默认全选，不然特别容易胶带覆盖整个架子，**我的分类会被破坏**，
   * >  还得一条一条单独改"
   *
   * 他说得对，而我原来的理由是**把两件事的代价算反了**：
   *  · 默认全选出错时，代价是"**我辛苦分好的类被冲掉**"，而且要**逐行改回来**；
   *  · 默认只选没贴过的行时，"想整块贴一张"只多一次点击（还有「全选」按钮）。
   *
   * 一边是"多一次点击"，一边是"已有的秩序被破坏"—— 后者是这个游戏里
   * **最不该被误伤的东西**（玩家花在分区上的心思就是玩法本身）。
   * 所以默认改成"只选**还没贴过**的那些行"：已经在用的行不会被无声改掉。
   *
   * ⚠ 一块也没贴过的架子，这个默认就等于全选 —— 新架子的体验没变。
   */
  private rows: number[] = [];
  /**
   * 这次打开是**冲着哪一张胶带**来的（`null` = 没有特别指定）。
   *
   * ★ 从胶带架上轻点一张胶带时给这个值，它让"已有胶带"那一列的正确条目高亮 ——
   * 否则抽屉里没有任何东西告诉你"我正在改的是哪一张"。
   */
  private focusZoneId: string | null = null;

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

  /**
   * 抽屉开着没有。
   *
   * ⚠ 判据是 `!root.hidden`，**不是 `shelfId !== null`** —— 从胶带架上轻点进来时
   * 本来就没有"从哪块架子"（`shelfId === null`），而那时抽屉确实是开着的。
   * 用 `shelfId` 判会让那种情况下的 `refresh()` / `close()` 全部失灵。
   */
  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get currentShelfId(): string | null {
    return this.shelfId;
  }

  /**
   * 现在选中的行（升序）。
   *
   * ★ `OrganizeScreen` 用它判断"这次点进来与上次是不是同一件事"：
   * 同一个货架的第 1 行与第 3 行**不是**同一次编辑，而只看 `shelfId`
   * 会把第二次点击当成重复、直接 return —— 表现是"点了另一行没反应"。
   */
  get currentRows(): number[] {
    return [...this.rows];
  }

  /**
   * 打开抽屉。
   *
   * @param shelfId 从哪块架子进来（`null` = **从胶带架上轻点进来的**）
   * @param rows 预选哪几行
   * @param focusZoneId ★ 直接编辑**这张已有的胶带**（不管它贴在哪几行上）
   *
   * ## `shelfId` 为什么可以是 `null`
   *
   * 胶带架上轻点一张胶带，玩家想改的是**那张胶带本身**（名字/颜色/清单），
   * 而它可能贴在好几块架子上 —— "从哪一块进"没有答案。
   * 所以那两个"看这一架"的区域（当前贴着什么、贴到哪几行）在 `shelfId` 为空时
   * 整块不渲染，只留编辑那张胶带的部分。
   */
  open(shelfId: string | null, rows?: number[], focusZoneId?: string): void {
    this.shelfId = shelfId;
    const shelf = shelfId === null ? null : (this.host.getShelves().find((s) => s.id === shelfId) ?? null);
    /*
     * ★ 打开时选的"这一行"是**那一行自己的胶带**，不是"整架的第一张"。
     * 从某一行点进抽屉时（`rows` 只给了一行），输入框要预填**那一行**贴着的东西 ——
     * 一块架子上有两张胶带时，用整架的视角预填会预填错那一张。
     */
    const focusRow = rows && rows.length === 1 ? rows[0] : undefined;
    this.focusZoneId = focusZoneId ?? null;
    const zone =
      focusZoneId !== undefined
        ? findZone(this.host.getZones(), focusZoneId)
        : shelf === null
          ? null
          : findZone(
              this.host.getZones(),
              focusRow !== undefined ? rowZoneId(shelf, focusRow) : firstZoneIdOf(shelf)
            );
    // 这架已经贴着胶带 → 输入框就是"这张胶带的编辑器"（预填它现在的名字、颜色与清单）
    this.name = zone?.name ?? '';
    this.color = zone?.color ?? this.pickFreeColor();
    this.categories = [...(zone?.autoAccept?.categories ?? [])];
    /*
     * 选中的行：外部指定优先；否则**只选还没贴过胶带的那些行**。
     * ★ 这个默认是走测之后改的（理由见 `rows` 字段的注释）：
     * 默认全选会把玩家已经分好的类无声冲掉，而"多一次点击"远比那个便宜。
     * 如果**每一行都贴过了**，才退回全选 —— 那时"想改哪几行"没有更好的猜法，
     * 而且此时全选不会破坏任何东西（它们本来就有胶带）。
     */
    const bare = Array.from({ length: shelf?.h ?? 0 }, (_, r) => r).filter(
      (r) => rowZoneId(shelf!, r) === null
    );
    this.rows =
      rows && rows.length > 0
        ? rows.filter((r) => r >= 0 && r < (shelf?.h ?? 0))
        : bare.length > 0
          ? bare
          : Array.from({ length: shelf?.h ?? 0 }, (_, r) => r);
    this.root.hidden = false;
    this.render();
    const input = this.root.querySelector<HTMLInputElement>('input[data-zone-name]');
    if (input && !zone) {
      // 没贴胶带时顺手聚焦，少点一次（不 hard-focus，手机上弹不弹键盘交给系统）
      window.setTimeout(() => input.focus({ preventScroll: true }), 60);
    }
  }

  close(): void {
    if (this.root.hidden) return;
    this.shelfId = null;
    this.rows = [];
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.onClose?.();
  }

  /**
   * 外部状态变了（别的命令提交过）时刷新列表；不会丢掉玩家正在输入的名字。
   *
   * ⚠ 判断"开着没有"用的是 `this.root.hidden`，**不是 `this.shelfId !== null`** ——
   * 从胶带架进来时 `shelfId` 本来就是 `null`（没有"从哪块架子"这回事），
   * 用 `shelfId` 判会让那种情况下抽屉永远不刷新（改了名字却看不到）。
   */
  refresh(): void {
    if (this.root.hidden) return;
    const input = this.root.querySelector<HTMLInputElement>('input[data-zone-name]');
    if (input) this.name = input.value;
    this.render();
  }

  private pickFreeColor(): string {
    const used = new Set(this.host.getZones().map((z) => z.color));
    return ZONE_COLORS.find((c) => !used.has(c)) ?? DEFAULT_ZONE_COLOR;
  }

  /** 这张胶带现在贴在**几行**上（原来是"几块货架"—— 粒度变了，这个数也要跟着变） */
  private usageCount(zoneId: string): number {
    let n = 0;
    for (const shelf of this.host.getShelves()) {
      for (let row = 0; row < shelf.h; row++) if (rowZoneId(shelf, row) === zoneId) n += 1;
    }
    return n;
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
        /*
         * ★ `rows` 每次都要带上 —— 它是"这次贴哪几行"。
         *
         * 改一张已有的胶带时（`editing`）也带：那张胶带本来就贴在若干行上，
         * 而玩家在抽屉里看到的名字/颜色/清单是**整张胶带**的，
         * 所以"保存"的意思是"这张胶带现在也贴到选中的这些行上"。
         */
        const input: ZoneInput = editing
          ? {
              name: this.name,
              color: this.color,
              categories: this.categories,
              zoneId: editing.id,
              rows: this.rows
            }
          : { name: this.name, color: this.color, categories: this.categories, rows: this.rows };
        /*
         * ★ 两条路分开（见 `ZoneSheetHost.updateZone` 的注释）：
         *  · 有货架上下文（从某一行点进来）→ 走 `apply`，它同时决定"贴到哪几行"；
         *  · 没有（从胶带架轻点进来）→ 只改这张胶带自身，不碰它贴在哪儿。
         *    这时界面上根本没有行选择器，`this.rows` 是"不知道"，
         *    拿它去 `apply` 只会把胶带贴到玩家没看见的地方。
         */
        const done =
          shelfId === null
            ? editing !== null
              ? this.host.updateZone(editing.id, {
                  name: this.name,
                  color: this.color,
                  categories: this.categories
                })
              : false
            : this.host.apply(shelfId, input);
        if (done) this.close();
        return;
      }
      case 'row': {
        /*
         * 切换某一行选没选中。
         *
         * ★ 只切选中态、**不重建 DOM** —— 与改色、改清单同一个坑：
         * 重建会把输入框的焦点与手机上的键盘顶掉。
         */
        const row = Number(hit.dataset['row']);
        if (!Number.isInteger(row)) return;
        this.rows = this.rows.includes(row)
          ? this.rows.filter((r) => r !== row)
          : [...this.rows, row].sort((a, b) => a - b);
        hit.classList.toggle('is-on', this.rows.includes(row));
        this.syncRowSummary();
        return;
      }
      case 'rows-all': {
        const shelf = this.host.getShelves().find((s) => s.id === shelfId);
        if (!shelf) return;
        this.rows = Array.from({ length: shelf.h }, (_, r) => r);
        this.root.querySelectorAll<HTMLElement>('[data-zone-act="row"]').forEach((el) => {
          el.classList.add('is-on');
        });
        this.syncRowSummary();
        return;
      }
      case 'rows-none': {
        this.rows = [];
        this.root.querySelectorAll<HTMLElement>('[data-zone-act="row"]').forEach((el) => {
          el.classList.remove('is-on');
        });
        this.syncRowSummary();
        return;
      }
      case 'cat': {
        const cat = hit.dataset['cat'] as CategoryId | undefined;
        if (!cat) return;
        this.categories = this.categories.includes(cat)
          ? this.categories.filter((c) => c !== cat)
          : [...this.categories, cat];
        // 只切选中态，不重建 DOM —— 否则输入框焦点和键盘会被顶掉（和改色同一个坑）
        this.syncCategoryChips();
        return;
      }
      case 'assign': {
        const zoneId = hit.dataset['zoneId'];
        if (!zoneId) return;
        if (this.host.assign(shelfId, zoneId, this.rows)) this.close();
        return;
      }
      case 'detach': {
        const zone = this.currentZone();
        if (!zone) return;
        /*
         * ★ 撕下的范围 = **选中的那几行**，不是"这一整架"。
         * 一块架子上有两张胶带时，"从这架撕下"是一句会误导的话 ——
         * 所以说法改成按行数，而且数的是**行**（粒度变了）。
         */
        const others = this.usageCount(zone.id) - this.rows.length;
        const rowText = this.rows.length === 1 ? '这一行' : `这 ${this.rows.length} 行`;
        const message =
          others > 0
            ? `从${rowText}撕下「${zone.name}」？另外 ${others} 行还贴着它。`
            : `从${rowText}撕下「${zone.name}」？没有别处用它了，这张胶带会一起撕掉。`;
        if (!window.confirm(message)) return;
        if (this.host.assign(shelfId, null, this.rows)) this.close();
        return;
      }
      default:
        return;
    }
  }

  /**
   * 抽屉里那张胶带（按**当前选中的行**取）。
   *
   * ★ 取第一张选中的行的胶带，而不是整架的第一张 ——
   * 一块架子上有两张胶带时（每张占一行），"这架贴的是什么"没有唯一答案，
   * 而玩家点开抽屉时心里想的是**他刚才点的那一行**。
   */
  private currentZone(): Zone | null {
    if (!this.shelfId) return null;
    const shelf = this.host.getShelves().find((s) => s.id === this.shelfId);
    if (!shelf) return null;
    const row = this.rows.length > 0 ? Math.min(...this.rows) : undefined;
    return findZone(
      this.host.getZones(),
      row !== undefined ? rowZoneId(shelf, row) : firstZoneIdOf(shelf)
    );
  }

  /** 一张胶带的清单，说人话 */
  private ruleText(zone: Zone): string {
    const cats = zone.autoAccept?.categories ?? [];
    // ★ §12 v0.8：空清单不再等于"归位率恒满"。它现在的准确说法是"收什么没写"——
    // 贴了胶带但没写清单，归位率仍然是 0（与"没贴胶带"一样）。
    // 这里不许再写"什么都收"：那句话在数值上已经不成立了
    if (cats.length === 0) return '还没写清单';
    return cats.map((c) => CATEGORY_LABELS[c]).join('/');
  }

  /**
   * 胶囊下方的说明。刻意只说"规则是什么"，不说"你该怎么做" ——
   * §5 引擎①：游戏不评判对错，所以这里连"建议"都不给。
   *
   * ★ 但归位率的**事实**必须说清（§12 v0.8）：没写清单就量不出"有没有按清单放"，
   * 所以归位率是 0。这不是评价，是一条算法口径 —— 不说，玩家只会觉得这个数坏了。
   */
  private categoryNote(): string {
    if (this.categories.length === 0) {
      return '什么都没选。归位率量的是"有没有按自己写的清单放"，所以没写清单时它是 0。';
    }
    return `只收 ${this.categories.map((c) => CATEGORY_LABELS[c]).join(' / ')}。别的东西放上来会点一个小墨点。`;
  }

  /** 只切胶囊的选中态与说明文字，不重建 DOM（重建会把输入框焦点顶掉） */
  private syncCategoryChips(): void {
    this.root.querySelectorAll<HTMLElement>('.cat-chip').forEach((el) => {
      const cat = el.dataset['cat'];
      const on = cat !== undefined && this.categories.includes(cat as CategoryId);
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const note = this.root.querySelector<HTMLElement>('[data-cat-note]');
    if (note) note.textContent = this.categoryNote();
  }

  /**
   * 选中的行数变了之后，把"当前"那一块的说法改掉。
   *
   * ★ 它**不重建 DOM**（与改色、改清单同一个坑：重建会顶掉输入框焦点）。
   * 行选择器自己是靠 `classList.toggle('is-on')` 直接改的，所以这里只管文字。
   *
   * ⚠ 一行都没选时要说清"贴不了"，而不是留一块让人以为还能保存的界面 ——
   * 命令层会 `reject('没选中要贴的行')`，而界面上先说出来更省一次点击。
   */
  private syncRowSummary(): void {
    const note = this.root.querySelector<HTMLElement>('[data-row-summary]');
    if (note) {
      note.textContent =
        this.rows.length === 0
          ? '一行都没选。先在上面点几行，再贴胶带。'
          : `选中的行还没贴胶带。没清单就算不出这些行的归位率。`;
    }
    // 保存按钮在"一行都没选"时禁用 —— §4A：不许有点了没反应的按钮
    const save = this.root.querySelector<HTMLButtonElement>('button[data-zone-act="save"]');
    if (save) {
      const none = this.rows.length === 0;
      save.disabled = none;
      save.title = none ? '先选几行' : '';
    }
  }

  private render(): void {
    const shelves = this.host.getShelves();
    const index = this.shelfId ? shelves.findIndex((s) => s.id === this.shelfId) : -1;
    const shelf = index >= 0 ? (shelves[index] as Shelf) : null;
    /*
     * ★ `shelf === null` 不再是"出错，关掉"：
     * 从**胶带架**上轻点一张胶带进来时，本来就没有"从哪块架子"这回事
     * （那张胶带可能贴在好几块架子上）。那种情况下只渲染**编辑这张胶带**那一半，
     * 与货架有关的两块（"这架贴了几行""贴到哪几行"）整块不画。
     *
     * ⚠ 但"shelfId 有值却找不到那块架子"仍然要关掉 —— 那是**真的出错**
     * （架子被拆了 / 存档坏了），继续画一个指向不存在货架的界面会让人看不懂。
     */
    if (this.shelfId && !shelf) {
      this.close();
      return;
    }
    const zones = this.host.getZones();
    /*
     * 抽屉里那一段"当前"以**选中的第一行**为准。
     * ⚠ 但 `tapeList` 里那个"这架已贴"的标记要按**行**算：
     * 一块架子有两张胶带时，"这架已贴「主食」"是假话（只有两行贴着它）。
     */
    const focusRow = this.rows.length > 0 ? Math.min(...this.rows) : undefined;
    const current =
      shelf === null
        ? null
        : findZone(zones, focusRow !== undefined ? rowZoneId(shelf, focusRow) : firstZoneIdOf(shelf));

    /*
     * 行的选择器。
     *
     * ★ 它是这次改动**唯一新增的交互**，所以做得尽量笨：
     * 一行一个按钮，点一下贴上/取下；外加"全选 / 全不选"两个快捷。
     * 不做拖拽框选、不做长按多选 —— 一块货架最多 4 行，两个按钮就够了，
     * 而更花哨的交互在手机上更容易误触。
     */
    const rowButtons = shelf
      ? Array.from({ length: shelf.h }, (_, row) => {
          const on = this.rows.includes(row);
          const zone = findZone(zones, rowZoneId(shelf, row));
          return `<button class="row-pick${on ? ' is-on' : ''}" data-zone-act="row" data-row="${row}"
        style="--zone:${zone?.color ?? 'transparent'}"
        aria-pressed="${on ? 'true' : 'false'}"
        title="${zone ? `第 ${row + 1} 行现在贴着「${escapeHtml(zone.name)}」` : `第 ${row + 1} 行还没贴`}">
        <span class="row-pick-tape"></span><span class="row-pick-num">第 ${row + 1} 行</span>
        ${zone ? `<span class="row-pick-zone">${escapeHtml(zone.name)}</span>` : ''}
      </button>`;
        }).join('')
      : '';

    const swatches = ZONE_COLORS.map((color) => {
      const active = color === this.color ? ' is-active' : '';
      return `<button class="swatch${active}" data-zone-act="color" data-color="${color}" style="--swatch:${color}" aria-label="${ZONE_COLOR_NAMES[ZONE_COLORS.indexOf(color)] ?? ''}"></button>`;
    }).join('');

    // 7 个品类胶囊。这是全游戏唯一一处"玩家给自己的整理立规矩"的地方，
    // 所以它必须一眼看懂、一次点完 —— 不做成需要展开的下拉或需要滚动的列表。
    const chips = CATEGORY_ORDER.map((cat) => {
      const on = this.categories.includes(cat);
      return `<button class="cat-chip${on ? ' is-on' : ''}" data-zone-act="cat" data-cat="${cat}" aria-pressed="${on ? 'true' : 'false'}">${CATEGORY_LABELS[cat]}</button>`;
    }).join('');

    const tapeList = zones.length
      ? zones
          .map((zone) => {
            const used = this.usageCount(zone.id);
            const isCurrent = current?.id === zone.id || (this.focusZoneId !== null && this.focusZoneId === zone.id);
            // ★ "这里贴了几行"而不是"这架已贴"—— 一块架子可以同时贴两张胶带
            const hereRows = shelf
              ? Array.from({ length: shelf.h }, (_, row) => row).filter(
                  (row) => rowZoneId(shelf, row) === zone.id
                ).length
              : 0;
            const word =
              hereRows > 0
                ? `这架贴了 ${hereRows} 行 · 共 ${used} 行`
                : used > 1
                  ? `${used} 行在用`
                  : used === 1
                    ? '贴着 1 行'
                    : '还没贴在哪儿';
            // 清单必须展示出来：玩家点"贴到这架"之前，得先看得见这张胶带收什么
            return `<button class="tape-slot${isCurrent ? ' is-current' : ''}" data-zone-act="assign" data-zone-id="${zone.id}" style="--zone:${zone.color}">
              <span class="tape-slot-name">${escapeHtml(zone.name)}</span>
              <span class="tape-slot-meta">${word} · ${escapeHtml(this.ruleText(zone))}</span>
            </button>`;
          })
          .join('')
      : '<p class="zone-empty">还没撕过胶带。给它起个名字，贴到选中的行上就行。</p>';

    const currentBlock =
      shelf === null
        ? ''
        : current
          ? `<div class="tape-current" style="--zone:${current.color}">
           <span class="tape-chip">${escapeHtml(current.name)}</span>
           <span class="tape-current-meta">这一行贴着它 · 全屋 ${this.usageCount(current.id)} 行在用 · ${escapeHtml(this.ruleText(current))}</span>
           <button class="mini mini-danger" data-zone-act="detach">撕下来</button>
         </div>`
          : `<p class="zone-empty" data-row-summary>选中的行还没贴胶带。没清单就算不出这些行的归位率。</p>`;

    this.root.innerHTML = `
      <div class="drawer-blocker" data-zone-act="close"></div>
      <div class="drawer-body">
        <header class="drawer-head">
          <h3>${shelf ? `给 ${shelfLabel(shelf, index)} 贴胶带` : '改这张胶带'}</h3>
          <button class="mini" data-zone-act="close">收起</button>
        </header>
        ${currentBlock}
        ${
          shelf
            ? `<div class="field">
                 <span class="field-label">贴到哪几行？
                   <em class="field-hint">一行一段胶带，同一段可以贴多行</em>
                   <span class="row-quick">
                     <button class="mini" data-zone-act="rows-all">全选</button>
                     <button class="mini" data-zone-act="rows-none">全不选</button>
                   </span>
                 </span>
                 <div class="row-picker">${rowButtons}</div>
               </div>`
            : `<p class="block-note">这张胶带贴在哪儿，到货架上拖就行 —— 从上面那条「胶带」栏里把它拖到某一行上。</p>`
        }
        ${
          shelf
            ? `<div class="field">
                 <span>已有胶带（点一下贴到选中的行）</span>
                 <div class="tape-list">${tapeList}</div>
               </div>`
            : ''
        }
        <div class="field">
          <span>${current ? '改这段胶带（改名 / 换色 / 改清单，贴着它的行一起变）' : '撕一段新胶带'}</span>
          <div class="tape-new">
            <input type="text" maxlength="8" placeholder="写上名字，比如 救命层" data-zone-name value="${escapeHtml(this.name)}" />
            <div class="swatches">${swatches}</div>
            <div class="cat-field">
              <span class="cat-label">这张胶带收什么？</span>
              <div class="cat-row">${chips}</div>
              <p class="cat-note" data-cat-note>${escapeHtml(this.categoryNote())}</p>
            </div>
            <button class="btn btn-primary" data-zone-act="save">${current ? '改这段胶带' : this.rows.length === 1 ? '贴到这一行' : `贴到这 ${this.rows.length} 行`}</button>
          </div>
        </div>
      </div>
    `;
    /*
     * ★ 渲染完之后对一次状态：`syncRowSummary` 那个函数负责"一行都没选时
     * 禁用保存按钮"这一条（§4A 不许有点了没反应的按钮）。
     * 它平时是在玩家点行时被调用的，而**首次渲染**这条路不经过点击 ——
     * 不在这里补一次的话，"打开抽屉时本来就一行没选"那个状态会漏掉
     * （那个状态现在到不了：`open()` 默认全选；但它是一个将来会被踩到的坑）。
     */
    this.syncRowSummary();
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
