/**
 * WebAudio 合成音效（§3.2：音效走 WebAudio，M0 不引入任何音频文件）。
 *
 * 音色目标："纸感"—— 短促、干、无混响长尾。合成路径统一是：
 *   白噪 → 带通/低通 → 指数衰减包络（40~110ms）+ 偶尔叠一个下行的正弦"咔"。
 *
 * 本文件属于 fx/，允许碰 DOM；但对外只暴露函数，界面不认识 AudioContext。
 */

/**
 * 音效名。
 *
 * ★ `cut`（撕胶带）是 2026-10 加的。它值得**自己的**声音，而不是借 `return`：
 * 这个动作的意思是"**我把立的规矩撤了**"，而 `return` 是"把东西放回去" ——
 * 两件事在玩家心里不该听起来一样。声音形状取"短、干、偏高频"：
 * 胶带被拉断的那一下本来就只有一声。
 */
type SoundName =
  | 'place'
  | 'preview'
  | 'unbox'
  | 'crush'
  | 'sort'
  | 'pick'
  | 'reject'
  | 'tidy'
  | 'return'
  | 'cut';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

/** 必须在第一次用户手势里调用（移动端自动播放策略） */
export function initAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.5; // 克制：连点 20 次不觉得吵（M2 验收项，M0 就先按这个包络定）
  master.connect(ctx.destination);
  noise = createNoiseBuffer(ctx, 0.25);
}

export function setMuted(next: boolean): void {
  muted = next;
  if (master) master.gain.value = next ? 0 : 0.5;
}

export function isMuted(): boolean {
  return muted;
}

function createNoiseBuffer(audio: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(audio.sampleRate * seconds);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

interface NoiseOptions {
  duration: number;
  gain: number;
  freq: number;
  q?: number;
  type?: BiquadFilterType;
  sweepTo?: number;
  delay?: number;
}

function playNoise(opts: NoiseOptions): void {
  if (!ctx || !master || !noise || muted) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq, t0);
  if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(80, opts.sweepTo), t0 + opts.duration);
  filter.Q.value = opts.q ?? 0.9;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(master);
  src.start(t0);
  src.stop(t0 + opts.duration + 0.02);
}

interface ToneOptions {
  duration: number;
  gain: number;
  from: number;
  to: number;
  delay?: number;
  type?: OscillatorType;
}

function playTone(opts: ToneOptions): void {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t0 + opts.duration);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);
  osc.connect(amp);
  amp.connect(master);
  osc.start(t0);
  osc.stop(t0 + opts.duration + 0.02);
}

export function playSfx(name: SoundName): void {
  if (!ctx) return; // 还没初始化（用户没交互过）→ 静默，绝不报错
  switch (name) {
    case 'place':
      playNoise({ duration: 0.06, gain: 0.34, freq: 2300, q: 0.7 });
      playTone({ duration: 0.07, gain: 0.16, from: 880, to: 420 });
      break;
    case 'preview':
      playNoise({ duration: 0.02, gain: 0.07, freq: 3600, q: 1.4 });
      break;
    case 'unbox':
      playNoise({ duration: 0.11, gain: 0.24, freq: 900, sweepTo: 2600, q: 0.6 });
      playTone({ duration: 0.06, gain: 0.1, from: 620, to: 300, delay: 0.02 });
      break;
    case 'crush':
      playNoise({ duration: 0.08, gain: 0.3, freq: 700, sweepTo: 240, type: 'lowpass' });
      playTone({ duration: 0.09, gain: 0.14, from: 300, to: 130 });
      break;
    case 'sort':
      for (let i = 0; i < 3; i++) {
        playNoise({ duration: 0.035, gain: 0.16, freq: 2600, q: 1.2, delay: i * 0.045 });
      }
      break;
    case 'pick':
      playNoise({ duration: 0.025, gain: 0.1, freq: 1800, q: 1.1 });
      break;
    case 'return':
      playNoise({ duration: 0.03, gain: 0.09, freq: 1300, q: 1 });
      break;
    case 'cut':
      // 撕胶带：一声干脆的高频"啪"。两句噪声叠在一起才有撕裂感（一句像点击）
      playNoise({ duration: 0.02, gain: 0.11, freq: 2600, q: 1.6 });
      playNoise({ duration: 0.045, gain: 0.07, freq: 1500, q: 0.9, delay: 0.018 });
      break;
    case 'tidy':
      playTone({ duration: 0.08, gain: 0.1, from: 1180, to: 1180, type: 'triangle' });
      playTone({ duration: 0.1, gain: 0.08, from: 1560, to: 1560, type: 'triangle', delay: 0.07 });
      break;
    case 'reject':
      playTone({ duration: 0.1, gain: 0.1, from: 240, to: 170, type: 'triangle' });
      break;
  }
}
