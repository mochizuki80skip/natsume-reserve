// 本部：自賠請求の氏名の保持日数
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getJibaiSetting } from '@/lib/jibaiServer';

const Body = z.object({ nameRetentionDays: z.number().int().min(7).max(3650) });

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s || s.role !== 'hq') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '保持日数は 7〜3650 の範囲で入力してください' }, { status: 400 });
  await getJibaiSetting();
  await prisma.jibaiSetting.update({ where: { id: 1 }, data: { nameRetentionDays: parsed.data.nameRetentionDays } });
  return NextResponse.json({ ok: true, setting: await getJibaiSetting() });
}
