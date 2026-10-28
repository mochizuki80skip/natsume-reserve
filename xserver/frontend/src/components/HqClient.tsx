import { useState } from 'react';
import { StoreUrlCards } from './UrlQrCard';

interface StoreRow { code: string; name: string; phone: string; beds: number; active: boolean; area?: string; hqOnly?: boolean; jibaiOnly?: boolean }
interface SettingForm {
  slotMinutes: number; newVisitSlots: number; returnVisitSlots: number; webCutoffMinutes: number; phoneCutoffMinutes: number;
  phoneMarkRemaining: number; closeOnHolidays: boolean; adminExtraSlots: number; retentionDays: number; hours: string;
}

export default function HqClient({ stores, areas = [], setting, onRefresh }: { stores: StoreRow[]; areas?: string[]; setting: SettingForm; onRefresh: () => void }) {
  const [s, setS] = useState(setting);
  const [ns, setNs] = useState({ code: '', name: '', phone: '', password: '' });
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<{ code: string; newCode: string; name: string; phone: string; hqOnly: boolean; jibaiOnly: boolean } | null>(null);
  const [showJibai, setShowJibai] = useState(false);

  async function saveSetting(e: React.FormEvent) {
    e.preventDefault();
    let hours: unknown;
    try { hours = JSON.parse(s.hours); } catch { setMsg('営業時間が JSON として正しくありません'); return; }
    const r = await fetch('/api/admin/hq/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, hours }) });
    setMsg(r.ok ? '共通設定を保存しました' : (await r.json()).error ?? '保存に失敗しました');
    onRefresh();
  }
  async function addStore(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/admin/hq/stores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ns) });
    setMsg(r.ok ? `店舗 ${ns.code} を追加しました` : (await r.json()).error ?? '追加に失敗しました');
    if (r.ok) { setNs({ code: '', name: '', phone: '', password: '' }); onRefresh(); }
  }
  async function storeAction(code: string, action: 'reset' | 'toggle' | 'delete') {
    let password: string | null = null;
    if (action === 'reset') { password = prompt(`${code} の新しいパスワード（8文字以上）`); if (!password) return; }
    if (action === 'delete' && !confirm(`店舗 ${code} を削除します。この店舗の予約表・予約データもすべて消えます。よろしいですか？`)) return;
    const r = await fetch('/api/admin/hq/stores', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, action, password }) });
    setMsg(r.ok ? '更新しました' : (await r.json()).error ?? '更新に失敗しました');
    onRefresh();
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const r = await fetch('/api/admin/hq/stores', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: edit.code, action: 'update', newCode: edit.newCode, name: edit.name, phone: edit.phone, hqOnly: edit.hqOnly, jibaiOnly: edit.jibaiOnly }) });
    setMsg(r.ok ? '店舗情報を更新しました' : (await r.json()).error ?? '更新に失敗しました');
    if (r.ok) { setEdit(null); onRefresh(); }
  }
  // 並べ替え（同じまとまりの中で 1 つ上・下へ）とエリアの付け替え
  async function storePut(body: Record<string, unknown>, done: string) {
    const r = await fetch('/api/admin/hq/stores', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setMsg(r.ok ? done : (await r.json().catch(() => ({}))).error ?? '更新に失敗しました');
    onRefresh();
  }
  // 一覧のまとまり：本部専用 → エリア（エリアの設定の順）→ エリア未設定
  // 自賠請求だけに使う店舗（ミツカル接骨院など）は一覧に出さず、いちばん下の「表示する」を押したときだけ出す
  const jibaiStores = stores.filter((x) => x.jibaiOnly);
  const main = stores.filter((x) => !x.jibaiOnly);
  const groups = [
    { key: '#hq', label: '本部専用（本部の人だけが見る店舗）', list: main.filter((x) => x.hqOnly) },
    ...areas.map((a) => ({ key: a, label: a, list: main.filter((x) => !x.hqOnly && x.area === a) })),
    { key: '#none', label: 'エリア未設定', list: main.filter((x) => !x.hqOnly && (!x.area || !areas.includes(x.area))) },
    ...(showJibai ? [{ key: '#jibai', label: '自賠請求のみの店舗（予約表・集計・店舗えらびページ・WEB 予約には出しません）', list: jibaiStores }] : []),
  ].filter((g) => g.list.length > 0 || g.key === '#none');
  const num = (k: keyof SettingForm) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-bold">本部管理</h1><a href="/admin/hq/overview" className="rounded border bg-white px-3 py-1 text-sm text-brand">全店状況（今日の予約・来院）を見る →</a></div>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}

      <section className="rounded border bg-white p-4">
        <h2 className="mb-1 font-bold">店舗一覧（{main.length} 店舗）</h2>
        <p className="mb-3 text-xs text-slate-500">各店舗には「管理URL」（/admin/login/店舗コード：パスワードだけでログイン）と「顧客URL」（/s/店舗コード）を配布してください。</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="w-16">並び</th><th>コード</th><th>店舗名</th><th>エリア</th><th>電話</th><th>ベッド</th><th>状態</th><th></th></tr></thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr className={g.key === '#hq' ? 'bg-violet-50' : 'bg-brand-light'}><td colSpan={8} className={`px-2 py-1 text-xs font-bold ${g.key === '#hq' ? 'text-violet-800' : 'text-brand-dark'}`}>{g.label}（{g.list.length} 店舗）</td></tr>
              {g.list.map((st, i) => edit && edit.code === st.code ? (
                <tr key={st.code} className="border-t bg-yellow-50">
                  <td colSpan={8} className="space-y-2 px-1 py-2">
                    <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                      <input value={edit.newCode} onChange={(e) => setEdit({ ...edit, newCode: e.target.value })} placeholder="店舗コード" required className="w-32 rounded border px-2 py-1 font-mono" />
                      <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="店舗名" required className="w-48 rounded border px-2 py-1" />
                      <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="電話番号" required className="w-40 rounded border px-2 py-1" />
                      <label className="flex items-center gap-1 rounded border border-violet-300 bg-white px-2 py-1 text-xs"><input type="checkbox" checked={edit.hqOnly} onChange={(e) => setEdit({ ...edit, hqOnly: e.target.checked })} />本部専用（店舗のアカウントではログインできない）</label>
                      <label className="flex items-center gap-1 rounded border border-amber-400 bg-white px-2 py-1 text-xs"><input type="checkbox" checked={edit.jibaiOnly} onChange={(e) => setEdit({ ...edit, jibaiOnly: e.target.checked })} />自賠請求のみ（店舗一覧・集計・WEB 予約に出さない）</label>
                      <button type="submit" className="rounded bg-brand px-3 py-1 text-white">保存</button>
                      <button type="button" onClick={() => setEdit(null)} className="rounded border px-3 py-1">やめる</button>
                      <span className="text-xs text-slate-500">店舗コードを変えると顧客URLとログインIDも変わります</span>
                    </form>
                    <StoreUrlCards code={st.code} name={st.name} />
                  </td>
                </tr>
              ) : (
                <tr key={st.code} className={`border-t ${st.active ? '' : 'text-slate-400'}`}>
                  <td className="whitespace-nowrap py-1">
                    <button type="button" aria-label={`${st.name} を上へ`} disabled={i === 0} onClick={() => storePut({ code: st.code, action: 'move', dir: -1 }, '並び順を変えました')} className="rounded border px-1.5 disabled:opacity-30">↑</button>
                    <button type="button" aria-label={`${st.name} を下へ`} disabled={i === g.list.length - 1} onClick={() => storePut({ code: st.code, action: 'move', dir: 1 }, '並び順を変えました')} className="ml-1 rounded border px-1.5 disabled:opacity-30">↓</button>
                  </td>
                  <td className="font-mono">{st.code}</td><td>{st.name}</td>
                  <td>
                    <select value={st.area && areas.includes(st.area) ? st.area : ''} onChange={(e) => storePut({ code: st.code, action: 'area', area: e.target.value }, `${st.name} のエリアを変えました`)} aria-label={`${st.name} のエリア`} className="rounded border px-1 py-0.5 text-xs">
                      <option value="">（未設定）</option>
                      {areas.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </td>
                  <td>{st.phone}</td><td>{st.beds}</td>
                  <td>{st.active ? '稼働' : '停止'}{st.hqOnly && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">本部専用</span>}{st.jibaiOnly && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">自賠のみ</span>}</td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    <a href={`/s/${st.code}`} target="_blank" rel="noreferrer" className="text-brand underline">顧客URL</a>
                    <a href={`/admin/login/${st.code}`} target="_blank" rel="noreferrer" className="text-brand underline">管理URL</a>
                    <button type="button" onClick={() => setEdit({ code: st.code, newCode: st.code, name: st.name, phone: st.phone, hqOnly: !!st.hqOnly, jibaiOnly: !!st.jibaiOnly })} className="rounded border px-2">編集・URL</button>
                    <button type="button" onClick={() => storeAction(st.code, 'reset')} className="rounded border px-2">PW再設定</button>
                    <button type="button" onClick={() => storeAction(st.code, 'toggle')} className="rounded border px-2">{st.active ? '停止' : '再開'}</button>
                    <button type="button" onClick={() => storeAction(st.code, 'delete')} className="rounded border border-red-300 px-2 text-red-700">削除</button>
                  </td>
                </tr>
              ))}
              {g.list.length === 0 && <tr><td colSpan={8} className="py-1 text-xs text-slate-400">なし</td></tr>}
            </tbody>
          ))}
        </table>
        {jibaiStores.length > 0 && (
          <button type="button" onClick={() => setShowJibai(!showJibai)} aria-expanded={showJibai} className="mt-2 rounded border bg-white px-3 py-1 text-xs text-slate-600">
            {showJibai ? '▾' : '▸'} 自賠請求のみの店舗（{jibaiStores.length} 店舗）を{showJibai ? 'しまう' : '表示する'}
          </button>
        )}
        <p className="mt-2 text-xs text-slate-500">エリアの名前・順番は「新患・再来集計（全店）」→「選択肢・エリアの設定」で変えられます。ここでの並び順は、上の店舗切り替え・全店状況・新患・再来集計・店舗えらびページにもそろいます。</p>
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
          <label>△（残りわずか）にする残り枠数<input type="number" min={0} max={20} value={s.phoneMarkRemaining} onChange={num('phoneMarkRemaining')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>WEB予約の締切（開始N分前）<input type="number" min={0} max={1440} value={s.webCutoffMinutes} onChange={num('webCutoffMinutes')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>電話受付の締切（開始N分前）<input type="number" min={0} max={1440} value={s.phoneCutoffMinutes} onChange={num('phoneCutoffMinutes')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>管理側の追加枠数（受付終了後の行）<input type="number" min={0} max={8} value={s.adminExtraSlots} onChange={num('adminExtraSlots')} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label>予約表・シフトの保持日数<span className="block text-[10px] text-slate-500">WEB予約・キャンセル名簿・入力の履歴・新患継続率は消しません</span><input type="number" min={7} max={3650} value={s.retentionDays} onChange={num('retentionDays')} className="mt-1 w-full rounded border px-2 py-1" /></label>
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
