/**
 * 一次性探针：**W-08 那一格到底会显示什么**（三个真实夹具各读一遍）。
 *
 * 要回答的是"这一格有没有读数差"，所以直接拿 `src/tools/save-*.txt` 那几个
 * 夹具（人工走查用的同一份数据）跑一遍 —— 而不是手搓一个局面对着自己写断言。
 */
import { getDisasterDef } from '../src/data/disaster';
import { handyDays, supplyDays } from '../src/model/contrast';
import { deserialize } from '../src/state/save';
import { computeOrganizeScore } from '../src/model/score';
import saveGood from '../src/tools/save-good.txt?raw';
import saveMessy from '../src/tools/save-messy.txt?raw';
import savePerfect from '../src/tools/save-perfect.txt?raw';
import save100 from '../src/tools/save-100boxes.txt?raw';

for (const [name, text] of [
  ['good（全上架 + 胶带 + 顺手位）', saveGood],
  ['messy（货架全空、一张胶带都没贴）', saveMessy],
  ['100boxes（100 箱全没拆）', save100],
  ['perfect（算出来的满分档）', savePerfect]
] as const) {
  const save = deserialize(text.trim());
  if (!save?.run) {
    console.log(`${name}: 读不出来`);
    continue;
  }
  const run = save.run;
  const disaster = getDisasterDef(run.disasterId);
  const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, disaster);
  console.log(
    `${name}\n` +
      `   day=${run.day} 灾难=${disaster.name} 货架=${run.shelves.length} 块 纸箱=${run.boxesToUnpack.length}\n` +
      `   归位率 ${Math.round(score.placement * 100)}% · 应急可达 ${Math.round(score.emergency * 100)}%\n` +
      `   余粮 ${supplyDays(run, disaster)} 天 → 随手够得到 ${handyDays(run, disaster)} 天` +
      `（差 ${supplyDays(run, disaster) - handyDays(run, disaster)} 天要翻）`
  );
}
