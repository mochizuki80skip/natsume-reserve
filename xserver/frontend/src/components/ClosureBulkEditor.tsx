// 本部・管轄MG：臨時休業をまとめて入れる（全店・エリアごと・店舗ごと）。入れた店舗の予約表には通知が出る
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { formatDateJa, nowJst } from '@/lib/time';

type Part = 'ALL' | 'AM' | 'PM';
interface Row { code: string; name: string; area: string; part: Part | null; note: string; by: string | null; booked: number }
const PART_JA: Record<Part, string> = { ALL: '終日', AM: '午前', PM: '午後' };

export default function ClosureBulkEditor() {
  const [date, setDate] = useState(() => nowJst().date);
  const [part, setPart] = useState<Part>('ALL');
  const [note, setNote] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const { data, reload } = useFetch<{ date: string; stores: Row[] }>(`/api/admin/closures?date=${date}`);
  const rows = data?.date === date ? data.stores : [];
  const areas = [...new Set(rows.map((r) => r.area))];
  const closed = rows.filter((r) => r.part);

  async function put(codes: string[], p: Part | null, done: string) {
    const r = await fetch('/api/admin/closures', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, codes, part: p, note }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? done : (j as { error?: string }).error ?? '保存できませんでした');
    if (r.ok) { reload(); if (p) setSel(new Set()); }
  }
  const toggle = (codes: string[], on: boolean) => setSel((s) => { const n = new Set(s); codes.forEach((c) => (on ? n.add(c) : n.delete(c))); return n; });

  return (
    <section className="mb-6 rounded border bg-white p-4 text-sm" aria-label="臨時休業（まとめて）">
      <h2 className="font-bold">臨時休業（まとめて）</h2>
      <p className="mt-1 text-xs text-slate-600">台風などで、いくつかの店舗をまとめて臨時休業にします。えらんだ店舗の予約ページ・店舗えらびのページにお知らせが出て、店舗の画面にも通知が出ます。あとから店舗の予約表で 1 店舗ずつ変えることもできます。</p>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1" role="status">{msg}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">日にち <input type="date" value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setMsg(''); } }} className="rounded border px-2 py-0.5" /></label>
        <span className="ml-2">時間</span>
        {(['ALL', 'AM', 'PM'] as const).map((p) => <button key={p} type="button" aria-pressed={part === p} onClick={() => setPart(p)} className={`rounded border px-2 py-0.5 ${part === p ? 'border-red-600 bg-red-600 font-bold text-white' : 'bg-white'}`}>{PART_JA[p]}</button>)}
        <label className="ml-2 flex items-center gap-1">お知らせの一言 <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} placeholder="例）台風のため" className={`w-52 rounded border px-2 py-0.5 ${note.trim() ? '' : 'border-amber-500'}`} /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => toggle(rows.map((r) => r.code), true)} className="rounded border px-2 py-0.5">全店をえらぶ</button>
        <button type="button" onClick={() => setSel(new Set())} className="rounded border px-2 py-0.5">全部外す</button>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {areas.map((a) => {
          const list = rows.filter((r) => r.area === a);
          const all = list.every((r) => sel.has(r.code));
          return (
            <div key={a || 'none'} className="rounded border px-3 py-2">
              <label className="flex items-center gap-1 font-bold"><input type="checkbox" checked={all} onChange={(e) => toggle(list.map((r) => r.code), e.target.checked)} />{a || 'エリア未設定'}（全部）</label>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-5">
                {list.map((r) => <label key={r.code} className="flex items-center gap-1"><input type="checkbox" checked={sel.has(r.code)} onChange={(e) => toggle([r.code], e.target.checked)} />{r.name}{r.part && <span className="rounded bg-red-100 px-1 text-xs font-bold text-red-800">{PART_JA[r.part]}休業中</span>}</label>)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!sel.size} onClick={() => put([...sel], part, `${sel.size} 店舗を ${formatDateJa(date, false)} ${PART_JA[part]} の臨時休業にしました`)} className="rounded bg-brand px-4 py-1 font-bold text-white disabled:opacity-40">
          {sel.size} 店舗を{PART_JA[part]}の臨時休業にする
        </button>
        {!note.trim() && sel.size > 0 && <span className="text-xs font-bold text-amber-700">お知らせの一言（理由）が空です</span>}
      </div>

      <h3 className="mt-5 font-bold">{formatDateJa(date, false)} の臨時休業</h3>
      {closed.length === 0 ? <p className="mt-1 text-xs text-slate-500">この日に臨時休業の店舗はありません</p> : (
        <>
          <table className="mt-1 w-full max-w-3xl" aria-label="この日の臨時休業">
            <thead><tr className="bg-slate-100 text-left text-xs"><th className="px-2 py-1">店舗</th><th className="px-2 py-1">臨時休業</th><th className="px-2 py-1">一言</th><th className="px-2 py-1">入っている予約</th><th className="px-2 py-1">入れた人</th><th /></tr></thead>
            <tbody>
              {closed.map((r) => (
                <tr key={r.code} className="border-t">
                  <td className="px-2 py-1">{r.name}</td>
                  <td className="px-2 py-1"><span className="rounded bg-red-100 px-1.5 text-xs font-bold text-red-800">{PART_JA[r.part!]}</span></td>
                  <td className="px-2 py-1">{r.note || <span className="text-xs text-amber-700">（未入力）</span>}</td>
                  <td className="px-2 py-1">{r.booked ? <b className="text-red-700">{r.booked}件（要連絡）</b> : '0件'}</td>
                  <td className="px-2 py-1 text-xs text-slate-500">{r.by ?? '店舗'}</td>
                  <td className="px-2 py-1 text-right"><button type="button" onClick={() => put([r.code], null, `${r.name} の臨時休業を取り消しました`)} className="rounded border px-2 py-0.5 text-xs">取り消す</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => confirm(`${formatDateJa(date, false)} の臨時休業（${closed.length} 店舗）をすべて取り消しますか？`) && put(closed.map((r) => r.code), null, `${closed.length} 店舗の臨時休業を取り消しました`)} className="mt-2 rounded border px-3 py-0.5 text-xs">この日の臨時休業をまとめて取り消す</button>
        </>
      )}
    </section>
  );
}
