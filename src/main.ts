/**
 * 装配入口（§3.3 分层的最顶端）：
 *   读档/开新局 → 把 phase 接到 Router → 挂"永不丢档"的三个钩子。
 *
 * M1 阶段 A 的界面清单：prologue（开局）/ stockpile_shop（扫货）/ organize（整理）/ ending（D-Day）。
 * 其余 phase 由 PendingScreen 兜底 —— 存档里可能存在它们（阶段 B/C/D 实装前后各有一个窗口期），
 * 白屏是最差的处理方式。
 */
import './style.css';
import { initAudio, playSfx } from './fx/audio';
import { showToast } from './fx/popup';
import { openDeferred } from './meta/deferred';
import type { GamePhase } from './model/types';
import { bootstrapStore } from './state/store';
import { createOrganizeSession, resetSession } from './systems/organize';
import { chooseIdentity, endDay, ensureDayStocks, goHome, goOut, type PhaseResult } from './systems/phases';
import { createStartingRun } from './systems/setup';
import { EndingScreen } from './ui/EndingScreen';
import { OrganizeScreen } from './ui/OrganizeScreen';
import { PendingScreen } from './ui/PendingScreen';
import { PrologueScreen } from './ui/PrologueScreen';
import { Router, type Screen, type ScreenKey } from './ui/Router';
import { ShopScreen } from './ui/ShopScreen';

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
    case 'ending':
      return 'ending';
    default:
      // night / survival_day / help_request 属阶段 B/C/D
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
      case 'dayStarted':
      case 'wentHome':
      case 'wentOut':
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
    case 'ending':
      return new EndingScreen(root as HTMLElement, store, { onRestart: restart });
    default:
      return new PendingScreen(root as HTMLElement, {
        title: '这里还没开',
        note: '这个阶段（夜晚事件 / 生存期 / 求援订单）会在后续里程碑实装。',
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
  (window as unknown as Record<string, unknown>)['__tunhuo'] = {
    store,
    session,
    router,
    deferred: debts
  };
  // 每开一次页面报一次账。目的很具体：让"寒潮是冷库 → M1 无腐坏""冰箱没效果"
  // 这类**已被记录的空转**，在任何人准备动手"修好"它之前先自我解释一次。
  console.info(
    `[囤货末世] 已知欠账 ${debts.length} 笔：${debts.map((d) => d.id).join(' / ')} —— 详见 src/meta/deferred.ts`
  );
}
