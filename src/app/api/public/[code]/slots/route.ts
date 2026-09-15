import { NextResponse } from 'next/server';
import { slotsForCustomer } from '@/lib/public';
import { isValidDate } from '@/lib/time';
import { loadStore, parseKind } from '../_store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await loadStore(code);
  if (!ctx) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? '';
  if (!isValidDate(date)) return NextResponse.json({ error: 'bad date' }, { status: 400 });
  const r = await slotsForCustomer(ctx.store, ctx.setting, date, parseKind(url.searchParams.get('kind')));
  return NextResponse.json({ date, ...r }, { headers: { 'Cache-Control': 'no-store' } });
}
