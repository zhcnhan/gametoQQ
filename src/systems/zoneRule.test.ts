/**
 * 胶带的「清单」与归位率。
 *
 * 这套测试钉的是一条设计契约（§5 引擎①）：
 *   规则由**玩家**写，游戏只负责数数，既不预设答案，也不指责。
 * 归位率从此有了可回答的含义 —— "你有没有按自己写的清单放" —— 而不是
 * 老版本那句自相矛盾的"物资有没有放在它自己那块分区里"（"它自己的分区"是谁定的？）。
 */
import { describe, expect, it } from 'vitest';
import { getItemDef } from '../data/items';
import { ZONE_COLORS } from '../data/palette';
import { isOffZone, makeStack, onlyZoneIdOf, placementRate, setSlotStack, shelfIsEmpty } from '../model/shelf';
import type { SlotPos, Zone } from '../model/types';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { applyZone, assignZone, createOrganizeSession } from './organize';
import { createStartingRun } from './setup';

const RED = ZONE_COLORS[0] as string;
const BLUE = ZONE_COLORS[3] as string;
const P0: SlotPos = { row: 0, col: 0 };
const P1: SlotPos = { row: 0, col: 1 };

function setup(seed = 20261001) {
  const run = createStartingRun(seed);
  const store = new GameStore(createSaveGame(run), {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  });
  const session = createOrganizeSession();
  return { store, session };
}

/** 直接往货架上放一件指定物资（测试里允许绕开命令层，好让品类是确定的） */
function seedItem(store: GameStore, shelfId: string, pos: SlotPos, itemId: string): void {
  store.commit((draft) => {
    const index = draft.shelves.findIndex((s) => s.id === shelfId);
    const shelf = draft.shelves[index];
    if (!shelf) return;
    draft.shelves[index] = setSlotStack(shelf, pos, makeStack(itemId, 1, null));
  });
}

function rate(store: GameStore): number {
  return placementRate(store.run.shelves, store.run.zones);
}

describe('归位率 = 你有没有按自己写的清单放', () => {
  it('★ §12 v0.8：不填清单 = 什么都收，但归位率**不再**恒满（loophole 已修）', () => {
    const { store } = setup();
    seedItem(store, 'shelf_a', P0, 'canned_beans');
    seedItem(store, 'shelf_a', P1, 'bandage');
    applyZone(store, 'shelf_a', { name: '随便放', color: RED });

    // 落盘仍然不保留空的 autoAccept —— "我不分类"照样是一种贴法，
    // 只是它不再能拿归位率的分：没有清单，就无从谈起"按清单放"
    expect(store.run.zones[0]?.autoAccept).toBeUndefined();
    expect(rate(store)).toBe(0);
  });

  it('写了清单、东西放对 → 满', () => {
    const { store } = setup();
    seedItem(store, 'shelf_a', P0, 'canned_beans');
    seedItem(store, 'shelf_a', P1, 'mineral_water');
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food', 'water'] });

    expect(store.run.zones[0]?.autoAccept).toEqual({ categories: ['food', 'water'] });
    expect(rate(store)).toBe(1);
  });

  it('写了清单、放错 → 掉分（这一句现在终于能被玩家自己验证）', () => {
    const { store } = setup();
    seedItem(store, 'shelf_a', P0, 'canned_beans'); // 主食，放对
    seedItem(store, 'shelf_a', P1, 'bandage'); // 医疗，不在这张清单里
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food'] });

    expect(rate(store)).toBe(0.5);
  });

  it('没贴胶带的货架不算归位，但也不算"放错"', () => {
    const { store } = setup();
    seedItem(store, 'shelf_a', P0, 'canned_beans');
    seedItem(store, 'shelf_b', P0, 'canned_beans');
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food'] });

    // shelf_a 归位，shelf_b 没胶带 → 1/2
    expect(rate(store)).toBe(0.5);
  });

  it('多块货架共用一张胶带时，每块都按同一份清单算', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food'] });
    assignZone(store, 'shelf_b', store.run.zones[0]?.id ?? null);
    assignZone(store, 'shelf_c', store.run.zones[0]?.id ?? null);

    seedItem(store, 'shelf_a', P0, 'canned_beans');
    seedItem(store, 'shelf_b', P0, 'canned_beans');
    seedItem(store, 'shelf_c', P0, 'bandage'); // 只有这块放错

    expect(store.run.shelves.filter((s) => onlyZoneIdOf(s) !== null)).toHaveLength(3);
    expect(rate(store)).toBeCloseTo(2 / 3, 5);
  });
});

describe('归位率的分母：还没拆的纸箱也算', () => {
  it('★ 一件没上架时归位率是 0，不是 100（否则这个指标在说谎）', () => {
    const { store } = setup();
    const empty = store.run.shelves.every((s) => shelfIsEmpty(s));
    expect(empty).toBe(true);
    expect(store.run.boxesToUnpack.length).toBeGreaterThan(0);
    // 老实现只数货架 → 空房间返回 1 → 玩家囤了一屋子没拆的货却显示"归位率 100%"
    expect(placementRate(store.run.shelves, store.run.zones, store.run.boxesToUnpack)).toBe(0);
    expect(placementRate(store.run.shelves, store.run.zones)).toBe(1); // 不传纸箱时保留 M0 行为
  });

  it('真的什么都没有时才返回 1（开局第一秒不该给玩家一个 0%）', () => {
    expect(placementRate([], [], [])).toBe(1);
  });

  it('上架一部分后归位率是渐进的百分比（清单写全了才算归位）', () => {
    const { store } = setup();
    const box = store.run.boxesToUnpack[0];
    expect(box).toBeDefined();
    // 手动把这箱的每一堆都搬到贴了"明确清单"的货架上。
    // 清单必须覆盖这一箱里出现过的全部品类 —— §12 v0.8 之后空清单不给分
    const categories = [...new Set((box?.items ?? []).map((s) => getItemDef(s.itemId).category))];
    applyZone(store, 'shelf_a', { name: '都放这儿', color: RED, categories });
    const total = store.run.boxesToUnpack.reduce((n, b) => n + b.items.length, 0);
    store.commit((draft) => {
      const first = draft.boxesToUnpack[0];
      if (!first) return;
      const shelfIndex = draft.shelves.findIndex((s) => s.id === 'shelf_a');
      let shelf = draft.shelves[shelfIndex];
      if (!shelf) return;
      let cursor = 0;
      for (const stack of first.items) {
        const row = Math.floor(cursor / shelf.w);
        const col = cursor % shelf.w;
        shelf = setSlotStack(shelf, { row, col }, stack);
        cursor += 1;
      }
      draft.shelves[shelfIndex] = shelf;
      first.items = [];
      draft.boxesToUnpack = draft.boxesToUnpack.filter((b) => b.items.length > 0);
    });
    const moved = total - store.run.boxesToUnpack.reduce((n, b) => n + b.items.length, 0);
    expect(moved).toBeGreaterThan(0);
    expect(placementRate(store.run.shelves, store.run.zones, store.run.boxesToUnpack)).toBeCloseTo(moved / total, 5);
  });
});

describe('小墨点：中性信息点，不是错误标记', () => {
  const foodZone: Zone = { id: 'zone_x', name: '口粮区', color: RED, autoAccept: { categories: ['food'] } };
  const openZone: Zone = { id: 'zone_y', name: '什么都收', color: BLUE };

  it('清单不匹配才出现', () => {
    expect(isOffZone(foodZone, makeStack('canned_beans', 1, null))).toBe(false);
    expect(isOffZone(foodZone, makeStack('bandage', 1, null))).toBe(true);
  });

  it('没贴胶带的货架永不提示（§5：不整理也能活）', () => {
    expect(isOffZone(null, makeStack('bandage', 1, null))).toBe(false);
  });

  it('胶带没写清单时不提示（什么都收）', () => {
    expect(isOffZone(openZone, makeStack('bandage', 1, null))).toBe(false);
  });
});

describe('清单属于胶带本身，不属于"这一次操作"', () => {
  it('同名复用：贴到第二块架子不会把已有清单冲掉', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food'] });
    // 第二块架子还没贴过胶带，抽屉里清单是空的；此时输入同名 → 应复用，而不是改写
    applyZone(store, 'shelf_b', { name: '口粮区', color: BLUE });

    expect(store.run.zones).toHaveLength(1);
    expect(store.run.zones[0]?.autoAccept).toEqual({ categories: ['food'] }); // 清单保住
    expect(store.run.zones[0]?.color).toBe(RED); // 颜色以先贴的那张为准（M0 既有行为）
    expect(onlyZoneIdOf(store.run.shelves.find((s) => s.id === 'shelf_b')!)).toBe(store.run.zones[0]?.id);
  });

  it('改清单只有一条路：显式带 zoneId 编辑这张胶带', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food'] });
    const zoneId = store.run.zones[0]?.id as string;
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food', 'water'], zoneId });

    expect(store.run.zones[0]?.autoAccept).toEqual({ categories: ['food', 'water'] });
    // 贴着同一张胶带的另一块架子跟着一起变（M0 既有行为）
    assignZone(store, 'shelf_b', zoneId);
    applyZone(store, 'shelf_b', { name: '口粮区', color: RED, categories: ['food'], zoneId });
    expect(store.run.zones[0]?.autoAccept).toEqual({ categories: ['food'] });
  });

  it('清空选择 = 回到"什么都收"，落盘不保留空的 autoAccept', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food'] });
    const zoneId = store.run.zones[0]?.id as string;
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: [], zoneId });

    expect(store.run.zones[0]?.autoAccept).toBeUndefined();
  });

  it('清单按 CATEGORY_ORDER 归一化：点击顺序不影响存档内容', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '甲', color: RED, categories: ['water', 'food'] });
    applyZone(store, 'shelf_b', { name: '乙', color: BLUE, categories: ['food', 'water'] });

    const first = store.run.zones.find((z) => z.name === '甲')?.autoAccept;
    const second = store.run.zones.find((z) => z.name === '乙')?.autoAccept;
    expect(first).toEqual({ categories: ['food', 'water'] });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('assignZone 只负责贴，绝不动清单', () => {
    const { store } = setup();
    applyZone(store, 'shelf_a', { name: '口粮区', color: RED, categories: ['food'] });
    const zoneId = store.run.zones[0]?.id as string;
    assignZone(store, 'shelf_b', zoneId);
    assignZone(store, 'shelf_c', zoneId);
    expect(store.run.zones[0]?.autoAccept).toEqual({ categories: ['food'] });
  });
});
