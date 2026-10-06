// シフトの区分（サーバーの Settings.php と同じ）
export const SHIFT_STATUSES = ['WORK', 'OFF', 'AM_OFF', 'PM_OFF', 'PAID', 'AM_PAID', 'PM_PAID', 'HELP', 'AM_HELP', 'PM_HELP'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];
export const SHIFT_LABEL: Record<ShiftStatus, string> = {
  WORK: '〇', OFF: '休', AM_OFF: '前休', PM_OFF: '後休', PAID: '有給', AM_PAID: '前有', PM_PAID: '後有',
  HELP: 'ヘルプ', AM_HELP: '前ヘルプ', PM_HELP: '後ヘルプ', // ヘルプ＝他店へ応援に出る（その時間帯はこの店舗の枠に数えない）
};
export function worksAm(status: string | undefined): boolean {
  return !status || status === 'WORK' || status === 'PM_OFF' || status === 'PM_PAID' || status === 'PM_HELP';
}
export function worksPm(status: string | undefined): boolean {
  return !status || status === 'WORK' || status === 'AM_OFF' || status === 'AM_PAID' || status === 'AM_HELP';
}

// 他店からの応援（シフト表の「応援」行。枠を 1 増やす）
export const HELP_IN_STATUSES = ['HELP_IN', 'AM_HELP_IN', 'PM_HELP_IN'] as const;
export const HELP_IN_LABEL: Record<string, string> = { HELP_IN: 'ヘルプ', AM_HELP_IN: '前ヘルプ', PM_HELP_IN: '後ヘルプ' };

/** その日に所属しているか（所属開始日・終了日。空なら制限なし） */
export function inPeriod(m: { startDate?: string | null; endDate?: string | null }, date: string): boolean {
  return (!m.startDate || date >= m.startDate) && (!m.endDate || date <= m.endDate);
}

/** "YYYY-MM-DD" の n か月後の前日（新人・異動の印を出す最終日） */
export function oneMonthLastDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m, d)); // 1 か月後の同日
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** 新人・異動の印（開始日から 1 か月間、その期間にかかる月のシフト表に出す） */
export function joinBadge(m: { startDate?: string | null; joinType?: string | null }, firstDate: string, lastDate: string): string {
  if (!m.joinType || !m.startDate) return '';
  if (m.startDate > lastDate || oneMonthLastDay(m.startDate) < firstDate) return '';
  return m.joinType === 'NEW' ? '新人' : m.joinType === 'TRANSFER' ? '異動' : '';
}
