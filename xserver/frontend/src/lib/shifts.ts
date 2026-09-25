// シフトの区分（サーバーの Settings.php と同じ）
export const SHIFT_STATUSES = ['WORK', 'OFF', 'AM_OFF', 'PM_OFF', 'PAID', 'AM_PAID', 'PM_PAID'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];
export const SHIFT_LABEL: Record<ShiftStatus, string> = {
  WORK: '〇', OFF: '休', AM_OFF: '前休', PM_OFF: '後休', PAID: '有給', AM_PAID: '前有', PM_PAID: '後有',
};
export function worksAm(status: string | undefined): boolean {
  return !status || status === 'WORK' || status === 'PM_OFF' || status === 'PM_PAID';
}
export function worksPm(status: string | undefined): boolean {
  return !status || status === 'WORK' || status === 'AM_OFF' || status === 'AM_PAID';
}
