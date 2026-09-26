// 自賠請求（速報集計）で画面共通に使う型と小さな関数

export interface JibaiClaim {
  id: string; ym: string; patientNo: string; patientName: string | null; days: number | null; amount: number; source: 'OCR' | 'MANUAL';
  verifiedAmount: number | null; verifiedAt: string | null; verifiedBy: string | null; note: string; createdBy: string; createdAt: string; updatedAt: string;
}
export interface JibaiMonth { status: 'DRAFT' | 'SUBMITTED'; submittedAt: string | null; submittedBy: string | null }
export interface JibaiLog { id: string; claimId: string | null; action: string; detail: string | null; byCode: string; createdAt: string }

export function yen(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : `${n.toLocaleString('ja-JP')}円`;
}

/** "2026-09" → "2026年9月" */
export function formatYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

/** "2026-09" + 1 → "2026-10" */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** "2026-09-26 10:05:00" → "9/26 10:05" */
export function formatDateTime(dt: string | null | undefined): string {
  if (!dt) return '';
  const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return dt;
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
}

export const LOG_ACTION_JA: Record<string, string> = { add: '追加', update: '変更', delete: '削除', submit: '提出', reopen: '提出取消', verify: '経理確認', unverify: '経理確認の取消' };
