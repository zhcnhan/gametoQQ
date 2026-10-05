/**
 * 一次性探针：决策 C（外界温度那维只算表现）的**影响面**。
 *
 * 要回答：把第 4 维从"用到几维"里摘出去之后，
 *  ① 116 场各自少算几维；
 *  ② 有没有场次会跌破它自己声称的层级门槛（L1≥4 / L2≥6 / L3≥10 / L4≥15）；
 *  ③ "只在前 4 维不同"那一对会不会因此冒出来（摘掉温度后新增的不合格对）。
 */
import { DISASTER_DEFS } from '../src/data/disaster';
import { DISASTER_DIMENSIONS, usedDimensions, sameButL1 } from '../src/data/disasterDimensions';

const MIN_DIMS: Record<string, number> = { L1: 4, L2: 6, L3: 10, L4: 15 };
const without4 = (def: (typeof DISASTER_DEFS)[number]): number[] =>
  usedDimensions(def).filter((no) => no !== 4);

const byLevel = new Map<string, number[]>();
const broken: string[] = [];
for (const d of DISASTER_DEFS) {
  const all = usedDimensions(d);
  const wo = without4(d);
  const arr = byLevel.get(d.level) ?? [];
  arr.push(wo.length);
  byLevel.set(d.level, arr);
  if (wo.length < (MIN_DIMS[d.level] ?? 0)) {
    broken.push(`${d.name}(${d.level}) ${all.length}→${wo.length} 需要≥${MIN_DIMS[d.level]}`);
  }
}

for (const [lvl, arr] of [...byLevel.entries()].sort()) {
  arr.sort((a, b) => a - b);
  console.log(`${lvl}: n=${arr.length} min=${arr[0]} max=${arr[arr.length - 1]} 门槛=${MIN_DIMS[lvl]}`);
}
console.log(`跌破门槛的场次：${broken.length}`);
for (const b of broken) console.log('  ' + b);

// 单独看温度那一维：有没有哪一场的温度表其实是空的（那才算"真没写"）
const emptyTemp = DISASTER_DEFS.filter((d) => !d.temperatures || Object.keys(d.temperatures).length === 0);
console.log(`temperatures 为空的场次：${emptyTemp.length}`);

// 摘掉温度之后，"只在前 4 维不同"的对子新增了吗
const L1_NO = DISASTER_DIMENSIONS.filter((x) => x.tier === 'L1').map((x) => x.no);
console.log(`L1 维编号 = ${L1_NO.join('/')}`);
let pairsBefore = 0;
let pairsAfter = 0;
const samples: string[] = [];
for (let i = 0; i < DISASTER_DEFS.length; i++) {
  for (let j = i + 1; j < DISASTER_DEFS.length; j++) {
    const a = DISASTER_DEFS[i]!;
    const b = DISASTER_DEFS[j]!;
    if (sameButL1(a, b)) pairsBefore++;
    const differs = DISASTER_DIMENSIONS.filter(
      (dim) => dim.no !== 4 && dim.read(a) !== dim.read(b)
    ).map((dim) => dim.no);
    const beyond = differs.filter((no) => !L1_NO.includes(no));
    if (differs.length > 0 && beyond.length === 0) {
      pairsAfter++;
      if (samples.length < 5) samples.push(`${a.name} × ${b.name}（差在第 ${differs.join('/')} 维）`);
    }
  }
}
console.log(`现有判据判出的不合格对 = ${pairsBefore}`);
console.log(`摘掉第 4 维之后的不合格对 = ${pairsAfter}`);
for (const s of samples) console.log('  ' + s);
