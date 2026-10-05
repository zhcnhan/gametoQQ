/*
 * 量"滑动方向到底是不是反的"。
 *
 * ## 为什么要有这个文件
 *
 * 玩家**报过两次**"滑动方向是反的"，而两次我都只能读代码推断方向 ——
 * 第一次推断成"两层滚动打架"（摘掉 `-webkit-overflow-scrolling: touch`），
 * 第二次推断成"滚的东西不一样"（拿掉 `.dock-boxes` 的 `data-scroll-host`）。
 * 两次都是**看着有道理**的推断，而第二次之后玩家说"还是反的"。
 *
 * 判据不能再是"读代码看起来对"：`takeOverScroll` 里写着
 * `node.scrollTop = before + (point.y - prev.y)`，从这一行能推出
 * "手指往下划 → scrollTop 变大"，但这只说明**代码想做什么**。
 * 真正要回答的是"手机上手指往下划，屏幕上的内容往哪边走"，
 * 而这件事只有让浏览器真的收一次触摸才知道。
 *
 * ## 它怎么问的
 *
 * 用 DevTools 协议派发**真触摸事件**（`Input.dispatchTouchEvent`），
 * 让浏览器自己合成 pointer 事件 —— 手势层（`ui/drag.ts`）收到的东西
 * 与真机完全同构。然后每一步都读一遍 `.room-scroll` 的 `scrollTop`。
 *
 * ★ 判据是**方向**：手指往下划（y 变大）→ `scrollTop` 必须**变大**
 *   （内容跟着手指走，露出下面的内容）。反了就是反了。
 *
 * 用法：
 *     npx vite-node scripts/_probe-scroll-dir.ts
 *     VIEWPORTS=375x667 SCENE=100boxes npx vite-node scripts/_probe-scroll-dir.ts
 *
 * 环境变量：
 *   · `APP_URL`（默认 dev 服务 5199）
 *   · `SCENE`（默认 `100boxes`：100 箱那一档，货架格子与箱子都在）
 *   · `VIEWPORTS`（默认 `375x667`，玩家指名的 iPhone SE）
 *   · `CHROME_PATH`
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/';
const SCENE = process.env['SCENE'] ?? '100boxes';
const PORT = 9334;

const VIEWPORTS: Array<{ w: number; h: number; label: string }> = (() => {
  const spec = process.env['VIEWPORTS'];
  if (!spec) return [{ w: 375, h: 667, label: 'iPhone SE（玩家指名的参照机）' }];
  return spec
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean)
    .map((one) => {
      const [w, h] = one.split('x').map((n) => Number(n.trim()));
      if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error(`VIEWPORTS 这项看不懂：${one}`);
      return { w, h, label: `自定义 ${w} × ${h}` };
    });
})();

const profile = mkdtempSync(join(tmpdir(), 'probe-scroll-'));

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
        const text = (msg.params?.args ?? [])
          .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? '')))
          .join(' ');
        this.logs.push(text);
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

/** 在页面里求值，返回 `value`（出错就把异常文本抛出来，绝不吞掉） */
async function evalIn<T>(cdp: Cdp, expr: string): Promise<T> {
  const res = await cdp.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
    'Runtime.evaluate',
    { expression: expr, awaitPromise: true, returnByValue: true },
  );
  if (res.exceptionDetails) {
    throw new Error(`页面里这段求值炸了：${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
  }
  return res.result.value;
}

interface Spot {
  ok: boolean;
  why?: string;
  x: number;
  y: number;
  top: number;
  max: number;
  /** 量方向用的起点（房间的中间）—— 顶和底都是边界，在边界上量不出方向 */
  mid: number;
  /** 落手的 y。★ 用**视口的中间**，不用格子的位置：房间滚到中间之后，
   *  格子自己的位置会跟着内容跑到视口外面去（格子静止，内容在动）。 */
  midY: number;
  dockTop: number;
  dockMax: number;
}

/** 找到"手指该按在哪"：货架第一个格子（没有格子就退回房间中间） */
const FIND_SPOT = `(() => {
  const room = document.querySelector('.room-scroll');
  if (!room) return { ok: false, why: '页面上没有 .room-scroll（没走到整理页？）' };
  const dock = document.querySelector('.dock-boxes');
  const slot = document.querySelector('.slot') || document.querySelector('.row-cells > *');
  const r = (slot || room).getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const max = Math.max(0, room.scrollHeight - room.clientHeight);
  return {
    ok: true,
    x,
    y: Math.round(r.top + r.height / 2),
    top: room.scrollTop,
    max,
    mid: Math.round(max / 2),
    /*
     * ★ 落手点用视口中间偏上：房间滚到中间之后，格子的**内容位置**已经动了，
     *   而落手点必须落在 .slot 上（手势只在 .slot 上绑）。取中间偏上既落在
     *   第二行格子那一带，又离上下两条边都远。
     */
    midY: Math.round(room.getBoundingClientRect().top + room.getBoundingClientRect().height * 0.45),
    dockTop: dock ? dock.scrollTop : -1,
    dockMax: dock ? Math.max(0, dock.scrollHeight - dock.clientHeight) : -1,
  };
})()`;

/** 把房间滚到一个位置（用来给"往上划"造出可滚空间） */
function setTop(v: number): string {
  return `(() => {
    const room = document.querySelector('.room-scroll');
    room.scrollTop = ${v};
    return { top: room.scrollTop, max: Math.max(0, room.scrollHeight - room.clientHeight) };
  })()`;
}

function readTops(): string {
  return `(() => {
    const room = document.querySelector('.room-scroll');
    const dock = document.querySelector('.dock-boxes');
    return { top: room.scrollTop, dockTop: dock ? dock.scrollTop : -1 };
  })()`;
}

/**
 * 一次真触摸拖动：按下 → 若干步移动 → 抬起。返回每一步之后的 `scrollTop`。
 *
 * ★ 每一步都顺手把手势层的诊断日志抽干打出来。第一版没有这一步，于是
 *   "① 完全没动"只能靠猜 —— 而日志一眼就能看出它到底收没收到触摸、
 *   是滚了 0 还是压根没进滚动那一支。
 */
async function touchDrag(
  cdp: Cdp,
  x: number,
  y: number,
  stepY: number,
  steps: number,
  label: string,
  holdMs = 60,
): Promise<void> {
  cdp.drainLogs();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }],
  });
  /*
   * ★ 按下之后先按 `holdMs` 不动，再开始划。
   *
   * 这一句是**真人与合成事件的差别所在**：脚本"按下 60ms 就划走"，
   * 而人的手指按下之后往往要停 300ms 以上才动。手势层里 300ms 是
   * **长按成立**那条线（`longPressMs`），越过去之后这一次手势就变成拖拽，
   * 再往下的位移会被当成"拖着重物走"而不是"滚屏幕"。
   */
  await sleep(holdMs);
  console.log(
    `    ── 按住 ${holdMs}ms 之后的日志：${cdp.drainLogs().join(' ｜ ') || '（空：手势层没收到 pointerdown）'}`,
  );
  for (let i = 1; i <= steps; i += 1) {
    const cy = Math.round(y + stepY * i);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: cy, radiusX: 6, radiusY: 6, force: 1, id: 1 }],
    });
    await sleep(16);
    const t = await evalIn<{ top: number; dockTop: number }>(cdp, readTops());
    console.log(
      `    ${label} 第 ${i} 步：手指 y=${cy}（${stepY > 0 ? '往下' : '往上'}划 ${Math.abs(stepY) * i}px）` +
        ` → 房间 scrollTop=${t.top}${t.dockTop >= 0 ? ` · 纸箱栏 scrollTop=${t.dockTop}` : ''}` +
        `　［${cdp.drainLogs().join(' ｜ ') || '无日志'}］`,
    );
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
  console.log(`    ── 抬起之后的日志：${cdp.drainLogs().join(' ｜ ') || '（空）'}`);
}

async function runViewport(cdp: Cdp, w: number, h: number, label: string): Promise<void> {
  console.log(`\n═══ ${w} × ${h}　${label} ═══`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

  const armed = await evalIn<boolean>(cdp, `sessionStorage.getItem('__scrollDirArmed') === '1'`);
  if (!armed) {
    await evalIn<string>(cdp, `(() => { sessionStorage.setItem('__scrollDirArmed','1'); return 'ok'; })()`);
    await evalIn<string>(cdp, `(() => { window.__tunhuo.load(${JSON.stringify(SCENE)}); return 'sent'; })()`);
    await sleep(2500);
  }
  await waitFor('整理页的 .room-scroll', async () => {
    try {
      return await evalIn<boolean>(cdp, `!!document.querySelector('.room-scroll')`);
    } catch {
      return false;
    }
  }, 25000);
  await sleep(500);

  /* 走一遍玩家走的那一步（load 之后落点不一定是整理页） */
  for (let i = 0; i < 20; i += 1) {
    const there = await evalIn<boolean>(cdp, `!!document.querySelector('.room-scroll')`);
    if (there) break;
    await evalIn<string>(
      cdp,
      `(() => {
        const btn = [...document.querySelectorAll('button, [data-action]')].find((el) => {
          if (el.disabled) return false;
          return /回家整理|去整理|开始整理|下一步|继续|确认|知道了|开始/.test((el.textContent || '').replace(/\\s+/g, ''));
        });
        if (btn) btn.click();
        return 'clicked';
      })()`,
    );
    await sleep(400);
  }
  await cdp.send('Runtime.evaluate', { expression: `window.__tunhuoTrace = true` });

  const spot = await evalIn<Spot>(cdp, FIND_SPOT);
  if (!spot.ok) throw new Error(spot.why ?? '找不到落手点');
  console.log(
    `  落手点 ${spot.x},${spot.midY}（房间里 45% 高度那一带）　房间可滚 ${spot.max}px` +
      `（当前 ${spot.top}）${spot.dockMax >= 0 ? `　纸箱栏可滚 ${spot.dockMax}px` : ''}`,
  );
  if (spot.max <= 0) {
    console.log('  ⚠ 房间滚不动（可滚 0px）—— 这一档量不出方向，换 SCENE 或视口');
    return;
  }

  /*
   * ★★ 两次拖动**必须从同一个位置出发**。
   *
   * 第一版把"手指往下划"放在 `scrollTop = 0`（房间顶上）—— 而那里往下划本来就
   * 没有东西可露（`scrollTop` 已经 0，夹住不动），于是它报"❌ 反了"，
   * 可那其实是**在边界上量方向**：量出来的是"没动"，不是"反了"。
   * 正确的摆法是把房间先放到中间，同一个起点分别试两个方向 —— 两次位移
   * 若符号相同，那才是真的反了。
   *
   * ★★ 而"按下之后停多久"是另一个变量：脚本式 60ms 是"一碰就划走"，
   *   真人的拇指往往是**按下去停一下**再划 —— 而 300ms 是长按那条线。
   *   所以四种组合全试：{短按、长按} × {往下、往上}。
   */
  const cases: Array<{ hold: number; step: number; name: string }> = [
    { hold: 60, step: 40, name: '短按 60ms 后往下划' },
    { hold: 400, step: 40, name: '长按 400ms 后往下划' },
    { hold: 60, step: -40, name: '短按 60ms 后往上划' },
    { hold: 400, step: -40, name: '长按 400ms 后往上划' },
  ];
  const result: Array<{ name: string; from: number; to: number; d: number }> = [];
  console.log(`\n  房间可滚 ${spot.max}px，四次拖动都从 scrollTop=${spot.mid} 出发：`);
  for (const one of cases) {
    await evalIn(cdp, setTop(spot.mid));
    await sleep(200);
    console.log(`\n  ▶ ${one.name}（期望：往下划 → scrollTop 变大；往上划 → 变小）`);
    const from = (await evalIn<{ top: number }>(cdp, readTops())).top;
    await touchDrag(cdp, spot.x, spot.midY, one.step, 4, '·', one.hold);
    const to = (await evalIn<{ top: number }>(cdp, readTops())).top;
    /* 松手 300ms 之后再读一次：惯性会在这段时间里继续写 scrollTop */
    await sleep(300);
    const after = (await evalIn<{ top: number }>(cdp, readTops())).top;
    result.push({ name: one.name, from, to, d: to - from });
    console.log(`    ⇒ ${one.name}：${from} → ${to}（位移 ${to - from >= 0 ? '+' : ''}${to - from}），松手 300ms 后 ${after}`);
  }

  console.log('\n  ── 判据 ──');
  for (const r of result) {
    const want = r.name.includes('往下') ? 1 : -1;
    const ok = want > 0 ? r.d > 0 : r.d < 0;
    const tag = r.d === 0 ? '⚠ 没动' : ok ? '✅ 方向对' : '❌ 反了';
    console.log(`    ${r.name}：位移 ${r.d >= 0 ? '+' : ''}${r.d}　${tag}`);
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
  await waitFor('页面加载出 #app', async () => {
    try {
      return await evalIn<boolean>(cdp, `!!document.querySelector('#app')`);
    } catch {
      return false;
    }
  }, 30000);
  await sleep(800);

  for (const v of VIEWPORTS) await runViewport(cdp, v.w, v.h, v.label);

  cdp.close();
}

main()
  .then(() => {
    chrome?.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 临时目录删不掉不影响结论 */
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
