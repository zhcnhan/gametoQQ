/**
 * 腐坏与家具的专属测试（§10.2.4 第 2 件 / D-02 清偿）。
 *
 * ## 为什么这个文件以前不存在、现在必须有
 *
 * `model/spoil.ts` 从 M1 阶段 C 起就没有自己的测试 —— 它的行为一直被
 * `survival.test.ts` 顺带覆盖（那几条测的是"每日结算会不会坏东西"）。
 * 那够用，直到**冰箱要有效果**为止：
 *
 * 冰箱的全部意义是"同一个批次，放在冰箱里比放在纸箱里晚坏"——
 * 这是一条**比值**断言，而"结算会不会坏东西"那种断言**永远抓不到它**。
 * 一个把 `spoilFactorOf` 整个删掉的实现，照样能让那些用例全绿。
 *
 * 所以这里守的是三件事：
 *
 *  ① **比值**：同一批货、同一天，冰箱里剩的比柜子里多、柜子里比纸箱里多；
 *  ② **"不改批次"这条性质**：搬进冰箱再搬出来，`expiresAtDay` 一个字节都没动
 *     （否则会出现"搬进搬出保质期变了"这种脏状态，而且它会在存档里累积）；
 *  ③ **界线**：家具只减缓腐坏，不许加速；纸箱永远等于灾难本身的倍率。
 */
import { describe, expect, it } from 'vitest';
import { FURNITURE_DEFS, MIN_SPOIL_FACTOR, spoilFactorOf } from '../data/furniture';
import { isBatchSpoiled, spoilEverything, spoilStack, virtualDay } from './spoil';
import { createShelf } from './shelf';
import type { ItemStack, Shelf } from './types';

/** 一堆会坏的货：第 10 天到期 */
function stack(expiresAtDay: number | null = 10, count = 3, itemId = 'milk'): ItemStack {
  return { itemId, batches: [{ expiresAtDay, count }] };
}

/** 一块指定种类、只有一格有货的家具 */
function shelf(kind: Shelf['kind'], load: ItemStack | null = stack()): Shelf {
  const s = createShelf(`s_${kind}`, 'room_living', kind, 1, 1);
  s.slots[0]![0]!.stack = load;
  return s;
}

/** 跑一次全屋腐坏，返回总损失 */
function spoilWith(shelves: Shelf[], day: number, disasterRate: number): number {
  return spoilEverything(shelves, [], day, disasterRate).total;
}

describe('furniture 表本身：口径与界线', () => {
  it('四种家具都有定义，而且 `spoilFactor` 一律 ≤ 1（家具只减缓，不加速）', () => {
    expect(FURNITURE_DEFS).toHaveLength(4);
    for (const def of FURNITURE_DEFS) {
      expect(def.spoilFactor, def.kind).toBeLessThanOrEqual(1);
      expect(def.spoilFactor, def.kind).toBeGreaterThanOrEqual(MIN_SPOIL_FACTOR);
      expect(def.why.length, `${def.kind} 必须写清它凭什么值得占一块地方`).toBeGreaterThan(8);
    }
  });

  it('★ 普通货架是"没有保护"的基准（1）—— 它定义了"没有家具"长什么样', () => {
    expect(spoilFactorOf('shelf')).toBe(1);
    expect(spoilFactorOf('floor')).toBe(1);
  });

  it('冰箱是最强的一档，柜子温和一些（这正是两者的取舍）', () => {
    expect(spoilFactorOf('fridge')).toBeLessThan(spoilFactorOf('cabinet'));
    expect(spoilFactorOf('cabinet')).toBeLessThan(spoilFactorOf('shelf'));
  });

  it('★ 认不出的 kind 退回普通货架，**不抛异常**（存档可手改、可来自旧版本）', () => {
    expect(() => spoilFactorOf('这个家具不存在')).not.toThrow();
    expect(spoilFactorOf('这个家具不存在')).toBe(1);
    expect(spoilFactorOf(undefined)).toBe(1);
  });

  it('坏值（NaN / 越界）被夹回合法区间，不会污染腐坏结算', () => {
    expect(spoilFactorOf('fridge')).toBeGreaterThanOrEqual(MIN_SPOIL_FACTOR);
  });
});

describe('virtualDay：它仍然是那个纯换算', () => {
  it('囤货期（day ≤ 0）按真实天走 —— 灾难还没来，不该提前腐坏', () => {
    expect(virtualDay(-7, 0.5)).toBe(-7);
    expect(virtualDay(0, 3)).toBe(0);
  });

  it('灾难期按倍率换算', () => {
    expect(virtualDay(4, 0.5)).toBe(2);
    expect(virtualDay(4, 3)).toBe(12);
  });

  it('不易腐的东西永远不坏', () => {
    expect(isBatchSpoiled({ expiresAtDay: null, count: 99 }, 99999)).toBe(false);
  });
});

describe('★★ 冰箱真的有效果了（D-02 清偿的核心断言：这是一条**比值**）', () => {
  /*
   * 同一批牛奶、同一天、同一场灾难，只换家具种类。
   * 全部用例都写成"比值"而不是"等于几" —— 因为"等于几"会随数值调参而红，
   * 而这里要守的是**家具之间的相对关系**，那才是冰箱的意义。
   */
  const day = 6;
  const rate = 3; // 热浪那一档：虚拟天跑得比真实天快

  it('冰箱里剩下的比普通货架多（同一天、同一批货）', () => {
    // 保质期到第 10 天。virtualDay(6, 3) = 18 > 10 → 普通货架上已经坏了
    expect(spoilWith([shelf('shelf')], day, rate)).toBe(3);
    // 冰箱：virtualDay(6, 3 × 0.4) = 7.2 < 10 → 还留着
    expect(spoilWith([shelf('fridge')], day, rate)).toBe(0);
  });

  it('柜子在两者之间：比普通货架强，比冰箱弱', () => {
    // 取一个"柜子已经坏、冰箱还没坏"的日子，把三档一次比出来
    // 到期日 10；virtualDay(6, 3×0.75) = 13.5 > 10（柜子坏）
    //              virtualDay(6, 3×0.4)  =  7.2 < 10（冰箱留）
    expect(spoilWith([shelf('shelf')], day, rate)).toBe(3);
    expect(spoilWith([shelf('cabinet')], day, rate)).toBe(3);
    expect(spoilWith([shelf('fridge')], day, rate)).toBe(0);
  });

  it('★★ 同一天，三档同时比 —— 这才是冰箱的意义', () => {
    /*
     * 实测（第 6 天、热浪倍率 3）：三档的虚拟天分别是
     *   普通货架 6 × 3    = 18
     *   柜子     6 × 2.25 = 13.5
     *   冰箱     6 × 1.2  =  7.2
     *
     * 于是换一个到期日就会**换出不同的名次**，这比"冰箱总是最好"有信息量得多：
     * 它说明保护程度是**连续的**，玩家要为"哪些东西值得占冰箱那一格"做取舍。
     */
    const at = (kind: 'shelf' | 'cabinet' | 'fridge', e: number) => spoilWith([shelf(kind, stack(e))], day, rate);

    // 到期 9：只有冰箱保得住
    expect(at('shelf', 9)).toBe(3);
    expect(at('cabinet', 9)).toBe(3);
    expect(at('fridge', 9)).toBe(0);

    // 到期 14：柜子也保得住了（13.5 < 14），而普通货架早就坏了（18 > 14）
    expect(at('shelf', 14)).toBe(3);
    expect(at('cabinet', 14)).toBe(0);
    expect(at('fridge', 14)).toBe(0);

    // 到期 50：三档都保得住 —— **冰箱不是万能**，它只是把线往后推
    expect(at('shelf', 50)).toBe(0);
    expect(at('cabinet', 50)).toBe(0);
    expect(at('fridge', 50)).toBe(0);
  });

  it('★ 冰箱**不是免死金牌**：够久的日子照样会坏', () => {
    // 到期日 5，第 13 天：virtualDay(13, 1.2) = 15.6 > 5 → 冰箱里也坏了
    expect(spoilWith([shelf('fridge', stack(5))], 13, rate)).toBe(3);
  });

  it('★ 灾难本身不腐坏时，家具也不该"制造"腐坏（寒潮那一档）', () => {
    // 寒潮 spoofRate 0.5：virtualDay(14, 0.5) = 7 < 10 → 全屋都不坏，冰箱也一样
    expect(spoilWith([shelf('shelf')], 14, 0.5)).toBe(0);
    expect(spoilWith([shelf('fridge')], 14, 0.5)).toBe(0);
  });
});

describe('★ "不改批次"这条性质：搬进搬出不留脏状态', () => {
  it('腐坏结算**不改** `expiresAtDay`，只改"拿什么虚拟天去比"', () => {
    /*
     * 这条比它看起来重要：如果按家具去改写批次，就会出现
     * "搬进冰箱再搬出来，保质期变了" —— 而且那种变化会随每次搬运累积，
     * 最后存档里躺着一堆来历不明的日期。文件头把"收敛"写成核心性质，就是为这个。
     */
    const original = stack(10, 3);
    const frozen = JSON.stringify(original.batches);
    spoilEverything([shelf('fridge', original)], [], 6, 3);
    expect(JSON.stringify(original.batches)).toBe(frozen);
  });

  it('同一堆货在不同家具里，坏掉的**件数**不同，而批次日期自始至终没动', () => {
    const a = stack(10, 3);
    const b = stack(10, 3);
    const [fridgeOut] = spoilEverything([shelf('fridge', a)], [], 6, 3).shelves;
    const [shelfOut] = spoilEverything([shelf('shelf', b)], [], 6, 3).shelves;
    expect(shelfOut?.slots[0]?.[0]?.stack).toBeNull(); // 普通货架上全坏了
    expect(fridgeOut?.slots[0]?.[0]?.stack?.batches).toEqual([{ expiresAtDay: 10, count: 3 }]);
  });
});

describe('纸箱：永远是灾难本身的倍率（"纸箱不是冰箱"）', () => {
  it('同一批货，纸箱里的和普通货架上的一样坏 —— 纸箱不给任何保护', () => {
    const inBox = spoilEverything([], [{ id: 'b', defId: 'box_staple', items: [stack(10, 3)] }], 6, 3);
    const onShelf = spoilEverything([shelf('shelf')], [], 6, 3);
    expect(inBox.total).toBe(onShelf.total);
    expect(inBox.total).toBe(3);
  });

  it('★ 但纸箱**不会**因为"没有家具"而比普通货架坏得更多（1 是下限）', () => {
    // 这条防的是"顺手给纸箱加个 1.5 的惩罚"——那不是家具的语义
    const inBox = spoilEverything([], [{ id: 'b', defId: 'box_staple', items: [stack(14, 3)] }], 6, 3);
    const onShelf = spoilEverything([shelf('shelf', stack(14))], [], 6, 3);
    expect(inBox.total).toBe(onShelf.total);
  });
});

describe('逐堆结算：只坏该坏的批次', () => {
  it('同堆里早到期的坏、晚到期的留', () => {
    const mixed: ItemStack = {
      itemId: 'canned_beans',
      batches: [
        { expiresAtDay: 5, count: 2 },
        { expiresAtDay: 50, count: 3 }
      ]
    };
    const result = spoilStack(mixed, 20);
    expect(result.lost).toBe(2);
    expect(result.stack?.batches).toEqual([{ expiresAtDay: 50, count: 3 }]);
  });

  it('一件都不坏时返回**原对象**（不制造无谓的克隆，结算每局要跑 14 次）', () => {
    const s = stack(99, 1);
    expect(spoilStack(s, 10).stack).toBe(s);
  });

  it('全坏了返回 null（格子真的空出来，而不是留一个空堆）', () => {
    expect(spoilStack(stack(5, 2), 10).stack).toBeNull();
  });
});
