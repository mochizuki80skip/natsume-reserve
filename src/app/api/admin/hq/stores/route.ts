import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

async function requireHq() {
  const s = await getSession();
  return s && s.role === 'hq' ? s : null;
}

const Create = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,20}$/, '店舗コードは英数字 2〜20 文字'),
  name: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).max(20),
  password: z.string().min(8, 'パスワードは8文字以上'),
});

export async function POST(req: Request) {
  if (!(await requireHq())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' }, { status: 400 });
  const b = parsed.data;
  if (await prisma.adminAccount.findUnique({ where: { code: b.code } })) {
    return NextResponse.json({ error: 'この店舗コードは既に使われています' }, { status: 409 });
  }
  await prisma.$transaction(async (tx) => {
    const store = await tx.store.create({ data: { code: b.code, name: b.name, phone: b.phone } });
    await tx.adminAccount.create({ data: { code: b.code, role: 'store', storeId: store.id, passwordHash: await bcrypt.hash(b.password, 10) } });
  });
  return NextResponse.json({ ok: true });
}

const Update = z.object({ code: z.string(), action: z.enum(['reset', 'toggle']), password: z.string().nullable().optional() });

export async function PUT(req: Request) {
  if (!(await requireHq())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { code, action, password } = parsed.data;
  const store = await prisma.store.findUnique({ where: { code } });
  if (!store) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (action === 'toggle') {
    await prisma.store.update({ where: { id: store.id }, data: { active: !store.active } });
  } else {
    if (!password || password.length < 8) return NextResponse.json({ error: 'パスワードは8文字以上' }, { status: 400 });
    await prisma.adminAccount.updateMany({ where: { storeId: store.id, role: 'store' }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  }
  return NextResponse.json({ ok: true });
}
