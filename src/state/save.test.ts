import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from './storage';
import {
  SAVE_VERSION,
  STORAGE_KEY,
  createSaveScheduler,
  deserialize,
  loadSave,
  migrate,
  serialize,
  writeSave
} from './save';
import { createStartingRun } from '../systems/setup';
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
    expect(migrated?.run?.shelves[0]?.zoneId).toBe('zone_1'); // 胶带还在货架上，只是不带规则了
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
    expect(migrated?.run?.cash).toBe(900); // 身份自带的开局现金
    expect(migrated?.run?.phase).toBe('organize');
    expect(migrated?.run?.actionPoints).toBe(3);
    expect(migrated?.run?.carLoad).toBe(0);
    expect(migrated?.run?.shopStocks).toEqual([]);
    expect(migrated?.run?.visitedShopIds).toEqual([]);
    expect(migrated?.run?.currentShopId).toBeNull();
  });

  it('day 已经到 0 却还停在囤货期界面 → 修正为 ending（否则永远见不到 D-Day）', () => {
    const run = { ...createStartingRun(5), phase: 'organize' as const, day: 0, identityId: 'group_buyer' };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    expect(deserialize(raw)?.run?.phase).toBe('ending');
  });

  it('day 越界（例如手改成 -30）会被夹回 M1 的 7 天区间', () => {
    const run = { ...createStartingRun(5), phase: 'stockpile_shop' as const, day: -30, identityId: 'group_buyer' };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    expect(deserialize(raw)?.run?.day).toBe(-7);
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
      night: { eventId: 'n_这个事件已经删掉了', choice: null }
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
      night: { eventId: 'n_neighbor_soup', choice: 99 }
    };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    const back = deserialize(raw);
    expect(back?.run?.phase).toBe('night');
    expect(back?.run?.night).toEqual({ eventId: 'n_neighbor_soup', choice: null });
  });

  it('夜色自愈③：不在夜里却留着夜色 → 清掉（否则下次入夜会读到上一晚的残影）', () => {
    const run = {
      ...createStartingRun(5),
      phase: 'organize' as const,
      day: -3,
      identityId: 'group_buyer',
      night: { eventId: 'n_neighbor_soup', choice: 0 }
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
      night: { eventId: 'n_neighbor_soup', choice: 0 }
    };
    const raw = serialize({ meta: { version: SAVE_VERSION } as never, run, savedAt: 1, syncVersion: 1, deviceId: 'dev' });
    const back = deserialize(raw);
    expect(back?.run?.phase).toBe('night');
    expect(back?.run?.night).toEqual({ eventId: 'n_neighbor_soup', choice: 0 });
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
