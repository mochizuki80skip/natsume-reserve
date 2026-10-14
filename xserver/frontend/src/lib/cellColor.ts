// 予約表のセルの色（画面と印刷で共用）。初診・再来・新自（初自）を優先し、次に回数（2回目・3回目・6回目…）
import { categorizeCell } from './attendance';

export const KIND_COLORS = { NEW: '#fde0de', ACCIDENT: '#fde9c4', REVISIT: '#d9e7fb' } as const;
export const KIND_COLOR_NAMES = { NEW: '初診', ACCIDENT: '新自・初自（交通事故）', REVISIT: '再来' } as const;
/** 回数のメニューは目立つ濃い色（文字は白） */
export const VISIT_COLORS: Record<string, string> = { '2回目': '#15803d', '3回目': '#6d28d9', '6回目': '#9a3412' };
const OTHER_VISIT_COLOR = '#334155';
export const isVisitMenu = (m: string) => /^\d+回目$/.test(m.trim());
export const visitColor = (m: string) => VISIT_COLORS[m.trim()] ?? OTHER_VISIT_COLOR;

/** 初診・再来・新自のどれか（「上記初診対応」などの 2 枠目は 1 枠目の文字で判定する） */
export function kindOf(text: string): keyof typeof KIND_COLORS | null {
  const c = categorizeCell(text);
  return c.isNew ? (c.isJibai ? 'ACCIDENT' : 'NEW') : c.isRevisit ? 'REVISIT' : null;
}

/**
 * セルの色。kindText＝区分を見る文字（2 枠目なら 1 枠目の文字）、menus＝そのセル（2 枠目なら 1 枠目）のメニュー。
 * 色を付けないときは null
 */
export function cellColor(kindText: string, menus: string[]): { bg: string; dark: boolean } | null {
  const k = kindText.trim() ? kindOf(kindText) : null;
  if (k) return { bg: KIND_COLORS[k], dark: false };
  const order = ['2回目', '3回目', '6回目'];
  const visits = menus.filter(isVisitMenu).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  if (visits.length) return { bg: visitColor(visits[0]), dark: true };
  return null;
}
