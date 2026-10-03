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
 *   ① 活过 14 天（`systems/phases.ts` 的 `advanceSurvivalDay`）
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
 * M3 第 2 步已清偿 D-16（图鉴有界面了）：`ui/CodexScreen.ts` 就是那张界面，
 * 而"有一批物资永远点不亮"那一半也修了 —— 而且现在**查得出来**：
 * `data/registry.ts` 的 `unobtainableEntries()` 会把它算出来。
 */
import { getDisasterDef } from '../data/disaster';
import { getIdentityDef } from '../data/identities';
import { countOfKind } from '../data/registry';
import { NPC_DEFS } from '../data/npcs';
import { countByItem } from '../model/consume';
import type { GameStore } from '../state/store';
import type { CodexPage, CodexState, MetaProfile, RunState } from '../model/types';
import { unlockAchievements, type AchievementVerdict } from './achievements';
import { levelOf, raiseIdentityLevel } from './identity';

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
  /**
   * 这一局达成的成就（§10B.2）。
   *
   * ★ 它必须随 verdict 一起返回，而不是让结算页自己再判一次：
   * 判定会**就地写 meta**（解锁是持久的），所以只能发生在一个地方。
   * 两处各判一次的话，第二处会看到"已经解锁"从而什么都不返回 ——
   * 于是结算页上一枚印章都不盖（那个 bug 的形态就是"成就静默失效"）。
   */
  achievements: AchievementVerdict;
  /**
   * 这一局有没有让身份升熟练度（§10B.3）。`before === after` 就是没升。
   *
   * 结算页据此说一句"夜班护士 Lv2"：**升级必须被看见**，
   * 否则它就是一个玩家永远不知道存在的隐藏数值（§10B.3 的纪律③）。
   */
  identityLevel: { before: number; after: number };
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
  // 走到第几天 = 结算时的 day —— 走完时它正好等于 SURVIVAL_DAYS，
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

  /*
   * ★ 成就（§10B.2）必须排在**图鉴合并之后**，这是硬顺序。
   *
   * 好几条成就的判据要读"图鉴点亮了什么"（罐头鉴赏家 / 有水就行 / 都见过了），
   * 而图鉴的合并就发生在上面的 for 循环里。顺序反了，那些成就永远慢一局才发 ——
   * 玩家会看到"我这一局点亮了最后两罐罐头，成就却没动静"，
   * 而下一局开局才莫名其妙地弹出来。
   *
   * 传进去的是**合并之后**的 `meta.codex`，所以 `ctx.codex` 就是
   * "生涯 ∪ 本局"那份账 —— 与玩家在结算页上看到的数字同源。
   */
  const achievementVerdict = unlockAchievements(meta, run, meta.codex);

  /*
   * ★ §10B.3 的身份熟练度：**用同一身份走完**会升它的等级（1~3）。
   *
   * 只有 `survived` 才算 —— 口径写清的理由在 `raiseIdentityLevel` 的注释里：
   * 如果倒下也算，这个数量度的就是"玩过几次"，而 §10B.3 写的是"**通关**会升"。
   *
   * 它排在这里（成就之后、写 `metaSettled` 之前）有两个理由：
   *  ① 与成就同一批"结算跨局账"的动作，放一起读得出来；
   *  ② ★ **在写 `metaSettled` 之前** —— 那个字段是幂等闸门，出事之后它已经落盘，
   *     而升级没做的话就永远补不回来了（`metaSettled` 非空会让整段提前 return）。
   *     顺序反了会造出"这一局的成就算数、熟练度不算"的半截账。
   */
  const levelBefore = levelOf(meta, run.identityId);
  const leveledUp = outcome === 'survived' ? raiseIdentityLevel(meta, run.identityId) : levelBefore;

  // ★ 顺序不能反：先钉住"已结算"，再让调用方去读这份结果。
  // 反过来的话，任何一次中途失败都会让奖励变成可重复领取的
  run.metaSettled = { at: Date.now(), outcome };
  run.log.push(
    `${outcome === 'survived' ? '撑过了' : '停在了'} ${days} 天${
      freshCount > 0 ? ` · 新点亮 ${freshCount} 项` : ''
    }${newRecord ? ' · 破了纪录' : ''}${
      achievementVerdict.fresh.length > 0 ? ` · 成就 ${achievementVerdict.fresh.length} 枚` : ''
    }${leveledUp > levelBefore ? ` · ${getIdentityDef(run.identityId).name} Lv${leveledUp}` : ''}`
  );
  // meta 不属于 run，所以不走 `store.commit`（那个入口只改 run）。
  // 但**必须立刻落盘** —— 结算页刷新一次就再也回不到"第一次结算"那个状态了
  store.persistNow();

  return {
    days,
    outcome,
    earned,
    fresh,
    freshCount,
    newRecord,
    previousBest,
    achievements: achievementVerdict,
    identityLevel: { before: levelBefore, after: leveledUp }
  };
}

/** 这一灾难目前的最佳纪录（结算页要显示"本灾难最佳纪录"） */
export function bestOf(meta: MetaProfile, disasterId: string): number {
  return meta.bestSurvivalDays[disasterId] ?? 0;
}

/**
 * 图鉴总项数：让人知道"一共有多少可以点"，否则"点亮了 3 项"没有参照。
 *
 * ★ 三页全部改成**问注册表**（§10B.5 的第 1 件）。
 *
 * 原来这里写的是 `disasters: 1, // M2 只有寒潮` —— 一个**手写的字面量**。
 * 多灾难一落地（M3 第 5 步）它就变成了假账：玩家点亮的灾难数会超过"总数"，
 * 而分母错了的进度条比没有进度条更糟（它会让玩家以为界面坏了）。
 *
 * 注册表的 `countOfKind` 是**按表算的**，所以往表里加内容时这个分母自己会跟上 ——
 * 这正是"图鉴 / 成就 / 解锁只读注册表，不再各自 import 八张表"那条的效果。
 */
export function codexTotals(): Record<CodexPage, number> {
  return {
    items: countOfKind('item'),
    disasters: countOfKind('disaster'),
    npcs: countOfKind('npc')
  };
}

/** 灾难名的展示口径（图鉴页与结算页共用） */
export function disasterName(disasterId: string): string {
  return getDisasterDef(disasterId).name;
}

function unique(list: readonly string[]): string[] {
  return [...new Set(list)];
}
