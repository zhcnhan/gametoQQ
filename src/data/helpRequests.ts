/**
 * 求援订单静态表（§6.5「Wilmot 的限时订单，不是复仇演出」）。
 *
 * ## 五条设计约束（都来自 §6.5，逐条对应）
 *
 *  1. **当日内有效**：`validUntilDay` 这个概念在实现上落成了"今天这道门，不处理就过去"——
 *     §4A 说玩家随时可能被领导叫走，所以这里**没有秒表**，也不该有；
 *  2. **需求是品类不是具体某一件**：邻居要的是"药"，不是"某某牌感冒药"。
 *     玩家囤的是品类，订单也该按品类开口，否则会出现"你有三盒药但没有他要的那一种"；
 *  3. **回报分两种**：人情（`trustGain`）与对方留下的东西（`thanks`）。
 *     后者是 §6.5 写的"以物易物"，不是每单都有 —— 全靠回报会把它变成刷分；
 *  4. **婉拒扣人情**，而且 §6.5 明说后果是"**后续交易关闭**"：
 *     所以人情为负时，「去敲个门」那条路也会关上（见 systems/trade.ts）；
 *  5. **不写台词腔**（§11）：他站在门口说一件具体的事就够了。
 *     不要"谢谢你啊你真是好人"——那句话会把整件事变成道德考试。
 *
 * DEFERRED(D-13): §6.5 的三种回报里，**「情报」还没做** —— 它需要一个能被追加的
 * 先知日历，而 M1 的 `DisasterProfile.calendar` 是静态表。所以这里的 `thanks`
 * 只有现金与箱型两种形态。
 */
import type { CategoryId } from '../model/types';

/**
 * 今天有人来敲门的概率（种子化决定，同 seed 同结果）。
 *
 * 45% 是刻意的：门响得太勤会变成"每日任务"，太稀又碰不上几次。
 * §6.5 说「对方今日离开，**明天还可能来**」—— 所以它有来有回，不是一次性事件。
 */
export const HELP_REQUEST_CHANCE = 0.45;

export interface HelpDemand {
  category: CategoryId;
  count: number;
}

export interface HelpRequestDef {
  id: string;
  npcId: string;
  /** 门口那句话。1~2 句，陈述处境与需求 */
  text: string;
  demands: readonly HelpDemand[];
  /** 交付后涨多少人情 */
  trustGain: number;
  /** 婉拒扣多少 */
  trustLoss: number;
  /** 对方留下的东西（§6.5 的"以物易物"）。不是每单都有 */
  thanks?: { readonly cash?: number; readonly boxDefId?: string };
}

export const HELP_REQUEST_DEFS: readonly HelpRequestDef[] = [
  // ———————— 王阿姨 ————————
  {
    id: 'q_wang_medicine',
    npcId: 'npc_wang',
    text: '王阿姨站在门口，说孙子半夜烧起来了，家里的药吃完了。',
    demands: [{ category: 'medicine', count: 3 }],
    trustGain: 2,
    trustLoss: 2,
    thanks: { cash: 60 }
  },
  {
    id: 'q_wang_water',
    npcId: 'npc_wang',
    text: '楼上水管冻住了。她拿着两个空桶，问能不能接点水。',
    demands: [{ category: 'water', count: 4 }],
    trustGain: 1,
    trustLoss: 2,
    thanks: { cash: 30 }
  },

  // ———————— 老同学 ————————
  {
    id: 'q_classmate_food',
    npcId: 'npc_classmate',
    text: '老同学在楼下等着，说家里断了两天，想先挪一点吃的。',
    demands: [{ category: 'food', count: 4 }],
    trustGain: 2,
    trustLoss: 3,
    thanks: { cash: 80 }
  },
  {
    id: 'q_classmate_fuel',
    npcId: 'npc_classmate',
    text: '他搓着手，说家里的炉子灭了，还差一点烧的。',
    demands: [{ category: 'fuel', count: 2 }],
    trustGain: 2,
    trustLoss: 2,
    thanks: { cash: 100 }
  },

  // ———————— 老陈 ————————
  {
    id: 'q_shopkeeper_tool',
    npcId: 'npc_shopkeeper',
    text: '老陈想借把扳手，说店门被风掀坏了，关不上。',
    demands: [{ category: 'tool', count: 2 }],
    trustGain: 2,
    trustLoss: 1,
    // 他自己就是存货的人 —— 这类回报是他唯一给得起的东西
    thanks: { boxDefId: 'box_staple' }
  },
  {
    id: 'q_shopkeeper_warmth',
    npcId: 'npc_shopkeeper',
    text: '他说晚上店里守不住，问有没有多的被子能匀一床。',
    demands: [{ category: 'warmth', count: 1 }],
    trustGain: 2,
    trustLoss: 1,
    thanks: { boxDefId: 'box_medical' }
  }
];

const HELP_BY_ID: ReadonlyMap<string, HelpRequestDef> = new Map(HELP_REQUEST_DEFS.map((d) => [d.id, d]));

export function getHelpRequestDef(defId: string): HelpRequestDef {
  const def = HELP_BY_ID.get(defId);
  if (!def) throw new Error(`未知求援订单 id: ${defId}`);
  return def;
}

export function findHelpRequestDef(defId: string): HelpRequestDef | null {
  return HELP_BY_ID.get(defId) ?? null;
}

/** 求援订单每单的抽签权重。现在全等，留一个函数是为了将来能按单调频率 */
export function helpRequestWeight(): number {
  return 1;
}
