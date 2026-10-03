/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  内容入库：把 `content/**\/*.json`（AI 批量生成物）转成 `src/data/**` 的 TS 表
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它在 §10B.7 那条流水线里的位置
 *
 * ```
 * ① 起草提示词（人写一次，之后复用）
 * ② AI 批量产出（只出数据，不出代码）
 * ③ scripts/check-content.mjs 静态校验    → id 重复 / 字段缺失 / 引用悬空 / 数值离群
 * ④ 语义校验（vitest）
 * ⑤ 探针（好档 / 乱档 / 补救）
 * ⑥ 人工过一遍文案
 * ⑦ ★ 本脚本：入库（JSON → TS）          ← 这一步
 * ```
 *
 * ## 为什么走"JSON → 生成 TS"而不是"运行期读 JSON"
 *
 *  1. **类型安全**：TS 表与 `model/types.ts` 是编译期对上的。
 *     运行期读 JSON 的话，一个打错的字段名要等玩家碰到那一格才发现；
 *  2. **零运行时成本**：内容直接进 bundle，不需要 fetch、不需要异步加载态。
 *     这在本项目尤其重要 —— §4A 要求"随时被叫走、回来接着玩"，
 *     多一个"内容还在下载"的状态就多一处会卡住的地方；
 *  3. **生成物可读**：`src/data/items.ts` 里能直接看到全部 57 件物资，
 *     而不是"表里 17 件 + 某个 JSON 里 40 件"（后者会让人改错地方）。
 *
 * ## 它**不做**的事（都在别的脚本里，别在这里重复实现）
 *
 *  · 不校验内容 —— 那是 `check-content.mjs` 的活。本脚本只做机械转换，
 *    它假设输入已经过了校验；把校验混进来会让"哪一步拦住了什么"变得说不清；
 *  · 不写 `data/registry.ts` —— 注册表是**手写**的（它要声明每张表怎么读字段），
 *    本脚本只往它汇总的那几张表里填内容。
 *
 * ## 用法
 *
 *     node scripts/merge-content.mjs            # 全部批次
 *     node scripts/merge-content.mjs item-01    # 只处理某批
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const contentDir = join(root, 'content');

// ——————————————————————————————————————————————————————————————
// 1. 每种内容的字段白名单
// ——————————————————————————————————————————————————————————————

/**
 * ★ **白名单而不是黑名单**，而且这件事有具体理由：
 *
 * 生成物里带着几个**给人看、不该进代码**的字段 —— `decision`（"它逼玩家做什么决定"）、
 * `note` / `notes`、`batchNote`。它们的存在是 §10B.6 的验收要求
 * （"同一类取舍不许超过 5 条"，归类数一遍需要那句话），所以**不能删**，
 * 但它们也不该悄悄漏进类型里变成"看起来是玩法字段"的东西。
 *
 * 白名单的另一个好处：生成模型多写了一个字段时，它会**在这里显形**
 * （见下面的 `dropped` 报告），而不是无声无息地被 Ts 类型忽略 ——
 * 本项目吃过"写了但没生效"的亏太多次了。
 */
const FIELDS = {
  item: ['id', 'name', 'category', 'icon', 'unitWeight', 'slotSize', 'stackLimit', 'perishable', 'shelfLifeDays', 'nutrition', 'basePrice', 'tags', 'tier', 'decision', 'note'],
  identity: ['id', 'name', 'tagline', 'startCash', 'vehicleCapacity', 'carryLimit', 'perk', 'perkRule', 'tier', 'decision'],
  nightEvent: ['id', 'text', 'options', 'tier', 'decision'],
  dayEvent: ['id', 'text', 'onlyShops', 'tags', 'options', 'tier', 'decision'],
  emergency: ['id', 'text', 'category', 'needOnHandy', 'lost', 'consumes', 'tier', 'decision'],
  helpRequest: ['id', 'npcId', 'text', 'demands', 'trustGain', 'trustLoss', 'thanks', 'tier', 'decision'],
  disaster: ['id', 'name', 'family', 'level', 'tier', 'axis', 'temperatures', 'spoilRate', 'dailyDrain', 'priorityCategories', 'windowScene', 'shelterDecayPerDay', 'restEfficiency', 'carryFactor', 'actionPointDelta', 'shopSupplyFactor', 'closedShopIds', 'priceSurcharge', 'eventPoolWeights', 'npcVisitFactor', 'categoryEfficiency', 'capacityFactor', 'unusableShelfIds', 'healthRiskPerDay', 'scoreWeights', 'specialMechanics', 'calendar', 'counterIntuitive', 'decisions', 'notes'],
  shop: ['id', 'name', 'blurb', 'priceFactor', 'actionCost', 'offers', 'specialty', 'tier', 'decision']
};

/**
 * **选项层**的字段白名单（夜间 / 白天事件）。
 *
 * ★ 必须单独列一份，因为选项与事件本身的字段是两套东西：
 * 事件有 `text`，选项有 `label` / `outcome`；而 `requireFullCash` 属于**选项**。
 * 混成一份白名单的话，"生成模型把 `requireFullCash` 写进了 `effect`"
 * 这种事就会被当成"一个不认识的字段"丢掉 —— 而丢掉它不会报错，
 * 只会让那条选项的"买不起就置灰"静默失效（见 `fixPlacement`）。
 */
const OPTION_FIELDS = ['label', 'outcome', 'effect', 'requireFullCash'];

/**
 * 选项**效果**里的字段白名单。
 *
 * ★ 这份清单原先不存在，后果是一个**真 bug**：`fixPlacement` 把
 * `requireFullCash` 从 `effect` 搬到选项层之后，选项层那个键紧接着被
 * "只保留 `OPTION_FIELDS`"的过滤**丢掉了** —— 搬是搬了，落地时又扔了，
 * 于是 19 处"买不起就置灰"照样失效。抓到它的是一条内容纪律测试
 * （"每条事件都得有一条不花钱也能选的路"报了 4 条全要花钱的事件）。
 *
 * 教训与开发纪律 §2.2 那条同源：**"改了"不等于"生效了"**。
 * 一次转换里"搬动"和"保留"是两步，两步都要显式写出来。
 */
const EFFECT_FIELDS = [
  'cash', 'priceUp', 'stockCut', 'limit', 'grab', 'boxDefId',
  'stamina', 'mood', 'health', 'shelter', 'visitLost'
];

// ——————————————————————————————————————————————————————————————
// 2. 把一条内容渲染成 TS 源码
// ——————————————————————————————————————————————————————————————

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 给一段已经缩进好的多行代码整体再加一层缩进（包进 `{ weight, def }` 时要用） */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

/**
 * 修正生成物里**放错层级**的字段。
 *
 * ## `requireFullCash` 必须搬到选项层（这是一个真 bug，不是格式洁癖）
 *
 * 提示词把 `requireFullCash` 列在"`effect` 可用字段"那张表里，
 * 于是生成模型老老实实把它写进了 `effect`：
 *
 * ```ts
 * { label: '开门看看', outcome: '…{spentCash}。', effect: { cash: -60, requireFullCash: true } }
 * ```
 *
 * 而代码里读的是 **选项层**的 `option.requireFullCash`
 * （`ui/NightScreen.ts:127`、`systems/phases.ts:216`、`ui/ShopScreen.ts:165`、`systems/shop.ts:726`）。
 * 写在 `effect` 里 = **这一条静默失效**：本来就该置灰的"买不起"按钮
 * 会照常可点，点完变成"有多少扣多少"。
 *
 * 这正是本项目最怕的那类坏法 —— 不报错、不崩溃，只是**规则没生效**。
 * 所以搬它，而不是"两种写法都收下"：收下等于把这个错误永久合法化，
 * 而下一批生成还会继续写错地方。
 */
function fixPlacement(kind, obj, report) {
  if (kind !== 'nightEvent' && kind !== 'dayEvent') return obj;
  let moved = 0;
  const options = (obj.options ?? []).map((opt) => {
    const eff = opt?.effect;
    if (!eff || typeof eff !== 'object' || eff.requireFullCash === undefined) return opt;
    const { requireFullCash, ...rest } = eff;
    moved++;
    // 选项层已经有时，以"真"为准（两处都说 true 就是 true，没有含糊的余地）
    return { ...opt, effect: rest, requireFullCash: opt.requireFullCash === true ? true : requireFullCash };
  });
  if (moved > 0) report.relocated.push(`${obj.id}: ${moved} 个 effect.requireFullCash → 选项层`);
  return { ...obj, options };
}

/** 渲染一个值：对象渲染成多行（可读），数组/标量渲染成一行 */
function ts(value, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // 标量数组写一行（`tags: ['canned', 'food']`），对象数组展开成多行
    if (value.every((v) => !isPlainObject(v) && !Array.isArray(v))) {
      return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    }
    const inner = value.map((v) => `${pad}  ${ts(v, indent + 2)}`).join(',\n');
    return `[\n${inner}\n${pad}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const inner = keys
      .map((k) => `${pad}  ${keyOf(k)}: ${ts(value[k], indent + 2)}`)
      .join(',\n');
    return `{\n${inner}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/**
 * 对象键的写法。
 *
 * ★ 这里有一个必须处理的坑：**数字键**。
 * 灾难的逐日温度表在 JSON 里长这样（JSON 的键只能是字符串）：
 *
 * ```json
 * "temperatures": { "-7": 6, "-4": 4 }
 * ```
 *
 * 而 TS 的类型是 `Record<number, number>`。**负数键不能写成 `'-7':`** ——
 * 那不是"数字键的字面量写法"，而是一个字符串键，在 TS 里会直接报
 * "`'-7'` 不能索引 `Record<number, number>`"。
 * 正确写法是**计算键**：`[-7]: 6`。
 *
 * 第一版脚本就是直接 `JSON.stringify(k)` 的，于是灾难一入库就编译不过。
 * 把"JSON 的键全是字符串"这件事显式处理掉，是这类转换脚本的必经一步。
 */
function keyOf(k) {
  if (/^-?\d+$/.test(k)) return `[${k}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : `'${k}'`;
}

/** 转成"安全整数"的写法：负温度等键要写成 `[-7]:` 那种计算键 */
function tsEntry(kind, obj, report) {
  const allowed = FIELDS[kind] ?? [];
  const kept = {};
  const dropped = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!allowed.includes(k)) {
      dropped.push(k);
      continue;
    }
    kept[k] = k === 'options' && Array.isArray(v) ? v.map((o) => pickOption(o, `${obj.id} 的选项`, report)) : v;
  }
  if (dropped.length > 0) report.dropped.push(`${obj.id}: 丢掉了不在白名单里的字段 ${dropped.join(' / ')}`);
  return ts(kept, 2);
}

/** 挑出一个选项的字段，并把它的 `effect` 再按 `EFFECT_FIELDS` 过一遍 */
function pickOption(opt, where, report) {
  const kept = pick(opt, OPTION_FIELDS, where, report);
  if (isPlainObject(kept.effect)) {
    kept.effect = pick(kept.effect, EFFECT_FIELDS, `${where} 的 effect`, report);
  }
  return kept;
}

/** 按字段清单挑出要保留的键，其余记进报告（用于选项这类嵌套对象） */
function pick(obj, allowed, where, report) {
  if (!isPlainObject(obj)) return obj;
  const kept = {};
  const dropped = [];
  for (const [k, v] of Object.entries(obj)) {
    if (allowed.includes(k)) kept[k] = v;
    else dropped.push(k);
  }
  if (dropped.length > 0) report.dropped.push(`${where}: 丢掉了 ${dropped.join(' / ')}`);
  return kept;
}

// ——————————————————————————————————————————————————————————————
// 3. 把一批内容插进目标 TS 文件
// ——————————————————————————————————————————————————————————————

/**
 * 插入点用**标记注释**定位，而不是靠行号或"最后一个 `]`"。
 *
 * 理由：靠结构猜位置的脚本会在表被重排之后**静默插错地方** ——
 * 而错位置的内容不会报错，只会变成"这件物资从来没出现在池子里"那类
 * 最难查的问题。标记注释是显式的，找不到就直接报错退出。
 */
const MARK_BEGIN = (batch) => `  // ═══ 生成内容 ${batch} 起（scripts/merge-content.mjs 插入，别手改这一段） ═══`;
const MARK_END = (batch) => `  // ═══ 生成内容 ${batch} 止 ═══`;

/**
 * 括号 / 方括号 / 圆括号是否配平（**忽略字符串与注释里的括号**）。
 *
 * ## 为什么入库脚本需要这个
 *
 * 第一版脚本用 `lastIndexOf('\n];')` 找"数组结尾"，结果在 `items.ts` 上
 * 找到了**文件后面另一个数组**的结尾（`CATEGORY_ORDER` 那个），
 * 于是 40 件物资被插到了 `ITEM_DEFS` 数组**外面** —— 文件里凭空多出
 * 300 多行悬空的对象字面量，而注释里的 `tags: ['canned']` 还让
 * 粗糙的配平计数看不出问题。
 *
 * 这类"插错位置"是本项目最怕的一种坏法：**它不一定报错**。
 * 所以这里不靠"位置猜对了"来保证，而是**插完先验证**：
 * 配平不过就一个字都不写，直接报错退出。
 */
function balanced(text) {
  const pairs = { '}': '{', ']': '[', ')': '(' };
  const stack = [];
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') stack.push(c);
    else if (c === '}' || c === ']' || c === ')') {
      if (stack.pop() !== pairs[c]) return false;
    }
  }
  return stack.length === 0;
}

function insertBatch(file, batch, text, report, anchor) {
  const abs = join(root, file);
  if (!existsSync(abs)) {
    report.failed.push(`${file} 不存在`);
    return;
  }
  const src = readFileSync(abs, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const begin = MARK_BEGIN(batch);
  const end = MARK_END(batch);
  const body = `${begin}${eol}${text}${eol}${end}`;

  if (src.includes(begin)) {
    // 重跑同一批：整段替换（**幂等**是这类脚本的硬要求，否则第二遍会插两遍）
    const from = src.indexOf(begin);
    const to = src.indexOf(end);
    if (to < 0) {
      report.failed.push(`${file} 里有起始标记却没有结束标记，拒绝改（先人工修好）`);
      return;
    }
    const next = src.slice(0, from) + body + src.slice(to + end.length);
    if (!balanced(next)) {
      report.failed.push(`${file} 替换后括号不配平，一个字都没写`);
      return;
    }
    writeFileSync(abs, next);
    report.replaced.push(`${file} · ${batch}`);
    return;
  }

  /*
   * 首次插入的位置靠 `anchor` 定位：那是目标数组的**声明行**（例：`export const ITEM_DEFS`）。
   * 从它往后找第一个 `\n];` —— 那才是这个数组的结尾。
   *
   * ★ 不能直接对全文件 `lastIndexOf('\n];')`：`items.ts` 后面还有别的数组
   * （`CATEGORY_ORDER`），那一次就插错了地方（见 `balanced` 的注释）。
   */
  if (!anchor) {
    report.failed.push(`${file} 没有配置插入锚点（TARGETS 里补 anchor）`);
    return;
  }
  const anchorIdx = src.indexOf(anchor);
  if (anchorIdx < 0) {
    report.failed.push(`${file} 里找不到锚点「${anchor}」，拒绝猜位置`);
    return;
  }
  const closeIdx = src.indexOf(`${eol}];`, anchorIdx);
  if (closeIdx < 0) {
    report.failed.push(`${file} 的锚点之后找不到数组结尾 \`];\`，拒绝猜位置`);
    return;
  }
  const head = src.slice(0, closeIdx);
  const tail = src.slice(closeIdx);
  // 给上一项补逗号（它原来是最后一项，没有逗号）
  const next = `${head},${eol}${body}${tail}`;
  if (!balanced(next)) {
    report.failed.push(`${file} 插入后括号不配平（锚点可能选错了），一个字都没写`);
    return;
  }
  writeFileSync(abs, next);
  report.inserted.push(`${file} · ${batch}`);
}

// ——————————————————————————————————————————————————————————————
// 4. 主流程
// ——————————————————————————————————————————————————————————————

/**
 * 每批内容 → 它该去哪张表。加一批内容时只改这里。
 *
 * `anchor` 是目标数组的**声明行** —— 定位插入点靠它，
 * 而不是靠"文件里最后一个 `];`"（那个做法在 `items.ts` 上真的插错过，见 `balanced`）。
 */
const TARGETS = {
  item: { file: 'src/data/items.ts', anchor: 'export const ITEM_DEFS' },
  identity: { file: 'src/data/identities.ts', anchor: 'export const IDENTITY_DEFS' },
  shop: { file: 'src/data/shops.ts', anchor: 'export const SHOP_DEFS' },
  nightEvent: { file: 'src/data/nightEvents.ts', anchor: 'export const NIGHT_EVENT_DEFS' },
  dayEvent: { file: 'src/data/dayEvents.ts', anchor: 'const WEIGHTED' },
  emergency: { file: 'src/data/emergencies.ts', anchor: 'export const EMERGENCY_DEFS' },
  helpRequest: { file: 'src/data/helpRequests.ts', anchor: 'export const HELP_REQUEST_DEFS' },
  disaster: { file: 'src/data/disaster.ts', anchor: 'export const DISASTER_DEFS' }
};

const fail = (msg) => {
  console.error(`[merge-content] ✗ ${msg}`);
  process.exitCode = 1;
};

const report = { inserted: [], replaced: [], dropped: [], relocated: [], failed: [], counts: [] };
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** 找出 content/ 下全部批次文件（按目录递归，跳过以 `_` 开头的草稿） */
function batchFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('_')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) out.push(p);
    }
  };
  walk(contentDir);
  return out.sort();
}

const files = batchFiles();
if (files.length === 0) fail(`content/ 下一个批次文件都没有（${contentDir}）`);

for (const file of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${basename(file)} 不是合法 JSON：${e.message}`);
    continue;
  }
  const kind = data.kind;
  const batch = data.batch ?? basename(file, '.json');
  if (only.length > 0 && !only.some((o) => batch.includes(o) || basename(file).includes(o))) continue;
  const target = TARGETS[kind];
  if (!target) {
    fail(`${basename(file)} 的 kind='${kind}' 没有对应的目标表（TARGETS 里加一行）`);
    continue;
  }
  if (!Array.isArray(data.entries)) {
    fail(`${basename(file)} 缺少 entries 数组`);
    continue;
  }

  const rendered = data.entries.map((e) => {
    const body = tsEntry(kind, fixPlacement(kind, e, report), report);
    /*
     * ★ 白天事件在代码里是**带权重**的：`WEIGHTED: { weight, def }[]`，
     * 而不是 `DayEventDef[]`（权重决定这条事件在店门里被抽到的相对概率）。
     *
     * 生成物没有 `weight` 这个概念 —— 它只有一个"我这条有多常见"的直觉。
     * 这里统一给 1.0（等权），因为**擅自替生成内容编一个权重，
     * 等于偷偷改了这个游戏的抽取分布**：那是一次数值改动，
     * 该由人按探针结果来做，不该由入库脚本顺手做掉。
     * 将来要调，就在这条事件自己的 `weight` 上手调。
     */
    if (kind === 'dayEvent') return `  {\n    weight: 1.0,\n    def: ${indent(body, 2)}\n  },`;
    return body + ',';
  });
  // 渲染统一用 `\n`；`insertBatch` 自己会按目标文件的行尾（CRLF/LF）做转换
  insertBatch(target.file, batch, rendered.join('\n'), report, target.anchor);
  report.counts.push(`${kind} · ${batch}：${data.entries.length} 条 → ${target.file}`);
}

// ——————————————————————————————————————————————————————————————
// 5. 报告
// ——————————————————————————————————————————————————————————————

console.log('[merge-content] 入库：');
for (const line of report.counts) console.log(`  · ${line}`);
if (report.inserted.length > 0) console.log(`  新插入：${report.inserted.join('、')}`);
if (report.replaced.length > 0) console.log(`  整段替换（重跑）：${report.replaced.join('、')}`);
if (report.dropped.length > 0) {
  console.log('\n[merge-content] 被白名单丢掉的字段（确认它们是"给人看的"而不是玩法字段）：');
  for (const d of report.dropped) console.log(`  · ${d}`);
}
if (report.relocated.length > 0) {
  console.log('\n[merge-content] 修正了放错层级的字段（不改会静默失效，见 fixPlacement）：');
  for (const r of report.relocated) console.log(`  · ${r}`);
}
if (report.failed.length > 0) {
  console.error('\n[merge-content] ★ 失败：');
  for (const f of report.failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\n[merge-content] 完成。下一步：npm run typecheck && npm run test');
