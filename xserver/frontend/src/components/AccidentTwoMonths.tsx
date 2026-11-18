// 新自・新三：初診から 2ヶ月たった方のリスト。継続・中止・終了を選ぶ（中止・終了はリストから外れる）
// 店舗＝自店舗（新患継続率の下）、本部・管轄MG＝全店（新自・新三（全店）の「2ヶ月経過」）。選べるのは直せる店舗だけ
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { useAdmin } from '@/pages/admin/Layout';

interface Row { id: string; store: string; storeName: string; area: string; date: string; kind: 'ACCIDENT' | 'THIRD'; karteNo: string; name: string; trig: string; trigDetail: string; staff: string; lastVisit: string; status: '' | 'CONT' | 'STOP' | 'END'; canEdit: boolean }
interface Resp { today: string; rows: Row[]; mine: string[] | null }

const STATUS: [Row['status'], string][] = [['', '（未選択）'], ['CONT', '継続'], ['STOP', '中止'], ['END', '終了']];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 初診からの経過（〇ヶ月〇日） */
function elapsed(from: string, to: string) {
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1), days = d2 - d1;
  if (days < 0) { months -= 1; days += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate(); }
  return `${months}ヶ月${days ? `${days}日` : ''}`;
}

export default function AccidentTwoMonths({ wide = false }: { wide?: boolean }) {
  const { me, refreshMe } = useAdmin();
  const { data, reload } = useFetch<Resp>('/api/admin/accidents/two-months');
  const [mineOnly, setMineOnly] = useState(true);
  const [msg, setMsg] = useState('');
  if (!data) return null;
  const rows = data.rows.filter((r) => !data.mine || !mineOnly || data.mine.includes(r.store));
  const pending = rows.filter((r) => r.status === '').length;
  async function set(r: Row, status: Row['status']) {
    const res = await fetch('/api/admin/accidents/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, status }) });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? (status === 'STOP' || status === 'END' ? `${r.name || 'この方'} を「${STATUS.find((x) => x[0] === status)?.[1]}」にしました（リストから外れます）` : '保存しました') : (j as { error?: string }).error ?? '保存できませんでした');
    reload(); refreshMe();
  }
  return (
    <section className="mt-4 rounded border border-amber-300 bg-white p-3 text-sm" aria-label="2ヶ月経過の交通事故の患者様">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">2ヶ月経過（新自・新三の通院中）</h2>
        {pending > 0 && <span className="rounded bg-red-500 px-2 py-0.5 text-xs font-bold text-white">未選択 {pending}件</span>}
        {data.mine && <label className="ml-2 text-xs"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> 管轄の店舗だけ</label>}
      </div>
      <p className="mt-1 text-xs text-slate-600">初診から 2ヶ月たった交通事故（新自）・第三者行為（新三）の患者様です。「中止」「終了」を選ぶとリストから外れます（「継続」はそのまま残ります）。{me.session.role !== 'store' && '状態を選べるのは、直せる店舗だけです。'}</p>
      {msg && <p className="mt-1 rounded bg-brand-light px-2 py-1 text-xs">{msg}</p>}
      {rows.length === 0 ? <p className="mt-2 text-xs text-slate-500">いまはいません</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-slate-100"><tr>{[...(wide ? ['店舗'] : []), '初診日', '経過', '区分', 'カルテNo', '氏名', 'きっかけ', '担当', '最後の来院', '状態'].map((h) => <th key={h} className="whitespace-nowrap border px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.status === '' ? 'bg-yellow-50' : ''} aria-label={`2ヶ月 ${r.name}`}>
                  {wide && <td className="whitespace-nowrap border px-1.5 py-1">{r.storeName}</td>}
                  <td className="whitespace-nowrap border px-1.5 py-1 tabular-nums">{md(r.date)}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{elapsed(r.date, data.today)}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{r.kind === 'THIRD' ? '新三' : '新自'}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{r.karteNo}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{r.name}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{r.trig}{r.trigDetail ? `（${r.trigDetail}）` : ''}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">{r.staff}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1 tabular-nums">{md(r.lastVisit)}</td>
                  <td className="whitespace-nowrap border px-1.5 py-1">
                    {r.canEdit
                      ? <select value={r.status} onChange={(e) => { const v = e.target.value as Row['status']; if ((v === 'STOP' || v === 'END') && !confirm(`${r.name || 'この方'} を「${STATUS.find((x) => x[0] === v)?.[1]}」にしますか？（リストから外れます）`)) return; void set(r, v); }} aria-label={`${r.name} の状態`} className="rounded border px-1 py-0.5">
                        {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      : <span>{STATUS.find((x) => x[0] === r.status)?.[1]}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
