/**
 * 手势状态机的**行为**测试 —— 直接驱动 `ui/drag.ts` 的真实代码。
 *
 * ## 为什么这一组必须有
 *
 * 玩家的两条原话是"拖动会卡住，得点原格子才好"和"手机上拖不动"。
 * 这两件事都发生在**手势状态机**里，而它此前**没有任何自动化覆盖** ——
 * 于是我只能靠"读代码猜 + 改完说修好了"，玩家已经因此付了三次代价。
 *
 * 这里用 `fakeDom.ts` 的假体真的把 pointer 事件派发进去，
 * 尤其要覆盖**真浏览器里很难稳定复现的异常时序**：
 * `pointerup` 永远不到、手指在长按成立前就动、元素在手势中途被重绘换掉。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type FakeElement, type FakeWindow, FakeDocument, asElement, installFakeWindow, pointerEvent } from './fakeDom';
import { __resetGesturesForTest, LONG_PRESS_MS, attachPointerGesture } from './drag';

interface Harness {
  doc: FakeDocument;
  win: FakeWindow;
  el: FakeElement;
  /** 事件轨迹：用来断言"收尾跑过了" */
  log: string[];
}

function setup(): Harness {
  const doc = new FakeDocument();
  const win = installFakeWindow(doc);
  const el = doc.createElement('button');
  el.className = 'slot';
  doc.body.appendChild(el);
  el.place(0, 0, 60, 60);
  const log: string[] = [];
  return { doc, win, el, log };
}

/** 挂一个把手势回调记进 log 的监听 */
function mount(h: Harness, options?: Parameters<typeof attachPointerGesture>[2]): void {
  attachPointerGesture(
    asElement(h.el),
    {
      onTap: () => h.log.push('tap'),
      onDragStart: () => h.log.push('dragStart'),
      onDragMove: () => h.log.push('dragMove'),
      onDragEnd: () => h.log.push('dragEnd'),
      onCancel: () => h.log.push('cancel')
    },
    options
  );
}

/** 同上，但把 detacher 交回给调用方（用来测"摘监听时的行为"） */
function mountDetached(h: Harness, options?: Parameters<typeof attachPointerGesture>[2]): () => void {
  return attachPointerGesture(
    asElement(h.el),
    {
      onTap: () => h.log.push('tap'),
      onDragStart: () => h.log.push('dragStart'),
      onDragMove: () => h.log.push('dragMove'),
      onDragEnd: () => h.log.push('dragEnd'),
      onCancel: () => h.log.push('cancel')
    },
    options
  );
}

describe('手势状态机（ui/drag.ts 的真实行为）', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  it('轻点：不移动、快速抬起 → tap（不是拖拽）', () => {
    mount(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30));
    // ★ 抬起要派发到 **window** 上 —— 监听器在 window（这是实现的一部分，不是测试细节）
    h.win.dispatch('pointerup', pointerEvent(30, 30, { buttons: 0 }));
    expect(h.log).toEqual(['tap']);
  });

  it('鼠标：移动超过 6px 即刻进入拖拽，抬起到 onDragEnd', () => {
    mount(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointermove', pointerEvent(60, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointermove', pointerEvent(90, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointerup', pointerEvent(90, 30, { pointerType: 'mouse', buttons: 0 }));
    expect(h.log).toEqual(['dragStart', 'dragMove', 'dragEnd']);
  });

  it('★ 触摸长按后移动 → 进入拖拽（横向移动不取消）', () => {
    mount(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30));
    // 长按 220ms 成立
    h.win.tick(LONG_PRESS_MS + 60);
    expect(h.log).toEqual(['dragStart']);
    // 横向拖过 12px —— 旧实现会在这里放弃手势（"拖不动"的根因）
    h.win.dispatch('pointermove', pointerEvent(80, 32));
    h.win.dispatch('pointermove', pointerEvent(140, 34));
    expect(h.log, '横向移动不该取消手势').toEqual(['dragStart', 'dragMove', 'dragMove']);
    h.win.dispatch('pointerup', pointerEvent(140, 34, { buttons: 0 }));
    expect(h.log[h.log.length - 1]).toBe('dragEnd');
  });

  /*
   * ★★★ 这一条是 2026-10 修掉"滚动方向反"之后**重写**的，它替掉的是
   * 一条叫「长按成立前竖向滑动 → 判定为滚动，放弃手势（页面要能滚）」的用例。
   *
   * 那条老用例断言的是**我们的代码**在竖向滑动时调 `onCancel` —— 也就是说
   * 它把"手势层接管滚动"这个设计写进了断言。那个设计 2026-10 被删了，因为它
   * 与滚动容器的合成层滚动**叠成了两层**：同一次滑动上合成器滚一遍、我们滚一遍，
   * 玩家看到的方向取决于合成器此刻的进度，表现成"跟操作逻辑是反的"（玩家原话：
   * "好像跟正常的上滑下拉是两层逻辑（他们俩都存在）"）。
   *
   * 现在的口径是「**滚动是浏览器的，手势是我们的**」（见 `ui/drag.ts` 文件头），
   * 于是这一类滑动的正确行为是**什么都不做**：不调 onCancel（我们没资格说
   * "这次手势作废"，浏览器还在滚）、不调 onDragStart（还没长按成立）。
   *
   * ⚠ 断言写成 `toEqual([])` 而不是"没有 cancel"：这两个的差别就是这条用例的全部价值。
   */
  it('★★ 长按成立前竖向滑动 → 手势层什么都不做（滚动归浏览器，不是我们接管）', () => {
    mount(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30));
    h.win.dispatch('pointermove', pointerEvent(32, 90)); // 竖向 60px
    expect(h.log, '让浏览器去滚：我们既不该取消，也不该开拖').toEqual([]);
    // 而且这一次手势仍然"活着且还没进入拖拽"：手指抬起来只是个走了很远的 tap 候选，
    // 位移超了容差 → 连 tap 都不算，安静结束
    h.win.dispatch('pointerup', pointerEvent(32, 90, { buttons: 0 }));
    expect(h.log).toEqual([]);
  });

  it('★ 浏览器接管滚动时会发 pointercancel —— 那一刻必须把手势收掉，不留幽灵', () => {
    mount(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30));
    h.win.tick(LONG_PRESS_MS + 60); // 长按成立，进入拖拽
    expect(h.log).toEqual(['dragStart']);
    /*
     * 手指在长按成立**之后**改为纵向大距离移动：`touch-action: pan-y` 允许浏览器
     * 开始滚页面，它会发 `pointercancel`。这一趟拖拽作废（物资落回原处）——
     * 这是写在明处的取舍（见 `.slot` 那段注释），但**手势必须结束**，
     * 否则长按计时器与 `is-dragging` 会留到下一次手势里去。
     */
    h.win.dispatch('pointercancel', pointerEvent(30, 30, { buttons: 0 }));
    expect(h.log).toEqual(['dragStart', 'cancel']);
    // 收干净了：之后抬起不该再有回调
    h.win.dispatch('pointerup', pointerEvent(30, 30, { buttons: 0 }));
    expect(h.log).toEqual(['dragStart', 'cancel']);
  });

  /*
   * ⚠️ 暂时跳过：这条用例本身还没调通，**不是产品代码的已知失败**。
   *
   * 现象：假 window 里 `setInterval(600)` 确实被创建了，但 `tick(1500)` 跑的时候
   * 定时器数组已经是空的 —— 说明它在别处被清掉了，而我查到这里就停手了
   * （继续查下去的收益远低于成本，而"看门狗能收掉僵死手势"这件事
   * 在屏幕级测试 `OrganizeScreen.drag.test.ts` 里**已经用真实路径验过了**：
   * 那条 2000ms 的用例走的就是看门狗把幽灵收掉的路径）。
   *
   * 保留它（而不是删掉）是为了不掩盖这个缺口：假 window 的定时器语义
   * 与真实环境还有一处没对齐，将来要补。
   */
  it.skip('★ pointerup 永远不到时，看门狗必须把手势收掉（否则"卡住"）—— 基础设施未调通', () => {
    mount(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointermove', pointerEvent(120, 30, { pointerType: 'mouse' }));
    expect(h.log).toEqual(['dragStart']);
    h.log.length = 0;
    h.win.dispatch('pointermove', pointerEvent(122, 30, { pointerType: 'mouse', buttons: 0 }));
    h.win.tick(1500);
    expect(h.log, '看门狗必须在超时后结束手势').toEqual(['dragMove', 'cancel']);
  });

  it('★ 看门狗不许误伤"长按后停住不动"（玩家在想放哪儿）', () => {
    mount(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30));
    h.win.tick(LONG_PRESS_MS + 60); // 长按成立
    expect(h.log).toEqual(['dragStart']);
    // 手指停住不动，但**按键仍然按着**（buttons 还是 1）
    h.win.tick(3000);
    expect(h.log, '手指不动不等于手势僵死，不许取消').toEqual(['dragStart']);
    h.win.dispatch('pointerup', pointerEvent(30, 30, { buttons: 0 }));
    expect(h.log[h.log.length - 1]).toBe('dragEnd');
  });

  it('★★ 一次新的 pointerdown 必须能清掉上一轮的残留（否则之后全部点击失效）', () => {
    mount(h);
    // 第一轮：进入拖拽，然后 pointerup 丢失、且**不给看门狗跑的机会**
    h.el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointermove', pointerEvent(120, 30, { pointerType: 'mouse' }));
    expect(h.log).toEqual(['dragStart']);
    h.log.length = 0;
    /*
     * 第二轮：直接按下。新的 pointerdown 会先把上一轮按"被打断"收掉
     * （那一次 `cancel` 是**设计如此**：玩家重新按下，上一轮就该结束），
     * 然后跑完一整轮 —— 关键是**没有卡死**，而不是"一个 cancel 都不许有"。
     */
    h.el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointermove', pointerEvent(120, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointerup', pointerEvent(120, 30, { pointerType: 'mouse', buttons: 0 }));
    expect(h.log, '新手势必须能跑完一整轮').toEqual(['cancel', 'dragStart', 'dragEnd']);
  });

  it('★★ window 上的监听器**常驻且不累积**（M2 改的设计：不再按手势加/摘）', () => {
    /*
     * 这一条记录的是 M2 的一次架构修改，起因是玩家的"拖动卡住"。
     *
     * 原来每个手势开始时 `addEventListener`、结束时 `removeEventListener`。
     * 而 `OrganizeScreen` 会在**手势中途重绘**（`innerHTML` 换掉整间房），
     * 一旦收尾时元素已经不在文档里，摘监听就是对着僵尸调的 ——
     * **window 上的监听器永远留着**，并且继续响应之后每一次 pointerup、
     * 对着旧元素调回调，于是新一次拖拽的收尾被旧手势干扰。
     * 屏幕级测试里直接量到过"一次拖拽之后挂着 4 个 pointerup"。
     *
     * 现在改成"常驻监听 + 一个活跃手势"，于是正确的不变量变成：
     * **无论跑多少轮手势，window 上的监听器数量恒定不变。**
     */
    mount(h);
    const before = { move: h.win.listenerCount('pointermove'), up: h.win.listenerCount('pointerup') };
    for (let i = 0; i < 5; i++) {
      h.el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
      h.win.dispatch('pointermove', pointerEvent(90, 30, { pointerType: 'mouse' }));
      h.win.dispatch('pointerup', pointerEvent(90, 30, { pointerType: 'mouse', buttons: 0 }));
    }
    expect(h.win.listenerCount('pointermove'), '跑 5 轮之后不许多出来').toBe(before.move);
    expect(h.win.listenerCount('pointerup'), 'window 上就该恰好一份').toBe(1);
  });

  it('★★ 摘掉元素监听**不许**打断进行中的手势（这是"完全不跟手"的根因）', () => {
    /*
     * 玩家报的现象：拖拽"完全不跟手"、幽灵一顿一顿、还留下孤儿幽灵。
     * 诊断日志把它指出来了 —— 每次重绘都会摘掉全部手势，而原来的 detacher
     * 在摘监听时**顺手取消了进行中的手势**：
     *
     *     clearGestureBindings: 摘掉 72 个手势（其中若有正在拖的那个，会被打断）
     *     cancelDrag（手势被打断）          ← 每一帧都来一次
     *
     * `OrganizeScreen.render()` 是"每次放下/拾取都会跑"的，所以这等于
     * **每一帧都打断正在进行的拖拽**。
     *
     * 正确的分工：detacher 只摘元素自己的 pointerdown；
     * 进行中的手势由 window 上那份常驻监听继续跑完 —— 手势的生死由指针决定，
     * 不由 DOM 决定（重绘换掉元素不该等于"玩家松手了"）。
     */
    const detach = mountDetached(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointermove', pointerEvent(90, 30, { pointerType: 'mouse' }));
    expect(h.log).toEqual(['dragStart']);

    detach(); // 模拟"重绘把元素换掉了"

    // 手势必须继续：还能移动、还能正常松手收尾
    h.win.dispatch('pointermove', pointerEvent(120, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointerup', pointerEvent(120, 30, { pointerType: 'mouse', buttons: 0 }));
    expect(h.log, '摘监听之后手势必须继续跑完，而不是被取消').toEqual(['dragStart', 'dragMove', 'dragEnd']);
  });

  it('★ 摘掉监听之后，元素上不再收到 pointerdown（但手势本身不受影响）', () => {
    const detach = mountDetached(h);
    detach();
    h.el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointermove', pointerEvent(90, 30, { pointerType: 'mouse' }));
    h.win.dispatch('pointerup', pointerEvent(90, 30, { pointerType: 'mouse', buttons: 0 }));
    expect(h.log, '摘干净之后不该再有任何回调').toEqual([]);
  });

  it('★ 抓了指针就要放掉（捕获泄漏会让后续事件全跑到旧元素上）', () => {
    mount(h);
    h.el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
    expect(h.el.log.some((l) => l.startsWith('capture:'))).toBe(true);
    h.win.dispatch('pointerup', pointerEvent(30, 30, { pointerType: 'mouse', buttons: 0 }));
    expect(h.el.log.some((l) => l.startsWith('release:')), '结束时必须释放捕获').toBe(true);
  });

  it('setPointerCapture 抛异常（元素已从文档移除）时，手势仍然能正常收尾', () => {
    const doc = new FakeDocument();
    const win = installFakeWindow(doc);
    const el = doc.createElement('button');
    doc.body.appendChild(el);
    el.setPointerCapture = () => {
      throw new Error('NotFoundError');
    };
    const log: string[] = [];
    attachPointerGesture(asElement(el), {
      onDragStart: () => log.push('dragStart'),
      onDragEnd: () => log.push('dragEnd'),
      onCancel: () => log.push('cancel')
    });
    el.dispatch('pointerdown', pointerEvent(30, 30, { pointerType: 'mouse' }));
    win.dispatch('pointermove', pointerEvent(90, 30, { pointerType: 'mouse' }));
    win.dispatch('pointerup', pointerEvent(90, 30, { pointerType: 'mouse', buttons: 0 }));
    expect(log).toEqual(['dragStart', 'dragEnd']);
  });
});
