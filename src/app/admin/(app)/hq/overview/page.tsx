// 本部：全店の 1 日の状況（予約・来院・WEB予約・内訳・キャンセル）を 1 画面で見る
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { getGlobalSetting } from '@/lib/settings';
import { loadDay } from '@/lib/dayData';
import { isPatientText } from '@/lib/availability';
import { isAm } from '@/lib/hours';
import { categorizeCell, isContinuationText } from '@/lib/attendance';
import { addDays, formatDateJa, isValidDate, nowJst } from '@/lib/time';

export const dynamic = 'force-dynamic';

interface Row {
  code: string; name: string; active: boolean; closed: boolean; published: boolean | null; capAm: number; capPm: number;
  rAm: number; rPm: number; vAm: number; vPm: number; web: number; nw: number; re: number; jb: number; cancel: number; noshow: number;
}

export default async function HqOverviewPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await requireSession();
  if (session.role !== 'hq') redirect('/admin');
  const sp = await searchParams;
  const today = nowJst().date;
  const date = sp.date && isValidDate(sp.date) ? sp.date : today;
  const [stores, setting] = await Promise.all([
    prisma.store.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
    getGlobalSetting(),
  ]);
  const rows: Row[] = await Promise.all(stores.map(async (store) => {
    const d = await loadDay(store, setting, date);
    const r: Row = { code: store.code, name: store.name, active: store.active, closed: d.day.closed, published: d.day.published, capAm: d.capacity.am, capPm: d.capacity.pm, rAm: 0, rPm: 0, vAm: 0, vPm: 0, web: 0, nw: 0, re: 0, jb: 0, cancel: d.cancels.length, noshow: d.cancels.filter((c) => c.kind === 'NOSHOW').length };
    for (const c of d.cells) {
      if (!isPatientText(c.text)) continue;
      const a = isAm(d.sessions, c.time);
      if (a) r.rAm++; else r.rPm++;
      if (c.visited) { if (a) r.vAm++; else r.vPm++; }
      if (c.web && !isContinuationText(c.text)) r.web++;
      const cat = categorizeCell(c.text);
      if (cat.isNew) r.nw++;
      if (cat.isRevisit) r.re++;
      if (cat.isJibai) r.jb++;
    }
    return r;
  }));
  const sum = rows.reduce((acc, r) => ({ rAm: acc.rAm + r.rAm, rPm: acc.rPm + r.rPm, vAm: acc.vAm + r.vAm, vPm: acc.vPm + r.vPm, web: acc.web + r.web, nw: acc.nw + r.nw, re: acc.re + r.re, jb: acc.jb + r.jb, cancel: acc.cancel + r.cancel, noshow: acc.noshow + r.noshow }),
    { rAm: 0, rPm: 0, vAm: 0, vPm: 0, web: 0, nw: 0, re: 0, jb: 0, cancel: 0, noshow: 0 });
  const num = 'px-2 py-1 text-right tabular-nums';
  const nav = (d: string, label: string) => <Link href={`/admin/hq/overview?date=${d}`} className="rounded border bg-white px-3 py-1">{label}</Link>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <h1 className="mr-2 text-xl font-bold">全店状況</h1>
        {nav(addDays(date, -1), '‹ 前日')}
        <form action="/admin/hq/overview" className="inline"><input type="date" name="date" defaultValue={date} className="rounded border px-2 py-1" /> <button className="rounded border bg-white px-2 py-1">表示</button></form>
        {nav(addDays(date, 1), '翌日 ›')}
        {nav(today, '今日')}
        <span className="ml-auto text-xs text-slate-500">{stores.length} 店舗（停止中の店舗は除く）</span>
      </div>
      <h2 className="mb-2 text-lg font-bold">{formatDateJa(date)}</h2>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left text-xs text-slate-600">
              <th className="px-2 py-1" rowSpan={2}>店舗</th>
              <th className="px-2 py-1" rowSpan={2}>顧客サイト</th>
              <th className="px-2 py-1 text-center" colSpan={2}>表示枠</th>
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
              <th className="px-2 py-1">午前</th><th className="px-2 py-1">午後</th>
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
                  <td className={num}>{r.capAm}</td><td className={num}>{r.capPm}</td>
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
            {rows.length === 0 && <tr><td colSpan={16} className="px-2 py-4 text-center text-slate-500">稼働中の店舗がありません</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-slate-50 font-bold">
                <td className="px-2 py-1" colSpan={4}>合計（{rows.length} 店舗）</td>
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
