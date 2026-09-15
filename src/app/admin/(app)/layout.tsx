import Link from 'next/link';
import { requireSession, resolveStore } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { nowJst } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const store = await resolveStore(session);
  const stores = session.role === 'hq' ? await prisma.store.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true, active: true } }) : [];
  const today = nowJst().date;

  return (
    <div className="min-h-screen">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link href={`/admin/day/${today}`} className="font-bold text-brand-dark">{store ? store.name : '店舗未選択'}</Link>
          {session.role === 'hq' && (
            <form action="/api/admin/switch" method="post" className="flex items-center gap-1 text-sm">
              <select name="store" defaultValue={store?.code ?? ''} className="rounded border px-2 py-1">
                {stores.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}{s.active ? '' : '（停止）'}</option>)}
              </select>
              <button type="submit" className="rounded border px-2 py-1">切替</button>
            </form>
          )}
          <nav className="ml-auto flex items-center gap-3 text-sm">
            <Link href={`/admin/day/${today}`} className="hover:underline">予約表</Link>
            <Link href="/admin/calendar" className="hover:underline">カレンダー</Link>
            <Link href="/admin/settings" className="hover:underline">店舗設定</Link>
            {session.role === 'hq' && <Link href="/admin/hq" className="hover:underline">本部</Link>}
            {store && <a href={`/s/${store.code}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">顧客ページ↗</a>}
            <form action="/api/admin/logout" method="post"><button className="text-slate-500 hover:underline">ログアウト（{session.code}）</button></form>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-4">{children}</div>
    </div>
  );
}
