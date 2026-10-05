/**
 * 「把这一局带走」的守卫（`ui/saveExchange.ts`）。
 *
 * 这一套守的是**两条只有真实使用才会走到的路**：
 *   ① 导出的那一段字，粘到别处再粘回来，还是同一局（`state/saveCode.test.ts` 管往返，
 *      这里管"界面上那个按钮真的把字放进了框里、而且那一段真的解得开"）；
 *   ② ★★ **读不出来的输入绝不能触发导入** —— 导入会覆盖玩家现成的那一局，
 *      写盘之后没有任何回收站。这是这一整个功能里唯一不可退让的约束。
 *
 * 用法与 `ui/howToPlay.test.ts` / `ui/windowBand.test.ts` 同一套：
 * `FakeDocument` + `asElement(root).innerHTML = …`，然后把事件**派发到那个元素**
 * （`el.dispatch('click')` 会把 `target` 设成它自己），
 * 委托监听器装在 root / document 上，正好走的是真实那条路。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installSaveExchange, saveExchangeHtml } from './saveExchange';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';
import { decodeSaveCode, encodeSaveCode } from '../state/saveCode';
import { createSaveGame } from '../state/save';
import { createStartingRun } from '../systems/setup';

/**
 * 一份"有内容"的档。★ 身份要给真的 —— 空身份会被 `normalizeRun` 消毒成第一个真身份，
 * 往返就不是同一份了（`state/saveCode.test.ts` 里那条注释写了原因）。
 */
function testSave() {
  const run = createStartingRun(20261007, { disasterId: 'cold_snap' });
  run.day = -3;
  run.phase = 'organize';
  run.identityId = 'group_buyer';
  return createSaveGame(run);
}

interface Harness {
  root: FakeElement;
  text: (selector: string) => string;
  /** 派发一个事件到某个元素上，**并且把委托那一层也走到** */
  fire: (selector: string, type: string) => void;
  /** 把一段字放进"粘贴"那个框（模拟玩家粘贴） */
  paste: (text: string) => void;
  imported: string[];
}

function setup(confirmAnswer = true): Harness {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  asElement(root).innerHTML = saveExchangeHtml();

  const imported: string[] = [];
  installSaveExchange(asElement(root), testSave, (code) => imported.push(code));

  /*
   * `window.confirm` 在测试环境里是一个**真的会阻塞**的函数（jsdom/node 的桩会返回 false）。
   * 换掉它是唯一能走到"确认之后"那一步的办法；同时它也是断言点：
   * 读不出来的输入**连问都不该问**（见下面那条用例）。
   */
  const confirmSpy = (): boolean => confirmAnswer;
  (globalThis as unknown as { confirm: () => boolean }).confirm = confirmSpy;

  const find = (selector: string): FakeElement | null => root.querySelector(selector);

  /** 顺着 `parent` 一路往上，找出最上面那一个（= 挂委托的那一层） */
  const topOf = (el: FakeElement): FakeElement => {
    let node = el;
    while (node.parent) node = node.parent;
    return node;
  };

  return {
    root,
    text: (selector) => find(selector)?.textContent ?? '',
    /*
     * ★★ 假 DOM 的 `dispatch` **不冒泡**（`ui/fakeDom.ts` 的注释与
     * `ui/CodexScreen.test.ts:20-22` 都写着这一条，我还是先踩了一次）。
     *
     * 事件必须派发到**挂着委托的那一层**，被点的元素放进 `event.target` ——
     * 真实浏览器里冒泡到委托者手上时，看到的就是这个样子。
     *
     * ⚠ 这里刻意**不用 `root.dispatch`**：那样写只是"测试知道委托挂在哪儿"，
     * 而 `main.ts` 里真正挂的是 `document`。走到最顶上那一个，
     * 将来挂载点从 root 挪到 document 时这些用例不用改。
     *
     * 第一版直接写 `el.dispatch('click')`，于是六条用例红在
     * "点了按钮什么都没发生"上 —— 假体不冒泡，**而且不报任何错**。
     */
    fire: (selector, type) => {
      const el = find(selector);
      if (el) topOf(el).dispatch(type, { target: el });
    },
    paste: (text) => {
      const box = find('[data-save-in]');
      if (box) (box as unknown as { value: string }).value = text;
    },
    imported
  };
}

let h: Harness;
beforeEach(() => {
  h = setup();
});

describe('那一块 HTML：它得说清自己在做什么，而且不能有死按钮', () => {
  it('★ 折起来的标题，以及"存档只在这个浏览器里"这句人话', () => {
    const html = saveExchangeHtml();
    expect(html).toContain('<details');
    expect(html).toContain('<summary>把这一局带走</summary>');
    expect(html).toContain('只在这个浏览器里');
  });

  it('★ 两个框都是 readonly —— 它们是拿来整段复制的，不是拿来改的', () => {
    const boxes = h.root.querySelectorAll('.save-code');
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      /*
       * ★★ 必须是 readonly 而**不是** disabled：`readonly` 的框算 isEditable，
       *    于是 `main.ts` 的剪贴板守卫会放行它的复制 / 粘贴。
       *
       * ★ 假体把布尔属性记成**空串**（`hidden=""` / `readonly=""` / `disabled=""`），
       *   所以判据是"在不在"而不是"值真不真"：写 `toBeTruthy()` 会在两个框都正确
       *   拿到 `readonly` 的情况下照样红，而那条红看起来像"少了 readonly"。
       */
      expect(box.attributes['readonly'] !== undefined).toBe(true);
      expect(box.attributes['disabled']).toBeUndefined();
    }
  });

  it('★★ 导入按钮一开始必须是禁用的（没有验证过的输入，就没有可点的导入）', () => {
    const button = h.root.querySelector('[data-action="save-import"]');
    // 假体把布尔属性记在 attributes 里；真 DOM 上这是 `disabled` 属性
    expect(button?.attributes['disabled'] !== undefined).toBe(true);
  });

  it('★ 三条路都在：生成 / 选文件 / 粘贴', () => {
    const html = saveExchangeHtml();
    expect(html).toContain('data-action="save-export"');
    expect(html).toContain('data-save-file');
    expect(html).toContain('data-save-in');
    expect(html).toContain('data-action="save-check"');
  });
});

describe('导出：按一下就得到一段真的能带回这一局的字', () => {
  it('★★ 生成的那一段解回来，就是现在这一局', () => {
    h.fire('[data-action="save-export"]', 'click');
    const code = (h.root.querySelector('[data-save-box]') as unknown as { value: string }).value;
    expect(code.startsWith('TUNHUO1')).toBe(true);
    const back = decodeSaveCode(code);
    expect(back?.run?.day).toBe(-3);
    expect(back?.run?.disasterId).toBe('cold_snap');
    expect(back?.meta.version).toBe(testSave().meta.version);
  });

  it('★ 顺手给了一句人话（复制成功 / 这个地址不让复制，都说清楚）', () => {
    h.fire('[data-action="save-export"]', 'click');
    // 提示是异步补上的（要等剪贴板那一步），所以只看"有没有说过话"这一层
    expect(h.root.querySelector('[data-save-msg-export]')).not.toBeNull();
  });

  it('★ "存成文件"那个链接在这之前是藏着的，生成之后才出现', () => {
    expect(h.root.querySelector('[data-save-download]')?.attributes['hidden'] !== undefined).toBe(true);
    h.fire('[data-action="save-export"]', 'click');
    const link = h.root.querySelector('[data-save-download]');
    expect(link?.attributes['hidden']).toBeUndefined();
    expect(link?.attributes['href'] ?? '').toContain('data:text/plain');
    expect(link?.attributes['download'] ?? '').toContain('tunhuo');
  });
});

describe('★★ 读不出来的输入，绝不能换掉玩家现在这一局', () => {
  const bad = [
    '随便一段什么',
    '',
    'TUNHUO9\nQUJD',
    'TUNHUO1\n!!!!',
    'TUNHUO1\nQUJD'
  ];

  for (const text of bad) {
    it(`★ 输入 ${JSON.stringify(text.slice(0, 16))} → 不导入、不抛异常`, () => {
      h.paste(text);
      expect(() => h.fire('[data-action="save-check"]', 'click')).not.toThrow();
      expect(() => h.fire('[data-action="save-import"]', 'click')).not.toThrow();
      expect(h.imported).toHaveLength(0);
    });
  }

  it('★★ 坏输入之后导入按钮还是禁用的（不能"按下去什么都不发生"）', () => {
    h.paste('这是一段坏存档码');
    h.fire('[data-action="save-check"]', 'click');
    expect(h.root.querySelector('[data-action="save-import"]')?.attributes['disabled'] !== undefined).toBe(
      true
    );
  });

  it('★ 坏输入要给一句能摆在界面上的话', () => {
    h.paste('这是一段坏存档码');
    h.fire('[data-action="save-check"]', 'click');
    expect(h.text('[data-save-msg-import]').length).toBeGreaterThan(0);
  });
});

describe('导入：验过之后才放行，而且写进去的是验过的那一段', () => {
  it('★★ 好存档码：看得懂 → 按得动 → 才真的导入', () => {
    const code = encodeSaveCode(testSave());
    h.paste(code);
    // 没点"看一看"之前，导入按钮不该能动
    expect(h.root.querySelector('[data-action="save-import"]')?.attributes['disabled'] !== undefined).toBe(
      true
    );
    h.fire('[data-action="save-check"]', 'click');
    /*
     * ★ 判"能按了"要按**假体记布尔属性**的口径写：`setImportEnabled(root, true)` 走的是
     * `button.disabled = false`，而假体把布尔属性记成空串（`disabled=""`）——
     * 写成 `toBeUndefined()` 会红在读到一个 `''` 上，而那条红看起来像"按钮还禁着"、
     * 让人去查 `setImportEnabled`，其实它完全正确。
     */
    expect(h.root.querySelector('[data-action="save-import"]')?.attributes['disabled']).toBe('');
    h.fire('[data-action="save-import"]', 'click');
    expect(h.imported).toHaveLength(1);
    expect(h.imported[0]).toBe(code);
  });

  it('★★ "验过之后又被改过" → 重新验，不拿旧结论放行', () => {
    /*
     * 这一条是 `stash` 存在的全部理由：验的是 A、写进去的是 B，
     * 不会有任何报错，而玩家那一局已经被覆盖了。
     */
    const good = encodeSaveCode(testSave());
    h.paste(good);
    h.fire('[data-action="save-check"]', 'click');

    h.paste('改成一段坏的了');
    h.fire('[data-action="save-import"]', 'click');
    expect(h.imported).toHaveLength(0);
  });

  it('★ 玩家在系统弹窗上点了"不要" → 什么都不写', () => {
    const local = setup(false);
    local.paste(encodeSaveCode(testSave()));
    local.fire('[data-action="save-check"]', 'click');
    local.fire('[data-action="save-import"]', 'click');
    expect(local.imported).toHaveLength(0);
  });

  it('★ 空框：说一句"还没有粘任何东西"，而不是静静什么都不发生', () => {
    h.fire('[data-action="save-check"]', 'click');
    expect(h.text('[data-save-msg-import]')).toContain('还没有');
    h.fire('[data-action="save-import"]', 'click');
    expect(h.imported).toHaveLength(0);
  });
});
