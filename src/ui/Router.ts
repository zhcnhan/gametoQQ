/**
 * 界面路由：把 `RunState.phase` 映射到具体界面（§4A「恢复即续玩」的落点）。
 *
 * 为什么用"整页重建"而不是"多页共存 + 显示隐藏"：
 * 整理界面持有拖拽手势、抽屉、滚动位置这些瞬时状态，切走再切回来时留着它们
 * 只会让"刷新后应该回到哪"这个问题变得无法回答。整页重建 = 界面状态永远可由存档推导。
 */

export interface Screen {
  /** 建 DOM、挂事件（只在进入这个界面时调一次） */
  mount(): void;
  /** 数据变了，重绘（同一个界面内被反复调用） */
  render(): void;
  /**
   * 离开这个界面时调用。
   *
   * ★ 必须实现的原因（真踩过的坑）：界面把事件委托挂在 `#app` 上，而 Router 换页只做
   * `innerHTML = ''` —— 那只清掉了子元素，**清不掉挂在 #app 自己的监听器**。
   * 于是"扫货 → 整理 → 扫货"来回切一轮，shop 的监听器就留下两个，
   * 点一次「搬回车上」会真的成交两箱。所有挂在宿主元素上的监听器都必须在这里摘掉。
   */
  dispose?(): void;
}

export type ScreenKey = 'prologue' | 'shop' | 'organize' | 'night' | 'ending' | 'pending';

export class Router {
  private readonly root: HTMLElement;
  private readonly make: (key: ScreenKey) => Screen;
  private readonly keyOf: () => ScreenKey;
  private current: { key: ScreenKey; screen: Screen } | null = null;

  constructor(root: HTMLElement, keyOf: () => ScreenKey, make: (key: ScreenKey) => Screen) {
    this.root = root;
    this.keyOf = keyOf;
    this.make = make;
  }

  get currentKey(): ScreenKey | null {
    return this.current ? this.current.key : null;
  }

  /** phase 变了就换页，没变就重绘当前页 */
  render(): void {
    const key = this.keyOf();
    if (!this.current || this.current.key !== key) {
      // 先摘干净旧界面的监听器，再清 DOM —— 顺序反了就会留下一批指向已死节点的委托
      this.current?.screen.dispose?.();
      this.root.innerHTML = '';
      const screen = this.make(key);
      this.current = { key, screen };
      screen.mount();
      return;
    }
    this.current.screen.render();
  }
}
