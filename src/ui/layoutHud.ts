/**
 * DEV 屏上诊断 —— 用户点名要的那个"检测"。
 *
 * ## 为什么要做这个东西（原话：「你就不能加个检测嘛，你一直在你自己那个假的dom里玩什么呢！」）
 *
 * 这一轮之前，关于"手机上的版面到底挤不挤""滑动到底往哪边"，我的证据**全部**
 * 来自我自己写的量具：无头 Chrome + 我自己挑的视口（375×667 / 390×710）+ 我自己
 * 写的判据。三次报障、三次"复量全绿"，而真机上一直是错的 —— 因为
 *
 *   ① 我挑的视口**恰好落在一个为他而写的媒体查询档里**，他真机的尺寸落在档外；
 *   ② 我的判据是"两个区域方向一致吗"，而它们**一致地反着**。
 *
 * 教训：判据不能从实现里推，尺寸不能从截图反推。真机上唯一可信的裁判是
 * **用户的眼睛 + 一次滑动**。所以这里把两件事搬到屏幕上，让他滑一下、
 * 截一张图，我就能拿到真相：
 *
 *   ① **逐块高度**：视口 / dvh / dpr，顶栏的每一个直接子元素，房间，操作台的
 *      每一个直接子元素 —— 不再由我猜他的机型；
 *   ② **最近一次滚动**：`手指 Δy` 与 `scrollTop Δ` 并排给出，附
 *      `✓ 跟手 / ✗ 反向！/ · 到边了（判不出来）` 的判定（数字来自
 *      `ui/drag.ts` 的 `scrollReport()`，就是真机上那一次滚动的**实测**值）。
 *
 * ## 怎么用
 *
 * DEV 里**左下角**永远有一枚极小的读数条（`pointer-events: none`，不挡任何点击）；
 * **点一下窗外那条带子**（`.window-band`，它自己没有交互）展开完整面板，
 * 点面板本身收起。也可以在地址后面加 `?hud=1` 让它开局就是展开的
 * （手机地址栏里加参数比长按好按）。
 *
 * ⚠ 三件事：① 整个模块只在 `import.meta.env.DEV` 里被**动态** import
 * （见 `main.ts`），生产构建里它连文件都不会进包；② 面板用**内联样式**，
 * 不进 `style.css` —— 一个诊断不该改产品的样式表，也不该被
 * `scripts/check-style.mjs` 的版面契约管着；③ 关闭时**一次几何都不量**
 * （只读 `scrollReport()` 那个纯数字），否则 250ms 一次的
 * `getBoundingClientRect` 会在他判断"惯性顺不顺"的时候抢主线程 ——
 * 量具本身不许成为被测对象的噪声。
 */
import { scrollReport } from './drag';

const TICK_MS = 250;

/** 面板打开时列的三个"逐块高度"清单 */
const HEADER_SEL = '.topbar';
const ROOM_SEL = '[data-room]';
const DOCK_SEL = '.dock';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function round(n: number): number {
  return Math.round(n);
}

function heightOf(sel: string): number {
  const el = document.querySelector(sel);
  return el ? round(el.getBoundingClientRect().height) : 0;
}

/**
 * 一个容器里**每个直接子元素**各占多高，按屏幕上的顺序。
 *
 * ★ 这里量的是结构而不是一张手写名单：版面每改一次，手写名单就得人回来改一次
 * （我已经漏过一次，量出来三行 `—px`），而 `children` 永远不会和 DOM 走散。
 */
function partsOf(sel: string): string {
  const el = document.querySelector(sel);
  if (!el) return '—';
  return [...el.children]
    .map((c) => {
      const cls = typeof c.className === 'string' ? c.className.split(/\s+/)[0] : '';
      const label = cls !== '' && cls !== undefined ? cls.replace(/^(is-|has-)/, '$1') : c.tagName.toLowerCase();
      return `${label} ${round(c.getBoundingClientRect().height)}`;
    })
    .join(' · ');
}

function viewportLine(): string {
  const vv = window.visualViewport;
  const dvh = heightOf('#app');
  const parts = [
    `屏 ${window.innerWidth}×${window.innerHeight}`,
    `dpr ${window.devicePixelRatio}`,
    `#app ${dvh}`,
    vv ? `可视 ${round(vv.width)}×${round(vv.height)}` : '可视 —'
  ];
  return parts.join(' · ');
}

/**
 * 那一行滚动读数。
 *
 * ★ 措辞必须把**两个量分开写**：「手指」是手指的位移（↓ = 手指往下），
 *   「scrollTop」是容器那两个数字的差。**跟手 = 手指往下而 scrollTop 变小**
 *   （手指往下，要看到的是上面的东西），所以判定看的是两者**异号**。
 *
 *   ⚠ 别把它简化成"手指 ↓160 → 内容 ↓160"：那一版里"内容"其实写的是
 *     手指位移（取反取错了），而它照样读得通、照样是绿色的 —— 一个读得通的
 *     假警报比没有警报更坏（`drag.ts` 的 `scrollDelta` 注释里记着这一笔）。
 */
function scrollLine(): string {
  const r = scrollReport();
  if (!r) return '滚动 · 还没滑过（在货架或纸箱上划一下）';
  const finger = `${r.finger > 0 ? '↓' : '↑'}${round(Math.abs(r.finger))}`;
  const top = `${r.scroll > 0 ? '+' : r.scroll < 0 ? '−' : ''}${round(Math.abs(r.scroll))}`;
  const tail = `　手指 ${finger} · scrollTop ${top}　[${r.host}]`;
  if (r.verdict === 'clipped') return `滚动 · 到边了（判不出来）${tail}`;
  if (r.verdict === 'follows') return `滚动 ✓ 跟手${tail}`;
  return `滚动 ✗✗ **反向**！${tail}`;
}

/** 收起时那一条：只读纯数字，**不量几何**（见文件头第 ③ 条） */
function chipText(): string {
  const r = scrollReport();
  const mark = !r ? '· 未滑' : r.verdict === 'follows' ? '✓ 跟手' : r.verdict === 'reverse' ? '✗ 反向' : '· 到边';
  return `${window.innerWidth}×${window.innerHeight} · 房间 ${heightOf(ROOM_SEL)} · 滚动 ${mark}`;
}

function panelText(): string {
  const room = document.querySelector(ROOM_SEL);
  const scrollable = room ? Math.max(0, room.scrollHeight - room.clientHeight) : 0;
  return [
    viewportLine(),
    `顶栏 ${heightOf(HEADER_SEL)} · ${partsOf(HEADER_SEL)}`,
    `房间 ${heightOf(ROOM_SEL)}（内容 ${room ? round(room.scrollHeight) : 0} · 可滚 ${round(scrollable)}）`,
    `操作台 ${heightOf(DOCK_SEL)} · ${partsOf(DOCK_SEL)}`,
    scrollLine()
  ].join('\n');
}

let chip: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let open = false;
let listening = false;

function paint(): void {
  if (chip !== null) chip.textContent = chipText();
  if (open && panel !== null) panel.textContent = panelText();
}

function toggle(next: boolean): void {
  open = next;
  if (panel !== null) panel.style.display = open ? 'block' : 'none';
  paint();
}

/**
 * 装上诊断。
 *
 * ★ 幂等：面板与读数条是**模块级**的（只建一次），`document` 上的监听器
 * 也只挂一次 —— 所以 router 换屏、Vite 热更新、重复调用都只是重新 `paint()`，
 * 不会在同一个 `click` 上叠出第二套监听器（叠出来的表现是"点一下带子，
 * 面板闪一下就没了"，因为两次 toggle 互相抵消）。
 */
export function installLayoutHud(): void {
  if (chip !== null && chip.isConnected) {
    paint();
    return;
  }
  chip?.remove();
  panel?.remove();

  chip = document.createElement('div');
  chip.id = 'layout-hud-chip';
  chip.setAttribute('aria-hidden', 'true');
  chip.style.cssText =
    `position:fixed;left:0;right:0;bottom:0;z-index:9998;pointer-events:none;` +
    `background:rgba(28,24,18,.78);color:#f6f1e6;font:10px/1.5 ${MONO};` +
    `text-align:center;white-space:nowrap;overflow:hidden;padding:1px 6px calc(1px + env(safe-area-inset-bottom))`;

  const node = document.createElement('div');
  panel = node;
  node.id = 'layout-hud';
  node.setAttribute('role', 'note');
  node.style.cssText =
    `position:fixed;left:0;right:0;top:0;z-index:9999;display:none;` +
    `background:rgba(28,24,18,.94);color:#f6f1e6;font:11px/1.55 ${MONO};` +
    `padding:calc(6px + env(safe-area-inset-top)) 10px 8px;white-space:pre-wrap;word-break:break-all`;

  document.body.append(chip, node);

  if (!listening) {
    listening = true;
    /*
     * ★ 委托到 `document` 而不是挂在那条带子上：`mount()` 只画一次，
     * 但换屏 / 重开的时候整块顶栏会重建，挂元素上的监听器会跟着死掉。
     */
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('#layout-hud')) {
        toggle(false);
        return;
      }
      if (target.closest('.window-band')) toggle(!open);
    });
    /*
     * ★ 自愈：万一有哪一处把 `document.body` 的孩子们换掉了（换屏 / 重开），
     * 下一次手指按下时把诊断装回去。判据是"节点还在不在文档里"，
     * 而不是"有没有调用过 `installLayoutHud`"。
     */
    document.addEventListener(
      'pointerdown',
      () => {
        if (chip === null || !chip.isConnected) installLayoutHud();
      },
      true
    );
    window.setInterval(paint, TICK_MS);
  }
  toggle(/(^|[?&#])hud(=|&|$)/.test(`${location.search}${location.hash}`));
  expose();
}

/**
 * 给探针/控制台留一个把手：`__tunhuoHud.text()` 拿到的是**同一份字符串**，
 * 所以"人看到的"和"探针读到的"不可能不一致。
 */
function expose(): void {
  (window as unknown as Record<string, unknown>)['__tunhuoHud'] = {
    show: () => {
      installLayoutHud();
      toggle(true);
    },
    hide: () => toggle(false),
    text: () => `[chip] ${chipText()}\n[panel]\n${panelText()}`
  };
}
