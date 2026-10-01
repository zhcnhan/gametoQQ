/**
 * 分区纸胶带色板（§5A：黑白为底，朱红唯一点缀）。
 * 8 色全部压过明度与饱和度，保证印在纸底上像"胶带撕下来贴上去"的质感，而不是荧光色。
 */
export const ZONE_COLORS: readonly string[] = [
  '#C8372D', // 朱红（主点缀色）
  '#E0A32E', // 赭黄
  '#6E8B6B', // 苔绿
  '#3F5E7A', // 藏青
  '#8C5A72', // 藕紫
  '#B58A5E', // 茶棕
  '#5B5B57', // 墨灰
  '#D8CDB4' // 米茶
];

export const ZONE_COLOR_NAMES: readonly string[] = [
  '朱红',
  '赭黄',
  '苔绿',
  '藏青',
  '藕紫',
  '茶棕',
  '墨灰',
  '米茶'
];

export const DEFAULT_ZONE_COLOR = ZONE_COLORS[0] as string;
