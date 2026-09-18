import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidDate } from '@/lib/time';

const Body = z.object({
  date: z.string().refine(isValidDate),
  published: z.boolean().nullable().optional(),
  closed: z.boolean().optional(),
  memo: z.string().max(500).optional(),
  capacityAm: z.number().int().min(0).max(20).nullable().optional(),
  capacityPm: z.number().int().min(0).max(20).nullable().optional(),
});

/** 日付の公開/非公開・臨時休診・メモ */
export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { date, ...rest } = parsed.data;
  const row = await prisma.dayStatus.upsert({
    where: { storeId_date: { storeId: ctx.store.id, date } },
    update: rest,
    create: { storeId: ctx.store.id, date, published: rest.published ?? null, closed: rest.closed ?? false, memo: rest.memo, capacityAm: rest.capacityAm ?? null, capacityPm: rest.capacityPm ?? null },
  });
  return NextResponse.json({ ok: true, day: row });
}
