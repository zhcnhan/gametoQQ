/**
 * 内容校验：把 AI 批量生成的 JSON 收进来之前，先让机器判一遍合格。
 *
 * ## 为什么它必须存在（这是 §10B 第 1 步的核心）
 *
 * §10B 要往这个游戏里灌**数百种**内容（物资 / 事件 / 灾难 / 身份 / 订单）。
 * 那件事的真正瓶颈**不是生成，是校对** —— 一批 50 条事件，人逐条读要一小时；
 * 而其中绝大多数错都是**机器一眼能看出来的**（id 打错、字段缺失、引用了不存在的物资、
 * 数值离群、文案承诺了效果给不出的东西）。
 *
 * 所以规矩是：**先有校验，再灌内容**。没有它，生成速度会被校对速度吃掉。
 *
 * ## 用法
 *
 *     node scripts/check-content.mjs                      # 校验现有内容表（进 npm run check）
 *     node scripts/check-content.mjs content/*.json       # 校验待入库的生成物
 *     node scripts/check-content.mjs --explain            # 打印每种内容的要求（喂给生成模型）
 *
 * ## 它检查什么（五类，与 §10B.5 一致）
 *
 *   ① **重复 id**（同一批内 / 与现有表冲突）
 *   ② **字段缺失或类型不对**（例：`perishable: true` 必须有 `shelfLifeDays`）
 *   ③ **引用悬空**（事件选项里的 `itemId` / `boxDefId` / `category` 必须真实存在）
 *   ④ **可达性**（不能是"写了但永远出不来"的内容 —— M2 的 D-16 就是这类）
 *   ⑤ **数值区间**（价格 / 重量 / 保质期落在设计区间内，挡住 AI 生成的离群值）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, isAbsolute } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'src');

const problems = [];
const notes = [];
const fail = (file, where, message) => problems.push({ file, where, message });
const note = (message) => notes.push(message);

/**
 * `--fresh`：按"这是一批还没入库的新内容"来审（id 与现有表冲突 → 不合格）。
 *
 * 默认**不**这样判，因为最常用的动作是"把已经入库的那批再校验一遍"，
 * 而那种情况下 id 当然已经存在（见下面那段注释）。
 */
const FRESH = process.argv.slice(2).includes('--fresh');

// ——————————————————————————————————————————————————————————————
// 1. 从源码里读出各内容表（脚本跑在 tsconfig 之外，所以用正则粗读）
// ——————————————————————————————————————————————————————————————

/**
 * 粗读一个 TS 数据文件里的字符串字面量 id。
 *
 * ★ 刻意**不**用 TypeScript 编译器 API：这个脚本要能被"刚加完内容的人"直接跑，
 * 而引入 `typescript` 的编程接口会让它变重。代价是它读不出运行期才拼出来的 id ——
 * 而这套数据表本来就是纯字面量（§10B.5 要求"内容表纯数据、无副作用"）。
 */
/**
 * 从一张已编译的数据表里收集 id。
 *
 * ★ **引号必须两种都认**，这一条是踩出来的：
 *
 * 手写的那部分用单引号（`id: 'canned_beans'`，项目的 TS 风格），
 * 而 `merge-content.mjs` 从 JSON 生成的那段用**双引号**（`id: "canned_fish"`，
 * JSON 风格原样搬过来）。原来这里的正则只写了 `'([^']+)'`，于是：
 *
 *   · 生成的 40 件物资**一件都不在这个集合里**；
 *   · 凡是引用它们的批次（`shop-01.json` 的 40 条 offers）全被判"引用了不存在的物资"。
 *
 * 而报出来的话术是"引用了不存在的物资" —— 它会把人带去查**内容**，
 * 而真正错的是**这个正则**。这类"诊断指向错误的方向"比不报更贵：
 * 照着它改，会去改一份本来正确的内容。
 *
 * ⚠ 修这个 bug 时想清楚一件事：**"不在集合里"不等于"不存在"**。
 * 集合少了一半，症状是"内容被判错"，而不是"工具报自己坏了"。
 */
function readIds(relPath) {
  const abs = join(src, relPath);
  if (!existsSync(abs)) return [];
  const text = readFileSync(abs, 'utf8');
  const ids = [];
  for (const m of text.matchAll(/^\s*id:\s*['"]([^'"]+)['"]/gm)) ids.push(m[1]);
  return ids;
}

const ITEM_IDS = readIds('data/items.ts');
const BOX_IDS = readIds('data/boxes.ts');
const DISASTER_IDS = readIds('data/disaster.ts');
const NIGHT_IDS = readIds('data/nightEvents.ts');
const DAY_IDS = readIds('data/dayEvents.ts');
const EMERGENCY_IDS = readIds('data/emergencies.ts');
const HELP_IDS = readIds('data/helpRequests.ts');
const IDENTITY_IDS = readIds('data/identities.ts');
const SHOP_IDS = readIds('data/shops.ts');

const CATEGORIES = ['food', 'water', 'medicine', 'fuel', 'warmth', 'tool', 'luxury'];

/** 已知 id 的全集，供"引用悬空"检查 */
const KNOWN = {
  item: new Set(ITEM_IDS),
  box: new Set(BOX_IDS),
  category: new Set(CATEGORIES),
  disaster: new Set(DISASTER_IDS),
  /*
   * ★ NPC id 也要读出来（2026-10 补）：求援订单的 `npcId` 认不出来时，
   * `getNpcDef` 会在**玩家点开那一单的时候**抛 —— 也就是一条内容错误
   * 会变成运行期崩溃。这类"引用了不存在的东西"正是本脚本最该拦的一类。
   */
  npc: new Set(readIds('data/npcs.ts'))
};

// ——————————————————————————————————————————————————————————————
// 2. 每种内容的字段要求（单一真相：校验脚本与"生成提示词"共用同一份）
// ——————————————————————————————————————————————————————————————

/**
 * 每条内容类型的 schema 描述。
 *
 * ★ 这份描述**同时是"生成提示词"的来源** —— 见 `--explain`。
 * 两处共用一份，是为了避免"提示词里写的要求"和"校验器检查的要求"漂移；
 * 那种漂移会让人对着提示词生成一堆东西、然后被校验器全部退回。
 */
const SCHEMAS = {
  item: {
    label: '物资',
    idPattern: /^[a-z][a-z0-9_]*$/,
    required: {
      id: 'string（小写 + 下划线）',
      name: 'string（中文名，2~6 字最佳）',
      category: `'${CATEGORIES.join("' | '")}'`,
      icon: 'string（图标键，**必须与 id 不同名**也要能认出来）',
      unitWeight: 'number（kg/件，0.05~8）',
      stackLimit: 'number（单槽堆叠上限，1~20）',
      perishable: 'boolean',
      nutrition: 'Partial<{food,water,health,comfort}>（0~3）',
      basePrice: 'number（元，1~400）',
      tags: 'string[]（1~4 个，供分区规则引用）',
      tier: 'number 1~4（1=开局可见，4=稀有）'
    },
    conditional: [{ when: (o) => o.perishable === true, need: 'shelfLifeDays', desc: 'number（天，3~2000）' }],
    ranges: { unitWeight: [0.05, 8], stackLimit: [1, 20], basePrice: [1, 400], tier: [1, 4] }
  },
  nightEvent: {
    label: '夜间事件',
    idPattern: /^n_[a-z0-9_]+$/,
    required: {
      id: 'string（以 n_ 开头）',
      text: 'string（睡前处境，1~2 句，≤60 字）',
      options: 'Array（2~3 条）'
    },
    optionRequired: {
      label: 'string（≤8 字，手机一行放得下）',
      outcome: 'string（选完一句话，可用 {spentCash}）',
      effect: 'NightEffect（见下）'
    },
    /*
     * ★ `when` 是 2026-10 加的**阶段标签**（用户的口径：囤货期是先知的安全期，
     * 不该出现"冻醒""天花板往下坠"这类灾后处境）。
     * 它是**可选**的，而漏标的默认是 `灾后` —— 也就是最严的那一档，
     * 所以漏标只会让内容在囤货期看不到，不会污染它。
     */
    optional: { when: "'平时' | '预兆' | '灾后'（不写 = 灾后。囤货期只抽 平时/预兆）" },
    tier: 'number 1~4'
  },
  dayEvent: {
    label: '白天事件',
    idPattern: /^d_[a-z0-9_]+$/,
    required: {
      id: 'string（以 d_ 开头）',
      text: 'string（门前处境，1~2 句，≤60 字）',
      options: 'Array（2~3 条）'
    },
    optionRequired: {
      label: 'string（≤8 字）',
      outcome: 'string（可用 {spentCash}）',
      effect: 'DayOptionEffect（见下，必须含至少一个"落到玩家身上"的字段）'
    },
    optional: { onlyShops: 'string[]（只在这几个点位出现；不写=任意点位）' },
    tier: 'number 1~4'
  },
  emergency: {
    label: '突发事件',
    idPattern: /^e_[a-z0-9_]+$/,
    required: {
      id: 'string（以 e_ 开头）',
      text: 'string（陈述处境，1~2 句）',
      category: `'${CATEGORIES.join("' | '")}'`,
      needOnHandy: 'number（顺手位上要有几件才算化解，1~6）',
      lost: 'number（没化解时按缺货口径受创的件数，1~4）',
      consumes: 'boolean（可选：化解是否消耗掉那几件）'
    },
    tier: 'number 1~4'
  },
  identity: {
    label: '玩家身份',
    idPattern: /^[a-z][a-z0-9_]*$/,
    required: {
      id: 'string',
      name: 'string（2~4 字）',
      tagline: 'string（一句话人设，≤20 字）',
      startCash: 'number（元，200~2000）',
      vehicleCapacity: 'number（kg/天，10~90）',
      carryLimit: 'number（kg/趟，5~40，必须 ≤ vehicleCapacity）',
      perk: 'string（天赋一句话，≤20 字）',
      perkRule: 'PerkRule（见 data/identities.ts 的现有两条）',
      tier: 'number 1~4'
    }
  },
  disaster: {
    label: '灾难',
    idPattern: /^[a-z][a-z0-9_]*$/,
    required: {
      id: 'string',
      name: 'string（2~4 字）',
      family: "'温度' | '水' | '结构' | '生物' | '社会' | '空气' | '组合'",
      level: "'L2' | 'L3' | 'L4'（L2 至少 6 个维度 / L3 至少 10 / L4 至少 15）",
      axis: 'string（一句话：这一场的压力轴是什么）',
      temperatures: 'Record<day, °C>（至少给 -7 / -4 / -1 / 0 / 3 / 7 / 11 / 14 这 8 天）',
      calendar: 'DayForecast[]（必须覆盖 D-7..D+14 共 22 天且 day 连续，逐日 {day,severity,hint}）',
      dailyDrain: 'Partial<Record<CategoryId, number>>（每日额外消耗权重）',
      priorityCategories: 'CategoryId[]（1~3 个）',
      windowScene: 'string（窗外渲染主题 key）',
      spoilRate: 'number（腐坏倍率：<1 延长 / >1 加速。**必填**，见 D-03）',
      counterIntuitive: 'string（★ 这一场那条"反直觉的侧面"，见 §10B.3.1）',
      decisions: 'string[]（2~4 条，互不重复的"它逼玩家做什么决定"）',
      notes: 'string（写明本场用到了哪些维度编号，便于查同质化）'
    },
    optional: {
      shelterDecayPerDay: 'number（-0.5 ~ -4）',
      restEfficiency: 'number（0.4 ~ 1.2）',
      carryFactor: 'number（0.5 ~ 1.0）',
      actionPointDelta: 'number（-1 ~ +1）',
      shopSupplyFactor: 'number（0.4 ~ 1.0）',
      closedShopIds: 'string[]',
      priceSurcharge: 'number（0 ~ 0.8）',
      eventPoolWeights: 'Record<标签, 倍数>',
      npcVisitFactor: 'number（0 ~ 1.5）',
      categoryEfficiency: 'Record<品类, 乘数>（0.5 ~ 1.5）',
      capacityFactor: 'number（0.5 ~ 1.0）',
      unusableShelfIds: 'string[]',
      healthRiskPerDay: 'number（0 ~ 3）',
      scoreWeights: 'Record<string, number>',
      specialMechanics: "string[]（**需要引擎支持**，见提示词第 6 节）"
    },
    tier: 'number 1~4（1=开局可选 / 2=通关一次 / 3=图鉴进度 / 4=成就解锁）'
  },
  helpRequest: {
    label: '求援订单',
    /**
     * ★★ 这个 schema 曾经**整个是过期的**，2026-10 才修（当时它挡住了第 3 轮内容）。
     *
     * 它原来要求 `validUntilDay` / `rewards` / `declineTrust` / `demands[].itemId` ——
     * 而 `HelpRequestDef`（`src/data/helpRequests.ts`）里**一个都没有**：
     * 活代码读的是 `npcId` / `demands[].category` / `trustGain` / `trustLoss` / `thanks`。
     *
     * 后果有两层，而且都很糟：
     *  ① 校验器把 `demands[].category` 当成 `itemId` 查，于是每条都报
     *     "引用了不存在的物资 'undefined'" —— **报的是它自己看错了字段**；
     *  ② 现有那 6 条的 id 是 `q_` 前缀，**连 `idPattern` 都不匹配**，
     *     所以求援这一类**从来没有被校验过**（`--fresh` 也没用，id 先不过）。
     *
     * 一条永远报错的规则等于没有规则 —— 而且比没有更糟：它会训练人忽略输出。
     * 现在按活类型重写，并把前缀放宽到 `[a-z]`（`q_` 是历史前缀，改它要动存档里的
     * `helpRequest.defId`，代价不值得）。
     */
    idPattern: /^[a-z][a-z0-9_]*_[a-z0-9_]+$/,
    required: {
      id: 'string（`h_` / `h2_` / `q_` 开头都认 —— `q_` 是历史前缀）',
      npcId: 'string（必须是已知 NPC id）',
      text: 'string（门口那句话，1~2 句）',
      demands: '{category,count}[]（1~3 条；**是品类不是 itemId**）',
      trustGain: 'number（交付涨多少人情，1~5）',
      trustLoss: 'number（婉拒扣多少人情，0~5）',
      tier: 'number 1~4'
    },
    optional: {
      thanks: '{cash?,boxDefId?}（对方留下的东西；**不是每单都有**，全靠回报会把门口变成刷分点）'
    }
  },
  shop: {
    label: '囤货期点位（商店）',
    idPattern: /^[a-z][a-z0-9_]*$/,
    required: {
      id: 'string（**不要用 supermarket/pharmacy/hardware**，那三个已存在）',
      name: 'string（2~6 字）',
      blurb: 'string（一句话点位描述，≤30 字，克制、不煽情）',
      priceFactor: 'number（0.6~2.0；低于 1 = 比超市便宜，高于 1 = 更贵）',
      offers: "{itemId,stock}[]（3~14 条；itemId 必须真实存在）",
      specialty: 'string[]（1~3 个品类或标签：**这家店最划算的是什么**）'
    },
    optional: {
      actionCost: 'number（进店花几点行动点，1~3；不写=1。远的店花 2 点但更便宜才有取舍）'
    },
    tier: 'number 1~4'
  }
};

// ——————————————————————————————————————————————————————————————
// 3. 逐条校验
// ——————————————————————————————————————————————————————————————

function checkRange(file, id, field, value, range) {
  const [lo, hi] = range;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(file, id, `${field} 必须是有限数字，实际是 ${JSON.stringify(value)}`);
    return;
  }
  if (value < lo || value > hi) {
    fail(file, id, `${field}=${value} 超出设计区间 [${lo}, ${hi}]（离群值要人工确认）`);
  }
}

/** 校验一条内容。`kind` 决定用哪份 schema */
function checkEntry(file, kind, obj, index) {
  const schema = SCHEMAS[kind];
  if (!schema) return;
  const where = `${schema.label}[${index}]`;

  if (typeof obj !== 'object' || obj === null) {
    fail(file, where, '不是一个对象');
    return;
  }
  const id = typeof obj.id === 'string' ? obj.id : '';
  if (!id) {
    fail(file, where, '缺少 id');
    return;
  }
  if (!schema.idPattern.test(id)) {
    fail(file, id, `id 不符合命名要求 ${schema.idPattern}`);
  }

  // ② 必需字段
  for (const [field, desc] of Object.entries(schema.required)) {
    if (obj[field] === undefined) fail(file, id, `缺少必需字段 ${field}（${desc}）`);
  }
  // 条件字段
  for (const c of schema.conditional ?? []) {
    if (c.when(obj) && obj[c.need] === undefined) {
      fail(file, id, `在 ${c.need} 应存在时缺失（${c.desc}）`);
    }
  }
  // ⑤ 数值区间
  for (const [field, range] of Object.entries(schema.ranges ?? {})) {
    if (obj[field] !== undefined) checkRange(file, id, field, obj[field], range);
  }

  /*
   * ★ 夜间事件的**阶段标签**（2026-10 加）。
   *
   * 它是可选的（不写 = `灾后`，最严的那一档），但**写了就必须是三个已知值之一** ——
   * 否则一个错别字（比如 `'灾侯'`）会让那一条悄悄从囤货期消失，
   * 而"内容没出现"是最难被发现的一类错（没有任何报错、也没有任何现象）。
   */
  if (kind === 'nightEvent' && obj.when !== undefined) {
    if (!['平时', '预兆', '灾后'].includes(obj.when)) {
      fail(file, id, `when='${obj.when}' 不是已知阶段（只许 平时 / 预兆 / 灾后；不写 = 灾后）`);
    }
  }

  // 引用完整性
  if (kind === 'item') {
    if (obj.category !== undefined && !KNOWN.category.has(obj.category)) {
      fail(file, id, `category='${obj.category}' 不是已知品类（${CATEGORIES.join('/')}）`);
    }
    if (!Array.isArray(obj.tags) || obj.tags.length === 0) {
      fail(file, id, 'tags 必须是非空数组（分区规则要靠它引用）');
    }
    if (obj.perishable === true && typeof obj.shelfLifeDays !== 'number') {
      fail(file, id, 'perishable=true 必须有 shelfLifeDays');
    }
    if (obj.perishable === false && obj.shelfLifeDays !== undefined) {
      note(`${id}: perishable=false 却写了 shelfLifeDays —— 确认是否有意`);
    }
  }
  if (kind === 'emergency' && obj.category !== undefined && !KNOWN.category.has(obj.category)) {
    fail(file, id, `category='${obj.category}' 不是已知品类`);
  }
  if (kind === 'helpRequest') {
    /*
     * ★ 这一段原来查的是 `demands[].itemId` —— 而求援的 `demands` 里**没有这个字段**
     * （它是 `{category, count}`），于是每一条都报"引用了不存在的物资 'undefined'"，
     * 而那句报错**指向了错误的地方**（它说的不是内容的问题，是它自己看错了字段）。
     * 现在按活类型查品类与 NPC，并给信任值定区间。
     */
    const npcIds = KNOWN.npc;
    if (typeof obj.npcId !== 'string' || !npcIds.has(obj.npcId)) {
      fail(file, id, `npcId='${obj.npcId}' 不是已知 NPC（${[...npcIds].join('/')}）`);
    }
    const dem = Array.isArray(obj.demands) ? obj.demands : [];
    if (dem.length < 1 || dem.length > 3) {
      fail(file, id, `demands 应为 1~3 条（§11：一次最多要三样），实际 ${dem.length}`);
    }
    for (const [di, d] of dem.entries()) {
      if (!KNOWN.category.has(d?.category)) {
        fail(file, id, `demands[${di}].category='${d?.category}' 不是已知品类（${CATEGORIES.join('/')}）`);
      }
      if (!Number.isFinite(d?.count) || d.count < 1 || d.count > 8) {
        fail(file, id, `demands[${di}].count=${d?.count} 越界（1~8）`);
      }
    }
    if (typeof obj.text !== 'string' || obj.text.trim().length === 0) {
      fail(file, id, 'text 不能为空（门口那句话是玩家唯一的线索）');
    }
    for (const key of ['trustGain', 'trustLoss']) {
      if (!Number.isFinite(obj[key]) || obj[key] < 0 || obj[key] > 5) {
        fail(file, id, `${key}=${obj[key]} 越界（0~5）`);
      }
    }
    /*
     * ★ `thanks` 是可选的（§6.5：回报不该每单都有），但**给了就必须能兑现**：
     * `boxDefId` 认不出来时 `getBoxDef` 会抛，而那一下发生在玩家点"凑单"的时候。
     */
    if (obj.thanks !== undefined) {
      const t = obj.thanks;
      if (t?.boxDefId !== undefined && !KNOWN.box.has(t.boxDefId)) {
        fail(file, id, `thanks.boxDefId='${t.boxDefId}' 不是已知箱型（${BOX_IDS.join('/')}）`);
      }
      if (t?.cash !== undefined && (!Number.isFinite(t.cash) || t.cash < 0 || t.cash > 400)) {
        fail(file, id, `thanks.cash=${t.cash} 越界（0~400）`);
      }
    }
  }
  if (kind === 'disaster') {
    const cal = Array.isArray(obj.calendar) ? obj.calendar : [];
    if (cal.length > 0) {
      if (cal.length !== 22) {
        fail(file, id, `calendar 应覆盖 D-7..D+14 共 22 天，实际 ${cal.length} 天`);
      }
      /**
       * ★ **day 必须连续**（-7, -6, …, 14）。
       * 只查长度不够：漏掉 D+7 再补一条 D+16 也是 22 条，而先知日历会缺一天 ——
       * 那天界面会显示空白，玩家会以为自己的游戏坏了。
       */
      const days = cal.map((d) => d?.day).sort((a, b) => a - b);
      for (let i = 0; i < days.length; i++) {
        if (days[i] !== -7 + i) {
          fail(file, id, `calendar 的 day 不连续：第 ${i + 1} 天应是 ${-7 + i}，实际 ${days[i]}`);
          break;
        }
      }
      for (const [ci, d] of cal.entries()) {
        if (typeof d?.hint !== 'string' || d.hint.length === 0) {
          fail(file, id, `calendar[${ci}] 缺少 hint`);
        } else if (d.hint.length > 30) {
          // ≤30 字是"先知日历一行"的排版约束（手机竖屏）
          fail(file, id, `calendar[${ci}].hint 超过 30 字（${d.hint.length}）：先知日历一行放不下`);
        }
        if (typeof d?.severity !== 'number' || d.severity < 0 || d.severity > 1) {
          fail(file, id, `calendar[${ci}].severity 必须是 0~1 的数字`);
        }
      }
    }
    if (typeof obj.spoilRate !== 'number') {
      fail(file, id, 'spoilRate 必须显式给出（D-03：腐坏是灾难的属性，不许默认）');
    }
    const temps = obj.temperatures;
    if (typeof temps !== 'object' || temps === null) {
      fail(file, id, 'temperatures 必须是逐日温度表');
    } else {
      const KEY_DAYS = [-7, -4, -1, 0, 3, 7, 11, 14];
      const missing = KEY_DAYS.filter((d) => typeof temps[d] !== 'number');
      if (missing.length > 0) {
        fail(file, id, `temperatures 缺少关键日 ${missing.join('/')}（程序按最近一档插值，缺了会显示 0°C）`);
      }
    }
    /**
     * ★★ **反直觉侧面**与**取舍列表**是 §10B.3 的硬要求。
     *
     * 为什么把"反直觉"做成必填：一个和"这场灾难很糟"直接推导出来的效果只是数字；
     * 一个没人会立刻想到、但想通后觉得"确实如此"的效果才是设计。
     * 把它变成必填字段，是为了逼生成者**每一场都想一次** ——
     * 不填的场次会退回，而不是变成一百场"更冷/更热"。
     */
    if (typeof obj.counterIntuitive !== 'string' || obj.counterIntuitive.length < 6) {
      fail(file, id, 'counterIntuitive 必填：写清"这一场那条反直觉的侧面"（见提示词第 1.3 节）');
    }
    const decisions = Array.isArray(obj.decisions) ? obj.decisions : [];
    if (decisions.length < 2 || decisions.length > 4) {
      fail(file, id, `decisions 需要 2~4 条，实际 ${decisions.length}`);
    }
    if (new Set(decisions).size !== decisions.length) {
      fail(file, id, 'decisions 里有重复条目（同一场里不许有两个一样的取舍）');
    }
    if (typeof obj.notes !== 'string' || obj.notes.length === 0) {
      fail(file, id, 'notes 必填：写明本场用到了哪些维度编号（查同质化要用它）');
    }
  }
  if (kind === 'shop') {
    /*
     * 商店的校验重点是**"它和别的店重不重合"**（§6.2 的设计口径）。
     *
     * 一家"卖的东西和超市一样、价钱也一样"的店是**纯冗余** ——
     * 玩家多花 1 个行动点却没有任何取舍。这类内容 AI 最容易生成，
     * 因为它看起来很合理（"再开一家便利店吧"）。
     */
    const offers = Array.isArray(obj.offers) ? obj.offers : [];
    if (offers.length < 3) fail(file, id, `offers 至少 3 条，实际 ${offers.length}（太少的店没有存在感）`);
    /*
     * ★★ 上限从 14 抬到 20（2026-10），而这是一次**容量算出来**的调整，不是放宽标准。
     *
     * 起因：新增的常驻用例要求"每一件物资都至少有一家店在卖"，而
     * 物资 **121** 件、9 家 × 14 = **126** 个坑位 —— 再去掉"每家至少 3 条"的
     * 24 个下限，可用坑位只剩 102，**装不下**。算下来的缺口是 2 个坑。
     *
     * 所以不是"内容写坏了"，是**这个上限从来没跟物资数一起算过**：
     * 它在 §10B.6 里是一个内容评审的数值区间，用来防"一家店什么都卖"。
     * 而 121 件物资分给 9 家店，平均就是 13.4 条 —— 14 这个数在物资变多之后
     * 必然卡住。抬到 20 仍然能防住"什么都卖"（那要靠人来评审），
     * 而容量够了。
     *
     * ⚠ 下层 3 条不放宽：那是"这家店得有东西可买"，与容量无关。
     */
    if (offers.length > 20) fail(file, id, `offers 最多 20 条，实际 ${offers.length}（§10B.6 的数值区间，2026-10 由 14 抬到 20）`);
    for (const [oi, o] of offers.entries()) {
      if (!KNOWN.item.has(o?.itemId)) {
        fail(file, id, `offers[${oi}] 引用了不存在的物资 '${o?.itemId}'`);
      }
      checkRange(file, id, `offers[${oi}].stock`, o?.stock, [1, 30]);
    }
    if (Array.isArray(obj.specialty) && obj.specialty.length === 0) {
      fail(file, id, 'specialty 不能是空数组（要写清这家店最划算的是什么）');
    }
    checkRange(file, id, 'priceFactor', obj.priceFactor, [0.6, 2.0]);
    if (obj.actionCost !== undefined) checkRange(file, id, 'actionCost', obj.actionCost, [1, 3]);
  }
  if (kind === 'identity') {
    if (typeof obj.carryLimit === 'number' && typeof obj.vehicleCapacity === 'number' && obj.carryLimit > obj.vehicleCapacity) {
      fail(file, id, `carryLimit(${obj.carryLimit}) 不该大于 vehicleCapacity(${obj.vehicleCapacity})`);
    }
    if (obj.perkRule === undefined) fail(file, id, 'perkRule 不能省略 —— 天赋必须真的有效果');
  }

  // 事件：选项
  if (kind === 'nightEvent' || kind === 'dayEvent') {
    const opts = Array.isArray(obj.options) ? obj.options : [];
    if (opts.length < 2 || opts.length > 3) {
      fail(file, id, `选项数应为 2~3，实际 ${opts.length}（§11：选项 ≤3）`);
    }
    /**
     * ★★ 这一条是 M2 用玩家真金白银换来的：**每个选项必须给玩家真实收获**。
     *
     * 判据的来龙去脉（别把它简化回去）：
     *  · 最早的要求是"至少命中一个落到玩家身上的效果"。玩家一句
     *    *"我结了账没拿到货？？？"* 把它的漏洞指了出来 ——
     *    `stamina: -4` 也算"落到玩家身上"，于是一条**只有惩罚**的选项能过；
     *  · 所以改成"必须净收益为正"。**注意"睡觉 +4 体力"是收益** ——
     *    休息本身就是那个选项的意义，把它判成"只有代价"是判据写错了
     *    （第一版就是这么错的，被自己的样例抓出来）。
     *
     * 一句话：**净变化必须为正**，且不能是"改商店"（那是处境不是奖励）。
     */
    const PLAYER_FACING = ['cash', 'health', 'mood', 'stamina', 'shelter', 'grab', 'boxDefId'];
    /*
     * ★★ 效果字段白名单 —— 这一层是 2026-10 补的，因为**同一个错我犯了两次**。
     *
     * 白天与夜间是**两套不同的效果类型**，而它们只差几个字段：
     *
     *   `DayOptionEffect`  cash / priceUp / stockCut / limit / grab / boxDefId / stamina / mood / visitLost
     *   `NightEffect`      cash / health / mood / stamina / shelter / boxDefId
     *
     * 于是凭印象写就会把 `shelter` 写进白天事件（我第 2 轮写了一次 `health`、
     * 第 5 轮写了四次 `shelter`/`health`）。而**唯一的防线是 `tsc`** ——
     * 那意味着必须先 `merge-content` 入库才看得见，而那时表已经被写脏了。
     *
     * 这一层补上之后，**入库前**就会报"白天事件没有 shelter 这个字段"。
     * 报错信息里同时给出两边各有哪些字段 —— 因为这两套的差别正是坑本身。
     */
    const EFFECT_FIELDS_BY_KIND = {
      dayEvent: ['cash', 'priceUp', 'stockCut', 'limit', 'grab', 'boxDefId', 'stamina', 'mood', 'visitLost'],
      nightEvent: ['cash', 'health', 'mood', 'stamina', 'shelter', 'boxDefId']
    };
    const allowedEffects = EFFECT_FIELDS_BY_KIND[kind] ?? [];
    for (const [oi, opt] of opts.entries()) {
      for (const key of Object.keys(opt?.effect ?? {})) {
        if (!allowedEffects.includes(key)) {
          const other = kind === 'dayEvent' ? EFFECT_FIELDS_BY_KIND.nightEvent : EFFECT_FIELDS_BY_KIND.dayEvent;
          fail(
            file,
            id,
            `选项[${oi}]「${opt?.label ?? '?'}」的 effect.${key} 在${kind === 'dayEvent' ? '白天' : '夜间'}事件里不存在。\n` +
              `      ${kind === 'dayEvent' ? '白天' : '夜间'}有：${allowedEffects.join(' / ')}\n` +
              `      ${other.includes(key) ? `「${key}」是${kind === 'dayEvent' ? '夜间' : '白天'}事件才有的字段 —— 两套类型只差几个字段，最容易混的就是它` : '两边都没有这个字段'}`
          );
        }
      }
    }
    for (const [oi, opt] of opts.entries()) {
      const eff = opt?.effect ?? {};
      const hits = PLAYER_FACING.filter((k) => eff[k] !== undefined);
      const numericGain =
        (eff.cash ?? 0) + (eff.health ?? 0) + (eff.mood ?? 0) + (eff.stamina ?? 0) + (eff.shelter ?? 0);
      const gains = numericGain > 0 || eff.grab !== undefined || eff.boxDefId !== undefined;
      if (hits.length === 0) {
        fail(file, id, `选项[${oi}]「${opt?.label ?? '?'}」没有任何落到玩家身上的效果`);
      } else if (!gains) {
        fail(
          file,
          id,
          `选项[${oi}]「${opt?.label ?? '?'}」净收益不为正（数值合计 ${numericGain}，也没有拿到货）—— ` +
            `只有代价的选项不许有（§10B.7）`
        );
      }
      if (typeof opt?.label === 'string' && opt.label.length > 8) {
        fail(file, id, `选项[${oi}] label「${opt.label}」超过 8 字（手机竖屏一行放不下）`);
      }
      // 引用悬空
      if (eff.grab?.category !== undefined && !KNOWN.category.has(eff.grab.category)) {
        fail(file, id, `选项[${oi}] grab.category='${eff.grab.category}' 不是已知品类`);
      }
      if (eff.stockCut?.category !== undefined && !KNOWN.category.has(eff.stockCut.category)) {
        fail(file, id, `选项[${oi}] stockCut.category='${eff.stockCut.category}' 不是已知品类`);
      }
      if (eff.limit?.category !== undefined && !KNOWN.category.has(eff.limit.category)) {
        fail(file, id, `选项[${oi}] limit.category='${eff.limit.category}' 不是已知品类`);
      }
      if (eff.boxDefId !== undefined && !KNOWN.box.has(eff.boxDefId)) {
        fail(file, id, `选项[${oi}] boxDefId='${eff.boxDefId}' 不是已知箱型（${BOX_IDS.join('/')}）`);
      }
      checkRange(file, id, `选项[${oi}].effect.cash`, eff.cash ?? 0, [-400, 400]);
    }
  }
}

/** 一批生成物或一张现有表的容器格式 */
function checkBatch(file, data) {
  if (typeof data !== 'object' || data === null) {
    fail(file, '(根)', 'JSON 根必须是对象');
    return [];
  }
  const kind = data.kind;
  if (typeof kind !== 'string' || !SCHEMAS[kind]) {
    fail(
      file,
      '(根)',
      `缺少 kind 或它不认识。应为：${Object.keys(SCHEMAS).join(' / ')}`
    );
    return [];
  }
  const entries = data.entries;
  if (!Array.isArray(entries)) {
    fail(file, '(根)', 'missing entries 数组');
    return [];
  }
  // ① 重复 id（批内）
  const seen = new Map();
  for (const [i, e] of entries.entries()) {
    checkEntry(file, kind, e, i);
    const id = e?.id;
    if (typeof id === 'string') {
      // 只记第一次出现的位置，否则报出来的"第几条"会指向后一次（指错位置比不报更糟）
      if (seen.has(id)) fail(file, id, `批内重复 id（第 ${seen.get(id) + 1} 条与第 ${i + 1} 条）`);
      else seen.set(id, i);
      /*
       * 与现有表冲突 —— **只在"这是新批次"时才该判不合格**。
       *
       * ★ 这一条原来是无条件判的，于是产生了一个很别扭的后果：
       * **已经入库的那批内容，再也不能被重新校验了**（它当然"已存在"）。
       * 而"重新校验一次看看有没有坏"正是最常用的动作，也是入库前最后一次自查。
       * 一条会让常见正确操作失败的工具，最后会被人绕过 —— 那比没有检查更糟。
       *
       * 所以分成两种：
       *   · 默认（`--fresh` 未给）：已存在**只提示**，不算不合格；
       *   · `--fresh`（专门用来审"新交来的一批"）：按冲突判不合格。
       */
      const existing = {
        item: ITEM_IDS,
        nightEvent: NIGHT_IDS,
        dayEvent: DAY_IDS,
        emergency: EMERGENCY_IDS,
        identity: IDENTITY_IDS,
        disaster: DISASTER_IDS,
        helpRequest: HELP_IDS,
        shop: SHOP_IDS
      }[kind];
      if (existing?.includes(id)) {
        if (FRESH) fail(file, id, `与现有内容表冲突（该 id 已存在）`);
        else notes.push(`${file} · ${id}：这个 id 已经在表里了（按"重新校验已入库的批次"处理）`);
      }
    }
  }
  return entries.map((e) => e?.id).filter((x) => typeof x === 'string');
}

// ——————————————————————————————————————————————————————————————
// 4. 入口
// ——————————————————————————————————————————————————————————————

function explain() {
  console.log('# 《囤货末世》内容格式要求（给生成模型）\n');
  console.log('输出格式：一个 JSON 对象，`kind` 说明这是哪类内容，`entries` 是内容数组。\n');
  console.log('```json');
  console.log(JSON.stringify({ kind: 'nightEvent', entries: [{ id: 'n_example', text: '…', options: [] }] }, null, 2));
  console.log('```\n');
  for (const [kind, s] of Object.entries(SCHEMAS)) {
    console.log(`## kind: \`${kind}\` —— ${s.label}\n`);
    console.log('| 字段 | 要求 |');
    console.log('| --- | --- |');
    for (const [f, d] of Object.entries(s.required)) console.log(`| \`${f}\` | ${d} |`);
    if (s.optionRequired) {
      console.log('\n每条 `options[]`：\n');
      console.log('| 字段 | 要求 |');
      console.log('| --- | --- |');
      for (const [f, d] of Object.entries(s.optionRequired)) console.log(`| \`${f}\` | ${d} |`);
    }
    if (s.tier) console.log(`\n另外每条都要有 \`tier\`：${s.tier}`);
    console.log('');
  }
}

const args = process.argv.slice(2);
if (args.includes('--explain')) {
  explain();
  process.exit(0);
}

const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  // 无参数 = 自检：把现有表当"内容"读一遍，确认已知 id 之间没有冲突
  console.log('[check-content] 现有内容表规模：');
  const tables = [
    ['物资 items', ITEM_IDS],
    ['箱型 boxes', BOX_IDS],
    ['灾难 disaster', DISASTER_IDS],
    ['夜间事件', NIGHT_IDS],
    ['白天事件', DAY_IDS],
    ['突发事件', EMERGENCY_IDS],
    ['求援订单', HELP_IDS],
    ['身份', IDENTITY_IDS],
    ['点位（商店）', SHOP_IDS]
  ];
  for (const [label, ids] of tables) console.log(`  ${label.padEnd(16)} ${ids.length} 条`);
  const dupes = [];
  for (const [label, ids] of tables) {
    const s = new Set();
    for (const id of ids) {
      if (s.has(id)) dupes.push(`${label}: ${id}`);
      s.add(id);
    }
  }
  if (dupes.length > 0) fail('现有表', '(自检)', `重复 id：${dupes.join('、')}`);
  note('这个脚本的真正用途是校验**待入库的生成物**：node scripts/check-content.mjs content/*.json');
} else {
  for (const f of files) {
    /**
     * ★ 路径解析踩过的两个坑（都会让工具报"文件不存在"，而文件明明在那儿）：
     *
     *  ① `join(process.cwd(), 'C:/…')` 在 Windows 上会拼成
     *     `D:\…\GameToQQ\C:\…` —— `path.join` 不认"参数是绝对路径"这件事，
     *     只有 `path.resolve` 认。生成物的目录常常在仓库外面（桌面、下载目录），
     *     所以这条一定会被踩到；
     *  ② 相对路径按**仓库根**解析，而不是 `process.cwd()`。
     *     否则同一条命令在根目录跑得通、在 `scripts/` 里跑就报不存在 ——
     *     而这种"换个目录就坏"的工具，会让人以为是自己文件写错了。
     */
    const abs = isAbsolute(f) ? f : join(root, f);
    if (!existsSync(abs)) {
      fail(basename(abs), '(文件)', `不存在：${abs}`);
      continue;
    }
    let data;
    try {
      // 允许 .json，也允许 .jsonl 之外的单文件对象
      data = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (e) {
      fail(basename(abs), '(解析)', `不是合法 JSON：${e.message}`);
      continue;
    }
    const ids = checkBatch(basename(abs), data);
    console.log(`[check-content] ${basename(abs)}：${ids.length} 条`);
  }
}

if (notes.length > 0) {
  console.log('');
  for (const n of notes) console.log(`[提示] ${n}`);
}

if (problems.length > 0) {
  console.error(`\n[check-content] ★ ${problems.length} 处不合格：\n`);
  for (const p of problems) console.error(`  ✗ ${p.file} · ${p.where}：${p.message}`);
  console.error(
    '\n  要求详见：node scripts/check-content.mjs --explain\n' +
      '  或 docs/囤货末世-游戏策划案.md §10B.5 / §10B.7'
  );
  process.exit(1);
}
console.log('[check-content] 全部合格');
