// 日報 /admin/report?date=YYYY-MM-DD（A4 1 枚。印刷・PDF 保存）。項目は本部が決め、数字は予約表・窓口集計・シフトなどから自動で入る。黄色の欄だけ店舗で入力
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { addDays, formatDateJa, nowJst } from '@/lib/time';

type Fmt = 'num' | 'yen' | 'dec' | 'pct' | 'time' | 'text' | 'staff';
interface Item { id: string; section: string; kind: 'value' | 'perf' | 'text' | 'staff'; label: string; source: string; fmt: Fmt; editable: boolean; value: number | string | null; target?: number | null; diff?: number | null }
interface Person { name: string; head: boolean; shift: string; churnRate?: number | null }
interface Resp { date: string; store: { code: string; name: string }; canEdit: boolean; items: Item[]; staff: { therapists: Person[]; reception: Person[]; help: { status: string; name: string } | null } }

const SHIFT: Record<string, string> = { WORK: '〇', OFF: '休', AM_OFF: '前休', PM_OFF: '後休', PAID: '有給', AM_PAID: '前有', PM_PAID: '後有', HELP: 'ヘルプ', AM_HELP: '前ヘルプ', PM_HELP: '後ヘルプ' };
const HELP: Record<string, string> = { HELP_IN: '終日', AM_HELP_IN: '午前', PM_HELP_IN: '午後' };

/** 表示の形にする（time は分 → 1:05） */
export function fmtValue(v: number | string | null | undefined, fmt: Fmt): string {
  if (v === null || v === undefined || v === '') return '';
  if (fmt === 'text') return String(v);
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (fmt === 'time') return `${n < 0 ? '-' : ''}${Math.floor(Math.abs(n) / 60)}:${String(Math.abs(n) % 60).padStart(2, '0')}`;
  if (fmt === 'yen') return `¥${n.toLocaleString('ja-JP')}`;
  if (fmt === 'dec') return Number.isInteger(n) ? String(n) : n.toFixed(1);
  if (fmt === 'pct') return `${n}%`;
  return n.toLocaleString('ja-JP');
}

export default function ReportPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const date = sp.get('date') ?? nowJst().date;
  const { data, error, reload } = useFetch<Resp>(`/api/admin/report?date=${encodeURIComponent(date)}`);
  const [msg, setMsg] = useState('');
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const go = (d: string) => navigate(`/admin/report?date=${d}`);

  async function save(it: Item, raw: string) {
    const r = await fetch('/api/admin/report/value', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data!.date, item: it.id, value: raw }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? '' : (j as { error?: string }).error ?? '保存できませんでした');
    if (r.ok) reload();
  }
  const Val = ({ it, big }: { it: Item; big?: boolean }) => {
    const shown = it.fmt === 'time' ? fmtValue(it.value, 'time') : it.value === null ? '' : String(it.value);
    if (it.editable && data.canEdit) {
      return it.fmt === 'text'
        ? <textarea key={`${data.date}:${it.id}:${shown}`} defaultValue={shown} rows={2} aria-label={it.label} onBlur={(e) => e.target.value !== shown && save(it, e.target.value)} className="report-input w-full resize-none bg-yellow-50 px-1 text-center" />
        : <input key={`${data.date}:${it.id}:${shown}`} defaultValue={shown} aria-label={it.label} inputMode={it.fmt === 'time' ? 'text' : 'numeric'} placeholder={it.fmt === 'time' ? '0:00' : ''}
          onBlur={(e) => e.target.value !== shown && save(it, e.target.value)} className={`report-input w-full bg-yellow-50 px-1 text-right ${big ? 'text-base font-bold' : ''}`} />;
    }
    return <span className={big ? 'text-base font-bold' : ''}>{fmtValue(it.value, it.fmt)}</span>;
  };

  // まとまりごとに（並びは本部の設定の順）
  const sections: { name: string; items: Item[] }[] = [];
  for (const it of data.items) {
    const last = sections.at(-1);
    if (last && last.name === it.section) last.items.push(it); else sections.push({ name: it.section, items: [it] });
  }
  const cell = 'border border-slate-400 px-1.5 py-0.5';
  const st = data.staff;

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">日報</h1>
        <button type="button" onClick={() => go(addDays(data.date, -1))} className="rounded border bg-white px-3 py-1">‹ 前日</button>
        <input type="date" value={data.date} onChange={(e) => e.target.value && go(e.target.value)} className="rounded border px-2 py-1" aria-label="日付" />
        <button type="button" onClick={() => go(addDays(data.date, 1))} className="rounded border bg-white px-3 py-1">翌日 ›</button>
        <button type="button" onClick={() => go(nowJst().date)} className="rounded border bg-white px-3 py-1">今日</button>
        <button type="button" onClick={() => window.print()} className="rounded bg-brand px-4 py-1 font-bold text-white">印刷・PDF</button>
        <span className="text-xs text-slate-500">水色＝自動で入る数字、黄色＝店舗で入力（押して入力すると保存）。PDF は印刷の画面で「PDF に保存」を選びます。</span>
      </div>
      {msg && <p className="no-print mb-2 rounded bg-red-50 px-3 py-1 text-sm text-red-700">{msg}</p>}

      <article className="report-sheet mx-auto bg-white p-4 text-[12px] text-slate-900 shadow print:p-0 print:shadow-none" aria-label="日報">
        <header className="mb-2 flex items-end justify-between border-b-2 border-slate-700 pb-1">
          <b className="text-base">{data.store.name}</b>
          <b className="text-base">日報　{formatDateJa(data.date)}</b>
        </header>
        <div className="grid gap-2">
          {sections.map((sec) => {
            const values = sec.items.filter((i) => i.kind === 'value');
            const perf = sec.items.filter((i) => i.kind === 'perf');
            const texts = sec.items.filter((i) => i.kind === 'text');
            const hasStaff = sec.items.some((i) => i.kind === 'staff');
            return (
              <section key={sec.name} className="break-inside-avoid" aria-label={sec.name}>
                {sec.name && <h2 className="border border-b-0 border-slate-400 bg-slate-200 px-1.5 text-[12px] font-bold">{sec.name}</h2>}
                {values.length > 0 && (
                  <table className="w-full border-collapse"><tbody>
                    {Array.from({ length: Math.ceil(values.length / 2) }, (_, r) => (
                      <tr key={r}>
                        {[0, 1].map((c) => {
                          const it = values[r * 2 + c];
                          return it ? [
                            <td key={`l${c}`} className={`${cell} w-[22%] bg-slate-50`}>{it.label}</td>,
                            <td key={`v${c}`} className={`${cell} w-[28%] text-right tabular-nums ${it.editable ? 'bg-yellow-50' : 'bg-sky-50'}`}><Val it={it} big={it.fmt === 'num' && it.label.endsWith('合計')} /></td>,
                          ] : [<td key={`e${c}`} className={cell} colSpan={2} />];
                        })}
                      </tr>
                    ))}
                  </tbody></table>
                )}
                {perf.length > 0 && (
                  <table className="w-full border-collapse text-center">
                    <thead><tr className="bg-slate-50"><th className={cell}>項目</th><th className={cell}>目標</th><th className={cell}>実績</th><th className={cell}>差分</th></tr></thead>
                    <tbody>{perf.map((it) => (
                      <tr key={it.id}><td className={cell}>{it.label}</td>
                        <td className={`${cell} bg-sky-50 tabular-nums`}>{it.target == null ? '－' : fmtValue(it.target, it.fmt)}</td>
                        <td className={`${cell} bg-sky-50 tabular-nums`}>{fmtValue(it.value, it.fmt)}</td>
                        <td className={`${cell} bg-sky-50 tabular-nums ${(it.diff ?? 0) < 0 ? 'text-red-700' : ''}`}>{it.diff == null ? '－' : fmtValue(it.diff, it.fmt)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
                {texts.map((it) => <div key={it.id} className={`${cell} min-h-[2.2em] text-center text-[13px] ${it.editable ? 'bg-yellow-50' : ''}`}><Val it={it} /></div>)}
                {hasStaff && (
                  <table className="w-full border-collapse text-center">
                    <tbody>
                      <tr><td className={`${cell} w-16 bg-slate-50`} rowSpan={3}>施術者</td>{st.therapists.map((p) => <td key={p.name} className={cell}>{p.name}{p.head && <span className="ml-0.5 rounded bg-slate-700 px-0.5 text-[10px] text-white">院長</span>}</td>)}{!st.therapists.length && <td className={cell}>－</td>}</tr>
                      <tr>{st.therapists.map((p) => <td key={p.name} className={`${cell} bg-sky-50 tabular-nums`} title="離反率（今月）">{p.churnRate == null ? '－' : `離反 ${p.churnRate.toFixed(1)}%`}</td>)}</tr>
                      <tr>{st.therapists.map((p) => <td key={p.name} className={`${cell} bg-sky-50`}>{SHIFT[p.shift] ?? p.shift}</td>)}</tr>
                      <tr><td className={`${cell} bg-slate-50`}>受付</td>{st.reception.map((p) => <td key={p.name} className={cell}>{p.name}（{SHIFT[p.shift] ?? p.shift}）</td>)}
                        {st.help && <td className={cell}>ヘルプ{st.help.name && `：${st.help.name}`}（{HELP[st.help.status] ?? ''}）</td>}
                        {!st.reception.length && !st.help && <td className={cell}>－</td>}</tr>
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      </article>
    </div>
  );
}
