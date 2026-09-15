// 本部アカウントの店舗切替
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { STORE_COOKIE } from '@/lib/admin';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'hq') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const form = await req.formData();
  const code = String(form.get('store') ?? '');
  const store = await prisma.store.findUnique({ where: { code } });
  if (!store) return NextResponse.json({ error: 'not found' }, { status: 404 });
  (await cookies()).set(STORE_COOKIE, code, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  const back = String(form.get('back') ?? '/admin');
  return NextResponse.redirect(new URL(back.startsWith('/admin') ? back : '/admin', req.url), { status: 303 });
}
