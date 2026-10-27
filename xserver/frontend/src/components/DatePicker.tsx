// 日付をえらぶカレンダー（予約表の上）。ブラウザの日付入力は、カレンダーで月を送ると「翌月の同じ日」が選ばれて
// その日へ移動してしまうので、月を送るだけでは移動せず、日を押したときだけ移動する自前のカレンダーにする
import { useEffect, useRef, useState } from 'react';
import { WEEKDAY_JA, addDays, weekdayOf } from '@/lib/time';

const ym = (d: string) => d.slice(0, 7);
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1 + n, 1)); return t.toISOString().slice(0, 7); };

export default function DatePicker({ value, today, onSelect, className }: { value: string; today: string; onSelect: (d: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(ym(value));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) setMonth(ym(value)); }, [value, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const first = `${month}-01`;
  const lead = weekdayOf(first); // 日曜はじまり
  const days: (string | null)[] = [...Array.from({ length: lead }, () => null)];
  for (let d = first; ym(d) === month; d = addDays(d, 1)) days.push(d);
  const pick = (d: string) => { setOpen(false); if (d !== value) onSelect(d); };

  return (
    <div ref={ref} className="relative max-sm:min-w-0 max-sm:flex-1">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label="日付を選ぶ"
        className={className ?? 'rounded border bg-white px-2 py-1 tabular-nums'}>
        {value.replaceAll('-', '/')} <span aria-hidden>📅</span>
      </button>
      {open && (
        <div role="dialog" aria-label="カレンダー" className="absolute left-0 top-full z-40 mt-1 w-64 rounded border bg-white p-2 text-sm shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded border px-2" aria-label="前の月">‹</button>
            <b>{Number(month.slice(0, 4))}年{Number(month.slice(5))}月</b>
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded border px-2" aria-label="次の月">›</button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] text-slate-500">{WEEKDAY_JA.map((w, i) => <span key={w} className={i === 0 ? 'text-red-600' : i === 6 ? 'text-blue-600' : ''}>{w}</span>)}</div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {days.map((d, i) => d === null ? <span key={`e${i}`} /> : (
              <button key={d} type="button" onClick={() => pick(d)} aria-label={d} aria-current={d === value ? 'date' : undefined}
                className={`rounded py-1 tabular-nums ${d === value ? 'bg-brand font-bold text-white' : d === today ? 'border border-brand text-brand-dark' : 'hover:bg-brand-light'} ${d !== value && weekdayOf(d) === 0 ? 'text-red-600' : d !== value && weekdayOf(d) === 6 ? 'text-blue-600' : ''}`}>
                {Number(d.slice(8))}
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs">
            <button type="button" onClick={() => pick(today)} className="rounded border px-2 py-0.5">今日</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded border px-2 py-0.5">閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}
