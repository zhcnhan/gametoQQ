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
  blizzard: { sky: '#dae6f1', far: '#c3d2e1', ground: '#6794bc', fall: 'snow' },
  'heat-haze': { sky: '#e5d6b8', far: '#e3d7b4', ground: '#b48643', fall: 'none' },
  'ash-dimmed-sky': { sky: '#cbbca6', far: '#d8c8b3', ground: '#7a6c58', fall: 'ash' },
  'damp-wall': { sky: '#c7d0b3', far: '#d3dbb7', ground: '#7a8255', fall: 'rain' },
  'cold-wind-field': { sky: '#c5d9e9', far: '#bad1e5', ground: '#708ca0', fall: 'none' },
  'late-summer-heat': { sky: '#e3d4b5', far: '#e3d4b2', ground: '#b48743', fall: 'none' },
  'late-frost-window': { sky: '#d2e4ef', far: '#bcd8e6', ground: '#7595a2', fall: 'none' },
  'ice-glaze': { sky: '#c5dbea', far: '#bbd8e6', ground: '#5e90a8', fall: 'none' },
  'snow-blocked-door': { sky: '#dee9f1', far: '#c6d7df', ground: '#7797b0', fall: 'snow' },
  'thaw-mud': { sky: '#c8d8d5', far: '#e2d4b2', ground: '#907144', fall: 'rain' },
  'dry-hot-wind': { sky: '#e6dabc', far: '#e0d0aa', ground: '#b08341', fall: 'dust' },
  'frozen-pipe': { sky: '#ccdfec', far: '#bcd5e6', ground: '#6d8a9d', fall: 'none' },
  'still-heat-haze': { sky: '#e8dec2', far: '#e4dab7', ground: '#ba9145', fall: 'none' },
  'cold-drizzle': { sky: '#b9cfde', far: '#bccfdc', ground: '#678290', fall: 'rain' },
  'foehn-wall': { sky: '#e7d3bf', far: '#e3ceb3', ground: '#b68043', fall: 'dust' },
  'deep-freeze-outdoor': { sky: '#c0d7e8', far: '#b9d3e5', ground: '#668a9f', fall: 'snow' },
  'heat-dome-night': { sky: '#cda978', far: '#ddc6a2', ground: '#7c6746', fall: 'none' },
  'endless-winter-slide': { sky: '#cdddec', far: '#bcd3e6', ground: '#7390a8', fall: 'snow' },
  'vortex-swing': { sky: '#bad3e6', far: '#b8d3e5', ground: '#66899f', fall: 'snow' },
  'melting-asphalt': { sky: '#e2d2b2', far: '#e1d1ae', ground: '#746754', fall: 'none' },
  'sinking-ground': { sky: '#ced7c8', far: '#e2d4b2', ground: '#877254', fall: 'dust' },
  'hail-crater': { sky: '#bdd6e7', far: '#b8d5e5', ground: '#688291', fall: 'rain' },
  'supercell-rain': { sky: '#9cb8cc', far: '#b5cad8', ground: '#5d7481', fall: 'rain' },
  'tornado-path': { sky: '#a4bed0', far: '#b5ccdc', ground: '#58707a', fall: 'rain' },
  'no-sun-days': { sky: '#ccccb8', far: '#d2d0bf', ground: '#857f60', fall: 'none' },
  'ice-load-collapse': { sky: '#d0e1ed', far: '#bcd5e6', ground: '#6e8da1', fall: 'snow' },
  'thin-air': { sky: '#c2d7e9', far: '#bad1e5', ground: '#68879c', fall: 'none' },
  'cold-dust': { sky: '#dcd4be', far: '#e3d5b3', ground: '#a38a5a', fall: 'dust' },

  // ── 水（16）──
  'rain-flood': { sky: '#a7cade', far: '#b2d1e2', ground: '#78835f', fall: 'rain' },
  'dry-tap': { sky: '#e8dfc0', far: '#e4dab6', ground: '#b69443', fall: 'none' },
  'river-smell': { sky: '#c2d6bd', far: '#c9dabf', ground: '#68805d', fall: 'none' },
  'still-water': { sky: '#bed1cb', far: '#c4d4c7', ground: '#5e8173', fall: 'none' },
  'typhoon-edge': { sky: '#9bb6ca', far: '#b5cad8', ground: '#596f7b', fall: 'rain' },
  'mud-runoff': { sky: '#d1c19e', far: '#e0ceab', ground: '#906b35', fall: 'rain' },
  'salt-tide': { sky: '#b9d2cd', far: '#bfd8cf', ground: '#63897a', fall: 'none' },
  'release-gate': { sky: '#adcad9', far: '#b9d0dc', ground: '#5d7480', fall: 'rain' },
  'dam-lake': { sky: '#b8cedc', far: '#b9d2e0', ground: '#5d7885', fall: 'none' },
  'main-burst': { sky: '#c1d5de', far: '#bcd4e0', ground: '#67838f', fall: 'rain' },
  'sewer-back': { sky: '#c7c7ad', far: '#d9d4b5', ground: '#747154', fall: 'rain' },
  'ice-jam': { sky: '#c9ddeb', far: '#bbd4e6', ground: '#658ba1', fall: 'snow' },
  'acid-rain': { sky: '#d0d6ad', far: '#e2e2b0', ground: '#848858', fall: 'rain' },
  'roof-drip': { sky: '#bdd0db', far: '#bbd1e0', ground: '#68838f', fall: 'rain' },
  'tsunami-wall': { sky: '#8ea8ba', far: '#b1c5d3', ground: '#536773', fall: 'rain' },
  'dam-wall': { sky: '#a2bccb', far: '#b6ccd8', ground: '#586e79', fall: 'rain' },

  // ── 结构（16）──
  'cracked-wall': { sky: '#e0d2bc', far: '#d7c9ae', ground: '#8b7b60', fall: 'dust' },
  'after-shock': { sky: '#dcceb8', far: '#d7c7ad', ground: '#83755d', fall: 'dust' },
  'blocked-slope': { sky: '#dacdb2', far: '#d5c6aa', ground: '#807052', fall: 'dust' },
  'sealed-district': { sky: '#cfc9bc', far: '#dacfb9', ground: '#736e53', fall: 'none' },
  'closed-bridges': { sky: '#bfcad1', far: '#c2ced4', ground: '#5c727f', fall: 'none' },
  'sunken-subway': { sky: '#beb8a6', far: '#cfc9b9', ground: '#6b674e', fall: 'none' },
  'burning-district': { sky: '#d3a889', far: '#debea6', ground: '#825a3d', fall: 'ash' },
  'sealed-underground': { sky: '#bcb5a2', far: '#cec7b9', ground: '#6a654d', fall: 'none' },
  'settling-belt': { sky: '#dacfb6', far: '#d5c6ad', ground: '#82745a', fall: 'dust' },
  'tunnel-plug': { sky: '#c1bba9', far: '#d0caba', ground: '#6e6950', fall: 'dust' },
  'no-power-city': { sky: '#b5af98', far: '#cbc5b7', ground: '#66614a', fall: 'none' },
  'caved-mine-zone': { sky: '#d1c4a9', far: '#d1c3aa', ground: '#7e6d4c', fall: 'dust' },
  'gas-main-blast': { sky: '#d0b89d', far: '#dcc6ac', ground: '#7a664a', fall: 'ash' },
  'span-roof-collapse': { sky: '#d5cab7', far: '#d3c6ad', ground: '#837555', fall: 'dust' },
  'dead-hub': { sky: '#c8cebb', far: '#ced2c1', ground: '#727857', fall: 'none' },
  'no-signal-city': { sky: '#bac5cd', far: '#c2ccd3', ground: '#586b79', fall: 'none' },

  // ── 生物（16）──
  'warehouse-rats': { sky: '#cbd0ac', far: '#dadfb2', ground: '#7a8052', fall: 'none' },
  'closed-doors': { sky: '#d1d8bb', far: '#d8deb8', ground: '#7c825e', fall: 'none' },
  'brown-tap': { sky: '#d4d4a8', far: '#e1dfaf', ground: '#858351', fall: 'none' },
  'wasp-city': { sky: '#ded4a5', far: '#e2d9b1', ground: '#958949', fall: 'none' },
  'dengue-city': { sky: '#c5d6ad', far: '#cfe0b4', ground: '#708159', fall: 'none' },
  'hollow-blocks': { sky: '#d3cdae', far: '#e0d8b2', ground: '#7c7656', fall: 'none' },
  'garbage-city': { sky: '#cec79b', far: '#dfd6ab', ground: '#7e764a', fall: 'none' },
  'tick-field': { sky: '#cddaa6', far: '#dae2b1', ground: '#808c47', fall: 'none' },
  'green-water': { sky: '#b7d3ae', far: '#c7deb6', ground: '#627f57', fall: 'none' },
  'packaging-fail': { sky: '#d4cba8', far: '#e1d7af', ground: '#7e7652', fall: 'none' },
  'locust-sky': { sky: '#ded0a6', far: '#e0d4ac', ground: '#9c843a', fall: 'dust' },
  'cull-line': { sky: '#d4c9ab', far: '#e2d4b0', ground: '#807652', fall: 'none' },
  'red-sea': { sky: '#d8ae96', far: '#e0c0ac', ground: '#8b553e', fall: 'none' },
  'bare-hills': { sky: '#dbd0af', far: '#e2d6b0', ground: '#867953', fall: 'none' },
  'mold-silo': { sky: '#c4cda8', far: '#d3ddb1', ground: '#747d4d', fall: 'none' },
  'spore-wall': { sky: '#cccaa3', far: '#dcdab0', ground: '#7a784e', fall: 'ash' },

  // ── 社会（16）──
  'riot-street': { sky: '#cbc2b1', far: '#d8ceb7', ground: '#66624a', fall: 'none' },
  'empty-shelves': { sky: '#d2c9b8', far: '#dbd0b9', ground: '#7a7158', fall: 'none' },
  'rush-hour-shop': { sky: '#dacdb5', far: '#e1d2b4', ground: '#7c7159', fall: 'none' },
  'sealed-gate': { sky: '#c4bfae', far: '#d1cabc', ground: '#6c674f', fall: 'none' },
  'ration-counter': { sky: '#d6c7a6', far: '#e1d2af', ground: '#7e7251', fall: 'none' },
  'moving-vans': { sky: '#d5cab4', far: '#ddd2b7', ground: '#7b7159', fall: 'none' },
  'piled-trash': { sky: '#ccc3a0', far: '#ddd3af', ground: '#79704b', fall: 'none' },
  'requisition-notice': { sky: '#d0c5ac', far: '#dccfb5', ground: '#786d57', fall: 'none' },
  'curfew-street': { sky: '#bab1a0', far: '#cdc6ba', ground: '#655e49', fall: 'none' },
  'dead-signal': { sky: '#bfc6b1', far: '#cbd1bf', ground: '#6a7152', fall: 'none' },
  'back-alley-trade': { sky: '#c7bca2', far: '#d8cdb2', ground: '#6e654b', fall: 'none' },
  'packed-shelter': { sky: '#d0c3a7', far: '#dfd0b0', ground: '#7c714e', fall: 'none' },
  'ration-gas': { sky: '#d5c8a2', far: '#e1d3ae', ground: '#837747', fall: 'none' },
  'idle-factory-gate': { sky: '#c8c4b2', far: '#d4cfbb', ground: '#746e54', fall: 'none' },
  'no-law-street': { sky: '#c0baa8', far: '#cfcabc', ground: '#695f4c', fall: 'none' },
  'crowded-station': { sky: '#d2c7ae', far: '#ddd0b5', ground: '#786c57', fall: 'none' },

  // ── 空气（12）──
  'sand-haze': { sky: '#dfcfa8', far: '#e1d3af', ground: '#aa853f', fall: 'dust' },
  'low-fog': { sky: '#d7d7c8', far: '#d4d4c4', ground: '#8f8f68', fall: 'none' },
  'smoke-drift': { sky: '#d0bfa7', far: '#dbcab2', ground: '#806f5c', fall: 'ash' },
  'chemical-plume': { sky: '#d9ce99', far: '#e0d9ac', ground: '#8a824e', fall: 'ash' },
  'dust-plume': { sky: '#ddc9a3', far: '#e1d4ae', ground: '#a5843d', fall: 'dust' },
  'acid-haze': { sky: '#d4daa6', far: '#dbe2b0', ground: '#848a53', fall: 'ash' },
  'grey-still': { sky: '#d5d5c4', far: '#d4d4c3', ground: '#8e8e67', fall: 'none' },
  'sewer-gas': { sky: '#d6cd9c', far: '#e0d8ac', ground: '#847c51', fall: 'none' },
  'ammonia-leak': { sky: '#c6cfb6', far: '#ced9ba', ground: '#798355', fall: 'none' },
  'coal-smoke': { sky: '#c4bbaa', far: '#d3cab8', ground: '#7a6f58', fall: 'ash' },

  // ── 组合（15）──
  'dark-city': { sky: '#abab8b', far: '#c8c8b3', ground: '#626247', fall: 'none' },
  'heat-blackout': { sky: '#d1af83', far: '#ddc5a4', ground: '#786343', fall: 'none' },
  'flood-outbreak': { sky: '#adc4bc', far: '#bfd1c4', ground: '#587a61', fall: 'rain' },
  'quake-fire': { sky: '#d2a486', far: '#debca5', ground: '#82583b', fall: 'ash' },
  'dust-drought': { sky: '#dcc9a1', far: '#e1d2ad', ground: '#a4843d', fall: 'dust' },
  'blocked-street-riot': { sky: '#c8c0aa', far: '#d7ceb6', ground: '#656049', fall: 'none' },
  'typhoon-dry-tap': { sky: '#a6c1ca', far: '#bbcfd3', ground: '#728845', fall: 'rain' },
  'cold-quarantine': { sky: '#c2d8e3', far: '#bad7e3', ground: '#67848f', fall: 'snow' },
  'flood-riot': { sky: '#aac2bc', far: '#bed0c5', ground: '#5b6e50', fall: 'rain' },
  'fire-heat-blackout': { sky: '#d0a27f', far: '#ddbca4', ground: '#835a30', fall: 'ash' },
  'quake-cold': { sky: '#c1d2db', far: '#c0ced8', ground: '#847c5f', fall: 'snow' },
  'mold-blackout': { sky: '#bdbda5', far: '#cfcfba', ground: '#6d6d4f', fall: 'ash' },
  'dust-riot': { sky: '#dac59b', far: '#e0d0ac', ground: '#736446', fall: 'dust' },
  'black-riot': { sky: '#b0aa91', far: '#cac6b6', ground: '#524964', fall: 'none' }
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
