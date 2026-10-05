/**
 * 手势层：Pointer Events 手搓（提示词 0 第 2 条：禁止 HTML5 Drag & Drop）。
 *
 * 两条操作路径都要有（§9）：
 *  - 点选-点放：手指抬起时没怎么移动 → 判定为 tap
 *  - 长按拖拽：触摸长按 220ms 后进入拖拽；鼠标则移动 6px 即进入拖拽（不强迫鼠标长按）
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
  /** 手势被打断 / 判定为滚动 */
  onCancel?: () => void;
}

export interface GestureOptions {
  /** 触摸进入拖拽所需的按住时长（毫秒） */
  longPressMs?: number;
  /** 判定为"移动了/要滚动"的像素阈值 */
  moveTolerance?: number;
  /** 点了但停留过久不算 tap 的上限 */
  tapMaxMs?: number;
  /**
   * 长按成立**之前**，手指竖向移动多少像素就判定为"玩家想滚动页面"（放弃手势）。
   *
   * 它按**方向**用（见 `handleMove`）：竖向移动才算滚动意图，横向不算 ——
   * 格子里的东西只能横向拖，而手指刚按下时抖十几像素实在太容易了。
   * 原来用"总位移超过 12px 就放弃"，于是**大部分想拖拽的手势在长按成立前就被放弃**
   * （玩家报的"手机上拖不动"）。
   */
  scrollTolerance?: number;
  /**
   * ★★ 这块区域**由我们自己滚**（玩家 2026-10 第二次报的"正常拖动又不正常了"）。
   *
   * ## 为什么必须自己滚，而不是交回给浏览器
   *
   * 这条是 `.slot` 上 `touch-action` 那两难的另一半，两次都踩过：
   *
   *  · `touch-action: none` → 浏览器**永远不滚动这块区域**（格子铺满整块可滚区，
   *    于是"能滚的地方只剩货架卡之间的缝"，玩家第一次报的就是这个）；
   *  · `touch-action: manipulation` → 浏览器**接管**纵向手势去滚动，
   *    并在接管时发 `pointercancel` —— 而我们的长按计时器还在，300ms 一到
   *    `beginDrag` 照常开拖，**玩家看到的是一个不跟手的幽灵**（第二次报的"正常拖动又不正常"）。
   *
   * 两者不能兼得的原因在于"谁来决定这次手势是什么"只能有一个答案。
   * 既然拖拽必须我们说了算，那就把滚动也一起接过来：`touch-action: none` 保住手势，
   * 竖向移动越过 `scrollTolerance` 时**由我们调用 `scrollTop`**。
   *
   * ⚠ 代价写在这里：这条路**没有惯性滚动**（手指抬起就停），
   * 而且一次手势里是"滚动"就不能再变回"拖拽"（反之亦然）——
   * 两个方向的取舍都指向同一个原则：**手势的含义只能被判定一次**。
   */
  scrollHost?: HTMLElement | null;
}

/**
 * 补全默认值之后的选项。
 *
 * ⚠ `scrollHost` **不在 `Required<>` 里**：它不是"有个默认值"的参数，而是一个
 * "这个调用方有没有自己接管滚动"的开关 —— 没传就是 `undefined`（见 `takeOverScroll`）。
 * 把它塞进 `Required<>` 会逼着 `DEFAULTS` 写一个假的默认元素出来，那个元素一旦被真的
 * `scrollTop +=` 就是往一个游离节点上写，**不报错、也没有任何视觉效果**。
 */
type ResolvedOptions = Required<Omit<GestureOptions, 'scrollHost'>> & Pick<GestureOptions, 'scrollHost'>;

const DEFAULTS: Required<Omit<GestureOptions, 'scrollHost'>> = {
  /*
   * ★ 300ms，不是 220ms（2026-10 玩家反馈后的调整）。
   *
   * 用户报的原话是"下滑上滑的效果不好，容易无效，尤其是在物品整理页面"。
   * 那个问题的根子是"谁来决定这次手势"只能有一个答案，两次都踩过：
   *
   *  · `.slot` 上 `touch-action: none` → 浏览器**永远不滚这块区域**
   *    （格子铺满整块可滚区，于是"能滚的地方只剩货架卡之间的缝"）；
   *  · 改成 `manipulation` → 浏览器接管纵向手势去滚，并顺手发 `pointercancel`，
   *    而我们这边**长按计时器还活着，300ms 一到照样开拖** ——
   *    玩家看到的是一个不跟手的幽灵（第二次报的"正常拖动又不正常了"）。
   *
   * 现在的口径：`touch-action: none` 拿回手势，滚动由手势层自己接管
   * （`GestureOptions.scrollHost`），而**这个阈值就是"滚动 / 拖拽"的分界线**。
   *
   *  · 一次"想滚一下屏幕"的滑动，从按下到手指真的移动，经常要 200ms 出头
   *    （拿起手机、找准位置、再推）。220ms 的窗口太窄 —— 手一迟疑就跨过去了，
   *    于是那次滑动直接被判成拖拽。玩家看到的仍然是"划不动"。
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
  scrollTolerance: 24
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

/** 当前活跃的手势（同时只允许一个 —— 真正的多点触控手势不在本作范围内） */
interface ActiveGesture {
  el: HTMLElement;
  handlers: GestureHandlers;
  opts: ResolvedOptions;
  dragging: boolean;
  start: Point;
  last: Point;
  startTime: number;
  longPressTimer: number | null;
  /** 最近一次看到的指针事件时间（"手势自杀检测"用） */
  lastSeenAt: number;
  /** 最近一次看到的指针按键状态 */
  lastButtons: number;
  pointerId: number;
  onWindowSettled: (() => void) | null;
  /**
   * ★ 这一次手势已经被判定成"滚动"（见 `GestureOptions.scrollHost`）。
   *
   * 判定只发生一次：一旦是滚动，剩下的路程全部用来 `scrollTop`，
   * 而且**长按计时器不会再生效**（否则一个想滚的人会在滚到一半时被拖拽截胡）。
   */
  scrolling: boolean;
}

let active: ActiveGesture | null = null;
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
 * 而"谁打断了它"有**五条**不同的路径（滚动判定 / 看门狗 / pointercancel /
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
   * ★ 接管了滚动的那一次手势，必须把 `touchmove` 的默认行为也吃掉。
   *
   * `.slot` 上的 `touch-action: none` 本来就已经让浏览器不管这块区域了，
   * 这一条是**第二道**防线：`touch-action` 只作用在它写着的那个元素上，
   * 而手势可能在别处（纸箱、胶带条）起手，那些地方的 `touch-action` 是另一个值。
   * 不吃掉的话，同一次滑动会**页面上滚一遍 + 我们滚一遍**（两倍速）。
   *
   * ⚠ `{ passive: false }` 是必须的：Chrome 从 56 起把 window 上的 `touchmove`
   * 默认设成 passive，那时 `preventDefault()` 会**被忽略且只在控制台抱怨**——
   * 也就是"写了但不生效"，正是本仓库最防的那一类。
   */
  window.addEventListener('touchmove', handleTouchMove, { passive: false });
  // 页面被切走/隐藏时（切窗口、系统弹层）把手势收掉，别留个幽灵在屏幕上
  window.addEventListener('blur', () => {
    traceDrag('cancel 来源=window blur');
    cancelActive();
  });
}

function handleTouchMove(e: TouchEvent): void {
  if (!active?.scrolling) return;
  if (e.cancelable) e.preventDefault();
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
  if (g.scrolling) return; // 这次手势已经是"滚动"了，不能再变成拖拽
  g.dragging = true;
  g.el.classList.add('is-dragging');
  traceDrag(`beginDrag at ${Math.round(point.x)},${Math.round(point.y)}`);
  g.handlers.onDragStart?.(point);
}

/**
 * ★★ 把这次手势判定成"滚动"，并自己滚（见 `GestureOptions.scrollHost`）。
 *
 * 返回是否真的滚了。返回 false 时调用方**不要**收手势 ——
 * `scrollHost` 是可选参数，没传的调用方（胶带条那几处）仍然走"放弃手势"的老路。
 *
 * 它同时给 `touchmove` 的那个 `preventDefault` 当判据：只有"我们已经接管了滚动"
 * 的手势才该吃掉浏览器的默认滚动，否则页面会滚两倍。
 */
function takeOverScroll(g: ActiveGesture, deltaY: number): boolean {
  const host = g.opts.scrollHost;
  if (!host) return false;
  g.scrolling = true;
  host.scrollTop += deltaY;
  return true;
}

function handleMove(e: PointerEvent): void {
  const g = active;
  if (!g) return;
  g.lastSeenAt = now();
  g.lastButtons = e.buttons;
  const point = { x: e.clientX, y: e.clientY };
  const prev = g.last;
  g.last = point;
  if (g.scrolling) {
    // 已经接管了滚动：这一趟剩下的路程全部用来滚，不再判任何别的东西
    takeOverScroll(g, point.y - prev.y);
    return;
  }
  if (!g.dragging) {
    if (e.pointerType === 'mouse') {
      if (distance(point, g.start) > 6) beginDrag(g, point);
      return;
    }
    /*
     * 长按还没成立：按**方向**判断滚动意图（见 GestureOptions.scrollTolerance）。
     * ⚠ 这一条也打日志：它是一条**安静地放弃手势**的路径，
     * 而"安静地放弃"在测试里与"什么都没发生"长得一模一样。
     */
    const dy = Math.abs(point.y - g.start.y);
    const dx = Math.abs(point.x - g.start.x);
    traceDrag(`move 未定格 dy=${Math.round(dy)} dx=${Math.round(dx)} 阈值=${g.opts.scrollTolerance}`);
    if (dy > g.opts.scrollTolerance && dy > dx) {
      if (takeOverScroll(g, point.y - prev.y)) {
        traceDrag(`滚动接管 dy=${Math.round(dy)} dx=${Math.round(dx)}`);
        return;
      }
      traceDrag(`cancel 来源=滚动判定 dy=${Math.round(dy)} dx=${Math.round(dx)}`);
      settle(g);
      g.handlers.onCancel?.();
    }
    return;
  }
  g.handlers.onDragMove?.(point);
}

function handleUp(e: PointerEvent): void {
  const g = active;
  traceDrag(`window pointerup，active=${g ? '有' : '**没有**'}`);
  if (!g) return;
  g.lastSeenAt = now();
  g.lastButtons = 0;
  const point = { x: e.clientX, y: e.clientY };
  const wasDragging = g.dragging;
  const moved = distance(point, g.start);
  const elapsed = now() - g.startTime;
  settle(g);
  if (wasDragging) {
    g.handlers.onDragEnd?.(point);
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
      start: { x: e.clientX, y: e.clientY },
      last: { x: e.clientX, y: e.clientY },
      startTime: now(),
      longPressTimer: null,
      lastSeenAt: now(),
      lastButtons: e.buttons,
      pointerId: e.pointerId,
      onWindowSettled: null,
      scrolling: false
    };
    active = g;
    startWatchdog();

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
