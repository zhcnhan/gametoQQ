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
    text: '单位群里在喊人顶夜班，双倍工资。手机亮着，等你回话。',
    options: [
      {
        label: '去顶班',
        outcome: '你在单位坐到天亮，回来时楼道里正有人出门上班。',
        effect: { stamina: -25, cash: 120 }
      },
      {
        label: '说家里有事',
        outcome: '你没去。群里很快安静了。',
        effect: { mood: -3 }
      }
    ]
  },
  {
    id: 'n_neighbor_soup',
    text: '楼上的王阿姨敲门，说她家煮了汤，让你过去坐坐。',
    options: [
      {
        label: '过去坐坐',
        outcome: '喝了两碗汤，听她念了半小时儿子。回来时身上是暖的。',
        effect: { mood: 12, stamina: -8 }
      },
      {
        label: '隔着门说累了',
        outcome: '她在门口站了会儿才走。你听见她上楼的声音。',
        effect: { mood: -5 }
      }
    ]
  },
  {
    id: 'n_midnight_restock',
    text: '有人说南边那家超市半夜补货。你们小区已经有车出门了。',
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
    ]
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
    ]
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
        outcome: '你转过去 {spentCash}。他回了一串谢谢，你没有问什么时候还。',
        effect: { cash: -80, mood: 8 }
      },
      {
        label: '说自己也紧',
        outcome: '消息挂在那儿，他没再回。',
        effect: { mood: -6 }
      }
    ]
  },
  {
    id: 'n_count_the_shelves',
    text: '睡前你站在货架前，把今天买回来的东西又看了一遍。',
    options: [
      {
        label: '蹲下来数一遍',
        outcome: '数到一半忘了数到哪，但心里踏实了。',
        effect: { stamina: -6, mood: 10 }
      },
      {
        label: '看一眼就睡',
        outcome: '你站了会儿，关上灯。',
        effect: { mood: 3 }
      }
    ]
  }
];

const NIGHT_BY_ID: ReadonlyMap<string, NightEventDef> = new Map(NIGHT_EVENT_DEFS.map((e) => [e.id, e]));

/** 表里没有这个 id 时返回 null（存档自愈要用它判断"这个夜色还认不认识"） */
export function findNightEvent(eventId: string): NightEventDef | null {
  return NIGHT_BY_ID.get(eventId) ?? null;
}

export function hasNightEvent(eventId: string): boolean {
  return NIGHT_BY_ID.has(eventId);
}
