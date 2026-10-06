// 自賠請求：店舗（本部が店舗切替中も含む）の 12 か月の月別の 1 枚あたり平均
import { NextResponse } from 'next/server';
import { apiContext } from '@/lib/admin';
import { currentYm, statsFrom, yearStats } from '@/lib/jibaiServer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const from = statsFrom(new URL(req.url).searchParams.get('from'));
  return NextResponse.json({ ...(await yearStats(ctx.store.id, from)), currentYm: currentYm() });
}
