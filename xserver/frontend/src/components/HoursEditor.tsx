// 店舗ごとの営業時間（期間つき）の入力。空なら全店共通の営業時間を使う
import { useState } from 'react';
import { WEEK_LABEL, WEEK_ORDER, emptyDays, toForm, toJson, type DayForm, type PeriodForm, type Range } from '@/lib/hoursForm';

interface Props { value: string; globalHours: string; slotMinutes: number; onChange: (json: string, error?: string) => void }

const tIn = 'w-[6.6rem] rounded border px-1 py-0.5 text-sm';

export default function HoursEditor({ value, globalHours, slotMinutes, onChange }: Props) {
  const initial = toForm(value, slotMinutes);
  const [periods, setPeriods] = useState<PeriodForm[]>(initial ?? []);
  const [err, setErr] = useState('');
  const [quick, setQuick] = useState<{ am: [string, string]; pm: [string, string] }>({ am: ['09:00', '12:00'], pm: ['15:00', '19:30'] });
  if (initial === null) {
    return <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">この店舗の営業時間は、1日に3つ以上の時間帯があるため、この画面では編集できません。下の「詳しい設定（JSON）」で編集してください。</p>;
  }
  const update = (next: PeriodForm[]) => {
    setPeriods(next);
    const r = toJson(next, slotMinutes);
    setErr(r.error ?? '');
    onChange(r.json, r.error);
  };
  const setP = (i: number, p: Partial<PeriodForm>) => update(periods.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setDay = (i: number, d: string, v: Partial<DayForm>) => setP(i, { days: { ...periods[i].days, [d]: { ...periods[i].days[d], ...v } } });
  const fill = (i: number, days: string[]) => {
    const next = { ...periods[i].days };
    for (const d of WEEK_ORDER) next[d] = days.includes(d) ? { closed: false, am: [...quick.am] as Range, pm: [...quick.pm] as Range } : { closed: true, am: null, pm: null };
    setP(i, { days: next });
  };
  const globalForm = toForm(globalHours, slotMinutes);
  const copyGlobal = () => {
    const g = globalForm?.[globalForm.length - 1];
    update([...periods, { from: '', to: '', days: g ? structuredClone(g.days) : emptyDays() }]);
  };
  const rangeIn = (i: number, d: string, k: 'am' | 'pm') => {
    const r = periods[i].days[d][k] ?? ['', ''];
    const set = (n: 0 | 1, v: string) => { const x: [string, string] = [r[0], r[1]]; x[n] = v; setDay(i, d, { [k]: x[0] || x[1] ? x : null }); };
    return (
      <span className="inline-flex items-center gap-1">
        <input type="time" step={slotMinutes * 60} value={r[0]} onChange={(e) => set(0, e.target.value)} className={tIn} aria-label={`${WEEK_LABEL[d]} ${k === 'am' ? '午前' : '午後'} 開始`} />〜
        <input type="time" step={slotMinutes * 60} value={r[1]} onChange={(e) => set(1, e.target.value)} className={tIn} aria-label={`${WEEK_LABEL[d]} ${k === 'am' ? '午前' : '午後'} 終了`} />
      </span>
    );
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-600">
        何も入れなければ、全店共通の営業時間を使います。期間を入れると、<b>その期間の日だけ</b>この店舗の営業時間になり、期間の外の日は全店共通に戻ります。
        （例：「〜2026/10/20」だけ入れる → 10/20 まではこの店舗の時間、10/21 からは全店共通）
      </p>
      {periods.map((p, i) => (
        <div key={i} className="rounded border bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <b>期間{i + 1}</b>
            <input type="date" value={p.from} onChange={(e) => setP(i, { from: e.target.value })} className="rounded border px-1 py-0.5" aria-label="開始日" />〜
            <input type="date" value={p.to} onChange={(e) => setP(i, { to: e.target.value })} className="rounded border px-1 py-0.5" aria-label="終了日" />
            <span className="text-xs text-slate-500">（空欄＝制限なし）</span>
            <button type="button" onClick={() => update(periods.filter((_, j) => j !== i))} className="ml-auto text-xs text-red-700">この期間を削除</button>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1.5 text-xs">
            <span className="font-bold">まとめて入力</span>
            午前<input type="time" step={slotMinutes * 60} value={quick.am[0]} onChange={(e) => setQuick({ ...quick, am: [e.target.value, quick.am[1]] })} className={tIn} />〜<input type="time" step={slotMinutes * 60} value={quick.am[1]} onChange={(e) => setQuick({ ...quick, am: [quick.am[0], e.target.value] })} className={tIn} />
            午後<input type="time" step={slotMinutes * 60} value={quick.pm[0]} onChange={(e) => setQuick({ ...quick, pm: [e.target.value, quick.pm[1]] })} className={tIn} />〜<input type="time" step={slotMinutes * 60} value={quick.pm[1]} onChange={(e) => setQuick({ ...quick, pm: [quick.pm[0], e.target.value] })} className={tIn} />
            <button type="button" onClick={() => fill(i, ['1', '2', '3', '4', '5', '6'])} className="rounded border bg-white px-2 py-0.5">月〜土に入れる</button>
            <button type="button" onClick={() => fill(i, ['1', '2', '3', '4', '5'])} className="rounded border bg-white px-2 py-0.5">月〜金に入れる</button>
          </div>
          <table className="text-sm">
            <thead><tr className="text-xs text-slate-500"><th className="pr-2 text-left">曜日</th><th className="pr-3">休診</th><th className="pr-3 text-left">午前（開始〜終了）</th><th className="text-left">午後（開始〜終了）</th></tr></thead>
            <tbody>
              {WEEK_ORDER.map((d) => {
                const day = p.days[d];
                return (
                  <tr key={d} className={day.closed ? 'text-slate-400' : ''}>
                    <td className={`py-0.5 pr-2 font-bold ${d === '0' ? 'text-red-600' : d === '6' ? 'text-blue-600' : ''}`}>{WEEK_LABEL[d]}</td>
                    <td className="pr-3 text-center"><input type="checkbox" checked={day.closed} onChange={(e) => setDay(i, d, { closed: e.target.checked })} aria-label={`${WEEK_LABEL[d]}曜 休診`} /></td>
                    <td className="pr-3">{day.closed ? '－' : rangeIn(i, d, 'am')}</td>
                    <td>{day.closed ? '－' : rangeIn(i, d, 'pm')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {err && <p className="rounded bg-red-50 px-3 py-1 text-xs text-red-700">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => update([...periods, { from: '', to: '', days: emptyDays() }])} className="rounded border bg-white px-3 py-1 text-xs">＋ 期間を追加（空から）</button>
        {globalForm && globalForm.length > 0 && <button type="button" onClick={copyGlobal} className="rounded border bg-white px-3 py-1 text-xs">＋ 期間を追加（全店共通の時間を写す）</button>}
      </div>
      <p className="text-xs text-slate-500">終了は「最後の受付が終わる時刻」で入れます（例：午前 9:00〜12:00 → 最後の枠は 11:45）。祝日の休診は全店共通設定に従います。入力したら一番下の「保存」を押してください。</p>
    </div>
  );
}
