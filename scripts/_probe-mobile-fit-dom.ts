/**
 * ────────────────────────────────────────────────────────────────────────────
 *  量具：在真浏览器里量"固定不滚的那几块"到底占多高
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ## 为什么不能靠算
 *
 * 手机上"看不见格子"是一道减法题：`100dvh` 减去顶栏、窗外那条带子、操作台。
 * 这几块的高度由**文字行高 + 内边距 + 边框**叠出来，看 CSS 猜出来的数字误差
 * 能到 ±30px —— 而这个误差正好等于"看得见两行"和"看得见一行"的差别。
 *
 * 所以这里开一个**真的无头 Chrome**，在真的视口尺寸下让 App 自己跑起来，
 * 用 `getBoundingClientRect` 把每一块量出来。
 *
 * ★ 用的是 Node 24 自带的 `WebSocket` 与 Chrome 自己的 DevTools 协议，
 *   **不需要装 puppeteer / playwright**（这个仓库不引新依赖）。
 *
 * ## 它量的是哪一屏
 *
 * 入口那几屏（开场 / 今日采购）在**同一套骨架**里：`.screen` = `.topbar` +
 * `windowBandHtml` 那条带子 + 可滚的主体 + `.dock`。所以量它们就等于量"顶栏
 * 与操作台各占多高"，那正是这里要的两个数。
 *
 * 整理页的 `.tape-shelf` 比别的屏多一块（44px + 10px），已在下面单独标注。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/';
const PORT = 9333;

/**
 * 要量的视口（宽 × 高）。第一档是用户报"看不见格子"的那一类机器。
 *
 * ★ `VIEWPORTS=390x710,390x780` 可以覆盖这一份 —— 用户的真机（浏览器 chrome +
 *   系统栏吃掉约 136 逻辑像素）落在**这几档之间**，而写死的那三档里没有它。
 *   判据要用真机的高度去量，不能拿"手边正好有的那一档"顶替。
 */
function parseViewports(spec: string | undefined): Array<{ w: number; h: number; label: string }> {
  if (!spec) return [];
  return spec
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean)
    .map((one) => {
      const [w, h] = one.split('x').map((n) => Number(n.trim()));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        throw new Error(`VIEWPORTS 里这一项看不懂：${one}（要写成 390x710 这样）`);
      }
      return { w, h, label: `自定义 ${w} × ${h}` };
    });
}

const OVERRIDE = parseViewports(process.env['VIEWPORTS']);
const VIEWPORTS: Array<{ w: number; h: number; label: string }> = OVERRIDE.length
  ? OVERRIDE
  : [
      { w: 375, h: 667, label: 'iPhone SE / 老安卓' },
      { w: 390, h: 844, label: 'iPhone 14/15' },
      { w: 1280, h: 800, label: '桌面' },
    ];

const profile = mkdtempSync(join(tmpdir(), 'probe-mobile-'));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(what: string, ok: () => Promise<boolean>, timeoutMs = 30000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await ok()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`等不到 ${what}`);
    await sleep(200);
  }
}

let chrome: ChildProcess | null = null;

async function launch(): Promise<void> {
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  await waitFor('Chrome 的调试端口', async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return r.ok;
    } catch {
      return false;
    }
  });
}

interface Target {
  id: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

class Cdp {
  private ws: WebSocket;
  private next = 1;
  private pending = new Map<number, { ok: (v: unknown) => void; bad: (e: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String((ev as MessageEvent).data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (typeof msg.id !== 'number') return;
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.error) slot.bad(new Error(msg.error.message));
      else slot.ok(msg.result);
    });
  }

  static async attach(wsUrl: string): Promise<Cdp> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((ok, bad) => {
      ws.addEventListener('open', () => ok(), { once: true });
      ws.addEventListener('error', () => bad(new Error('连不上 DevTools')), { once: true });
    });
    return new Cdp(ws);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.next++;
    return new Promise<T>((ok, bad) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, bad });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** 量一屏，再把"这一屏能点哪儿"一并报出来（用于走到整理页） */
const MEASURE = `(async () => {
  const SCENE = ${JSON.stringify(process.env['SCENE'] ?? '')};
  const waitFor = async (sel, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const el = document.querySelector(sel);
      if (el) return el;
      if (Date.now() - t0 > ms) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  await waitFor('#app > *', 20000);
  const app = document.querySelector('#app');
  if (!app || !app.firstElementChild) return { error: 'App 没渲染出来' };

  /*
   * 走到整理页。
   *
   * 这不是"模拟玩家点击"，而是用仓库自己的 dev 钩子把状态摆到那一天的整理页。
   * ★ 它只在 dev 构建里存在 —— 量具本来就跑在 dev 服务上。
   *
   * 空屋子那一档用 jump(-1)（囤货期最后一天，行动点满）。
   * ★★ 但**空屋子是最好看的那一档** —— 用户报的是"元素多的时候"看不见格子，
   *   所以 SCENE 非空时改成 load 一个压测档（100boxes = 100 箱 / 1000+ 件）。
   *   load 会 window.location.reload()，所以它**永远不 resolve**：
   *   绝不能 await 它（await 了就永远量不到东西），只能发出去再等页面自己回来。
   */
  const tun = window.__tunhuo;
  /*
   * ★★ 这个标记必须活在 **sessionStorage** 里，不能只是个 window 变量：
   *   load() 会刷新页面，回来后 window 上的一切都没了 —— 用 window 变量的话
   *   第二趟会再 load 一次，于是**无休止地刷新**（表现是量具卡住、什么都不报）。
   */
  const KEY = '__tunhuoProbeArmed';
  const armed = sessionStorage.getItem(KEY) === '1';
  /*
   * ★★ 这一段"推进"必须**所有档都走一遍**，不能只在 SCENE 为空时走。
   *
   *   load('good') 装好的是一份**从 D-7 开始**的囤货档，落到的是开场 / 扫货那几屏，
   *   整理页还在两步之后。第一版把推进写进了 else 分支里，于是量 good 得到的是
   *   screen-plain（.scroll，没有 .dock-boxes）—— 数字全对、屏幕全错，
   *   而量具只会在末尾轻描淡写地打一句"没走到整理页"。
   *   判据是**落在哪一屏**，不是"存档装没装好"。
   */
  const pushTowardRoom = async (deadlineMs) => {
    const t0 = Date.now();
    while (!document.querySelector('.room-scroll') && Date.now() - t0 < deadlineMs) {
      const btn = [...document.querySelectorAll('button, [data-action]')].find((el) => {
        if (el.disabled) return false;
        const t = (el.textContent || '').replace(/\s+/g, '');
        return /回家整理|去整理|开始整理|下一步|继续|确认|知道了|开始/.test(t);
      });
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  if (SCENE) {
    if (!armed) {
      sessionStorage.setItem(KEY, '1');
      try { tun.load(SCENE); } catch (e) { /* 加载失败会一直停在旧屏，下面 waitFor 会报出来 */ }
      await new Promise((r) => setTimeout(r, 1500));
      await waitFor('.room-scroll', 20000);
    }
    /* 存档回来之后仍然要自己走到整理页（见上面那段注释） */
    await pushTowardRoom(15000);
  } else if (!armed) {
    sessionStorage.setItem(KEY, '1');
    const t0 = Date.now();
    while (!document.querySelector('.room-scroll') && Date.now() - t0 < 15000) {
      try { tun.jump(-1); } catch (e) { /* 还没初始化好，下一轮再来 */ }
      await new Promise((r) => setTimeout(r, 300));
      /*
       * jump(-1) 落在**扫货页**（囤货期的默认落脚点），整理页要从那儿进 ——
       * 就是玩家走的那一步：「回家整理」。这一步点不动就说明入口改了名，
       * 量具宁可报错也不要悄悄量错屏。
       */
      const home = [...document.querySelectorAll('button, [data-action]')].find((el) =>
        /回家整理|去整理|整理/.test(el.textContent || ''));
      if (home && !document.querySelector('.room-scroll')) home.click();
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  await waitFor('.room-scroll', 10000);
  await new Promise((r) => setTimeout(r, 400));

  const screen = app.firstElementChild;

  const h = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height) };
  };
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 50) : null;
  };
  const cs = (sel, name) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).getPropertyValue(name).trim() : null;
  };
  const buttons = [...document.querySelectorAll('button, [data-action], [role="button"]')]
    .filter((el) => el.offsetParent !== null || el === document.activeElement)
    .slice(0, 24)
    .map((el) => ((el.getAttribute('data-action') || el.getAttribute('data-slot') || el.getAttribute('data-box') || el.tagName.toLowerCase()) +
      (el.disabled ? '(disabled)' : '') + ':' +
      (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18)));

  const body = h('.room-scroll') ? '.room-scroll' : '.scroll';
  const topbar = document.querySelector('.topbar');
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    screen: [...screen.classList].join(' '),
    h1: text('h1'),
    sub: text('.sub') || text('.title'),
    topbar: h('.topbar'),
    /*
     * ⚠ 2026-10：整理页的顶栏重排之后，.topbar-row 在**这一屏**已经不存在了
     * （它换成了 .topbar-head，见 ui/OrganizeScreen.ts 的 mount）；
     * 别的屏（夜间 / 开局 / 商店 / 生存）仍然是 .topbar-row，所以两条都留着。
     * 量某个具体元素时**先看下面那张按 DOM 走的结构表** —— 它才是判据。
     * ⚠⚠ 这段注释写在 MEASURE 那个模板字面量里：**反引号一个都不许出现**
     *   （第四次踩，症状是 esbuild 报 Expected ";" but found "xxx"，行号还指在几十行之前）。
     */
    topbarRow: h('.topbar-row'),
    topbarHead: h('.topbar-head'),
    topbarTools: h('.topbar-tools'),
    score: h('.score'),
    tapeShelf: h('.tape-shelf'),
    runBar: h('.run-bar'),
    runBarRow: h('.run-bar-row'),
    body,
    bodyBox: h(body),
    titleRow: h('.title'),
    dock: h('.dock'),
    dockHand: h('.dock-hand'),
    dockBoxes: h('.dock-boxes'),
    dockBoxesCap: cs('.dock-boxes', 'max-height'),
    /* ★ 纸箱那一栏的抬头（"还没拆的箱子" + 「收起」），它在手机上是一整行、约 40px */
    boxesHead: h('.boxes-head'),
    boxFold: h('.boxes-fold'),
    /* ★ 手里那块牌子自己占多高（.dock-hand 就是它的容器；.hand-card 不存在） */
    handCard: h('.dock-hand'),
    /* ★ 窗外那条带子的**整条**（.run-bar = 带子 + 先知日历行），用来看配比 */
    windowBand: h('.window-band'),
    /*
     * ★★ "合计对不上"时必须能量到剩下的那一块（M5 补）。
     *
     * 第一次拆账时十块加起来 560px，而视口 710px —— 差 150px。
     * 那 150px 就是 .topbar 与 .dock 自己的 padding 与内部 gap，
     * 一个个量出来才能把账做平；否则"还差 150px"会一直被当成量具坏了。
     */
    topbarPad: (function () {
      var el = document.querySelector('.topbar');
      if (!el) return null;
      var s = getComputedStyle(el);
      return {
        top: Math.round(parseFloat(s.paddingTop)),
        bottom: Math.round(parseFloat(s.paddingBottom)),
        gap: Math.round(parseFloat(s.rowGap) || 0),
        children: el.children.length,
      };
    })(),
    dockPad: (function () {
      var el = document.querySelector('.dock');
      if (!el) return null;
      var s = getComputedStyle(el);
      return {
        top: Math.round(parseFloat(s.paddingTop)),
        bottom: Math.round(parseFloat(s.paddingBottom)),
        gap: Math.round(parseFloat(s.rowGap) || 0),
        children: el.children.length,
      };
    })(),
    /*
     * ★★ 这一栏的**内容**有多高（M5 补）。
     *
     * 只量容器高度会被 max-height 骗：上限是 170px 时，两行箱子只占 102px，
     * 剩下 68px 是**空的**，而"房间少了一截"却是因为这个上限写的。
     * 判据必须是"内容多高 vs 上限多少"——两者差得远就说明上限该收。
     */
    dockBoxesScroll: (function () {
      var el = document.querySelector('.dock-boxes');
      return el ? Math.round(el.scrollHeight) : null;
    })(),
    /*
     * 纸箱那一叠的两个数（M5 加）：一个箱子多高、能看见几行。
     *
     * 用户报的是这一栏太占地方、但不能一直收起来，于是这一栏的判据不是容器多高，
     * 而是同一块高度里能看见几个箱头。只量容器高度会得出改了等于没改的错误结论：
     * 容器被 max-height 钉住，箱子变小了它也不变。
     */
    box: h('.box'),
    boxCount: document.querySelectorAll('.box').length,

    /*
     * ★★ 行数与每行个数**不能靠 getBoundingClientRect 的 top 去重来数**。
     *
     * 第一版就是这么数的（把 top 四舍五入之后当键）。结果 4 个一行的纸箱
     * 被数成 27 行（100 ÷ 27 ≈ 3.7）—— 因为同一行的格子 top 会是 421 与 421.5
     * 这种**亚像素**差，四舍五入之后就分成两个键。
     * 判据换成"**最左边那一列有几个**"：left 最小的那些格子，一个就是一行。
     * （left 之间也可能有亚像素差，所以同样先四舍五入再比 —— 同一列取整后必然相等。）
     *
     * ⚠ 这个文件里凡是写在 MEASURE 这一段里的注释，**一律不许出现反引号**：
     *   MEASURE 本身就是反引号字符串，注释里再写一个就把字符串提前结束了
     *   （报错是 esbuild 的 Expected ";" but found …，行号还指在几十行之前）。
     */
    boxPerRow: (function () {
      var boxes = Array.prototype.slice.call(document.querySelectorAll('.box'));
      if (!boxes.length) return null;
      var min = Infinity;
      for (var i = 0; i < boxes.length; i++) {
        min = Math.min(min, Math.round(boxes[i].getBoundingClientRect().left));
      }
      var n = 0;
      for (var j = 0; j < boxes.length; j++) {
        if (Math.round(boxes[j].getBoundingClientRect().left) === min) n += 1;
      }
      return n;
    })(),
    /*
     * ★ 名字那一格还剩多少宽（M5 补）。
     *
     * 横排把"名字"从整张卡的宽度挤成了"卡宽 − 图标 − 间隙 − 内边距"，
     * 于是"粮油箱"这种三个字的名字会在真机上被截成"粮油…" —— 而这件事
     * **任何高度数字都看不出来**。判据是 metaWidth 与 nameWidth 够不够放下
     * 三个汉字（12px 字号 ≈ 36px）。
     */
    boxWidth: (function () {
      var el = document.querySelector('.box');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    })(),
    boxMetaWidth: (function () {
      var el = document.querySelector('.box-meta');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    })(),
    boxNameWidth: (function () {
      var el = document.querySelector('.box-name');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    })(),
    /*
     * ★★ 判据不是"名字格多宽"，而是"**三个汉字要占多宽**"（M5 补）。
     *
     * 36px 这个数字本身说明不了任何事 —— 它够不够取决于字号与字体。
     * 拿一个屏幕外的 span 用同一套字体量一次"粮油箱"的宽度，就能直接比出
     * "差多少像素"，也不必凭截图猜。
     */
    nameNeed: (function () {
      var probe = document.querySelector('.box-name');
      if (!probe) return null;
      var cs = getComputedStyle(probe);
      var span = document.createElement('span');
      span.textContent = '粮油箱';
      span.style.font = cs.font;
      span.style.position = 'absolute';
      span.style.visibility = 'hidden';
      span.style.whiteSpace = 'nowrap';
      document.body.appendChild(span);
      var w = Math.round(span.getBoundingClientRect().width);
      span.parentNode.removeChild(span);
      return w;
    })(),
    /*
     * ★★ 卡片内部的账单（M5 补）—— 名字被截断这件事必须能一眼拆开算。
     *
     * .box-meta 是 flex 子项，它的宽度是"flex-basis: auto 算出来的内容宽"
     * 与"容器剩多少"里的小者；这两个数只要不在同一行就会出现
     * "明明还有空位，名字却被截成两个字"这种自相矛盾的读数。
     * 所以这里把 flexGrow / scrollWidth（内容想要多宽）与实得宽一起打出来。
     *
     * ⚠ 同前：这一段里的注释不许出现反引号。
     */
    boxMetaFlexGrow: cs('.box-meta', 'flex-grow'),
    boxMetaScrollWidth: (function () {
      var el = document.querySelector('.box-meta');
      return el ? Math.round(el.scrollWidth) : null;
    })(),
    /*
     * ★ 名字自己"想"多宽（M5 补）：实得宽 36 到底是"够用"还是"被截"，
     * 只有和 scrollWidth 一比才知道 —— 36 恰好等于三个字需要的宽度，
     * 所以光看这个名字格宽度会得出完全相反的结论。
     */
    boxNameScrollWidth: (function () {
      var el = document.querySelector('.box-name');
      return el ? Math.round(el.scrollWidth) : null;
    })(),
    boxNameText: (function () {
      var el = document.querySelector('.box-name');
      return el ? el.textContent : null;
    })(),
    boxRows: (function () {
      var boxes = Array.prototype.slice.call(document.querySelectorAll('.box'));
      if (!boxes.length) return 0;
      var min = Infinity;
      for (var i = 0; i < boxes.length; i++) {
        min = Math.min(min, Math.round(boxes[i].getBoundingClientRect().left));
      }
      var n = 0;
      for (var j = 0; j < boxes.length; j++) {
        if (Math.round(boxes[j].getBoundingClientRect().left) === min) n += 1;
      }
      return n === 0 ? 0 : Math.ceil(boxes.length / n);
    })(),
    dockTools: h('.dock-tools'),
    /*
     * ★★ 这一档到底命中没有（M5 补）：把"哪些样式表里的哪条规则提到了 max-height"
     *   全部列出来，而不是只看最终算出来的那个数。
     *
     * 起因：源码里写的是 min(170px, 26dvh)，浏览器报回来的却是死的 170px，
     * 而"哪一条赢了"这个问题从计算值上完全看不出来 —— 只有把候选规则
     * 连同它们的 mediaText 一起打出来，才能分清"规则没命中"和"规则命中了但被覆盖"。
     */
    dockBoxesRules: (function () {
      var out = [];
      for (var i = 0; i < document.styleSheets.length; i++) {
        var rules;
        try {
          rules = document.styleSheets[i].cssRules;
        } catch (e) {
          continue;
        }
        if (!rules) continue;
        for (var j = 0; j < rules.length; j++) {
          var r = rules[j];
          if (r.selectorText && r.selectorText.indexOf('.dock-boxes') >= 0 && r.style && r.style.maxHeight) {
            out.push({ sel: r.selectorText, maxHeight: r.style.maxHeight, media: '' });
          }
          if (r.media && r.cssRules) {
            for (var k = 0; k < r.cssRules.length; k++) {
              var inner = r.cssRules[k];
              if (inner.selectorText && inner.selectorText.indexOf('.dock-boxes') >= 0 && inner.style && inner.style.maxHeight) {
                out.push({ sel: inner.selectorText, maxHeight: inner.style.maxHeight, media: r.media.mediaText });
              }
            }
          }
        }
      }
      return out;
    })(),
    shelfCard: h('.shelf-card'),
    shelfHead: h('.shelf-head'),
    shelfRows: h('.shelf-rows'),
    rowCells: h('.row-cells'),
    slot: h('.slot'),
    // 货架能不能填满"房间"：填不满说明底下那块是空的，能填满才说明真挤
    roomContentHeight: body === '.room-scroll' && document.querySelector('[data-room]')
      ? (() => { const el = document.querySelector('[data-room]'); return el ? Math.round(el.scrollHeight) : null; })()
      : null,
    topbarParts: topbar
      ? [...topbar.children].map((el) => ({ cls: [...el.classList].join('.'), h: Math.round(el.getBoundingClientRect().height) }))
      : null,
    /* ★ 操作台那几块同理（量具按 DOM 结构与顺序读，不按手写名单 —— 见下面那一段注释） */
    dockParts: (function () {
      var el = document.querySelector('.dock');
      if (!el) return null;
      return [...el.children].map(function (c) {
        return { cls: [...c.classList].join('.'), h: Math.round(c.getBoundingClientRect().height) };
      });
    })(),
    buttons,
  };
})()`;

/** 点一下某个选择器（找不到就返回 false），用来一屏一屏走到整理页 */
async function click(cdp: Cdp, sel: string): Promise<boolean> {
  const res = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || el.disabled) return false; el.click(); return true; })()`,
    returnByValue: true,
  });
  return res.result.value === true;
}

async function main(): Promise<void> {
  await launch();
  const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Target[];
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error('没有可用的页面目标');
  const cdp = await Cdp.attach(page.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const vp of VIEWPORTS) {
    console.log(`\n══════════════════════════════════════════ ${vp.label}  ${vp.w} × ${vp.h}`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w,
      height: vp.h,
      deviceScaleFactor: 1,
      mobile: vp.w < 700,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await sleep(800);

    /*
     * 一屏一屏往里走，到整理页为止。
     *
     * 只认"按钮上写的字"（开始 / 确认 / 下一步 / 继续），不去猜内部状态 ——
     * 这条路径是从**玩家能看到的东西**推出来的，界面改了它会走不动并报出来，
     * 而不是悄悄量错一屏（量的屏幕不对，数字再准也没用）。
     */
    /*
     * 只量一次 —— 量具自己会用 dev 钩子走到整理页（见 MEASURE）。
     * 走不过去就报错退出：**量的屏幕不对的话，数字再准也没用**。
     *
     * ★★ 带 SCENE 时它会 `window.location.reload()`，于是这一发 evaluate
     *   **必然以 `Inspected target navigated or closed` 告终** —— 那不是坏，
     *   那正是"存档已经装好、页面正在回来"的信号。所以这里重试，
     *   而不是把这句话印成"量具坏了"（第一版就是这么误报的）。
     */
    const navAway = /navigated or closed/i;
    let m: MeasureResult | null = null;
    for (let attempt = 0; attempt < 4 && m === null; attempt += 1) {
      try {
        const res = await cdp.send<{ result: { value: MeasureResult }; exceptionDetails?: { text: string } }>(
          'Runtime.evaluate',
          { expression: MEASURE, awaitPromise: true, returnByValue: true },
        );
        if (res.exceptionDetails) throw new Error(`页面里报错：${res.exceptionDetails.text}`);
        m = res.result.value;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!navAway.test(msg)) throw err;
        console.log(`  ↻ 页面正在载入 ${process.env['SCENE'] ?? ''} 这个档，等它回来…`);
        await sleep(2500);
      }
    }
    if (m === null) throw new Error('重试四次都没量到 —— 页面一直在刷新？');
    console.log(`\n──── 落在这一屏：${m.screen}（正文容器 ${m.body}）`);
    /*
     * ★ 先把"这一屏的竖直账"压成一行再打整份 JSON。
     *
     * 判据是**一行能读完**：`房间 / 操作台 / 纸箱那一栏 / 一个纸箱` 四个数并排，
     * 加一减一立刻看得见。整份 JSON 仍然照打（要看细节时它在下面），
     * 但"改完到底好没好"这个问题不该靠翻八十行 JSON 来回答。
     */
    const boxH = (m['box'] as { height?: number } | null)?.height ?? null;
    const hOf = (k: string): number | string => ((m[k] as { height?: number } | null)?.height ?? '—');
    console.log(
      `  ▸ 房间 ${hOf('bodyBox')} · 操作台 ${hOf('dock')} · 纸箱栏 ${hOf('dockBoxes')}` +
        `（上限 ${String(m['dockBoxesCap'])}）· 一个纸箱 ${String(boxH)}` +
        ` · 纸箱 ${String(m['boxCount'])} 个 / ${String(m['boxRows'])} 行` +
        ` · 每行 ${String(m['boxPerRow'])} · 内容高 ${String(m['dockBoxesScroll'])}` +
        ` · 卡宽 ${String(m['boxWidth'])} / 名字格 ${String(m['boxNameWidth'])}` +
        ` / 三个字要 ${String(m['nameNeed'])}` +
        ` / meta 想要 ${String(m['boxMetaScrollWidth'])} 拿到 ${String(m['boxMetaWidth'])} grow ${String(m['boxMetaFlexGrow'])}` +
        ` / 名字「${String(m['boxNameText'])}」想要 ${String(m['boxNameScrollWidth'])}`,
    );
    console.log(JSON.stringify(m, null, 2));
    const rules = m['dockBoxesRules'] as { sel: string; maxHeight: string; media: string }[] | undefined;
    if (rules) {
      for (const r of rules) {
        console.log(`  · 候选规则 ${r.sel} { max-height: ${r.maxHeight} }${r.media ? ` @media ${r.media}` : ''}`);
      }
    }
    console.log(`  · 命中的上限 = ${String(m['dockBoxesCap'])}，实得高度 = ${String(hOf('dockBoxes'))}`);
    /*
     * ★★ "太紧凑"是一道减法题：视口高度减去哪几块。
     *
     * ## 判据按**结构**读，不再按一张手写的名单（2026-10 改）
     *
     * 原来这里是一张写死的十块清单（标题行 / 四格台账 / 胶带架 / …）。
     * 整理页把顶栏重排成「窗外 → 先知栏 → 胶带架 → 标题 + 台账」之后，
     * 那张表当场读错两处：`标题行` 量的是**已经不存在的** `.topbar-row`
     * （打印成 `—px`），而 `.tape-shelf` 与先知栏换了位置之后，
     * "谁在上面"从表里完全看不出来。
     *
     * 所以改成**照着 DOM 走**：顶栏与操作台的**每一个直接子元素**各一行，
     * 顺序就是屏幕上的顺序。改版式之后这张表自动跟着变 ——
     * 手写名单那种做法每改一次版式就要人回来改一次（而我刚漏了一次）。
     */
    const partsMap = m['topbarParts'] as { cls: string; h: number }[] | null;
    const dockParts = m['dockParts'] as { cls: string; h: number }[] | null;
    const byClass = (list: { cls: string; h: number }[] | null, cls: string): number =>
      (list ?? []).filter((p) => p.cls.split('.').indexOf(cls) >= 0).reduce((n, p) => n + p.h, 0);
    let treeSum = 0;
    if (partsMap) {
      for (const p of partsMap) {
        treeSum += p.h;
        console.log(`  · 顶栏 ${p.cls || '(无类名)'}  ${String(p.h).padStart(4)}px`);
      }
    } else {
      console.log('  ⚠ 量具这次没取到顶栏子元素清单（topbarParts），下面只能看合计');
    }
    const roomH = byClass([{ cls: 'room-scroll', h: Number(hOf('bodyBox')) || 0 }], 'room-scroll');
    console.log(`  · 房间（可滚）  ${String(hOf('bodyBox')).padStart(4)}px`);
    treeSum += Number(hOf('bodyBox')) || 0;
    if (dockParts) {
      for (const p of dockParts) {
        treeSum += p.h;
        console.log(`  · 操作台 ${p.cls || '(无类名)'}  ${String(p.h).padStart(4)}px`);
      }
    }
    const tp = m['topbarPad'] as { top: number; bottom: number; gap: number; children: number } | null;
    const dp = m['dockPad'] as { top: number; bottom: number; gap: number; children: number } | null;
    const pad = (p: typeof tp): number => (p ? p.top + p.bottom + p.gap * Math.max(0, p.children - 1) : 0);
    const padSum = pad(tp) + pad(dp);
    console.log(
      `  · 结构合计 ${treeSum}px ＋ 顶栏内边距/间隙 ${pad(tp)}px ＋ 操作台内边距/间隙 ${pad(dp)}px` +
        ` = ${treeSum + padSum}px ／ 视口 ${vp.h}px ／ 差 ${vp.h - treeSum - padSum}px` +
        `（房间 ${roomH}px 顶栏 ${byClass(partsMap, 'topbar')}px）`,
    );
    if (m.body !== '.room-scroll') {
      console.log('  ⚠ 没走到整理页 —— 上面这些数字量的是别的屏，别拿它下结论');
      process.exitCode = 1;
    }

    /*
     * 顺便**存一张图**。
     *
     * ★ 数字只回答"还剩多少像素"，回答不了"那 141px 看起来是不是一团糊"。
     *   一张窄屏截图是唯一能让**人**看懂这次改动的证据 —— 也是这个量具
     *   唯一能反过来验自己的办法（长度对了但挤成一团，只有眼睛看得出来）。
     */
    if (process.env['SHOT_DIR']) {
      const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      /*
       * ★ 目录要自己建：`SHOT_DIR` 指到一个不存在的路径时，第一张图就
       *   `ENOENT` 把整趟量测打断（报错文案里只有路径，看起来像"量具坏了"）。
       *   量具是给下一次改动用的，不该要求调用者先手动 mkdir。
       */
      mkdirSync(process.env['SHOT_DIR'], { recursive: true });
      const file = join(process.env['SHOT_DIR'], `${vp.w}x${vp.h}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`  📷 ${file}`);
    }
  }

  cdp.close();
}

interface MeasureResult {
  screen: string;
  body: string;
  h1: string | null;
  [k: string]: unknown;
}

main()
  .catch((err: unknown) => {
    console.error('量具坏了：', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    chrome?.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 临时目录删不掉不算失败 */
    }
  });
