/**
 * 核对"外部交付的那批内容"是否已经全部进仓库。
 *
 * ## 它是干什么用的
 *
 * 每收到一批外部内容（生成方交回、或从别处捡来的 json），都用它过一遍：
 *
 *  · **入库后**：确认**一条都没丢**，且差异只来自本项目明确做过的修订；
 *  · 入库前：也能用它确认这批的 id 与仓库现有的不冲突。
 *
 * 用法：把交付目录填进下面的 `DELIVERED_ROOT`，然后
 * `node scripts/check-content-coverage.mjs`。
 *
 * ## ★ 为什么按 id 在全库找，而不是按文件对文件比
 *
 * 第一版就是按文件对的，而灾难已经按家族重排了
 * （`disaster-00.json` 里的热浪搬去了 `disaster-温度.json`），
 * 于是它报"丢了 heat_wave / blackout_winter" —— 而那两条好好地在别的文件里。
 * **文件怎么组织是会变的，id 不会**，所以判据要挂在 id 上。
 *
 * ## 判据
 *
 *  ① 交付件的每一个 id，必须在仓库全库（所有文件加起来）里找得到；
 *  ② 每个 id 的字段差异必须落在 `KNOWN` 列出的那几类修订里（**每一类都写了理由**）；
 *  ③ 仓库里多出来的 id（自己写的内容、后续批次）不算问题。
 *
 * ⚠ `KNOWN` 的正则匹配的是 diff 返回的 `路径: 旧值 → 新值`，
 * 所以每个模式都要覆盖"路径后面跟冒号 / 中括号"这几种收尾。
 * 这个匹配口径我改了三次，每次的症状都是"脚本报异常，而异常其实是已知修订"——
 * **校验脚本自己的口径写错时，它的输出看起来完全正常。**
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 外部交付件的根目录（这次是外援放在桌面的那份；以后换成新交付的目录） */
const DELIVERED_ROOT = 'C:/Users/29942/Desktop/M3生成/设定JSON';
const DESKTOP = DELIVERED_ROOT;

/** 桌面那份：{ id → 条目 } */
const delivered = new Map();
const desktopFiles = [];
for (const dir of ['物资', '事件', '身份与商店', '灾难']) {
  const d = `${DESKTOP}/${dir}`;
  for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(d, f), 'utf8'));
    desktopFiles.push(`${dir}/${f}`);
    for (const e of data.entries ?? []) delivered.set(e.id, { ...e, __from: `${dir}/${f}` });
  }
}

/** 仓库那份：{ id → 条目 }（全库，跨文件） */
const repo = new Map();
for (const dir of ['物资', '事件', '身份与商店', '灾难']) {
  const d = join('content', dir);
  for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(d, f), 'utf8'));
    for (const e of data.entries ?? []) repo.set(e.id, { ...e, __from: `${dir}/${f}` });
  }
}

/** 递归收集差异路径 */
function diff(a, b, path = '', out = []) {
  if (out.length > 40) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: 数组长度 ${a.length} → ${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diff(a[k], b[k], path ? `${path}.${k}` : k, out);
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  return out;
}

/**
 * 这些差异属于**我在这次会话里明确做过的修订**，逐类给出理由。
 *
 * ★ 匹配的是 diff 返回的字符串，形状是
 *   `路径: 旧值 → 新值`（例：`tags: undefined → ["queue"]`、`offers :: LEN`）
 *   —— 所以每个模式都要覆盖"路径后面跟冒号/空格/中括号"这几种收尾。
 *
 * ★ 这个脚本的匹配口径我改了三次，每次都是"脚本报异常、而异常其实是已知修订"：
 *   ① 按文件对文件比 → 灾难按家族重排后误报"丢了 heat_wave"；
 *   ② `^tags$` → 整行里的 `tags:` 匹配不上，48 处已知修订全被报成异常；
 *   ③ 第三次才发现路径带 `: ` 分隔符。
 *   **校验脚本自己的口径写错时，它的输出看起来完全正常** ——
 *   今天这个坑（第三类静默失效）在 check-content 的引号、我那个计数正则上各踩过一次。
 */
const KNOWN = [
  [/^__from[: ]/, '文件按家族/类型重排'],
  [/^tags[:[]/, '事件补 tags（让灾难的 eventPoolWeights 挂得上）'],
  [/^tier[: ]/, '身份分批（§10B.3：把 9 个 tier1 改成 3 个开局可选）'],
  [/^batchNote[: ]/, '按家族/类型重写批次说明'],
  [/^(entries\[\d+\]\.)?tagline[: ]/, '护士人设句：清掉「硬扛」这个词'],
  [/^outcome[: ]/, '文案与效果对齐（day-02 的 6 处）'],
  [/^effect\.shelter[: ]/, '删掉白天没有的 shelter 字段'],
  [/^offers[:[]/, '点位扩充货架（40 件新物资要有地方卖）']
];

const unknown = [];
const missing = [];
for (const [id, a] of delivered) {
  const b = repo.get(id);
  if (!b) {
    missing.push(`${id}（来自 ${a.__from}）`);
    continue;
  }
  // 去掉 __from 再比（它是脚本加的）
  const strip = ({ __from, ...rest }) => rest;
  for (const d of diff(strip(a), strip(b))) {
    if (KNOWN.some(([re]) => re.test(d))) continue;
    unknown.push(`${id}: ${d}`);
  }
}

console.log(`桌面交付：${desktopFiles.length} 个文件、${delivered.size} 条`);
console.log(`仓库现状：${repo.size} 条（多出的 ${repo.size - delivered.size} 条是我写的标杆 + 后续批次）`);
console.log('');
console.log(`桌面有、仓库找不到的：${missing.length === 0 ? '（无）' : missing.join(', ')}`);
console.log(`非预期差异：${unknown.length} 处`);
for (const u of unknown.slice(0, 15)) console.log('  ⚠ ' + u.slice(0, 140));
if (unknown.length > 15) console.log(`  … 还有 ${unknown.length - 15} 处`);

console.log(
  missing.length === 0 && unknown.length === 0
    ? '\n✅ 桌面那份的每一条都在仓库里，且差异全部落在我明确改过的几类里 —— 仓库是它的超集，可以安全删除'
    : '\n❌ 先查清上面那些再决定删不删'
);
