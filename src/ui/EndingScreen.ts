/**
 * 结算界面（§9.6：生存天数 / 整理评分 / 图鉴解锁）。
 *
 * ★ M1 的结局有**两种**，界面必须把它们说清楚（§12.3 v0.5 修订）：
 *
 *   · `outcome === 'survived'`  —— 活过了 7 天；
 *   · `outcome === 'collapsed'` —— 健康归零，走到第 N 天停下来了；
 *   · `outcome === null`        —— 老档（阶段 A 时期"囤货期走完就结束"），按"囤货期结束"说。
 *
 * 三种都说成"你撑过去了"是最糟的处理：那会让"没撑住"变成一个没有重量的结局。
 *
 * 图鉴解锁（§9.6 第三项）属 M2，这里仍然只有生存天数 + 整理评分。
 */
import { SURVIVAL_DAYS, getDisasterDef } from '../data/disaster';
import { getIdentityDef, hasIdentityDef } from '../data/identities';
import { getItemDef, hasItemDef } from '../data/items';
import { NPC_DEFS } from '../data/npcs';
import { dayLabel, hintAt } from '../model/calendar';
import { districtDays, supplyDays } from '../model/contrast';
import { computeOrganizeScore, gradeLabel, toPercent } from '../model/score';
import type { CodexState, DisasterProfile, RunState } from '../model/types';
import type { GameStore } from '../state/store';
import { CODEX_PAGE_LABELS, CODEX_PAGES, bestOf, codexTotals, settleRunMeta, type RunVerdict } from '../systems/codex';
import { achievementTotal, orderedUnlocked } from '../systems/achievements';
import { MAX_IDENTITY_LEVEL, LEVEL_BONUS_PER_STEP, levelOf } from '../systems/identity';
import { householdTotals } from '../systems/organize';
import type { Screen } from './Router';

export interface EndingScreenProps {
  onRestart: () => void;
  /** 翻图鉴（§10B.2 的界面 / 补 D-16）。结算页是它最主要的入口 */
  onOpenCodex: () => void;
}

export class EndingScreen implements Screen {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly props: EndingScreenProps;

  constructor(root: HTMLElement, store: GameStore, props: EndingScreenProps) {
    this.root = root;
    this.store = store;
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
    const run = this.store.run;
    const disaster = getDisasterDef(run.disasterId);
    const score = computeOrganizeScore(run.shelves, run.zones, run.boxesToUnpack, getDisasterDef(run.disasterId));
    const totals = householdTotals(run);
    const placement = toPercent(score.placement);
    const fefo = toPercent(score.fefo);
    const emergency = toPercent(score.emergency);
    const collapsed = run.outcome === 'collapsed';
    const survived = run.outcome === 'survived';
    // 倒下的那天就是"走到哪儿"；活到最后一天时 run.day 正好等于 SURVIVAL_DAYS
    const lasted = Math.max(0, run.day);

    // ★ 跨局结算只在这里发生一次（§9.6 / §6.7）。幂等由 `run.metaSettled` 保证：
    // 反复刷新结算页不会把图鉴与纪录刷满 —— 那正是这个方法的全部意义。
    // 返回 null = 这一局之前已经记过了，那就只读账本、不再发奖。
    const verdict = settleRunMeta(this.store);
    const meta = this.store.save.meta;
    const best = bestOf(meta, run.disasterId);
    const fresh = verdict?.fresh ?? { items: [], disasters: [], npcs: [] };
    const freshCount = verdict?.freshCount ?? 0;
    const newRecord = verdict?.newRecord ?? false;
    const totalsOf = codexTotals();
    const streaked = run.survival.safeStreak >= 2;

    const title = survived
      ? `撑过 ${SURVIVAL_DAYS} 天`
      : collapsed
        ? `第 ${lasted} 天 · 停在这里`
        : `${dayLabel(0)} · ${escapeHtml(disaster.name)}登陆`;
    const sub = survived
      ? `${escapeHtml(disaster.name)}过去了`
      : collapsed
        ? `${escapeHtml(disaster.name)} · 没撑住`
        : escapeHtml(hintAt(disaster, 0));
    const verdictText = survived
      ? '撑过来了。'
      : collapsed
        ? '没撑住。'
        : '囤货期结束了。';

    this.root.innerHTML = `
      <div class="screen screen-plain">
        <header class="topbar">
          <div class="title">
            <h1>${title}</h1>
            <p class="sub">${sub}</p>
          </div>
        </header>
        <main class="scroll">
          <section class="block">
            <h2 class="block-title">这一局</h2>
            <p class="block-note strong${collapsed ? ' is-collapsed' : ''}">${escapeHtml(verdictText)}</p>
            <div class="stat-grid">
              <div class="stat"><i>撑过</i><b>${lasted} 天</b></div>
              <div class="stat"><i>硬撑过</i><b>${run.survival.hardPressDays} 天</b></div>
              <div class="stat"><i>没凑齐</i><b>${run.survival.shortagePieces} 件</b></div>
              <div class="stat"><i>最后剩下</i><b>${totals.pieces} 件</b></div>
            </div>
            <p class="block-note">${escapeHtml(
              runStory({
                survived,
                lasted,
                hardPressDays: run.survival.hardPressDays,
                shortPieces: run.survival.shortagePieces,
                unreachablePieces: run.survival.unreachablePieces
              })
            )}</p>
            ${collapsed ? lastDayStrip(run) : ''}
            ${trustNote(run) ? `<p class="block-note">${escapeHtml(trustNote(run))}</p>` : ''}
            <p class="block-note">${escapeHtml(contrastNote(run, disaster))}</p>
          </section>

          <section class="block">
            <h2 class="block-title">这一场 ${escapeHtml(disaster.name)}</h2>
            <div class="stat-grid">
              <div class="stat"><i>本灾难最佳纪录</i><b>${best} 天</b></div>
              <div class="stat"><i>最好连过</i><b>${meta.bestSafeStreak} 天</b></div>
            </div>
            ${
              newRecord
                ? // 暖黄只用于"安全 / 窗内"语义（§5A）。破纪录属于 M2 新增的正反馈，
                  // 与安全感、交付成功、图鉴点亮同一类 —— 这是它第二次上岗，不许扩散
                  `<p class="block-note warm">破纪录。上一次是 ${verdict?.previousBest ?? 0} 天。</p>`
                : `<p class="block-note">离纪录还差 ${Math.max(0, best - lasted + 1)} 天。</p>`
            }
            ${
              streaked
                ? `<p class="block-note warm">这一局连着 ${run.survival.safeStreak} 天，该拿到的都拿到了。</p>`
                : ''
            }
          </section>

          <section class="block">
            <h2 class="block-title">图鉴</h2>
            ${
              freshCount > 0
                ? `<p class="block-note warm">本局新点亮 <b>${freshCount}</b> 项。</p>`
                : '<p class="block-note">这一局没有新点亮的。</p>'
            }
            <div class="stat-grid is-triple">
              ${CODEX_PAGES.map((page) => {
                const have = meta.codex[page].length;
                const total = totalsOf[page];
                const freshHere = fresh[page].length;
                return `<div class="stat"><i>${CODEX_PAGE_LABELS[page]}</i><b>${have} / ${total}${
                  freshHere > 0 ? `<em class="is-fresh">+${freshHere}</em>` : ''
                }</b></div>`;
              }).join('')}
            </div>
            ${newlyHtml(fresh)}
            <div class="dock-tools">
              <button class="btn" data-action="codex">翻开图鉴</button>
            </div>
          </section>

          ${this.achievementsHtml(verdict)}

          ${this.identityHtml(verdict)}

          <section class="block">
            <h2 class="block-title">整理体检</h2>
            <div class="score-rows">
              ${this.scoreRow('归位率', placement, '你自己给胶带写的清单，东西有没有照放。它决定每天找东西要花多少体力')}
              ${this.scoreRow('临期优先', fefo, '同一块货架有没有按到期日排好，快到期的排在前面')}
              ${this.scoreRow('应急可达率', emergency, '急用的东西有多少放在顺手位。体力见底的那天，只有它们还够得到')}            </div>
            ${
              score.tidyShelfIds.length > 0
                ? `<p class="block-note">有 ${score.tidyShelfIds.length} 块货架做到了「整整齐齐」。${
                    score.tidyShelfIds.length === run.shelves.length ? '整个房间都是。' : ''
                  }</p>`
                : '<p class="block-note">还没有一块货架做到「整整齐齐」。</p>'
            }
          </section>

          <section class="block">
            <h2 class="block-title">接下来</h2>
            <p class="block-note">
              换一个身份、换一套整理思路再来一次。这一局的物资会清空，
              但"东西放在哪值多少体力"你已经知道了。
            </p>
          </section>
        </main>
        <footer class="dock">
          <div class="dock-tools">
            <button class="btn btn-primary" data-action="restart">再来一局</button>
          </div>
        </footer>
      </div>
    `;
  }

  /**
   * 成就与那枚**朱红印章**（§10B.2 的演出）。
   *
   * ## §10B.2 对演出的原话
   *
   * > **达成时的演出要克制但"帅"**：沿用 §5A 的纸墨朱红，一枚**朱红印章**
   * > 盖在日报/结算页上。
   *
   * 所以这里没有彩带、没有弹窗、没有音效墙 —— 只有一枚印，加上它叫什么。
   * "克制"是硬要求：§5A 规定朱红是唯一点缀色，它一旦被用来做大面积庆祝，
   * 那些真正该被看见的警告（缺水、缺粮、健康见底）就再也跳不出来了。
   *
   * ## 为什么这里也列出**已经解锁过的**
   *
   * 只列"本局新盖的"有一个具体的坏处：一个反复玩的人会看到这一栏
   * 大部分时候是空的，于是那一栏在他眼里等于不存在。所以：
   *   · 本局新解锁的 → 朱红印章（一次性，值得被看见）；
   *   · 已经有的     → 淡墨列出，不抢眼。
   * 两者的**视觉重量差**才是"新"这个字的载体，而不是"有与没有"。
   */
  private achievementsHtml(verdict: RunVerdict | null): string {
    const meta = this.store.save.meta;
    const all = orderedUnlocked(meta);
    if (all.length === 0) {
      return `
        <section class="block">
          <h2 class="block-title">成就</h2>
          <p class="block-note">还没有达成的成就。图鉴页码下面的那一栏写着每一条要怎么才算达成。</p>
        </section>
      `;
    }
    const fresh = new Set((verdict?.achievements.fresh ?? []).map((a) => a.id));
    const freshDefs = all.filter((a) => fresh.has(a.id));

    return `
      <section class="block">
        <h2 class="block-title">成就<em class="codex-count">${all.length} / ${achievementTotal()}</em></h2>
        ${
          freshDefs.length > 0
            ? `<p class="block-note warm">本局盖了 <b>${freshDefs.length}</b> 枚印。</p>
               <div class="seal-row">
                 ${freshDefs
                   .map(
                     (a) =>
                       `<span class="seal-chip"><span class="seal-dot">印</span>${escapeHtml(a.name)}</span>`
                   )
                   .join('')}
               </div>
               <div class="seal-grid" style="margin-top:8px">
                 ${freshDefs
                   .map(
                     (a) => `
                       <div class="seal is-on">
                         <span class="seal-mark">印</span>
                         <span class="seal-body">
                           <b>${escapeHtml(a.name)}</b>
                           <i>${escapeHtml(a.hint)}</i>
                         </span>
                       </div>
                     `
                   )
                   .join('')}
               </div>`
            : '<p class="block-note">这一局没有新达成的成就。</p>'
        }
        ${
          all.length > freshDefs.length
            ? `<p class="block-note">已经拿到：${all
                .filter((a) => !fresh.has(a.id))
                .map((a) => escapeHtml(a.name))
                .join(' · ')}</p>`
            : ''
        }
      </section>
    `;
  }

  /**
   * 身份熟练度（§10B.3）—— **升级必须被看见**。
   *
   * ## 为什么这一段不能省
   *
   * §10B.3 的纪律③ 是"升级条件要看得出来"，理由很具体：
   * 熟练度是**开局参数**（现金 / 车载 / 单趟），它不像成就那样有一次印章演出；
   * 如果结算页一个字都不提，玩家就永远不会知道"我用护士又一次活到最后"这件事
   * 除了通关之外还改变了什么 —— 那它就退化成一个隐藏数值，
   * 而"隐藏的成长"等于没有成长。
   *
   * 三种状态分别说清楚（**不许含糊**）：
   *  · 升级了 → 说出升到几级、下一局会多什么；
   *  · 满级了 → 说"已经满了"，而不是含糊地什么都不说；
   *  · 没升级 → 说明**为什么**（没活到最后就不算，口径见 `raiseIdentityLevel`）。
   */
  private identityHtml(verdict: RunVerdict | null): string {
    const run = this.store.run;
    if (!run.identityId) return '';
    let name = run.identityId;
    if (hasIdentityDef(run.identityId)) name = getIdentityDef(run.identityId).name;
    const info = verdict?.identityLevel ?? null;
    const level = info?.after ?? levelOf(this.store.save.meta, run.identityId);
    const leveled = info !== null && info.after > info.before;

    if (leveled && info) {
      return `
        <section class="block">
          <h2 class="block-title">身份</h2>
          <p class="block-note warm">
            ${escapeHtml(name)} 练到 <b>Lv${info.after}</b>。
            下一局用它开局会多 ${LEVEL_BONUS_PER_STEP.startCash} 元、
            ${LEVEL_BONUS_PER_STEP.vehicleCapacity}kg 车载、
            ${LEVEL_BONUS_PER_STEP.carryLimit}kg 单趟。
          </p>
        </section>
      `;
    }
    if (level >= MAX_IDENTITY_LEVEL) {
      return `
        <section class="block">
          <h2 class="block-title">身份</h2>
          <p class="block-note">${escapeHtml(name)} 已经练满（Lv${MAX_IDENTITY_LEVEL}）。</p>
        </section>
      `;
    }
    return `
      <section class="block">
        <h2 class="block-title">身份</h2>
        <p class="block-note">
          ${escapeHtml(name)} 现在是 Lv${level}。活到最后一次就会升到 Lv${level + 1}
          （倒下的那一局不算）。        </p>
      </section>
    `;
  }

  private scoreRow(name: string, percent: number, explain: string): string {
    return `
      <div class="score-row">
        <span class="score-row-name">${escapeHtml(name)}</span>
        <span class="score-row-bar"><i style="--fill:${percent / 100}"></i></span>
        <span class="score-row-value">${percent}%<em>${escapeHtml(gradeLabel(percent / 100))}</em></span>
        <span class="score-row-explain">${escapeHtml(explain)}</span>
      </div>
    `;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
    if (action === 'restart') this.props.onRestart();
    if (action === 'codex') this.props.onOpenCodex();
  }
}

/**
 * 把四个孤立的数字讲成一句话。
 *
 * 它存在的原因很具体：结算页曾经出现过一组自相矛盾的格子 —— **「撑过 7 天 · 断粮 7 天」**。
 * 数据其实没错（每天确实都短了点东西，但没短到垮掉），错的是没人把它们串起来。
 * 玩家看到四个互不相干的数，只能自己猜；而结算页只该回答一个问题：**这一局栽在哪。**
 */
/**
 * 「没撑住」的死亡记录（§12.3 v0.7）：把**最后一天**的样子原样摆出来。
 *
 * 全案不许说教（§5 引擎①），但事实本身够重了 —— "缺 3 件 · 有 2 件就在屋里没翻出来 ·
 * 硬撑连续第 6 天"这三行数字摆在「撑过 N 天」旁边，比任何判词都疼。
 * 它同时是可行动的：下一局该补哪一样，玩家自己读得出来。
 */
function lastDayStrip(run: RunState): string {
  const last = run.survival.last;
  const bits: string[] = [];
  if (last.shortage > 0) bits.push(`缺 ${last.shortage} 件`);
  if (last.unreachable > 0) bits.push(`有 ${last.unreachable} 件在屋里，没翻出来`);
  bits.push(`翻找花了 ${last.workCost} 点体力（一整架排好的屋子是 4.5）`);
  if (run.survival.hardPressStreak > 0) {
    bits.push(`硬撑连续第 ${run.survival.hardPressStreak} 天`);
  }
  if (last.usedMedicine > 0) bits.push(`用了 ${last.usedMedicine} 件药`);
  return `<p class="block-note strong is-collapsed">最后一天：${escapeHtml(bits.join(' · '))}。</p>`;
}

function runStory(input: {
  survived: boolean;
  lasted: number;
  hardPressDays: number;
  shortPieces: number;
  unreachablePieces: number;
}): string {
  const { survived, lasted, hardPressDays, shortPieces, unreachablePieces } = input;

  if (!survived) {
    // 没撑住的时候，"缺的是吃的"和"缺的是力气"是两种完全不同的死法，必须分开说
    if (unreachablePieces > shortPieces) {
      return `第 ${lasted} 天没撑住。屋里还有东西，是没能翻出来。`;
    }
    if (shortPieces > 0) {
      return `第 ${lasted} 天没撑住。前后一共短了 ${shortPieces} 件口粮。`;
    }
    return `第 ${lasted} 天没撑住。吃的不缺。`;
  }

  if (hardPressDays === 0 && shortPieces === 0 && unreachablePieces === 0) {
    return '一路没短过什么，最后那点余粮也没怎么动。';
  }

  const parts: string[] = [];
  if (hardPressDays > 0) parts.push(`有 ${hardPressDays} 天在硬撑`);
  if (shortPieces > 0) parts.push(`前后短了 ${shortPieces} 件口粮`);
  if (unreachablePieces > 0) parts.push(`还有 ${unreachablePieces} 件在屋里、没力气翻出来`);

  const head = parts.join('，');
  if (hardPressDays > 0) return `${head}。撑是撑过来了。`;
  return parts.length > 0 ? `${head}。` : '';
}

/**
 * 结算页的那句反差（§9.6「数字日报对比」）。
 *
 * 它必须在这儿，因为这一局的**意义**要靠它才读得出来：
 * "你撑过 7 天"是一个数，而"那几天里街区平均只剩 1 天，你手上还有 6 天"是另一个数。
 * 后者才是让玩家明白自己那几十次弯腰究竟换来了什么的东西。
 */
function contrastNote(run: RunState, disaster: DisasterProfile): string {
  return `你手上的余粮还够 ${supplyDays(run, disaster)} 天。同期街区平均是 ${districtDays(run.day)} 天。`;
}

/**
 * 关系的一句话总结（§6.5 的人情）。
 *
 * §6.7 的"关系图鉴"属 M2，M1 只做这一行 —— 但这一行必须有：
 * 人情是这个局里唯一会**跨天累积**、又会影响别的东西的数值（它决定「去敲个门」开不开），
 * 不显示出来，玩家就永远不知道那次婉拒到底付了什么代价。
 *
 * 全是 0 时不显示 —— 一个从没和人来往过的局，不该被硬塞一句"人情：0"。
 */
function trustNote(run: RunState): string {
  const rows = NPC_DEFS.map((npc) => ({ name: npc.name, value: run.trust[npc.id] ?? 0 })).filter(
    (r) => r.value !== 0
  );
  if (rows.length === 0) return '';
  const parts = rows.map((r) => `${r.name} ${r.value > 0 ? '+' : ''}${r.value}`);
  return `人情：${parts.join(' · ')}`;
}

/**
 * 「本局新点亮了哪些东西」。
 *
 * 它存在的理由就是 M2 评审那句话：**要给"再来一局"一个具体的理由**。
 * "本局新点亮 3 项"是一个数，而"泡面 · 寒潮 · 楼上王阿姨"是三个名字 ——
 * 后者才会让玩家想"那还有多少没见过的"。空的时候整段不渲染
 * （一行"没有新东西"比不写更打击人，而且 §5 引擎① 不许说教）。
 */
function newlyHtml(fresh: CodexState): string {
  const lines: string[] = [];
  if (fresh.items.length > 0) {
    lines.push(`物资：${fresh.items.map((id) => itemNameOf(id)).join(' · ')}`);
  }
  if (fresh.disasters.length > 0) {
    lines.push(`灾难：${fresh.disasters.map((id) => getDisasterDef(id).name).join(' · ')}`);
  }
  if (fresh.npcs.length > 0) {
    lines.push(`关系：${fresh.npcs.map((id) => npcNameOf(id)).join(' · ')}`);
  }
  if (lines.length === 0) return '';
  return `<p class="block-note">${lines.map((line) => escapeHtml(line)).join('<br>')}</p>`;
}

/** 图鉴里的物资名。认不出的 id 退回 id 本身，绝不让结算页崩在一条旧数据上 */
function itemNameOf(itemId: string): string {
  return hasItemDef(itemId) ? getItemDef(itemId).name : itemId;
}

function npcNameOf(npcId: string): string {
  return NPC_DEFS.find((n) => n.id === npcId)?.name ?? npcId;
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
