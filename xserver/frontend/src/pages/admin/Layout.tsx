// 管理画面の共通枠（ヘッダー・店舗切替・メニュー）。未ログインならログイン画面へ
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { goLogin, useFetch } from '@/lib/api';
import type { Me } from '@/lib/types';
import WebNotifier from '@/components/WebNotifier';
import { UpdateBanner, WhatsNew } from '@/components/UpdateNotice';
import { APP_VERSION } from '@/version';

export interface AdminContext { me: Me; refreshMe: () => void }

export function useAdmin(): AdminContext {
  return useOutletContext<AdminContext>();
}

/** ヘッダーの「▾」で開くメニュー（項目を押すか、外を押すと閉じる） */
function DropMenu({ label, plain, children }: { label: string; plain?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary className={`cursor-pointer list-none rounded border px-2 py-0.5 ${plain ? 'text-slate-600 hover:bg-slate-50' : 'border-brand font-bold text-brand-dark hover:bg-brand-light'}`}>{label} ▾</summary>
      <div onClick={() => { if (ref.current) ref.current.open = false; }} className="absolute right-0 z-50 mt-1 flex min-w-[12rem] flex-col rounded border bg-white py-1 shadow-lg [&>a]:px-3 [&>a]:py-1.5 [&>a:hover]:bg-brand-light">
        {children}
      </div>
    </details>
  );
}

export default function AdminLayout() {
  const location = useLocation();
  // 表の幅が広い画面（新患継続率・本部の集計）は横幅いっぱいに使う
  const wide = /^\/admin\/(karte|hq\/karte|madoguchi|acct)/.test(location.pathname);
  const { data: me, error, loading, reload } = useFetch<Me>('/api/admin/me');
  useEffect(() => {
    if (error && error.status === 401) goLogin();
  }, [error]);
  if (loading && !me) return <div className="p-4 text-sm text-slate-500">読み込み中…</div>;
  if (!me) return <div className="p-4 text-sm text-red-700">{error?.status === 401 ? 'ログインしてください' : error?.message ?? '読み込みに失敗しました'}</div>;
  const store = me.store;
  const today = me.today;
  // 自賠請求だけに使う店舗では、予約表などの画面は開かず自賠請求へ（本部のページはそのまま）
  if (store?.jibaiOnly && me.session.role !== 'acct' && !/^\/admin\/(jibai|hq|updates|guide)/.test(location.pathname)) return <Navigate to="/admin/jibai" replace />;
  // 経理アカウント：窓口集計・自賠集計だけ（予約表などの店舗の画面は開かない）
  const acct = me.session.role === 'acct';
  if (acct && !/^\/admin\/(acct|madoguchi|hq\/jibai|updates|guide)/.test(location.pathname)) return <Navigate to="/admin/acct" replace />;
  return (
    <div className="min-h-screen">
      <UpdateBanner role={me.session.role} />
      <WhatsNew role={me.session.role} />
      <header className="no-print border-b bg-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap px-3 py-1.5">
          <Link to={`/admin/day/${today}`} className="font-bold text-brand-dark">{me.session.role === 'hq' || acct ? 'なつめ接骨院グループ' : store ? store.name : '店舗未選択'}</Link>
          {me.session.role === 'mg' && <span className="rounded bg-brand-light px-2 text-xs text-brand-dark">管轄MG（{me.session.area}）</span>}
          {acct && <span className="rounded bg-brand-light px-2 text-xs text-brand-dark">経理</span>}
          {(me.session.role === 'hq' || me.session.role === 'mg') && (
            <form action="/api/admin/switch" method="post" className="flex items-center gap-1 text-sm">
              <input type="hidden" name="back" value={location.pathname + location.search} />
              <select name="store" defaultValue={store?.code ?? ''} className="rounded border px-2 py-1">
                {/* 本部専用 → エリアごと（本部の店舗一覧の並び順） */}
                {[...new Map(me.stores.map((s) => [s.jibaiOnly ? '自賠請求のみ' : s.hqOnly ? '本部専用' : s.area || 'エリア未設定', 0])).keys()].map((g) => (
                  <optgroup key={g} label={g}>
                    {me.stores.filter((s) => (s.jibaiOnly ? '自賠請求のみ' : s.hqOnly ? '本部専用' : s.area || 'エリア未設定') === g).map((s) => <option key={s.code} value={s.code}>{s.name}{s.active ? '' : '（停止）'}</option>)}
                  </optgroup>
                ))}
              </select>
              <button type="submit" className="rounded border px-2 py-1">切替</button>
            </form>
          )}
          <nav className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            {acct ? (<>
              <Link to="/admin/acct" className="hover:underline">窓口集計（全店）</Link>
              <Link to="/admin/hq/jibai" className="hover:underline">自賠集計</Link>
            </>) : store?.jibaiOnly ? (
              // 自賠請求だけに使う店舗：メニューは自賠請求だけ
              <Link to="/admin/jibai" className="hover:underline">自賠請求</Link>
            ) : (<>
              <Link to={`/admin/day/${today}`} className="hover:underline">予約表</Link>
              <Link to="/admin/shifts" className="hover:underline">シフト</Link>
              <Link to="/admin/reservations" className="hover:underline">予約・来院ログ</Link>
              <Link to="/admin/karte" className="hover:underline">新患継続率</Link>
              {me.session.role !== 'hq' && <Link to="/admin/karte/summary" className="hover:underline">新患・再来集計</Link>}
              <Link to="/admin/staff-counts" className="hover:underline">担当数</Link>
              <Link to="/admin/jibai" className="hover:underline">自賠請求</Link>
              <Link to="/admin/madoguchi" className="hover:underline">窓口集計</Link>
              <Link to="/admin/settings" className="hover:underline">店舗設定</Link>
              {me.session.role === 'mg' && <Link to="/admin/acct" className="hover:underline">エリアの窓口集計</Link>}
            </>)}
            {me.session.role === 'hq' && (
              <DropMenu label="本部メニュー">
                <Link to="/admin/hq/overview">全店状況</Link>
                <Link to="/admin/hq/karte">新患・再来集計（全店）</Link>
                <Link to="/admin/hq/jibai">自賠集計</Link>
                <Link to="/admin/acct">窓口集計（全店）</Link>
                <Link to="/admin/hq">本部（店舗・設定）</Link>
                <Link to="/admin/hq/accounts">アカウント</Link>
              </DropMenu>
            )}
            {/* 使い方：開いていた画面の記事を上に出す */}
            <Link to={location.pathname.startsWith('/admin/guide') ? location.pathname + location.search : `/admin/guide?from=${encodeURIComponent(location.pathname + location.search)}`} className="hover:underline">使い方</Link>
            <DropMenu label="その他" plain>
              {!store?.jibaiOnly && !acct && <Link to="/admin/story">ストーリー画像</Link>}
              <Link to="/admin/updates">更新のお知らせ</Link>
              {store && !store.jibaiOnly && !acct && <a href={`/s/${store.code}`} target="_blank" rel="noreferrer">顧客ページ↗</a>}
              <form action="/api/admin/logout" method="post" className="mt-1 border-t pt-1"><button className="w-full px-3 py-1.5 text-left hover:bg-brand-light">ログアウト{me.session.name ? `（${me.session.name}）` : ''}</button></form>
            </DropMenu>
          </nav>
        </div>
      </header>
      {store && <WebNotifier key={store.id} />}
      <main className={`mx-auto ${wide ? 'max-w-none px-4 py-3' : 'max-w-6xl px-4 py-4'}`}>
        <Outlet context={{ me, refreshMe: reload } satisfies AdminContext} />
        <p className="no-print mt-6 text-right text-[10px] text-slate-400">画面の版 {APP_VERSION}</p>
      </main>
    </div>
  );
}
