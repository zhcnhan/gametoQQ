/*
 * 量"手指落在哪儿"会不会改变滚动的方向。
 *
 * ## 起因（不是猜的）
 *
 * `scripts/_probe-scroll-native.ts` 的第 ④ 项量出一条**互相矛盾**的结果：
 * 同样把房间从 `scrollTop = 472` 出发，手指落点也一样，
 *   · 往下划 160px → 512（+156，与手指同向）
 *   · 往上划 160px → 699（**+227，与手指相反**）
 * 两个方向都让 `scrollTop` 变大，这在一个只有一个写者的世界里不可能。
 * 所以要么"有两个写者"，要么"两次不是同一个起点"。
 *
 * ## 这个探针怎么把这件事钉死
 *
 * 对每一种组合，都：
 *   ① 把房间**精确**放到 `scrollTop = 中位`
 *   ② 划之前**再读一次**（若读数不等于中位，说明上一次的惯性还在写 —— 这一条
 *      本身就是答案之一，必须打出来）
 *   ③ 逐步记 `scrollTop`（每 40px 一步）—— 方向若在**中途**翻转，逐步记才看得见
 *   ④ 松手后 100 / 300 / 600ms 各读一次（惯性是松手之后继续写的那个写者）
 *
 * 组合是 2 × 2：{手指落在格子上、落在房间空白处} × {往下划、往上划}。
 *
 * 用法：
 *     npx vite-node scripts/_probe-scroll-two-writers.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/';
const SCENE = process.env['SCENE'] ?? '100boxes';
const PORT = 9336;

const VIEWPORTS = (() => {
  const spec = process.env['VIEWPORTS'] ?? '375x667';
  return spec
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean)
    .map((one) => {
      const [w, h] = one.split('x').map((n) => Number(n.trim()));
      if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error(`VIEWPORTS 这项看不懂：${one}`);
      return { w, h };
    });
})();

const profile = mkdtempSync(join(tmpdir(), 'probe-2w-'));

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
  private logs: string[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String((ev as MessageEvent).data)) as {
        id?: number;
        method?: string;
        params?: { args?: Array<{ value?: unknown; description?: string }> };
        result?: unknown;
        error?: { message: string };
      };
      if (msg.method === 'Runtime.consoleAPICalled') {
        this.logs.push(
          (msg.params?.args ?? [])
            .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? '')))
            .join(' '),
        );
        return;
      }
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

  drainLogs(): string[] {
    const out = this.logs;
    this.logs = [];
    return out;
  }

  close(): void {
    this.ws.close();
  }
}

async function evalIn<T>(cdp: Cdp, expr: string): Promise<T> {
  const res = await cdp.send<{
    result: { value: T };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(`页面里这段求值炸了：${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
  }
  return res.result.value;
}

const SPOTS = `(() => {
  const room = document.querySelector('.room-scroll');
  if (!room) return { ok: false, why: '没有 .room-scroll' };
  const r = room.getBoundingClientRect();
  /*
   * ★ 房间里的**空白处**：用 elementFromPoint 反查一个不在格子上的坐标。
   *   不能靠"猜哪一带是空白"—— 猜错了量到的是格子，反而是"有手势绑定"那一支。
   *   判据是"这一点往上没有 .slot"。
   */
  const isBlank = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return !!el && !el.closest('.slot');
  };
  const onSlot = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return !!el && !!el.closest('.slot');
  };
  let blank = null;
  let slot = null;
  for (let y = Math.round(r.top + 4); y < Math.round(r.bottom - 4) && (!blank || !slot); y += 3) {
    for (let x = Math.round(r.left + 4); x < Math.round(r.right - 4); x += 8) {
      if (!blank && isBlank(x, y)) blank = { x, y };
      if (!slot && onSlot(x, y)) slot = { x, y };
      if (blank && slot) break;
    }
  }
  /*
   * ★ 纸箱那一叠：用户第三次报障里点名的**第二处**（「连下面的箱子如果多了，
   *   滑动一下也还是反向的」）。落点取**第一个纸箱的正中** —— 判据是这一点
   *   往上能 closest 到 [data-box]（不能靠"取条子的中点"：中点可能落在
   *   两行之间的缝里，而缝里没有任何手势绑定，量出来会是"划了不动"）。
   */
  const strip = document.querySelector('.dock-boxes');
  let box = null;
  let stripMax = 0;
  let boxCount = 0;
  if (strip) {
    stripMax = Math.max(0, strip.scrollHeight - strip.clientHeight);
    boxCount = strip.querySelectorAll('[data-box]').length;
    const first = strip.querySelector('[data-box]');
    if (first) {
      const b = first.getBoundingClientRect();
      box = { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    }
  }
  return {
    ok: true,
    blank, slot, box,
    rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    max: Math.max(0, room.scrollHeight - room.clientHeight),
    stripMax, boxCount,
    slotTa: getComputedStyle(document.querySelector('.slot')).touchAction,
    roomTa: getComputedStyle(room).touchAction,
    stripTa: strip ? getComputedStyle(strip).touchAction : '—',
  };
})()`;

/**
 * 在纸箱那一叠里**当场**挑一个落点：一个看得见、且 `elementFromPoint` 真的命中
 * `[data-box]` 的箱子正中。
 *
 * ★ 为什么不能像房间那两处一样在开局算一次就完事：算的时候这一叠还在顶端，
 *   而挥之前我把它滚到了中位 —— 那个坐标就落到别的箱子（或者两行之间的**缝**）上了。
 *   缝里没有任何手势绑定，量出来的会是"划了不动"，然后我会去修一个不存在的 bug。
 */
function pickBox(): string {
  return `(() => {
    const strip = document.querySelector('.dock-boxes');
    if (!strip) return null;
    const sr = strip.getBoundingClientRect();
    for (const b of strip.querySelectorAll('[data-box]')) {
      const r = b.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      if (y > sr.top + 2 && y < sr.bottom - 2 && x > sr.left + 2 && x < sr.right - 2) {
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('[data-box]')) return { x, y };
      }
    }
    return null;
  })()`;
}

function setTop(v: number): string {
  return `(() => { const r = document.querySelector('.room-scroll'); r.scrollTop = ${v}; return r.scrollTop; })()`;
}

function boxTop(): string {
  return `(() => {
    const d = document.querySelector('.dock-boxes');
    return d ? Math.round(d.scrollTop * 100) / 100 : -1;
  })()`;
}

function setBoxTop(v: number): string {
  return `(() => { const d = document.querySelector('.dock-boxes'); d.scrollTop = ${v}; return d.scrollTop; })()`;
}

function readTop(): string {
  return `(() => {
    const r = document.querySelector('.room-scroll');
    return { top: Math.round(r.scrollTop * 100) / 100, dock: (() => { const d = document.querySelector('.dock-boxes'); return d ? Math.round(d.scrollTop) : -1; })() };
  })()`;
}

/*
 * ★★★ 裁判：一个**没有任何手势绑定**的原生滚动块。
 *
 * ## 为什么必须有它（这一条是这一轮最贵的教训）
 *
 * 在这个文件之前的版本里，判据是"手指往下划 → `scrollTop` 应该变大"——
 * 那是我**从实现里推出来的**（实现写的就是 `scrollTop += deltaY`），
 * 而"跟手"的定义来自浏览器：手指往下划要看到**上面**的内容，`scrollTop` 应该是**变小**。
 * 于是四个格子全绿、方向全反，我拿这份绿报告宣布"修好了"，用户第三次报障。
 *
 * 所以现在的判据是**比较**：同一发手势、同样的坐标、同样的起点（中位），
 * 一个落在我们的容器上、一个落在旁边这个原生块上，
 * **两者 `scrollTop` 的符号必须相同**。这个方向不来自我，也不来自 `drag.ts`。
 *
 * ⚠ 它必须是 `position: fixed` + 最高 z-index + `touch-action: auto`：
 *   `fixed` 是为了不被文档流影响，`z-index` 是为了 `elementFromPoint` 命中它，
 *   `touch-action: auto` 是让浏览器**真的**去滚它（我们自己的容器是 `none`）。
 */
function nativeOracle(x: number, y: number): string {
  return `(() => {
    document.getElementById('__native-oracle')?.remove();
    const box = document.createElement('div');
    box.id = '__native-oracle';
    box.style.cssText =
      'position:fixed;z-index:2147483647;overflow-y:auto;overflow-x:hidden;' +
      'touch-action:auto;background:rgba(0,0,0,0.01);' +
      'left:' + (${x} - 20) + 'px;top:' + (${y} - 20) + 'px;width:40px;height:40px';
    box.innerHTML = '<div style="height:2000px"></div>';
    document.body.appendChild(box);
    box.scrollTop = 500;
    return box.scrollTop;
  })()`;
}

function dropNativeOracle(): string {
  return `(() => { document.getElementById('__native-oracle')?.remove(); return 'ok'; })()`;
}

function readOracle(): string {
  return `(() => { const b = document.getElementById('__native-oracle'); return b ? b.scrollTop : -1; })()`;
}

/**
 * 屏上诊断（`ui/layoutHud.ts`）此刻说的那一句话。
 *
 * ★ 顺手把它读出来是为了**验它自己**：那一句是给用户看的证据，
 * 它错了就等于我又给了他一个错的判据（而这个文件的存在就是为了不再发生这件事）。
 */
function hudText(): string {
  return `(() => {
    const hud = window.__tunhuoHud;
    return hud ? String(hud.text()).split('\\n').filter((l) => l.startsWith('滚动')).join('') : '（屏上诊断没装上）';
  })()`;
}

interface StepLog {
  steps: number[];
  after: number[];
  logs: string[];
  actualStart: number;
}

/**
 * 读一个 `scrollTop` 的表达式（默认读整理页那间房）。
 *
 * ★ 之所以要参数化：同一发手势要分别喂给**我们的容器**与**原生裁判块**，
 *   而"谁被滚了"是这两趟唯一的差别 —— 如果读取端固定成房间，
 *   原生那一路读的就还是房间（等于裁判没上场，而报告会显示"我们 = 我们"）。
 */
function roomTop(): string {
  return `(() => {
    const r = document.querySelector('.room-scroll');
    return r ? Math.round(r.scrollTop * 100) / 100 : -1;
  })()`;
}

async function gesture(
  cdp: Cdp,
  x: number,
  y: number,
  stepY: number,
  readExpr: string = roomTop(),
): Promise<StepLog> {
  cdp.drainLogs();
  const actualStart = await evalIn<number>(cdp, readExpr);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }],
  });
  await sleep(60);
  const steps: number[] = [];
  for (let i = 1; i <= 4; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: Math.round(y + stepY * i), radiusX: 6, radiusY: 6, force: 1, id: 1 }],
    });
    await sleep(16);
    steps.push(await evalIn<number>(cdp, readExpr));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after: number[] = [];
  for (const ms of [100, 200, 300]) {
    await sleep(ms);
    after.push(await evalIn<number>(cdp, readExpr));
  }
  return { steps, after, logs: cdp.drainLogs(), actualStart };
}

async function runViewport(cdp: Cdp, w: number, h: number): Promise<void> {
  console.log(`\n═══ ${w} × ${h} ═══`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

  if (!(await evalIn<boolean>(cdp, `sessionStorage.getItem('__twoWriters') === '1'`))) {
    await evalIn<string>(cdp, `(() => { sessionStorage.setItem('__twoWriters','1'); return 'ok'; })()`);
    await evalIn<string>(cdp, `(() => { window.__tunhuo.load(${JSON.stringify(SCENE)}); return 'sent'; })()`);
    await sleep(2500);
  }
  await waitFor(
    '整理页的 .room-scroll',
    async () => {
      try {
        return await evalIn<boolean>(cdp, `!!document.querySelector('.room-scroll')`);
      } catch {
        return false;
      }
    },
    25000,
  );
  for (let i = 0; i < 20; i += 1) {
    if (await evalIn<boolean>(cdp, `!!document.querySelector('.room-scroll')`)) break;
    await evalIn<string>(
      cdp,
      `(() => {
        const btn = [...document.querySelectorAll('button, [data-action]')].find((el) =>
          !el.disabled && /回家整理|去整理|开始整理|下一步|继续|确认|知道了|开始/.test((el.textContent || '').replace(/\\s+/g, '')));
        if (btn) btn.click();
        return 'clicked';
      })()`,
    );
    await sleep(400);
  }
  await cdp.send('Runtime.evaluate', { expression: `window.__tunhuoTrace = true` });
  await sleep(300);

  const spots = await evalIn<{
    ok: boolean;
    why?: string;
    blank: { x: number; y: number } | null;
    slot: { x: number; y: number } | null;
    rect: { top: number; bottom: number; left: number; right: number };
    max: number;
    stripMax: number;
    boxCount: number;
    box: { x: number; y: number } | null;
    slotTa: string;
    roomTa: string;
    stripTa: string;
  }>(cdp, SPOTS);
  if (!spots.ok) throw new Error(spots.why ?? '找不到落点');
  console.log(
    `  房间 ${Math.round(spots.rect.top)}…${Math.round(spots.rect.bottom)}　可滚 ${spots.max}px　` +
      `格子 touch-action=${spots.slotTa}　房间 touch-action=${spots.roomTa}`,
  );
  console.log(`  格子上的落点 ${JSON.stringify(spots.slot)}　空白处的落点 ${JSON.stringify(spots.blank)}`);
  if (!spots.blank || !spots.slot) throw new Error('两种落点没有同时找到');
  console.log(
    `  纸箱那一叠 可滚 ${spots.stripMax}px / ${spots.boxCount} 个箱子 touch-action=${spots.stripTa}` +
      `　落点 ${JSON.stringify(spots.box)}`,
  );

  if (
    !(await evalIn<boolean>(cdp, `sessionStorage.getItem('__hudWait') === '1'`)) &&
    spots.stripMax > 8 &&
    spots.box
  ) {
    /* HUD 每 250ms 重画一次，等它把"未滑"那一版画出来再动手（否则读到上一格的残留） */
    await evalIn<string>(cdp, `(() => { sessionStorage.setItem('__hudWait','1'); return 'ok'; })()`);
    await sleep(300);
  }

  const mid = Math.round(spots.max / 2);
  const stripMid = Math.round(spots.stripMax / 2);
  const cases: Array<{
    name: string;
    p: { x: number; y: number };
    step: number;
    pre: string;
    read: string;
    resolveP?: string;
  }> = [
    { name: '格子上・往下划', p: spots.slot, step: 40, pre: setTop(mid), read: roomTop() },
    { name: '格子上・往上划', p: spots.slot, step: -40, pre: setTop(mid), read: roomTop() },
    { name: '空白处・往下划', p: spots.blank, step: 40, pre: setTop(mid), read: roomTop() },
    { name: '空白处・往上划', p: spots.blank, step: -40, pre: setTop(mid), read: roomTop() },
  ];
  /*
   * ★★ 用户第三次报障里点名的第二处：「连下面的箱子如果多了，滑动一下也还是反向的」。
   *
   * 这一叠必须单独量，因为它的手势路径**本来就与房间不同** ——
   * 它的容器不是 `.room-scroll`，而它曾经连 `data-scroll-host` 都没有
   * （那版注释写着"全屏只许有这一处"，代价就是"落在箱子上的竖向滑动被当场作废"）。
   * 步长取 20（不是 40）：这一叠只有一百多像素高，40×4=160 会把两头都顶到边界上，
   * "符号相同"这件事就会被边界吃掉一半。
   */
  if (spots.box && spots.stripMax > 8) {
    cases.push(
      {
        name: '纸箱上・往下划',
        p: spots.box,
        step: 20,
        pre: setBoxTop(stripMid),
        read: boxTop(),
        resolveP: pickBox(),
      },
      {
        name: '纸箱上・往上划',
        p: spots.box,
        step: -20,
        pre: setBoxTop(stripMid),
        read: boxTop(),
        resolveP: pickBox(),
      },
    );
  } else {
    console.log('  ⚠ 这一档纸箱叠不可滚（箱子太少），跳过纸箱那两格');
  }
  let bad = 0;
  let unknown = 0;
  for (const one of cases) {
    await evalIn(cdp, dropNativeOracle());
    await evalIn(cdp, one.pre);
    /*
     * ★ 静置 1.2 秒之后再确认起点。上一次手势的惯性会继续写 `scrollTop`，
     *   而"起点其实不是中位"这件事本身就是一个必须看见的事实 ——
     *   上一个探针里 472 与 398 的分歧就出在这里。
     */
    await sleep(1200);
    /*
     * ★ 落点也在这时候才定：`resolveP`（纸箱那两格）要在**容器已经滚到中位之后**
     *   重新找一次，见 `pickBox` 那段注释。
     */
    const p = one.resolveP ? await evalIn<{ x: number; y: number } | null>(cdp, one.resolveP) : one.p;
    if (!p) {
      console.log(`\n  ▶ ${one.name}　⚠ 找不到落点（跳过）`);
      unknown += 1;
      continue;
    }
    const settled = await evalIn<number>(cdp, one.read);
    console.log(`\n  ▶ ${one.name}（先把容器放到中位，静置后实际起点 ${settled}　落点 ${JSON.stringify(p)}）`);
    const g = await gesture(cdp, p.x, p.y, one.step, one.read);
    console.log(`     按下那一刻起点=${g.actualStart}　逐步：${g.steps.join(' → ')}`);
    console.log(`     松手后 100/300/600ms：${g.after.join(' → ')}`);
    const moved = g.steps[g.steps.length - 1] - g.actualStart;

    /*
     * ★★ 同一发手势、同一个坐标，再喂给**原生裁判**（见 `nativeOracle` 那段注释）。
     *    两边都从"自己的中位"出发，所以比的是**符号**，不是绝对值（比例也不必相同：
     *    我们的容器与裁判块的尺寸、惯性与边界都不同）。
     */
    const oracleStart = await evalIn<number>(cdp, nativeOracle(p.x, p.y));
    const n = await gesture(cdp, p.x, p.y, one.step, readOracle());
    const nativeMoved = n.steps[n.steps.length - 1] - oracleStart;

    const ours = Math.sign(moved);
    const theirs = Math.sign(nativeMoved);
    let verdict: string;
    if (Math.abs(nativeMoved) < 4) {
      verdict = '⚠ 裁判没滚（这一格判不出来）';
      unknown += 1;
    } else if (ours === theirs) {
      verdict = '✅ 与原生同向';
    } else {
      verdict = '❌ **与原生相反**';
      bad += 1;
    }
    console.log(`     我们 ${moved >= 0 ? '+' : ''}${moved}（${moved === 0 ? '⚠ 没动' : '动了'}）`);
    console.log(`     原生 ${nativeMoved >= 0 ? '+' : ''}${nativeMoved}（裁判块 40×40，同一个坐标）`);
    console.log(`     ${verdict}　［${g.logs.join(' ｜ ') || '无日志'}］`);
    console.log(`     屏上诊断：${await evalIn<string>(cdp, hudText())}`);
    await evalIn(cdp, dropNativeOracle());
  }
  console.log(
    `\n  小结：${cases.length} 格里 ${cases.length - bad - unknown} 格与原生同向` +
      `${bad > 0 ? `，**${bad} 格相反**` : ''}${unknown > 0 ? `，${unknown} 格判不出来` : ''}`,
  );
  if (bad > 0) throw new Error(`有 ${bad} 格与原生裁判方向相反 —— 这就是"滑动反向"`);
}

async function main(): Promise<void> {
  await launch();
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Target[];
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error('没有可用的页面目标');
  const cdp = await Cdp.attach(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(
    '页面加载出 #app',
    async () => {
      try {
        return await evalIn<boolean>(cdp, `!!document.querySelector('#app')`);
      } catch {
        return false;
      }
    },
    30000,
  );
  await sleep(800);
  for (const v of VIEWPORTS) await runViewport(cdp, v.w, v.h);
  cdp.close();
}

main()
  .then(() => {
    chrome?.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 临时目录不影响结论 */
    }
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    chrome?.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 同上 */
    }
    process.exit(1);
  });
