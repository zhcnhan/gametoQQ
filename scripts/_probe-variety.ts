/**
 * 一次性取证：**116 场灾难到底有没有差别**，逐维度数一遍（用户 2026-10 的疑问）。
 *
 * 用户问的两件事：
 *  ① "每个灾难真的主要需求的物品都会有差别吗" —— 数 `dailyDrain` 与 `priorityCategories`
 *     各有多少种取值（**去重之后的种类数**才是"玩家感觉到的不同"）；
 *  ② "各个灾难没有让我感觉到不同，同质性太强烈了" ——
 *     如果 116 场只落在少数几种取值上，那他的感觉是**对的**，
 *     而且根因不是"数值太小"，是"**组合太少**"。
 *
 * 判据：把每一维的去重取值列出来。**种类数 = 1 的维度，玩家永远感觉不到它。**
 */
import { DISASTER_DEFS, disasterModifiersOf } from '../src/data/disaster';

const key = (v: unknown): string => JSON.stringify(v);

const dims: { name: string; of: (d: (typeof DISASTER_DEFS)[number]) => unknown }[] = [
  { name: '日耗 dailyDrain', of: (d) => d.dailyDrain ?? {} },
  { name: '刚需 priorityCategories', of: (d) => [...(d.priorityCategories ?? [])].sort() },
  { name: '腐坏 spoilRate', of: (d) => d.spoilRate },
  { name: '空间 capacityFactor', of: (d) => disasterModifiersOf(d.id).capacityFactor },
  { name: '摘块 unusableShelfIds', of: (d) => [...(d.unusableShelfIds ?? [])].sort() },
  { name: '行动点 actionPointDelta', of: (d) => disasterModifiersOf(d.id).actionPointDelta },
  { name: '搬运 carryFactor', of: (d) => disasterModifiersOf(d.id).carryFactor },
  { name: '休息 restEfficiency', of: (d) => disasterModifiersOf(d.id).restEfficiency },
  { name: '物价 priceSurcharge', of: (d) => disasterModifiersOf(d.id).priceSurcharge },
  { name: 'NPC npcVisitFactor', of: (d) => disasterModifiersOf(d.id).npcVisitFactor },
  { name: '健康债 healthRiskPerDay', of: (d) => disasterModifiersOf(d.id).healthRiskPerDay },
  { name: '品类效率 categoryEfficiency', of: (d) => d.categoryEfficiency ?? {} },
  { name: '事件池 eventPoolWeights', of: (d) => d.eventPoolWeights ?? {} },
  { name: '温度曲线 temperatures', of: (d) => JSON.stringify(d.temperatures ?? {}) },
  { name: '窗口文案 windowScene', of: (d) => d.windowScene ?? '' },
  { name: 'family', of: (d) => d.family },
  { name: 'level', of: (d) => d.level },
  { name: 'tier', of: (d) => d.tier }
];

console.log(`全表 ${DISASTER_DEFS.length} 场\n`);
const single: string[] = [];
for (const dim of dims) {
  const values = new Map<string, number>();
  for (const d of DISASTER_DEFS) {
    const k = key(dim.of(d));
    values.set(k, (values.get(k) ?? 0) + 1);
  }
  const kinds = values.size;
  const top = [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const mark = kinds === 1 ? ' ★玩家永远感觉不到' : kinds <= 4 ? ' ← 种类很少' : '';
  console.log(
    `${dim.name.padEnd(26)} ${String(kinds).padStart(3)} 种${mark}\n` +
      `      最常见：${top.map(([k, n]) => `${k.slice(0, 60)}×${n}`).join('  ')}`
  );
  if (kinds === 1) single.push(dim.name);
}

console.log(`\n只有一种取值的维度：${single.length > 0 ? single.join(' / ') : '（无）'}`);

// 日耗那几种取值具体是什么
console.log('\n══ 日耗的全部取值 ══');
const drains = new Map<string, string[]>();
for (const d of DISASTER_DEFS) {
  const k = key(
    Object.entries(d.dailyDrain ?? {})
      .sort()
      .map(([c, n]) => `${c}:${n}`)
      .join(',')
  );
  const list = drains.get(k) ?? [];
  list.push(d.name);
  drains.set(k, list);
}
for (const [k, names] of [...drains.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k.padEnd(34)} ×${String(names.length).padStart(3)} 场  ${names.slice(0, 6).join('/')}${names.length > 6 ? '…' : ''}`);
}

console.log('\n══ 刚需的全部取值 ══');
const prio = new Map<string, string[]>();
for (const d of DISASTER_DEFS) {
  const k = [...(d.priorityCategories ?? [])].sort().join(',');
  const list = prio.get(k) ?? [];
  list.push(d.name);
  prio.set(k, list);
}
for (const [k, names] of [...prio.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k.padEnd(30)} ×${String(names.length).padStart(3)} 场  ${names.slice(0, 6).join('/')}${names.length > 6 ? '…' : ''}`);
}
