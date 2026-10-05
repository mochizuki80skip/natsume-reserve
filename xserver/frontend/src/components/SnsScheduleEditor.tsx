// 投稿の頻度（毎週○曜／毎月第○○曜 ＋ 時刻）の入力
import { WEEKDAY_JA } from '@/lib/time';
import type { Schedule } from '@/lib/sns';

export default function SnsScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const time = `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
  const setTime = (t: string) => { const [h, m] = t.split(':').map(Number); onChange({ ...value, hour: h, minute: m }); };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={value.type} onChange={(e) => onChange(e.target.value === 'weekly' ? { type: 'weekly', weekdays: [4], hour: value.hour, minute: value.minute } : { type: 'monthly', nth: 2, weekday: 6, hour: value.hour, minute: value.minute })} className="rounded border px-2 py-1">
        <option value="weekly">毎週</option>
        <option value="monthly">毎月</option>
      </select>
      {value.type === 'weekly' ? (
        <span className="flex flex-wrap gap-1">
          {WEEKDAY_JA.map((w, i) => (
            <label key={i} className={`cursor-pointer rounded border px-2 py-1 ${value.weekdays.includes(i) ? 'bg-brand text-white' : 'bg-white'}`}>
              <input type="checkbox" className="hidden" checked={value.weekdays.includes(i)} onChange={(e) => {
                const wd = e.target.checked ? [...value.weekdays, i] : value.weekdays.filter((d) => d !== i);
                if (wd.length) onChange({ ...value, weekdays: wd.sort() });
              }} />{w}
            </label>
          ))}
        </span>
      ) : (
        <>
          <select value={value.nth} onChange={(e) => onChange({ ...value, nth: Number(e.target.value) })} className="rounded border px-2 py-1">
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>第{n}</option>)}
          </select>
          <select value={value.weekday} onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })} className="rounded border px-2 py-1">
            {WEEKDAY_JA.map((w, i) => <option key={i} value={i}>{w}曜</option>)}
          </select>
        </>
      )}
      <input type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className="rounded border px-2 py-1" />
    </div>
  );
}
