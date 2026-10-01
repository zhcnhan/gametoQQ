/**
 * §5A 招牌反馈：手写拟声字 + 2~3 根漫画速度线，100ms 淡出。
 * 另附：空纸箱压扁 ghost、"整整齐齐"小字奖励、轻提示条。
 *
 * 说明：这里的随机只有"歪多少度、偏几像素"这类纯视觉抖动，用 Math.random 即可，
 * 不消耗游戏种子（否则同一局的随机数序列会被渲染次数影响，存档不再可复现）。
 */
import { SFX_WORDS, type SfxAction } from '../data/sfx-words';
import { iconSvg } from './icons';

const WORD_LIFETIME_MS = 190;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export interface Point {
  x: number;
  y: number;
}

/** 在指定屏幕坐标弹拟声字 + 速度线（100ms 淡出，存活不超过 190ms） */
export function spawnSfxWord(host: HTMLElement, point: Point, action: SfxAction, overrideText?: string): void {
  const def = SFX_WORDS[action];
  const word = overrideText ?? def.words[Math.floor(Math.random() * def.words.length)] ?? '咔！';

  const el = document.createElement('div');
  el.className = `sfx-word sfx-${action}`;
  const rotate = randomBetween(def.rotateRange[0], def.rotateRange[1]);
  el.style.left = `${point.x}px`;
  el.style.top = `${point.y}px`;
  // 旋转与缩放挂在文字本体上（--rot/--sc）：外层要留给入场动画的 transform
  el.style.setProperty('--rot', `${rotate.toFixed(2)}deg`);
  el.style.setProperty('--sc', String(def.scale));

  const lines = Math.max(0, def.speedLines);
  for (let i = 0; i < lines; i++) {
    const line = document.createElement('i');
    line.className = `sfx-line sfx-line-${i + 1}`;
    line.style.setProperty('--len', `${randomBetween(16, 30).toFixed(1)}px`);
    line.style.setProperty('--ang', `${(i - (lines - 1) / 2) * randomBetween(24, 40) + randomBetween(-6, 6)}deg`);
    el.appendChild(line);
  }

  const text = document.createElement('span');
  text.className = 'sfx-word-text';
  text.textContent = word;
  el.appendChild(text);

  host.appendChild(el);
  window.setTimeout(() => el.remove(), WORD_LIFETIME_MS);
}

/** 空纸箱压扁：拿一个旧位置的坐标，在原地演"被踩扁"然后消失 */
export function spawnCrushGhost(host: HTMLElement, rect: DOMRect): void {
  const ghost = document.createElement('div');
  ghost.className = 'box-ghost';
  ghost.innerHTML = `${iconSvg('box')}<span class="box-ghost-crush">${iconSvg('crush')}</span>`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  host.appendChild(ghost);
  window.setTimeout(() => ghost.remove(), 320);
  spawnSfxWord(host, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, 'crush');
}

/** 一整列排满 FEFO 时的"整整齐齐"小字奖励（§5A） */
export function spawnTidyTag(host: HTMLElement, rect: DOMRect): void {
  const el = document.createElement('div');
  el.className = 'tidy-tag';
  el.textContent = '整整齐齐';
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top - 6}px`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 900);
}

const toastTimers = new WeakMap<HTMLElement, number>();

export function showToast(host: HTMLElement, text: string, tone: 'ink' | 'warn' = 'ink'): void {
  const prev = toastTimers.get(host);
  if (prev !== undefined) window.clearTimeout(prev);
  let el = host.querySelector<HTMLDivElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    host.appendChild(el);
  }
  el.className = `toast toast-${tone}`;
  el.textContent = text;
  // 重启动画
  el.classList.remove('toast-in');
  void el.offsetWidth;
  el.classList.add('toast-in');
  const timer = window.setTimeout(() => el?.remove(), 1600);
  toastTimers.set(host, timer);
}
