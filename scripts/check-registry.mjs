/**
 * 注册表自检：对**已经编译进游戏的**内容表（`src/data/*.ts`）做运行期可达性与
 * 分层校验。
 *
 * ## 为什么它与 `check-content.mjs` 是两个脚本
 *
 * 它们看的东西**根本不同**（D-24 专门登记过这条，别混）：
 *
 * | | 看什么 | 什么时候 | 怎么读 |
 * | --- | --- | --- | --- |
 * | `check-content.mjs` | **正要入库的** JSON（`content/**`） | 内容进来之前 | 正则粗读，不 import TS |
 * | 本脚本 | **已经在册的** TS 表 | 每次 `npm run check` | 真的 import 注册表 |
 *
 * `check-content.mjs` 刻意用正则粗读（它要能被"刚加完内容的人"直接 `node` 跑，
 * 而且那时 TS 可能根本编译不过）；而"已经进来的内容到底能不能被玩家碰到"
 * 这件事只有**跑起来**才算得准 —— 所以要一个 `vite-node` 的脚本。
 *
 * ## 它抓的是哪一类问题
 *
 * **"写了但永远出不来"**（M2 的 D-16）。M3 第 1 步就真的抓到了一次：
 * `item-01` 交了 40 件主食与饮水，而 `shop-01` 的 `offers` 与 `boxes.ts` 的池子
 * **都只列着原来那 17 件** —— 于是那 40 件编译进了游戏、图鉴里有格子，
 * 而玩家一件也碰不到。那件事没有任何报错，只有这个检查能看见。
 *
 * 用法：`npm run check:registry`（已挂进 `npm run check`）
 */
import { SURVIVAL_DAYS } from '../src/data/disaster';
import { sameButL1, usedDimensions } from '../src/data/disasterDimensions';
import { countOfKind, entriesOfKind, unobtainableEntries } from '../src/data/registry';

const problems = [];
const notes = [];

// ——————————————————————————————————————————————————————————————
// ① 可达性：没有一件物资是"永远拿不到"的
// ——————————————————————————————————————————————————————————————

const deadItems = unobtainableEntries('item');
if (deadItems.length > 0) {
  problems.push(
    `有 ${deadItems.length} 件物资玩家一件也碰不到（不在任何点位的 offers 里，` +
      `也不在任何箱子的池子里）：${deadItems.map((e) => e.id).join('、')}\n` +
      '    → 它们编译进了游戏、图鉴里有格子，但没有任何来源。' +
      '要么加进某个点位的 offers，要么加进某个箱子的池子。'
  );
}

// ——————————————————————————————————————————————————————————————
// ② 分层：有 tier 概念的表，每一条都得写
// ——————————————————————————————————————————————————————————————

const TIERED = [
  'item',
  'disaster',
  'nightEvent',
  'dayEvent',
  'emergency',
  'helpRequest',
  'identity',
  'shop'
];
for (const kind of TIERED) {
  const missing = entriesOfKind(kind)
    .filter((e) => e.tier === undefined)
    .map((e) => e.id);
  if (missing.length > 0) {
    problems.push(`${kind} 表里有 ${missing.length} 条没写 tier：${missing.join('、')}`);
  }
  const bad = entriesOfKind(kind)
    .filter((e) => e.tier !== undefined && ![1, 2, 3, 4].includes(e.tier))
    .map((e) => `${e.id}=${e.tier}`);
  if (bad.length > 0) problems.push(`${kind} 表里有 tier 越界的条目：${bad.join('、')}`);
}

// ——————————————————————————————————————————————————————————————
// ③ 解锁阶梯：至少要有一场 tier 1 的灾难，否则新玩家开局没有可玩的
// ——————————————————————————————————————————————————————————————

const tier1Disasters = entriesOfKind('disaster').filter((e) => e.tier === 1);
if (tier1Disasters.length === 0) {
  problems.push('没有任何一场 tier 1 的灾难 —— 新玩家开局会无局可开');
}
const tier1Identities = entriesOfKind('identity').filter((e) => e.tier === 1);
if (tier1Identities.length < 2) {
  problems.push(
    `tier 1 的身份只有 ${tier1Identities.length} 个 —— §8 的开局是"三选一"，` +
      '至少要有 2 个可选（3 个更好）'
  );
}

// ——————————————————————————————————————————————————————————————
// ④ 标签：一个标签至少要有 3 件物资共用才有意义
//    （§10B.5 的原文：「同一个 tag 至少要有 3 件物资共用才有意义」）
// ——————————————————————————————————————————————————————————————

const tagOwners = new Map();
for (const entry of entriesOfKind('item')) {
  for (const tag of entry.tags) tagOwners.set(tag, (tagOwners.get(tag) ?? 0) + 1);
}
const lonely = [...tagOwners.entries()].filter(([, n]) => n < 3).map(([tag, n]) => `${tag}(${n})`);
if (lonely.length > 0) {
  // 提示而不是不合格：孤标签不破坏任何规则，但它说明"这个 tag 是给谁用的"没有答案
  notes.push(
    `只有 1~2 件物资共用的标签：${lonely.join('、')} —— ` +
      '标签是给玩家写分区规则用的，孤标签等于一个只有他自己能懂的词'
  );
}

// ——————————————————————————————————————————————————————————————
// ⑤ ★ 维度签名：机械地判"换皮"（§10B.3.1）
// ——————————————————————————————————————————————————————————————

/**
 * §10B.3.1 的机械验收办法：
 *
 * > 把全部灾难按 17 个维度各自的取值排成矩阵，
 * > **任意两场灾难如果只在前 4 个维度上不同，就必须合并或重写。**
 *
 * ★ 其中"外界温度"那一维（第 4 维）只算表现，所以它**不参与**下面两道判据
 * （决策 C）。判据本身住在 `src/data/disasterDimensions.ts`，这里只是调用点 ——
 * 剔除规则与门槛都不该在这一份里再写一遍（§2.19 的形状）。
 *
 * ## 为什么这条校验必须在"已经在册的灾难"上跑，而不只是在待入库的 JSON 上
 *
 * 换皮是**成对**的性质：单独看一场永远看不出问题（每一场单看都合理），
 * 只有把它和**已有的那几场**放在一起比才显形。所以它只能在这里跑 ——
 * 只有这里才有完整的灾难表。
 *
 * ## 它同时校验"声称的层级"
 *
 * `level: 'L3'` 意味着"这一场动的是玩法"（§10B.3.1 的实施分层），
 * 而只用了 4 个维度的一场显然做不到那件事。所以声称 L2/L3/L4 的场次
 * 必须真的用够维度 —— 否则那个字段就是一句自夸。
 *
 * ★ 门槛在决策 C 之后**各降 1**（L1 4→3、L4 15→14），因为第 4 维（外界温度）
 * 从此不算"用到"；而它是类型必填的，所以在此之前每一场都白送一维 ——
 * 门槛里其实一直含着那一维。降 1 之后门槛说的才是**真的机制维度数**。
 */
const disasterDefs = entriesOfKind('disaster')
  .map((e) => e.raw)
  .filter(Boolean);

const MIN_DIMS = { L1: 3, L2: 6, L3: 10, L4: 14 };

console.log(`[check-registry] 灾难维度签名（${disasterDefs.length} 场）：`);
for (const def of disasterDefs) {
  const used = usedDimensions(def);
  const need = MIN_DIMS[def.level] ?? 0;
  console.log(
    `  ${used.length >= need ? '✓' : '·'} ${String(def.name).padEnd(6)} ${String(def.family ?? '?').padEnd(4)} ${def.level} ` +
      `用到 ${String(used.length).padStart(2)} 维（要求 ≥${need}）：${used.join('/')}`
  );
}
console.log('');

// 逐对比较：只在前 4 维不同 → 不合格
for (let i = 0; i < disasterDefs.length; i++) {
  for (let j = i + 1; j < disasterDefs.length; j++) {
    const problem = sameButL1(disasterDefs[i], disasterDefs[j]);
    if (problem) problems.push(problem);
  }
}

// 声称的层级与实际的维度数必须对得上
for (const def of disasterDefs) {
  const need = MIN_DIMS[def.level] ?? 0;
  const used = usedDimensions(def);
  if (used.length < need) {
    problems.push(
      `「${def.name}」声称 ${def.level}（至少要用到 ${need} 个维度），实际只用到 ${used.length} 个：` +
        `${used.join('/')} —— 声称的层级与场地不符`
    );
  }
}

// ——————————————————————————————————————————————————————————————
// ⑤.5 ★ 事件池权重必须真的挂得上（否则维度 11 是装饰）
// ——————————————————————————————————————————————————————————————

/**
 * 维度 11（`eventPoolWeights`）靠**标签**匹配事件（见 `systems/shop.ts` 的
 * `rollDayEvent`）。所以一条权重如果指向一个**没有任何事件带着的标签**，
 * 它算得再准也不会生效 —— 而"用了这一维"在维度签名里照样算数
 * （签名看的是"有没有值"，不是"有没有用"）。
 *
 * 这正是"静默失效"的典型形状：内容看起来对（那一场确实写了 `water: 3`），
 * 玩起来没变（水的权重一直是 1）。**签名查不出这一类，所以要有这一道。**
 *
 * ★ 这道守卫上线时抓到 10 处：全项目 17 条权重里，
 * 只有 5 个标签（`people` / `panic` / `supply` / `limit` / `market` / `queue`）
 * 真的存在于事件上，而 `cold` / `heat` / `water` / `dark` / `neighbor`
 * **一条事件都没带** —— 于是"热浪多碰上热的事"这件事从来没有发生过。
 */
const eventTags = new Set();
const eventIds = new Set();
for (const kind of ['dayEvent', 'nightEvent']) {
  for (const entry of entriesOfKind(kind)) {
    eventIds.add(entry.id);
    for (const tag of entry.tags) eventTags.add(tag);
  }
}
console.log(`[check-registry] 事件标签（维度 11 只能挂在这些上）：${[...eventTags].sort().join(' / ') || '（一个都没有）'}`);

const danglingWeights = [];
for (const def of disasterDefs) {
  for (const [tag, value] of Object.entries(def.eventPoolWeights ?? {})) {
    if (value === 1) continue; // 中性值不算"用了这一维"
    if (eventTags.has(tag) || eventIds.has(tag)) continue;
    danglingWeights.push(`「${def.name}」的 eventPoolWeights.${tag} = ${value}`);
  }
}
if (danglingWeights.length > 0) {
  problems.push(
    `有 ${danglingWeights.length} 条事件池权重挂在空处（写了但不会有任何事件因此变多）：\n      ` +
      danglingWeights.join('\n      ') +
      '\n    → 要么给相关事件补上那个 tag，要么把这一条改成已有标签之一'
  );
}

// ——————————————————————————————————————————————————————————————
// ⑥ 内容量盘点（给 §10B.6 的产能口径对账）
// ——————————————————————————————————————————————————————————————

const TARGETS = [
  { kind: 'item', label: '物资', now: countOfKind('item'), goal: '120~200' },
  { kind: 'nightEvent', label: '夜间事件', now: countOfKind('nightEvent'), goal: '60~100' },
  { kind: 'dayEvent', label: '白天事件', now: countOfKind('dayEvent'), goal: '60~100' },
  { kind: 'emergency', label: '突发事件', now: countOfKind('emergency'), goal: '60~100' },
  { kind: 'disaster', label: '灾难', now: countOfKind('disaster'), goal: '112~116' },
  { kind: 'identity', label: '身份', now: countOfKind('identity'), goal: '10~16' },
  { kind: 'helpRequest', label: '求援订单', now: countOfKind('helpRequest'), goal: '30~50' },
  { kind: 'shop', label: '点位', now: countOfKind('shop'), goal: '8~14' }
];

console.log(`[check-registry] 内容量（§10B.6 的口径，生存期 ${SURVIVAL_DAYS} 天）：`);
for (const t of TARGETS) {
  const [lo] = t.goal.split('~').map(Number);
  const mark = t.now >= (lo ?? 0) ? '✓' : '·';
  console.log(`  ${mark} ${t.label.padEnd(6)} ${String(t.now).padStart(4)} / ${t.goal}`);
}

if (notes.length > 0) {
  console.log('');
  for (const n of notes) console.log(`[提示] ${n}`);
}

if (problems.length > 0) {
  console.error(`\n[check-registry] ★ ${problems.length} 处不合格：\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n[check-registry] 全部合格');
