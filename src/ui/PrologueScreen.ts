/**
 * 开局界面（§9.1：身份三选一卡 + 灾难揭示 + 先知日历；M1 身份二选一、灾难固定寒潮）。
 *
 * 分层纪律：本文件只读 data/ 的静态表；写操作一律通过 props.onConfirm 交回给 systems。
 * 「先知落差」是爽点①，所以日历必须**开局就给全**（§6.1），让玩家在选身份时就能算账：
 * 寒潮要燃料，夜班员的燃料便宜 20% —— 这个念头应该由界面自己浮出来，不要靠教学文案点破。
 */
import { M1_DISASTER_ID, getDisasterDef } from '../data/disaster';
import { IDENTITY_DEFS } from '../data/identities';
import { CATEGORY_LABELS } from '../data/items';
import { calendarBars, dayLabel } from '../model/calendar';
import type { IdentityDef } from '../model/types';
import { iconSvg } from '../fx/icons';
import type { Screen } from './Router';

export interface PrologueScreenProps {
  /** 玩家按下「就这么定了」，参数是选中的身份 id */
  onConfirm: (identityId: string) => void;
  onRestart: () => void;
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
              <p class="sub">重生回灾难前 7 天</p>
            </div>
          </div>
        </header>
        <main class="scroll">
          <section class="block">
            <h2 class="block-title">你重生了，先决定你是谁</h2>
            <div class="identity-list">
              ${IDENTITY_DEFS.map((def) => this.identityCard(def)).join('')}
            </div>
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
            </p>
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

  private identityCard(def: IdentityDef): string {
    const active = this.selected === def.id ? ' is-active' : '';
    return `
      <button class="identity-card${active}" data-identity="${def.id}" aria-pressed="${this.selected === def.id}">
        <span class="identity-head">
          <span class="identity-name">${escapeHtml(def.name)}</span>
          ${active ? `<span class="identity-picked">${iconSvg('check')}</span>` : ''}
        </span>
        <span class="identity-tagline">${escapeHtml(def.tagline)}</span>
        <span class="identity-stats">
          <span><i>现金</i><b>${def.startCash}</b></span>
          <span><i>车载</i><b>${def.vehicleCapacity}kg</b></span>
          <span><i>一趟能拿</i><b>${def.carryLimit}kg</b></span>
        </span>
        <span class="identity-perk">${escapeHtml(def.perk)}</span>
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
