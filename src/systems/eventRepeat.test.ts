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
    const run = (seed: number, recentAware: boolean): string[] => {
      const cursor = createCursor(seed);
      const history: string[] = [];
      const out: string[] = [];
      for (let day = 0; day < 400; day++) {
        const id = recentAware
          ? rollHelpRequest(cursor, history)
          : nextFloat(cursor) < 0.45
            ? uniformPick(cursor, HELP_REQUEST_DEFS).id
            : null;
        if (!id) continue;
        out.push(id);
        if (recentAware) {
          history.unshift(id);
          history.length = Math.min(history.length, 4);
        }
      }
      return out;
    };

    /*
     * ★★ 这条用例在 2026-10 改过一次，而它原来**根本没在测它声称的东西**。
     *
     * 原版只跑**一组**种子（20261001）然后断言
     * `closeRepeats(now) < closeRepeats(before)`，注释还写着
     * "老口径下差不多每四次就有一次是'又是他，又是那件事'"。
     *
     * 实际数字（求援池从 6 涨到 33 之后量出来的）：
     *     now = 4，before = 3，两边各 177 次抽签
     * 而 33 的池子里、177 次抽签、窗口为 2，**期望的"近距离重来"本来就只有约 3.4 次** ——
     * 所以 `4 < 3` 是**噪声**，不是效果。改成池子小的时候它碰巧成立（6 条池子期望约 60 次），
     * 内容一多就随机红。
     *
     * 现在改成：**跨 40 组种子求总数**。单组是噪声，40 组的总数才量得出"少了很多"。
     * 这条例子的主张是"新口径显著少于老口径"，而它现在真的在量那句话。
     */
    let nowTotal = 0;
    let beforeTotal = 0;
    let draws = 0;
    for (let i = 0; i < 40; i++) {
      const seed = 20261001 + i * 7919;
      const now = run(seed, true);
      const before = run(seed, false);
      draws += now.length;
      nowTotal += closeRepeats(now, 2);
      beforeTotal += closeRepeats(before, 2);
    }
    expect(draws, '40 组加起来的总抽签数').toBeGreaterThan(3000);
    // 新口径应该少一大截，而不是"少一点点" —— 留 40% 的余量给种子之间的波动
    expect(nowTotal).toBeLessThan(beforeTotal * 0.6);
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
    /*
     * ★ 取样量从 400 抬到 20000（2026-10，加了一批突发事件之后）。
     *
     * 400 次里**只有约 109 次真的抽到东西**，其余全是"今晚没事"
     * （`EMERGENCY_CHANCE = 0.3`）。109 次抽样去盖 52 条池子，期望上就会漏几条 ——
     * 实测漏 5 条，而最后那句 `Set(ids).size === EMERGENCY_DEFS.length` 是**全集相等**，
     * 于是它红了。
     *
     * ★ 判断"这是抽样太少还是可达性 bug"的办法：**把次数加大看会不会补齐**。
     * 20000 次（≈6119 次真抽）之后 52 条全中 —— 所以那 5 条是可达的，
     * 红的是**取样量**，不是产品。这个区间定在两者之间很关键：
     *  · 太小 → 会随机红，而"随机红的测试"最后一定会被人加 `skip`；
     *  · 太大 → 白跑几千次抽签，而这条要守的只是"每条都够得着"。
     */
    for (let i = 0; i < 20000; i++) {
      const def = rollEmergency(cursor, history);
      if (!def) continue;
      ids.push(def.id);
      history.unshift(def.id);
      history.length = Math.min(history.length, 4);
    }
    expect(ids.length, '真抽到的次数（其余是"今晚没事"）').toBeGreaterThan(50);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i], '连续两天同一件突发事件').not.toBe(ids[i - 1]);
    }
    // 而池子里每一条都还会出现（这才是真判据：没有结构上够不着的条目）
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
