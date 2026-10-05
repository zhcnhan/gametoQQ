/**
 * 开局界面（§9.1：身份三选一卡 + 灾难揭示 + 先知日历；M1 身份二选一、灾难固定寒潮）。
 *
 * 分层纪律：本文件只读 data/ 的静态表；写操作一律通过 props.onConfirm 交回给 systems。
 * 「先知落差」是爽点①，所以日历必须**开局就给全**（§6.1），让玩家在选身份时就能算账：
 * 寒潮要燃料，夜班员的燃料便宜 20% —— 这个念头应该由界面自己浮出来，不要靠教学文案点破。
 *
 * ## ★ 这一页显示的必须是**这一局真的抽到的那一场**（M4 决策 A）
 *
 * 在 W-01 之前这里读的是 `M1_DISASTER_ID`（写死寒潮）：日历、温度、刚需品类
 * 全是寒潮那一份。而 `run.disasterId` 一旦能是别的一场，那一页就会**撒谎** ——
 * 玩家照着"要燃料和棉被"囤了 7 天，D-Day 来了才发现是热浪。
 *
 * ★ 所以 `disasterId` 是**从 run 传进来的**，不是这一页自己算的：
 * 它就是 `systems/setup.ts` 铺房间用的那个 id。两处各读一次源
 * （这里读常量、那里读 run）正是这个 bug 的形状。
 *
 * ★ 也是选①而不是"开局页让玩家选"的一个好处：玩家在开局页**就知道**
 * 自己抽到了哪一场，所以"先知知道该囤什么"这条身份设定仍然成立。
 */
import {
  DISASTER_DEFS,
  DISASTER_TIER_GATES,
  disasterPool,
  disasterTopTier,
  getDisasterDef
} from '../data/disaster';
import { CATEGORY_LABELS } from '../data/items';
import type { IdentityDef, MetaProfile } from '../model/types';
import { identityStartOf, unlockHintOf } from '../systems/identity';
import { lockedIdentities, unlockCandidates, unlockedIdentities, survivedRuns } from '../systems/unlock';

/**
 * 「还差什么」那一栏最多列几条。
 *
 * 刚开局时八件东西锁着（5 个身份 + 1 间房 + 更远的），全列出来会把开局页
 * 撑得很长，而开局页的主角是**三个身份卡**。所以只露最近的三条 + 一句"还有 N 件"。
 *
 * ★ 这个数不是"信息量"的取舍，是**版面**的取舍 —— 所以它属于界面层，
 * 而 `unlockCandidates()` 仍然给全部。
 */
const MAX_SHOWN = 3;
/** 全表有多少场灾难（报"还有 N 场没放出来"时用；从数据算，不写死） */
const TOTAL_DISASTERS = DISASTER_DEFS.length;
import { iconSvg } from '../fx/icons';
import { windowBandHtml } from './windowBand';
import type { Screen } from './Router';

export interface PrologueScreenProps {
  /** 玩家按下「就这么定了」，参数是选中的身份 id */
  onConfirm: (identityId: string) => void;
  onRestart: () => void;
  /**
   * ★ 这一局抽到的那一场灾难（`run.disasterId`）。
   *
   * 传 id 而不是传整个 run：这一页只读它一个字段（日历 / 温度 / 刚需品类
   * 全部从 `DisasterProfile` 上读），传 run 会让"这一页能改什么"变得看不出来。
   */
  disasterId: string;
  /**
   * 跨局账本（§10B.3 的身份熟练度与分批都要读它）。
   *
   * 为什么把 meta **整个**传进来，而不是传 `{ levelOf }` 这样一个查询函数：
   * 界面要画的是"这个身份我练到几级了、还差几次升级、要什么条件才解锁" ——
   * 那是三四个不同的问法，包成一个函数反而要在界面里写死背后读的是哪些字段。
   * 传数据、界面自己按需要格式化，是这一层原本就在做的事（它已经读 `IDENTITY_DEFS` 了）。
   */
  meta: MetaProfile;
}

export class PrologueScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly props: PrologueScreenProps;
  private selected: string | null = null;

  constructor(root: HTMLElement, props: PrologueScreenProps) {
    this.root = root;
    this.props = props;
  }

  private readonly onClickBound = (e: MouseEvent): void => this.onClick(e);

  mount(): void {
    this.root.addEventListener('click', this.onClickBound);
    this.render();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClickBound);
  }

  render(): void {
    const disaster = getDisasterDef(this.props.disasterId);
    const dday = disaster.calendar.find((f) => f.day === 0);
    /*
     * ★ 从这里**删掉**的那一块（D-33 / 决策 E）：原来是 `.calendar-strip`
     * 那条 66px 高的强度曲线 + `cal-axis` + 首日 hint，占据正文第一段。
     *
     * 用户要的是"日历的先知作用挪到最上面去"，所以它现在住在
     * `ui/prophetBar.ts` 里、由 `ui/windowBand.ts` 画进**每一屏**的顶栏底下
     * （连这一屏也有：`windowBandHtml(this.props.disasterId)`）。
     *
     * ⚠ 这里**不是"搬走了所以什么都不剩"**：开局页仍然要说"这一局会撞上什么"
     * —— D-Day 那句 `hint` 与"最要紧的是哪两类"是**选身份**时要看的东西
     * （选保安还是选装卸工，取决于这一场要囤什么），而逐日强度那种
     * "要规划才看"的细节才归顶栏。两处说同一件事时口径必须同源：
     * 这里的 `dday.hint` 与 `priorityCategories` 与顶栏读的是同一份数据。
     */
    const prepDays = disaster.calendar.filter((f) => f.day < 0).length;
    const canConfirm = this.selected !== null;

    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar">
          <div class="topbar-row">
            <div class="title">
              <h1>囤货末世</h1>
              <p class="sub">重生在灾难前 7 天</p>
            </div>
          </div>
        </header>
        ${windowBandHtml(this.props.disasterId)}
        
        <main class="scroll">
          <section class="block">
            <h2 class="block-title">你重生了，先决定你是谁</h2>
            <div class="identity-list">
              ${unlockedIdentities(this.props.meta)
                .map((def) => this.identityCard(def))
                .join('')}
            </div>
            ${this.nextUnlockHtml()}
            ${this.lockedHtml()}
          </section>

          <section class="block">
            <h2 class="block-title">这一局会撞上什么</h2>
            <p class="block-note strong">${escapeHtml(dday?.hint ?? '灾难将至。')}</p>
            <p class="block-note">
              最要紧的是 ${disaster.priorityCategories.map((c) => `<b>${CATEGORY_LABELS[c]}</b>`).join(' 和 ')}。
              你有 ${prepDays} 天准备。
            </p>
            ${this.disasterLadderHtml()}
          </section>
        </main>
        <footer class="dock">
          <div class="dock-tools">
            <button class="btn btn-primary" data-action="confirm" ${canConfirm ? '' : 'disabled'}>
              ${canConfirm ? '就这么定了' : '先选一个身份'}
            </button>
          </div>
        </footer>
      </div>
    `;
  }

  /**
   * ★★ **这一局可能抽到哪几场** + **还差什么才能抽到更多**（M4，用户 2026-10 报的）。
   *
   * ## 用户的原话（这一块存在的全部理由）
   *
   * > "我问一下你的设定是不是必须撑过一次寒潮才能解锁其他灾难呢，
   * >  因为我没通过几次他也没解锁"
   *
   * 他说得对，而且那条规则**在界面上一个字都没有** ——
   * 玩家只能靠"反复重开、发现永远是寒潮"自己猜出这条规则，
   * 而猜出来的版本（"过几次就解锁"）比真相宽松，于是它读起来像 bug。
   *
   * ## 为什么这一块必须写在**开局页**（而不是结算页）
   *
   * 因为抽签发生在**开新局的那一刻**（`data/disaster.ts` 的 `DISASTER_TIER_GATES`）：
   * 玩家要问"我这次能不能撞上点别的"，问的正是这一屏。
   * 而结算页回答不了它 —— 那一局的灾难早就定了。
   *
   * ## 口径：报**池子有多大**与**下一档差什么**
   *
   * 不列全部 116 场的名字（那是图鉴的活），只报三件事：
   * 这一局是抽的、现在池子里有几场、下一档要什么。**不解释机制、不劝他多玩**。
   */
  private disasterLadderHtml(): string {
    const progress = { survivedRuns: survivedRuns(this.props.meta), seenDisasters: this.props.meta.codex.disasters.length };
    const pool = disasterPool(progress);
    const top = disasterTopTier(progress);
    const nextTier = ([1, 2, 3, 4] as const).find((t) => t > top);

    if (!nextTier) {
      return `
        <p class="block-note">
          这一局的灾难是随机抽的（现在 ${pool.length} 场都可能）。
        </p>
      `;
    }
    const gate = DISASTER_TIER_GATES[nextTier];
    // 还差什么：两个条件取**更宽**的那个（与 `disasterTopTier` 同一套口径）
    const needRuns = Math.max(0, gate.need - progress.survivedRuns);
    const needSeen = gate.seen === null ? null : Math.max(0, gate.seen - progress.seenDisasters);
    const left =
      needSeen !== null && needSeen < needRuns
        ? `图鉴里再点亮 ${needSeen} 场灾难`
        : `再撑到最后 ${needRuns} 次`;
    const more = TOTAL_DISASTERS - pool.length;
    return `
      <p class="block-note">
        这一局的灾难是随机抽的（现在 ${pool.length} 场都可能）。还有 ${more} 场没放出来 ——
        ${escapeHtml(left)}就能碰到。
      </p>
    `;
  }

  /**
   * 还没解锁的身份（§10B.3 的"身份分批"）。
   *
   * ## 为什么**要列出来**，而不是干脆不渲染
   *
   * 这是 §10B.2 对图鉴那一条的同一种道理：
   *
   * > **未点亮的那一格要看得见轮廓与"从哪儿来"的提示** —— 玩家需要知道
   * > "还差什么、去哪儿找"，否则收集欲无从下手。
   *
   * 开局页上不列它们，玩家就永远不知道还有别的身份可玩 ——
   * 而"下一次换个身份再来"正是 §10B.1 说的**重开新一局的动机**。
   * 只列名字与解锁条件（不列数值）：摆出九个满数值的选择只会让人选不出来，
   * 而"再活到最后一次就解锁"是一个明确的、可执行的目标。
   */
  private lockedHtml(): string {
    const locked = lockedIdentities(this.props.meta);
    if (locked.length === 0) return '';
    return `
      <p class="block-note">还有 ${locked.length} 个身份没解锁。</p>
      <div class="identity-locked">
        ${locked
          .map(
            (def) => `
              <div class="identity-lock">
                <span class="identity-lock-name">${escapeHtml(def.name)}</span>
                <span class="identity-lock-hint">${escapeHtml(unlockHintOf(def.id))}</span>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  }

  /**
   * 「还差什么」那一栏。
   *
   * ## ★ 它改过一版：从"只报一个"改成"列出来 + 显示进度"
   *
   * 第一版只显示最近的那一个（"下一个：……"），理由是"一次列五个等于一个都不给"。
   * 用户的反馈是：
   *
   * > "下一个：储藏间 / 身份『外卖骑手』，这个横幅也不对，
   * >  只有外卖骑手没提示储藏间"
   *
   * 也就是**玩家想知道全部还差什么**。正确做法不是藏起来，而是
   * **按门槛排序 + 每一项都写清还差几次**：门槛低的排前面（那是现在能追的），
   * 而列表随解锁越来越短 —— 那本身就是进度感。
   *
   * ★ 这里只显示前 `MAX_SHOWN` 条，其余折成一句"还有 N 件"。
   * 砍在**显示层**而不是数据层：`unlockCandidates()` 给全，
   * 将来想做"解锁一览"页不必改数据层。
   */
  private nextUnlockHtml(): string {
    const list = unlockCandidates(this.props.meta);
    if (list.length === 0) return '';
    const shown = list.slice(0, MAX_SHOWN);
    const rest = list.length - shown.length;
    const rows = shown
      .map((c) => {
        const left = Math.max(0, c.need - c.have);
        return `<li class="unlock-row">
          <span class="unlock-name">${escapeHtml(c.label)}</span>
          <span class="unlock-need">再活到最后 <b>${left}</b> 次</span>
          <span class="unlock-hint">${escapeHtml(c.hint)}</span>
        </li>`;
      })
      .join('');
    return `
      <div class="unlock-next">
        <p class="unlock-head">再活到最后就能解锁（现在活过 <b>${survivedRuns(this.props.meta)}</b> 次）</p>
        <ul class="unlock-list">${rows}</ul>
        ${rest > 0 ? `<p class="unlock-more">还有 ${rest} 件更远的。</p>` : ''}
      </div>
    `;
  }

  private identityCard(def: IdentityDef): string {
    const active = this.selected === def.id ? ' is-active' : '';
    // ★ §10B.3：卡片上显示的必须是**含熟练度加成**的那份数，与开局真正拿到的一致
    const start = identityStartOf(this.props.meta, def.id);
    return `
      <button class="identity-card${active}" data-identity="${def.id}" aria-pressed="${this.selected === def.id}">
        <span class="identity-head">
          <span class="identity-name">${escapeHtml(def.name)}</span>
          ${start.level > 1 ? `<span class="identity-level">Lv${start.level}</span>` : ''}
          ${active ? `<span class="identity-picked">${iconSvg('check')}</span>` : ''}
        </span>
        <span class="identity-tagline">${escapeHtml(def.tagline)}</span>
        <span class="identity-stats">
          <span><i>现金</i><b>${start.startCash}</b></span>
          <span><i>车载</i><b>${start.vehicleCapacity}kg</b></span>
          <span><i>一趟能拿</i><b>${start.carryLimit}kg</b></span>
        </span>
        <span class="identity-perk">${escapeHtml(def.perk)}</span>
        ${start.level > 1 ? `<span class="identity-note">熟练度 Lv${start.level}，开局参数已经算进去了</span>` : ''}
      </button>
    `;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const card = target.closest<HTMLElement>('[data-identity]');
    if (card) {
      const id = card.dataset['identity'];
      if (!id) return;
      this.selected = id;
      this.render();
      return;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
    if (action === 'confirm' && this.selected) this.props.onConfirm(this.selected);
  }
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
