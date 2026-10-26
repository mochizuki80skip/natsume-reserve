// 日報 /admin/report?date=YYYY-MM-DD（A4 1 枚。印刷・PDF 保存）。今までのスプレッドシートの日報と同じ形に並べ、
// 数字は本部が決めた項目（どこから取るか）で予約表・窓口集計・シフトなどから自動で入る。黄色の欄だけ店舗で入力
import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { WEEKDAY_JA, addDays, nowJst, weekdayOf } from '@/lib/time';

type Fmt = 'num' | 'yen' | 'dec' | 'pct' | 'time' | 'text' | 'staff';
interface Item { id: string; section: string; kind: 'value' | 'perf' | 'text' | 'staff'; label: string; source: string; fmt: Fmt; editable: boolean; value: number | string | null; target?: number | null; diff?: number | null }
interface Person { name: string; head: boolean; shift: string; churnRate?: number | null }
interface Resp { date: string; store: { code: string; name: string }; canEdit: boolean; items: Item[]; staff: { therapists: Person[]; reception: Person[]; help: { status: string; name: string } | null } }

// 出勤の欄：〇（出勤）・前休・後休など。休みは空欄
const SHIFT: Record<string, string> = { WORK: '〇', OFF: '', AM_OFF: '前休', PM_OFF: '後休', PAID: '有給', AM_PAID: '前有', PM_PAID: '後有', HELP: 'ヘルプ', AM_HELP: '前ヘルプ', PM_HELP: '後ヘルプ' };
const HELP: Record<string, string> = { HELP_IN: '〇', AM_HELP_IN: '午前', PM_HELP_IN: '午後' };
/** スプレッドシートの日報で決まった場所に出す項目（ほかの項目は下の「追加の項目」に出る） */
const PLACED = ['target-avg', 'workdays', 'am', 'pm', 'jibai', 'self', 'total', 'new', 'revisit', 'new-jibai', 'third', 'new-total', 'ot-today', 'ot-month',
  'm-copay', 'm-third', 'm-self', 'm-acu', 'm-goods', 'm-unknown', 'm-colcopay', 'm-colself', 'm-diffcopay', 'm-diffself', 'm-deposit', 'm-cert', 'm-total', 'bank-1', 'bank-2', 'ins-claim', 'jibai-claim',
  'p-new', 'p-revisit', 'p-goods', 'p-review', 'avg', 'achieve', 'goal', 'staff'];

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
/** 月間成績の数（物販は ¥ を付けずにカンマ区切り。スプレッドシートと同じ） */
const plain = (v: number | string | null | undefined, fmt: Fmt) => (v === null || v === undefined || v === '' ? '' : fmt === 'time' ? fmtValue(v, 'time') : Number(v).toLocaleString('ja-JP'));

export default function ReportPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const date = sp.get('date') ?? nowJst().date;
  const { data, error, reload } = useFetch<Resp>(`/api/admin/report?date=${encodeURIComponent(date)}`);
  const [msg, setMsg] = useState('');
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const go = (d: string) => navigate(`/admin/report?date=${d}`);
  const byId = new Map(data.items.map((i) => [i.id, i]));

  async function save(it: Item, raw: string) {
    const r = await fetch('/api/admin/report/value', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data!.date, item: it.id, value: raw }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? '' : (j as { error?: string }).error ?? '保存できませんでした');
    if (r.ok) reload();
  }
  /** 値（手入力の項目は入力欄。自動は文字） */
  const val = (id: string, o: { cls?: string; text?: boolean; show?: (it: Item) => string } = {}): ReactNode => {
    const it = byId.get(id);
    if (!it) return null;
    const shown = it.fmt === 'time' || it.fmt === 'yen' ? fmtValue(it.value, it.fmt) : it.value === null ? '' : String(it.value);
    if (it.editable && data.canEdit) {
      return o.text || it.fmt === 'text'
        ? <textarea key={`${data.date}:${id}:${shown}`} defaultValue={shown} rows={2} aria-label={it.label} onBlur={(e) => e.target.value !== shown && save(it, e.target.value)} className={`report-input w-full resize-none bg-yellow-50 text-center ${o.cls ?? ''}`} />
        : <input key={`${data.date}:${id}:${shown}`} defaultValue={shown} aria-label={it.label} inputMode={it.fmt === 'time' ? 'text' : 'numeric'} placeholder={it.fmt === 'time' ? '0:00' : ''}
          onBlur={(e) => e.target.value !== shown && save(it, e.target.value)} className={`report-input w-full bg-yellow-50 text-center ${o.cls ?? ''}`} />;
    }
    return <span className={o.cls}>{o.show ? o.show(it) : fmtValue(it.value, it.fmt)}</span>;
  };
  const label = (id: string, fallback = '') => byId.get(id)?.label ?? fallback;
  const wd = WEEKDAY_JA[weekdayOf(data.date)];
  const [y, m, d] = data.date.split('-').map(Number);
  // 店舗名は「なつめ接骨院」と「〇〇店」の 2 段に（スプレッドシートと同じ）
  const name = data.store.name;
  const cut = name.indexOf('接骨院');
  const [name1, name2] = cut >= 0 ? [name.slice(0, cut + 3), name.slice(cut + 3).trim()] : [name, ''];
  const st = data.staff;
  const therapists = [...st.therapists, ...Array.from({ length: Math.max(0, 7 - st.therapists.length) }, () => null)];
  const reception = [...st.reception, ...Array.from({ length: Math.max(0, 3 - st.reception.length) }, () => null)];
  // 決まった場所に出ない項目：日報に出ない入力（「今月の合計」のもとの手入力）と、追加の項目
  const extras = data.items.filter((i) => !PLACED.includes(i.id) && i.kind !== 'staff');
  const usedBySum = new Set(data.items.filter((i) => i.source.startsWith('sum:')).map((i) => i.source.slice(4)));
  const inputOnly = extras.filter((i) => i.editable && usedBySum.has(i.id));
  const printed = extras.filter((i) => !inputOnly.includes(i));
  const perf = ['p-new', 'p-revisit', 'p-goods', 'p-review'].map((id) => byId.get(id)).filter((x): x is Item => !!x);
  const goal = byId.get('goal');

  const bd = 'border border-slate-800';
  // 本日の来院数の 1 行（名前・数・人）
  const visitRow = (id: string, big = false) => (
    <div className={`flex items-end border-b border-slate-800 ${big ? 'pt-1' : ''}`}>
      <span className={`w-16 whitespace-nowrap ${big ? 'text-[19px] font-bold' : 'text-[13px] font-bold'}`}>{label(id)}</span>
      <span className={`flex-1 text-center tabular-nums ${big ? 'text-[19px] font-bold' : 'text-[13px] font-bold'}`}>{val(id)}</span>
      <span className={`w-6 text-right ${big ? 'text-[19px] font-bold' : 'text-[13px] font-bold'}`}>人</span>
    </div>
  );
  const yenCell = (id: string) => <td className={`${bd} w-[16%] px-1 text-right tabular-nums`}>{val(id, { show: (it) => plain(it.value, it.fmt) })}</td>;
  const lblCell = (id: string) => <td className={`${bd} w-[10%] px-1 text-[10px] font-bold`}>{label(id)}</td>;

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">日報</h1>
        <button type="button" onClick={() => go(addDays(data.date, -1))} className="rounded border bg-white px-3 py-1">‹ 前日</button>
        <input type="date" value={data.date} onChange={(e) => e.target.value && go(e.target.value)} className="rounded border px-2 py-1" aria-label="日付" />
        <button type="button" onClick={() => go(addDays(data.date, 1))} className="rounded border bg-white px-3 py-1">翌日 ›</button>
        <button type="button" onClick={() => go(nowJst().date)} className="rounded border bg-white px-3 py-1">今日</button>
        <button type="button" onClick={() => window.print()} className="rounded bg-brand px-4 py-1 font-bold text-white">印刷・PDF</button>
        <span className="text-xs text-slate-500">黄色＝店舗で入力（押して入力すると保存）。ほかは自動で入ります。PDF は印刷の画面で「PDF に保存」を選びます。</span>
      </div>
      {msg && <p className="no-print mb-2 rounded bg-red-50 px-3 py-1 text-sm text-red-700">{msg}</p>}
      {inputOnly.length > 0 && data.canEdit && (
        <div className="no-print mx-auto mb-2 flex max-w-[194mm] flex-wrap items-center gap-3 rounded border bg-white px-3 py-1.5 text-sm" aria-label="日報に出ない入力">
          <span className="text-xs text-slate-500">今月の合計に足す入力：</span>
          {inputOnly.map((it) => <label key={it.id} className="flex items-center gap-1">{it.label}<span className="w-20 rounded border">{val(it.id)}</span></label>)}
        </div>
      )}

      <article className="report-sheet mx-auto bg-white p-5 text-[12px] text-slate-900 shadow print:p-0 print:shadow-none" aria-label="日報">
        {/* 店舗名・日付・曜日 */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="grid grid-cols-2 text-center font-bold leading-tight"><span className="text-[15px]">{name1.replace('接骨院', '')}</span><span className="text-[15px]">{cut >= 0 ? '接骨院' : ''}</span><span className="text-[12px]">{name2.replace(/店$/, '')}</span><span className="text-[12px]">{name2.endsWith('店') ? '店' : ''}</span></div>
          <div className={`${bd} px-4 py-2 text-[13px] font-bold`}>{y}年{m}月{d}日</div>
          <div className="text-center text-[14px] font-bold">{wd}　曜日</div>
        </div>
        {/* 平均来院数目標・稼働日数 */}
        <div className="mt-4 grid grid-cols-2 gap-8">
          <div className="flex items-end border-b border-slate-800"><span className="flex-1 text-[13px] font-bold">{label('target-avg', '平均来院数目標')}</span><span className="w-24 text-center text-[19px] font-bold tabular-nums">{val('target-avg')}</span></div>
          <div className="flex items-end border-b border-slate-800"><span className="flex-1 text-[13px] font-bold">{label('workdays', '稼働日数')}</span><span className="w-20 text-center text-[19px] font-bold tabular-nums">{val('workdays')}</span></div>
        </div>
        {/* 本日の来院数 */}
        <div className={`${bd} mt-3 inline-block px-2 text-[11px] font-bold`}>本日の来院数</div>
        <div className="mt-1 grid grid-cols-[1fr_1fr_0.9fr] gap-x-6">
          <div className="grid gap-y-1">{visitRow('am')}{visitRow('pm')}{visitRow('jibai')}{visitRow('self')}{visitRow('total', true)}</div>
          <div className="grid gap-y-1">{visitRow('new')}{visitRow('revisit')}{visitRow('new-jibai')}{visitRow('third')}{visitRow('new-total', true)}</div>
          <div className="flex flex-col items-center gap-1 pt-1 text-[13px] font-bold">
            <span>{label('ot-today', '本日の時間外')}</span>
            <span className="w-28 text-center text-[14px]">{val('ot-today', { cls: 'border border-slate-800' })}</span>
            <span className="mt-4">{label('ot-month', '今月の時間外')}</span>
            <span className="text-[14px]">{val('ot-month')}</span>
          </div>
        </div>
        {/* 入金額詳細 */}
        <table className="mt-3 w-full border-collapse text-[11px]">
          <tbody>
            <tr><td className={`${bd} bg-white text-center font-bold`} colSpan={8}>入金額詳細</td></tr>
            <tr>{lblCell('m-copay')}{yenCell('m-copay')}{lblCell('m-colcopay')}{yenCell('m-colcopay')}
              <td className={`${bd} text-center text-[11px] font-bold`} colSpan={2} rowSpan={2}>{label('m-total', '本日の窓口計')}</td><td className={`${bd} text-center text-[14px] font-bold`} colSpan={2} rowSpan={2}>{val('m-total')}</td></tr>
            <tr>{lblCell('m-third')}{yenCell('m-third')}{lblCell('m-colself')}{yenCell('m-colself')}</tr>
            <tr>{lblCell('m-self')}{yenCell('m-self')}{lblCell('m-diffcopay')}{yenCell('m-diffcopay')}
              <td className={`${bd} text-center text-[11px] font-bold`} colSpan={4}>本日の通帳入金額<br /><span className="text-[10px]">※手入力</span></td></tr>
            <tr>{lblCell('m-acu')}{yenCell('m-acu')}{lblCell('m-diffself')}{yenCell('m-diffself')}
              <td className={`${bd} bg-slate-200 text-center text-[12px] font-bold`} colSpan={2}>{val('bank-1', { show: (it) => fmtValue(it.value, 'yen') })}</td><td className={`${bd} bg-slate-200 text-center text-[12px] font-bold`} colSpan={2}>{val('bank-2', { show: (it) => fmtValue(it.value, 'yen') })}</td></tr>
            <tr>{lblCell('m-goods')}{yenCell('m-goods')}{lblCell('m-deposit')}{yenCell('m-deposit')}
              <td className={`${bd} text-center text-[11px] font-bold`} colSpan={4}>請求情報</td></tr>
            <tr>{lblCell('m-unknown')}{yenCell('m-unknown')}{lblCell('m-cert')}{yenCell('m-cert')}
              <td className={`${bd} text-[10px] font-bold`}>{label('ins-claim', '保険請求額')}</td><td className={`${bd} text-right tabular-nums`}>{val('ins-claim', { show: (it) => plain(it.value, it.fmt) })}</td>
              <td className={`${bd} text-[10px] font-bold`}>{label('jibai-claim', '自賠請求額')}</td><td className={`${bd} text-right tabular-nums`}>{val('jibai-claim', { show: (it) => plain(it.value, it.fmt) })}</td></tr>
          </tbody>
        </table>
        {/* 月間成績 */}
        <table className="mt-3 w-full border-collapse text-center text-[12px]">
          <thead>
            <tr><th className={`${bd} border-2 text-[12px]`} colSpan={4}>月間成績</th></tr>
            <tr className="font-bold"><td className={bd}>項目</td><td className={bd}>目標</td><td className={bd}>実績</td><td className={bd}>差分</td></tr>
          </thead>
          <tbody>
            {perf.map((it) => (
              <tr key={it.id}>
                <td className={`${bd} font-bold`}>{it.label}</td>
                <td className={`${bd} tabular-nums`}>{it.target == null ? '' : plain(it.target, it.fmt)}</td>
                <td className={`${bd} tabular-nums`}>{plain(it.value, it.fmt)}</td>
                <td className={`${bd} tabular-nums`}>{it.diff == null ? '' : plain(it.diff, it.fmt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 grid grid-cols-2 gap-8">
          <div className="flex items-end border-b border-slate-800"><span className="flex-1 text-[14px] font-bold">{label('avg', '現在の平均')}</span><span className="w-24 text-center text-[16px] font-bold tabular-nums">{val('avg')}</span></div>
          <div className="flex items-end border-b border-slate-800"><span className="flex-1 text-[14px] font-bold">{label('achieve', '目標達成率')}</span><span className="w-20 text-center text-[16px] font-bold tabular-nums">{val('achieve')}</span></div>
        </div>
        {/* 今月の目標 */}
        {goal && (
          <div className={`${bd} mt-3`}>
            <div className={`border-b border-slate-800 px-2 py-0.5 text-center text-[12px] font-bold`}>{goal.section || goal.label}</div>
            <div className="min-h-[2.4em] px-2 py-1 text-center text-[14px] font-bold">{val('goal', { text: true })}</div>
          </div>
        )}
        {/* 出勤状況 */}
        {byId.has('staff') && (
          <table className="mt-3 w-full table-fixed border-collapse text-center text-[11px]">
            <tbody>
              <tr><td className={`${bd} px-1 text-left font-bold`} colSpan={8}>出勤状況</td></tr>
              <tr>
                <td className={`${bd} w-[12%] font-bold leading-tight`} rowSpan={3}>資格者<br />離反率<br />出勤</td>
                {therapists.map((p, i) => <td key={i} className={`${bd} font-bold`}>{p ? <>{p.name}{p.head && <span className="ml-0.5 text-[9px] font-normal">（院長）</span>}</> : ''}</td>)}
              </tr>
              <tr>{therapists.map((p, i) => <td key={i} className={`${bd} text-right tabular-nums`}>{p ? (p.churnRate == null ? '0.0%' : `${p.churnRate.toFixed(1)}%`) : (i < 7 ? '0.0%' : '')}</td>)}</tr>
              <tr>{therapists.map((p, i) => <td key={i} className={`${bd} text-left`}>{p ? SHIFT[p.shift] ?? p.shift : ''}</td>)}</tr>
              <tr>
                <td className={`${bd} font-bold leading-tight`} rowSpan={2}>受付<br />出勤</td>
                {reception.map((p, i) => <td key={i} className={`${bd} font-bold`}>{p?.name ?? ''}</td>)}
                <td className={`${bd} font-bold`}>ヘルプ1{st.help?.name ? `（${st.help.name}）` : ''}</td><td className={`${bd} font-bold`}>ヘルプ2</td>
                {Array.from({ length: Math.max(0, 7 - reception.length - 2) }, (_, i) => <td key={`x${i}`} className={bd} />)}
              </tr>
              <tr>
                {reception.map((p, i) => <td key={i} className={`${bd} text-left`}>{p ? SHIFT[p.shift] ?? p.shift : ''}</td>)}
                <td className={`${bd} text-left`}>{st.help ? HELP[st.help.status] ?? '' : ''}</td><td className={bd} />
                {Array.from({ length: Math.max(0, 7 - reception.length - 2) }, (_, i) => <td key={`y${i}`} className={bd} />)}
              </tr>
            </tbody>
          </table>
        )}
        {/* 本部が足した項目 */}
        {printed.length > 0 && (
          <table className="mt-3 w-full border-collapse text-[11px]" aria-label="追加の項目">
            <tbody>
              <tr><td className={`${bd} px-1 font-bold`} colSpan={4}>追加の項目</td></tr>
              {Array.from({ length: Math.ceil(printed.length / 2) }, (_, r) => (
                <tr key={r}>{[0, 1].map((c) => { const it = printed[r * 2 + c]; return it ? [<td key={`l${c}`} className={`${bd} w-[20%] px-1 font-bold`}>{it.label}</td>, <td key={`v${c}`} className={`${bd} w-[30%] px-1 text-right`}>{it.kind === 'perf' ? `${plain(it.value, it.fmt)}（目標 ${it.target == null ? '－' : plain(it.target, it.fmt)}）` : val(it.id)}</td>] : [<td key={`e${c}`} className={bd} colSpan={2} />]; })}</tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </div>
  );
}
