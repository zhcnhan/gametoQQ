/**
 * 情报（§6.5 的第三种回报）—— 清偿 D-13。
 *
 * ## 这一组要守住的是什么
 *
 * 情报的定义只有一句话：**先知日历里"还没到的那些天"的预告**。
 * 所以测试要钉的也是三件事：
 *
 *  ① **过去的天一定看得见** —— 那一页日报本来就写过，藏起来没有意义，
 *     而且"我以为我知道昨天"比"我不知道明天"更荒谬；
 *  ② **没到的天按情报条数依次解锁** —— 一条都没挣到时只看得到今天；
 *  ③ **上限是"还没到的天数"** —— 给一个用不掉的数字是**在骗玩家**
 *     （他会以为攒着有用）。
 */
import { describe, expect, it } from 'vitest';
import { getDisasterDef } from '../data/disaster';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { intelCapacity, intelIsUseful, revealedForecasts } from './intel';
import { createStartingRun } from './setup';

function storeAt(day: number, intel: number): GameStore {
  const run = createStartingRun(20261001);
  run.day = day;
  run.intel = intel;
  return new GameStore(createSaveGame(run), {
    schedule: () => undefined,
    flush: () => undefined,
    dispose: () => undefined,
    pending: false
  });
}

describe('★ 情报 = 先知日历里"还没到的那些天"的预告', () => {
  it('★★ 过去的天**一定**看得见（与情报条数无关）', () => {
    const store = storeAt(3, 0);
    const known = revealedForecasts(store.run);
    const past = known.filter((f) => f.past).map((f) => f.day);
    // day 3 时，0/1/2/3 都该在（日历从 0 开始）
    expect(past).toContain(0);
    expect(past).toContain(3);
    expect(past.every((d) => d <= 3)).toBe(true);
  });

  it('★★ 一条情报都没有时，**看不到任何未来的天**', () => {
    const store = storeAt(1, 0);
    const future = revealedForecasts(store.run).filter((f) => !f.past);
    expect(future, '情报 0 条就不该有预告').toEqual([]);
  });

  it('★★ 情报越多，能看到的未来天数越多（从近到远）', () => {
    const one = revealedForecasts(storeAt(1, 1).run).filter((f) => !f.past).map((f) => f.day);
    const three = revealedForecasts(storeAt(1, 3).run).filter((f) => !f.past).map((f) => f.day);
    expect(one).toHaveLength(1);
    expect(three).toHaveLength(3);
    // 从近到远：三条里最近的那条就是一条时的那个
    expect(three[0]).toBe(one[0]);
    expect(three).toEqual([...three].sort((a, b) => a - b));
  });

  it('★★ 情报**用不掉**的部分不会堆着（上限 = 还没到的天数）', () => {
    const store = storeAt(5, 999);
    const capacity = intelCapacity(store.run);
    const known = revealedForecasts(store.run).filter((f) => !f.past);
    expect(known.length, '再多情报也只能揭开还没到的那些天').toBe(capacity);
    expect(capacity).toBeLessThan(999);
  });

  it('★ 最后一天：没有未来可揭，情报也就没用了（界面据此不显示那一块）', () => {
    const disaster = getDisasterDef('cold_snap');
    const lastDay = Math.max(...disaster.calendar.map((d) => d.day));
    const store = storeAt(lastDay, 5);
    expect(intelCapacity(store.run)).toBe(0);
    expect(intelIsUseful(store.run)).toBe(false);
    expect(revealedForecasts(store.run).filter((f) => !f.past)).toEqual([]);
  });

  it('★ 揭开的预告**带 hint 文本**（玩家拿到的是消息，不是一个数字）', () => {
    const known = revealedForecasts(storeAt(1, 3).run).filter((f) => !f.past);
    expect(known.length).toBeGreaterThan(0);
    for (const f of known) {
      expect(typeof f.hint).toBe('string');
      expect(f.hint.length, '`hint` 是给人看的一句话，不该是空的').toBeGreaterThan(2);
    }
  });
});
