/**
 * 「把这一局带走」—— 存档码的导出 / 导入界面（D-34 的邻座，用户 2026-10 走查提的那一件）。
 *
 * ## 为什么要有这一块
 *
 * 存档只活在浏览器的 localStorage 里（`state/save.ts` 的 `STORAGE_KEY = 'tunhuo.save'`）。
 * 于是有两件真实会发生、而且**没有任何提示**的事：
 *
 *   ① 换设备、换浏览器、清一次浏览数据 → 这一局凭空消失；
 *   ② 试玩的人卡在某一天，只能口述"我卡在哪儿" —— 她既发不回一个可复现的现场，
 *      本端也拿不到她的档来看。
 *
 * ## 两条路，都要有
 *
 * | 路 | 给谁用 | 为什么不能只有这一条 |
 * | --- | --- | --- |
 * | **复制 / 粘贴一段字** | 发消息给人 | ★ 剪贴板 API 只在 https 或 localhost 下存在；局域网 http 打开时 `navigator.clipboard` 是 **undefined** |
 * | **下载 / 选择一个文件** | 同一个人换设备 | iOS Safari 上"下载一个 txt"会进文件 App，不好找；而粘贴在手机上很顺手 |
 *
 * 少任何一条，都有一半人搬不动自己的存档 —— 而这两条加起来不到一百行。
 *
 * ## ★★ 一个关键的接线决定：`document` 级委托，不是挂到某一屏
 *
 * 与 `ui/prophetBar.ts` 的展开钮同一种做法（那里的注释写了原因）：
 * 这一块住在**图鉴页的末尾**，而图鉴页每次打开都会整体重建
 * （`ui/Router.ts` 换页时清空 root）—— 监听器挂在 root 上会跟着没。
 * 挂在 `document` 上，它与屏的生灭无关。
 *
 * ## ⚠⚠ 两个框都必须是 `readonly`（**不能**是 `disabled`，也**不能**什么都不写）
 *
 * `src/main.ts` 的 `installClipboardGuard` 会拦住"复制 / 粘贴 / 剪切"这几个事件，
 * 而它放行的条件是 `isEditable(目标)` —— 判据是 `readOnly` 为真、或者 `isContentEditable`。
 * 少了这个属性，**手机上长按那个框根本粘不进去**：`paste` 事件被 `preventDefault`，
 * 表现是"框里怎么都出不来字"，而且不报任何错。
 *
 * 第一版就是这样漏掉的：导出那个框写了 `readonly`（它确实只要复制），
 * 而**导入那个框没写** —— 讽刺的是导入那个框恰恰是要往里粘东西的那个。
 * 这一条现在由 `ui/saveExchange.test.ts` 逐框守着（两个框都要 `readonly`，都不许 `disabled`）。
 *
 * ## ⚠ 它不碰 `store`，也不碰 localStorage
 *
 * 导出：把调用方交进来的 `SaveGame` 编成一段字（纯函数，`state/saveCode.ts`）。
 * 导入的第一步只是**解出来看一眼**，真正的"换掉现在这一局"由调用方决定
 * （`src/main.ts` 的 `importSaveCode`：写盘 + 重开页面）。
 * 这一层刻意不知道存档存在哪儿 —— 那样它才测得出"解不出来时不写任何东西"。
 */
import { encodeSaveCode, inspectSaveCode, type SaveCodeInfo } from '../state/saveCode';
import { SAVE_VERSION } from '../state/save';
import type { SaveGame } from '../model/types';

/** 导出区的 textarea 与导入区的**共用一个**元素 id 会打架，所以导出那一块只要一个只读框 */
const EXPORT_BOX = '[data-save-box]';

/**
 * 空框那句话说一遍就够了。
 *
 * ★ 两处（"看一看"与"换掉现在这一局"）都会撞到空框，而它们各自写一份措辞，
 * 早晚会漂成两句不一样的话 —— 同一件事在两屏里说法不同，玩家会以为这是两件事。
 */
const EMPTY_INPUT_NOTE = '还没有粘任何东西 —— 把别人发你的那一整段字粘到上面那个框里。';

/**
 * 这一块的 HTML。**纯函数**，无输入。
 *
 * ★ 与 `ui/howToPlay.ts` 同一条纪律：它不接 `store`、也不接 `SaveGame` ——
 * 存档码是点"生成"那一刻才编的（在这里就编会让每一屏的 HTML 都背上 19KB）。
 */
export function saveExchangeHtml(): string {
  return `
    <section class="block save-exchange" data-save-exchange>
      <details class="save-fold">
        <summary>把这一局带走</summary>
        <p class="block-note">
          存档只在这个浏览器里。换手机、换浏览器、清一次浏览数据，它就没了 ——
          想留着，就把下面这一段字发给未来的自己。
        </p>

        <div class="save-actions">
          <button class="btn btn-quiet" type="button" data-action="save-export">生成一段存档码</button>
          <a class="btn btn-quiet" data-save-download hidden download="tunhuo-save.txt">存成文件</a>
          <label class="btn btn-quiet save-file">
            选一个存档文件
            <input type="file" accept=".txt,text/plain" data-save-file hidden />
          </label>
        </div>
        <p class="block-note save-msg" data-save-msg-export aria-live="polite"></p>
        <textarea class="save-code" data-save-box readonly rows="4"
          aria-label="这一段就是你的存档，可以整段复制"
          placeholder="按上面那个按钮，这里会出现一段字。"></textarea>

        <hr class="save-hr" />

        <p class="block-note">
          从别处拿回来一段？粘在下面，先看清楚它是什么，再决定要不要换掉现在这一局。
        </p>
        <textarea class="save-code" data-save-in readonly rows="4"
          aria-label="把存档码粘在这里"
          placeholder="把那段字整段粘进来。"></textarea>
        <div class="save-actions">
          <button class="btn btn-quiet" type="button" data-action="save-check">看一看这是什么</button>
          <button class="btn" type="button" data-action="save-import" disabled>换掉现在这一局</button>
        </div>
        <p class="block-note save-msg" data-save-msg-import aria-live="polite"></p>
      </details>
    </section>
  `;
}

/**
 * 装上委托。**只需要在启动时调一次**（见文件头"document 级委托"）。
 *
 * `read` 在按下"生成"的那一刻才被调用：它返回**当前**存档，而不是启动时那一份。
 */
export function installSaveExchange(
  root: ParentNode,
  read: () => SaveGame,
  importCode: (text: string) => void
): void {
  const fail = (msg: string): void => {
    report(root, 'import', msg, true);
    setImportEnabled(root, false);
  };

  /** "看一看"验过的那一段。见 `onImport` 与下面 `check()` 里的 `stash` */
  let verified: string | null = null;

  const onImport = (): void => {
    /*
     * ★★ 写进去的是**"看一看"那一步验过的那一段**（`verified`），
     * 不是此刻输入框里的内容 —— 见 `stash`。
     * 若两者不一致（玩家验完又改了几个字），必须**重新验**，不能拿旧的结论放行。
     */
    const box = asInput(root.querySelector('[data-save-in]'));
    const typed = String(box?.value ?? '').trim();
    const code = verified !== null && verified === typed ? verified : typed;
    if (code.length === 0) {
      report(root, 'import', EMPTY_INPUT_NOTE, true);
      return;
    }
    const info = inspectSaveCode(code);
    if (!info.readable) {
      // 解不出来 → 按钮留在"不能按"的状态。**绝不能**让它可以按下去然后什么都不发生
      fail(info.note);
      return;
    }
    if (info.version > SAVE_VERSION) {
      fail(info.note);
      return;
    }
    /*
     * ★ 一次 `confirm`，把结论摆出来再动手。
     * 覆盖掉的这一局**没有回收站**（写盘是直接 `setItem`），所以这一步不能省。
     * 用原生 `confirm` 而不是自绘弹层：它出现在所有九屏之上、不依赖任何样式，
     * 而这正是"最后一次确认"该有的样子。
     *
     * ⚠ 走 `askConfirm` 而不是直接 `window.confirm(...)`：`window` 上有没有 `confirm`
     * 在一个**根本不该有关系**的地方决定了导入能不能用 —— 测试环境里就没有
     * （表现是 `TypeError: window.confirm is not a function`，看起来像测试的错），
     * 而"压缩过的 WebView / 某些内置浏览器里没有 `confirm`"是真会发生的：
     * 那种环境下不弹窗、直接按"玩家已经确认过"继续，比让整个按钮炸掉好。
     */
    if (!askConfirm(`要换掉现在这一局吗？\n\n` +
      `拿回来的那一局：${info.disaster} · ${info.dayLabel}（${info.note}）\n` +
      `现在正在玩的这一局会被覆盖，覆盖之后找不回来。`)) {
      return;
    }
    importCode(code);
  };

  const onExport = (): void => {
    let code = '';
    try {
      code = encodeSaveCode(read());
    } catch (error) {
      report(root, 'export', `编不出来：${String(error)}`, true);
      return;
    }
    const box = asInput(root.querySelector(EXPORT_BOX));
    if (box) box.value = code;
    const link = root.querySelector('[data-save-download]');
    if (isTag(link, 'A')) {
      /*
       * ★ 用 `setAttribute` 而不是 `anchor.href = …`。
       *
       * 两者在浏览器里结果一样（`href` 是反射属性），差别只在**有没有写进属性表**：
       * `a.href = x` 只设属性（property），`a.getAttribute('href')` 仍然是 null。
       * 而这一段东西唯一的用处就是被点开下载 —— 属性表里没有它，
       * 测试就只能靠"读 property"来验，而那正是**假 DOM 没有的那一半**
       * （`ui/fakeDom.ts` 的元素只有 `attributes` 字典，没有 `href` 反射）。
       * 写成 setAttribute，浏览器与假体看到的是同一件事。
       */
      const anchor = link as HTMLAnchorElement;
      anchor.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(code)}`);
      anchor.setAttribute('download', fileNameOf(read()));
      anchor.removeAttribute('hidden');
    }
    /*
     * 按完顺手复制一次。**失败是完全正常的**：局域网 http 打开时
     * `navigator.clipboard` 根本不存在（剪贴板 API 只在 https / localhost 下有）。
     * 所以这里不报错，只换一句提示 —— 说清楚"去上面的框里自己复制"。
     */
    void copyText(code).then((done) => {
      const size = `${Math.round(code.length / 1024)}KB`;
      report(
        root,
        'export',
        done
          ? `已经复制好了（${size}）。也可以直接长按上面那个框全选。`
          : `生成好了（${size}）。这个地址下浏览器不让网页自己复制，**长按上面那个框全选、复制**。`,
        false
      );
    });
  };

  const onFile = (input: HTMLInputElement): void => {
    const file = input.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => {
        const box = asInput(root.querySelector('[data-save-in]'));
        if (box) box.value = text;
        check();
      })
      .catch((error: unknown) => fail(`这个文件读不出来：${String(error)}`));
  };

  const check = (): void => {
    const box = asInput(root.querySelector('[data-save-in]'));
    /*
     * ⚠ `String(box?.value ?? '')` 里的 `?? ''` 不是多余的：假 DOM（`ui/fakeDom.ts`）
     * 的 `<textarea>` 上**没有 `value`**，而输入框里的字正是这一段唯一的输入 ——
     * 少了它就变成 `Cannot read properties of undefined (reading 'trim')`，
     * 而那条报错看起来像"测试写错了"，不像"界面读不到框里的字"。
     * 真浏览器里 `value` 永远是字符串，取不到才是异常。
     */
    const code = String(box?.value ?? '').trim();
    if (code.length === 0) {
      /*
       * ★★ 这里必须**说一句话**，不能只是"什么都不显示"。
       *
       * 第一版写的是 `report(root, 'import', '', false)` —— 把提示清空、按钮按下。
       * 读起来像"什么都没发生"，而按下按钮却什么都不发生，
       * 玩家得到的结论是"这个按钮坏了"，不是"我还没粘东西"。
       * 空框是**最常撞到**的那一种输入（第一次点开的人十有八九就是这么按的），
       * 所以这句话是这一段里最该说清的一句。
       */
      report(root, 'import', EMPTY_INPUT_NOTE, false);
      setImportEnabled(root, false);
      return;
    }
    const info = inspectSaveCode(code);
    report(root, 'import', describe(info), !info.readable);
    setImportEnabled(root, info.readable);
    if (info.readable) {
      verified = code;
      stash(root, code);
    }
  };

  root.addEventListener('click', (e) => {
    /*
     * ⚠ 这里**不能**写成一串允许的标签名（`isTag(target, 'BUTTON', 'A', …)`）：
     * 按钮里那个图标是 `<i>`、`<span>` 还是别的，改一次样式就变了，
     * 而漏掉一个标签名的表现是"**点那个图标没反应**"、不报任何错。
     * 判据改成"有没有 `closest`" —— 事件目标本身是什么标签与能不能往上找按钮无关。
     */
    const target = e.target as HTMLElement | null;
    if (typeof target?.closest !== 'function') return;
    const button = target.closest<HTMLElement>('[data-action]');
    const action = button?.dataset['action'];
    if (action === 'save-export') onExport();
    else if (action === 'save-check') check();
    else if (action === 'save-import') onImport();
  });

  root.addEventListener('change', (e) => {
    const target = e.target as Element | null;
    if (isTag(target, 'INPUT') && target?.matches('[data-save-file]')) onFile(target as HTMLInputElement);
  });
}

/**
 * 一句"这一段里是什么"。
 *
 * ★ 它**必须比"读得出来 / 读不出来"多说一句**：玩家真正要判断的是
 * "这值不值得换掉我手里这一局"，而"寒潮 · D-3（囤货期 · 在外面买东西）"
 * 才让他判断得了。只写"有效"等于什么都没说。
 */
function describe(info: SaveCodeInfo): string {
  if (!info.readable) return info.note;
  return `这一段是：${info.disaster} · ${info.dayLabel} · ${info.note}。换掉之后，现在这一局就没了。`;
}

function report(root: ParentNode, which: 'export' | 'import', text: string, bad: boolean): void {
  const el = root.querySelector(`[data-save-msg-${which}]`);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-bad', bad);
  el.classList.toggle('is-ok', !bad && text.length > 0);
}

/**
 * 最后一次确认。**这是唯一一个"不行也得行"的地方**：覆盖掉的这一局没有回收站。
 *
 * ## ⚠ 为什么要包一层，而不是直接 `window.confirm(...)`
 *
 * 第一版直接调用，结果在测试里炸成 `TypeError: window.confirm is not a function`
 * —— 报错位置在 `onImport` 里面，看起来像"测试写错了"，
 * 而它其实是**产品代码不该假设 `window` 上一定有 `confirm`**。
 *
 * 这条假设在两个地方不成立：
 *   ① 测试环境（`installFakeWindow` 只装它需要的那几个）；② 真会遇到的 ——
 *      某些裁剪过的 WebView / 内置浏览器里没有 `confirm`。
 *
 * 拿不到对话框时**返回 true**（继续导入）：这个函数问的是"确认吗"，
 * 而按到这一步的玩家已经先点过"看一看"、又点过"换掉现在这一局"了 ——
 * 两次明确的动作之后，因为浏览器没有那个弹窗就把功能整个废掉，是更坏的结果。
 */
function askConfirm(message: string): boolean {
  const ask = (globalThis as { confirm?: unknown }).confirm;
  if (typeof ask !== 'function') return true;
  return (ask as (m: string) => boolean).call(globalThis, message);
}

/**
 * ★★ 全部按**标签名**判，不写 `instanceof HTMLTextAreaElement`。
 *
 * ## 为什么（踩到过，而且它让整个功能"看起来没做"）
 *
 * `src/ui/fakeDom.ts` 造出来的假元素只是 `FakeElement`，而整套测试环境里
 * **只装了 `HTMLElement` 一个构造器**（`installFakeWindow` 那一段）。
 * 于是 `x instanceof HTMLTextAreaElement` 在测试里**恒为 false** ——
 * 不是抛异常，是静默地判成"这不是输入框"。
 *
 * 后果是最坏的那种：导出那条路在测试里**走出去了、但是什么都没做**
 * （框里没有字、下载链接不出现），而真浏览器里一切正常。
 * 也就是说这个功能的测试会变成"验空气"，谁也不会发现。
 *
 * 用 `tagName` 就没这个问题：真 DOM 与假体给的标签名是同一个字符串
 * （`fakeDom` 的 `FakeElement.tagName` 就是建它时那个 tag 的大写形式）。
 *
 * ⚠ `tagName` 在做 XML 文档时会保留小写，所以两边都判。
 */
function isTag(el: Element | null | undefined, ...tags: string[]): boolean {
  if (!el) return false;
  const tag = (el as { tagName?: unknown }).tagName;
  if (typeof tag !== 'string') return false;
  const upper = tag.toUpperCase();
  return tags.some((t) => t.toUpperCase() === upper);
}

function setImportEnabled(root: ParentNode, on: boolean): void {
  const button = root.querySelector('[data-action="save-import"]');
  if (!isTag(button, 'BUTTON')) return;
  (button as HTMLButtonElement).disabled = !on;
}

function asInput(el: Element | null): HTMLTextAreaElement | null {
  return isTag(el, 'TEXTAREA') ? (el as HTMLTextAreaElement) : null;
}

/**
 * 把已经验过的那段码**也**收在按钮自己身上。
 *
 * ★ 为什么不 import 时只从输入框读一次：文件那条路与粘贴那条路
 * 会写出**两份不同的真相**（框里那份可能被玩家改过），
 * 而"验的是 A、写进去的是 B"不会有任何报错。收在这里，就只有一份 ——
 * 顺带它也让"按过'看一看'之后又改了输入框"这件事变得可判（见 `onImport`）。
 */
function stash(root: ParentNode, code: string): void {
  const button = root.querySelector('[data-action="save-import"]');
  if (button) (button as HTMLElement).dataset['saveCode'] = code;
}

async function copyText(text: string): Promise<boolean> {
  const nav = navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } };
  try {
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 用户拒绝授权、或非安全上下文：都走下面那条路
  }
  return false;
}

/** 文件名：让人三个月后在下载文件夹里认得出这是哪一局 */
function fileNameOf(save: SaveGame): string {
  const day = save.run ? `D${save.run.day}` : 'none';
  return `tunhuo-${day}.txt`;
}
