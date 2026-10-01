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
}

const DEFAULTS: Required<GestureOptions> = {
  longPressMs: 220,
  moveTolerance: 12,
  tapMaxMs: 500
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

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
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
    const point = { x: e.clientX, y: e.clientY };
    last = point;
    const moved = distance(point, start);
    if (!dragging) {
      if (e.pointerType === 'mouse') {
        if (moved > 6) beginDrag(point);
        return;
      }
      if (moved > opts.moveTolerance) {
        // 手指在长按成立之前先动了 → 玩家想滚动页面，放行
        finish();
        handlers.onCancel?.();
      }
      return;
    }
    handlers.onDragMove?.(point);
  };

  const onUp = (e: PointerEvent): void => {
    if (!active) return;
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
    if (active) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true;
    dragging = false;
    start = { x: e.clientX, y: e.clientY };
    last = start;
    startTime = Date.now();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
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
