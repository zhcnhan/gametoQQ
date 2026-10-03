/**
 * 注册表的守护测试（§10B.5 第 1 件 / D-23）。
 *
 * ## 这个文件在守什么
 *
 * 注册表本身是"汇总 + 查询"，逻辑很少，所以它最容易出的不是算法错，
 * 而是**结构性的事实错**：
 *
 *  · 某张表**没被登记**（加了第九张表却忘了加进 `TABLES`）——
 *    后果是图鉴少一页、成就少一批，而且**没有任何报错**；
 *  · 某个 kind 的 `countOfKind` 与表长不一致（图鉴的分母就成了假账）；
 *  · **跨表 id 撞车**（两个不同种类用了同一个 id）——
 *    `findEntry` 只认第一个，第二个永远查不到；
 *  · `tier` 漏写（校验器只管**待入库**的 JSON，管不到已经编译进游戏的表）；
 *  · 可达性算错 —— 那正是 D-16 那一类"写了但永远出不来"。
 *
 * ## 为什么"表都被登记了"这条要靠**对账**而不是靠类型
 *
 * `ContentKind` 是一个联合类型，所以"加一种 kind 却不加进 TABLES"
 * 在类型上是合法的（`TABLES` 是 `ContentTable[]`，少一项不报错）。
 * 所以这里反过来数：**每张数据表里的条目，都必须能在注册表里查到**。
 */
import { describe, expect, it } from 'vitest';
import { BOX_DEFS } from '../data/boxes';
import { DAY_EVENT_DEFS } from '../data/dayEvents';
import { DISASTER_DEFS } from '../data/disaster';
import { EMERGENCY_DEFS } from '../data/emergencies';
import { HELP_REQUEST_DEFS } from '../data/helpRequests';
import { IDENTITY_DEFS } from '../data/identities';
import { ITEM_DEFS } from '../data/items';
import { NIGHT_EVENT_DEFS } from '../data/nightEvents';
import { NPC_DEFS } from '../data/npcs';
import { SHOP_DEFS } from '../data/shops';
import {
  ALL_ENTRIES,
  countOfKind,
  contentReference,
  entriesOfKind,
  findEntry,
  findByCategory,
  hasEntry,
  isObtainable,
  itemsForTier,
  listByTag,
  mergeMods,
  sourcesOfItem,
  tagCounts,
  unobtainableEntries,
  type ContentKind
} from '../data/registry';

describe('注册表：汇总的完整性', () => {
  it('★ 每一张内容表的每一条都在册（加了第九张表却忘了登记 = 图鉴少一页，且不报错）', () => {
    const tables: { kind: ContentKind; ids: string[] }[] = [
      { kind: 'item', ids: ITEM_DEFS.map((d) => d.id) },
      { kind: 'box', ids: BOX_DEFS.map((d) => d.id) },
      { kind: 'disaster', ids: DISASTER_DEFS.map((d) => d.id) },
      { kind: 'nightEvent', ids: NIGHT_EVENT_DEFS.map((d) => d.id) },
      { kind: 'dayEvent', ids: DAY_EVENT_DEFS.map((d) => d.id) },
      { kind: 'emergency', ids: EMERGENCY_DEFS.map((d) => d.id) },
      { kind: 'helpRequest', ids: HELP_REQUEST_DEFS.map((d) => d.id) },
      { kind: 'identity', ids: IDENTITY_DEFS.map((d) => d.id) },
      { kind: 'shop', ids: SHOP_DEFS.map((d) => d.id) },
      { kind: 'npc', ids: NPC_DEFS.map((d) => d.id) }
    ];
    const missing: string[] = [];
    for (const { kind, ids } of tables) {
      for (const id of ids) {
        if (!hasEntry(id, kind)) missing.push(`${kind}: ${id}`);
      }
      // 反过来也数一遍：注册表里这个种类的条数必须正好等于表长
      if (countOfKind(kind) !== ids.length) {
        missing.push(`${kind} 计数不符：注册表 ${countOfKind(kind)} vs 表 ${ids.length}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('注册表的总条目数 = 各表之和（没有幽灵条目）', () => {
    const kinds: ContentKind[] = [
      'item',
      'box',
      'disaster',
      'nightEvent',
      'dayEvent',
      'emergency',
      'helpRequest',
      'identity',
      'shop',
      'npc'
    ];
    const sum = kinds.reduce((n, k) => n + countOfKind(k), 0);
    expect(ALL_ENTRIES).toHaveLength(sum);
  });

  it('★ 跨表 id 不许撞车（撞了的话 `findEntry` 只认第一个，第二个永远查不到）', () => {
    const byId = new Map<string, string[]>();
    for (const entry of ALL_ENTRIES) {
      byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry.kind]);
    }
    const clashes = [...byId.entries()]
      .filter(([, kinds]) => kinds.length > 1)
      .map(([id, kinds]) => `${id} 出现在 ${kinds.join(' / ')}`);
    expect(clashes).toEqual([]);
  });

  it('每条内容的 id / name 都非空（图鉴会直接把它们画出来）', () => {
    const bad = ALL_ENTRIES.filter((e) => e.id.length === 0 || e.name.length === 0).map((e) => e.kind + ':' + e.id);
    expect(bad).toEqual([]);
  });
});

describe('注册表：tier（§10B.5 第 3 件）', () => {
  /**
   * ★ 这条是"本仓库的内容必须写 tier"那条规矩的**运行期守卫**。
   *
   * `scripts/check-content.mjs` 只管待入库的 JSON；已经编译进游戏的 TS 表
   * 它管不到。而 tier 是"数百种内容能被渐进放出来"的唯一手段 ——
   * 漏一个就等于那件东西永远没有出场时机（D-16 那一类）。
   */
  it('★ 有 tier 概念的表，每一条都必须写了 tier（0 或 5 也不算）', () => {
    const bad: string[] = [];
    for (const kind of ['item', 'disaster', 'nightEvent', 'dayEvent', 'emergency', 'helpRequest', 'identity', 'shop'] as ContentKind[]) {
      for (const entry of entriesOfKind(kind)) {
        if (entry.tier === undefined) bad.push(`${kind}: ${entry.id} 没写 tier`);
        else if (![1, 2, 3, 4].includes(entry.tier)) bad.push(`${kind}: ${entry.id} 的 tier=${entry.tier} 越界`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('不用分层的表（箱型 / NPC）tier 是 undefined，**不是 1**', () => {
    // "没写"与"写了 1"必须能分开：前者要被揪出来，后者是明确的决定
    for (const kind of ['box', 'npc'] as ContentKind[]) {
      expect(entriesOfKind(kind).every((e) => e.tier === undefined)).toBe(true);
    }
  });

  it('itemsForTier 不会把"没写 tier"的条目当成 tier 1', () => {
    const tier1 = itemsForTier(1);
    expect(tier1.length).toBeGreaterThan(0);
    expect(tier1.every((e) => e.tier === 1)).toBe(true);
    // 箱型没有 tier，所以它一条都不该出现在任何层里
    expect(tier1.some((e) => e.kind === 'box')).toBe(false);
  });
});

describe('注册表：可达性（D-16 的静态版本）', () => {
  it('★ "从哪儿来"是算出来的：卖它的点位 / 开得出它的箱型都对得上真表', () => {
    // 拿一件确定在超市卖的物资验：来源必须真的包含 supermarket
    const sources = sourcesOfItem('canned_beans');
    expect(sources.shops).toContain('supermarket');
    // 而且它确实出现在某个箱子的池子里
    expect(sources.boxes.length).toBeGreaterThan(0);
  });

  it('认不出的物资返回空来源，而不是抛异常（图鉴不许崩在旧数据上）', () => {
    expect(sourcesOfItem('这件物资不存在')).toEqual({ itemId: '这件物资不存在', shops: [], boxes: [] });
  });

  it('★ 现在没有一件物资是"永远拿不到"的（D-16 已随内容补齐清偿）', () => {
    /*
     * D-16 记的就是这件事：`hot_water_bag_gift` 当时不在任何箱子的池子里，
     * 也不在任何点位的 `offers` 里 —— 图鉴上那一格永远空着，而且**没人看得出来**。
     *
     * M3 的内容批次给了它一个真实来源（周末旧货市在卖），所以这条现在应当为空。
     * ★ 它是一条**会真的红**的守卫：往 `ITEM_DEFS` 里加一件没有任何来源的物资，
     * 这里立刻报出它的 id。
     */
    expect(unobtainableEntries('item').map((e) => e.id)).toEqual([]);
  });

  it('isObtainable 与 unobtainableEntries 是同一件事的两种说法（不许打架）', () => {
    for (const entry of entriesOfKind('item')) {
      expect(isObtainable(entry.id)).toBe(!unobtainableEntries('item').some((e) => e.id === entry.id));
    }
  });

  it('灾难与身份的可达性看 tier 1（解锁功能还没做，这是诚实的口径）', () => {
    // 寒潮是唯一的 tier 1，所以它必然可达
    expect(isObtainable('cold_snap')).toBe(true);
    // 更高层的灾难现在拿不到（等 §10B.3.2 的解锁阶梯）—— 它们必须被报出来
    const locked = unobtainableEntries('disaster').map((e) => e.id);
    expect(locked).toContain('heat_wave');
  });
});

describe('注册表：查询 API', () => {
  it('listByTag 找得到带该标签的物资，且结果都真的有那个标签', () => {
    const canned = listByTag('canned', 'item');
    expect(canned.length).toBeGreaterThan(1);
    expect(canned.every((e) => e.tags.includes('canned'))).toBe(true);
  });

  it('findByCategory 对物资按 category 查、对灾难按 family 查', () => {
    expect(findByCategory('food', 'item').every((e) => e.category === 'food')).toBe(true);
    const families = findByCategory('温度', 'disaster').map((e) => e.id);
    expect(families).toContain('cold_snap');
  });

  it('tagCounts 与实际标签用量一致（参照表读它，错了两边都错）', () => {
    const counts = tagCounts();
    for (const [tag, n] of counts) {
      expect(listByTag(tag).length).toBe(n);
    }
  });

  it('★★ tagCounts 只数物资，不把店铺的 `specialty` 混进来', () => {
    /*
     * ## 这条守的是一个真 bug
     *
     * `tagCounts()` 第一版扫全表，于是**店铺的 `specialty`**
     * （"这家店最划算的是什么"）也被当成标签数了进去：
     * `weekend_flea` 的 specialty 里有 `warmth`，于是"带 warmth 标签的物资"
     * 报成 2 件，而实际只有棉被一件。
     *
     * 这个数不对不会报错，只会让"一个 tag 至少要有 3 件物资共用才有意义"
     * 那类判断凭空虚高 —— 而那是给玩家写分区规则用的口径。
     *
     * 所以判据是**逐标签对账**：注册表数的，必须等于物资表里真正带它的件数。
     */
    const direct = new Map<string, number>();
    for (const def of ITEM_DEFS) {
      for (const tag of def.tags) direct.set(tag, (direct.get(tag) ?? 0) + 1);
    }
    expect([...tagCounts('item').entries()].sort()).toEqual([...direct.entries()].sort());

    // 反证：店铺的 specialty 一定**不在**这个口径里（否则就是又混了）
    for (const shop of SHOP_DEFS) {
      for (const word of shop.specialty ?? []) {
        if (direct.has(word)) continue; // 这个巧合是允许的（同一个词两边都用）
        expect(tagCounts('item').has(word), `店铺专长词「${word}」被当成物资标签数进去了`).toBe(false);
      }
    }
  });

  it('★ 箱型的 `hint` 不算标签（它是给玩家看的箱子名，不是分区规则引用的 tag）', () => {
    // 箱型的 hint 是"粮油""常用药"这类中文词组，与物资 tag 同名不同义
    const boxWords = BOX_DEFS.map((b) => b.hint);
    for (const word of boxWords) {
      expect(tagCounts('item').has(word), `箱型标签「${word}」被当成物资标签数进去了`).toBe(false);
    }
  });

  it('findEntry 认不出的 id 返回 null（不是抛异常 —— 调用方是图鉴）', () => {
    expect(findEntry('不可能存在的 id')).toBeNull();
    expect(findEntry('cold_snap')?.kind).toBe('disaster');
  });
});

describe('注册表：mod 挂载点（§10B.5「mod 友好的三条」）', () => {
  it('mergeMods 把外来的内容接上，而且不污染 ALL_ENTRIES', () => {
    const before = ALL_ENTRIES.length;
    const merged = mergeMods({
      item: [
        {
          id: 'mod_test_item',
          name: '外来物资',
          category: 'food',
          icon: 'can',
          unitWeight: 1,
          slotSize: 1,
          stackLimit: 1,
          perishable: false,
          nutrition: {},
          basePrice: 10,
          tags: ['modded'],
          tier: 1
        }
      ]
    });
    expect(merged.length).toBe(before + 1);
    expect(merged.some((e) => e.id === 'mod_test_item')).toBe(true);
    // ★ 关键：`ALL_ENTRIES` 是模块级常量，一次合并不该把它改掉
    // （那会让"同一个进程里合并两次"变成叠加，而 mod 加载是幂等的）
    expect(ALL_ENTRIES.length).toBe(before);
    expect(findEntry('mod_test_item')).toBeNull();
  });

  it('mergeMods 认不出的 kind 直接忽略，不抛异常', () => {
    expect(() => mergeMods({ 不存在的种类: [] } as never)).not.toThrow();
  });
});

describe('注册表：给生成提示词的内容参照（§10B.7 的产能口径）', () => {
  it('参照表里的 id 清单与各表一致（手抄的参照表一定会漂，所以它必须是算出来的）', () => {
    const ref = contentReference();
    const byKind = new Map(ref.kinds.map((k) => [k.kind, k.ids]));
    expect(byKind.get('item')).toEqual(ITEM_DEFS.map((d) => d.id));
    expect(byKind.get('disaster')).toEqual(DISASTER_DEFS.map((d) => d.id));
    expect(byKind.get('shop')).toEqual(SHOP_DEFS.map((d) => d.id));
  });

  it('参照表带上七种品类与全部点位 / 箱型 / NPC 的 id', () => {
    const ref = contentReference();
    expect(ref.categories).toHaveLength(7);
    expect(ref.shopIds).toEqual(SHOP_DEFS.map((s) => s.id));
    expect(ref.boxIds).toEqual(BOX_DEFS.map((b) => b.id));
    expect(ref.npcIds).toEqual(NPC_DEFS.map((n) => n.id));
  });

  it('标签按用量从多到少排（生成者要一眼看出哪些 tag 是真的在用的）', () => {
    const tags = contentReference().tags;
    for (let i = 1; i < tags.length; i++) {
      expect(tags[i - 1]!.count).toBeGreaterThanOrEqual(tags[i]!.count);
    }
  });
});
