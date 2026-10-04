/**
 * 一次性：胶带架真的渲染出来了吗？
 *
 * ★ 假 DOM 很挑（它不做完整的 HTML 容错），而我这次是**手拼**的 HTML ——
 * 所以"渲染出来了没有"必须先量一遍，不能靠看代码。
 */
import { readFileSync } from 'node:fs';
import { deserialize } from '../src/state/save';
import { GameStore } from '../src/state/store';
import { createOrganizeSession } from '../src/systems/organize';
import { OrganizeScreen } from '../src/ui/OrganizeScreen';
import { FakeDocument, asElement } from '../src/ui/fakeDom';

const doc = new FakeDocument();
(globalThis as unknown as { window: unknown }).window = { document: doc };
const root = doc.createElement('div');
const save = deserialize(readFileSync('src/tools/save-rows.txt', 'utf8'));
if (!save?.run) throw new Error('夹具读不出来');
const store = new GameStore(save, {
  schedule: () => undefined,
  flush: () => undefined,
  dispose: () => undefined,
  pending: false
});
new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
  onRestart: () => undefined,
  onGoOut: () => undefined,
  onEndDay: () => undefined
}).mount();

const counts: Record<string, number> = {};
for (const sel of ['[data-tape-shelf]', '[data-tape-chip]', '[data-tape-new]', '[data-tape-scissors]', '.tape-chip', '.tape-tool', '[data-shelf-row]']) {
  counts[sel] = root.querySelectorAll(sel).length;
}
console.log('渲染结果：');
for (const [sel, n] of Object.entries(counts)) console.log(`  ${sel.padEnd(22)} ${n}`);

const host = root.querySelectorAll('[data-tape-shelf]')[0];
console.log('\n胶带架的内容：');
console.log('  ' + (host?.innerHTML ?? '(没有)').replace(/\s+/g, ' ').slice(0, 420));
