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
