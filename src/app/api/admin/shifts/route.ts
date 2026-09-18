import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidDate } from '@/lib/time';
import { SHIFT_STATUSES } from '@/lib/settings';

const Body = z.object({
  staffId: z.string(),
  date: z.string().refine(isValidDate),
  status: z.enum(['', ...SHIFT_STATUSES]),
});

/** シフト 1 セルの保存。status が空または WORK なら行を削除（未入力＝〇） */
export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { staffId, date, status } = parsed.data;
  const m = await prisma.staffMember.findFirst({ where: { id: staffId, storeId: ctx.store.id } });
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (status === '' || status === 'WORK') {
    await prisma.shift.deleteMany({ where: { staffId, date } });
  } else {
    await prisma.shift.upsert({ where: { staffId_date: { staffId, date } }, update: { status }, create: { storeId: ctx.store.id, staffId, date, status } });
  }
  return NextResponse.json({ ok: true });
}
