import { NextResponse } from 'next/server';
import { calendarForCustomer } from '@/lib/public';
import { isValidMonth, nowJst } from '@/lib/time';
import { loadStore, parseKind } from '../_store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await loadStore(code);
  if (!ctx) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const url = new URL(req.url);
  const ym = url.searchParams.get('month') ?? nowJst().date.slice(0, 7);
  if (!isValidMonth(ym)) return NextResponse.json({ error: 'bad month' }, { status: 400 });
  const days = await calendarForCustomer(ctx.store, ctx.setting, ym, parseKind(url.searchParams.get('kind')));
  return NextResponse.json({ month: ym, today: nowJst().date, days }, { headers: { 'Cache-Control': 'no-store' } });
}
