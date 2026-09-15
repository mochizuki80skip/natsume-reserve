'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, password }) });
    setBusy(false);
    if (!r.ok) { setError((await r.json()).error ?? 'ログインに失敗しました'); return; }
    router.push('/admin');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rounded-lg border bg-white p-5">
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <label className="mb-3 block text-sm">店舗コード
        <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="username" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="mb-4 block text-sm">パスワード
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <button type="submit" disabled={busy} className="w-full rounded bg-brand px-4 py-2 font-bold text-white disabled:opacity-50">ログイン</button>
    </form>
  );
}
