import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WEEKDAY_JA, weekdayOf } from '@/lib/time';
import { HELP_IN_LABEL, HELP_IN_STATUSES, SHIFT_LABEL, SHIFT_STATUSES, inPeriod, joinBadge, worksAm, worksPm, type ShiftStatus } from '@/lib/shifts';

interface Member { id: string; name: string; role: string; startDate?: string | null; endDate?: string | null; joinType?: string | null }
interface HelpIn { date: string; status: string; name: string }
interface Props {
  month: string; dates: string[]; closedDates: string[]; members: Member[]; shifts: { staffId: string; date: string; status: string }[];
  helpIn: HelpIn[]; hasTherapists: boolean; defaultActiveBeds: number; beds: number;
}
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export default function ShiftTable({ month, dates, closedDates, members, shifts, helpIn, hasTherapists, defaultActiveBeds, beds }: Props) {
  const [map, setMap] = useState<Map<string, string>>(() => new Map(shifts.map((s) => [`${s.staffId}:${s.date}`, s.status])));
  const [help, setHelp] = useState<Map<string, HelpIn>>(() => new Map(helpIn.map((h) => [h.date, h])));
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

  // 他店からの応援（1 日 1 行）。誰が来るか未定なら名前は空のままでよい
  async function saveHelp(date: string, status: string, name: string) {
    setHelp((m) => { const n = new Map(m); if (!status) n.delete(date); else n.set(date, { date, status, name }); return n; });
    setState('saving');
    const r = await fetch('/api/admin/help-in', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, status, name }) });
    setState(r.ok ? 'saved' : 'error');
  }

  // 顧客に見える枠数：所属期間内で勤務の施術者の数（未登録なら既定値）＋応援
  const capFor = (date: string, am: boolean) => {
    const base = hasTherapists
      ? therapists.filter((m) => inPeriod(m, date) && (am ? worksAm : worksPm)(map.get(`${m.id}:${date}`))).length
      : defaultActiveBeds;
    const h = help.get(date)?.status;
    const plus = h && (h === 'HELP_IN' || h === (am ? 'AM_HELP_IN' : 'PM_HELP_IN')) ? 1 : 0;
    return Math.min(base + plus, beds);
  };
  const first = dates[0];
  const last = dates[dates.length - 1];

  const Rows = ({ list, label }: { list: Member[]; label: string }) => (
    <>
      <tr className="bg-slate-100"><td colSpan={dates.length + 1} className="px-2 py-0.5 text-xs font-bold text-slate-600">{label}</td></tr>
      {list.map((m) => (
        <tr key={m.id}>
          <td className="sticky left-0 z-10 whitespace-nowrap border bg-white px-2 py-0.5 font-medium">
            {m.name}
            {(() => {
              const b = joinBadge(m, first, last);
              return b && <span className={`ml-1 rounded px-1 text-[10px] font-bold text-white ${b === '新人' ? 'bg-green-600' : 'bg-violet-600'}`}>{b}</span>;
            })()}
            {m.startDate && m.startDate > first && <span className="ml-1 text-[10px] font-normal text-slate-500">{md(m.startDate)}〜</span>}
            {m.endDate && m.endDate < last && <span className="ml-1 text-[10px] font-normal text-slate-500">〜{md(m.endDate)}</span>}
          </td>
          {dates.map((d) => {
            const v = map.get(`${m.id}:${d}`) ?? 'WORK';
            const isClosed = closed.has(d);
            if (!inPeriod(m, d)) {
              return <td key={d} className="border bg-slate-100 p-0" title="所属期間外（入社前・異動後）"><span className="block text-center text-[10px] text-slate-400">－</span></td>;
            }
            return (
              <td key={d} className={`border p-0 ${isClosed ? 'bg-slate-200' : v === 'WORK' ? '' : v.endsWith('HELP') ? 'bg-sky-50' : v.startsWith('AM') || v.startsWith('PM') ? 'bg-amber-50' : 'bg-red-50'}`}>
                {isClosed ? <span className="block whitespace-nowrap text-center text-[10px] text-slate-400">休診</span> : (
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
        <Link to={`/admin/shifts?month=${shiftMonth(month, -1)}`} className="rounded border bg-white px-3 py-1">‹ 前月</Link>
        <h1 className="text-xl font-bold">シフト表 {Number(month.slice(0, 4))}年{Number(month.slice(5))}月</h1>
        <Link to={`/admin/shifts?month=${shiftMonth(month, 1)}`} className="rounded border bg-white px-3 py-1">翌月 ›</Link>
        <Link to="/admin/settings" className="text-sm text-brand underline">スタッフの追加・変更</Link>
        <span className="ml-auto text-xs text-slate-500">{state === 'saving' ? '保存中…' : state === 'saved' ? '保存しました' : state === 'error' ? '保存に失敗しました' : '選ぶと自動保存されます'}</span>
      </div>
      <p className="mb-2 text-xs text-slate-600">
        未入力＝〇（終日勤務）。前休・前有＝午前の枠を1つ減らす／後休・後有＝午後の枠を1つ減らす／休・有給＝終日減らす。スタッフの行のヘルプ（他店へ出張）も同じで、前ヘルプ＝午前／後ヘルプ＝午後／ヘルプ＝終日減らす。
        下の「ヘルプ（他店から）」の行は、他店から来る人の分で、前ヘルプ＝午前／後ヘルプ＝午後／ヘルプ＝終日、枠を1つ増やします。灰色の「－」は所属期間外（入社前・異動後）です。
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
            <tr className="bg-slate-100"><td colSpan={dates.length + 1} className="px-2 py-0.5 text-xs font-bold text-slate-600">ヘルプ（他店から来る人。誰が来るか未定なら名前は空欄でOK）</td></tr>
            <tr>
              <td className="sticky left-0 z-10 whitespace-nowrap border bg-white px-2 py-0.5 font-medium">ヘルプ（他店から）</td>
              {dates.map((d) => {
                const h = help.get(d);
                const isClosed = closed.has(d);
                return (
                  <td key={d} className={`border p-0 align-top ${isClosed ? 'bg-slate-200' : h ? 'bg-emerald-50' : ''}`}>
                    {isClosed ? <span className="block whitespace-nowrap text-center text-[10px] text-slate-400">休診</span> : (
                      <>
                        <select value={h?.status ?? ''} onChange={(e) => saveHelp(d, e.target.value, h?.name ?? '')} aria-label={`他店からのヘルプ ${d}`}
                          className="h-7 w-full appearance-none bg-transparent text-center text-xs outline-none focus:bg-yellow-50">
                          <option value="">－</option>
                          {HELP_IN_STATUSES.map((st) => <option key={st} value={st}>{HELP_IN_LABEL[st]}</option>)}
                        </select>
                        {h && (
                          <input key={`${d}:${h.status}`} defaultValue={h.name} placeholder="名前" maxLength={30} aria-label={`他店からのヘルプの名前 ${d}`}
                            onBlur={(e) => e.target.value.trim() !== h.name && saveHelp(d, h.status, e.target.value.trim())}
                            className="block w-full min-w-[3.5rem] border-t bg-transparent px-0.5 text-center text-[10px] outline-none focus:bg-yellow-50" />
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
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
