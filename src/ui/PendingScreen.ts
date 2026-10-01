/**
 * 未实装阶段的兜底页。
 *
 * 存在意义：`RunState.phase` 里 `night` / `survival_day` / `help_request` 三个值
 * 属于阶段 B/C/D。阶段 A 不会产生它们，但**存档可以**（升级前玩过、或手改过档）。
 * 与其让 Router 找不到界面而白屏，不如给一页说清楚"这里还没开"。
 * 这一页是工程防御，不是玩法内容 —— 阶段 B/C/D 落地后它自然不会再被走到。
 */
import type { Screen } from './Router';

export interface PendingScreenProps {
  title: string;
  note: string;
  onRestart: () => void;
}

export class PendingScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly props: PendingScreenProps;

  constructor(root: HTMLElement, props: PendingScreenProps) {
    this.root = root;
    this.props = props;
  }

  private readonly onClickBound = (e: MouseEvent): void => {
    const target = e.target;
    if (target instanceof HTMLElement && target.closest('[data-action="restart"]')) this.props.onRestart();
  };

  mount(): void {
    this.root.addEventListener('click', this.onClickBound);
    this.render();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClickBound);
  }

  render(): void {
    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar">
          <div class="title">
            <h1>${escapeHtml(this.props.title)}</h1>
          </div>
        </header>
        <main class="scroll">
          <section class="block">
            <p class="block-note strong">${escapeHtml(this.props.note)}</p>
            <p class="block-note">这一页是占位。囤货期（D-7 到 D-Day）现在已经可以完整玩通了。</p>
          </section>
        </main>
        <footer class="dock">
          <div class="dock-tools">
            <button class="btn btn-primary" data-action="restart">重开一局</button>
          </div>
        </footer>
      </div>
    `;
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
