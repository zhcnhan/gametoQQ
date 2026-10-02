/**
 * 手势层：Pointer Events 手搓（提示词 0 第 2 条：禁止 HTML5 Drag & Drop）。
 *
 * 两条操作路径都要有（§9）：
 *  - 点选-点放：手指抬起时没怎么移动 → 判定为 tap
 *  - 长按拖拽：触摸长按 220ms 后进入拖拽；鼠标则移动 6px 即进入拖拽（不强迫鼠标长按）
 *
 * 关键实现细节：监听器挂在 window 而不是目标元素上 ——
 * 因为"从纸箱里拿出一件"会立刻触发重绘（原元素被替换掉），
 * 如果监听器挂在元素上，那一次的 pointerup 就会丢失，拖拽永远结束不了。
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
   * 长按成立**之前**，手指移动多少像素就判定为"玩家想滚动页面"（放弃手势）。
   *
   * 它比 `moveTolerance` 宽，而且**按方向**用（见 `onMove`）：
   * 竖向移动才算滚动意图，横向移动不算 —— 格子里的东西只能横向拖，
   * 而手指刚按下时抖十几像素实在太容易了。
   */
  scrollTolerance?: number;
}

const DEFAULTS: Required<GestureOptions> = {
  longPressMs: 220,
  moveTolerance: 12,
  tapMaxMs: 500,
  scrollTolerance: 24
};

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function attachPointerGesture(
  el: HTMLElement,
  handlers: GestureHandlers,
  options: GestureOptions = {}
): () => void {
  const opts = { ...DEFAULTS, ...options };
  let active = false;
  let dragging = false;
  let start: Point = { x: 0, y: 0 };
  let last: Point = { x: 0, y: 0 };
  let startTime = 0;
  let timer: number | null = null;
  /** 最近一次看到的指针事件时间戳（毫秒）。"手势自杀检测"用它判断是不是僵住了 */
  let lastSeenAt = 0;
  let lastButtons = 0;
  /** 这一次手势的 pointerId（释放捕获要用） */
  let pointerId = -1;
  let watchdog: number | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const clearWatchdog = (): void => {
    if (watchdog !== null) {
      window.clearInterval(watchdog);
      watchdog = null;
    }
  };

  /**
   * 手势自杀检测（每 600ms 看一眼）。
   *
   * ## 它修的是一个真实的死锁
   *
   * 原来的实现只靠 `pointerup` / `pointercancel` 结束手势。可这两件事**不保证会到**：
   * 切到别的窗口、系统弹出权限框、浏览器把手势当成了滚动或返回手势 ——
   * 那些情况下 `pointerup` 永远不会派发到这个页面。
   * 于是 `active` 永久停在 `true`，而 `onDown` 的第一句就是 `if (active) return` ——
   * **之后所有的 pointerdown 都被忽略**，玩家看到的就是"拖着拖着卡住了，得刷新页面"。
   *
   * 判据用**指针按键状态**而不是"超时没动"：长按之后手指停住不动是合法操作
   * （玩家在想放哪儿），只有"按键已经松开、我们却还认为自己按着"才是真的僵住。
   * `pointermove/up` 都会顺带更新 `lastButtons`，所以正常情况下这个检测不会误伤。
   */
  const startWatchdog = (): void => {
    clearWatchdog();
    watchdog = window.setInterval(() => {
      if (!active) {
        clearWatchdog();
        return;
      }
      const alive = Date.now() - lastSeenAt < 1200;
      if (lastButtons === 0 || !alive) {
        // 按键已经松开了（或者指针事件彻底断了）→ 按"被打断"收尾，让下一次能重新开始
        const wasDragging = dragging;
        finish();
        if (wasDragging) handlers.onCancel?.();
      }
    }, 600);
  };

  const blockScroll = (e: TouchEvent): void => {
    if (dragging && e.cancelable) e.preventDefault();
  };

  const detachWindow = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('touchmove', blockScroll);
    el.classList.remove('is-dragging');
    /*
     * 主动释放捕获。正常情况下浏览器会在 pointerup 后自动释放，
     * 但显式放一次能覆盖"手势被 finish() 提前结束"的路径
     * （比如看门狗判定僵住、或者新的 pointerdown 把上一轮清掉）。
     */
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // 元素已经被重绘换掉时释放会失败，忽略即可
    }
    clearWatchdog();
  };

  const beginDrag = (point: Point): void => {
    if (dragging) return;
    dragging = true;
    el.classList.add('is-dragging');
    document.addEventListener('touchmove', blockScroll, { passive: false });
    handlers.onDragStart?.(point);
  };

  const finish = (): void => {
    clearTimer();
    detachWindow();
    active = false;
    dragging = false;
  };

  const onMove = (e: PointerEvent): void => {
    if (!active) return;
    lastSeenAt = Date.now();
    lastButtons = e.buttons;
    const point = { x: e.clientX, y: e.clientY };
    last = point;
    const moved = distance(point, start);
    if (!dragging) {
      if (e.pointerType === 'mouse') {
        if (moved > 6) beginDrag(point);
        return;
      }
      /*
       * ★ 长按还没成立时，怎么判断"玩家其实是想滚动页面"？
       *
       * 原来的写法是"位移超过 `moveTolerance`（12px）就放弃" —— 那条太苛刻了：
       * 手指刚按下时抖十几像素极其常见，而长按要 220ms 才成立，
       * 于是**大部分想拖拽的手势都在成立之前就被放弃掉了**。
       * 玩家报的"手机上拖不动"就是这个。
       *
       * 现在按**方向**判断意图：
       *  · 房间是竖向滚动的，而格子里的东西只能**横向**拖
       *    （6 列密排，拖拽基本是左右移动）；
       *  · 所以竖向滑得明显 = 想滚页面，放行；
       *  · 横向滑动**不算**滚动意图，继续等长按成立。
       */
      const dy = Math.abs(point.y - start.y);
      const dx = Math.abs(point.x - start.x);
      if (dy > opts.scrollTolerance && dy > dx) {
        finish();
        handlers.onCancel?.();
      }
      return;
    }
    handlers.onDragMove?.(point);
  };

  const onUp = (e: PointerEvent): void => {
    if (!active) return;
    lastSeenAt = Date.now();
    lastButtons = 0;
    const point = { x: e.clientX, y: e.clientY };
    const wasDragging = dragging;
    const moved = distance(point, start);
    const elapsed = Date.now() - startTime;
    finish();
    if (wasDragging) {
      handlers.onDragEnd?.(point);
      return;
    }
    if (moved <= opts.moveTolerance && elapsed <= opts.tapMaxMs) handlers.onTap?.(point);
  };

  const onCancel = (): void => {
    if (!active) return;
    const wasDragging = dragging;
    finish();
    if (wasDragging) handlers.onCancel?.();
  };

  const onDown = (e: PointerEvent): void => {
    /*
     * 上一轮手势如果没被正常收掉（`pointerup` 没到），`active` 会是 `true`。
     * 与其"永久拒绝新的手势"（= 玩家得刷新页面），不如在这里清掉它重来 ——
     * 新的一次 pointerdown 本身就证明玩家还在操作。
     */
    if (active) finish();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true;
    dragging = false;
    start = { x: e.clientX, y: e.clientY };
    last = start;
    lastSeenAt = Date.now();
    lastButtons = e.buttons;
    startTime = Date.now();
    pointerId = e.pointerId;
    /*
     * ★ 抓住指针（pointer capture）。
     *
     * 这是"拖到一半卡住"的**根治**：`pointerup` 原来只挂在 window 上听，
     * 而指针一旦离开页面（拖到窗口外、切窗口、浏览器截走手势），
     * `pointerup` 就可能再也不派发到我们的文档上 —— 于是幽灵停在屏幕上、
     * 手势永远结束不了（玩家看到的就是"卡住了，得点一下原格子才好"）。
     *
     * 抓住之后，后续的 pointermove / pointerup / pointercancel **一定会送到 `el`**，
     * 由它冒泡到 window。这比"事后靠看门狗猜"可靠得多：
     *  · `setPointerCapture` 在指针已经抬起时会抛 `NotFoundError` —— 包在 try 里；
     *  · 元素在手势中途被重绘换掉时，捕获会在元素从文档移除时**自动释放**，
     *    而监听器本来就挂在 window 上，所以那种情况不受影响。
     */
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 拿不到捕获不是致命问题：window 上的监听器仍然照常工作
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    startWatchdog();
    if (e.pointerType !== 'mouse') {
      clearTimer();
      timer = window.setTimeout(() => beginDrag(last), opts.longPressMs);
    }
  };

  el.addEventListener('pointerdown', onDown);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    finish();
  };
}

/**
 * 纯长按（标题进分区编辑用）：鼠标与触摸一视同仁，按住 400ms 触发。
 * 一旦移动超过 10px 就放弃 —— 免得玩家想滚动屏幕时误开弹层。
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
