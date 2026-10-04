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

export interface ZoneSheetHost {
  getShelves(): Shelf[];
  getZones(): Zone[];
  /**
   * 改一张已有胶带**自己**（名字 / 颜色 / 清单），不动"它贴在哪几行"。
   *
   * ★ 抽屉从 2026-10 起是**纯编辑器**，所以这是它唯一的写入路径。
   * 贴到哪一行由**拖拽**决定（见 `OrganizeScreen` 的「胶带架」）。
   */
  updateZone(zoneId: string, input: { name: string; color: string; categories: CategoryId[] }): boolean;
  /**
   * 新建一张胶带（只建，不贴 —— 贴要靠拖）。
   *
   * ⚠ 它**不能**顺手贴到某一行上：抽屉里没有行选择器了，
   * 而"替玩家猜一个落点"正是上一个版本出问题的地方（贴到 0 行 / 贴到过期的那几行）。
   */
  createZone(input: { name: string; color: string; categories: CategoryId[] }): boolean;
  /** 整张删掉（只允许用在"没贴在哪儿"的胶带上，UI 会按这个条件才显示按钮） */
  deleteZone(zoneId: string): boolean;
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
   * @param shelfId 从哪块架子进来（`null` = **从胶带架进来的**）
   * @param rows 从哪一行进来（只用来**认领要编辑的那张胶带**，不再当"选中要贴的行"）
   * @param focusZoneId ★ 直接指定编辑**这张已有的胶带**（从胶带架轻点某一张时）
   *
   * ## 三条入口，一致的语义
   *
   * 抽屉现在是**纯编辑器**（见 `render` 的注释），所以打开时只做一件事：
   * **定下"我在改哪张胶带"**（`editingZone`）。
   *
   *  · 从某一行进来 → 那一行贴着的胶带；
   *  · 从胶带架轻点某一张 → 那一张（它可能贴在好几块架子上）；
   *  · 从「＋」/ 剪刀进来 → `null`，保存时新建。
   *
   * ⚠ `rows` 现在**只用来定位**，不再决定"保存时贴到哪几行" ——
   * 那个决定已经交给拖拽了。这个参数保留是因为"从哪一行点进来的"
   * 仍然是"我要改哪一张"最自然的线索。
   */
  open(shelfId: string | null, rows?: number[], focusZoneId?: string): void {
    this.shelfId = shelfId;
    const shelf = shelfId === null ? null : (this.host.getShelves().find((s) => s.id === shelfId) ?? null);
    /*
     * ★ 打开时认领的是**那一行自己的胶带**，不是"整架的第一张"。
     * 从某一行点进来时，要编辑的是**那一行**贴着的东西 ——
     * 一块架子上有两张胶带时，用整架的视角会认领错那一张。
     */
    const focusRow = rows && rows.length === 1 ? rows[0] : undefined;
    this.editingZone =
      focusZoneId !== undefined
        ? findZone(this.host.getZones(), focusZoneId)
        : shelf === null
          ? null
          : findZone(
              this.host.getZones(),
              focusRow !== undefined ? rowZoneId(shelf, focusRow) : firstZoneIdOf(shelf)
            );
    const zone = this.editingZone;
    this.name = zone?.name ?? '';
    this.color = zone?.color ?? this.pickFreeColor();
    this.categories = [...(zone?.autoAccept?.categories ?? [])];
    /*
     * `rows` 不再被界面使用（抽屉里已经没有行选择器了），清空它 ——
     * 留着会让人以为"它还参与判定"，而那正是上一个版本出问题的地方。
     */
    this.rows = [];
    this.root.hidden = false;
    this.openedAt = Date.now();
    this.render();
    this.pinToVisibleViewport();
    /*
     * ★★ **不要自动聚焦输入框**（2026-10 去掉，这是手机上"闪一下就没了"的元凶）。
     *
     * 这里原来有一句"新建时顺手聚焦，少点一次"。而手机上 `focus()` 会**弹出软键盘**，
     * 键盘把**视觉视口**压扁 —— 而抽屉是贴在视口底部的（`position: fixed` + `bottom: 0`），
     * 于是它在键盘弹起的那一瞬间被顶到可视区外面。玩家看到的正是
     * "闪出来极短的一瞬间然后消失"，而**这一点在桌面上完全看不出来**
     * （桌面没有软键盘）—— 用户的原话："如果我用 f12 换回电脑模式，
     * 那么那个编辑胶带其实是弹出来了的，只不过在小屏上看不到"。
     *
     * 顺带：那一句本来就是我自己加的便利，用户没要求过；
     * 而"少点一次"换"打开之后看不见"显然不划算。要打字就点一下输入框。
     */
  }

  /**
   * 抽屉是**哪一刻**打开的（`Date.now()`；0 = 没开过）。
   *
   * ★★ 它挡的是一个只在手机上出现的时序 bug（2026-10 用户实测）：
   *
   * > "点一下，瞬间弹出来然后消失，之后再点连这个弹出来的一瞬间都没有了，
   * >  但是如果我切回电脑模式再点一下他又能出现"
   *
   * ## 机制：**同一只手指合成了一个 click**
   *
   * 触摸序列是 `pointerdown → pointerup →（浏览器补发）click`。
   * 而"点胶带 → 打开抽屉"发生在 **pointerup** 那一刻 ——
   * 于是紧接着补发的那个 `click` 落到的是**刚刚才盖上来的遮罩**
   * （`.drawer-blocker` 覆盖整屏，而它自己写着 `data-zone-act="close"`）。
   * 结果：打开 → 同一只手指把它关掉。看起来就是"闪一下就没了"。
   *
   * 关掉之后第二次点，因为抽屉已经关了，守卫放行 ——
   * 但第二次同样会被那一发 click 关掉。而**电脑模式下没有合成的 click**，
   * 所以同一个操作在桌面上完全正常。这就是"F12 换回电脑模式就能出现"的原因。
   *
   * ## 修法：打开之后极短的一段时间内不认遮罩的关闭
   *
   * 350ms 是"一次触摸序列的余波"的量级 —— 比它短的连击不算两次操作。
   * ⚠ 只挡**遮罩**（`data-zone-act="close"` 里那个 blocker），
   * 不挡"收起"按钮：玩家手速再快也不至于在 350ms 内去点两处，
   * 而挡错了会让"收起"变成偶尔失灵 —— 那比原 bug 更烦人。
   */
  private openedAt = 0;

  /**
   * 把抽屉钉在**当前可见的那块视口**里。
   *
   * ## 为什么不能只靠 CSS 的 `position: fixed`
   *
   * `fixed` 是相对**布局视口**定位的，而手机上"看得见的那块"是**视觉视口**
   * （`visualViewport`）—— 软键盘弹起、地址栏收放、下拉刷新都会让两者不一样。
   * 那时 `fixed` 的元素会**跑到看得见的地方之外**，而 CSS 里没有任何东西
   * 能表达"我要贴在可见区域底部"。
   *
   * ## 做法
   *
   * 把 `.drawer-body` 从"贴在容器底部"改成**显式给出 top 与高度**，
   * 数值来自 `visualViewport`（拿不到就退回 `innerHeight`，老浏览器/测试环境）。
   * 同时把这个抽屉本身也挪到可见区域的顶部，让遮罩与它对齐。
   *
   * ⚠ 这是**防御性**的（用户在这个 bug 上报过两次）。它自己不会让任何东西出错：
   * 量不到就直接返回，此时 CSS 的值照常生效。
   */
  private pinToVisibleViewport(): void {
    const root = this.root as HTMLElement & { style?: CSSStyleDeclaration };
    if (!root.style) return;
    const body = this.root.querySelector<HTMLElement>('.drawer-body');
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const visibleH = Math.round(vv?.height ?? window.innerHeight);
    const offsetTop = Math.round(vv?.offsetTop ?? 0);
    if (!(visibleH > 0)) return;

    root.style.top = `${offsetTop}px`;
    root.style.bottom = 'auto';
    root.style.height = `${visibleH}px`;
    if (body) {
      /*
       * 最多占可见高度的 58%（与 CSS 里那条 `max-height: 58vh` 同一个口径，
       * 但这里用的是**可见**高度 —— 那才是玩家真正看到的那块）。
       */
      const maxH = Math.round(visibleH * 0.58);
      body.style.maxHeight = `${maxH}px`;
    }
  }

  /** 清掉 `pinToVisibleViewport` 写下的 inline 值（关抽屉时） */
  private unpinViewport(): void {
    const root = this.root as HTMLElement & { style?: CSSStyleDeclaration };
    if (!root.style) return;
    root.style.top = '';
    root.style.bottom = '';
    root.style.height = '';
    const body = this.root.querySelector<HTMLElement>('.drawer-body');
    if (body) body.style.maxHeight = '';
  }

  close(): void {
    if (this.root.hidden) return;
    this.shelfId = null;
    this.rows = [];
    this.unpinViewport();
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
    /*
     * ★★ 这里**只判 `hit`，不判 `this.shelfId`**（2026-10 修）。
     *
     * 原来写的是 `if (!hit || !this.shelfId) return;` —— 而 2026-10 之后
     * 抽屉可以从**胶带架**打开（那时 `shelfId` 是 `null`，因为"从哪块架子进"
     * 对一张跨架子的胶带没有答案）。于是从那条路进来时
     * **抽屉里每一个按钮都失效**：收起、颜色、品类胶囊、保存，全都点不动。
     *
     * 用户的原话："这个东西那个栏位还收不回去（也就是选颜色和名字那个
     * 无法点收回好像跟什么东西冲突卡住了）" —— 不是冲突，是这个 guard
     * 把整块点击处理丢掉了。
     *
     * ⚠ 那条 guard 在"抽屉只从货架打开"的年代是对的（没有 shelfId 就不该有抽屉）。
     * 现在抽屉有**两种打开方式**，所以判据变成"抽屉开着没有" —— 那是 `isOpen`。
     */
    if (!hit || !this.isOpen) return;
    const act = hit.dataset['zoneAct'];

    /*
     * ★★ 刚打开的那一瞬间，**不认遮罩的关闭**（理由见 `openedAt` 的注释）。
     *
     * 手机上"点胶带"会在 `pointerup` 打开抽屉，紧接着浏览器补发一个 `click`，
     * 而它落到的是**刚盖上来的遮罩** —— 于是刚打开就被同一只手指关掉。
     * 桌面没有合成的 click，所以只在小屏上出现。
     *
     * ⚠ 只挡遮罩（`closest('.drawer-blocker')`），不挡"收起"按钮 ——
     * 挡错了会让"收起"偶尔失灵，那比原 bug 更烦人。
     */
    if (
      act === 'close' &&
      hit.classList.contains('drawer-blocker') &&
      // （这个窗口被"临时改成 0"验证过会红 —— 见 tapeShelf.test.ts 的那条 ★★）
      Date.now() - this.openedAt < 350
    ) {
      return;
    }

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
        /*
         * ★★ 保存前**从输入框读一次实时值**。
         *
         * `this.name` 平时靠 `input` 事件跟着输入框走，但那条路只在玩家**打字**
         * 时触发 —— 而"打完字直接点保存"这件事在移动端未必会先派发一个 `input`
         * （软键盘的完成键、或者输入法还在组合中）。那时 `this.name` 还是旧值，
         * 保存就"什么都没改"。
         *
         * 这是实测出来的：`tapeShelf.test.ts` 里那条改名用例，
         * 输入框的值设了、保存点了，而名字没变 —— 因为没人派发 `input`。
         * 真实手机上同类情况（输入法未提交）也会落到这里。
         */
        const liveInput = this.root.querySelector<HTMLInputElement>('input[data-zone-name]');
        if (liveInput) this.name = liveInput.value;
        /*
         * ★★ 抽屉现在是**纯粹的编辑器**（2026-10 用户拍板）。
         *
         * > "有了这个就不需要那个贴标签按钮了"
         *
         * 有了"从胶带架拖到某一行"之后，抽屉里再放一个"贴到选中行"按钮
         * 就是**两条路做同一件事**，而且它们会打架：
         *  · 拖拽那条路的落点由手指决定，玩家看得见；
         *  · 抽屉那条路的落点是"上一次选中的行"，而那个选择在拖拽之后可能已经过期 ——
         *    用户实测到的"显示还是放到这 0 行，按钮点不下去"，就是从这条入口进来时
         *    `rows` 是空的，而 `syncRowSummary` 按 §4A 把按钮禁用了。
         *    禁用本身没错，错的是这条路**不该有那个按钮**。
         *
         * 所以：**贴到哪一行只由拖拽决定**；抽屉只管这张胶带自己（名字/颜色/清单）。
         * 这同时消掉了"保存会不会顺带改位置"那个说不清的中间态。
         */
        const editing = this.editingZone;
        const done = editing
          ? this.host.updateZone(editing.id, {
              name: this.name,
              color: this.color,
              categories: this.categories
            })
          : this.host.createZone({
              name: this.name,
              color: this.color,
              categories: this.categories
            });
        if (done) this.close();
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
      case 'delete': {
        const zone = this.editingZone;
        if (!zone) return;
        const used = this.usageCount(zone.id);
        const message =
          used > 0
            ? `把「${zone.name}」整张撕掉？它现在贴在 ${used} 行上，那些行会变成没贴胶带。`
            : `删掉「${zone.name}」？`;
        if (!window.confirm(message)) return;
        if (this.host.deleteZone(zone.id)) this.close();
        return;
      }
      default:
        return;
    }
  }

  /**
   * 这次在编辑的**那一张**胶带（`null` = 正在新建一张，还没存）。
   *
   * ## 它为什么是一个字段，而不是每次现算
   *
   * 原来叫 `currentZone()`，按"**当前选中的行**"取。那在"抽屉用来分配"的年代
   * 是对的，但 2026-10 之后抽屉是**纯编辑器**（见 `case 'save'`），而"选中哪几行"
   * 这件事已经从抽屉里拿掉了 —— 于是现算的判据（`this.rows`）变成空的，
   * 表现就是用户看到的"显示还是放到这 0 行"。
   *
   * 现在改成**打开时定一次**：谁把我打开的，我就编辑谁。
   *  · 从某一行点进来 → 编辑那一行贴着的胶带；
   *  · 从胶带架轻点某一张 → 编辑那一张（它可能贴在好几块架子上）；
   *  · 从「＋」或剪刀进来 → `null`，保存时新建一张。
   */
  private editingZone: Zone | null = null;

  /**
   * 一张胶带的清单，说人话。
   *
   * ★ §12 v0.8：空清单**不再**等于"归位率恒满"。它现在的准确说法是
   * "收什么没写" —— 贴了胶带但没写清单，归位率仍然是 0（与"没贴胶带"一样）。
   * 这里不许再写"什么都收"：那句话在数值上已经不成立了。
   */
  private ruleText(zone: Zone): string {
    const cats = zone.autoAccept?.categories ?? [];
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
   * 名字空着时禁用保存 —— §4A：不许有点了没反应的按钮。
   *
   * ★ 判据从"选了几行"换成了"**名字写没写**"（2026-10）：
   * 抽屉不再管"贴到哪几行"，而 `editZone` / `applyZone` 都会
   * `reject('给它起个名字')`。界面上先把这件事说出来，省一次点击。
   */
  private syncSaveButton(): void {
    const save = this.root.querySelector<HTMLButtonElement>('button[data-zone-act="save"]');
    if (!save) return;
    const blank = this.name.trim().length === 0;
    save.disabled = blank;
    save.title = blank ? '先给它起个名字' : '';
  }

  /**
   * 渲染抽屉。
   *
   * ★★ 2026-10 起它是**纯粹的编辑器**：只有名字、颜色、清单，加一个保存/删除。
   *
   * 被删掉的三块（以及为什么）：
   *  · **行选择器**（"贴到哪几行" + 全选/全不选）—— 用户说"有了这个就不需要那个
   *    贴标签按钮了"。贴到哪一行现在**只由拖拽决定**，落点看得见；而抽屉里
   *    那条路上的落点是"上一次选中的行"，拖完之后就过期了 ——
   *    用户实测到的"显示还是放到这 0 行，而那个按钮点不下去"就是这个过期状态
   *    （`rows` 空了 → `syncRowSummary` 按 §4A 禁用按钮。禁用没错，错的是不该有它）；
   *  · **"已有胶带"列表**（点一下贴到选中的行）—— 同上，那是第二条分配路。
   *    要换一张贴在别处，去架子上拖；
   *  · **"撕下来"按钮** —— 撕的动作在剪刀上（拖到行上撕一行、拖到整块卡上清一架）。
   *
   * 留下的是"这张胶带收什么"这一格 —— 那是**全游戏唯一一处玩家给自己的整理立规矩的地方**，
   * 它必须一眼看懂、一次点完（7 个品类胶囊，不做下拉、不做滚动列表）。
   */
  private render(): void {
    const shelves = this.host.getShelves();
    const index = this.shelfId ? shelves.findIndex((s) => s.id === this.shelfId) : -1;
    const shelf = index >= 0 ? (shelves[index] as Shelf) : null;
    /*
     * `shelfId` 有值却找不到那块架子 = **真的出错**（架子被拆了 / 存档坏了），
     * 关掉抽屉。而 `shelfId` 为 `null` 是正常情况（从胶带架进来），不关。
     */
    if (this.shelfId && !shelf) {
      this.close();
      return;
    }
    const zone = this.editingZone;
    const used = zone ? this.usageCount(zone.id) : 0;

    const swatches = ZONE_COLORS.map((color) => {
      const active = color === this.color ? ' is-active' : '';
      return `<button class="swatch${active}" data-zone-act="color" data-color="${color}" style="--swatch:${color}" aria-label="${ZONE_COLOR_NAMES[ZONE_COLORS.indexOf(color)] ?? ''}"></button>`;
    }).join('');

    const chips = CATEGORY_ORDER.map((cat) => {
      const on = this.categories.includes(cat);
      return `<button class="cat-chip${on ? ' is-on' : ''}" data-zone-act="cat" data-cat="${cat}" aria-pressed="${on ? 'true' : 'false'}">${CATEGORY_LABELS[cat]}</button>`;
    }).join('');

    /*
     * 这一张现在贴在几行上、收什么 —— 它是**信息**，不是操作。
     * 玩家改名字之前该看得见"这张影响几行、收哪几类"，
     * 而"改了之后贴在哪"由上一条（拖拽）决定。
     */
    const where =
      !zone
        ? `<p class="block-note">保存之后，到上面那条「胶带」栏里把它拖到某一行上，才算贴上。</p>`
        : used === 0
          ? `<p class="block-note">这张胶带现在**没贴在哪儿** —— 从上面那条「胶带」栏里拖到某一行上就行。</p>`
          : `<p class="block-note">现在贴在 <b>${used}</b> 行上（收 ${escapeHtml(this.ruleText(zone))}），那些行会一起跟着改。</p>`;

    this.root.innerHTML = `
      <div class="drawer-blocker" data-zone-act="close"></div>
      <div class="drawer-body">
        <header class="drawer-head">
          <h3>${zone ? `改「${escapeHtml(zone.name)}」` : '新胶带'}</h3>
          <button class="mini" data-zone-act="close">收起</button>
        </header>
        ${where}
        <div class="field">
          <span>名字与颜色</span>
          <div class="tape-new">
            <input type="text" maxlength="8" placeholder="写上名字，比如 救命层" data-zone-name value="${escapeHtml(this.name)}" />
            <div class="swatches">${swatches}</div>
            <div class="cat-field">
              <span class="cat-label">这张胶带收什么？</span>
              <div class="cat-row">${chips}</div>
              <p class="cat-note" data-cat-note>${escapeHtml(this.categoryNote())}</p>
            </div>
            <div class="tape-actions">
              <button class="btn btn-primary" data-zone-act="save">${zone ? '保存' : '建这张胶带'}</button>
              ${zone && used === 0 ? '<button class="mini mini-danger" data-zone-act="delete">删掉</button>' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
    // 名字空着时禁用保存 —— §4A：不许有点了没反应的按钮
    this.syncSaveButton();
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
