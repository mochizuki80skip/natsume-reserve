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
