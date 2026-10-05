/**
 * 开局装配（纯逻辑，禁止 DOM）。
 *
 * M1 起本文件只负责两件事：
 *  1. "一局开始时长什么样"—— 一间房 + 3 货架 + 3 箱刚送到的货（`createStartingRun` 停在 prologue）；
 *  2. 物资的随机生成原语 —— 箱内内容与批次到期日，供采购系统复用（同一个 seed 开出同一箱）。
 * 身份 / 灾难 / 日历 / 每日库存都不在这里，它们在 data/ 与 systems/phases.ts。
 */
import { BOX_DEFS, type BoxDef } from '../data/boxes';
import {
  FIRST_STOCKPILE_DAY,
  M1_DISASTER_ID,
  disasterModifiersOf,
  disasterPool,
  hasDisasterDef,
  type DisasterProgress
} from '../data/disaster';
import { furnitureDefOf } from '../data/furniture';
import { getItemDef } from '../data/items';
import { EMPTY_SURVIVAL_SNAPSHOT, NEVER_TRADED } from '../data/survival';
import { createCursor, nextFloat, nextInt, pick, randomSeed, shuffle, type RngCursor } from '../model/rng';
import { createShelf, makeStack, nextShelfId, ROOM_ID, SHELF_H, SHELF_W } from '../model/shelf';
import type { EventHistory, ItemStack, RunState, Shelf, UnpackBox } from '../model/types';

export const STARTING_SHELF_COUNT = 3;
/** 事件近期记录留几条（与 `EVENT_HISTORY_KEEP` 同值，这里再导一次方便 data 层引用） */
const KEEP = 4;
export const STARTING_BOX_COUNT = 3;
export const SHELF_IDS = ['shelf_a', 'shelf_b', 'shelf_c'] as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  这一局抽到哪一场灾难（M4 决策 A 的落地 / 工单 W-01）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 抽签**不碰 run 的 seed 游标**（这条是硬约束，不是风格问题）
 *
 * 用的是同一个 `seed`，但开一条**自己的游标**（`createCursor(seed)` 之后就丢）。
 * 于是抽签既确定（同 seed 同结果）、又与 `run.seed` 那条主序列**完全无关**。
 *
 * 为什么非要这样：`run.seed` 的游标位置是三条永久回归探针的基线
 * （好档活满 14 天 / 乱档 D+10 倒 / D+2 补救能活）。只要抽签多消耗一次随机数，
 * 探针里每一次后续随机都换一条序列 —— 曲线整体漂移，而**原因看不出来**
 * （§4.4 那条"探针的输入必须与内容量无关"，我在这里是提前躲开的）。
 *
 * ## 池子按 tier 阶梯放量（用户 2026-10 拍板的那条）
 *
 * 见 `data/disaster.ts` 的 `DISASTER_TIER_GATES`。一句话：第一局必然是寒潮
 * （阶梯第一档只有它），之后撑得越久、见过得越多，池子越大。
 *
 * @param progress 跨局账本里那两个数（撑过几次 / 见过几场）
 * @param seed 这一局的种子 —— 与 `RunState.seed` 同一个数
 */
export function rollDisasterId(progress: DisasterProgress, seed: number): string {
  const pool = disasterPool(progress);
  // 池子永远非空（tier 1 那一档就是寒潮），但兜底一下：一个空池子会让开局抛异常，
  // 而"抽不到灾难"不该是一种能崩掉开局的失败
  if (pool.length === 0) return M1_DISASTER_ID;
  // ★ 自己的流：`createCursor` + 一次 `pick`，用完即弃，不写回任何地方
  return pick(createCursor(seed >>> 0), pool).id;
}

/** `MetaProfile` 里抽签要读的那两个数（收成一个结构，见 `DisasterProgress`） */
export function disasterProgressOf(meta: { survivedRuns?: number; codex?: { disasters?: readonly string[] } }): DisasterProgress {
  const runs = meta.survivedRuns;
  const seen = meta.codex?.disasters?.length;
  return {
    survivedRuns: typeof runs === 'number' && Number.isFinite(runs) && runs > 0 ? Math.floor(runs) : 0,
    seenDisasters: typeof seen === 'number' && Number.isFinite(seen) && seen > 0 ? Math.floor(seen) : 0
  };
}

/**
 * 开新局用的那一对：**先定种子，再按阶梯抽灾难**。
 *
 * 它存在的理由是顺序：`rollDisasterId` 要读 seed，而 `createStartingRun`
 * 的默认 seed 是当场现摇的（`randomSeed()`）。两处各写一遍"先摇种子"
 * 迟早会出现"界面显示的那一场"与"真的铺进房间的那一场"不是同一场 ——
 * 而那正是 W-01 要修掉的那种静默错位。所以收成一个函数，调用方只拿结果。
 */
export function newRunWithDisaster(meta: {
  survivedRuns?: number;
  codex?: { disasters?: readonly string[] };
}): RunState {
  const seed = randomSeed();
  return createStartingRun(seed, { disasterId: rollDisasterId(disasterProgressOf(meta), seed) });
}


/**
 * 开局的家具。
 *
 * ★ 冰箱从 M3 第 6 步起**真的有玩法效果了**（D-02 已清偿）：腐坏结算按 `kind`
 *   各算各的虚拟天，冰箱的乘数是 0.4。但它的价值**随灾难变** ——
 *   寒潮里全屋本来就是冷库，冰箱在那里的收益是 0。那是设计，不是 bug：
 *   见 `data/furniture.ts` 的注释。
 *
 * ★ "一间房能放几块"从此由**房间表**说了算（`data/rooms.ts` 的 `capacity`，
 *   原编号 D-08 已清偿）：客厅 6 块、储藏间 3 块，而储藏间要活到最后一次解锁。
 *   空间压力因此不再是"72 格装得下就算了"—— 客厅 144 格**到不了**
 *   §10.2.6 的"单局上架 300 件"，玩家终究要解锁第二间房。
 *
 * ## ★ §10.2.3.1 的维度 14「空间限制」落在这里
 *
 * 两个粒度，各有各的表达：
 *
 *  · `capacityFactor`（整屋小一圈）→ **每块的底下一排格子不可用**。
 *    选"砍排"而不是"砍列"是为了对得上这一维的叙事：进水、结冰、塌方
 *    都是**从下往上**吃掉空间，而左右对称地砍列读起来像"屋子变窄了"，
 *    那与"低处完了"是两件事；
 *  · `unusableShelfIds`（这一块没了）→ 整块移出列表。
 *
 * ★ 两者都是**乘在盘面上**，不是乘在数值上 —— 这正是 §10B.0 的主轴
 * （"更大的空间才是奖励"的反面：这一场你**没有**那么大的空间），
 * 也是"整理这件事本身变难"最直接的兑现方式。
 *
 * ## 两处必须守住的边界
 *
 *  1. **至少留一格**、而且**至少留一块家具**：§4A 承诺任何界面都得有一条能走的路，
 *     而"一格都没有"不是难度，是卡死。所以两道 `Math.max`；
 *  2. **`handyRank` 不会指向被拆掉的那块**：顺手位是开局之后玩家自己标的
 *     （`toggleHandy`），而这里只影响"开局时有哪些家具" ——
 *     被拆掉的块从列表里消失，它上面本来就没有标记。
 *
 * ## ★ 这一维的接线经过（D-32，2026-10 清偿）
 *
 * 这两个字段在这个函数里**从 M3 起就是通的**，而它整整一维没生效过 —— 因为
 * `createStartingRun` 把实参写成了 `M1_DISASTER_ID`，而寒潮是 L1 教学样板，
 * **没写** `capacityFactor` / `unusableShelfIds`。于是全表 43 场 / 31 场写了
 * 空间代价、一场都没被玩家碰到。
 *
 * ★ 教训值得留在这里：**"这个字段通了"与"它生效了"是两件事** ——
 * 上面那两段注释当时读起来完全正确，而下游一次都没跑到。
 * 所以现在那条接线由 `systems/setup.test.ts` 钉着（按 43 场里真实的一场
 * 造出开局，断死"少了哪块、矮了几排"），而不是靠这段注释自证。
 *
 * @param disasterId 这一局真正抽到的那一场（不传 = 寒潮，测试与夹具用）
 */
export function createStartingShelves(
  roomId: string = ROOM_ID,
  disasterId: string = M1_DISASTER_ID
): Shelf[] {
  const mods = disasterModifiersOf(disasterId);
  const kinds: Shelf['kind'][] = ['shelf', 'shelf', 'fridge'];
  return SHELF_IDS.slice(0, STARTING_SHELF_COUNT)
    // 整块用不了的先摘掉（至少留一块）
    .filter((id) => !mods.unusableShelfIds.includes(id))
    .slice(0, Math.max(1, STARTING_SHELF_COUNT - mods.unusableShelfIds.length))
    .map((id, i) => {
      // 整屋小一圈 → 每块少掉底下的几排（至少留一排）
      const usableH = rowsFor(SHELF_H, mods.capacityFactor);
      return createShelf(id, roomId, kinds[i] ?? 'shelf', SHELF_W, usableH, null);
    });
}

/**
 * 「整屋小一圈」落成几排 —— **一律向下取整**。
 *
 * ## 为什么是 floor 而不是 round（这条改过一版，值得记）
 *
 * 每一块货架只有 4 排，而 `capacityFactor` 是一个 0.5~1 的连续乘数 ——
 * 所以"乘出来的行数"必须落到整数排上，而**取整方式决定了这一维是真的生效
 * 还是静默失效**。实测（`scripts/_probe-rounding.ts`，43 场逐个过一遍）：
 *
 * | 乘数 | ×4 排 | `round`（旧） | `floor`（新） |
 * | --- | --- | --- | --- |
 * | 0.65 | 2.6 | 3 | 2 |
 * | 0.70 / 0.72 | 2.8 / 2.88 | 3 | 2 |
 * | 0.75 / 0.80 / 0.85 | 3.0 / 3.2 / 3.4 | 3 | 3 |
 * | **0.90** | 3.6 | **4 ← 一排都没少** | 3 |
 *
 * 也就是说 `round` 在那 **10 场**上把"屋子小了一圈"抬回成"什么都没发生"，
 * 其中就包含**凌汛**（唯一的 0.90 —— 它本来会一格都不少）与
 * `地震` / `爆管` / `地陷` 那一类"屋子塌了一块"的场次。
 *
 * ★ 那正是 D-32 那一整类错误（"写了 ≠ 生效了"）在一个更小的尺度上重演：
 * 数据写了、校验器认它、维度签名把它算成"用到第 14 维"，而玩家那边什么都没发生。
 * 所以口径是：**只要 `capacityFactor < 1，就必须真的少掉至少一排`** ——
 * 一个"乘了但没变"的乘数比"没写"更坏，因为下一个人会以为这一场有空间代价。
 *
 * @param full 这块家具本来的排数
 * @param factor 灾难的 `capacityFactor`（≥1 时按 1 算：灾难不该让屋子变大）
 */
export function rowsFor(full: number, factor: number): number {
  const cap = Math.max(0.5, Math.min(1, factor));
  // 乘数 = 1 时原样返回（floor 会把它算成同一件事，但这样读起来更直白）
  if (cap >= 1) return Math.max(1, Math.round(full));
  return Math.max(1, Math.floor(full * cap));
}

export function boxDefAt(index: number): BoxDef {
  const def = BOX_DEFS[index];
  if (!def) throw new Error(`没有第 ${index + 1} 号箱型的定义`);
  return def;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  加一块家具（§10.2.4 的"新货架 / 新家具类型"）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么是"纯函数"而不是一个命令
 *
 * §10.2.4 里"新货架"和"新家具类型"是**解锁物**（元进程的奖励），
 * 而"怎么解锁"（进度阶梯）与"房间能放几块"（`rooms` 变成数据）都属于**第 7 步**。
 * 所以这里只做**机制**：给我一份货架、一种家具，还你一份多了它的货架。
 *
 * 这样切的好处是"谁来调用它"可以晚定 —— 商店买、成就发给、开局配置，
 * 三条路都能接在同一个函数上，而不必先写完元进程才能动手。
 *
 * ## 三条硬约束
 *
 *  1. **id 必须唯一**：用递增后缀而不是随机（id 进存档，随机 id 会让
 *     "同一份操作两次得到不同存档"）。重名会让 `findShelf` 拿到错的那一块 ——
 *     而那种错**不会报错**，只会让东西放到别处；
 *  2. **房间要存在**：`roomId` 指向一间还没有的房间 = 一块玩家永远看不见的家具
 *     （整理页按房间分组渲染）。所以认不出就退回 `ROOM_ID`，与
 *     `furnitureDefOf` 认不出 kind 时退回普通货架是同一条纪律；
 *  3. **`handyRank` 一律 null**：顺手位是**全屋唯一**的（§12.3 v0.7.1 玩家拍板），
 *     新家具**不许**自己抢那个位置。买了冰箱就把"门口那一块"顶掉，
 *     会让玩家在毫无察觉的情况下丢掉应急可达率。
 *
 * @param shelves 现在的全部家具
 * @param kind 要加的家具种类（认不出 → 普通货架）
 * @param opts.roomId 放进哪间房（默认 `ROOM_ID`；将来 `rooms` 变数据后由调用方给）
 * @param opts.spoilFactor 灾难的空间限制（维度 14）—— 与开局那三块用同一把尺子
 * @returns **新的**数组（不改入参，配合原子存档）
 */
export function addFurniture(
  shelves: readonly Shelf[],
  kind: Shelf['kind'],
  opts: { roomId?: string; spoilFactor?: number; ids?: readonly string[] } = {}
): Shelf[] {
  const roomId = opts.roomId ?? ROOM_ID;
  const def = furnitureDefOf(kind);
  // 与开局那几块**同一个函数**算排数（`rowsFor`）—— 两边各写一遍取整，
  // 迟早会出现"买来的那块比开局的矮一排"（而那种差没人看得出来）
  const usableH = rowsFor(def.h, opts.spoilFactor ?? 1);

  // id：优先用调用方给的池子（`SHELF_IDS` 那种固定名单），否则按现有块数递增
  const pool = opts.ids ?? [];
  const used = new Set(shelves.map((s) => s.id));
  const id = pool.find((x) => !used.has(x)) ?? nextShelfId(def.kind);
  // 池子用尽且懒得给更多时，仍然要保证不重名 —— 这是上面第 1 条约束
  const finalId = used.has(id) ? nextShelfId(def.kind) : id;

  return [...shelves, createShelf(finalId, roomId, def.kind, def.w, usableH, null)];
}

/** 批次到期日：保质期 ±12% 抖动。不易腐返回 null（= 永不到期，FEFO 时排最后） */
export function rollExpiry(cursor: RngCursor, itemId: string, dayRef = 0): number | null {
  const def = getItemDef(itemId);
  if (!def.perishable || !def.shelfLifeDays) return null;
  const jitter = Math.max(1, Math.round(def.shelfLifeDays * 0.12));
  return dayRef + def.shelfLifeDays + nextInt(cursor, -jitter, jitter);
}

/**
 * 拆箱引擎③：一箱里摸出的东西是"一件一件"的堆栈。
 * 同一种物资超过 2 件时有概率拆成两个批次 —— 拆箱时能亲眼看到保质期不一样，
 * 后面的 FEFO 排序才有得排（否则玩家没有理由用排序按钮）。
 */
export function generateBoxStacks(cursor: RngCursor, def: BoxDef, dayRef = 0): ItemStack[] {
  const itemCount = nextInt(cursor, def.minItems, def.maxItems);
  const pool = shuffle(cursor, def.pool);
  const out: ItemStack[] = [];
  for (let i = 0; i < itemCount; i++) {
    const itemId = pool[i % pool.length];
    if (!itemId) break;
    const item = getItemDef(itemId);
    const maxPer = Math.max(1, Math.min(def.maxCountPerItem, item.stackLimit));
    const count = nextInt(cursor, 1, maxPer);
    const canSplit = item.perishable && count > 2;
    const splitAt = canSplit && nextInt(cursor, 0, 1) === 1 ? Math.floor(count / 2) : count;
    out.push(makeStack(itemId, splitAt, rollExpiry(cursor, itemId, dayRef)));
    if (splitAt < count) out.push(makeStack(itemId, count - splitAt, rollExpiry(cursor, itemId, dayRef)));
  }
  // 奢侈品是**额外**的一抽，不占上面那些名额（M2，§12 拍板 v0.9）。
  // 放在最后掷的理由：这样"这一箱有几件正经货"与"有没有开到好东西"是两件独立的事，
  // 玩家拆到箱底那一下的期待才是纯粹的 —— 而不是"少了一件罐头换来的"。
  const luxury = rollLuxury(cursor, def, dayRef);
  if (luxury) out.push(luxury);
  return out;
}

/**
 * 这一箱有没有开出奢侈品（M2）。没有 `luxuryChance` 的箱型直接返回 null，**不消耗 RNG**。
 *
 * 不消耗那一次掷很要紧：`box_staple` / `box_medical` 是玩家按品类买的确定性商品，
 * 它们不该因为"表里没有奢侈品"而在 RNG 流里留下一个空位 ——
 * 那会让同 seed 下粮油箱的内容随着"混合箱的奢侈品概率"变化而变化。
 */
function rollLuxury(cursor: RngCursor, def: BoxDef, dayRef: number): ItemStack | null {
  const chance = def.luxuryChance ?? 0;
  const pool = def.luxuryPool ?? [];
  if (chance <= 0 || pool.length === 0) return null;
  if (nextFloat(cursor) >= chance) return null;
  const itemId = pick(cursor, pool);
  // 每次只开出一件：多件会让"开出一件好东西"这件事贬值
  return makeStack(itemId, 1, rollExpiry(cursor, itemId, dayRef));
}

/**
 * @param dayRef 批次到期日的起算天。M1 传当前天（囤货期为负），
 *   这样 D-7 买的罐头和 D-1 买的会差出好几天 —— 否则 FEFO 根本没有可排的东西（§5 引擎④）。
 */
export function createStartingBoxes(
  cursor: RngCursor,
  count: number = STARTING_BOX_COUNT,
  dayRef = 0
): UnpackBox[] {
  const boxes: UnpackBox[] = [];
  for (let i = 0; i < count; i++) {
    const def = boxDefAt(i);
    boxes.push({ id: `box_${i + 1}`, defId: def.id, items: generateBoxStacks(cursor, def, dayRef) });
  }
  return boxes;
}

/**
 * D-Day 的四维起点。
 *
 * ⚠ 这个常量住在 **`data/survival.ts`** 里，这里只是转出去给调用点用。
 * 为什么不放这儿：`data/` **不能**依赖 `systems/`（分层），
 * 而 `data/survival.ts` 需要它当"囤货期的地板"（见那里的 `PEACETIME_FLOOR`）——
 * 放这里会形成 `data/survival ⇄ systems/setup` 的**循环依赖**。
 */
import { STARTING_STATS } from '../data/survival';
export { STARTING_STATS };

/**
 * 开新局：**停在 prologue**（§9.1 开局界面）。
 *
 * 身份与现金都还是空的，等玩家在开局页点完身份卡，由 `systems/phases.ts` 的
 * `chooseIdentity()` 一次性填上并推进到囤货期第一天。这样"选身份"也是一个原子存档点。
 *
 * seed 落盘策略：存的是"已经用掉的游标值"，后续任何随机（点位库存、事件抽取）
 * 都从这个游标继续走，于是同档同序。
 *
 * ## ★ `opts.disasterId`：这一局抽到哪一场（M4 决策 A / W-01）
 *
 * **真实的生产路径一定会传它**（`main.ts` 走 `newRunWithDisaster`，那边先按
 * tier 阶梯抽签再进来）。不传时回落到寒潮，这份默认值是给**测试与夹具**用的：
 *
 *  · 三条永久回归探针必须钉死灾难 —— 它们的基线（好档活满 14 天 / 乱档 D+10 倒）
 *    是在寒潮上量出来的，而且"同一份货 + 同一个身份 = 同一个结果"是它们的前提；
 *  · `scripts/make-save.mjs` 与九个 `src/tools/save-*.txt` 夹具同理。
 *
 * ⚠ 所以这里**不是**"随机抽一场"的落点 —— 抽签在 `rollDisasterId`，
 * 而它要读跨局账本。把随机塞进这个函数会让每一个测试都变得不可复现。
 *
 * 同一行决定了**两件事**：`run.disasterId`（全局规则读它）与
 * `createStartingShelves` 的实参（空间维度读它）。在 M4 之前后者写死寒潮，
 * 于是 `capacityFactor`（43 场写了）与 `unusableShelfIds`（31 场写了）
 * **一场都没生效过** —— 见 `src/meta/deferred.ts` 的 D-32（已清偿）。
 */
export function createStartingRun(
  seed: number = randomSeed(),
  opts: { disasterId?: string } = {}
): RunState {
  const cursor = createCursor(seed);
  // 存档可以被手改，而 `getDisasterDef` 对未知 id 会抛 —— 所以这里先问一句。
  // 与 `systems/phases.ts` 的 `chooseIdentity` 挡"没有这个身份"是同一条纪律。
  const disasterId = opts.disasterId && hasDisasterDef(opts.disasterId) ? opts.disasterId : M1_DISASTER_ID;
  const run: RunState = {
    phase: 'prologue',
    day: FIRST_STOCKPILE_DAY,
    identityId: '',
    // §10B.3：熟练度等级在 `chooseIdentity` 那一刻才定；开局页上还没有身份，所以是 1
    identityLevel: 1,
    // ★ 全局规则与**铺房间**用同一个 id。这两处一旦分家，空间限制（维度 14）
    //   就会静默套错灾难 —— 玩家看到的日历是一场，货架却按另一场砍
    //   （那正是 M4 之前那个 bug 的形状：日历写着寒潮，而寒潮没有空间维度，
    //    所以"少了一整块货架"这件事从来没有发生过）
    disasterId,
    cash: 0,
    shelves: createStartingShelves(ROOM_ID, disasterId),

    zones: [],
    // 重生前家里就有的三箱货（§4.1 第0段"重生开局"）—— 不让玩家对着空货架开场
    boxesToUnpack: createStartingBoxes(cursor, STARTING_BOX_COUNT, FIRST_STOCKPILE_DAY),
    stats: { ...STARTING_STATS },
    trust: {},
    deliveredOrders: 0,
    /*
     * 情报（D-13）：开局给 1 条 —— 也就是"今天"那一天。
     * `revealedForecasts` 让过去的天无条件可见，所以这一条的实际作用是
     * "开局就知道今天将要面对什么"，而更远的那些天要挣。
     */
    intel: 1,
    log: [],
    seed: cursor.state,
    actionPoints: 0,
    carLoad: 0,
    shopStocks: [],
    visitedShopIds: [],
    currentShopId: null,
    // M2：开局还没有白天事件。物价倍率给 1，真正的当日价由 chooseIdentity /
    // 换天时的 rollDaySetup 按"那一天"的倍率算进 line.price（见 systems/shop.ts）
    shopPriceFactor: 1,
    shopLimits: [],
    shopBoughtToday: {},
    dayEvent: null,
    eventHistory: emptyEventHistory(),
    // v15：手里那件物资（§4A 要求它随存档保留；开局当然是空的）
    held: null,
    heldFrom: { kind: 'none' },
    night: null,
    helpRequest: null,
    survival: {
      spoiled: 0,
      shortageDays: 0,
      shortagePieces: 0,
      unreachablePieces: 0,
      hardPressDays: 0,
      hardPressStreak: 0,
      safeStreak: 0,
      // v16（成就）：`cleanDays` 从 0 数起；`minStamina` 从满值起 ——
      // 它是"最低体力"，开局还没累过，所以真值就是 100（补 0 会让成就白送）
      cleanDays: 0,
      minStamina: 100,
      emergencyHurtCount: 0,
      lastTradeDay: NEVER_TRADED,
      last: { ...EMPTY_SURVIVAL_SNAPSHOT }
    },
    outcome: null,
    metaSettled: null
  };
  return run;
}

/** 箱子正面的手写标签：有箱型定义就用定义里的，没有就按里面的头一件自己编 */
export function boxLabel(box: UnpackBox): string {
  if (box.items.length === 0) return '空箱';
  const def = BOX_DEFS.find((b) => b.id === box.defId);
  if (def) return def.name;
  const first = box.items[0];
  return first ? `${getItemDef(first.itemId).name} 一箱` : '没写标签的箱';
}

/** 箱内序号：整局唯一（'box_1' / 'box_stray_3'），空箱被摘掉也不会让别的箱串位 */
export function nextBoxSeq(boxes: readonly UnpackBox[]): number {
  let max = 0;
  for (const box of boxes) {
    const m = /(\d+)$/.exec(box.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * 把一条刚抽中的事件记进"近期记录"（`RunState.eventHistory`），最新在前、只留几条。
 *
 * 它服务的是 M2 走测反馈里那条"重复"：求援订单池只有 6 单，
 * 而每次都是均匀随机 —— 同一个 NPC 前后两次问同一件事的概率是 50%。
 * 记下最近出过的，抽签时把它们的权重压低（见 `model/rng.ts` 的 `pickEventAvoidingRecent`）。
 *
 * 放在 setup.ts 是因为它是**纯记账**，不属于任何一个事件池；
 * 三个抽签点（夜间 / 求援 / 白天）都要用它，各写一份必然漂。
 */
export function recordEvent(run: RunState, kind: keyof EventHistory, eventId: string): void {
  const next = [eventId, ...run.eventHistory[kind].filter((id) => id !== eventId)];
  run.eventHistory[kind] = next.slice(0, KEEP);
}

/** 空的事件记录（开新局与老档迁移都用它） */
export function emptyEventHistory(): EventHistory {
  return { night: [], help: [], day: [], emergency: [] };
}

export { createCursor };
