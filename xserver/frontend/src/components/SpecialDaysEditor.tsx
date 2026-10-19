// 店舗設定：特別な営業日（プレオープン・イベントなど）。その日だけ、ここで決めた時間で予約表と WEB 予約の枠ができる（定休日・祝日でも）
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { WEEKDAY_JA, weekdayOf } from '@/lib/time';

interface Row { date: string; sessions: [string, string][]; memo: string }
const label = (d: string) => `${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8)}（${WEEKDAY_JA[weekdayOf(d)]}）`;
const text = (r: Row) => r.sessions.map(([a, b]) => `${a}〜${b}`).join('／');

export default function SpecialDaysEditor() {
  const { data, reload } = useFetch<{ rows: Row[] }>('/api/admin/special-days');
  const [f, setF] = useState({ date: '', am1: '', am2: '', pm1: '', pm2: '', memo: '' });
  const [msg, setMsg] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sessions = [[f.am1, f.am2], [f.pm1, f.pm2]].filter(([a, b]) => a || b);
    if (!f.date) { setMsg('日付を選んでください'); return; }
    if (sessions.length === 0 || sessions.some(([a, b]) => !a || !b)) { setMsg('午前・午後の時間を「始め〜受付の最後」の両方入れてください（午前か午後だけでも OK）'); return; }
    const r = await fetch('/api/admin/special-days', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: f.date, sessions, memo: f.memo }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${label(f.date)} を特別な営業日にしました` : j.error ?? '保存できませんでした');
    if (r.ok) { setF({ date: '', am1: '', am2: '', pm1: '', pm2: '', memo: '' }); reload(); }
  }
  async function remove(d: string) {
    if (!confirm(`${label(d)} の特別な営業日を消して、通常の営業時間に戻しますか？`)) return;
    const r = await fetch('/api/admin/special-days', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: d }) });
    setMsg(r.ok ? `${label(d)} を通常の営業時間に戻しました` : '消せませんでした');
    reload();
  }
  const edit = (r: Row) => setF({ date: r.date, am1: r.sessions[0]?.[0] ?? '', am2: r.sessions[0]?.[1] ?? '', pm1: r.sessions[1]?.[0] ?? '', pm2: r.sessions[1]?.[1] ?? '', memo: r.memo });
  const time = (k: 'am1' | 'am2' | 'pm1' | 'pm2', aria: string) => <input type="time" step={900} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={aria} className="rounded border px-1 py-0.5" />;
  return (
    <section className="rounded-lg border bg-white p-4 text-sm" aria-label="特別な営業日">
      <h2 className="font-bold">特別な営業日（プレオープン・イベントなど）</h2>
      <p className="mt-1 text-xs text-slate-500">
        その日だけ、ここで決めた時間で予約表と WEB 予約の枠ができます（定休日・祝日でも営業日になります）。時刻は「始め〜<b>受付の最後</b>」です（例：10:00〜12:30 なら 12:30 の予約まで）。
        WEB で受け付けるかは、いつもどおり予約表の「公開する／非公開にする」で決めてください。
      </p>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      <form onSubmit={save} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-1">日付<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="特別な営業日の日付" className="rounded border px-1 py-0.5" /></label>
        <span className="flex items-center gap-1">午前 {time('am1', '午前の始め')}〜{time('am2', '午前の受付の最後')}</span>
        <span className="flex items-center gap-1">午後 {time('pm1', '午後の始め')}〜{time('pm2', '午後の受付の最後')}</span>
        <label className="flex items-center gap-1">メモ<input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} maxLength={40} placeholder="プレオープン" aria-label="特別な営業日のメモ" className="w-36 rounded border px-2 py-0.5" /></label>
        <button type="submit" className="rounded bg-brand px-3 py-1 font-bold text-white">保存</button>
      </form>
      <table className="mt-3 w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th>日付</th><th>時間</th><th>メモ</th><th /></tr></thead>
        <tbody>
          {(data?.rows ?? []).map((r) => (
            <tr key={r.date} className="border-t">
              <td className="whitespace-nowrap py-1">{label(r.date)}</td>
              <td className="tabular-nums">{text(r)}</td>
              <td>{r.memo}</td>
              <td className="whitespace-nowrap text-right">
                <button type="button" onClick={() => edit(r)} className="rounded border px-2 py-0.5 text-xs">直す</button>
                <button type="button" onClick={() => remove(r.date)} className="ml-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700">消す</button>
              </td>
            </tr>
          ))}
          {data && data.rows.length === 0 && <tr><td colSpan={4} className="py-1 text-xs text-slate-400">まだありません</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
