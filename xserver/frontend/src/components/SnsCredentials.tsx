// 店舗ごとの SNS のログイン情報（本部だけ）。パスワードはサーバーで暗号化して保存し、「表示」を押したときだけ取り出す
import { useEffect, useState } from 'react';
import { useFetch } from '@/lib/api';
import { copyText, sendJson, type Channel } from '@/lib/sns';

export interface Credential { channel: Channel; loginId: string; hasPassword: boolean; email: string; phone: string; note: string; updatedAt: string | null; updatedBy: string | null; revealedAt: string | null; revealedBy: string | null }
interface Resp { store: { code: string; name: string }; credentials: Record<Channel, Credential> }

const LABEL: Record<Channel, { title: string; id: string; idPh: string; color: string }> = {
  ig: { title: 'Instagram のログイン情報', id: 'ユーザーネーム（ログインID）', idPh: 'natsume_honten', color: 'border-pink-200' },
  gbp: { title: 'Google（ビジネスプロフィールのオーナー）のログイン情報', id: 'Google アカウント（メールアドレス）', idPh: 'natsume.honten@gmail.com', color: 'border-emerald-200' },
};

export default function SnsCredentials({ storeQ }: { storeQ: string }) {
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/credentials?${storeQ}`);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  return (
    <section className="space-y-3 rounded border bg-white p-4 text-sm">
      <div>
        <h2 className="font-bold">ログイン情報（本部だけが見られます）</h2>
        <p className="mt-1 text-xs text-slate-500">パスワードは暗号化して保存し、「表示」を押したときだけ見えます（誰がいつ表示したかを記録）。2 段階認証のコードの受け取り先（電話・メール）もメモしておくと、担当者が変わっても困りません。</p>
      </div>
      {(['ig', 'gbp'] as const).map((ch) => <CredCard key={`${ch}:${data.credentials[ch].updatedAt}`} storeQ={storeQ} c={data.credentials[ch]} onSaved={reload} />)}
    </section>
  );
}

function CredCard({ storeQ, c, onSaved }: { storeQ: string; c: Credential; onSaved: () => void }) {
  const L = LABEL[c.channel];
  const [f, setF] = useState({ loginId: c.loginId, email: c.email, phone: c.phone, note: c.note, password: '' });
  const [shown, setShown] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [editPw, setEditPw] = useState(!c.hasPassword);
  useEffect(() => { if (shown === null) return; const t = setTimeout(() => setShown(null), 30000); return () => clearTimeout(t); }, [shown]);
  const dirty = f.loginId !== c.loginId || f.email !== c.email || f.phone !== c.phone || f.note !== c.note || f.password !== '';

  async function save(clearPassword = false) {
    setMsg('');
    try {
      await sendJson(`/api/admin/sns/credentials?${storeQ}`, 'PUT', { channel: c.channel, loginId: f.loginId, email: f.email, phone: f.phone, note: f.note, password: f.password, clearPassword });
      setMsg('保存しました'); setShown(null); onSaved();
    } catch (e) { setMsg((e as Error).message); }
  }
  async function reveal(copy: boolean) {
    setMsg('');
    try {
      const r = await sendJson<{ password: string }>(`/api/admin/sns/credentials/reveal?${storeQ}`, 'POST', { channel: c.channel });
      if (copy) { await copyText(r.password); setMsg('パスワードをコピーしました'); } else setShown(r.password);
    } catch (e) { setMsg((e as Error).message); }
  }
  const inp = (k: 'loginId' | 'email' | 'phone') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className={`rounded border-2 ${L.color} p-3`}>
      <div className="mb-2 font-bold">{L.title}</div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="block">{L.id}
          <div className="mt-1 flex gap-1"><input value={f.loginId} onChange={inp('loginId')} placeholder={L.idPh} autoComplete="off" className="w-full rounded border px-2 py-1" />
            {c.loginId && <button type="button" onClick={async () => { await copyText(c.loginId); setMsg('ID をコピーしました'); }} className="whitespace-nowrap rounded border px-2 text-xs">コピー</button>}</div>
        </label>
        <div>パスワード
          {c.hasPassword && !editPw ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <code className="min-w-32 rounded bg-slate-100 px-2 py-1">{shown ?? '••••••••'}</code>
              <button type="button" onClick={() => (shown ? setShown(null) : reveal(false))} className="rounded border px-2 py-0.5 text-xs">{shown ? '隠す' : '表示'}</button>
              <button type="button" onClick={() => reveal(true)} className="rounded border px-2 py-0.5 text-xs">コピー</button>
              <button type="button" onClick={() => setEditPw(true)} className="rounded border px-2 py-0.5 text-xs">変更</button>
            </div>
          ) : (
            <div className="mt-1 flex gap-1">
              <input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={c.hasPassword ? '新しいパスワード' : 'パスワード'} autoComplete="off" spellCheck={false} className="w-full rounded border px-2 py-1 font-mono" />
              {c.hasPassword && <button type="button" onClick={() => { setEditPw(false); setF({ ...f, password: '' }); }} className="whitespace-nowrap rounded border px-2 text-xs">やめる</button>}
            </div>
          )}
        </div>
        <label className="block">登録メールアドレス<input value={f.email} onChange={inp('email')} autoComplete="off" className="mt-1 w-full rounded border px-2 py-1" /></label>
        <label className="block">登録電話番号（2 段階認証の受け取り先など）<input value={f.phone} onChange={inp('phone')} autoComplete="off" className="mt-1 w-full rounded border px-2 py-1" /></label>
        <label className="block md:col-span-2">メモ（ログインしている端末、管理者、ビジネスアカウントの種類など）<textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} className="mt-1 w-full rounded border px-2 py-1" /></label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!dirty} onClick={() => save(false)} className="rounded bg-brand px-4 py-1 text-white disabled:opacity-40">保存</button>
        {c.hasPassword && <button type="button" onClick={() => confirm('保存しているパスワードを消しますか？') && save(true)} className="rounded border px-3 py-1 text-xs text-red-700">パスワードを消す</button>}
        {msg && <span className="text-xs text-brand-dark">{msg}</span>}
        <span className="ml-auto text-xs text-slate-400">{c.updatedAt && `更新 ${c.updatedAt.slice(0, 16)}${c.updatedBy ? `（${c.updatedBy}）` : ''}`}{c.revealedAt && `・最終表示 ${c.revealedAt.slice(0, 16)}${c.revealedBy ? `（${c.revealedBy}）` : ''}`}</span>
      </div>
    </div>
  );
}
