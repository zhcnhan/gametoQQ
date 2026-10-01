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
}

export const BOX_DEFS: readonly BoxDef[] = [
  {
    id: 'box_staple',
    name: '粮油箱',
    hint: '粮油 · 保重',
    pool: ['canned_beans', 'instant_noodles', 'rice_bag', 'flour', 'mineral_water', 'milk'],
    minItems: 5,
    maxItems: 7,
    maxCountPerItem: 4
  },
  {
    id: 'box_medical',
    name: '医疗箱',
    hint: '常用药 · 别硬撑',
    pool: ['bandage', 'cold_medicine', 'mineral_water', 'battery'],
    minItems: 3,
    maxItems: 5,
    maxCountPerItem: 5
  },
  {
    id: 'box_mixed',
    name: '神秘混合箱',
    hint: '隔壁单位拼的 · 说不上都有啥',
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
    maxCountPerItem: 3
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
  hint: '放不下的先搁这儿',
  pool: [],
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
