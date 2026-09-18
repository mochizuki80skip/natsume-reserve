'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { WEEKDAY_JA, weekdayOf } from '@/lib/time';
import { SHIFT_LABEL, SHIFT_STATUSES, worksAm, worksPm, type ShiftStatus } from '@/lib/settings';

interface Member { id: string; name: string; role: string }
interface Props { month: string; dates: string[]; closedDates: string[]; members: Member[]; shifts: { staffId: string; date: string; status: string }[] }

function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export default function ShiftTable({ month, dates, closedDates, members, shifts }: Props) {
  const [map, setMap] = useState<Map<string, string>>(() => new Map(shifts.map((s) => [`${s.staffId}:${s.date}`, s.status])));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const closed = useMemo(() => new Set(closedDates), [closedDates]);
  const therapists = members.filter((m) => m.role === 'THERAPIST');
  const reception = members.filter((m) => m.role === 'RECEPTION');

  async function save(staffId: string, date: string, status: string) {
    const k = `${staffId}:${date}`;
    setMap((m) => { const n = new Map(m); if (!status || status === 'WORK') n.delete(k); else n.set(k, status); return n; });
    setState('saving');
    const r = await fetch('/api/admin/shifts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId, date, status }) });
    setState(r.ok ? 'saved' : 'error');
  }

  const capFor = (date: string, am: boolean) => therapists.filter((m) => (am ? worksAm : worksPm)(map.get(`${m.id}:${date}`))).length;

  const Rows = ({ list, label }: { list: Member[]; label: string }) => (
    <>
      <tr className="bg-slate-100"><td colSpan={dates.length + 1} className="px-2 py-0.5 text-xs font-bold text-slate-600">{label}</td></tr>
      {list.map((m) => (
        <tr key={m.id}>
          <td className="sticky left-0 z-10 whitespace-nowrap border bg-white px-2 py-0.5 font-medium">{m.name}</td>
          {dates.map((d) => {
            const v = map.get(`${m.id}:${d}`) ?? 'WORK';
            const isClosed = closed.has(d);
            return (
              <td key={d} className={`border p-0 ${isClosed ? 'bg-slate-200' : v === 'WORK' ? '' : v.startsWith('AM') || v.startsWith('PM') ? 'bg-amber-50' : 'bg-red-50'}`}>
                {isClosed ? <span className="block text-center text-[10px] text-slate-400">休診</span> : (
                  <select value={v} onChange={(e) => save(m.id, d, e.target.value)} aria-label={`${m.name} ${d}`}
                    className="h-7 w-full appearance-none bg-transparent text-center text-xs outline-none focus:bg-yellow-50">
                    {SHIFT_STATUSES.map((st) => <option key={st} value={st}>{SHIFT_LABEL[st as ShiftStatus]}</option>)}
                  </select>
                )}
              </td>
            );
          })}
        </tr>
      ))}
      {list.length === 0 && <tr><td colSpan={dates.length + 1} className="px-2 py-1 text-xs text-slate-400">店舗設定でスタッフを登録してください</td></tr>}
    </>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`/admin/shifts?month=${shiftMonth(month, -1)}`} className="rounded border bg-white px-3 py-1">‹ 前月</Link>
        <h1 className="text-xl font-bold">シフト表 {Number(month.slice(0, 4))}年{Number(month.slice(5))}月</h1>
        <Link href={`/admin/shifts?month=${shiftMonth(month, 1)}`} className="rounded border bg-white px-3 py-1">翌月 ›</Link>
        <Link href="/admin/settings" className="text-sm text-brand underline">スタッフの追加・変更</Link>
        <span className="ml-auto text-xs text-slate-500">{state === 'saving' ? '保存中…' : state === 'saved' ? '保存しました' : state === 'error' ? '保存に失敗しました' : '選ぶと自動保存されます'}</span>
      </div>
      <p className="mb-2 text-xs text-slate-600">
        未入力＝〇（終日勤務）。前休・前有＝午前の枠を1つ減らす／後休・後有＝午後の枠を1つ減らす／休・有給＝終日減らす。
        一番下の行が、顧客に見える枠数（午前／午後）です。
      </p>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100">
              <th className="sticky left-0 z-10 border bg-slate-100 px-2 py-1">氏名</th>
              {dates.map((d) => {
                const w = weekdayOf(d);
                return (
                  <th key={d} className={`w-12 border px-0.5 py-1 text-center text-xs font-normal ${w === 0 ? 'text-red-600' : w === 6 ? 'text-blue-600' : ''} ${closed.has(d) ? 'bg-slate-200' : ''}`}>
                    <span className="block font-bold">{Number(d.slice(8))}</span>{WEEKDAY_JA[w]}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <Rows list={therapists} label="施術者" />
            <Rows list={reception} label="受付" />
            <tr className="bg-brand-light font-bold">
              <td className="sticky left-0 z-10 whitespace-nowrap border bg-brand-light px-2 py-0.5">枠数 午前／午後</td>
              {dates.map((d) => (
                <td key={d} className="whitespace-nowrap border px-0.5 py-0.5 text-center text-xs tabular-nums">
                  {closed.has(d) ? '－' : `${capFor(d, true)}／${capFor(d, false)}`}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
