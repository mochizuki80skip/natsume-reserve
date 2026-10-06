// 本部：全店（または 1 店舗）の 12 か月の月別の 1 枚あたり平均と、店舗ごとの年間の比較
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { currentYm, statsFrom, storesYearSummary, yearStats } from '@/lib/jibaiServer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.role !== 'hq') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const from = statsFrom(sp.get('from'));
  const code = sp.get('store') ?? '';
  const store = code ? await prisma.store.findUnique({ where: { code }, select: { id: true, code: true, name: true } }) : null;
  if (code && !store) return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
  const [data, stores] = await Promise.all([yearStats(store?.id ?? null, from), storesYearSummary(from)]);
  return NextResponse.json({ ...data, currentYm: currentYm(), store: store ? { code: store.code, name: store.name } : null, stores });
}
