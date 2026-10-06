// 自賠請求：年間（12 か月）の月別の枚数・合計・1 枚あたり平均の表。店舗画面と本部画面で使う
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { formatYm, yen } from '@/lib/jibai';

interface MonthStat { ym: string; count: number; total: number; avg: number | null }
interface StoreStat { code: string; name: string; count: number; total: number; avg: number | null; months?: MonthStat[] }
interface Resp {
  from: string; to: string; months: MonthStat[]; year: { count: number; total: number; avg: number | null }; currentYm: string;
  store?: { code: string; name: string } | null; stores?: StoreStat[];
  /** 全店の月別・年間（本部の一覧表の合計行） */
  allMonths?: MonthStat[]; allYear?: { count: number; total: number; avg: number | null };
}

type CellView = 'both' | 'total' | 'avg' | 'count';

/** 本部の画面では hqStores（店舗一覧）を渡すと、全店／店舗ごとの切り替えと店舗別の年間比較を表示する */
/** refreshKey が変わると読み直す（明細の保存・削除のあとに最新の数字にするため） */
export default function JibaiYearStats({ endpoint, currentYm, hqStores, refreshKey = 0 }: { endpoint: string; currentYm: string; hqStores?: { code: string; name: string }[]; refreshKey?: number }) {
  const cy = Number(currentYm.slice(0, 4));
  const cm = Number(currentYm.slice(5, 7));
  const [mode, setMode] = useState<'cal' | 'fy'>('cal'); // cal＝1〜12 月、fy＝年度（4 月〜翌 3 月）
  const [year, setYear] = useState(cy);
  const [store, setStore] = useState('');
  const [view, setView] = useState<CellView>('both');
  const from = mode === 'cal' ? `${year}-01` : `${year}-04`;
  const { data, error } = useFetch<Resp>(`${endpoint}?from=${from}${store ? `&store=${encodeURIComponent(store)}` : ''}&r=${refreshKey}`);
  const switchMode = (m: 'cal' | 'fy') => { setMode(m); setYear(m === 'fy' && cm < 4 ? cy - 1 : cy); };
  const years = Array.from({ length: 6 }, (_, i) => cy - i);
  const num = 'px-2 py-1 text-right tabular-nums';
  const label = (y: number) => (mode === 'cal' ? `${y}年（1〜12月）` : `${y}年度（${y}年4月〜${y + 1}年3月）`);
  const filled = data ? data.months.filter((m) => m.count > 0) : [];
  const maxAvg = filled.length ? Math.max(...filled.map((m) => m.avg ?? 0)) : 0;

  return (
    <section className="rounded border bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <h2 className="mr-2 font-bold">年間の 1 枚あたり平均請求額（月別）</h2>
        <div className="flex overflow-hidden rounded border text-xs">
          <button type="button" onClick={() => switchMode('cal')} aria-pressed={mode === 'cal'} className={`px-2 py-1 ${mode === 'cal' ? 'bg-brand text-white' : 'bg-white'}`}>1〜12月</button>
          <button type="button" onClick={() => switchMode('fy')} aria-pressed={mode === 'fy'} className={`px-2 py-1 ${mode === 'fy' ? 'bg-brand text-white' : 'bg-white'}`}>年度（4月〜）</button>
        </div>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="年" className="rounded border px-2 py-1">
          {years.map((y) => <option key={y} value={y}>{label(y)}</option>)}
        </select>
        {hqStores && (
          <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="店舗" className="rounded border px-2 py-1">
            <option value="">全店</option>
            {hqStores.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
          </select>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error.message}</p>}
      {!data && !error && <p className="text-sm text-slate-500">読み込み中…</p>}
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="px-2 py-1">請求月</th><th className={num}>枚数</th><th className={num}>合計</th><th className={num}>1 枚あたり平均</th></tr></thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.ym} className={`border-t ${m.ym === currentYm ? 'bg-brand-light' : ''}`}>
                  <td className="px-2 py-1">{formatYm(m.ym)}{m.ym === currentYm && <span className="ml-1 text-xs text-brand-dark">（今月）</span>}</td>
                  <td className={num}>{m.count || ''}</td>
                  <td className={num}>{m.count ? m.total.toLocaleString('ja-JP') : ''}</td>
                  <td className={`${num} font-bold`}>{m.avg !== null ? yen(m.avg) : <span className="font-normal text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-slate-50 font-bold">
                <td className="px-2 py-1">年間{data.store ? `（${data.store.name}）` : hqStores ? '（全店）' : ''}</td>
                <td className={num}>{data.year.count}</td>
                <td className={num}>{data.year.total.toLocaleString('ja-JP')}</td>
                <td className={`${num} text-brand-dark`}>{data.year.avg !== null ? yen(data.year.avg) : '—'}</td>
              </tr>
            </tfoot>
          </table>
          <div className="space-y-2 text-sm">
            <div className="rounded bg-slate-50 px-3 py-2">
              <div className="text-xs text-slate-500">{label(year)}の 1 枚あたり平均（年間合計 ÷ 年間枚数）</div>
              <div className="text-2xl font-bold tabular-nums text-brand-dark">{data.year.avg !== null ? yen(data.year.avg) : '—'}</div>
              {filled.length > 0 && (
                <div className="mt-1 text-xs text-slate-600">
                  月別の最高 {formatYm(filled.find((m) => m.avg === maxAvg)!.ym)} {yen(maxAvg)} ／ 最低 {(() => { const minAvg = Math.min(...filled.map((m) => m.avg ?? 0)); return `${formatYm(filled.find((m) => m.avg === minAvg)!.ym)} ${yen(minAvg)}`; })()}
                </div>
              )}
            </div>
            {hqStores && data.stores && (
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="px-2 py-1">店舗（年間）</th><th className={num}>枚数</th><th className={num}>合計</th><th className={num}>1 枚あたり平均</th></tr></thead>
                <tbody>
                  {data.stores.map((s) => (
                    <tr key={s.code} className={`border-t ${store === s.code ? 'bg-brand-light' : ''}`}>
                      <td className="whitespace-nowrap px-2 py-1"><button type="button" onClick={() => setStore(store === s.code ? '' : s.code)} className="text-left hover:underline"><span className="mr-1 font-mono text-xs text-slate-500">{s.code}</span>{s.name}</button></td>
                      <td className={num}>{s.count || ''}</td>
                      <td className={num}>{s.count ? s.total.toLocaleString('ja-JP') : ''}</td>
                      <td className={`${num} font-bold`}>{s.avg !== null ? yen(s.avg) : <span className="font-normal text-slate-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-slate-500">請求月（請求書に印字された「令和 ○年 ○月」）で集計した速報額です。1 枚あたり平均＝その月の合計 ÷ 請求書の枚数（四捨五入）。年間は「年間合計 ÷ 年間枚数」で、枚数の多い月ほど強く反映されます。{hqStores ? '店舗名を押すとその店舗の月別に切り替わります。' : ''}</p>
          </div>
        </div>
      )}
      {data && hqStores && data.stores && data.stores[0]?.months && data.allMonths && data.allYear && (
        <StoreMonthMatrix data={data as Required<Pick<Resp, 'stores' | 'allMonths' | 'allYear'>> & Resp} view={view} setView={setView} periodLabel={label(year)} currentYm={currentYm} selected={store} onSelect={(c) => setStore(store === c ? '' : c)} />
      )}
    </section>
  );
}

/** 本部：店舗 × 月の一覧表（縦に店舗、横に 12 か月。右端に年間、最下段に全店） */
function StoreMonthMatrix({ data, view, setView, periodLabel, currentYm, selected, onSelect }: {
  data: Resp & { stores: StoreStat[]; allMonths: MonthStat[]; allYear: { count: number; total: number; avg: number | null } };
  view: CellView; setView: (v: CellView) => void; periodLabel: string; currentYm: string; selected: string; onSelect: (code: string) => void;
}) {
  const months = data.allMonths.map((m) => m.ym);
  const short = (ym: string) => `${Number(ym.slice(5, 7))}月`;
  const cell = (m: MonthStat | { count: number; total: number; avg: number | null }) => {
    if (!m.count) return <span className="text-slate-300">—</span>;
    if (view === 'total') return <span className="font-bold">{m.total.toLocaleString('ja-JP')}</span>;
    if (view === 'avg') return <span className="font-bold">{(m.avg ?? 0).toLocaleString('ja-JP')}</span>;
    if (view === 'count') return <span className="font-bold">{m.count}</span>;
    return (<><div className="font-bold">{m.total.toLocaleString('ja-JP')}</div><div className="whitespace-nowrap text-[11px] text-slate-500">@{(m.avg ?? 0).toLocaleString('ja-JP')}・{m.count}枚</div></>);
  };
  function downloadCsv() {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['店舗コード', '店舗名', ...months.flatMap((m) => [`${formatYm(m)} 枚数`, `${formatYm(m)} 合計`, `${formatYm(m)} 1枚平均`]), '年間 枚数', '年間 合計', '年間 1枚平均'];
    const line = (code: string, name: string, ms: MonthStat[], y: { count: number; total: number; avg: number | null }) =>
      [code, name, ...ms.flatMap((m) => [m.count, m.total, m.avg ?? '']), y.count, y.total, y.avg ?? ''].map(q).join(',');
    const body = [head.map(q).join(','), ...data.stores.map((s) => line(s.code, s.name, s.months!, s)), line('', '全店', data.allMonths, data.allYear)].join('\r\n');
    const blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' }); // 先頭の BOM で Excel でも文字化けしない
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // ファイル名は英数字にする（日本語のファイル名はブラウザによって「download」に置き換えられることがあるため）
    a.download = `jibai_store_month_${data.from}_${data.to}.csv`;
    document.body.appendChild(a); // ページに付けてから押すと、どのブラウザでもファイル名が保たれる
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const th = 'whitespace-nowrap px-2 py-1 text-right font-normal';
  const td = 'px-2 py-1 text-right tabular-nums align-top';
  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <h3 className="mr-2 font-bold">店舗別・月別の一覧（{periodLabel}）</h3>
        <div className="flex overflow-hidden rounded border text-xs" role="group" aria-label="表示する数字">
          {([['both', '合計＋平均'], ['total', '合計'], ['avg', '1枚平均'], ['count', '枚数']] as [CellView, string][]).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={`px-2 py-1 ${view === v ? 'bg-brand text-white' : 'bg-white'}`}>{l}</button>
          ))}
        </div>
        <button type="button" onClick={downloadCsv} className="ml-auto rounded border bg-white px-3 py-1 text-xs">CSV ダウンロード（Excel で開けます）</button>
      </div>
      <div className="overflow-x-auto rounded border">
        <table className="w-full min-w-[1100px] text-sm" aria-label="店舗別・月別の一覧">
          <thead>
            <tr className="bg-slate-100 text-xs text-slate-600">
              <th className="sticky left-0 z-10 bg-slate-100 px-2 py-1 text-left font-normal">店舗</th>
              {months.map((m) => <th key={m} className={`${th} ${m === currentYm ? 'bg-brand-light' : ''}`}>{short(m)}</th>)}
              <th className={`${th} border-l-2`}>年間 枚数</th>
              <th className={th}>年間 合計</th>
              <th className={th}>年間 1枚平均</th>
            </tr>
          </thead>
          <tbody>
            {data.stores.map((s) => (
              <tr key={s.code} className={`border-t ${selected === s.code ? 'bg-brand-light' : ''}`}>
                <td className={`sticky left-0 z-10 whitespace-nowrap px-2 py-1 align-top ${selected === s.code ? 'bg-brand-light' : 'bg-white'}`}>
                  <button type="button" onClick={() => onSelect(s.code)} className="text-left hover:underline" title="上の表をこの店舗の月別に切り替え"><span className="mr-1 font-mono text-xs text-slate-500">{s.code}</span>{s.name}</button>
                </td>
                {s.months!.map((m) => <td key={m.ym} className={`${td} ${m.ym === currentYm ? 'bg-brand-light/60' : ''}`}>{cell(m)}</td>)}
                <td className={`${td} border-l-2`}>{s.count || ''}</td>
                <td className={`${td} font-bold`}>{s.count ? s.total.toLocaleString('ja-JP') : ''}</td>
                <td className={`${td} font-bold text-brand-dark`}>{s.avg !== null ? s.avg.toLocaleString('ja-JP') : <span className="font-normal text-slate-300">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-slate-50">
              <td className="sticky left-0 z-10 bg-slate-50 px-2 py-1 font-bold">全店</td>
              {data.allMonths.map((m) => <td key={m.ym} className={td}>{cell(m)}</td>)}
              <td className={`${td} border-l-2 font-bold`}>{data.allYear.count}</td>
              <td className={`${td} font-bold`}>{data.allYear.total.toLocaleString('ja-JP')}</td>
              <td className={`${td} font-bold text-brand-dark`}>{data.allYear.avg !== null ? data.allYear.avg.toLocaleString('ja-JP') : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-500">金額の単位は円。「合計＋平均」では上段が合計、下段が「@1 枚あたり平均・枚数」です。年間 1 枚平均＝年間合計 ÷ 年間枚数。店舗名を押すと上の表がその店舗の月別に切り替わります。</p>
    </div>
  );
}
