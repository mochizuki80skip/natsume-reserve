
import { useEffect, useMemo, useRef, useState } from 'react';
import { WEEKDAY_JA, addDays, diffDays, minToHm, weekdayOf } from '@/lib/time';
import { NOON } from '@/lib/hours';

export type Kind = 'NEW' | 'RETURN';
type SlotStatus = 'open' | 'phone' | 'closed';
export interface WeekDay { date: string; label: string | null; slots: { time: number; status: SlotStatus }[] }
export interface WeekData { today: string; weekStart: string; publishDaysAhead: number; days: WeekDay[] }
export interface Selection { date: string; time: number; status: SlotStatus }

interface Props {
  storeCode: string;
  kind: Kind;
  onKindChange: (k: Kind) => void;
  onProceed: (sel: Selection) => void;
  phone: string;
}

const KIND_LABEL: Record<Kind, string> = { NEW: '① はじめての方', RETURN: '② ご通院中の方' };

function md(date: string) { return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`; }

export default function WeekGrid({ storeCode, kind, onKindChange, onProceed, phone }: Props) {
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [data, setData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Selection | null>(null);
  const headRef = useRef<HTMLDivElement>(null);

  // 固定ヘッダーの高さを測って、曜日行の固定位置に反映
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--wk-head-h', `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    const q = new URLSearchParams({ kind });
    if (weekStart) q.set('start', weekStart);
    fetch(`/api/public/${encodeURIComponent(storeCode)}/week?${q}`)
      .then((r) => r.json())
      .then((j: WeekData) => { if (!alive) return; setData(j); if (!weekStart) setWeekStart(j.weekStart); })
      .catch(() => alive && setError('読み込みに失敗しました'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [storeCode, kind, weekStart]);

  useEffect(() => { setSel(null); }, [kind, weekStart]);

  const rows = useMemo(() => {
    if (!data) return [] as number[];
    const set = new Set<number>();
    for (const d of data.days) for (const s of d.slots) set.add(s.time);
    return Array.from(set).sort((a, b) => a - b);
  }, [data]);

  const statusMap = useMemo(() => {
    const m = new Map<string, SlotStatus>();
    if (data) for (const d of data.days) for (const s of d.slots) m.set(`${d.date}:${s.time}`, s.status);
    return m;
  }, [data]);

  const days = data?.days ?? [];
  const amRows = rows.filter((t) => t < NOON).length;
  const pmRows = rows.length - amRows;
  const prevDisabled = !data || days.length === 0 || days[0].date <= data.today;
  const nextDisabled = !data || days.length === 0 || diffDays(data.today, days[6].date) >= data.publishDaysAhead;
  const phoneHref = `tel:${phone.replace(/[^\d+]/g, '')}`;

  return (
    <div className={sel ? 'pb-28' : ''}>
      <div className="wk-head" ref={headRef}>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="来院区分">
          {(['NEW', 'RETURN'] as Kind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => onKindChange(k)}
              className={`rounded-lg border-2 border-brand px-1.5 py-2 text-[12.5px] font-semibold leading-tight ${kind === k ? 'bg-brand text-white' : 'bg-white text-brand-dark'}`}>
              {KIND_LABEL[k]}
              <span className="block text-[10.5px] font-normal opacity-85">{k === 'NEW' ? '1ヶ月以上ご来院の無い方・30分枠' : '診察券番号をご用意ください'}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <button type="button" disabled={prevDisabled} onClick={() => weekStart && setWeekStart(addDays(weekStart, -7))} className="rounded border bg-white px-2.5 py-1.5 text-sm disabled:opacity-40">‹ 前週</button>
          <div className="text-[15px] font-bold tabular-nums">
            {days.length ? `${md(days[0].date)}（${WEEKDAY_JA[weekdayOf(days[0].date)]}）〜 ${md(days[6].date)}（${WEEKDAY_JA[weekdayOf(days[6].date)]}）` : ''}
          </div>
          <button type="button" disabled={nextDisabled} onClick={() => weekStart && setWeekStart(addDays(weekStart, 7))} className="rounded border bg-white px-2.5 py-1.5 text-sm disabled:opacity-40">翌週 ›</button>
        </div>
        <div className="wk-legend" aria-label="記号の意味">
          <span><span className="o">〇</span> WEB予約できます</span>
          <span><span className="p">📞</span> 残りわずか／直前のためお電話で</span>
          <span><span className="x">×</span> 空きなし・受付終了</span>
          <span><span className="sw" /> 定休日・祝日</span>
        </div>
      </div>

      {error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="wk-wrap">
        <table className="wk" aria-label="1週間の空き状況">
          <thead>
            <tr>
              <th className="time">時間</th>
              {days.map((d) => {
                const w = weekdayOf(d.date);
                return <th key={d.date} className={w === 0 ? 'sun' : w === 6 ? 'sat' : ''}><span className="d">{md(d.date)}</span>{WEEKDAY_JA[w]}{d.label === '祝日' ? '・祝' : ''}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={8} className="py-6 text-sm text-slate-500">この週は受付しておりません。</td></tr>
            )}
            {rows.map((t, ri) => {
              const isPmStart = ri > 0 && rows[ri - 1] < NOON && t >= NOON;
              return (
                <RowGroup key={t} t={t} ri={ri} isPmStart={isPmStart} days={days} amRows={amRows} pmRows={pmRows} statusMap={statusMap} sel={sel}
                  onPick={(date, time, status) => setSel({ date, time, status })} />
              );
            })}
          </tbody>
        </table>
      </div>
      {loading && <p className="mt-2 text-sm text-slate-500">読み込み中…</p>}

      {sel && (
        <div className="wk-sheet" aria-live="polite">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="min-w-0 flex-1">
              <b className="block text-base">{md(sel.date)}（{WEEKDAY_JA[weekdayOf(sel.date)]}）{minToHm(sel.time)}〜</b>
              <span className="text-xs text-slate-500">{sel.status === 'open' ? (kind === 'NEW' ? '① はじめての方（30分）' : '② ご通院中の方（15分）') : '残りわずか／直前のためお電話でご予約ください'}</span>
            </div>
            {sel.status === 'open'
              ? <button type="button" onClick={() => onProceed(sel)} className="whitespace-nowrap rounded-lg bg-brand px-4 py-3 text-sm font-bold text-white">この日時で予約へ進む</button>
              : <a href={phoneHref} className="whitespace-nowrap rounded-lg bg-amber-700 px-4 py-3 text-sm font-bold text-white">📞 {phone}</a>}
            <button type="button" onClick={() => setSel(null)} aria-label="閉じる" className="px-1 text-xl text-slate-500">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RowGroup({ t, ri, isPmStart, days, amRows, pmRows, statusMap, sel, onPick }: {
  t: number; ri: number; isPmStart: boolean; days: WeekDay[]; amRows: number; pmRows: number;
  statusMap: Map<string, SlotStatus>; sel: Selection | null; onPick: (date: string, time: number, status: SlotStatus) => void;
}) {
  const cells = days.map((d) => {
    if (d.label) {
      if (ri === 0) return <td key={d.date} className="closedcol" rowSpan={amRows}><span className="v">{d.label.split('').map((ch, i) => <span key={i}>{ch}<br /></span>)}</span></td>;
      if (isPmStart) return <td key={d.date} className="closedcol" rowSpan={pmRows}><span className="v">{d.label.split('').map((ch, i) => <span key={i}>{ch}<br /></span>)}</span></td>;
      return null;
    }
    const st = statusMap.get(`${d.date}:${t}`);
    if (!st) return <td key={d.date} className="blank" />;
    if (st === 'closed') return <td key={d.date} className="slot x">×</td>;
    const isSel = sel && sel.date === d.date && sel.time === t;
    return (
      <td key={d.date} className={`slot ${st === 'open' ? 'o' : 'p'} ${isSel ? 'sel' : ''}`}>
        <button type="button" onClick={() => onPick(d.date, t, st)} aria-label={`${md(d.date)} ${minToHm(t)} ${st === 'open' ? '予約できます' : 'お電話でご予約ください'}`}>
          {st === 'open' ? '〇' : '📞'}
        </button>
      </td>
    );
  });
  return (
    <>
      {ri === 0 && <tr className="band"><td className="time">午前</td><td colSpan={7}>{rangeText(days, true)}</td></tr>}
      {isPmStart && <tr className="band"><td className="time">午後</td><td colSpan={7}>{rangeText(days, false)}</td></tr>}
      <tr className={isPmStart ? 'pmstart' : ''}>
        <td className="time">{minToHm(t)}</td>
        {cells}
      </tr>
    </>
  );
}

/** 午前/午後の営業時間の説明文（週内の開いている日から算出） */
function rangeText(days: WeekDay[], am: boolean): string {
  const ranges = new Map<string, number>();
  for (const d of days) {
    const ts = d.slots.map((s) => s.time).filter((x) => (am ? x < NOON : x >= NOON));
    if (!ts.length) continue;
    const key = `${minToHm(Math.min(...ts))}〜${minToHm(Math.max(...ts))}`;
    ranges.set(key, (ranges.get(key) ?? 0) + 1);
  }
  const list = Array.from(ranges.keys());
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return list.join(' ／ ');
}
