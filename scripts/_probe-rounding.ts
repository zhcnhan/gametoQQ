/** 一次性诊断：取整从 round 改成 floor 之后，**到底哪几场的结果变了**。 */
import { DISASTER_DEFS } from '../src/data/disaster';
import { furnitureDefOf } from '../src/data/furniture';

const full = furnitureDefOf('shelf').h; // 4 排
const changed: string[] = [];
const table: string[] = [];
for (const d of DISASTER_DEFS) {
  const f = d.capacityFactor;
  if (typeof f !== 'number' || f >= 1) continue;
  const r = Math.max(1, Math.round(full * f));
  const fl = Math.max(1, Math.floor(full * f));
  table.push(`${f.toFixed(2)} → round ${r} / floor ${fl}${r === fl ? '' : '   ← 变了'}`);
  if (r !== fl) changed.push(`${d.name}(${f})`);
}
console.log('全部乘数的取整对照：');
for (const t of [...new Set(table)].sort()) console.log('  ' + t);
console.log(`\n结果变了的场次 = ${changed.length}：${changed.join(' / ')}`);
console.log(`（全表写了 capacityFactor 的场次 = ${table.length}）`);
