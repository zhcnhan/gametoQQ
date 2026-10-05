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
  }

  get className(): string {
    return this.classList.value;
  }
  set className(value: string) {
    for (const c of [...this.classList.value.split(' ').filter(Boolean)]) this.classList.remove(c);
    for (const c of value.split(/\s+/)) if (c) this.classList.add(c);
  }

  get innerHTML(): string {
    return this._html;
  }
  /** 存字符串，并**真的解析成子元素树**（`querySelectorAll` 依赖它） */
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
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
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

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    const camel = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    this.dataset[camel] = value;
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
   * 推进**假时钟 + 假定时器**。
   *
   * ★ 它必须同时接管 `Date.now()`，否则会有"测不到的地方"：
   * `drag.ts` 的看门狗用 `Date.now() - lastSeenAt` 判断"指针事件是不是断了"，
   * 而真实时钟在单测里几乎不动 —— 于是那段时间逻辑**没法被测**，
   * 只能靠读代码确认。这个假窗把 `Date.now` 也接管了（见 `installFakeWindow`）。
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
      timers.push({ at: now + ms, fn, every: false, everyMs: 0, id });
      return id;
    },
    clearTimeout(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      timers.push({ at: now + ms, fn, every: true, everyMs: ms, id });
      return id;
    },
    clearInterval(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    tick(ms) {
      const advance = (globalThis as unknown as Record<string, unknown>)['__advanceFakeNow'];
      if (typeof advance === 'function') (advance as (n: number) => void)(ms);

      const target = now + ms;
      for (let guard = 0; guard < 500; guard++) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        if (due.every) due.at = now + due.everyMs;
        else {
          const i = timers.indexOf(due);
          if (i >= 0) timers.splice(i, 1);
        }
        due.fn();
      }
      now = target;
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
  return win;
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
    if (m[2] !== undefined) re.lastIndex = m.index + m[0].length;
  }
}

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
