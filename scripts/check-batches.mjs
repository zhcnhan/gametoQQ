/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  content/ 的**批次间** id 对账（入库前跑）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么需要它（这是踩出来的，不是想出来的）
 *
 * `check-content.mjs` 是**按文件**校验的，所以：
 *
 *  · 批内重复 —— 它抓得到（"批内重复 id"）；
 *  · 与**已入库**的表冲突 —— 它抓得到，但**只在加 `--fresh` 时**判不合格，
 *    否则只算提示（那是为"重新校验已入库批次"留的路，有道理）；
 *  · ★ **两个都还没入库的批次之间撞车 —— 它一个字都不会说。**
 *
 * 我写 `突发-02.json` 时就有两条 id（`e_cold_snap_extra` / `e_quilt_damp`）
 * 与 `突发-01.json` 撞了，而那次我**没加 `--fresh`** —— 于是校验报"全部合格"，
 * 一直到 `merge-content` 写完、`check-registry` 自检时才炸出来。
 * 那时的处境很别扭：表已经被写进去了一个重复 id，要先回滚再改。
 *
 * ## 它做什么
 *
 * 把 `content/` 下**全部**批次文件的 id 收在一起，按 `kind` 分组，
 * 报出任何重复 —— **包括与已经合并过的批次重复**（那些也算重复）。
 *
 * ⚠ 它与 `check-content.mjs` 是**互补**的，不是替代：
 * 那个管"一条内容本身合不合格"（字段、范围、选项净收益），
 * 这个只管"id 有没有撞"。两者都要跑。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, '..', 'content');

/** 递归找出全部批次文件（跳过 `_` 开头的草稿 —— 与 merge-content 同一条规矩） */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.json') && !e.startsWith('_')) out.push(p);
  }
  return out;
}

/** kind → id → 第一次出现的位置（文件 + 第几条） */
const seen = new Map();
const problems = [];
let files = 0;
let entries = 0;

for (const abs of walk(contentDir)) {
  let data;
  try {
    data = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    problems.push(`${relative(contentDir, abs)}：JSON 解析失败 —— ${err.message}`);
    continue;
  }
  files += 1;
  const kind = data.kind ?? '(缺 kind)';
  const list = Array.isArray(data.entries) ? data.entries : [];
  const byId = seen.get(kind) ?? new Map();
  seen.set(kind, byId);

  for (const [i, e] of list.entries()) {
    entries += 1;
    const id = e?.id;
    if (typeof id !== 'string') continue;
    const where = `${relative(contentDir, abs)} 第 ${i + 1} 条`;
    const prev = byId.get(id);
    if (prev) {
      problems.push(`${kind} · ${id} 撞车：\n      ${prev}\n      ${where}`);
    } else {
      byId.set(id, where);
    }
  }
}

/*
 * 报账。★ 也报"每个 kind 有多少条" —— 那一半是为了写 batchNote 时能对账：
 * 我这一批曾经在 batchNote 里写"23 条"，而实际只有 22 条，
 * 是**人手数错**，而那种错没有任何工具会报。
 */
console.log(`[check-batches] ${files} 个批次文件、${entries} 条内容`);
for (const [kind, byId] of [...seen.entries()].sort()) {
  console.log(`  ${kind.padEnd(12)} ${byId.size} 条`);
}

if (problems.length > 0) {
  console.error(`\n[check-batches] ★ ${problems.length} 处 id 撞车：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\n  撞车的两条会被同一个 id 查到，而 `findEntry` 只认第一个 —— 第二条永远拿不到。\n' +
      '  改法：换掉新那一条的 id（旧的那条可能已经被存档引用）。'
  );
  process.exit(1);
}
console.log('[check-batches] id 无撞车。');
