// 自賠責請求の速報集計：サーバー側の共通処理（行の整形・操作記録・氏名の自動削除）
import type { JibaiClaim, JibaiMonth } from '@prisma/client';
import { prisma } from './prisma';
import { addDays, isValidMonth, nowJst } from './time';

export const DEFAULT_NAME_RETENTION_DAYS = 180;
export const MAX_AMOUNT = 99999999;

export function isValidYm(ym: unknown): ym is string {
  return typeof ym === 'string' && isValidMonth(ym) && ym >= '2020-01' && ym <= '2099-12';
}

export function currentYm(): string {
  return nowJst().date.slice(0, 7);
}

/** DateTime → "YYYY-MM-DD HH:MM:SS"（日本時間。画面の整形関数に合わせる） */
export function fmtDt(d: Date | null | undefined): string | null {
  if (!d) return null;
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')} ${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}:${String(j.getUTCSeconds()).padStart(2, '0')}`;
}

export function claimRow(c: JibaiClaim) {
  return {
    id: c.id, ym: c.ym, invoiceYm: c.invoiceYm, patientNo: c.patientNo, patientName: c.patientName, days: c.days, amount: c.amount, source: c.source,
    verifiedAmount: c.verifiedAmount, verifiedAt: fmtDt(c.verifiedAt), verifiedBy: c.verifiedBy, note: c.note ?? '', createdBy: c.createdBy,
    createdAt: fmtDt(c.createdAt), updatedAt: fmtDt(c.updatedAt),
  };
}

export function monthRow(m: JibaiMonth | null) {
  return m ? { status: m.status, submittedAt: fmtDt(m.submittedAt), submittedBy: m.submittedBy } : null;
}

export async function getJibaiSetting(): Promise<{ nameRetentionDays: number }> {
  const s = await prisma.jibaiSetting.findUnique({ where: { id: 1 } });
  if (s) return { nameRetentionDays: s.nameRetentionDays };
  const c = await prisma.jibaiSetting.create({ data: { id: 1, nameRetentionDays: DEFAULT_NAME_RETENTION_DAYS } });
  return { nameRetentionDays: c.nameRetentionDays };
}

export async function listClaims(storeId: string, ym: string) {
  const rows = await prisma.jibaiClaim.findMany({ where: { storeId, ym }, orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map(claimRow);
}

export async function jibaiLog(storeId: string, ym: string, claimId: string | null, action: string, detail: string | null, byCode: string): Promise<void> {
  await prisma.jibaiLog.create({ data: { storeId, ym, claimId, action, detail: detail === null ? null : detail.slice(0, 300), byCode } });
}

export async function listLogs(storeId: string, ym: string, limit = 50) {
  const rows = await prisma.jibaiLog.findMany({ where: { storeId, ym }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
  return rows.map((r) => ({ id: r.id, claimId: r.claimId, action: r.action, detail: r.detail, byCode: r.byCode, createdAt: fmtDt(r.createdAt) }));
}

/** データがある月の一覧（新しい順） */
export async function monthsWithData(storeId: string | null, limit = 24): Promise<string[]> {
  const where = storeId ? { storeId } : {};
  const [a, b, c] = await Promise.all([
    prisma.jibaiClaim.findMany({ where, select: { ym: true }, distinct: ['ym'] }),
    prisma.jibaiMonth.findMany({ where, select: { ym: true }, distinct: ['ym'] }),
    prisma.jibaiClaim.findMany({ where: { ...where, NOT: { invoiceYm: null } }, select: { invoiceYm: true }, distinct: ['invoiceYm'] }),
  ]);
  return Array.from(new Set([...a.map((r) => r.ym), ...b.map((r) => r.ym), ...c.map((r) => r.invoiceYm!)])).sort().reverse().slice(0, limit);
}

/** 保持期間を過ぎた月の氏名を消す（金額などの集計値は残す）。対象月の翌月 1 日から nameRetentionDays 日を過ぎた月が対象 */
export async function cleanupJibaiNames(): Promise<{ beforeMonth: string; namesCleared: number }> {
  const { nameRetentionDays } = await getJibaiSetting();
  const limitYm = addDays(nowJst().date, -nameRetentionDays).slice(0, 7);
  const r = await prisma.jibaiClaim.updateMany({ where: { ym: { lt: limitYm }, patientName: { not: null } }, data: { patientName: null } });
  return { beforeMonth: limitYm, namesCleared: r.count };
}

export const yenFmt = (n: number) => n.toLocaleString('ja-JP');
