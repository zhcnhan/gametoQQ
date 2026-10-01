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

/**
 * 身份天赋规则（相对 §7 的一处新增，理由）：
 * §7 的 `perk` 是 string，例如 '加油站夜班：燃料价格 -20%' —— 那是写给策划案读者看的注释，
 * 不是可执行的规则，systems/ 没法据此算折扣。要让天平真的倾斜就必须结构化。
 * 处理：`perk` 原样保留（继续当 UI 展示文案），另加 `perkRule` 给 systems 执行。
 */
export type PerkRule =
  | { kind: 'none' }
  /** 指定品类打折：rate = 0.15 表示便宜 15% */
  | { kind: 'categoryDiscount'; categories: CategoryId[]; rate: number };

export interface IdentityDef {
  // 随机身份
  id: string;
  name: string;
  /** 一句话人设，开局卡上显示 */
  tagline: string;
  startCash: number;
  vehicleCapacity: number;
  /**
   * 单趟手提上限（kg）—— 相对 §7 的新增，理由：
   * §6.2 的"三约束"点名了「背负重」，但 §7 的 IdentityDef 只给了 vehicleCapacity，落不了地。
   * 按已拍板的分工：carryLimit 决定"一次能从货架搬多少上车"（0 行动点，纯物理闸门），
   * vehicleCapacity 决定"这一整天总共能带回家多少"。
   */
  carryLimit: number;
  perk: string; // '加油站夜班：燃料价格 -20%'
  perkRule: PerkRule;
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

/** 囤货期点位（§6.2：MVP 取 3 个 —— 超市 / 药店 / 五金店） */
export type ShopId = 'supermarket' | 'pharmacy' | 'hardware';

export interface ShopOfferDef {
  itemId: string;
  /** 库存基数：当天实际库存会在 base±1 之间种子化抖动 */
  stock: number;
}

export interface ShopDef {
  id: ShopId;
  name: string;
  /** 一句话点位描述（点位列表上显示） */
  blurb: string;
  /** 价格系数：同一件物资在五金店比超市贵 */
  priceFactor: number;
  offers: ShopOfferDef[];
}

// ============ 运行时状态（model/） ============

/**
 * 某点位"今天"的一行货（种子化生成后落盘）。
 * 为什么必须落盘而不是每次现算：库存要在玩家回家整理、刷新页面之后仍然是同一批 ——
 * 现算会让 RNG 游标被渲染/刷新次数影响，"同 seed 同结果"当场失效。
 */
export interface ShopStockLine {
  itemId: string;
  /** 当天单价（已含点位系数与身份折扣） */
  price: number;
  /** 今天还剩几件 */
  stock: number;
}

export interface ShopDayStock {
  shopId: string;
  /** 这份库存属于哪一天（囤货期为负），用于读档后校验是否该换天 */
  day: number;
  lines: ShopStockLine[];
}

export interface ItemBatch {
  expiresAtDay: number | null;
  count: number;
}

export interface ItemStack {
  itemId: string;
  batches: ItemBatch[]; // 按批次记录保质期，FEFO 取 batches[0]
}

/**
 * 待拆箱（相对 §7 的 `boxesToUnpack: ItemStack[][]` 的一处模型变更，理由如下）：
 * §7 用"二维数组 + 下标"当箱子身份，一旦空箱被摘除，后面所有箱子的下标全部位移 ——
 * 玩家手里那件物资的"来处"就会指向另一个箱子（串箱），"放回原处"必然放错。
 * 而且 M1 采购要按箱型补货（同一天可能补两批同型箱），也必须区分"箱型"与"这一箱"。
 * 故：箱子升级为带稳定 id + 箱型 defId 的对象。
 */
export interface UnpackBox {
  id: string; // 'box_1'，整局唯一且不随摘箱变化
  defId: string; // 箱型：data/boxes.ts 的 BoxDef.id
  items: ItemStack[]; // items[0] 是下一个被摸出来的
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
  /**
   * 囤货期为负（-7..-1，M1 的 7 天），0 = D-Day（灾难降临日，只演出不操作），生存期为 1..7。
   * M0 的旧档把 day 恒写成 0 表示"整理中"，迁移时按"囤货期最后一天"处理（v3 → v4）。
   */
  day: number;
  identityId: string;
  disasterId: string;
  cash: number;
  shelves: Shelf[];
  zones: Zone[];
  boxesToUnpack: UnpackBox[]; // 待拆箱队列（引擎3）
  stats: { health: number; mood: number; stamina: number; shelter: number };
  trust: Record<string, number>; // npcId → 关系值
  deliveredOrders: number;
  log: string[]; // 日报流水（每条自带 'D-7 · ' 前缀，阶段 E 的日报按前缀分组）

  /** 种子游标：一切随机都从这里续着往下走（提示词 0 硬性要求 seed 落盘） */
  seed: number;

  // ———————— M1 囤货期（阶段 A） ————————

  /** 当天剩余行动点（每天重置为 ACTION_POINTS_PER_DAY） */
  actionPoints: number;
  /**
   * 当天已经"搬上车"的总重量（kg）—— 受车载容量约束，回家时清零。
   * 注意它与 boxesToUnpack 不冗余：箱子是"已经买到的货"，carLoad 只回答"今天还能再装几公斤"。
   */
  carLoad: number;
  /** 当天各点位的库存快照（种子化生成，随存档落盘） */
  shopStocks: ShopDayStock[];
  /** 今天已经进过哪几个店门（只用于界面标记"今天去过了"，不禁止再去） */
  visitedShopIds: string[];
  /**
   * 正站在哪个点位的货架前（null = 在外面的点位列表上）。
   * 落盘的理由是 §4A「恢复即续玩」：刷新后必须回到同一个货架前，而不是退回点位列表让玩家再点一次。
   */
  currentShopId: string | null;
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
