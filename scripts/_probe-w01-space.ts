/**
 * 一次性探针：**灾难的空间维度从"没生效"到"生效"**（W-01 的实测，纪律 §4A.2）。
 *
 * 要量三件事，都要数字：
 *  ① 一场灾难对"开局可用格子"到底影响多大（用真实函数铺一遍再数，不看字段）；
 *  ② 116 场里有几场真的有空间代价、最狠的几场少几格；
 *  ③ ★ 三条永久回归探针的基线有没有漂（好档最低体力 / 乱档倒下的那天）——
 *     这条最要紧：抽签走**自己的 RNG 流**就是为了不动它，而"我以为没动"
 *     必须由实测量出来（§4A.4：诊断先于猜测）。
 */
import { DISASTER_DEFS, SURVIVAL_DAYS } from '../src/data/disaster';
import { CATEGORY_ORDER } from '../src/data/items';
import { createCursor } from '../src/model/rng';
import { makeStack, setSlotStack, ROOM_ID, SHELF_H, SHELF_W } from '../src/model/shelf';
import { createSaveGame } from '../src/state/save';
import { GameStore } from '../src/state/store';
import { createStartingRun, createStartingShelves } from '../src/systems/setup';
import { settleSurvivalDay } from '../src/systems/survival';
import type { RunState } from '../src/model/types';

// ———————— ① 一场灾难对"可用格子"的影响 ————————
/** 这一场开局真的有几个格子（用真实函数铺一遍再数，而不是看字段） */
function usableSlots(disasterId: string): number {
  return createStartingShelves(ROOM_ID, disasterId).reduce((n, s) => n + s.w * s.h, 0);
}

const BASELINE = usableSlots('cold_snap');
console.log(`寒潮（L1 教学关）开局可用格 = ${BASELINE}（3 块 × ${SHELF_W}×${SHELF_H}）`);

let withCost = 0;
let totalLost = 0;
const worst: { name: string; slots: number; block: number }[] = [];
for (const d of DISASTER_DEFS) {
  const shelves = createStartingShelves(ROOM_ID, d.id);
  const slots = shelves.reduce((n, s) => n + s.w * s.h, 0);
  if (slots < BASELINE) {
    withCost += 1;
    totalLost += BASELINE - slots;
    worst.push({ name: d.name, slots, block: shelves.length });
  }
}
worst.sort((a, b) => a.slots - b.slots);
console.log(`有空间代价的场次 = ${withCost} / ${DISASTER_DEFS.length}`);
console.log(
  `平均少掉 = ${(totalLost / withCost).toFixed(1)} 格（占寒潮开局的 ${((totalLost / withCost / BASELINE) * 100).toFixed(1)}%）`
);
console.log(`最狠的 5 场 = ${worst.slice(0, 5).map((w) => `${w.name}→${w.slots}格/${w.block}块`).join(' / ')}`);
const onlyBlock = worst.filter((w) => w.slots === BASELINE - SHELF_W * SHELF_H);
console.log(`少掉**整整一块**的场次 = ${onlyBlock.length}（例：${onlyBlock.slice(0, 4).map((w) => w.name).join('/')}）`);

// ———————— ③ 三条永久回归探针的基线 ————————
console.log('');
const noop = { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };

/** 与 `survival.test.ts` 的 `bareRun` 同一口径：清空箱子与货架，游标按回原种子 */
function bareRun(seed: number): RunState {
  const run = createStartingRun(seed);
  run.boxesToUnpack = [];
  run.seed = seed;
  run.shelves = run.shelves.map((s) => ({
    ...s,
    slots: s.slots.map((row) => row.map(() => ({ stack: null })))
  }));
  return run;
}

/** 备足 N 天口粮（主食 / 饮水 / 燃料各 2 件一天），一格一栈地铺 */
function stockFor(run: RunState, days: number): void {
  const cursors = run.shelves.map((shelf) => ({ shelf, at: 0 }));
  const nextSlot = () => {
    for (const c of cursors) {
      if (c.at < c.shelf.w * c.shelf.h) {
        const pos = { row: Math.floor(c.at / c.shelf.w), col: c.at % c.shelf.w };
        c.at += 1;
        return { shelfId: c.shelf.id, pos };
      }
    }
    throw new Error('放不下');
  };
  for (const itemId of ['canned_beans', 'mineral_water', 'fuel_can']) {
    let left = days * 2;
    while (left > 0) {
      const slot = nextSlot();
      const idx = run.shelves.findIndex((s) => s.id === slot.shelfId);
      const shelf = run.shelves[idx]!;
      const take = Math.min(left, 3);
      run.shelves[idx] = setSlotStack(shelf, slot.pos, makeStack(itemId, take, null));
      left -= take;
    }
  }
}

/** 把屋子整理好（全收胶带 + 顺手位） */
function tidyUp(run: RunState): void {
  run.zones = [{ id: 'zone_all', name: '全收', color: '#000000', autoAccept: { categories: [...CATEGORY_ORDER] } }];
  run.shelves = run.shelves.map((s, i) => ({
    ...s,
    zoneIds: s.zoneIds.map(() => 'zone_all'),
    handyRank: i === 0 ? 1 : null
  }));
}

function trial(seed: number, tidy: boolean, fixDay: number | null) {
  const run = bareRun(seed);
  stockFor(run, SURVIVAL_DAYS + 1);
  if (tidy) tidyUp(run);
  run.phase = 'survival_day';
  run.day = 0;
  const store = new GameStore(createSaveGame(run), noop);
  const cursor = createCursor(run.seed);
  for (let day = 1; day <= SURVIVAL_DAYS; day++) {
    if (fixDay !== null && day === fixDay) store.commit((draft) => tidyUp(draft));
    store.run.day = day;
    settleSurvivalDay(store.run, cursor);
    if (store.run.stats.health <= 0) {
      return { alive: false, day, minStamina: store.run.survival.minStamina };
    }
  }
  return { alive: true, day: SURVIVAL_DAYS, minStamina: store.run.survival.minStamina };
}

for (const [label, tidy, fixDay] of [
  ['好档（全上架+胶带+顺手位）', true, null],
  ['乱档（什么都没有）', false, null],
  ['乱档 D+2 补救', false, 2]
] as const) {
  const out = trial(20261001, tidy, fixDay);
  console.log(
    `${label.padEnd(26)} → ${out.alive ? `活满 ${SURVIVAL_DAYS} 天` : `D+${out.day} 倒下`}，最低体力 ${out.minStamina}`
  );
}
