/**
 * 夜间事件静态表（§6.2「夜间小事件」）。
 *
 * 设计约束（都在 §11 的「克制化」红线上）：
 *  - 文本 1~2 句，**陈述处境，不写台词腔**。"楼上的王阿姨敲门"比"王阿姨说：'你囤了好多啊！'"好得多；
 *  - 选项 2~3 个，标签 ≤ 8 字（手机竖屏一行放得下）；
 *  - **"什么都不做"永远是合法出口**，但它不在这个表里 —— 它是界面上一条常驻的「关灯睡觉」，
 *    存进存档时用 `NIGHT_SLEEP`（-1）标记。这样每条事件都能只写"做事"的选项，不用每行都抄一遍"睡觉"；
 *  - 后果只用**当前已经有意义的数值**（现金 / 健康 / 心情 / 体力 / 庇护所）。
 *    信任值（§6.5 的人情）与情报要等阶段 D 有 NPC 之后才会在这里出现；
 *  - 数值一律走**交换**：没有白拿的好处，也没有纯粹的坑。玩家读完应该能自己算出划不划算。
 */

import type { NightEventDef } from '../model/types';

/** 「直接睡」：不参与今晚的事件。存进 `NightState.choice` 的哨兵值 */
export const NIGHT_SLEEP = -1;

export const NIGHT_EVENT_DEFS: readonly NightEventDef[] = [
  {
    id: 'n_night_shift',
    text: '单位群里在喊人顶夜班，双倍工资。',
    options: [
      {
        label: '去顶班',
        outcome: '你在单位坐到天亮。回来的时候，楼道里已经有人出门上班了。',
        effect: { stamina: -25, cash: 120 }
      },
      {
        label: '说家里有事',
        outcome: '你没去。群里很快没人说话了。',
        effect: { mood: -3 }
      }
    ],
    tier: 1
  },
  {
    id: 'n_neighbor_soup',
    text: '王阿姨敲门，说她家煮了汤，让你过去坐坐。',
    options: [
      {
        label: '过去坐坐',
        outcome: '喝了两碗汤，听她念了半小时儿子。回来的时候身上是暖的。',
        effect: { mood: 12, stamina: -8 }
      },
      {
        label: '隔着门说累了',
        outcome: '她在门口站了会儿才走。你听见她上楼的声音。',
        effect: { mood: -5 }
      }
    ],
    tier: 1
  },
  {
    id: 'n_midnight_restock',
    text: '有人说南边那家超市半夜补货。小区里已经有车出去了。',
    options: [
      {
        // 买货：钱不够就是买不成（界面上会置灰并写明还差多少）
        label: '开车去看看',
        outcome: '你摸黑拉回来一箱，箱子上没写标签。',
        effect: { stamina: -18, cash: -50, boxDefId: 'box_mixed' },
        requireFullCash: true
      },
      {
        label: '托邻居捎一箱',
        outcome: '他答应得爽快，也说好了要抽两成。',
        effect: { cash: -70, boxDefId: 'box_staple' },
        requireFullCash: true
      }
    ],
    tier: 1
  },
  {
    id: 'n_tripped_breaker',
    text: '晚上跳了闸。你摸黑找到配电箱，手电筒的光已经发黄了。',
    options: [
      {
        label: '现在就修好',
        outcome: '你换上一根保险丝，灯亮了。屋里重新有点热乎气。',
        effect: { stamina: -14, shelter: 6 }
      },
      {
        label: '裹紧被子睡',
        outcome: '屋里比昨天冷一点。你听着风声睡着了。',
        effect: { shelter: -5 }
      }
    ],
    tier: 1
  },
  {
    id: 'n_old_classmate',
    text: '一个很久没联系的同学发来消息，说手头紧，想周转一下。',
    options: [
      {
        /**
         * 人情这一类**允许少给**（不写 requireFullCash）：兜里只有 25 元的人照样能帮上忙，
         * 只是帮得少一点。`{spentCash}` 会换成真的转出去的那个数 ——
         * 屏幕上是"你转过去 80"还是"你转过去 25"，取决于这个人当时有多少。
         */
        label: '转他 80',
        outcome: '你转过去 {spentCash}。他回了一串谢谢。',
        effect: { cash: -80, mood: 8 }
      },
      {
        label: '说自己也紧',
        outcome: '消息挂在那儿，他没再回。',
        effect: { mood: -6 }
      }
    ],
    tier: 1
  },
  {
    id: 'n_count_the_shelves',
    text: '睡前你站在货架前，把今天买回来的东西又看了一遍。',
    options: [
      {
        label: '蹲下来数一遍',
        outcome: '数到一半忘了数到哪。',
        effect: { stamina: -6, mood: 10 }
      },
      {
        label: '看一眼就睡',
        outcome: '你站了会儿，关了灯。',
        effect: { mood: 3 }
      }
    ],
    tier: 1
  },
  // ═══ 生成内容 夜间-01 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "n_rat_droppings",
    text: "米袋旁边有几粒黑色的东西。你蹲下来看了看。",
    tier: 1,
    decision: "把这一袋米扔掉（损失一袋），还是挑一挑继续吃",
    options: [
      {
        label: "整袋扔掉",
        outcome: "米进了垃圾袋。心里踏实了一点。",
        effect: {
          mood: 2
        }
      },
      {
        label: "挑一挑留下",
        outcome: "你把表层舀掉了半盆。剩下的看起来没事。",
        effect: {
          health: -2,
          mood: 3
        }
      },
      {
        label: "下楼补一袋",
        outcome: "粮油店还亮着灯。你扛回一包主食。",
        effect: {
          cash: -18,
          boxDefId: "box_staple"
        }
      }
    ]
  },
{
    id: "n_cold_feet",
    text: "脚一直是凉的。被窝里焐了半小时，还是凉的。",
    tier: 1,
    decision: "烧一壶热水泡脚（费燃料），还是忍到天亮",
    options: [
      {
        label: "烧水泡脚",
        outcome: "水很烫。脚趾慢慢有了知觉。",
        effect: {
          stamina: 4,
          mood: 2
        }
      },
      {
        label: "缩成一团睡",
        outcome: "后来睡着了。脚是早上才暖过来的。",
        effect: {
          stamina: 3
        }
      }
    ]
  },
{
    id: "n_can_dented",
    text: "整理时发现一罐黄豆罐头鼓了盖。按下去，会慢慢弹回来。",
    tier: 1,
    decision: "吃掉这罐可疑的（省一罐但赌健康），还是直接扔",
    options: [
      {
        label: "今晚吃掉它",
        outcome: "味道有点怪。你配着挂面吃完了。",
        effect: {
          health: -2,
          mood: 3
        }
      },
      {
        label: "扔进垃圾袋",
        outcome: "十七块钱。你看着它落进袋底。",
        effect: {
          mood: 1
        }
      }
    ]
  },
{
    id: "n_power_bill",
    text: "手机里躺着这个月的电费单。数字比平时厚了一截。",
    tier: 1,
    decision: "明天开始少用电（省现金），还是维持现在的用法",
    options: [
      {
        label: "掐着电用",
        outcome: "你把热水器调到了最低档。",
        effect: {
          cash: 30
        }
      },
      {
        label: "照常过",
        outcome: "灯亮着，屋里像个正常的家。",
        effect: {
          mood: 3,
          stamina: 2
        }
      }
    ]
  },
{
    id: "n_knock_sell",
    text: "有人敲门。门外的人压低声音说，手上有两箱罐头，便宜出。",
    tier: 1,
    decision: "花现金吃下这批来路不明的货，还是不开门",
    options: [
      {
        label: "开门看看",
        outcome: "箱子是真的，罐头也是真的。{spentCash}。",
        effect: {
          cash: -60,
          boxDefId: "box_staple"
        },
        requireFullCash: true
      },
      {
        label: "说不需要",
        outcome: "脚步声在楼道里远了。你数了一遍门锁。",
        effect: {
          mood: 2
        }
      }
    ]
  },
{
    id: "n_back_pain",
    text: "弯腰搬了一下午箱子，现在直不起来。",
    tier: 1,
    decision: "用热毛巾敷一晚（费时间），还是直接躺平",
    options: [
      {
        label: "敷一敷再睡",
        outcome: "毛巾换了两回。躺下时腰是松的。",
        effect: {
          health: 3,
          stamina: 2
        }
      },
      {
        label: "直接睡",
        outcome: "你把自己放平了。疼被睡意盖住了。",
        effect: {
          stamina: 4
        }
      }
    ]
  },
{
    id: "n_smell_fridge",
    text: "打开冰箱，有一股说不清的味道。你挨个闻了一遍。",
    tier: 1,
    decision: "今晚把可疑的全处理掉（费体力），还是明天再说",
    options: [
      {
        label: "连夜清理",
        outcome: "扔了两样，擦干净了三层隔板。",
        effect: {
          health: 2,
          mood: 2,
          stamina: -1
        }
      },
      {
        label: "关上冰箱门",
        outcome: "味道留在了门里。你明天会想起它的。",
        effect: {
          stamina: 4
        }
      }
    ]
  },
{
    id: "n_window_rattle",
    text: "风一大，卧室的窗框就响。缝隙里有凉气渗进来。",
    tier: 1,
    decision: "起来用胶带封窗（费体力），还是拿被子堵住",
    options: [
      {
        label: "封胶带",
        outcome: "三条胶带下去，响声停了。",
        effect: {
          shelter: 3,
          mood: 1,
          stamina: -1
        }
      },
      {
        label: "塞被子",
        outcome: "窗不响了。被子上有一层凉。",
        effect: {
          stamina: 3,
          mood: 1
        }
      }
    ]
  },
{
    id: "n_trade_smokes",
    text: "楼下的小刘发来消息，想用一包主食换你半条烟。",
    tier: 1,
    decision: "拿不抽的烟换回主食，还是留着烟以后换更大的",
    options: [
      {
        label: "换了",
        outcome: "他拎来一包主食。烟盒瘪了一半。",
        effect: {
          boxDefId: "box_staple"
        }
      },
      {
        label: "先不换",
        outcome: "烟回了抽屉。主食明天还在货架上。",
        effect: {
          mood: 2,
          stamina: 2
        }
      }
    ]
  },
{
    id: "n_shiver_night",
    text: "半夜冻醒了一次。你摸到床头的温度贴：9°C。",
    tier: 1,
    decision: "起来加一床被子（打断睡眠），还是蜷着扛过去",
    options: [
      {
        label: "加被子",
        outcome: "被子的重量压下来。后半夜睡沉了。",
        effect: {
          stamina: 5
        }
      },
      {
        label: "蜷到天亮",
        outcome: "你数着时间挨到了天亮。",
        effect: {
          stamina: 1,
          mood: 1
        }
      }
    ]
  },
{
    id: "n_expired_milk",
    text: "一箱牛奶的保质期是昨天。一共还有六盒。",
    tier: 1,
    decision: "今晚集中喝掉（顶饱但喝撑），还是扔掉",
    options: [
      {
        label: "喝掉两盒",
        outcome: "胃里有点沉。剩下的明天再说。",
        effect: {
          stamina: 2,
          mood: 2
        }
      },
      {
        label: "整箱扔掉",
        outcome: "六盒。你数着它们进了袋子。",
        effect: {
          mood: 2
        }
      }
    ]
  },
{
    id: "n_neighbor_borrow",
    text: "对门来敲门，想借一节五号电池。他家的钟停了。",
    tier: 1,
    decision: "借出去（电池紧张），还是说自己也没有",
    options: [
      {
        label: "借他两节",
        outcome: "他连声道谢。这层楼的声气近了一点。",
        effect: {
          mood: 3
        }
      },
      {
        label: "说没有",
        outcome: "门轻轻合上了。电池还在你的抽屉里。",
        effect: {
          stamina: 2,
          mood: 1
        }
      }
    ]
  },
{
    id: "n_sore_throat",
    text: "嗓子有点紧。你翻出感冒药，看了看日期。",
    tier: 1,
    decision: "现在就吃药压下去（消耗药），还是喝点热水扛",
    options: [
      {
        label: "吃一粒",
        outcome: "药很苦。你灌了两大口水。",
        effect: {
          health: 4
        }
      },
      {
        label: "喝热水",
        outcome: "一杯热水下去，嗓子松了一点。",
        effect: {
          health: 2,
          stamina: 2
        }
      }
    ]
  },
{
    id: "n_dark_landing",
    text: "楼道的声控灯坏了两层。晚上出去要摸着墙走。",
    tier: 1,
    decision: "自己换个灯泡（要花现金），还是摸黑适应",
    options: [
      {
        label: "换灯泡",
        outcome: "灯亮了，{spentCash}。这层楼的脚步声都轻了。",
        effect: {
          cash: -6,
          mood: 4,
          shelter: 3
        }
      },
      {
        label: "记着台阶数",
        outcome: "七步一转。你已经能闭着眼走了。",
        effect: {
          stamina: 3
        }
      }
    ]
  },
{
    id: "n_leftover_stew",
    text: "锅里的菜还剩一半。倒了可惜，放着怕坏。",
    tier: 1,
    decision: "当夜宵吃掉（顶明天的口粮），还是留着明天热",
    options: [
      {
        label: "吃掉它",
        outcome: "热了一遍。连汤都喝完了。",
        effect: {
          stamina: 3,
          mood: 2
        }
      },
      {
        label: "盖好锅盖",
        outcome: "锅坐上了冷水。明天中午就是它了。",
        effect: {
          mood: 2,
          stamina: 2
        }
      }
    ]
  },
{
    id: "n_blisters",
    text: "手心磨出了两个水泡。是下午搬箱子磨的。",
    tier: 1,
    decision: "挑破包扎（消耗绷带），还是让它自己好",
    options: [
      {
        label: "挑破包上",
        outcome: "针尖烫过火。包好后手握得拢了。",
        effect: {
          health: 3
        }
      },
      {
        label: "不管它",
        outcome: "你把手揣进了兜里。明天会结痂的。",
        effect: {
          stamina: 3
        }
      }
    ]
  },
{
    id: "n_group_chat",
    text: "业主群还在刷消息。有人高价收燃料，有人出鸡蛋。",
    tier: 1,
    decision: "卖一部分存货换现金，还是捂住不动",
    options: [
      {
        label: "出一罐燃料",
        outcome: "对方转了账。楼下自提，两清。",
        effect: {
          cash: 55
        }
      },
      {
        label: "只看不说",
        outcome: "你把手机扣在了桌上。价格还在跳。",
        effect: {
          mood: 2,
          stamina: 2
        }
      }
    ]
  },
{
    id: "n_wet_shoes",
    text: "下午出门踩了水，鞋到现在还是湿的。明天还要穿它。",
    tier: 1,
    decision: "用烘干机烤鞋（费电），还是塞报纸慢慢吸",
    options: [
      {
        label: "烤一小时",
        outcome: "鞋干了，鞋带是温的。",
        effect: {
          cash: -4,
          stamina: 3,
          mood: 2
        }
      },
      {
        label: "塞报纸",
        outcome: "报纸吸饱了水。明早能穿，就是有点凉。",
        effect: {
          stamina: 2,
          mood: 1
        }
      }
    ]
  },
{
    id: "n_water_meter",
    text: "水表转得比上个月快。你趴在井盖上看了半天。",
    tier: 1,
    decision: "明天开始循环用水（麻烦），还是照常用",
    options: [
      {
        label: "存洗菜水",
        outcome: "卫生间多了一只桶。马桶用它冲。",
        effect: {
          cash: 12
        }
      },
      {
        label: "照常用",
        outcome: "水声哗哗的。你不想在这些事上省。",
        effect: {
          mood: 3
        }
      }
    ]
  },
{
    id: "n_cough_nextdoor",
    text: "隔壁咳了一晚上。墙很薄，听得清楚。",
    tier: 1,
    decision: "送一盒感冒药过去（消耗药），还是装作没听见",
    options: [
      {
        label: "送药过去",
        outcome: "门开了一条缝。一只手把药接了过去。",
        effect: {
          mood: 4
        }
      },
      {
        label: "戴上耳塞",
        outcome: "咳嗽声远了。你睡着了。",
        effect: {
          stamina: 4
        }
      }
    ]
  },
{
    id: "n_scale_weight",
    text: "体重秤的数字比上周少了两斤。",
    tier: 1,
    decision: "明天起每顿加量（费存货），还是继续保持",
    options: [
      {
        label: "加半碗饭",
        outcome: "锅底刮干净了。胃里有了底。",
        effect: {
          health: 3,
          stamina: 2
        }
      },
      {
        label: "保持原样",
        outcome: "数字只是数字。你把秤踢回了床底。",
        effect: {
          mood: 2,
          stamina: 2
        }
      }
    ]
  },
{
    id: "n_drip_faucet",
    text: "厨房的水龙头关不严，隔几秒滴一声。",
    tier: 1,
    decision: "自己试着修（费体力），还是先接水用",
    options: [
      {
        label: "拧开看看",
        outcome: "皮垫老化了。换上备用的，不滴了。",
        effect: {
          mood: 3,
          shelter: 2,
          stamina: -2
        }
      },
      {
        label: "放个盆接着",
        outcome: "滴一夜能接半盆。正好冲厕所。",
        effect: {
          stamina: 3
        }
      }
    ]
  },
  // ═══ 生成内容 夜间-01 止 ═══,
  // ═══ 生成内容 夜间-02 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "n_ceiling_fall",
    text: "头顶的天花板鼓了个包，边缘往下坠。床就摆在正下方。",
    tier: 1,
    decision: "今晚把床挪开清空顶下（费体力），还是先睡明天再说",
    options: [
      {
        label: "连夜挪床",
        outcome: "床拖到墙角。头发上落了一层灰。",
        effect: {
          stamina: -4,
          mood: 3,
          shelter: 2
        }
      },
      {
        label: "先睡",
        outcome: "你躺下了。包在头顶，一夜没再往下掉。",
        effect: {
          stamina: 4
        }
      }
    ]
  },
{
    id: "n_partition_fall",
    text: "卫生间的隔断整块倒了，屋里连成一片。地上散着板材和螺丝。",
    tier: 1,
    decision: "连夜把隔断重新码回去，还是先挪出一条能走的通道",
    options: [
      {
        label: "连夜重码",
        outcome: "两点半，隔断立回去了。手背划了三道。",
        effect: {
          stamina: -4,
          shelter: 3,
          mood: 3
        }
      },
      {
        label: "挪出通道",
        outcome: "板材堆到墙根，从床到门能走了。",
        effect: {
          stamina: 2,
          mood: 2
        }
      }
    ]
  },
{
    id: "n_rice_weevil",
    text: "拆开米袋，米粒里爬着几只黑褐色小虫。半袋还没动。",
    tier: 1,
    decision: "整袋丢掉，筛一遍留下，还是连袋子一起处理",
    options: [
      {
        label: "整袋丢掉",
        outcome: "米倒进了垃圾袋，谷壳味留在袋口。",
        effect: {
          mood: 2,
          stamina: 1
        }
      },
      {
        label: "筛一遍",
        outcome: "虫子挑了出去，米摊在阳台上晒到天黑。",
        effect: {
          stamina: -1,
          mood: 3
        }
      },
      {
        label: "连袋处理",
        outcome: "整袋拎下楼，袋子也没留。",
        effect: {
          mood: 1,
          stamina: 3
        }
      }
    ]
  },
{
    id: "n_ant_trail",
    text: "橱柜下沿一条黑线在动，是蚂蚁。尽头堆着几粒米。",
    tier: 1,
    decision: "搬空橱柜清理，下药，还是把缝封住",
    options: [
      {
        label: "搬空清理",
        outcome: "柜子空了。抹布擦过三遍，糖罐挪到高处。",
        effect: {
          stamina: -3,
          mood: 3,
          shelter: 2
        }
      },
      {
        label: "下药",
        outcome: "药粉沿缝撒了一圈。第二天早上，蚁线断了。",
        effect: {
          mood: 3,
          stamina: -1
        }
      },
      {
        label: "封住缝",
        outcome: "水泥抹平了柜脚的缝，蚂蚁没再进来。",
        effect: {
          stamina: -2,
          shelter: 4
        }
      }
    ]
  },
{
    id: "n_flea_bite",
    text: "胳膊上多了几个红点。掀开床垫，垫面有些小黑点。",
    tier: 1,
    decision: "拆下床品洗晒，换个地方睡，还是忍一夜",
    options: [
      {
        label: "拆下来洗",
        outcome: "床单泡进盆里，床垫搬到了阳台。",
        effect: {
          stamina: -4,
          health: 4,
          mood: 1
        }
      },
      {
        label: "换睡处",
        outcome: "你抱着被子去了客厅。沙发短了一截。",
        effect: {
          stamina: 3,
          mood: 1
        }
      },
      {
        label: "忍一夜",
        outcome: "你翻来覆去，天亮时红点又多了两个。",
        effect: {
          stamina: 2,
          health: -1
        }
      }
    ]
  },
{
    id: "n_moth_holes",
    text: "压箱底的羊毛衫翻出来，肩上有三个小洞，边缘挂着丝。",
    tier: 1,
    decision: "翻箱逐件检查，放樟脑丸，还是先不管",
    options: [
      {
        label: "翻箱检查",
        outcome: "两件挂了洞。其余几件叠好，用袋子扎紧。",
        effect: {
          stamina: -3,
          mood: 3,
          shelter: 1
        }
      },
      {
        label: "放樟脑丸",
        outcome: "樟脑丸塞进柜角。味道冲，心里定了些。",
        effect: {
          mood: 3,
          stamina: -1
        }
      },
      {
        label: "先不管",
        outcome: "毛衣塞回箱底，洞还在那儿。",
        effect: {
          stamina: 3,
          mood: 1
        }
      }
    ]
  },
  // ═══ 生成内容 夜间-02 止 ═══
];

const NIGHT_BY_ID: ReadonlyMap<string, NightEventDef> = new Map(NIGHT_EVENT_DEFS.map((e) => [e.id, e]));

/** 表里没有这个 id 时返回 null（存档自愈要用它判断"这个夜色还认不认识"） */
export function findNightEvent(eventId: string): NightEventDef | null {
  return NIGHT_BY_ID.get(eventId) ?? null;
}

export function hasNightEvent(eventId: string): boolean {
  return NIGHT_BY_ID.has(eventId);
}

/** 夜间事件每条的抽签权重。现在全等，留一个函数是为了将来能按条调频率 */
export function nightEventWeight(): number {
  return 1;
}
