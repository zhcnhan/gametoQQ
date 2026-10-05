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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/';
const PORT = 9333;

/** 要量的视口（宽 × 高）。第一档是用户报"看不见格子"的那一类机器 */
const VIEWPORTS: Array<{ w: number; h: number; label: string }> = [
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
  if (tun && !armed) {
    sessionStorage.setItem(KEY, '1');
    if (SCENE) {
      try { tun.load(SCENE); } catch (e) { /* 加载失败会一直停在旧屏，下面 waitFor 会报出来 */ }
      await new Promise((r) => setTimeout(r, 1500));
      await waitFor('.room-scroll', 20000);
    } else {
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
    // 顶栏里每一块各占多高 —— "挤"的账就是在这几个数之间分
    topbarRow: h('.topbar-row'),
    score: h('.score'),
    tapeShelf: h('.tape-shelf'),
    runBar: h('.run-bar'),
    runBarRow: h('.run-bar-row'),
    runTrack: h('.run-bar-track'),
    body,
    bodyBox: h(body),
    dock: h('.dock'),
    dockHand: h('.dock-hand'),
    dockBoxes: h('.dock-boxes'),
    dockBoxesCap: cs('.dock-boxes', 'max-height'),
    dockTools: h('.dock-tools'),
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
    console.log(JSON.stringify(m, null, 2));
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
