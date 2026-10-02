/**
 * 事件不要重复（M2 走测反馈的落点）。
 *
 * ## 玩家的原话
 *
 * "生存期的借用事件太重复太多了（这个我也能理解，毕竟我们还没做大拓展，我只是说一下）"。
 * 账算下来他没错：求援订单池只有 6 单，每天 45% 有人敲门，而每次是**均匀随机** ——
 * 同一个 NPC 前后两次问同一件事的概率是 **50%**。夜间事件（6 条 / 60%）同理。
 *
 * ## 修法是"压低权重"，不是"禁掉"
 *
 * 池子小的时候硬禁会让"下一抽"变成确定的，玩家第二次就能预测 —— 那比重复更糟。
 * 所以最近出过的那几条被压到 15%（`pickEventAvoidingRecent`）。
 * 这一组同时守两件事：**重复率真的降下来了**，而且**没有变成可预测的轮转**。
 */
import { describe, expect, it } from 'vitest';
import { HELP_REQUEST_DEFS, helpRequestWeight } from '../data/helpRequests';
import { NIGHT_EVENT_DEFS, nightEventWeight } from '../data/nightEvents';
import { EMERGENCY_DEFS } from '../data/emergencies';
import { createCursor, nextFloat, pickEventAvoidingRecent, type RngCursor } from '../model/rng';
import { rollNight } from './night';
import { rollHelpRequest } from './help';
import { rollEmergency } from './survival';

/** 老口径的对照组：均匀随机从池子里挑（`pick` 的语义） */
function uniformPick<T>(cursor: RngCursor, pool: readonly T[]): T {
  const index = Math.floor(nextFloat(cursor) * pool.length);
  return pool[Math.min(index, pool.length - 1)] as T;
}

/** 同一个 id 在前后 `window` 次以内又出现的次数 */
function closeRepeats(ids: readonly string[], window = 2): number {
  let n = 0;
  for (let i = 1; i < ids.length; i++) {
    for (let back = 1; back <= window && i - back >= 0; back++) {
      if (ids[i] === ids[i - back]) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

describe('★ 事件不要重复：最近出过的会被压低权重', () => {
  it('求援订单：同一条隔一次以内又来的次数明显下降（新口径 vs 老口径）', () => {
    const run = (recentAware: boolean): string[] => {
      const cursor = createCursor(20261001);
      const history: string[] = [];
      const out: string[] = [];
      for (let day = 0; day < 400; day++) {
        const id = recentAware
          ? rollHelpRequest(cursor, history)
          : (nextFloat(cursor) < 0.45 ? uniformPick(cursor, HELP_REQUEST_DEFS).id : null);
        if (!id) continue;
        out.push(id);
        if (recentAware) {
          history.unshift(id);
          history.length = Math.min(history.length, 4);
        }
      }
      return out;
    };
    const now = run(true);
    const before = run(false);
    expect(now.length).toBeGreaterThan(100);
    expect(before.length).toBeGreaterThan(100);
    // 这就是玩家感觉到的那件事：老口径下差不多每四次就有一次是"又是他，又是那件事"
    expect(closeRepeats(now, 2)).toBeLessThan(closeRepeats(before, 2));
  });

  it('夜间事件：不会连续两晚是同一件事', () => {
    const cursor = createCursor(777);
    const history: string[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const id = rollNight(cursor, history);
      if (!id) continue;
      ids.push(id);
      history.unshift(id);
      history.length = Math.min(history.length, 4);
    }
    expect(ids.length).toBeGreaterThan(100);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i], '连续两晚撞上了同一件事').not.toBe(ids[i - 1]);
    }
  });

  it('★ 但没有变成可预测的轮转：隔一次仍然会回来', () => {
    // "硬禁"的实现会让同一个 id 在 3 次之内完全不出现 —— 那就可预测了。
    // 这条要求至少出现过"隔一次又回来"，证明它还是随机的
    const cursor = createCursor(4242);
    const history: string[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 400; i++) {
      const id = rollNight(cursor, history);
      if (!id) continue;
      ids.push(id);
      history.unshift(id);
      history.length = Math.min(history.length, 4);
    }
    let gap2 = 0;
    for (let i = 2; i < ids.length; i++) if (ids[i] === ids[i - 2]) gap2 += 1;
    expect(gap2).toBeGreaterThan(0);
  });

  it('池子里的每一条都还会出现（压低权重不是永久排除）', () => {
    const cursor = createCursor(99);
    const history: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = rollNight(cursor, history);
      if (!id) continue;
      seen.add(id);
      history.unshift(id);
      history.length = Math.min(history.length, 4);
    }
    expect(seen.size).toBe(NIGHT_EVENT_DEFS.length);
  });

  it('抽签仍然只吃一次随机数（同 seed 同序列，存档可回放）', () => {
    const seq = (): string[] => {
      const cursor = createCursor(31337);
      const history: string[] = [];
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        const id = rollNight(cursor, history);
        if (!id) continue;
        out.push(id);
        history.unshift(id);
        history.length = Math.min(history.length, 4);
      }
      return out;
    };
    expect(seq()).toEqual(seq());
  });

  it('突发事件走同一套口径（顺延给下一条），连续两天不会撞同一件', () => {
    const cursor = createCursor(20261001);
    const history: string[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 400; i++) {
      const def = rollEmergency(cursor, history);
      if (!def) continue;
      ids.push(def.id);
      history.unshift(def.id);
      history.length = Math.min(history.length, 4);
    }
    expect(ids.length).toBeGreaterThan(50);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i], '连续两天同一件突发事件').not.toBe(ids[i - 1]);
    }
    // 而池子里每一条都还会出现
    expect(new Set(ids).size).toBe(EMERGENCY_DEFS.length);
  });

  it('★ 低层函数：上一条被**排除**，不是"概率变低"', () => {
    // 这是这一版和上一版的区别所在。上一版把最近出过的压到 15%，
    // 于是"连着两次同一件事"仍然会发生（算下来约每 12 次抽签撞一次，
    // 玩家照样觉得重复）。现在它是**硬排除**：概率是 0，而池子里还剩 5 条可选。
    const countHits = (recent: string[], seed: number): number => {
      const cursor = createCursor(seed);
      let n = 0;
      for (let i = 0; i < 2000; i++) {
        const picked = pickEventAvoidingRecent(cursor, NIGHT_EVENT_DEFS, recent, nightEventWeight);
        if (picked?.id === 'n_night_shift') n += 1;
      }
      return n;
    };
    expect(countHits(['n_night_shift'], 555)).toBe(0);
    // 但没有被永久排除：下次它不在"上一条"的位置时，照常出现
    expect(countHits([], 555)).toBeGreaterThan(0);
    // 池子只剩一条时也不会崩（防御性兜底）
    const single = NIGHT_EVENT_DEFS.slice(0, 1);
    expect(pickEventAvoidingRecent(createCursor(1), single, ['n_night_shift'], nightEventWeight)).not.toBeNull();
    // 夜间权重目前全等；留一个函数是为了将来能按条调频率
    expect(nightEventWeight()).toBe(1);
    expect(helpRequestWeight()).toBe(1);
  });
});
