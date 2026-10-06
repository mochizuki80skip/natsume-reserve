// 継続の状況：店舗の継続率（新患／再来／全体）・初回担当者別の継続率・推移グラフ
import { useState } from 'react';
import { isNewKind, pct, retentionOf, VISIT_COUNT, type KarteRow, type Retention } from '@/lib/karte';
import { PercentLines, SERIES_COLORS } from './charts';

const HEAD = ['初回', ...Array.from({ length: VISIT_COUNT }, (_, i) => `${i + 2}回目`)];
const STORE_COLOR = '#334155';

function Meter({ v, color }: { v: number; color: string }) {
  return <div className="mx-auto mt-0.5 h-1 w-11 overflow-hidden rounded bg-slate-200"><i className="block h-full" style={{ width: `${v}%`, background: color }} /></div>;
}

export default function KarteRetention({ rows, monthLabel }: { rows: KarteRow[]; monthLabel: string }) {
  const [tab, setTab] = useState<'new' | 're'>('new');
  const newRows = rows.filter((r) => isNewKind(r.kind));
  const reRows = rows.filter((r) => r.kind === 'REVISIT');
  const staffNames = [...new Set(rows.map((r) => r.staff || '（担当未入力）'))].sort((a, b) => (a.startsWith('（') ? 1 : b.startsWith('（') ? -1 : 0));
  const colorOf = (name: string) => SERIES_COLORS[staffNames.indexOf(name) % SERIES_COLORS.length];
  const byStaff = (list: KarteRow[]) => staffNames.map((s) => ({ name: s, r: retentionOf(list.filter((x) => (x.staff || '（担当未入力）') === s)) })).filter((x) => x.r.first > 0);

  const storeRows: [string, Retention, string][] = [['新患', retentionOf(newRows), '#e34948'], ['再来', retentionOf(reRows), '#2a78d6'], ['全体', retentionOf(rows), STORE_COLOR]];
  const chartList = tab === 'new' ? newRows : reRows;
  const series = [
    ...byStaff(chartList).map(({ name, r }) => ({ name, color: colorOf(name), values: [100, ...r.reached.map((v) => pct(v, r.first))], counts: [`${r.first}名`, ...r.reached.map((v) => `${v}/${r.first}名`)] })),
    ...(chartList.length ? [{ name: '店舗合計', color: STORE_COLOR, bold: true, values: [100, ...retentionOf(chartList).reached.map((v) => pct(v, chartList.length))], counts: [`${chartList.length}名`, ...retentionOf(chartList).reached.map((v) => `${v}/${chartList.length}名`)] }] : []),
  ];

  const StaffTable = ({ label, list }: { label: string; list: KarteRow[] }) => {
    const total = retentionOf(list);
    return (
      <>
        <tr className="bg-slate-50"><td colSpan={7} className="px-2 pt-1.5 text-left text-[11.5px] font-bold">{label}</td></tr>
        {list.length === 0 && <tr><td colSpan={7} className="px-2 py-1 text-left text-xs text-slate-400">この月はいません</td></tr>}
        {byStaff(list).map(({ name, r }) => (
          <tr key={name} className="border-b border-slate-100">
            <td className="whitespace-nowrap px-2 py-1 text-left"><i className="mr-1 inline-block h-[3px] w-3 rounded align-middle" style={{ background: colorOf(name) }} />{name}</td>
            <td className="px-1 py-1">{r.first}名</td>
            {r.reached.map((v, i) => <td key={i} className="px-1 py-1"><b>{pct(v, r.first)}%</b> <span className="text-[10px] text-slate-500">{v}</span></td>)}
          </tr>
        ))}
        {list.length > 0 && (
          <tr className="border-b border-t-2 border-slate-200 font-bold">
            <td className="px-2 py-1 text-left"><i className="mr-1 inline-block h-[3px] w-3 rounded align-middle" style={{ background: STORE_COLOR }} />店舗合計</td>
            <td className="px-1 py-1">{total.first}名</td>
            {total.reached.map((v, i) => <td key={i} className="px-1 py-1">{pct(v, total.first)}% <span className="text-[10px] font-normal text-slate-500">{v}</span></td>)}
          </tr>
        )}
      </>
    );
  };

  return (
    <section className="mt-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <h2 className="text-base font-bold">継続の状況（{monthLabel}の初回 {rows.length}名）</h2>
        <span className="text-xs text-slate-500">2〜6回目の「日付」が入っている人を継続として数えます。月末に近い初回の人は、まだ次回が来ていないため低めに出ます。新患＝初診・初・初自。</span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.3fr_0.95fr]">
        <div className="rounded-lg border bg-white p-3">
          <h3 className="mb-1 text-sm font-bold">店舗の継続率</h3>
          <table className="w-full text-center text-xs tabular-nums">
            <thead><tr className="text-[10.5px] text-slate-500">{['', ...HEAD].map((h) => <th key={h} className="px-1 py-1 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {storeRows.map(([label, r, color]) => (
                <tr key={label} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-1 py-1.5 text-left font-bold"><i className="mr-1 inline-block h-[3px] w-3 rounded align-middle" style={{ background: color }} />{label}</td>
                  <td className="px-1">{r.first}名</td>
                  {r.reached.map((v, i) => <td key={i} className="px-1"><b>{pct(v, r.first)}%</b><Meter v={pct(v, r.first)} color={color} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-lg border bg-white p-3">
          <h3 className="mb-1 text-sm font-bold">初回担当者別の継続率</h3>
          <table className="w-full text-center text-xs tabular-nums">
            <thead><tr className="text-[10.5px] text-slate-500"><th className="px-2 py-1 text-left font-semibold">初回担当</th>{HEAD.map((h) => <th key={h} className="px-1 py-1 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              <StaffTable label="新患（初診・初・初自）" list={newRows} />
              <StaffTable label="再来" list={reRows} />
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-500">％＝継続率、横の数字＝人数</p>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <div className="mb-1 flex items-center">
            <h3 className="text-sm font-bold">継続率の推移</h3>
            <div className="ml-auto inline-flex overflow-hidden rounded border text-xs">
              {(['new', 're'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-0.5 ${tab === t ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{t === 'new' ? '新患' : '再来'}</button>)}
            </div>
          </div>
          <div className="mb-1 flex flex-wrap gap-x-3 text-[11px]">{series.map((s) => <span key={s.name}><i className="mr-1 inline-block h-[3px] w-3 rounded align-middle" style={{ background: s.color }} />{s.name}</span>)}</div>
          {series.length ? <PercentLines xLabels={HEAD} series={series} /> : <p className="py-10 text-center text-xs text-slate-400">この月はいません</p>}
        </div>
      </div>
    </section>
  );
}
