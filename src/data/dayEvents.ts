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

const WEIGHTED: readonly WeightedDayEvent[] = [
  {
    weight: 1.0,
    def: {
      id: 'd_queue_aunt',
      text: '前面排了很长的队。收银台只开了两个，一位大妈正把购物车横在过道上。',
      options: [
        {
          label: '排到底',
          outcome: '你排了四十分钟。轮到你的时候，筐里的东西还在。',
          // 排队的代价是力气与耐心，不是钱 —— 它是这三样里唯一不花钱的那个
          effect: { stamina: -10, mood: -3 }
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
          effect: { stamina: -4, cash: -10, mood: 4 }
        }
      ]
    }
  },
  {
    weight: 1.6,
    def: {
      id: 'd_panic_buying',
      text: '有人在群里说高速封了。前面几辆购物车都在往米面那边挤。',
      // 这条要的就是"今天该不该早买"的那个决定，所以它不限点位
      options: [
        {
          label: '先抢一轮',
          outcome: '你把架子上的主食扫掉一半。旁边有人看你。',
          // 削库存是**今天真实发生的**：抢完了就是抢完了，不是"你被禁止买"
          effect: { stockCut: { category: 'food', count: 4 }, mood: 5 }
        },
        {
          label: '照原计划买',
          outcome: '你没去挤。货架空了小半，剩下的够你今天的量。',
          effect: { stockCut: { category: 'food', count: 2 } }
        },
        {
          label: '今天不买了',
          outcome: '你空着手出来，站在门口听了会儿风。',
          effect: { visitLost: true, mood: -2 }
        }
      ]
    }
  },
  {
    weight: 1.4,
    def: {
      id: 'd_purchase_limit',
      text: '门口贴了张手写的纸：米面油盐，每人限购。理货员在数人头。',
      options: [
        {
          label: '按限购买',
          outcome: '你买到了限额内的一份。后面还有人排着。',
          effect: { limit: { category: 'food', max: 2 } }
        },
        {
          label: '换一家看看',
          outcome: '你转身去了别处。这里的队伍还在长。',
          effect: { visitLost: true }
        },
        {
          label: '找熟人通融',
          outcome: '你给理货员递了包烟，他装作没看见你多拿的那两件。',
          effect: { cash: -20, limit: { category: 'food', max: 5 } }
        }
      ]
    }
  },
  {
    weight: 0.6,
    def: {
      id: 'd_black_market',
      text: '五金店后巷停着一辆没牌照的面包车。有人从车窗里递出一箱货，收了钱就走。',
      // 只在五金店 —— 后巷这件事有地址，到处都能碰上就假了
      onlyShops: ['hardware'],
      options: [
        {
          label: '问一句价钱',
          outcome: '他伸出两根手指。你数出 {spentCash} 递过去，他把箱子塞进你怀里。',
          effect: { cash: -120, boxDefId: 'box_mixed' },
          requireFullCash: true
        },
        {
          label: '装作没看见',
          outcome: '你从巷口走过去了。后视镜里那辆车一直没动。',
          // §4A：每条事件都得有一条"不参与"的路。这里的代价只有一点心情 ——
          // 你没买东西、也没白跑一趟（店还开着，可以照常进去买）
          effect: { mood: -2 }
        },
        {
          label: '这店今天不进了',
          outcome: '你调头走了。那辆车还停在巷子里。',
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
