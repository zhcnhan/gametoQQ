/**
 * 打包箱静态表（§6.2 打包箱制 / 引擎③ 拆箱惊喜）。
 * 箱子只描述"里面可能摸出什么"，具体批次与件数由种子化 RNG 在 systems/setup.ts 里生成，
 * 这样同一个 seed 永远开出同一箱物资（存档一致）。
 */
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

export const BOX_DEFS: readonly BoxDef[] = [
  {
    id: 'box_staple',
    name: '粮油箱',
    hint: '粮油',
    pool: ['canned_beans', 'instant_noodles', 'rice_bag', 'flour', 'mineral_water', 'milk'],
    minItems: 5,
    maxItems: 7,
    maxCountPerItem: 4
  },
  {
    id: 'box_medical',
    name: '医疗箱',
    hint: '常用药',
    pool: ['bandage', 'cold_medicine', 'mineral_water', 'battery'],
    minItems: 3,
    maxItems: 5,
    maxCountPerItem: 5
  },
  {
    id: 'box_mixed',
    name: '神秘混合箱',
    hint: '隔壁单位拼的，说不上都有啥',
    pool: [
      'canned_beans',
      'instant_noodles',
      'rice_bag',
      'flour',
      'mineral_water',
      'milk',
      'bandage',
      'cold_medicine',
      'fuel_can',
      'quilt',
      'battery',
      'toolbox'
    ],
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
    luxuryPool: ['cocoa_tin', 'cigarettes', 'coffee_beans', 'picture_book', 'hot_water_bag_gift']
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
