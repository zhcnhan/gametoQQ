/**
 * 「存档码」—— 把一局存档变成一段可以带走的文字（§4A：任何时刻杀进程，损失 = 0）。
 *
 * ## 它为什么存在（用户 2026-10 的走查）
 *
 * 存档原本**只活在浏览器的 localStorage 里**，全仓搜 `导出存档 / 导入存档 /
 * exportSave / importSave` 零命中。于是有两条真实的路会把人逼死：
 *
 *   ① 换设备 / 换浏览器 / 清一次浏览数据 → **整段进度凭空消失**，而且没有任何提示；
 *   ② 试玩的人卡在某一天，只能**口述**"我卡在哪儿" —— 她既发不回来一个可复现的现场，
 *      本端也没法把她的档拿过来看。
 *
 * ## 格式：为什么是"一行头 + base64"
 *
 * ```
 * TUNHUO1
 * <base64，可以折行、可以有空格>
 * ```
 *
 *   · **头一行是人看的**：一串裸 base64 与一段乱码在聊天窗口里长得一样，
 *     而"这东西是什么、哪个版本写的"必须一眼看得出（将来格式变了，
 *     头一行就是判据，见 `CODE_HEADER` / `decodeSaveCode` 的版本判据）。
 *   · **正文用 base64 而不是 JSON 原文**：JSON 里有换行、引号、全角标点，
 *     粘进聊天软件会被自动转义或折行。base64 只有 `A-Za-z0-9+/=`，
 *     **穿得过任何聊天窗口**，代价是体积涨三分之一。
 *   · ★ **解码时把空白全去掉**：聊天软件会在中间插换行、手机输入法会带进空格。
 *     一个"必须原样复制、多一个换行就失败"的存档码，等于没有。
 *
 * ## 体积（实测，写在这儿免得下次重新量）
 *
 * 一局走到结算（生存 14 天，约 21 天）序列化是 **14381 字符**，base64 之后约 19KB。
 * 也就是说它**不适合手抄**，只适合"复制 / 粘贴"，或者走文件（见 `ui/saveExchange.ts` 的下载那条路）。
 * 早期的一局只有 **3525 字符**（约 4.7KB），粘贴毫无压力。
 *
 * ⚠ 不做的两件事，都是刻意不做：
 *   · **不做字典压缩**：键名换单字符实测只能省 948 / 3525 字符（约 27%），
 *     而代价是一张必须与存档码同版本发布的词表 —— 词表一旦漂了，
 *     解出来的是"看起来像存档、实际是错的"数据，比大一点的文件糟得多。
 *   · **不做加密 / 校验和**：这是玩家自己的存档，`deserialize` 本来就会
 *     把不认识的东西判成 null（`migrate` 见 `state/save.ts`）。
 */
import { deserialize, SAVE_VERSION, serialize } from './save';
import type { SaveGame } from '../model/types';
import { getDisasterDef } from '../data/disaster';
import { dayLabel } from '../model/calendar';
import type { GamePhase } from '../model/types';

/** 头一行。★ 改格式时**必须改这个数**，它是唯一能认出"这是老格式"的东西 */
export const CODE_HEADER = 'TUNHUO1';

/**
 * 从存档生成一段可以带走的文字。
 *
 * 它是**纯函数**：不碰 localStorage、不碰 DOM。读存档是调用方的事 ——
 * 这样它才测得出"同一份存档永远给出同一段文字"（同 seed 同结果那条纪律的延伸）。
 */
export function encodeSaveCode(save: SaveGame): string {
  return `${CODE_HEADER}\n${base64Of(utf8Bytes(serialize(save)))}`;
}

/**
 * 把一段文字解回存档；**认识不出来就给 null，绝不抛异常**。
 *
 * 它会宽容三件事（都是真实粘贴会遇到的）：前后多余的空白、正文里的换行与空格、
 * 以及整体被聊天软件加上引号。它**不宽容**的是版本头 —— 没有头、或头不是
 * 本版本写的，一律 null（"看起来解开了、其实解错了"比"没解开"危险得多）。
 */
export function decodeSaveCode(text: string): SaveGame | null {
  /*
   * ★ 引号在**分行之前**就要剥掉（2026-10 修）：聊天软件转发时会把整段包进一对引号，
   * 而收尾的那个 `”` 贴在**正文最后一行**的末尾 —— 先分行再剥头，
   * 它就会跟着 base64 一起进正则，被 `[A-Za-z0-9+/]` 判成"正文不是 base64"。
   * 表现是"别人发给我的一段字，我这里说读不出来"，而两边都不报错。
   */
  const lines = text
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  const header = lines[0] ?? '';
  if (header !== CODE_HEADER) return null;
  // 正文：去掉所有空白再解 —— 见文件头"解码时把空白全去掉"
  const body = lines.slice(1).join('').replace(/\s+/g, '');
  if (body.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  try {
    return deserialize(utf8Of(base64ToBytes(body)));
  } catch {
    return null;
  }
}

/** 一段存档码里能读出什么 —— 给"你确定要换掉现在这一局吗"用 */
export interface SaveCodeInfo {
  /** 这一局是什么灾难（读不出来时给 id 本身） */
  disaster: string;
  day: number;
  dayLabel: string;
  /** 存档里记的版本号 */
  version: number;
  /** 本端能不能读（**false 时唯一的动作是"别导入"**） */
  readable: boolean;
  /** 读不了的原因，直接摆在界面上 */
  note: string;
}

/**
 * 先看一眼"这段码里是什么"，再决定要不要覆盖现在这一局。
 *
 * ★ 这里刻意走 `decodeSaveCode` **完整解一遍**，而不是只读个头就放行：
 * 一半的存档码是坏的（少粘了一段、聊天软件把 `+` 吃掉了），
 * 而"按下导入之后才发现读不出来"会让玩家以为是自己弄坏了什么。
 * 解开一次的数据便宜得很（19KB 的 base64 解出来是毫秒级），
 * 换来的是一句按之前就说得清的话。
 */
export function inspectSaveCode(text: string): SaveCodeInfo {
  const blank: SaveCodeInfo = {
    disaster: '—',
    day: 0,
    dayLabel: '—',
    version: 0,
    readable: false,
    note: '不认识这一段。它要么粘少了一截，要么不是这个游戏写出来的。'
  };
  const save = decodeSaveCode(text);
  if (!save) return blank;

  const run = save.run;
  if (!run) {
    return {
      ...blank,
      version: save.meta.version,
      readable: false,
      note: '这一段是好的，但里面是一次都没有开过的档（没有正在进行的这一局）。'
    };
  }

  const def = safeDisasterName(run.disasterId);
  return {
    disaster: def,
    day: run.day,
    dayLabel: dayLabel(run.day),
    version: save.meta.version,
    readable: true,
    note: phaseNote(run.phase, save.meta.version)
  };
}

/**
 * `getDisasterDef` 对不认识的 id 会**抛异常**（`data/disaster.ts` 里那一句
 * `throw new Error('未知灾难 id: …')`）。存档码来自别人，读不出名字是正常情况，
 * 所以在这里挡一道 —— 界面上显示 id 比崩掉好。
 */
function safeDisasterName(id: string): string {
  try {
    return getDisasterDef(id).name;
  } catch {
    return id;
  }
}

/** 版本比本端新时，唯一正确的话是"别导入" */
function phaseNote(phase: GamePhase, version: number): string {
  if (version > SAVE_VERSION) {
    return `这一段的版本（v${version}）比你现在这个游戏新，读进来会写坏 —— 先更新游戏。`;
  }
  const where: Record<string, string> = {
    prologue: '还没开始',
    stockpile_shop: '囤货期 · 在外面买东西',
    organize: '囤货期 · 在家里整理',
    night: '囤货期 · 夜里',
    survival_day: '生存期',
    help_request: '生存期 · 有人敲门',
    ending: '已经结算了'
  };
  const label = where[phase] ?? '（不认识的阶段）';
  return version < SAVE_VERSION ? `${label}（旧版本 v${version}，读进来会升级）` : label;
}

/* ------------------------------------------------------------------ *
 * base64 ↔ UTF-8 字节
 *
 * ⚠ 不用 `btoa(JSON)`：存档里有**中文**（货架上手写的胶带名、成就文案），
 * 而 `btoa` 只吃 Latin-1 —— 喂中文进去会抛 `InvalidCharacterError`。
 * 正确顺序永远是 JSON → UTF-8 字节 → base64。
 *
 * 两条路：浏览器有 `TextEncoder` / `btoa` 就用它们；`btoa` 不存在时
 * （Node 里跑测试、或极老的 WebView）退回手写实现。
 * ------------------------------------------------------------------ */

function utf8Bytes(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return new Uint8Array(out);
}

function utf8Of(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i] ?? 0;
    let cp: number;
    let size: number;
    if (b0 < 0x80) {
      cp = b0;
      size = 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      size = 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      size = 3;
    } else {
      cp = b0 & 0x07;
      size = 4;
    }
    for (let k = 1; k < size; k += 1) cp = (cp << 6) | ((bytes[i + k] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
    i += size;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 字节 → base64。**手写而不是转手给 `btoa`**：这样 Node 与浏览器走的是同一条路，不会有第二种行为 */
function base64Of(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 0x3f];
  }
  return out;
}

function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >> bits) & 0xff;
      at += 1;
    }
  }
  return out.subarray(0, at);
}
