import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { parseHoursConfig } from '@/lib/hours';

const Body = z.object({
  name: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).max(20),
  beds: z.number().int().min(1).max(20),
  defaultActiveBeds: z.number().int().min(0).max(20),
  publishDaysAhead: z.number().int().min(0).max(365),
  notifyPhone: z.string().trim().max(20).optional(),
  hoursOverride: z.unknown().nullable(),
});

export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 });
  const b = parsed.data;
  let hoursOverride: object | null = null;
  if (b.hoursOverride !== null && b.hoursOverride !== undefined) {
    const cfg = parseHoursConfig(b.hoursOverride);
    if (!cfg) return NextResponse.json({ error: '営業時間の個別設定の形式が正しくありません（docs/SPEC.md 参照）' }, { status: 400 });
    hoursOverride = cfg;
  }
  await prisma.store.update({
    where: { id: ctx.store.id },
    data: { name: b.name, phone: b.phone, beds: b.beds, defaultActiveBeds: Math.min(b.defaultActiveBeds, b.beds), publishDaysAhead: b.publishDaysAhead, notifyPhone: b.notifyPhone || null, hoursOverride: hoursOverride ?? Prisma.JsonNull },
  });
  return NextResponse.json({ ok: true });
}

/** 自分のパスワード変更 */
export async function PATCH(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const current = String(body.current ?? '');
  const next = String(body.next ?? '');
  if (next.length < 8) return NextResponse.json({ error: '8文字以上にしてください' }, { status: 400 });
  const account = await prisma.adminAccount.findUnique({ where: { id: ctx.session.accountId } });
  if (!account || !(await bcrypt.compare(current, account.passwordHash))) {
    return NextResponse.json({ error: '現在のパスワードが違います' }, { status: 400 });
  }
  await prisma.adminAccount.update({ where: { id: account.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
  return NextResponse.json({ ok: true });
}
