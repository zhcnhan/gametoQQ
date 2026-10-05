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
  return {
    ok: true,
    blank, slot,
    rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    max: Math.max(0, room.scrollHeight - room.clientHeight),
    slotTa: getComputedStyle(document.querySelector('.slot')).touchAction,
    roomTa: getComputedStyle(room).touchAction,
  };
})()`;

function setTop(v: number): string {
  return `(() => { const r = document.querySelector('.room-scroll'); r.scrollTop = ${v}; return r.scrollTop; })()`;
}

function readTop(): string {
  return `(() => {
    const r = document.querySelector('.room-scroll');
    return { top: Math.round(r.scrollTop * 100) / 100, dock: (() => { const d = document.querySelector('.dock-boxes'); return d ? Math.round(d.scrollTop) : -1; })() };
  })()`;
}

interface StepLog {
  steps: number[];
  after: number[];
  logs: string[];
  actualStart: number;
}

async function gesture(cdp: Cdp, x: number, y: number, stepY: number): Promise<StepLog> {
  cdp.drainLogs();
  const actualStart = (await evalIn<{ top: number }>(cdp, readTop())).top;
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
    steps.push((await evalIn<{ top: number }>(cdp, readTop())).top);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after: number[] = [];
  for (const ms of [100, 200, 300]) {
    await sleep(ms);
    after.push((await evalIn<{ top: number }>(cdp, readTop())).top);
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
    slotTa: string;
    roomTa: string;
  }>(cdp, SPOTS);
  if (!spots.ok) throw new Error(spots.why ?? '找不到落点');
  console.log(
    `  房间 ${Math.round(spots.rect.top)}…${Math.round(spots.rect.bottom)}　可滚 ${spots.max}px　` +
      `格子 touch-action=${spots.slotTa}　房间 touch-action=${spots.roomTa}`,
  );
  console.log(`  格子上的落点 ${JSON.stringify(spots.slot)}　空白处的落点 ${JSON.stringify(spots.blank)}`);
  if (!spots.blank || !spots.slot) throw new Error('两种落点没有同时找到');

  const mid = Math.round(spots.max / 2);
  const cases: Array<{ name: string; p: { x: number; y: number }; step: number }> = [
    { name: '格子上・往下划', p: spots.slot, step: 40 },
    { name: '格子上・往上划', p: spots.slot, step: -40 },
    { name: '空白处・往下划', p: spots.blank, step: 40 },
    { name: '空白处・往上划', p: spots.blank, step: -40 },
  ];
  for (const one of cases) {
    await evalIn(cdp, setTop(mid));
    /*
     * ★ 静置 1.2 秒之后再确认起点。上一次手势的惯性会继续写 `scrollTop`，
     *   而"起点其实不是中位"这件事本身就是一个必须看见的事实 ——
     *   上一个探针里 472 与 398 的分歧就出在这里。
     */
    await sleep(1200);
    const settled = (await evalIn<{ top: number }>(cdp, readTop())).top;
    console.log(`\n  ▶ ${one.name}（先把房间放到 ${mid}，静置后实际起点 ${settled}）`);
    const g = await gesture(cdp, one.p.x, one.p.y, one.step);
    console.log(`     按下那一刻起点=${g.actualStart}　逐步：${g.steps.join(' → ')}`);
    console.log(`     松手后 100/300/600ms：${g.after.join(' → ')}`);
    const moved = g.steps[g.steps.length - 1] - g.actualStart;
    const want = one.name.includes('往下') ? 1 : -1;
    const ok = want > 0 ? moved > 0 : moved < 0;
    console.log(
      `     位移 ${moved >= 0 ? '+' : ''}${moved}　${moved === 0 ? '⚠ 没动' : ok ? '✅ 与手指同向' : '❌ **与手指相反**'}` +
        `　［${g.logs.join(' ｜ ') || '无日志'}］`,
    );
  }
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
