/**
 * 手写线稿图标（§5A：物资不用扁平 emoji，走线稿；§13.2 优先 game-icons.net，
 * 缺失的品种自己手写）。全部 24×24、stroke=currentColor，跟着 CSS 的颜色走。
 */
const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const ITEM_ICONS: Record<string, string> = {
  can: '<path d="M6 8h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"/><ellipse cx="12" cy="8" rx="6" ry="2.2"/>',
  noodles:
    '<path d="M6 9h12l-1.4 10.2a2 2 0 0 1-2 1.8h-5.2a2 2 0 0 1-2-1.8Z"/><path d="M4.8 9h14.4"/><path d="M8.2 6.4c1-1.7 2.4 1.5 3.4-.2 1-1.7 2.4 1.5 3.4-.2"/>',
  rice: '<path d="M8 7.4h8L17.4 19a2 2 0 0 1-2 2.2H8.6a2 2 0 0 1-2-2.2Z"/><path d="M9 7.4V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.6"/><path d="M10.6 12.6h2.8"/>',
  flour: '<path d="M7 8h10l1 11.2A1.8 1.8 0 0 1 16.2 21H7.8A1.8 1.8 0 0 1 6 19.2Z"/><path d="M7 8 9 4h6l2 4"/><path d="M12 13v4"/>',
  water:
    '<path d="M10 3h4v2.4l1.5 2.2a3 3 0 0 1 .5 1.6V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-10.8a3 3 0 0 1 .5-1.6L10 5.4Z"/><path d="M9.4 5.4h5.2"/>',
  milk: '<path d="M7 8h10v13H7z"/><path d="M7 8 9.4 4h5.2L17 8"/><path d="M12 4v4"/>',
  bandage: '<circle cx="12" cy="12" r="7.6"/><path d="M12 9v6M9 12h6"/>',
  pill: '<rect x="3.6" y="9" width="16.8" height="6" rx="3"/><path d="M12 9v6"/>',
  fuel: '<path d="M6 8h9l3 3v9.2A1.8 1.8 0 0 1 16.2 22H7.8A1.8 1.8 0 0 1 6 20.2Z"/><path d="M9.4 8V5.2h3.2"/><path d="M9 13h4"/>',
  quilt:
    '<path d="M4 9.4h16v8.4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M4 13.4h16"/><path d="M8 9.4V7.2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2.2"/>',
  battery: '<rect x="3" y="8" width="15" height="8" rx="1.6"/><path d="M20.4 11v2"/><path d="M6 10.4v3.2"/>',
  toolbox:
    '<rect x="3" y="10" width="18" height="9.4" rx="1.6"/><path d="M9 10V8.2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2V10"/><path d="M3 14.4h18"/>'
};

const UI_ICONS: Record<string, string> = {
  box: '<path d="M3.4 8.6 12 4.2l8.6 4.4v9L12 22l-8.6-4.4Z"/><path d="M3.4 8.6 12 13l8.6-4.4"/><path d="M12 13v9"/>',
  sort: '<path d="M4 7h13M4 12h9M4 17h5"/><path d="M18 14.4 21 17.4l-3 3"/>',
  tag: '<path d="M12.6 3.4H20V10.8L10.6 20.2a1.6 1.6 0 0 1-2.3 0L3.8 15.7a1.6 1.6 0 0 1 0-2.3Z"/><circle cx="16.2" cy="7.4" r="1.3"/>',
  hand: '<path d="M8 12V6.4a1.5 1.5 0 0 1 3 0V12m0-.6V5a1.5 1.5 0 0 1 3 0v6.4m0-.8V7a1.5 1.5 0 0 1 3 0v8.4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.6-3.8L5.6 16a1.6 1.6 0 0 1 2.6-1.9"/>',
  check: '<path d="M5 13.2 9.6 18 19 7.4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  warning: '<path d="M12 4.6 21 20H3Z"/><path d="M12 10v4.4"/><path d="M12 17.4h.01"/>',
  crush: '<path d="M3.4 17.4 12 13l8.6 4.4"/><path d="M3.4 12.6 12 8.2l8.6 4.4"/>'
};

export function iconSvg(key: string, className = 'ico'): string {
  const body = ITEM_ICONS[key] ?? UI_ICONS[key];
  if (!body) return '';
  return `<svg class="${className}" ${SVG_ATTRS} aria-hidden="true">${body}</svg>`;
}

export function itemIconSvg(iconKey: string): string {
  return iconSvg(iconKey, 'ico ico-item');
}
