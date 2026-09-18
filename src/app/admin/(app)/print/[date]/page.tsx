import { notFound } from 'next/navigation';
import { requireSession, resolveStore } from '@/lib/admin';
import { getGlobalSetting } from '@/lib/settings';
import { loadDay } from '@/lib/dayData';
import { formatDateJa, isValidDate, minToHm } from '@/lib/time';
import { isPatientText } from '@/lib/availability';
import { NOON } from '@/lib/hours';
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
  for (const c of d.cells) if (isPatientText(c.text)) { if (c.time < NOON) am++; else pm++; }
  const cols = d.beds;
  const staffLine = (label: string, names: string[]) => {
    const n = names.filter((x) => x.trim());
    return n.length ? `${label}：${n.join('・')}` : `${label}：－`;
  };

  return (
    <main className="mx-auto max-w-[190mm] bg-white p-4 text-[11px] print:p-0">
      <PrintButton />
      <div className="mb-2 flex items-end justify-between">
        <h1 className="text-lg font-bold">《予約表》 {store.name}</h1>
        <div className="text-sm">午前 <b>{am}</b> 名　午後 <b>{pm}</b> 名　合計 <b>{am + pm}</b> 名</div>
      </div>
      <div className="mb-1 text-base font-bold">{formatDateJa(date)}</div>
      <div className="mb-2 flex flex-wrap gap-x-4 text-[10px] text-slate-700">
        <span>{staffLine('施術者', d.therapists)}（{d.capacity} 枠）</span>
        <span>{staffLine('受付', d.reception)}</span>
      </div>
      {d.times.length === 0 ? <p>休診日</p> : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-14 border border-black px-1">時間</th>
              {cols.map((b) => <th key={b} className={`border border-black px-1 ${b > d.capacity ? 'bg-slate-200' : ''}`}>{b}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.times.map((t, r) => (
              <tr key={t} className={r > 0 && d.times[r - 1] < NOON && t >= NOON ? 'border-t-2 border-t-black' : ''}>
                <td className="border border-black px-1 text-center font-mono">{minToHm(t)}</td>
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
