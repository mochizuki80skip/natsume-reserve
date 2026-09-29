// 本部：自賠請求の指定月の店舗別合計と全社合計
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { currentYm, fmtDt, getJibaiSetting, isValidYm } from '@/lib/jibaiServer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.role !== 'hq') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const q = new URL(req.url).searchParams.get('ym') ?? '';
  const ym = isValidYm(q) ? q : currentYm();
  const [stores, claims, months, setting] = await Promise.all([
    prisma.store.findMany({ where: { active: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    prisma.jibaiClaim.findMany({ where: { ym }, select: { storeId: true, amount: true, verifiedAmount: true, source: true, invoiceYm: true } }),
    prisma.jibaiMonth.findMany({ where: { ym } }),
    getJibaiSetting(),
  ]);
  const byStore = new Map<string, { n: number; total: number; vn: number; vtotal: number; ocr: number; ymMismatch: number }>();
  for (const c of claims) {
    const a = byStore.get(c.storeId) ?? { n: 0, total: 0, vn: 0, vtotal: 0, ocr: 0, ymMismatch: 0 };
    a.n++; a.total += c.amount;
    if (c.verifiedAmount !== null) { a.vn++; a.vtotal += c.verifiedAmount; }
    if (c.source === 'OCR') a.ocr++;
    if (c.invoiceYm && c.invoiceYm !== ym) a.ymMismatch++;
    byStore.set(c.storeId, a);
  }
  const monthByStore = new Map(months.map((m) => [m.storeId, m]));
  const sum = { count: 0, total: 0, verifiedCount: 0, verifiedTotal: 0, submitted: 0 };
  const rows = stores.map((st) => {
    const a = byStore.get(st.id);
    const m = monthByStore.get(st.id);
    const row = {
      code: st.code, name: st.name,
      status: m ? m.status : 'NONE', submittedAt: fmtDt(m?.submittedAt), submittedBy: m?.submittedBy ?? null,
      count: a?.n ?? 0, total: a?.total ?? 0, ocrCount: a?.ocr ?? 0, ymMismatch: a?.ymMismatch ?? 0, verifiedCount: a?.vn ?? 0, verifiedTotal: a?.vtotal ?? 0,
    };
    sum.count += row.count; sum.total += row.total; sum.verifiedCount += row.verifiedCount; sum.verifiedTotal += row.verifiedTotal;
    if (row.status === 'SUBMITTED') sum.submitted++;
    return row;
  });
  const trendRaw = await prisma.jibaiClaim.groupBy({ by: ['ym'], _count: { _all: true }, _sum: { amount: true, verifiedAmount: true }, orderBy: { ym: 'desc' }, take: 12 });
  const trend = trendRaw.map((t) => ({ ym: t.ym, count: t._count._all, total: t._sum.amount ?? 0, verifiedTotal: t._sum.verifiedAmount ?? 0 }));
  return NextResponse.json({ ym, currentYm: currentYm(), rows, sum, storeCount: stores.length, trend, setting });
}
