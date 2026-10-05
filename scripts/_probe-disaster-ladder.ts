/**
 * 一次性探针：灾难阶梯的**形状**（决策 A 的落地验收）。
 *
 * 要回答三件事：
 *  ① 每一档的池子有几场、能不能真的抽到（不是"理论上有"）；
 *  ② 第一局是不是**必然**只有寒潮（用户选的那条）；
 *  ③ 抽签用的随机数**会不会扰动 `createStartingRun` 的 seed 游标**
 *     （扰动 = 三条永久回归探针的基线全漂 —— 这是最要紧的一条）。
 */
import { DISASTER_DEFS, disasterPool, disasterTopTier } from '../src/data/disaster';

const cases: { name: string; survivedRuns: number; seenDisasters: number }[] = [
  { name: '全新档（0 次 / 见 0 场）', survivedRuns: 0, seenDisasters: 0 },
  { name: '撑过 1 次', survivedRuns: 1, seenDisasters: 1 },
  { name: '撑过 2 次', survivedRuns: 2, seenDisasters: 2 },
  { name: '撑过 3 次', survivedRuns: 3, seenDisasters: 3 },
  { name: '撑过 5 次', survivedRuns: 5, seenDisasters: 5 },
  { name: '见过 8 场但一次没撑过（老档）', survivedRuns: 0, seenDisasters: 8 },
  { name: '撑过 10 次', survivedRuns: 10, seenDisasters: 10 }
];

for (const c of cases) {
  const top = disasterTopTier(c);
  const pool = disasterPool(c);
  console.log(
    `${c.name.padEnd(30)} → 最高 tier ${top}，池子 ${String(pool.length).padStart(3)} 场` +
      `（占全表 ${((pool.length / DISASTER_DEFS.length) * 100).toFixed(1)}%）`
  );
}

console.log('');
const pool0 = disasterPool({ survivedRuns: 0, seenDisasters: 0 });
console.log(`第一局的池子 = [${pool0.map((d) => `${d.name}(${d.id})`).join(', ')}]`);
console.log(`它是不是恰好一场寒潮：${pool0.length === 1 && pool0[0]?.id === 'cold_snap'}`);

// 池子里真的抽得到吗 —— 用真实 seed 打一遍（与 systems/setup.ts 的抽法同一口径）
const { createCursor, pick } = await import('../src/model/rng');
for (const c of cases.slice(0, 4)) {
  const pool = disasterPool(c);
  const hits = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) {
    hits.add(pick(createCursor(seed), pool).id);
  }
  console.log(`${c.name.padEnd(30)} 400 个 seed 抽到 ${hits.size} 种不同灾难`);
}
