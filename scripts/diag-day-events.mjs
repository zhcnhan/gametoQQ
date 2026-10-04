/**
 * 诊断：把 `dayEvent.test.ts` 里几条内容纪律的**逐条判定**打出来。
 *
 * 为什么单独写这个脚本（而不是直接读测试的报错）：测试用的是
 * `expect(bad).toEqual([])`，vitest 只打印 `[ …(10) ]` —— **看不见是哪 10 条**。
 * 而这里要改的是具体某几条的内容，所以需要那份名单本身。
 * （这正是纪律文档 §0.1 那条："诊断要输出分支与原始值，不要输出症状"。）
 *
 * ★ 它的第二个用途：**给"重新生成内容"准备工单**。
 *
 * ## ★★ 一个必须记住的口径：`requireFullCash` 可能写在**两层**
 *
 * 提示词把它列在 `effect` 的字段表里，而代码读的是**选项层**
 * （见 `scripts/merge-content.mjs` 的 `fixPlacement`，入库时会自动搬上去）。
 * 所以生成物里它有**两种写法**，而任何判"这条选项要不要全款"的地方
 * **两层都必须认** —— 否则判据会把"其实要全款"的选项当成免费的。
 *
 * 这个脚本第一版就只读了选项层。重写后的那一批里 17 处都写在 `effect` 层，
 * 于是它报了"全都要花钱 0 条"—— 那四条事件**若仍未修好也会显示为合格**。
 * 测试那边（`dayEvent.test.ts`）同样只读选项层，它之所以没被骗，
 * 是因为入库已经把字段搬到选项层了。**两边口径不一致本身就是隐患**：
 * 诊断跑在"入库前"的 JSON 上，测试跑在"入库后"的 TS 上。
 *
 * 用法：node scripts/diag-day-events.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * ★ 扫**整个** `content/事件/` 里**白天事件**的那几个文件，而不是写死某一个文件名。
 *
 * 原来这里写的是 `content/事件/day-01.json` —— 那种写法在内容加了第二批
 * （`白天-02.json`）、或者在文件改名之后就会**静默只看一半**：
 * 工具照常输出、照常说"0 条"，而它根本没读到新的那批。
 * 一份诊断工具"少看了一半还报 OK"比没有它更坏。
 *
 * ⚠ 只收 `白天-*.json`：这四条判据是**给白天事件**写的
 * （它们读 `options[].effect` 里的 grab / stockCut / priceUp），
 * 而夜间与突发事件的形状不同 —— 一并扫进来会在 `def.options` 上抛异常。
 * 要查夜间事件请另写一份工具，不要把这四条判据套上去。
 */
const eventDir = 'content/事件';
const dayFiles = readdirSync(eventDir).filter((f) => f.startsWith('白天-') && f.endsWith('.json'));
const json = {
  entries: dayFiles.flatMap((f) => {
    const data = JSON.parse(readFileSync(join(eventDir, f), 'utf8'));
    return (data.entries ?? []).map((e) => ({ ...e, __file: f }));
  })
};
console.log(`扫了 ${dayFiles.length} 个白天事件文件（${dayFiles.join('、')}），共 ${json.entries.length} 条\n`);

const says = (text, re) => re.test(text);

/** 这条选项要不要"给得起全款才成立"（两层都认，见文件头） */
const needsFullCash = (opt) => opt.requireFullCash === true || opt.effect?.requireFullCash === true;

const onlyCost = [];
const allPay = [];
const mismatched = [];
const misplaced = [];

for (const def of json.entries) {
  for (const opt of def.options) {
    const eff = opt.effect ?? {};
    const hasGoods = eff.grab !== undefined || eff.boxDefId !== undefined;
    const spentCash = (eff.cash ?? 0) < 0 || opt.outcome.includes('{spentCash}');
    const where = `${def.id} 的「${opt.label}」`;

    // 顺带记下"写在 effect 层"的（入库会搬，但生成侧最好写对层）
    if (eff.requireFullCash !== undefined) misplaced.push(where);

    const gains =
      hasGoods ||
      (eff.cash ?? 0) > 0 ||
      (eff.mood ?? 0) > 0 ||
      (eff.stamina ?? 0) > 0 ||
      eff.visitLost === true ||
      eff.stockCut !== undefined ||
      eff.limit !== undefined;
    if (!gains) onlyCost.push(`${where}：${JSON.stringify(eff)}`);

    if (says(opt.outcome, /买了|结完账|结了账|付了钱|花掉/) && !(hasGoods || spentCash)) {
      mismatched.push(`${where} 说交易但没收支：${opt.outcome}`);
    }
    if (says(opt.outcome, /拿了两|抓了|抢到|多给了你|带回来/) && !hasGoods) {
      mismatched.push(`${where} 说拿了但没给货：${opt.outcome}`);
    }
    if (hasGoods && !says(opt.outcome, /拿|抓|给|带|箱|袋|篮子|车里|上车|到手|进袋|塞|都还|买了|结账|结了账/)) {
      mismatched.push(`${where} 给了货但文案没提：${opt.outcome}`);
    }
  }
  // 每个选项都要全款、都扣钱 → 兜里没钱的玩家点开只剩灰按钮（§4A）
  const free = def.options.some((o) => !needsFullCash(o) && (o.effect?.cash ?? 0) >= 0);
  if (!free) allPay.push(`${def.id}：${def.options.map((o) => o.label).join(' / ')}`);
}

console.log(`本批 ${json.entries.length} 条：`);
console.log(`\n① 只有代价、没有收获的选项（${onlyCost.length} 条）：`);
for (const x of onlyCost) console.log('  · ' + x);
console.log(`\n② "每个选项都要花钱"的事件（${allPay.length} 条，兜里没钱的人点开只剩灰按钮）：`);
for (const x of allPay) console.log('  · ' + x);
console.log(`\n③ 文案与效果对不上的（${mismatched.length} 条）：`);
for (const x of mismatched) console.log('  · ' + x);
console.log(
  `\n（提示）requireFullCash 写在 effect 层、要入库脚本搬上去的：${misplaced.length} 处` +
    '\n  搬这一下不会出错（`merge-content.mjs` 会搬并打报告），但直接写在选项层更省事。'
);

