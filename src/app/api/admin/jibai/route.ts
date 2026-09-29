// 自賠請求（速報集計）：店舗（本部が店舗切替中も含む）の対象月データ
import { NextResponse } from 'next/server';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { currentYm, getJibaiSetting, isValidYm, listClaims, listLogs, monthRow, monthsWithData } from '@/lib/jibaiServer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const q = new URL(req.url).searchParams.get('ym') ?? '';
  const ym = isValidYm(q) ? q : currentYm();
  const sid = ctx.store.id;
  const [claims, month, months, logs, setting, others] = await Promise.all([
    listClaims(sid, ym),
    prisma.jibaiMonth.findUnique({ where: { storeId_ym: { storeId: sid, ym } } }),
    monthsWithData(sid),
    listLogs(sid, ym),
    getJibaiSetting(),
    // 他の月の画面で登録された、この月分（請求月＝この月）の明細。この月の合計に含める
    prisma.jibaiClaim.groupBy({ by: ['ym'], where: { storeId: sid, invoiceYm: ym, NOT: { ym } }, _count: { _all: true }, _sum: { amount: true }, orderBy: { ym: 'asc' } }),
  ]);
  return NextResponse.json({
    ym,
    currentYm: currentYm(),
    store: { code: ctx.store.code, name: ctx.store.name },
    isHq: ctx.session.role === 'hq',
    month: monthRow(month),
    claims,
    total: claims.reduce((s, c) => s + c.amount, 0),
    verifiedTotal: claims.reduce((s, c) => s + (c.verifiedAmount ?? 0), 0),
    months,
    otherScreens: others.map((o) => ({ screenYm: o.ym, count: o._count._all, total: o._sum.amount ?? 0 })),
    logs,
    nameRetentionDays: setting.nameRetentionDays,
  });
}
