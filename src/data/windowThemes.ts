/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「窗外」配色 —— 让**每一场灾难看起来就不一样**（2026-10 用户要的）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它补的是哪一笔账（用户的原话）
 *
 * > "各个灾难没有让我感觉到不同，同质性太强烈了（即便有数值变化我也感觉不出来，
 * >  哪怕你改改某些配色也是好的啊）"
 *
 * 他说得对，而取证的结果比"感觉"更硬（`scripts/_probe-variety.ts`）：
 * **116 场在各个维度上其实都不缺差别**（日耗 40 种、刚需 45 种、事件池 107 种、
 * 温度曲线 96 种），可**玩家能看见的只有数字** ——
 * 而"每天多要 1 份水"这种差别在屏幕上根本不构成"这是另一场灾难"。
 *
 * ★★ 而表里其实**早就写好了一整维给眼睛看的东西**：
 * `DisasterProfile.windowScene`（`model/types.ts` 的注释写着"**窗外渲染主题 key**"），
 * 116 场**各有各的值**（`blizzard` / `tsunami-wall` / `locust-sky` / `riot-street` …）——
 * 而它在全仓**只有一个类型定义**，**零个渲染读点**。
 * 也就是说：**这一维从 M3 生成出来那天起就是死的**（与 `capacityFactor` 同一类，
 * 见 `src/meta/deferred.ts` 的 D-32 —— "写了 ≠ 生效了"）。
 *
 * 所以这个文件做两件事：
 *  ① 把 116 个 `windowScene` key **一个个**映到一组配色上（不靠"按家族猜"）；
 *  ② 让家族给一个**底色倾向**，key 自己再定**具体脸色** ——
 *     两张表叠起来，同一场永远得到同一个主题，而**光看颜色就能认出是哪一场**。
 *
 * ## 三条美学纪律（§5A，不许自己改）
 *
 *  · **黑白为底**：纸底 `#f7f3ea` 与墨色 `#2c2c2a` 一个都不动，这一层只是"窗外"；
 *  · **朱红唯一点缀**：所以下面**一个 `#c8372d` 都不用** ——
 *    窗外的天不该跟"警告 / 分区 / 拟声字"抢那个颜色；
 *  · **暖黄只给"安全 / 窗内"**：所以它也不用。
 *    剩下的色全部取自分区色板（`data/palette.ts`）那 7 个压过明度与饱和度的印色 ——
 *    它们本来就为"印在纸底上"调过，正是这一层要的质感。
 *
 * ## 覆盖率的账（`palette.test.ts` 钉着）
 *
 * 116 个 key **一个都没有回退到兜底色** —— 兜底存在是为了"将来加灾难时不崩"，
 * 而不是为了"省事"。哪一场漏写，测试会当场报出它的名字。
 */
import type { DisasterProfile } from '../model/types';

/** 一扇窗的配色：天空、地面、以及一条"远处"的中间色（做三道渐变要它） */
export interface WindowTheme {
  /** 天空（上半）：最亮的一道 */
  sky: string;
  /** 远景（中间那道）：地平线附近 */
  far: string;
  /** 地面（下半）：最沉的一道 */
  ground: string;
  /**
   * 这一场窗外**有没有雪 / 灰 / 水汽**这类"飘着的东西"。
   * 界面据此加一层稀疏的斑点（纯 CSS，不用图）。
   */
  fall: 'snow' | 'ash' | 'rain' | 'dust' | 'none';
}

/**
 * 家族 → 底色倾向（7 个家族，取自 `DisasterProfile.family`）。
 *
 * ★ 它只提供**三道渐变的相对关系**（哪一道最亮、哪一道最沉），
 * 具体色值由 `WINDOW_SCENES` 按 key 定 —— 两层叠起来才有"116 场各不相同"的效果。
 */
const FAMILY_TONE: Readonly<Record<string, { sky: string; far: string; ground: string; fall: WindowTheme['fall'] }>> = {
  温度: { sky: '#cfe0ea', far: '#e7eef2', ground: '#d8cdb4', fall: 'none' },
  水: { sky: '#b9cdd8', far: '#cfdde4', ground: '#8fa6ae', fall: 'rain' },
  结构: { sky: '#d5cfc4', far: '#c4bcae', ground: '#9d968a', fall: 'dust' },
  生物: { sky: '#c9d3bd', far: '#dfe3d2', ground: '#8a9280', fall: 'none' },
  社会: { sky: '#c8c6c1', far: '#ddd9d1', ground: '#5b5b57', fall: 'none' },
  空气: { sky: '#c6c3bb', far: '#d9d5cb', ground: '#a39d92', fall: 'ash' },
  组合: { sky: '#bfc4c6', far: '#d4d2cb', ground: '#7d7a75', fall: 'ash' }
};

/**
 * 116 个 `windowScene` key → 这一场窗外的具体脸色。
 *
 * ⚠ **逐 key 手写，不按家族批量生成**：家族色是"这一类"，而玩家要看出来的是
 * "**这一场**" —— 同一个水家族里，洪水是浑黄的、海啸是铅灰的、赤潮是暗红的，
 * 那是三件不同的事，而批量生成只会给它们同一个颜色。
 */
const WINDOW_SCENES: Readonly<Record<string, WindowTheme>> = {
  // ── 温度（25）──
  blizzard: { sky: '#dfe6ec', far: '#f0f2f4', ground: '#cdd5dc', fall: 'snow' },
  'heat-haze': { sky: '#efd9ae', far: '#f2e6c4', ground: '#c9a878', fall: 'none' },
  'ash-dimmed-sky': { sky: '#c1bab0', far: '#d0c9c0', ground: '#7d766c', fall: 'ash' },
  'damp-wall': { sky: '#c4c8bb', far: '#d7dacd', ground: '#82866f', fall: 'rain' },
  'cold-wind-field': { sky: '#ccd8e2', far: '#e2e9ef', ground: '#b8bfc4', fall: 'none' },
  'late-summer-heat': { sky: '#f0d9a8', far: '#f3e3bd', ground: '#c9a978', fall: 'none' },
  'late-frost-window': { sky: '#d7e3ea', far: '#eaf0f3', ground: '#c2c9cc', fall: 'none' },
  'ice-glaze': { sky: '#c9dae6', far: '#e4eef3', ground: '#a8b6bd', fall: 'none' },
  'snow-blocked-door': { sky: '#e3e8ec', far: '#f2f4f5', ground: '#d5dade', fall: 'snow' },
  'thaw-mud': { sky: '#cdd3d2', far: '#ded9cd', ground: '#8a7a63', fall: 'rain' },
  'dry-hot-wind': { sky: '#eeddb4', far: '#e6d3a6', ground: '#c0a173', fall: 'dust' },
  'frozen-pipe': { sky: '#d2dee6', far: '#e8eef2', ground: '#b0b8bd', fall: 'none' },
  'still-heat-haze': { sky: '#f2e2b8', far: '#f4ecd0', ground: '#cbb489', fall: 'none' },
  'cold-drizzle': { sky: '#c3cdd4', far: '#d8dee2', ground: '#9aa3a8', fall: 'rain' },
  'foehn-wall': { sky: '#e6d3c0', far: '#e9dccb', ground: '#b9a48c', fall: 'dust' },
  'deep-freeze-outdoor': { sky: '#c6d6e2', far: '#dfe8ee', ground: '#aab4ba', fall: 'snow' },
  'heat-dome-night': { sky: '#b9a68c', far: '#cbb99c', ground: '#6e6455', fall: 'none' },
  'endless-winter-slide': { sky: '#d3dde6', far: '#e9eef2', ground: '#c6ccd1', fall: 'snow' },
  'vortex-swing': { sky: '#c2d2de', far: '#dee7ed', ground: '#a9b3b9', fall: 'snow' },
  'melting-asphalt': { sky: '#f0d7a4', far: '#ecd9b0', ground: '#6f6a63', fall: 'none' },
  'sinking-ground': { sky: '#cfd2cd', far: '#ded9cd', ground: '#8d8272', fall: 'dust' },
  'hail-crater': { sky: '#c8d4dc', far: '#e0e7eb', ground: '#9ba4a9', fall: 'rain' },
  'supercell-rain': { sky: '#a9b6bf', far: '#c3ccd2', ground: '#7c858a', fall: 'rain' },
  'tornado-path': { sky: '#b0bcc4', far: '#c9d2d8', ground: '#6f7679', fall: 'rain' },
  'no-sun-days': { sky: '#c4c4c0', far: '#d6d5cf', ground: '#8e8d88', fall: 'none' },
  'ice-load-collapse': { sky: '#d5e0e8', far: '#e9eff3', ground: '#b6bec3', fall: 'snow' },
  'thin-air': { sky: '#ccd6df', far: '#e2e9ef', ground: '#a9b2b8', fall: 'none' },
  'cold-dust': { sky: '#d4d0c6', far: '#e3ded2', ground: '#b3ab9c', fall: 'dust' },

  // ── 水（16）──
  'rain-flood': { sky: '#b6c6cf', far: '#cdd8de', ground: '#8a8f7f', fall: 'rain' },
  'dry-tap': { sky: '#e2dcc6', far: '#ece7d6', ground: '#bdae8a', fall: 'none' },
  'river-smell': { sky: '#c6cfc4', far: '#dde2da', ground: '#7f8a7a', fall: 'none' },
  'still-water': { sky: '#c3ccc9', far: '#dbe0dc', ground: '#7d8a85', fall: 'none' },
  'typhoon-edge': { sky: '#a8b4bd', far: '#c2cbd1', ground: '#6f7a80', fall: 'rain' },
  'mud-runoff': { sky: '#c3bcac', far: '#d8cdb8', ground: '#7d6a4e', fall: 'rain' },
  'salt-tide': { sky: '#c0cbc9', far: '#d7dfdc', ground: '#8d9a95', fall: 'none' },
  'release-gate': { sky: '#b9c6cd', far: '#d2dade', ground: '#79848a', fall: 'rain' },
  'dam-lake': { sky: '#c2ccd2', far: '#dae1e5', ground: '#7e8b91', fall: 'none' },
  'main-burst': { sky: '#c9d2d6', far: '#e0e6e9', ground: '#98a2a6', fall: 'rain' },
  'sewer-back': { sky: '#c0c0b4', far: '#d3d1c4', ground: '#6f6e60', fall: 'rain' },
  'ice-jam': { sky: '#d0dce4', far: '#e6edf2', ground: '#a9b4ba', fall: 'snow' },
  'acid-rain': { sky: '#c8cbb8', far: '#dcdcc9', ground: '#8f9179', fall: 'rain' },
  'roof-drip': { sky: '#c5ced3', far: '#dde3e7', ground: '#9aa3a7', fall: 'rain' },
  'tsunami-wall': { sky: '#9aa6ae', far: '#b4bec5', ground: '#5f686d', fall: 'rain' },
  'dam-wall': { sky: '#adb9c0', far: '#c6cfd4', ground: '#6b757a', fall: 'rain' },

  // ── 结构（16）──
  'cracked-wall': { sky: '#d6d0c6', far: '#c8c1b4', ground: '#9c958a', fall: 'dust' },
  'after-shock': { sky: '#d2ccc2', far: '#c6beb1', ground: '#8f887c', fall: 'dust' },
  'blocked-slope': { sky: '#cfc9bd', far: '#c0b8a9', ground: '#7f7768', fall: 'dust' },
  'sealed-district': { sky: '#c9c7c2', far: '#dbd7cf', ground: '#6a6963', fall: 'none' },
  'closed-bridges': { sky: '#c4c9cc', far: '#d6dadc', ground: '#7b8083', fall: 'none' },
  'sunken-subway': { sky: '#b6b4ae', far: '#c8c5be', ground: '#5a5953', fall: 'none' },
  'burning-district': { sky: '#c0ab9c', far: '#cbb9ab', ground: '#6d5b4e', fall: 'ash' },
  'sealed-underground': { sky: '#b3b1ab', far: '#c5c2bb', ground: '#575651', fall: 'none' },
  'settling-belt': { sky: '#d0cbc0', far: '#c3bbae', ground: '#8a8375', fall: 'dust' },
  'tunnel-plug': { sky: '#b9b7b1', far: '#cbc8c1', ground: '#605f5a', fall: 'dust' },
  'no-power-city': { sky: '#a9a8a4', far: '#bcbab5', ground: '#4f4e4a', fall: 'none' },
  'caved-mine-zone': { sky: '#c6c0b4', far: '#b8b0a2', ground: '#776f5f', fall: 'dust' },
  'gas-main-blast': { sky: '#c2b7ab', far: '#cec4b8', ground: '#6f6659', fall: 'ash' },
  'span-roof-collapse': { sky: '#cdc8bf', far: '#bfb8ab', ground: '#87806f', fall: 'dust' },
  'dead-hub': { sky: '#c5c6c3', far: '#d7d8d4', ground: '#73746f', fall: 'none' },
  'no-signal-city': { sky: '#c1c4c6', far: '#d4d7d9', ground: '#6f7376', fall: 'none' },

  // ── 生物（16）──
  'warehouse-rats': { sky: '#c4c6b6', far: '#d8dac9', ground: '#7d8069', fall: 'none' },
  'closed-doors': { sky: '#cdd0c3', far: '#dfe1d5', ground: '#8b8e7d', fall: 'none' },
  'brown-tap': { sky: '#c8c8b4', far: '#dbdac6', ground: '#87866c', fall: 'none' },
  'wasp-city': { sky: '#d3cdb0', far: '#e2ddc6', ground: '#96906f', fall: 'none' },
  'dengue-city': { sky: '#c3cbb8', far: '#d9dfd0', ground: '#7f8873', fall: 'none' },
  'hollow-blocks': { sky: '#c9c6b8', far: '#dcd9cb', ground: '#7e7b6b', fall: 'none' },
  'garbage-city': { sky: '#c0bda9', far: '#d2cebb', ground: '#75715c', fall: 'none' },
  'tick-field': { sky: '#c6ccb4', far: '#dcdfcd', ground: '#818764', fall: 'none' },
  'green-water': { sky: '#bcc9b8', far: '#d5ddcf', ground: '#75846f', fall: 'none' },
  'packaging-fail': { sky: '#c8c4b4', far: '#dad6c6', ground: '#7d7967', fall: 'none' },
  'locust-sky': { sky: '#d6ccae', far: '#ddd4b6', ground: '#93865f', fall: 'dust' },
  'cull-line': { sky: '#c9c4b6', far: '#dbd6c8', ground: '#807b69', fall: 'none' },
  'red-sea': { sky: '#c6b3a8', far: '#d8c6bb', ground: '#7c6257', fall: 'none' },
  'bare-hills': { sky: '#cfcabb', far: '#ded9c9', ground: '#8a836f', fall: 'none' },
  'mold-silo': { sky: '#bfc3b2', far: '#d2d6c4', ground: '#72765f', fall: 'none' },
  'spore-wall': { sky: '#c1c0ae', far: '#d3d2c0', ground: '#74735f', fall: 'ash' },

  // ── 社会（16）──
  'riot-street': { sky: '#c4c0b8', far: '#d5d1c8', ground: '#4f4e4a', fall: 'none' },
  'empty-shelves': { sky: '#cbc7bf', far: '#dcd8d0', ground: '#7a776f', fall: 'none' },
  'rush-hour-shop': { sky: '#d0cabf', far: '#e0dbd1', ground: '#807b70', fall: 'none' },
  'sealed-gate': { sky: '#bdbbb5', far: '#cfccc6', ground: '#5c5b56', fall: 'none' },
  'ration-counter': { sky: '#c9c2b3', far: '#dad4c6', ground: '#7c7666', fall: 'none' },
  'moving-vans': { sky: '#ccc7bd', far: '#dedad1', ground: '#7e7a70', fall: 'none' },
  'piled-trash': { sky: '#c0bcac', far: '#d2cebe', ground: '#6e6a59', fall: 'none' },
  'requisition-notice': { sky: '#c6c1b6', far: '#d8d3c9', ground: '#787369', fall: 'none' },
  'curfew-street': { sky: '#b0aeaa', far: '#c3c1bd', ground: '#4c4b48', fall: 'none' },
  'dead-signal': { sky: '#bcbdba', far: '#cfd0cd', ground: '#63645f', fall: 'none' },
  'back-alley-trade': { sky: '#bdb8ac', far: '#cfcabe', ground: '#5e5a4f', fall: 'none' },
  'packed-shelter': { sky: '#c5bfb2', far: '#d7d1c4', ground: '#75705f', fall: 'none' },
  'ration-gas': { sky: '#c7c1b0', far: '#d9d3c3', ground: '#79735c', fall: 'none' },
  'idle-factory-gate': { sky: '#c2c0b8', far: '#d4d2ca', ground: '#6d6b62', fall: 'none' },
  'no-law-street': { sky: '#b8b6b0', far: '#cbc9c3', ground: '#535250', fall: 'none' },
  'crowded-station': { sky: '#c8c3b8', far: '#dad5cb', ground: '#78736a', fall: 'none' },

  // ── 空气（12）──
  'sand-haze': { sky: '#dfcfa8', far: '#e5d9bb', ground: '#b49b6a', fall: 'dust' },
  'low-fog': { sky: '#d2d2cd', far: '#e0e0dc', ground: '#a3a39d', fall: 'none' },
  'smoke-drift': { sky: '#c5bdb2', far: '#d3ccc2', ground: '#8a8177', fall: 'ash' },
  'chemical-plume': { sky: '#c8c3aa', far: '#d8d4bd', ground: '#8b876c', fall: 'ash' },
  'dust-plume': { sky: '#dcc9a4', far: '#e3d8b8', ground: '#ab9463', fall: 'dust' },
  'acid-haze': { sky: '#c9ccb4', far: '#daddc8', ground: '#8d9074', fall: 'ash' },
  'grey-still': { sky: '#cfcfca', far: '#dedeD9', ground: '#a0a09a', fall: 'none' },
  'sewer-gas': { sky: '#c6c2ac', far: '#d6d2bd', ground: '#84806a', fall: 'none' },
  'ammonia-leak': { sky: '#c4c8bd', far: '#d6dacf', ground: '#82876f', fall: 'none' },
  'coal-smoke': { sky: '#bdb9b1', far: '#cdc9c1', ground: '#7b776f', fall: 'ash' },

  // ── 组合（15）──
  'dark-city': { sky: '#9d9d99', far: '#b0b0ac', ground: '#454543', fall: 'none' },
  'heat-blackout': { sky: '#c2ad92', far: '#cdbba3', ground: '#655c4e', fall: 'none' },
  'flood-outbreak': { sky: '#b4bdba', far: '#cbd2cd', ground: '#6f7a72', fall: 'rain' },
  'quake-fire': { sky: '#bfa899', far: '#cbb6a8', ground: '#6a584b', fall: 'ash' },
  'dust-drought': { sky: '#ddc9a0', far: '#e2d5b4', ground: '#ad9560', fall: 'dust' },
  'blocked-street-riot': { sky: '#c0bcb2', far: '#d2cec4', ground: '#4d4c48', fall: 'none' },
  'typhoon-dry-tap': { sky: '#b0bcc0', far: '#c8d0d2', ground: '#75805f', fall: 'rain' },
  'cold-quarantine': { sky: '#cbd5da', far: '#e0e7ea', ground: '#9aa2a5', fall: 'snow' },
  'flood-riot': { sky: '#b2bab8', far: '#c9cecb', ground: '#5c6159', fall: 'rain' },
  'fire-heat-blackout': { sky: '#c0a48f', far: '#ccb4a2', ground: '#61503f', fall: 'ash' },
  'quake-cold': { sky: '#c8d0d4', far: '#dbdfe2', ground: '#8d8b84', fall: 'snow' },
  'mold-blackout': { sky: '#b6b6ac', far: '#c9c9bf', ground: '#5f5f55', fall: 'ash' },
  'dust-riot': { sky: '#d3c3a2', far: '#dcd0b6', ground: '#5f594c', fall: 'dust' },
  'black-riot': { sky: '#a3a29e', far: '#b7b6b2', ground: '#48474a', fall: 'none' }
};

/** 兜底：认不出的 key（将来加灾难时漏写）→ 按家族给一份中性脸色，绝不崩 */
export function windowThemeOf(disaster: DisasterProfile): WindowTheme {
  const scene = WINDOW_SCENES[disaster.windowScene];
  if (scene) return scene;
  const tone = FAMILY_TONE[disaster.family];
  if (tone) return tone;
  return { sky: '#c9c9c4', far: '#dcdcd7', ground: '#8f8f8a', fall: 'none' };
}

/** 全部写死的 key 数（测试用它核"116 场一个都没漏"） */
export const WINDOW_SCENE_KEYS: readonly string[] = Object.keys(WINDOW_SCENES);

/** 这一场窗外的三道渐变，直接当 CSS 用（界面只拼字符串，不做判断） */
export function windowGradientOf(disaster: DisasterProfile): string {
  const t = windowThemeOf(disaster);
  return `linear-gradient(180deg, ${t.sky} 0%, ${t.far} 58%, ${t.ground} 100%)`;
}

/**
 * ★ 这一场的**代表色**（给日历条、灾难名、日报抬头那一枚小标记用）。
 *
 * 取窗外的**地面**那一色：它是最沉、最有辨识度的一道，
 * 而"每场一个颜色"这件事本身就是玩家要的那个"看起来不一样"。
 *
 * ⚠ 它**不是**朱红（§5A：朱红专指警告 / 分区 / 拟声字）——
 * 所以第 12 步那套"灾难配色"与警告色永远不会撞。
 */
export function disasterTintOf(disaster: DisasterProfile): string {
  return windowThemeOf(disaster).ground;
}
