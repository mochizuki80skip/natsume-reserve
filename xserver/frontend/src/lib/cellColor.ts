// 予約表のセルの色（画面と印刷で共用）。
// 1. 初診（赤）・再来（青）・新自／初自（オレンジ）は担当が無くても色を付ける
// 2. 2・3・6・12回目など「n回目」は、担当（初回を担当したスタッフ）の色
// 3. 矯正は黄緑の斜線（担当の色と重ならない）
import { categorizeCell } from './attendance';

export const KIND_COLORS = { NEW: '#fca5a5', REVISIT: '#93c5fd', ACCIDENT: '#fdba74' } as const;
export const KIND_COLOR_NAMES = { NEW: '初診', REVISIT: '再来', ACCIDENT: '新自・初自（交通事故）・新三（第三者行為）' } as const;
/** 担当の色（初回・再来を担当する施術者に上から順に割り当てる。初診・再来・新自の色と重ならない色） */
export const STAFF_PALETTE: { name: string; color: string }[] = [
  { name: '緑', color: '#bbf7d0' }, { name: '黄', color: '#fef08a' }, { name: '紫', color: '#e9d5ff' }, { name: '水色', color: '#a5f3fc' },
  { name: 'ピンク', color: '#fbcfe8' }, { name: '茶', color: '#e7c9a0' }, { name: '藍', color: '#a5b4fc' }, { name: '灰', color: '#cbd5e1' },
  { name: '青緑', color: '#5eead4' }, { name: '赤紫', color: '#f0abfc' },
];
export const KYOSEI_BG = 'repeating-linear-gradient(135deg, #d9f99d 0 6px, #ffffff 6px 10px)';
export const MENU_CELL_COLORS: Record<string, string> = { 矯正: KYOSEI_BG };
export const isVisitMenu = (m: string) => /^\d+回目$/.test(m.trim());

/** 施術者名 → 色（店舗設定で決めた色、空なら並び順で自動） */
export function staffColorMap(list: { name: string; color: string }[] | undefined): Map<string, string> {
  return new Map((list ?? []).map((s, i) => [s.name, s.color || STAFF_PALETTE[i % STAFF_PALETTE.length].color]));
}

/** 初診・再来・新自のどれか（「上記初診対応」などの 2 枠目は 1 枠目の文字で判定する） */
export function kindOf(text: string): keyof typeof KIND_COLORS | null {
  const c = categorizeCell(text);
  return c.isNew ? (c.isJibai || c.isThird ? 'ACCIDENT' : 'NEW') : c.isRevisit ? 'REVISIT' : null;
}

/**
 * セルの色。kindText＝区分を見る文字（2 枠目なら 1 枠目の文字）、menus・staff＝そのセル（2 枠目なら 1 枠目）のメニューと担当。
 * 色を付けないときは null。bg は CSS の background にそのまま入れる
 */
export function cellColor(kindText: string, menus: string[], staff = '', colors: Map<string, string> = new Map()): { bg: string; dark: boolean } | null {
  const k = kindText.trim() ? kindOf(kindText) : null;
  if (k) return { bg: KIND_COLORS[k], dark: false };
  if (menus.some(isVisitMenu) && staff && colors.has(staff)) return { bg: colors.get(staff)!, dark: false };
  const m = menus.find((x) => MENU_CELL_COLORS[x.trim()]);
  if (m) return { bg: MENU_CELL_COLORS[m.trim()], dark: false };
  return null;
}
