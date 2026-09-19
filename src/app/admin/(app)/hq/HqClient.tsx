'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface StoreRow { code: string; name: string; phone: string; beds: number; active: boolean }
interface SettingForm {
  slotMinutes: number; newVisitSlots: number; returnVisitSlots: number; webCutoffMinutes: number; phoneCutoffMinutes: number;
  phoneMarkRemaining: number; closeOnHolidays: boolean; adminExtraSlots: number; retentionDays: number; hours: string;
}

export default function HqClient({ stores, setting }: { stores: StoreRow[]; setting: SettingForm }) {
  const router = useRouter();
  const [s, setS] = useState(setting);
  const [ns, setNs] = useState({ code: '', name: '', phone: '', password: '' });
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<{ code: string; newCode: string; name: string; phone: string } | null>(null);

  async function saveSetting(e: React.FormEvent) {
    e.preventDefault();
    let hours: unknown;
    try { hours = JSON.parse(s.hours); } catch { setMsg('営業時間が JSON として正しくありません'); return; }
    const r = await fetch('/api/admin/hq/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, hours }) });
    setMsg(r.ok ? '共通設定を保存しました' : (await r.json()).error ?? '保存に失敗しました');
    router.refresh();
  }
  async function addStore(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/admin/hq/stores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ns) });
    setMsg(r.ok ? `店舗 ${ns.code} を追加しました` : (await r.json()).error ?? '追加に失敗しました');
    if (r.ok) { setNs({ code: '', name: '', phone: '', password: '' }); router.refresh(); }
  }
  async function storeAction(code: string, action: 'reset' | 'toggle' | 'delete') {
    let password: string | null = null;
    if (action === 'reset') { password = prompt(`${code} の新しいパスワード（8文字以上）`); if (!password) return; }
    if (action === 'delete' && !confirm(`店舗 ${code} を削除します。この店舗の予約表・予約データもすべて消えます。よろしいですか？`)) return;
    const r = await fetch('/api/admin/hq/stores', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, action, password }) });
    setMsg(r.ok ? '更新しました' : (await r.json()).error ?? '更新に失敗しました');
    router.refresh();
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const r = await fetch('/api/admin/hq/stores', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: edit.code, action: 'update', newCode: edit.newCode, name: edit.name, phone: edit.phone }) });
    setMsg(r.ok ? '店舗情報を更新しました' : (await r.json()).error ?? '更新に失敗しました');
    if (r.ok) { setEdit(null); router.refresh(); }
  }
  const num = (k: keyof SettingForm) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-bold">本部管理</h1><a href="/admin/hq/overview" className="rounded border bg-white px-3 py-1 text-sm text-brand">全店状況（今日の予約・来院）を見る →</a></div>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}

      <section className="rounded border bg-white p-4">
        <h2 className="mb-1 font-bold">店舗一覧（{stores.length} 店舗）</h2>
        <p className="mb-3 text-xs text-slate-500">各店舗には「管理URL」（/admin/login/店舗コード：パスワードだけでログイン）と「顧客URL」（/s/店舗コード）を配布してください。</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th>コード</th><th>店舗名</th><th>電話</th><th>ベッド</th><th>状態</th><th></th></tr></thead>
          <tbody>
            {stores.map((st) => edit && edit.code === st.code ? (
              <tr key={st.code} className="border-t bg-yellow-50">
                <td colSpan={6} className="py-2">
                  <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                    <input value={edit.newCode} onChange={(e) => setEdit({ ...edit, newCode: e.target.value })} placeholder="店舗コード" required className="w-32 rounded border px-2 py-1 font-mono" />
                    <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="店舗名" required className="w-48 rounded border px-2 py-1" />
                    <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="電話番号" required className="w-40 rounded border px-2 py-1" />
                    <button type="submit" className="rounded bg-brand px-3 py-1 text-white">保存</button>
                    <button type="button" onClick={() => setEdit(null)} className="rounded border px-3 py-1">やめる</button>
                    <span className="text-xs text-slate-500">店舗コードを変えると顧客URLとログインIDも変わります</span>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={st.code} className="border-t">
                <td className="py-1 font-mono">{st.code}</td><td>{st.name}</td><td>{st.phone}</td><td>{st.beds}</td>
                <td>{st.active ? '稼働' : '停止'}</td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  <a href={`/s/${st.code}`} target="_blank" rel="noreferrer" className="text-brand underline">顧客URL</a>
                  <a href={`/admin/login/${st.code}`} target="_blank" rel="noreferrer" className="text-brand underline">管理URL</a>
                  <button type="button" onClick={() => setEdit({ code: st.code, newCode: st.code, name: st.name, phone: st.phone })} className="rounded border px-2">編集</button>
                  <button type="button" onClick={() => storeAction(st.code, 'reset')} className="rounded border px-2">PW再設定</button>
                  <button type="button" onClick={() => storeAction(st.code, 'toggle')} className="rounded border px-2">{st.active ? '停止' : '再開'}</button>
                  <button type="button" onClick={() => storeAction(st.code, 'delete')} className="rounded border border-red-300 px-2 text-red-700">削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addStore} className="mt-4 grid grid-cols-2 gap-2 border-t pt-3 text-sm md:grid-cols-5">
          <input placeholder="店舗コード (例: S003)" value={ns.code} onChange={(e) => setNs({ ...ns, code: e.target.value })} required className="rounded border px-2 py-1" />
          <input placeholder="店舗名" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} required className="rounded border px-2 py-1" />
          <input placeholder="電話番号" value={ns.phone} onChange={(e) => setNs({ ...ns, phone: e.target.value })} required className="rounded border px-2 py-1" />
          <input placeholder="初期パスワード" type="password" minLength={8} value={ns.password} onChange={(e) => setNs({ ...ns, password: e.target.value })} required className="rounded border px-2 py-1" />
          <button type="submit" className="rounded bg-brand px-3 py-1 text-white">店舗を追加</button>
        </form>
      </section>

      <form onSubmit={saveSetting} className="space-y-3 rounded border bg-white p-4">
        <h2 className="font-bold">全店共通設定</h2>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <label>枠の刻み（分）<input type="number" min={5} max={60} value={s.slotMinutes} onChange={num('slotMinutes')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>初回に必要な枠数<input type="number" min={1} max={8} value={s.newVisitSlots} onChange={num('newVisitSlots')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>通院中に必要な枠数<input type="number" min={1} max={8} value={s.returnVisitSlots} onChange={num('returnVisitSlots')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>電話マークにする残り枠数<input type="number" min={0} max={20} value={s.phoneMarkRemaining} onChange={num('phoneMarkRemaining')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>WEB予約の締切（開始N分前）<input type="number" min={0} max={1440} value={s.webCutoffMinutes} onChange={num('webCutoffMinutes')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>電話受付の締切（開始N分前）<input type="number" min={0} max={1440} value={s.phoneCutoffMinutes} onChange={num('phoneCutoffMinutes')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>管理側の追加枠数（受付終了後の行）<input type="number" min={0} max={8} value={s.adminExtraSlots} onChange={num('adminExtraSlots')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>個人情報の保持日数<input type="number" min={7} max={3650} value={s.retentionDays} onChange={num('retentionDays')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={s.closeOnHolidays} onChange={(e) => setS({ ...s, closeOnHolidays: e.target.checked })} />祝日は休診</label>
        </div>
        <label className="block text-sm">営業時間（全店共通。曜日 0=日〜6=土。無い曜日は休診。[開始, 最終枠の開始]）
          <textarea value={s.hours} onChange={(e) => setS({ ...s, hours: e.target.value })} rows={14} className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs" />
        </label>
        <button type="submit" className="rounded bg-brand px-4 py-2 font-bold text-white">共通設定を保存</button>
      </form>
    </div>
  );
}
