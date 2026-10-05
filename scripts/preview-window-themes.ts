/**
 * 一次性脚本：生成一份**可以双击打开的预览页** —— 116 场灾难各长什么样。
 *
 * ## 为什么是"生成一个 HTML"而不是起一个服务
 *
 * 用户要判断的是"**每一场看起来一不一样**"，而那是一件纯视觉的事：
 * 它不需要跑游戏、不需要点任何东西，只需要**一次看全**。
 * 所以这里把 `src/data/windowThemes.ts` 的结果导成一张静态页：
 * 每一场一格，背景就是它窗外的三道渐变，配上灾难名与家族 / 层级 / 空间代价。
 *
 * 它放在 `dist/`（构建产物目录，已在 .gitignore 里）—— 不是源码的一部分，
 * 而是"看一眼"的工具。
 *
 * 用法：`npx vite-node scripts/preview-window-themes.ts` → 打开 `dist/window-themes.html`
 */
import { writeFileSync } from 'node:fs';
import { DISASTER_DEFS, disasterModifiersOf } from '../src/data/disaster';
import { disasterTintOf, windowThemeOf } from '../src/data/windowThemes';

const FALL_MARK: Record<string, string> = {
  snow: '❄',
  ash: '░',
  rain: '│',
  dust: '∴',
  none: ''
};

const cards = DISASTER_DEFS.map((d) => {
  const t = windowThemeOf(d);
  const mods = disasterModifiersOf(d.id);
  const costs: string[] = [];
  if (mods.capacityFactor !== 1) costs.push(`空间 ×${mods.capacityFactor}`);
  if (mods.unusableShelfIds.length > 0) costs.push(`少 ${mods.unusableShelfIds.length} 块`);
  if (mods.actionPointDelta !== 0) costs.push(`行动点 ${mods.actionPointDelta}`);
  if (mods.carryFactor !== 1) costs.push(`搬运 ×${mods.carryFactor}`);
  const drain = Object.entries(d.dailyDrain ?? {})
    .map(([c, n]) => `${c}${n}`)
    .join(' ');
  return `
    <figure class="card">
      <div class="sky" style="background:linear-gradient(180deg, ${t.sky} 0%, ${t.far} 58%, ${t.ground} 100%)">
        <span class="fall">${FALL_MARK[t.fall] ?? ''}</span>
        <span class="tint" style="background:${disasterTintOf(d)}"></span>
      </div>
      <figcaption>
        <b>${d.name}</b>
        <em>${d.family} · ${d.level} · tier${d.tier}</em>
        <span class="meta">日耗 ${drain || '—'}</span>
        <span class="meta">${costs.join(' · ') || '无空间代价'}</span>
      </figcaption>
    </figure>`;
}).join('');


/**
 * 页面骨架。
 *
 * ⚠ **刻意不写成一个大模板字面量**：里面要嵌的说明文字自带反引号，
 * 一层模板套一层模板会让 esbuild 在编译期就报 `Expected ";" but found "data"`
 * （我第一版正是那么写的，而且报错指向一个与真正原因无关的位置 ——
 * 与纪律 §3.4「不要用 shell 拼多行字符串」是同一类坑）。
 * 所以用数组 + join，每一段都是独立的普通字符串。
 */
const PAGE_STYLE = [
  ':root { --paper:#f7f3ea; --ink:#2c2c2a; --card:#fffcf5; --vermilion:#c8372d; }',
  '* { box-sizing: border-box; }',
  'body { margin:0; padding:20px; background:var(--paper); color:var(--ink);',
  '  font:14px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }',
  'h1 { font-size:20px; margin:0 0 4px; }',
  'p.note { margin:0 0 18px; color:rgba(44,44,42,.7); font-size:13px; }',
  '.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(170px,1fr)); gap:10px; }',
  '.card { margin:0; border:1.5px solid rgba(44,44,42,.16); border-radius:8px; overflow:hidden; background:var(--card); }',
  '.sky { position:relative; height:74px; }',
  '.fall { position:absolute; inset:0; display:grid; place-items:center; font-size:26px; color:rgba(255,255,255,.5); }',
  '.tint { position:absolute; left:8px; bottom:-7px; width:14px; height:14px; border-radius:50%; border:2px solid var(--card); }',
  'figcaption { display:flex; flex-direction:column; gap:1px; padding:10px 10px 9px; }',
  'figcaption b { font-size:14px; }',
  'figcaption em { font-style:normal; font-size:11px; color:rgba(44,44,42,.7); }',
  'figcaption .meta { font-size:10.5px; color:rgba(44,44,42,.55); }',
  '.count { color:var(--vermilion); }'
  ].join('\n');

const NOTE = [
  '每格的上半是它窗外的三道渐变（src/data/windowThemes.ts），左下角那个圆点是这一场的代表色',
  '（给日历条 / 灾难名用）。下面两行是这一场的日耗与空间代价 ——',
  '配色要回答"看起来不一样"，这两行回答"玩起来不一样"，两件事都得有。',
  '共 <span class="count">' + DISASTER_DEFS.length + '</span> 场。'
  ].join(' ');

const html = [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '<meta charset="utf-8">',
  '<title>116 场灾难 · 窗外配色预览</title>',
  '<style>' + PAGE_STYLE + '</style>',
  '<h1>116 场灾难 · 窗外配色预览</h1>',
  '<p class="note">' + NOTE + '</p>',
  '<div class="grid">' + cards + '</div>',
  '</html>'
  ].join('\n');

writeFileSync('dist/window-themes.html', html, 'utf8');
console.log('写好 dist/window-themes.html（' + DISASTER_DEFS.length + ' 场）—— 双击打开即可');