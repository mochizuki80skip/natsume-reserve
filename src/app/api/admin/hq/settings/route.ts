import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseHoursConfig } from '@/lib/hours';

const Body = z.object({
  slotMinutes: z.number().int().min(5).max(60),
  newVisitSlots: z.number().int().min(1).max(8),
  returnVisitSlots: z.number().int().min(1).max(8),
  webCutoffMinutes: z.number().int().min(0).max(1440),
  phoneCutoffMinutes: z.number().int().min(0).max(1440),
  phoneMarkRemaining: z.number().int().min(0).max(20),
  closeOnHolidays: z.boolean(),
  adminExtraSlots: z.number().int().min(0).max(8),
  retentionDays: z.number().int().min(7).max(3650),
  hours: z.unknown(),
});

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s || s.role !== 'hq') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 });
  const { hours, ...rest } = parsed.data;
  const cfg = parseHoursConfig(hours);
  if (!cfg) return NextResponse.json({ error: '営業時間の形式が正しくありません' }, { status: 400 });
  if (rest.phoneCutoffMinutes > rest.webCutoffMinutes) return NextResponse.json({ error: '電話受付の締切はWEB予約の締切以下にしてください' }, { status: 400 });
  await prisma.globalSetting.upsert({ where: { id: 1 }, update: { ...rest, hours: cfg as object }, create: { id: 1, ...rest, hours: cfg as object } });
  return NextResponse.json({ ok: true });
}
