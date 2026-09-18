import { notFound } from 'next/navigation';
import { requireSession, resolveStore } from '@/lib/admin';
import { getGlobalSetting } from '@/lib/settings';
import { loadDay } from '@/lib/dayData';
import { formatDateJa, isValidDate, minToHm } from '@/lib/time';
import { isPatientText } from '@/lib/availability';
import { isAm } from '@/lib/hours';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

export default async function PrintPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();
  const session = await requireSession();
  const store = await resolveStore(session);
  if (!store) notFound();
  const setting = await getGlobalSetting();
  const d = await loadDay(store, setting, date);
  const cell = new Map(d.cells.map((c) => [`${c.time}:${c.bed}`, c.text]));
  let am = 0, pm = 0;
  for (const c of d.cells) if (isPatientText(c.text)) { if (isAm(d.sessions, c.time)) am++; else pm++; }
  const cols = d.beds;
  const names = (n: string[]) => (n.length ? n.join('・') : '－');

  return (
    <main className="mx-auto max-w-[190mm] bg-white p-4 text-[11px] print:p-0">
      <PrintButton />
      <div className="mb-2 flex items-end justify-between">
        <h1 className="text-lg font-bold">《予約表》 {store.name}</h1>
        <div className="text-sm">午前 <b>{am}</b> 名　午後 <b>{pm}</b> 名　合計 <b>{am + pm}</b> 名</div>
      </div>
      <div className="mb-1 text-base font-bold">{formatDateJa(date)}</div>
      <div className="mb-2 flex flex-wrap gap-x-4 text-[10px] text-slate-700">
        <span>午前：{names(d.capacity.namesAm)}（{d.capacity.am} 枠）</span>
        <span>午後：{names(d.capacity.namesPm)}（{d.capacity.pm} 枠）</span>
        <span>受付：{names(d.receptionNames)}</span>
      </div>
      {d.times.length === 0 ? <p>休診日</p> : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-14 border border-black px-1">時間</th>
              {cols.map((b) => <th key={b} className={`border border-black px-1 ${b > Math.max(d.capacity.am, d.capacity.pm) ? 'bg-slate-200' : ''}`}>{b}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.times.map((t, r) => (
              <tr key={t} className={r > 0 && isAm(d.sessions, d.times[r - 1]) && !isAm(d.sessions, t) ? 'border-t-2 border-t-black' : ''}>
                <td className={`border border-black px-1 text-center font-mono ${d.customerTimes.includes(t) ? '' : 'bg-slate-100'}`}>{minToHm(t)}</td>
                {cols.map((b) => <td key={b} className="h-[5.2mm] border border-black px-1">{cell.get(`${t}:${b}`) ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.day.memo && <div className="mt-2 whitespace-pre-wrap border border-black p-1"><b>メモ：</b>{d.day.memo}</div>}
    </main>
  );
}
