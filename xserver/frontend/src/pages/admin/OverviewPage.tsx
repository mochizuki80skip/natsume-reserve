// 本部：全店の 1 日の状況
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { addDays, formatDateJa } from '@/lib/time';
import { useAdmin } from './Layout';
import ClosureBulkEditor from '@/components/ClosureBulkEditor';
import SpecialBulkEditor from '@/components/SpecialBulkEditor';

interface Row { code: string; name: string; closed: boolean; published: boolean | null; rAm: number; rPm: number; vAm: number; vPm: number; web: number; nw: number; re: number; jb: number; th?: number; cancel: number; noshow: number }
interface Resp { date: string; today: string; rows: Row[]; sum: Omit<Row, 'code' | 'name' | 'closed' | 'published'>; storeCount: number }

export default function OverviewPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const dateParam = sp.get('date') ?? '';
  const { data, error } = useFetch<Resp>(me.session.role === 'hq' || me.session.role === 'mg' ? `/api/admin/hq/overview?date=${encodeURIComponent(dateParam)}` : null);
  if (me.session.role !== 'hq' && me.session.role !== 'mg') return <Navigate to="/admin" replace />;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…（全店舗分を集計しています）</p>;
  const { date, today, rows, sum } = data;
  const num = 'px-2 py-1 text-right tabular-nums';
  const nav = (d: string, label: string) => <Link to={`/admin/hq/overview?date=${d}`} className="rounded border bg-white px-3 py-1">{label}</Link>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <h1 className="mr-2 text-xl font-bold">全店状況</h1>
        {nav(addDays(date, -1), '‹ 前日')}
        <input type="date" value={date} onChange={(e) => e.target.value && navigate(`/admin/hq/overview?date=${e.target.value}`)} className="rounded border px-2 py-1" />
        {nav(addDays(date, 1), '翌日 ›')}
        {nav(today, '今日')}
        <span className="ml-auto text-xs text-slate-500">{data.storeCount} 店舗（停止中の店舗は除く）</span>
      </div>
      <h2 className="mb-2 text-lg font-bold">{formatDateJa(date)}</h2>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left text-xs text-slate-600">
              <th className="px-2 py-1" rowSpan={2}>店舗</th>
              <th className="px-2 py-1" rowSpan={2}>顧客サイト</th>
              <th className="px-2 py-1 text-center" colSpan={3}>予約</th>
              <th className="px-2 py-1 text-center" colSpan={3}>来院</th>
              <th className="px-2 py-1 text-right" rowSpan={2}>WEB</th>
              <th className="px-2 py-1 text-right" rowSpan={2}>初診</th>
              <th className="px-2 py-1 text-right" rowSpan={2}>再来</th>
              <th className="px-2 py-1 text-right" rowSpan={2}>自賠</th>
              <th className="px-2 py-1 text-right" rowSpan={2}>新三</th>
              <th className="px-2 py-1 text-right" rowSpan={2}>ｷｬﾝｾﾙ<br /><span className="font-normal">（うち無断）</span></th>
              <th rowSpan={2}></th>
            </tr>
            <tr className="bg-slate-100 text-right text-xs text-slate-600">
              <th className="px-2 py-1">午前</th><th className="px-2 py-1">午後</th><th className="px-2 py-1">計</th>
              <th className="px-2 py-1">午前</th><th className="px-2 py-1">午後</th><th className="px-2 py-1">計</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = !r.closed && r.published !== false;
              return (
                <tr key={r.code} className="border-t">
                  <td className="whitespace-nowrap px-2 py-1">{r.name}</td>
                  <td className="whitespace-nowrap px-2 py-1"><span className={`rounded px-1.5 text-xs ${r.closed ? 'bg-slate-200 text-slate-600' : open ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>{r.closed ? '臨時休業' : r.published === false ? '非公開' : r.published === true ? '公開' : '公開（既定）'}</span></td>
                  <td className={num}>{r.rAm}</td><td className={num}>{r.rPm}</td><td className={`${num} font-bold`}>{r.rAm + r.rPm}</td>
                  <td className={`${num} text-green-700`}>{r.vAm}</td><td className={`${num} text-green-700`}>{r.vPm}</td><td className={`${num} font-bold text-green-700`}>{r.vAm + r.vPm}</td>
                  <td className={num}>{r.web}</td>
                  <td className={num}>{r.nw}</td><td className={num}>{r.re}</td><td className={`${num} text-amber-800`}>{r.jb}</td><td className={`${num} text-amber-800`}>{r.th ?? 0}</td>
                  <td className={num}>{r.cancel}{r.noshow ? <span className="ml-1 text-xs text-red-700">({r.noshow})</span> : ''}</td>
                  <td className="whitespace-nowrap px-2 py-1">
                    <form action="/api/admin/switch" method="post" className="inline">
                      <input type="hidden" name="store" value={r.code} /><input type="hidden" name="back" value={`/admin/day/${date}`} />
                      <button className="text-brand underline">予約表</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={15} className="px-2 py-4 text-center text-slate-500">稼働中の店舗がありません</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-slate-50 font-bold">
                <td className="px-2 py-1" colSpan={2}>合計（{rows.length} 店舗）</td>
                <td className={num}>{sum.rAm}</td><td className={num}>{sum.rPm}</td><td className={num}>{sum.rAm + sum.rPm}</td>
                <td className={`${num} text-green-700`}>{sum.vAm}</td><td className={`${num} text-green-700`}>{sum.vPm}</td><td className={`${num} text-green-700`}>{sum.vAm + sum.vPm}</td>
                <td className={num}>{sum.web}</td>
                <td className={num}>{sum.nw}</td><td className={num}>{sum.re}</td><td className={`${num} text-amber-800`}>{sum.jb}</td><td className={`${num} text-amber-800`}>{sum.th ?? 0}</td>
                <td className={num}>{sum.cancel}{sum.noshow ? <span className="ml-1 text-xs text-red-700">({sum.noshow})</span> : ''}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <CardRateTable />
      {me.session.role === 'mg' && <div className="mt-6"><ClosureBulkEditor /><SpecialBulkEditor /></div>}
      <p className="mt-2 text-xs text-slate-500">予約・来院は氏名が入ったセルの数（「上記初診対応」などは含まない）。WEB は WEB予約の件数。初診・再来・自賠・新三（新・第三者行為）はセルの文字による内訳（新三は初診にも数えます）。「予約表」を押すとその店舗に切り替えて予約表を開きます。</p>
    </div>
  );
}

interface CardRateRow { code: string; name: string; visits: number; direct: number; map: number; none: number; rate: number | null }

/** 店舗ごとのカルテNo 付き率（離反などを番号で数えられている割合。入力の差を見るため） */
function CardRateTable() {
  const [month, setMonth] = useState('');
  const { data } = useFetch<{ month: string; rows: CardRateRow[] }>(`/api/admin/hq/card-rate${month ? `?month=${month}` : ''}`);
  const shift = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1)).toISOString().slice(0, 7);
  if (!data) return null;
  const cls = (r: number | null) => (r === null ? '' : r >= 90 ? 'text-emerald-700' : r >= 70 ? 'text-amber-700' : 'text-red-700');
  return (
    <section className="mt-6" aria-label="カルテNo 付き率">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="font-bold">カルテNo 付き率（店舗ごと）</h2>
        <button type="button" onClick={() => setMonth(shift(data.month, -1))} className="rounded border bg-white px-2 text-sm">‹</button>
        <b className="text-sm">{Number(data.month.slice(0, 4))}年{Number(data.month.slice(5))}月</b>
        <button type="button" onClick={() => setMonth(shift(data.month, 1))} className="rounded border bg-white px-2 text-sm">›</button>
      </div>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-left">{['店舗', '来院（チェックあり）', '番号で入力', '名前から番号につながった', '名前だけ', 'カルテNo 付き率'].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.code} className="border-t">
                <td className="px-2 py-1">{r.name}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.visits}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.direct}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.map}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.none}</td>
                <td className={`px-2 py-1 text-right font-bold tabular-nums ${cls(r.rate)}`}>{r.rate === null ? '－' : `${r.rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-500">離反などは、カルテNo が分かる来院は番号で、分からない来院は名前で数えます。付き率が低い店舗は、名前の書き方の違いで数字がずれやすくなります。番号で入力＝WEB 予約の診察券番号・予約表に診察券番号を打って名前に置き換えた・名前の前に番号を書いた。名前から番号につながった＝患者一覧（レセコンの CSV）・新患継続率のカルテNo から。</p>
    </section>
  );
}
