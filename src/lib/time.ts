// 日付・時刻ユーティリティ。サーバーのタイムゾーンに関係なく日本時間で扱う。

export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** "09:00" → 540 */
export function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/** 540 → "9:00" */
export function minToHm(min: number, pad = false): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad ? String(h).padStart(2, '0') : h}:${String(m).padStart(2, '0')}`;
}

/** YYYY-MM-DD の妥当性 */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** YYYY-MM-DD の曜日（0=日）。UTC で計算しても日付だけなので影響なし */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 日付に日数を加算 */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 2 日付の差（b - a、日数） */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** 日本時間の現在（日付と 0:00 からの分） */
export function nowJst(now: Date = new Date()): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24; // "24" が返る環境への保険
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

/** "2026年10月21日（水）" */
export function formatDateJa(date: string, withYear = true): string {
  const [y, m, d] = date.split('-').map(Number);
  const w = WEEKDAY_JA[weekdayOf(date)];
  return `${withYear ? `${y}年` : ''}${m}月${d}日（${w}）`;
}

/** "10/21(水)" */
export function formatDateShort(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAY_JA[weekdayOf(date)]})`;
}

/** 月の日付一覧 "YYYY-MM" → ["YYYY-MM-01", ...] */
export function datesOfMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}

export function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
