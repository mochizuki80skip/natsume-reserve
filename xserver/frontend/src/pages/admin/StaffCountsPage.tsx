// 担当数（/admin/staff-counts）：スタッフごとに何人の施術に入ったか（日ごと → 月の合計）と、新患・再来・回数・2回目到達率（スタッフの評価用）
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { WEEKDAY_JA, nowJst, weekdayOf } from '@/lib/time';

interface Row { staff: string; total: number; new: number; revisit: number; jibai: number; counts: Record<string, number>; firsts: number; reached2: number; days: Record<string, number> }
interface Resp { month: string; dates: string[]; rows: Row[]; partial: boolean }

const shift = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export default function StaffCountsPage() {
  const [ym, setYm] = useState(nowJst().date.slice(0, 7));
  const [view, setView] = useState<'daily' | 'summary'>('daily');
  const { data, error } = useFetch<Resp>(`/api/admin/staff-counts?month=${ym}`);
  const rows = data?.rows ?? [];
  const dates = data?.dates ?? [];
  const label = (r: Row) => r.staff || '担当なし';

  // まとめ（新患・再来・回数・2回目到達率）
  const visitCols = [...new Set(rows.flatMap((r) => Object.keys(r.counts)))].sort((a, b) => parseInt(a) - parseInt(b));
  const rate = (r: Row) => (r.firsts ? `${Math.round((r.reached2 / r.firsts) * 100)}%` : '－');
  const sumHeader = ['担当', '施術人数（月）', '新患', '再来', '新自', ...visitCols, '初回担当', '2回目到達率'];
  const sumLine = (r: Row) => [label(r), r.total, r.new, r.revisit, r.jibai, ...visitCols.map((m) => r.counts[m] ?? 0), r.firsts, rate(r)];

  // 日ごと（施術に入った人数）：縦＝日付、横＝施術者。月の全日を並べ、いちばん上に月の合計
  const dayTotal = (d: string) => rows.reduce((n, r) => n + (r.days[d] ?? 0), 0);
  const monthTotal = rows.reduce((n, r) => n + r.total, 0);
  const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}（${WEEKDAY_JA[weekdayOf(d)]}）`;
  const dailyHeader = ['日付', ...rows.map(label), '合計'];

  function copy() {
    if (!data) return;
    const table = view === 'daily'
      ? [dailyHeader, ['月の合計', ...rows.map((r) => r.total), monthTotal], ...dates.map((d) => [dayLabel(d), ...rows.map((r) => r.days[d] ?? 0), dayTotal(d)])]
      : [sumHeader, ...rows.map(sumLine)];
    navigator.clipboard.writeText(table.map((x) => x.join('\t')).join('\n')).catch(() => {});
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">担当数</h1>
        <button type="button" onClick={() => setYm(shift(ym, -1))} className="rounded border bg-white px-3 py-1">‹ 前月</button>
        <b className="tabular-nums">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b>
        <button type="button" onClick={() => setYm(shift(ym, 1))} className="rounded border bg-white px-3 py-1">翌月 ›</button>
        <div className="ml-2 inline-flex overflow-hidden rounded border" role="group" aria-label="見方">
          <button type="button" aria-pressed={view === 'daily'} onClick={() => setView('daily')} className={`px-3 py-1 text-sm ${view === 'daily' ? 'bg-brand font-bold text-white' : 'bg-white'}`}>日ごとの施術人数</button>
          <button type="button" aria-pressed={view === 'summary'} onClick={() => setView('summary')} className={`border-l px-3 py-1 text-sm ${view === 'summary' ? 'bg-brand font-bold text-white' : 'bg-white'}`}>新患・再来・回数</button>
        </div>
        <button type="button" onClick={copy} className="ml-auto rounded border bg-white px-3 py-1">表をコピー（Excel に貼り付け）</button>
      </div>
      <p className="mb-2 text-xs text-slate-600">
        来院チェック済みの予約を、担当ごとに数えます（担当は予約表のメニューの帯で付けます）。
        {view === 'daily' ? '日ごとの人数を足したものが「月の合計」です。' : '「2回目到達率」＝その月に初回（初診・再来・新自）を担当した患者様のうち、2回目に来た割合（初回カルテ集計から）。'}
      </p>
      {data?.partial && <p className="mb-2 rounded bg-amber-50 px-3 py-1 text-xs text-amber-900">この月は予約表の保存期間を過ぎた日を含むため、残っている日だけの数字です（2回目到達率は初回カルテ集計から出ます）。</p>}
      {error && <p className="text-sm text-red-700">{error.message}</p>}
      {!data ? <p className="text-sm text-slate-500">読み込み中…</p> : rows.length === 0 ? (
        <p className="rounded border bg-white px-3 py-3 text-sm text-slate-500">この月の来院チェック済みの予約はありません</p>
      ) : view === 'daily' ? (
        <div className="max-h-[75vh] w-fit max-w-full overflow-auto rounded border bg-white">
          <table className="text-sm tabular-nums" aria-label="日ごとの施術人数">
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-100 text-xs">
                <th className="sticky left-0 z-10 bg-slate-100 px-2 py-1 text-left">日付</th>
                {rows.map((r) => <th key={r.staff || '-'} className={`min-w-[4.5rem] px-2 py-1 text-right ${r.staff ? '' : 'font-normal text-slate-500'}`}>{label(r)}</th>)}
                <th className="min-w-[4rem] bg-slate-200 px-2 py-1 text-right">合計</th>
              </tr>
              <tr className="bg-brand-light font-bold">
                <td className="sticky left-0 z-10 bg-brand-light px-2 py-1">月の合計</td>
                {rows.map((r) => <td key={r.staff || '-'} className="px-2 py-1 text-right text-base">{r.total}</td>)}
                <td className="px-2 py-1 text-right text-base">{monthTotal}</td>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const w = weekdayOf(d);
                return (
                  <tr key={d} className="border-t">
                    <td className={`sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-0.5 ${w === 0 ? 'text-red-600' : w === 6 ? 'text-blue-600' : ''}`}>{dayLabel(d)}</td>
                    {rows.map((r) => <td key={r.staff || '-'} className={`px-2 py-0.5 text-right ${r.days[d] ? '' : 'text-slate-300'}`}>{r.days[d] ?? '·'}</td>)}
                    <td className="bg-slate-50 px-2 py-0.5 text-right font-bold">{dayTotal(d) || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="max-w-5xl overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm tabular-nums" aria-label="新患・再来・回数">
            <thead><tr className="bg-slate-100 text-xs">{sumHeader.map((h, i) => <th key={h} className={`px-2 py-1 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.staff || '-'} className="border-t">
                  {sumLine(r).map((v, i) => <td key={i} className={`px-2 py-1 ${i === 0 ? 'text-left font-bold' : 'text-right'} ${i === 0 && !r.staff ? 'text-slate-500' : ''}`}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
