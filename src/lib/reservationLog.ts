// 予約・来院ログ（WEB予約一覧／キャンセル名簿）の絞り込み条件と検索。画面と CSV/Excel 書き出しで共用
import type { Store } from '@prisma/client';
import { prisma } from './prisma';
import { addDays, isValidDate, nowJst } from './time';

export interface LogFilter { tab: 'web' | 'cancel'; from: string; to: string; status: '' | 'BOOKED' | 'CANCELLED'; q: string }

/** URL のクエリから絞り込み条件を組み立てる（不正な値は既定値にする） */
export function parseLogFilter(sp: { from?: string; to?: string; status?: string; q?: string; tab?: string }): LogFilter {
  const today = nowJst().date;
  return {
    tab: sp.tab === 'cancel' ? 'cancel' : 'web',
    from: sp.from && isValidDate(sp.from) ? sp.from : addDays(today, -7),
    to: sp.to && isValidDate(sp.to) ? sp.to : addDays(today, 60),
    status: sp.status === 'BOOKED' || sp.status === 'CANCELLED' ? sp.status : '',
    q: (sp.q ?? '').trim(),
  };
}

export function logFilterQuery(f: LogFilter): string {
  const p = new URLSearchParams({ tab: f.tab, from: f.from, to: f.to });
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  return p.toString();
}

/** WEB予約一覧 */
export async function findReservations(store: Pick<Store, 'id'>, f: LogFilter, take = 500) {
  const q = f.q;
  return prisma.reservation.findMany({
    where: {
      storeId: store.id, date: { gte: f.from, lte: f.to },
      ...(f.status ? { status: f.status } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q.replace(/[^\d+]/g, '') || q } }, { cardNo: { contains: q } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take,
  });
}

/** キャンセル名簿 */
export async function findCancels(store: Pick<Store, 'id'>, f: LogFilter, take = 500) {
  return prisma.cancelLog.findMany({
    where: { storeId: store.id, date: { gte: f.from, lte: f.to }, ...(f.q ? { name: { contains: f.q } } : {}) },
    orderBy: [{ date: 'desc' }, { time: 'asc' }],
    take,
  });
}

export const STATUS_JA: Record<string, string> = { BOOKED: '予約中', CANCELLED: '取消' };
export const KIND_JA: Record<string, string> = { NEW: '初診', REVISIT: '再来', RETURN: '通院中' };
