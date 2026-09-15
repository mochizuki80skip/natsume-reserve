// 営業時間の設定と、ある日付の営業セッション（時間帯）の解決
import { isHoliday } from 'japanese-holidays';
import { hmToMin, weekdayOf } from './time';

/** ["09:00", "11:45"] = 最初の枠の開始時刻, 最後の枠の開始時刻 */
export type Session = [string, string];

export interface HoursPeriod {
  from?: string; // YYYY-MM-DD（含む）。省略時は無期限
  to?: string;   // YYYY-MM-DD（含む）。省略時は無期限
  byWeekday: Record<string, Session[]>; // "0"(日)〜"6"(土)。無い曜日は休診
}

export interface HoursConfig {
  periods: HoursPeriod[];
}

const WEEKDAY_SESSIONS: Session[] = [['09:00', '11:45'], ['15:00', '19:15']];
const SATURDAY_SESSIONS: Session[] = [['09:00', '11:45'], ['14:00', '18:15']];

/** 2026-10-21 から全店統一の営業時間。木・日は休診 */
export const UNIFIED_BY_WEEKDAY: Record<string, Session[]> = {
  '1': WEEKDAY_SESSIONS,
  '2': WEEKDAY_SESSIONS,
  '3': WEEKDAY_SESSIONS,
  '5': WEEKDAY_SESSIONS,
  '6': SATURDAY_SESSIONS,
};

export const DEFAULT_HOURS: HoursConfig = {
  periods: [
    { to: '2026-10-20', byWeekday: UNIFIED_BY_WEEKDAY },
    { from: '2026-10-21', byWeekday: UNIFIED_BY_WEEKDAY },
  ],
};

export interface ResolvedSession {
  start: number;     // 分
  lastStart: number; // 最終枠の開始（分）
}

/** 設定 JSON を検証して HoursConfig にする（不正なら null） */
export function parseHoursConfig(v: unknown): HoursConfig | null {
  if (!v || typeof v !== 'object') return null;
  const periods = (v as { periods?: unknown }).periods;
  if (!Array.isArray(periods)) return null;
  const out: HoursPeriod[] = [];
  for (const p of periods) {
    if (!p || typeof p !== 'object') return null;
    const { from, to, byWeekday } = p as HoursPeriod;
    if (from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
    if (to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
    if (!byWeekday || typeof byWeekday !== 'object') return null;
    const bw: Record<string, Session[]> = {};
    for (const [k, sessions] of Object.entries(byWeekday)) {
      if (!/^[0-6]$/.test(k) || !Array.isArray(sessions)) return null;
      for (const s of sessions) {
        if (!Array.isArray(s) || s.length !== 2) return null;
        if (!s.every((x) => typeof x === 'string' && /^\d{1,2}:\d{2}$/.test(x))) return null;
        if (hmToMin(s[0]) > hmToMin(s[1])) return null;
      }
      bw[k] = sessions as Session[];
    }
    out.push({ from, to, byWeekday: bw });
  }
  return { periods: out };
}

/** 日付に適用する期間を返す。複数該当する場合は後ろの定義が優先 */
export function periodForDate(config: HoursConfig, date: string): HoursPeriod | null {
  let found: HoursPeriod | null = null;
  for (const p of config.periods) {
    if (p.from && date < p.from) continue;
    if (p.to && date > p.to) continue;
    found = p;
  }
  return found;
}

export function isJpHoliday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  return Boolean(isHoliday(new Date(y, m - 1, d)));
}

/**
 * 日付の営業セッションを返す。休診なら空配列。
 * closed（臨時休診）が true なら空配列。
 */
export function sessionsForDate(
  config: HoursConfig,
  date: string,
  opts: { closeOnHolidays: boolean; closed?: boolean },
): ResolvedSession[] {
  if (opts.closed) return [];
  if (opts.closeOnHolidays && isJpHoliday(date)) return [];
  const p = periodForDate(config, date);
  if (!p) return [];
  const sessions = p.byWeekday[String(weekdayOf(date))] ?? [];
  return sessions
    .map(([a, b]) => ({ start: hmToMin(a), lastStart: hmToMin(b) }))
    .sort((x, y) => x.start - y.start);
}

/** セッション内の枠開始時刻を列挙 */
export function slotTimes(sessions: ResolvedSession[], slotMinutes: number): number[] {
  const out: number[] = [];
  for (const s of sessions) for (let t = s.start; t <= s.lastStart; t += slotMinutes) out.push(t);
  return out;
}

/** 午前/午後の境界。12:00 より前に始まる枠を午前とする */
export const NOON = 12 * 60;
