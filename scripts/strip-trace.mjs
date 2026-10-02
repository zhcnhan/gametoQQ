/**
 * 一次性清理：删掉 `src/ui/OrganizeScreen.ts` 里的诊断 `trace(...)` 调用。
 *
 * 背景：为了定位"拖拽卡住 / 不跟手 / 交换被拒"这几个只在运行期才显形的 bug，
 * 我在代码里插了一批 `trace(...)`（由 `window.__tunhuoTrace` 开关）。
 * 它们完成了任务 —— 现在把调用点清掉，只保留 `trace` 函数与开关本身，
 * 以后再遇到"现象说不清"的问题可以直接复用。
 *
 * 保留：
 *  · `function trace(...)` 的定义与开关（`__tunhuoTrace`）；
 *  · 所有解释性注释（那些是这一轮排查的结论，值得留下）。
 *
 * 跑法：`node scripts/strip-trace.mjs`（**一次性工具**，不进 npm scripts）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'ui', 'OrganizeScreen.ts');
const lines = readFileSync(target, 'utf8').split('\n');

const out = [];
let removed = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // 只删"整行以 trace( 开头"的调用；跨行的要一起吃掉
  if (/^\s*trace\(/.test(line)) {
    let depth = 0;
    let j = i;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
      }
      if (depth <= 0) break;
    }
    // 如果上一行是这条 trace 的注释、且注释只讲这条 trace，也一并删掉
    removed += 1;
    i = j;
    continue;
  }
  out.push(line);
}

writeFileSync(target, out.join('\n'));
console.log(`[strip-trace] 删掉 ${removed} 处 trace 调用；剩余 ${out.filter((l) => /^\s*trace\(/.test(l)).length} 处（应为 0）`);
