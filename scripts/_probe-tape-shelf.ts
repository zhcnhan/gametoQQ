/**
 * 临时探针：整理页的胶带架塞满时，还够不够得着
 *
 * 用户 m18160（乔子一号）报「那个胶带，超过5个，就不好改名字了，会超出屏幕外」。
 * 这一屏要回答四件事：
 *   ① **几何**：第 6 张之后是不是跑到可见框（甚至视口）外面去了；
 *   ② **手指**：在胶带块上横着划一下，这条横条到底滚不滚；
 *   ③ **隔缝**：在两块之间的缝上划（改之前唯一指望能滚的地方）滚不滚；
 *   ④ **改名**：轻点一张够得着的胶带，编辑抽屉开不开、名字有没有默认值、保存能不能按。
 *   ⑤⑥ **竖着划**：换行之后列表只长两行，第三行要靠竖着划才看得到 —— 在胶带块上、在缝里各划一次。
 *
 * ★★ 两条纪律（这一轮踩出来的）：
 *  1. **合成事件证明不了滚动。** `new PointerEvent(...)` 能驱动手势层（它听
 *     `pointerdown/move/up`），但**绝不会**让浏览器自己滚。滚动一律用 CDP 的
 *     `Input.dispatchTouchEvent`（真输入）。
 *  2. **真输入也要有裁判。** 每趟都现场注入一个"原生滚动"的对照组
 *     （`#__native-oracle`，`overflow-x:auto` + `touch-action:auto`），
 *     它要是也滚不动，那就说明是探针的问题，不是产品的问题。
 *
 * 每一步都先 `__tunhuo.load()` 回到同一份存档 —— 一趟手势万一被当成拖拽，
 * 游戏会自己存档，下一步就不是同一个起点了。
 *
 * 用完即删（`scripts/_probe-*.ts` 是纯 LF 的既有约定）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env['CHROME_PATH'] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = process.env['APP_URL'] ?? 'http://127.0.0.1:5199/';
const SCENE = process.env['SCENE'] ?? 'many-tapes';
const VIEW = (process.env['VIEWPORT'] ?? '424x790').split('x').map((n) => Number(n.trim()));
const VIEW_W = VIEW[0];
const VIEW_H = VIEW[1];
const PORT = 9342;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Chip {
  i: number;
  text: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
  insideList: boolean;
  insideViewport: boolean;
  hitCls: string;
  hitIsSelf: boolean;
  idle: boolean;
}

const RELOAD = `(() => { window.__tunhuo.load(${JSON.stringify(SCENE)}); return 'loading'; })()`;

/** 几何 + 坐标（不动手） */
const MEASURE = `(async () => {
  const out = { chips: [], shelf: null, list: null, reachable: 0, unreachable: 0 };
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const waitFor = async (sel, ms = 20000) => {
    const t0 = Date.now();
    for (;;) {
      const el = document.querySelector(sel);
      if (el) return el;
      if (Date.now() - t0 > ms) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  await waitFor('.tape-shelf', 20000);
  const shelf = document.querySelector('.tape-shelf');
  const list = document.querySelector('.tape-shelf-list');
  if (shelf) {
    const cs = getComputedStyle(shelf);
    out.shelf = { ...rect(shelf), overflowX: cs.overflowX, touchAction: cs.touchAction, text: norm(shelf.textContent).slice(0, 90) };
  }
  if (list) {
    const cs = getComputedStyle(list);
    out.list = {
      ...rect(list), overflowX: cs.overflowX, overflowY: cs.overflowY, touchAction: cs.touchAction,
      flexWrap: cs.flexWrap, maxHeight: cs.maxHeight,
      scrollW: list.scrollWidth, clientW: list.clientWidth, scrollH: list.scrollHeight, clientH: list.clientHeight,
      scrollLeft: Math.round(list.scrollLeft), scrollTop: Math.round(list.scrollTop),
      canScrollX: list.scrollWidth > list.clientWidth + 1, canScrollY: list.scrollHeight > list.clientHeight + 1,
      isScrollHost: list.hasAttribute('data-scroll-host'),
    };
  }
  const lr = list ? list.getBoundingClientRect() : null;
  out.chips = [...document.querySelectorAll('.tape-chip')].map((el, i) => {
    const r = el.getBoundingClientRect();
    const cx = Math.max(0, Math.min(innerWidth - 1, Math.round(r.left + r.width / 2)));
    const cy = Math.max(0, Math.min(innerHeight - 1, Math.round(r.top + r.height / 2)));
    const hit = document.elementFromPoint(cx, cy);
    const insideList = lr ? r.left >= lr.left - 0.5 && r.right <= lr.right + 0.5 && r.top >= lr.top - 0.5 && r.bottom <= lr.bottom + 0.5 : null;
    const insideViewport = r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5;
    if (insideList && insideViewport) out.reachable += 1; else out.unreachable += 1;
    return {
      i, text: norm(el.textContent),
      x: Math.round(r.left), y: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
      w: Math.round(r.width), h: Math.round(r.height), cx, cy, insideList, insideViewport,
      hitCls: hit ? String(hit.className).slice(0, 30) : '(null)', hitIsSelf: hit === el,
      idle: el.classList.contains('is-idle'),
    };
  });
  return out;
})()`;

/** 每趟都注入一个"原生滚动"对照组：它滚不动，就说明是探针的问题 */
const ORACLE = `(() => {
  const old = document.getElementById('__native-oracle');
  if (old) old.remove();
  const d = document.createElement('div');
  d.id = '__native-oracle';
  d.style.cssText = 'position:fixed;left:6px;top:6px;width:180px;height:70px;overflow-x:auto;touch-action:auto;z-index:99999;background:#fff;border:2px solid #000';
  d.innerHTML = '<div style="width:900px;height:10px"></div>';
  document.body.appendChild(d);
  return { x: Math.round(d.getBoundingClientRect().left), y: Math.round(d.getBoundingClientRect().top + 35) };
})()`;

const readOracle = `(() => { const d = document.getElementById('__native-oracle'); return d ? Math.round(d.scrollLeft) : null; })()`;

const readList = `(() => {
  const list = document.querySelector('.tape-shelf-list');
  const drawer = document.querySelector('.zone-drawer');
  const input = drawer ? drawer.querySelector('input[data-zone-name]') : null;
  const save = drawer ? [...drawer.querySelectorAll('button')].find((b) => /保存|建这张胶带/.test((b.textContent || '').trim())) : null;
  return {
    scrollLeft: list ? Math.round(list.scrollLeft) : null,
    scrollTop: list ? Math.round(list.scrollTop) : null,
    chips: document.querySelectorAll('.tape-chip').length,
    drawerOpen: !!drawer && !drawer.hidden,
    drawerText: drawer && !drawer.hidden ? (drawer.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70) : null,
    name: input ? input.value : null,
    saveDisabled: save ? !!save.disabled : null,
    saveText: save ? (save.textContent || '').trim() : null,
  };
})()`;

async function waitForDevtools(): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - t0 > 30000) throw new Error('等不到 Chrome 的调试端口');
    await sleep(200);
  }
}

class Cdp {
  private next = 1;
  private pending = new Map<number, { ok: (v: unknown) => void; bad: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String((ev as MessageEvent).data)) as { id?: number; result?: unknown; error?: { message: string } };
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

async function evaluate(cdp: Cdp, expr: string): Promise<{ value?: unknown; error?: string }> {
  const r = await cdp.send<{ result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
    'Runtime.evaluate',
    { expression: expr, awaitPromise: true, returnByValue: true },
  );
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '未知异常' };
  return { value: r.result?.value };
}

async function touch(cdp: Cdp, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ x: number; y: number }>): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 12, radiusY: 12, force: 1 })),
  });
}

async function swipe(cdp: Cdp, from: { x: number; y: number }, dx: number, dy: number, steps = 10): Promise<void> {
  await touch(cdp, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', [{ x: Math.round(from.x + (dx * i) / steps), y: Math.round(from.y + (dy * i) / steps) }]);
    await sleep(18);
  }
  await touch(cdp, 'touchEnd', []);
  await sleep(500);
}

async function tap(cdp: Cdp, at: { x: number; y: number }): Promise<void> {
  await touch(cdp, 'touchStart', [at]);
  await sleep(48);
  await touch(cdp, 'touchEnd', []);
  await sleep(700);
}

const profile = mkdtempSync(join(tmpdir(), 'probe-tape-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'],
  { stdio: 'ignore' },
);

try {
  await waitForDevtools();
  const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到页面 target');
  const cdp = await Cdp.attach(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Page.navigate', { url: APP_URL });
  await sleep(4000);

  /** 回到同一份存档：load() 会 reload，那一发 evaluate 必然报 "navigated or closed" */
  const reset = async (): Promise<void> => {
    try {
      await evaluate(cdp, RELOAD);
    } catch {
      /* 正常：页面正在刷新 */
    }
    await sleep(3000);
    for (let i = 0; i < 40; i++) {
      const r = await evaluate(cdp, `!!document.querySelector('.tape-shelf')`);
      if (r.value === true) break;
      await sleep(250);
    }
    await sleep(300);
  };

  const measure = async (): Promise<{ chips: Chip[]; shelf: Record<string, unknown>; list: Record<string, unknown>; reachable: number; unreachable: number }> => {
    const r = await evaluate(cdp, MEASURE);
    if (r.error) throw new Error(`量不到：${r.error.split('\n')[0]}`);
    return r.value as never;
  };

  await reset();
  const m = await measure();
  console.log(`场景 ${SCENE} · 视口 ${VIEW_W}x${VIEW_H}`);
  console.log('胶带架：', JSON.stringify(m.shelf));
  console.log('胶带列表：', JSON.stringify(m.list));
  console.log(`芯片 ${m.chips.length} 张（手指够得着 ${m.reachable} 张 / 够不着 ${m.unreachable} 张）：`);
  for (const c of m.chips) {
    console.log(
      `  ${String(c.i + 1).padStart(2)} ${c.text.padEnd(6)} x=${String(c.x).padStart(4)} right=${String(c.right).padStart(4)} y=${String(c.y).padStart(4)}` +
        ` 可见框内=${c.insideList ? '✓' : '❌'} 视口内=${c.insideViewport ? '✓' : '❌'} 点到的=${c.hitCls}${c.hitIsSelf ? '(自己)' : ''}${c.idle ? ' [还在架上]' : ''}`,
    );
  }

  /* ① 对照组：原生横条滚不滚（探针自己的裁判） */
  {
    const o = await evaluate(cdp, ORACLE);
    const at = o.value as { x: number; y: number };
    const before = await evaluate(cdp, readOracle);
    await swipe(cdp, { x: at.x + 150, y: at.y }, -120, 0);
    const after = await evaluate(cdp, readOracle);
    console.log(`① 对照组（原生 overflow-x 横条）横划 120px：scrollLeft ${JSON.stringify(before.value)} → ${JSON.stringify(after.value)}`);
    await evaluate(cdp, `(() => { const d = document.getElementById('__native-oracle'); if (d) d.remove(); })()`);
  }

  /* ② 在胶带块上横划 —— 这条横条滚不滚 */
  {
    await reset();
    const mm = await measure();
    const chip = mm.chips[Math.min(2, mm.chips.length - 1)]!;
    const before = await evaluate(cdp, readList);
    await swipe(cdp, { x: chip.cx, y: chip.cy }, -150, 0);
    const after = await evaluate(cdp, readList);
    console.log(`② 在「${chip.text}」上横划 150px：${JSON.stringify(before.value)} → ${JSON.stringify(after.value)}`);
  }

  /* ③ 在两块之间的缝上横划（改之前唯一指望能滚的地方） */
  {
    await reset();
    const mm = await measure();
    const gapX = Math.round((mm.chips[0]!.right + mm.chips[1]!.x) / 2);
    const before = await evaluate(cdp, readList);
    await swipe(cdp, { x: gapX, y: mm.chips[0]!.cy }, -150, 0);
    const after = await evaluate(cdp, readList);
    console.log(`③ 在缝上（x=${gapX}）横划 150px：${JSON.stringify(before.value)} → ${JSON.stringify(after.value)}`);
  }

  /* ④ 轻点最后一张（够不够得着）+ 轻点第一张（改名那条路通不通） */
  {
    await reset();
    const mm = await measure();
    const last = mm.chips[mm.chips.length - 1]!;
    const atLast = { x: Math.min(last.cx, VIEW_W - 3), y: Math.min(last.cy, VIEW_H - 3) };
    const hit = await evaluate(cdp, `(() => { const el = document.elementFromPoint(${atLast.x}, ${atLast.y}); return el ? String(el.className).slice(0, 30) : '(null)'; })()`);
    await tap(cdp, atLast);
    const afterLast = await evaluate(cdp, readList);
    console.log(`④a 轻点最后一张「${last.text}」（中心 x=${last.cx}，实际落点 x=${atLast.x}）：落点上是 ${JSON.stringify(hit.value)} → ${JSON.stringify(afterLast.value)}`);

    await reset();
    const mm2 = await measure();
    const first = mm2.chips[0]!;
    await tap(cdp, { x: first.cx, y: first.cy });
    const afterFirst = await evaluate(cdp, readList);
    console.log(`④b 轻点第一张「${first.text}」：${JSON.stringify(afterFirst.value)}`);
  }

  /* ⑤ 在胶带块上竖划 —— 换行之后这条列表该这么滚 */
  {
    await reset();
    const mm = await measure();
    const chip = mm.chips[Math.min(2, mm.chips.length - 1)]!;
    const before = await evaluate(cdp, readList);
    await swipe(cdp, { x: chip.cx, y: chip.cy }, 0, -120);
    const after = await evaluate(cdp, readList);
    console.log(`⑤ 在「${chip.text}」上竖划 120px（往上推）：${JSON.stringify(before.value)} → ${JSON.stringify(after.value)}`);
  }

  /* ⑥ 在两块之间的缝上竖划（同一趟该滚得更顺） */
  {
    await reset();
    const mm = await measure();
    const gapX = Math.round((mm.chips[0]!.right + mm.chips[1]!.x) / 2);
    const before = await evaluate(cdp, readList);
    await swipe(cdp, { x: gapX, y: mm.chips[0]!.cy }, 0, -120);
    const after = await evaluate(cdp, readList);
    console.log(`⑥ 在缝上（x=${gapX}）竖划 120px：${JSON.stringify(before.value)} → ${JSON.stringify(after.value)}`);
  }

  const shotDir = process.env['SHOT_DIR'];
  if (shotDir) {
    await reset();
    const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    mkdirSync(shotDir, { recursive: true });
    const file = join(shotDir, `${VIEW_W}x${VIEW_H}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('📷', file);
  }
} finally {
  chrome.kill();
}
