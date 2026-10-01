/**
 * 拟声字表（§5A 招牌反馈 / 策划案 §12 开放项：中文用字表建议让她过目一遍）。
 * M0 只上"放置系"三档；M2 会扩到 拆箱/压扁/翻找/凑单 全表，并换成手写 SVG。
 *
 * 每条给多个候选字，由 RNG 选一个 —— 同一动作连着做 20 次也不会看腻。
 */
export type SfxAction = 'place' | 'swap' | 'unbox' | 'crush' | 'sort' | 'pick' | 'return' | 'tidy';

export interface SfxWordDef {
  words: readonly string[];
  /** 入场随机旋转范围（度），手写感全靠这点歪 */
  rotateRange: [number, number];
  /** 速度线根数（§5A：2~3 根漫画速度线） */
  speedLines: number;
  /** 字号倍率，拟声字之间要有大小节奏 */
  scale: number;
}

export const SFX_WORDS: Record<SfxAction, SfxWordDef> = {
  place: { words: ['咔！', '咔哒', '嗒'], rotateRange: [-9, 9], speedLines: 3, scale: 1 },
  swap: { words: ['啪嗒', '咔沙'], rotateRange: [-12, 12], speedLines: 2, scale: 0.92 },
  unbox: { words: ['唰', '窸窣', '刺啦'], rotateRange: [-6, 10], speedLines: 2, scale: 0.95 },
  crush: { words: ['哐', '啪叽'], rotateRange: [-14, 14], speedLines: 2, scale: 1.05 },
  sort: { words: ['唰唰', '哗啦'], rotateRange: [-5, 5], speedLines: 3, scale: 0.9 },
  pick: { words: ['咯'], rotateRange: [-8, 8], speedLines: 1, scale: 0.85 },
  return: { words: ['嗒'], rotateRange: [-7, 7], speedLines: 1, scale: 0.85 },
  tidy: { words: ['整整齐齐'], rotateRange: [-2, 2], speedLines: 0, scale: 0.78 }
};
