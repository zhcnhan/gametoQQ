/**
 * 突发事件表（§5 的另一半，M2 §12 拍板 v0.9）。
 *
 * ## 它在补齐什么
 *
 * §5 的整理收益清单里有一条一直悬着：
 *
 *   > 应急货架（门口/最顺手位）放急救品 → **突发事件不掉健康**
 *
 * M1 阶段 F 把"顺手位"落地成了 `Shelf.handyRank`，§6.3 的应急可达率也算了分，
 * 但那个分数**没有下游** —— 它是印在结算页上的一个百分比，玩家体会不到。
 * 这张表就是它的下游：应急可达率从"分数"变成"战力"的最后一环
 * （D-06 的残留，M2 清偿）。
 *
 * ## 为什么它不是选项题
 *
 * 夜间事件与白天事件都是"文本 + 选项 + 后果"，这里是**检查题**：
 * 事情发生的那一刻，玩家没有第二次决定的机会 —— 他早就在整理期决定过了。
 * 这正是 §5 那句话的力量所在（"放急救品"是一个**之前**做的动作）。
 * 所以它的形态是：陈述处境 → 顺手位上有没有 → 有就化解，没有就按缺货口径受创。
 *
 * ## 两条文案纪律
 *
 *  1. **陈述处境，不演惩罚**（M2 提示词原文：「做成"陈述处境"而不是惩罚演出」）：
 *     写"炉子熄了，屋里的温度在往下掉"，不写"你失败了，健康 -6"；
 *  2. 1~2 句，不写台词腔、不煽情（§11）。
 *
 * ## 低频是刻意的
 *
 * 夜间事件约 60% 的夜晚有事，突发事件要**更低**（见 `EMERGENCY_NONE_WEIGHT`）：
 * 它要像意外，不能像日程。种子化决定哪一天有事、是哪一件。
 */
import type { EmergencyDef } from '../model/types';

/**
 * "今天有事"的概率（抽签池里的一个虚拟条目）。
 *
 * ★ 它与 `data/dayEvents.ts` 的 `DAY_EVENT_CHANCE` 是**同一类修正**，
 * 而这里踩的坑更典型 —— 原来的写法是一个**手算出来的权重常数**：
 *
 * ```
 * EMERGENCY_NONE_WEIGHT = 16.3   // 注释写着"7 条事件各权重 1 → 7 / 23.3 ≈ 30%"
 * ```
 *
 * 那个 `16.3` 的正确性完全依赖"表里恰好 7 条事件"。M3 把突发事件从
 * 7 条加到 28 条，同一个常数让有事概率变成 **63%** —— 突发事件从"像意外"
 * 变成"像日程"，而**没有任何代码或类型会报错**。
 *
 * 所以改成概率口径：设计意图写在概率上，"没事"那一格的权重由当次池子反推。
 *
 * 为什么是 30% 而不是夜间事件那种 60%：突发事件**不掉健康就是掉健康**，
 * 它没有"选一个温和的选项"这条路。夜间事件是"今晚要不要去顶班"（玩家有话说），
 * 突发是"炉子熄了"（玩家没话说）—— 同一频率下，后者的疲劳感要重得多。
 *
 * 为什么用权重而不是"先掷一次概率再抽事件"：一次抽签只有一个 RNG 消耗点，
 * 所以"某一天有没有事"在整个存档里只依赖一个数，回放与调试都更容易对账。
 */
export const EMERGENCY_CHANCE = 0.3;

/**
 * 抽签池里"今天没事"那一格的权重，由 `EMERGENCY_CHANCE` 与当次池子反推。
 *
 * @param poolWeight 这一次实际参与抽签的事件权重合计
 */
export function emergencyNoneWeight(poolWeight: number): number {
  if (!(poolWeight > 0)) return 1;
  return (poolWeight * (1 - EMERGENCY_CHANCE)) / EMERGENCY_CHANCE;
}

/**
 * 突发事件的池子。
 *
 * 每一条都必须**能被顺手位化解**，而且化解物必须是玩家在囤货期真的会买的东西 ——
 * 若某条事件要的是一个玩家根本不会囤的品类，那它就不是检查题，是随机扣血。
 */
export const EMERGENCY_DEFS: readonly EmergencyDef[] = [
  {
    id: 'e_cut_hand',
    text: '拆木箱的时候手滑了一下，虎口拉开一道口子。',
    category: 'medicine',
    needOnHandy: 1,
    lost: 1,
    tier: 1
    // 不写 consumes：用掉的绷带由每日结算的自动补给去消耗（跌破 70 才动），
    // 这里再扣一次会让同一卷绷带被算两遍
  },
  {
    id: 'e_stove_out',
    text: '炉子熄了。凑近听，罐子已经空了。',
    category: 'fuel',
    needOnHandy: 1,
    lost: 2,
    consumes: true,
    tier: 1
  },
  {
    id: 'e_pipe_burst',
    text: '水管冻裂了，水顺着墙往下淌。',
    category: 'tool',
    needOnHandy: 1,
    lost: 2,
    tier: 1
  },
  {
    id: 'e_fever',
    text: '后半夜开始发冷，天亮时额头是烫的。',
    category: 'medicine',
    needOnHandy: 2,
    lost: 2,
    tier: 1
  },
  {
    id: 'e_window_gap',
    text: '风把窗缝吹开了。屋里那点热气正往外跑。',
    category: 'warmth',
    needOnHandy: 1,
    lost: 1,
    tier: 1
  },
  {
    id: 'e_water_frozen',
    text: '存的水冻成了整块。要喝得先凿。',
    category: 'fuel',
    needOnHandy: 1,
    lost: 1,
    consumes: true,
    tier: 1
  },
  {
    id: 'e_rat_in_box',
    text: '纸箱底被咬开一个洞。里面剩下什么，得翻出来才知道。',
    category: 'tool',
    needOnHandy: 1,
    lost: 1,
    tier: 1
  },
  // ═══ 生成内容 突发-01 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "e_weevils",
    text: "米袋里爬出几只米虫。整袋米都得翻一遍。",
    category: "food",
    needOnHandy: 1,
    lost: 1,
    consumes: false,
    tier: 1,
    decision: "整理期主食放没放在密封分区，顺手位留没留备用口粮"
  },
{
    id: "e_soup_burn",
    text: "晚饭烧糊了。锅底一层黑，今天这顿得拿存货补上。",
    category: "food",
    needOnHandy: 2,
    lost: 1,
    consumes: true,
    tier: 1,
    decision: "顺手位留没留能直接吃的即食存货"
  },
{
    id: "e_hungry_gnaw",
    text: "半夜饿醒了。你不想生火，只想抓一样能直接吃的东西。",
    category: "food",
    needOnHandy: 2,
    lost: 1,
    consumes: true,
    tier: 1,
    decision: "即食类主食放没放在伸手能够到的地方"
  },
{
    id: "e_kettle_empty",
    text: "想烧水泡药，水壶是空的。存水在阳台，天已经黑了。",
    category: "water",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 1,
    decision: "饮用水放没放在屋里顺手位，还是全堆在阳台"
  },
{
    id: "e_dust_water",
    text: "停水了半天。来水时先放出来的是一股黄汤，要放很久才清。",
    category: "water",
    needOnHandy: 4,
    lost: 2,
    consumes: false,
    tier: 1,
    decision: "干净存水的量够不够撑过水质反复的这几天"
  },
{
    id: "e_thirsty_night",
    text: "夜里渴醒。你摸黑找水，碰倒了一只空瓶。",
    category: "water",
    needOnHandy: 2,
    lost: 1,
    consumes: true,
    tier: 1,
    decision: "睡前床头放没放能直接喝的水"
  },
{
    id: "e_splinter",
    text: "拆箱子时一根木刺扎进了指缝。不深，但一直在疼。",
    category: "medicine",
    needOnHandy: 1,
    lost: 1,
    consumes: false,
    tier: 1,
    decision: "小药箱放没放在门口顺手位"
  },
{
    id: "e_headache_night",
    text: "后半夜头开始疼。你翻遍三个抽屉才想起药在哪。",
    category: "medicine",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 1,
    decision: "常用药集中放一处，还是分散塞在各个抽屉"
  },
{
    id: "e_allergy",
    text: "胳膊上起了一片疹子。可能是白天搬货蹭到了什么。",
    category: "medicine",
    needOnHandy: 2,
    lost: 2,
    consumes: true,
    tier: 1,
    decision: "外用药和口服药分没分区，顺手位有没有留"
  },
{
    id: "e_heater_click",
    text: "取暖器按了三次才打着。火苗比平时小了一圈。",
    category: "fuel",
    needOnHandy: 2,
    lost: 2,
    consumes: true,
    tier: 1,
    decision: "燃料放没放在炉子边上，还是要穿过整个屋子去搬"
  },
{
    id: "e_cold_snap_extra",
    text: "温度比预报又掉了两度。今晚得比计划多烧一档。",
    category: "fuel",
    needOnHandy: 4,
    lost: 3,
    consumes: true,
    tier: 1,
    decision: "囤货时按预报囤的，还是按更坏一档囤的"
  },
{
    id: "e_canister_rust",
    text: "搬燃料罐时闻到一股味。罐口的密封圈老化了。",
    category: "fuel",
    needOnHandy: 1,
    lost: 2,
    consumes: false,
    tier: 1,
    decision: "燃料罐立着放在通风分区，还是压在了箱子底下"
  },
{
    id: "e_quilt_damp",
    text: "被子摸上去是潮的。这屋子的湿气一天比一天重。",
    category: "warmth",
    needOnHandy: 3,
    lost: 2,
    consumes: false,
    tier: 1,
    decision: "保暖物资有没有垫高存放，还是直接贴地码着"
  },
{
    id: "e_sock_wet",
    text: "袜子晾了两天还没干。脚上这双是最后一双干的。",
    category: "warmth",
    needOnHandy: 1,
    lost: 1,
    consumes: false,
    tier: 1,
    decision: "贴身的保暖件数留没留换洗余量"
  },
{
    id: "e_draft_door",
    text: "门缝底下的风一阵阵灌进来。拖鞋边上一圈是凉的。",
    category: "warmth",
    needOnHandy: 3,
    lost: 2,
    consumes: false,
    tier: 1,
    decision: "门缝窗缝这些漏点，整理期拿旧织物堵没堵"
  },
{
    id: "e_flashlight_dead",
    text: "手电按了两下才亮，光很黄。电池该换了。",
    category: "tool",
    needOnHandy: 1,
    lost: 1,
    consumes: true,
    tier: 1,
    decision: "备用电池和电器放在同一个分区，还是分开两处"
  },
{
    id: "e_tape_gone",
    text: "想找胶带固定纸箱，胶带座是空的。最后一卷不知道塞哪了。",
    category: "tool",
    needOnHandy: 3,
    lost: 2,
    consumes: false,
    tier: 1,
    decision: "高频小工具留没留在顺手位，还是用完随手一塞"
  },
{
    id: "e_toolbox_buried",
    text: "想拧两颗螺丝固定晃的货架，工具箱压在了米袋后面。",
    category: "tool",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 1,
    decision: "工具箱放没放在大件外面"
  },
{
    id: "e_niece_birthday",
    text: "外甥女生日。你想找一样拿得出手的小东西当礼物。",
    category: "luxury",
    needOnHandy: 1,
    lost: 1,
    consumes: true,
    tier: 1,
    decision: "拿得出手的东西收没收到能立刻找到的地方"
  },
{
    id: "e_bad_day",
    text: "今天什么都不顺。你只想找点能让自己缓一缓的东西。",
    category: "luxury",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 1,
    decision: "慰藉品放没放在伸手可及的地方，还是压在了箱底"
  },
{
    id: "e_barter_ask",
    text: "楼下传话，想拿两罐燃料换一样不顶用但讨人喜欢的东西。你翻出一件递下去，过了一会儿人又上来了，把一罐煤油放在门口。",
    category: "luxury",
    needOnHandy: 2,
    lost: 1,
    consumes: true,
    thanks: { itemId: "lamp_oil", count: 1 },
    tier: 1,
    decision: "奢侈品留没留可以出手的富余"
  },
  // ═══ 生成内容 突发-01 止 ═══,
  // ═══ 生成内容 突发-02 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "e_pantry_moth",
    text: "橱柜深处飞出一只灰蛾子。你想起上次那袋面就是这么没的。",
    category: "food",
    needOnHandy: 1,
    lost: 1,
    consumes: false,
    tier: 1,
    decision: "主食有没有密封、顺手位有没有留一份备用口粮"
  },
{
    id: "e_flour_damp",
    text: "墙根返潮，最底下那袋粉结成了硬块。",
    category: "food",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 2,
    decision: "怕潮的东西有没有垫高、有没有把耐放的与怕放的分开"
  },
{
    id: "e_can_dent",
    text: "搬箱子时磕了一下，有几罐的接缝处鼓起来了。",
    category: "food",
    needOnHandy: 2,
    lost: 1,
    consumes: true,
    tier: 2,
    decision: "罐头够不够多到可以丢掉几罐而不心疼"
  },
{
    id: "e_oil_rancid",
    text: "开盖闻到一股旧油味，那桶油放得太靠暖气片了。",
    category: "food",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 3,
    decision: "怕热的油有没有放到阴凉那一格"
  },
{
    id: "e_pipe_freeze",
    text: "早上拧开龙头，只有一声空响。管子冻住了。",
    category: "water",
    needOnHandy: 3,
    lost: 2,
    consumes: false,
    tier: 2,
    decision: "水有没有按\"够喝几天\"备而不是\"够喝今天\""
  },
{
    id: "e_bottle_crack",
    text: "一整提水的塑料膜破了，有两瓶在楼道里冻裂。",
    category: "water",
    needOnHandy: 3,
    lost: 2,
    consumes: true,
    tier: 1,
    decision: "水这个品类够不够经得起一次损耗"
  },
{
    id: "e_water_mold",
    text: "储水桶内壁起了一层滑腻的东西，闻着不对。",
    category: "water",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 3,
    decision: "储水有没有轮换、有没有把\"先买的先用\"当真"
  },
{
    id: "e_med_expired",
    text: "翻药盒时发现一整排都过期了，盒子上的日期是去年。",
    category: "medicine",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 2,
    decision: "药有没有按效期排、有没有在用之前看过日期"
  },
{
    id: "e_med_crushed",
    text: "药盒被压在最底下，铝箔全皱了，有几片露在外面。",
    category: "medicine",
    needOnHandy: 2,
    lost: 2,
    consumes: true,
    tier: 2,
    decision: "急救品有没有放在拿得到、压不着的地方"
  },
{
    id: "e_infection_night",
    text: "伤口周围红了一圈，摸着发烫。你翻出药盒，手有点抖。",
    category: "medicine",
    needOnHandy: 3,
    lost: 3,
    consumes: true,
    tier: 3,
    decision: "医疗那格够不够厚到能应付一次真的感染"
  },
{
    id: "e_stove_clog",
    text: "炉子的喷嘴堵了，火苗忽大忽小，屋里飘着一股没烧净的味道。",
    category: "fuel",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 2,
    decision: "燃料有没有备用、有没有留一件能替换的"
  },
{
    id: "e_kerosene_leak",
    text: "储物角有一股刺鼻味 —— 有一桶燃料在慢慢渗。",
    category: "fuel",
    needOnHandy: 3,
    lost: 2,
    consumes: false,
    tier: 3,
    decision: "燃料有没有独立存放、有没有垫托盘"
  },
{
    id: "e_ash_vent",
    text: "炉子的排烟口积了灰，屋里飘着一层薄薄的烟。",
    category: "fuel",
    needOnHandy: 3,
    lost: 3,
    consumes: true,
    tier: 3,
    decision: "烧得多的那些天，有没有想过炉子本身也要维护"
  },
{
    id: "e_wet_wood",
    text: "屋檐下的柴受了潮，点着只冒烟不出火。",
    category: "fuel",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 1,
    decision: "有没有留一件\"一定点得着\"的引火物"
  },
{
    id: "e_window_seep",
    text: "风从窗缝里钻进来，桌上的水杯表面结了一层薄冰。",
    category: "warmth",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 2,
    decision: "保暖那一格够不够堵住一个漏风的窗"
  },
{
    id: "e_mattress_mildew",
    text: "褥子底下起了一片黑斑，凑近闻有股闷味。",
    category: "warmth",
    needOnHandy: 3,
    lost: 2,
    consumes: false,
    tier: 3,
    decision: "铺盖有没有定期离地翻晒、有没有留一套干爽的替换"
  },
{
    id: "e_heat_lost",
    text: "暖宝宝整盒都硬成一块了。可能是受潮，也可能本来就是存货。",
    category: "warmth",
    needOnHandy: 3,
    lost: 2,
    consumes: true,
    tier: 2,
    decision: "一次性取暖品够不够多到能损耗一批"
  },
{
    id: "e_battery_dead",
    text: "手电按了两下，光只亮了一瞬。电池到底还是没电了。",
    category: "tool",
    needOnHandy: 2,
    lost: 1,
    consumes: true,
    tier: 1,
    decision: "电池那一格有没有留够、有没有按型号分开"
  },
{
    id: "e_tape_lost",
    text: "你翻遍抽屉也没找到那卷胶带，窗缝还在漏风。",
    category: "tool",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 2,
    decision: "常用的小工具是不是放在固定、拿得到的地方"
  },
{
    id: "e_rope_needed",
    text: "楼下的东西太重，一个人抬不上来，得捆一下再拖。",
    category: "tool",
    needOnHandy: 3,
    lost: 2,
    consumes: false,
    tier: 3,
    decision: "有没有备那种\"平时用不上、缺了过不去\"的东西"
  },
{
    id: "e_treat_ants",
    text: "糖罐外面爬了一圈蚂蚁，旁边的点心也遭了殃。",
    category: "luxury",
    needOnHandy: 1,
    lost: 1,
    consumes: false,
    tier: 1,
    decision: "零嘴有没有密封、有没有和主粮分开"
  },
{
    id: "e_coffee_mold",
    text: "咖啡粉结块了，闻着有一股闷味。",
    category: "luxury",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 2,
    decision: "开封过的零嘴有没有尽快吃完或封好"
  },
{
    id: "e_treat_gone",
    text: "柜子最上层空了 —— 那盒东西不知道什么时候见底了。",
    category: "luxury",
    needOnHandy: 2,
    lost: 2,
    consumes: true,
    tier: 2,
    decision: "心情类的东西要不要也留一点余量给最难的那几天"
  },
{
    id: "e_chocolate_bloom",
    text: "那板巧克力表面起了一层白霜，摸着还是硬的。",
    category: "luxury",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 3,
    decision: "怕热的东西有没有避开暖气片与南窗"
  },
  // ═══ 生成内容 突发-02 止 ═══,
  // ═══ 生成内容 突发-03 起（scripts/merge-content.mjs 插入，别手改这一段） ═══
{
    id: "e_porch_theft",
    text: "门口那箱昨天拆了一半的东西不见了。地上留着拖过的印子。",
    category: "food",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 2,
    decision: "东西放在门口过夜 —— 你的秩序经不经得起别人动过"
  },
{
    id: "e_borrowed_never_back",
    text: "你想起上个月借出去的那两件，借的人再没提起过。",
    category: "tool",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 1,
    decision: "借出去的东西算不算还在你的账上"
  },
{
    id: "e_misplaced_stash",
    text: "你确定有一包东西放在某个地方，但翻了三处都没有。",
    category: "medicine",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 2,
    decision: "有没有固定的位置，还是每次都靠记性"
  },
{
    id: "e_door_jammed",
    text: "门框受潮涨了，钥匙能转但推不开。你从里面顶了两下也没用。",
    category: "tool",
    needOnHandy: 2,
    lost: 2,
    consumes: false,
    tier: 3,
    decision: "屋子本身出问题的时候，你手上有没有能修的东西"
  },
{
    id: "e_floor_soft",
    text: "靠墙那块地板踩上去发软，边缘有点翘。下面大概是受潮了。",
    category: "tool",
    needOnHandy: 3,
    lost: 2,
    consumes: false,
    tier: 3,
    decision: "受潮的地面会不会被注意到，取决于你有没有留出通道"
  },
{
    id: "e_vent_blocked",
    text: "通风口被堆上去的东西挡住了一半，屋里的空气一整天都是闷的。",
    category: "fuel",
    needOnHandy: 2,
    lost: 1,
    consumes: false,
    tier: 2,
    decision: "为了多放两件而堵住通风，值不值"
  },
{
    id: "e_mystery_box",
    text: "有人在你门口放了一个纸箱，没有署名。拎起来有点沉。",
    category: "luxury",
    needOnHandy: 1,
    lost: 1,
    consumes: false,
    tier: 3,
    decision: "来路不明的东西要不要收 —— 它占地方，也可能有别的问题"
  },
{
    id: "e_followed_cat",
    text: "一只猫跟着你上了楼，蹲在门口不走，毛上沾着灰。",
    category: "food",
    needOnHandy: 1,
    lost: 1,
    consumes: false,
    tier: 2,
    decision: "多一张嘴意味着每天要多分出去一点 —— 而它会待在屋里"
  },
  // ═══ 生成内容 突发-03 止 ═══
];

const EMERGENCY_BY_ID: ReadonlyMap<string, EmergencyDef> = new Map(EMERGENCY_DEFS.map((d) => [d.id, d]));

/** 表里没有这个 id 时返回 null（存档自愈要用它判断"这件事还认不认识"） */
export function findEmergency(eventId: string): EmergencyDef | null {
  return EMERGENCY_BY_ID.get(eventId) ?? null;
}

export function hasEmergency(eventId: string): boolean {
  return EMERGENCY_BY_ID.has(eventId);
}
