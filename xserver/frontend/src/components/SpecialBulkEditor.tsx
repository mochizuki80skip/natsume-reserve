// 本部・管轄MG：特別な営業日（年末年始の時短など）を、選んだ店舗にまとめて入れる（全店・エリアごと・店舗ごと）。
// 店舗がすでに入れていた日は上書きする。新しい時間の外に入っている予約は消さずに一覧で知らせる（店舗が電話で調整）
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { formatDateJa } from '@/lib/time';

interface StoreLite { code: string; name: string; area: string }
interface Row { date: string; sessions: [string, string][]; memo: string; stores: string[] }
interface Outside { store: string; name: string; date: string; count: number }

export default function SpecialBulkEditor() {
  const { data, reload } = useFetch<{ stores: StoreLite[]; rows: Row[] }>('/api/admin/special-bulk');
  const [f, setF] = useState({ from: '', to: '', am1: '', am2: '', pm1: '', pm2: '', memo: '' });
  const [pick, setPick] = useState<string[] | null>(null);
  const [msg, setMsg] = useState('');
  const [outside, setOutside] = useState<Outside[]>([]);
  const stores = data?.stores ?? [];
  const chosen = pick ?? stores.map((s) => s.code); // はじめは全店
  const areas = [...new Set(stores.map((s) => s.area))];
  const nameOf = new Map(stores.map((s) => [s.code, s.name]));
  const toggle = (codes: string[], on: boolean) => setPick(on ? [...new Set([...chosen, ...codes])] : chosen.filter((c) => !codes.includes(c)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sessions = [[f.am1, f.am2], [f.pm1, f.pm2]].filter(([a, b]) => a || b);
    if (!f.from) { setMsg('日付を選んでください'); return; }
    if (sessions.length === 0 || sessions.some(([a, b]) => !a || !b)) { setMsg('午前・午後の時間を「始め〜受付の最後」の両方入れてください（午前か午後だけでも OK）'); return; }
    if (chosen.length === 0) { setMsg('店舗を選んでください'); return; }
    const r = await fetch('/api/admin/special-bulk', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: f.from, to: f.to || f.from, sessions, memo: f.memo, stores: chosen }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error ?? '保存できませんでした'); return; }
    setMsg(`${chosen.length} 店舗に特別な営業日を入れました（${formatDateJa(f.from)}${f.to && f.to !== f.from ? `〜${formatDateJa(f.to)}` : ''}）。店舗がすでに入れていた日は上書きしました。`);
    setOutside(j.outside ?? []);
    reload();
  }
  async function remove(r: Row) {
    if (!confirm(`${formatDateJa(r.date)} の特別な営業日を ${r.stores.length} 店舗から消して、通常の営業時間に戻しますか？`)) return;
    const res = await fetch('/api/admin/special-bulk', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: r.date, stores: r.stores }) });
    setMsg(res.ok ? `${formatDateJa(r.date)} を ${r.stores.length} 店舗で通常の営業時間に戻しました` : '消せませんでした');
    setOutside([]);
    reload();
  }
  const time = (k: 'am1' | 'am2' | 'pm1' | 'pm2', aria: string) => <input type="time" step={900} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={aria} className="rounded border px-1 py-0.5" />;
  const storesLabel = (codes: string[]) => (codes.length === stores.length ? `全店（${codes.length} 店）` : codes.map((c) => nameOf.get(c) ?? c).join('・'));

  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label="特別な営業日（まとめて）">
      <h2 className="font-bold">特別な営業日をまとめて入れる（年末年始の時短など）</h2>
      <p className="mt-1 text-xs text-slate-600">
        選んだ店舗の、その日だけの営業時間を入れます（定休日・祝日でも、その時間で営業日になります）。時刻は「始め〜<b>受付の最後</b>」です（例：9:00〜11:45 なら 11:45 の予約まで）。
        店舗がすでに入れていた日は上書きします。お休みにする日は「臨時休業をまとめて入れる」を使ってください。
      </p>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      {outside.length > 0 && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert" aria-label="時間の外の予約">
          <b>新しい時間の外に予約が入っています</b>（予約は消していません。店舗から患者様へ電話で調整してください）：
          <ul className="mt-1 list-disc pl-5">{outside.map((o) => <li key={`${o.store}:${o.date}`}>{o.name}　{formatDateJa(o.date)}　{o.count} 件</li>)}</ul>
        </div>
      )}
      <form onSubmit={save} className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          日付 <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="特別営業の始めの日" className="rounded border px-1 py-0.5" />
          〜 <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="特別営業の終わりの日" className="rounded border px-1 py-0.5" />
          <span className="text-xs text-slate-500">（1 日だけなら終わりは空欄）</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          午前 {time('am1', '午前の始め')}〜{time('am2', '午前の受付の最後')}　午後 {time('pm1', '午後の始め')}〜{time('pm2', '午後の受付の最後')}
          <span className="text-xs text-slate-500">（空欄＝その半日は休み）</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          メモ <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} maxLength={40} placeholder="例：年末の時短営業" aria-label="特別営業のメモ" className="w-56 rounded border px-2 py-0.5" />
          <span className="text-xs text-slate-500">（予約表に出ます）</span>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span>店舗</span>
            <label className="font-bold"><input type="checkbox" checked={stores.length > 0 && chosen.length === stores.length} onChange={(e) => setPick(e.target.checked ? stores.map((s) => s.code) : [])} aria-label="全店" /> 全店</label>
            <span className="text-xs text-slate-500">{chosen.length} 店を選んでいます</span>
          </div>
          {areas.map((a) => {
            const list = stores.filter((s) => s.area === a);
            return (
              <div key={a || '-'} className="ml-2 mt-1">
                <label className="font-bold"><input type="checkbox" checked={list.every((s) => chosen.includes(s.code))} onChange={(e) => toggle(list.map((s) => s.code), e.target.checked)} aria-label={`エリア ${a || '未設定'}`} /> {a || 'エリア未設定'}</label>
                <span className="ml-3 inline-flex flex-wrap gap-x-3">{list.map((s) => <label key={s.code} className="whitespace-nowrap"><input type="checkbox" checked={chosen.includes(s.code)} onChange={(e) => toggle([s.code], e.target.checked)} aria-label={`特別営業：${s.name}`} /> {s.name}</label>)}</span>
              </div>
            );
          })}
        </div>
        <button type="submit" className="rounded bg-brand px-4 py-1.5 font-bold text-white">選んだ店舗に入れる</button>
      </form>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th className="pr-2">日付</th><th className="pr-2">時間（始め〜受付の最後）</th><th className="pr-2">メモ</th><th className="pr-2">店舗</th><th /></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={`${r.date}:${r.sessions.join()}:${r.memo}`} className="border-t align-top">
                <td className="py-1 pr-2 whitespace-nowrap">{formatDateJa(r.date)}</td>
                <td className="py-1 pr-2">{r.sessions.map(([a, b]) => `${a}〜${b}`).join('・')}</td>
                <td className="py-1 pr-2">{r.memo}</td>
                <td className="py-1 pr-2">{storesLabel(r.stores)}</td>
                <td className="py-1 text-right"><button type="button" onClick={() => remove(r)} className="whitespace-nowrap rounded border px-2 py-0.5">まとめて消す</button></td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-400">今日から先の特別な営業日はありません</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
