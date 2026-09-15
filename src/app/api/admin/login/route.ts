import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { setSessionCookie } from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/ratelimit';

export async function POST(req: Request) {
  if (!rateLimit(`login:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'しばらくしてからお試しください' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? '').trim();
  const password = String(body.password ?? '');
  const account = await prisma.adminAccount.findUnique({ where: { code }, include: { store: true } });
  const ok = account && (await bcrypt.compare(password, account.passwordHash));
  if (!ok || (account.role === 'store' && !account.store?.active)) {
    return NextResponse.json({ error: '店舗コードまたはパスワードが違います' }, { status: 401 });
  }
  await setSessionCookie({ accountId: account.id, role: account.role === 'hq' ? 'hq' : 'store', storeId: account.storeId, code: account.code });
  return NextResponse.json({ ok: true });
}
