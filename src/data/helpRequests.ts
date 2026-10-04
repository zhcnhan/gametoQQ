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
import type { CategoryId, ContentTier } from '../model/types';

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
  /**
   * 内容分层（§10B.5 第 3 件）。
   *
   * ★ 这里刻意**不写 `?? 1` 的默认值**：分层是"这条内容打算在第几层放出来"的
   * 一个明确决定，不是可以省略的装饰。校验器要求每条都写。
   */
  tier: ContentTier;
  /** 生成时写下的「它逼玩家做什么决定」（评审留痕，不参与玩法，见 `ItemDef.decision`） */
  decision?: string;
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
    thanks: { cash: 60 },
    tier: 1
  },
  {
    id: 'q_wang_water',
    npcId: 'npc_wang',
    text: '楼上水管冻住了。她拿着两个空桶，问能不能接点水。',
    demands: [{ category: 'water', count: 4 }],
    trustGain: 1,
    trustLoss: 2,
    thanks: { cash: 30 },
    tier: 1
  },

  // ———————— 老同学 ————————
  {
    id: 'q_classmate_food',
    npcId: 'npc_classmate',
    text: '老同学在楼下等着，说家里断了两天，想先挪一点吃的。',
    demands: [{ category: 'food', count: 4 }],
    trustGain: 2,
    trustLoss: 3,
    thanks: { cash: 80 },
    tier: 1
  },
  {
    id: 'q_classmate_fuel',
    npcId: 'npc_classmate',
    text: '他搓着手，说家里的炉子灭了，还差一点烧的。',
    demands: [{ category: 'fuel', count: 2 }],
    trustGain: 2,
    trustLoss: 2,
    thanks: { cash: 100 },
    tier: 1
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
    thanks: { boxDefId: 'box_staple' },
    tier: 1
  },
  {
    id: 'q_shopkeeper_warmth',
    npcId: 'npc_shopkeeper',
    text: '他说晚上店里守不住，问有没有多的被子能匀一床。',
    demands: [{ category: 'warmth', count: 1 }],
    trustGain: 2,
    trustLoss: 1,
    thanks: { boxDefId: 'box_medical' },
    tier: 1
  },
  // ═══ 生成内容 求援-01 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "h2_wang_grandson_milk",
    npcId: "npc_wang",
    text: "王阿姨说孙子烧退了，但什么都吃不下，只想喝口奶。",
    demands: [
      {
        category: "food",
        count: 2
      }
    ],
    trustGain: 3,
    trustLoss: 3,
    thanks: {
      cash: 50
    },
    tier: 1,
    decision: "为孩子开口 —— 东西不多，但拒绝的代价落在\"那孩子\"身上"
  },
{
    id: "h2_wang_medicine_again",
    npcId: "npc_wang",
    text: "她又来了，站在门口没进来。说上次的药还剩两片，想再要一点备着。",
    demands: [
      {
        category: "medicine",
        count: 2
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    thanks: {
      cash: 40
    },
    tier: 2,
    decision: "第二次开口 —— 给了就等于答应\"以后也可以来\""
  },
{
    id: "h2_wang_blanket_old",
    npcId: "npc_wang",
    text: "她说楼上那户老人屋里没暖气，问有没有旧被子，薄的也行。",
    demands: [
      {
        category: "warmth",
        count: 1
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    tier: 3,
    decision: "替不在场的人要 —— 你给的不是她，而是一个你没见过的人"
  },
{
    id: "h2_classmate_fuel_deal",
    npcId: "npc_classmate",
    text: "老同学直说：他要两罐燃料，按市价一倍半收，现钱。",
    demands: [
      {
        category: "fuel",
        count: 2
      }
    ],
    trustGain: 2,
    trustLoss: 3,
    thanks: {
      cash: 130
    },
    tier: 1,
    decision: "一笔算得清的交易 —— 回报明显高于市价，而他为什么肯出这个价"
  },
{
    id: "h2_classmate_water_swap",
    npcId: "npc_classmate",
    text: "他拎着一箱东西站在门口，说拿这个换你四瓶水，行不行。",
    demands: [
      {
        category: "water",
        count: 4
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    thanks: {
      boxDefId: "box_medical"
    },
    tier: 2,
    decision: "以物易物 —— 他给的那箱东西你不知道里面是什么"
  },
{
    id: "h2_classmate_battery_bulk",
    npcId: "npc_classmate",
    text: "他说要清一批小东西，问能不能把你这儿的电池全吃下，付现金。",
    demands: [
      {
        category: "tool",
        count: 5
      }
    ],
    trustGain: 3,
    trustLoss: 2,
    thanks: {
      cash: 90
    },
    tier: 2,
    decision: "一次性清空一个品类 —— 钱到手了，而那格货架空着"
  },
{
    id: "h2_classmate_two_kinds",
    npcId: "npc_classmate",
    text: "他伸两根手指：一样两件，主食和药，凑齐了他就上楼。",
    demands: [
      {
        category: "food",
        count: 2
      },
      {
        category: "medicine",
        count: 2
      }
    ],
    trustGain: 3,
    trustLoss: 2,
    thanks: {
      cash: 110
    },
    tier: 3,
    decision: "一次要两样 —— 单笔拿得出，但两格同时短一截"
  },
{
    id: "h2_classmate_debt_called",
    npcId: "npc_classmate",
    text: "他提起大半年前那顿饭，说这回该轮到你搭把手了。",
    demands: [
      {
        category: "food",
        count: 5
      }
    ],
    trustGain: 2,
    trustLoss: 3,
    thanks: {
      cash: 70
    },
    tier: 3,
    decision: "人情债被当面提起 —— 拒绝会把旧账一起翻出来"
  },
{
    id: "h2_classmate_intel_road",
    npcId: "npc_classmate",
    text: "他说知道一条还能走通的路，但得先拿两件保暖的换这个消息。",
    demands: [
      {
        category: "warmth",
        count: 2
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    thanks: {
      cash: 20
    },
    tier: 3,
    decision: "买消息 —— 他说的那条路你没法事先验证"
  },
{
    id: "h2_classmate_run_out",
    npcId: "npc_classmate",
    text: "他脸色不好，说家里那点存货已经见底了，只差两天的量。",
    demands: [
      {
        category: "food",
        count: 3
      }
    ],
    trustGain: 3,
    trustLoss: 3,
    thanks: {
      cash: 45
    },
    tier: 2,
    decision: "他现在就快撑不住了 —— 不是\"想要\"，是\"顶不住\""
  },
{
    id: "h2_chen_door_lock",
    npcId: "npc_shopkeeper",
    text: "老陈说卷帘门的锁被撬了，问有没有能顶一夜的东西。",
    demands: [
      {
        category: "tool",
        count: 2
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    thanks: {
      boxDefId: "box_staple"
    },
    tier: 1,
    decision: "店是他的命 —— 这一件不给，他今天晚上守不住"
  },
{
    id: "h2_chen_light_night",
    npcId: "npc_shopkeeper",
    text: "他说店里晚上没灯，货被人摸走了两箱。想借点烧的。",
    demands: [
      {
        category: "fuel",
        count: 2
      }
    ],
    trustGain: 2,
    trustLoss: 1,
    thanks: {
      cash: 60
    },
    tier: 1,
    decision: "他要的不是取暖，是照明 —— 同一格燃料两个用途"
  },
{
    id: "h2_chen_empty_shelf",
    npcId: "npc_shopkeeper",
    text: "他说货架空了一半，问能不能从你这儿匀点主食摆上去充门面。",
    demands: [
      {
        category: "food",
        count: 6
      }
    ],
    trustGain: 3,
    trustLoss: 2,
    thanks: {
      cash: 100
    },
    tier: 3,
    decision: "他要的是\"看起来还有货\" —— 给出去的东西换不来任何实物"
  },
{
    id: "h2_chen_pay_upfront",
    npcId: "npc_shopkeeper",
    text: "老陈先把钱拍在桌上，说两件保暖的，多的算他谢你。",
    demands: [
      {
        category: "warmth",
        count: 2
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    thanks: {
      cash: 120
    },
    tier: 2,
    decision: "他先付钱 —— 这一单几乎没有风险，除了那两件东西本身"
  },
{
    id: "h2_chen_intel_rumor",
    npcId: "npc_shopkeeper",
    text: "他说听见批发那边在传一件事，跟你要囤的东西有关，问值不值一件药。",
    demands: [
      {
        category: "medicine",
        count: 1
      }
    ],
    trustGain: 2,
    trustLoss: 1,
    thanks: {
      cash: 15
    },
    tier: 3,
    decision: "一条还没证实的消息 —— 它可能让你少亏一批货，也可能是空话"
  },
{
    id: "h2_chen_too_much_ask",
    npcId: "npc_shopkeeper",
    text: "他这次要得多：四件药、两件工具，说店里出了点事。",
    demands: [
      {
        category: "medicine",
        count: 4
      },
      {
        category: "tool",
        count: 2
      }
    ],
    trustGain: 3,
    trustLoss: 3,
    thanks: {
      boxDefId: "box_mixed"
    },
    tier: 4,
    decision: "他从来只小口小口要 —— 这一次不一样，说明真的出事了"
  },
{
    id: "h2_wang_one_can",
    npcId: "npc_wang",
    text: "她只要一听罐头，说给楼下那个刚搬来的年轻人。",
    demands: [
      {
        category: "food",
        count: 1
      }
    ],
    trustGain: 2,
    trustLoss: 1,
    tier: 1,
    decision: "要得极少 —— 接了就立下\"这种要求可以提\"的规矩"
  },
{
    id: "h2_wang_sugar_for_child",
    npcId: "npc_wang",
    text: "她说孙子药太苦，问有没有甜的东西能压一压。",
    demands: [
      {
        category: "luxury",
        count: 1
      }
    ],
    trustGain: 3,
    trustLoss: 2,
    thanks: {
      cash: 35
    },
    tier: 2,
    decision: "她要的是奢侈那一格 —— 那本来是你留给自己撑过坏日子的"
  },
{
    id: "h2_wang_last_ask",
    npcId: "npc_wang",
    text: "她站在门口很久才开口，说这是最后一次来麻烦你。",
    demands: [
      {
        category: "water",
        count: 5
      }
    ],
    trustGain: 3,
    trustLoss: 3,
    tier: 3,
    decision: "她说\"最后一次\" —— 你信不信，以及要不要现在就把这句兑现"
  },
{
    id: "h2_classmate_quick",
    npcId: "npc_classmate",
    text: "他催得急，说半小时后就得走，只要两件，什么都行。",
    demands: [
      {
        category: "food",
        count: 2
      }
    ],
    trustGain: 2,
    trustLoss: 3,
    thanks: {
      cash: 40
    },
    tier: 1,
    decision: "他要得急 —— 急到没空挑，而\"什么都行\"背后是他真的很赶"
  },
{
    id: "h2_classmate_stand_in",
    npcId: "npc_classmate",
    text: "他说替楼下那家人来问，他们家男人伤了手，出不了门。",
    demands: [
      {
        category: "medicine",
        count: 3
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    thanks: {
      cash: 65
    },
    tier: 3,
    decision: "替别人来要 —— 要的人不在场，你也没法核对这是不是真的"
  },
{
    id: "h2_classmate_half_now",
    npcId: "npc_classmate",
    text: "他说五件太多，先给两件，剩下的他下周再来拿。",
    demands: [
      {
        category: "food",
        count: 2
      }
    ],
    trustGain: 1,
    trustLoss: 1,
    thanks: {
      cash: 30
    },
    tier: 1,
    decision: "他先把胃口缩小 —— 这是最难拒绝的一单，因为它几乎不痛"
  },
{
    id: "h2_chen_for_neighbor_shop",
    npcId: "npc_shopkeeper",
    text: "他说隔壁那家店也撑不住了，问能不能一起匀三件主食。",
    demands: [
      {
        category: "food",
        count: 3
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    thanks: {
      boxDefId: "box_staple"
    },
    tier: 3,
    decision: "他替同行开口 —— 那不是他的人情，但你欠的是他"
  },
{
    id: "h2_chen_warm_up",
    npcId: "npc_shopkeeper",
    text: "他搓着手说店里冷得没法待，要点烧的，明天就还。",
    demands: [
      {
        category: "fuel",
        count: 3
      }
    ],
    trustGain: 2,
    trustLoss: 1,
    thanks: {
      cash: 75
    },
    tier: 2,
    decision: "他说\"明天就还\" —— 而你还记得他上次还没还"
  },
{
    id: "h2_chen_small_change",
    npcId: "npc_shopkeeper",
    text: "他有点不好意思，说只要一件工具，什么都行。",
    demands: [
      {
        category: "tool",
        count: 1
      }
    ],
    trustGain: 1,
    trustLoss: 0,
    tier: 1,
    decision: "一件小东西，而他说了\"不好意思\" —— 这一单拒绝几乎不扣人情"
  },
{
    id: "h2_wang_pair_for_winter",
    npcId: "npc_wang",
    text: "她说要降温了，想给自己和孙子各备一件厚的。",
    demands: [
      {
        category: "warmth",
        count: 2
      }
    ],
    trustGain: 2,
    trustLoss: 2,
    thanks: {
      cash: 85
    },
    tier: 2,
    decision: "两件 —— 一件给她自己，一件给孙子。只给一件的话，给谁"
  },
{
    id: "h2_wang_soap_and_water",
    npcId: "npc_wang",
    text: "她说楼里有人病了，得烧水擦洗，问能不能给点水和烧的。",
    demands: [
      {
        category: "water",
        count: 3
      },
      {
        category: "fuel",
        count: 2
      }
    ],
    trustGain: 3,
    trustLoss: 3,
    tier: 4,
    decision: "要两样，而且是为了一个病人 —— 这是本批里最难开口拒绝的一单"
  },
  // ═══ 生成内容 求援-01 止 ═══
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
