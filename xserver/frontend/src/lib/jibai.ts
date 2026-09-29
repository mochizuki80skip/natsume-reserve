// 自賠請求（速報集計）で画面共通に使う型と小さな関数

export interface JibaiClaim {
  id: string; ym: string; invoiceYm: string | null; patientNo: string; patientName: string | null; days: number | null; amount: number; source: 'OCR' | 'MANUAL';
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

/** "2026-09" → "2026年9月（令和8年）" */
export function formatYmWithEra(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const era = y >= 2019 ? `令和${y - 2018 === 1 ? '元' : y - 2018}年` : `平成${y - 1988}年`;
  return `${y}年${m}月（${era}）`;
}

/** 請求月の選択肢：基準月の 2 か月先から 24 か月前まで（新しい順）＋ 指定の月 */
export function ymOptions(baseYm: string, extra: string[] = []): string[] {
  const list = Array.from({ length: 27 }, (_, i) => addMonths(baseYm, 2 - i));
  return Array.from(new Set([...list, ...extra.filter((x) => /^\d{4}-\d{2}$/.test(x))])).sort().reverse();
}

// ---- スクショの大きさの目安（現場向けに「画面の縦の何割」で案内する）----
// このレセコンの請求書は縦長（横:縦 ≒ 656:940）。検証では横幅 590px 以上で全項目が正しく読めたため、
// 余裕をみて横 600px ＝ 縦 860px 以上をスクショ上の目安にする。
// 読み取りに効くのは請求書の「縦の長さ」なので、ウィンドウが全画面か左右半分かは問わない。
export const MIN_INVOICE_HEIGHT_PX = 860;
export const INVOICE_ASPECT = 940 / 656;

/** このパソコンの画面の縦の実ピクセル数（Windows の表示スケールを含む。スクショはこの解像度で撮られる） */
export function screenPixelHeight(): number | null {
  try {
    if (typeof window === 'undefined' || !window.screen?.height) return null;
    return Math.round(window.screen.height * (window.devicePixelRatio || 1));
  } catch { return null; }
}

/** 0.8 → "8割"。1 以上は "10割"（画面いっぱい） */
export function wari(f: number): string {
  return `${Math.min(10, Math.max(1, Math.ceil(f * 10 - 0.05)))}割`;
}

/** この画面で、請求書が画面の縦の何割以上に写っていればよいか（1 を超えるならこの画面では足りない） */
export function requiredScreenFraction(screenH = screenPixelHeight()): number | null {
  return screenH ? MIN_INVOICE_HEIGHT_PX / screenH : null;
}

export const LOG_ACTION_JA: Record<string, string> = { add: '追加', update: '変更', delete: '削除', submit: '提出', reopen: '提出取消', verify: '経理確認', unverify: '経理確認の取消' };
