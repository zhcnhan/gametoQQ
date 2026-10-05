/**
 * 一次性探针：**116 场灾难，每一场都跑完一整局**（M4 W-01 的验收）。
 *
 * 用的是仓库里的夹具（`systems/walkthroughRun.ts` 的 `trialDisaster`）——
 * 与 `walkthrough.test.ts` 那一组样本**同一套代码**，只是把样本换成全量。
 * （测试里跑 10 场是因为那是"每次 npm test 都跑"的位置；全量几十秒，
 * 属于"加灾难时要跑一遍"的那一类。）
 *
 * 判据：走到结算 / 四维不越界 / `disasterId` 不中途被换。
 * "活满 14 天"只作观察 —— 灾难分 L1~L4，难度本来就该有差。
 */
import { DISASTER_DEFS, SURVIVAL_DAYS } from '../src/data/disaster';
import { trialDisaster } from '../src/systems/walkthroughRun';

const t0 = Date.now();
const rows = DISASTER_DEFS.map((d) => trialDisaster(d.id));
const broken = rows.filter((r) => r.problems.length > 0);
const survived = rows.filter((r) => r.survived);

console.log(`跑完 ${rows.length} 场（好档策略，每场一整局 7 + ${SURVIVAL_DAYS} 天）`);
console.log(`用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`\n══ 硬判据 ══`);
console.log(`走到结算：${rows.filter((r) => r.finished).length} / ${rows.length}`);
console.log(`四维/换灾难 等问题：${broken.length} 场`);
for (const b of broken) console.log(`  ✗ ${b.name}(${b.id}) —— ${b.problems.join('；')}`);

console.log(`\n══ 观察值（不是判据）══`);
console.log(`活满 14 天：${survived.length} / ${rows.length}`);
const byLevel = new Map<string, { n: number; ok: number }>();
for (const r of rows) {
  const e = byLevel.get(r.level) ?? { n: 0, ok: 0 };
  e.n += 1;
  if (r.survived) e.ok += 1;
  byLevel.set(r.level, e);
}
for (const [lvl, e] of [...byLevel.entries()].sort()) {
  console.log(`  ${lvl}：活满 ${e.ok} / ${e.n}`);
}
const died = rows.filter((r) => !r.survived).sort((a, b) => a.day - b.day);
console.log(`\n最早倒下的 10 场（同一套策略下）：`);
for (const r of died.slice(0, 10)) {
  console.log(`  D+${String(r.day).padStart(2)} ${r.name.padEnd(8)} ${r.level} 健康 ${r.stats.health} 心情 ${r.stats.mood} 体力 ${r.stats.stamina}`);
}
