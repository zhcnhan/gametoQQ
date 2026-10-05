/*
 * ★★ 整理页货架卡上那条"靠里这块费劲"的牌子（维度 7 的位置那一半）。
 *
 * ## 为什么这条要单独有一份用例
 *
 * `model/haul.ts` 把"东西压在靠里那块要多花力气"算得很清楚，日报也会说出
 * 总数 —— 但**总数说不出该挪什么**。日报那一屏看不到货架；玩家读完
 * "这一趟多花 1.5 点"，能做的只有猜。
 *
 * 所以牌子必须挂在**该挪的那一块**头上：门口那块不挂（它不罚），
 * 没有搬运惩罚的天气一个字都不挂（挂一条永远在的提示会让玩家去挪一个
 * 本来不该挪的屋子）。
 *
 * ## ⚠ 这一条的判据只能用**只属于这句**的措辞
 *
 * 货架卡上还挂着别的东西（`.shelf-why` 是冰箱那句、`.tidy-badge` 是
 * "整整齐齐"、`.zone-tape` 是胶带）。所以断言认 `.shelf-far` 这个类名 ——
 * 不是认"卡片里出现了『多花』"（别的句子也可能带这两个字）。
 */
import { describe, expect, it } from 'vitest';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { farShelfNote } from '../model/haul';
import { createOrganizeSession } from '../systems/organize';
import { createStartingRun } from '../systems/setup';
import { OrganizeScreen } from './OrganizeScreen';
import { __resetGesturesForTest } from './drag';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';

function saveStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/**
 * 挂一屏整理页。
 *
 * ⚠ `disasterId` 必须由调用方给：默认那场是寒潮，而它**没有** `carryFactor`
 * 那一行 —— 乘数恒为 1，牌子永远不出现，这一组会**假绿**。
 */
function mount(disasterId: string): FakeElement {
  __resetGesturesForTest();
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  root.place(0, 0, 1000, 900);

  const run = createStartingRun(20261001, { disasterId });
  run.phase = 'organize';
  run.day = -3;
  run.identityId = 'group_buyer';
  run.actionPoints = 3;

  const store = new GameStore(createSaveGame(run), saveStub());
  new OrganizeScreen(asElement(root), store, createOrganizeSession(), {
    onRestart: () => undefined,
    onGoOut: () => undefined,
    onEndDay: () => undefined,
    onBackToSurvival: () => undefined
  }).mount();
  return root;
}

/** 所有挂着牌子的货架卡（按屏幕顺序） */
function farNotes(root: FakeElement): FakeElement[] {
  return root.querySelectorAll('.shelf-far');
}

describe('★★ 货架卡上的"靠里这块费劲"（维度 7）', () => {
  it('★ 搬不动的天气里：牌子上有百分比，并且说的就是这一场真正多花的那个数', () => {
    const root = mount('tsunami');
    const notes = farNotes(root);
    expect(notes.length, '一场 carryFactor 0.5 的灾难里不该一块牌子都没有').toBeGreaterThan(0);

    /*
     * ## ⚠ 不能断言"等于 `HAUL_PREMIUM_MAX`"
     *
     * 海啸带 `unusableShelfIds: ['shelf_a']`，开局只剩**两块**架子 ——
     * 于是靠里那块是 `index = 1`（第 1 层，吃一半上限 = 7%），
     * 而不是"最里头那块"（`index >= 2`，吃满 15%）。
     *
     * 这一条要守的其实是**两处百分比来自同一个公式**：牌子上印的数
     * 必须等于 `farShelfNote(index, carryFactor)` 自己算出来的那个数。
     * 所以判据是"印出来的数 = 按这一场的实际架子数算出来的数"。
     */
    const idx = root.querySelectorAll('[data-shelf-card]').length - 1;
    const expected = farShelfNote(idx, 0.5) ?? '';
    expect(expected, '这一场按实际架子数应该挂得出牌子').not.toBe('');
    const note = farNotes(root)[0];
    expect(note?.textContent).toBe(expected);
    // 牌子说"靠里"（只到第 1 层）而不是"最里头"（那要第 2 层起）
    expect(note?.textContent).toContain('靠里');
    expect(note?.textContent).not.toContain('最里头');
    // 说的是"取东西"，不是别的（玩家要能把它与日报那句"多花 N 点"对上）
    expect(note?.textContent).toContain('取东西');
  });

  it('★ 门口那一块不挂牌子 —— 它本来就不罚，挂了等于让玩家去挪一块没问题的架子', () => {
    const root = mount('tsunami');
    const cards = root.querySelectorAll('[data-shelf-card]');
    expect(cards.length, '这一场至少要有两块架子，否则"门口不挂"根本验不到').toBeGreaterThan(1);
    // 第一块 = 门口那块
    expect(cards[0]?.querySelectorAll('.shelf-far').length, '门口那块不该有这块牌子').toBe(0);
    // 而里头的确实挂上了（否则这条断言只是"都没挂"）
    const deep = cards.slice(1).reduce((n, c) => n + c.querySelectorAll('.shelf-far').length, 0);
    expect(deep).toBeGreaterThan(0);
  });

  it('★ 没有搬运惩罚的天气：一块牌子都不许有', () => {
    /*
     * 寒潮（默认抽到的那场）没有 `carryFactor` 行 —— 平时摆哪儿都一分不多花。
     * 一条永远挂着的"靠里那块费劲"会让玩家去挪一个本来不该挪的屋子。
     */
    expect(farNotes(mount('cold_snap'))).toHaveLength(0);
  });
});
