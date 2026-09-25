// 営業時間に関する画面側の小さな関数（判定本体はサーバーの PHP が行う）
import type { ResolvedSession } from './types';

export type { ResolvedSession };

/** 午前/午後の境界（営業セッションが分からない場合の目安） */
export const NOON = 12 * 60;

/** その時刻が午前ブロックか。12:00 の追加枠のように正午以降でも午前セッションに属する枠は午前扱い */
export function isAm(sessions: ResolvedSession[], t: number): boolean {
  const s = sessions.find((x) => t >= x.start && t <= x.lastAdmin);
  return s ? s.start < NOON : t < NOON;
}
