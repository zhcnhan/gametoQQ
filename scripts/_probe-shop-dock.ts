/**
 * 临时探针：走到扫货页 → 进一家店 → 加一件 → 把底栏（.dock）读出来
 *
 * 目的只有一个：用户报「买东西的时候那个"搬回车上"的按钮不见了」。
 * 这个按钮在 `src/ui/ShopScreen.ts:437`，只有三种情况它不在 DOM 里：
 *   ① `run.dayEvent`（门口有事）→ 底栏只放「换一家 / 先不进去 / 回家整理」
 *   ② `!run.currentShopId`（站在店名单上）→ 只放「回家整理」
 *   ③ `buildCartView(...) === null`（查不到库存或缺身份）→ 只放「回家整理」
 * 所以这里把每一步的底栏**原文**打出来，看它落在哪一种。
 *
 * 用完即删（`scripts/_probe-*.ts` 是纯 LF 的既有约定）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env['CHROME_PATH'] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = process.env['APP_URL'] ?? 'http://127.0.0.1:5199/';
const SCENE = process.env['SCENE'] ?? 'shop-tour';
/** 视口：`VIEWPORT=424x660` 可覆盖 —— 用户的真机可见高度就在这一带 */
const VIEW = (process.env['VIEWPORT'] ?? '424x790').split('x').map((n) => Number(n.trim()));
const VIEW_W = VIEW[0];
const VIEW_H = VIEW[1];
const PORT = 9341;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const WALK = `(async () => {
  const SCENE = ${JSON.stringify(SCENE)};
  const out = { scene: SCENE, steps: [], dock: null, loadButton: null, shops: 0, screen: '' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (sel, ms = 20000) => {
    const t0 = Date.now();
    for (;;) {
      const el = document.querySelector(sel);
      if (el) return el;
      if (Date.now() - t0 > ms) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const dockText = () => norm(document.querySelector('.dock') ? document.querySelector('.dock').innerText : '（没有 .dock）');
  const snap = (label) => {
    const load = document.querySelector('[data-action="load"]');
    out.steps.push({
      label,
      screen: norm(document.querySelector('#app > *') ? document.querySelector('#app > *').className : ''),
      dock: dockText(),
      hasLoad: !!load,
      loadDisabled: load ? !!load.disabled : null,
      shops: document.querySelectorAll('[data-shop]').length,
      goods: document.querySelectorAll('.good').length,
    });
  };
  const clickText = async (re) => {
    const btn = [...document.querySelectorAll('button, [data-action]')].find((el) => {
      if (el.disabled) return false;
      return re.test(norm(el.textContent));
    });
    if (!btn) return false;
    btn.click();
    await sleep(500);
    return true;
  };

  await waitFor('#app > *', 20000);
  const KEY = '__tunhuoShopProbe';
  if (sessionStorage.getItem(KEY) !== '1' && window.__tunhuo && SCENE) {
    sessionStorage.setItem(KEY, '1');
    try { window.__tunhuo.load(SCENE); } catch (e) { out.steps.push({ label: 'load 失败: ' + e.message }); }
    await sleep(2000);
    await waitFor('.dock', 20000);
  }
  snap('载入之后');

  /* 反复点"往前走"的按钮，直到店名单出现（开局那几屏 / 开场 / 身份） */
  for (let i = 0; i < 24 && document.querySelectorAll('[data-shop]').length === 0; i++) {
    const moved = await clickText(/下一步|继续|确认|知道了|开始|选好了|就这样|回家整理|去采购|再去采购|先去采购|出门|逛/);
    if (!moved) break;
  }
  snap('走到扫货页');

  /*
   * 进店：两种存档都要能用 —— 站在店名单上的（有 [data-shop] 卡片）与
   * **已经在店里**的（存档里 currentShopId 已经有值，没有卡片可点）。
   */
  const card = document.querySelector('[data-shop]');
  if (card) {
    card.click();
    await sleep(900);
    snap('进店之后');
  } else if (document.querySelector('.good')) {
    snap('存档就已经在店里');
  } else {
    out.steps.push({ label: '没找到任何 [data-shop] 卡片，也不在店里' });
  }
  const inc = [...document.querySelectorAll('[data-action="inc"]')].find((b) => !b.disabled);
  if (inc) {
    inc.click();
    await sleep(400);
    snap('加了一件之后');
    const inc2 = [...document.querySelectorAll('[data-action="inc"]')].find((b) => !b.disabled);
    if (inc2) { inc2.click(); await sleep(400); snap('加了两件之后'); }
  } else {
    out.steps.push({ label: '店里没有一个能点的 + （全部 disabled）' });
  }
  const load = document.querySelector('[data-action="load"]');
  if (load) {
    const r = load.getBoundingClientRect();
    out.loadButton = { text: norm(load.textContent), disabled: !!load.disabled, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inView: r.bottom <= innerHeight + 0.5 && r.top >= -0.5 };
  }
  out.viewport = innerWidth + 'x' + innerHeight;
  /* ★ 底栏那一排按钮：三枚（搬回车上 / 先不进去 / 回家整理）在窄屏上会不会截字或换行 */
  out.buttons = [...document.querySelectorAll('.dock-tools .btn')].map((b) => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return {
      text: norm(b.textContent),
      w: Math.round(r.width), h: Math.round(r.height),
      fontSize: cs.fontSize, lineHeight: cs.lineHeight,
      clipped: b.scrollWidth > b.clientWidth + 1,
      lines: Math.round(r.height / parseFloat(cs.lineHeight || '1')),
      inView: r.bottom <= innerHeight + 0.5,
    };
  });
  /* ★ 关键：底栏是"钉在屏幕底下"还是"页面里最后一块" —— 若是后者，长一点的货单会把它推到折线以下 */
  const dockEl = document.querySelector('.dock');
  if (dockEl) {
    const cs = getComputedStyle(dockEl);
    const dr = dockEl.getBoundingClientRect();
    out.dockBox = { position: cs.position, top: Math.round(dr.top), bottom: Math.round(dr.bottom), h: Math.round(dr.height), inView: dr.bottom <= innerHeight + 0.5 };
  }
  const scroller = document.scrollingElement;
  out.page = { scrollH: scroller ? scroller.scrollHeight : null, clientH: scroller ? scroller.clientHeight : null, scrollTop: scroller ? Math.round(scroller.scrollTop) : null };
  const main = document.querySelector('#app .screen > *:not(.topbar):not(.dock)');
  if (main) {
    const mr = main.getBoundingClientRect();
    out.main = { cls: main.className, top: Math.round(mr.top), bottom: Math.round(mr.bottom), scrollH: main.scrollHeight, clientH: main.clientHeight };
  }
  out.dockHtml = document.querySelector('.dock') ? document.querySelector('.dock').innerHTML.slice(0, 1200) : null;
  return out;
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

const profile = mkdtempSync(join(tmpdir(), 'probe-shop-'));
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
  await cdp.send('Page.enable');  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Page.navigate', { url: APP_URL });
  await sleep(4000);

  for (let attempt = 1; attempt <= 4; attempt++) {
    /* ★ load() 会 reload —— 那一发 evaluate 必然以 "navigated or closed" 告终，要当成信号而不是崩溃 */
    let r: { value?: unknown; error?: string };
    try {
      r = await evaluate(cdp, WALK);
    } catch (e) {
      r = { error: e instanceof Error ? e.message : String(e) };
    }
    if (r.error) {
      console.log(`· 第 ${attempt} 趟被刷新打断（正常）：${r.error.split('\n')[0]}`);
      await sleep(2500);
      continue;
    }
    const out = r.value as { steps: Array<Record<string, unknown>>; loadButton: unknown; dockHtml: string | null } | undefined;
    if (!out) break;
    for (const s of out.steps) {
      console.log('─'.repeat(70));
      console.log(`【${String(s['label'])}】  屏幕=${String(s['screen'])}  店铺卡=${String(s['shops'])}  货品行=${String(s['goods'])}`);
      console.log(`  底栏：${String(s['dock'])}`);
      console.log(`  搬回车上按钮：${s['hasLoad'] ? '在' : '❌ 不在 DOM 里'}${s['hasLoad'] ? (s['loadDisabled'] ? '（disabled）' : '（可点）') : ''}`);
    }
    console.log('─'.repeat(70));
    console.log('搬回车上按钮的位置：', JSON.stringify((out as unknown as { loadButton: unknown }).loadButton));
    console.log('视口：', JSON.stringify((out as unknown as { viewport: unknown }).viewport));
    console.log('底栏按钮：', JSON.stringify((out as unknown as { buttons?: unknown }).buttons, null, 1));
    console.log('底栏盒子：', JSON.stringify((out as unknown as { dockBox: unknown }).dockBox));
    console.log('页面：', JSON.stringify((out as unknown as { page: unknown }).page));
    console.log('主区：', JSON.stringify((out as unknown as { main: unknown }).main));
    console.log('底栏 HTML：', out.dockHtml);

    /* 截图：数字回答不了"这三枚按钮挤不挤"，眼睛可以 */
    const shotDir = process.env['SHOT_DIR'];
    if (shotDir) {
      const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      mkdirSync(shotDir, { recursive: true });
      const file = join(shotDir, `${VIEW_W}x${VIEW_H}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log('📷', file);
    }
    break;
  }
  cdp.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
