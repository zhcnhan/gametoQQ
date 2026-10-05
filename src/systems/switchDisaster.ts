/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  换这一局的灾难（走查用的两条入口）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么它必须是一个**独立模块**（而不是写在 `main.ts` 里的两段）
 *
 * 用户 2026-10 连着报了几轮"切换灾难的指令根本没生效"。查下去发现：
 *
 *  ① 我把它写在 `main.ts` 那个 `if (import.meta.env.DEV)` 块里 ——
 *     于是 `npm run build` 出来的那一份**压根没有它**（"没生效"的第一层）；
 *  ② 而更麻烦的是：**`main.ts` 是测不到的**（它一 import 就装配整个应用、
 *     抓 `#app`、建 store、挂路由）。于是那个函数**一次都没有被测试跑过** ——
 *     它唯一的验收方式是"人工去控制台敲一下然后看屏幕"，而
 *     屏幕上那一条带子当时还被一段坏注释吃掉了（见 `style.css` 的桌面适配注释）。
 *
 * 两件事叠在一起就是"指令报了一句话、页面没有任何变化"。
 *
 * 所以现在：**纯函数住这里**（`systems/` 的写法，可单测），
 * `main.ts` 只负责把它的结果接到 router 与 URL 上。
 *
 * ## 一条刻意的副作用边界
 *
 * 它**重铺货架**（`createStartingShelves`）并清掉当日点位库存 ——
 * 这是"换一场"这件事的必需部分：空间维度（少一块 / 矮一排）只在
 * **开局那一刻**才铺得出来（见 `systems/setup.ts` 的 `createStartingShelves`），
 * 而点位库存的当日价格是按灾难算的（`rollShopStocks`）。
 */
import { DISASTER_DEFS } from '../data/disaster';
import { ROOM_ID } from '../model/shelf';
import type { DisasterProfile, RunState } from '../model/types';
import { createStartingShelves } from './setup';

/** 按 id **或中文名**认一场灾难（认不出返回 null，绝不抛 —— 它跑在控制台里） */
export function findDisasterByName(which: string): DisasterProfile | null {
  const needle = which.trim();
  if (needle.length === 0) return null;
  return DISASTER_DEFS.find((d) => d.id === needle || d.name === needle) ?? null;
}

export interface SwitchResult {
  ok: boolean;
  /** 给控制台看的一句话（认不出时是提示，认得出时是这一场的形状） */
  message: string;
}

/**
 * 把这一局换成 `which` 那一场（`run` 由调用方给的 `mutate` 改，纯逻辑不碰 store）。
 *
 * @param run 当前这一局（会被改）
 * @param which 灾难 id 或中文名
 */
export function switchDisaster(run: RunState, which: string): SwitchResult {
  const def = findDisasterByName(which);
  if (!def) {
    return {
      ok: false,
      message: `没有叫「${which}」的灾难。可以用 id 或中文名（例：热浪 / heat_wave）。`
    };
  }
  run.disasterId = def.id;
  // 重铺货架：空间维度只在开局那一刻铺得出来
  run.shelves = createStartingShelves(ROOM_ID, def.id);
  // 当日点位库存按灾难定价，换一场就得重算（下一次 `ensureDayStocks` 会补齐）
  run.shopStocks = [];
  const rows = run.shelves[0]?.h ?? 0;
  return {
    ok: true,
    message:
      `换成了「${def.name}」：${def.level} · ${def.family} · ` +
      `capacityFactor ${def.capacityFactor ?? 1}、` +
      `unusableShelfIds [${(def.unusableShelfIds ?? []).join(',')}] ` +
      `→ 屋里 ${run.shelves.length} 块、每块 ${rows} 排`
  };
}
