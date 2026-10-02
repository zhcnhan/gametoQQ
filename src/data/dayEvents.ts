/**
 * 白天随机事件表（§6.2「随机事件：物价波动、限购、插队大妈、黑市商人」/ 清偿 D-10）。
 *
 * ## 它在补齐什么
 *
 * §6.2 给扫货写了「文本 1~2 句，选项 2~3 个」，M1 一条都没做 ——
 * 白天采购是纯数值操作，而囤货期占整局 **70% 的操作量**。M2 提示词的原话是：
 * 「这是扫货期从纯数值操作变成有变数的游戏 —— 囤货期占 70% 操作量，目前后 40% 是纯算术作业」。
 *
 * ## 数据结构刻意复用夜间事件那一套
 *
 * 文本 + 选项 + 后果（`DayOptionEffect`）。阶段 B 已经把这条路跑通了，
 * 玩家也已经学会了这套界面语言（选完先看后果，再看下一步）。白天不该另发明一套。
 *
 * ## 两条与夜间**不同**的地方，都是有理由的
 *
 *  1. **后果动的是钱、货、价格、限购，不动四维。** 四维是生存期的账
 *     （`data/survival.ts` 那套），白天在囤货期、生存期还没开始，凭空扣血没有下游。
 *     唯一的例外是体力与心情 —— 它们本来就是"今天过得顺不顺"的容器；
 *  2. **有一条事件必须能只在特定的店门出现**（黑市商人只在五金店后巷那种事）。
 *     那由 `onlyShops` 表达，而不是在文案里暗示 —— 否则玩家会到处找那个不存在的商人。
 *
 * ## 「物价波动」为什么没有选项
 *
 * §6.2 把它列在随机事件里，但它**天然是环境而不是选择**：玩家没法"决定"物价。
 * 所以它落在 `rollDayPriceFactor()`（逐日上行的价格倍率，见 systems/shop.ts），
 * 而这张表只留"有得选"的那几条。把一件没得选的事做成弹窗，是在浪费玩家的一次点击。
 *
 * ## 限购与物价波动补的是一个 M1 的隐性空洞
 *
 * D-03（寒潮腐坏恒 0）让"早买 vs 晚买"失去意义：「临期优先」排得再好也没东西会坏。
 * 逐日上行的价格把这个博弈救回来 —— 今天不买，明天更贵。
 * 见 `DAY_PRICE_FACTOR` 与策划案 §12 的 v0.8 标注。
 *
 * DEFERRED(D-17): 物价与限购**只活在当天、且不进 `run.log`**。
 *   "换天清零"是对的（它们本来就该只活一天），但"事后查不到"不是 ——
 *   玩家回翻日报时看不到"D+3 那天物价涨到 1.5 倍"，而那一局的取舍正是被它决定的。
 *   M3 与日报的复盘视图一起做。
 *
 * DEFERRED(D-19): `DAY_PRICE_FACTOR` 是**手写的**，而且只覆盖寒潮 ——
 *   与 D-15 的外界温度表同一类问题。多灾难（M3）时要按 `disasterId` 拆成几份
 *   （热浪的抢购曲线不该和寒潮长得一样）。
 */
import type { DayEventDef } from '../model/types';

/**
 * "今天这家店没事"的权重（抽签池里的一个虚拟条目）。
 *
 * 3.0 配合下面 4 条事件的权重（1.0 + 1.6 + 1.4 + 0.6 = 4.6）→
 * 有事的概率 ≈ 4.6 / 7.6 ≈ **六成**。比夜间事件（60%）略低、
 * 比突发事件（约三成）高得多：白天要变数，但一天进三家店，每家都有事就成了例会。
 */
export const DAY_EVENT_NONE_WEIGHT = 3.0;

interface WeightedDayEvent {
  def: DayEventDef;
  weight: number;
}

/**
 * ★ 写事件的硬约束（完整版在 `DayOptionEffect` 的字段注释里，由 `dayEvent.test.ts` 强制）：
 *
 *  1. **每个选项都必须至少有一个"落到玩家身上"的效果**（现金 / 四维 / 一箱货 /
 *     当场拿到的货 / 明确的"不参与"）。只改商店（削库存、加限购）的选项**不许存在** ——
 *     玩家点完什么都不会变，那不是选择，是白扣一次行动点；
 *  2. **文案只许承诺效果给得出来的东西**。说"抢到了"就必须真给货（`grab`）；
 *     说"货架空了"说的是**商店**的货架，不许让玩家以为自家少了东西；
 *  3. **限购是处境，不是奖励**。"按限购买"这种选项给玩家的只有一条限制 ——
 *     玩家的原话是"限购两件跟我有鸡毛关系，我两件东西也没买到啊"。
 *     它只能写在 `text` 的处境里，或者在"通融"那条里配一笔钱一起给。
 */
const WEIGHTED: readonly WeightedDayEvent[] = [
  {
    weight: 1.0,
    def: {
      id: 'd_queue_aunt',
        tags: ['queue', 'people'],
      text: '前面排了很长的队。收银台只开了两个，一个购物车横在过道上。',
      options: [
        {
          label: '排到底',
          outcome: '你排了四十分钟。轮到你的时候，筐里的东西都还在。',
          // ★ 代价要配收获：四十分钟换来的是**真把这趟买成了**。
          // 上一版这里只扣体力与心情 —— 那和"点了没反应"在玩家眼里是一回事
          // （规则见 dayEvent.test.ts 的"每个选项都得有收获"）。
          effect: { grab: { category: 'food', count: 2 }, stamina: -10, mood: -3 }
        },
        {
          label: '不排了，换一家',
          outcome: '你把筐放回原处，出了门。这趟白跑。',
          // 只花 1 点行动点（早就扣了），不额外罚 —— "不参与"必须是真的不参与
          effect: { visitLost: true }
        },
        {
          label: '绕到后门问问',
          outcome: '理货的小伙子认得你，从后门给你结了账。',
          effect: { grab: { category: 'food', count: 2 }, stamina: -4, cash: -10, mood: 4 }
        }
      ]
    }
  },
  {
    weight: 1.6,
    def: {
      id: 'd_panic_buying',
        tags: ['panic', 'supply'],
      text: '群里说高速封了。前面几个人的车都在往米面那边靠。',
      // 这条要的就是"今天该不该早买"的那个决定，所以它不限点位
      options: [
        {
          label: '先抢一轮',
          // ★ 文案说"抓了两袋"就必须真给货 —— 原来这条只削了商店库存，玩家一件没拿到，
          // 读完文案却看着自家箱子没变，只会以为事件坏了
          outcome: '你挤进去抓了两袋，后面的人也上手了。',
          effect: { grab: { category: 'food', count: 2 }, stockCut: { category: 'food', count: 4 }, mood: 5 }
        },
        {
          label: '也去拿两袋',
          // ★ 文案说"拿了两袋"就必须真给货（grab）。这一条的上一版写的是
          // "你照原计划结完账就出了门"，而它的效果里根本没有"结账"那一步 ——
          // 玩家点完只掉体力、物价还涨，屏幕上却说他买了东西。玩家的原话：
          // "我结了账没拿到货？？？" 一条选项**不许描述它没有做的事**。
          outcome: '你跟着挤进去拿了两袋，出来的时候后背全是汗。',
          effect: { grab: { category: 'food', count: 2 }, stamina: -6, priceUp: 0.1 }
        },
        {
          label: '等人散了再说',
          // 这条的好处是真的：货架被抢空了一部分（stockCut 落到**商店**），
          // 而你什么也没损失。文案不许再写"我买了" —— 你没买，你等了。
          // `visitLost` 也一起给：这条事件里"我今天不在这儿买了"就是它的出口
          // （§4A 要求每条事件都有一条明确的不参与路径，测试会强制）
          outcome: '你退到货架外面等。前面的人把主食扫掉大半，你什么也没拿。',
          effect: { stockCut: { category: 'food', count: 4 }, mood: 2, visitLost: true }
        }
      ]
    }
  },
  {
    weight: 1.4,
    def: {
      id: 'd_purchase_limit',
        tags: ['limit', 'supply'],
      // ★ 限购写在**处境**里，而不是当成选项发给玩家
      text: '门口贴了张手写的纸：米面油盐，每人限购两件。理货员在数人头。',
      options: [
        {
          label: '就买两件',
          // 给玩家的东西是**那两件货本身**，限购只是它后面的处境
          outcome: '你拿了两袋米。他伸手指了指那张纸。',
          effect: { grab: { category: 'food', count: 2 }, limit: { category: 'food', max: 2 } }
        },
        {
          label: '换一家看看',
          outcome: '你转身去了别处。这里的队还在排。',
          effect: { visitLost: true }
        },
        {
          label: '找熟人通融',
          outcome: '你给理货员递了包烟。他多给了你两件。',
          effect: { cash: -20, grab: { category: 'food', count: 2 }, limit: { category: 'food', max: 5 } }
        }
      ]
    }
  },
  {
    weight: 0.6,
    def: {
      id: 'd_black_market',
        tags: ['market', 'people'],
      text: '五金店后巷停着一辆没牌照的面包车。有人从车窗里递出一箱货，收钱就走。',
      // 只在五金店 —— 后巷这件事有地址，到处都能碰上就假了
      onlyShops: ['hardware'],
      options: [
        {
          label: '问一句价钱',
          // 文案必须提到"拿到手"：花掉一笔钱换来一箱货，两件事都得说
          // （规则见 dayEvent.test.ts 的"文案与效果必须语义一致"第 ④ 条）
          outcome: '他伸出两根手指。你数出 {spentCash} 递过去，接过来一箱。',
          effect: { cash: -120, boxDefId: 'box_mixed' },
          requireFullCash: true
        },
        {
          label: '装作没看见',
          outcome: '你从巷口走过去了。省下一笔钱。',
          // §4A：每条事件都得有一条"不参与"的路。这里的收获是**明确的**：
          // 你没买、也没白跑一趟（店还开着，可以照常进去买）。
          // 上一版只扣 2 点心情 —— 那等于"选项本身就是惩罚"，规则不允许
          effect: { mood: 2 }
        },
        {
          label: '这店今天不进了',
          outcome: '你调头走了。',
          effect: { visitLost: true }
        }
      ]
    }
  }
];

export const DAY_EVENT_DEFS: readonly DayEventDef[] = WEIGHTED.map((w) => w.def);

/** 一条事件在它所属店门里的抽签权重。表里没有的事件返回 0（"这个点位抽不到它"） */
export function dayEventWeight(def: DayEventDef, shopId: string): number {
  if (def.onlyShops && !def.onlyShops.includes(shopId)) return 0;
  return WEIGHTED.find((w) => w.def.id === def.id)?.weight ?? 0;
}

const DAY_EVENT_BY_ID: ReadonlyMap<string, DayEventDef> = new Map(DAY_EVENT_DEFS.map((d) => [d.id, d]));

/** 表里没有这个 id 时返回 null（存档自愈要用它判断"这件事还认不认识"） */
export function findDayEvent(eventId: string): DayEventDef | null {
  return DAY_EVENT_BY_ID.get(eventId) ?? null;
}

export function hasDayEvent(eventId: string): boolean {
  return DAY_EVENT_BY_ID.has(eventId);
}

/**
 * 逐日上行的物价倍率（§6.2「物价波动」，也是 D-03 那个空洞的补丁）。
 *
 * ## 为什么必须存在（而不是"顺便做个随机事件"）
 *
 * M1 拍板「寒潮是天然冷库」（D-03），于是全程**没有任何东西会坏**，
 * 连带「临期优先」排得再好也拿不到红利 —— 更要紧的是：
 * **"早买还是晚买"这个博弈彻底消失了**。D-7 买和 D-1 买在数值上完全等价，
 * 于是囤货期的前半段没有任何理由不"先把钱留着"。
 *
 * 物价逐日上行把这个博弈用另一条路救回来：越晚越贵。
 * 它同时是最朴素的一条 M2 世界感 —— 灾难逼近，什么都贵。
 *
 * ## 取值：从"灾前打折"走到"灾后翻倍"
 *
 * 负数那些天（囤货期）**价格在低位**：货还多、人还没慌，超市有促销。
 * 从 D-2 起开始涨，D-Day 起跳，生存期继续爬到 2.2 倍 ——
 * 那已经不是"物价波动"，是"你有钱也买不到"。
 *
 * ★ 它只影响**囤货期**的实际操作（生存期买不了东西），
 * 生存期那几档是留给"读到日报的人"的参照物：日历在涨，你的库存不会。
 */
export const DAY_PRICE_FACTOR: ReadonlyMap<number, number> = new Map([
  [-7, 0.95],
  [-6, 0.95],
  [-5, 0.98],
  [-4, 0.98],
  [-3, 1.0],
  [-2, 1.05],
  [-1, 1.12],
  [0, 1.25],
  [1, 1.4],
  [2, 1.5],
  [3, 1.6],
  [4, 1.7],
  [5, 1.8],
  [6, 1.9],
  [7, 2.0],
  [8, 2.0],
  [9, 2.05],
  [10, 2.05],
  [11, 2.1],
  [12, 2.1],
  [13, 2.15],
  [14, 2.2]
]);

/**
 * 这一天买东西贵多少倍。日历覆盖不到的日子夹到最近的一档 ——
 * 物价不会自己回落，这是这个函数唯一的默认方向。
 */
export function dayPriceFactor(day: number): number {
  const key = Math.round(day);
  if (DAY_PRICE_FACTOR.has(key)) return DAY_PRICE_FACTOR.get(key) as number;
  // 超出日历：取最近的一端（早于 D-7 用第一天，晚于 D+14 用最后一天）
  const keys = [...DAY_PRICE_FACTOR.keys()].sort((a, b) => a - b);
  const first = keys[0] as number;
  const last = keys[keys.length - 1] as number;
  if (key < first) return DAY_PRICE_FACTOR.get(first) as number;
  return DAY_PRICE_FACTOR.get(last) as number;
}
