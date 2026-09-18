import { NextResponse } from 'next/server';
import { weekForCustomer } from '@/lib/public';
import { isValidDate, mondayOf, nowJst } from '@/lib/time';
import { loadStore, parseKind } from '../_store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await loadStore(code);
  if (!ctx) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const url = new URL(req.url);
  const startParam = url.searchParams.get('start');
  const start = startParam && isValidDate(startParam) ? mondayOf(startParam) : mondayOf(nowJst().date);
  const r = await weekForCustomer(ctx.store, ctx.setting, start, parseKind(url.searchParams.get('kind')));
  return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
}
