// 交通事故患者様の終了報告の一覧 /admin/accident-ends?unit=month|year&period=YYYY-MM|YYYY
// 本部・管轄MG＝全店（エリア・店舗で絞り込み）、店舗＝自店舗。月ごと・年ごと。Excel で保存
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { useAdmin } from './Layout';

interface Row {
  id: string; store: string; storeName: string; area: string; submittedAt: string; patientName: string; sex: string; age: string; job: string; accidentDate: string | null;
  place: string; mechanism: string; fault: string; parts: string; period: string; months: string[]; photo: string; survey: string; note: string; canDelete: boolean;
}
interface Resp { unit: 'month' | 'year'; period: string; rows: Row[]; stores: { code: string; name: string; area: string }[] }

const shiftYm = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1)).toISOString().slice(0, 7);
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');

export default function AccidentEndsPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const today = (me.today ?? new Date().toISOString()).slice(0, 10);
  const unit = sp.get('unit') === 'year' ? 'year' : 'month';
  const period = sp.get('period') ?? (unit === 'year' ? today.slice(0, 4) : today.slice(0, 7));
  const { data, error, reload } = useFetch<Resp>(`/api/admin/accident-ends?unit=${unit}&period=${period}`);
  const [area, setArea] = useState('');
  const [store, setStore] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  const wide = me.session.role !== 'store';
  const go = (u: string, p: string) => setSp({ unit: u, period: p });
  const label = unit === 'year' ? `${period}年` : `${Number(period.slice(0, 4))}年${Number(period.slice(5))}月`;
  const rows = (data?.rows ?? []).filter((r) => (!area || r.area === area) && (!store || r.store === store));
  const byStore = new Map<string, number>();
  for (const r of data?.rows ?? []) byStore.set(r.storeName, (byStore.get(r.storeName) ?? 0) + 1);
  const byMonth = new Map<string, number>();
  if (unit === 'year') for (const r of rows) byMonth.set(r.submittedAt.slice(0, 7), (byMonth.get(r.submittedAt.slice(0, 7)) ?? 0) + 1);
  const areas = [...new Set((data?.stores ?? []).map((s) => s.area).filter(Boolean))];
  async function del(r: Row) {
    if (!confirm(`${r.patientName} さんの終了報告を取り消しますか？`)) return;
    const res = await fetch('/api/admin/accident-ends', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }) });
    if (!res.ok) alert(((await res.json().catch(() => ({}))) as { error?: string }).error ?? '取り消せませんでした');
    reload();
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">事故患者 終了報告{wide ? '（全店）' : `（${me.store?.name ?? ''}）`}</h1>
        <div className="inline-flex overflow-hidden rounded border" role="group" aria-label="単位">
          <button type="button" aria-pressed={unit === 'month'} onClick={() => go('month', today.slice(0, 7))} className={`px-3 py-1 ${unit === 'month' ? 'bg-brand font-bold text-white' : 'bg-white'}`}>月ごと</button>
          <button type="button" aria-pressed={unit === 'year'} onClick={() => go('year', today.slice(0, 4))} className={`px-3 py-1 ${unit === 'year' ? 'bg-brand font-bold text-white' : 'bg-white'}`}>年ごと</button>
        </div>
        <button type="button" onClick={() => go(unit, unit === 'year' ? String(Number(period) - 1) : shiftYm(period, -1))} className="rounded border bg-white px-3 py-1">‹ 前{unit === 'year' ? '年' : '月'}</button>
        <b className="tabular-nums">{label}</b>
        <button type="button" onClick={() => go(unit, unit === 'year' ? String(Number(period) + 1) : shiftYm(period, 1))} className="rounded border bg-white px-3 py-1">{unit === 'year' ? '翌年' : '翌月'} ›</button>
        <a href={`/api/admin/accident-ends/export?unit=${unit}&period=${period}`} className="ml-auto rounded border bg-white px-3 py-1 font-bold no-underline">Excel で保存</a>
      </div>
      {data && (
        <div className="flex flex-wrap items-center gap-1.5 rounded border bg-white px-3 py-2" role="group" aria-label="件数">
          <b className="mr-1">{label}：{data.rows.length} 件</b>
          {wide && [...byStore].map(([n, c]) => <span key={n} className="rounded-full border bg-slate-50 px-2 py-0.5 text-xs">{n} {c}</span>)}
          {unit === 'year' && [...byMonth].sort().map(([m, c]) => <span key={m} className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs">{Number(m.slice(5))}月 {c}</span>)}
        </div>
      )}
      {wide && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={area} onChange={(e) => { setArea(e.target.value); setStore(''); }} aria-label="エリア" className="rounded border px-2 py-1"><option value="">すべてのエリア</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="店舗" className="rounded border px-2 py-1"><option value="">すべての店舗</option>{(data?.stores ?? []).filter((s) => !area || s.area === area).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
        </div>
      )}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-slate-100"><tr>{['申請日', ...(wide ? ['店舗'] : []), '患者氏名', '性別', '年齢', '職業', '事故日', '診断部位', '通院期間', '写真', 'アンケート', ''].map((h) => <th key={h} className="whitespace-nowrap border px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr aria-label={`終了報告 ${r.patientName}`}>
                  <td className="whitespace-nowrap border px-1.5 py-1 tabular-nums">{md(r.submittedAt.slice(0, 10))}</td>
                  {wide && <td className="whitespace-nowrap border px-1.5 py-1">{r.storeName}</td>}
                  <td className="whitespace-nowrap border px-1.5 py-1 font-bold">{r.patientName}</td>
                  <td className="border px-1.5 py-1">{r.sex}</td><td className="border px-1.5 py-1">{r.age}</td><td className="border px-1.5 py-1">{r.job}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{md(r.accidentDate)}</td><td className="border px-1.5 py-1">{r.parts}</td><td className="whitespace-nowrap border px-1.5 py-1">{r.period}</td>
                  <td className="border px-1.5 py-1">{r.photo}</td><td className="border px-1.5 py-1">{r.survey}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">
                    <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} className="text-brand underline">{open === r.id ? '閉じる' : '詳しく'}</button>
                    {r.canDelete && <button type="button" onClick={() => del(r)} className="ml-2 text-red-700 underline">取り消し</button>}
                  </td>
                </tr>
                {open === r.id && (
                  <tr key={`${r.id}d`}><td colSpan={wide ? 12 : 11} className="border bg-slate-50 px-3 py-2">
                    <dl className="grid gap-x-4 gap-y-1 md:grid-cols-[8em_1fr]">
                      <dt className="font-bold">事故発生地域</dt><dd>{r.place}</dd>
                      <dt className="font-bold">発生機序</dt><dd className="whitespace-pre-wrap">{r.mechanism}</dd>
                      <dt className="font-bold">過失割合</dt><dd>{r.fault}</dd>
                      {r.months.map((m, i) => m && <Fragment key={i}><dt className="font-bold">{i + 1}ヶ月目</dt><dd className="whitespace-pre-wrap">{m}</dd></Fragment>)}
                      {r.note && <><dt className="font-bold">備考欄</dt><dd className="whitespace-pre-wrap">{r.note}</dd></>}
                      <dt className="font-bold">申請日時</dt><dd>{r.submittedAt}</dd>
                    </dl>
                  </td></tr>
                )}
              </Fragment>
            ))}
            {data && rows.length === 0 && <tr><td colSpan={12} className="px-3 py-4 text-center text-slate-500">この期間の報告はありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
