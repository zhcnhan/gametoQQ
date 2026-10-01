/**
 * 跨局结算：把这一局的成果记进 `MetaProfile`（§6.7 跨局成长 / §9.6 第三项）。
 *
 * ## 它在修什么
 *
 * M1 评审的原话是：**当前死亡/通关都零遗产，是上瘾循环的断点** ——
 * Roguelite 的死亡必须发奖励，否则"再来一局"只是重来一遍。
 * 这一份就是那份奖励的账本：图鉴三个页面、每灾难的最佳纪录、安全感连击的历史最好。
 *
 * ## 为什么结算要由**命令层**独占（而不是结算页自己写）
 *
 * 结局有**三条**路，而且都会走到结算页：
 *
 *   ① 撑满 14 天（`systems/phases.ts` 的 `advanceSurvivalDay`）
 *   ② 健康归零（同文件的 `settleAndMaybeEnd`）
 *   ③ **读档自愈**（`state/save.ts` 的 `normalizeRun` 发现 health ≤ 0，补一个结局）
 *
 * 结算页每渲染一次就发一次奖励的话，玩家反复刷新结算页就能把图鉴与纪录刷满 ——
 * 那不是上瘾循环，那是记账错误。所以发放的入口只有 `settleRunMeta` 一个，
 * 而且它**先写 `run.metaSettled` 再发**（顺序反了会出现"发了奖励但没记上"，
 * 下一次进结算页又会发一遍）。
 *
 * ## 图鉴的口径：只记"你真的见过"
 *
 * 三页的点亮条件都是**这一局里确实碰到过的**：
 *
 *   · 物资 —— 屋里有的（货架上 + 还没拆的纸箱里）。不记商店里"见过但没买"的：
 *     图鉴是战利品清单，不是商品目录；
 *   · 灾难 —— 这一局的那一场。M1/M2 只有寒潮，所以它现在必然点亮；
 *   · 关系 —— 敲过门的 NPC（交付过或婉拒过）。**没来往过的不算** ——
 *     一个从没应过门的人不该在"关系图鉴"里留一行空白。
 *
 * systems/ 层纪律：不碰任何浏览器 API。
 *
 * DEFERRED(D-16): 图鉴只有账、没有界面（§9 界面清单第 7 条），而且有一批物资
 *   在当前内容下永远点不亮 —— `hot_water_bag_gift` 不在任何箱子的池子里，
 *   所以那一格图鉴是空着的。这不是 bug，是"内容没跟上账本"，M3 随内容扩张一起补。
 */
import { getDisasterDef } from '../data/disaster';
import { ITEM_DEFS } from '../data/items';
import { NPC_DEFS } from '../data/npcs';
import { countByItem } from '../model/consume';
import type { GameStore } from '../state/store';
import type { CodexPage, CodexState, MetaProfile, RunState } from '../model/types';

/** 三页各自的中文名。界面与结算页共用一份，免得两处各写一遍 */
export const CODEX_PAGE_LABELS: Record<CodexPage, string> = {
  items: '物资',
  disasters: '灾难',
  npcs: '关系'
};

export const CODEX_PAGES: readonly CodexPage[] = ['items', 'disasters', 'npcs'];

/** 这一局的**成绩**：走到第几天、结局、图鉴点亮了什么 */
export interface RunVerdict {
  /** 撑到第几天 */
  days: number;
  outcome: 'survived' | 'collapsed';
  /** 这一局该点亮的 id（三页） */
  earned: CodexState;
  /** 本局**新**点亮了几项（已经点过的再碰到不算） */
  fresh: CodexState;
  /** 本局新点亮的总项数 —— 结算页那句"本局新点亮 X 项"读它 */
  freshCount: number;
  /** 是不是破了这一灾难的最佳纪录 */
  newRecord: boolean;
  /** 破纪录之前那一个数（0 = 之前没有纪录） */
  previousBest: number;
}

/**
 * 这一局该点亮什么。**只看 `run`，不看 meta** ——
 * 所以它是一个纯函数，单测可以直接喂一个造出来的 run 进去。
 */
export function earnedCodex(run: RunState): CodexState {
  // 物资：全副家当（货架 + 还没拆的纸箱）。口径必须与库存表的"总共有多少件"同源 ——
  // 否则会出现"库存说我有 47 件、图鉴只点亮了 30 件"这种对不上的账
  const items = countByItem(run.shelves, run.boxesToUnpack).map((s) => s.itemId);
  const npcs = NPC_DEFS.filter((npc) => (run.trust[npc.id] ?? 0) !== 0).map((npc) => npc.id);
  return {
    items: unique(items),
    // 灾难按 id 记：它是"这一场你走完了没有"的凭据，所以**只要打过就记**
    disasters: run.disasterId ? [run.disasterId] : [],
    npcs: unique(npcs)
  };
}

/**
 * 结算这一局：算出成绩、更新 meta、写 `metaSettled`。
 *
 * **幂等**：已经记过（`run.metaSettled !== null`）就直接返回 `null`，
 * 一个字节都不改。调用方（结算页）据此判断"这次是第一次进来还是刷新"。
 *
 * @returns 这一局的成绩；已经记过则返回 null
 */
export function settleRunMeta(store: GameStore): RunVerdict | null {
  const run = store.run;
  if (run.metaSettled !== null) return null;
  if (run.outcome !== 'survived' && run.outcome !== 'collapsed') return null;

  const meta = store.save.meta;
  const outcome = run.outcome;
  const earned = earnedCodex(run);
  const fresh: CodexState = { items: [], disasters: [], npcs: [] };
  for (const page of CODEX_PAGES) {
    const have = new Set(meta.codex[page]);
    fresh[page] = earned[page].filter((id) => !have.has(id));
  }
  const freshCount = CODEX_PAGES.reduce((n, page) => n + fresh[page].length, 0);

  const previousBest = meta.bestSurvivalDays[run.disasterId] ?? 0;
  // 走到第几天 = 结算时的 day —— 撑满时它正好等于 SURVIVAL_DAYS，
  // 倒下时它是停下来的那一天（"你走到 D+N"，见策划案 §12.3 v0.5 的结局措辞）
  const days = Math.max(0, run.day);
  const newRecord = days > previousBest;

  for (const page of CODEX_PAGES) {
    const merged = new Set([...meta.codex[page], ...earned[page]]);
    // 排序后落盘：不然"点亮顺序"会随碰到的先后而变，存档 diff 全是噪音
    meta.codex[page] = [...merged].sort();
  }
  if (newRecord) meta.bestSurvivalDays[run.disasterId] = days;
  if (run.survival.safeStreak > meta.bestSafeStreak) meta.bestSafeStreak = run.survival.safeStreak;

  // ★ 顺序不能反：先钉住"已结算"，再让调用方去读这份结果。
  // 反过来的话，任何一次中途失败都会让奖励变成可重复领取的
  run.metaSettled = { at: Date.now(), outcome };
  run.log.push(
    `${outcome === 'survived' ? '撑过了' : '停在了'} ${days} 天${
      freshCount > 0 ? ` · 新点亮 ${freshCount} 项` : ''
    }${newRecord ? ' · 破了纪录' : ''}`
  );
  // meta 不属于 run，所以不走 `store.commit`（那个入口只改 run）。
  // 但**必须立刻落盘** —— 结算页刷新一次就再也回不到"第一次结算"那个状态了
  store.persistNow();

  return { days, outcome, earned, fresh, freshCount, newRecord, previousBest };
}

/** 这一灾难目前的最佳纪录（结算页要显示"本灾难最佳纪录"） */
export function bestOf(meta: MetaProfile, disasterId: string): number {
  return meta.bestSurvivalDays[disasterId] ?? 0;
}

/** 图鉴总项数：让人知道"一共有多少可以点"，否则"点亮了 3 项"没有参照 */
export function codexTotals(): Record<CodexPage, number> {
  return {
    items: ITEM_DEFS.length,
    disasters: 1, // M2 只有寒潮；M3 加灾难时它会跟着长
    npcs: NPC_DEFS.length
  };
}

/** 灾难名的展示口径（图鉴页与结算页共用） */
export function disasterName(disasterId: string): string {
  return getDisasterDef(disasterId).name;
}

function unique(list: readonly string[]): string[] {
  return [...new Set(list)];
}
