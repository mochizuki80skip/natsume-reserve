// SNS 投稿管理の共通枠：左にメニュー（ホーム／店舗の下書き／全体：手動投稿・カレンダー・投稿一覧・定型投稿・画像・分析・設定・接続状況）、右に内容
import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useAdmin } from '@/pages/admin/Layout';
import { SNS_ONLY } from '@/lib/mode';
import { StoreDot } from '@/lib/storeColor';
import { useFetch } from '@/lib/api';

export interface HomeStatus { pending: number; approved: number; failed: number; ig: { enabled: number; connected: number }; google: 'manual' | 'ok' | 'nolocation' | 'none'; googleMapped: number; line: 'ok' | 'mail' | 'none' }
interface HomeResp { status: HomeStatus; manual: { id: string }[]; byStore: { code: string; name: string; ig: Record<string, number>; gbp: Record<string, number> }[] }

export default function SnsShell() {
  const ctx = useAdmin();
  const { me } = ctx;
  const { pathname } = useLocation();
  const [sp] = useSearchParams();
  const isHq = me.session.role === 'hq';
  const { data } = useFetch<HomeResp>('/api/admin/sns/home');
  const storeParam = sp.get('store');
  const st = data?.status;
  const item = (to: string, label: string, badge?: number, exact = false) => {
    const active = exact ? pathname === to : pathname.startsWith(to) && !(to === '/admin/sns/posts' && storeParam);
    return (
      <Link key={to} to={to} className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${active ? 'bg-brand-light font-bold text-brand-dark' : 'text-slate-700 hover:bg-slate-100'}`}>
        <span>{label}</span>
        {badge ? <span className={`rounded-full px-2 text-xs ${active ? 'bg-brand text-white' : 'bg-amber-100 text-amber-800'}`}>{badge}</span> : null}
      </Link>
    );
  };
  const stores = isHq ? me.stores.filter((s) => s.active) : me.store ? [{ code: me.store.code, name: me.store.name, active: true }] : [];
  const draftCount = (code: string) => { const r = data?.byStore.find((b) => b.code === code); return r ? (r.ig.draft ?? 0) + (r.gbp.draft ?? 0) : 0; };
  const dot = (ok: boolean | null, label: string, text?: string) => (
    <div className="flex items-center gap-2 text-xs"><span className={`inline-block h-2.5 w-2.5 rounded-full ${ok === true ? 'bg-green-600' : ok === false ? 'bg-red-600' : 'bg-amber-500'}`} /><span className={ok === true ? 'text-green-800' : ok === false ? 'text-red-800' : 'text-amber-800'}>{label}{text ? ` ${text}` : ''}</span></div>
  );
  return (
    <div className="flex gap-5">
      <aside className={`w-60 shrink-0 ${SNS_ONLY ? '' : 'hidden md:block'}`}>
        <div className="sticky top-4 flex min-h-[80vh] flex-col rounded-lg border bg-white p-3">
          <div className="px-2 pb-3"><div className="text-lg font-bold">SNS投稿</div><div className="text-xs text-slate-500">管理画面</div></div>
          <nav className="space-y-0.5">{item('/admin/sns', 'ホーム', st?.pending, true)}</nav>
          <div className="mt-3 px-3 text-xs text-slate-500">店舗の下書き</div>
          <nav className="mt-1 max-h-72 space-y-0.5 overflow-auto">
            {stores.map((s) => {
              const active = pathname.startsWith('/admin/sns/posts') && storeParam === s.code;
              const n = draftCount(s.code);
              return (
                <Link key={s.code} to={`/admin/sns/posts?store=${encodeURIComponent(s.code)}`} className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${active ? 'bg-brand-light font-bold text-brand-dark' : 'text-slate-700 hover:bg-slate-100'}`}>
                  <StoreDot code={s.code} /><span className="truncate">{s.name}</span>{n > 0 && <span className="ml-auto rounded-full bg-amber-100 px-2 text-xs text-amber-800">{n}</span>}
                </Link>
              );
            })}
            {stores.length === 0 && <p className="px-3 text-xs text-slate-400">店舗がありません</p>}
          </nav>
          <div className="mt-3 px-3 text-xs text-slate-500">全体</div>
          <nav className="mt-1 space-y-0.5">
            {item('/admin/sns/manual', '手動投稿', data?.manual.length)}
            {item('/admin/sns/calendar', 'カレンダー')}
            {item('/admin/sns/posts', '投稿一覧')}
            {item('/admin/sns/topics', '定型投稿・ネタ')}
            {item('/admin/sns/media', '画像')}
            {item('/admin/sns/insights', '分析')}
            {isHq ? item('/admin/sns/schedule', '設定') : item('/admin/sns/settings', '設定')}
            {isHq && item('/admin/hq/sns', '接続状況')}
          </nav>
          {st && (
            <div className="mt-auto space-y-1 border-t px-2 pt-3">
              {dot(st.line === 'ok' ? true : st.line === 'mail' ? null : false, 'LINE', st.line === 'ok' ? 'OK' : st.line === 'mail' ? 'メール' : '未設定')}
              {dot(st.ig.enabled === 0 ? null : st.ig.connected >= st.ig.enabled ? true : st.ig.connected > 0 ? null : false, 'Instagram', st.ig.enabled ? `${st.ig.connected}/${st.ig.enabled}` : '未使用')}
              {dot(st.google === 'manual' ? null : st.google === 'ok' ? true : false, 'Google', st.google === 'manual' ? '手動' : st.google === 'ok' ? 'OK' : st.google === 'nolocation' ? '拠点未割当' : '承認待ち')}
            </div>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
