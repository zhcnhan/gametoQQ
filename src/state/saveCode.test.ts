/**
 * 存档码的往返测试（`state/saveCode.ts`）。
 *
 * 这一套守卫的是**"这一局能不能被带走"**——它坏掉的表现是
 * "朋友发来一段字，粘进去说读不出来"，而那种失败在本地怎么玩都碰不到。
 *
 * ★ 一条重要的口径：这里**只解一次、只看它等不等于原来那一份**。
 * 不逐字段抽查 —— 逐字段抽查会在加字段时静默放过新字段（`toEqual` 不会）。
 */
import { describe, expect, it } from 'vitest';
import {
  CODE_HEADER,
  decodeSaveCode,
  encodeSaveCode,
  inspectSaveCode
} from './saveCode';
import { createSaveGame, SAVE_VERSION, serialize } from './save';
import { createStartingRun } from '../systems/setup';
import { ZONE_COLORS } from '../data/palette';

/**
 * 一份"有内容"的存档。
 *
 * ★ 刻意**不是** `createSaveGame(null)`：空档什么都测不出来 ——
 * 一份只有 `{ meta, run: null }` 的 JSON 里没有中文、没有嵌套数组、
 * 没有长字符串，于是"UTF-8 编码坏了""深嵌套丢了"这两类错误全都能溜过去。
 */
function richSave() {
  const run = createStartingRun(20261007, { disasterId: 'cold_snap' });
  run.day = -3;
  run.phase = 'organize';
  /*
   * ★ 身份必须**给一个真的**。`createStartingRun` 开出来的局 `identityId` 是空串
   * （身份由玩家在开局页选），而 `state/save.ts` 的 `normalizeRun` 认为
   * "空的身份 id"是坏档，会把它填成第一个真身份 —— 于是"往返还是同一份"
   * 那条会红，而红的不是 `saveCode.ts`。空身份那条单独有用例（见下面）。
   */
  run.identityId = 'group_buyer';
  // 手写的中文胶带名 + 两张真胶带：这是 UTF-8 那条路唯一的证据
  // ⚠ `Zone`（`model/types.ts:588`）只有 `id / name / color / autoAccept?` ——
  //   没有 `createdAtDay`，写上它 `tsc` 会红（这张表由 `data/palette.ts` 供色）。
  run.zones = [
    { id: 'zone_test', name: '主食 · 一天一罐', color: ZONE_COLORS[0] ?? '#C8372D' },
    { id: 'zone_test2', name: '饮水', color: ZONE_COLORS[1] ?? '#E0A32E' }
  ];
  run.log = ['D-3 · 买回来 4 件', 'D-3 · 把「罐头」贴到第 1 行'];
  return createSaveGame(run);
}

describe('存档码：编出来再解回来，还是同一份', () => {
  it('★ 值一个不差地往返（比较前先去掉时间戳——它天生是变的）', () => {
    const save = richSave();
    const back = decodeSaveCode(encodeSaveCode(save));
    expect(back).not.toBeNull();
    /*
     * ⚠ 这里比的是**去掉 `savedAt` 之后**的两份。
     *
     * 不用 `toEqual(save)` 有一个真实的原因：`state/save.ts` 的 `migrate` 末了会走
     * `normalizeMeta` / `normalizeRun`（那是**消毒**，不是 bug）——
     * `normalizeMeta` 按固定键序**重建** meta、`normalizeRun` 会把认不出的
     * 灾难 id / 身份 id / 四维拉回安全值。`toEqual` 不看键的顺序，所以它能过；
     * 但它**会**被 `savedAt`（毫秒时间戳）卡住，而那个字段天生每次都不一样。
     */
    const strip = (s: typeof save) => ({ ...s, savedAt: 0 });
    expect(back && strip(back)).toEqual(strip(save));
  });

  it('★★ 空身份 id 会被消毒成一个真身份（读进来的坏档也要能玩）', () => {
    /*
     * `normalizeRun` 的口径：认不出的身份 id → 第一个真身份。
     * 这不是 `saveCode.ts` 的错，也不是这里要改的东西 —— 它属于"读进来的那一份
     * 也要能玩"这条既有纪律（`state/save.ts` 里那一大段压测报告）。
     * 写在这里是为了让下一个人一眼看到：**消毒是允许改变内容的**，
     * 而"能被带走"问的是"解出来还玩得了吗"，不是"逐字节相同"。
     */
    const run = createStartingRun(20261007, { disasterId: 'cold_snap' });
    run.identityId = '';
    const back = decodeSaveCode(encodeSaveCode(createSaveGame(run)));
    expect(back?.run?.identityId).toBe('group_buyer');
  });

  it('★ 解出来的那一份是可以直接写盘、直接开玩的', () => {
    const back = decodeSaveCode(encodeSaveCode(richSave()));
    // 消毒之后 stage / 天数 / 胶带都还在（"读得进去但玩不了"是这里要挡的）
    expect(back?.run?.day).toBe(-3);
    expect(back?.run?.phase).toBe('organize');
    expect(back?.run?.zones).toHaveLength(2);
    expect(back?.run?.shelves.length).toBeGreaterThan(0);
  });

  it('★ 中文活得下来（胶带名 / 日志都在里面）', () => {
    const save = richSave();
    const back = decodeSaveCode(encodeSaveCode(save));
    expect(back?.run?.zones.map((z) => z.name)).toEqual(['主食 · 一天一罐', '饮水']);
    expect(back?.run?.log[1]).toContain('罐头');
  });

  it('★ 空档（一次都没开过）也能往返', () => {
    const save = createSaveGame(null);
    const back = decodeSaveCode(encodeSaveCode(save));
    expect(back?.run).toBeNull();
    expect(back?.meta.version).toBe(SAVE_VERSION);
  });

  it('★ 同一份存档永远给出同一段文字（纯函数，同 seed 同结果的延伸）', () => {
    const save = richSave();
    expect(encodeSaveCode(save)).toBe(encodeSaveCode(save));
  });

  it('★ 头一行是能认出来的那句，正文只有一个换行分段', () => {
    const code = encodeSaveCode(richSave());
    const lines = code.split('\n');
    expect(lines[0]).toBe(CODE_HEADER);
    expect(lines).toHaveLength(2);
    // 正文里不许有它自己之外的分隔（一行到底，方便整段复制）
    expect(lines[1]).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('★ base64 的正文长度对得上（体积那一笔账别算错）', () => {
    const save = richSave();
    const json = serialize(save);
    const body = encodeSaveCode(save).split('\n')[1] ?? '';
    // base64 是 4 字符一组、3 字节一组（UTF-8 之后每个中文 3 字节）
    const bytes = new TextEncoder().encode(json).length;
    expect(body.length).toBe(Math.ceil(bytes / 3) * 4);
    // 体积账：base64 比原文长三分之一左右（写在这里，将来有人问"为什么这么大"）
    expect(body.length).toBeGreaterThan(json.length);
    expect(body.length).toBeLessThan(json.length * 2);
  });
});

describe('存档码：粘进来的东西什么样都能判', () => {
  it('★ 宽容聊天软件插进去的换行与空格', () => {
    const code = encodeSaveCode(richSave());
    const mangled = `${code.slice(0, 40)}\n   ${code.slice(40, 90)}\n\n${code.slice(90)}   \n`;
    expect(mangled).not.toBe(code);
    const back = decodeSaveCode(mangled);
    expect(back?.run?.day).toBe(-3);
    expect(back?.run?.zones.map((z) => z.name)).toEqual(['主食 · 一天一罐', '饮水']);
  });

  it('★ 宽容被聊天软件加上的引号', () => {
    const [head, body] = encodeSaveCode(richSave()).split('\n');
    expect(head).toBe(CODE_HEADER);
    // 整段被包进一对中文引号 —— 转发到聊天窗口里很常见
    expect(decodeSaveCode(`“${CODE_HEADER}\n${body ?? ''}”`)).not.toBeNull();
  });

  it('★★ 认不出来一律给 null，绝不抛异常（十种坏输入）', () => {
    const bad = [
      '',
      '   ',
      'hello',
      CODE_HEADER, // 只有头，没有正文
      `${CODE_HEADER}\n`, // 同上，带换行
      'TUNHUO9\nQUJD', // 版本不对
      `${CODE_HEADER}\n!!!!`, // 正文不是 base64
      `${CODE_HEADER}\nQUJD`, // 是 base64，但不是存档
      `${CODE_HEADER}\nW10=`, // ★ 是合法 JSON（`[]`），但**不是存档的形状**
      'QUJD\nREVG' // 有内容，但那不是头
    ];
    for (const text of bad) {
      expect(() => decodeSaveCode(text), `输入：${JSON.stringify(text)}`).not.toThrow();
      expect(decodeSaveCode(text), `输入：${JSON.stringify(text)}`).toBeNull();
    }
  });

  it('★ 解坏了也不会把原档写坏（解出来是 null，调用方就知道别写）', () => {
    const code = encodeSaveCode(richSave());
    // 掐掉最后 20 个字符 —— 这正是"复制的时候少选了一截"
    const cut = code.slice(0, code.length - 20);
    expect(decodeSaveCode(cut)).toBeNull();
  });
});

describe('存档码：先看一眼它是什么（导入前的唯一判断依据）', () => {
  it('★ 报得出这一局是什么灾难、第几天、在哪个阶段', () => {
    const info = inspectSaveCode(encodeSaveCode(richSave()));
    expect(info.readable).toBe(true);
    expect(info.disaster).toBe('寒潮');
    expect(info.day).toBe(-3);
    expect(info.dayLabel).toBe('D-3');
    expect(info.version).toBe(SAVE_VERSION);
    expect(info.note).toContain('囤货期');
  });

  it('★ 读不出来时 readable = false，并且给一句能摆在界面上的话', () => {
    const info = inspectSaveCode('随便一段什么');
    expect(info.readable).toBe(false);
    expect(info.note.length).toBeGreaterThan(0);
    expect(info.disaster).toBe('—');
  });

  it('★★ 版本比本端新 → 唯一正确的话是"别导入"', () => {
    const save = richSave();
    save.meta.version = SAVE_VERSION + 1;
    const info = inspectSaveCode(encodeSaveCode(save));
    /*
     * ⚠ 这一条与上面那条的区别值得写下来：`migrate` 对**未来版本**返回 null
     * （见 `state/save.ts:157`），所以这段码根本解不开 —— 于是它必须
     * 落在"读不出来"那一支，而不是"读出来但版本新"那一支。
     * `ui/saveExchange.ts` 里那道 `info.version > SAVE_VERSION` 是第二道保险：
     * 它挡的是"将来 migrate 改成宽容了"的那一天。
     */
    expect(info.readable).toBe(false);
  });

  it('★ 一段没有开过局的档：说得清它没有正在进行的一局', () => {
    const info = inspectSaveCode(encodeSaveCode(createSaveGame(null)));
    expect(info.readable).toBe(false);
    expect(info.note).toContain('没有');
  });

  it('★★ 手改过的坏灾难 id 不会让它抛异常，而是被消毒回安全值', () => {
    /*
     * ★ 这一段**不能**走 `encodeSaveCode`：编码器与解码器中间夹着
     * `migrate` 末了的 `normalizeRun`，它会把认不出的 `disasterId`
     * 拉回 `M1_DISASTER_ID`（寒潮）—— 所以从 `richSave()` 出发的坏 id
     * 在"编"的那一步就被修好了，测的就不是解码器了。
     * 这里直接手写一段原始 JSON，模拟"别人的档、或者被人改过的档"，
     * 要验的是**解码这条路遇到坏 id 不炸**（`inspectSaveCode` 里那句
     * `safeDisasterName` 挡不住这种情况：名字是从**消毒后**的档里读的）。
     */
    const raw = JSON.parse(serialize(richSave())) as Record<string, unknown>;
    const run = raw['run'] as Record<string, unknown>;
    run['disasterId'] = 'no_such_disaster';
    const bytes = new TextEncoder().encode(JSON.stringify(raw));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const code = `${CODE_HEADER}\n${btoa(binary)}`;

    expect(() => inspectSaveCode(code)).not.toThrow();
    const info = inspectSaveCode(code);
    expect(info.readable).toBe(true);
    // 消毒回寒潮 —— 这是 `normalizeRun` 的口径，不是解码器的
    expect(info.disaster).toBe('寒潮');
  });
});

describe('存档码：meta 也要一起走（换了设备，图鉴不该从零开始）', () => {
  it('★ 图鉴 / 成就 / 破纪录都在存档码里', () => {
    const save = richSave();
    save.meta.codex.items = ['mineral_water'];
    save.meta.achievements = ['a_first_blood'];
    save.meta.identityLevels = { group_buyer: 2 };
    const back = decodeSaveCode(encodeSaveCode(save));
    expect(back?.meta.codex.items).toEqual(['mineral_water']);
    expect(back?.meta.achievements).toEqual(['a_first_blood']);
    expect(back?.meta.identityLevels).toEqual({ group_buyer: 2 });
  });

  it('★ 连 deviceId 也走 —— 换设备就是换设备，这一点不该假装', () => {
    /*
     * ⚠ 不能直接喂 `createMetaProfile()`：它返回的是 `MetaProfile`，而存档码编的是
     * **`SaveGame`**（`{ meta, run, savedAt, syncVersion, deviceId }`）——
     * 类型对不上（`tsc` 报 "Property 'deviceId' does not exist on type 'MetaProfile'"），
     * 而且真喂进去就会静默编出一份没有 run 的档。`createSaveGame(null)` 才是
     * "有 meta、没有 run 的那一份"。
     *
     * ⚠⚠ 而且 `deviceId` 在 **`SaveGame` 的顶层**，不在 `meta` 里
     * （`state/save.ts:117-125`）—— 写成 `?.meta.deviceId` 两边都是 undefined，
     * `toBe` 会**通过**：一条恒真的断言比没有断言更坏。
     */
    const save = createSaveGame(null);
    expect(save.deviceId.length).toBeGreaterThan(0);
    expect(decodeSaveCode(encodeSaveCode(save))?.deviceId).toBe(save.deviceId);
  });
});
