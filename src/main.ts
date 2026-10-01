/**
 * 装配入口：读档 / 开局 → 装界面 → 挂"永不丢档"的三个钩子。
 * M0 只有整理一页，状态机（prologue → … → ending）留给 M1。
 */
import './style.css';
import { initAudio } from './fx/audio';
import { bootstrapStore } from './state/store';
import { createOrganizeSession, resetSession } from './systems/organize';
import { createStartingRun } from './systems/setup';
import { OrganizeScreen } from './ui/OrganizeScreen';

const root = document.getElementById('app');
if (!root) throw new Error('找不到 #app 挂载点');

const store = bootstrapStore(() => createStartingRun());
const session = createOrganizeSession();

const screen = new OrganizeScreen(root, store, session, {
  onRestart: () => {
    resetSession(session);
    store.replaceRun(createStartingRun());
    screen.render();
  }
});
screen.mount();

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

// 调试用：控制台可以直接看当前存档与整理会话
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>)['__tunhuo'] = { store, session, screen };
}
