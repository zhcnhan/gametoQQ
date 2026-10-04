/**
 * 一次性：把第 II 批物资写成**正规内容文件** `content/物资/物资-02.json`。
 *
 * ## 为什么绕这一圈（而不是留在那个一次性脚本里）
 *
 * `AGENTS.md` 与策划案 §10.2.6 定的内容流程是：
 *
 *     content/*.json  →  check-content.mjs  →  merge-content.mjs  →  src/data/*.ts
 *
 * 我这一批是先写了 TS 再补内容文件，等于**跳过了流程**。那样有两个具体代价：
 *  ① `check-content.mjs` 校验的是**待入库的 JSON**，而我的条目从没被它看过
 *     （虽然我用脚本自查了同样的字段与范围，但那是**第二份判据**）；
 *  ② `merge-content.mjs` 是**幂等**的（同一批次整段替换），所以这批内容
 *     将来改数值时应当走那条重跑，而不是回到我那个一次性脚本。
 *
 * ★ 把 `_add-items-round2.ts` 里的数据搬过来之后，那个脚本就可以删了 ——
 * **内容住在 content/，代码住在 src/**，两者不再混在同一个文件里。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { ROWS } from './_add-items-round2-data.js';

const batchNote =
  '本批 30 件，专门补齐五个稀疏品类（医疗 2→10 / 燃料 1→8 / 保暖 1→6 / 工具 2→9 / 享受 5→8）。\n\n' +
  '加这一批**不是因为总数不够**（当时 57 件，目标 120~200），而是因为分布歪得厉害：\n' +
  '主食 34 件、而医疗只有 2 件、燃料与保暖各 1 件。\n\n' +
  '★ 「医疗只有 2 件」是**设计问题**而不只是数字问题：生存期每天会自动开药箱\n' +
  '（健康跌破 70 就按 FEFO 取一件医疗品），只有两种药可挑时，那个\n' +
  '「按 FEFO 取」的机制等于没有选择。\n\n' +
  '取舍类型分布（§10.2.6 要求同一类不超过 5 条）：\n' +
  '  · 一物两用、用的却是同一份存量（酒精能消毒也能引火 / 补液盐既算药又算水 / 酒精炉烧的是医用酒精）3\n' +
  '  · 重与大：便宜顶用但要弯腰搬（木炭 / 汽油桶 / 柴 / 防水布 / 羊毛毯）5\n' +
  '  · 只在特定灾难里回本（烫伤膏 / 防水布 / 羽绒服）3\n' +
  '  · 便宜但不精（纱布卷 / 蜡烛 / 引火块 / 宽胶带 / 暖宝宝）5\n' +
  '  · 贵而省地方（多用钳 / 充电宝 / 速溶咖啡 / 礼盒巧克力）4\n' +
  '  · 纯保险件：平时用不上，缺它那一次过不去（尼龙绳 / 手摇手电 / 收音机）3\n' +
  '  · 归类本身就是个决定（补液盐 / 果干 / 蜂蜜）3\n' +
  '  · 与另一格直接竞争（酒精炉 vs 药、热水袋 vs 燃料）2\n' +
  '  · 消耗与耐放之争（暖宝宝 / 保暖内衣 / 煤油）3';

const out = {
  kind: 'item',
  batch: '物资-02',
  batchNote,
  entries: ROWS
};

const dir = 'content/物资';
mkdirSync(dir, { recursive: true });

// 自查：这批的 id 一个都不能与物资-01 撞
import { readFileSync } from 'node:fs';
const first = JSON.parse(readFileSync('content/物资/物资-01.json', 'utf8'));
const used = new Set(first.entries.map((e) => e.id));
const clash = ROWS.filter((r) => used.has(r.id)).map((r) => r.id);
if (clash.length > 0) {
  console.log(`✗ 与物资-01 撞 id：${clash.join(', ')}，**没有写盘**`);
  process.exit(1);
}

writeFileSync(`${dir}/物资-02.json`, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`✓ content/物资/物资-02.json：${ROWS.length} 条`);
