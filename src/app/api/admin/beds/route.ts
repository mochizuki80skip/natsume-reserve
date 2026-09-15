import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidDate } from '@/lib/time';

const Body = z.object({
  date: z.string().refine(isValidDate),
  beds: z.array(z.object({ bed: z.number().int().min(1).max(20), active: z.boolean(), label: z.string().max(30).optional() })).min(1).max(20),
});

/** 日付×ベッドの稼働チェック・見出しを保存（初回保存時は全ベッド分の行を作る） */
export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { date, beds } = parsed.data;
  const store = ctx.store;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.bedStatus.count({ where: { storeId: store.id, date } });
    if (existing === 0) {
      // 既定状態を明示的に保存してから差分を適用する
      await tx.bedStatus.createMany({
        data: Array.from({ length: store.beds }, (_, i) => ({ storeId: store.id, date, bed: i + 1, active: i + 1 <= store.defaultActiveBeds })),
        skipDuplicates: true,
      });
    }
    for (const b of beds) {
      if (b.bed > store.beds) continue;
      await tx.bedStatus.upsert({
        where: { storeId_date_bed: { storeId: store.id, date, bed: b.bed } },
        update: { active: b.active, ...(b.label !== undefined ? { label: b.label } : {}) },
        create: { storeId: store.id, date, bed: b.bed, active: b.active, label: b.label },
      });
    }
  });
  return NextResponse.json({ ok: true });
}
