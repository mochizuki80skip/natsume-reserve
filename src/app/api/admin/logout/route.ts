import { NextResponse } from 'next/server';
import { clearSessionCookie, getSession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await getSession();
  await clearSessionCookie();
  // 店舗アカウントはその店舗専用のログイン画面へ、本部は共通のログイン画面へ
  const to = session && session.role === 'store' ? `/admin/login/${encodeURIComponent(session.code)}` : '/admin/login';
  return NextResponse.redirect(new URL(to, req.url), { status: 303 });
}
