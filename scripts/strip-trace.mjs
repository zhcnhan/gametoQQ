/**
 * 清掉**诊断用**的 `console.*`（M2 起就需要的那个小工具）。
 *
 * ## 它解决什么
 *
 * 纪律 §4A.4 说"红了先打现场" —— 而打现场的手段是一行 `console.log`。
 * 那些行**用完必须清掉**（§4.3），否则它们会在玩家的控制台里刷屏、
 * 也会让"这里的代码看起来在正常跑"这件事变得可疑。
 *
 * 问题在于手工清很容易漏（一个文件里打了七八行、散在四个函数里），
 * 而**用 shell 批量替换源码是这个仓库明令禁止的**
 * （见纪律 §3.4：PowerShell 的多行字符串与反引号极不可靠）。
 * 所以：写成一个脚本，既可靠又留下记录。
 *
 * ## 判据（刻意保守）
 *
 * 只有**同时**满足这两条的 `console.*` 才被删：
 *
 *  ① 它**独占一行**（行首除缩进外就是 `console.`）；
 *  ② 它**上一行**（跳过空行）带 `诊断` / `debug` / `TODO(诊断)` 之一，
 *     或者这一行**自带** `// 诊断` 后缀。
 *
 * ★ 为什么要求"上一行有标记"：`__tunhuoTrace` 那种**按开关打印**的诊断
 * 是**产品的一部分**（它只在开了开关时输出），**不许删**。
 * 第一版按"所有 console.log"删，会把它们一起清掉 —— 那种脚本比不写更危险。
 *
 * ## 用法
 *
 * ```
 * node scripts/strip-trace.mjs            # 只报告，不改
 * node scripts/strip-trace.mjs --write    # 真的删
 * ```
 *
 * 默认**不改**：先看清楚它要删哪几行，再决定。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WRITE = process.argv.includes('--write');
const ROOTS = ['src'];
const MARKERS = ['诊断', 'debug', 'DEBUG'];

/** 收集 .ts（跳过测试：那里的 console 是给人看的断言辅助，另有一套纪律） */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

/** 独占一行的 console.*（缩进任意） */
const SOLE_CONSOLE = /^\s*console\.(log|info|warn|error|debug|table)\s*[([]/;

let filesTouched = 0;
let linesRemoved = 0;

for (const root of ROOTS) {
  if (!statSync(root).isDirectory()) continue;
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const keep = [];
    const removed = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!SOLE_CONSOLE.test(line)) {
        keep.push(line);
        continue;
      }
      // ① 自带后缀标记
      const selfMarked = /\/\/\s*诊断/.test(line);
      // ② 上一行（跳过空行）带标记
      let j = i - 1;
      while (j >= 0 && (lines[j] ?? '').trim() === '') j -= 1;
      const prev = lines[j] ?? '';
      const prevMarked = MARKERS.some((m) => prev.includes(m)) || /\/\/\s*(临时|诊断)/.test(prev);
      if (!selfMarked && !prevMarked) {
        keep.push(line);
        continue;
      }
      // 连"上一行的标记注释"一起清掉（它只为这一行存在）
      if (!selfMarked && prevMarked && keep.length > 0 && keep[keep.length - 1] === prev) {
        keep.pop();
      }
      removed.push(i + 1);
    }

    if (removed.length === 0) continue;
    filesTouched += 1;
    linesRemoved += removed.length;
    console.log(`${file}：${removed.length} 行（${removed.slice(0, 8).join(', ')}${removed.length > 8 ? ', …' : ''}）`);
    if (WRITE) writeFileSync(file, keep.join('\n'), 'utf8');
  }
}

if (filesTouched === 0) {
  console.log('[strip-trace] 没有找到带标记的诊断 console（这就是干净状态）。');
} else if (WRITE) {
  console.log(`\n[strip-trace] ✓ 删了 ${linesRemoved} 行（${filesTouched} 个文件）。`);
  console.log('  下一步：npm run check（删多了会当场红）');
} else {
  console.log(`\n[strip-trace] 以上 ${linesRemoved} 行**只是报告**，没有改动。`);
  console.log('  确认无误后：node scripts/strip-trace.mjs --write');
}
