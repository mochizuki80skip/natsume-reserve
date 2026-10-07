// 本部アカウント（一人ずつ）の発行・停止 /admin/hq/accounts と操作の記録
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { useAdmin } from './Layout';

interface Account { id: string; code: string; name: string; active: boolean; canManage: boolean; lastLoginAt: string; owner: boolean }
interface Resp { accounts: Account[]; me: { id: string; canManage: boolean } }
interface AuditRow { at: string; actor: string; store: string; action: string; detail: string; ok: boolean }

async function send(method: string, body: object) {
  const r = await fetch('/api/admin/hq/accounts', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, error: (j as { error?: string }).error ?? '保存できませんでした' };
}

export default function AccountsPage() {
  const { me } = useAdmin();
  const { data, error, reload } = useFetch<Resp>('/api/admin/hq/accounts');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState({ code: '', name: '', password: '', canManage: false });
  if (me.session.role !== 'hq') return <p>本部アカウントでログインしてください。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const can = data.me.canManage;

  async function act(body: object, done: string) {
    const r = await send('PUT', body);
    setMsg({ ok: r.ok, text: r.ok ? done : r.error });
    if (r.ok) reload();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await send('POST', f);
    setMsg({ ok: r.ok, text: r.ok ? `「${f.name}」さんのアカウント（ID：${f.code}）を発行しました。ID とパスワードを本人に伝えてください。` : r.error });
    if (r.ok) { setF({ code: '', name: '', password: '', canManage: false }); reload(); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">本部アカウント</h1>
        <p className="text-sm text-slate-600">MG以上の本部メンバーは、一人ずつ自分のアカウントでログインします（ログイン画面で ID とパスワード）。できることは全員同じ（全店の閲覧・設定・集計）です。
          {can ? '「発行・停止の権限」がある人だけが、この画面でアカウントを発行・停止できます。' : 'アカウントの発行・停止は、権限がある人（HQ・部長クラスなど）に依頼してください。'}</p>
      </div>
      {msg && <p className={`rounded px-3 py-2 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-3 py-2 text-left">名前</th><th className="px-3 py-2 text-left">ID</th><th className="px-3 py-2 text-left">状態</th><th className="px-3 py-2 text-left">発行・停止の権限</th><th className="px-3 py-2 text-left">最終ログイン</th>{can && <th className="px-3 py-2 text-left">操作</th>}</tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.id} className={`border-t ${a.active ? '' : 'bg-slate-50 text-slate-400'}`}>
                <td className="px-3 py-2">
                  {can ? <input key={a.name} defaultValue={a.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== a.name && act({ id: a.id, name: e.target.value.trim() }, '名前を変更しました')} className="w-36 rounded border px-2 py-0.5" /> : a.name}
                  {a.id === data.me.id && <span className="ml-1 rounded bg-brand-light px-1 text-[10px] text-brand-dark">自分</span>}
                </td>
                <td className="px-3 py-2 font-mono">{a.code}{a.owner && <span className="ml-1 text-[10px] text-slate-500">（管理者）</span>}</td>
                <td className="px-3 py-2">{a.active ? <span className="text-green-700">利用中</span> : <span>停止中</span>}</td>
                <td className="px-3 py-2">
                  {can && !a.owner && a.id !== data.me.id
                    ? <label className="inline-flex cursor-pointer items-center gap-1"><input type="checkbox" checked={a.canManage} onChange={(e) => act({ id: a.id, canManage: e.target.checked }, e.target.checked ? '権限を付けました' : '権限を外しました')} />{a.canManage ? 'あり' : 'なし'}</label>
                    : a.canManage ? 'あり' : 'なし'}
                </td>
                <td className="px-3 py-2 text-xs">{a.lastLoginAt || '－'}</td>
                {can && (
                  <td className="whitespace-nowrap px-3 py-2">
                    <button type="button" onClick={() => { const pw = prompt(`${a.name}（${a.code}）の新しいパスワード（8文字以上）`); if (pw) act({ id: a.id, password: pw }, 'パスワードを再設定しました。本人に伝えてください。'); }} className="mr-1 rounded border px-2 py-0.5 text-xs">PW再設定</button>
                    {!a.owner && a.id !== data.me.id && (
                      <button type="button" onClick={() => (a.active ? confirm(`${a.name} さんのアカウントを停止しますか？（すぐにログインできなくなります）`) : true) && act({ id: a.id, active: !a.active }, a.active ? '停止しました' : '再開しました')}
                        className={`rounded border px-2 py-0.5 text-xs ${a.active ? 'border-red-300 text-red-700' : ''}`}>{a.active ? '停止' : '再開'}</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {can && (
        <form onSubmit={add} className="rounded-lg border bg-white p-3 text-sm">
          <h2 className="mb-2 font-bold">アカウントを発行</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">名前<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={30} placeholder="例）山田 MG" className="mt-0.5 block w-36 rounded border px-2 py-1 text-sm" /></label>
            <label className="text-xs">ID（英数字）<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required pattern="[A-Za-z0-9_\-]{2,20}" placeholder="例）yamada" className="mt-0.5 block w-32 rounded border px-2 py-1 font-mono text-sm" /></label>
            <label className="text-xs">初期パスワード（8文字以上）<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} className="mt-0.5 block w-40 rounded border px-2 py-1 text-sm" /></label>
            <label className="flex items-center gap-1 pb-1.5 text-xs"><input type="checkbox" checked={f.canManage} onChange={(e) => setF({ ...f, canManage: e.target.checked })} />発行・停止の権限を付ける</label>
            <button type="submit" className="rounded bg-brand px-4 py-1.5 font-bold text-white">発行</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">本人は、店舗設定の「パスワード変更」から自分のパスワードに変えられます。異動・退職のときは「停止」してください（記録は残ります）。</p>
        </form>
      )}

      {can && <Audit />}
    </div>
  );
}

function Audit() {
  const { data } = useFetch<{ rows: AuditRow[] }>('/api/admin/hq/audit');
  return (
    <div className="rounded-lg border bg-white p-3 text-sm">
      <h2 className="mb-1 font-bold">操作の記録（新しい順・300件まで）</h2>
      <p className="mb-2 text-xs text-slate-500">誰が・いつ・どの店舗で・何をしたかを記録しています。患者様の氏名などは記録しません。</p>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-2 py-1 text-left">日時</th><th className="px-2 py-1 text-left">操作した人</th><th className="px-2 py-1 text-left">店舗</th><th className="px-2 py-1 text-left">操作</th><th className="px-2 py-1 text-left">内容</th></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((r, i) => (
              <tr key={i} className="border-t">
                <td className="whitespace-nowrap px-2 py-1">{r.at}</td><td className="px-2 py-1">{r.actor}</td><td className="px-2 py-1 font-mono">{r.store}</td>
                <td className="px-2 py-1">{r.action}{!r.ok && <span className="ml-1 text-red-700">（失敗）</span>}</td><td className="px-2 py-1 text-slate-500">{r.detail}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-400">まだ記録はありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
