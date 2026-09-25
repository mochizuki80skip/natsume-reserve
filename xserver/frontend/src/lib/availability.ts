// 予約表のセル文字の判定（サーバーの Availability.php と同じ規則）
const NOT_A_PATIENT = new Set(['〃', '"', '✖', '×', 'X', 'x', '-', 'ー', '－', '休', '休み', '上記初診対応', '上記再来対応']);

/** 予約表の氏名セルとして数えるか（「〃」「✖」などは数えない） */
export function isPatientText(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return t.length > 0 && !NOT_A_PATIENT.has(t);
}
