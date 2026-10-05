/**
 * 装配入口（§3.3 分层的最顶端）：
 *   读档/开新局 → 把 phase 接到 Router → 挂"永不丢档"的三个钩子。
 *
 * M1 阶段 A 的界面清单：prologue（开局）/ stockpile_shop（扫货）/ organize（整理）/ ending（D-Day）。
 * 其余 phase 由 PendingScreen 兜底 —— 存档里可能存在它们（阶段 B/C/D 实装前后各有一个窗口期），
 * 白屏是最差的处理方式。
 */
import './style.css';
import { CATEGORY_ORDER } from './data/items';
import {
  DISASTER_DEFS,
  DISASTER_TIER_GATES,
  disasterPool,
  disasterTopTier,
  getDisasterDef
} from './data/disaster';
import { getIdentityDef } from './data/identities';
import { ACTION_POINTS_PER_DAY } from './data/shops';
import { initAudio, playSfx } from './fx/audio';
import { showToast } from './fx/popup';
import { openDeferred } from './meta/deferred';
import { createCursor } from './model/rng';
import { ROOM_ID } from './model/shelf';
import type { GamePhase } from './model/types';
import { bootstrapStore } from './state/store';
import { declineRequest, fulfillRequest, leaveRequest, type HelpResult } from './systems/help';
import { createOrganizeSession, resetSession, restoreOrganizeSession } from './systems/organize';
import { rollShopStocks } from './systems/shop';
import { tradeForBox } from './systems/trade';
import {
  advanceSurvivalDay,
  chooseIdentity,
  chooseNightOption,
  endDay,
  ensureDayStocks,
  goHome,
  goOut,
  sleep,
  startSurvival,
  type PhaseResult
} from './systems/phases';
import { switchDisaster } from './systems/switchDisaster';
import { createStartingShelves, disasterProgressOf, newRunWithDisaster } from './systems/setup';
import { CodexScreen } from './ui/CodexScreen';
import { EndingScreen } from './ui/EndingScreen';
import { NightScreen } from './ui/NightScreen';
import { OrganizeScreen } from './ui/OrganizeScreen';
import { PendingScreen } from './ui/PendingScreen';
import { PrologueScreen } from './ui/PrologueScreen';
import { Router, type Screen, type ScreenKey } from './ui/Router';
import { HelpScreen } from './ui/HelpScreen';
import { ShopScreen } from './ui/ShopScreen';
import { SurvivalScreen } from './ui/SurvivalScreen';

const root = document.getElementById('app');
if (!root) throw new Error('找不到 #app 挂载点');

/**
 * 全局表现层容器：toast 必须活过页面切换。
 * 各界面自己的 .fx-layer 负责拟声字这类"贴着某个格子出现"的东西，切页时跟着一起消失才对；
 * 而"寒潮登陆""放回粮油箱"这类跨页提示得有个不随页面重建的家，所以另起一个挂在 body 上。
 */
const fxRoot = document.createElement('div');
fxRoot.className = 'fx-layer';
document.body.appendChild(fxRoot);

/*
 * ★ 开新局这一下**必须带上跨局账本**（M4 决策 A）：这一局抽到哪一场灾难
 * 由 tier 阶梯决定（第一局必然是寒潮，见 `data/disaster.ts` 的 `DISASTER_TIER_GATES`）。
 * `bootstrapStore` 把 meta 交进来，所以这里不必自己去读一次存档 ——
 * 而"读两次"正是会出现"界面显示的那一场与铺进房间的那一场不是同一场"的地方。
 */
const store = bootstrapStore((meta) => newRunWithDisaster(meta));
const session = createOrganizeSession();

/*
 * ★ 恢复"手里正捏着的那件"（v15：它现在落盘了）。
 *
 * 在此之前它只活在内存里，而"拿起一件"会把物资**从格子/箱子里移走** ——
 * 于是拿起来之后刷新页面，那件物资**凭空消失**（玩家报的就是这个）。
 * 现在从存档里恢复；万一来处已经不存在（箱子被拆空后消失等），
 * `restoreOrganizeSession` 会把它送进临时搁置箱 —— **绝不丢件**。
 */
restoreOrganizeSession(store, session);

// 存档自愈：v3 迁移过来的档没有"当天的点位库存"，这里补一次。
// 幂等 —— 库存已经属于今天时它一步都不动（不碰 RNG，不影响"同 seed 同结果"）。
ensureDayStocks(store);

/**
 * 图鉴是否打开（§10B.2 的界面 / 补 D-16）。
 *
 * ★ 它**不落盘**，而且这是刻意的：图鉴是"停下来看一眼"的地方，
 * 不是一个要恢复的进度。刷新之后回到 `phase` 该在的那一屏，正是 §4A 要的
 * （"任何时刻杀进程，损失 = 0" —— 而回到图鉴不算损失，回到该做的事才算）。
 *
 * 详见 `ui/Router.ts` 的 `ScreenKey` 注释：图鉴是唯一一个**不来自 phase** 的页面。
 */
let codexOpen = false;

function keyOfPhase(phase: GamePhase): ScreenKey {
  // 图鉴优先级最高：它可以从任何一屏打开（结算页、开局页），
  // 而"打开着图鉴"这件事与这一局进行到哪一步无关
  if (codexOpen) return 'codex';
  switch (phase) {
    case 'prologue':
      return 'prologue';
    case 'stockpile_shop':
      return 'shop';
    case 'organize':
      return 'organize';
    case 'night':
      return 'night';
    case 'survival_day':
      return 'survival';
    case 'help_request':
      return 'help';
    case 'ending':
      return 'ending';
    default:
      return 'pending';
  }
}

/** 打开 / 关闭图鉴。两处都只是翻一个开关再让 Router 自己判断换不换页 */
function setCodex(open: boolean): void {
  codexOpen = open;
  router.render();
}

function restart(): void {
  resetSession(session);
  // ★ 重开也要按阶梯重抽：玩家可能刚在上一局撑到了最后，
  //   池子因此变大（见 `systems/setup.ts` 的 `newRunWithDisaster`）
  store.replaceRun(newRunWithDisaster(store.save.meta));
  router.render();
}

function consumePhase(result: PhaseResult): void {
  for (const ev of result.events) {
    switch (ev.type) {
      case 'rejected':
        playSfx('reject');
        showToast(fxRoot, ev.reason, 'warn');
        break;
      case 'identityChosen':
        showToast(fxRoot, `${ev.identityName} · 开局现金 ${ev.cash} 元`);
        break;
      case 'disasterLanded':
        playSfx('crush');
        // ★ 报的是**这一局那一场**的名字，不是写死的"寒潮"（M4 决策 A）。
        //   116 场都能被抽到之后，一句写死的浮字会当场变成一个 bug。
        showToast(fxRoot, `${getDisasterDef(store.run.disasterId).name}登陆`);
        break;
      case 'nightFell':
        // 入夜的表现交给 NightScreen 自己（它要在同一个屏幕里把四维摊开给玩家看），
        // 这里只补一个"事情来了"的听觉提示
        playSfx('preview');
        break;
      case 'survivalSettled': {
        const report = ev.report;
        const short = report.drains.reduce((sum, d) => sum + d.shortage, 0);
        const bits: string[] = [];
        if (short > 0) bits.push(`缺 ${short} 件`);
        // 刻意**不**往这里塞"硬撑"：日报里已经有一整行专门讲它，浮字只会压在正文上重复一遍。
        // 浮字留给"坏了 N 件"这类界面正文里没有的、转瞬即逝的事。
        if (report.spoiledToday > 0) bits.push(`坏了 ${report.spoiledToday} 件`);
        if (bits.length > 0) showToast(fxRoot, bits.join(' · '), short > 0 ? 'warn' : 'ink');
        break;
      }
      case 'survivalCompleted':
        playSfx('tidy');
        showToast(fxRoot, `撑过 ${ev.days} 天`);
        break;
      case 'survivalEnded':
        playSfx('crush');
        showToast(fxRoot, '撑不住了', 'warn');
        break;
      case 'helpKnocked':
        // 门响的表现交给 HelpScreen 自己（它要在同一屏里把清单摊开给玩家看）
        playSfx('preview');
        break;
      case 'nightResolved':
      case 'helpResolved':
      case 'dayStarted':
      case 'wentHome':
      case 'wentOut':
        break;
    }
  }
}

/**
 * 求援订单的后果提示。
 *
 * 单独一条函数（而不是并进 consumePhase），因为订单命令返回的是 `HelpEvent` 而不是
 * `PhaseEvent` —— 两者的生命周期不一样：前者只在这一屏有效，后者要驱动换页。
 */
function consumeHelp(result: HelpResult): void {
  for (const ev of result.events) {
    switch (ev.type) {
      case 'helpFulfilled':
        playSfx('tidy');
        showToast(fxRoot, ev.thanks ? `${ev.npcName}留下了 ${ev.thanks}` : `给了${ev.npcName}`);
        break;
      case 'helpDeclined':
        showToast(fxRoot, `人情 -${ev.trustLoss}`, 'warn');
        break;
      case 'helpFailed':
        playSfx('reject');
        showToast(fxRoot, ev.reason, 'warn');
        break;
      case 'rejected':
        showToast(fxRoot, ev.reason, 'warn');
        break;
    }
  }
}

function makeScreen(key: ScreenKey): Screen {
  switch (key) {
    case 'prologue':
      return new PrologueScreen(root as HTMLElement, {
        // ★ 这一页显示的必须是**这一局真的抽到的那一场**（M4 决策 A）——
        //   它就是铺房间用的那个 id。写死常量会让这一页对着热浪局念寒潮的日历。
        disasterId: store.run.disasterId,
        // §10B.3：开局页要读跨局账本（身份熟练度 + 哪些身份解锁了）
        meta: store.save.meta,
        onConfirm: (identityId) => {
          consumePhase(chooseIdentity(store, identityId));
          router.render();
        },
        onRestart: restart
      });
    case 'shop':
      return new ShopScreen(root as HTMLElement, store, {
        onGoHome: () => {
          consumePhase(goHome(store));
          router.render();
        }
      });
    case 'organize':
      return new OrganizeScreen(root as HTMLElement, store, session, {
        onRestart: restart,
        onGoOut: () => {
          consumePhase(goOut(store));
          router.render();
        },
        onEndDay: () => {
          consumePhase(endDay(store));
          router.render();
        }
      });
    case 'night':
      return new NightScreen(root as HTMLElement, store, {
        onChoose: (choice) => {
          consumePhase(chooseNightOption(store, choice));
          router.render();
        },
        onSleep: () => {
          consumePhase(sleep(store));
          router.render();
        }
      });
    case 'survival':
      return new SurvivalScreen(root as HTMLElement, store, {
        onStart: () => {
          consumePhase(startSurvival(store));
          router.render();
        },
        onNext: () => {
          consumePhase(advanceSurvivalDay(store));
          router.render();
        },
        onTrade: (picks) => {
          const result = tradeForBox(store, picks);
          for (const ev of result.events) {
            if (ev.type === 'traded') {
              playSfx('place');
              showToast(fxRoot, `换回一${ev.boxName}`);
            } else {
              playSfx('reject');
              showToast(fxRoot, ev.reason, 'warn');
            }
          }
          router.render();
          return result.ok;
        }
      });
    case 'help':
      return new HelpScreen(root as HTMLElement, store, {
        onFulfill: () => {
          consumeHelp(fulfillRequest(store));
          router.render();
        },
        onDecline: () => {
          consumeHelp(declineRequest(store));
          router.render();
        },
        onLeave: () => {
          // 兜底出口，没有提示 —— 它本不该发生，弹一条浮字只会让玩家以为自己弄坏了什么
          consumeHelp(leaveRequest(store));
          router.render();
        }
      });
    case 'ending':
      return new EndingScreen(root as HTMLElement, store, {
        onRestart: restart,
        onOpenCodex: () => setCodex(true)
      });
    case 'codex':
      return new CodexScreen(root as HTMLElement, store, { onClose: () => setCodex(false) });
    default:
      // 兜底页。走到这里说明存档里是一个**当前版本不认识的 phase**（手改过的档、
      // 或者从更新的版本降级回来）。它不该断言任何"还没做"的东西 ——
      // M2 收尾时这里还写着"夜晚事件 / 生存期 / 求援订单会在后续里程碑实装"，
      // 而那时它们都已经能玩了：一句过期的占位文案比白屏更糟，因为它是在骗玩家。
      return new PendingScreen(root as HTMLElement, {
        title: '这一局读不出来',
        note: '存档里的进度状态这个版本不认识。可以重开一局，或者回到上一页继续。',
        // 兜底页也要那条「窗外」—— 见 `ui/windowBand.ts` 的注释
        disasterId: store.run.disasterId,
        onRestart: restart
      });
  }
}

const router = new Router(root, () => keyOfPhase(store.run.phase), makeScreen);
router.render();

// 移动端：第一次触摸才允许创建 AudioContext（自动播放策略）
const unlockAudio = (): void => initAudio();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// §4A "任何时刻杀进程，损失 = 0"：把待写的档在离开前砸实
const flush = (): void => store.flush();
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

/**
 * ★★ 换灾难的**生产构建也能用**的那条路（2026-10 补，用户的走查卡在这里）。
 *
 * ## 为什么必须有它
 *
 * `__tunhuo` 那一整套钩子住在下面的 `if (import.meta.env.DEV)` 里 ——
 * 于是 **`npm run build` 出来的那一份里 `__tunhuo` 根本不存在**，
 * 而用户走查时打开的正是 `dist/index.html`（或一个预览服务）。
 * 他报的"`__tunhuo.disaster('洪水')` 这个命令好像根本没用"就是这么来的：
 * **不是命令坏了，是那一份构建里没有它**（连 `__tunhuo` 都没有，
 * 控制台会报 `Cannot read properties of undefined`，而那读起来像"命令没实现"）。
 *
 * 所以这里补一条**不依赖构建模式**的路：URL 参数。
 *   · `index.html?disaster=洪水`（中文名）
 *   · `index.html?disaster=flood_urban`（id）
 *
 * ⚠ 它**重铺货架**（`createStartingShelves`），所以会清空已经摆好的东西 ——
 * 这是刻意的：空间维度（少一块 / 矮一排）只有在**开局那一刻**才铺得出来。
 * 这条与 dev 那个 `__tunhuo.disaster()` 是同一件事的两种入口。
 */
function applyDisasterFromUrl(): void {
  const param = new URLSearchParams(window.location.search).get('disaster');
  if (!param) return;
  store.commit((draft) => {
    const result = switchDisaster(draft, param);
    if (!result.ok) console.warn(`[囤货末世] ?disaster=${param} —— ${result.message}`);
    else console.info(`[囤货末世] ?disaster ${result.message}`);
  });
  const wanted = DISASTER_DEFS.find((d) => d.id === param || d.name === param);
  if (wanted && store.run.disasterId === wanted.id) {
    ensureDayStocks(store);
    router.render();
  }
  /*
   * ★ 用 URL 换过一次之后**记得把参数从地址栏去掉** —— 否则它每次刷新都会再执行一遍，
   * 于是"我刚刚在控制台换成了热浪、一刷新又变回洪水"会读起来像"命令时灵时不灵"。
   * （这不是 bug，是 URL 参数本来就有"常驻"的语义；但不写一句提示，它就是陷阱。）
   */
  if (wanted) {
    console.info(
      `[囤货末世] 地址栏里的 ?disaster=${param} 会在**每次刷新**时重新生效 —— ` +
        `想固定用控制台的 __tunhuo.disaster("…") 换场，请把地址栏那个参数去掉。`
    );
  }
}
applyDisasterFromUrl();

// 调试用：控制台可以直接看当前存档、整理会话、路由，以及欠账清单
if (import.meta.env.DEV) {
  const debts = openDeferred();

  /**
   * 一键跳到某一天 —— **只在 dev 构建里存在**。
   *
   * 它存在的理由是"人工走测"这件事本身：M2 的验收要求逐条读事件文案，
   * 而白天事件（约六成的店门）、突发事件（约三成的日子）都是**随机**才碰得到的，
   * 夜间事件还叠了一层 60%。没有这个钩子，想读一遍全部文案就得反复重开、走满 7 天，
   * 于是"逐条读一遍"这件事事实上没人会做。
   *
   * 用法（浏览器控制台）：
   *   __tunhuo.jump(-7)     囤货期第一天，从扫货开始
   *   __tunhuo.jump(-1, { actionPoints: 3 })  囤货期最后一天，行动点满
   *   __tunhuo.jump(0)      D-Day
   *   __tunhuo.jump(3)      生存期第 3 天（会先结算一次，日报上就有东西了）
   *   __tunhuo.jump(3, { handy: false })       顺手位不标，看突发事件受创的那一版
   *   __tunhuo.jump(3, { zone: 'none' })       一张胶带都不贴
   *
   * 它**只改 phase / day / 身份**，不伪造货物与库存 —— 所以看到的仍然是真实规则下的屏幕。
   */
  const jump = (day: number, opts: { actionPoints?: number; handy?: boolean; zone?: 'none' | 'all' } = {}): void => {
    store.commit((draft) => {
      if (!draft.identityId) draft.identityId = 'group_buyer';
      const identity = getIdentityDef(draft.identityId);
      draft.day = day;
      draft.actionPoints = opts.actionPoints ?? ACTION_POINTS_PER_DAY;
      draft.carLoad = 0;
      draft.currentShopId = null;
      draft.dayEvent = null;
      draft.shopPriceFactor = 1;
      draft.shopLimits = [];
      draft.shopBoughtToday = {};
      draft.night = null;
      if (day < 0) {
        draft.phase = 'stockpile_shop';
        // 走测钩子也要带上这一场的灾难 id —— 物价曲线是按灾难算的（D-19）
        draft.shopStocks = rollShopStocks(identity, createCursor(draft.seed), day, draft.disasterId);
        draft.seed = createCursor(draft.seed).state;
      } else {
        draft.phase = 'survival_day';
      }
      if (opts.handy !== undefined) {
        draft.shelves.forEach((s, i) => {
          s.handyRank = opts.handy && i === 0 ? 1 : null;
        });
      }
      if (opts.zone === 'none') {
        draft.zones = [];
        draft.shelves.forEach((s) => {
          // 一行的粒度：整块清空 = 每一行都置 null
          s.zoneIds = Array.from({ length: s.h }, () => null);
        });
      } else if (opts.zone === 'all') {
        draft.zones = [
          { id: 'zone_all', name: '全收', color: '#000000', autoAccept: { categories: [...CATEGORY_ORDER] } }
        ];
        draft.shelves.forEach((s) => {
          s.zoneIds = Array.from({ length: s.h }, () => 'zone_all');
        });
      }
    });
    router.render();
  };

  /**
   * ★ **重抽这一局的灾难**（M4 W-01 的走查钩子）。
   *
   * ## 它为什么必须有
   *
   * 116 场灾难从 M4 起真的会被抽到了，而**抽到哪一场是按 tier 阶梯来的**：
   * 全新档的池子里只有寒潮（那是刻意的，见 `data/disaster.ts` 的
   * `DISASTER_TIER_GATES`）。于是"想看一眼洪水局长什么样"这件事，
   * 在真实规则下要**先撑过一次**才做得到 —— 而走查要看的恰恰是那些没见过的。
   *
   * 所以它把这件事变成一条命令：按名字（或 id）指定一场，**重铺整间屋子**。
   *
   * ⚠ 它**只在 dev 构建里存在**。用 `npm run build` 出来的那一份时请用
   * URL 参数：`index.html?disaster=洪水`（见 `applyDisasterFromUrl` 的注释 ——
   * 那条路就是为用户"在预览服务上走查"补的）。
   *
   * 用法（浏览器控制台，dev）：
   *   __tunhuo.disaster('洪水')      按名字
   *   __tunhuo.disaster('flood_urban')  按 id
   *   __tunhuo.disaster()            列出现在能抽到的池子（含"还差什么"）
   */
  const disaster = (which?: string): void => {
    const progress = disasterProgressOf(store.save.meta);
    const pool = disasterPool(progress);
    if (!which) {
      const top = disasterTopTier(progress);
      console.info(
        `[囤货末世] 现在最高 tier ${top}，池子 ${pool.length}/${DISASTER_DEFS.length} 场：\n` +
          pool.map((d) => `${d.name}(${d.id})`).join(' / ')
      );
      console.info(
        `[囤货末世] 撑过 ${progress.survivedRuns} 次、见过 ${progress.seenDisasters} 场。` +
          `下一档：${[1, 2, 3, 4].map((t) => `${t}=${DISASTER_TIER_GATES[t as 1 | 2 | 3 | 4].why}`).join('；')}`
      );
      return;
    }
    /*
     * ★ 换灾难的**逻辑**住在 `systems/switchDisaster.ts`（可以被单测跑到），
     * 这里只负责"接上 store 与 router"。
     *
     * 之所以要这么切：用户报"指令只发一句话、页面毫无变化"时，
     * 我发现那个函数**一次都没被测试跑过** —— 它住在 `main.ts` 的 DEV 块里，
     * 而 `main.ts` 一 import 就装配整个应用，测不了。
     * 于是它的唯一验收方式是"人工敲一下看屏幕"，而屏幕上那一条带子
     * 当时还被 `style.css` 里一段坏注释吃掉了。
     */
    store.commit((draft) => {
      const result = switchDisaster(draft, which);
      if (result.ok) console.info(`[囤货末世] ${result.message}`);
      else console.warn(`[囤货末世] ${result.message}`);
    });
    ensureDayStocks(store);
    router.render();
  };

  /**
   * ★★ **走查自检**：一次把"你在看哪一份、那一屏上有什么"打出来（2026-10 补）。
   *
   * ## 为什么必须有它（而不是再改一次代码）
   *
   * 用户连着两轮报"天光带没看到""那个命令根本没生效"，而我这边
   * 代码、构建产物、测试**三处都验过是对的**。这种"两边都说得通"的局面，
   * 再猜下去就是 M2 那条 7 轮的老路（纪律 §0.1：改到第二轮还不好，
   * 就停止改代码、去补"能看见现场"的手段）。
   *
   * 所以这里补的**不是**第三次修改，而是一个能把现场说清楚的手段：
   *
   *   · 这一份是 dev 还是生产（`__tunhuo` 只在 dev 里存在）；
   *   · 当前这一局的灾难 id 与名字、以及在哪一屏；
   *   · 屏幕上**真的有没有**那条带子、它的高度、背景、以及它被算出来的位置；
   *   · 顺带把这一屏的几个区块标题打出来（"我没看到"有时是"我不在那一屏"）。
   *
   * 用法：控制台 `__tunhuo.why()`
   */
  const why = (): void => {
    const run = store.run;
    const band = document.querySelector('.window-band') as HTMLElement | null;
    const tag = document.querySelector('.disaster-tag') as HTMLElement | null;
    const cs = band ? getComputedStyle(band) : null;
    const rect = band?.getBoundingClientRect();
    const blocks = [...document.querySelectorAll('.block-title')].map((e) => e.textContent).join(' / ');
    console.info(
      [
        '[囤货末世] 自检',
        `  构建：${import.meta.env.DEV ? 'dev（__tunhuo 存在）' : '生产（没有 __tunhuo）'}`,
        `  这一局：${run.disasterId}（${getDisasterDef(run.disasterId).name}） · phase=${run.phase} · day=${run.day}`,
        `  带子：${band ? '在 DOM 里' : '★ 不在 DOM 里（这一份构建没有它）'}`,
        band
          ? `    类名 = ${band.className}\n` +
            `    内联 = ${band.getAttribute('style')}\n` +
            `    算出来：高度 ${cs?.height} · 背景 ${(cs?.backgroundImage ?? '').slice(0, 70)}\n` +
            `    位置 = ${rect ? `top ${Math.round(rect.top)}px、高 ${Math.round(rect.height)}px、宽 ${Math.round(rect.width)}px` : '?'}`
          : '',
        `  灾难标记 = ${tag ? tag.textContent : '不在'}`,
        `  这一屏的区块 = ${blocks || '（没有）'}`
      ]
        .filter(Boolean)
        .join('\n')
    );
  };

  /**
   * 换一个测试存档（`src/tools/save-*.txt`）。
   *
   * ## 为什么需要它：人工走查的成本几乎全在"走到那一屏"
   *
   * `jump(day)` 只能跳天数，而它**不伪造货物**（那是刻意的：看到的必须仍是
   * 真实规则下的屏幕）。于是"想看结算页长什么样"就得真的囤满 7 天再打 14 天 ——
   * 十几分钟，而走查一轮要看七八屏。那笔账一算，走查就会变成"只看第一屏"。
   *
   * 四个夹具正好各站在一个关键位置（`npm run make-save` 生成）：
   *   · `good`       D-Day，全上架 + 贴好胶带 + 标了顺手位
   *   · `messy`      D-Day，货架全空、一张胶带都没贴
   *   · `100boxes`   囤货期 D-7，100 箱 1000+ 件（整理页的压测位）
   *   · `big-house`  整理期 D-7，**活过 3 次**（身份与房间全解锁）+ 两间房 7 块家具
   *   · `empty-room` 整理期 D-7，**活过 1 次**（储藏间刚解锁但**还空着**）
   *   · `rows`       整理期 D-7，**三张胶带按行贴**（看行级颜色：一块架上三种状态）
   *
   * ★ `big-house` / `empty-room` 是后加的，理由很具体：多房间与"加家具"都要先
   * 把客厅加满（6 块 = 600 元），而普通档在 D-7 只有几百块、还要留钱囤货 ——
   * **人工走查根本走不到那一屏**，而走查的意义恰恰是"看那一屏"。
   * `empty-room` 更专门：它复现的是用户报的"储藏间就一条横线 0/3"那一屏，
   * 而那个状态在别的档里**一个都复现不出来**。
   *
   * 它们**读的是仓库里那几个 .txt**，所以走查用的档与 `saveFixtures.test.ts`
   * 验收过的是同一份 —— 不会出现"我走查的那个档和测试里的不是一回事"。
   *
   * ★ 这是**开发期工具**：生产构建里整个 `if (import.meta.env.DEV)` 块都不存在。
   */
  const load = async (
    name:
      | 'good'
      | 'messy'
      | '100boxes'
      | 'big-house'
      | 'empty-room'
      | 'rows'
      | 'shop-tour'
      | 'perfect'
      | 'perfect-survival'
  ): Promise<void> => {
    const text = await (await fetch(`/src/tools/save-${name}.txt`)).text();
    window.localStorage.setItem('tunhuo.save', text.trim());
    window.location.reload();
  };

  /**
   * ★★ 换灾难的**生产构建也能用**的那条路（2026-10 补）。
   *
   * ## 为什么必须有它
   *
   * 上面那个 `disaster()` 住在 `if (import.meta.env.DEV)` 里 —— 于是
   * **`npm run build` 出来的那一份里 `__tunhuo` 根本不存在**，
   * 而用户走查时打开的正是 `dist/index.html`（或者一个预览服务）。
   * 他报的"`__tunhuo.disaster('洪水')` 这个命令好像根本没用"就是这么来的：
   * 不是命令坏了，是**那一份构建里没有它**（连 `__tunhuo` 都没有）。
   *
   * 所以给一条**不依赖构建模式**的路：URL 参数。
   * 它是走查用的开关，不是玩法 —— 所以它只在"换一场灾难"这个粒度上成立，
   * 而且会**把这一局重置**（空间维度只在开局那一刻铺得出来，见 `disaster()` 的注释）。
   *
   * 用法：`index.html?disaster=洪水` 或 `?disaster=flood_urban`
   */
  const applyDisasterFromUrl = (): void => {
    const param = new URLSearchParams(window.location.search).get('disaster');
    if (!param) return;
    const def = DISASTER_DEFS.find((d) => d.id === param || d.name === param);
    if (!def) {
      // eslint-disable-next-line no-console
      console.warn(`[囤货末世] ?disaster=${param} 认不出这一场（可以用 id 或中文名）。`);
      return;
    }
    store.commit((draft) => {
      draft.disasterId = def.id;
      draft.shelves = createStartingShelves(ROOM_ID, def.id);
      draft.shopStocks = [];
    });
    ensureDayStocks(store);
    // eslint-disable-next-line no-console
    console.info(`[囤货末世] ?disaster 换成了「${def.name}」（${def.id}）`);
  };

  applyDisasterFromUrl();

  (window as unknown as Record<string, unknown>)['__tunhuo'] = {
    store,
    session,
    router,
    deferred: debts,
    jump,
    load,
    disaster,
    why
  };
  // 每开一次页面报一次账。目的很具体：让"寒潮是冷库 → M1 无腐坏""冰箱没效果"
  // 这类**已被记录的空转**，在任何人准备动手"修好"它之前先自我解释一次。
  console.info(
    `[囤货末世] 已知欠账 ${debts.length} 笔：${debts.map((d) => d.id).join(' / ')}，详见 src/meta/deferred.ts`
  );
  console.info('[囤货末世] 走测用：__tunhuo.jump(day) 可以跳到任意一天（只在 dev 构建里存在）');
  console.info(
    '[囤货末世] 走查用：__tunhuo.load("perfect" | "perfect-survival" | "good" | "messy" | "100boxes" | "big-house" | "empty-room" | "rows" | "shop-tour") 切到测试存档'
  );
  console.info(
    '[囤货末世] 走查用：__tunhuo.disaster("洪水") 换一场灾难（重铺屋子）；' +
      '生产构建里没有 __tunhuo，请改用 URL 参数 —— index.html?disaster=洪水'
  );
}
