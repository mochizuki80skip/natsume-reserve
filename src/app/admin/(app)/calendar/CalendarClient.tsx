'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WEEKDAY_JA, weekdayOf } from '@/lib/time';

interface Day { date: string; published: boolean | null; closed: boolean; businessDay: boolean; effectivePublished: boolean }
interface Props { month: string; today: string; days: Day[]; publishDaysAhead: number }

function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export default function CalendarClient({ month, today, days, publishDaysAhead }: Props) {
  const router = useRouter();
  const [state, setState] = useState(days);
  const [mode, setMode] = useState<'publish' | 'unpublish' | 'auto' | 'closed'>('publish');
  const lead = weekdayOf(`${month}-01`);

  async function apply(d: Day) {
    const patch = mode === 'closed'
      ? { closed: !d.closed }
      : { published: mode === 'publish' ? true : mode === 'unpublish' ? false : null };
    const r = await fetch('/api/admin/days', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: d.date, ...patch }) });
    if (r.ok) {
      setState((s) => s.map((x) => (x.date === d.date ? { ...x, ...patch } : x)));
      router.refresh();
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`/admin/calendar?month=${shiftMonth(month, -1)}`} className="rounded border bg-white px-3 py-1">‹ 前月</Link>
        <h1 className="text-xl font-bold">{Number(month.slice(0, 4))}年{Number(month.slice(5))}月</h1>
        <Link href={`/admin/calendar?month=${shiftMonth(month, 1)}`} className="rounded border bg-white px-3 py-1">翌月 ›</Link>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded border bg-white p-2 text-sm">
        <span>日付をクリックしたときの操作：</span>
        {([['publish', '公開する'], ['unpublish', '非公開にする'], ['auto', '既定に戻す'], ['closed', '臨時休診の切替']] as const).map(([v, l]) => (
          <label key={v} className="flex items-center gap-1"><input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} />{l}</label>
        ))}
        <span className="ml-auto text-xs text-slate-500">既定：今日から {publishDaysAhead} 日先まで公開（店舗設定で変更）</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {WEEKDAY_JA.map((w, i) => <div key={w} className={`py-1 text-xs ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-600' : 'text-slate-500'}`}>{w}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
        {state.map((d) => {
          const past = d.date < today;
          const cls = d.closed ? 'bg-red-50 border-red-200 text-red-700'
            : !d.businessDay ? 'bg-slate-100 border-slate-100 text-slate-400'
            : d.effectivePublished ? 'bg-green-50 border-green-300'
            : 'bg-white border-slate-200 text-slate-500';
          return (
            <button key={d.date} type="button" disabled={past} onClick={() => apply(d)}
              className={`flex h-20 flex-col items-center justify-center rounded border ${cls} ${past ? 'opacity-50' : 'hover:ring-2 hover:ring-brand'}`}>
              <span className="text-base font-bold">{Number(d.date.slice(8))}</span>
              <span className="text-xs">
                {d.closed ? '臨時休診' : !d.businessDay ? '休診' : d.effectivePublished ? '公開' : '非公開'}
                {d.published !== null && !d.closed && d.businessDay ? '(個別)' : ''}
              </span>
              <Link href={`/admin/day/${d.date}`} className="mt-1 text-[10px] text-brand underline" onClick={(e) => e.stopPropagation()}>予約表</Link>
            </button>
          );
        })}
      </div>
    </div>
  );
}
