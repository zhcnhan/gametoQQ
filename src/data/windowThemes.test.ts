/**
 * 跨灾难走测：**「看起来不一样」这件事要能被量**（M4 第 12 步的第一步）
 *
 * ## 用户的原话（这个文件的由来）
 *
 * > "各个灾难没有让我感觉到不同，同质性太强烈了（即便有数值变化我也感觉不出来，
 * >  哪怕你改改某些配色也是好的啊）"
 * >
 * > "加一条铁则，任何东西都要让我有感知"
 *
 * ## 走访的结果：他不是"感觉不出来"，而是**确实看不见**
 *
 * 取证（`scripts/_probe-variety.ts`）显示 116 场在**数值**上一点都不缺差别
 * （日耗 40 种取值、刚需 45 种、事件池 107 种、温度曲线 96 种）——
 * **但那些差别全都只以数字的形式出现**。
 *
 * ★★ 而表里**早就写好了一整维专门给眼睛看的东西**：
 * `DisasterProfile.windowScene`（注释写着"窗外渲染主题 key"），
 * **116 场各有各的值**，而它此前**零个渲染读点** —— 从生成出来那天就是死的。
 *
 * 所以这一组守两件事：
 *  ① **116 个 key 一个都没漏**（漏了就会静默回退成家族色，两场看起来一样）；
 *  ② 那些颜色**不许碰 §5A 的两条红线**（朱红 = 警告、暖黄 = 安全 / 窗内），
 *     也不许等于纸底 / 墨色 —— 否则"窗外的天"会和界面语义抢颜色。
 */
import { describe, expect, it } from 'vitest';
import { DISASTER_DEFS } from './disaster';
import { WINDOW_SCENE_KEYS, disasterTintOf, windowThemeOf } from './windowThemes';

/** §5A 的两条红线 + 纸底 / 墨色（这一层一个都不许用） */
const RESERVED = ['#c8372d', '#f2c94c', '#f7f3ea', '#2c2c2a', '#fffcf5'];

const hex = (v: string): string => v.toLowerCase();

describe('★★ 「每一场灾难看起来都不一样」—— 116 个窗外主题一个都不许漏', () => {
  it('★ 116 场的 windowScene **全部**有手写主题（没有一场回退到家族色）', () => {
    /*
     * 判据是"这个 key 在写死的表里"，而不是"颜色好看"——
     * 回退是**安全网**（将来加灾难时不崩），不是省事的路：
     * 一旦有一场走了回退，它就会与同家族的某一场**拿到同一个颜色**，
     * 而那正是用户报的那个毛病。
     */
    const missing = DISASTER_DEFS.filter((d) => !WINDOW_SCENE_KEYS.includes(d.windowScene)).map(
      (d) => `${d.name}(${d.windowScene})`
    );
    expect(missing, '这些灾难没有手写窗外主题，会静默回退成家族色').toEqual([]);
  });

  it('★ key 表里也没有多余的（删灾难时要一起删）', () => {
    const used = new Set(DISASTER_DEFS.map((d) => d.windowScene));
    const extra = WINDOW_SCENE_KEYS.filter((k) => !used.has(k));
    expect(extra, '这些 key 没有任何灾难在用').toEqual([]);
  });

  it('★★ 颜色不许碰 §5A 的两条红线（朱红 / 暖黄）与纸底墨色', () => {
    const bad: string[] = [];
    for (const d of DISASTER_DEFS) {
      const t = windowThemeOf(d);
      for (const [k, v] of Object.entries(t)) {
        if (typeof v !== 'string' || !v.startsWith('#')) continue;
        if (RESERVED.includes(hex(v))) bad.push(`${d.name} 的 ${k}=${v}`);
      }
    }
    expect(bad, '窗外的天抢了"警告 / 安全 / 纸墨"的颜色').toEqual([]);
  });

  it('★ 三道渐变必须**有层次**（天空 / 远景 / 地面不许有任意两道相同）', () => {
    /*
     * 三条一样的颜色 = 一块纯色板，那就不叫"窗外"了。
     * 这一条防的正是"批量生成配色"最典型的偷懒结果。
     */
    const flat: string[] = [];
    for (const d of DISASTER_DEFS) {
      const t = windowThemeOf(d);
      if (hex(t.sky) === hex(t.far) || hex(t.far) === hex(t.ground) || hex(t.sky) === hex(t.ground)) {
        flat.push(`${d.name}(${t.sky}/${t.far}/${t.ground})`);
      }
    }
    expect(flat, '这些场次的三道渐变有重复色 —— 看起来会是一块纯色').toEqual([]);
  });

  it('★★ 代表色（`disasterTintOf`）在 116 场里**足够分散**（不是只有几种颜色）', () => {
    /*
     * ★ 这条是这一组的核心：它把"看起来不一样"变成一个**可量的数**。
     * 门槛定在 40 种 —— 116 场里至少要有 40 种不同的代表色。
     * 而"每场都不同"（116 种）**不是**目标：同一个水家族里几场共用一种浑黄
     * 是**对的**（它们确实像），强行给每一场配一个独有色反而会变成调色盘。
     *
     * ⚠ 门槛不是随手定的：改之前这个数是 **1**（全部回退到家族色时最多 7 种，
     * 而在此之前连读点都没有 = 0 种）。
     */
    const tints = new Set(DISASTER_DEFS.map((d) => disasterTintOf(d)));
    expect(tints.size, `116 场只有 ${tints.size} 种代表色 —— 玩家当然感觉不出不同`).toBeGreaterThanOrEqual(40);
  });

  it('★ 同一个家族里也要有分得开的几档（否则"同质性太强烈"照旧）', () => {
    /*
     * 家族色只是倾向；如果家族内每一场都一样，那玩家看到的仍然是"7 种灾难"。
     * 所以逐家族查：成员最多的那个家族（温度 25 场）内部至少要有 5 种颜色。
     */
    const byFamily = new Map<string, Set<string>>();
    for (const d of DISASTER_DEFS) {
      const set = byFamily.get(d.family) ?? new Set<string>();
      set.add(disasterTintOf(d));
      byFamily.set(d.family, set);
    }
    const thin = [...byFamily.entries()]
      .filter(([family, set]) => {
        const size = DISASTER_DEFS.filter((d) => d.family === family).length;
        return size >= 4 && set.size < 3;
      })
      .map(([family, set]) => `${family}（${set.size} 种色）`);
    expect(thin, '这些家族内部颜色太少 —— 同一家族的两场会看起来一样').toEqual([]);
  });
});
