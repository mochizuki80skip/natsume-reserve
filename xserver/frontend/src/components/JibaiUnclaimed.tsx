// 自賠の未請求者リスト。新自（初診が自賠）の方で、自賠請求のスクショ（登録した明細）に同じカルテNo が無い方。
// 店舗＝自店舗の一覧（理由・除く）。本部・管轄MG＝店舗ごとの人数（押すと一覧）
import { useState } from 'react';
import { useFetch } from '@/lib/api';

interface Row { id: string; date: string; karteNo: string; name: string; staff: string; reason: string; excluded: boolean; noKarteNo: boolean }
interface StoreResp { start: string | null; rows: Row[]; count: number; canEdit?: boolean }
interface HqResp { start: string | null; stores: { code: string; name: string; area: string; count: number; rows: Row[] }[]; mine: string[] | null }

const md = (d: string) => `${Number(d.slice(0, 4))}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const ymJa = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
const NOTE = '新患継続率の新自（初診が自賠）の方で、自賠請求のスクショで登録した明細に、同じカルテNo（患者番号）が 1 度も無い方です。今月の初診は請求前なので出しません。';

async function put(body: object) {
  const r = await fetch('/api/admin/jibai/unclaimed', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) alert(((await r.json().catch(() => ({}))) as { error?: string }).error ?? '保存できませんでした');
}

/** 店舗：自店舗の未請求者 */
export function JibaiUnclaimedStore() {
  const { data, reload } = useFetch<StoreResp>('/api/admin/jibai/unclaimed?scope=store');
  if (!data || !Array.isArray(data.rows)) return null;
  const ro = data.canEdit === false;
  const rows = [...data.rows.filter((r) => !r.excluded), ...data.rows.filter((r) => r.excluded)];
  return (
    <section className="rounded border border-amber-300 bg-white p-4 text-sm" aria-label="自賠の未請求者">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">自賠の未請求者</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${data.count ? 'bg-red-500 text-white' : 'bg-green-100 text-green-800'}`}>{data.count ? `${data.count} 人` : 'いません'}</span>
        {data.start && <span className="text-xs text-slate-500">（{ymJa(data.start)}の初診から）</span>}
      </div>
      <p className="mt-1 text-xs text-slate-600">{NOTE}請求できない理由を入れてください。請求しない方（自費になった・番号の違いなど）は「除く」を付けると人数から外れます。</p>
      {rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-slate-100"><tr>{['初診日', 'カルテNo', '氏名', '担当', '理由', '除く'].map((h) => <th key={h} className="whitespace-nowrap border px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.excluded ? 'text-slate-400' : ''} aria-label={`未請求 ${r.name}`}>
                  <td className="whitespace-nowrap border px-1.5 py-1 tabular-nums">{md(r.date)}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{r.noKarteNo ? <span className="font-bold text-red-700">未入力（新患継続率で入れてください）</span> : r.karteNo}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{r.name}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{r.staff}</td>
                  <td className="border px-1 py-0.5"><input key={r.reason} defaultValue={r.reason} disabled={ro} aria-label={`${r.name} の理由`} maxLength={200} placeholder="例）書類待ち・保険会社確認中" onBlur={async (e) => { if (e.target.value.trim() !== r.reason) { await put({ id: r.id, reason: e.target.value }); reload(); } }} className="w-full min-w-[12em] rounded border px-1 py-0.5" /></td>
                  <td className="border px-1.5 py-1 text-center"><input type="checkbox" checked={r.excluded} disabled={ro} aria-label={`${r.name} を除く`} onChange={async (e) => { await put({ id: r.id, excluded: e.target.checked }); reload(); }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 本部・管轄MG：店舗ごとの人数（押すと一覧。見るだけ） */
export function JibaiUnclaimedHq() {
  const { data } = useFetch<HqResp>('/api/admin/jibai/unclaimed');
  const [open, setOpen] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  if (!data || !Array.isArray(data.stores)) return null;
  const stores = data.stores.filter((s) => !mineOnly || !data.mine || data.mine.includes(s.code));
  const total = stores.reduce((a, s) => a + s.count, 0);
  return (
    <section className="rounded border bg-white p-4 text-sm" aria-label="自賠の未請求者（店舗ごと）">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">自賠の未請求者（店舗ごと）</h2>
        <span className="text-xs text-slate-500">{data.start ? `${ymJa(data.start)}の初診から` : 'まだ自賠請求の登録がありません'}</span>
        <b className="ml-2">合計 {total} 人</b>
        {data.mine && <label className="ml-2 text-xs"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> 管轄の店舗だけ</label>}
      </div>
      <p className="mt-1 text-xs text-slate-600">{NOTE}店舗名を押すと一覧が出ます（理由は店舗が入れます）。</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {stores.map((s) => (
          <button key={s.code} type="button" onClick={() => setOpen(open === s.code ? null : s.code)} aria-expanded={open === s.code} aria-label={`未請求 ${s.name} ${s.count}人`}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${s.count ? 'border-red-300 bg-red-50 font-bold text-red-800' : 'bg-slate-50 text-slate-500'}`}>{s.name} {s.count} 人</button>
        ))}
      </div>
      {open && (() => {
        const s = data.stores.find((x) => x.code === open)!;
        return (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-100"><tr>{['初診日', 'カルテNo', '氏名', '担当', '理由', ''].map((h) => <th key={h} className="whitespace-nowrap border px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>
                {s.rows.length === 0 && <tr><td colSpan={6} className="border px-2 py-2 text-slate-500">いません</td></tr>}
                {s.rows.map((r) => (
                  <tr key={r.id} className={r.excluded ? 'text-slate-400' : ''}>
                    <td className="whitespace-nowrap border px-1.5 py-1 tabular-nums">{md(r.date)}</td>
                    <td className="whitespace-nowrap border px-1.5 py-1">{r.noKarteNo ? 'カルテNo 未入力' : r.karteNo}</td>
                    <td className="whitespace-nowrap border px-1.5 py-1">{r.name}</td>
                    <td className="whitespace-nowrap border px-1.5 py-1">{r.staff}</td>
                    <td className="border px-1.5 py-1">{r.reason || <span className="text-red-700">（理由なし）</span>}</td>
                    <td className="whitespace-nowrap border px-1.5 py-1">{r.excluded ? '除く' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}
    </section>
  );
}
