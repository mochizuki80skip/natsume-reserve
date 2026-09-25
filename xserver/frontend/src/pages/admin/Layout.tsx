// 管理画面の共通枠（ヘッダー・店舗切替・メニュー）。未ログインならログイン画面へ
import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import type { Me } from '@/lib/types';

export interface AdminContext { me: Me; refreshMe: () => void }

export function useAdmin(): AdminContext {
  return useOutletContext<AdminContext>();
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: me, error, loading, reload } = useFetch<Me>('/api/admin/me');
  useEffect(() => {
    if (error && error.status === 401) navigate('/admin/login', { replace: true });
  }, [error, navigate]);
  if (loading && !me) return <div className="p-4 text-sm text-slate-500">読み込み中…</div>;
  if (!me) return <div className="p-4 text-sm text-red-700">{error?.status === 401 ? 'ログインしてください' : error?.message ?? '読み込みに失敗しました'}</div>;
  const store = me.store;
  const today = me.today;
  return (
    <div className="min-h-screen">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link to={`/admin/day/${today}`} className="font-bold text-brand-dark">{store ? store.name : '店舗未選択'}</Link>
          {me.session.role === 'hq' && (
            <form action="/api/admin/switch" method="post" className="flex items-center gap-1 text-sm">
              <input type="hidden" name="back" value={location.pathname + location.search} />
              <select name="store" defaultValue={store?.code ?? ''} className="rounded border px-2 py-1">
                {me.stores.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}{s.active ? '' : '（停止）'}</option>)}
              </select>
              <button type="submit" className="rounded border px-2 py-1">切替</button>
            </form>
          )}
          <nav className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <Link to={`/admin/day/${today}`} className="hover:underline">予約表</Link>
            <Link to="/admin/calendar" className="hover:underline">カレンダー</Link>
            <Link to="/admin/shifts" className="hover:underline">シフト</Link>
            <Link to="/admin/reservations" className="hover:underline">予約・来院ログ</Link>
            <Link to="/admin/settings" className="hover:underline">店舗設定</Link>
            {me.session.role === 'hq' && <Link to="/admin/hq/overview" className="hover:underline">全店状況</Link>}
            {me.session.role === 'hq' && <Link to="/admin/hq" className="hover:underline">本部</Link>}
            {store && <a href={`/s/${store.code}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">顧客ページ↗</a>}
            <form action="/api/admin/logout" method="post"><button className="text-slate-500 hover:underline">ログアウト（{me.session.code}）</button></form>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-4">
        <Outlet context={{ me, refreshMe: reload } satisfies AdminContext} />
      </div>
    </div>
  );
}
