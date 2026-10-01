/**
 * 纯文本/展示换算（ui/ 层，无状态）。
 */
import { getItemDef } from '../data/items';
import { firstBatchExpiry, stackCount } from '../model/shelf';
import type { ItemStack, Shelf } from '../model/types';

const KIND_LABEL: Record<Shelf['kind'], string> = {
  shelf: '货架',
  fridge: '冰箱',
  cabinet: '柜子',
  floor: '地面'
};

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function shelfLabel(shelf: Shelf, index: number): string {
  return `${KIND_LABEL[shelf.kind]} ${LETTERS[index] ?? index + 1}`;
}

export function itemName(itemId: string): string {
  return getItemDef(itemId).name;
}

export function stackLabel(stack: ItemStack): string {
  const n = stackCount(stack);
  return `${itemName(stack.itemId)}${n > 1 ? ` ×${n}` : ''}`;
}

/** 还剩多少天到期（dayNow 为当前天；M0 恒为 0） */
export function expiryDays(stack: ItemStack, dayNow = 0): number | null {
  const e = firstBatchExpiry(stack);
  return e === null ? null : e - dayNow;
}

export function expiryText(stack: ItemStack, dayNow = 0): string {
  const days = expiryDays(stack, dayNow);
  if (days === null) return '不易腐';
  if (days <= 0) return '已过期';
  return `剩 ${days} 天`;
}

/** 保质期警告：剩 ≤30 天用朱红标记（§5A：朱红只做"警告/重要"） */
export function isExpiringSoon(stack: ItemStack, dayNow = 0, threshold = 30): boolean {
  const days = expiryDays(stack, dayNow);
  return days !== null && days <= threshold;
}
