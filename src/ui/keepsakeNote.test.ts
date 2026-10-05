/**
 * ★★ 生存期日报里"屋里摆着 N 件你自己喜欢的东西"那一行（D-29）。
 *
 * ## 为什么这一行值得单独有守卫
 *
 * 奢侈品这一类**不参与任何生存数值**：`nutrition` 全空、不是任何灾难的
 * `priorityCategories`（见 `data/items.ts:200` 那一整段注释）。它唯一的用处
 * 就是这一行 —— 所以这一行要是没有，五件奢侈品就只剩"贵 + 占地方"。
 *
 * ## 三条判据，各自拦一种"看起来对了"的写法
 *
 *  1. **说清几件、加多少** —— 只说"心情不错"玩家没法把它与自己摆的东西对上；
 *  2. **说清"收在没拆的纸箱里不算"** —— 那是玩家唯一能控制的动作。
 *     不写的话他会以为买到手就生效，然后把可可粉留在箱子里等心情；
 *  3. **0 件时一个字都不显示** —— 一条每天都在的"你有 0 件纪念品"是废话，
 *     而这一屏（日报）本来就只该说**今天与昨天不同**的事。
 *
 * ⚠ 判据认 `.block-note` 里**含"喜欢的东西"**的那一段，不认 `.block-note` 本身：
 * 同一区块里还有归位率、翻找体力、身份省力三句话。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { EMPTY_SURVIVAL_SNAPSHOT } from '../data/survival';
import { createStartingRun } from '../systems/setup';
import { SurvivalScreen } from './SurvivalScreen';
import { FakeDocument, asElement, installFakeWindow, type FakeElement } from './fakeDom';
import type { SurvivalSnapshot } from '../model/types';

function stubScheduler() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

/** 一份"正在生存期、刚走完一天"的局面，日报快照按参数拼 */
function mountLast(last: Partial<SurvivalSnapshot>): FakeElement {
  const doc = new FakeDocument();
  installFakeWindow(doc);
  const root = doc.createElement('div');

  const run = createStartingRun(20261007);
  run.identityId = 'group_buyer';
  run.phase = 'survival_day';
  run.day = 3;
  run.survival.last = { ...EMPTY_SURVIVAL_SNAPSHOT, ...last };
  const store = new GameStore(createSaveGame(run), stubScheduler());
  new SurvivalScreen(asElement(root), store, {
    onStart: () => undefined,
    onNext: () => undefined,
    onTrade: () => false,
    onGoOrganize: () => undefined
  }).mount();
  return root;
}

/** 那一行（不存在就返回 null）—— 认措辞，不认 `.block-note`（同区块还有三句话） */
function keepsakeLine(root: FakeElement): string | null {
  const hit = root
    .querySelectorAll('.block-note')
    .map((el) => el.textContent)
    .filter((text) => text.includes('喜欢的东西'));
  return hit[0] ?? null;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('★★ 摆出来的纪念品换来的心情（D-29）', () => {
  it('★ 有摆出来的纪念品：说清几件、加多少心情，并写明摆在货架上才算', () => {
    const line = keepsakeLine(mountLast({ keepsakes: 3, moodFromKeepsakes: 3 }));
    expect(line, '有纪念品时这一行必须存在').not.toBeNull();
    // ① 几件 —— 玩家要能去货架上数出来
    expect(line).toContain('3 件');
    // ② 加多少
    expect(line).toContain('+3');
    // ③ 唯一的动作提示：收在箱子里不算（不然玩家会以为买到手就生效）
    expect(line).toContain('纸箱');
  });

  it('★ 一件都没有：一个字都不显示', () => {
    /*
     * 这是绝大多数局的开局状态（奢侈品只在神秘混合箱里低概率开出、商店不卖）。
     * 一条天天挂着的"你有 0 件纪念品"是废话，而日报这一屏只该说今天变了什么。
     */
    expect(keepsakeLine(mountLast({}))).toBeNull();
    expect(keepsakeLine(mountLast({ keepsakes: 0, moodFromKeepsakes: 0 }))).toBeNull();
  });

  it('★ 心情的加成有上限：五件也只说 +3（与 `KEEPSAKE_MOOD_MAX` 同一个数）', () => {
    /*
     * 上限的存在理由见 `data/survival.ts` 的 `KEEPSAKE_MOOD_MAX`：
     * 它必须小于 `moodFromPlacement` 的最高档（+4），否则玩家会得出
     * "把屋子码整齐不如多囤几罐可可粉"。这一条守的是**日报不会替规则吹牛**：
     * 快照里写 3，日报就印 3，不会按件数自己再算一遍。
     */
    const line = keepsakeLine(mountLast({ keepsakes: 9, moodFromKeepsakes: 3 }));
    expect(line).toContain('9 件');
    expect(line).toContain('+3');
    expect(line).not.toContain('+9');
  });
});
