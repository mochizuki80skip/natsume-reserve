import { useState } from 'react';

export default function LoginForm({ fixedCode }: { fixedCode?: string } = {}) {
  const [code, setCode] = useState(fixedCode ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, password }) });
    setBusy(false);
    if (!r.ok) { setError((await r.json()).error ?? 'ログインに失敗しました'); return; }
    window.location.href = '/admin'; // 全体を読み直してログイン状態を反映
  }

  return (
    <form onSubmit={submit} className="rounded-lg border bg-white p-5">
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {fixedCode ? (
        <p className="mb-3 text-sm text-slate-600">店舗コード：<span className="font-mono font-bold">{fixedCode}</span></p>
      ) : (
        <label className="mb-3 block text-sm">店舗コード
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="username" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
      )}
      <label className="mb-4 block text-sm">パスワード
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <button type="submit" disabled={busy} className="w-full rounded bg-brand px-4 py-2 font-bold text-white disabled:opacity-50">ログイン</button>
      {fixedCode && <p className="mt-3 text-center text-xs text-slate-400"><a href="/admin/login" className="underline">本部・他店舗のログインはこちら</a></p>}
    </form>
  );
}
