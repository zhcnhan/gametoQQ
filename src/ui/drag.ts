/**
 * 手势层：Pointer Events 手搓（提示词 0 第 2 条：禁止 HTML5 Drag & Drop）。
 *
 * 两条操作路径都要有（§9）：
 *  - 点选-点放：手指抬起时没怎么移动 → 判定为 tap
 *  - 长按拖拽：触摸长按 300ms 后进入拖拽；鼠标则移动 6px 即进入拖拽（不强迫鼠标长按）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ★★ 本层**接管滚动**，而且必须是**唯一**那一层（2026-10 第三次定稿）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 这一条来回改过三次，三次的实测都被写进了 `src/style.css` 的 `.slot` 那段，
 * 这里只讲**为什么最后落在"自己滚"**：
 *
 *  · 让浏览器滚（`touch-action: pan-y`）：滚动跟手、有惯性、方向一定对。
 *    但它要求的代价是"**手势的含义由浏览器定**" —— 手指一动它就接管纵向手势
 *    并发 `pointercancel`。表现是玩家 2026-10 报的"**从箱子里拖东西，
 *    出一个极小的范围就消失**"：长按成立、幽灵刚出来，手指一往下挪，
 *    浏览器把这一趟收走了。它比"滚不动"更伤，因为拖拽是这一屏的主操作。
 *
 *  · 自己滚（本层，`touch-action: none`）：手势的含义由我们定，拖拽稳。
 *    代价是滚动的跟手与惯性得自己写（见 `startInertia`）。
 *
 * ★★ 两层同时存在的那个 bug（"方向是反的"）**不是"自己滚"造成的**，
 * 而是"自己滚"叠上了**合成器滚动**：当时 `.room-scroll` 写着
 * `-webkit-overflow-scrolling: touch`，那块区域被提升成合成层滚动容器，
 * 浏览器自己也在滚同一块内容。**主线程拦不住合成器**。
 * 所以定稿是两条一起改：接管滚动 + 把 `-webkit-overflow-scrolling` 摘掉，
 * 让这块内容上只有一层（我们这一层）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ★★ 为什么 window 上的监听器**只在模块加载时挂一次**（M2 重写）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 原来的写法是"每个手势开始时 `window.addEventListener`、结束时 `removeEventListener`"。
 * 看起来天经地义，实际把玩家坑了三次（"拖动卡住，得点原格子才好"）：
 *
 *  · `OrganizeScreen` 每次放下/拾取都会重绘，而 `renderRoom` 用 `innerHTML`
 *    **把整间房换掉** —— 手里那个元素连同它的监听器一起消失；
 *  · 一旦手势是在"元素已经被换掉"之后才结束的，`el.removeEventListener` 是对着
 *    一块僵尸调的，**window 上的监听器就永远摘不掉**；
 *  · 那些僵尸监听器还会继续响应之后每一次 pointerup，对着旧元素调 `onUp` ——
 *    于是新一次拖拽的收尾被旧手势干扰。
 *    屏幕级测试里直接量到了这个数字：一次拖拽之后 window 上挂着 **4 个** pointerup。
 *
 * 改成"监听器常驻 + 一个当前的活跃手势"之后，**这一类 bug 在结构上不可能发生**：
 * window 永远恰好挂着一份监听，没有"加/摘不配对"的余地，
 * 元素被换掉也不影响收尾（收尾只依赖 `active` 这个变量，不依赖元素还在不在）。
 *
 * 代价是"每个手势都要判一次 active"——那是几次整数比较，可以忽略。
 */

export interface Point {
  x: number;
  y: number;
}

export interface GestureHandlers {
  /** 点选-点放：轻点 */
  onTap?: (point: Point) => void;
  /** 进入拖拽态（此时 ui 应该建一个跟随手指的 ghost） */
  onDragStart?: (point: Point) => void;
  onDragMove?: (point: Point) => void;
  /** 松手（point 是松手位置，落点判定交给 ui 用 elementFromPoint 做） */
  onDragEnd?: (point: Point) => void;
  /** 手势被打断（浏览器开始滚页面、窗口失焦、元素被换掉…） */
  onCancel?: () => void;
}

export interface GestureOptions {
  /** 触摸进入拖拽所需的按住时长（毫秒） */
  longPressMs?: number;
  /** 判定为"移动了"的像素阈值（鼠标专用；触摸靠长按，不看位移） */
  moveTolerance?: number;
  /** 点了但停留过久不算 tap 的上限 */
  tapMaxMs?: number;
  /**
   * 竖着越过这个距离就算"这次手势是滚动"（只用**方向**判定，见 `handleMove`）。
   *
   * 它必须比 `moveTolerance` 大：按下时手抖十几像素太容易了，
   * 用 12px 当判据会让**大部分想拖拽的手势在长按成立前就被判成滚动**。
   */
  scrollTolerance?: number;
  /**
   * ★★ 这块区域**由我们自己滚**（玩家 2026-10 第二次报的"正常拖动又不正常了"）。
   *
   * ⚠ **不传就是"不接管"** —— 那种调用方（胶带条那几处不需要滚的）仍然走
   * "竖向滑动就放弃手势"的老路。别给它编一个默认元素：一个真的
   * `scrollTop +=` 会写到游离节点上，**不报错、也没有任何视觉效果**。
   */
  scrollHost?: HTMLElement | null;
}

/**
 * 补全默认值之后的选项。
 *
 * ⚠ `scrollHost` 不在 `Required<>` 里：它不是"有个默认值"的参数，
 * 而是"这个调用方有没有自己接管滚动"的开关。
 */
type ResolvedOptions = Required<Omit<GestureOptions, 'scrollHost'>> & Pick<GestureOptions, 'scrollHost'>;

const DEFAULTS: Required<Omit<GestureOptions, 'scrollHost'>> = {
  /*
   * ★ 300ms，不是 220ms（2026-10 玩家反馈后的调整）。
   *
   * ★ 300ms，不是 220ms（2026-10 玩家反馈"下滑上滑的效果不好，容易无效"之后）。
   *
   * 他当时报的是滚动不灵，而滚动早就不归这一层管了（见文件头）——
   * 但**这个数仍然是那条账的一部分**，因为它是"这一次手势算点、还是算拖拽"的分界线：
   *
   *  · 一次"想滚一下屏幕"的滑动，从按下到手指真的移动，经常要 200ms 出头
   *    （拿起手机、找准位置、再推）。220ms 的窗口太窄 —— 手一迟疑就跨过去了，
   *    于是那次滑动在浏览器还没开始 pan 之前就被我们判成了拖拽（一个不跟手的幽灵）。
   *
   * 300ms 是把这条边界往"先当作滚动"那一侧推：想拖的人按住不动不会在意
   * 多等 80ms（他本来就要停一下瞄准落点），想滚的人几乎不会再被截胡。
   *
   * ⚠ 别再往下调。这条的代价是**对称的**：调小会让滚动变难，调大只让
   * 拖拽慢 80ms —— 两种错法的难受程度不一样。
   *
   * ★ 导出给测试用（`src/ui/drag.test.ts` 与 `tapeShelf.test.ts` 里那些
   * `tick(260)` 原来写死了"220 + 40"）。写死的话，改这个数会让几条用例
   * **静默变成"什么手势都没发生"** —— 断言里看到的是空数组，
   * 与"手势层根本不工作"长得一模一样，而它会指向完全错误的方向。
   */
  longPressMs: 300,
  moveTolerance: 12,
  tapMaxMs: 500,
  /*
   * ★ 16px：比 `moveTolerance`（12）大一档。
   *
   * 为什么不能一样大 —— 两个判据管的是**不同的手**：
   *  · `moveTolerance` 问的是"这次手势动了吗"（鼠标 6px 就能进拖拽，见 `handleMove`）；
   *  · 这一个问的是"这次手势想滚吗"，而**想滚的人一上来就动得很多**（他是划，不是按）。
   * 按下时手指抖 12px 太常见了：把这条线画在 12px 上，等于让"按偏了一下"的手势
   * 在长按窗口里被判成滚动，玩家看到的是"**按住就再也拖不动了**"。
   * 16px 让"真的想滚"（通常一次划 100px 上下）远远越过它，而手抖越不过去。
   */
  scrollTolerance: 16
};

/**
 * 长按进入拖拽所需的毫秒数（导出给测试用 —— 见 `longPressMs` 上方那段）。
 *
 * 测试里请用 `LONG_PRESS_MS + 60` 这种写法，**不要写死数字**。
 */
export const LONG_PRESS_MS = DEFAULTS.longPressMs;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * ★★ 谁负责滚：从被按住的元素往上找**最近的那个"滚动容器"标记**。
 *
 * ## 为什么是标记，不是 `scrollHeight > clientHeight`
 *
 * 判"这元素能不能滚"通常看尺寸，但那件事**假体测不出来**（`fakeDom` 不解析 CSS，
 * 没有 `getComputedStyle` 的 `overflow`），于是"滚动接管"这条路上最关键的
 * 一个决定（滚谁）会在单测里**永远走不到**。标记是纯 DOM 事实：
 * 假体和真浏览器看到的是同一件事。
 *
 * ## 标记写在谁身上
 *
 * 由**渲染那一层**写在滚动容器上（`data-scroll-host`，见 `OrganizeScreen` 的
 * `.room-scroll` 与纸箱那一叠）：`<div class="room-scroll" data-scroll-host>`。
 * 手势层只管往上找 —— 格子住在房间里，纸箱住在那一叠里，**各自找到各自的那个**。
 *
 * ★ 纸箱那一叠为什么不直接归外面的房间滚：`.dock-boxes` 自己就是
 * `overflow-y: auto` 的容器，手指落在箱子上先说"滚箱子的列表"才是自然的
 * （箱子多到要滚的时候，玩家想看的正是下面的箱子）。滚到头之后再滚外面那层
 * 属于"滚动接力"，那件事由 `takeOverScroll` 处理（它顺着 `parentElement` 往上找）。
 *
 * ⚠ 两层都找不到 → 返回 `null` → **不接管**（那次竖向滑动什么都不做，
 * 与"没有 `scrollHost`"的老路径一致）。胶带条就是这种调用方。
 */
function resolveScrollHost(el: HTMLElement, opts: ResolvedOptions): HTMLElement | null {
  /*
   * 显式传进来的优先（胶带条那几处按需覆盖，也让"没有标记"的调用方能接管）。
   * ★ 注意判据是 `!== undefined` 而不是真值：传 `null` 是**明确表示"这一处不接管"**，
   * 传 `undefined`（也就是没传）才轮到往上找。
   */
  if (opts.scrollHost !== undefined) return opts.scrollHost;
  let node: HTMLElement | null = el;
  while (node) {
    if (node.hasAttribute('data-scroll-host')) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * 这一次位移**真的**滚到头了吗（`takeOverScroll` 用它决定要不要接力给外层）。
 *
 * ⚠ 判据是"`scrollTop` 到没到边界"，**不是**"这次移动了 0 像素"：
 * 手指划 3px 时 `scrollTop` 也只动 3px，而这显然不是"到头"。
 * 正数方向（手指往上推）的边界是 `scrollHeight - clientHeight`，负数是 0。
 * 那 0.5px 是给亚像素的余量（`scrollTop` 在部分浏览器上是小数）。
 */
function atScrollEnd(host: HTMLElement, deltaY: number): boolean {
  const max = Math.max(0, host.scrollHeight - host.clientHeight);
  if (deltaY > 0) return host.scrollTop >= max - 0.5;
  if (deltaY < 0) return host.scrollTop <= 0.5;
  return true;
}

/**
 * 接管滚动：把这一次位移交给 `host`（以及必要时它的外层容器）。
 *
 * ## 返回值是"这次手势归我们滚了"，不是"这一次位移滚成了"
 *
 * 两者**必须**分开，而这里踩过一次：第一版写成"没滚动就不算接管"，
 * 于是手指从**列表顶端**往上划（`scrollTop` 已经是 0、`canScroll` 判 false）
 * 那一次会被当成"滚不动" → 手势作废、调 `onCancel`。而玩家只是
 * **划反了一下**，接下来他往回划时手势早就没了 —— 表现成"从顶上往下滑，
 * 滑一次就再也滚不动"。
 *
 * 正确的判据是"**这一处有没有滚动容器**"（有容器 = 这一次手势归滚动，
 * 至于这一刻滚不滚得动是 `scrollTop` 的边界问题）。没有容器才是真的没法接管。
 */
function takeOverScroll(g: ActiveGesture, deltaY: number): boolean {
  const host = g.scrollHost;
  if (!host) return false;
  g.scrolling = true;
  let left = deltaY;
  let node: HTMLElement | null = host;
  while (node && Math.abs(left) > 0.01) {
    const before = node.scrollTop;
    node.scrollTop = before + left;
    left -= node.scrollTop - before;
    /*
     * ★ 顺 `data-scroll-host` 往上找**外层容器**（滚动接力）：内层滚到头之后
     * 这一次手势剩下的位移交给外层。没有这一条，纸箱那一叠滚到底之后
     * 房间就再也滚不动了 —— 而手指明明还在往上划。
     */
    if (!atScrollEnd(node, left)) break;
    node = node.parentElement;
    while (node && !node.hasAttribute('data-scroll-host')) node = node.parentElement;
  }
  /*
   * ★ 采样只服务于"松手时的甩动速度"，所以每次滚动位移都记一笔，
   * 而且只留最近两笔（见 `ActiveGesture.samples` 那段）。
   */
  g.samples.push([now(), deltaY]);
  if (g.samples.length > 2) g.samples.shift();
  return true;
}

/**
 * 甩动速度（px/ms）。
 *
 * ★ 符号与手指移动的方向一致（`point.y - prev.y`）：**正数 = 手指往下划
 * = `scrollTop` 变大 = 看到下面的内容**（手指往哪边划，内容就跟到哪边，
 * 与手机上的自然滚动同向）。`startInertia` 直接把它当 `scrollTop`
 * 的增量速度用，所以两个符号必须是同一个。
 *
 * ⚠ 这里曾经写反过（"正数 = 手指往上划"）。写反的代价不是"手感差一点"，
 * 而是**整段滚动的方向在真机上就是反的** —— 而它在单测里看不出来，
 * 因为断言也照着那句写反的注释抄。判据只有一条：`takeOverScroll` 里
 * 就是 `scrollTop = before + deltaY`（`deltaY` 取的是 `point.y - prev.y`），
 * 读代码就能定，不要凭"感觉像"。
 */
function flingVelocity(g: ActiveGesture): number {
  const [a, b] = g.samples;
  if (!a || !b) return 0;
  const dt = b[0] - a[0];
  if (dt <= 0 || dt > INERTIA_STALE_MS) return 0;
  return b[1] / dt;
}

/**
 * 当前环境里的动画帧接口（**每次调用时现取**，见下面 `startInertia` 那段）。
 *
 * ⚠ 别把它写成模块级的 `const raf = requestAnimationFrame`：那会在这里
 * **捕获一次**，之后谁也换不掉。真浏览器里没差别（`window` 自始至终是同一个），
 * 但测试里差别是"整个进程 4GB 堆崩掉"—— 见 `startInertia` 的注释。
 */
function rafFn(): ((cb: (t: number) => void) => number) | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const fn = g['requestAnimationFrame'];
  return typeof fn === 'function' ? (fn as (cb: (t: number) => void) => number) : null;
}

function cafFn(): ((id: number) => void) | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const fn = g['cancelAnimationFrame'];
  return typeof fn === 'function' ? (fn as (id: number) => void) : null;
}

/** 停掉惯性动画（按下、收尾、被打断三处都要调） */
function stopInertia(): void {
  if (inertiaFrame === null) return;
  cafFn()?.(inertiaFrame);
  inertiaFrame = null;
}

/**
 * 松手之后的惯性滑行。
 *
 * ## 为什么必须自己写
 *
 * `.slot` / `.box` 上是 `touch-action: none`（见 `src/style.css` 那段：
 * 让浏览器接管滚动会发 `pointercancel`，把拖拽也一起收掉）。**"浏览器永不插手"
 * 的另一面就是"它也不再帮你滑"** —— 而"没有惯性"是玩家明确抱怨过的一条。
 *
 * ## 衰减
 *
 * `v(t) = v0 · exp(-t/τ)`，每帧按真实时间增量积分。总距离 = `v0 × τ`
 * （τ = `INERTIA_TAU_MS`），到 0.02px/ms 以下就停手 —— 再往下滑的
 * 那一两个像素人眼看不见，白占一个动画帧。
 *
 * ⚠ 只从**松手那一刻**开始算：`pointerup` 到第一次 rAF 之间可能隔了十几毫秒，
 * 那段时间按"速度不变"记账（多滑 `v0 × dt`），免得手感上"松手先顿一下"。
 *
 * ## ★★ 时钟与帧都必须是"当前这一个"（这一条踩过一次，代价是测试进程崩掉）
 *
 * 第一版这里直接写 `Date.now()` 与模块级捕获的 `requestAnimationFrame`，
 * 两处都**绕过了本文件已有的可替换接口**（`now()`），后果连成一条链：
 *
 *  ① 假 window 把全局 `Date.now` / `requestAnimationFrame` 都换掉了，
 *     而 `drag.ts` 在**模块加载时**就把真的那个 `requestAnimationFrame`
 *     存进了模块作用域 —— 测试从此跑的是**真 rAF**（约 16ms 一帧的宏任务）；
 *  ② 真 rAF 的回调在用例结束之后**照样会跑**，而它读的 `Date.now()`
 *     也是**真的**（假时钟只管假的那些）—— 于是 `dt` 极小、位移几乎为 0，
 *     而"速度衰减够了"与"滚到头了"两个停止条件**一个都不成立**；
 *  ③ `step` 于是永远自己排下一帧，每一帧都新分配一个闭包。
 *     实测：测试进程堆涨到 4GB 后被 OOM 杀掉，报错是
 *     `JavaScript heap out of memory` / `Worker exited unexpectedly` ——
 *     **一个字都不提动画**，而它在单测里看起来只是"惯性那条用例红了"。
 *
 * 判据：**惯性这一段动画只能通过 `now()` + 现取的 rAF 读写时间与帧**，
 * 这样测试里"一帧"就是 `tick(16)`，与现实同构。
 */
function startInertia(host: HTMLElement, velocity: number): void {
  stopInertia();
  const raf = rafFn();
  if (!raf) return;
  let v = velocity;
  let last = now();
  const step = (): void => {
    inertiaFrame = null;
    const nowMs = now();
    const dt = Math.min(64, Math.max(0, nowMs - last));
    last = nowMs;
    const move = v * dt;
    const before = host.scrollTop;
    host.scrollTop = before + move;
    const applied = host.scrollTop - before;
    v *= Math.exp(-dt / INERTIA_TAU_MS);
    /*
     * 两个停止条件：速度衰减够了、或者**已经滚到头**（`applied` 与期望差得远）。
     * 后者不处理的话，动画会空转完整个衰减过程 —— 表现是"顶上继续甩手指，
     * 页面纹丝不动但一帧都没省"。
     */
    if (Math.abs(v) < 0.02 || Math.abs(applied - move) > 0.5) return;
    inertiaFrame = raf(step);
  };
  inertiaFrame = raf(step);
}

/** 当前活跃的手势（同时只允许一个 —— 真正的多点触控手势不在本作范围内） */
interface ActiveGesture {
  el: HTMLElement;
  handlers: GestureHandlers;
  opts: ResolvedOptions;
  dragging: boolean;
  /**
   * ★ 这次手势已经**判定为滚动**（只能判定一次，见 `beginDrag` 里那一句）。
   *
   * 它是"拖"与"滚"的分水岭：一旦为真，这次手势既不会再开拖，抬手也不会判 tap
   * —— 玩家划了一下屏幕，抬手时不该在他手指底下放下一件物资。
   */
  scrolling: boolean;
  /** 接管滚动时写 `scrollTop` 的那个元素（`pointerdown` 那一刻就算好，见 `resolveScrollHost`） */
  scrollHost: HTMLElement | null;
  start: Point;
  last: Point;
  /**
   * 最近两次移动的采样 `[毫秒, y]`，只用来算**甩动速度**（惯性用）。
   *
   * ⚠ 只留两个（不是"从头到尾记一串"）：甩动的速度是**松手那一刻**的速度，
   * 两次采样算出来的正是它。记一整串要么得出"整段平均速度"（一次"先慢划
   * 后快甩"会被平均成慢速，惯性小于应有的距离），要么得再写一套窗口逻辑 ——
   * 而两次采样在"最后一次 pointermove 到 pointerup 之间"这个窗口里就是对的。
   */
  samples: [number, number][];
  startTime: number;
  longPressTimer: number | null;
  /** 最近一次看到的指针事件时间（"手势自杀检测"用） */
  lastSeenAt: number;
  /** 最近一次看到的指针按键状态 */
  lastButtons: number;
  pointerId: number;
  onWindowSettled: (() => void) | null;
}

let active: ActiveGesture | null = null;

/**
 * 惯性滚动的动画帧 id（同一时刻最多一个）。
 *
 * 三处必须 `stopInertia()`：新手势按下、手势收尾、手势被打断 ——
 * 少一处就会留下一个"还在自己滚"的幽灵动画，而它滚的是**已经被换掉的那块 DOM**。
 */
let inertiaFrame: number | null = null;

/**
 * 甩动衰减的时间常数（毫秒）：速度按 `exp(-t / tau)` 衰减。
 *
 * 400ms 是**看着选的**（真浏览器的惯性大约就是这个手感），而且它有一个好性质：
 * 总滑行距离 = `v0 × tau` —— 速度 1.5px/ms 的甩动滑 600px，慢划 0.4px/ms 滑 160px，
 * 比例关系不用调参就自洽。
 *
 * ⚠ 这已经列进"只有真机能验"的清单（见提交信息）：手感够不够顺，
 * 只有手指能判断，这里给的是浏览器量级的一个合理值。
 */
const INERTIA_TAU_MS = 400;

/**
 * 速度采样窗口：两次采样间隔超过这个毫秒数就丢掉最早那个。
 *
 * 150ms 的理由是"停住之后再松手不算甩"：手指按住不动 200ms 才抬手，
 * 那两次采样的时间差很大、算出来的速度趋近于 0 —— 这一条是**冗余保险**
 * （速度本身已经会算出接近 0 的值），但它让"按住不动"这件事在代码里看得见。
 */
const INERTIA_STALE_MS = 150;
let watchdog: number | null = null;
/**
 * 常驻监听器装在**哪个 window 对象**上。
 *
 * 存对象而不是布尔值，是为了让"换了一个 window"这种情况自动重新安装 ——
 * 单测里每个用例都会 `installFakeWindow()` 造一个新 window，
 * 布尔标志会让第二个用例之后**一个监听都挂不上**（实测踩到过）。
 * 真实浏览器里 `window` 自始至终是同一个对象，这个判断永远为真、零开销。
 */
let installedOn: unknown = null;

/**
 * 手势层的诊断开关（与 ui 层同名）：控制台 `__tunhuoTrace = true` 打开。
 *
 * 加它的原因很具体：手机的日志里出现"每 6px 就被打断一次"，
 * 而"谁打断了它"有**四条**不同的路径（看门狗 / pointercancel /
 * window blur / 新的 pointerdown 顶掉）。不打出来就只能靠猜 —— 猜了三轮了。
 *
 * ★ 2026-10 补了两条曾经"安静地不做任何事"的路径的日志：
 *  · `beginDrag` —— 起手那一刻（没有它，"拖拽没反应"看不出是哪一段断的）；
 *  · `up 判定 tap` —— 抬手时的两个数（位移 / 用时）。这一条是在写胶带拖拽测试时
 *    补的：当时"轻点不触发 onTap"，而**没有任何日志**说明为什么，
 *    只能一个分支一个分支地试。现在它会直接把两个数与两个阈值打出来。
 */
function traceDrag(message: string): void {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  if (w && w['__tunhuoTrace']) {
    // eslint-disable-next-line no-console
    console.log(`[手势] ${message}`);
  }
}

function now(): number {
  return Date.now();
}

/**
 * 常驻监听器：**每个 window 只装一次**，而且只在动手势时才装。
 *
 * 这就是那个"结构上不可能泄漏"的来源 —— 没有 add/remove 配对，就没有配错的机会。
 */
function installWindowListeners(): void {
  if (installedOn === window) return;
  installedOn = window;
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
  window.addEventListener('pointercancel', handleCancel);
  /*
   * ★★ 手势进行中，把浏览器的**原生触摸滚动**按掉。
   *
   * `touch-action: none` 已经保证了"落在格子/纸箱上的手势不发 `pointercancel`"，
   * 但那是**元素级**的声明；iOS 上还有一条元素级声明管不到的东西：
   * 页面级的橡皮筋（overscroll）与"滚动被交给祖先滚动容器"这条路。
   * 一次拖拽如果同时把页面往上拽，玩家看到的是幽灵与页面一起动。
   *
   * 判据只有一个：**当前有没有活跃手势**（`active`）。所以：
   *  · 没在拖 → 一次都不拦，滚动完全不受影响；
   *  · 在拖 → 拦掉，这一趟只属于我们。
   * 这比"按元素判断能不能滚"简单得多，也不会误伤（胶带条那条路径同样受益）。
   *
   * ⚠ `passive: false` 是必须的：被动监听器里 `preventDefault()` **静默无效**
   * （浏览器只在控制台抱怨一句）。而"静默无效"正是这一整类 bug 最爱的形状。
   */
  window.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (!active) return;
      e.preventDefault();
    },
    { passive: false }
  );
  // 页面被切走/隐藏时（切窗口、系统弹层）把手势收掉，别留个幽灵在屏幕上
  window.addEventListener('blur', () => {
    traceDrag('cancel 来源=window blur');
    cancelActive();
  });
}

function clearLongPressTimer(g: ActiveGesture): void {
  if (g.longPressTimer !== null) {
    window.clearTimeout(g.longPressTimer);
    g.longPressTimer = null;
  }
}

/** 收尾：清状态、摘元素上的 dragging 标记、释放指针捕获、跑调用方给的清理 */
function settle(g: ActiveGesture): void {
  clearLongPressTimer(g);
  g.el.classList.remove('is-dragging');
  /*
   * ★ 惯性必须在这里停。
   *
   * 惯性动画是**独立于手势**在跑的（它靠 rAF，不靠指针），所以"手势结束了"
   * 不等于"它停了"。而 `settle` 是四条路的共同出口（抬手 / 看门狗 /
   * `pointercancel` / 新手势顶掉上一轮），惯性漏在任何一条路上，
   * 表现都是"页面自己滚个不停，而手指早就松开了"。
   * ⚠ 唯一的例外是 `handleUp` 里那条滚动路径：它**先**取速度、**再** settle、
   * **然后**才 `startInertia(...)` —— 顺序反过来（先开惯性再 settle）会被这里当场停掉。
   */
  stopInertia();
  /*
   * 显式释放捕获。浏览器通常会在 pointerup 后自动释放，
   * 但"手势被看门狗/新的 pointerdown 提前结束"这几条路不会 ——
   * 捕获留着会让后续的指针事件继续送给那个元素（而不是指针真正底下的那个）。
   */
  try {
    if (g.el.hasPointerCapture(g.pointerId)) g.el.releasePointerCapture(g.pointerId);
  } catch {
    // 元素已经被重绘换掉时释放会失败，忽略即可
  }
  if (active === g) active = null;
  g.onWindowSettled?.();
}

function startWatchdog(): void {
  if (watchdog !== null) return;
  /*
   * 手势自杀检测：每 600ms 看一眼当前手势是不是僵住了。
   *
   * ## 它修的是一个真实的死锁
   *
   * 原来只靠 `pointerup` / `pointercancel` 结束手势，而这两件事**不保证会到**
   * （切窗口、系统弹窗、浏览器把手势当成滚动或返回）。一旦没到，
   * 手势就永远结束不了，之后所有 pointerdown 都会被拒 —— 玩家得刷新页面。
   *
   * 判据用**指针按键状态**而不是"超时没动"：长按之后手指停住不动是合法操作
   * （玩家在想放哪儿），只有"按键已经松开、我们却还认为自己按着"才是真的僵住。
   */
  watchdog = window.setInterval(() => {
    const g = active;
    if (!g) {
      if (watchdog !== null) {
        window.clearInterval(watchdog);
        watchdog = null;
      }
      return;
    }
    const alive = now() - g.lastSeenAt < 1200;
    if (g.lastButtons === 0 || !alive) {
      traceDrag(`cancel 来源=看门狗 buttons=${g.lastButtons} alive=${alive}`);
      const wasDragging = g.dragging;
      settle(g);
      if (wasDragging) g.handlers.onCancel?.();
    }
  }, 600);
}

function beginDrag(g: ActiveGesture, point: Point): void {
  if (g.dragging) return;
  /*
   * ★★ 这一次手势已经判定为"滚动"了，就不能再变成拖拽。
   *
   * 场景：玩家按下、手指一划（越过 `scrollTolerance` → `scrolling = true`），
   * 然后**停在原地 300ms** —— 长按计时器照常到期，`beginDrag` 会被调。
   * 没有这一句，屏幕上会冒出一个幽灵，而玩家只是在滚屏。
   * 手势的含义**只能判定一次**：判成滚动之后，这一趟就归滚动。
   */
  if (g.scrolling) return;
  g.dragging = true;
  g.el.classList.add('is-dragging');
  traceDrag(`beginDrag at ${Math.round(point.x)},${Math.round(point.y)}`);
  g.handlers.onDragStart?.(point);
}

function handleMove(e: PointerEvent): void {
  const g = active;
  /**
   * ★ 过滤掉"上一轮的陈旧监听"。
   *
   * window 上的监听器是**模块级只装一次**的，而单测里每个用例都新建一个假 window
   * —— 上一个用例的监听器还挂在**上一个 window 对象**上，只有 `dispatch` 到那个
   * 对象时才会被调到；真浏览器里 window 自始至终是同一个，这一句永远为真。
   * 它在这里是为了让"一次手势只被它自己那根指针驱动"成为一句写得出来的话
   * （多点触控不在本作范围内，见 `ActiveGesture` 上面那句）。
   */
  if (!g || e.pointerId !== g.pointerId) return;
  g.lastSeenAt = now();
  g.lastButtons = e.buttons;
  const point = { x: e.clientX, y: e.clientY };
  const prev = g.last;
  g.last = point;
  if (g.scrolling) {
    takeOverScroll(g, point.y - prev.y);
    return;
  }
  if (g.dragging) {
    g.handlers.onDragMove?.(point);
    return;
  }
  if (e.pointerType === 'mouse') {
    if (distance(point, g.start) > 6) beginDrag(g, point);
    return;
  }
  /*
   * ★★ 触摸、长按还没成立：按**方向**判"这次手势想不想滚"。
   *
   * ## 这一步必须在长按成立之前做，而且只用方向
   *
   * 长按是 300ms 的等待，而"想滚一下"的人在这 300ms 里早就划出去几十像素了 ——
   * 所以要在他划出去的那一刻就判定，不能等长按窗口过去（那样每次滚屏都会
   * 先冒出一个幽灵）。判据只用 `dy > scrollTolerance && dy > dx`：
   *  · `dy > dx` 把"横着拖物资"排除掉（那是拖拽，不是滚动）；
   *  · `scrollTolerance`（16px）比 `moveTolerance`（12px）大，手抖越不过去。
   */
  const dy = point.y - g.start.y;
  const dx = point.x - g.start.x;
  if (Math.abs(dy) > g.opts.scrollTolerance && Math.abs(dy) > Math.abs(dx)) {
    /*
     * ⚠ 传的是**从起点算起的位移** `dy`，不是"这一帧的增量"。
     *
     * 第一次判定的那一帧，手指已经划出去 `dy` 了（往往几十像素）——
     * 只把"这一帧的增量"交给容器的话，那几十像素会被**吃掉**：
     * 玩家看到的是"手指划了半天，屏幕从某一刻才开始动"，也就是不跟手。
     */
    if (takeOverScroll(g, dy)) return;
    /*
     * 没有滚动容器可接管：这一次手势**作废**。
     *
     * ⚠ 这一支只对"没有滚动容器"的调用方有意义（胶带条：块之间的空白由
     * `.tape-shelf` 自己横向滚，落在块上的竖向滑动既不是滚动也不是拖拽）。
     * **不是**"滚到头了所以作废" —— 那件事在 `takeOverScroll` 里面处理完了
     * （它只要有容器就返回 true，滚不动只是这一刻没位移，见那段注释）。
     */
    traceDrag('cancel 来源=竖向滑动但没有滚动容器');
    settle(g);
    g.handlers.onCancel?.();
  }
  /*
   * ⚠ 不写 `else`：这里的意思是"还没到判滚动的时候，什么都不做"。
   * 以前这个分支里有一整套滚动接管，2026-10 删掉之后**看起来像漏写了**，
   * 现在它又回来了 —— 但这一次 `.room-scroll` 上那行
   * `-webkit-overflow-scrolling: touch` 已经摘掉，不会再有第二层。
   */
}

function handleUp(e: PointerEvent): void {
  const g = active;
  traceDrag(`window pointerup，active=${g ? '有' : '**没有**'}`);
  if (!g || e.pointerId !== g.pointerId) return;
  g.lastSeenAt = now();
  g.lastButtons = 0;
  const point = { x: e.clientX, y: e.clientY };
  const wasDragging = g.dragging;
  const wasScrolling = g.scrolling;
  const host = g.scrollHost;
  /*
   * ★ 速度要在 `settle` **之前**算 —— `settle` 会把 `active` 清空，
   * 而这里还要靠 `g` 上那两次采样决定"松手之后滑多远"。
   */
  const velocity = wasScrolling ? flingVelocity(g) : 0;
  const moved = distance(point, g.start);
  const elapsed = now() - g.startTime;
  settle(g);
  if (wasDragging) {
    g.handlers.onDragEnd?.(point);
    return;
  }
  if (wasScrolling) {
    /*
     * ★★ 滚完抬手**绝不能判 tap**。
     *
     * 玩家划了一下屏幕，抬手那一刻手指底下正好是一件物资 ——
     * 判成 tap 就是"滚屏顺手把东西放下/拿起来了"，而且他完全不知道发生了。
     * 这里连 trace 都不打 tap 那条：这一趟的结论早就定了。
     *
     * ⚠ 惯性只在**这一次手势真的是滚动**时开：一次轻点（没有任何滚动接管）
     * 抬手时 `velocity` 是 0，但那时候根本不该有惯性动画。
     */
    traceDrag(`up 判定滚动：滑行速度=${velocity.toFixed(3)}px/ms`);
    if (host && Math.abs(velocity) > 0.05) startInertia(host, velocity);
    return;
  }
  traceDrag(
    `up 判定 tap：moved=${Math.round(moved)} 容差=${g.opts.moveTolerance} elapsed=${Math.round(elapsed)} 上限=${g.opts.tapMaxMs}`
  );
  if (moved <= g.opts.moveTolerance && elapsed <= g.opts.tapMaxMs) g.handlers.onTap?.(point);
}

function handleCancel(): void {
  traceDrag('cancel 来源=pointercancel');
  cancelActive();
}

/** 把当前手势按"被打断"收掉 */
function cancelActive(): void {
  const g = active;
  if (!g) return;
  const wasDragging = g.dragging;
  settle(g);
  if (wasDragging) g.handlers.onCancel?.();
}

/**
 * 仅供测试：把模块级的常驻状态清空。
 *
 * 为什么需要它：这里的 window 监听器是**模块级只装一次**的，而单测里
 * `installFakeWindow()` 每个用例都新建一个假 window ——
 * 上一个用例的常驻监听器和活跃手势会**跨用例残留**，导致
 * "这个 window 上挂了几份监听"这类断言数字虚高、行为互相干扰。
 * 真实浏览器里只有一个 window、一个页面会话，不存在这个问题。
 *
 * 它不做任何"生产代码在跑的事"，所以放在这里不会影响线上行为。
 */
export function __resetGesturesForTest(): void {
  active = null;
  /*
   * ★ 惯性动画也要停（2026-10 补）。
   *
   * 它由一个 rAF 链驱动，而那条链**不挂在 window 上** —— 上一个用例留下的
   * 惯性会继续跑在下一个用例的假时钟里，往一个已经不存在的 host 上写 `scrollTop`，
   * 表现是"某条断言偶尔差几十像素"。
   */
  stopInertia();
  if (watchdog !== null) {
    clearInterval(watchdog);
    watchdog = null;
  }
  installedOn = null;
}
export function attachPointerGesture(
  el: HTMLElement,
  handlers: GestureHandlers,
  options: GestureOptions = {}
): () => void {
  installWindowListeners();
  const opts: ResolvedOptions = { ...DEFAULTS, ...options };

  const onDown = (e: PointerEvent): void => {
    /*
     * 上一轮手势如果没被正常收掉，这里先清掉再开始新的 ——
     * 新的一次 pointerdown 本身就证明玩家还在操作，没理由继续拒绝他。
     */
    if (active) {
      traceDrag('cancel 来源=新的 pointerdown 顶掉上一轮');
      cancelActive();
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    traceDrag(`pointerdown type=${e.pointerType} buttons=${e.buttons}`);

    const g: ActiveGesture = {
      el,
      handlers,
      opts,
      dragging: false,
      scrolling: false,
      /*
       * ★★ 滚谁在**按下那一刻**就算好，而且整趟手势不再变。
       *
       * 手势中途重绘（`OrganizeScreen.render()` 每次放下/拾取都跑）会把元素
       * 从文档里摘掉，那时再往上找 `parentElement` 就**什么都找不到了** ——
       * 表现是"拖到一半页面突然不滚了"。按下那一刻的答案在整趟手势里都成立。
       */
      scrollHost: resolveScrollHost(el, opts),
      samples: [],
      start: { x: e.clientX, y: e.clientY },
      last: { x: e.clientX, y: e.clientY },
      startTime: now(),
      longPressTimer: null,
      lastSeenAt: now(),
      lastButtons: e.buttons,
      pointerId: e.pointerId,
      onWindowSettled: null
    };
    active = g;
    startWatchdog();
    /*
     * 玩家重新按下 → 上一趟的惯性立刻停。不停的话，新手势写的 `scrollTop`
     * 与惯性动画写的 `scrollTop` 会**互相打架**（同一个属性两个写者），
     * 表现是"按下去的瞬间页面自己跳一下"。
     */
    stopInertia();

    /*
     * 抓住指针。抓住之后后续的 move/up/cancel **一定会送到这个元素**再冒泡到 window，
     * 于是"拖到窗口外再松手"也能收到 pointerup。
     * 指针已经抬起时 `setPointerCapture` 会抛 `NotFoundError`，所以包在 try 里。
     */
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 拿不到捕获不是致命问题：window 上的常驻监听器仍然照常工作
    }

    if (e.pointerType !== 'mouse') {
      clearLongPressTimer(g);
      g.longPressTimer = window.setTimeout(() => beginDrag(g, g.last), opts.longPressMs);
    }
  };

  el.addEventListener('pointerdown', onDown);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    /*
     * ★★ 这里**刻意不取消进行中的手势**（原来的写法会取消，那是"完全不跟手"的根因）。
     *
     * `OrganizeScreen.render()` 每次都会摘掉全部手势再重建，
     * 而"摘掉"发生在元素即将被 `innerHTML` 替换的前一刻 ——
     * 如果在这里 `cancelActive()`，就等于**每一帧渲染都打断进行中的拖拽**：
     * 玩家看到的是幽灵一顿一顿、跟手极差，甚至留下孤儿幽灵。
     *
     * 正确的分工是：
     *  · 这个 detacher 只负责**摘掉元素自己的 pointerdown 监听**；
     *  · 进行中的手势由 **window 上那份常驻监听**继续跑完 ——
     *    它不依赖元素是否还在文档里，`onDragEnd` / `onCancel` 照常送到调用方；
     *  · 幽灵是否还在文档里，由 `ui` 那一层自己判断（见 `moveGhostTo` 的 `isConnected`）。
     *
     * 换句话说：**"元素没了"不等于"手势该结束"**。手势的生死由指针决定，不由 DOM 决定。
     */
  };
}

/**
 * 纯长按（标题进分区编辑用）：鼠标与触摸一视同仁，按住 400ms 触发。
 * 一旦移动超过 10px 就放弃 —— 免得玩家想滚动屏幕时误开弹层。
 *
 * 它与 `attachPointerGesture` 是**两套独立的手势**（长按标题时不应该干扰拖物资），
 * 所以这里仍然用"每个元素自己挂 window 监听"的写法；但它没有 bring-up/teardown
 * 的配对问题：`pointermove`/`pointerup` 在挂载时就装上、卸载时摘掉，
 * 而它的持有者（`longPressDetachers`）本来就被显式清理。
 */
export function attachLongPress(el: HTMLElement, onLongPress: (point: Point) => void, holdMs = 400): () => void {
  let timer: number | null = null;
  let start: Point = { x: 0, y: 0 };
  let fired = false;

  const clear = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    fired = false;
    clear();
    timer = window.setTimeout(() => {
      fired = true;
      onLongPress(start);
    }, holdMs);
  };

  const onMove = (e: PointerEvent): void => {
    if (timer === null) return;
    if (distance({ x: e.clientX, y: e.clientY }, start) > 10) clear();
  };

  const onUp = (): void => {
    if (fired) fired = false;
    clear();
  };

  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    clear();
  };
}
