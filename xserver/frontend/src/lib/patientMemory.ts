// 次回の予約のために、この端末（ブラウザ）の中だけにお名前・電話番号・診察券番号を覚えておく
// サーバーには保存しない。共用の端末では予約完了画面のチェックを外してもらう
const KEY = 'natsume.patient';
export interface PatientMemory { name: string; phone: string; cardNo: string }

export function loadPatient(): PatientMemory | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v.name === 'string' && typeof v.phone === 'string') return { name: v.name, phone: v.phone, cardNo: typeof v.cardNo === 'string' ? v.cardNo : '' };
  } catch { /* 読めないときは覚えていない扱い */ }
  return null;
}

export function savePatient(p: PatientMemory): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 保存できない端末では何もしない */ }
}

export function forgetPatient(): void {
  try { localStorage.removeItem(KEY); } catch { /* 同上 */ }
}
