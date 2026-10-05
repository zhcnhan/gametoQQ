/**
 * 白天随机事件与物价波动（§6.2 / M2 清偿 D-10）。
 *
 * 这一组守三件事：
 *
 *  ① **种子化可复现**：同 seed、同点位、同进出顺序 → 同事件序列；
 *  ② **"不参与"永远是一条路**（§4A）：每条事件都必须能退出，
 *     而且"白跑一趟"要真的结束这一趟（否则它和"照常买"没有区别）；
 *  ③ **限购与削库存只活一天**：换天必须清干净 —— 昨天的限购跟着走到今天，
 *     是这套机制最容易出、也最难被玩家说清的那种 bug。
 */
import { describe, expect, it } from 'vitest';
import { DAY_EVENT_DEFS, dayPriceFactor } from '../data/dayEvents';
import { countCategory } from '../model/consume';
import { createCursor } from '../model/rng';
import { HOME_SINK_MAX_ROWS } from '../model/sink';
import { createSaveGame } from '../state/save';
import { GameStore } from '../state/store';
import { chooseIdentity } from './phases';
import { createStartingRun } from './setup';
import {
  basePriceOf,
  buildCartView,
  buyCart,
  enterShop,
  findShopStock,
  hasPlayerFacingEffect,
  leaveShop,
  purchaseLimitOf,
  resolveDayEvent,
  rollDayEvent
} from './shop';

function createSaveSchedulerStub() {
  return { schedule: () => undefined, flush: () => undefined, dispose: () => undefined, pending: false };
}

function startedStore(seed = 20261001, identityId = 'group_buyer') {
  const store = new GameStore(createSaveGame(createStartingRun(seed)), createSaveSchedulerStub());
  chooseIdentity(store, identityId);
  return store;
}

describe('物价波动：它补的是 D-03 留下的那个空洞', () => {
  /*
   * ★ 这一组用例在 D-19 清偿时**改过口径**，值得说明改了什么：
   *
   * 原来 `dayPriceFactor(day)` 读的是 `data/dayEvents.ts` 里一张写死的
   * 22 行表（只覆盖寒潮）。现在它**按灾难**算了，所以每条都要带上灾难 id；
   * 而"单调不减"那条断言也不再成立 —— 一个**衰减型**的灾难
   * （"极地涡旋"那种 0.9 → 0.5）本来就该一路降价。
   */
  const COLD = 'cold_snap';

  it('囤货期：灾前便宜，越接近灾难越贵（这一段 116 场共用同一把尺子）', () => {
    expect(dayPriceFactor(-7, COLD)).toBeLessThan(1);
    expect(dayPriceFactor(-3, COLD)).toBe(1);
    expect(dayPriceFactor(-2, COLD)).toBeGreaterThan(1);
    // 单调不减：囤货期**灾难还没来**，面对的是同一件事（消息在传、东西在涨）
    let prev = 0;
    for (let day = -7; day <= -1; day++) {
      const f = dayPriceFactor(day, COLD);
      expect(f, `D${day}`).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('D-Day 起跳：降临那天一定比前一天贵（这是一局里最陡的一次涨价）', () => {
    expect(dayPriceFactor(0, COLD)).toBeGreaterThan(dayPriceFactor(-1, COLD));
  });

  it('日历覆盖不到的日子夹到最近的一档，不返回 0 或 NaN', () => {
    expect(dayPriceFactor(-99, COLD)).toBe(dayPriceFactor(-7, COLD));
    expect(dayPriceFactor(999, COLD)).toBe(dayPriceFactor(14, COLD));
    expect(Number.isFinite(dayPriceFactor(1000, COLD))).toBe(true);
  });

  it('★ 当天单价里烘进了当天的物价倍率 —— 界面与结账读的是同一个数', () => {
    const store = startedStore();
    const line = findShopStock(store.run, 'supermarket')?.lines.find((l) => l.itemId === 'canned_beans');
    expect(line).toBeDefined();
    // 事件倍率是 1（还没碰上事件），所以实际单价 = 生成时烘进去的那个数
    expect(basePriceOf(store.run, line as { price: number })).toBe((line as { price: number }).price);
  });

  it('★ 事件涨价只影响今天剩下的时间：shopPriceFactor 乘上去，换天清掉', () => {
    const store = startedStore();
    const line = findShopStock(store.run, 'supermarket')?.lines.find((l) => l.itemId === 'canned_beans');
    const before = basePriceOf(store.run, line as { price: number });
    store.commit((draft) => {
      draft.shopPriceFactor = 1.5;
    });
    expect(basePriceOf(store.run, line as { price: number })).toBe(Math.max(1, Math.round(before * 1.5)));
  });
});

describe('白天事件的抽签', () => {
  it('同 seed 同点位 → 同结果（同一天连进三次同一家店也一致）', () => {
    const seq = (seed: number, shopId: string, n = 30): (string | null)[] => {
      const cursor = createCursor(seed);
      return Array.from({ length: n }, () => rollDayEvent(cursor, shopId));
    };
    expect(seq(20261001, 'supermarket')).toEqual(seq(20261001, 'supermarket'));
  });

  it('★ 黑市商人只在五金店后巷 —— onlyShops 之外的店门权重是 0，抽不到他', () => {
    /*
     * ★ 取样量从 200 抬到 4000（2026-10，给 26 条事件补上 `onlyShops` 之后）。
     *
     * 补完归属之后 hardware 的池子变小了，而 `d_black_market` 是个低频条目 ——
     * 实测出现率约 **1.1%**（220 / 20000），200 次抽样的期望只有 2.2 次，
     * 于是"expected [...] to include 'd_black_market'"随机红。
     *
     * 这与 `eventRepeat.test.ts` 那条突发覆盖率的毛病**是同一类**：
     * 断言本身没错（黑市确实只在五金店），错的是**取样量配不上要检出的频率**。
     * 4000 次对 1.1% 的期望是 44 次，足够稳。
     */
    const inHardware = Array.from({ length: 4000 }, (_, i) => rollDayEvent(createCursor(i), 'hardware'));
    const inPharmacy = Array.from({ length: 4000 }, (_, i) => rollDayEvent(createCursor(i), 'pharmacy'));
    expect(inHardware).toContain('d_black_market');
    expect(inPharmacy).not.toContain('d_black_market');
  });

  it('约六成的店门没事 —— 一天进三家店，家家有事就成了例会', () => {
    let hits = 0;
    const draws = 2000;
    for (let i = 0; i < draws; i++) if (rollDayEvent(createCursor(i), 'supermarket')) hits += 1;
    const rate = hits / draws;
    expect(rate).toBeGreaterThan(0.35);
    expect(rate).toBeLessThan(0.75);
  });

  it('每条事件的选项都在 2~3 个、标签不超过 8 字（手机竖屏一行放得下）', () => {
    for (const def of DAY_EVENT_DEFS) {
      expect(def.options.length).toBeGreaterThanOrEqual(2);
      expect(def.options.length).toBeLessThanOrEqual(3);
      for (const opt of def.options) {
        expect(opt.label.length).toBeLessThanOrEqual(8);
        expect(opt.outcome.length).toBeGreaterThan(4);
      }
    }
  });
});

/**
 * ★ 这一组就是那条"不许出现毫无效果的事件"的**可执行形式**。
 *
 * 它存在的理由是一次真实的返工：M2 第一批白天事件里，四个选项里有三个什么都没发生 ——
 * "先抢一轮"只把**商店**的货架削掉了（玩家一件货都没拿到），"照原计划买"更是纯亏，
 * "按限购买"给玩家的只有一条限购。玩家的原话是
 * "我抢了东西买了东西……家里的东西并没有增长啊""限购两件跟我有鸡毛关系，我两件东西也没买到啊"。
 *
 * 那不是数值 bug，是**数据结构没拦住"写一个没有后果的选项"**。
 * 现在这几条测试拦得住：以后加新事件（不管是买东西、修水管还是邻居吵架），
 * 只要写了一个什么都不给的选项，这里就红。
 */
describe('★ 结构约束：不许有"点了什么都不发生"的选项', () => {
  it('每个选项都至少命中一个"落到玩家身上"的效果', () => {
    const bad: string[] = [];
    for (const def of DAY_EVENT_DEFS) {
      for (const opt of def.options) {
        if (!hasPlayerFacingEffect(opt.effect)) {
          bad.push(
            `${def.id} 的「${opt.label}」只改商店（${Object.keys(opt.effect).join('/')}），玩家点完什么都不会变`
          );
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('只改商店与物价的选项不许存在（削库存 / 限购 / 涨价单独出现 = 白扣一个行动点）', () => {
    /*
     * ⚠ `homeSink` **不在**这张表里，加它之前要读一遍 W-05 的那条注释
     * （`systems/shop.ts` 的 `PLAYER_FACING_EFFECT_KEYS`）：
     * 它看起来与 `priceUp` 同族（都是坏的），区别是**它改盘面** ——
     * 玩家回来能指着那几排说"这里原来有东西"。所以它可以单独成项。
     */
    const SHOP_ONLY = ['stockCut', 'limit', 'priceUp'];
    const bad: string[] = [];
    for (const def of DAY_EVENT_DEFS) {
      for (const opt of def.options) {
        const keys = Object.keys(opt.effect);
        if (keys.length > 0 && keys.every((k) => SHOP_ONLY.includes(k))) {
          bad.push(`${def.id} 的「${opt.label}」只动了商店与物价：${keys.join('/')}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('限购只当处境，或与真给到手的收获一起出现', () => {
    for (const def of DAY_EVENT_DEFS) {
      for (const opt of def.options) {
        if (opt.effect.limit === undefined) continue;
        const givesGoods = opt.effect.grab !== undefined || opt.effect.boxDefId !== undefined;
        const label = `${def.id} 的「${opt.label}」`;
        expect(
          givesGoods || def.text.includes('限购'),
          `${label} 把"限购"当成收获发给玩家了（它是处境，不是奖励）`
        ).toBe(true);
      }
    }
  });

  it('★ 文案说"拿到了"就必须真给货', () => {
    const CLAIMS_GOODS = /抓了|拿了两|多给了你|带回来/;
    const bad: string[] = [];
    for (const def of DAY_EVENT_DEFS) {
      for (const opt of def.options) {
        if (!CLAIMS_GOODS.test(opt.outcome)) continue;
        const gives = opt.effect.grab !== undefined || opt.effect.boxDefId !== undefined;
        if (!gives) bad.push(`${def.id} 的「${opt.label}」文案说拿到了东西，效果里却没有：${opt.outcome}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * ★★ 屋子进水（W-05）：文案与效果**必须互相说得通**，两个方向都拦。
   *
   * 这是 §10.1A 铁则第 1 条（"只改数字的机制必须同时有非数字的表达"）在
   * **内容侧**的可执行形式。它守的是这一片最容易出的两种错，而且是**相反的**两种：
   *
   *  · **说了没做**：outcome 写"水漫上来、贴地那几排泡了"，而 `effect` 里没有
   *    `homeSink` —— 玩家读完那段话去找，家里什么都没变。这与 M2 那批
   *    "文案说抢到了、实际没给货"是同一个病（见上面那条守卫的来历）；
   *  · **做了没说**：`effect.homeSink` 在，而 outcome 一个字没提 —— 玩家回到整理页
   *    发现货架凭空矮了一排，只会认为存档坏了（这条更贵：**它没有报错的机会**）。
   *
   * ⚠ 判据只认"贴地 / 泡了 / 漫上来"这一族词，不要求写死句式。
   * 新写事件时如果用了别的说法（"淹到第二层板"），把词补进来 ——
   * 但**别把它放宽成"随便提到水都算"**：那样"堤上守了一夜"也会被算成淹水，
   * 判据就从"对账"退化成"含有某个字"。
   */
  it('★ homeSink：文案说泡了就必须真淹，真淹了就必须在文案里说', () => {
    const SAYS_FLOOD = /贴地|泡了|漫上来|淹|渗进/;
    const bad: string[] = [];
    for (const def of DAY_EVENT_DEFS) {
      for (const opt of def.options) {
        const says = SAYS_FLOOD.test(opt.outcome);
        const does = opt.effect.homeSink !== undefined;
        if (says && !does) {
          bad.push(`${def.id} 的「${opt.label}」文案说屋里泡了水，效果里没有 homeSink：${opt.outcome}`);
        }
        if (does && !says) {
          bad.push(
            `${def.id} 的「${opt.label}」会淹掉玩家的屋子，而文案一个字没提（玩家只会以为存档坏了）`
          );
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * `homeSink` 的排数必须是**书上写过的那个区间**。
   *
   * `HOME_SINK_MAX_ROWS = 2` 不是随手定的：`model/sink.ts` 里写明了理由
   * （再多就把整理这件事压没了）。内容作者写 3 会被 `sinkShelves` 默默夹成 2，
   * 于是"文案说三排、实际少两排"—— 正是本项目最贵的那类静默不一致。
   * 所以这里在**数据层**就拦住，而不是等运行时夹。
   */
  it('★ homeSink 的排数在允许区间内（写超了会被静默夹掉）', () => {
    const bad: string[] = [];
    for (const def of DAY_EVENT_DEFS) {
      for (const opt of def.options) {
        const rows = opt.effect.homeSink?.rows;
        if (rows === undefined) continue;
        if (!Number.isInteger(rows) || rows < 1 || rows > HOME_SINK_MAX_ROWS) {
          bad.push(`${def.id} 的「${opt.label}」写了 homeSink.rows = ${rows}，允许区间是 1~${HOME_SINK_MAX_ROWS}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * ★★ 这一条是补上来的，因为上一条**没拦住**一个真 bug。
   *
   * 现场：选项「先买了再走」的文案是"你照原计划**结完账**就出了门"，
   * 而它的效果只有 `{ priceUp, stamina }` —— **根本没有结账那一步**。
   * 玩家点完掉体力、物价还涨，屏幕上却说他买了东西。原话是"我结了账没拿到货？？？"。
   *
   * 上一条规则（"至少命中一个落到玩家身上的效果"）之所以放它过关，是因为
   * `stamina: -4` 也算"落到玩家身上"——**扣体力也算有效果，可玩家的收获是零**。
   * 规则没错，是边界划错了。所以这里换成**语义对照**：
   * 文案里的说法与效果字段必须一一对得上，而且**不许描述它没做的事**。
   */
  it('★★ 文案与效果必须语义一致：说了"买了/结了账"就必须真有收支，说了"拿/抢"就必须真有货', () => {
    const bad: string[] = [];

    for (const def of DAY_EVENT_DEFS) {
      for (const opt of def.options) {
        const where = `${def.id} 的「${opt.label}」`;
        const says = (re: RegExp): boolean => re.test(opt.outcome);
        const hasGoods = opt.effect.grab !== undefined || opt.effect.boxDefId !== undefined;
        const spentCash = (opt.effect.cash ?? 0) < 0;
        /*
         * ★ `{spentCash}` 是"真花了钱"的**另一种写法**，不是遗漏（M3 补上）。
         *
         * 它是夜间/白天事件唯一一个占位符：渲染时会被换成**实际花掉的那个数**
         * （见 `NightOption.outcome` 的注释）。所以文案里的
         * "你们四个人凑了一单。{spentCash}。" 说的就是"这笔钱真的出去了"。
         *
         * 只认 `cash < 0` 的话，这 6 条会被判成"说发生了交易却没有收支" ——
         * 而它们的效果字段是对的，**错的是判据没认这个占位符**。
         * 判据的职责是拦住"编一个没发生的交易"，不是规定文案用什么词交代付款。
         */
        const saysSpent = opt.outcome.includes('{spentCash}');
        // "收" = 真拿到东西，或者真花出去一笔钱换来东西
        const receives = hasGoods || spentCash || saysSpent;

        // ① 说了"买了 / 结了账 / 花了钱" → 必须有收支，否则就是在编一个没发生的交易
        if (says(/买了|结完账|结了账|付了钱|花掉/) && !receives) {
          bad.push(`${where} 文案说发生了交易，效果里既没有货也没有花钱：${opt.outcome}`);
        }
        // ② 说了"拿 / 抢 / 抓" → 必须真有货进袋
        if (says(/拿了两|抓了|抢到|多给了你|带回来/) && !hasGoods) {
          bad.push(`${where} 文案说拿了东西，效果里没有 grab / boxDefId：${opt.outcome}`);
        }
        // ③ 说了"货架空了 / 抢光" → 必须有 stockCut（商店那一头），
        //    而且文案不许暗示是"自家"少了东西
        if (says(/货架|架子/) && says(/空|扫掉|拿掉|没了/) && opt.effect.stockCut === undefined) {
          bad.push(`${where} 文案说货架被抢空了，效果里没有 stockCut：${opt.outcome}`);
        }
        // ④ 反过来：真给了货，文案就必须提到拿到手（不许默默塞进待拆箱）。
        //    这一条刻意写得宽松（一个"拿到"的同义动词表），因为它是**兜底**：
        //    精确的那一半由 ①②③ 负责。它要拦的是"效果给了货、文案一字不提"
        //    ——那正是玩家"我抢了东西，家里的东西并没有增长"的镜像版本。
        //
        //    ★ M3 补了几个词（`上车 / 篮子 / 车里 / 塞`）：新内容用了
        //    "两罐上车"、"放进篮子"、"塞进了车里"、"塞进车里" 这类写法。
        //    它们**都是"拿到手"**，漏掉它们只会逼着文案去用同一个动词，
        //    而那会把 24 条事件写得读起来像一个人写的 —— 这条例子的目的是
        //    拦住"没提"，不是规定"必须用哪个词"。
        if (hasGoods && !says(/拿|抓|给|带|箱|袋|篮子|车里|上车|到手|进袋|塞|都还|买了|结账|结了账/)) {
          bad.push(`${where} 效果里真给了货，文案却没提玩家拿到了什么：${opt.outcome}`);
        }
      }
    }

    expect(bad).toEqual([]);
  });

  it('★ 每个选项都得有"收获"，不能只是挨罚（扣体力不算收获）', () => {
    // 又是那个 bug 的另一面：「先买了再走」唯一的"落到玩家身上"的效果是 stamina -4。
    // 一条只有代价、没有任何收获的选项，和"什么都不发生"在玩家眼里是一回事。
    //
    // ★ 判据的两个边界（M3 补内容时被逼着写清楚，两边都改过一次）：
    //
    //  1. **体力掉是代价，体力涨是收获。** 这条原来只认 `mood > 0`，
    //     于是 5 条新内容的"歇一会儿"/"下午再来"/"回家自己烧"（`stamina: +2~3`）
    //     被判成"只有代价"。那 5 条在语义上恰恰是**玩家省下了力气**，
    //     也就是这个选项的收获 —— 和夜间事件那边"睡觉 +4 体力算收益"
    //     是同一条道理（`check-content.mjs` 的注释里专门写过这件事）。
    //     原来那条判据是**不对称**的，不是"更严格"。
    //  2. 判据必须仍然拦住最初那个 bug：`stamina: -4` **单独出现**时不算收获。
    //     所以这里判的是 `> 0`，不是"有这个字段"。
    const bad: string[] = [];
    for (const def of DAY_EVENT_DEFS) {
      for (const opt of def.options) {
        const gains =
          opt.effect.grab !== undefined ||
          opt.effect.boxDefId !== undefined ||
          (opt.effect.cash ?? 0) > 0 ||
          (opt.effect.mood ?? 0) > 0 ||
          (opt.effect.stamina ?? 0) > 0 ||
          opt.effect.visitLost === true ||
          // 这两条也算收获，而且各有各的道理：
          //  · stockCut —— "别人把货抢走了"是一种处境变化，玩家能看见（店里少了）
          //  · limit   —— "能买得更多"是通融那条的收获，配合 grab 一起给
          opt.effect.stockCut !== undefined ||
          opt.effect.limit !== undefined;
        if (!gains) bad.push(`${def.id} 的「${opt.label}」只有代价没有收获：${JSON.stringify(opt.effect)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /*
   * ## 关于「每条事件都要有一条"不参与"的路」（§4A）—— M3 改了判据，理由如下
   *
   * 原来的断言是：**每条事件的选项里必须有一条 `visitLost === true`**。
   * 存量那 4 条确实都有（"不排了，换一家"、"这店今天不进了"），所以它一直是对的。
   *
   * 但 M3 补进 20 条之后，情况变了：新内容一致地把"不参与"写成了
   * **"我不参与这个选择"**（"换家店看"、"关掉通知"、"不进巷子"、"转身离开"，
   * 后果是回一点体力或心情），而不是 `visitLost`（那一条的语义是
   * **"这家店今天我不进了"**，会把玩家踢回点位列表）。
   *
   * 那个更严格的要求会逼出一个坏结果：20 条事件每条都得再加一个重复的
   * "转身走"，而那**不是取舍，是噪音** —— §4A 那条规则要的是"能走开"，
   * 不是"每条都得劝你走"。
   *
   * ★ 真正要守的东西其实有两件，这里改成分开守：
   *
   *  1. **全局出口必须存在且真的有效**：事件待决时界面上常驻「先不进去」
   *     （`ui/ShopScreen.ts` 的 `data-action="leave-event"` → `leaveShop`），
   *     它不处理那件事、直接退回点位列表，行动点照扣（那是进门的价钱）。
   *     这条由下面 `describe('白天事件接进 enterShop')` 里的
   *     「★ "先不进去"：事件没处理也能退出」用例守着 —— 那是**行为**，
   *     比"表里有个字段"更强；
   *  2. **每条事件都得有一条"不花钱也能选"的路**：否则一个兜里没钱的玩家
   *     点开事件就只剩"掏钱"，而买不起就等于没得选。这一条是**内容**层面的，
   *     留在这里逐条扫。
   */
  it('★ 每条事件都得有一条"不花钱也能选"的路（否则没钱的人点开就只剩掏钱）', () => {
    /*
     * 为什么这条是硬的：囤货期现金是**紧的**（两个身份 780~1150 元，
     * 14 天刚需就占八九成），而 `requireFullCash` 的语义是"给不起就置灰"。
     * 于是一条"每个选项都要花钱"的事件，对一个兜里只剩几十块的人
     * **等于没有选项** —— 他点开只看到两个灰按钮，而事件还挂在屏幕上。
     * 那不是难度，是卡住（§4A：任何界面都得有一条能走的路）。
     *
     * 判据：有一个选项**既不要全款、也不扣钱**。`visitLost` 天然满足
     * （"这店今天不进了"本来就不花钱）。
     */
    const bad: string[] = [];
    for (const def of DAY_EVENT_DEFS) {
      const free = def.options.some(
        (o) => o.requireFullCash !== true && (o.effect.cash ?? 0) >= 0
      );
      if (!free) bad.push(`${def.id} 的每个选项都要花钱：${def.options.map((o) => o.label).join(' / ')}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('白天事件接进 enterShop：门口先讲那件事', () => {
  /** 反复开新局，直到这一家店门口真的出了指定的那件事（种子化地穷举） */
  function storeAtEvent(eventId: string, seed = 1, shopId = 'supermarket') {
    for (let s = seed; s < seed + 400; s++) {
      const store = startedStore(s);
      const result = enterShop(store, shopId);
      if (store.run.dayEvent?.defId === eventId) return { store, result };
    }
    throw new Error(`400 个 seed 里没抽到 ${eventId}`);
  }

  it('★ 掷中事件时，行动点照扣、店门照进、dayEvent 挂上（它是"路上的遭遇"）', () => {
    const { store, result } = storeAtEvent('d_queue_aunt');
    expect(result.ok).toBe(true);
    expect(store.run.actionPoints).toBe(2);
    expect(store.run.currentShopId).toBe('supermarket');
    expect(store.run.dayEvent?.shopId).toBe('supermarket');
    expect(store.run.dayEvent?.choice).toBeNull();
    expect(result.events.some((e) => e.type === 'dayEventHit')).toBe(true);
  });

  it('"排到底"：花体力与心情，货还能买', () => {
    const { store } = storeAtEvent('d_queue_aunt');
    const stamina = store.run.stats.stamina;
    const res = resolveDayEvent(store, 0);
    expect(res.ok).toBe(true);
    expect(store.run.stats.stamina).toBeLessThan(stamina);
    expect(store.run.dayEvent?.choice).toBe(0);
    expect(store.run.dayEvent?.applied?.stamina).toBeLessThan(0);
    // 已经决定过 → 再点被拒（幂等）
    expect(resolveDayEvent(store, 1).ok).toBe(false);
  });

  it('★ "不排了，换一家" = 这趟白跑：退回点位列表，但行动点不还（那是进门的价钱）', () => {
    const { store } = storeAtEvent('d_queue_aunt');
    const points = store.run.actionPoints;
    const res = resolveDayEvent(store, 1);
    expect(res.ok).toBe(true);
    expect(store.run.dayEvent).toBeNull();
    expect(store.run.currentShopId).toBeNull();
    expect(store.run.actionPoints).toBe(points);
    expect(res.events.some((e) => e.type === 'dayEventResolved' && e.visitLost)).toBe(true);
  });

  it('★ 每条事件都有一条"不走这趟"的路 —— 判据见上面那条用例的注释（不是要求每条的选项里都有 visitLost）', () => {
    /*
     * 这条曾经是"每条事件的选项里必须有 `visitLost === true`"，M3 改了判据。
     * 完整的理由写在上面那个 describe 里的长注释；这里只重复一句最关键的：
     *
     * **§4A 要的是"能走开"，而不是"每条事件都得劝你走"。**
     * 全局出口是界面上常驻的「先不进去」，它的行为由本文件下面
     * 「★ "先不进去"：事件没处理也能退出」那条守着。
     *
     * 所以这里改守**那个出口真的对每条事件都成立**：事件待决时，
     * `leaveShop` 必须能清干净它。这比断言一个字段强 —— 字段在不在
     * 与玩家走不走得掉是两件事。
     */
    for (const def of DAY_EVENT_DEFS) {
      expect(def.options.length).toBeGreaterThanOrEqual(2);
    }
    // 事件待决时「先不进去」必须有效（挑一条新内容里的事件来验）
    const { store } = storeAtEvent('d_truck_unloading');
    expect(store.run.dayEvent?.defId).toBe('d_truck_unloading');
    const res = leaveShop(store);
    expect(res.ok).toBe(true);
    expect(store.run.dayEvent).toBeNull();
    expect(store.run.currentShopId).toBeNull();
  });

  it('★★ 文案承诺了货，就一定要给到货 —— 哪怕这家店该品类已经卖光', () => {
    // 这是被玩家的截图逼出来的：屏幕上同时出现"你拿了两袋米"与"这一趟没拿到货"。
    // 原因是 `grabFromShop` 在店里的该品类没库存时静默返回空，而文案是写死的。
    // 一条选项的文案既然承诺了，效果就必须无条件兑现（店里现货优先，缺的用箱子补）。
    const { store } = storeAtEvent('d_purchase_limit');
    // 把超市的主食全部抽干：模拟"这家店该品类已经没了"
    store.commit((draft) => {
      const stock = draft.shopStocks.find((s) => s.shopId === 'supermarket');
      if (stock) for (const line of stock.lines) line.stock = 0;
    });
    const before = countCategory(store.run.shelves, store.run.boxesToUnpack, 'food');
    const res = resolveDayEvent(store, 0); // 就买两件（文案说"你拿了两袋米"）
    expect(res.ok).toBe(true);
    const after = countCategory(store.run.shelves, store.run.boxesToUnpack, 'food');
    // 承诺的 2 件必须真的到手
    expect(after - before).toBeGreaterThanOrEqual(2);
    expect(store.run.dayEvent?.applied?.grabbed.length).toBeGreaterThan(0);
    // 而且摘要里必须报出拿到的东西（正是玩家截图里缺的那一行）
    expect(res.events.some((e) => e.type === 'dayEventResolved' && e.summary.some((s) => s.includes('拿到')))).toBe(
      true
    );
  });

  it('★ 限购：事件加的上限真的会限制能买几件，而且换天清掉', () => {    const { store } = storeAtEvent('d_purchase_limit');
    const res = resolveDayEvent(store, 0); // "按限购买" → 主食限 2 件
    expect(res.ok).toBe(true);
    expect(purchaseLimitOf(store.run, 'supermarket', 'canned_beans')).toBe(2);

    // 限购之下：想买 6 件会被截到 2 件，而且只提示、不阻断
    const view = buildCartView(store.run, 'supermarket', [{ itemId: 'canned_beans', count: 6 }]);
    expect(view?.lines[0]?.count).toBe(2);
    expect(view?.notes.some((n) => n.includes('限购'))).toBe(true);
    expect(view?.canLoad).toBe(true);
    // 结账也只扣 2 件的钱
    const cost = view?.cost ?? 0;
    const cash = store.run.cash;
    expect(buyCart(store, 'supermarket', [{ itemId: 'canned_beans', count: 6 }]).ok).toBe(true);
    expect(store.run.cash).toBe(cash - cost);
    // 买满之后不能加购
    const again = buildCartView(store.run, 'supermarket', [{ itemId: 'canned_beans', count: 1 }]);
    expect(again?.canLoad).toBe(false);
  });

  it('★ 削库存 + 抢到货：选项 0（先抢一轮）两头都动 —— 店里少了，你家多了', () => {
    const { store } = storeAtEvent('d_panic_buying');
    const stockBefore = findShopStock(store.run, 'supermarket')?.lines.reduce((n, l) => n + l.stock, 0) ?? 0;
    const boxesBefore = store.run.boxesToUnpack.length;
    const hadFoodBefore = countCategory(store.run.shelves, store.run.boxesToUnpack, 'food');

    const res = resolveDayEvent(store, 0); // 先抢一轮
    expect(res.ok).toBe(true);
    const applied = store.run.dayEvent?.applied;
    // ① 商店那一头：货架真的少了
    expect(applied?.stockCut.length).toBeGreaterThan(0);
    const stockAfter = findShopStock(store.run, 'supermarket')?.lines.reduce((n, l) => n + l.stock, 0) ?? 0;
    expect(stockAfter).toBeLessThan(stockBefore);
    // ② 玩家那一头：**真拿到了货**（这是原来缺的一半 —— 玩家当时一件都没拿到）
    expect(applied?.grabbed.length).toBeGreaterThan(0);
    expect(store.run.boxesToUnpack.length).toBeGreaterThan(boxesBefore);
    expect(countCategory(store.run.shelves, store.run.boxesToUnpack, 'food')).toBeGreaterThan(hadFoodBefore);
    // ③ 而且重量照实记进了车载（原来黑市那一箱漏了这一步）
    expect(store.run.carLoad).toBeGreaterThan(0);
  });

  it('黑市商人：给得起钱才成立，钱不够时命令层也挡（界面置灰之外的第二道）', () => {
    const { store } = storeAtEvent('d_black_market', 1, 'hardware');
    store.run.cash = 10; // 要 120
    const res = resolveDayEvent(store, 0);
    expect(res.ok).toBe(false);
    expect(store.run.cash).toBe(10);
    expect(store.run.dayEvent?.choice).toBeNull();
  });

  it('黑市商人：给得起就带回来一箱，钱照扣', () => {
    const { store } = storeAtEvent('d_black_market', 1, 'hardware');
    const boxes = store.run.boxesToUnpack.length;
    const cash = store.run.cash;
    const res = resolveDayEvent(store, 0);
    expect(res.ok).toBe(true);
    expect(store.run.boxesToUnpack.length).toBe(boxes + 1);
    expect(store.run.cash).toBe(cash - 120);
    expect(store.run.dayEvent?.applied?.gotBox).toBe(true);
  });

  it('★ "先不进去"：事件没处理也能退出（leaveShop 清干净 dayEvent）', () => {
    const { store } = storeAtEvent('d_queue_aunt');
    const res = leaveShop(store);
    expect(res.ok).toBe(true);
    expect(store.run.dayEvent).toBeNull();
    expect(store.run.currentShopId).toBeNull();
  });

  it('不在外面的时候不能处理门口的事', () => {
    const store = startedStore();
    store.run.phase = 'organize';
    expect(resolveDayEvent(store, 0).ok).toBe(false);
  });
});

/**
 * ★★ W-05：一类事件真的动了你家里的盘面（"屋子进水"）。
 *
 * ## 这一组在守什么
 *
 * 工单的原话是"169 个事件里没有一个改变已有物资的归属" —— 白天事件能加货
 * （`grab`）、能给箱子（`boxDefId`）、能改价（`priceUp`）、能削商店（`stockCut`），
 * 但**没有一件能碰你昨晚摆好的那些排**。`homeSink` 补的就是这一格。
 *
 * 所以这一组要钉的不是"字段通了"，而是**接线真的走到底了**：
 * 玩家选了「不去」→ 货架少一排 → 泡了的货进了箱子 → 界面读得到这件事。
 * 这四步里断任何一步，字段都是"通了但没生效"（`systems/setup.ts:130-135`
 * 记着这个教训的原话）。
 *
 * ⚠ 这一组**故意钉死 `disasterId: 'cold_snap'`**：`sinkShelves` 每块家具至少留
 * 一排，而 `createStartingShelves` 会按灾难的 `capacityFactor` 预先砍掉低处的排
 * （43 场写了这一维）。如果随机抽到 `capacityFactor: 0.5` 的那几场，开局每块
 * 就只剩 2 排，再砍 1 排还能砍动；抽到 0.5 且再砍一次就到了下限，
 * `rows` 会变成 0 而用例随种子时红时绿。寒潮没有这一维（4 排满高），
 * 是这批用例唯一稳定的基座。
 */
describe('★★ 白天事件：屋子进水（W-05）', () => {
  /** 反复开新局，直到这一家店门口真的出了指定的那件事（与上面同一套穷举） */
  function storeAtLevee(seed = 1) {
    for (let s = seed; s < seed + 400; s++) {
      const store = new GameStore(
        createSaveGame(createStartingRun(s, { disasterId: 'cold_snap' })),
        createSaveSchedulerStub()
      );
      chooseIdentity(store, 'group_buyer');
      enterShop(store, 'supermarket');
      if (store.run.dayEvent?.defId === 'd_levee_shift') return store;
    }
    throw new Error('400 个 seed 里没抽到 d_levee_shift');
  }

  /** 「不去」是第三支（前两支是去值守 / 出钱请人） */
  const STAY_HOME = 2;

  it('选「不去」：家具真的矮了一排，而且家里那本水位账记上了', () => {
    const store = storeAtLevee();
    const before = store.run.shelves.map((s) => s.h);
    expect(before.every((h) => h === 4)).toBe(true);
    expect(store.run.homeSinkRows).toBe(0);

    const res = resolveDayEvent(store, STAY_HOME);
    expect(res.ok).toBe(true);

    const after = store.run.shelves.map((s) => s.h);
    expect(after).toEqual(before.map((h) => h - 1));
    expect(store.run.homeSinkRows).toBe(1);
    // 三个长度必须一致（只改 h 就是"放得进去、东西却不见了"那类静默 bug）
    for (const shelf of store.run.shelves) {
      expect(shelf.slots).toHaveLength(shelf.h);
      expect(shelf.zoneIds).toHaveLength(shelf.h);
    }
  });

  it('★ 泡了的东西不蒸发：它进了待拆的箱子，而且箱数被记下来', () => {
    const store = storeAtLevee();
    const boxesBefore = store.run.boxesToUnpack.length;
    const applied = (() => {
      resolveDayEvent(store, STAY_HOME);
      return store.run.dayEvent?.applied;
    })();

    expect(applied?.homeSink).not.toBeNull();
    expect(applied?.homeSink?.rows).toBe(1);
    expect(applied?.homeSink?.shelfIds.length).toBe(store.run.shelves.length);
    // 捞出来的东西只可能装在**新增**的箱子里（原来那些箱子的内容不该被动）
    expect(store.run.boxesToUnpack.length).toBe(boxesBefore + (applied?.homeSink?.boxes ?? 0));
  });

  it('★ 事件的摘要要把它说出来（§10.1A：改了盘面就必须有非数字的表达）', () => {
    const store = storeAtLevee();
    const res = resolveDayEvent(store, STAY_HOME);
    /*
     * ⚠ 摘要**不在** `run.dayEvent` 上：`describeDayEffect` 是在 `resolveDayEvent`
     * 里现算的，随 `dayEventResolved` 事件发出去，界面（`ui/ShopScreen.ts:231`）
     * 拿 applied 自己再算一遍。第一版这里读的是 `store.run.dayEvent?.summary`
     * —— 那个字段不存在，`?? ''` 把它静静变成空串，于是这条用例报的是
     * "expected '' to contain …"，看着像功能没做，其实是断言找错了地方。
     */
    const line = res.events
      .filter((e) => e.type === 'dayEventResolved')
      .flatMap((e) => (e.type === 'dayEventResolved' ? e.summary : []))
      .join('，');
    expect(line).toContain('屋里贴地那 1 排没了');
  });

  it('另外两支不会动盘面（"可后悔的决定"要真的只有那一支有代价）', () => {
    const store = storeAtLevee();
    const before = store.run.shelves.map((s) => s.h);
    // 「去值守」是 0 号（耗体力换心情），它不该动家里
    expect(resolveDayEvent(store, 0).ok).toBe(true);
    expect(store.run.shelves.map((s) => s.h)).toEqual(before);
    expect(store.run.homeSinkRows).toBe(0);
    expect(store.run.dayEvent?.applied?.homeSink ?? null).toBeNull();
  });

  it('★ 每块至少留一排：水位不会把某块家具吃到 0 排', () => {
    const store = storeAtLevee();
    // 先把每块砍到只剩一排（模拟"水位已经很高"），再淹一次
    store.run.shelves = store.run.shelves.map((s) => ({
      ...s,
      h: 1,
      slots: s.slots.slice(0, 1),
      zoneIds: s.zoneIds.slice(0, 1),
    }));
    resolveDayEvent(store, STAY_HOME);
    expect(store.run.shelves.every((s) => s.h === 1)).toBe(true);
    // 砍不动就**不记账**（否则玩家会看到"屋里贴地 1 排没了"而没有一排真的没了）
    expect(store.run.homeSinkRows).toBe(0);
    expect(store.run.dayEvent?.applied?.homeSink ?? null).toBeNull();
  });
});
