/**
 * 物资静态表（策划案 §8：MVP 10~12 种）。
 * 纯常量，不含任何逻辑与 DOM 引用。
 *
 * 数值约定（§7）：
 *  - slotSize：1=小件 / 2=大瓶 / 4=整袋（M0 槽位矩阵是"一格一栈"，slotSize 暂作展示与排序用，见验收报告）
 *  - stackLimit：单槽堆叠上限
 *  - nutrition：基础营养，M0 不使用，M1 生存期消耗读这里
 */
import type { CategoryId, ItemDef } from '../model/types';

export const ITEM_DEFS: readonly ItemDef[] = [
  {
    id: 'canned_beans',
    name: '黄豆罐头',
    category: 'food',
    icon: 'can',
    unitWeight: 0.4,
    slotSize: 1,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 720,
    nutrition: { food: 1 },
    basePrice: 8,
    tags: ['canned', 'food']
  },
  {
    id: 'instant_noodles',
    name: '泡面',
    category: 'food',
    icon: 'noodles',
    unitWeight: 0.12,
    slotSize: 1,
    stackLimit: 8,
    perishable: true,
    shelfLifeDays: 180,
    nutrition: { food: 1, comfort: 1 },
    basePrice: 5,
    tags: ['dry', 'food']
  },
  {
    id: 'rice_bag',
    name: '大米',
    category: 'food',
    icon: 'rice',
    unitWeight: 5,
    slotSize: 4,
    stackLimit: 1,
    perishable: true,
    shelfLifeDays: 365,
    nutrition: { food: 4 },
    basePrice: 40,
    tags: ['grain', 'food']
  },
  {
    id: 'flour',
    name: '面粉',
    category: 'food',
    icon: 'flour',
    unitWeight: 2.5,
    slotSize: 2,
    stackLimit: 2,
    perishable: true,
    shelfLifeDays: 240,
    nutrition: { food: 3 },
    basePrice: 22,
    tags: ['grain', 'food']
  },
  {
    id: 'mineral_water',
    name: '矿泉水',
    category: 'water',
    icon: 'water',
    unitWeight: 1.5,
    slotSize: 2,
    stackLimit: 6,
    perishable: true,
    shelfLifeDays: 365,
    nutrition: { water: 2 },
    basePrice: 3,
    tags: ['drink', 'water']
  },
  {
    id: 'milk',
    name: '牛奶',
    category: 'water',
    icon: 'milk',
    unitWeight: 1,
    slotSize: 2,
    stackLimit: 4,
    perishable: true,
    shelfLifeDays: 21,
    nutrition: { water: 1, food: 1, comfort: 1 },
    basePrice: 12,
    tags: ['drink', 'fresh']
  },
  {
    id: 'bandage',
    name: '绷带',
    category: 'medicine',
    icon: 'bandage',
    unitWeight: 0.1,
    slotSize: 1,
    stackLimit: 10,
    perishable: false,
    nutrition: { health: 2 },
    basePrice: 6,
    tags: ['medkit', 'medicine']
  },
  {
    id: 'cold_medicine',
    name: '感冒药',
    category: 'medicine',
    icon: 'pill',
    unitWeight: 0.05,
    slotSize: 1,
    stackLimit: 8,
    perishable: false,
    nutrition: { health: 3 },
    basePrice: 18,
    tags: ['medkit', 'medicine']
  },
  {
    id: 'fuel_can',
    name: '燃料罐',
    category: 'fuel',
    icon: 'fuel',
    unitWeight: 4,
    slotSize: 2,
    stackLimit: 2,
    perishable: false,
    nutrition: {},
    basePrice: 30,
    tags: ['fuel', 'flammable']
  },
  {
    id: 'quilt',
    name: '棉被',
    category: 'warmth',
    icon: 'quilt',
    unitWeight: 3,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: { comfort: 3 },
    basePrice: 60,
    tags: ['warmth', 'soft']
  },
  {
    id: 'battery',
    name: '电池',
    category: 'tool',
    icon: 'battery',
    unitWeight: 0.03,
    slotSize: 1,
    stackLimit: 12,
    perishable: false,
    nutrition: {},
    basePrice: 5,
    tags: ['power', 'tool']
  },
  {
    id: 'toolbox',
    name: '工具箱',
    category: 'tool',
    icon: 'toolbox',
    unitWeight: 6,
    slotSize: 4,
    stackLimit: 1,
    perishable: false,
    nutrition: {},
    basePrice: 80,
    tags: ['tool', 'heavy']
  }
];

const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEM_DEFS.map((d) => [d.id, d]));

export function getItemDef(itemId: string): ItemDef {
  const def = ITEM_BY_ID.get(itemId);
  if (!def) throw new Error(`未知物资 id: ${itemId}`);
  return def;
}

export function hasItemDef(itemId: string): boolean {
  return ITEM_BY_ID.has(itemId);
}

export const ITEM_IDS: readonly string[] = ITEM_DEFS.map((d) => d.id);

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  food: '主食',
  water: '饮水',
  medicine: '医疗',
  fuel: '燃料',
  warmth: '保暖',
  tool: '工具',
  luxury: '享受'
};

/**
 * 品类的**稳定顺序**（胶带胶囊按它排、存档里的清单也按它归一化）。
 *
 * 必须显式写出来，不能靠 `Object.keys(CATEGORY_LABELS)`：
 * 那样顺序会随 label 表的编辑而变，玩家看到的胶囊会莫名换位子，
 * 而且同一个存档在不同版本里序列化出的字符串会不一样（diff 噪音）。
 */
export const CATEGORY_ORDER: readonly CategoryId[] = [
  'food',
  'water',
  'medicine',
  'fuel',
  'warmth',
  'tool',
  'luxury'
];
