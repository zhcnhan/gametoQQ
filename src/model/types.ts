/**
 * 全部数据模型定义 —— 直接采用策划案 §7，逐字对应。
 * 唯一改动：RunState 增加 `seed`（提示词 0 硬性要求"seed 存进存档"，§7 遗漏）。
 *
 * 本文件属于 model/，必须是纯类型/纯逻辑，不碰任何浏览器 API（DOM、定时器、音频）。
 */

// ============ 静态表（data/ 的静态表都用这里的类型） ============

export type CategoryId = 'food' | 'water' | 'medicine' | 'fuel' | 'warmth' | 'tool' | 'luxury';

export interface ItemDef {
  id: string; // 'canned_beans'
  name: string; // '黄豆罐头'
  category: CategoryId;
  icon: string; // emoji 或 svg key
  unitWeight: number; // kg/件
  slotSize: number; // 占用槽位数（1=小件, 2=大瓶, 4=整袋米）
  stackLimit: number; // 单槽堆叠上限
  perishable: boolean;
  shelfLifeDays?: number; // 保质期（perishable=true 必填）
  nutrition: Partial<{ food: number; water: number; health: number; comfort: number }>;
  basePrice: number;
  tags: string[]; // 供玩家分区规则引用：'canned','drink','medkit'...
}

export interface DisasterProfile {
  id: 'cold_snap' | 'heat_wave' | 'flood' | 'epidemic';
  name: string;
  calendar: DayForecast[]; // 先知日历：逐日强度曲线
  dailyDrain: Partial<Record<CategoryId, number>>; // 每日额外消耗权重
  priorityCategories: CategoryId[]; // 寒潮→['fuel','warmth']
  windowScene: string; // 窗外渲染主题 key
}

export interface DayForecast {
  day: number;
  severity: number;
  hint: string;
}

export interface IdentityDef {
  // 随机身份
  id: string;
  name: string;
  startCash: number;
  vehicleCapacity: number;
  perk: string; // '加油站夜班：燃料价格 -20%'
}

export interface NpcDef {
  id: string;
  name: string;
  archetype: string; // '楼上王阿姨'
  requestPool: string[]; // 求援订单模板 id 列表
}

export interface HelpRequestDef {
  // 订单模板
  id: string;
  demands: { itemId: string; count: number }[];
  validUntilDay: number; // 当日有效，不用实时秒表（见 §4A）
  rewards: { trust?: number; intel?: string; barter?: { itemId: string; count: number }[] };
  declineTrust: number; // 婉拒的关系变化（负值）
}

// ============ 运行时状态（model/） ============

export interface ItemBatch {
  expiresAtDay: number | null;
  count: number;
}

export interface ItemStack {
  itemId: string;
  batches: ItemBatch[]; // 按批次记录保质期，FEFO 取 batches[0]
}

export interface Slot {
  stack: ItemStack | null;
}

export interface Zone {
  // ★ 引擎1核心：玩家自定义分区
  id: string;
  name: string; // 玩家命名
  color: string;
  autoAccept?: { categories?: CategoryId[]; tags?: string[] }; // 可选规则
}

export interface Shelf {
  id: string;
  roomId: string;
  kind: 'shelf' | 'fridge' | 'cabinet' | 'floor';
  w: number;
  h: number; // 格子矩阵
  slots: Slot[][]; // [row][col]
  zoneId: string | null;
}

export type GamePhase =
  | 'prologue' // 开局三选一身份 + 灾难揭晓
  | 'stockpile_shop' // 囤货期：外出扫货
  | 'organize' // 囤货期：回家整理（禅）
  | 'night' // 夜间事件
  | 'survival_day' // 生存期：每日结算 + 事件
  | 'help_request' // 求援订单弹窗
  | 'ending'; // 结算

export interface RunState {
  // 当局存档
  phase: GamePhase;
  day: number; // 囤货期为负（-30..-1），生存期为正
  identityId: string;
  disasterId: string;
  cash: number;
  shelves: Shelf[];
  zones: Zone[];
  boxesToUnpack: ItemStack[][]; // 待拆箱队列（引擎3）
  stats: { health: number; mood: number; stamina: number; shelter: number };
  trust: Record<string, number>; // npcId → 关系值
  deliveredOrders: number;
  log: string[]; // 日报流水

  /** 种子游标：一切随机都从这里续着往下走（提示词 0 硬性要求 seed 落盘） */
  seed: number;
}

export interface MetaProfile {
  // 跨局存档
  version: number;
  identityLevels: Record<string, number>;
  codex: { items: string[]; disasters: string[]; npcs: string[] };
  bestSurvivalDays: Record<string, number>; // 每灾难最佳纪录
}

export interface SaveGame {
  meta: MetaProfile;
  run: RunState | null;
  // —— 云备份（§4A）——
  savedAt: number; // 本地最后写入时间戳
  syncVersion: number; // 单调递增，云端冲突时取大者
  deviceId: string; // 匿名设备标识，迁移码绑定用
}

// ============ 位置辅助类型（纯逻辑用，非存档结构） ============

export interface SlotPos {
  row: number;
  col: number;
}
