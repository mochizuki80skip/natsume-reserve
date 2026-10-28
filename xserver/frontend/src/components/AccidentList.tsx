// 新患継続率の下：新自（交通事故）・新三（第三者行為）の一覧。事故日・事故内容を入れる（空は黄色。前の月の未入力も出す）
import { useState } from 'react';
import { accidentMissing, isInjuryKind, parseAccidentDate, type KarteRow } from '@/lib/karte';
import { halfNumInput } from '@/lib/format';

const ymd = (d?: string | null) => (d ? d.replaceAll('-', '/') : '');
const cell = 'h-[26px] w-full bg-transparent px-1 text-[12px] outline-none focus:bg-yellow-50';

function AccDate({ row, onSave }: { row: KarteRow; onSave: (iso: string | null) => void }) {
  const [bad, setBad] = useState(false);
  const v = row.accidentDate ?? '';
  return (
    <input key={v} defaultValue={ymd(v)} aria-label="事故日" title="例）9/18 または 0918（初診日より前の日になります）、2026/9/18"
      onInput={(e) => { if (!(e.nativeEvent as InputEvent).isComposing) halfNumInput(e.currentTarget); }} onCompositionEnd={(e) => halfNumInput(e.currentTarget)}
      onBlur={(e) => { const iso = parseAccidentDate(e.target.value, row.date); if (iso === null) { setBad(true); return; } setBad(false); if (iso !== v) onSave(iso || null); else e.target.value = ymd(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${cell} text-center tabular-nums ${bad ? 'bg-red-200' : ''}`} />
  );
}

function AccNote({ row, onSave }: { row: KarteRow; onSave: (v: string) => void }) {
  const v = row.accidentNote ?? '';
  return (
    <textarea key={v} defaultValue={v} aria-label="事故内容" maxLength={200} rows={1}
      onBlur={(e) => { const t = e.target.value.trim(); if (t !== v) onSave(t); }}
      className={`${cell} block min-h-[26px] resize-y py-1`} />
  );
}

function Rows({ rows, onPatch }: { rows: KarteRow[]; onPatch: (id: string, p: Partial<KarteRow>) => void }) {
  return (
    <>
      {rows.map((r) => {
        const missDate = !r.accidentDate, missNote = !(r.accidentNote ?? '').trim();
        return (
          <tr key={r.id} className="align-top">
            <td className="whitespace-nowrap border px-1 py-1 text-center tabular-nums">{ymd(r.date)}</td>
            <td className="whitespace-nowrap border px-1 py-1 text-center">{r.kind === 'THIRD' ? '新三' : '新自'}</td>
            <td className="whitespace-nowrap border px-1 py-1 text-center">{r.karteNo}</td>
            <td className="whitespace-nowrap border px-1 py-1">{r.name}</td>
            <td className="whitespace-nowrap border px-1 py-1">{r.trig}{r.trigDetail ? `（${r.trigDetail}）` : ''}</td>
            <td className={`border ${missDate ? 'bg-yellow-300' : ''}`}><AccDate row={r} onSave={(v) => onPatch(r.id, { accidentDate: v })} /></td>
            <td className={`border ${missNote ? 'bg-yellow-300' : ''}`}><AccNote row={r} onSave={(v) => onPatch(r.id, { accidentNote: v })} /></td>
            <td className="whitespace-nowrap border px-1 py-1">{r.staff}</td>
          </tr>
        );
      })}
    </>
  );
}

export default function AccidentList({ rows, pending, monthLabel, onPatch }: { rows: KarteRow[]; pending: KarteRow[]; monthLabel: string; onPatch: (id: string, p: Partial<KarteRow>) => void }) {
  const mine = rows.filter((r) => isInjuryKind(r.kind));
  const missing = mine.filter(accidentMissing).length + pending.filter(accidentMissing).length;
  return (
    <section className="mt-6 rounded border border-slate-300 bg-white p-3 text-sm" aria-label="新自・新三（事故）">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">新自（交通事故）・新三（第三者行為）　{monthLabel}</h2>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{mine.length}件</span>
        {missing > 0
          ? <span className="rounded bg-yellow-300 px-2 py-0.5 text-xs font-bold text-yellow-900" role="status">⚠ 事故日・事故内容の未入力 {missing}件</span>
          : <span className="text-xs text-green-700">未入力はありません</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">新・再が「初自」「新三」の方です。事故日・事故内容を入れてください（空の欄は黄色。上のメニューの「新患継続率」にも未入力の数が出ます）。事故日は「9/18」「0918」で入れられます。</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[12px]">
          <thead>
            <tr className="bg-[#5b3f8c] text-left text-white">
              {[['初診日', 84], ['区分', 44], ['カルテNo', 60], ['氏名', 100], ['きっかけ', 130], ['事故日', 90], ['事故内容', 0], ['担当', 60]].map(([h, w]) => <th key={h} className="whitespace-nowrap border border-[#5b3f8c] px-1 py-1 font-bold" style={w ? { width: w as number } : undefined}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            <Rows rows={mine} onPatch={onPatch} />
            {mine.length === 0 && <tr><td colSpan={8} className="border p-3 text-center text-slate-500">この月の新自・新三はまだありません。</td></tr>}
            {pending.length > 0 && <tr><td colSpan={8} className="border bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">ほかの月の未入力（{pending.length}件）</td></tr>}
            <Rows rows={pending} onPatch={onPatch} />
          </tbody>
        </table>
      </div>
    </section>
  );
}
