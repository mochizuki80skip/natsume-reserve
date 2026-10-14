// 担当数（/admin/staff-counts）：担当者ごとの来院数・新患・再来・回数・2回目到達率（スタッフの評価用）
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { nowJst } from '@/lib/time';

interface Row { staff: string; total: number; new: number; revisit: number; jibai: number; counts: Record<string, number>; firsts: number; reached2: number }
interface Resp { month: string; rows: Row[]; partial: boolean }

const shift = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export default function StaffCountsPage() {
  const [ym, setYm] = useState(nowJst().date.slice(0, 7));
  const { data, error } = useFetch<Resp>(`/api/admin/staff-counts?month=${ym}`);
  const visitCols = [...new Set((data?.rows ?? []).flatMap((r) => Object.keys(r.counts)))].sort((a, b) => parseInt(a) - parseInt(b));
  const rate = (r: Row) => (r.firsts ? `${Math.round((r.reached2 / r.firsts) * 100)}%` : '－');
  const header = ['担当', '担当数', '新患', '再来', '新自', ...visitCols, '初回担当', '2回目到達率'];
  const line = (r: Row) => [r.staff || '担当なし', r.total, r.new, r.revisit, r.jibai, ...visitCols.map((m) => r.counts[m] ?? 0), r.firsts, rate(r)];
  function copy() {
    if (!data) return;
    const tsv = [header, ...data.rows.map(line)].map((x) => x.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv).catch(() => {});
  }
  return (
    <div className="max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">担当数</h1>
        <button type="button" onClick={() => setYm(shift(ym, -1))} className="rounded border bg-white px-3 py-1">‹ 前月</button>
        <b className="tabular-nums">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b>
        <button type="button" onClick={() => setYm(shift(ym, 1))} className="rounded border bg-white px-3 py-1">翌月 ›</button>
        <button type="button" onClick={copy} className="ml-auto rounded border bg-white px-3 py-1">表をコピー（Excel に貼り付け）</button>
      </div>
      <p className="mb-2 text-xs text-slate-600">来院チェック済みの予約だけを数えます。担当は予約表のメニューの帯で付けます。「2回目到達率」＝その月に初回（初診・再来・新自）を担当した患者様のうち、2回目に来た割合（初回カルテ集計から）。</p>
      {data?.partial && <p className="mb-2 rounded bg-amber-50 px-3 py-1 text-xs text-amber-900">この月は予約表の保存期間を過ぎた日を含むため、担当数は残っている日だけの数字です（2回目到達率は初回カルテ集計から出ます）。</p>}
      {error && <p className="text-sm text-red-700">{error.message}</p>}
      {!data ? <p className="text-sm text-slate-500">読み込み中…</p> : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm tabular-nums">
            <thead><tr className="bg-slate-100 text-xs">{header.map((h, i) => <th key={h} className={`px-2 py-1 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={header.length} className="px-2 py-3 text-xs text-slate-400">この月の来院チェック済みの予約はありません</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.staff || '-'} className="border-t">
                  {line(r).map((v, i) => <td key={i} className={`px-2 py-1 ${i === 0 ? 'text-left font-bold' : 'text-right'} ${i === 0 && !r.staff ? 'text-slate-500' : ''}`}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
