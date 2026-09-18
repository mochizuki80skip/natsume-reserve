// 管理画面の共通処理（セッション取得と対象店舗の解決）
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Store } from '@prisma/client';
import { getSession, type Session } from './auth';
import { prisma } from './prisma';

export const STORE_COOKIE = 'bk_store'; // 本部アカウントが表示中の店舗コード

/** レイアウトとページの両方から呼ばれるため、同一リクエスト内では 1 回だけ検証する */
const cachedSession = cache(getSession);

export async function requireSession(): Promise<Session> {
  const s = await cachedSession();
  if (!s) redirect('/admin/login');
  return s;
}

/** セッションから操作対象の店舗を返す。本部は Cookie（店舗切替）で選んだ店舗、無ければ先頭。同一リクエスト内は 1 回だけ読む */
export const resolveStore = cache(async (session: Session): Promise<Store | null> => {
  if (session.role === 'store') {
    return session.storeId ? prisma.store.findUnique({ where: { id: session.storeId } }) : null;
  }
  const code = (await cookies()).get(STORE_COOKIE)?.value;
  if (code) {
    const s = await prisma.store.findUnique({ where: { code } });
    if (s) return s;
  }
  return prisma.store.findFirst({ where: { active: true }, orderBy: { code: 'asc' } });
});

/** API 用：セッション＋店舗を返す。無ければ null */
export async function apiContext(): Promise<{ session: Session; store: Store } | null> {
  const session = await cachedSession();
  if (!session) return null;
  const store = await resolveStore(session);
  if (!store) return null;
  return { session, store };
}
