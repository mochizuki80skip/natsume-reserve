import { NextResponse } from 'next/server';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';

/** WEB予約を取り消す：その予約のセル（氏名と2枠目）をすべて削除し、予約を CANCELLED にする */
export async function DELETE(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  const r = await prisma.reservation.findFirst({ where: { id: String(id), storeId: ctx.store.id } });
  if (!r) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await prisma.$transaction([
    prisma.cell.deleteMany({ where: { reservationId: r.id } }),
    prisma.reservation.update({ where: { id: r.id }, data: { status: 'CANCELLED' } }),
  ]);
  return NextResponse.json({ ok: true });
}
