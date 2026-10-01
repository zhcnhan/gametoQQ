/**
 * 突发事件表（§5 的另一半，M2 §12 拍板 v0.9）。
 *
 * ## 它在补齐什么
 *
 * §5 的整理收益清单里有一条一直悬着：
 *
 *   > 应急货架（门口/最顺手位）放急救品 → **突发事件不掉健康**
 *
 * M1 阶段 F 把"顺手位"落地成了 `Shelf.handyRank`，§6.3 的应急可达率也算了分，
 * 但那个分数**没有下游** —— 它是印在结算页上的一个百分比，玩家体会不到。
 * 这张表就是它的下游：应急可达率从"分数"变成"战力"的最后一环
 * （D-06 的残留，M2 清偿）。
 *
 * ## 为什么它不是选项题
 *
 * 夜间事件与白天事件都是"文本 + 选项 + 后果"，这里是**检查题**：
 * 事情发生的那一刻，玩家没有第二次决定的机会 —— 他早就在整理期决定过了。
 * 这正是 §5 那句话的力量所在（"放急救品"是一个**之前**做的动作）。
 * 所以它的形态是：陈述处境 → 顺手位上有没有 → 有就化解，没有就按缺货口径受创。
 *
 * ## 两条文案纪律
 *
 *  1. **陈述处境，不演惩罚**（M2 提示词原文：「做成"陈述处境"而不是惩罚演出」）：
 *     写"炉子熄了，屋里的温度在往下掉"，不写"你失败了，健康 -6"；
 *  2. 1~2 句，不写台词腔、不煽情（§11）。
 *
 * ## 低频是刻意的
 *
 * 夜间事件约 60% 的夜晚有事，突发事件要**更低**（见 `EMERGENCY_NONE_WEIGHT`）：
 * 它要像意外，不能像日程。种子化决定哪一天有事、是哪一件。
 */
import type { EmergencyDef } from '../model/types';

/**
 * "今天没事"的权重（抽签池里的一个虚拟条目）。
 *
 * 取值 2.2 → 有事 ≈ 6 / (6 + 2.2 × 6) = 6 / 19.2 ≈ 31%。
 * 为什么用权重而不是"先掷一次概率再抽事件"：一次抽签只有一个 RNG 消耗点，
 * 所以"某一天有没有事"这件事在整个存档里只依赖一个数，回放与调试都更容易对账。
 */
export const EMERGENCY_NONE_WEIGHT = 2.2;

/**
 * 突发事件的池子。
 *
 * 每一条都必须**能被顺手位化解**，而且化解物必须是玩家在囤货期真的会买的东西 ——
 * 若某条事件要的是一个玩家根本不会囤的品类，那它就不是检查题，是随机扣血。
 */
export const EMERGENCY_DEFS: readonly EmergencyDef[] = [
  {
    id: 'e_cut_hand',
    text: '拆木箱的时候手滑了一下，虎口拉开一道口子。血滴在地板上。',
    category: 'medicine',
    needOnHandy: 1,
    lost: 1
    // 不写 consumes：用掉的绷带由每日结算的自动补给去消耗（跌破 70 才动），
    // 这里再扣一次会让同一卷绷带被算两遍
  },
  {
    id: 'e_stove_out',
    text: '炉子自己熄了。凑近听，罐子已经空了。',
    category: 'fuel',
    needOnHandy: 1,
    lost: 2,
    consumes: true
  },
  {
    id: 'e_pipe_burst',
    text: '水管冻裂了，水顺着墙往下淌。地上很快结了一层。',
    category: 'tool',
    needOnHandy: 1,
    lost: 2
  },
  {
    id: 'e_fever',
    text: '后半夜开始发冷，天亮时额头是烫的。',
    category: 'medicine',
    needOnHandy: 2,
    lost: 2
  },
  {
    id: 'e_window_gap',
    text: '风把窗缝吹开了，窗帘一直在动。屋里那点热气正往外跑。',
    category: 'warmth',
    needOnHandy: 1,
    lost: 1
  },
  {
    id: 'e_water_frozen',
    text: '存的水冻成了整块。要喝得先凿。',
    category: 'fuel',
    needOnHandy: 1,
    lost: 1,
    consumes: true
  },
  {
    id: 'e_rat_in_box',
    text: '纸箱底被咬开一个洞。里面剩下什么，得翻出来才知道。',
    category: 'tool',
    needOnHandy: 1,
    lost: 1
  }
];

const EMERGENCY_BY_ID: ReadonlyMap<string, EmergencyDef> = new Map(EMERGENCY_DEFS.map((d) => [d.id, d]));

/** 表里没有这个 id 时返回 null（存档自愈要用它判断"这件事还认不认识"） */
export function findEmergency(eventId: string): EmergencyDef | null {
  return EMERGENCY_BY_ID.get(eventId) ?? null;
}

export function hasEmergency(eventId: string): boolean {
  return EMERGENCY_BY_ID.has(eventId);
}
