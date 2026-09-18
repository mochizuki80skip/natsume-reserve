import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidDate } from '@/lib/time';

const Body = z.object({
  date: z.string().refine(isValidDate),
  role: z.enum(['THERAPIST', 'RECEPTION']),
  slot: z.number().int().min(1).max(20),
  name: z.string().max(30),
});

/** 日付ごとのシフト（施術者・受付の氏名）。name が空なら削除 */
export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { date, role, slot, name } = parsed.data;
  const max = role === 'THERAPIST' ? ctx.store.maxTherapists : ctx.store.maxReception;
  if (slot > max) return NextResponse.json({ error: 'slot out of range' }, { status: 400 });
  const storeId = ctx.store.id;
  const text = name.trim();
  if (text === '') {
    await prisma.staffDay.deleteMany({ where: { storeId, date, role, slot } });
  } else {
    await prisma.staffDay.upsert({
      where: { storeId_date_role_slot: { storeId, date, role, slot } },
      update: { name: text },
      create: { storeId, date, role, slot, name: text },
    });
  }
  const therapists = await prisma.staffDay.count({ where: { storeId, date, role: 'THERAPIST' } });
  return NextResponse.json({ ok: true, therapists });
}
