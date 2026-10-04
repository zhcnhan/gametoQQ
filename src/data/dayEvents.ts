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
 * ★ 那笔"逐日物价只覆盖寒潮"的账（原编号 D-19）**已经清偿**：
 *   曲线改成按 `disasterId` 的严重度算，见下面 `dayPriceFactor` 的注释。
 */
import { severityAt } from '../model/calendar';
import { getDisasterDef, hasDisasterDef } from './disaster';
import type { DayEventDef } from '../model/types';

/**
 * "今天这家店有事"的概率。
 *
 * ## ★ 为什么是概率，而不是一个权重常数（M3 改的，这是修一个真的坑）
 *
 * 原来这里是一个**权重** `DAY_EVENT_NONE_WEIGHT = 3.0`，注释写着
 * "3.0 配合 4 条事件的权重 → 有事的概率 ≈ 六成（约四成没事）"。
 * 那句话在当时是对的，但它把"六成"这件事**挂在了事件池的大小上**：
 *
 * ```
 * 有事概率 = 池子总权重 / (池子总权重 + NONE)
 * ```
 *
 * 于是 M3 把白天事件从 4 条加到 24 条时，同一个 `3.0` 让有事概率变成了
 * **85.85%** —— 一天进三家店，家家有事，白天从"有变数"变成"例会"，
 * 而**没有任何一处代码或类型会报错**。守卫它的那条测试报的是
 * "expected 0.8585 to be less than 0.75"，读起来像是测试太严，其实是真的坏了。
 *
 * 同一个坑在突发事件那边也踩了一次（`EMERGENCY_NONE_WEIGHT`，
 * 7 条 → 28 条时有事概率从 30% 涨到 63%）。所以两处一起改成**概率口径**：
 * 设计意图写在概率上，池子多大由期望权重反推。
 *
 * ★ 附带的好处：`eventPoolWeights`（灾难的"事件池权重"维度）会乘事件的权重，
 * 这时 NONE 也跟着按比例缩放 —— "这场灾难里事件更多/更少"变成一件能表达的事。
 * 原来那种写法下，倍率一变，"没事"的概率会跟着乱飘。
 */
export const DAY_EVENT_CHANCE = 0.6;

/**
 * 抽签池里"今天没事"那一格的权重，**由 `DAY_EVENT_CHANCE` 与当次池子反推**。
 *
 * 为什么做成函数而不是常数：池子的大小是**当场**才知道的
 * （`onlyShops` 会把点位之外的条目权重压成 0，灾难的 `eventPoolWeights`
 * 又会乘倍率）。所以"没事"的权重必须跟着那一次的实际池子算，
 * 而不是在模块加载时算一个固定值。
 *
 * @param poolWeight 这一次实际参与抽签的事件权重合计
 */
export function noneWeightFor(poolWeight: number): number {
  if (!(poolWeight > 0)) return 1; // 空池：只剩"没事"这一格
  return (poolWeight * (1 - DAY_EVENT_CHANCE)) / DAY_EVENT_CHANCE;
}

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
      ],
      tier: 1
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
      ],
      tier: 1
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
      ],
      tier: 1
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
      ],
      tier: 1
    }
  },
  // ═══ 生成内容 白天-01 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
  {
    weight: 1.0,
    def:   {
      id: "d_truck_unloading",
      text: "后门有人在卸货，司机在看手机。纸箱上印着罐头。",
      onlyShops: ["supermarket"],
      tier: 1,
      decision: "趁乱搬两箱（费体力），还是照常排队买限购的",
      options: [
        {
          label: "搬两箱走",
          outcome: "两箱罐头上了车。司机抬头看了一眼，没说话。",
          effect: {
            grab: {
              category: "food",
              count: 6
            },
            stamina: -6
          }
        },
        {
          label: "照常排队",
          outcome: "队伍没动。前面的人在数货架。",
          effect: {
            mood: 2
          }
        }
      ],
      tags: ["queue", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_cash_only",
      text: "收银台贴了张纸：今日只收现金，不找零。",
      tier: 1,
      decision: "为了凑整多拿一件，还是放下东西去别家",
      options: [
        {
          label: "多拿一包盐",
          outcome: "盐进了袋子。{spentCash}，正好。",
          effect: {
            grab: {
              category: "food",
              count: 1
            },
            cash: -8
          },
          requireFullCash: true
        },
        {
          label: "换家店看",
          outcome: "你拎着空篮子出了门。",
          effect: {
            stamina: 2,
            mood: 1
          }
        }
      ],
      tags: ["panic", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_price_jump",
      text: "货架上的价签换过了。燃料罐从 30 跳到了 38。",
      onlyShops: ["hardware"],
      tier: 1,
      decision: "按新价囤两罐（怕明天更贵），还是只买一罐看情况",
      options: [
        {
          label: "囤两罐",
          outcome: "两罐上车。{spentCash}。",
          effect: {
            grab: {
              category: "fuel",
              count: 2
            },
            cash: -76
          },
          requireFullCash: true
        },
        {
          label: "买一罐",
          outcome: "你把一罐放进篮子。价签明天还会换。",
          effect: {
            grab: {
              category: "fuel",
              count: 1
            },
            cash: -38
          },
          requireFullCash: true
        },
        {
          label: "记下新价",
          outcome: "你把 38 记进了手机备忘录。罐子还在货架上。",
          effect: {
            mood: 2
          }
        }
      ],
      tags: ["cold"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_kid_candy",
      text: "排在你前面的小孩盯着收银台边的糖，他妈妈在看价签。",
      tier: 1,
      decision: "替他付了（小钱换人情），还是不管",
      options: [
        {
          label: "一起结了",
          outcome: "他妈妈连声道谢。{spentCash}。",
          effect: {
            cash: -4,
            mood: 5
          }
        },
        {
          label: "看自己的单",
          outcome: "队伍往前挪了一格。",
          effect: {
            stamina: 2
          }
        }
      ],
      tags: ["neighbor", "people"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_last_box",
      text: "货架上只剩最后一箱矿泉水。你和一个男人同时伸手。",
      tier: 1,
      decision: "让给他（换个人情），还是坚持先到先得",
      options: [
        {
          label: "让他先拿",
          outcome: "他愣了一下，说药店后巷还有半垛。",
          effect: {
            mood: 3
          }
        },
        {
          label: "抱走这箱",
          outcome: "水很沉。你把它塞进了车里。",
          effect: {
            grab: {
              category: "water",
              count: 6
            },
            stamina: -4
          }
        }
      ],
      tags: ["market", "panic", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_pharmacy_queue",
      text: "药店门口排到了马路牙子上。队尾有人在小声念药名。",
      onlyShops: ["pharmacy"],
      tier: 1,
      decision: "排进去（耗体力），还是下午再来碰运气",
      options: [
        {
          label: "排队等",
          outcome: "四十分钟。你买到了感冒药和绷带。",
          effect: {
            grab: {
              category: "medicine",
              count: 2
            },
            stamina: -5
          }
        },
        {
          label: "下午再来",
          outcome: "你在对面坐了一会儿。队伍没有变短。",
          effect: {
            stamina: 3
          }
        }
      ],
      tags: ["heat", "queue", "water"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_bulk_rice",
      text: "粮油区挂了牌子：整袋米限购一袋，但可以按批发价拼单。",
      onlyShops: ["supermarket"],
      tier: 1,
      decision: "和陌生人拼三袋拿批发价（要垫钱），还是自己买一袋",
      options: [
        {
          label: "拼单三袋",
          outcome: "你们四个人凑了一单，三袋米上了车。{spentCash}。",
          effect: {
            grab: {
              category: "food",
              count: 3
            },
            cash: -105
          },
          requireFullCash: true
        },
        {
          label: "自己扛一袋",
          outcome: "一袋四十。你扛着它排了二十分钟队。",
          effect: {
            grab: {
              category: "food",
              count: 1
            },
            cash: -40,
            stamina: -2
          },
          requireFullCash: true
        },
        {
          label: "今天先不买",
          outcome: "你把批发价记在了单子上。米还堆在原地。",
          effect: {
            mood: 2
          }
        }
      ],
      tags: ["supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_shelf_empty",
      text: "泡面那排货架空了。理货员说下午三点补货。",
      tier: 1,
      decision: "等三小时补货（耗时间），还是买旁边的挂面替代",
      options: [
        {
          label: "等到三点",
          outcome: "补货车来了。你抱走半箱泡面。",
          effect: {
            grab: {
              category: "food",
              count: 4
            },
            stamina: -4
          }
        },
        {
          label: "拿挂面",
          outcome: "挂面还剩很多。你抓了两把。",
          effect: {
            grab: {
              category: "food",
              count: 2
            },
            cash: -14
          },
          requireFullCash: true
        }
      ],
      tags: ["queue", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_old_man_scale",
      text: "门口有个老人摆摊卖自家晒的干菜，用一杆小秤。",
      tier: 1,
      decision: "买他的干菜（比超市贵一点），还是进超市买",
      options: [
        {
          label: "买两把干菜",
          outcome: "秤杆压得平平的，两把干菜装进袋子。{spentCash}。",
          effect: {
            grab: {
              category: "food",
              count: 2
            },
            cash: -18,
            mood: 2
          },
          requireFullCash: true
        },
        {
          label: "进超市",
          outcome: "超市的干菜区空了半边。",
          effect: {
            mood: 1,
            stamina: 2
          }
        }
      ],
      tags: ["supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_delivery_app",
      text: "手机弹出通知：外卖平台还能下单，配送费翻了三倍。",
      tier: 1,
      decision: "花高价让人送上门（省体力费钱），还是自己出门搬",
      options: [
        {
          label: "下单叫人送",
          outcome: "骑手把袋子放在门口。{spentCash}。",
          effect: {
            boxDefId: "box_staple",
            cash: -90
          },
          requireFullCash: true
        },
        {
          label: "关掉通知",
          outcome: "你把手机揣回兜里。自己的事自己干。",
          effect: {
            stamina: 2,
            mood: 1
          }
        }
      ],
      tags: ["panic"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_tool_demo",
      text: "五金店老板在店门口试一台手摇发电机。围观的人不多。",
      onlyShops: ["hardware"],
      tier: 1,
      decision: "现在就买（怕断货），还是再看看别家",
      options: [
        {
          label: "搬一台走",
          outcome: "老板帮你抬上车。{spentCash}。",
          effect: {
            grab: {
              category: "tool",
              count: 1
            },
            cash: -120
          },
          requireFullCash: true
        },
        {
          label: "记下型号",
          outcome: "你说再想想。老板点了点头。",
          effect: {
            mood: 2
          }
        }
      ],
      tags: ["cold"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_scratch_card",
      text: "超市搞活动：满两百抽一次奖。奖品池里有一台暖风机。",
      onlyShops: ["supermarket"],
      tier: 1,
      decision: "为了凑单多买（赌一把奖品），还是只买清单上的",
      options: [
        {
          label: "凑到两百",
          outcome: "你刮开涂层：一个福袋。{spentCash}。",
          effect: {
            boxDefId: "box_mixed",
            cash: -200
          },
          requireFullCash: true
        },
        {
          label: "只买清单",
          outcome: "账算得清清楚楚，清单上的东西都拿齐了。{spentCash}。",
          effect: {
            grab: {
              category: "food",
              count: 2
            },
            cash: -60
          },
          requireFullCash: true
        },
        {
          label: "不凑热闹",
          outcome: "你绕开了堆头的活动海报。",
          effect: {
            mood: 2
          }
        }
      ],
      tags: ["supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_pharmacy_bundling",
      text: "药店的感冒药不单卖了，要搭一盒维生素才给结账。",
      onlyShops: ["pharmacy"],
      tier: 1,
      decision: "接受搭售（多花钱拿了不需要的），还是去别处找",
      options: [
        {
          label: "连盒带走",
          outcome: "维生素塞在袋底。{spentCash}。",
          effect: {
            grab: {
              category: "medicine",
              count: 2
            },
            cash: -45
          },
          requireFullCash: true
        },
        {
          label: "转身离开",
          outcome: "你去了下一条街。腿有点酸。",
          effect: {
            stamina: 2
          }
        }
      ],
      tags: []
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_price_freeze",
      text: "广播里说：从明天起，主城区生活物资限价三天。",
      tier: 1,
      decision: "今天按现价抢（怕限价后断货），还是等明天的限价",
      options: [
        {
          label: "今天就买",
          outcome: "货架还有货，三袋主食搬上了车。{spentCash}。",
          effect: {
            grab: {
              category: "food",
              count: 3
            },
            cash: -70
          },
          requireFullCash: true
        },
        {
          label: "等明天",
          outcome: "你把清单重新排了一遍顺序。",
          effect: {
            mood: 2,
            stamina: 1
          }
        }
      ],
      tags: ["queue", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_free_hotwater",
      text: "药店门口支了个桶，写着免费热水。队伍比买药的还长。",
      onlyShops: ["pharmacy"],
      tier: 1,
      decision: "花体力排队接两壶（省家里燃料），还是回家自己烧",
      options: [
        {
          label: "排队接水",
          outcome: "两壶热水。拎着沉，但家里省了一罐气。",
          effect: {
            stamina: -3,
            mood: 4
          }
        },
        {
          label: "回家自己烧",
          outcome: "炉子点上了。水开还要二十分钟。",
          effect: {
            stamina: 2
          }
        }
      ],
      tags: ["heat", "queue", "water"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_student_volunteers",
      text: "几个穿红马甲的学生在帮老人搬东西，不收钱。",
      tier: 1,
      decision: "请他们帮你搬（欠人情），还是自己慢慢来",
      options: [
        {
          label: "请他们搭手",
          outcome: "两个学生帮你把米扛上了楼。你塞了两瓶水。",
          effect: {
            stamina: 5,
            mood: 2
          }
        },
        {
          label: "自己来",
          outcome: "分了三趟，搬完了。腿肚子在打颤。",
          effect: {
            stamina: -2,
            mood: 4
          }
        }
      ],
      tags: ["neighbor", "people"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_counter_short",
      text: "前面的人和收银员吵起来了：找零少了五块。",
      tier: 1,
      decision: "帮他说话（耽误时间换人情），还是低头结账",
      options: [
        {
          label: "说句公道话",
          outcome: "监控回放了。那人拿到五块，朝你点头。",
          effect: {
            mood: 3
          }
        },
        {
          label: "低头结账",
          outcome: "你数了两遍找零，一袋米拎在手上。{spentCash}。",
          effect: {
            grab: {
              category: "food",
              count: 1
            },
            cash: -15
          },
          requireFullCash: true
        }
      ],
      tags: ["panic", "people", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_night_market",
      text: "天黑了，后巷摆起一溜地摊。有蜡烛，有电池，有散装米。",
      tier: 1,
      decision: "在地摊补货（没小票但便宜），还是去正规店",
      options: [
        {
          label: "地摊扫货",
          outcome: "摊主用报纸给你包好。{spentCash}。",
          effect: {
            grab: {
              category: "food",
              count: 3
            },
            cash: -40
          },
          requireFullCash: true
        },
        {
          label: "不进巷子",
          outcome: "巷口的路灯坏了一盏。你绕开了。",
          effect: {
            mood: 2,
            stamina: 1
          }
        }
      ],
      tags: ["dark", "market", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_senior_short",
      text: "前面的老人翻遍口袋，还差四十块。收银员在等。",
      tier: 1,
      decision: "替他垫上（他说明天还），还是装没看见",
      options: [
        {
          label: "替他垫上",
          outcome: "晚上他来敲门，还了钱，多给了五块谢意。",
          effect: {
            cash: 5,
            mood: 4
          }
        },
        {
          label: "装没看见",
          outcome: "队伍慢慢往前挪。",
          effect: {
            stamina: 2
          }
        }
      ],
      tags: ["neighbor", "people"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_coupon_expiry",
      text: "手机里有张满一百减二十的券，今天到期。",
      tier: 1,
      decision: "为用券多买到一百（买本来不买的），还是让券作废",
      options: [
        {
          label: "凑单一百",
          outcome: "券核掉了，凑够一百，东西到手。{spentCash}。",
          effect: {
            grab: {
              category: "food",
              count: 3
            },
            cash: -80
          },
          requireFullCash: true
        },
        {
          label: "让它作废",
          outcome: "券灰了。你只买了需要的。{spentCash}。",
          effect: {
            grab: {
              category: "food",
              count: 1
            },
            cash: -20
          },
          requireFullCash: true
        },
        {
          label: "关掉手机",
          outcome: "券静静躺在那里。你什么也没买。",
          effect: {
            mood: 2
          }
        }
      ],
      tags: ["panic", "supply"]
    }
  },
  // ═══ 生成内容 白天-01 止 ═══,
  // ═══ 生成内容 白天-02 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
  {
    weight: 1.0,
    def:   {
      id: "d_levee_shift",
      text: "居委会的人上门，说夜里堤上要人值守，一户出一个。",
      tier: 2,
      decision: "自己去值守（耗时间体力），出钱请人替，还是不去",
      options: [
        {
          label: "去值守",
          outcome: "堤上守到后半夜。回来睡了半天，楼道里见了点头。",
          effect: {
            stamina: -4,
            mood: 5
          }
        },
        {
          label: "出钱请人",
          outcome: "你托人换了班，{spentCash}。顺手在镇上带了箱粮油回来。",
          effect: {
            cash: -60,
            boxDefId: "box_staple"
          },
          requireFullCash: true
        },
        {
          label: "不去",
          outcome: "你没去。第二天楼道里没人跟你打招呼。",
          effect: {
            stamina: 3,
            mood: 1
          }
        }
      ],
      tags: ["neighbor", "water"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_elevator_down",
      text: "楼里电梯停了，检修牌挂在门口。家住十几层。",
      tier: 1,
      decision: "自己扛一趟上楼，花钱请人搬，还是只拿最轻的",
      options: [
        {
          label: "自己扛",
          outcome: "两趟。米和水都拿进了门，腿是软的。",
          effect: {
            grab: {
              category: "food",
              count: 2
            },
            stamina: -6
          }
        },
        {
          label: "请人搬",
          outcome: "两个人分两趟，把米和水都拿到了门口，{spentCash}。",
          effect: {
            cash: -50,
            boxDefId: "box_staple"
          },
          requireFullCash: true
        },
        {
          label: "只拿最轻的",
          outcome: "你拎着两袋挂面上了楼。剩下的还堆在楼下。",
          effect: {
            stamina: -1,
            mood: 2
          }
        }
      ],
      tags: ["supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_repair_crew",
      text: "楼下贴了通知：施工队明天进场，上午断水两小时。",
      tier: 1,
      decision: "按时间去接水，把东西挪开，还是去外面待着",
      options: [
        {
          label: "照表接水",
          outcome: "两个塑料桶都塞满了，一共四桶水。水龙头再开时已经浑了。",
          effect: {
            grab: {
              category: "water",
              count: 2
            },
            stamina: -2
          }
        },
        {
          label: "挪开东西",
          outcome: "厨房地面的箱子全搬到了客厅，底下一层还翻出两袋没拆的挂面。",
          effect: {
            stamina: -3,
            grab: {
              category: "food",
              count: 2
            }
          }
        },
        {
          label: "去外面待着",
          outcome: "你去了趟超市，回来水管已经修好。",
          effect: {
            mood: 2,
            stamina: 2
          }
        }
      ],
      tags: ["supply", "water"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_rumor_wave",
      text: "业主群里有人说，下个月开始限供，配给要减半。",
      tier: 2,
      decision: "跟着群里去抢，自己跑一趟核实，还是当没看见",
      options: [
        {
          label: "跟着抢",
          outcome: "超市九点就空了。你抢到三袋米。",
          effect: {
            grab: {
              category: "food",
              count: 3
            },
            stamina: -4
          }
        },
        {
          label: "去核实",
          outcome: "你去了趟粮站，门口的告示还是老样子。",
          effect: {
            mood: 3,
            stamina: -1
          }
        },
        {
          label: "当没看见",
          outcome: "你把群消息设成了免打扰。",
          effect: {
            mood: 2,
            stamina: 2
          }
        }
      ],
      tags: ["panic", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_neighbor_dispute",
      text: "楼道里两家在吵，为的是谁家接了公共插座的电。",
      tier: 1,
      decision: "帮一边说话，居中劝和，还是关上门不管",
      options: [
        {
          label: "帮一边",
          outcome: "你说了句公道话。另一家瞪了你一眼。",
          effect: {
            mood: 2,
            stamina: 1
          }
        },
        {
          label: "劝和",
          outcome: "你把两家拉开，各说了一半。",
          effect: {
            mood: 4,
            stamina: -1
          }
        },
        {
          label: "关门",
          outcome: "门合上了。吵声隔了一层，还是听得见。",
          effect: {
            stamina: 3,
            mood: 1
          }
        }
      ],
      tags: ["neighbor", "people"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_claim_denied",
      text: "手机进来一条短信：理赔申请不在赔付范围，请知悉。",
      tier: 2,
      decision: "打电话去争，认了，还是找邻居问问",
      options: [
        {
          label: "打电话争",
          outcome: "打了四十分钟，对方把申请退回了重审。",
          effect: {
            mood: 4,
            stamina: -2
          }
        },
        {
          label: "认了",
          outcome: "你把短信划掉了，这事翻篇。",
          effect: {
            mood: 2,
            stamina: 2
          }
        },
        {
          label: "问邻居",
          outcome: "楼下老王说他家上个月也这么被退过。",
          effect: {
            mood: 3,
            stamina: -1
          }
        }
      ],
      tags: ["neighbor"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_watch_patrol",
      text: "小区门口设了卡，进出要登记，拎工具的人要开包看。",
      tier: 2,
      decision: "配合登记，绕开卡口，还是出人轮值",
      options: [
        {
          label: "配合登记",
          outcome: "本子写了两行。包打开，是你自己家的扳手。",
          effect: {
            mood: 2,
            stamina: 1
          }
        },
        {
          label: "绕开卡口",
          outcome: "你从侧门进了，多走了十分钟。",
          effect: {
            stamina: -2,
            mood: 3
          }
        },
        {
          label: "出人轮值",
          outcome: "你报了明天的班，队里记了你一功。",
          effect: {
            mood: 3,
            stamina: -1
          }
        }
      ],
      tags: ["people", "panic"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_long_queue",
      text: "街口排了两支队，一队粮油，一队药。今天只够排一次。",
      tier: 1,
      decision: "排粮，排药，还是干脆走人",
      options: [
        {
          label: "排粮",
          outcome: "队挪得慢。傍晚你拎回两袋主食。",
          effect: {
            grab: {
              category: "food",
              count: 2
            },
            stamina: -4
          }
        },
        {
          label: "排药",
          outcome: "药店的号发到一百开外。你拿到两盒消炎药。",
          effect: {
            grab: {
              category: "medicine",
              count: 2
            },
            stamina: -5
          }
        },
        {
          label: "走人",
          outcome: "两条队都没排，你抄近路回了家。",
          effect: {
            mood: 3,
            stamina: 2
          }
        }
      ],
      tags: ["queue", "supply"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_loan_shark",
      text: "有人敲门递名片，说急用钱可以押东西，三天不计息。",
      tier: 2,
      decision: "借一笔补货，押东西换钱，还是不借",
      options: [
        {
          label: "借一笔",
          outcome: "条子写好，钱点到手。你当天补了一趟货。",
          effect: {
            boxDefId: "box_staple",
            mood: -4
          }
        },
        {
          label: "押东西换钱",
          outcome: "一箱罐头搬下楼，他数了两百给你。",
          effect: {
            cash: 200,
            mood: -3
          }
        },
        {
          label: "不借",
          outcome: "你把名片还了回去，门关上。",
          effect: {
            mood: 3,
            stamina: 1
          }
        }
      ],
      tags: ["market", "panic"]
    }
  },
  {
    weight: 1.0,
    def:   {
      id: "d_charity_tent",
      text: "广场支了个棚，写着免费领物资。队伍排出去两条街。",
      tier: 1,
      decision: "排队去挤，等人少了再去，还是不去",
      options: [
        {
          label: "排队去挤",
          outcome: "挤了四十分钟，领到两袋挂面和一瓶水。",
          effect: {
            grab: {
              category: "food",
              count: 2
            },
            stamina: -5
          }
        },
        {
          label: "等会儿再去",
          outcome: "下午人少了，棚里只剩几包纸巾，你也拿了一份。",
          effect: {
            grab: {
              category: "food",
              count: 1
            },
            mood: 1
          }
        },
        {
          label: "不去",
          outcome: "你路过看了一眼就回家了。",
          effect: {
            mood: 2,
            stamina: 2
          }
        }
      ],
      tags: ["people", "queue", "supply"]
    }
  },
  // ═══ 生成内容 白天-02 止 ═══
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
 * 囤货期那 7 档（D-7 ~ D-1）。
 *
 * ★ 这七个数是**原样搬过来的**：原来那张 22 行表里，囤货期这 7 档是
 * 手写并校对过的（灾前促销 → 一天天收敛到原价），搬过来时**一个都没动**。
 * 这个函数认出 D-7 之前的日子并把它们夹到第一档 —— 物价不会自己往回走。
 */
const STOCKPILE_PRICE: readonly number[] = [0.95, 0.95, 0.98, 0.98, 1.0, 1.05, 1.12];

function stockpilePriceFactor(day: number): number {
  const idx = Math.min(STOCKPILE_PRICE.length - 1, Math.max(0, day + 7));
  return STOCKPILE_PRICE[idx] as number;
}

/** 灾难降临那天（D-Day）的物价：原表的值，也是灾难期的**底价** */
const D_LANDING_PRICE = 1.25;
/** 这一场最凶的时候的物价：原表 D+14 的值 */
const D_MAX_PRICE = 2.2;
/**
 * 严重度 → 价格的斜率：`1.25 + 0.95 × severity`。
 *
 * 这个数是**从寒潮反推的**：寒潮最凶的那天（severity 1.0）原表给 2.2，
 * 于是 `1.25 + k = 2.2` → `k = 0.95`。
 * 它让"满强度的灾难"正好落在原表的天花板上，而不是我另拍一个数。
 */
const D_SEVERITY_PRICE_SLOPE = 0.95;

/**
 * 逐日上行的物价倍率（§6.2「物价波动」）。
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
 * ## ★★ 它现在**按灾难**算（D-19 清偿）
 *
 * 原来这里是一张**写死的 22 行表**，只覆盖寒潮。116 场灾难落地之后，
 * 另外 115 场全都在按寒潮的曲线定价 —— "这一场什么都贵得离谱、
 * 那一场反而有促销"这件事**根本不存在**。
 *
 * 现在它的形状由**这一场自己的严重度曲线**决定：
 *
 * | 相位 | 公式 | 直觉 |
 * | --- | --- | --- |
 * | 囤货期（day < 0） | 沿用原表那 7 档（0.95 → 1.12） | 灾前促销一路收敛到原价，**七天七档** |
 * | 生存期（day ≥ 0） | `1.25 + 0.95 × (severity - 灾首强度) / (1 - 灾首强度)` | 灾难最凶的那天 → 2.20 |
 *
 * ★ 生存期那条式子的**参照点是"这一场第 0 天的强度"**，不是 0：
 * 灾难降临那天（D-Day）物价就该跳到 1.25，而那一刻的 severity
 * 各场不同（寒潮 0.55、热浪 1.0）。以灾首为起点归一化之后：
 *
 *  · 寒潮（0.55 → 1.0 慢慢逼近）→ 1.25 爬到 2.20（**与原表逐日一致**）；
 *  · 热浪（一上来就是 1.0）→ 从头到尾 2.20（"你有钱也买不到"）；
 *  · 极地涡旋（0.9 → 0.5 **衰减型**）→ 从 1.25 往下走（灾难过去了，货回来了）。
 *
 * ★ 这不只是"换一种算法"，它**真的让 116 场不一样**：实测按逐日严重度
 * 分形状有 **20 种**。而**只看峰值是分不出来的** —— 116 场的峰值全是 1.0，
 * 我第一版按峰值算，结果 116 场算出来一模一样，
 * 那只是把"一张手写表"换成了"一条大家都一样的公式"。
 *
 * ★ 囤货期那 7 档**刻意不按灾难变**：那 7 天灾难还没来，
 * 玩家面对的是同一件事 —— 消息在传、东西在涨。
 * 让它在 116 场之间也各不相同，只会让"灾前该不该早买"这个
 * 本来很清楚的判断变得没法学习。
 *
 * ★ 它只影响**囤货期**的实际操作（生存期买不了东西），
 * 生存期那几档是留给"读到日报的人"的参照物：日历在涨，你的库存不会。
 */
export function dayPriceFactor(day: number, disasterId: string): number {
  const key = Math.round(day);
  /*
   * ★ 认不出的灾难 id **不许抛异常**：这条路径跑在**商店渲染与日报**上，
   * 而灾难 id 存在存档里（可手改、可来自旧版本）。
   * `getDisasterDef` 对未知 id 是抛的 —— 所以这里必须先用 `hasDisasterDef` 问一句，
   * 与 `normalizeRun` 的自愈是同一条纪律。
   *
   * ★ 兜底值刻意取"灾首原价 1.25"而不是 1.0：
   * 一个坏掉的 id 不该让整城东西变便宜（那是个对玩家有利的 bug，
   * 比崩溃更容易活下来，也更难被发现）。
   */
  const def = hasDisasterDef(disasterId) ? getDisasterDef(disasterId) : null;
  /*
   * ① 这一场**自带曲线**就用它。
   *
   * ★ 寒潮走这一条 —— 它那条曲线是手写并校对过的历史数据，
   * 不能由公式生成（拟合最大偏差 0.29，见 `disaster.ts` 的 `priceCurve` 注释）。
   * 查不到那一天就夹到最近的一档：**物价不会自己往回走**。
   */
  const curve = def?.priceCurve;
  if (curve) {
    const hit = curve[key];
    if (typeof hit === 'number' && Number.isFinite(hit)) return hit;
    const keys = Object.keys(curve)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (keys.length > 0) {
      const first = keys[0] as number;
      const last = keys[keys.length - 1] as number;
      const at = key < first ? first : last;
      const v = curve[at];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  // ② 没自带曲线的（那一百多场）：由这一场的严重度推
  if (key < 0) return stockpilePriceFactor(key);
  if (!def) return D_LANDING_PRICE;
  /*
   * 生存期：价格 = 基准 × 这一天的严重度。
   *
   * ## 口径（改过两版，两版都错，值得记下来）
   *
   * 第一版按**峰值**算 → 116 场的峰值全是 1.0，算出来一模一样，
   * 等于把"一张手写表"换成"一条大家都一样的公式"。
   *
   * 第二版按"相对灾首的进展"算 → **64 场衰减型灾难全被夹成 1.25**。
   * 根因是我把**"灾难有多严重"和"市场有多慌"混成了一个数**：
   * 一个 0.9 → 0.5 的灾难，到后面确实没那么惨了，但**城里还是买不到东西**，
   * 价格不该回到灾前的水平。
   *
   * 现在这一版只做一件事：**把这一天的严重度线性换成价格**。
   * 参照点是"曾经最凶的那一天"，而不是"灾难降临那天" ——
   * 后者会让"一上来就很凶"的灾难（热浪）从头到尾顶格，
   * 而那正是它们应有的样子。
   *
   * ★ 底价 `D_LANDING_PRICE`（1.25）：只要还在灾难期，东西就不会回到灾前价位。
   * 那是"灾难还在"这件事本身的价格。
   */
  const severity = Math.max(0, Math.min(1, severityAt(def, key)));
  const price = D_LANDING_PRICE + D_SEVERITY_PRICE_SLOPE * severity;
  return Math.max(D_LANDING_PRICE, Math.min(D_MAX_PRICE, price));
}
