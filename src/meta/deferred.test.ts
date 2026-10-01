/**
 * 欠账登记册的守护测试。
 *
 * 它做的事只有一件：**让 `src/meta/deferred.ts` 不能变成一纸空文**。
 * 三条硬规则 ——
 *   ① 代码里出现的标记，必须在册（不许有来历不明的欠账）；
 *   ② 在册且未清偿的代码欠账，必须在它声明的文件里真的找到标记（不许表格一套、代码一套）；
 *   ③ 已清偿的条目不许在代码里留残标（做完了要收干净）。
 * 外加一条：**已拍板的设计决定本身也要被钉住**（见最后一个 describe）。
 */
import { describe, expect, it } from 'vitest';
import { DEFERRED_ITEMS, DEFERRED_MARKER, findDeferred, openDeferred } from './deferred';

/**
 * 读 `src/` 下所有 ts 源码的原始文本。
 * 用 vite 的 `?raw` 而不是 node 的 fs —— 项目没有（也不打算引入）`@types/node`，
 * 而 `import.meta.glob` 是构建工具自带的能力，零依赖。
 */
const SOURCES = import.meta.glob('../**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

/** key 形如 `'../model/types.ts'` → 归一成登记册里使用的 `'model/types.ts'` */
function relPath(key: string): string {
  return key.replace(/^\.\.[/\\]/, '').replace(/\\/g, '/');
}

/** `'model/types.ts'` → `'../model/types.ts'`（glob 的 key 形态） */
function globKey(rel: string): string {
  return `../${rel}`;
}

/** 扫出 `{ 相对路径: [id...] }`；`meta/` 是登记册自己的地盘，不参与扫描 */
function scanMarkers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [key, text] of Object.entries(SOURCES)) {
    const rel = relPath(key);
    if (rel.startsWith('meta/')) continue;
    const ids: string[] = [];
    for (const match of text.matchAll(new RegExp(DEFERRED_MARKER.source, 'g'))) {
      if (match[1]) ids.push(match[1]);
    }
    if (ids.length > 0) found.set(rel, ids);
  }
  return found;
}

/** 登记册里承认真实存在的源码文件（防止 markedIn 打错字蒙混过关） */
function knownSource(key: string): boolean {
  return SOURCES[key] !== undefined;
}

describe('欠账登记册：结构自检', () => {
  it('id 唯一，且形如 D-01', () => {
    const ids = DEFERRED_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^D-\d{2}$/.test(id))).toBe(true);
  });

  it('每条都写清了"现在的影响"和"什么时候还"', () => {
    const vague = DEFERRED_ITEMS.filter(
      (item) => item.impact.trim().length < 20 || item.plan.trim().length < 2 || item.title.trim().length < 5
    );
    expect(vague.map((item) => item.id)).toEqual([]);
  });

  it('kind=code 的条目必须声明至少一个落点文件，且文件真实存在', () => {
    const broken: string[] = [];
    for (const item of DEFERRED_ITEMS) {
      if (item.kind !== 'code') continue;
      if (item.markedIn.length === 0) {
        broken.push(`${item.id} 是代码欠账却没写 markedIn`);
        continue;
      }
      for (const file of item.markedIn) {
        if (!knownSource(globKey(file))) broken.push(`${item.id} 的 markedIn 指向了不存在的文件：${file}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('kind=process 的条目不该声明落点文件（它没有标记可埋）', () => {
    const wrong = DEFERRED_ITEMS.filter((item) => item.kind === 'process' && item.markedIn.length > 0);
    expect(wrong.map((item) => item.id)).toEqual([]);
  });

  it('登记册不许被清空 —— 它记的是设计决定，不是"待办清单"', () => {
    expect(openDeferred().length).toBeGreaterThan(0);
  });
});

describe('欠账登记册：与源码双向一致', () => {
  it('① 代码里的每个 DEFERRED 标记都在册', () => {
    const registered = new Set(DEFERRED_ITEMS.map((item) => item.id));
    const unknown: string[] = [];
    for (const [file, ids] of scanMarkers()) {
      for (const id of ids) {
        if (!registered.has(id)) unknown.push(`${file} 里的 ${id} 没有登记`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('② 未清偿的代码欠账，在它声明的文件里真的有标记', () => {
    const markers = scanMarkers();
    const missing: string[] = [];
    for (const item of DEFERRED_ITEMS) {
      if (item.status !== 'open' || item.kind !== 'code') continue;
      for (const file of item.markedIn) {
        const ids = markers.get(file) ?? [];
        if (!ids.includes(item.id)) missing.push(`${item.id} 应该在 ${file} 里留下 DEFERRED(${item.id}) 标记，但没有`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('③ 已清偿的条目不许在代码里留残标', () => {
    const done = new Set(DEFERRED_ITEMS.filter((item) => item.status === 'done').map((item) => item.id));
    const stale: string[] = [];
    for (const [file, ids] of scanMarkers()) {
      for (const id of ids) {
        if (done.has(id)) stale.push(`${file} 还留着 ${id} 的标记`);
      }
    }
    expect(stale).toEqual([]);
  });
});

/**
 * 这一组测试守护的不是"待办"，而是**已经拍板的设计决定**。
 * 它们的共同敌人是同一个人：三个月后看到"腐坏恒为 0""冰箱没效果"，
 * 顺手把它们"修好"的人。修好之后，M1 的验收数字会更好看，而玩家的设计意图没了。
 */
describe('已拍板的设计决定：不许被"顺手修好"', () => {
  it('寒潮仍是天然冷库：spoilRate 必须还是 0.5', () => {
    const source = SOURCES[globKey('data/disaster.ts')] ?? '';
    expect(source).toContain('spoilRate: 0.5');
  });

  it('"寒潮 = 冷库 → M1 无腐坏"这笔账还在册，且未清偿', () => {
    const item = findDeferred('D-03');
    expect(item).not.toBeNull();
    expect(item?.status).toBe('open');
    // 它必须指名道姓地解释清楚，否则后来者只会看到一串数字
    expect(item?.impact).toContain('装饰');
  });

  it('M1 验收清单第 3 条作废这件事在册（避免被误读成"没做完"）', () => {
    expect(findDeferred('D-04')?.kind).toBe('process');
    expect(findDeferred('D-04')?.status).toBe('open');
  });

  it('冰箱的"没效果"是被记录的，不是被忽略的', () => {
    expect(findDeferred('D-02')?.status).toBe('open');
  });
});
