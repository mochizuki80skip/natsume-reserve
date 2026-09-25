// 本部：全店の 1 日の状況
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { addDays, formatDateJa } from '@/lib/time';
import { useAdmin } from './Layout';

interface Row { code: string; name: string; closed: boolean; published: boolean | null; rAm: number; rPm: number; vAm: number; vPm: number; web: number; nw: number; re: number; jb: number; cancel: number; noshow: number }
interface Resp { date: string; today: string; rows: Row[]; sum: Omit<Row, 'code' | 'name' | 'closed' | 'published'>; storeCount: number }

export default function OverviewPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const dateParam = sp.get('date') ?? '';
  const { data, error } = useFetch<Resp>(me.session.role === 'hq' ? `/api/admin/hq/overview?date=${encodeURIComponent(dateParam)}` : null);
  if (me.session.role !== 'hq') return <Navigate to="/admin" replace />;
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
                  <td className="whitespace-nowrap px-2 py-1"><span className="mr-1 font-mono text-xs text-slate-500">{r.code}</span>{r.name}</td>
                  <td className="whitespace-nowrap px-2 py-1"><span className={`rounded px-1.5 text-xs ${r.closed ? 'bg-slate-200 text-slate-600' : open ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>{r.closed ? '臨時休診' : r.published === false ? '非公開' : r.published === true ? '公開' : '公開（既定）'}</span></td>
                  <td className={num}>{r.rAm}</td><td className={num}>{r.rPm}</td><td className={`${num} font-bold`}>{r.rAm + r.rPm}</td>
                  <td className={`${num} text-green-700`}>{r.vAm}</td><td className={`${num} text-green-700`}>{r.vPm}</td><td className={`${num} font-bold text-green-700`}>{r.vAm + r.vPm}</td>
                  <td className={num}>{r.web}</td>
                  <td className={num}>{r.nw}</td><td className={num}>{r.re}</td><td className={`${num} text-amber-800`}>{r.jb}</td>
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
            {rows.length === 0 && <tr><td colSpan={14} className="px-2 py-4 text-center text-slate-500">稼働中の店舗がありません</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-slate-50 font-bold">
                <td className="px-2 py-1" colSpan={2}>合計（{rows.length} 店舗）</td>
                <td className={num}>{sum.rAm}</td><td className={num}>{sum.rPm}</td><td className={num}>{sum.rAm + sum.rPm}</td>
                <td className={`${num} text-green-700`}>{sum.vAm}</td><td className={`${num} text-green-700`}>{sum.vPm}</td><td className={`${num} text-green-700`}>{sum.vAm + sum.vPm}</td>
                <td className={num}>{sum.web}</td>
                <td className={num}>{sum.nw}</td><td className={num}>{sum.re}</td><td className={`${num} text-amber-800`}>{sum.jb}</td>
                <td className={num}>{sum.cancel}{sum.noshow ? <span className="ml-1 text-xs text-red-700">({sum.noshow})</span> : ''}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">予約・来院は氏名が入ったセルの数（「上記初診対応」などは含まない）。WEB は WEB予約の件数。初診・再来・自賠はセルの文字による内訳。「予約表」を押すとその店舗に切り替えて予約表を開きます。</p>
    </div>
  );
}
