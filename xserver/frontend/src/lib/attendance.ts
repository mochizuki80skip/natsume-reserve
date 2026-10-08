// 来院チェックの表示状態（純粋関数）

export type CellState = 'visited' | 'noshow' | 'pending' | 'none';
export const NOSHOW_AFTER_MIN = 30;

/** 2枠目（初診・再来の対応欄）の文字か */
export function isContinuationText(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return t === '上記初診対応' || t === '上記再来対応' || t === '〃';
}

/** 予約表の内訳集計に使う区分。1 つのセルが複数に該当することがある（例：初診かつ自賠） */
export interface CellCategories { isNew: boolean; isRevisit: boolean; isJibai: boolean }

/**
 * セルの文字から内訳を判定する（サーバー側 Text::categorize と同じ決まり）。
 * - 初診：「（初診）」「（初自）」「（初）」（半角括弧も可）、または括弧なしの「初診」「初自」を含む
 * - 再来：「（再）」、または括弧なしの「再来」「再診」を含む
 * - 自賠：「初自」「自賠」「事故」を含む（例：山田 自賠、鈴木（事故））
 * 括弧なしの「初」「再」1文字はお名前（初美など）と区別できないので数えない。2枠目の「上記初診対応」「上記再来対応」は対象外
 */
export function categorizeCell(text: string | null | undefined): CellCategories {
  const t = (text ?? '').trim();
  if (isContinuationText(t)) return { isNew: false, isRevisit: false, isJibai: false };
  return {
    isNew: /[（(]初(診|自)?[）)]|初診|初自/.test(t),
    isRevisit: /[（(]再[）)]|再来|再診/.test(t),
    isJibai: /自賠|事故|初自/.test(t),
  };
}

/** 1枠目の文字が初診・再来（2枠使う予約）か */
export function isTwoSlotName(text: string | null | undefined): boolean {
  const c = categorizeCell(text);
  return c.isNew || c.isRevisit;
}

/**
 * セルの表示状態。
 * - visited: 来院チェック済み
 * - noshow: 予約時刻 + 30 分を過ぎて未チェック（「未来院」表記）
 * - pending: 予約時刻を過ぎて未チェック
 * - none: まだ予約時刻前、または当日以外
 * @param nowMinutes 当日なら現在時刻（分）、過去日は Infinity、未来日は null
 */
export function cellState(visited: boolean, time: number, nowMinutes: number | null): CellState {
  if (visited) return 'visited';
  if (nowMinutes === null) return 'none';
  if (nowMinutes >= time + NOSHOW_AFTER_MIN) return 'noshow';
  if (nowMinutes > time) return 'pending';
  return 'none';
}
