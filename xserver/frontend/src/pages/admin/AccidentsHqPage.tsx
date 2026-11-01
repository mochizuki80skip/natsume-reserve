// 新自・新三（全店） /admin/hq/accidents?month=YYYY-MM（本部・管轄MG＝全店。見るだけ）
// その月の新自（交通事故）・新三（第三者行為）と、前の月までの未入力（事故日・事故内容）。店舗ごとの未入力の件数、エリア・店舗・未入力だけで絞り込み、Excel
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { useAdmin } from './Layout';

interface Row {
  id: string; store: string; storeName: string; area: string; date: string; kind: 'ACCIDENT' | 'THIRD'; karteNo: string; name: string;
  trig: string; trigDetail: string; staff: string; accidentDate: string | null; accidentNote: string; missing: boolean; earlier: boolean;
}
interface Resp { month: string; rows: Row[]; stores: { code: string; name: string; area: string }[]; areas: string[] }

const shiftYm = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const ymd = (d?: string | null) => (d ? d.replaceAll('-', '/') : '');

export default function AccidentsHqPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const role = me.session.role;
  const ym = sp.get('month') ?? (me.today ?? new Date().toISOString()).slice(0, 7);
  const { data, error } = useFetch<Resp>(role === 'hq' || role === 'mg' ? `/api/admin/hq/accidents?month=${ym}` : null);
  const [area, setArea] = useState('');
  const [store, setStore] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  if (role !== 'hq' && role !== 'mg') return <Navigate to="/admin" replace />;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  const go = (m: string) => setSp({ month: m });
  const all = data?.rows ?? [];
  const rows = all.filter((r) => (!area || r.area === area) && (!store || r.store === store) && (!onlyMissing || r.missing));
  const missByStore = new Map<string, number>();
  for (const r of all) if (r.missing) missByStore.set(r.store, (missByStore.get(r.store) ?? 0) + 1);
  const [y, m] = ym.split('-').map(Number);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">新自・新三（全店）</h1>
        <button type="button" onClick={() => go(shiftYm(ym, -1))} className="rounded border bg-white px-3 py-1">‹ 前月</button>
        <b className="tabular-nums">{y}年{m}月</b>
        <button type="button" onClick={() => go(shiftYm(ym, 1))} className="rounded border bg-white px-3 py-1">翌月 ›</button>
        <a href={`/api/admin/hq/accidents/export?month=${ym}`} className="ml-auto rounded border bg-white px-3 py-1 font-bold no-underline">Excel で保存</a>
      </div>
      <p className="text-xs text-slate-600">新規の交通事故（新自）・第三者行為（新三）の事故日・事故内容を、全店まとめて見る画面です（見るだけ。入力は店舗の「新患継続率」の下の一覧で行います）。前の月までの未入力も出します。<span className="rounded bg-yellow-300 px-1">黄色</span>は未入力です。</p>
      {data && (
        <div className="flex flex-wrap items-center gap-1.5 rounded border bg-white px-3 py-2" role="group" aria-label="店舗ごとの未入力">
          <b className="mr-1 text-xs">未入力</b>
          {missByStore.size === 0 ? <span className="text-xs text-green-700">すべて入力済みです</span> : [...missByStore].map(([code, n]) => (
            <button key={code} type="button" onClick={() => { setStore(code); setArea(''); setOnlyMissing(true); }}
              className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-800">{data.stores.find((s) => s.code === code)?.name ?? code} {n} 件</button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={area} onChange={(e) => { setArea(e.target.value); setStore(''); }} aria-label="エリア" className="rounded border px-2 py-1">
          <option value="">すべてのエリア</option>
          {(data?.areas ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="店舗" className="rounded border px-2 py-1">
          <option value="">すべての店舗</option>
          {(data?.stores ?? []).filter((s) => !area || s.area === area).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
        <label><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> 未入力だけ</label>
        <span className="text-xs text-slate-500">{rows.length} 件</span>
      </div>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse text-[12.5px]" aria-label="新自・新三（全店）">
          <thead className="bg-slate-100">
            <tr>{['店舗', '初診日', '区分', 'カルテNo', '氏名', 'きっかけ', '事故日', '事故内容', '担当'].map((h) => <th key={h} className="whitespace-nowrap border px-1.5 py-1 text-left">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap border px-1.5 py-1">{r.storeName}{r.area && <span className="block text-[10.5px] text-slate-500">{r.area}</span>}</td>
                <td className="whitespace-nowrap border px-1.5 py-1 tabular-nums">{ymd(r.date)}{r.earlier && <span className="block text-[10.5px] text-red-700">前の月の未入力</span>}</td>
                <td className="whitespace-nowrap border px-1.5 py-1">{r.kind === 'THIRD' ? '新三' : '新自'}</td>
                <td className="whitespace-nowrap border px-1.5 py-1">{r.karteNo}</td>
                <td className="whitespace-nowrap border px-1.5 py-1">{r.name}</td>
                <td className="whitespace-nowrap border px-1.5 py-1">{r.trig}{r.trigDetail ? `（${r.trigDetail}）` : ''}</td>
                <td className={`whitespace-nowrap border px-1.5 py-1 tabular-nums ${r.accidentDate ? '' : 'bg-yellow-300'}`}>{ymd(r.accidentDate)}</td>
                <td className={`min-w-[14rem] whitespace-pre-line border px-1.5 py-1 ${r.accidentNote.trim() ? '' : 'bg-yellow-300'}`}>{r.accidentNote}</td>
                <td className="whitespace-nowrap border px-1.5 py-1">{r.staff}</td>
              </tr>
            ))}
            {data && rows.length === 0 && <tr><td colSpan={9} className="px-2 py-4 text-center text-slate-500">該当する新自・新三はありません</td></tr>}
            {!data && <tr><td colSpan={9} className="px-2 py-4 text-center text-slate-500">読み込み中…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
