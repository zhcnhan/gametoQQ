/**
 * NPC 静态表（§6.5 求援订单 / §6.7 关系图鉴）。
 *
 * M1 只做三个人，而且刻意都是**楼道里会遇见的人**，不是剧情角色 ——
 * 他们的作用只有一个：把你的整理翻译成"别人怎么看你"。
 *
 * 文案约束（§11 克制化）：一句话说清他是谁就够了。不写身世、不写台词腔，
 * 玩家应该从"他缺什么"和"他留下什么"里自己拼出这个人的样子。
 */

export interface NpcDef {
  id: string;
  name: string;
  /** 一句话说明他是谁。结算页的关系记录要用它 */
  blurb: string;
}

export const NPC_DEFS: readonly NpcDef[] = [
  {
    id: 'npc_wang',
    name: '王阿姨',
    blurb: '楼上的。家里有个上小学的孙子。'
  },
  {
    id: 'npc_classmate',
    name: '老同学',
    blurb: '很久没联系了，后来发现也住这一片。'
  },
  {
    id: 'npc_shopkeeper',
    name: '老陈',
    blurb: '小区门口小卖部的。货比谁都齐，话不多。'
  }
];

const NPC_BY_ID: ReadonlyMap<string, NpcDef> = new Map(NPC_DEFS.map((n) => [n.id, n]));

export function getNpcDef(npcId: string): NpcDef {
  const def = NPC_BY_ID.get(npcId);
  if (!def) throw new Error(`未知 NPC id: ${npcId}`);
  return def;
}

export function findNpc(npcId: string): NpcDef | null {
  return NPC_BY_ID.get(npcId) ?? null;
}
