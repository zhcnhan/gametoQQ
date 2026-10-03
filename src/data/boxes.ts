/**
 * 打包箱静态表（§6.2 打包箱制 / 引擎③ 拆箱惊喜）。
 * 箱子只描述"里面可能摸出什么"，具体批次与件数由种子化 RNG 在 systems/setup.ts 里生成，
 * 这样同一个 seed 永远开出同一箱物资（存档一致）。
 *
 * ## ★ M3 第 1 步：池子从"手写 17 件"改成"按品类推导"
 *
 * 原来这三个池子是**手写的 id 列表**，而 M3 把物资从 17 件扩到了 57 件 ——
 * 于是那 40 件新物资**一件也不在任何池子里**：它们编译进了游戏、图鉴里有格子，
 * 而玩家一件也碰不到。这正是 D-16 记的那类问题（"写了但永远出不来"），
 * 而且它藏得很深：谁也看不出少了什么。
 *
 * 发现它的是 `data/registry.ts` 的「没有一件物资是永远拿不到的」
 * —— 那条守卫是**算出来的**（扫商店 offers 与箱子池），
 * 所以内容一多它当场就报了 40 个 id。**这正是"可达性必须能自动查出来"的价值。**
 *
 * ## 为什么改成函数而不是继续手写
 *
 * 手写一张 57 件的名单有两个问题：写的时候要逐条抄 id（抄错不会报错，
 * 只会让那件物资悄悄消失），而**下一批内容进来时又会漏一遍**。
 * 按品类推导之后，"加了物资就有地方出"是**由构造保证**的 ——
 * 新物资只要品类在下面那几个集合里，就自动进池子，不需要任何人记得回来改这里。
 *
 * ## 顺带说清一个设计约束（不是 bug）
 *
 * `generateBoxStacks` 是**洗牌后取前 N 件**（N = minItems~maxItems），
 * 所以池子变大**不会**让一箱装得更多，只会让每件东西出现得更稀。
 * 这是刻意的：箱子的大小该由 `minItems`/`maxItems` 说了算，
 * 而不是由"我们有多少种物资"说了算 —— 否则内容一多，一箱就变成一座仓库。
 */
import { ITEM_DEFS } from './items';
import type { CategoryId } from '../model/types';

export interface BoxDef {
  id: string;
  name: string;
  /** 文案模板，用于纸箱正面手写标签 */
  hint: string;
  /** 可能摸出的物资 id 池 */
  pool: readonly string[];
  minItems: number;
  maxItems: number;
  /** 每件物资的件数上限（默认取 ItemDef.stackLimit） */
  maxCountPerItem: number;
  /**
   * 奢侈品池（M2，§12 拍板 v0.9）：这一箱**额外**有多大概率摸出一件奢侈品。
   *
   * ## 为什么要单独一个池，而不是把 luxury 塞进 `pool`
   *
   * 塞进 `pool` 的话，它就和罐头一样是"等概率的一项"，赌性会被摊平 ——
   * 拆箱时会看到"哦，又一个"，而不是"这次会不会开出点什么"。
   * 单独一个**低概率的额外抽**，才有 §5 引擎③ 要的那一下心跳。
   *
   * ## 抽法（见 systems/setup.ts 的 generateBoxStacks）
   *
   * 每次生成一箱时掷一次；中了就在 `luxuryPool` 里等概率抽一件、追加到箱尾。
   * **最多一件**：多件会让"开出一件好东西"这件事贬值。
   * 掷与抽各自消耗一次 RNG，所以同 seed 同结果照旧成立。
   *
   * ## 只有神秘混合箱有
   *
   * 粮油箱与医疗箱是"按品类买的确定性商品"（买了米面就是米面），
   * 在那里塞奢侈品会让采购的账算不清。赌性属于**混合**箱 ——
   * 它的名字本来就叫"说不上都有啥"。
   */
  luxuryChance?: number;
  luxuryPool?: readonly string[];
}

/** 一个箱型装哪几个品类 —— 由它推导 `pool`（见文件头的说明） */
const STAPLE_CATEGORIES: readonly CategoryId[] = ['food', 'water'];
const MEDICAL_CATEGORIES: readonly CategoryId[] = ['medicine', 'warmth', 'fuel', 'tool'];

/** 按品类取物资 id（**保持 `ITEM_DEFS` 里的原始顺序**，所以同一 seed 的结果稳定） */
function itemIdsIn(categories: readonly CategoryId[]): string[] {
  return ITEM_DEFS.filter((d) => categories.includes(d.category)).map((d) => d.id);
}

/** 奢侈品（`luxury`）单独走 `luxuryChance`，不进正经池子 —— 见 `luxuryPool` 的注释 */
const LUXURY_IDS: readonly string[] = ITEM_DEFS.filter((d) => d.category === 'luxury').map((d) => d.id);

/** 混合箱：除了奢侈品（那走单独的池子）以外的**全部**物资 */
const MIXED_IDS: readonly string[] = ITEM_DEFS.filter((d) => d.category !== 'luxury').map((d) => d.id);

export const BOX_DEFS: readonly BoxDef[] = [
  {
    id: 'box_staple',
    name: '粮油箱',
    hint: '粮油',
    pool: itemIdsIn(STAPLE_CATEGORIES),
    minItems: 5,
    maxItems: 7,
    maxCountPerItem: 4
  },
  {
    id: 'box_medical',
    name: '医疗箱',
    hint: '常用药',
    pool: itemIdsIn(MEDICAL_CATEGORIES),
    minItems: 3,
    maxItems: 5,
    maxCountPerItem: 5
  },
  {
    id: 'box_mixed',
    name: '神秘混合箱',
    hint: '隔壁单位拼的，说不上都有啥',
    pool: MIXED_IDS,
    minItems: 4,
    maxItems: 8,
    maxCountPerItem: 3,
    /**
     * 18% —— 大约五箱里开出一件。
     *
     * 标定依据：一局里神秘混合箱的来源有四处（开局三箱之一、白天采购的杂货一趟、
     * 夜间事件"半夜补货"、黑市商人），实际到手的混合箱通常是 6~12 个。
     * 18% 意味着**平均一局开得出 1~2 件奢侈品** —— 够让图鉴走动，又不至于烂大街。
     * 定得太高，"开出一件"就不再是能跟人提一句的事。
     */
    luxuryChance: 0.18,
    luxuryPool: [...LUXURY_IDS]
  }
];

/**
 * 临时搁置箱：不参与开局生成，只在"手里这件实在没地方放"时兜底（策划案 §12.3 永远留逆转口）。
 * pool 故意留空 —— generateBoxStacks 遇到空池会直接返回空列表，不会被误生成。
 */
export const STRAY_BOX_ID = 'box_stray';

export const STRAY_BOX_DEF: BoxDef = {
  id: STRAY_BOX_ID,
  name: '临时搁置箱',
  hint: '放不下的先搁这儿',  pool: [],
  minItems: 0,
  maxItems: 0,
  maxCountPerItem: 1
};

export function getBoxDef(boxId: string): BoxDef {
  if (boxId === STRAY_BOX_ID) return STRAY_BOX_DEF;
  const def = BOX_DEFS.find((b) => b.id === boxId);
  if (!def) throw new Error(`未知箱型 id: ${boxId}`);
  return def;
}
