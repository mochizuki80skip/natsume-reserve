'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface StoreForm { name: string; phone: string; beds: number; defaultActiveBeds: number; publishDaysAhead: number; notifyPhone: string; hoursOverride: string }
interface Props { store: StoreForm; globalHours: string; canChangePassword: boolean }

export default function StoreSettingsForm({ store, globalHours, canChangePassword }: Props) {
  const router = useRouter();
  const [f, setF] = useState(store);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    let hoursOverride: unknown = null;
    if (f.hoursOverride.trim()) {
      try { hoursOverride = JSON.parse(f.hoursOverride); } catch { setMsg('営業時間の個別設定が JSON として正しくありません'); return; }
    }
    const r = await fetch('/api/admin/store', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, hoursOverride }) });
    const j = await r.json();
    setMsg(r.ok ? '保存しました' : j.error ?? '保存に失敗しました');
    if (r.ok) router.refresh();
  }
  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/admin/store', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pw) });
    const j = await r.json();
    setMsg(r.ok ? 'パスワードを変更しました' : j.error ?? '変更に失敗しました');
    if (r.ok) setPw({ current: '', next: '' });
  }

  const num = (k: keyof StoreForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  const str = (k: keyof StoreForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="space-y-6">
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <form onSubmit={save} className="space-y-3 rounded border bg-white p-4">
        <label className="block text-sm">店舗名<input value={f.name} onChange={str('name')} required className="mt-1 w-full rounded border px-2 py-1" /></label>
        <label className="block text-sm">電話番号（顧客サイトの電話マーク・SMSに表示）<input value={f.phone} onChange={str('phone')} required className="mt-1 w-full rounded border px-2 py-1" /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">ベッド数（列数）<input type="number" min={1} max={20} value={f.beds} onChange={num('beds')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="block text-sm">既定の稼働台数<input type="number" min={0} max={20} value={f.defaultActiveBeds} onChange={num('defaultActiveBeds')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="block text-sm">公開する日数（今日から）<input type="number" min={0} max={365} value={f.publishDaysAhead} onChange={num('publishDaysAhead')} className="mt-1 w-full rounded border px-2 py-1" /></label>
        </div>
        <label className="block text-sm">WEB予約が入ったとき店舗へSMS通知する番号（任意）<input value={f.notifyPhone} onChange={str('notifyPhone')} className="mt-1 w-full rounded border px-2 py-1" placeholder="09012345678" /></label>
        <label className="block text-sm">営業時間の個別設定（空欄＝全店共通設定を使う）
          <textarea value={f.hoursOverride} onChange={str('hoursOverride')} rows={8} className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs" placeholder={globalHours} />
        </label>
        <details className="text-xs text-slate-500"><summary>全店共通の営業時間（参考）</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2">{globalHours}</pre></details>
        <button type="submit" className="rounded bg-brand px-4 py-2 font-bold text-white">保存</button>
      </form>
      {canChangePassword && (
        <form onSubmit={changePw} className="space-y-3 rounded border bg-white p-4">
          <h2 className="font-bold">パスワード変更</h2>
          <label className="block text-sm">現在のパスワード<input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="block text-sm">新しいパスワード（8文字以上）<input type="password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required className="mt-1 w-full rounded border px-2 py-1" /></label>
          <button type="submit" className="rounded border px-4 py-2">変更</button>
        </form>
      )}
    </div>
  );
}
