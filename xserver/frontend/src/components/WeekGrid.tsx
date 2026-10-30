
import { useEffect, useMemo, useRef, useState } from 'react';
import { WEEKDAY_JA, addDays, diffDays, minToHm, weekdayOf } from '@/lib/time';
import { NOON } from '@/lib/hours';

// 来院区分。NEW=はじめて（ケガ・痛み・不調）、ACCIDENT=はじめて（交通事故）、RETURN=現在通院中、REVISIT=1ヶ月以上ご来院の無い方
export type Kind = 'NEW' | 'ACCIDENT' | 'RETURN' | 'REVISIT';
export type Group = 'FIRST' | 'VISITED';
export const groupOf = (k: Kind): Group => (k === 'NEW' || k === 'ACCIDENT' ? 'FIRST' : 'VISITED');
export const KIND_TEXT: Record<Kind, string> = {
  NEW: 'はじめての方（ケガ・痛み・不調など）',
  ACCIDENT: 'はじめての方（交通事故による痛み）',
  RETURN: 'ご通院したことがある方（現在通院中）',
  REVISIT: 'ご通院したことがある方（1ヶ月以上ご来院の無い方）',
};
const GROUP_LABEL: Record<Group, { title: string; sub: string; kinds: [Kind, string][] }> = {
  FIRST: { title: 'はじめての方', sub: '', kinds: [['NEW', 'ケガ・痛み・不調など'], ['ACCIDENT', '交通事故による痛み']] },
  VISITED: { title: 'ご通院したことがある方', sub: '', kinds: [['RETURN', '現在通院中'], ['REVISIT', '1ヶ月以上ご来院の無い方']] },
};
type SlotStatus = 'open' | 'few' | 'phone' | 'closed';
/** WEB で予約へ進める（〇・△） */
const bookable = (s: SlotStatus) => s === 'open' || s === 'few';
export interface WeekDay { date: string; label: string | null; slots: { time: number; status: SlotStatus }[] }
export interface WeekData { today: string; weekStart: string; publishDaysAhead: number; days: WeekDay[] }
export interface Selection { date: string; time: number; status: SlotStatus }

interface Props {
  storeCode: string;
  kind: Kind | null; // null＝まだ選ばれていない（最初は何も選ばれていない状態。日時は見られるが、区分を選ぶまで先へ進めない）
  onKindChange: (k: Kind | null) => void;
  onProceed: (sel: Selection) => void;
  phone: string;
  cardRemembered?: boolean; // この端末に診察券番号を覚えている（通院中の案内の文言を変える）
}


function md(date: string) { return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`; }

export default function WeekGrid({ storeCode, kind, onKindChange, onProceed, phone, cardRemembered = false }: Props) {
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [data, setData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Selection | null>(null);
  const [group, setGroup] = useState<Group | null>(kind ? groupOf(kind) : null);
  const [needKind, setNeedKind] = useState(false); // 区分を選ばずに進もうとした → 区分の欄を目立たせる
  const [notice, setNotice] = useState('');
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
    // 区分が未選択の間は、選んでいるグループのいちばん厳しい区分の空き状況を見せる（新規・再来を止めた時間が 〇 に見えないように）。
    // はじめての方・未選択＝初診、ご通院したことがある方＝現在通院中（どちらも内容を選ぶまでは未選択のまま。選んだら、その区分の空き状況で確かめ直す）
    const q = new URLSearchParams({ kind: kind ?? (group === 'VISITED' ? 'RETURN' : 'NEW') });
    if (weekStart) q.set('start', weekStart);
    fetch(`/api/public/${encodeURIComponent(storeCode)}/week?${q}`)
      .then((r) => r.json())
      .then((j: WeekData) => { if (!alive) return; setData(j); if (!weekStart) setWeekStart(j.weekStart); })
      .catch(() => alive && setError('読み込みに失敗しました'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [storeCode, kind, group, weekStart]);

  useEffect(() => { setSel(null); setNotice(''); }, [weekStart]);
  useEffect(() => { if (kind) setNeedKind(false); }, [kind]);
  // 区分を選び直したら、選んでいた日時がその区分でも予約できるか確かめる
  useEffect(() => {
    if (!data) return;
    setSel((cur) => {
      if (!cur) return cur;
      const st = data.days.find((d) => d.date === cur.date)?.slots.find((x) => x.time === cur.time)?.status;
      if (!st || st === 'closed') { setNotice('選んでいた日時は、この内容では予約できません。別の日時をお選びください。'); return null; }
      return st === cur.status ? cur : { ...cur, status: st };
    });
  }, [data]);

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
      <div className={`wk-head ${needKind ? 'ring-4 ring-red-400' : ''}`} ref={headRef}>
        <p className={`mb-1 text-[14px] font-bold ${needKind ? 'text-red-600' : 'text-brand-dark'}`}>① どちらかを選択してください</p>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="来院区分">
          {(['FIRST', 'VISITED'] as Group[]).map((g) => (
            <button key={g} type="button" aria-pressed={group === g} onClick={() => { if (group === g) return; setGroup(g); onKindChange(null); }}
              className={`rounded-lg border-2 border-brand px-1.5 ${group ? 'py-2 text-[12.5px]' : 'py-4 text-[15px]'} font-semibold leading-tight ${group === g ? 'bg-brand text-white' : 'bg-white text-brand-dark'}`}>
              {GROUP_LABEL[g].title}
              {GROUP_LABEL[g].sub && <span className="block text-[10.5px] font-normal opacity-85">{GROUP_LABEL[g].sub}</span>}
            </button>
          ))}
        </div>
        {group && <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="ご来院の内容">
          {GROUP_LABEL[group].kinds.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => onKindChange(k)}
              className={`rounded-md border px-1.5 py-1.5 text-[12px] font-semibold leading-tight ${kind === k ? 'border-brand bg-brand-light text-brand-dark ring-2 ring-brand' : 'border-slate-300 bg-white text-slate-700'}`}>
              {kind === k ? '● ' : '○ '}{label}
            </button>
          ))}
        </div>}
        {kind === 'RETURN' && <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[12.5px] font-semibold text-amber-900" role="note" aria-label="通院中の方へのお願い">{cardRemembered
          ? <>診察券番号は前回の番号が入ります<span className="block text-[11px] font-normal">念のため番号をご確認ください</span></>
          : <>診察券をご用意ください<span className="block text-[11px] font-normal">次の画面で診察券番号を入力します</span></>}</p>}
        {group && !kind && (
          <p className={`mt-2 text-center text-[13px] font-semibold ${needKind ? 'text-red-600' : 'text-brand-dark'}`} role="note" aria-label="ご来院の内容の案内">
            {group === 'VISITED' ? '「現在通院中」か「1ヶ月以上ご来院の無い方」のどちらかを選んでください' : '「ケガ・痛み・不調など」か「交通事故による痛み」のどちらかを選んでください'}
            {group === 'VISITED' && <span className="block text-[11px] font-normal text-slate-500">（下の表は、現在通院中の方の空き状況です）</span>}
          </p>
        )}
        <p className="mt-2.5 text-[14px] font-bold text-brand-dark">② ご希望の日時を選択してください</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <button type="button" disabled={prevDisabled} onClick={() => weekStart && setWeekStart(addDays(weekStart, -7))} className="rounded border bg-white px-2.5 py-1.5 text-sm disabled:opacity-40">‹ 前週</button>
          <div className="text-[15px] font-bold tabular-nums">
            {days.length ? `${md(days[0].date)}（${WEEKDAY_JA[weekdayOf(days[0].date)]}）〜 ${md(days[6].date)}（${WEEKDAY_JA[weekdayOf(days[6].date)]}）` : ''}
          </div>
          <button type="button" disabled={nextDisabled} onClick={() => weekStart && setWeekStart(addDays(weekStart, 7))} className="rounded border bg-white px-2.5 py-1.5 text-sm disabled:opacity-40">翌週 ›</button>
        </div>
        <div className="wk-legend" aria-label="記号の意味">
          <span><span className="o">〇</span> WEB予約できます</span>
          <span><span className="f">△</span> 残り1枠（WEB予約可）</span>
          <span><span className="p">📞</span> 直前・急患はお電話で</span>
          <span><span className="x">×</span> 空きなし・受付終了</span>
          <span><span className="sw" /> 定休日・祝日</span>
        </div>
      </div>

      {error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {notice && <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}
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
                  onPick={(date, time, status) => { setSel({ date, time, status }); setNotice(''); }} />
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
              <span className={`text-xs ${bookable(sel.status) && !kind ? 'font-bold text-red-600' : 'text-slate-500'}`}>{!bookable(sel.status) ? '直前のためお電話でご予約ください' : kind ? `${KIND_TEXT[kind]}${sel.status === 'few' ? '（残り1枠）' : ''}` : '上で来院区分を選ぶと予約へ進めます'}</span>
            </div>
            {bookable(sel.status) && !kind
              ? <button type="button" onClick={() => { setNeedKind(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="whitespace-nowrap rounded-lg border-2 border-brand bg-white px-4 py-3 text-sm font-bold text-brand">来院区分を選ぶ</button>
              : bookable(sel.status)
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
      <td key={d.date} className={`slot ${st === 'open' ? 'o' : st === 'few' ? 'f' : 'p'} ${isSel ? 'sel' : ''}`}>
        <button type="button" onClick={() => onPick(d.date, t, st)} aria-label={`${md(d.date)} ${minToHm(t)} ${st === 'open' ? '予約できます' : st === 'few' ? '残り1枠・予約できます' : 'お電話でご予約ください'}`}>
          {st === 'open' ? '〇' : st === 'few' ? '△' : '📞'}
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
