/**
 * 一次性脚本：**按数据重新生成** `.window-band-fall` 那几组选择器。
 *
 * 起因：`check-style.mjs` 第 ⑨ 条守卫一上线就报出 **21 场**的"飘着的东西"
 * 在 CSS 里没有对应的类 —— 也就是说那几组名单是我**手抄**的，而抄漏了。
 * 手抄的名单一定会漂（这一条是这个项目反复踩的坑），所以改成生成：
 * 从 `windowThemes.ts` 的 `fall` 读真相，写回 `style.css`。
 *
 * 写盘前自查：① 每一组都非空；② 改完之后再数一遍，21 场全都进名单了。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DISASTER_DEFS } from '../src/data/disaster';
import { windowThemeOf } from '../src/data/windowThemes';

const PATH = 'src/style.css';
const SHAPE: Record<string, string> = {
  snow: `  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.85) 1.4px, transparent 1.6px);
  background-size: 26px 17px;`,
  ash: `  background-image: repeating-linear-gradient(
    115deg,
    rgba(255, 255, 255, 0.5) 0 5px,
    transparent 5px 13px
  );`,
  rain: `  background-image: repeating-linear-gradient(
    96deg,
    transparent 0 4px,
    rgba(255, 255, 255, 0.42) 4px 5px,
    transparent 5px 11px
  );`,
  dust: `  background-image: repeating-linear-gradient(
    0deg,
    rgba(255, 255, 255, 0.45) 0 1px,
    transparent 1px 9px
  );`
};

const groups: string[] = [];
for (const kind of ['snow', 'ash', 'rain', 'dust'] as const) {
  const scenes = DISASTER_DEFS.filter((d) => windowThemeOf(d).fall === kind).map((d) => d.windowScene);
  if (scenes.length === 0) {
    console.error(`组 ${kind} 一场都没有 —— 拒绝写盘`);
    process.exit(1);
  }
  const selectors = scenes.map((s) => `.window-band.is-${s} .window-band-fall`).join(',\n');
  groups.push(`${selectors} {\n${SHAPE[kind]}\n}`);
}

const text = readFileSync(PATH, 'utf8');
// 从"飘着的东西"那一组之前、到 .disaster-tag 的注释之前，整段替换
// ⚠ 用正则而不是 indexOf：这个文件在 git 里是 **CRLF**（§3.4 那条老坑），
//   写死 '\n' 的锚点会找不到 —— 第一版就是这么失败的。
const startRe = /\/\*\r?\n \* 四类"飘着的东西"/;
const endRe = /\/\*\r?\n \* ★ 灾难名那一枚小标记/;
const startM = startRe.exec(text);
const endM = endRe.exec(text);
const start = startM?.index ?? -1;
const end = endM?.index ?? -1;
if (start < 0 || end < 0 || end < start) {
  console.error(`找不到要替换的那一段 —— 拒绝写盘（start=${start} end=${end}）`);
  process.exit(1);
}
const header = [
  '/*',
  ' * 四类"飘着的东西"。形状刻意各不相同 —— 那也是"这一场看起来不一样"的一部分：',
  ' * 雪是圆的、灰是斜的、雨是竖的、尘是横的。',
  ' *',
  ' * ★ 这四组名单**由 `scripts/_regen-fall-css.ts` 从 `data/windowThemes.ts` 生成**，',
  ' * 不是手抄的：手抄的名单一定会漂（第一版抄漏了 21 场，而漂了**不会报错** ——',
  ' * 那些场的窗外只是少一层形状）。所以由 `check-style.mjs` 第 ⑨ 条逐场对账。',
  ' */'
].join('\n') + '\n';

const block = `${header}${groups.join('\n\n')}\n`;
const out = text.slice(0, start) + block + text.slice(end);

// 自查：每一场都该在名单里
const missing: string[] = [];
for (const d of DISASTER_DEFS) {
  const kind = windowThemeOf(d).fall;
  if (kind === 'none') continue;
  const re = new RegExp(`\\.window-band\\.is-${d.windowScene.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[\\s,]`);
  if (!re.test(out.slice(start, start + block.length))) missing.push(`${d.name}(${d.windowScene}, ${kind})`);
}
if (missing.length > 0) {
  console.error(`自查失败：仍有 ${missing.length} 场不在名单里：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

writeFileSync(PATH, out, 'utf8');
const counts = (['snow', 'ash', 'rain', 'dust'] as const).map(
  (k) => `${k} ${DISASTER_DEFS.filter((d) => windowThemeOf(d).fall === k).length}`
);
console.log(`写盘完成：${counts.join(' / ')}`);
