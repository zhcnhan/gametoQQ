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


/**
 * key 形如 `'../model/types.ts'` → 归一成登记册里使用的 `'model/types.ts'`。
 *
 * `'./xxx.ts'` 是本目录（`meta/`）的文件 —— 返回 null 表示**不参与扫描**。
 * 这一条不能省：登记册与它自己的测试里都写着 `D-01` 这样的字样，
 * 把本目录扫进来会立刻造出一堆"来历不明的标记"（这个坑真踩过）。
 */
function relPath(key: string): string | null {
  if (key.startsWith('./')) return null;
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
    if (rel === null) continue;
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

  it('未清偿的条目都写清了"现在的影响"和"什么时候还"', () => {
    const vague = openDeferred().filter(
      (item) => item.impact.trim().length < 20 || item.plan.trim().length < 2 || item.title.trim().length < 5
    );
    expect(vague.map((item) => item.id)).toEqual([]);
  });

  it('未清偿的代码欠账必须声明至少一个落点文件，且文件真实存在', () => {
    const broken: string[] = [];
    for (const item of DEFERRED_ITEMS) {
      if (item.kind !== 'code' || item.status !== 'open') continue;
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

  it('未清偿的 process 欠账不该声明落点文件（它没有标记可埋）', () => {
    const wrong = openDeferred().filter((item) => item.kind === 'process' && item.markedIn.length > 0);
    expect(wrong.map((item) => item.id)).toEqual([]);
  });

  it('已清偿的条目必须写明清偿于哪里（否则后人不知道该不该信）', () => {
    const vague = DEFERRED_ITEMS.filter(
      (item) => item.status === 'done' && (item.resolvedIn ?? '').trim().length < 8
    );
    expect(vague.map((item) => item.id)).toEqual([]);
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

  it('"寒潮 = 冷库"这笔账已清偿，但清偿理由必须写明白（多灾难落地了）', () => {
    const item = findDeferred('D-03');
    expect(item).not.toBeNull();
    expect(item?.status).toBe('done');
    /*
     * ★ 这条断言的口径在清偿时改过一次，值得说明为什么不是"删掉这条用例"：
     *
     * 它原来查的是 `item.impact` 里有没有「装饰」—— 那守的是"**这笔账没被悄悄关掉**"。
     * 而账一旦真的清偿，`impact` 就该描述**清偿过程**，不该再留着"装饰"那句话。
     *
     * 所以现在守的是"**清偿理由里说清了当初卡在哪**"：`resolvedIn` 必须提到
     * 当初的清偿条件（多灾难）。这才防得住"三个月后有人看到一条 done 的欠账，
     * 以为它本来就是小事"。
     */
    expect(item?.resolvedIn ?? '').toContain('多灾难');
    // 而"寒潮是冷库"这条设计本身继续被上一条用例钉着（字面量 0.5）
  });

  it('M1 验收清单第 3 条已改口径清偿，且留档说明换成了什么', () => {
    const item = findDeferred('D-04');
    expect(item?.kind).toBe('process');
    expect(item?.status).toBe('done');
    // 必须说清"腐坏那条换成了什么"，否则后来者只会看到一条被悄悄关掉的欠账
    expect(item?.impact).toContain('体力');
  });

  it('冰箱的"没效果"已清偿，而且清偿说明里留了"它在寒潮里依然是零收益"这一条', () => {
    /*
     * 这条原来只查 `D-02.status === 'open'`（"这件事是被记录的，不是被忽略的"）。
     * 冰箱真的有效果之后，那个断言就没有意义了 —— 但**它守的东西还得守**：
     * 后来者最容易犯的错是"既然冰箱有用，那寒潮里也该有用吧"，
     * 然后去把寒潮的 `spoilRate` 调高，好让冰箱"物有所值"。
     *
     * 所以改成：清偿说明里必须写明"寒潮里收益是 0，那是设计"。
     * 真正的机制验证在 `model/spoil.test.ts`（按家具比值）。
     */
    const item = findDeferred('D-02');
    expect(item?.status).toBe('done');
    expect(item?.impact ?? '').toContain('随灾难变');
  });
});

