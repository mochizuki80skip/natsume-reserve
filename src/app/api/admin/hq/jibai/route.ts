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
    // 合計は請求月（請求書に印字された月。未設定なら登録した画面の月）で集計する
    prisma.jibaiClaim.findMany({ where: { OR: [{ invoiceYm: ym }, { invoiceYm: null, ym }, { ym }] }, select: { storeId: true, ym: true, amount: true, verifiedAmount: true, source: true, invoiceYm: true } }),
    prisma.jibaiMonth.findMany({ where: { ym } }),
    getJibaiSetting(),
  ]);
  const byStore = new Map<string, { n: number; total: number; vn: number; vtotal: number; ocr: number; late: number; lateTotal: number; out: number }>();
  for (const c of claims) {
    const a = byStore.get(c.storeId) ?? { n: 0, total: 0, vn: 0, vtotal: 0, ocr: 0, late: 0, lateTotal: 0, out: 0 };
    if ((c.invoiceYm ?? c.ym) === ym) {
      a.n++; a.total += c.amount;
      if (c.verifiedAmount !== null) { a.vn++; a.vtotal += c.verifiedAmount; }
      if (c.source === 'OCR') a.ocr++;
      if (c.ym !== ym) { a.late++; a.lateTotal += c.amount; } // 他の月の画面で登録された分
    } else {
      a.out++; // この月の画面で登録したが、別の月分として集計される
    }
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
      count: a?.n ?? 0, total: a?.total ?? 0, ocrCount: a?.ocr ?? 0, lateCount: a?.late ?? 0, lateTotal: a?.lateTotal ?? 0, movedOut: a?.out ?? 0, verifiedCount: a?.vn ?? 0, verifiedTotal: a?.vtotal ?? 0,
    };
    sum.count += row.count; sum.total += row.total; sum.verifiedCount += row.verifiedCount; sum.verifiedTotal += row.verifiedTotal;
    if (row.status === 'SUBMITTED') sum.submitted++;
    return row;
  });
  // 過去 12 か月の推移も請求月で集計
  const trendRaw = await prisma.jibaiClaim.groupBy({ by: ['ym', 'invoiceYm'], _count: { _all: true }, _sum: { amount: true, verifiedAmount: true } });
  const tm = new Map<string, { count: number; total: number; verifiedTotal: number }>();
  for (const t of trendRaw) {
    const k = t.invoiceYm ?? t.ym;
    const cur = tm.get(k) ?? { count: 0, total: 0, verifiedTotal: 0 };
    cur.count += t._count._all; cur.total += t._sum.amount ?? 0; cur.verifiedTotal += t._sum.verifiedAmount ?? 0;
    tm.set(k, cur);
  }
  const trend = [...tm.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12).map(([k, v]) => ({ ym: k, ...v }));
  return NextResponse.json({ ym, currentYm: currentYm(), rows, sum, storeCount: stores.length, trend, setting });
}
