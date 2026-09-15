import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'bk_session';
const MAX_AGE_SEC = 12 * 60 * 60;

export interface Session {
  accountId: string;
  role: 'store' | 'hq';
  storeId: string | null;
  code: string;
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET is not set (16 文字以上の乱数を設定してください)');
  return new TextEncoder().encode(s);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.accountId !== 'string' || (payload.role !== 'store' && payload.role !== 'hq')) return null;
    return {
      accountId: payload.accountId,
      role: payload.role,
      storeId: typeof payload.storeId === 'string' ? payload.storeId : null,
      code: String(payload.code ?? ''),
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function setSessionCookie(s: Session): Promise<void> {
  const token = await signSession(s);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
}
