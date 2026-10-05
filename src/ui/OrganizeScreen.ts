/**
 * 整理界面（M0 唯一界面）。
 *
 * 分层纪律：本文件**只读** buildView() 的结果；写操作一律调用 systems/organize 的命令函数，
 * 命令返回的 OrganizeEvent 才是表现层的输入（音效 / 拟声字 / 压扁动画）。
 */
import { getDisasterDef, disasterModifiersOf } from '../data/disaster';
import { FURNITURE_DEFS, furnitureDefOf, furniturePriceOf } from '../data/furniture';
import { handySlotLimitOf } from '../data/identities';
import { CATEGORY_LABELS, getItemDef } from '../data/items';
import { ZONE_COLORS } from '../data/palette';
import { initAudio, isMuted, playSfx, setMuted } from '../fx/audio';
import { iconSvg, itemIconSvg } from '../fx/icons';
import { showToast, spawnCrushGhost, spawnSfxWord, spawnTidyTag } from '../fx/popup';
import { dayLabel } from '../model/calendar';
import { farShelfNote } from '../model/haul';
import { findZone, getStack, isOffZone, rowZoneId, stackCount, zoneIdsOf, zoneListedFor } from '../model/shelf';
import { emergencyCategories } from '../model/score';
import type { CategoryId, ItemStack, Shelf, SlotPos, Zone } from '../model/types';
import type { GameStore } from '../state/store';
import { roomForNewFurniture, roomsOf, type RoomView } from '../systems/home';
import { isSurvivalOrganize } from '../systems/phases';
import { lockedRooms, survivedRuns } from '../systems/unlock';
import {
  SNAP_PREFER_PX,
  SNAP_PREFER_TOUCH_PX,
  addFurnitureCommand,
  applyZone,
  assignZone,
  buildView,
  createZone,
  deleteZone,
  editZone,
  inventoryTotals,
  pickSnapCandidate,
  placeHeld,
  pickupFromShelf,
  returnHeld,
  sortAllByFEFO,
  swapHeldWithSlot,
  takeFromBox,
  tapSlot,
  toggleHandy,
  type CommandResult,
  type OrganizeSession,
  type OrganizeView,
} from '../systems/organize';
import { attachLongPress, attachPointerGesture } from './drag';
import { expiryText, isExpiringSoon, shelfLabel, stackLabel } from './labels';
import { prophetDetailHtml } from './prophetBar';
import { prophetStripHtml, windowBandStripHtml } from './windowBand';
import { ZoneSheet } from './zoneSheet';

export interface OrganizeScreenProps {
  /** 重开一局（由 main 负责换一份 RunState） */
  onRestart: () => void;
  /** 还有行动点时再出门一次（M1 新增；由 systems/phases 的 goOut 命令完成） */
  onGoOut: () => void;
  /** 过一天（M1 新增；由 systems/phases 的 endDay 命令完成） */
  onEndDay: () => void;
  /**
   * 生存期整理完，回日报（M4 决策 B；由 systems/phases 的 backToSurvival 完成）。
   *
   * ⚠ 它**只在生存期的那一次整理**里被调用 —— 囤货期点不到它（那时 dock 里是
   * "再去采购 / 过一天"）。判定见 `isSurvivalOrganize`。
   */
  onBackToSurvival: () => void;
}

interface DragState {
  active: boolean;
  source: 'shelf' | 'box' | 'hand';
}

/**
 * 正在从「胶带架」上拖着的东西。
 *
 * · `tape` + `zoneId` —— 拖一张**已有的**胶带，落到某一行上；
 * · `tape` + `zoneId: null` —— 拖的是「＋」，落地时**新建**一张（默认名 + 自动色）；
 * · `scissors` —— 拖的是剪刀，落到行上撕那一行、落到整块架上清那一架。
 */
interface TapeDrag {
  kind: 'tape' | 'scissors';
  zoneId?: string | null;
}

/**
 * 拖拽诊断开关（默认关）。
 *
 * 在控制台执行 `__tunhuoTrace = true` 打开，然后重现一次拖拽，
 * 控制台会按顺序打出每一环走到哪个分支。它是给"现象说不清、只能猜"这种情况用的 ——
 * 猜一轮要花一次构建与一次往返，而这个开关能直接给出分支。
 *
 * ## 它在 2026-07 那轮排查里救过一次场
 *
 * 玩家报"手机上拖拽完全不跟手、拖出极小范围就断"，日志显示**每约 6px 就一次
 * `cancelDrag`** —— 那直接指向 `.slot` 缺少 `touch-action: none`（浏览器把手势
 * 抢去滚动了）。另一个是"拖两件交换却被拒"，追踪到起手那一格是**空的**
 * （拾取已经把它拿走了），于是 `swapSlots` 必然拒绝。
 * 两个根因都不是靠读代码能发现的。
 *
 * ★ 调用点已清理（见 `scripts/strip-trace.mjs`）。**保留这个函数与开关本身**：
 * 下次遇到"只在运行期显形"的问题，直接在关心的分支插一行 `trace('…')` 即可，
 * 不必再搭一遍。`void trace` 是告诉 TS "它被有意保留、不是漏删的死代码"。
 */
let TRACE = false;
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__tunhuoTrace', {
    get: () => TRACE,
    set: (v: boolean) => {
      TRACE = Boolean(v);
      // eslint-disable-next-line no-console
      console.log(`[拖拽诊断] ${TRACE ? '已打开' : '已关闭'}`);
    },
    configurable: true
  });
}
function trace(message: string): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g['__tunhuoTrace']) TRACE = true;
  if (TRACE) {
    // eslint-disable-next-line no-console
    console.log(`[拖拽] ${message}`);
  }
}
/*
 * 有意保留、暂时没有调用点（见上面 `trace` 的注释）。
 * 这一行是写给 `noUnusedLocals` 与后来者看的：**它不是漏删的死代码**。
 */
void trace;

export class OrganizeScreen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly session: OrganizeSession;
  private readonly props: OrganizeScreenProps;

  /**
   * 触屏吗？（决定吸附的偏好半径，见 `systems/organize.ts` 的 `SNAP_PREFER_PX`）
   *
   * 只看一次并记住：它在一台设备上不会变，而拖动过程中每帧都要问。
   * `matchMedia` 在测试环境里没有，所以按"鼠标"处理 —— 那条路径是默认值，
   * 也正是假 DOM 测试能验到的那一条。
   */
  private readonly coarsePointer: boolean =
    typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(pointer: coarse)').matches;

  private roomEl!: HTMLElement;
  private dockEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  /** 水位那一行（`run.homeSinkRows` 的唯一读点，见 `renderSinkNote`） */
  private sinkNoteEl!: HTMLElement;
  private subEl!: HTMLElement;
  private fxLayer!: HTMLElement;
  private sheet!: ZoneSheet;

  /** 刚放下的格子：重绘后给它一个"接住"的小动画 */
  private pendingFocus: { shelfId: string; pos: SlotPos } | null = null;
  private hoverEl: HTMLElement | null = null;
  private ghost: HTMLElement | null = null;
  /**
   * 正在拖的是胶带还是剪刀（`null` = 没在拖）。
   *
   * ★ 它是**纯界面状态**，不进存档，也刻意不与 `session.held`（货物拖拽）共用 ——
   * 两者语义不同：一个"手里拿着一件货"，一个"手上捏着一张胶带"。
   * 共用会让"手里有货时又去拖胶带"变成一种无法解释的状态。
   */
  private tapeDrag: TapeDrag | null = null;
  /** 拖动时高亮着的落点（一行或一整块架子） */
  private tapeHoverEl: HTMLElement | null = null;
  /**
   * 「加家具」的三个选择展不展开。
   *
   * ★ 它是**会话态**（不进存档），而且故意不自动收起 ——
   * 玩家常常想连着加两块。刷新之后收起是可以接受的：
   * 那只是少一次点击，不是一个会丢的状态。
   */
  private addOpen = false;
  /**
   * 纸箱那一栏展不展开（`true` = 展开）。
   *
   * ★ 2026-10 玩家要求："让下面那个箱子的一栏可以被折叠展开"。
   * 他要的是做法，真问题是**手机上一屏装不下**："顶栏 + 纸箱栏 + 三块货架 +
   * 工具条"，而工具条固定在底下不随内容滚 —— 被它吃掉的高度没有任何办法找回来。
   *
   * 默认展开是**故意的**：拆箱是整理页最常做的事，一进来就藏起来会让它变远。
   * 与 `addOpen` 同一条纪律：会话态，不进存档（刷新之后回到展开）。
   */
  private boxesOpen = true;
  private drag: DragState = { active: false, source: 'shelf' };
  /**
   * 上一次渲染用的视图（给吸附偏好查"这一行是哪张胶带"用）。
   *
   * ★ 为什么不现算：`nearestLegalSlot` 在**拖动过程中每一帧**都会被调用，
   * 而 `buildView` 会重建整份房间/货架/胶带结构 —— 在指针移动里做那件事
   * 就是每帧一次全量重算。视图只在渲染时变，所以缓存它、丢掉重算，
   * 代价是"渲染之后又被改过的分区"要等下一次渲染才生效（亚帧级，看不见）。
   */
  private lastView: OrganizeView | null = null;

  constructor(root: HTMLElement, store: GameStore, session: OrganizeSession, props: OrganizeScreenProps) {
    this.root = root;
    this.store = store;
    this.session = session;
    this.props = props;
  }

  mount(): void {
    this.root.innerHTML = `
      <div class="screen">
        <header class="topbar">
          ${/* ① ★★ **标题在最顶上**（2026-10 用户："还是把囤货台账和三个数字放在最顶上啊，
                那是标题啊"）。我第一次把带子与先知栏提到标题之上是读错了上一句话 ——
                "放在最顶上"说的是**标题**，不是窗外那条带子。 */ ''}
          <div class="topbar-head">
            <div class="title">
              <h1>囤货台账</h1>
              <p class="sub" data-sub></p>
            </div>
            <div class="topbar-tools">
              <button class="mini" data-action="mute" data-mute-label>静音</button>
              <button class="mini" data-action="restart">重开</button>
            </div>
          </div>
          ${/* ② 四个指标（归位率 / 快到期的先吃 / 急用的够不够 / 已上架）。
                它与标题是**一块**：玩家说的"囤货台账和三个数字"就是这两行。 */ ''}
          <div class="score" data-score></div>
          ${/* ③ 窗外那条带子（见 ui/windowBand.ts 的 windowBandStripHtml）。
                2026-10 用户："光条和先知日历缩小点"—— 缩小是这一条的全部要求，
                位置紧跟标题块之下。 */ ''}
          ${windowBandStripHtml(this.store.run)}
          ${/* ④ 先知栏：进度条 + 灾难名 + 强度 + 还有几天 + 「先知日历」那一枚 */ ''}
          ${prophetStripHtml(this.store.run)}
          <!--
            ⑤ 「胶带架」：胶带与剪刀都住在这儿，从这里**拖到某一行**上使用。
            见 renderTapeShelf 的注释（用户要的手感：写一张 → 拖到某一行）。
            ★ 用户原话"胶带的加号和剪刀放在他们下面一点"——"他们"就是上面那两样。
          -->
          <div class="tape-shelf" data-tape-shelf></div>
          ${/* ★ W-05：屋子被水吃过几排（`run.homeSinkRows`）。空着的时候整行不写出来 */ ''}
          <p class="block-note" data-sink-note hidden></p>
          ${/* ⑥ 先知点开之后的逐日细节落在这儿（ui/prophetBar.ts 的 prophetDetailHtml）。
                它是"点开才给"的逐日细节，向下长，不挤头顶那几样。 */ ''}
          ${prophetDetailHtml(this.store.run.disasterId, this.store.run.day)}
        </header>
        ${/* ★★ `data-scroll-host`：告诉手势层"落在这里的手势是用来滚这一块的"。
              2026-10 用户第二次报拖拽出问题（"出一个极小的范围就会消失"）之后，
              滚动重新归手势层接管（`.slot` 是 `touch-action: none`，
              浏览器永不插手，也就不会发 `pointercancel` 把拖拽收掉）——
              代价是**滚谁**这件事得由我们指出来。
              见 `ui/drag.ts` 的 `resolveScrollHost`：它从被按住的元素往上找这个属性。
              ★ 全屏**只许有这一处**：见下面 `data-boxes` 那一段
              （两个滚动容器就是"滑动方向是反的"那个报障的根因）。 */ ''}
        <main class="room-scroll" data-room data-scroll-host></main>
        <footer class="dock">
          <div class="dock-hand" data-hand data-drop="return"></div>
          ${/* ★★ 这里**故意没有** `data-scroll-host`（2026-10 修"滑动反向"时拿掉的）。
                纸箱那一叠自己 `overflow-y: auto`，于是它**同时**是一个滚动容器；
                如果落在这里的手势去滚它、落在别处的手势去滚房间，屏幕上就有两个
                能独立滚的窗口 —— 手指在箱子上下拉，动的是箱子；往上推到货架上，
                动的却是整页。玩家报的"滑动方向是反的"就是这个：**不是方向错了，
                是滚的东西不一样**。
                现在全屏只有 `.room-scroll` 一个滚动容器，手势滚到它的边界还会
                接力给外层，而"箱子那一叠"由「收起」把手来管（它本来就是为这个造的）。 */ ''}
          <div class="dock-boxes" data-boxes></div>
          <div class="dock-tools">
            <button class="btn" data-action="sort">${iconSvg('sort')}<span>按保质期排</span></button>
            ${
              /*
               * ★★ 「加家具」那一个 host 在生存期**整个不写出来**（M4 决策 B，用户明确要求：
               * "不要花现金加家具，生存页回去的时候闭合这个入口"）。
               *
               * 为什么是"不渲染"而不是"渲染成灰的"：灰按钮说的是"条件没满足"，
               * 而这里的口径是**这件事在生存期不存在**（钱在生存期没有别的用途，
               * 而家具是囤货期"东西放不下"的解药，生存期不需要它）。
               * 留一个灰的反而会让玩家去找"怎么才能点亮它"。
               */
              isSurvivalOrganize(this.store.run) ? '' : '<span data-add-furniture></span>'
            }
            ${
              isSurvivalOrganize(this.store.run)
                ? `<button class="btn btn-primary" data-action="back-survival"><span>回日报</span></button>`
                : `<button class="btn" data-action="go-out"><span>再去采购</span></button>
            <button class="btn btn-primary" data-action="end-day"><span>过一天</span></button>`
            }
          </div>
        </footer>
      </div>
      <div class="fx-layer" data-fx></div>
    `;

    this.roomEl = this.query('[data-room]');
    this.dockEl = this.query('.dock');
    this.scoreEl = this.query('[data-score]');
    this.sinkNoteEl = this.query('[data-sink-note]');
    this.subEl = this.query('[data-sub]');
    this.fxLayer = this.query('[data-fx]');

    const sheetEl = document.createElement('div');
    /*
     * ★★ 抽屉挂在 **`document.body`** 上，不挂 `#app`（2026-10 修）。
     *
     * 用户报的现象："那个编辑胶带其实是弹出来了的，只不过在小屏上看不到"、
     * "在小屏上他会闪出来极短的一瞬间然后消失"。
     *
     * `#app` 有 `height: 100dvh` —— 而 `dvh` 是**会跟着视觉视口变**的单位：
     * 手机软键盘弹起、地址栏收放、甚至下拉刷新，都会让它变小。
     * 抽屉原来是 `#app` 的子元素，于是**父容器一变小，它就被一起压掉**，
     * 而它自己又是 `position: fixed`（本该脱离父容器的布局）—— 两者一套组合，
     * 表现就是"闪一下然后没了"。桌面没有软键盘，所以完全看不出来。
     *
     * 挂到 `body` 上之后，它与那个会变的容器**没有任何布局关系**，
     * `position: fixed` 才真正只在做"贴视口"这一件事。
     */
    document.body.appendChild(sheetEl);
    this.sheet = new ZoneSheet(
      sheetEl,
      {
        getShelves: () => this.store.run.shelves,
        getZones: () => this.store.run.zones,
        /*
         * 抽屉从 2026-10 起是**纯编辑器**：只有三条写入路径
         * （改一张 / 新建一张 / 删掉一张），而"贴到哪一行"完全归拖拽。
         * 所以这里不再有 `apply` / `assign` —— 它们那条路已经删了。
         */
        updateZone: (zoneId: string, input: { name: string; color: string; categories: CategoryId[] }) => {
          const result = editZone(this.store, zoneId, input);
          this.consume(result);
          return result.ok;
        },
        createZone: (input: { name: string; color: string; categories: CategoryId[] }) => {
          const result = createZone(this.store, input);
          this.consume(result);
          return result.ok;
        },
        deleteZone: (zoneId: string) => {
          const result = deleteZone(this.store, zoneId);
          this.consume(result);
          return result.ok;
        }
      },
      () => this.clearEditHighlight()
    );

    // 只挂一个委托监听（顶栏指标卡 / 货架按钮 / 底部工具都从这里走），少一层心智负担
    this.root.addEventListener('click', this.onClickBound);

    this.render();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClickBound);
    this.clearLongPressBindings();
  }

  render(): void {
    /*
     * ★ 兜底：任何一次重绘都顺手清掉"游离的拖拽幽灵"。
     *
     * 幽灵是 `fx-layer` 里一个独立元素，不进 DOM 树状重绘，所以它只能靠
     * 手势结束（`endGhost`）来收。只要那条路有一条我没覆盖到的分支
     * （玩家反馈的"卡住了，得点一下原格子才好"），幽灵就会一直贴在屏幕上。
     *
     * 与其指望我把所有分支都找齐，不如在这儿兜住：**重绘 = 屏幕重来一遍**，
     * 那幽灵就没有理由跨过一次重绘活下来。就算真有漏网的分支，
     * 玩家看到的也只是"它消失了"，而不是"它卡在那儿不动"。
     */
    if (this.ghost !== null) {
      this.endGhost();
    }
    /*
     * ★ 同理，一次重绘 = 上一批手势全部作废。
     * 这里**先摘掉再重建**，而不是等 `bindRoomGestures` 自己清 ——
     * 那样"货架"和"纸箱"两批的清理时机就不一致了（两处都要记得清，迟早漏一处）。
     */
    this.clearGestureBindings();
    const view = buildView(this.store, this.session);
    // 吸附偏好要按行查胶带，而它每帧都会被问一次 —— 所以在这里存一份（见 lastView）
    this.lastView = view;
    this.renderSub(view);
    this.renderScore(view);
    this.renderSinkNote();
    this.renderTapeShelf();
    this.renderRoom(view);
    this.renderDock(view);
    this.applyFocus();
    this.sheet.refresh();
  }

  // ———————— 渲染 ————————

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  「胶带架」：胶带与剪刀都住在这儿，从这儿拖到某一行上使用
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ## 用户要的手感（2026-10 走测）
   *
   * > "胶带能不能换个手感，就是我写一张胶带，然后拖到某一行上，这样子，
   * >  然后还可以用一个剪刀拖上去清掉，他还有选中动画"
   * > "然后已有的胶带存在一个区域直接拖上去就行"
   *
   * 所以这里是**一个常驻区域**（不藏在抽屉里）：
   *
   *     胶带  [主食][工具][随便]…  [＋]  [✂]
   *
   *  · **拖胶带 → 某一行** = 贴上（已有胶带用它的名字与颜色）；
   *  · **拖剪刀 → 某一行** = 撕下那一行；
   *  · **拖剪刀 → 一整块架子** = 清掉这一架所有胶带；
   *  · **轻点胶带** = 打开抽屉改名字/颜色/清单（拖是"贴"，点是"改"）。
   *
   * ## 为什么"＋"拖出去是**先贴、后改名**
   *
   * 拖出去时先落一张**默认名 + 自动色**的胶带，落地之后点它改名。
   * 反过来（先弹输入框、打完字再拖）要多一次交互，而那一瞬间玩家手上
   * 还按着东西、心思在"贴到哪一行"上 —— 分两步更顺。用户拍板了这个口径。
   *
   * ## 撕下来的胶带**留在架上**
   *
   * 只有"没有任何一行在用它"时才真正消失 —— 否则玩家会不敢试（贴错了就没了）。
   */
  private renderTapeShelf(): void {
    const host = this.query('[data-tape-shelf]');
    if (!host) return;
    const run = this.store.run;
    const chips = run.zones
      .map((zone) => {
        // 这张胶带现在贴在几行上（0 = 还在架上、没被用）
        const rows = run.shelves.reduce(
          (n, s) =>
            n + Array.from({ length: s.h }, (_, r) => rowZoneId(s, r)).filter((id) => id === zone.id).length,
          0
        );
        const lifted = this.tapeDrag?.kind === 'tape' && this.tapeDrag.zoneId === zone.id ? ' is-lifted' : '';
        return `<button class="tape-chip${rows === 0 ? ' is-idle' : ''}${lifted}"
                  data-tape-chip="${zone.id}"
                  style="--zone:${zone.color}"
                  title="拖到某一行上贴上去；点一下改名字与清单${rows === 0 ? '（现在没贴在哪儿）' : `（贴在 ${rows} 行上）`}">
          ${escapeHtml(zone.name)}${rows > 0 ? `<em class="tape-chip-count">${rows}</em>` : ''}
        </button>`;
      })
      .join('');
    const liftedCut = this.tapeDrag?.kind === 'scissors' ? ' is-lifted' : '';
    /*
     * ★★ 顺序是**工具在前、胶带列表在后**（2026-10 修）。
     *
     * 用户报的问题："如果胶带种类太多在手机上会覆盖住加号和剪刀，无法继续操作"。
     *
     * 原来的顺序是「标签 + 胶带列表 + ＋ + 剪刀」，于是胶带一多，
     * 列表把两个工具**推出可视区**（这一条是 `overflow-x: auto`，推出去就滚不回来了，
     * 因为工具本身也在可滚区域里）。
     *
     * 现在把两个工具放在**最左**：它们永远可见、永远够得到，
     * 而胶带列表在右边自己滚。列表再长也不会影响这两个按钮。
     */
    host.innerHTML = `
      <span class="tape-shelf-label">胶带</span>
      <button class="tape-tool" data-tape-new title="拖到某一行上，新建一张胶带">＋</button>
      <button class="tape-tool tape-tool-cut${liftedCut}" data-tape-scissors
              title="拖到某一行上撕下那一行；拖到一整块架子上就清掉那一架">✂</button>
      <div class="tape-shelf-list">
        ${chips || '<span class="tape-shelf-empty">还没有胶带。把左边那个「＋」拖到某一行上，就有了。</span>'}
      </div>
    `;
    this.bindTapeGestures();
  }

  /** 把胶带架上的三样东西挂上手势（每次重绘都要重挂 —— 元素换了） */
  private bindTapeGestures(): void {
    const host = this.query('[data-tape-shelf]');
    if (!host) return;
    host.querySelectorAll<HTMLElement>('[data-tape-chip]').forEach((el) => {
      const zoneId = el.dataset['tapeChip'] ?? '';
      attachPointerGesture(el, {
        onTap: () => this.openZoneDrawer(undefined, undefined, zoneId),
        onDragStart: (point) => this.beginTapeDrag({ kind: 'tape', zoneId }, point),
        onDragMove: (point) => this.moveTapeDrag(point),
        onDragEnd: (point) => this.endTapeDrag(point),
        onCancel: () => this.cancelTapeDrag()
      });
      /*
       * ★★ 原生 `click` 兜底（2026-10）。
       *
       * 用户报："手机上……那个胶带的编辑还是不行，他不弹出，贴上去判定那个功能没问题了"。
       *
       * 也就是说：**拖**那条路通了（落点判定修好之后），而**点**这条路不通。
       * 手势层的 tap 判定（位移 ≤12px 且 ≤500ms）在真实手指上很紧 ——
       * 而拖拽那条路我们已经验证是好的。所以这里加一条**不依赖手势层**的兜底：
       * 浏览器自己的 `click` 只要按下与抬起落在同一个元素上就会发，
       * 而它在移动端比我们那套阈值宽容得多。
       *
       * ## 为什么不会变成"点两下开两次"
       *
       * `openZoneDrawer` 是**幂等**的：它开头就有"抽屉开着、而且货架与行都没变 → 直接 return"。
       * 所以手势层与原生 click 都触发时，第二次是空操作。
       *
       * ## 为什么不会与拖拽打架
       *
       * 拖拽结束后浏览器**不会**补发 click（元素在拖拽中被重绘换掉了，
       * 而且指针已经移开）—— 真发了也无害，见上一条。
       */
      // （这条被"临时关掉验证过会红"—— 见 tapeShelf.test.ts 的两条 ★★）
      el.addEventListener('click', () => this.openZoneDrawer(undefined, undefined, zoneId));
    });
    const fresh = host.querySelector<HTMLElement>('[data-tape-new]');
    if (fresh) {
      attachPointerGesture(fresh, {
        onTap: () => showToast(this.fxLayer, '把这个「＋」拖到某一行上，就新建一张胶带', 'ink'),
        onDragStart: (point) => this.beginTapeDrag({ kind: 'tape', zoneId: null }, point),
        onDragMove: (point) => this.moveTapeDrag(point),
        onDragEnd: (point) => this.endTapeDrag(point),
        onCancel: () => this.cancelTapeDrag()
      });
      // 原生 click 兜底：新建一张（与拖到空处同一个结果）
      fresh.addEventListener('click', () => this.openZoneDrawer());
    }
    const cut = host.querySelector<HTMLElement>('[data-tape-scissors]');
    if (cut) {
      attachPointerGesture(cut, {
        onTap: () => showToast(this.fxLayer, '把剪刀拖到某一行上就能撕下来', 'ink'),
        onDragStart: (point) => this.beginTapeDrag({ kind: 'scissors' }, point),
        onDragMove: (point) => this.moveTapeDrag(point),
        onDragEnd: (point) => this.endTapeDrag(point),
        onCancel: () => this.cancelTapeDrag()
      });
      cut.addEventListener('click', () => showToast(this.fxLayer, '把剪刀拖到某一行上就能撕下来', 'ink'));
    }
  }

  /** 手势被打断（判定为滚动等）：收幽灵、清状态，什么都不改 */
  private cancelTapeDrag(): void {
    this.endGhost();
    this.tapeDrag = null;
    this.clearTapeHover();
    this.renderTapeShelf();
  }

  /**
   * 起手拖胶带 / 剪刀。
   *
   * ★ 与货物的拖拽（`beginDrag`）是**两套状态**，刻意不共用 `session.held`：
   * 那个字段的语义是"玩家手里拿着一件货"，而且它**进存档**。
   * 胶带拖拽是纯界面状态（松手就没了），塞进去会让存档多一个不该有的字段。
   */
  private beginTapeDrag(drag: TapeDrag, point: { x: number; y: number }): void {
    this.tapeDrag = drag;
    const el = document.createElement('div');
    el.className = 'drag-ghost tape-ghost';
    if (drag.kind === 'scissors') {
      el.innerHTML = '<span class="tape-ghost-cut">✂</span>';
    } else {
      const zone = drag.zoneId ? findZone(this.store.run.zones, drag.zoneId) : null;
      const color = zone?.color ?? this.newTapeInput().color;
      el.innerHTML = `<span class="tape-ghost-strip" style="--zone:${color}"></span>`;
      el.style.setProperty('--zone', color);
    }
    el.style.left = `${point.x}px`;
    el.style.top = `${point.y}px`;
    this.fxLayer.appendChild(el);
    this.ghost = el;
    this.renderTapeShelf(); // 让被拿起来的那一张显示"抬起"态
    playSfx('preview');
  }

  /** 拖动中：高亮指针下的那一行 / 那一块架子，并让幽灵跟手 */
  private moveTapeDrag(point: { x: number; y: number }): void {
    this.moveGhostTo(point);
    const target = this.pickTapeTarget(point);
    if (target === this.tapeHoverEl) return;
    this.clearTapeHover();
    if (!target) return;
    this.tapeHoverEl = target;
    target.classList.add(target.dataset['row'] !== undefined ? 'is-tape-hover' : 'is-tape-hover-card');
  }

  /**
   * 指针下能贴的东西：**一行**优先，其次**一整块架子**（只有剪刀用得上）。
   *
   * ## ★★ 两条判据，缺一不可（用户报的"正好放在图标上就没判定"）
   *
   * > "不管是剪刀还是加号还是已有标签，如果正好放在图标上就没判定了，
   * >  这其实是个老问题，改一下"
   *
   * · **① `elementFromPoint` + `closest`** —— 正常情况，也最准
   *   （它尊重层叠、`pointer-events`、滚动裁剪）；
   * · **② 几何兜底**（`rowUnderPoint` / `cardUnderPoint`）—— ① 落空时按坐标找。
   *   ① 会落空的原因有三个：格子里的 SVG 图标自己可命中、一行里那些
   *   `pointer-events: none` 的子元素穿透到谁身上依实现而定、
   *   以及 `.slot:active` 的 `transform: scale(0.96)` 让格子在被按住时缩小。
   *
   * ⚠ 货物拖拽那条路（`pickDropSlot`）早就有 ② 了，而**胶带这条新路只写了 ①** ——
   * 于是把同一类毛病重新引入了一遍。这正是"老问题"那三个字的由来。
   */
  private pickTapeTarget(point: { x: number; y: number }): HTMLElement | null {
    const el = document.elementFromPoint(point.x, point.y);
    if (el instanceof HTMLElement) {
      const row = el.closest<HTMLElement>('[data-shelf-row]');
      if (row) return row;
      if (this.tapeDrag?.kind === 'scissors') {
        const card = el.closest<HTMLElement>('[data-shelf-card]');
        if (card) return card;
      }
    }
    // ② 几何兜底（这一条被"临时拆掉验证过会红"—— 见 tapeShelf.test.ts 那条 ★★）
    const byGeometry = this.rowUnderPoint(point);
    if (byGeometry) return byGeometry;
    if (this.tapeDrag?.kind === 'scissors') return this.cardUnderPoint(point);
    return null;
  }

  private endTapeDrag(point: { x: number; y: number }): void {
    const drag = this.tapeDrag;
    const target = this.pickTapeTarget(point);
    this.endGhost();
    this.tapeDrag = null;
    this.clearTapeHover();

    /*
     * ★★ 丢在空处 → **当作轻点**（打开抽屉），不是"什么都没发生"。
     *
     * ## 这是手机上"编辑打不开"的真正原因
     *
     * 用户的原话："在手机端……那个胶带的编辑打不开，弹不出来，到了电脑上就正常了"。
     *
     * 机制：手指"轻点"时几乎总会移动十几像素、或者停得比 220ms 久一点，
     * 于是手势层把它判成**拖拽**而不是轻点（`onTap` 只在位移 ≤12px 且 ≤500ms 时触发）。
     * 玩家于是拖起了一张胶带、又没落到任何行上 —— 而那时的处理是"静默什么都不做"，
     * 看起来就是**点了没反应**。
     *
     * 鼠标上不会这样：位移小、而且"按下-抬起"快。这就解释了"电脑上正常"。
     *
     * 修法是标准做法：**拖出去又原样放回来 = 一次点击**。
     * 它同时让"想改一张胶带但手抖了"这个常见动作有个自然的结果。
     */
    if (!drag || !target) {
      // （这条被"临时关掉验证过会红"—— 见 tapeShelf.test.ts 那条 ★★）
      if (drag?.kind === 'tape') {
        this.openZoneDrawer(undefined, undefined, drag.zoneId ?? undefined);
        return;
      }
      this.renderTapeShelf();
      return;
    }
    const shelfId = target.dataset['shelf'] ?? '';
    if (!shelfId) {
      this.renderTapeShelf();
      return;
    }
    const rowAttr = target.dataset['row'];

    if (drag.kind === 'scissors') {
      const rows = rowAttr === undefined ? this.allRowsOf(shelfId) : [Number(rowAttr)];
      const r = assignZone(this.store, shelfId, null, rows);
      this.consume(r);
      if (r.ok) {
        playSfx('cut');
        showToast(this.fxLayer, rowAttr === undefined ? '这一架的胶带清掉了' : '这一行撕下来了', 'ink');
      }
      this.render();
      return;
    }

    if (rowAttr === undefined) {
      // 胶带只能贴到**某一行**上（想整块贴 = 抽屉里的「全选」那条路）
      showToast(this.fxLayer, '拖到具体某一行上', 'ink');
      this.renderTapeShelf();
      return;
    }

    const row = Number(rowAttr);
    const r = drag.zoneId
      ? assignZone(this.store, shelfId, drag.zoneId, [row])
      : applyZone(this.store, shelfId, { ...this.newTapeInput(), rows: [row] });
    this.consume(r);
    if (r.ok) {
      playSfx('place');
      // ★ 落定之后那一行闪一下 —— "贴上去了"这件事必须看得见（用户要的"选中动画"）
      this.flashRow(shelfId, row);
    }
    this.render();
  }

  /** 这一块架子的全部行号（剪刀落在整块卡上时用） */
  private allRowsOf(shelfId: string): number[] {
    const shelf = this.store.run.shelves.find((s) => s.id === shelfId);
    return shelf ? Array.from({ length: shelf.h }, (_, r) => r) : [];
  }

  /**
   * 新胶带的默认名字与颜色。
   *
   * ★ 名字取"**没被用过的第一个** `胶带 N`"，而不是 `zones.length + 1` ——
   * 否则删掉一张再新建就会撞名，而撞名的后果是 `applyZone` 的
   * "同名复用"分支把两张胶带并成一张（那是它设计好的行为，但在这里是意外）。
   */
  private newTapeInput(): { name: string; color: string } {
    const zones = this.store.run.zones;
    const used = new Set(zones.map((z) => z.name));
    let n = 1;
    while (used.has(`胶带 ${n}`)) n += 1;
    const usedColors = new Set(zones.map((z) => z.color));
    return { name: `胶带 ${n}`, color: ZONE_COLORS.find((c) => !usedColors.has(c)) ?? ZONE_COLORS[0]! };
  }

  /** 某一行的"贴上去了"闪烁 */
  private flashRow(shelfId: string, row: number): void {
    const el = this.roomEl.querySelector<HTMLElement>(
      `[data-shelf-row][data-shelf="${shelfId}"][data-row="${row}"]`
    );
    if (!el) return;
    el.classList.add('is-tape-landed');
    window.setTimeout(() => el.classList.remove('is-tape-landed'), 420);
  }

  private clearTapeHover(): void {
    for (const el of this.roomEl.querySelectorAll('.is-tape-hover, .is-tape-hover-card')) {
      el.classList.remove('is-tape-hover', 'is-tape-hover-card');
    }
    this.tapeHoverEl = null;
  }

  private renderSub(view: OrganizeView): void {
    const run = this.store.run;
    const totals = inventoryTotals(run);
    const boxes = view.boxes.length;
    // 天数用 D-7 / D-Day / D+3 这套统一写法（model/calendar.dayLabel），不各写各的
    this.subEl.textContent = `${dayLabel(run.day)} · 在家整理 · 待拆 ${boxes} 箱 · 在库 ${totals.pieces} 件`;
  }

  private renderScore(view: OrganizeView): void {
    const p = Math.round(view.score.placement * 100);
    const f = Math.round(view.score.fefo * 100);
    const e = Math.round(view.score.emergency * 100);
    const run = this.store.run;
    const capacity = run.shelves.reduce((n, s) => n + s.w * s.h, 0);
    const handyCount = run.shelves.filter((s) => s.handyRank !== null).length;
    /*
     * ★ 那两句话跟着**这一局的灾难**走（M4 W-01 顺手修的文案 bug）。
     *
     * 原来这里写死了"这场寒潮要用的东西（燃料和药）" —— 在 116 场都能被抽到之后，
     * 它在热浪局里会指着水与药说"燃料和药"。而这两句是**解释这一栏怎么算的**，
     * 算错一项，玩家就会按错的清单去整理。
     *
     * 品类取自 `emergencyCategories(disaster)`（= 这一场的刚需 ∪ 医疗），
     * 与那一栏的分子分母**同一个来源** —— 两处各写一份的话，
     * 解释与算法迟早分家（那是 §2.19 那个形状）。
     */
    const emergencyCats = emergencyCategories(getDisasterDef(run.disasterId));
    const emergencyNames = emergencyCats.map((c) => CATEGORY_LABELS[c]).join('和');
    /*
     * ★ M4 W-06：顺手位的**上限随身份变**（`handySlotLimitOf`），所以这句空态提示
     * 不能再说死"全屋只有这一块" —— 小区保安读到那句会以为界面坏了
     * （他明明能标两块）。同一件事的两种说法就是 §2.19 那个形状，
     * 只不过这次分家的是"文案"与"命令层的真实上限"。
     */
    const handyLimit = handySlotLimitOf(run.identityId);
    // 全中文台账。术语解释放 title（鼠标）＋点一下弹提示（手机没 hover，只能点）
    this.scoreEl.innerHTML = `
      <button class="score-item" data-action="explain" data-explain="归位率：你自己给胶带写的清单，东西有没有照放。只有被某张清单明确写进去的东西才算归位；贴了胶带但没写清单，和没贴一样是 0。" title="你自己给胶带写的清单，东西有没有照放。只有被清单明确写进去的才算归位；没写清单就不算。">
        <i>归位率</i><b>${p}%</b>
      </button>
      <button class="score-item" data-action="explain" data-explain="快到期的先吃：同一块货架有没有按到期日排好，快到期的排在前面，也先被用掉" title="同一块货架有没有按到期日排好">
        <i>快到期的先吃</i><b>${f}%</b>
      </button>
      <button class="score-item" data-action="explain" data-explain="急用的够不够得着：这一场要用的东西（${emergencyNames}）有多少放在顺手位上${handyCount === 0 ? `。你还没标过顺手位，点货架右上角的「顺手位」，${handyLimit > 1 ? `你可以标${handyLimit}块` : '全屋只有这一块'}` : ''}。体力见底那天，只有顺手位上的东西还够得到。" title="急用的东西有多少放在顺手位上">
        <i>急用的够不够得着</i><b>${e}%</b>
      </button>
      <button class="score-item" data-action="explain" data-explain="已上架：占了 ${view.score.stacks} 个格子，全房间一共 ${capacity} 格" title="已占用 ${view.score.stacks} 个格子，全房间共 ${capacity} 格">
        <i>已上架</i><b>${view.score.stacks}</b>
      </button>
    `;
  }

  /**
   * ★★ 水位那一行（W-05 的界面那一半）。
   *
   * ## 为什么它必须存在
   *
   * `homeSink` 让白天事件能真的吃掉玩家屋里的几排 —— 但**盘面本身说不出这件事**：
   * 一排没了之后，屏幕上只剩一块"本来就只有三排"的货架，玩家无法分辨
   * "我这块一直是三排"和"我这块昨晚被水泡掉一排"。而 §10.1A 的口径是
   * **任何东西都要让我有感知** —— 只在后台改数据、指望玩家自己数出来，
   * 正好是那条铁则要禁的形状（`docs/囤货末世-策划案.md` §10.1A）。
   *
   * 所以这里是 `run.homeSinkRows` 的**唯一读点**，说的是那本账（水位到过哪儿），
   * 而不是"正在发生什么"—— 水早就退了。
   *
   * ⚠ 它**不**逐个复述被泡掉的胶带：那件事属于"当时那一刻"的反馈，
   * 已经由 `describeDayEffect` 在商店那屏说了（"「主食」的胶带跟着掉了"）。
   * 一个跨天还挂在整理页上的提示去复述当时的细节，只会变成两块屏幕抢着说同一句话。
   */
  private renderSinkNote(): void {
    const rows = this.store.run.homeSinkRows;
    if (rows <= 0) {
      /*
       * 整行藏起来（`hidden` 而不是空字符串）：空 `<p>` 会照旧吃掉那 6px margin。
       *
       * ⚠ 这里**不能写 `this.sinkNoteEl.hidden = true`** —— 那句话在真浏览器里对，
       * 在本项目的假 DOM（`ui/fakeDom.ts`）里却会**静默失效**：假体没有 `hidden`
       * 属性，赋值只是往对象上挂了一个没人读的字段，于是这条分支的效果
       * 在屏幕级测试里永远验不到。属性得走 `toggleAttribute`。
       * （`fakeDom` 的 `BOOLEAN_ATTRS` 只覆盖"解析 HTML 时"的布尔属性，
       * 那是另一条路，管不着产品代码在 JS 里设的那一个。）
       */
      this.sinkNoteEl.toggleAttribute('hidden', true);
      this.sinkNoteEl.textContent = '';
      return;
    }
    const shelves = this.store.run.shelves.filter((s) => s.id.startsWith('shelf_')).length;
    /*
     * 单位是**排**：`homeSinkRows` 累加的是"这一次淹了几排"，
     * 而每块家具是**各砍一排**（`sinkShelves` 逐块算 `cut`），
     * 所以"每块各少一排"才是实情 —— "一共少了 N 排"会被读成总排数
     * （三块各少一排，写成"一共少了一排"或"少了三排"都是假话）。
     */
    const body =
      shelves > 0
        ? `屋里进过水：靠地那${rows === 1 ? '一排' : `${rows} 排`}，每块家具各少了一排。`
        : `屋里进过水：贴地那${rows === 1 ? '一排' : `${rows} 排`}没了。`;
    const tail = shelves > 0 ? `现在全屋最多能放 ${this.shelfRowsTotal()} 排。` : '';
    this.sinkNoteEl.toggleAttribute('hidden', false);
    this.sinkNoteEl.textContent = `${body}${tail}`;
  }

  /** 全屋还剩几排可放（水位那一行用它把"少了"换算成当下的事实） */
  private shelfRowsTotal(): number {
    return this.store.run.shelves.reduce((n, s) => n + s.h, 0);
  }

  /**
   * 空房间那一格。
   *
   * ## ★ 用户的一句话点出了真问题
   *
   * > "储藏间现在就是一个横条上面写着 0/3 呢，啥用没有啊。就一个分格线"
   *
   * 他说得对。一个空房间原来只画一条分隔线加一个计数，那**三条信息一条都没有**：
   *
   *  ① 这间房**是干什么的**（玩家刚解锁它，还不知道它能放什么）；
   *  ② 它**值多少**（"能放 3 块"是他刚刚花一次通关换来的东西，值得说清）；
   *  ③ 怎么**把东西放进去**（下一步动作）。
   *
   * 而"解锁一间空房"本身在设计上是对的（§10.2.4：新那间空着、能放三块）——
   * 错的只是**它没说话**。所以这里不是把空房藏起来，而是让它把该说的话说完。
   *
   * ★ 家具**进哪一间**由 `roomForNewFurniture()` 决定（先填满旧的那间），
   * 所以这里的文案不能说"点下面就会放进这间" —— 那在客厅没满时是**假话**。
   * 它只说"这间还能放 N 块"，把去哪间留给下面那个按钮。
   */
  private emptyRoomHtml(room: RoomView): string {
    /*
     * ★ 每一句都包一层 `<span>`，而不是让文字裸在 `<p>` 里。
     *
     * 这不只是洁癖：裸文本在假 DOM 里**既不是子元素、也不进 `textContent`**
     * （假解析器只建模标签，见 `fakeDom.ts` 的 `parseHtml`），
     * 于是"这一屏到底说了什么"在测试里**读不到**。
     * 包一层之后 `querySelectorAll` 能取到，测试才钉得住这段文案。
     */
    return `
      <p class="room-empty">
        <span class="room-empty-lead">这间还空着。</span>
        <span class="room-empty-body">它最多能放 ${room.capacity} 块家具 —— 加家具的按钮在下面，东西放不下的时候它就是那份额外的空间。</span>
      </p>
    `;
  }

  private renderRoom(view: OrganizeView): void {
    const scrollTop = this.roomEl.scrollTop;
    /*
     * ★ 按房间分组（§10.2.4 的「搬更大的家」）。
     *
     * 只有一间房时**不画房名** —— 那一刻"客厅"这个词没有任何信息量，
     * 而多一行标题会让整理页看起来比它实际复杂。两间房起才分组。
     *
     * ★ 顺序取自 `roomsOf()`（房间表的顺序），不是 `shelves` 的顺序 ——
     * 否则家具一多，房间的先后会随存档里的插入顺序漂。
     */
    const rooms = roomsOf(this.store.save.meta, this.store.run);
    if (rooms.length <= 1) {
      this.roomEl.innerHTML = view.shelves
        .map((shelf, index) => this.shelfHtml(shelf, index, view))
        .join('');
    } else {
      this.roomEl.innerHTML = rooms
        .map((room) => {
          const cards =
            room.shelves.length > 0
              ? room.shelves
                  .map((shelf) => this.shelfHtml(shelf, view.shelves.indexOf(shelf), view))
                  .join('')
              : this.emptyRoomHtml(room);
          const full = room.used >= room.capacity ? ' is-full' : '';
          return `
            <section class="room-group">
              <h2 class="room-title"><span class="room-label">${escapeHtml(room.label)}</span><span class="room-count${full}">${room.used}/${room.capacity}</span></h2>
              ${cards}
            </section>
          `;
        })
        .join('');
    }
    this.roomEl.scrollTop = scrollTop;
    this.bindRoomGestures();
  }

  private shelfHtml(shelf: Shelf, index: number, view: OrganizeView): string {
    const tidy = view.tidyShelfIds.includes(shelf.id);
    /*
     * ★ M4 W-06：顺手位的上限随身份变，而这一层是**逐架**渲染的
     * （`shelfHtml` 会被调 N 次），所以每次现读一次 —— 它是纯查表的常数时间操作，
     * 而把上限塞进 `OrganizeView` 会多出一条"视图构建者必须记得带上它"的约定。
     */
    const handyLimit = handySlotLimitOf(this.store.run.identityId);
    /*
     * ★ 一方胶带只贴**一行**（用户拍板 2026-10）。
     *
     * 所以颜色不再是"整块货架一个色"，而是**一行一个色** ——
     * 一块架子上可以同时出现两三种颜色，那就是玩家自己立的规矩分布。
     *
     * 渲染上做成"一层行的包裹"，每层带自己的 `--zone`：
     *  · 层左侧 4px 的色条 = 这一行贴了什么（肉眼一扫就看得出）；
     *  · 颜色再传给层里的格子（`.slot` 的边框），所以贴了胶带的行
     *    有一圈同色描边，**涂色**这件事在格子上也看得见。
     *
     * 为什么不用 `color-mix` 铺底色：格子里本来就有一枚图标 + 到期日 + 墨点，
     * 再铺一层底会让 320px 上的小格子糊成一片（§5A 的层次口径）。
     * 描边 + 侧色条表达得一样清楚，而且**不占格子的视觉容量**。
     */
    const rows: string[] = [];
    for (let row = 0; row < shelf.h; row++) {
      const zone = findZone(view.zones, rowZoneId(shelf, row));
      const cells: string[] = [];
      for (let col = 0; col < shelf.w; col++) {
        const stack = getStack(shelf, { row, col });
        cells.push(this.slotHtml(shelf.id, { row, col }, stack, zone));
      }
      rows.push(`
        <div class="shelf-row${zone ? ' is-taped' : ''}" data-shelf-row data-shelf="${shelf.id}" data-row="${row}"
             style="--zone:${zone?.color ?? 'transparent'}"
             title="${zone ? `第 ${row + 1} 行：${escapeHtml(zone.name)}` : `第 ${row + 1} 行：还没贴`}">
          <span class="row-tape" aria-hidden="true"></span>
          <span class="row-cells" style="--cols:${shelf.w}">${cells.join('')}</span>
        </div>
      `);
    }
    /*
     * 抬头那一行只报"这一架用到哪几张胶带"：
     * 一块架子可能贴了两三张（每张占一行），所以名字要能列得下。
     * 一张都没贴时仍然是"还没贴"。
     */
    const zoneNames = zoneIdsOf(shelf)
      .map((id) => view.zones.find((z) => z.id === id))
      .filter((z): z is Zone => Boolean(z));
    const tapeLabel =
      zoneNames.length === 0
        ? '<em class="zone-name is-none">还没贴</em>'
        : zoneNames
            .map((z) => `<em class="zone-name" style="--zone:${z.color}">${escapeHtml(z.name)}</em>`)
            .join('');
    /*
     * ★★ 「这块家具凭什么占地方」——玩家问出来的。
     *
     * 用户的原话："我还想问你，冰箱现在是有效的吗，即便是我加家具加进来的冰箱也有效吗"
     *
     * 冰箱**是有效的**（`spoilFactor 0.4`，而货架是 1.0），而且自己买的走同一段逻辑。
     * 但**界面上一个字都没说** —— 玩家会问这个问题，本身就是"机制看不见"的证据。
     * 那句话早就写在 `FurnitureDef.why` 里（"断电之后它仍然是个箱子：
     * 装鲜食能多撑一阵，装别的占地方"），却只躺在数据里没人读。
     *
     * ⚠ **只在它真的做了什么时才显示**（`spoilFactor < 1`）：
     * 普通货架是 1.0，"什么都能放、什么都不额外保护"对玩家是废话 ——
     * 而一块架子上挂一句废话，四块架子就是四句（§5A 的层次口径）。
     */
    const fur = furnitureDefOf(shelf.kind);
    const special = fur.spoilFactor < 1 ? `<em class="shelf-why">${escapeHtml(fur.why)}</em>` : '';
    /*
     * ★ 维度 7 的位置那一半（`model/haul.ts`）：靠里那块取东西费劲。
     *
     * ## 它为什么非挂在**这一块**的头上
     *
     * 这条轴平时一分钱不多花（`carryFactor >= 1` 时乘数恒为 1），只在
     * "搬不动的天气"里出现 —— 而那正是玩家最没空研究界面的时候。
     * 挂在门口那块上没用（它不罚），挂在日报里也没用（日报说的是总数，
     * 而玩家需要知道的是**该把什么挪走**）。所以它只出现在该挪的那一块上。
     *
     * ⚠ 文案由 `farShelfNote` 统一给（与日报同一句话）—— 这里不拼字符串，
     * 免得两处说法漂开。
     */
    const far = farShelfNote(index, this.haulCarryFactor());
    const farNote = far === null ? '' : `<em class="shelf-far">${escapeHtml(far)}</em>`;
    return `
      <section class="shelf-card" data-shelf-card="${shelf.id}">
        <div class="shelf-head">
          <span class="zone-tape" style="--zone:${zoneNames[0]?.color ?? 'transparent'}"></span>
          <h2 class="shelf-title" data-shelf-title data-shelf="${shelf.id}" data-action="edit-zone" title="点一下改这张胶带">
            ${shelfLabel(shelf, index)}
            ${tapeLabel}
          </h2>
          ${tidy ? '<span class="tidy-badge">整整齐齐</span>' : ''}
          <button class="tape-btn${shelf.handyRank !== null ? ' is-handy' : ''}"
                  data-action="toggle-handy" data-shelf="${shelf.id}"
                  title="${handyTitle(shelf.handyRank, handyLimit)}">
            ${handyLabel(shelf.handyRank, handyLimit)}
          </button>
          <button class="tape-btn" data-action="edit-zone" data-shelf="${shelf.id}" aria-label="改这一架的胶带">
            ${iconSvg('tag')}<span>胶带</span>
          </button>
        </div>
        ${special}
        ${farNote}
        <div class="shelf-rows">${rows.join('')}</div>
      </section>
    `;
  }

  /**
   * 这一场的搬运惩罚。抽成一个方法是因为 `shelfHtml` 逐架调用它 ——
   * `disasterModifiersOf` 自己带缓存，所以这里不必再缓存一层；
   * 真正要防的是**在别处另写一个 `disaster.carryFactor ?? 1`**（第二个真相）。
   */
  private haulCarryFactor(): number {
    return disasterModifiersOf(this.store.run.disasterId).carryFactor;
  }

  private slotHtml(shelfId: string, pos: SlotPos, stack: ItemStack | null, zone: Zone | null): string {
    const attrs = `data-slot data-shelf="${shelfId}" data-row="${pos.row}" data-col="${pos.col}"`;
    if (!stack) return `<button class="slot is-empty" ${attrs} aria-label="空格"></button>`;
    const def = getItemDef(stack.itemId);
    const count = stackCount(stack);
    const day = this.store.run.day;
    const soon = isExpiringSoon(stack, day);
    // 中性信息点：白描一个墨色小圈，不用朱红（§5A：朱红 = 警告/重要）。
    // 没贴胶带的货架 isOffZone 恒为 false —— "我不分类"不点名。
    const off = isOffZone(zone, stack);
    const label = `${stackLabel(stack)}，${expiryText(stack, day)}${off ? '，不在这张胶带的清单里' : ''}`;
    return `<button class="slot${soon ? ' is-soon' : ''}" ${attrs} aria-label="${label}" title="${label}">
      <span class="slot-icon">${itemIconSvg(def.icon)}</span>
      ${count > 1 ? `<span class="slot-count">×${count}</span>` : ''}
      ${soon ? `<span class="slot-soon" aria-hidden="true"></span>` : ''}
      ${off ? '<span class="slot-off" aria-hidden="true"></span>' : ''}
    </button>`;
  }

  /**
   * 「加家具」那个按钮（§10.2.4 的"新货架 / 新家具类型" —— 第 6 步 B 的入口）。
   *
   * ## 三条界面纪律
   *
   *  ① **放不下时按钮不灰**，而是改成"家里放不下了"并指出去解锁新房 ——
   *     §4A 说"不许有死按钮"，而灰掉的按钮既不解释原因、也不给下一步；
   *  ② **现金不够时也不灰**，只是把差价说出来。这与商店里"钱不够"的处理一致：
   *     玩家需要知道自己差多少，而不是面对一个点不动的按钮；
   *  ③ 只在**整理页**给这个入口。它是"东西放不下了"的解药，
   *     而"东西放不下"这件事只在整理时被感受到。
   */
  private addFurnitureHtml(): string {
    /*
     * ★★ 生存期不给这个入口（M4 决策 B）。
     *
     * 这一道判断与 `mount()` 里那个"整个 host 不写出来"是**故意重复**的：
     * 那一边管"屏幕上有没有地方放它"，这一边管"这个方法本身会不会造出它"。
     * 只留前者的话，任何一次 `mount()` 之后的路径改动（比如把 host 加回来、
     * 或者别人在别处调这个方法）都会让入口**静默复活** —— 而它复活的表现
     * 是"玩家在生存期能花 100 块加一块货架"，不是任何一条报错。
     */
    if (isSurvivalOrganize(this.store.run)) return '';
    const meta = this.store.save.meta;
    const room = roomForNewFurniture(meta, this.store.run);
    if (!room) {
      /*
       * ★★ 「家里满了」这条说法重写过（2026-10 用户反馈）。
       *
       * 用户的原话：
       *
       * > "搬更大的家是啥意思我不懂，我也没见到多房间，我也没解锁过多房间"
       *
       * 两句都是文案的错，不是机制的错：
       *
       *  ① **"搬更大的家"** 是一个玩家推不出来的短语 —— 他从没见过"家"这个单位，
       *     也没见过"更大"是什么样。现在直接说**那间房叫什么**（储藏间），
       *     以及**它还锁着**；
       *  ② **"活到最后一次"** 更糟 —— 那句读起来像"再撑一天"，
       *     而它实际的意思是"**完整跑完一局**（囤货期 + 生存期，撑满或倒下都算）"。
       *     间隔用的 `survivedRuns` 数的是**局**，不是天。
       *     所以写清是"跑完一局"，并把**还差几局**报出来。
       */
      const locked = lockedRooms(meta)[0];
      const name = locked ? locked.label : '新的房间';
      const need = locked ? locked.need : 1;
      const done = survivedRuns(meta);
      const left = Math.max(1, need - done);
      return `<button class="btn" data-action="explain" data-explain="家里放不下了：每间房能放几块是固定的，${name}还锁着。解锁条件是**把一整局跑完**（囤货期 + 生存期，撑满或倒下都算）——再跑完 ${left} 局就开，它自带 3 块空位。">${iconSvg('box')}<span>放不下了 · ${name}还锁着</span></button>`;
    }
    const cash = this.store.run.cash;
    /*
     * ★ 四种家具都摆出来（2026-10 清偿 D-30：`floor` 原来被这一行滤掉，
     * 全仓没有第二个购买入口 —— 于是"地面"这件家具玩家一辈子见不到，
     * 而它是四件里唯一真有取舍的：便宜 40 元，但只有 12 格，且什么保护都没有）。
     *
     * 「加家具 N 起」用最便宜那件当门槛：门槛写死 100 会让 60 元的家具
     * 摆在一个显示"要 100"的按钮下面。
     */
    const cheapest = Math.min(...FURNITURE_DEFS.map((d) => furniturePriceOf(d.kind)));
    /*
     * ★ 展开四个选择，而不是弹对话框。
     *
     * 手机上没有 hover，而"加家具"是一个**要挑种类**的动作
     * （货架 / 冰箱 / 柜子 / 地面四者的格数与腐坏乘数不同）。做一个对话框要处理
     * 遮罩、焦点、返回键；而四个并排的小按钮说的是同一件事，还少一层。
     * 展开后**不自动收起** —— 玩家可能想连着加两块。
     *
     * ★ 每颗按钮把**价钱写在名字旁边**，钱不够时给"差 N"而**不置灰**（§4A 那条
     * 界面纪律：灰按钮只说"不行"，"差 40"说的是"你离它有多远"）。
     * 价钱不写进 `title` —— 手机上永远看不到 title。
     */
    const picks = FURNITURE_DEFS.map((d) => {
      const price = furniturePriceOf(d.kind);
      const short = price - cash;
      return `<button class="mini is-price" data-action="add-furniture" data-kind="${d.kind}" data-price="${price}" title="${escapeHtml(d.why)}">${escapeHtml(d.label)}<b class="mini-price">${price}</b>${
        short > 0 ? `<em class="btn-note">差 ${short}</em>` : ''
      }</button>`;
    }).join('');
    return `
      <div class="add-furniture">
        <button class="btn" data-action="toggle-add">${iconSvg('box')}<span>加家具 ${cheapest} 起</span>${
          cash >= cheapest ? '' : `<em class="btn-note">差 ${cheapest - cash}</em>`
        }</button>
        ${
          this.addOpen
            ? `<div class="add-picks" role="group" aria-label="挑一种家具">
                 <span class="add-picks-title">加哪一种？</span>
                 ${picks}
                 <button class="mini" data-action="toggle-add">收起</button>
               </div>`
            : ''
        }
      </div>
    `;
  }

  private renderDock(view: OrganizeView): void {
    const hand = view.held;
    const handHtml = hand
      ? `<div class="hand-item">
           <span class="hand-icon">${itemIconSvg(getItemDef(hand.itemId).icon)}</span>
           <span class="hand-text">${escapeHtml(stackLabel(hand))}<em>${escapeHtml(expiryText(hand, this.store.run.day))}</em></span>
         </div>
         <button class="mini" data-action="return">放回</button>`
      : `<div class="hand-item"><span class="hand-icon is-empty">${iconSvg('hand')}</span><span class="hand-text">空手<em>点纸箱拆箱，点格子放置</em></span></div>`;

    const boxes = view.boxes
      .map((box) => {
        const def = box.top ? getItemDef(box.top.itemId) : null;
        const isEmpty = box.items.length === 0;
        return `<button class="box${isEmpty ? ' is-empty' : ''}" data-box="${box.id}" data-drop="box" aria-label="${escapeHtml(box.name)}，还有 ${box.total} 件">
          <span class="box-icon">${iconSvg('box')}</span>
          <span class="box-meta">
            <span class="box-name">${escapeHtml(box.name)}</span>
            <span class="box-count">${box.total} 件</span>
          </span>
          ${def ? `<span class="box-peek">${itemIconSvg(def.icon)}</span>` : ''}
        </button>`;
      })
      .join('');

    /*
     * ★ 折叠态：一条 34px 的摘要（有几箱、共几件），整条可点开。
     *
     * 判据用 `view.boxes.length` 而**不是** `boxItems.length` —— 这一栏说的就是
     * "还没拆的纸箱"，箱子拆空了也仍然占一个格子（`is-empty` 那一档）。
     */
    const folded = `<button class="boxes-fold" data-action="toggle-boxes" aria-expanded="false">
        ${iconSvg('box')}<span>纸箱 ${view.boxes.length} 个 · 共 ${view.boxes.reduce((n, b) => n + b.total, 0)} 件</span><em>展开</em>
      </button>`;

    this.dockEl.querySelector('[data-hand]')?.classList.toggle('has-item', hand !== null);
    const handHost = this.dockEl.querySelector('[data-hand]');
    if (handHost) handHost.innerHTML = handHtml;
    const boxHost = this.dockEl.querySelector('[data-boxes]');
    if (boxHost) {
      boxHost.classList.toggle('is-folded', !this.boxesOpen);
      boxHost.innerHTML = !this.boxesOpen
        ? folded
        : `<div class="boxes-head">
             <span class="boxes-title">还没拆的箱子</span>
             <button class="mini" data-action="toggle-boxes" aria-expanded="true">收起</button>
           </div>${boxes || '<p class="box-empty-hint">箱子都拆完了。货架归你管。</p>'}`;
      this.bindBoxGestures();
    }

    /*
     * ★ 「加家具」那一组要**每次重画**，不能写死在 `mount()` 的静态 HTML 里。
     *
     * 我第一版就是写死的，结果 `toggle-add` 只改了 `this.addOpen` 而没有 DOM 可改
     * —— 点一下什么都不会发生。用户报的"加家具那个按钮没用"正是这个。
     *
     * 根因是 `renderDock` 的模式：它**只重画有 host 的那几块**
     * （`[data-hand]` / `[data-boxes]`），静态元素只在 `mount()` 里出现一次。
     * 所以任何"状态会变"的 dock 内容都必须有自己的 host。
     */
    const addHost = this.dockEl.querySelector('[data-add-furniture]');
    if (addHost) addHost.innerHTML = this.addFurnitureHtml();

    // 行动点用完了就不该再给一个"点了没反应"的按钮（§4A 无死按钮）
    const goOut = this.dockEl.querySelector<HTMLButtonElement>('[data-action="go-out"]');
    if (goOut) {
      const canGoOut = this.store.run.actionPoints > 0;
      goOut.disabled = !canGoOut;
      goOut.title = canGoOut ? `今天还能出门 ${this.store.run.actionPoints} 次` : '今天的行动点用完了';
    }
  }

  // ———————— 手势绑定 ————————

  /**
   * 已经挂上的手势 detacher。
   *
   * ★★ 这是"拖动卡住"的**真正病根**，屏幕级测试抓出来的
   * （断言 `win.listenerCount('pointerup')` 时发现竟然挂着 4 个）。
   *
   * `renderRoom` 用 `innerHTML` 换掉整间房，但**从来没有调用过这些 detacher**。
   * 而 `attachPointerGesture` 在拖拽期间会往 **window** 上加 `pointermove` / `pointerup`
   * 监听器 —— 只要手势没跑完就重绘了（**拾取一件东西就会重绘**），
   * 那些 window 监听器就永远留在那儿。
   *
   * 后果不是"泄漏一点内存"，而是**行为错乱**：
   * 僵尸监听器继续响应之后每一次 pointerup，而且是对着**已经不在屏幕上的旧元素**
   * 调 `onDragEnd` / `onUp` —— 于是新一次拖拽的收尾被旧手势干扰，
   * 表现成"拖着拖着卡住、得点一下原格子才好"。
   */
  private gestureDetachers: (() => void)[] = [];

  private clearGestureBindings(): void {
    /*
     * 刻意**不打 trace**：它在每一帧渲染都会跑（一次摘 72 个），
     * 打出来会把真正有用的信息淹没 —— 第一次排查时就是这样，
     * 满屏都是它，反而看不清 `beginDrag` / `endDrag` 的配对关系。
     */
    for (const detach of this.gestureDetachers) detach();
    this.gestureDetachers = [];
  }

  private bindRoomGestures(): void {
    this.clearLongPressBindings();
    /*
     * ★★ 手势从"每个格子各挂一份"改成"整块区域挂一份 + 委托"（2026-10）。
     *
     * ## 为什么必须上提一层（玩家第三次报"滑动方向是反的"的根因）
     *
     * `touch-action` **只对它被声明的那块像素生效，不继承**。原来 `none` 写在
     * `.slot` 上，于是：手指落在格子上归我们接管（方向对），落在**格子之间**
     * —— `gap`、货架卡的内边距、两张卡之间的空白 —— 那些像素还是 `auto`，
     * 浏览器在那里做**原生滚动**，方向与我们相反。
     *
     * 真浏览器实测（`scripts/_probe-scroll-two-writers.ts`，375×667）：
     *   格子上        398 → 438 → 478 → 518 → 558（跟手）
     *   格子之间的空白 398 → 333 → 293 → 253（**与手指相反**，日志 `cancel 来源=pointercancel`）
     *
     * 所以不是"方向写错了"，是**同一块屏幕上真有两个写着相反方向的写者** ——
     * 这也解释了它为什么能活过前两轮修复。修法必须成对：`touch-action: none`
     * 上提到 `.room-scroll`（见 `style.css`），手势也上提到同一个元素。
     *
     * ⚠ **不要**在这里再给每个格子各挂一份：一次 pointerdown 会建立两个
     * `ActiveGesture`，第二个把第一个顶掉，表现是"拖到一半手势换了主人"。
     */
    this.gestureDetachers.push(
      attachPointerGesture(
        this.roomEl,
        {
          onTap: (_point, element) => {
            const slot = slotFromElement(element);
            if (!slot) return;
            this.consume(tapSlot(this.store, this.session, slot.shelfId, slot.pos));
          },
          onDragStart: (point, element) => {
            /*
             * ★ 来源必须**当场定**，不能从 `session.heldFrom` 读（M2 走测抓出来的 bug）。
             *
             * 原来的写法是：手里空则拾取这一格，然后 `beginDrag` 从 `session.heldFrom`
             * 取来源。可"先点一下 A 把 A 拿到手上、再拖 B"时：
             *   · 手里已经有 A → **不拾取 B**（手里还是 A）；
             *   · 但 `heldFrom` 指的是 **A 那一格**，而 A 那格此时是**空的**；
             *   · 松手时 `swapSlots(from = A 那格, to = B 那格)` → A 那格没东西 → 拒绝。
             * 玩家看到的是"我明明拖了两件东西互换，它跟我说必须得有东西才谈得上互换"。
             *
             * 现在：**手里的东西就是这一趟拖的货，来源就是它来的那一格**；
             * 手里空才当场拾取这一格，来源就是这一格。
             */
            const slot = slotFromElement(element);
            /* 手指落在格子之间的空白上：这一趟只滚屏，不开拖 */
            if (!slot) return;
            if (this.session.held && this.session.heldFrom.kind === 'shelf') {
              this.beginDrag(
                'shelf',
                {
                  shelfId: this.session.heldFrom.shelfId,
                  pos: this.session.heldFrom.pos
                },
                point
              );
              return;
            }
            if (!this.session.held) {
              this.consume(pickupFromShelf(this.store, this.session, slot.shelfId, slot.pos));
            }
            this.beginDrag('shelf', { shelfId: slot.shelfId, pos: slot.pos }, point);
          },
          onDragMove: (point) => this.moveDrag(point),
          onDragEnd: (point) => this.endDrag(point),
          onCancel: () => this.cancelDrag()
        },
        /*
         * ⚠ 两个都要给：`selector` 让"格子"仍然是唯一算数的东西（`element` 就来自它），
         * `scrollHost` 让**空白处**的滑动也跟手 —— 它就是这块区域自己。
         *
         * ★ `moveTolerance: 6` 保持原值：鼠标按住挪 6px 就进拖拽（触摸不看它）。
         */
        { moveTolerance: 6, selector: '[data-slot]', scrollHost: this.roomEl }
      )
    );
    this.roomEl.querySelectorAll<HTMLElement>('[data-shelf-title]').forEach((el) => {
      const shelfId = el.dataset['shelf'];
      if (!shelfId) return;
      // §6.3：长按货架标题进入分区编辑（也保留了右上角的"分区"按钮，鼠标党不用长按）
      this.longPressDetachers.push(attachLongPress(el, () => this.sheet.open(shelfId)));
    });
  }

  private bindBoxGestures(): void {
    this.dockEl.querySelectorAll<HTMLElement>('[data-box]').forEach((el) => {
      const boxId = el.dataset['box'];
      if (!boxId) return;
      this.gestureDetachers.push(
        attachPointerGesture(el, {
          onTap: () => this.consume(takeFromBox(this.store, this.session, boxId)),
        onDragStart: (point) => {
          /*
           * 从纸箱拖起：手里空就当场拿一件；**来源一律是 `null`**。
           *
           * 没有货架来源，所以拖到占用格上只会走"放上去"（`placeHeld`），
           * 绝不走互换 —— 这是对的：从箱子里掏出来的东西没有"原来那一格"可换。
           *
           * （原来这里还判断过"手里那件是不是上一步没放下的一半"来沿用来源，
           * 那个 `holdingPartial` 标记连同 `DragState.partial` 一起删掉了：
           * 它与"这一趟从哪格拖起"是同一件事的两种说法，而两套说法会打架 ——
           * 玩家报的"拖两件互换却被拒绝"就是打架的结果。）
           */
          if (!this.session.held) this.consume(takeFromBox(this.store, this.session, boxId));
          this.beginDrag('box', null, point);
        },
          onDragMove: (point) => this.moveDrag(point),
          onDragEnd: (point) => this.endDrag(point),
          onCancel: () => this.cancelDrag()
        })
      );
    });
  }

  private readonly onClickBound = (e: MouseEvent): void => this.onDelegatedClick(e);

  /**
   * 长按监听器挂在 window 上，不会随货架重绘自动消失 —— 每次重绘都要先把上一批摘掉。
   * （M0 时期货架只重绘几次，泄漏看不出来；M1 每次放好一件都会重绘，必须收干净。）
   */
  private longPressDetachers: (() => void)[] = [];

  private clearLongPressBindings(): void {
    for (const detach of this.longPressDetachers) detach();
    this.longPressDetachers = [];
  }

  private onDelegatedClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    initAudio();
    const hit = target.closest<HTMLElement>('[data-action]');
    if (!hit) return;
    const action = hit.dataset['action'];
    const shelfId = hit.dataset['shelf'];
    switch (action) {
      case 'toggle-add':
        this.addOpen = !this.addOpen;
        // 只重画底部工具条：整屏重绘会把货架滚动位置与手势绑定一起重置，
        // 而"展开一个选择"不该有那个副作用
        this.renderDock(buildView(this.store, this.session));
        return;
      case 'toggle-boxes':
        /*
         * 纸箱那一栏折叠/展开（2026-10 玩家要求）。
         *
         * 与 `toggle-add` 同一套做法：**只重画 dock，不动房间** ——
         * 整屏重绘会把货架滚动位置重置，而玩家折叠纸箱正是为了去看下面的货架，
         * 一折就把滚动弹回顶部等于白折。
         */
        playSfx('pick');
        this.boxesOpen = !this.boxesOpen;
        this.renderDock(buildView(this.store, this.session));
        return;
      case 'add-furniture': {
        const kind = hit.dataset['kind'] as Shelf['kind'] | undefined;
        if (!kind) return;
        /*
         * ★ 钱不够时在**界面层**先说一句，并给足信息（差多少）。
         *
         * 这一道与 `addFurnitureCommand` 里的拒绝是**故意重复**的：命令层读的是
         * 存档里的 `cash`，界面层读的是玩家眼里那个数字 —— 两者本该一致，
         * 但"差别只有多少"这句话只有界面说得出（按钮不再是灰的，见 §4A）。
         */
        const price = furniturePriceOf(kind);
        const short = price - this.store.run.cash;
        if (short > 0) {
          showToast(this.fxLayer, `现金不够：这种家具 ${price} 元，还差 ${short} 元`, 'warn');
          return;
        }
        const result = addFurnitureCommand(this.store, this.session, kind);
        this.consume(result);
        if (result.ok) {
          this.addOpen = false;
          const added = result.events.find(
            (e): e is Extract<typeof e, { type: 'furnitureAdded' }> => e.type === 'furnitureAdded'
          );
          if (added) showToast(this.fxLayer, `放进了${added.roomLabel}`, 'ink');
        }
        this.render();
        return;
      }
      case 'explain':
        showToast(this.fxLayer, hit.dataset['explain'] ?? '', 'ink');
        return;
      case 'edit-zone': {
        /*
         * ★ 从**哪一行**点进来的，就编辑那一行贴着的那张胶带。
         *
         * 一行一段胶带之后，"给这架贴胶带"没有唯一答案 —— 玩家点的是
         * 第 2 行的那条色条，他想改的就是第 2 行的那张。
         *
         * ⚠ `rows` 现在**只用来认领要编辑的那张胶带**（见 `ZoneSheet.open`），
         * 不再表示"保存时贴到哪几行" —— 那个决定已经交给拖拽了。
         */
        const rowAttr = hit.dataset['row'];
        if (shelfId) this.openZoneDrawer(shelfId, rowAttr === undefined ? undefined : [Number(rowAttr)]);
        return;
      }
      case 'toggle-handy':
        if (shelfId) this.consume(toggleHandy(this.store, shelfId));
        return;
      case 'sort':
        this.consume(sortAllByFEFO(this.store, this.session));
        return;
      case 'return':
        this.consume(returnHeld(this.store, this.session));
        return;
      case 'mute': {
        setMuted(!isMuted());
        const label = this.root.querySelector('[data-mute-label]');
        if (label) label.textContent = isMuted() ? '已静音' : '静音';
        return;
      }
      case 'go-out':
        this.props.onGoOut();
        return;
      case 'end-day':
        this.props.onEndDay();
        return;
      case 'back-survival':
        this.props.onBackToSurvival();
        return;
      case 'restart':
        if (window.confirm('重开一局会清空这一局的所有进度（物资、分区、现金），确定吗？')) this.props.onRestart();
        return;
      default:
        return;
    }
  }

  // ———————— 拖拽 ————————

  /**
   * 这一趟拖拽**从哪儿起的**（`null` = 从纸箱里拖出来的，没有货架来源）。
   *
   * ★ 它由 `beginDrag` 的调用方**当场传进来**，绝不从 `session.heldFrom` 读 ——
   * 那个字段反映的是"手里那件从哪来"，而在"先点 A 拿在手上、再拖 B"这种顺序下
   * 它与"这一趟拖的是谁"是两回事。读错的后果是：把空的那一格当成来源，
   * `swapSlots` 于是拒绝，并给玩家一句莫名其妙的"两个格子都得有东西才谈得上互换"。
   */
  private dragOrigin: { shelfId: string; pos: SlotPos } | null = null;

  private beginDrag(
    source: DragState['source'],
    origin: { shelfId: string; pos: SlotPos } | null = null,
    /** 拖拽起手的指针位置 —— **顺手就把幽灵摆到这儿**，别让它在 (0,0) 闪一下 */
    at: { x: number; y: number } | null = null
  ): void {
    if (!this.session.held) return;
    this.drag = { active: true, source };
    this.dragOrigin = origin;
    /*
     * ★★ 起手先把**从上一轮手势留下的悬停**清掉（屏幕级测试抓出来的）。
     *
     * `moveDrag` 有一句"落点没变就提前 return"（那一句本身是对的：
     * 落点没变就不该重画预览、不该再播一次音效）。可 `hoverEl` 是**跨手势**
     * 留着的字段 —— 上一趟拖完松手时它记着最后一格，而新一轮的第一次移动
     * 只要落在同一格上，那句提前 return 就会吃掉这一帧：
     * 预览记号不加、`is-hover-snap` 不加、而 `data-snap` 那个标记
     * 更是要等到**第二次移动**才补上。
     *
     * 后果是"按下就拖到某处、然后停住"这种最自然的操作，第一次落点
     * 永远不亮（玩家看到的是"拖过去没反应，再动一下才亮"）。
     * 起手清空 hoverEl 之后，新一轮的第一次移动必定走完整段判定。
     */
    this.clearHover();
    const el = document.createElement('div');
    el.className = 'drag-ghost';
    const held = this.session.held;
    el.innerHTML = `${itemIconSvg(getItemDef(held.itemId).icon)}<span class="ghost-count">×${stackCount(held)}</span>`;
    /*
     * ★ **创建时就摆到指针的位置**。
     *
     * 幽灵是 `position: fixed`，靠 inline 的 `left`/`top` 定位；不设就落在
     * **视口左上角 (0,0)**，要等第一次 `onDragMove` 才跳到指针处。
     * 鼠标路径下这个空档极小（移动 6px 就进拖拽，紧接着就有 move），
     * 但**触摸长按路径会"先窄后跳"**：长按成立时手指已经停着不动，
     * 而 `onDragMove` 要等手指再动一下才来 —— 玩家看到的就是"幽灵卡在最左上角"。
     */
    el.style.left = `${at?.x ?? 0}px`;
    el.style.top = `${at?.y ?? 0}px`;
    this.fxLayer.appendChild(el);
    this.ghost = el;
  }

  /** 幽灵跟随指针（抽出来给 `moveDrag` 用，也让"初始摆位"和"移动"走同一段代码） */
  private moveGhostTo(point: { x: number; y: number }): void {
    const ghost = this.ghost;
    if (!ghost) {
      return;
    }
    /*
     * ★ 幽灵如果已经不在文档里（被某次重绘/替换丢掉），就当作"没有幽灵"、
     * 顺手把引用清掉 —— 否则会出现"我们以为它在、其实它早没了"的状态，
     * 之后每一次移动都在给一个看不见的元素设 left/top。
     */
    if (ghost.isConnected === false) {
      this.ghost = null;
      return;
    }
    ghost.style.left = `${point.x}px`;
    ghost.style.top = `${point.y}px`;
  }

  private moveDrag(point: { x: number; y: number }): void {
    /*
     * ★ 只要**幽灵还在屏幕上**就让它跟手，不再先看 `this.drag.active`。
     *
     * 原来的顺序是"先判 active、再移动"，于是 `active` 只要因为任何原因
     * （被取消、被旧手势覆盖、重绘时序）与"幽灵存在"这件事不同步，
     * 幽灵就会**钉在最后一次成功移动的位置一动不动**，而后面的落点判定照旧跑 ——
     * 玩家看到的是"留下一个影子、然后啥也干不了"。
     * 幽灵存在 = 玩家正在拖，这是更可靠的那个信号。
     */
    this.moveGhostTo(point);
    if (!this.drag.active) return;
    const slot = this.pickDropSlot(point);
    /*
     * ★★ `data-snap` 必须在**提前 return 之前**读出来（屏幕级测试抓出来的）。
     *
     * `nearestLegalSlot` 每帧都会给这一帧选中的格子打上 `data-snap="1"`，
     * 而下面那句 `slot === this.hoverEl` 会在"落点没变"时直接返回。
     * 原来把读取放在返回之后：拖动中**第一次**选中某格时会走进来读到 `'1'`、
     * 加对了 `is-hover-snap`；可只要指针继续在这格附近微动（落点不变），
     * 后续每一帧都在**同一个元素**上重新打标记然后提前返回 ——
     * 读到的 `data-snap` 于是可能是"上一帧这次调用之前"的状态，
     * 中间一旦经过 `clearHover()` 清过一次，`is-hover-snap` 就再也加不上，
     * 而 `data-snap` 这个**供测试与外部查询的标记**也会与当前选中格不一致。
     * 顺序改成"先读、再决定要不要重画"。
     */
    const snapped = slot !== null && slot.dataset['snap'] === '1';
    if (slot === this.hoverEl) return;
    this.clearHover();
    if (slot) {
      this.hoverEl = slot;
      const shelfId = slot.dataset['shelf'];
      const row = Number(slot.dataset['row']);
      const col = Number(slot.dataset['col']);
      const stack = shelfId ? getStack(this.shelfById(shelfId), { row, col }) : null;
      const sameItem = stack && this.session.held && stack.itemId === this.session.held.itemId;
      // 三个记号各说一件事：会放（虚线）/ 会换（实线 + 角标）/ 这是吸附（半透明 + 虚线角标）
      slot.classList.add(stack && !sameItem ? 'is-hover-swap' : 'is-hover');
      if (snapped) slot.classList.add('is-hover-snap');
      playSfx('preview');
    }
  }

  private endDrag(point: { x: number; y: number }): void {
    const wasActive = this.drag.active;
    /*
     * ★★ 落点**按松手时的坐标重新判定**，不再优先用 `this.hoverEl`。
     *
     * `hoverEl` 是"上一帧悬停到的那一格"，它与"松手这一刻指针在哪"**不保证一致**：
     *  · 最后一帧可能因为移动太小没触发 `moveDrag`（`slot === this.hoverEl` 会提前 return）；
     *  · 中途被重绘换掉过元素时，缓存的可能是**已经不在文档里**的那一个；
     *  · 玩家快速松手时，最后一次 `pointermove` 与 `pointerup` 之间可能还差一点。
     *
     * 拿旧缓存当落点的后果就是玩家报的怪现象：把 A 拖到 B 上，却提示
     * "两个格子都得有东西才谈得上互换" —— 因为判定的其实是**起手那一格**
     * （它已经被拿空了），而不是 B。
     *
     * `pickDropSlot` 本来就是纯函数式的判定（看坐标 + 当前盘面），重算一次很便宜，
     * 而且**与悬停预览用的是同一套规则**，所以"看到什么就落到什么"。
     */
    const slot = this.pickDropSlot(point) ?? this.hoverEl;
    this.endGhost();
    if (!wasActive || !this.session.held) {
      this.drag = { active: false, source: 'shelf' };
      return;
    }
    this.drag = { active: false, source: 'shelf' };

    if (slot) {
      const shelfId = slot.dataset['shelf'];
      const row = Number(slot.dataset['row']);
      const col = Number(slot.dataset['col']);
      if (shelfId) {
        /*
         * ★ 这里分成两条路（玩家要求"独立开"）：
         *
         *  · **拖拽 A 落在 B 上** → 两格互换，手保持空（`swapSlots`）；
         *  · **手里拿着东西点格子** → 放上去，被换的那件进手里（`placeHeld`）。
         *
         * 判据只有三个：这一趟是**从货架的某一格**拖起的（`dragOrigin` 有值）、
         * 落点那一格压着**别的**物资、而且不是原来那一格。
         */
        const target = getStack(this.shelfById(shelfId), { row, col });
        const held = this.session.held;
        const origin = this.dragOrigin;
        const sameSlot =
          origin !== null &&
          origin.shelfId === shelfId &&
          origin.pos.row === row &&
          origin.pos.col === col;
        const canSwap =
          origin !== null && target !== null && held !== null && target.itemId !== held.itemId && !sameSlot;
        if (canSwap && origin) {
          /*
           * ★★ 用 `swapHeldWithSlot`，不是 `swapSlots`。
           *
           * 拖拽的物理过程是"起手那一格**先被拿空**"（`onDragStart` 里
           * `pickupFromShelf` 已经把东西移进手里），所以起手格此刻是空的 ——
           * 而 `swapSlots` 要求两格都有东西，于是它**必然拒绝**并甩出那句
           * "两个格子都得有东西才谈得上互换"。玩家看到的正是这句话。
           *
           * 正确的模型是"**手里这件**换到落点、落点那件回到起手格"：
           * 对玩家而言与"两格对调"完全一样，但它符合拖拽的真实中间状态。
           */
          const res = swapHeldWithSlot(
            this.store,
            this.session,
            { shelfId: origin.shelfId, pos: origin.pos },
            { shelfId, pos: { row, col } }
          );
          this.consume(res);
          return;
        }
        this.consume(placeHeld(this.store, this.session, shelfId, { row, col }));
        return;
      }
    }
    const el = document.elementFromPoint(point.x, point.y);
    if (el instanceof HTMLElement && el.closest('[data-drop="return"]')) {
      this.consume(returnHeld(this.store, this.session));
      return;
    }
    // 丢在空地：留在手里，玩家可以再点一个格子放下去（点选-点放永远兜底）
    this.render();
  }

  private endGhost(): void {
    this.ghost?.remove();
    this.ghost = null;
    /*
     * ★★ 顺手把**所有**游离的幽灵都扫掉，不只清我们自己记着的那个引用。
     *
     * 理由：拖拽诊断的日志里出现过"两次 `beginDrag` 之间没有 `endDrag`"的时序 ——
     * 意味着前一次手势的幽灵**没被任何人认领**，于是它作为孤儿元素永久留在
     * `fx-layer` 里（玩家看到的就是"留一个影子在那儿、点别的格子才把它顶掉"）。
     * 只要"引用"与"实际"不同步一次就会产生孤儿，所以清理要**按 DOM 找**，
     * 而不是依赖"我们记得它"。
     *
     * 幽灵是这个应用里唯一会出现在 `fx-layer` 的 `.drag-ghost`，可以放心全清。
     */
    for (const stray of this.fxLayer.querySelectorAll('.drag-ghost')) stray.remove();
    this.clearHover();
  }

  /**
   * 手势被**中断**（不是正常松手）：收掉幽灵与悬停预览，物资留在手里。
   *
   * ★ 这个方法是被屏幕级测试逼出来的。`attachPointerGesture` 有一条 `onCancel`
   * 通路（长按成立前判定为滚动、以及看门狗认定手势僵死），
   * 而屏幕层**原本没有实现它** —— 于是看门狗虽然把手势结束了，
   * **幽灵却没人收**，正好就是玩家截图里那个"卡住不动的小方块"。
   *
   * 刻意不把物资放下：这是一次被中断的操作，玩家没表达"放哪儿"，
   * 留在手里才是可继续的状态（想放就再点一格）。
   */
  private cancelDrag(): void {
    this.drag = { active: false, source: 'shelf' };
    this.dragOrigin = null;
    this.endGhost();
    this.render();
  }

  private clearHover(): void {
    if (this.hoverEl) {
      this.hoverEl.classList.remove('is-hover', 'is-hover-swap', 'is-hover-snap');
      this.hoverEl = null;
    }
  }

  /**
   * 落点判定：**指针正下方那一格优先，不行就吸附到同架最近的合规落点**（口径 3）。
   *
   * ## 三段，按优先级
   *
   *  ① **指针底下就是格子** → 用它（精确操作）；
   *  ② 命中的是**特效层里的东西**（拖拽幽灵、拟声字…）→ 不看它，改按坐标
   *     **几何命中**最近的格子；
   *  ③ 指针在货架卡里但不是格子 → 吸附到同架最近的合规落点；
   *  ④ 指针在货架卡之外 → 不吸附（那是"我要放下"和"我要放回"的分界）。
   *
   * ## ★ 第 ② 段是怎么来的（玩家报的现象）
   *
   * "把 A 正正好好放在 B 上反而判定不到，中心周围一小圈才能判定到。"
   *
   * `elementFromPoint` 命中的是**最上层**元素。幽灵就跟着指针、**正好在指针底下**，
   * 所以它天然是候选。我给 `.drag-ghost` 补了 `pointer-events: none`（正确且必要），
   * 但玩家反馈"没变化" —— 说明**至少还有一个因素**，而我不该再去赌它是什么
   * （可能是浏览器/设备模拟对 `pointer-events` 的处理，也可能是别的覆盖层）。
   *
   * 所以第 ② 段**从结构上绕开这个问题**：命中到 `fx-layer` 里的东西时，
   * 不信 `elementFromPoint`，改按坐标自己找 —— 幽灵在哪儿、它吃不吃指针事件，
   * 都不再影响判定。**证据比机制更重要**：我赌错一次，就不赌第二次。
   */
  private pickDropSlot(point: { x: number; y: number }): HTMLElement | null {
    const el = document.elementFromPoint(point.x, point.y);
    const held = this.session.held;
    const inFxLayer = el instanceof HTMLElement && el.closest('[data-fx]') !== null;

    /*
     * ★ 命中的在**特效层**里（幽灵等），或压根没命中 → 直接走几何兜底。
     * 幽灵自己写了 `pointer-events: none`，正常情况下不会挡；但"正常情况"这四个字
     * 在移动端不太可靠（层叠上下文 / 设备模拟 / `pointer-events` 的穿透对象
     * 依实现而定）—— 而几何兜底比排查那些便宜得多。
     */
    if (!inFxLayer && el instanceof HTMLElement) {
      const exact = el.closest<HTMLElement>('[data-slot]');
      if (exact) {
        if (!held) return exact;
        const shelfId = exact.dataset['shelf'];
        const stack = shelfId
          ? getStack(this.shelfById(shelfId), {
              row: Number(exact.dataset['row']),
              col: Number(exact.dataset['col'])
            })
          : null;
        // 空格、或同类（会合并）→ 正常落点
        if (!stack || stack.itemId === held.itemId) return exact;
        // 占用格上是**别的**物资：这一趟从某格拖起的 → 合规（会互换）
        if (this.dragOrigin !== null) return exact;
      }
    }

    // ② 命中的是特效层（幽灵等）、或没命中 → 按坐标几何命中
    const byGeometry = this.slotUnderPoint(point);
    if (byGeometry) return byGeometry;

    // ③ 指针在货架卡里但不是格子 → 吸附到同架最近的合规落点
    const card =
      el instanceof HTMLElement
        ? el.closest<HTMLElement>('[data-shelf-card]')
        : this.cardUnderPoint(point);
    const shelfId = card?.dataset['shelfCard'];
    if (!shelfId) {
      /*
       * ④ 货架之外：不吸附。★ 但**必须把上一帧留下的吸附标记抹掉** ——
       * 这条路径以前直接 `return null`，于是"指针已经离开货架"之后
       * 那一格还挂着 `data-snap="1"`：屏幕上那个虚线角标不会自己消失，
       * `data-snap` 也不再等于"最近一次判定"（屏幕级守卫抓到的第二处）。
       */
      this.wipeSnapMarks();
      return null;
    }
    return this.nearestLegalSlot(shelfId, point);
  }

  /**
   * 抹掉所有 `data-snap`。
   *
   * 这个标记的语义是"**最近一次吸附判定的结果**"，所以要保住两件事：
   * 判定时只留一个（见 `nearestLegalSlot`），而判定**不成立时**一个都不留
   * （见 `pickDropSlot` 的第 ④ 段）。
   */
  private wipeSnapMarks(): void {
    this.roomEl.querySelectorAll<HTMLElement>('[data-slot][data-snap]').forEach((el) => {
      delete el.dataset['snap'];
    });
  }

  /**
   * 按坐标找"指针正下方的那一格"（几何命中），不看 `elementFromPoint`。
   * 用于绕开"特效层里的东西挡在指针底下"这种情况 —— 幽灵的位置是可信的
   * （我们自己设的 `left/top`），而"谁在指针最上层"是浏览器的说法，可能受
   * `pointer-events`、层叠上下文、设备模拟等一堆因素影响。
   */
  private slotUnderPoint(point: { x: number; y: number }): HTMLElement | null {    const held = this.session.held;
    let best: HTMLElement | null = null;
    let bestArea = Number.POSITIVE_INFINITY;
    this.roomEl.querySelectorAll<HTMLElement>('[data-slot]').forEach((slot) => {
      const r = slot.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (point.x < r.left || point.x > r.left + r.width) return;
      if (point.y < r.top || point.y > r.top + r.height) return;
      const shelfId = slot.dataset['shelf'];
      if (held && shelfId) {
        const stack = getStack(this.shelfById(shelfId), {
          row: Number(slot.dataset['row']),
          col: Number(slot.dataset['col'])
        });
        // 与①同一套合规判据，两处必须一致
        if (stack && stack.itemId !== held.itemId && this.dragOrigin === null) return;
      }
      // 取面积最小的那个（嵌套时取最里层），并优先取文档里靠后的（上层）
      const area = r.width * r.height;
      if (area <= bestArea) {
        bestArea = area;
        best = slot;
      }
    });
    return best;
  }

  /**
   * 按坐标找"指针正下方的那一格"（几何命中），不看 `elementFromPoint`。
   *
   * ## ★★ 为什么必须有这一条（用户报的"正好放在图标上就没判定"）
   *
   * 用户的原话：
   *
   * > "不管是剪刀还是加号还是已有标签，如果正好放在图标上就没判定了，
   * >  这其实是个老问题，改一下"
   *
   * "老问题"三个字是准的 —— 货物拖拽那条路上早就有 `slotUnderPoint` 兜底，
   * 而**胶带这条新路只写了 `elementFromPoint`**，于是把同一类毛病重新引入了一遍。
   *
   * 而这一类毛病的来源有三个，全都与"谁在指针最上层"有关：
   *  · 格子里的那枚 SVG 图标自己可以命中（它没有 `pointer-events: none`）；
   *  · 一行里 `pointer-events: none` 的元素（`.row-tape`、`.slot-count` 那些）
   *    在浏览器里会被**穿透**，但穿透到谁身上依实现而定；
   *  · `.slot:active` 的 `transform: scale(0.96)` 会让格子在被按住时**缩小**，
   *    手指落在边缘就可能落到格子外面。
   *
   * 几何命中的判据（与 `slotUnderPoint` 同一套）：取**包含该点、面积最小**的那个元素。
   * 面积最小 = 嵌套时取最里层，而那正是玩家指着的那个。
   */
  private rowUnderPoint(point: { x: number; y: number }): HTMLElement | null {
    return this.smallestUnderPoint('[data-shelf-row]', point);
  }

  /** 按坐标找指针底下的货架卡（`elementFromPoint` 不可信时的兜底） */
  private cardUnderPoint(point: { x: number; y: number }): HTMLElement | null {
    return this.smallestUnderPoint('[data-shelf-card]', point);
  }

  /**
   * 取"包含该点、面积最小"的那个元素。
   *
   * 抽出来是因为它在这次改动里被**三处**用到（格子 / 行 / 卡），
   * 而它自己那段逻辑（面积最小、平局取后者）是容易写歪的 ——
   * 与其复制三份，不如只有一份。
   */
  private smallestUnderPoint(selector: string, point: { x: number; y: number }): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestArea = Number.POSITIVE_INFINITY;
    this.roomEl.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (point.x < r.left || point.x > r.left + r.width) return;
      if (point.y < r.top || point.y > r.top + r.height) return;
      const area = r.width * r.height;
      // 平局用 `<=`：先访问到的是文档里靠前的，靠后的应当盖住它（粗略近似绘制顺序）
      if (area <= bestArea) {
        bestArea = area;
        best = el;
      }
    });
    return best;
  }
  /**
   * 同架离指针最近的**合法落点**。
   *
   * "合法" = 空格，或者装着**别的**物资的格子且**这一趟是从某格拖起的**（那是互换目标）。
   * 与 `pickDropSlot` 的①用同一套判据 —— 两处必须一致，否则"精确命中被拒、吸附却能落"
   * 这种自相矛盾的行为就会出现。
   *
   * ★★ 而"最近"之上还有一条**偏好**（W-02，2026-10）：半径内优先挑
   * **清单收它的那一行**。理由与半径怎么定的，见 `systems/organize.ts` 的
   * `pickSnapCandidate` —— 那里是纯函数，所以这个规则能被测试跑到；
   * 这里只负责把格子量成"距离 + 收不收"两栏。
   *
   * 返回的元素带 `data-snap="1"`，供悬停预览区分"精确命中"与"吸附"。
   */
  private nearestLegalSlot(shelfId: string, point: { x: number; y: number }): HTMLElement | null {
    /*
     * ★★ 开跑前先抹掉**上一帧留下的** `data-snap`（屏幕级守卫逼出来的分工）：
     * 这一帧的标记必须由这一帧的判定来打，否则"这一格是不是吸附来的"这个问题
     * 会被上一帧的答案回答。抹干净 + 帧末保留，两件事合起来才让
     * `data-snap="1"` 成为"**最近一次吸附判定的结果**"这个可断言的事实。
     *
     * ⚠ 这件事以前挂在 `clearHover()` 里，而 `clearHover()` 是在**判定之后**
     * 被调用的 —— 于是它删掉的正是这一帧刚打的标记：屏幕上 `is-hover-snap`
     * 加得上（那是提前读出来的布尔值），`data-snap` 却永远查不到。
     */
    this.wipeSnapMarks();
    const shelf = this.shelfById(shelfId);
    const held = this.session.held;
    const canSwap = this.dragOrigin !== null;
    const view = this.lastView;
    const candidates: HTMLElement[] = [];
    this.roomEl.querySelectorAll<HTMLElement>(`[data-slot][data-shelf="${shelfId}"]`).forEach((el) => {
      const row = Number(el.dataset['row']);
      const col = Number(el.dataset['col']);
      const stack = getStack(shelf, { row, col });
      if (stack) {
        // 同类（会合并）随时合法；别的物资只有在"会互换"时才算合法落点
        const sameItem = held !== null && stack.itemId === held.itemId;
        if (!sameItem && !canSwap) return;
      }
      candidates.push(el);
    });
    if (candidates.length === 0) return null;

    /*
     * 手里那件的定义只查一次（外层循环里的每一格都要用同一份答案）。
     * `held === null` 时这一趟是"空手拖"，偏好整个关闭 —— 没有"收不收"可言。
     */
    const itemDef = held !== null ? getItemDef(held.itemId) : null;
    const scored = candidates.map((el) => {
      const rect = el.getBoundingClientRect();
      const row = Number(el.dataset['row']);
      const zone = view ? findZone(view.zones, rowZoneId(shelf, row)) : null;
      return {
        el,
        distance: Math.hypot(rect.left + rect.width / 2 - point.x, rect.top + rect.height / 2 - point.y),
        listed: itemDef !== null && zoneListedFor(zone, itemDef)
      };
    });

    const pick = pickSnapCandidate(
      scored,
      this.coarsePointer ? SNAP_PREFER_TOUCH_PX : SNAP_PREFER_PX
    );
    const best = scored[pick]?.el ?? null;
    if (best !== null) best.dataset['snap'] = '1';
    return best;
  }

  /**
   * 打开胶带抽屉。
   *
   * 它刻意做两件事：把目标货架滚到房间区顶部（抽屉只占下半屏，货架必须露在上面）、
   * 给它加虚线高亮 —— 分区是空间概念，编辑时必须看得见那块区域。
   *
   * @param shelfId 从哪块架子进来（不给 = 从**胶带架**进来，那时"从哪一块"没有答案，
   *   因为一张胶带可能贴在好几块架子上）
   * @param rows 从哪一行进来 —— 只用来**认领要编辑的那张胶带**
   * @param focusZoneId 直接指定要编辑哪一张（从胶带架轻点某一张时）
   *
   * ★ 抽屉是**纯编辑器**（2026-10 用户拍板："有了这个就不需要那个贴标签按钮了"），
   * 所以"贴到哪几行"不在这里决定 —— 那是拖拽的事。
   */
  private openZoneDrawer(shelfId?: string, rows?: number[], focusZoneId?: string): void {
    /*
     * ★ "同一个货架"不再等于"同一次编辑"：从第 1 行点进来与从第 3 行点进来
     * 要看的是不同的胶带。所以还开着的时候，只在**货架与行都一样**时才跳过重开 ——
     * 否则玩家点了另一行，抽屉里却还是上一行的内容（而那一行看起来"点了没反应"）。
     */
    const sameRows = (this.sheet.currentRows?.join(',') ?? '') === (rows ?? []).join(',');
    if (
      this.sheet.isOpen &&
      this.sheet.currentShelfId === (shelfId ?? null) &&
      sameRows &&
      !focusZoneId
    ) {
      return;
    }
    this.clearEditHighlight();
    this.sheet.open(shelfId ?? null, rows, focusZoneId);
    if (!shelfId) return;
    const card = this.roomEl.querySelector<HTMLElement>(`[data-shelf-card="${shelfId}"]`);
    if (card) {
      card.scrollIntoView({ block: 'start' });
      card.classList.add('is-editing');
    }
  }
  private clearEditHighlight(): void {
    this.roomEl.querySelectorAll('.shelf-card.is-editing').forEach((el) => el.classList.remove('is-editing'));
  }

  private shelfById(shelfId: string): Shelf {
    const shelf = this.store.run.shelves.find((s) => s.id === shelfId);
    if (!shelf) throw new Error(`找不到货架 ${shelfId}`);
    return shelf;
  }

  // ———————— 事件 → 表现层 ————————

  private consume(result: CommandResult): void {
    const after: Array<() => void> = [];
    for (const ev of result.events) {
      switch (ev.type) {
        case 'rejected':
          playSfx('reject');
          showToast(this.fxLayer, ev.reason, 'warn');
          break;
        case 'boxOpened':
          playSfx('unbox');
          after.push(() => this.wordOn(`[data-box="${ev.boxId}"]`, 'unbox'));
          break;
        case 'boxEmptied': {
          // 立刻量位置：重绘之后这个箱子就不在了
          const rect = this.rectOf(`[data-box="${ev.boxId}"]`);
          if (rect) spawnCrushGhost(this.fxLayer, rect);
          playSfx('crush');
          showToast(this.fxLayer, `${ev.label} 拆空了`);
          break;
        }
        case 'picked':
          playSfx('pick');
          break;
        case 'placed':
          playSfx('place');
          this.pendingFocus = { shelfId: ev.shelfId, pos: ev.pos };
          after.push(() => this.wordOn(slotSelector(ev.shelfId, ev.pos), 'place'));
          if (ev.partial) showToast(this.fxLayer, '这一格塞满了，剩下的还在手里');
          break;
        case 'swapped':
          playSfx('preview');
          this.pendingFocus = { shelfId: ev.shelfId, pos: ev.pos };
          // **两个格子都要有反馈**：交换是 A 去 B、B 去 A，只动落点那一个的话，
          // 屏幕上只有一边有动静，玩家会怀疑"另一件到底动没动"
          after.push(() => this.wordOn(slotSelector(ev.shelfId, ev.pos), 'swap'));
          after.push(() => this.wordOn(slotSelector(ev.from.shelfId, ev.from.pos), 'swap'));
          break;
        case 'returned':
          playSfx('return');
          // 放回哪儿去了必须说清楚 —— 否则玩家不知道东西跑哪了（"名副其实"的一半靠这句话）
          showToast(this.fxLayer, `放回 ${ev.toWhere}`);
          break;
        case 'sorted':
          playSfx('sort');
          if (ev.changedShelves === 0) showToast(this.fxLayer, '这些货架已经排好了');
          break;
        case 'tidy':
          playSfx('tidy');
          after.push(() => this.tidyOn(ev.shelfId));
          break;
        case 'handyChanged':
          playSfx('pick');
          // 说清它在哪个顺位 —— "顺手位"是个位置概念，不报顺位等于没说完
          showToast(
            this.fxLayer,
            ev.rank === null ? '从顺手位撤下' : '门口这块，急用的东西放这儿'
          );
          break;
        case 'zoneUpdated':
          break;
        case 'zoneRemoved':
          showToast(this.fxLayer, `已撕下「${ev.name}」`);
          break;
      }
    }
    this.render();
    for (const fn of after) fn();
  }

  private applyFocus(): void {
    const focus = this.pendingFocus;
    this.pendingFocus = null;
    if (!focus) return;
    const el = this.roomEl.querySelector<HTMLElement>(slotSelector(focus.shelfId, focus.pos));
    if (!el) return;
    el.classList.add('is-just-placed');
    window.setTimeout(() => el.classList.remove('is-just-placed'), 180);
  }

  private wordOn(selector: string, action: Parameters<typeof spawnSfxWord>[2]): void {
    const el = this.root.querySelector<HTMLElement>(selector) ?? this.roomEl.querySelector<HTMLElement>(selector);
    const rect = el ? el.getBoundingClientRect() : null;
    if (!rect) return;
    spawnSfxWord(this.fxLayer, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, action);
  }

  private tidyOn(shelfId: string): void {
    const el = this.roomEl.querySelector<HTMLElement>(`[data-shelf-card="${shelfId}"]`);
    if (!el) return;
    spawnTidyTag(this.fxLayer, el.getBoundingClientRect());
  }

  private rectOf(selector: string): DOMRect | null {
    const el = this.root.querySelector<HTMLElement>(selector);
    return el ? el.getBoundingClientRect() : null;
  }

  private query<T extends HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`缺少必需节点：${selector}`);
    return el;
  }
}

function slotSelector(shelfId: string, pos: SlotPos): string {
  return `[data-slot][data-shelf="${shelfId}"][data-row="${pos.row}"][data-col="${pos.col}"]`;
}

/**
 * ★★ 从**手指底下那个元素**读出"这是哪一块货架的哪一格"（2026-10 委托手势用）。
 *
 * ## 为什么需要它（而不是让调用方读 `e.target`）
 *
 * 手势挂在整块 `.room-scroll` 上（见 `bindRoomGestures` 那段注释），于是
 * `onTap` / `onDragStart` 收到的 `element` 是 `e.target.closest('[data-slot]')`
 * 的结果：命中的时候**它自己就带着 `data-shelf` / `data-row` / `data-col`**。
 * 而 `closest` 的答案与"格子在不在文档里"无关 —— 捏着它读属性是最稳的，
 * 不用再去 `elementFromPoint` 猜一次。
 *
 * ⚠ 返回 `null` 的两种情况都必须**安静地**处理：手指落在格子之间的空白上
 * （这一趟只滚屏），以及元素上缺 `data-shelf`（重绘中途的残缺节点）。
 */
function slotFromElement(element: HTMLElement | null): { shelfId: string; pos: SlotPos } | null {
  const shelfId = element?.dataset?.['shelf'];
  if (!element || !shelfId) return null;
  return { shelfId, pos: { row: Number(element.dataset['row']), col: Number(element.dataset['col']) } };
}

/**
 * ★ M4 W-06：顺手位按钮上的三个字。
 *
 * 上限是 1 时（绝大多数身份）与原来**一模一样**（`门口这块` / `顺手位`）——
 * 这是刻意的：小区保安那条天赋是"全屋唯一"的**破例**，
 * 如果为了它把所有人都改成"第 1 块 / 第 2 块"，那条破例就变成了新的常态，
 * 而 §12.3 v0.7.1 玩家拍板的正是"门口那块本该只有一个答案"。
 *
 * 上限是 2 时才需要第二档文案：标了第一块的叫"门口这块"，
 * 第二块得有个**不叫门口**的说法 —— 保安的第二块是"巡逻路线上的那一块"。
 * 两块的顺位仍然有意义（`Shelf.handyRank`），所以文案要能看出哪块是第一块。
 */
function handyLabel(rank: number | null, limit: number): string {
  if (rank === null) return '顺手位';
  if (limit <= 1) return '门口这块';
  return rank === 1 ? '门口这块' : '第二块';
}

/** 顺手位按钮的 `title`（鼠标党只有这一条路能问"再点一下会发生什么"） */
function handyTitle(rank: number | null, limit: number): string {
  if (rank !== null) {
    return limit > 1
      ? '这一块算顺手位。再点一下撤下，可以换别的架'
      : '门口就是这块。再点一下撤下，可以换别的架';
  }
  return limit > 1
    ? `把这块标成顺手位（你是${limit === 2 ? '小区保安，能标两块' : `能标${limit}块`}）`
    : '把这块标成门口的顺手位（全屋只有这一块）';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
