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
import { getIdentityDef } from './data/identities';
import { ACTION_POINTS_PER_DAY } from './data/shops';
import { initAudio, playSfx } from './fx/audio';
import { showToast } from './fx/popup';
import { openDeferred } from './meta/deferred';
import { createCursor } from './model/rng';
import type { GamePhase } from './model/types';
import { bootstrapStore } from './state/store';
import { declineRequest, fulfillRequest, leaveRequest, type HelpResult } from './systems/help';
import { createOrganizeSession, resetSession } from './systems/organize';
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
import { createStartingRun } from './systems/setup';
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

const store = bootstrapStore(() => createStartingRun());
const session = createOrganizeSession();

// 存档自愈：v3 迁移过来的档没有"当天的点位库存"，这里补一次。
// 幂等 —— 库存已经属于今天时它一步都不动（不碰 RNG，不影响"同 seed 同结果"）。
ensureDayStocks(store);

function keyOfPhase(phase: GamePhase): ScreenKey {
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

function restart(): void {
  resetSession(session);
  store.replaceRun(createStartingRun());
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
        showToast(fxRoot, '寒潮登陆');
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
      return new EndingScreen(root as HTMLElement, store, { onRestart: restart });
    default:
      // 兜底页。走到这里说明存档里是一个**当前版本不认识的 phase**（手改过的档、
      // 或者从更新的版本降级回来）。它不该断言任何"还没做"的东西 ——
      // M2 收尾时这里还写着"夜晚事件 / 生存期 / 求援订单会在后续里程碑实装"，
      // 而那时它们都已经能玩了：一句过期的占位文案比白屏更糟，因为它是在骗玩家。
      return new PendingScreen(root as HTMLElement, {
        title: '这一局读不出来',
        note: '存档里的进度状态这个版本不认识。可以重开一局，或者回到上一页继续。',
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
        draft.shopStocks = rollShopStocks(identity, createCursor(draft.seed), day);
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
          s.zoneId = null;
        });
      } else if (opts.zone === 'all') {
        draft.zones = [
          { id: 'zone_all', name: '全收', color: '#000000', autoAccept: { categories: [...CATEGORY_ORDER] } }
        ];
        draft.shelves.forEach((s) => {
          s.zoneId = 'zone_all';
        });
      }
    });
    router.render();
  };

  (window as unknown as Record<string, unknown>)['__tunhuo'] = {
    store,
    session,
    router,
    deferred: debts,
    jump
  };
  // 每开一次页面报一次账。目的很具体：让"寒潮是冷库 → M1 无腐坏""冰箱没效果"
  // 这类**已被记录的空转**，在任何人准备动手"修好"它之前先自我解释一次。
  console.info(
    `[囤货末世] 已知欠账 ${debts.length} 笔：${debts.map((d) => d.id).join(' / ')}，详见 src/meta/deferred.ts`
  );
  console.info('[囤货末世] 走测用：__tunhuo.jump(day) 可以跳到任意一天（只在 dev 构建里存在）');
}
