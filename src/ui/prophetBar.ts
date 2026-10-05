/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  「大先知」那一条 —— 日历从开局页搬上来，抬着头就看得见（D-33 / 决策 E）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 用户的原话（这一条存在的全部理由，2026-10）
 *
 * > "而且日历的先知作用挪到最上面去，毕竟我们可是有优越感的大先知，
 * >  能预支灾难的！也让他更显眼一点，能介绍更多"
 *
 * 在那之前，先知日历只出现在**开局页**（`ui/PrologueScreen.ts` 里那一块）——
 * 玩家选完身份之后就再也看不到它了，而"能预支灾难"这件事的价值恰恰在后面：
 * 扫货那 7 天要按日历排采购、生存期要按日历决定哪天省着点。
 *
 * ## 决策 E 定的三层（用户拍板"档 2 + 3 的一半"）
 *
 *   ① **常驻的那一行**（这个文件）：还有几天 / 强度条 / 这一场最要紧的两类 ——
 *      抬头就有，不用点；
 *   ② **点开之后**：逐日"哪几天最难"（`hint` 那一列）——
 *      ★ 刻意**不**贴在脸上：§6.1 说日历是**规划乐趣**的来源，
 *      "先知要我主动去问"比"先知把答案贴在脸上"更像先知；
 *   ③ **不做**："它上次怎么把我打倒的"（要动跨局 schema）——
 *      这一条与它所在的那笔账一起收口了，理由见
 *      `src/meta/deferred.ts` 的 D-33（M5 工单重写之后，那笔账只留一段结论）。
 *
 * ## 三条纪律
 *
 *  ① **零依赖、零图片**：一个 CSS 变量（`--remain`）画剩下的天数、
 *     一个 `data-days` 画倒计时、一行 `<b>` 画强度 —— 全部是纯 CSS + 数字；
 *  ② **不碰纸墨朱红的语义**：颜色一律走 `var(--ink)` / `var(--vermilion)`；
 *  ③ ★ **比例只算一次**：`--remain` 与 `data-days` 都由 `prophetBarHtml`
 *     算好写上去；CSS / 界面 / 测试都不许再"顺手重算一遍"——
 *     两处各算一遍的表现是"条走到一半、字说还有一天"，而两个数各自都算得出来。
 *     ⚠ `--remain` 是**还剩几成**（灾前七天满格 → D-Day 见底），
 *     方向必须与右边那句"还有 N 天"一致 —— 第一版写成了"走了多少"，见下面
 *     `prophetViewOf` 里那段注释。
 *
 * ## ★ 它为什么与「窗外」一起返回（`ui/windowBand.ts` 调用它）
 *
 * `windowBandHtml` 是**唯一**一个九屏都调过的渲染入口（那条纪律是被一次
 * 惨痛的接线缺口换来的：九屏各写各的，带子漏了七屏）。先知栏如果自己再开
 * 一个入口，就是"再记得手工加第九次"——所以它**挂在那个入口底下**，
 * 与带子同生共死（`ui/windowBand.test.ts` 逐屏核对，两样都问）。
 *
 * ## 谁拿得到"今天"
 *
 * 七个屏手里有 `store.run`，两个没有（`PrologueScreen` / `PendingScreen`
 * 只有 `disasterId`）。所以 `day` 可以是 `null` —— 那时**不写倒计时**，
 * 但强度曲线与"最要紧的两类"照旧（**没有天数就少说一句，不编一个数**）。
 */
import { CATEGORY_LABELS } from '../data/items';
import { getDisasterDef, STOCKPILE_DAYS } from '../data/disaster';
import { calendarBars, dayLabel, daysUntilDisaster, severityAt } from '../model/calendar';
import type { DisasterProfile } from '../model/types';

/**
 * 这一场的先知栏要说的全部东西（**算一次，读它的地方不再自己算第二遍**）。
 *
 * 为什么要有这个中间形状：界面要画的四个数（倒计时 / 进度 / 当天强度 /
 * 逐日列表）来自四个不同的函数，散在 `prophetBarHtml` 里逐个调用时，
 * 后来的人很容易"顺手再算一个"（比如在详情行里自己写 `severity >= 0.8`）。
 * 集中在这里之后，测试也能直接对着**数据**断言，不必去 DOM 里捞数字。
 */
export interface ProphetView {
  /** 这一场叫什么（顶栏那一行要念出名字：不是"寒潮"这种写死的） */
  name: string;
  /** 今天是第几天；`null` = 这一屏手里没有 `run`（只有 `disasterId`） */
  day: number | null;
  /** 倒计时那一块要说的那件事；`day` 为 null 时是 null（不写、不编） */
  countdown: { label: string; days: number } | null;
  /** 灾难登陆那天的强度 0..1 —— 顶栏那条曲线的"满格"标尺 */
  peak: number;
  /** 今天（或 D-Day）的强度 0..1 —— 顶栏那个数字 */
  today: number;
  /** 离灾难**还剩几成**的囤货期 0..1（灾前七天满格，D-Day 见底；生存期恒 0） */
  remain: number;
  /** 「这一场最要紧的两类」（`DisasterProfile.priorityCategories`） */
  priorities: string[];
  /** 逐日天象，按天数升序（详情层要的那一列） */
  bars: { day: number; severity: number; hint: string; label: string }[];
}

/**
 * 日历上总共有多少天要摊开 —— 就是囤货期的天数。
 *
 * ★ 从 `data/disaster.ts` 取，不在这儿另写一个 `7`：
 * 这一页的整条线（还剩几成）与"灾前七天"这句话必须同源，
 * 两处各写一个 7 时改动一处就会静默错位（而它只在"天数只剩一两天"时看得出来）。
 */

/**
 * 把这一场 + 今天算成一份可读的视图。纯函数，不碰 DOM。
 *
 * @param disasterId 这一局的灾难 id
 * @param day        今天（囤货期是负数、D-Day 是 0、生存期是正数）；不知道就给 null
 */
export function prophetViewOf(disasterId: string, day: number | null): ProphetView {
  const disaster: DisasterProfile = getDisasterDef(disasterId);
  const bars = calendarBars(disaster).map((f) => ({
    day: f.day,
    severity: f.severity,
    hint: f.hint,
    label: dayLabel(f.day)
  }));
  const peak = bars.find((b) => b.day === 0)?.severity ?? 1;
  const today = day === null ? peak : severityAt(disaster, day);

  /*
   * ★ 那一条说的是**还剩多少**，不是"走了多少"（第一版写反过，被用例抓住）。
   *
   * 它是**倒计时**的形状：灾前七天满格，一天少一格，D-Day 见底；
   * 生存期恒 0（"离那天还有多远"这件事已经问完了），没有 `day` 时也是 0。
   * 夹在 0..1 之间：`day` 若是被手改过的档带上来的怪数，这里也不许越界。
   */
  const remain = day === null ? 0 : Math.min(1, Math.max(0, daysUntilDisaster(day) / STOCKPILE_DAYS));

  return {
    name: disaster.name,
    day,
    countdown: day === null ? null : { label: countdownLabel(day), days: day },
    peak,
    today,
    remain,
    priorities: disaster.priorityCategories.map((c) => CATEGORY_LABELS[c]),
    bars
  };
}

/**
 * 倒计时那一句（日期标签是**唯一的解释口径**，这里不自己发明措辞）。
 *
 * 囤货期说"还有 N 天"，正日子说"D-Day"，过了那天只说"已经在里面了"——
 * ★ 生存期刻意**不报天数**：那几天里"第几天"是天气自己会喊的事
 * （日报每天开场就写），顶栏再念一遍只是噪声。
 */
export function countdownLabel(day: number): string {
  if (day < 0) return `还有 ${daysUntilDisaster(day)} 天`;
  if (day === 0) return 'D-Day';
  return '已经在里面了';
}

/** 强度那一个数字（0..1 → 0~100 的整数；顶栏与详情用同一把尺子） */
function severityText(severity: number): string {
  return String(Math.round(severity * 100));
}

/**
 * ★★ **抬头就看得见的那一行**（D-33 的第 ① 层）。
 *
 * 三层，从上往下读：**还剩多少**那条测量线 → 灾难名 + 强度 + 倒计时 + 展开按钮
 * → "这一场最要紧的两类"。
 *
 * ★ 第三层（"最要紧的是 …"）放在这里而不是只留在展开层里，理由是用户那句
 * "能介绍更多"：它是最该被一眼看到的一句话（决定今天出门买什么），
 * 而逐日细节才是"要问才给"的那一半。
 */
export function prophetBarHtml(disasterId: string, day: number | null): string {
  const view = prophetViewOf(disasterId, day);
  const countdown = view.countdown
    ? `<span class="run-bar-days" data-days="${view.countdown.days}">${escapeHtml(
        view.countdown.label
      )}</span>`
    : '';
  /*
   * ★ 还剩多少用**内联 `--remain`**，不用 `data-*` + CSS 逐档规则：
   * 前者是一个连续量，后者要写 8 条规则、且每加一档都得记得加一条。
   */
  return `
    <section class="run-bar" data-day="${view.day === null ? '' : view.day}" style="--remain:${view.remain.toFixed(
      3
    )}">
      <div class="run-bar-track"><i></i></div>
      <div class="run-bar-row">
        <span class="run-bar-name">${escapeHtml(view.name)}</span>
        <span class="run-bar-sev">强度 <b>${severityText(view.today)}</b></span>
        ${countdown}
        <button class="run-bar-toggle" data-action="prophet" aria-expanded="false">先知日历<i class="ico-arrow"></i></button>
      </div>
      <p class="run-bar-need">最要紧的是 ${prioritiesHtml(view.priorities)}</p>
    </section>
  `;
}

/** 「饮水 和 保暖」——顶栏那一行与展开层都要说这一句，所以只写一次 */
function prioritiesHtml(names: readonly string[]): string {
  return names.map((name) => `<b>${escapeHtml(name)}</b>`).join(' 和 ');
}

/**
 * ★★ **点开之后**（D-33 的第 ② 层）：逐日"哪几天最难"。
 *
 * ## 为什么它默认是收着的（这是用户拍板的那一半）
 *
 * "先知要我主动去问"比"先知把答案贴在脸上"更像先知 —— §6.1 说日历是
 * **规划乐趣**的来源，而把 22 天的 hint 全摊在顶栏底下，等于每天开局先读一屏字。
 *
 * ## 为什么强度最高的那几天要标出来
 *
 * 用户要的是"能介绍更多"。`hint` 那一列本来就写着每天会发生什么（数据层
 * 早就有了，实测每场内部 `severity` 落差中位 0.9 —— 只是从来没人展示过），
 * 所以这里只做一件事：把"哪几天最难"从 22 行里挑出来（`is-hard`）。
 */
export function prophetDetailHtml(disasterId: string, day: number | null): string {
  const view = prophetViewOf(disasterId, day);
  const rows = view.bars
    .map((bar) => {
      const isToday = view.day !== null && bar.day === view.day;
      const hard = bar.severity >= 0.75 ? ' is-hard' : '';
      return `
        <li class="prophet-day${isToday ? ' is-today' : ''}${hard}">
          <i>${escapeHtml(bar.label)}</i>
          <b>${severityText(bar.severity)}</b>
          <span>${escapeHtml(bar.hint)}</span>
        </li>
      `;
    })
    .join('');
  return `
    <section class="prophet-detail" data-prophet="detail" hidden>
      <p class="block-note">这一场最要紧的是 ${prioritiesHtml(view.priorities)}。下面是每一天会发生什么 —— 数字是那天的强度。</p>
      <ul class="prophet-days">${rows}</ul>
    </section>
  `;
}

/**
 * ★ 展开 / 收起（`src/main.ts` 的事件委托里调它）。
 *
 * ## 为什么不用 `<details>`
 *
 * 原生 `<details>` 是最省事的写法，但它的**箭头不能改**（`::marker` 在移动端
 * 各浏览器长得不一样），而这一条顶栏是"台账"版式的一部分，箭头要和别处一致。
 * 所以用 `hidden` 属性 + 一个 `<button aria-expanded>`：
 * 无障碍上等价，外观完全可控，而且**状态只有一处**（`hidden` 与 `aria-expanded`
 * 一起翻 —— 两个都写在这一处，免得"看起来开着、读屏说关着"）。
 *
 * ⚠ 展开状态**不落盘、也不留在 `RunState` 里**：它是"看一眼"的瞬时状态，
 * 而这一整屏重绘时（换天、切页）本来就该收回去（§4A：界面状态永远可由存档推导）。
 *
 * ★★ 两个元素都用**属性选择器**找（`[data-prophet="detail"]` /
 * `[data-action="prophet"]`），刻意**不用 `#id`**：
 * `ui/fakeDom.ts` 的 `parseSelector` 不认识 `#`（它的正则只切中括号块 / 类 / 标签），
 * 于是 `querySelector('#prophet-detail')` 在屏幕级测试里**永远返回 null** ——
 * 表现是"点了没反应"，而产品代码与假体各自都不报错。
 * （顺带，用属性选择器也不必再维护一个 `aria-controls` 的 id 字符串。）
 */
export function toggleProphet(root: ParentNode): void {
  const detail = root.querySelector('[data-prophet="detail"]');
  const toggle = root.querySelector('[data-action="prophet"]');
  if (!detail) return;
  /*
   * ⚠ 读的是 `getAttribute('hidden')`，不是 `detail.hidden` / `hasAttribute`：
   * 前者的**属性存在性**口径在真 DOM 与 `ui/fakeDom.ts` 上一致
   * （假体的 `hidden` 属性是在解析 HTML 时由 `BOOLEAN_ATTRS` 补上的，
   * 而它没有实现 `hasAttribute`）。屏幕级测试读的也是这个属性。
   */
  const open = detail.getAttribute('hidden') !== null;
  if (open) detail.removeAttribute('hidden');
  else detail.setAttribute('hidden', '');
  if (toggle) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.classList.toggle('is-open', open);
  }
}

/**
 * 转义（本文件只往 HTML 里塞数据层来的字，但仍然不许裸拼 —— 纪律见 `CodexScreen`）。
 * ⚠ 刻意**不**从别处 import 一份：`ui/` 里各屏自带一个私有转义是既有约定，
 * 跨屏共享它会让"改一处"变成"改九个文件"。
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
