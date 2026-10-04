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
import { lockedIdentities, nextUnlock, unlockedIdentities } from '../systems/unlock';
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
   * 「下一个解锁目标」那一行。
   *
   * ## 为什么只写一个
   *
   * 一次列出五个待解锁项，等于一条都不给 —— 玩家需要的是**一个可执行的目标**。
   * `nextUnlock()` 挑出**门槛最低**的那一个，并说清"你还差几次"。
   *
   * ★ 这一行是"活到最后一次就解锁"那句话的**回执**：
   * 在解锁系统做出来之前，界面上写着那句话，而玩家活到最后一次之后
   * 什么都不会发生 —— 用户报的正是这个。现在它会变成
   * "再活到最后一次就解锁「储藏间」"，然后真的解锁。
   */
  private nextUnlockHtml(): string {
    const next = nextUnlock(this.props.meta);
    if (!next) return '';
    const left = Math.max(0, next.need - next.have);
    return `
      <p class="block-note unlock-next">
        下一个：${escapeHtml(next.label)} —— 再活到最后 <b>${left}</b> 次。
        <br><span class="identity-lock-hint">${escapeHtml(next.hint)}</span>
      </p>
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
