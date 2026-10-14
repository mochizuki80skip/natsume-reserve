// 予約表のメニュー（矯正・2回目 など）の表示用（純粋関数）
import { isVisitMenu, visitColor } from './cellColor';

/** セルの中に出す短い印。「2回目」→「2」、それ以外は先頭の 1 文字（「矯正」→「矯」） */
export function menuShort(label: string): string {
  const t = label.trim();
  const num = t.match(/^\d+/);
  return num ? num[0] : t.slice(0, 1);
}

/** メニューの色（選択肢の並び順で決める。色が足りなければ繰り返す） */
const MENU_COLORS = ['#b4462e', '#2f6fb3', '#2a8a6a', '#7a4fb0', '#a2741a', '#c23e7a', '#0f7c8c', '#5b6b2e', '#8a3b5f', '#4b5563'];
export function menuColor(label: string, options: string[]): string {
  if (isVisitMenu(label)) return visitColor(label); // 2回目・3回目・6回目はセルの色と同じ濃い色
  const i = options.indexOf(label);
  return MENU_COLORS[(i < 0 ? options.length : i) % MENU_COLORS.length];
}

/** 付け外し（選択肢の並び順にそろえる。選択肢から消えたメニューは後ろに残す） */
export function toggleMenu(current: string[], label: string, options: string[]): string[] {
  const next = current.includes(label) ? current.filter((m) => m !== label) : [...current, label];
  const order = (m: string) => { const i = options.indexOf(m); return i < 0 ? options.length : i; };
  return next.sort((a, b) => order(a) - order(b));
}
