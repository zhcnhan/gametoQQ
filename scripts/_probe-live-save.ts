/**
 * 临时探针：**线上站点**拿到一份"旧版本的存档"之后，还认不认？（用户 m18160 的第一条要求）
 *
 * 要回答的是：热更新 GitHub Pages 之后，玩家（乔子零号/一号）的存档会不会丢。
 * 机制上 localStorage 按**源**（scheme+host+port）隔离，重新部署不动它；
 * 但"机制上应该没事"不算证据，所以这里实跑一遍：
 *
 *   ① 打开线上站点 → 记下初始界面；
 *   ② 把仓库里那份 **v19** 的存档（`src/tools/save-shop-tour.txt`，由更早的构建生成）
 *      塞进线上源的 localStorage → 刷新；
 *   ③ 看它进的是**游戏**还是**开场页**，以及 localStorage 里那份存档的
 *      `meta.version` 有没有被迁移成当前版本（被改写 = 迁移真的跑了）；
 *   ④ 再刷新一次（这一次不碰存储）→ 看还在不在游戏里。
 *
 * 跑法：`npx vite-node scripts/_probe-live-save.ts`（`APP_URL=…` 可换成别的地址）
 * 用完即删（`scripts/_probe-*.ts` 是纯 LF 的既有约定）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env['CHROME_PATH'] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = process.env['APP_URL'] ?? 'https://zhcnhan.github.io/gametoQQ/';
const OLD_SAVE = process.env['OLD_SAVE'] ?? 'src/tools/save-shop-tour.txt';
const VIEW = (process.env['VIEWPORT'] ?? '424x790').split('x').map((n) => Number(n.trim()));
const PORT = 9343;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** 页面上的"现在是什么界面"判定：读第一屏前 160 字 + 关键选择器 */
const SNAP = `(() => {
  const saved = window.localStorage.getItem('tunhuo.save');
  let version = null;
  let day = null;
  try { const j = JSON.parse(saved || 'null'); version = j && j.meta ? j.meta.version : null; day = j && j.run ? j.run.day : null; } catch (e) {}
  return {
    title: document.title,
    intro: /怎么玩|先决定你是谁/.test(document.body.innerText),
    game: /出货|整理|扫货|先知日历|行动点/.test(document.body.innerText),
    head: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160),
    savedBytes: saved ? saved.length : 0,
    version,
    day,
    rootClass: document.querySelector('#app > *') ? document.querySelector('#app > *').className : '（空）',
  };
})()`;

const profile = mkdtempSync(join(tmpdir(), 'probe-live-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'],
  { stdio: 'ignore' },
);

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

function show(label: string, v: unknown): void {
  console.log(`── ${label} ──`);
  console.log(JSON.stringify(v, null, 1));
}

const oldText = readFileSync(OLD_SAVE, 'utf8').trim();
let oldVersion: unknown = null;
try {
  oldVersion = (JSON.parse(oldText) as { meta?: { version?: number } }).meta?.version;
} catch {
  /* 不是 JSON 就让它空着 */
}

try {
  await waitForDevtools();
  const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的页面目标');
  const cdp = await Cdp.attach(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW[0], height: VIEW[1], deviceScaleFactor: 2, mobile: true });

  console.log(`站点：${APP_URL}`);
  console.log(`要塞进去的旧档：${OLD_SAVE}（meta.version = ${String(oldVersion)}，${oldText.length} 字节）`);

  await cdp.send('Page.navigate', { url: APP_URL });
  await sleep(4000);
  show('① 干净环境（没有任何存档）', (await evaluate(cdp, SNAP)).value ?? (await evaluate(cdp, SNAP)).error);

  // ② 把旧档塞进**线上这个源**的 localStorage，然后刷新
  const injected = await evaluate(
    cdp,
    `(() => { window.localStorage.setItem('tunhuo.save', ${JSON.stringify(oldText)}); return window.localStorage.getItem('tunhuo.save').length; })()`,
  );
  console.log(`② 写入 localStorage：${String(injected.value ?? injected.error)} 字节`);

  const reload = evaluate(cdp, `(() => { window.location.reload(); return 'go'; })()`);
  await Promise.race([reload, sleep(3000)]);
  await sleep(5000);
  show('③ 刷新之后（这一份是旧版本的存档）', (await evaluate(cdp, SNAP)).value ?? (await evaluate(cdp, SNAP)).error);

  // ④ 再刷新一次：这一次不碰存储，看它还在不在
  const reload2 = evaluate(cdp, `(() => { window.location.reload(); return 'go'; })()`);
  await Promise.race([reload2, sleep(3000)]);
  await sleep(5000);
  show('④ 再刷新一次（这次没人碰存储）', (await evaluate(cdp, SNAP)).value ?? (await evaluate(cdp, SNAP)).error);

  const shotDir = process.env['SHOT_DIR'];
  if (shotDir) {
    const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const file = join(shotDir, 'live-save.png');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(shotDir, { recursive: true });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('📷', file);
  }
  cdp.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
