// 本部・管轄MG：臨時休業をまとめて入れる（全店・エリアごと・店舗ごと）。入れた店舗の予約表には通知が出る
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { formatDateJa, nowJst } from '@/lib/time';

type Part = 'ALL' | 'AM' | 'PM';
interface Row { code: string; name: string; area: string; part: Part | null; note: string; by: string | null; booked: number }
const PART_JA: Record<Part, string> = { ALL: '終日', AM: '午前', PM: '午後' };

export default function ClosureBulkEditor() {
  const [date, setDate] = useState(() => nowJst().date);
  const [to, setTo] = useState(''); // 期間の終わり（空欄＝1 日だけ）
  const [booked, setBooked] = useState<{ name: string; date: string; count: number }[]>([]);
  const [part, setPart] = useState<Part>('ALL');
  const [note, setNote] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const { data, reload } = useFetch<{ date: string; stores: Row[] }>(`/api/admin/closures?date=${date}`);
  const rows = data?.date === date ? data.stores : [];
  const areas = [...new Set(rows.map((r) => r.area))];
  const closed = rows.filter((r) => r.part);
  const isRange = !!to && to > date;
  const days = isRange ? Math.round((Date.parse(to) - Date.parse(date)) / 86400000) + 1 : 1;
  const span = isRange ? `${formatDateJa(date, false)}〜${formatDateJa(to, false)}` : formatDateJa(date, false);

  // range：期間（始め〜終わり）でまとめて。false のときは表に出ている日だけ（取り消しボタン）
  async function put(codes: string[], p: Part | null, done: string, range = true) {
    const r = await fetch('/api/admin/closures', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, to: range ? to || date : date, codes, part: p, note }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? done : (j as { error?: string }).error ?? '保存できませんでした');
    setBooked(r.ok ? (j as { booked?: { name: string; date: string; count: number }[] }).booked ?? [] : []);
    if (r.ok) { reload(); if (p) setSel(new Set()); }
  }
  const toggle = (codes: string[], on: boolean) => setSel((s) => { const n = new Set(s); codes.forEach((c) => (on ? n.add(c) : n.delete(c))); return n; });

  return (
    <section className="mb-6 rounded border bg-white p-4 text-sm" aria-label="臨時休業（まとめて）">
      <h2 className="font-bold">臨時休業（まとめて）</h2>
      <p className="mt-1 text-xs text-slate-600">台風などで、いくつかの店舗をまとめて臨時休業にします。えらんだ店舗の予約ページ・店舗えらびのページにお知らせが出て、店舗の画面にも通知が出ます。あとから店舗の予約表で 1 店舗ずつ変えることもできます。</p>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1" role="status">{msg}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">日にち <input type="date" value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setMsg(''); setBooked([]); } }} aria-label="臨時休業の始めの日" className="rounded border px-2 py-0.5" /></label>
        <label className="flex items-center gap-1">〜 <input type="date" value={to} min={date} onChange={(e) => { setTo(e.target.value); setMsg(''); setBooked([]); }} aria-label="臨時休業の終わりの日" className="rounded border px-2 py-0.5" /><span className="text-xs text-slate-500">（年末年始など。1 日だけなら空欄）</span></label>
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
        <button type="button" disabled={!sel.size} onClick={() => put([...sel], part, `${sel.size} 店舗を ${span} ${PART_JA[part]} の臨時休業にしました`)} className="rounded bg-brand px-4 py-1 font-bold text-white disabled:opacity-40">
          {sel.size} 店舗を{isRange ? `${span}（${days} 日）` : ''}{PART_JA[part]}の臨時休業にする
        </button>
        {isRange && <button type="button" disabled={!sel.size} onClick={() => confirm(`${sel.size} 店舗の ${span} の臨時休業を取り消しますか？`) && put([...sel], null, `${sel.size} 店舗の ${span} の臨時休業を取り消しました`)} className="rounded border px-3 py-1 disabled:opacity-40">{sel.size} 店舗の{span}の臨時休業を取り消す</button>}
        {!note.trim() && sel.size > 0 && <span className="text-xs font-bold text-amber-700">お知らせの一言（理由）が空です</span>}
      </div>

      {booked.length > 0 && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert" aria-label="休みの日の予約">
          <b>休みにした時間に予約が入っています</b>（予約は消していません。店舗から患者様へ連絡し、キャンセル・変更名簿へ移してください）：
          <ul className="mt-1 list-disc pl-5">{booked.map((b) => <li key={`${b.name}:${b.date}`}>{b.name}　{formatDateJa(b.date, false)}　{b.count} 件</li>)}</ul>
        </div>
      )}
      <h3 className="mt-5 font-bold">{formatDateJa(date, false)} の臨時休業{isRange && <span className="ml-2 text-xs font-normal text-slate-500">（始めの日の様子。ほかの日は日にちを変えると見られます）</span>}</h3>
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
                  <td className="px-2 py-1 text-right"><button type="button" onClick={() => put([r.code], null, `${r.name} の ${formatDateJa(date, false)} の臨時休業を取り消しました`, false)} className="rounded border px-2 py-0.5 text-xs">取り消す</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => confirm(`${formatDateJa(date, false)} の臨時休業（${closed.length} 店舗）をすべて取り消しますか？`) && put(closed.map((r) => r.code), null, `${closed.length} 店舗の臨時休業を取り消しました`, false)} className="mt-2 rounded border px-3 py-0.5 text-xs">この日の臨時休業をまとめて取り消す</button>
        </>
      )}
    </section>
  );
}
