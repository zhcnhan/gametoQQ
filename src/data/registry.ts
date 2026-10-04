/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  内容注册表（Content Registry）—— §10B.5 的第 1 件，也是 §10B 第 1 步的主体
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么要有它
 *
 * §10B 要把内容从"十几条"扩到"数百条"，而那件事的真正瓶颈不是生成、是**校对**。
 * 这个文件解决的是另一半：
 *
 *   · **图鉴 / 成就 / 解锁的输入是同一件事** —— "这世界上有哪些内容、玩家见过其中哪些"。
 *     没有注册表，图鉴界面会 import 八张表，将来加第九张就要改界面（加内容不再便宜），
 *     而成就条件会各自硬编码（"点亮全部 canned"这种查询没有地方放）；
 *   · **"写了但永远出不来"的内容没人发现** —— M2 的 D-16 就是
 *     `hot_water_bag_gift` 不在任何箱子的池子里，图鉴上永远空一格。
 *
 * ## ★ 它与 `scripts/check-content.mjs` 是两件事（D-24 专门登记过，别混）
 *
 * | | 回答什么 | 什么时候跑 |
 * | --- | --- | --- |
 * | **本文件（注册表）** | "**已经进来的**内容怎么被查询与遍历" | 运行期 |
 * | `check-content.mjs`（校验） | "**正要进来的**数据合不合格" | 构建期 |
 *
 * 两者都会用到"有哪些内容"这份名单，但**用的是各自的一份**：
 * 注册表读的是**已被接受的、编译进游戏的**内容（TS 表）；
 * 校验器还要能看"这一批新的"，所以它自己另读一份（含待入库的 JSON）。
 *
 * ## 一个刻意没做的东西
 *
 * §10B.5 要求"注册表**不写死在代码里**：允许将来从 `data/mods/*.ts` 合并
 * （M3 只留挂载点，不实现）"。所以下面有 `mergeMods()` 这个**挂载点**，
 * 它现在的实现是"原样返回" —— 但接口留在这里，将来接上 mod 时不用改任何调用方。
 * 现在就把挂载点写出来，是因为"加 mod 支持"这类事一旦拖到内容量上来之后做，
 * 就得回头改所有读内容的地方；留一个函数是零成本的。
 *
 * ## 分层
 *
 * 本文件属于 `data/`（静态数据），所以：**纯数据、无副作用**，
 * 不碰 DOM / window / localStorage，也不 import 任何 `systems/` 或 `ui/`。
 */
import { BOX_DEFS, STRAY_BOX_DEF, type BoxDef } from './boxes';
import { DAY_EVENT_DEFS } from './dayEvents';
import { DISASTER_DEFS } from './disaster';
import { EMERGENCY_DEFS } from './emergencies';
import { HELP_REQUEST_DEFS } from './helpRequests';
import { IDENTITY_DEFS } from './identities';
import { ITEM_DEFS, CATEGORY_LABELS, CATEGORY_ORDER } from './items';
import { NIGHT_EVENT_DEFS } from './nightEvents';
import { NPC_DEFS, type NpcDef } from './npcs';import { SHOP_DEFS } from './shops';
import type { CategoryId, ContentTier, ItemDef, ShopDef } from '../model/types';

// ——————————————————————————————————————————————————————————————
// 1. 内容种类与条目
// ——————————————————————————————————————————————————————————————

/**
 * 内容的**种类**。它是注册表的坐标系：任何"遍历全部内容"的地方
 * （图鉴分页、成就判定、解锁阶梯、构建期校验、生成提示词的内容参照表）
 * 都按这个联合类型分派，而不是各自列一张表名清单。
 *
 * ★ 加一种内容 = 在这里加一个字面量 + 在 `TABLES` 里加一行 ——
 * 这是 §10B.5「加内容 = 加一行数据，不动代码」在**元数据**这一层的落法。
 */
export type ContentKind =
  | 'item'
  | 'box'
  | 'disaster'
  | 'nightEvent'
  | 'dayEvent'
  | 'emergency'
  | 'helpRequest'
  | 'identity'
  | 'shop'
  | 'npc';

/**
 * 一条内容的**统一身份**（id + 种类 + 分层 + 展示名 + 分类）。
 *
 * 为什么要这么一层：图鉴 / 成就 / 解锁关心的从来不是"这条内容是 ItemDef 还是
 * DayEventDef"，而是"它的 id 是什么、它算第几层、它叫什么、它归在哪一类"。
 * 把这几件事抽出来，那些读者就不必认识八种不同的结构。
 */
export interface ContentEntry {
  kind: ContentKind;
  id: string;
  /** 展示名（`disasterName` / 物资名 / 事件标题那种）。事件类用它正文的首句，见 `titleOf` */
  name: string;
  /**
   * 内容分层。**没写就是 undefined，不是 1** ——
   * "没写"与"写了 1"是两件事：前者要被校验器揪出来，后者是明确的决定。
   * 一个 `?? 1` 的默认值会把"作者忘了写"这件事永久藏起来。
   */
  tier: ContentTier | undefined;
  /**
   * 分类。对物资是 `category`，对突发事件是它要的品类，对商店是 `specialty` 的第一项，
   * 对灾难是 `family`，其余留空。它服务"同类内容互相比较"这类查询
   * （例如成就「罐头鉴赏家」要"点亮全部 canned 标签"）。
   */
  category?: string;
  /** 这条内容自带的标签（物资的 `tags`、事件的 `tags` / `specialty`），供分区规则与成就引用 */
  tags: readonly string[];
  /** **只给图鉴与解锁用**：这条内容现在到底能不能被玩家碰到。理由见 `accessibilityOf` */
  obtainable: boolean;
  /** 原始定义。界面要读细节时从这里下去（例：图鉴要显示物资的重量与保质期） */
  raw: unknown;
}

/**
 * 八张内容表 + 两张"也在册但不是玩法内容"的表（箱型 / NPC）。
 *
 * ★ 为什么把箱型与 NPC 也算进来：§10B.5 盘点的"八张表"里本来就有箱型，
 * 而 NPC 是**图鉴第三页**（关系）的键 —— `CodexState.npcs` 存的就是 NPC id。
 * 不上册的话，"图鉴一共几页、每页多少条"就得在图鉴界面里硬编码一张对应关系。
 */
interface ContentTable<K extends ContentKind, T> {
  kind: K;
  /** 中文名（界面与校验报告共用一份，免得两处各写一遍） */
  label: string;
  list: readonly T[];
  idOf: (def: T) => string;
  /** 容器给这一条的内容分层。没有分层这个概念的表返回 undefined */
  tierOf: (def: T) => ContentTier | undefined;
  nameOf: (def: T) => string;
  categoryOf?: (def: T) => string | undefined;
  tagsOf?: (def: T) => readonly string[];
}

/** 事件类的"名字"：它们没有 `name` 字段，正文首句就是它的名字 */
function titleOf(text: string, max = 14): string {
  const head = text.split(/[。！？]/)[0] ?? text;
  return head.length > max ? `${head.slice(0, max)}…` : head;
}

/**
 * 声明一张表，同时把它的泛型固定下来。
 *
 * 不写这个函数的话，`TABLES` 的每个元素的类型参数会被推成 `unknown`
 * （因为数组里混着九种不同的结构），于是 `idOf` / `nameOf` 这些回调
 * 全都在 `unknown` 上取属性 —— 编译器会报一屏 `TS18046`。
 * 包一层就恢复了逐表的类型，而 `TABLES` 本身仍然是一张统一清单。
 */
function table<K extends ContentKind, T>(t: ContentTable<K, T>): ContentTable<ContentKind, unknown> {
  return t as unknown as ContentTable<ContentKind, unknown>;
}

/** 不支持分层的表（箱型 / NPC）：写一次，省得每处都写 `() => undefined` */
const noTier = (): ContentTier | undefined => undefined;

/** 八张内容表 + 两张"也在册但不是玩法内容"的表（箱型 / NPC）的清单 */
const TABLES: readonly ContentTable<ContentKind, unknown>[] = [
  table({
    kind: 'item',
    label: '物资',
    list: ITEM_DEFS,
    idOf: (d) => d.id,
    tierOf: (d) => d.tier,
    nameOf: (d) => d.name,
    categoryOf: (d) => d.category,
    tagsOf: (d) => d.tags
  }),
  table({
    kind: 'box',
    label: '箱型',
    // 临时搁置箱不在册：它不是"内容"，是兜底机制（池子为空，永远开不出东西）
    list: BOX_DEFS,
    idOf: (d) => d.id,
    tierOf: noTier,
    nameOf: (d) => d.name
    /*
     * ★ 这里**刻意没有 `tagsOf`**，而这件事值得写下来（它是个真 bug）。
     *
     * 第一版给它写了 `tagsOf: (d) => [d.hint]`（箱型没有 tags 字段，
     * 而 `hint` 是"粮油 / 常用药 / 隔壁单位拼的"那种手写标签，看着像）。
     * 后果是**标签统计被污染**：`tagCounts()` 把 `'粮油'` 也算成一个标签，
     * 于是"标签用量"表里冒出一些只有箱型在用的词。
     *
     * 它是怎么被发现的：`check-registry.mjs` 报 `warmth(2)`，
     * 而实际只有棉被一件带这个标签 —— **一个数不对，追下去发现是口径混了**。
     * 这类错误不会报错，只会让"某个 tag 至少 3 件共用"这类判断凭空虚高。
     *
     * 一句话：**`hint` 是给玩家看的箱子标签，不是分区规则引用的 tag。**
     * 两者同名不同义，混在一起就会造出第二个真相来源（§2.8）。
     */
  }),
  table({
    kind: 'disaster',
    label: '灾难',
    list: DISASTER_DEFS,
    idOf: (d) => d.id,
    tierOf: (d) => d.tier,
    nameOf: (d) => d.name,
    categoryOf: (d) => d.family,
    tagsOf: (d) => [d.family, d.level]
  }),
  table({
    kind: 'nightEvent',
    label: '夜间事件',
    list: NIGHT_EVENT_DEFS,
    idOf: (d) => d.id,
    tierOf: (d) => d.tier,
    nameOf: (d) => titleOf(d.text)
  }),
  table({
    kind: 'dayEvent',
    label: '白天事件',
    list: DAY_EVENT_DEFS,
    idOf: (d) => d.id,
    tierOf: (d) => d.tier,
    nameOf: (d) => titleOf(d.text),
    tagsOf: (d) => d.tags ?? []
  }),
  table({
    kind: 'emergency',
    label: '突发事件',
    list: EMERGENCY_DEFS,
    idOf: (d) => d.id,
    tierOf: (d) => d.tier,
    nameOf: (d) => titleOf(d.text),
    categoryOf: (d) => d.category
  }),
  table({
    kind: 'helpRequest',
    label: '求援订单',
    list: HELP_REQUEST_DEFS,
    idOf: (d) => d.id,
    tierOf: (d) => d.tier,
    nameOf: (d) => titleOf(d.text),
    categoryOf: (d) => d.demands[0]?.category,
    tagsOf: (d) => [d.npcId]
  }),
  table({
    kind: 'identity',
    label: '身份',
    list: IDENTITY_DEFS,
    idOf: (d) => d.id,
    tierOf: (d) => d.tier,
    nameOf: (d) => d.name
  }),
  table({
    kind: 'shop',
    label: '点位',
    list: SHOP_DEFS,
    idOf: (d) => d.id,
    tierOf: (d) => d.tier,
    nameOf: (d) => d.name,
    tagsOf: (d) => d.specialty ?? []
  }),
  table({
    kind: 'npc',
    label: '关系',
    list: NPC_DEFS,
    idOf: (d) => d.id,
    tierOf: noTier,
    nameOf: (d) => d.name
  })
];

// ——————————————————————————————————————————————————————————————
// 2. 可达性："写了但永远出不来"的那一类（D-16 的静态版本）
// ——————————————————————————————————————————————————————————————

/**
 * 一眼能看出"这条内容从哪儿来"的清单：物资 id → 来源描述。
 *
 * ## 它为什么必须存在
 *
 * §10B.2 里有一条设计纪律：
 *
 *   > **未点亮的那一格要看得见轮廓与"从哪儿来"的提示** —— 这是收集类界面
 *   > 最重要的一条：玩家需要知道"还差什么、去哪儿找"，否则收集欲无从下手。
 *   > 「哪儿来」直接从注册表推导（见 §10B.5），不手写。
 *
 * 所以"从哪儿来"必须是**算出来的**，不能是每件物资手写一句 ——
 * 手写的话，加一件物资就要记得回来补一句，而忘掉是默认结局。
 *
 * ## 算法与它承认的边界
 *
 * 物资的来源只有两个真实入口：**商店在卖**（`ShopDef.offers`）与
 * **箱子可能开出来**（`BoxDef.pool` / `luxuryPool`）。两者都扫一遍即可。
 * 扫不到 = 这件物资现在拿不到 —— 那**不是**一个可以静默接受的状态。
 *
 * ★ 注意这里刻意**不**把"被某条事件的 `grab` 给到"算进来：
 * `grab` 按**品类**给货（`{category, count}`），不指定具体哪一件，
 * 所以它给不了"这一件确定能拿到"的承诺。把品类级的来源写成件级的来源，
 * 就是那句被反复引用的教训 —— **注释里不许把"应该"写成"已经"**。
 */
export interface ItemSource {
  itemId: string;
  /** 卖它的点位 id */
  shops: string[];
  /** 可能开出它的箱型 id */
  boxes: string[];
}

/**
 * 一件物资从哪儿来 —— **它就是"可达性"的定义**。
 *
 * ★ 这个函数从 `ALL_ENTRIES` 的初始化到 `sourcesOfItem` 都用同一份实现，
 * 所以只有一处能定义"什么叫拿得到"。想改口径（比如将来加上"事件 `grab` 也算"）
 * 只需改这里，而**改完立刻会被 `registry.test.ts` 那条守卫看见**。
 */
function itemSources(): Map<string, ItemSource> {
  const map = new Map<string, ItemSource>();
  const ensure = (itemId: string): ItemSource => {
    let s = map.get(itemId);
    if (!s) {
      s = { itemId, shops: [], boxes: [] };
      map.set(itemId, s);
    }
    return s;
  };
  for (const shop of SHOP_DEFS) {
    for (const offer of shop.offers) ensure(offer.itemId).shops.push(shop.id);
  }
  for (const box of boxPoolDefs()) {
    for (const itemId of [...box.pool, ...(box.luxuryPool ?? [])]) ensure(itemId).boxes.push(box.id);
  }
  return map;
}

/** 全部箱型（含只作兜底的临时搁置箱 —— 它的池子是空的，天然什么也不提供） */
function boxPoolDefs(): readonly BoxDef[] {
  return [...BOX_DEFS, STRAY_BOX_DEF];
}

/**
 * 这条内容现在能不能被玩家碰到。
 *
 * 各表的口径不同，而且**每个不同都是有意的**：
 *   · 物资 —— 有人在卖，或某个箱子开得出（见 `ItemSource`）；
 *   · 灾难 —— 看它的 `tier`：`tier: 1` 的那个开局就在（§10B.3.2 的解锁阶梯，
 *     寒潮是唯一的 tier 1）；更高层的等解锁功能做出来才算"可达"，
 *     而解锁功能还没做 —— 所以这里返回 false，让图鉴与校验器都能看见这笔账；
 *   · 身份 —— 同上，`tier: 1` 开局可选（见 `IDENTITY_DEFS`：`group_buyer` /
 *     `night_shift` / `nurse` 三个）；
 *   · 事件 / 订单 / 商店 / 箱型 / NPC —— 进了池子就是可达的（抽取器按各自的权重表走）。
 */
function accessibilityOf(kind: ContentKind, def: unknown, tier: ContentTier | undefined, sources: Map<string, ItemSource>): boolean {
  switch (kind) {
    case 'item': {
      const id = (def as ItemDef).id;
      const s = sources.get(id);
      return Boolean(s && (s.shops.length > 0 || s.boxes.length > 0));
    }
    // 灾难 / 身份的解锁功能在 §10B 第 2~3 步（成就与解锁阶梯），现在只有 tier 1 可达
    case 'disaster':
    case 'identity':
      return tier === 1;
    default:
      return true;
  }
}

// ——————————————————————————————————————————————————————————————
// 3. 注册表本体
// ——————————————————————————————————————————————————————————————

/**
 * 挂载点：把 `data/mods/*.ts` 的内容合并进来（§10B.5「mod 友好的三条」）。
 *
 * **M3 不实现 mod 加载**，这个函数就做一件事：把传进来的东西接上。
 * 留它的理由见文件头 —— "加 mod 支持"一旦拖到内容量上来之后做，
 * 就得回头改所有读内容的地方；而留一个纯函数是零成本的。
 *
 * @param mods 额外的内容，按种类给（键与 `ContentKind` 一致）
 */
export function mergeMods(mods: Partial<Record<ContentKind, readonly unknown[]>>): readonly ContentEntry[] {
  const merged: ContentEntry[] = [...ALL_ENTRIES];
  const sources = itemSources();
  for (const [kind, list] of Object.entries(mods) as [ContentKind, readonly unknown[]][]) {
    const table = tableOf(kind);
    if (!table || !list) continue;
    for (const def of list) {
      const tier = table.tierOf(def);
      merged.push({
        kind,
        id: table.idOf(def),
        name: table.nameOf(def),
        tier,
        category: table.categoryOf?.(def),
        tags: table.tagsOf?.(def) ?? [],
        obtainable: accessibilityOf(kind, def, tier, sources),
        raw: def
      });
    }
  }
  return merged;
}

/** 按种类取表。加一种内容时这里不用改（`TABLES` 是唯一清单） */
export function tableOf(kind: ContentKind): ContentTable<ContentKind, unknown> | undefined {
  return TABLES.find((t) => t.kind === kind);
}

/** 全部内容条目（按 `TABLES` 的顺序，同种类内保持表里的原始顺序） */
export const ALL_ENTRIES: readonly ContentEntry[] = (() => {
  const sources = itemSources();
  const out: ContentEntry[] = [];
  for (const table of TABLES) {
    for (const def of table.list) {
      const tier = table.tierOf(def);
      out.push({
        kind: table.kind,
        id: table.idOf(def),
        name: table.nameOf(def),
        tier,
        category: table.categoryOf?.(def),
        tags: table.tagsOf?.(def) ?? [],
        obtainable: accessibilityOf(table.kind, def, tier, sources),
        raw: def
      });
    }
  }
  return out;
})();

/** 按 id 建索引。**跨表唯一**由 `check-content.mjs` 守着（这里不抛异常，见下） */
const BY_ID: ReadonlyMap<string, ContentEntry> = new Map(ALL_ENTRIES.map((e) => [e.id, e]));

// ——————————————————————————————————————————————————————————————
// 4. 查询 API（图鉴 / 成就 / 解锁只用这些，不再各自 import 八张表）
// ——————————————————————————————————————————————————————————————

/** 一种内容的全部条目 */
export function entriesOfKind(kind: ContentKind): ContentEntry[] {
  return ALL_ENTRIES.filter((e) => e.kind === kind);
}

/**
 * 一种内容的**总数**。
 * 图鉴的"已点亮 / 总数"读它 —— 没有这个分母，"点亮了 3 项"没有参照。
 */
export function countOfKind(kind: ContentKind): number {
  return tableOf(kind)?.list.length ?? 0;
}

/**
 * 按 id 找一条内容。**找不到返回 null，不抛异常。**
 *
 * 与 `getItemDef`（未知 id 抛异常）分工不同：那个函数的调用方是命令层，
 * 传进来的 id 来自存档、必须显式处理"认不出"；这个函数的调用方是图鉴与成就，
 * 它们遍历的是**别人的存档**（云备份合并、旧档），一条认不出的 id
 * 应该让那一格空着，而不是把整个界面炸掉。
 */
export function findEntry(id: string): ContentEntry | null {
  return BY_ID.get(id) ?? null;
}

/** 一批 id 能不能都在册（存档自愈与校验器共用；`kind` 省略则跨表查） */
export function hasEntry(id: string, kind?: ContentKind): boolean {
  const e = BY_ID.get(id);
  if (!e) return false;
  return kind === undefined || e.kind === kind;
}

/**
 * 带某个标签的全部内容（成就「罐头鉴赏家」这类查询的落点）。
 *
 * ★ `kind` 默认是 `'item'`，与 `tagCounts()` 的默认一致 —— 这不是随手挑的：
 * 在这套数据里"标签"这个词**主要指物资的 `tags`**（玩家拿它写分区规则，
 * §10B.5 对它的约束也是按物资说的："同一个 tag 至少要有 3 件物资共用"）。
 * 店铺的 `specialty` 虽然也是字符串数组，但它是"这家店最划算的是什么"，
 * 语义不同。想要那种就显式传 `'shop'`。
 *
 * 两个同名 API 对"标签"的默认口径必须一致 —— 不一致的话，
 * `tagCounts()` 与 `listByTag()` 会对同一个词给出不同的数，而**两边都不报错**。
 * 那正是我在 `tagCounts` 注释里记的那个 bug 的成因。
 */
export function listByTag(tag: string, kind: ContentKind = 'item'): ContentEntry[] {
  return ALL_ENTRIES.filter((e) => e.kind === kind && e.tags.includes(tag));
}

/** 某个分类的全部内容（对物资是 `category`，对灾难是 `family`，对店铺是 `specialty`） */
export function findByCategory(category: string, kind?: ContentKind): ContentEntry[] {
  return ALL_ENTRIES.filter((e) => (kind === undefined || e.kind === kind) && e.category === category);
}

/**
 * 内容分层是 `tier` 的那一批。
 *
 * ★ 注意 `tier: undefined` 的条目**不会**被 `itemsForTier(1)` 选出来 ——
 * 这正是我们要的："没写分层"与"分层是 1"必须能被区分开，
 * 否则"作者忘了写"会被静默当成"这是开局内容"。
 */
export function itemsForTier(tier: ContentTier, kind?: ContentKind): ContentEntry[] {
  return ALL_ENTRIES.filter((e) => (kind === undefined || e.kind === kind) && e.tier === tier);
}

/**
 * 标签 → 用了它的内容条数。
 *
 * ## ★ `kind` 是**必需**参数，不给默认值 —— 这是被一个真 bug 逼出来的
 *
 * 第一版没有参数，扫全表。后果是 `tagCounts()` 把**店铺的 `specialty`**
 * （"这家店最划算的是什么"）也数了进去：`weekend_flea` 的 specialty 里有
 * `warmth`，于是"带 warmth 标签的物资"报成 2 件，而实际只有棉被一件。
 *
 * 这个数不对**不会报错**，只会让"一个 tag 至少要有 3 件物资共用才有意义"
 * 那类判断凭空虚高 —— 而那是给玩家写分区规则用的口径，虚高等于骗人。
 *
 * 所以现在强制调用方说清"数哪一类"：物资的 `tags` 与店铺的 `specialty`
 * 虽然都是字符串数组，**语义完全不同**（一个是"这东西算什么"，
 * 一个是"这家店最划算的是什么"）。同名不同义的东西混在一个桶里，
 * 就是 §2.8 那条"同一件事只留一个真相来源"的反面。
 */
export function tagCounts(kind: ContentKind = 'item'): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entriesOfKind(kind)) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/** 这一条内容现在能不能被玩家碰到（详见 `accessibilityOf`） */
export function isObtainable(id: string): boolean {
  return BY_ID.get(id)?.obtainable ?? false;
}

/**
 * **写了但永远出不来**的内容 —— 全部不可达的条目。
 *
 * §10B.5 把"可达性"列为构建期校验的一类，而 M2 的 D-16 证明它不是假设：
 * `hot_water_bag_gift` 当时不在任何箱子的池子里，图鉴上那一格永远空着。
 * 构建期用 `check-content.mjs` 拦新的，运行期用这个函数回答"现在有哪些"，
 * 于是图鉴能老老实实把那一格画成"还没有来源"。
 */
export function unobtainableEntries(kind?: ContentKind): ContentEntry[] {
  return ALL_ENTRIES.filter((e) => (kind === undefined || e.kind === kind) && !e.obtainable);
}

/**
 * 这件物资从哪儿来（图鉴的"从哪儿来"提示读它）。
 * 拿不到时返回空的两栏 —— 界面据此说"还没有来源"，而不是编一个。
 */
export function sourcesOfItem(itemId: string): ItemSource {
  return itemSources().get(itemId) ?? { itemId, shops: [], boxes: [] };
}

/** 七种品类按稳定顺序列出（界面与校验共用一份，`CATEGORY_ORDER` 是唯一真相） */
export function allCategories(): readonly CategoryId[] {
  return CATEGORY_ORDER;
}

/** 品类的中文名 */
export function categoryLabel(category: CategoryId): string {
  return CATEGORY_LABELS[category];
}

// ——————————————————————————————————————————————————————————————
// 5. 给"生成提示词"用的内容参照（§10B.7 的产能口径）
// ——————————————————————————————————————————————————————————————

/**
 * 现有内容的 id 清单，按种类分组。
 *
 * ## 为什么这件事要放在**运行期代码**里，而不是写死在提示词文档里
 *
 * 生成模型被明确要求"只能引用 `_内容参照.md` 里列出的 id"。而那份参照表
 * 在第一版里是**手抄的** —— 于是它必然会漂：加了一批物资、改了 tag 全集，
 * 参照表却还停在上一次手抄的版本上。生成出来的东西引用了一个"参照表里有、
 * 代码里没有"的 id，整批被校验器退回，而人会以为是自己写错了。
 *
 * 所以参照表必须**从注册表推导**（`scripts/gen-content-ref.mjs` 就是那个导出器）。
 * 一份数据只服务一个读者，但**一个事实只能有一个来源**。
 */
export function contentReference(): {
  kinds: { kind: ContentKind; label: string; ids: string[] }[];
  categories: { id: CategoryId; label: string }[];
  tags: { tag: string; count: number }[];
  shopIds: string[];
  boxIds: string[];
  npcIds: string[];
} {
  const kinds = TABLES.map((t) => ({
    kind: t.kind,
    label: t.label,
    ids: t.list.map((d) => t.idOf(d))
  }));
  const tags = [...tagCounts('item').entries()]
    .map(([tag, count]) => ({ tag, count }))
    // 按用处排序：共用的多的在前（参照表要让生成者看清"哪些 tag 是真的在用的"）
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return {
    kinds,
    categories: CATEGORY_ORDER.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
    tags,
    shopIds: SHOP_DEFS.map((s: ShopDef) => s.id),
    boxIds: BOX_DEFS.map((b: BoxDef) => b.id),
    npcIds: NPC_DEFS.map((n: NpcDef) => n.id)
  };
}
