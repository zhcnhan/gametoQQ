/**
 * 开局界面（§9.1：身份三选一卡 + 灾难揭示 + 先知日历；M1 身份二选一、灾难固定寒潮）。
 *
 * 分层纪律：本文件只读 data/ 的静态表；写操作一律通过 props.onConfirm 交回给 systems。
 * 「先知落差」是爽点①，所以日历必须**开局就给全**（§6.1），让玩家在选身份时就能算账：
 * 寒潮要燃料，夜班员的燃料便宜 20% —— 这个念头应该由界面自己浮出来，不要靠教学文案点破。
 */
import { M1_DISASTER_ID, getDisasterDef } from '../data/disaster';
import { CATEGORY_LABELS } from '../data/items';
import { calendarBars, dayLabel } from '../model/calendar';
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
import { iconSvg } from '../fx/icons';
import type { Screen } from './Router';

export interface PrologueScreenProps {
  /** 玩家按下「就这么定了」，参数是选中的身份 id */
  onConfirm: (identityId: string) => void;
  onRestart: () => void;
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
    const disaster = getDisasterDef(M1_DISASTER_ID);
    const bars = calendarBars(disaster);
    const dday = disaster.calendar.find((f) => f.day === 0);
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
            <h2 class="block-title">先知日历 · ${escapeHtml(disaster.name)}</h2>
            <p class="block-note">
              ${bars.length > 0 ? escapeHtml(bars[0]?.hint ?? '') : ''}
            </p>
            <div class="calendar-strip" role="img" aria-label="先知日历的强度曲线">
              ${bars
                .map(
                  (f) =>
                    `<i class="cal-bar${f.day === 0 ? ' is-dday' : ''}${f.day < 0 ? ' is-before' : ''}" style="--sev:${f.severity}"></i>`
                )
                .join('')}
            </div>
            <div class="cal-axis">
              <span>${dayLabel(bars[0]?.day ?? -7)}</span>
              <span class="cal-axis-mid">${dayLabel(0)}</span>
              <span>${dayLabel(bars[bars.length - 1]?.day ?? 7)}</span>
            </div>
            <p class="block-note strong">
              ${escapeHtml(dday?.hint ?? '灾难将至。')}
            </p>
            <p class="block-note">
              最要紧的是 ${disaster.priorityCategories.map((c) => `<b>${CATEGORY_LABELS[c]}</b>`).join(' 和 ')}。
            </p>          </section>
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
