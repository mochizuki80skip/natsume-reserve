import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidDate } from '@/lib/time';

const Body = z.object({
  date: z.string().refine(isValidDate),
  cells: z.array(z.object({ time: z.number().int().min(0).max(1440), bed: z.number().int().min(0).max(20), text: z.string().max(100) })).max(500),
});

/** セルの一括保存。text が空なら削除 */
export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { date, cells } = parsed.data;
  const storeId = ctx.store.id;
  await prisma.$transaction(async (tx) => {
    const touched = new Set<string>();
    for (const c of cells) {
      if (c.bed > ctx.store.beds) continue;
      const text = c.text.trim();
      const where = { storeId_date_time_bed: { storeId, date, time: c.time, bed: c.bed } };
      if (text === '') {
        const old = await tx.cell.findUnique({ where, select: { reservationId: true } });
        if (old?.reservationId) touched.add(old.reservationId);
        await tx.cell.deleteMany({ where: { storeId, date, time: c.time, bed: c.bed } });
      } else {
        await tx.cell.upsert({ where, update: { text }, create: { storeId, date, time: c.time, bed: c.bed, text } });
      }
    }
    // WEB予約のセルがすべて消えたら、その予約は取消扱いにする
    for (const rid of touched) {
      const remain = await tx.cell.count({ where: { reservationId: rid } });
      if (remain === 0) await tx.reservation.update({ where: { id: rid }, data: { status: 'CANCELLED' } });
    }
  });
  return NextResponse.json({ ok: true });
}
