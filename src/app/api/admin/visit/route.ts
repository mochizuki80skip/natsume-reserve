import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidDate } from '@/lib/time';

const Body = z.object({ date: z.string().refine(isValidDate), time: z.number().int(), bed: z.number().int().min(1), visited: z.boolean() });

/** 来院チェックの ON/OFF */
export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { date, time, bed, visited } = parsed.data;
  const r = await prisma.cell.updateMany({ where: { storeId: ctx.store.id, date, time, bed }, data: { visited } });
  if (r.count === 0) return NextResponse.json({ error: 'セルが空です' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
