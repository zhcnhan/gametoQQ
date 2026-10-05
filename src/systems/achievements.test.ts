/**
 * 成就系统的守护测试（§10B.2 / M3 第 2 步）。
 *
 * ## 这个文件在守什么
 *
 * 成就最容易出的**不是**"条件写错"，而是三类结构性的事：
 *
 *  1. **判据抛异常** —— 它跑在结算页的渲染路径上，一个抛出去的异常
 *     会让玩家看不到结算页。存档可以被手改、云备份可以合并来一份别的版本，
 *     所以"坏输入不崩"必须被验证（`unlockAchievements` 里包了 try）；
 *  2. **重复发** —— 结算页每渲染一次就判一次，而解锁会**写 meta**。
 *     幂等没做对的话，反复刷新结算页能把成就刷满（与 `metaSettled` 同一类错误）；
 *  3. **永不解锁 / 白送** —— 前者是 D-16 那一类（"写了但永远出不来"），
 *     后者是"成就变成了安慰奖"。两边都要有测试钉住。
 *
 * ## 为什么用**造出来的 run** 而不是跑一整局
 *
 * 一条成就的判据读 run 里七八个字段；跑一整局去凑出"最小体力 ≥ 50 且一天没硬撑"
 * 这种局面既慢又不稳。造 run 让每条判据都能**在它自己的边界上**被验：
 * 刚好达成、差一点没达成、以及坏值。
 */
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_RANK_ORDER } from '../data/achievements';
import {
  ACHIEVEMENT_DEFS,
  ACHIEVEMENT_KIND_ORDER,
  achievementTotal,
  achievementsOfKind,
  findAchievement,
  priorityItemIdsOf_测试用
} from '../data/achievements';
import { SURVIVAL_DAYS, hasDisasterDef } from '../data/disaster';
import { ITEM_DEFS } from '../data/items';
import { createMetaProfile } from '../state/save';
import { createStartingRun } from './setup';
import {
  groupByKind,
  isUnlocked,
  orderedUnlocked,
  progressOfKind,
  unknownUnlocked,
  unlockAchievements
} from './achievements';
import type { MetaProfile, RunState } from '../model/types';

/** 一局"走完了、哪一项都没出错"的底线局面。每条用例只改它关心的那一两项 */
function goodRun(over: Partial<RunState> = {}): RunState {
  const run = createStartingRun(20261002);
  run.outcome = 'survived';
  run.day = SURVIVAL_DAYS;
  run.survival.shortagePieces = 0;
  run.survival.unreachablePieces = 0;
  run.survival.hardPressDays = 0;
  run.survival.cleanDays = SURVIVAL_DAYS;
  run.survival.minStamina = 100;
  run.survival.emergencyHurtCount = 0;
  return Object.assign(run, over);
}

function metaWith(over: Partial<MetaProfile> = {}): MetaProfile {
  return Object.assign(createMetaProfile(), over);
}

/** 结算一次：返回新解锁的 id */
function settle(meta: MetaProfile, run: RunState): string[] {
  return unlockAchievements(meta, run, meta.codex).fresh.map((a) => a.id);
}

describe('成就表本身：形状与分类', () => {
  it('id 唯一，而且都有名字与判据（界面上"未解锁"也要写出怎么达成）', () => {
    const ids = ACHIEVEMENT_DEFS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const bad = ACHIEVEMENT_DEFS.filter((a) => !a.name || !a.hint).map((a) => a.id);
    expect(bad).toEqual([]);
  });

  it('五个分类都有内容（§10B.2 那张表：图鉴 / 生存 / 整理 / 极端 / 隐藏）', () => {
    for (const kind of ACHIEVEMENT_KIND_ORDER) {
      expect(achievementsOfKind(kind).length, `分类 ${kind} 一条成就都没有`).toBeGreaterThan(0);
    }
    expect(achievementTotal()).toBe(ACHIEVEMENT_DEFS.length);
  });

  it('★ 成就不给数值增益 —— 表里不许出现任何"奖励"字段', () => {
    /*
     * §10B.2 的硬约束③：一旦成就加数值，最早的成就就成了永久优势，
     * 后开的局再也追不上 —— 这与 §4A 的"不催进度"直接冲突。
     *
     * 这条测试是那条纪律的**可执行形式**：给 `AchievementDef` 加一个 `reward`
     * 字段时它会当场红。它守的不是"现在没问题"，而是"将来加不进来"。
     */
    for (const def of ACHIEVEMENT_DEFS) {
      const keys = Object.keys(def);
      const forbidden = keys.filter((k) => /reward|bonus|grant|unlock(?!ed)/i.test(k));
      expect(forbidden, `${def.id} 带了疑似奖励字段`).toEqual([]);
    }
  });

  it('名字与判据都短到能在一行里放下（手机竖屏）', () => {
    const long = ACHIEVEMENT_DEFS.filter((a) => a.name.length > 12 || a.hint.length > 40).map(
      (a) => `${a.id} name=${a.name.length} hint=${a.hint.length}`
    );
    expect(long).toEqual([]);
  });
});

/**
 * ★★ 成就的**等级**（2026-10 用户要的"难度低的和难度高的都用不同的炫酷特效标记，分等级"）
 *
 * 等级是**一条独立的数据轴**（不是从 `kind` 推的）：同为生存类，
 * 「活过 14 天」与「一件口粮都没缺地活过 14 天」差着量级。
 *
 * 守三件事：
 *  ① 每一档都要有人 —— 空档会让"分等级"在界面上根本看不出来；
 *  ② 每一档都要有多种**特效标记**（界面上是印章的形状与颜色，见 `ui/CodexScreen`）；
 *  ③ 高档不许烂大街：`common` 不能吃掉全部（那是"等级白标了"的另一种形式）。
 */
describe('★★ 成就分等级：三档都要有人，而且高档不许烂大街', () => {
  it('★ 三档都有内容（有一档空着 = "分等级"这件事在界面上看不出来）', () => {
    for (const rank of ACHIEVEMENT_RANK_ORDER) {
      const n = ACHIEVEMENT_DEFS.filter((a) => a.rank === rank).length;
      expect(n, `等级 ${rank} 一条成就都没有`).toBeGreaterThan(0);
    }
  });

  it('★ 低档占多数、高档是少数（等级才读得出分量）', () => {
    const count = (rank: string): number => ACHIEVEMENT_DEFS.filter((a) => a.rank === rank).length;
    const common = count('common');
    const epic = count('epic');
    expect(common, '「常」那一档太少了 —— 等级没有区分度').toBeGreaterThanOrEqual(3);
    expect(epic, '「极」那一档比「常」还多 —— 那不难').toBeLessThan(common);
  });

  it('★ 每一条的 rank 都是合法值（写错字会静默落到"没有等级"）', () => {
    const bad = ACHIEVEMENT_DEFS.filter((a) => !ACHIEVEMENT_RANK_ORDER.includes(a.rank)).map((a) => a.id);
    expect(bad, '这些成就的 rank 不是三档之一').toEqual([]);
  });

  it('★ 灾难专属成就：标了 `disaster` 的必须在判据里真的读这一场', () => {
    /*
     * `disaster` 是**给人看的分类**，不是判据（见那个字段的注释）——
     * 所以这里只能验"标了它的成就确实与灾难有关"：
     * 判据的源码里必须出现 `disasterId`。
     *
     * ⚠ 这条是个**弱判据**（它读不到"是哪一场"），但弱判据胜过没有：
     * 它拦得住"随手复制一条成就、忘了改判据"那类错 ——
     * 而那会让玩家在寒潮局里拿到"热浪专属"的印章。
     */
    const tagged = ACHIEVEMENT_DEFS.filter((a) => a.disaster !== undefined);
    expect(tagged.length, '一条灾难专属成就都没有（用户点名要的）').toBeGreaterThanOrEqual(3);
    const bad = tagged.filter((a) => !a.when.toString().includes('disasterId')).map((a) => a.id);
    expect(bad, '这些成就标了灾难专属，判据里却没读 disasterId').toEqual([]);
  });

  it('★ 标了灾难的成就，那个灾难 id 必须在表里（认不出的 id 会在界面上显示成一串英文）', () => {
    const bad = ACHIEVEMENT_DEFS.filter((a) => a.disaster !== undefined && !hasDisasterDef(a.disaster)).map(
      (a) => `${a.id} → ${a.disaster}`
    );
    expect(bad).toEqual([]);
  });
});

describe('解锁：幂等与持久', () => {
  it('★ 同一个局面判两次，第二次一枚都不发（结算页每渲染一次就要判一次）', () => {
    const meta = metaWith();
    const run = goodRun();
    const first = settle(meta, run);
    expect(first.length).toBeGreaterThan(0);
    const second = settle(meta, run);
    expect(second).toEqual([]);
    // 但账本上还在
    expect(meta.achievements.length).toBe(first.length);
  });

  it('解锁写进 meta.achievements，并且**排序后落盘**（否则存档 diff 全是噪音）', () => {
    const meta = metaWith();
    settle(meta, goodRun());
    expect(meta.achievements.length).toBeGreaterThan(1);
    expect(meta.achievements).toEqual([...meta.achievements].sort());
  });

  it('已经解锁过的不会再出现，但 `unlocked` 全集照旧完整', () => {
    const meta = metaWith();
    const run = goodRun();
    const first = unlockAchievements(meta, run, meta.codex);
    const second = unlockAchievements(meta, run, meta.codex);
    expect(second.fresh).toEqual([]);
    // 全集两次都一样，而且顺序稳定（成就页不能随解锁先后跳位）
    expect(second.unlocked.map((a) => a.id)).toEqual(first.unlocked.map((a) => a.id));
  });

  it('★ 判据抛异常时按"未达成"处理，绝不把结算页弄崩', () => {
    const meta = metaWith();
    const run = goodRun();
    // 造一个"一定会让判据崩"的局面：trust 是 null（手改档 / 云备份合并都可能给出这种）
    (run as unknown as Record<string, unknown>)['trust'] = null;
    expect(() => unlockAchievements(meta, run, meta.codex)).not.toThrow();
    // 结论：涉及 trust 的那条（不发一言的冬天）不该被发出去
    expect(meta.achievements).not.toContain('a_silent_winter');
  });

  it('坏值（NaN / undefined）不会让判定崩，也不会白送', () => {
    const meta = metaWith();
    const run = goodRun();
    (run.survival as unknown as Record<string, unknown>)['minStamina'] = Number.NaN;
    (run.survival as unknown as Record<string, unknown>)['cleanDays'] = undefined;
    expect(() => unlockAchievements(meta, run, meta.codex)).not.toThrow();
    // NaN >= 50 是 false，所以「一路从容」不该被发
    expect(meta.achievements).not.toContain('a_composed');
  });
});

describe('逐条判据：达成 / 差一点 / 边界', () => {
  const id = (meta: MetaProfile, run: RunState, want: string): boolean =>
    settle(meta, run).includes(want);

  it('罐头鉴赏家：点亮全部 canned 才算，差一件就不算', () => {
    const canned = ITEM_DEFS.filter((d) => d.tags.includes('canned')).map((d) => d.id);
    expect(canned.length).toBeGreaterThan(1);

    const almost = metaWith({ codex: { items: canned.slice(0, -1), disasters: [], npcs: [] } });
    expect(id(almost, goodRun(), 'a_canned_connoisseur')).toBe(false);

    const all = metaWith({ codex: { items: [...canned], disasters: [], npcs: [] } });
    expect(id(all, goodRun(), 'a_canned_connoisseur')).toBe(true);
  });

  it('★ 灾难图鉴那条写的是"≥4"而不是"全部"（写死全部会在 112 场那天变成永远拿不到）', () => {
    // 点亮 4 场就该发
    const four = metaWith({ codex: { items: [], disasters: ['a', 'b', 'c', 'd'], npcs: [] } });
    expect(id(four, goodRun(), 'a_all_disasters')).toBe(true);
    // 三场不发
    const three = metaWith({ codex: { items: [], disasters: ['a', 'b', 'c'], npcs: [] } });
    expect(id(three, goodRun(), 'a_all_disasters')).toBe(false);
  });

  it('不发一言的冬天：零求援走完才发；交付过一次就不发', () => {
    const clean = goodRun();
    expect(id(metaWith(), clean, 'a_silent_winter')).toBe(true);

    const helped = goodRun();
    helped.trust = { npc_wang: 2 };
    expect(id(metaWith(), helped, 'a_silent_winter')).toBe(false);
  });

  it('一尘不染：cleanDays 要满期；差一天就不发', () => {
    expect(id(metaWith(), goodRun({ survival: { ...goodRun().survival, cleanDays: SURVIVAL_DAYS } }), 'a_spotless')).toBe(true);
    const short = goodRun();
    short.survival.cleanDays = SURVIVAL_DAYS - 1;
    expect(id(metaWith(), short, 'a_spotless')).toBe(false);
  });

  it('一路从容：看的是**历史最低**体力；中途掉下去就不算（哪怕最后睡回来了）', () => {
    const composed = goodRun();
    composed.survival.minStamina = 50;
    composed.stats.stamina = 100; // 最后一天是满的 —— 那不该救它
    expect(id(metaWith(), composed, 'a_composed')).toBe(true);

    const tired = goodRun();
    tired.survival.minStamina = 49;
    expect(id(metaWith(), tired, 'a_composed')).toBe(false);

    const pressed = goodRun();
    pressed.survival.hardPressDays = 1;
    expect(id(metaWith(), pressed, 'a_composed')).toBe(false);
  });

  it('门口那一块：看的是**累计**受创次数，不是最后一天的快照', () => {
    const clean = goodRun();
    expect(id(metaWith(), clean, 'a_all_handy')).toBe(true);

    const hurtOnce = goodRun();
    hurtOnce.survival.emergencyHurtCount = 1;
    // 最后一次恰好化解了 —— 只看快照的话会误判成满分
    hurtOnce.survival.last.emergencyId = 'e_cut_hand';
    hurtOnce.survival.last.emergencyResolved = true;
    expect(id(metaWith(), hurtOnce, 'a_all_handy')).toBe(false);
  });

  it('仓库管理员：看的是**生涯累计**上架件数（单局做不到 300 件，所以口径必须是累计）', () => {
    expect(id(metaWith({ totalShelved: 299 }), goodRun(), 'a_storekeeper')).toBe(false);
    expect(id(metaWith({ totalShelved: 300 }), goodRun(), 'a_storekeeper')).toBe(true);
  });

  it('★ 先见之明：买过这一场的刚需品类才算（刚需从灾难定义读，不另抄一份）', () => {
    // 寒潮的刚需是 fuel / warmth
    const fuelIds = ITEM_DEFS.filter((d) => d.category === 'fuel').map((d) => d.id);
    expect(fuelIds.length).toBeGreaterThan(0);

    const bought = metaWith({ everBoughtItemIds: [fuelIds[0]!] });
    expect(id(bought, goodRun(), 'a_foresight')).toBe(true);

    // 买过一堆**不相干**的东西（药）不算
    const unrelated = metaWith({
      everBoughtItemIds: ITEM_DEFS.filter((d) => d.category === 'medicine').map((d) => d.id)
    });
    expect(id(unrelated, goodRun(), 'a_foresight')).toBe(false);
  });

  it('倒下的那一局不发任何"走完"类的成就', () => {
    const dead = goodRun({ outcome: 'collapsed' });
    const fresh = settle(metaWith(), dead);
    for (const want of ['a_silent_winter', 'a_no_shortage', 'a_never_unreachable', 'a_spotless', 'a_composed', 'a_all_handy', 'a_foresight']) {
      expect(fresh, `${want} 不该在倒下的那一局发`).not.toContain(want);
    }
  });

  it('认不出的灾难 id 不会让「先见之明」崩（手改档）', () => {
    const bad = goodRun({ disasterId: '这场灾难不存在' });
    expect(() => settle(metaWith({ everBoughtItemIds: ['fuel_can'] }), bad)).not.toThrow();
  });
});

describe('查询 API（成就页读这些）', () => {
  it('orderedUnlocked 按表里的顺序排，不随解锁先后变', () => {
    const meta = metaWith();
    settle(meta, goodRun());
    const ordered = orderedUnlocked(meta).map((a) => a.id);
    const tableOrder = ACHIEVEMENT_DEFS.map((a) => a.id).filter((id) => ordered.includes(id));
    expect(ordered).toEqual(tableOrder);
  });

  it('isUnlocked 对认不出的 id 返回 false（不许把界面弄崩）', () => {
    expect(isUnlocked(metaWith({ achievements: ['不存在的成就'] }), '不存在的成就')).toBe(false);
    expect(isUnlocked(metaWith({ achievements: ['a_spotless'] }), 'a_spotless')).toBe(true);
    expect(findAchievement('不存在的成就')).toBeNull();
  });

  it('★ unknownUnlocked 能把"这个版本已经不认的"成就 id 报出来（不许有来历不明的状态）', () => {
    const meta = metaWith({ achievements: ['a_spotless', 'a_被删掉的成就'] });
    expect(unknownUnlocked(meta)).toEqual(['a_被删掉的成就']);
  });

  it('progressOfKind 的分母与表一致，分子只数已解锁的', () => {
    const meta = metaWith({ achievements: ['a_spotless'] });
    const p = progressOfKind(meta, 'organize');
    expect(p.total).toBe(achievementsOfKind('organize').length);
    expect(p.have).toBe(1);
  });

  it('groupByKind 覆盖全部成就，且不产生空分组', () => {
    const groups = groupByKind(ACHIEVEMENT_DEFS);
    const total = groups.reduce((n, g) => n + g.defs.length, 0);
    expect(total).toBe(ACHIEVEMENT_DEFS.length);
    expect(groups.every((g) => g.defs.length > 0)).toBe(true);
    // 顺序跟 ACHIEVEMENT_KIND_ORDER 走
    expect(groups.map((g) => g.kind)).toEqual(ACHIEVEMENT_KIND_ORDER.filter((k) => achievementsOfKind(k).length > 0));
  });
});

describe('刚需品类的读取口径：从灾难定义来，不另抄一份（§2.8）', () => {
  /**
   * ★ 这条测试守的是**数据源唯一**。
   *
   * 「先见之明」需要知道"这一场最缺哪几类"。这个事实**只有一个真相来源**：
   * `data/disaster.ts` 的 `priorityCategories`。如果哪天有人在成就表里
   * 另抄一份小表，两份会在某次内容调整时分叉 —— 而分叉的那一天，
   * 成就的判据就与玩家实际玩到的东西不一致了，且**没有任何报错**。
   *
   * 所以这里逐场对账：从灾难表读出来的，必须与成就判据用的是同一份。
   */
  it('逐场对账：优先级品类取自灾难表，而且认不出的 id 返回空（不抛异常）', () => {
    for (const id of ['cold_snap', 'heat_wave', 'flood_urban', 'blackout_winter']) {
      const ids = priorityItemIdsOf_测试用(id);
      expect(ids.length, `${id} 的刚需品类一件物资都没有`).toBeGreaterThan(0);
      // 返回的每一件都必须在物资表里
      for (const itemId of ids) expect(ITEM_DEFS.some((d) => d.id === itemId)).toBe(true);
    }
    expect(priorityItemIdsOf_测试用('不存在')).toEqual([]);
  });

  it('寒潮的刚需是燃料与保暖（与灾难表一致）', () => {
    const ids = priorityItemIdsOf_测试用('cold_snap');
    expect(ids).toContain('fuel_can');
    expect(ids).toContain('quilt');
  });
});
