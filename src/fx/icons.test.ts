/**
 * 图标的守护测试。
 *
 * 图标这件事有两个**构建期与类型期都发现不了**的坏法，只能靠测试盯：
 *
 *  1. 物资表里 `icon` 打错一个字母 → 屏幕上那块是**空白**（`iconSvg` 返回空串），
 *     而 `icon` 是 `string`，类型检查不会报；
 *  2. 两件物资**画得一模一样** —— 原来"可可粉铁罐"借用 `can`、
 *     "一条烟"与"一本画册"都借用 `toolbox`，于是它们和黄豆罐头在界面上无法分辨。
 *     图鉴里这是致命的：玩家分不出自己点亮的是哪一件。
 */
import { describe, expect, it } from 'vitest';
import { ITEM_DEFS } from '../data/items';
import { ITEM_ICON_KEYS, hasIcon, itemIconSvg } from './icons';

describe('物资图标', () => {
  it('★ 物资表里的每个 icon 键都真的画出来了（打错字母 = 屏幕上空白）', () => {
    const missing = ITEM_DEFS.filter((d) => !hasIcon(d.icon)).map((d) => `${d.id} → ${d.icon}`);
    expect(missing).toEqual([]);
  });

  it('★ 每个物资都有自己独立的图标键（不许两件货长得一样）', () => {
    const byIcon = new Map<string, string[]>();
    for (const def of ITEM_DEFS) {
      const list = byIcon.get(def.icon) ?? [];
      list.push(def.name);
      byIcon.set(def.icon, list);
    }
    const shared = [...byIcon.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([icon, names]) => `${icon} 被 ${names.length} 件货共用：${names.join(' / ')}`);
    expect(shared).toEqual([]);
  });

  it('渲染出来的是真 SVG，而且带得动"淡影填充"（§5A 的厚度）', () => {
    const svg = itemIconSvg('can');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
    // 至少有一半图标用了 fill-opacity 那层淡影 —— 那是这一版"看起来厚"的来源
    const filled = ITEM_ICON_KEYS.filter((key) => itemIconSvg(key).includes('fill-opacity'));
    expect(filled.length).toBeGreaterThan(ITEM_ICON_KEYS.length / 2);
  });

  it('认不出的键返回空串，而不是抛异常（手改过的档不能让界面崩）', () => {
    expect(itemIconSvg('这个键不存在')).toBe('');
  });
});

