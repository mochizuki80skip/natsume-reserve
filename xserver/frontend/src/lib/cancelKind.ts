// キャンセル・変更名簿の区分（ADVANCE＝事前連絡のキャンセル、NOSHOW＝無断キャンセル、CHANGE＝予約変更）
import { formatDateShort, minToHm } from './time';

export const CANCEL_KIND_JA: Record<string, string> = { ADVANCE: '事前連絡', NOSHOW: '無断', CHANGE: '予約変更' };
export const CANCEL_KIND_CLASS: Record<string, string> = { ADVANCE: 'bg-brand-light text-brand-dark', NOSHOW: 'bg-red-100 text-red-800', CHANGE: 'bg-violet-100 text-violet-800' };

/** 予約変更の変更先（「10/20 15:00」）。時刻が無ければ日付だけ */
export function changeTargetText(nextDate: string | null | undefined, nextTime: number | string | null | undefined): string {
  if (!nextDate) return '';
  const t = nextTime === null || nextTime === undefined || nextTime === '' ? null : Number(nextTime);
  return `${formatDateShort(nextDate)}${t === null || Number.isNaN(t) ? '' : ` ${minToHm(t)}`}`;
}
