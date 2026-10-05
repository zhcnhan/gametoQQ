/**
 * 极小的 DOM 假体，只够驱动 `ui/drag.ts` 与 `OrganizeScreen` 的手势路径。
 *
 * ## 为什么不用 jsdom
 *
 * 项目**零依赖**是明文纪律，而 vitest 的 DOM 环境（jsdom / happy-dom）要额外装包。
 * 更要紧的是：这些测试要验的不是"浏览器会怎么渲染"，而是**手势状态机的行为** ——
 * 事件有没有被收掉、幽灵有没有被摘掉、落点算出来是哪一格。
 * 那些事情只用到 `addEventListener` / `classList` / `dataset` / `getBoundingClientRect`，
 * 自己写一百行假体比引一整个 DOM 实现更可控（而且**能精确构造异常时序**，
 * 比如"pointerup 永远不到" —— 真的浏览器里这个很难稳定复现）。
 *
 * ## 能力边界（写测试时必须知道）
 *
 *  · **没有布局**：`getBoundingClientRect` 返回的是你显式 set 的矩形（默认 0,0,0,0）。
 *    要测"落点判定"，得先给元素摆好位置 —— 见 `layoutGrid`。
 *  · **不解析 CSS**：`:hover`、`@media` 一律不生效，`classList` 只是字符串集合。
 *  · `elementFromPoint` 由 `FakeDocument` 按"最靠上、含该点"的元素自己做一次命中测试。
 *    ★ 它**对任何元素都通用**（早期注释里写的"只认 `data-slot`"是过期的：
 *    实现走的是"有非零矩形 + 不是 `pointer-events: none`"，与选择器无关）。
 *    但假体不做布局，所以**测之前要自己把矩形摆好**（`layoutGrid` 或直接设 `rect`）——
 *    否则每个元素都是 0×0，命中测试永远返回 `null`，落点断言全在验空气。
 *  · `closest` 只支持 `[attr]` / `[attr="v"]` / 标签名 / 类名这几种简单选择器。
 */

export interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

class FakeClassList {
  private readonly set = new Set<string>();
  constructor(initial = '') {
    for (const c of initial.split(/\s+/)) if (c) this.set.add(c);
  }
  add(...names: string[]): void {
    for (const n of names) this.set.add(n);
  }
  remove(...names: string[]): void {
    for (const n of names) this.set.delete(n);
  }
  contains(name: string): boolean {
    return this.set.has(name);
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  get value(): string {
    return [...this.set].join(' ');
  }
}

export class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly classList: FakeClassList;
  readonly dataset: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  /**
   * 假 style：既当字典读，也支持 setProperty / getPropertyValue。
   * OrganizeScreen 会 el.style.setProperty('--zone', color) 之类，缺了它整屏渲染就炸。
   */
  readonly style: Record<string, string> & {
    setProperty(name: string, value: string): void;
    getPropertyValue(name: string): string;
    removeProperty(name: string): void;
  } = Object.assign(Object.create(null) as Record<string, string>, {
    setProperty(this: Record<string, string>, name: string, value: string) {
      this[name] = value;
    },
    getPropertyValue(this: Record<string, string>, name: string) {
      return this[name] ?? '';
    },
    removeProperty(this: Record<string, string>, name: string) {
      delete this[name];
    }
  });
  ownerDocument!: FakeDocument;
  rect: FakeRect = { left: 0, top: 0, width: 0, height: 0 };
  /**
   * ★★ 滚动位置（2026-10 补），**并且带真实浏览器的夹取**（同月第二次补）。
   *
   * ## 第一版为什么不够
   *
   * 第一版就是一个普通字段（`scrollTop = 0`）。于是 `drag.ts` 里那句
   * `node.scrollTop = before + left` 在"已经滚到头"时**照样会写进去** ——
   * 假体说 `scrollTop = -60`，真实浏览器说 `0`。两个后果：
   *
   *  ① `takeOverScroll` 里那套"滚到头就接力给外层容器"的逻辑**验不到**
   *     （它靠 `scrollTop` 没动来发现"这一层到头了"）；
   *  ② 更贵的一个：`left -= node.scrollTop - before` 里的 `left` 减不掉，
   *     于是外层的 `while (node && Math.abs(left) > 0.01)` **停不下来** ——
   *     每次都往上找一层、写一次、再往上找，直到把 `documentElement` 写穿。
   *     实测的形态是**整个测试进程 4GB 堆崩掉**（不是某条用例红），
   *     而报错信息（`Worker exited unexpectedly` / `JavaScript heap out of memory`）
   *     **一个字都不提滚动**。
   *
   * 真实浏览器里 `scrollTop` 是可写但**会被夹取**的：负值归 0，
   * 超过 `scrollHeight - clientHeight` 归那个上界。假体照做，
   * 于是"滚到头"这件事在单测里与在手机上一样**看得见**。
   *
   * ⚠ 它必须**定义在 `scrollHeight` / `clientHeight` 之后**：夹取要用那一对，
   *   而它们是构造时用 `Object.defineProperty` 装的（见下面那段），
   *   普通字段的初始化顺序在构造函数体**之前**，写在类字段区会拿到 `undefined`。
   */
  scrollTop = 0;
  /**
   * 内容高度 / 可视高度（同上，2026-10 补）。
   *
   * 它们决定"滚到头了没有" —— `takeOverScroll` 靠这一对判断，
   * 于是用例可以摆出"内容比容器高"（能滚）与"一样高"（滚不动）两种局面。
   * 默认取 `rect.height`（也就是"内容正好塞满"，滚不动），
   * 要测滚动就显式写大它。
   */
  scrollHeight = 0;
  clientHeight = 0;
  /**
   * 这个元素自己的 `pointer-events`（默认 `auto`，也就是"接受"）。
   *
   * 假体不解析 CSS，所以这里由测试**显式设置** —— 需要在测试里构造
   * "某个覆盖层挡住了底下元素"这种局面时，把它设成 `'none'` 即可。
   */
  pointerEvents: 'auto' | 'none' = 'auto';
  /** 记录所有被派发过来的事件类型，测试用它断言"幽灵被摘了"之类 */
  readonly log: string[] = [];
  textContent = '';
  disabled = false;
  title = '';
  private readonly listeners = new Map<string, Set<(e: unknown) => void>>();
  private captured: number | null = null;

  constructor(tagName = 'div', className = '') {
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList(className);
    /*
     * ★ `scrollHeight` / `clientHeight` 默认跟着 `rect` 走（见上面那段）：
     * 用 `Object.defineProperty` 而不是普通字段，是为了让 `place()` 之后
     * 这两个数**自动跟上**（假体的尺寸几乎都是 `place()` 给的）。
     * 用例一旦显式写过它们（`el.scrollHeight = 900`），就以显式值为准。
     */
    for (const key of ['scrollHeight', 'clientHeight'] as const) {
      let explicit: number | null = null;
      Object.defineProperty(this, key, {
        get: () => explicit ?? this.rect.height,
        set: (v: number) => {
          explicit = v;
        },
        enumerable: true,
        configurable: true
      });
    }
    /*
     * ★ `scrollTop` 在这里换成"可写 + 夹取"的版本（理由见字段区那一大段）。
     * 夹取边界与 `atScrollEnd` 用的是同一对量（`scrollHeight - clientHeight`）。
     */
    let top = 0;
    Object.defineProperty(this, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        top = v < 0 ? 0 : v > max ? max : v;
      },
      enumerable: true,
      configurable: true
    });
  }

  get className(): string {
    return this.classList.value;
  }
  set className(value: string) {
    for (const c of [...this.classList.value.split(' ').filter(Boolean)]) this.classList.remove(c);
    for (const c of value.split(/\s+/)) if (c) this.classList.add(c);
  }

  /**
   * ★★ 序列化**当前**子树（不是"我上次被设成了什么"）。
   *
   * ## 这个 getter 原来只是把 `_html` 原样吐回去，那是一处很坏的假体缺陷
   *
   * `OrganizeScreen` 的写法是"整屏写成一个字符串，其中留几个空 host
   * （`<div data-boxes></div>`），挂载后再 `host.innerHTML = ...` 填内容"。
   * 而旧 getter 返回的是**构造时那个字符串**（host 还是空的），于是：
   *
   * ```ts
   * root.innerHTML.includes('还没拆的箱子')   // ← 假体说 false，浏览器里明明有
   * ```
   *
   * 它是 2026-10 做"纸箱栏可折叠"时被找出来的（第 4 个假体缺陷，前三个见
   * `isConnected` / `dispatch` 不冒泡 / 布尔属性）。真正危险的方向是**反过来**：
   * 断言"某段文字**不该**出现"时，旧 getter 会因为"静态模板里本来就没有它"
   * 而**通过** —— 一条永远绿的守卫，比一条红的守卫坏得多。
   *
   * 所以现在按真实语义走一遍树：属性照写、子元素递归、直接文本段保留
   * （与 `parseHtml` 的读取口径一致 —— 它不做文本节点，只存"这一段直接文本"）。
   */
  get innerHTML(): string {
    return this.children.map((child) => serializeEl(child)).join('');
  }
  /**
   * 最近一次被赋的原始字符串。
   *
   * ★ 它**只在两个地方**还该被读：① `parseHtml` 的往返自检；
   * ② 想确认"这段 HTML 里有没有某个**静态**片段"（比如"这个 host 在模板里存在"）。
   * **凡是想问"屏幕上现在有没有这几个字"，用 `innerHTML`（序列化）或选择器** ——
   * 用这个字段会得到"模板里写没写"，那是另一个问题。
   */
  get rawHtml(): string {
    return this._html;
  }
  private _html = '';
  set innerHTML(value: string) {
    this._html = value;
    for (const child of [...this.children]) {
      child.parent = null;
      this.ownerDocument?.unregisterSubtree(child);
    }
    this.children.length = 0;
    if (value && this.ownerDocument) parseHtml(value, this.ownerDocument, this);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    this.ownerDocument?.register(child);
    return child;
  }

  remove(): void {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
    this.ownerDocument?.unregisterSubtree(this);
    this.parent = null;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    this.log.push(type);
    const e = { type, target: this, preventDefault: () => undefined, ...event };
    /*
     * ★★ 沿父链**冒泡**（2026-10 补，`ui/drag.ts` 改用事件委托之后必须有它）。
     *
     * ## 为什么这不是"顺手加个功能"，而是假体在骗人
     *
     * 原来这里只跑自己的监听器。于是"手势挂在整块区域上、靠 `e.target.closest()`
     * 找到格子"这种写法（`.room-scroll` 上挂一次、`selector: '[data-slot]'`）
     * 在假体里**永远收不到事件** —— 格子上按下去，容器上的监听器一声不响。
     * 而它在真浏览器里是对的：**没有冒泡的 DOM 不是 DOM 的近似，是另一个东西**。
     *
     * ⚠ 两个必须保持的语义：① `target` 始终是**最初派发的那个元素**（不是
     * 冒泡途中的祖先）—— `closest` 全靠它；② 父链到顶就停（假体没有 document 级
     * 派发，`window` 上的监听器由 `FakeWindow.dispatch` 单独负责）。
     */
    let node: FakeElement | null = this;
    while (node) {
      for (const fn of [...(node.listeners.get(type) ?? [])]) fn(e);
      node = node.parent;
    }
  }

  /** 手势层用到的那两个方法；记录调用以便断言"捕获确实拿了/放了" */
  setPointerCapture(id: number): void {
    this.captured = id;
    this.log.push(`capture:${id}`);
  }
  hasPointerCapture(id: number): boolean {
    return this.captured === id;
  }
  releasePointerCapture(id: number): void {
    if (this.captured === id) this.captured = null;
    this.log.push(`release:${id}`);
  }

  /**
   * ★ 父元素（2026-10 补，`ui/drag.ts` 的滚动接管要用它往上找容器）。
   *
   * ## 为什么这是一个**必须补**的成员，而不是可以绕开的细节
   *
   * 假体里一直只有 `parent`（`appendChild` 会设它）。差一个字母，成本却是：
   * `drag.ts` 的 `resolveScrollHost` 从手指底下的格子往上找
   * `data-scroll-host` 时，第一跳就拿到 `undefined` → 返回 `null` →
   * **"接管滚动"整条分支在单测里一次都没跑过**，
   * 而它看起来只是"那个用例的断言写错了"（四个用例一起报"滚了 0 像素"）。
   *
   * ⚠ 返回 `null` 而不是 `undefined`：真实 DOM 里没有父节点就是 `null`，
   * 而两处的写法（`while (node)`）对两者都能停 —— 但 `=== null` 这种断言
   * 在假体与浏览器里会给出不同的答案，那正是假体最不该制造的分歧。
   */
  get parentElement(): FakeElement | null {
    return this.parent ?? null;
  }

  getBoundingClientRect(): FakeRect {
    return this.rect;
  }

  /**
   * 属性名列表。有些渲染辅助会遍历它来决定要不要写某个属性，
   * 缺了会以 `element.getAttributeNames is not a function` 的形式炸出来。
   */
  getAttributeNames(): string[] {
    return Object.keys(this.attributes);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  /**
   * ★ 属性在不在（2026-10 补）。
   *
   * 补它的理由与 `removeAttribute` 那条同源：**缺一个成员的成本不是报错，
   * 而是被测代码里某条分支静静地验不到**。
   * 这一处具体是：`ui/drag.ts` 找滚动容器时问的是"这个元素有没有
   * `data-scroll-host`"（纯"在不在"，与值无关），而假体没有 `hasAttribute`
   * 就只有 `getAttribute(...) !== null` 一种写法 —— 那要求产品代码为假体改变
   * 自己的写法，方向反了。
   */
  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    const camel = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    this.dataset[camel] = value;
  }

  /**
   * ★ 摘掉一个属性（2026-10 补，`toggleAttribute` 用它）。
   *
   * 补它的原因值得记：`setAttribute` 从假体第一天就有，而 `removeAttribute`
   * 一直缺着 —— 于是"产品代码想在 JS 里开关一个布尔属性"这件事**没有写法**
   * （`el.hidden = true` 那种属性赋值在假体上静默无效，见 `BOOLEAN_ATTRS`
   * 的注释），屏幕级测试也就永远验不到那条分支。
   * 缺一个成员的成本不是报错，而是被测代码里某条分支静静地验不到。
   */
  removeAttribute(name: string): void {
    delete this.attributes[name];
    const camel = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    delete this.dataset[camel];
  }

  /**
   * 开关一个属性。
   *
   * ★ 口径与真 DOM 对齐：属性**在不在**就是全部信息，所以 `force === true` 时
   * 写进属性表的空串（不是 `'true'`）。第一版写成 `'true'` 的话，
   * 断言里就得比 `'true'` —— 而真浏览器把裸属性读回来是 `''`，
   * 两边对不上，屏幕级测试会开始验一个真机上不存在的东西。
   */
  toggleAttribute(name: string, force?: boolean): boolean {
    const on = force ?? !(name in this.attributes);
    if (on) this.attributes[name] = '';
    else delete this.attributes[name];
    return on;
  }

  /** 手动摆位置（假体没有布局引擎） */
  place(left: number, top: number, width: number, height: number): this {
    this.rect = { left, top, width, height };
    return this;
  }

  /** 元素中心点 */
  get center(): { x: number; y: number } {
    return { x: this.rect.left + this.rect.width / 2, y: this.rect.top + this.rect.height / 2 };
  }

  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.rect.left && x <= this.rect.left + this.rect.width && y >= this.rect.top && y <= this.rect.top + this.rect.height
    );
  }

  /** 自己 + 后代（深度优先），用于 `closest` / 命中测试 */
  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      for (const c of el.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  /**
   * 自己是不是还挂在文档上（沿 `parent` 链走到 `documentElement`）。
   *
   * ★ 这个成员是**被一次静默失效找出来的**（W-02 的屏幕级守卫）：
   * `OrganizeScreen.moveGhostTo` 里有一句"幽灵已被某次重绘丢掉就当它不存在"——
   * `if (ghost.isConnected === false) { this.ghost = null; return; }`，
   * 而假体**没有这个成员** → `undefined === false` 恒为假 → 那条清理逻辑
   * 在屏幕级测试里**一次都没生效过**，真实浏览器里却是有效的。
   *
   * 教训：假体缺一个成员，代价不是"报错"，而是被测代码里某条分支**静静地不跑**。
   */
  get isConnected(): boolean {
    let cur: FakeElement | null = this;
    while (cur !== null) {
      if (cur === this.ownerDocument?.documentElement) return true;
      cur = cur.parent;
    }
    return false;
  }

  /**
   * `other` 是不是自己或自己的后代（真实 DOM 的 `Node.contains`）。
   *
   * ★★ 补它是因为一次**真机与单测给出不同答案**的缺陷（2026-10，委托手势那一批）：
   * `drag.ts` 的 `gestureActiveOn(el)` 要判"这个元素是不是正被拖着的那一个"，
   * 写成 `g.delegate === el || g.delegate.contains(el) || el.contains(g.delegate)`。
   * 真实浏览器里三支都成立；而假体**没有 `contains`** → `g.delegate.contains` 是
   * `undefined` → 调用即 `TypeError`，表现是"长按守卫那条用例崩在一个和它无关的栈上"。
   *
   * ⚠ 别把它和 `classList.contains(name)` 弄混 —— 那个在 `classList` 上，收一个类名。
   */
  contains(other: FakeElement | null): boolean {
    let cur: FakeElement | null = other;
    while (cur !== null) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }

  /**
   * 真浏览器会把元素滚进视野（`Element.scrollIntoView`）。
   *
   * ★★ 补它是因为一条"**点货架标题打开抽屉**"的用例（2026-10，删掉那枚多余的
   * 「胶带」按钮时加的守卫）：`OrganizeScreen.openZoneDrawer` 在打开抽屉前会把
   * 那一块货架卡滚进视野（`card.scrollIntoView({ block: 'start' })`），
   * 而假体**没有这个成员** → `TypeError: card.scrollIntoView is not a function`。
   *
   * 表现很误导：栈顶指在**打开抽屉**那一行，看起来像"点标题打不开抽屉"，
   * 而门其实是通的 —— 只是走到"滚动"这一步才崩。
   *
   * ⚠ 假体**不做布局**，所以这里无事可做，但这个方法必须**存在**：
   * 缺一个成员的代价从来不是"报错"，而是被测代码里某条分支静静地不跑
   * （见上面 `isConnected` 那段）。这一次它选择了报错，那是运气好。
   */
  scrollIntoView(_arg?: boolean | ScrollIntoViewOptions): void {
    // 无布局可滚：真的什么都不用做
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this;
    while (cur) {
      if (matchesAny(cur, selector)) return cur;
      cur = cur.parent;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((el) => matchesAny(el, selector));
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** 把选择器拆成"必须同时满足"的简单选择器列表 */
function parseSelector(selector: string): string[] {
  /*
   * ★ `[data-slot][data-shelf="x"]` 这类**紧挨着**的多个条件是"与"关系，
   * 不是后代选择器。第一版按空格分词，于是它被当成"[data-slot] 里面有 [data-shelf]"，
   * 一个都匹配不到（自检测出来的）。这里只在**真·后代组合符**（空格）
   * 两边都是独立简单选择器时才……其实本项目用不到后代选择器，
   * 所以直接按"中括号块 / 类 / 标签"切分、全部要求满足 —— 更简单也不会错。
   */
  const parts: string[] = [];
  const re = /\[[^\]]+\]|\.[\w-]+|[a-zA-Z][\w-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector)) !== null) parts.push(m[0]);
  return parts;
}

/**
 * 逗号分组的选择器是否命中。
 *
 * ★ 这一层是 M3 补的，补的是一个**静默**的坑：
 * `parseSelector` 会把 `[data-page], [data-action]` 拆成 `['[data-page]', '[data-action]']`，
 * 而 `matches(...)` 被 `every` 用来要求**全部命中** —— 于是那串选择器
 * 要求元素**同时**有 `data-page` 和 `data-action`，一个都不命中。
 *
 * 后果不是"选择器严格"，而是**事件委托彻底失灵**：界面里
 * `target.closest('[data-page], [data-action]')` 永远返回 null，
 * 于是图鉴翻页与「返回」都点不动 —— 而**假体不报错**，只有人去看才发现。
 * （真实浏览器里逗号是"或"，这是 CSS 的基本语义。）
 *
 * 所以逗号在 `every` **之前**分组：任一组全命中即算命中。
 */
function matchesAny(el: FakeElement, selector: string): boolean {
  return selector
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group.length > 0)
    .some((group) => parseSelector(group).every((p) => matches(el, p)));
}

/** 一个简单选择器是否命中该元素 */
function matches(el: FakeElement, part: string): boolean {
  if (part.startsWith('[')) {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
    if (!m) return false;
    const key = m[1] as string;
    const want = m[2];
    // HTML 属性名 data-shelf-card → dataset 键 shelfCard
    const camel = key.replace(/^data-/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const has = key in el.attributes || camel in el.dataset;
    if (!has) return false;
    if (want !== undefined) {
      const actual = el.attributes[key] ?? el.dataset[camel] ?? '';
      if (actual !== want) return false;
    }
    return true;
  }
  if (part.startsWith('.')) return el.classList.contains(part.slice(1));
  return el.tagName === part.toUpperCase();
}

export class FakeDocument {
  readonly body: FakeElement;
  readonly documentElement: FakeElement;
  private readonly all: FakeElement[] = [];
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  constructor() {
    this.documentElement = new FakeElement('html');
    this.body = new FakeElement('body');
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.all.push(this.documentElement, this.body);
  }

  register(el: FakeElement): void {
    if (!this.all.includes(el)) this.all.push(el);
  }
  unregister(el: FakeElement): void {
    const i = this.all.indexOf(el);
    if (i >= 0) this.all.splice(i, 1);
  }
  /** 把一个元素连同它的整棵子树从"文档里所有元素"的索引中摘掉 */
  unregisterSubtree(root: FakeElement): void {
    for (const el of [root, ...root.descendants()]) this.unregister(el);
  }

  createElement(tag: string): FakeElement {
    const el = new FakeElement(tag);
    /*
     * ★ 必须在这里就设上 `ownerDocument`。
     * `innerHTML` 的解析有 `if (this.ownerDocument)` 守卫，而这个守卫依赖它 ——
     * 第一版只在 `appendChild` 里设，于是用 `doc.createElement('div')` 造出来的根元素
     * **永远解析不了自己的 innerHTML**，命中测试一返回 `null`，所有落点断言都在验空气。
     */
    el.ownerDocument = this;
    return el;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type, preventDefault: () => undefined, ...event });
  }

  querySelectorAll(selector: string): FakeElement[] {
    const parts = parseSelector(selector);
    return this.all.filter((el) => parts.every((p) => matches(el, p)));
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /**
   * 命中测试：所有**可见**（有非零矩形）且含该点、且**接受指针事件**的元素里，
   * 取**最深**的那个 —— 这就是真浏览器 `elementFromPoint` 的语义。
   *
   * ★ 两条都是被真实 bug 逼出来的：
   *
   *  1. **从文档树遍历**，而不是查那个扁平的手工索引 `all`。
   *     第一版查 `all`，于是 `innerHTML = ...` 重建整间房之后新元素从没被登记，
   *     命中测试永远返回 `null`，所有"落点"断言都在验空气；
   *  2. **尊重 `pointer-events: none`**。玩家报过一个很反直觉的现象：
   *     "把 A 正正好好放在 B 上反而判定不到、边缘一圈才能交换" ——
   *     根因就是拖拽幽灵跟着指针、正好在指针底下，而它当时**是可命中的**，
   *     于是命中测试拿到的是幽灵而不是格子。
   *     假体不模拟这一条，就永远发现不了这类 bug。
   */
  elementFromPoint(x: number, y: number): FakeElement | null {
    let best: FakeElement | null = null;
    let bestDepth = -1;
    const consider = (el: FakeElement, depth: number): void => {
      // 不接受指针事件 → 它和整棵子树都跳过
      if (this.pointerEventsOf(el) === 'none') return;
      /*
       * 平局用 `>=`：先访问到的是**文档里靠前**的元素，靠后的应当盖住它。
       * 这是"绘制顺序"的粗略近似 —— 真实浏览器按 z-index / 层叠上下文决定，
       * 这里只做"深度优先 + 后者胜"，对"幽灵 vs 格子"这类场景够用。
       */
      if (el.containsPoint(x, y) && el.rect.width > 0 && el.rect.height > 0 && depth >= bestDepth) {
        best = el;
        bestDepth = depth;
      }
      for (const child of el.children) consider(child, depth + 1);
    };
    consider(this.documentElement, 0);
    return best;
  }

  /**
   * 这个元素在接受指针事件吗？
   *
   * ★ `pointer-events` **不是继承属性**（初始值就是 `auto`）—— 这一点很容易搞错，
   * 我第一版就写成了"沿祖先链找 `none`"，结果子元素永远被父元素的 `none` 吃掉，
   * 反向对照那条断言因此失败。
   *
   * 正确语义（也是那个真实 bug 的机制）：
   *  · 元素自己**显式**设了值 → 就用它；
   *  · 元素自己**没设** → 它默认就是 `auto`，**父元素的 `none` 管不到它**。
   *
   * 所以 `.fx-layer { pointer-events: none }` 并不能让 `.drag-ghost` 免于命中 ——
   * 幽灵必须**自己**写 `pointer-events: none`。玩家报的
   * "正正好好放在 B 上反而判定不到"就是这个。
   */
  pointerEventsOf(el: FakeElement): 'none' | 'auto' {
    return el.pointerEvents;
  }
}

export interface FakeWindow {
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
  dispatch(type: string, event: Record<string, unknown>): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
  /**
   * 推进**假时钟 + 假定时器 + 假动画帧**。
   *
   * ★ 它必须同时接管 `Date.now()`，否则会有"测不到的地方"：
   * `drag.ts` 的看门狗用 `Date.now() - lastSeenAt` 判断"指针事件是不是断了"，
   * 而真实时钟在单测里几乎不动 —— 于是那段时间逻辑**没法被测**，
   * 只能靠读代码确认。这个假窗把 `Date.now` 也接管了（见 `installFakeWindow`）。
   *
   * ★★ 动画帧（rAF）在**时钟推到目标之后**跑，每个 tick 最多 240 帧。
   * 惯性滚动正是靠它推的：`tick(16)` = 一帧。上限存在的理由是"帧会自己再排一帧"
   * —— 一个不收尾的惯性能把用例挂死，所以宁可让它跑 240 帧后停手，
   * 也不能让 `tick` 变成死循环。
   */
  tick(ms: number): void;
  now(): number;
  listenerCount(type: string): number;
}

/** 装到 globalThis 上的可控时钟 */
export function installFakeClock(): void {
  const realNow = Date.now;
  let fake = 1_700_000_000_000;
  (globalThis as unknown as Record<string, unknown>)['__fakeNow'] = () => fake;
  (globalThis as unknown as Record<string, unknown>)['__advanceFakeNow'] = (ms: number) => {
    fake += ms;
  };
  Date.now = () => fake;
  void realNow;
}

/**
 * 假体里**唯一**的那个时钟（`installFakeClock` 装上去的那个）。
 *
 * ★★ 假体里所有跟时间有关的地方都必须读它：`setTimeout` 排期、`tick()` 判"到点了没有"、
 * `win.now()`。曾经 `setTimeout` 用的是假 window 自己的一个计数器（起点 0），
 * 而 `Date.now()` 用的是这个（起点 `1700000000000`）—— 两个起点差了整整一个纪元，
 * 于是 `at <= now` 里的 `at` 看着像"未来 500 年"，**每一个定时器都不会到点**：
 * 长按永远不成立、看门狗永远不看一眼，而用例红在"`dragStart` 没出现"这种
 * 和时钟毫不相干的断言上（那次就是这样查了一整轮）。
 */
function fakeClock(): number {
  const fn = (globalThis as unknown as Record<string, unknown>)['__fakeNow'];
  return typeof fn === 'function' ? (fn as () => number)() : 0;
}

/** 造一个假 window，并把它装到 globalThis 上（`drag.ts` 直接引用 window/setTimeout） */
export function installFakeWindow(document: FakeDocument): FakeWindow {
  installFakeClock();
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  interface Timer {
    at: number;
    fn: () => void;
    every: boolean;
    /** 重复定时器的间隔（毫秒）；非重复为 0 */
    everyMs: number;
    id: number;
  }
  const timers: Timer[] = [];
  let now = 0;
  let nextId = 1;

  const win: FakeWindow & Record<string, unknown> = {
    addEventListener(type, fn) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, preventDefault: () => undefined, ...event });
    },
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.push({ at: fakeClock() + ms, fn, every: false, everyMs: 0, id });
      return id;
    },
    clearTimeout(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      timers.push({ at: fakeClock() + ms, fn, every: true, everyMs: ms, id });
      return id;
    },
    clearInterval(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    tick(ms) {
      const nowFn = (globalThis as unknown as Record<string, unknown>)['__advanceFakeNow'];
      const advance = typeof nowFn === 'function' ? (nowFn as (n: number) => void) : null;
      /*
       * ★★ 先把本地时钟**对齐到那一个唯一的时钟**（2026-10 修，代价是单测全红）。
       *
       * 这里曾经有一个自己的计数器 `let now = 0`，而 `setTimeout` / `setInterval`
       * 用的是 `installFakeClock()` 里那个 `fake`（`Date.now()` 也读它）。
       * 两个计数器的**起点差了整整一个纪元**（`1700000000000` vs `0`），
       * 于是 `at <= now` 里的 `at` 看着像"未来 500 年"——
       * **每一个定时器都不会到点**，长按永远不成立、看门狗永远不看一眼，
       * 而用例红在"`dragStart` 没出现"这种和时钟毫不相干的断言上。
       *
       * 判据：假体里**只允许有一个时钟**。`tick()` 必须读那个时钟、
       * 也只能推那个时钟；本地不留副本，留副本就是下一次漂移的开始。
       */
      now = fakeClock();
      if (advance) advance(ms);

      const target = fakeClock();
      /*
       * ★★ 每一次 `due.fn()` 之后都必须**重新对着 `target` 判一次**
       * （2026-10 修，代价是测试进程 4GB 堆爆）。
       *
       * 第一版是"把 `t.at <= target` 的都挑出来跑完"，看着很直白，但它在
       * **重复定时器**上是个死循环：`tick(3000)` 里那条 `setInterval(600)`
       * 每跑一次就把自己的 `at` 推到 `now + 600`，而 `now` 也随之往前走 ——
       * 于是"下一次也 `<= target`"永远成立，`guard < 500` 跑到 500 只是把
       * 循环留在数组里，接着又开一轮……内存一路涨到 OOM，而报错是
       * `Ineffective mark-compacts near heap limit`，**一个字都不提定时器**。
       *
       * 正确判据是"这一刻（`now`）有没有到点"，而不是"有没有在窗口内"：
       * 到点了就跑，跑完再看下一个；没到点就跳出，剩下的留给下一次 `tick`。
       */
      for (let guard = 0; guard < 500; guard++) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        if (due.every) {
          due.at = now + due.everyMs;
          due.fn();
        } else {
          const i = timers.indexOf(due);
          if (i >= 0) timers.splice(i, 1);
          due.fn();
        }
      }
      now = target;
      /*
       * 接着推帧。
       *
       * ★★ 帧的预算必须在**推进 `Date.now` 之前**算好（2026-10 修，代价是 OOM）。
       *
       * 上面那两行已经把 `Date.now` 推到了 `target`，所以"这一趟还能跑几帧"
       * **不能**拿 `now < target` 当判据 —— 那个条件在进入循环时就已经是假的了，
       * 结果是一帧都不跑。第一版就是这么写的：帧排在那儿永远没人跑，
       * 而表现是"惯性完全不动"。
       *
       * 正确判据是**帧自己的账**：这次 `tick(ms)` 允许跑 `ms / FRAME_MS` 帧
       * （`tick(200)` ≈ 12 帧，与现实同构），每跑一帧扣一帧、并把时钟与
       * `window.now()` 一起前进 16ms。谁也不能靠"给自己再排一帧"把账做平 ——
       * 预算用完就停，动画于是自己会停下来。
       */
      let frame = 0;
      while (frame < 240 && frame <= ms / FRAME_MS) {
        if (fakeFrames().length === 0) break;
        now += FRAME_MS;
        advance?.(FRAME_MS);
        runFakeFrame();
        frame += 1;
      }
    },
    now() {
      return now;
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    document,
    localStorage: makeFakeStorage()
  };

  const g = globalThis as unknown as Record<string, unknown>;
  g['window'] = win;
  g['document'] = document;
  g['setTimeout'] = win.setTimeout.bind(win);
  g['clearTimeout'] = win.clearTimeout.bind(win);
  g['setInterval'] = win.setInterval.bind(win);
  g['clearInterval'] = win.clearInterval.bind(win);
  g['HTMLElement'] = FakeElement;
  g['Element'] = FakeElement;
  /*
   * ★★ `requestAnimationFrame` 也必须是**可控**的（2026-10 补）。
   *
   * `ui/drag.ts` 的惯性滚动用 rAF 驱动，而真实 rAF 在 vitest 里跑的是
   * node 的计时器 —— 18ms 一帧、要等几十帧才停，"滚完 400px"这件事
   * **在单测里根本等不到**（用例要么挂几十秒，要么断言在动画中途取样，
   * 变成一条会随机红的用例）。
   *
   * 所以帧也由 `tick()` 推：`tick(16)` 就是**一帧**。
   * 时间戳用假时钟（`Date.now()` 已经被 `installFakeClock` 接管），
   * 于是"衰减到什么时候停"这件事也是确定性的。
   */
  let frameSeq = 1;
  let frames: { id: number; fn: (t: number) => void }[] = [];
  /**
   * ★★ 跑一帧之前，时钟要**再往前走一帧**（2026-10 补，和上面的假 rAF 是同一件事）。
   *
   * 原来 `tick(1)` 只把时钟推 1ms，然后把这 1ms 内排队的帧**全部**跑完 ——
   * 于是同一批帧读到的 `Date.now()` 是**同一个值**。这在 `drag.ts` 的惯性里
   * 是致命的：`dt = 0` → `move = 0` → `applied - move = 0`，而"速度衰减够了"
   * 与"已经滚到头"两个停止条件**一个都不成立** → 每帧都自己排下一帧。
   * 而且帧一多就滚雪球：`runFakeFrame` 只清空一次队列，那 240 次循环里每一帧
   * 排进来的新帧都会被下一次循环**在同一趟里**跑掉 → 一次 `tick()` 跑掉几万帧，
   * 测试进程 4GB 堆爆（报错是 `Ineffective mark-compacts near heap limit`，
   * 一个字都不提动画）。
   *
   * 修法就是**帧必须有自己的时间**：每跑一帧 `Date.now()` 前进 16ms
   * （`tick(200)` 于是约等于 12 帧，与现实同构），并且**上限跟着 `tick` 走** ——
   * 谁也不能靠"给自己再排一帧"把时钟推出 `tick` 的窗口，动画于是自己会停。
   */
  const FRAME_MS = 16;
  fakeFrames = () => frames;
  const raf = (fn: (t: number) => void): number => {
    const id = frameSeq++;
    frames.push({ id, fn });
    return id;
  };
  const caf = (id: number): void => {
    // ★ 原地删（`frames = frames.filter(...)` 会把数组换成新的一个，
    // 而 `fakeFrames()` 返回的还是旧的 —— 取消掉的帧于是照旧被跑）。
    const i = frames.findIndex((f) => f.id === id);
    if (i >= 0) frames.splice(i, 1);
  };
  g['requestAnimationFrame'] = raf;
  g['cancelAnimationFrame'] = caf;
  win['requestAnimationFrame'] = raf;
  win['cancelAnimationFrame'] = caf;
  return win;
}

/**
 * 当前假体里排队的动画帧。
 *
 * ★ 语义是"**永远返回同一个数组**"：`installFakeWindow` 把本次的数组放进来，
 * `raf`/`caf`/`runFakeFrame` 都只动它、**不换它**。曾经这里是"每次取用都换一层
 * 新数组"，结果 `raf` 往旧数组里 push、`fakeFrames()` 报 0 → 帧永远没人跑，
 * 而"队列里还有几帧"出现了两个互相矛盾的答案（详见 `runFakeFrame` 的注释）。
 */
let fakeFrames: () => { id: number; fn: (t: number) => void }[] = () => [];

/**
 * 跑一帧（假体的 `requestAnimationFrame` 驱动器）。
 *
 * ⚠ `fakeFrames` 是**模块级的一个格子**，而 `installFakeWindow` 每次调用都会
 * 把它换成本次那个数组 —— 于是"存一份 rAF 回调、等 `tick()` 的时候再逐个调"
 * 这种做法在这里是**错的**：等你调的时候，格子早被下一个用例换走了，
 * 你手里那一份回调属于上一个 window，而它们要写的 `scrollTop` 早就不该再写。
 * 所以驱动方式是"当场把格子取空、再跑取到的那几个"。
 *
 * 传进来的时间戳就是假时钟的当前值 —— `tick(16)` 先把时钟推 16ms 再跑，
 * 于是 `drag.ts` 里那套"按毫秒算的衰减"在单测里是可推演的。
 */
/**
 * 假体里还排着几个动画帧。
 *
 * 用例用它断言"这一次交互确实排了一帧"（惯性那条路只有在真的开了动画时才有意义）——
 * `scrollTop` 没变有好几种解释，而"队列里一帧都没有"只可能是"动画根本没开"。
 */
export function fakeFrameCount(): number {
  return fakeFrames().length;
}

function runFakeFrame(): void {
  /*
   * ★★ 必须先**快照**，再**原地清空**（2026-10 修，代价是测试进程 4GB 堆爆）。
   *
   * 第一版是 `const due = fakeFrames(); fakeFrames = () => [];` —— 两处都错：
   *
   * ① `due` 拿的是**活数组**。`for (const f of due)` 遍历的是那个数组本身，
   *    回调里 `raf(step)` 往同一个数组 push 的那一帧，会被**这一次遍历接着跑掉**
   *    （数组迭代器是活的）：`step` 排帧 → 立刻被跑 → 又排帧 → …… 一趟 `tick()`
   *    里跑掉几万帧、内存涨到 OOM。表现是 `runFakeFrame` 只"调用了一次"，
   *    但每个回调体反复执行（日志里 `回调返回 #1` 连刷几千行，`raf` 的 id 早过了五万）。
   * ② `fakeFrames = () => []` 换的是**模块级格子**，而 `raf`/`caf` 闭包捕获的是
   *    `installFakeWindow` 里那个数组 —— 它们照旧往旧数组里 push，于是
   *    "队列里还有几帧" 这个问题的答案取决于你问谁。同一个事实两个副本，
   *    迟早对不上：判据只能是"**永远返回同一个数组，当场清空它**"。
   *
   * 正确的形状：快照 → 清空原数组（`raf`/`caf` 看到的是同一个它）→ 跑快照。
   * 于是"一帧里新排的帧"留到下一帧，与浏览器一致，`while (frame <= ms / FRAME_MS)`
   * 那个预算也才真的管得住。
   */
  const due = fakeFrames().slice();
  fakeFrames().length = 0;
  for (const f of due) f.fn(Date.now());
}

/**
 * 极简 HTML 解析器：只认标签、`attr="value"`、`attr`（无值）、自闭合标签与注释。
 *
 * 为什么必须有一个：`OrganizeScreen` 把整个界面写成 `innerHTML` 字符串，
 * 然后立刻 `querySelectorAll('[data-slot]')` 去绑手势。没有解析，
 * 屏幕上就一个元素都找不到 —— 屏幕级测试**跑不起来**，
 * 而"拖动卡住"这个 bug 恰好只在屏幕级（手势 + 状态机 + DOM 的交互里）出现。
 *
 * 它刻意**不**实现：文本节点、实体解码、命名空间、`<script>` 里含 `<`。
 * 这套界面是自产的、可控的模板，够用 —— 一旦不够用，测试会当场炸出来（querySelector 返回空），
 * 而不是悄悄给出错误结果。
 *
 * ★★ **一条会骗人的边界**（M4 写开局页测试时踩到的，记在这里免得下一个人重踩）：
 *
 * 它只判"这里面有没有子标签"（`/<[a-zA-Z]/`）。**有**子标签 → 走 `parseHtml`
 * 递归，而**这一层的纯文本被整个丢掉**（没有文本节点承载它）；
 * **没有**子标签 → 才把内容塞进 `textContent`。
 *
 * 于是 `最要紧的是 <b>燃料</b> 和 <b>保暖</b>。` 这种混排文本里，
 * "最要紧的是"**在假 DOM 里根本不存在** —— 而在真浏览器里它好端端地在那儿。
 * 后果不是"测试红了"，恰恰相反：**断言这一句的测试会永远失败，
 * 而断言它不存在的测试会永远通过**（后者更危险）。
 *
 * 所以：**要么把那一句放进一个纯文本叶子元素**（`OrganizeScreen` 的
 * `.room-label` 就是这么加出来的，"房名与计数是两件事，分开之后样式也各自独立"），
 * **要么就别断言它** —— 别让一条读不到字的断言伪装成"这屏没问题"。
 */
function parseHtml(html: string, doc: FakeDocument, parent: FakeElement, depth = 0): void {
  if (depth > 60) throw new Error('[fakeDom] HTML 嵌套超过 60 层，疑似病理循环');
  // 去掉注释
  const src = html.replace(/<!--[\s\S]*?-->/g, '');
  let i = 0;
  let guard = 0;
  while (i < src.length) {
    /*
     * ★ 硬上限：一次解析最多创建 2000 个元素。
     *
     * 这个假体的解析器很粗（不做完整的 HTML 容错），某些畸形输入会让
     * `findClosingTag` 与递归**互相喂**，变成病理性循环 ——
     * 表现是"测试跑 45 秒然后 V8 内存爆掉"，非常难查。
     * 与其让那种情况吃掉 4GB 内存，不如在这里明确报错：
     * 报错信息会直接告诉后来者"是解析器碰到它处理不了的输入了"。
     */
    if (++guard > 2000) {
      throw new Error(
        `[fakeDom] HTML 解析超过 2000 个元素，疑似病理循环。` +
          `输入片段：${JSON.stringify(src.slice(0, 200))}`
      );
    }
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    const gt = src.indexOf('>', lt);
    if (gt < 0) break;
    const raw = src.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (raw === '' || raw.startsWith('!') || raw.startsWith('?')) continue;

    if (raw.startsWith('/')) {
      // 闭合标签：回到上一层（parent 由调用方维护，这里用栈式递归处理）
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const spaceAt = body.search(/\s/);
    const tag = (spaceAt < 0 ? body : body.slice(0, spaceAt)).toLowerCase();
    const attrText = spaceAt < 0 ? '' : body.slice(spaceAt);
    if (!tag) continue;

    const el = doc.createElement(tag);
    applyAttributes(el, attrText);
    parent.appendChild(el);

    /*
     * 找**与这个标签配对**的闭合位置。
     *
     * ★ 不能简单 `indexOf('</tag>')` —— 那样第一个 `<button>` 会一路吞到
     * **最后一个** `</button>`，把中间的兄弟节点全吃掉。这个 bug 是自检测出来的
     * （"组合选择器"那条断言返回空数组）。这里按同名标签的开合配对计数，
     * 找到深度归零的那一个。
     */
    const closeAt = findClosingTag(src, tag, i);
    if (closeAt < 0) continue; // 模板被截断：容忍，把这个标签当空元素
    const inner = src.slice(i, closeAt);
    if (/<[a-zA-Z]/.test(inner)) {
      /*
       * ★★ 有子标签时也**保留直接文本**（2026-10 修）。
       *
       * 原来的写法是"有子标签就什么都不存"，于是
       * `<em>120 元<span class="price-stress">…</span> · 5kg · 限购</em>`
       * 里的 `120 元 / 5kg / 限购` **全部读不到** —— 而那正是玩家看得见的字。
       * 这个洞曾经让我把一条**正确的守卫**误判成"守卫写错了"（见 `leafTexts` 的注释）。
       *
       * 现在把直接文本段（不含任何标签的那些片段）拼起来存进 `textContent`，
       * 与真 DOM 的 `textContent` 语义一致：**子孙的字也算在内**。
       */
      parseHtml(inner, doc, el);
      const direct = directTextOf(inner);
      if (direct) el.textContent = direct;
    } else {
      // 没有子标签：整个内容就是文本（<span class="slot-count">×3</span> 这类）
      el.textContent = inner.trim();
    }
    i = closeAt + `</${tag}>`.length;
  }
}

/**
 * 取一段 HTML 里**不属于任何子标签**的直接文本（空白折叠后拼接）。
 *
 * `decodeEntities` 与解析属性走同一个函数，免得"属性里的 `&amp;` 解了、
 * 文本里的没解"这种半吊子状态。
 */
function directTextOf(html: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    i = gt + 1;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** 从 `from` 起找到与 `tag` 配对的闭合标签位置（按同名开合计数） */
function findClosingTag(src: string, tag: string, from: number): number {
  const open = new RegExp(`<${tag}(?=[\\s/>])`, 'gi');
  const close = new RegExp(`</${tag}>`, 'gi');
  let depth = 1;
  let pos = from;
  for (let guard = 0; guard < 10000; guard++) {
    open.lastIndex = pos;
    close.lastIndex = pos;
    const o = open.exec(src);
    const c = close.exec(src);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth += 1;
      pos = o.index + o[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return c.index;
    pos = c.index + c[0].length;
  }
  return -1;
}

function applyAttributes(el: FakeElement, attrText: string): void {
  /*
   * ★ 必须带词边界 `\b` 且**跳过已消费的值** —— 否则 `class="shelf-card"` 里的
   * `shelf` 会被当成一个独立属性名、`data-shelf-card="x"` 里的 `shelf` 同理。
   * 这个 bug 也是自检测出来的（"解析 innerHTML"那条断言失败）。
   */
  const re = /\b([\w-]+)(?:="([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    const name = m[1] as string;
    const value = m[2] ?? '';
    el.attributes[name] = value;
    const camel = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    el.dataset[camel] = value;
    /*
     * ★ `class` 还要同步到 `classList` —— 否则 `querySelector('.slot')` 找不到任何东西、
     * `classList.contains('is-empty')` 恒为 false。
     * 这个疏漏是自检测出来的（"组合选择器"那条返回空数组），
     * 而它会让屏幕级测试**静默地验错对象**，比直接报错危险得多。
     */
    if (name === 'class') el.className = value;
    /*
     * ★★ 布尔属性要同步到**属性**上（2026-10 修）。
     *
     * 假体原来只把它们写进 `attributes` / `dataset`，于是
     * `<button disabled>` 的 `el.disabled` **仍然是 `false`** ——
     * 而产品代码读的正是那个属性（`goOut.disabled = !canGoOut`、
     * `btn.disabled: true` 那几处）。这与 `isConnected` 是同一类毛病：
     * **假体缺一个成员，代价不是报错，而是被测代码里某条分支静静地验不到。**
     *
     * 只列真正被产品代码读的那几个；`value` 这种"有值才设"的不在此列。
     */
    if (name in BOOLEAN_ATTRS) (el as unknown as Record<string, boolean>)[name] = true;
    if (m[2] !== undefined) re.lastIndex = m.index + m[0].length;
  }
}

/**
 * 把一棵假体子树写回 HTML 字符串（`get innerHTML` 用它）。
 *
 * ## 它与 `parseHtml` 是一对，必须按同一份口径往返
 *
 * `parseHtml` 存下来的东西只有三样：**属性表**（`el.attributes`）、
 * **classList**、**直接文本**（`el.textContent`，不含子孙的字）。所以序列化时：
 *
 * - `class` **从 `classList.value` 重建**，不从 `attributes['class']` 取 ——
 *   产品代码 `el.classList.add('is-folded')` 只动 classList，而解析时 `class`
 *   在 `attributes` 里也有一份，两边同时写就会输出重复的 `class` 属性；
 * - 其余属性逐一输出，`dataset` 里那些**没有对应 attributes 项**的补成 `data-k`
 *   （产品代码 `el.dataset['snap'] = '1'` 正是这种），键名按 `data-kebab-case` 还原；
 * - 自闭合标签（`svg` / `path` / `rect` / …）写成 `<tag .../>`：`parseHtml` 对它们
 *   的处理是"读到一个标签就只前进一位"，本来就拿不到内部内容（图标是静态的）；
 * - 值里的 `"` 与 `&` 做转义，免得往返一次就散架。
 *
 * ★ 往返**不可能字节级一致**（属性顺序、自闭合写法、空白折叠都会变），
 * 所以自检只能断言"关键结构还在"，别写 `toBe(original)`。
 */
function serializeEl(el: FakeElement): string {
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [];
  if (el.classList.value) attrs.push(`class="${escapeAttr(el.classList.value)}"`);
  for (const [name, value] of Object.entries(el.attributes)) {
    if (name === 'class') continue;
    attrs.push(`${name}="${escapeAttr(value)}"`);
  }
  for (const [key, value] of Object.entries(el.dataset)) {
    const name = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (name in el.attributes) continue;
    attrs.push(`${name}="${escapeAttr(value)}"`);
  }
  const head = attrs.length > 0 ? `<${tag} ${attrs.join(' ')}` : `<${tag}`;
  if (SELF_CLOSING_TAGS.has(tag)) return `${head}/>`;
  /*
   * 直接文本与子元素的先后：`parseHtml` 把直接文本段整体存进 `textContent`，
   * 不记它在兄弟之间的位置。这里统一**先子元素、后文本** —— 产品代码写出来的
   * 文本段几乎都在最后（`<span class="x">名字</span>`）或者整段都是文本。
   */
  const inner = `${el.children.map((child) => serializeEl(child)).join('')}${el.textContent !== '' ? escapeText(el.textContent) : ''}`;
  return inner === '' ? `${head}></${tag}>` : `${head}>${inner}</${tag}>`;
}

/** 下面这几个标签解析时就不带内部内容，序列化也写成自闭合 */
const SELF_CLOSING_TAGS = new Set(['svg', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'input', 'br', 'img']);

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML 布尔属性：出现即为真，与值无关（见 `applyAttributes` 里那段注释） */
const BOOLEAN_ATTRS: Record<string, true> = {
  disabled: true,
  checked: true,
  selected: true,
  hidden: true,
  open: true
};

/** 假 localStorage（`resolveStorage()` 会探测它，所以形状要对） */
function makeFakeStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
} {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    }
  };
}

/**
 * 把假元素交给只吃 `HTMLElement` 的代码（`attachPointerGesture` 之类）。
 *
 * 这是一个**有意的、局部的**不安全转换：假体只实现了手势层真正用到的那几个成员
 * （`addEventListener` / `classList` / `dataset` / `getBoundingClientRect` / 指针捕获），
 * 而 TS 要求一整个 `HTMLElement`。把转换**集中在这一个函数**里，
 * 比在每个调用点写 `as unknown as HTMLElement` 好 ——
 * 至少"整个项目只有这里在做这件事"是显式的。
 */
export function asElement(el: FakeElement): HTMLElement {
  return el as unknown as HTMLElement;
}

/** 造一次 pointer 事件（手势层只读这几个字段） */
export function pointerEvent(
  x: number,
  y: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0, buttons: 1, cancelable: true, ...extra };
}

/**
 * ★★ 把一棵子树里**所有**读得到的字拼起来 —— 屏幕级断言该走这个。
 *
 * ## 为什么必须有一个（而不是各测试自己写一遍）
 *
 * 假体的解析器不实现文本节点（见 `parseHtml` 的边界说明）：文本存在元素的
 * `textContent` 上而不是独立的文本节点里。所以
 * `<div class="a"><i>外面</i><b>-18°C</b></div>` 这种混排里，
 * 容器的 `textContent` 读到的是**它自己的那段字**（2026-10 起也含混排文本），
 * 子标签的字则各自在自己身上。
 *
 * 于是"读 `.contrast-cell` 的 textContent"可能得到**空**，而那条失败看起来
 * 像"这一格没渲染" —— 它会把一个正确的界面报成坏的。反过来更危险：
 * 用 `not.toContain` 断言时，空串会让它**永远通过**。
 *
 * 这个函数把"这一屏上到底有哪些字"变成一句可依赖的话：沿 `children` 递归，
 * 收集每个**有文本**的节点。它对"真 DOM 里能不能读到"不做承诺 ——
 * 它回答的是"假体里渲染出了哪些字"，而那正是测试要断言的那件事。
 *
 * ⚠ 它**不**按文档顺序拼接容器与叶子的文本（假体没有文本节点，顺序信息不存在）。
 * 所以断言应该用 `toContain` / `toContain` 的组合，而不是 `toBe` 一整句。
 *
 * ## 2026-10 修掉的那个洞（代价：一条正确的守卫被误判成写错了）
 *
 * 原来容器在**有子标签时一个字都不存**，于是
 * `<em>120 元<span class="price-stress">…</span> · 5kg · 限购</em>`
 * 里的 `120 元 / 5kg / 限购` 全读不到 —— 而那正是玩家看得见的字。
 * 现在 `parseHtml` 会把混排里的**直接文本段**也存下来，与真 DOM 的
 * `textContent` 语义对齐（子孙的字也算在内）。
 *
 * ★ 教训不是"记住这个边界"，而是"**混合内容**是这种假体的经典盲区：
 * 一旦某个叶子改成分叉，原来那条断言会静默失去对象"。
 */
export function leafTexts(el: FakeElement): string[] {
  const out: string[] = [];
  const walk = (node: FakeElement): void => {
    if (node.textContent) out.push(node.textContent);
    for (const child of node.children) walk(child);
  };
  walk(el);
  return out;
}

/** `leafTexts` 的拼接版：读"这一屏/这一块有哪些字"时默认用它 */
export function allText(el: FakeElement): string {
  return leafTexts(el).join('｜');
}
