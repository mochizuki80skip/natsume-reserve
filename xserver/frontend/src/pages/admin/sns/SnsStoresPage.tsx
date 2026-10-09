// 店舗管理（本部・SNS 投稿管理）：店舗ごとの SNS の設定状況（地域・投稿の有無・Instagram 連携・Google の投稿ページ・差し込み語）を一覧し、
// 「SNS設定」から各店舗の詳しい設定を開く。店舗の追加・名前の変更・パスワード再設定・停止・削除もここで行う
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { describeSchedule, type Schedule, type StoreSetting } from '@/lib/sns';
import { StoreDot } from '@/lib/storeColor';
import SnsNav from '@/components/SnsNav';
import { BulkStoreImport } from '@/components/HqClient';
import { useAdmin } from '../Layout';

interface Row {
  code: string; name: string; phone: string; active: boolean; setting: StoreSetting; draftCount: number;
  ig: { connected: boolean; username: string; error: string | null }; varsMissing: string[];
}
interface Resp { stores: Row[]; defaults: { igSchedule: Schedule; gbpSchedule: Schedule }; gbpManual: boolean }

const ok = 'inline-block whitespace-nowrap rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-800';
const warn = 'inline-block whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800';
const off = 'inline-block whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500';

export default function SnsStoresPage() {
  const { me, refreshMe } = useAdmin();
  const isHq = me.session.role === 'hq';
  const { data, error, reload } = useFetch<Resp>(isHq ? '/api/admin/hq/sns/stores?all=1' : null);
  const [msg, setMsg] = useState('');
  const [ns, setNs] = useState({ code: '', name: '', phone: '', password: '' });
  const [edit, setEdit] = useState<{ code: string; newCode: string; name: string; phone: string } | null>(null);
  if (!isHq) return <Navigate to="/admin/sns/settings" replace />;
  if (error) return <div><SnsNav title="店舗管理" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="店舗管理" /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const refresh = () => { reload(); refreshMe(); };

  async function call(method: string, url: string, body: unknown): Promise<boolean> {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { setMsg((await r.json().catch(() => ({}))).error ?? '失敗しました'); return false; }
    return true;
  }
  async function addStore(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    if (await call('POST', '/api/admin/hq/stores', ns)) { setMsg(`店舗 ${ns.code} を追加しました。「SNS設定」から地域や投稿の有無を設定してください`); setNs({ code: '', name: '', phone: '', password: '' }); refresh(); }
  }
  async function storeAction(code: string, name: string, action: 'reset' | 'toggle' | 'delete') {
    setMsg('');
    let password: string | null = null;
    if (action === 'reset') { password = prompt(`${name}（${code}）の新しいパスワード（8文字以上）`); if (!password) return; }
    if (action === 'delete' && !confirm(`${name}（${code}）を削除します。この店舗の SNS の設定・下書き・投稿の記録もすべて消えます。よろしいですか？`)) return;
    if (await call('PUT', '/api/admin/hq/stores', { code, action, password })) { setMsg(action === 'reset' ? 'パスワードを変更しました' : action === 'delete' ? '削除しました' : '更新しました'); refresh(); }
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (await call('PUT', '/api/admin/hq/stores', { code: edit.code, action: 'update', newCode: edit.newCode, name: edit.name, phone: edit.phone })) { setMsg('店舗情報を更新しました'); setEdit(null); refresh(); }
  }
  function copyLogin(code: string) {
    const url = `${window.location.origin}/admin/login/${code}`;
    navigator.clipboard?.writeText(url).then(() => setMsg(`ログインURLをコピーしました：${url}`), () => setMsg(url));
  }

  const active = data.stores.filter((s) => s.active);
  const todo = active.filter((s) => !s.setting.area || (!s.setting.igEnabled && !s.setting.gbpEnabled) || s.varsMissing.length > 0 || (s.setting.gbpEnabled && data.gbpManual && !s.setting.gbpPostUrl));

  return (
    <div className="space-y-4">
      <SnsNav title="店舗管理" />
      <p className="-mt-2 text-sm text-slate-600">店舗ごとの SNS の設定状況です。「SNS設定」を押すと、その店舗の地域・差し込み語・投稿の有無と頻度・Google の投稿ページ・Instagram の連携を設定できます。</p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      {todo.length > 0 && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">設定が終わっていない店舗が {todo.length} 店舗あります（黄色の項目）。</p>}

      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">店舗</th><th className="px-2">地域</th><th className="px-2">Instagram</th><th className="px-2">Google</th><th className="px-2">差し込み語</th><th className="px-2">確認待ち</th><th className="px-2"></th></tr>
          </thead>
          <tbody>
            {data.stores.map((st) => {
              const s = st.setting;
              if (edit && edit.code === st.code) return (
                <tr key={st.code} className="border-t bg-yellow-50">
                  <td colSpan={7} className="px-3 py-2">
                    <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                      <input value={edit.newCode} onChange={(e) => setEdit({ ...edit, newCode: e.target.value })} placeholder="店舗コード" required className="w-28 rounded border px-2 py-1 font-mono" />
                      <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="店舗名" required className="w-56 rounded border px-2 py-1" />
                      <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="電話番号" required className="w-40 rounded border px-2 py-1" />
                      <button type="submit" className="rounded bg-brand px-3 py-1 text-white">保存</button>
                      <button type="button" onClick={() => setEdit(null)} className="rounded border px-3 py-1">やめる</button>
                      <span className="text-xs text-slate-500">店舗コードを変えるとログインURLも変わります。店舗名は投稿文の {'{店舗名}'} に入ります</span>
                    </form>
                  </td>
                </tr>
              );
              return (
                <tr key={st.code} className={`border-t align-top ${st.active ? '' : 'bg-slate-50 text-slate-400'}`}>
                  <td className="min-w-[200px] px-3 py-2">
                    <div className="flex items-center gap-2"><StoreDot code={st.code} /><span className="font-bold">{st.name}</span></div>
                    <div className="mt-0.5 whitespace-nowrap text-xs text-slate-400"><span className="font-mono">{st.code}</span>・{st.phone}{!st.active && <span className="ml-1 rounded bg-slate-200 px-1 text-slate-600">停止中</span>}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">{s.area ? s.area : <span className={warn}>未入力</span>}</td>
                  <td className="px-2 py-2">
                    {s.igEnabled ? <span className={ok}>投稿する</span> : <span className={off}>投稿しない</span>}
                    {s.igEnabled && <div className="mt-1 text-xs text-slate-500">{describeSchedule(s.effectiveIgSchedule)}</div>}
                    {s.igEnabled && <div className="mt-1">{st.ig.connected ? <span className={st.ig.error ? warn : ok}>{st.ig.error ? '要再連携' : `連携中 @${st.ig.username}`}</span> : <span className={off}>未連携（手動投稿）</span>}</div>}
                  </td>
                  <td className="px-2 py-2">
                    {s.gbpEnabled ? <span className={ok}>投稿する</span> : <span className={off}>投稿しない</span>}
                    {s.gbpEnabled && <div className="mt-1 text-xs text-slate-500">{describeSchedule(s.effectiveGbpSchedule)}</div>}
                    {s.gbpEnabled && data.gbpManual && <div className="mt-1">{s.gbpPostUrl ? <span className={ok}>投稿ページ登録済み</span> : <span className={warn}>投稿ページ未登録</span>}</div>}
                  </td>
                  <td className="px-2 py-2">{st.varsMissing.length === 0 ? <span className={ok}>OK</span> : <span className={warn} title={st.varsMissing.join('、')}>未入力 {st.varsMissing.length}</span>}</td>
                  <td className="px-2 py-2">{st.draftCount > 0 ? <Link to={`/admin/sns/posts?store=${encodeURIComponent(st.code)}`} className="text-brand underline">{st.draftCount} 件</Link> : <span className="text-slate-400">0</span>}</td>
                  <td className="w-[250px] px-2 py-2 text-right">
                    <Link to={`/admin/sns/settings?store=${encodeURIComponent(st.code)}`} className="inline-block rounded bg-brand px-3 py-1 text-white">SNS設定</Link>
                    <div className="mt-1 flex flex-wrap justify-end gap-1 text-xs">
                      <button type="button" onClick={() => copyLogin(st.code)} className="rounded border px-2 py-0.5">ログインURL</button>
                      <button type="button" onClick={() => setEdit({ code: st.code, newCode: st.code, name: st.name, phone: st.phone })} className="rounded border px-2 py-0.5">名前・電話</button>
                      <button type="button" onClick={() => storeAction(st.code, st.name, 'reset')} className="rounded border px-2 py-0.5">PW再設定</button>
                      <button type="button" onClick={() => storeAction(st.code, st.name, 'toggle')} className="rounded border px-2 py-0.5">{st.active ? '停止' : '再開'}</button>
                      <button type="button" onClick={() => storeAction(st.code, st.name, 'delete')} className="rounded border border-red-300 px-2 py-0.5 text-red-700">削除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {data.stores.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">店舗がありません。下から追加してください</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border bg-white p-4 text-sm">
        <h2 className="mb-1 font-bold">店舗を追加</h2>
        <p className="mb-2 text-xs text-slate-500">店舗コードは予約システムと同じにすると、投稿文の {'{予約URL}'} がその店舗の予約ページになります。パスワードは店舗のスタッフがログインに使います（8文字以上）。</p>
        <form onSubmit={addStore} className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <input placeholder="店舗コード (例: S003)" value={ns.code} onChange={(e) => setNs({ ...ns, code: e.target.value })} required className="rounded border px-2 py-1" />
          <input placeholder="店舗名" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} required className="rounded border px-2 py-1" />
          <input placeholder="電話番号" value={ns.phone} onChange={(e) => setNs({ ...ns, phone: e.target.value })} required className="rounded border px-2 py-1" />
          <input placeholder="初期パスワード" type="password" minLength={8} value={ns.password} onChange={(e) => setNs({ ...ns, password: e.target.value })} required className="rounded border px-2 py-1" />
          <button type="submit" className="rounded bg-brand px-3 py-1 text-white">店舗を追加</button>
        </form>
        <BulkStoreImport onDone={refresh} />
      </section>
    </div>
  );
}
