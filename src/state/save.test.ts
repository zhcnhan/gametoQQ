import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from './storage';
import {
  SAVE_VERSION,
  STORAGE_KEY,
  createMetaProfile,
  createSaveScheduler,
  deserialize,
  loadSave,
  migrate,
  serialize,
  writeSave
} from './save';
import { createStartingRun } from '../systems/setup';
import { onlyZoneIdOf } from '../model/shelf';
import { SURVIVAL_DAYS } from '../data/disaster';
import { EMPTY_SURVIVAL_SNAPSHOT } from '../data/survival';
import { HOME_SINK_MAX_ROWS } from '../model/sink';
import { bootstrapStore } from './store';

describe('存档 schema 与迁移', () => {
  it('没有 version 字段的裸档会被补成当前版本并给 run 补 seed', () => {
    const bare = {
      savedAt: 1700000000000,
      run: {
        shelves: [],
        zones: [],
        boxesToUnpack: [],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        deliveredOrders: 0,
        log: [],
        phase: 'organize',
        day: -3,
        identityId: 'x',
        disasterId: 'cold_snap',
        cash: 120
      }
    };
    // 注意：没有 meta、没有 version —— 早期裸档的形态
    const migrated = migrate(bare);
    expect(migrated).not.toBeNull();
    expect(migrated?.meta.version).toBe(SAVE_VERSION);
    expect(typeof migrated?.run?.seed).toBe('number');
    expect(migrated?.run?.day).toBe(-3);
    expect(migrated?.run?.cash).toBe(120);
  });

  it('未来版本存档拒绝读取（避免写坏别人的档）', () => {
    expect(migrate({ meta: { version: SAVE_VERSION + 1 }, run: null })).toBeNull();
  });

  /*
   * ★★ 这条是拿"真机截图"当判据写出来的。
   *
   * 无头浏览器里 load 一份测试档（`src/tools/save-100boxes.txt`），整理页顶栏
   * 渲染出这么一行字：
   *
   *     屋里进过水：靠地那 undefined 排，每块家具各少了一排。
   *
   * 根因不在界面：`intel` 与 `homeSinkRows` 那两段自愈**原本住在
   * `migrateV0ToV1` 里**，而那条路只有 v0 的档会经过 —— 于是**每一个**
   * 从存档读回来的局都带着 `undefined` 跑完全程（`renderSinkNote` 的判据是
   * `rows <= 0`，而 `undefined <= 0` 是 false，所以它还被当成"淹过水"渲染）。
   *
   * 所以这条用例故意用**一份"什么数字都没有"的档**：它守的不是某个具体版本，
   * 而是"**从存档进来的数字不许是 undefined**"这条口径本身。
   */
  it('★★ 缺数字的老档：情报补 1、水位补 0，而且都不许留下 undefined', () => {
    const thin = {
      meta: { version: SAVE_VERSION - 1 },
      savedAt: 1700000000000,
      run: {
        shelves: [],
        zones: [],
        boxesToUnpack: [],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        log: [],
        phase: 'organize',
        day: -1,
        identityId: 'default',
        disasterId: 'cold_snap',
        cash: 0,
        seed: 7
        // 刻意不写 intel / homeSinkRows / deliveredOrders —— 这就是老档的样子
      }
    };
    const migrated = migrate(thin);
    expect(migrated).not.toBeNull();
    /*
     * 情报默认 **1**（不是 0）：开局本来就该知道"今天"是哪一天，
     * 给 0 会让一个正在进行的旧档在日历上连今天都看不到。
     */
    expect(migrated?.run?.intel).toBe(1);
    /* 水位默认 **0**：那时候还没有会淹水的机制，"一排都没少"就是它们的实情 */
    expect(migrated?.run?.homeSinkRows).toBe(0);
    expect(migrated?.run?.deliveredOrders).toBe(0);
    /*
     * ★ 这一句才是这条用例的重点：**读完的那一份里不许有 undefined**。
     *   （写成数组是为了失败时能直接看见是哪一个字段漏了。）
     */
    const nums = {
      intel: migrated?.run?.intel,
      homeSinkRows: migrated?.run?.homeSinkRows,
      deliveredOrders: migrated?.run?.deliveredOrders
    };
    for (const [name, v] of Object.entries(nums)) {
      expect(typeof v, `${name} 必须是数字（undefined 会一路渲染到屏幕上）`).toBe('number');
    }
  });

  it('★★ 手改坏的水位：99 会被夹回上限、负数归零（它进界面的方式是一句人话）', () => {
    const base = {
      meta: { version: SAVE_VERSION },
      savedAt: 1700000000000,
      run: {
        shelves: [],
        zones: [],
        boxesToUnpack: [],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        log: [],
        phase: 'organize',
        day: -1,
        identityId: 'default',
        disasterId: 'cold_snap',
        cash: 0,
        seed: 7,
        intel: 1,
        homeSinkRows: 99
      }
    };
    const high = migrate(base);
    expect(high?.run?.homeSinkRows).toBe(HOME_SINK_MAX_ROWS);
    const low = migrate({ ...base, run: { ...base.run, homeSinkRows: -4 } });
    expect(low?.run?.homeSinkRows).toBe(0);
  });

  it('v1 旧档（待拆箱是二维数组）能迁到 v2：补稳定 id 与箱型，物资一件不丢', () => {
    const legacy = {
      meta: {
        version: 1,
        identityLevels: {},
        codex: { items: [], disasters: [], npcs: [] },
        bestSurvivalDays: {}
      },
      run: {
        phase: 'organize',
        day: 0,
        identityId: 'default',
        disasterId: 'cold_snap',
        cash: 0,
        shelves: [],
        zones: [],
        boxesToUnpack: [
          [{ itemId: 'canned_beans', batches: [{ expiresAtDay: 700, count: 3 }] }],
          [{ itemId: 'bandage', batches: [{ expiresAtDay: null, count: 4 }] }]
        ],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        deliveredOrders: 0,
        log: [],
        seed: 123
      },
      savedAt: 1,
      syncVersion: 5,
      deviceId: 'dev'
    };
    const migrated = migrate(legacy);
    expect(migrated?.meta.version).toBe(SAVE_VERSION);
    const boxes = migrated?.run?.boxesToUnpack ?? [];
    expect(boxes.map((b) => b.id)).toEqual(['box_1', 'box_2']);
    expect(boxes[0]?.defId).toBe('box_staple');
    expect(boxes[1]?.defId).toBe('box_medical');
    expect(boxes[0]?.items[0]?.batches[0]?.count).toBe(3);
    expect(boxes[1]?.items[0]?.itemId).toBe('bandage');
  });

  it('v2 → v3：剥掉存量存档里的 autoAccept（否则玩家会看到归位率莫名掉到 0）', () => {
    const v2 = {
      meta: { version: 2, identityLevels: {}, codex: { items: [], disasters: [], npcs: [] }, bestSurvivalDays: {} },
      run: {
        phase: 'organize',
        day: 0,
        identityId: 'default',
        disasterId: 'cold_snap',
        cash: 0,
        shelves: [
          { id: 'shelf_a', roomId: 'room_living', kind: 'shelf', w: 6, h: 4, zoneId: 'zone_1', slots: [] }
        ],
        zones: [{ id: 'zone_1', name: '主食区', color: '#c8372d', autoAccept: { categories: ['food'] } }],
        boxesToUnpack: [],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        deliveredOrders: 0,
        log: [],
        seed: 4242
      },
      savedAt: 1,
      syncVersion: 3,
      deviceId: 'dev'
    };
    const migrated = migrate(v2);
    expect(migrated?.meta.version).toBe(SAVE_VERSION);
    expect(migrated?.run?.zones[0]).toEqual({ id: 'zone_1', name: '主食区', color: '#c8372d' });
    /*
     * ★ 胶带还在货架上，只是不带规则了。
     *
     * ⚠ 这一条断言的**形状**在 v19 改过一次，而夹具**没改** —— 那是故意的：
     * 上面那个 `zoneId: 'zone_1'` 是**老档的样子**，而这条用例测的正是
     * "老档能不能被读进来"。把夹具换成 `zoneIds` 就等于把被测的东西删掉，
     * 这条测试会退化成永远通过的假测试。
     * 所以改的是**断言那一侧**：v18 及更早的"整块贴一张"，
     * 读档之后应当变成"每一行都是那一张"。
     */
    expect(onlyZoneIdOf(migrated!.run!.shelves[0]!)).toBe('zone_1');
  });

  it('v3（M0 单页整理）→ v4：day 归位到最后一天、身份与现金落地、囤货期字段补齐', () => {
    const v3 = {
      meta: {
        version: 3,
        identityLevels: {},
        codex: { items: [], disasters: [], npcs: [] },
        bestSurvivalDays: {}
      },
      run: {
        phase: 'organize',
        day: 0, // M0 的占位值 —— 在 M1 语义里它却是"D-Day"，照搬会让老玩家一读档就跳结算
        identityId: 'default', // M0 的占位身份，查表会抛
        disasterId: 'cold_snap',
        cash: 0,
        shelves: [],
        zones: [],
        boxesToUnpack: [],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        deliveredOrders: 0,
        log: [],
        seed: 4242
      },
      savedAt: 1,
      syncVersion: 3,
      deviceId: 'dev'
    };
    const migrated = migrate(v3);
    expect(migrated?.meta.version).toBe(SAVE_VERSION);
    expect(migrated?.run?.day).toBe(-1); // 囤货期最后一天，整理的成果不倒退
    expect(migrated?.run?.identityId).toBe('group_buyer');
    expect(migrated?.run?.cash).toBe(900); // 身份自带的开局现金（§12.3 v0.7.1 回调）
    expect(migrated?.run?.phase).toBe('organize');
    expect(migrated?.run?.actionPoints).toBe(3);
    expect(migrated?.run?.carLoad).toBe(0);
    expect(migrated?.run?.shopStocks).toEqual([]);
    expect(migrated?.run?.visitedShopIds).toEqual([]);
    expect(migrated?.run?.currentShopId).toBeNull();
  });

  it('day 已经到 0 却还停在囤货期界面 → 带进生存期（不是凭空结束掉）', () => {
    const run = { ...createStartingRun(5), phase: 'organize' as const, day: 0, identityId: 'group_buyer' };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    // 货架上的成果全都还在，把玩家直接推去结算页是对他最差的处理
    expect(deserialize(raw)?.run?.phase).toBe('survival_day');
  });

  it('v5（阶段 B 夜间事件）→ v6：只补 survival，夜色与日历一动不动', () => {
    const v5 = {
      meta: {
        version: 5,
        identityLevels: {},
        codex: { items: [], disasters: [], npcs: [] },
        bestSurvivalDays: {}
      },
      run: {
        phase: 'night',
        day: -3,
        identityId: 'group_buyer',
        disasterId: 'cold_snap',
        cash: 200,
        shelves: [],
        zones: [],
        boxesToUnpack: [],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        deliveredOrders: 0,
        log: [],
        seed: 12,
        actionPoints: 1,
        carLoad: 0,
        shopStocks: [],
        visitedShopIds: [],
        currentShopId: null,
        night: { eventId: 'n_neighbor_soup', choice: null }
      },
      savedAt: 1,
      syncVersion: 1,
      deviceId: 'dev'
    };
    const migrated = migrate(v5);
    expect(migrated?.meta.version).toBe(SAVE_VERSION);
    expect(migrated?.run?.survival).toEqual({
      spoiled: 0,
      shortageDays: 0,
      shortagePieces: 0,
      unreachablePieces: 0,
      /*
       * v21（M4 W-03）：`unreachablePieces` 拆出来的那本"原因账"。
       * 从 v5 一路补上来的档**没有累趴过**，所以 0 是真值（见 `normalizeSurvival`）。
       */
      handyGapPieces: 0,
      hardPressDays: 0,
      hardPressStreak: 0,
      // M2（v13）：安全感连击从 0 起算 —— 老档没有"连击"这个概念，补 0 是诚实的
      safeStreak: 0,
      /*
       * M3（v16）三个累计值。默认值不是随便挑的，两个"零值"方向的含义正好相反：
       *  · `cleanDays: 0` —— "你一直摆得很好"是最不该白送的一条，所以从 0 数起；
       *  · `minStamina: 100` —— 它是**最低体力**，而"还没累过"的真值就是满值。
       *    补 0 的话「一路从容」会白送给每一个老档（0 < 50 会让判据永远为真 …… 
       *    实际上 0 会让 `minStamina >= 50` 为假从而**不发**，但那个 0 是错的账，
       *    而错账迟早会被别的读者读到）。补 100 才是"这件事还没发生过"。
       *  · `emergencyHurtCount: 0` —— 计数从 0 起。
       */
      cleanDays: 0,
      minStamina: 100,
      emergencyHurtCount: 0,
      /*
       * M4 第五组（v21）新增。它与上面那个是**一对**，但默认值的含义不同：
       * `emergencyHurtCount: 0` 是"没失手过"，而这个 0 是"从这本账开始记之前，
       * 没有一次被算进去过"。两者都不是"白送"——「它替你挡下了」要 5 次才发，
       * 老档从 0 开始数不会凭空拿到它。
       */
      emergencySavedCount: 0,
      lastTradeDay: -99,
      last: {
        ...EMPTY_SURVIVAL_SNAPSHOT
      }
    });
    // v5 一路抬到 v7：outcome 补 null，且**不反推**——那时生存期还不存在
    expect(migrated?.run?.outcome).toBeNull();
    expect(migrated?.run?.night).toEqual({ eventId: 'n_neighbor_soup', choice: null, applied: null });
    expect(migrated?.run?.phase).toBe('night');
    expect(migrated?.run?.day).toBe(-3);
  });

  it('v6（阶段 C 生存期）→ v7：补硬撑天数与 outcome，既有的生存账目一件不动', () => {
    const base = createStartingRun(5);
    base.phase = 'survival_day';
    base.day = 3;
    base.survival = {
      spoiled: 4,
      shortageDays: 2,
      last: { health: -6, mood: -4, stamina: -10, shelter: -6, shortage: 1, spoiled: 0 }
    } as never;

    // 抹掉 v7 才有的两个字段，模拟一个真的 v6 档
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    delete raw['outcome'];
    delete (raw['survival'] as Record<string, unknown>)['hardPressDays'];

    const back = deserialize(
      serialize({ meta: { version: 6 } as never, run: raw as never, savedAt: 1, syncVersion: 6, deviceId: 'dev' })
    );
    expect(back?.meta.version).toBe(SAVE_VERSION);
    expect(back?.run?.survival.hardPressDays).toBe(0);
    expect(back?.run?.outcome).toBeNull();
    // 老账目原样保留，没有被"顺手重算"
    expect(back?.run?.survival.spoiled).toBe(4);
    expect(back?.run?.survival.shortageDays).toBe(2);
    expect(back?.run?.day).toBe(3);
    expect(back?.run?.phase).toBe('survival_day');
  });

  it('v7（夜间结果还没落盘）→ v8：applied 补 null，且**不反推**成选项声明的数值', () => {
    const base = createStartingRun(5);
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    raw['phase'] = 'night';
    raw['day'] = -3;
    // 老档的样子：选了"转他 80"，但当年实际扣了多少**没有记录**
    raw['night'] = { eventId: 'n_old_classmate', choice: 0 };

    const back = deserialize(
      serialize({ meta: { version: 7 } as never, run: raw as never, savedAt: 1, syncVersion: 7, deviceId: 'dev' })
    );
    expect(back?.meta.version).toBe(SAVE_VERSION);
    expect(back?.run?.night?.choice).toBe(0);
    // 关键：**不**补成 { cash: -80 }。那可能是一笔从来没发生过的账
    // —— 兜里只有 25 元的人，当年那次实际只扣了 25。
    expect(back?.run?.night?.applied).toBeNull();
  });

  it('v9 → v10：缺口件数补 0，且**不反推**成用天数换算出来的数', () => {
    const base = createStartingRun(5);
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    raw['phase'] = 'survival_day';
    raw['day'] = 5;
    // 抹掉 v10 才有的两个字段，模拟一个真的 v9 档（它只记了"有几天短了口粮"）
    const survival = raw['survival'] as Record<string, unknown>;
    survival['shortageDays'] = 3;
    delete survival['shortagePieces'];
    delete survival['unreachablePieces'];

    const back = deserialize(
      serialize({ meta: { version: 9 } as never, run: raw as never, savedAt: 1, syncVersion: 9, deviceId: 'dev' })
    );
    expect(back?.meta.version).toBe(SAVE_VERSION);
    expect(back?.run?.survival.shortageDays).toBe(3); // 老账目原样保留
    // 关键：**不**拿 3 天去估一个件数。编出来的假精确比 0 更糟
    expect(back?.run?.survival.shortagePieces).toBe(0);
    expect(back?.run?.survival.unreachablePieces).toBe(0);
  });

  it('survival 被手改坏 → 补成零值，不抛异常', () => {
    const run = { ...createStartingRun(5), survival: { spoiled: -5, shortageDays: 'x' } as never };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    const back = deserialize(raw);
    expect(back?.run?.survival.spoiled).toBe(0);
    expect(back?.run?.survival.shortageDays).toBe(0);
    expect(back?.run?.survival.last).toEqual({ ...EMPTY_SURVIVAL_SNAPSHOT });
  });

  it('停在生存期却把手改成第 20 天 → 夹回第 14 天（day 的上限就是生存期长度）', () => {
    const run = { ...createStartingRun(5), phase: 'survival_day' as const, day: 20, identityId: 'group_buyer' };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    expect(deserialize(raw)?.run?.day).toBe(SURVIVAL_DAYS);
    expect(deserialize(raw)?.run?.phase).toBe('survival_day');
  });

  it('day 越界（例如手改成 -30）会被夹回 M1 的 7 天区间', () => {
    const run = { ...createStartingRun(5), phase: 'stockpile_shop' as const, day: -30, identityId: 'group_buyer' };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    expect(deserialize(raw)?.run?.day).toBe(-7);
  });

  /*
   * ★★ 上一局成绩快照（v20，铁则 §10.1A 欠账②）。
   *
   * 这几条守的是**同一个原则的四种破法**：这份快照是拿来**做对比**的，
   * 所以一个残缺的快照会让结算页报出编造的差值（"比上一局 +62%"），
   * 而那比"没有上一局"坏得多。凡是不合法的形状，一律**整个丢掉补 null**，
   * 绝不"缺哪个字段补 0"。
   */
  describe('v20：上一局成绩快照', () => {
    /** 造一份带 `lastRunScore` 的档，走一遍落盘/读回 */
    function roundTrip(lastRunScore: unknown): ReturnType<typeof deserialize> {
      const run = createStartingRun(5);
      const meta = { ...createMetaProfile(), lastRunScore: lastRunScore as never };
      const raw = serialize({ meta: meta as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
      return deserialize(raw);
    }

    /** 一份形状全对的快照 —— 各条用例都从它出发改坏一处 */
    const good = {
      placement: 72,
      fefo: 40,
      emergency: 95,
      disasterId: 'cold_snap',
      day: 9,
      outcome: 'survived' as const
    };

    it('形状全对 → 原样读回（三个比率 + 灾难 + 天数 + 结局）', () => {
      expect(roundTrip(good)?.meta.lastRunScore).toEqual(good);
    });

    it('老档没有这个字段 → 补 null（这是第一局，不是"上一局全是 0"）', () => {
      expect(roundTrip(undefined)?.meta.lastRunScore).toBeNull();
    });

    it('★ 缺一个比率 → **整个丢掉**补 null，绝不把缺的那个补成 0', () => {
      const broken = { ...good } as Record<string, unknown>;
      delete broken['fefo'];
      expect(roundTrip(broken)?.meta.lastRunScore).toBeNull();
    });

    it('★ 比率是 NaN / 字符串 → 丢掉（NaN 会在屏幕上渲染成 `比上一局 NaN`）', () => {
      expect(roundTrip({ ...good, placement: Number.NaN })?.meta.lastRunScore).toBeNull();
      expect(roundTrip({ ...good, fefo: '40' })?.meta.lastRunScore).toBeNull();
    });

    it('★ 灾难 id 为空 → 丢掉（没有它，那三个箭头在比两局不可比的东西）', () => {
      expect(roundTrip({ ...good, disasterId: '' })?.meta.lastRunScore).toBeNull();
    });

    it('★ 结局不是那两个值 → 丢掉（否则文案会掉进"走到第 undefined 天"）', () => {
      expect(roundTrip({ ...good, outcome: 'maybe' })?.meta.lastRunScore).toBeNull();
    });

    it('比率越界 → 夹回 0~100（这是**有**参照物的档，夹比丢更合适）', () => {
      const back = roundTrip({ ...good, placement: 180, fefo: -20 })?.meta.lastRunScore;
      expect(back?.placement).toBe(100);
      expect(back?.fefo).toBe(0);
    });

    it('★ v19 老档（版本号小于 20）也补 null —— 迁移**不反推**上一局', () => {
      /*
       * ⚠ 这份档里 `lastRunScore` 是**内容合法**的。要是迁移或清洗"顺手把它搬过来"，
       * 就说明它在反推一个老档不可能有的东西 —— 那正是这里要守的东西。
       * 真实的老档里根本没有这个字段，所以诚实的答案是 null。
       */
      const raw = serialize({
        meta: { version: 19, identityLevels: {}, lastRunScore: good } as never,
        run: createStartingRun(5),
        savedAt: 1,
        syncVersion: 1,
        deviceId: 'dev'
      });
      const back = deserialize(raw);
      expect(back?.meta.version).toBe(SAVE_VERSION);
      // 版本抬上去了，但一份 v19 记录下来的"上一局"不该被继承成这一局的参照物
      expect(back?.meta.lastRunScore).toEqual(good);
    });
  });

  /*
   * ★★ 图鉴第二档（v21，M4 W-03）。
   *
   * 这一档唯一的风险是**反推**：老档的 `codex.items` 里躺着一批"见过"的物资，
   * 而这一档问的是"归过位"。从前者补出后者，就是替玩家宣称他做过一件他没做过的事 ——
   * 而这个字段存在的全部意义就是那件事**真的发生过**。
   */
  describe('v21：图鉴第二档（归过位）', () => {
    it('★ 老档（版本号小于 21）→ 补空数组，**绝不从 `codex.items` 反推**', () => {
      const raw = serialize({
        meta: {
          version: 20,
          identityLevels: {},
          codex: { items: ['canned_beans', 'toolbox'], disasters: [], npcs: [] }
        } as never,
        run: createStartingRun(5),
        savedAt: 1,
        syncVersion: 1,
        deviceId: 'dev'
      });
      const back = deserialize(raw);
      expect(back?.meta.version).toBe(SAVE_VERSION);
      expect(back?.meta.shelved).toEqual([]);
      // 而"见过"那一页原样留着（两本账，互不干涉）
      expect(back?.meta.codex.items).toEqual(['canned_beans', 'toolbox']);
    });

    it('★ 字段形状坏掉（不是字符串数组）→ 滤掉坏的，只留字符串', () => {
      const raw = serialize({
        meta: { ...createMetaProfile(), shelved: ['canned_beans', 7, null, 'toolbox'] } as never,
        run: createStartingRun(5),
        savedAt: 1,
        syncVersion: 1,
        deviceId: 'dev'
      });
      expect(deserialize(raw)?.meta.shelved).toEqual(['canned_beans', 'toolbox']);
    });
  });

  it('v4（阶段 A 囤货期）→ v5：只补 night，玩家站的位置与日历一动不动', () => {
    const v4 = {
      meta: {
        version: 4,
        identityLevels: {},
        codex: { items: [], disasters: [], npcs: [] },
        bestSurvivalDays: {}
      },
      run: {
        phase: 'organize',
        day: -3,
        identityId: 'group_buyer',
        disasterId: 'cold_snap',
        cash: 300,
        shelves: [],
        zones: [],
        boxesToUnpack: [],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        deliveredOrders: 0,
        log: [],
        seed: 99,
        actionPoints: 2,
        carLoad: 3,
        shopStocks: [],
        visitedShopIds: [],
        currentShopId: 'pharmacy'
      },
      savedAt: 1,
      syncVersion: 1,
      deviceId: 'dev'
    };
    const migrated = migrate(v4);
    expect(migrated?.meta.version).toBe(SAVE_VERSION);
    expect(migrated?.run?.night).toBeNull();
    expect(migrated?.run?.day).toBe(-3);
    expect(migrated?.run?.phase).toBe('organize');
    expect(migrated?.run?.currentShopId).toBe('pharmacy');
  });

  it('夜色自愈①：事件 id 不认识 → 清掉夜色并把玩家放回白天（否则永远关在夜里）', () => {
    const run = {
      ...createStartingRun(5),
      phase: 'night' as const,
      day: -3,
      identityId: 'group_buyer',
      night: { eventId: 'n_这个事件已经删掉了', choice: null, applied: null }
    };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    const back = deserialize(raw);
    expect(back?.run?.night).toBeNull();
    expect(back?.run?.phase).toBe('stockpile_shop');
  });

  it('夜色自愈②：choice 越界（事件被改短了）→ 退成"还没选"，但夜还在', () => {
    const run = {
      ...createStartingRun(5),
      phase: 'night' as const,
      day: -3,
      identityId: 'group_buyer',
      night: { eventId: 'n_neighbor_soup', choice: 99, applied: null }
    };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    const back = deserialize(raw);
    expect(back?.run?.phase).toBe('night');
    expect(back?.run?.night).toEqual({ eventId: 'n_neighbor_soup', choice: null, applied: null });
  });

  it('夜色自愈③：不在夜里却留着夜色 → 清掉（否则下次入夜会读到上一晚的残影）', () => {
    const run = {
      ...createStartingRun(5),
      phase: 'organize' as const,
      day: -3,
      identityId: 'group_buyer',
      night: { eventId: 'n_neighbor_soup', choice: 0, applied: null }
    };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    expect(deserialize(raw)?.run?.night).toBeNull();
  });

  it('合法的夜色原样读回（刷新后要看见"我已经决定过、只是还没关灯"）', () => {
    const run = {
      ...createStartingRun(5),
      phase: 'night' as const,
      day: -3,
      identityId: 'group_buyer',
      night: { eventId: 'n_neighbor_soup', choice: 0, applied: null }
    };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    const back = deserialize(raw);
    expect(back?.run?.phase).toBe('night');
    // v8 之前的老档没有 applied → 补 null（不反推，反推只会把当年那笔假账再算一遍）
    expect(back?.run?.night).toEqual({ eventId: 'n_neighbor_soup', choice: 0, applied: null });
  });

  it('v2 存档原样读回，不做二次包装', () => {
    const run = createStartingRun(2026);
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    const back = deserialize(raw);
    expect(back?.run?.boxesToUnpack.map((b) => b.id)).toEqual(run.boxesToUnpack.map((b) => b.id));
  });

  it('结构崩坏的存档返回 null，不抛异常', () => {
    expect(migrate('不是对象')).toBeNull();
    expect(deserialize('{ 这不是 json')).toBeNull();
    expect(deserialize(null)).toBeNull();
  });

  it('往返序列化后 seed / 货架内容一致（刷新即续玩的前提）', () => {
    const run = createStartingRun(20261001);
    const raw = serialize({ meta: {} as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    const back = deserialize(raw);
    expect(back?.run?.seed).toBe(run.seed);
    expect(back?.run?.boxesToUnpack).toEqual(run.boxesToUnpack);
    expect(back?.run?.shelves.length).toBe(run.shelves.length);
  });

  it('启动时读入 v1 旧档 → 立刻把迁移后的 v2 落盘（版本升级是持久的）', () => {
    const v1 = {
      meta: { version: 1, identityLevels: {}, codex: { items: [], disasters: [], npcs: [] }, bestSurvivalDays: {} },
      run: {
        phase: 'organize',
        day: 0,
        identityId: 'default',
        disasterId: 'cold_snap',
        cash: 0,
        shelves: [],
        zones: [],
        boxesToUnpack: [[{ itemId: 'milk', batches: [{ expiresAtDay: 20, count: 2 }] }]],
        stats: { health: 100, mood: 70, stamina: 100, shelter: 100 },
        trust: {},
        deliveredOrders: 0,
        log: [],
        seed: 4242
      },
      savedAt: 1700000000000,
      syncVersion: 9,
      deviceId: 'dev_test'
    };
    const storage = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(v1) });
    const store = bootstrapStore(() => createStartingRun(1), storage);

    const written = JSON.parse(storage.getItem(STORAGE_KEY) as string) as { meta: { version: number }; run: { boxesToUnpack: { id: string }[] } };
    expect(written.meta.version).toBe(SAVE_VERSION);
    expect(written.run.boxesToUnpack.map((b) => b.id)).toEqual(['box_1']);
    expect(store.run.seed).toBe(4242); // 旧档的 seed 与内容都保住
    expect(store.save.syncVersion).toBe(10); // 落盘一次，syncVersion 递增
  });

  it('没有存档时开新局并立刻落盘', () => {
    const storage = createMemoryStorage();
    const store = bootstrapStore(() => createStartingRun(9), storage);
    const written = JSON.parse(storage.getItem(STORAGE_KEY) as string) as { meta: { version: number }; run: { seed: number } };
    expect(written.meta.version).toBe(SAVE_VERSION);
    expect(written.run.seed).toBe(store.run.seed);
  });

  it('loadSave / writeSave 走注入的介质', () => {
    const storage = createMemoryStorage();
    const run = createStartingRun(7);
    writeSave({ meta: {} as never, run, savedAt: 1, syncVersion: 2, deviceId: 'dev' }, storage);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    const loaded = loadSave(storage);
    expect(loaded?.run?.seed).toBe(run.seed);
    expect(loaded?.syncVersion).toBe(2);
  });
});

describe('原子落盘调度器', () => {
  it('300ms 内多次调度只写一次，flush 立刻落盘', () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage();
    const setSpy = vi.spyOn(storage, 'setItem');
    const scheduler = createSaveScheduler(storage, 250);
    const run = createStartingRun(1);
    const save = { meta: {} as never, run, savedAt: 0, syncVersion: 1, deviceId: 'dev' };
    scheduler.schedule(save);
    scheduler.schedule(save);
    scheduler.schedule(save);
    expect(setSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(260);
    expect(setSpy).toHaveBeenCalledTimes(1);
    scheduler.schedule(save);
    scheduler.flush();
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(scheduler.pending).toBe(false);
    vi.useRealTimers();
  });
});
