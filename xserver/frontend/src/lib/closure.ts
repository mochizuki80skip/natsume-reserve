// 臨時休業のお知らせ（予約ページ・店舗えらび）。part が null なら終日、AM / PM は午前だけ・午後だけ
import { WEEKDAY_JA, weekdayOf } from './time';

export interface Closure { date: string; part: 'AM' | 'PM' | null; note: string }

const PART_JA = { AM: '午前', PM: '午後' } as const;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}（${WEEKDAY_JA[weekdayOf(d)]}）`;
const mdJa = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日（${WEEKDAY_JA[weekdayOf(d)]}）`;

/** 店舗えらびの印：「本日 臨時休業」「10/28（水）午前 臨時休業」 */
export function closureBadge(c: Closure, today: string): string {
  return `${c.date === today ? '本日' : md(c.date)} ${c.part ? `${PART_JA[c.part]} ` : ''}臨時休業`;
}

/** 予約ページのお知らせ文：「10月28日（水）は臨時休業いたします（台風のため）。」 */
export function closureSentence(c: Closure): string {
  return `${mdJa(c.date)}${c.part ? `${PART_JA[c.part]}` : ''}は臨時休業いたします${c.note ? `（${c.note}）` : ''}。`;
}
