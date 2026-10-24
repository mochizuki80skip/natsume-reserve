// 離反・フォロー /admin/churn?tab=churn|follow（離反者リスト：月ごと。2 週間フォロー：毎日のリストと履歴）
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { halfNum, halfNumInput } from '@/lib/format';
import { parseChurnSheet, type ChurnLine } from '@/lib/churnImport';

interface ChurnRow { id: string; churnDate: string; lastVisit: string | null; cardNo: string; name: string; sex: string; age: number | null; kind: string; visits: string; staff: string; symptom: string; treatment: string; manage: string; reason: string; source: 'auto' | 'import' | 'manual'; edited: boolean }
interface ChurnResp { month: string; today: string; rows: ChurnRow[]; canEdit: boolean; stats: { count: number; active: number; excluded: number; rate: number | null; rateEx: number | null }; manage: string[]; staff: string[] }
interface FollowRow { id: string; listDate: string; lastVisit: string; cardNo: string; name: string; staff: string; contactedAt: string | null; nextText: string; noBooking: boolean; note: string; autoNext: { date: string; time: number } | null }
interface FollowResp { date: string; today: string; pending: boolean; pendingCount: number; rows: FollowRow[]; canEdit: boolean }

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
const mdw = (d: string) => `${md(d)}（${WD[new Date(`${d}T00:00:00`).getDay()]}）`;
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const shiftYm = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1)).toISOString().slice(0, 7);
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diffDays = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400e3);
const fyOf = (d: string) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);

async function send(url: string, method: string, body: object) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? '保存できませんでした');
  return j;
}

function Cell({ value, onSave, label, ro, w = 'w-full', num, half, ph, boxed }: { value: string; onSave: (v: string) => void; label: string; ro: boolean; w?: string; num?: boolean; half?: boolean; ph?: string; boxed?: boolean }) {
  if (ro) return <span className="block px-1">{value}</span>;
  return (
    <input key={value} defaultValue={value} aria-label={label} inputMode={num ? 'numeric' : undefined}
      {...(half ? { onInput: (e: React.FormEvent<HTMLInputElement>) => { if (!(e.nativeEvent as InputEvent).isComposing) halfNumInput(e.currentTarget); } } : {})}
      onBlur={(e) => { const v = (half ? halfNum(e.target.value) : e.target.value).trim(); if (v !== value) onSave(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder={ph} className={`${w} px-1 outline-none focus:bg-sky-50 ${boxed ? 'm-0.5 rounded border border-slate-300 bg-white' : 'bg-transparent'}`} />
  );
}
function Pick({ value, opts, onSave, label, ro }: { value: string; opts: string[]; onSave: (v: string) => void; label: string; ro: boolean }) {
  if (ro) return <span className="block px-1 text-center">{value}</span>;
  return (
    <select value={value} aria-label={label} onChange={(e) => onSave(e.target.value)} className="w-full appearance-none bg-transparent px-1 text-center">
      <option value="" />{[...new Set([...opts, value].filter(Boolean))].map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export default function ChurnPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'follow' ? 'follow' : 'churn';
  const setQ = (p: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(p).forEach(([k, v]) => (v === null ? n.delete(k) : n.set(k, v))); setSp(n); };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-lg font-bold">離反・フォロー</h1>
        <span className="inline-flex overflow-hidden rounded border text-sm" role="tablist">
          {([['churn', '離反者リスト'], ['follow', '2週間フォロー']] as const).map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setQ({ tab: v })} className={`px-3 py-0.5 ${tab === v ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{l}</button>)}
        </span>
      </div>
      {tab === 'churn' ? <ChurnTab month={sp.get('month') ?? ''} setMonth={(m) => setQ({ month: m })} /> : <FollowTab date={sp.get('date') ?? ''} pending={sp.get('pending') === '1'} setQ={setQ} />}
    </div>
  );
}

function ChurnTab({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { data, error, reload } = useFetch<ChurnResp>(`/api/admin/churn?month=${encodeURIComponent(month)}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  // 画面のどこで Ctrl+V しても、スプレッドシートの行なら取り込みの確認を開く
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[aria-label="離反者リストの取り込み"]')) return;
      const t = e.clipboardData?.getData('text/plain') ?? '';
      if (!t.includes('\t') || (!t.trim().includes('\n') && t.split('\t').length < 6)) return;
      e.preventDefault();
      setPaste(t);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, []);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const ym = data.month;
  const ro = !data.canEdit;
  const run = async (fn: () => Promise<unknown>, done = '保存しました') => { try { await fn(); setMsg({ ok: true, text: done }); reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  const patch = (id: string, p: object) => run(() => send('/api/admin/churn', 'PATCH', { id, patch: p }));
  const st = data.stats;
  const noReason = data.rows.filter((r) => !r.reason && !r.manage).length;
  const autoCls = (r: ChurnRow) => (r.source === 'auto' && !r.edited ? 'bg-sky-100' : '');

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMonth(shiftYm(ym, -1))} className="rounded border bg-white px-2 py-0.5 text-sm">‹ 前月</button>
        <b className="text-sm">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月に離反した方</b>
        <button type="button" onClick={() => setMonth(shiftYm(ym, 1))} className="rounded border bg-white px-2 py-0.5 text-sm">翌月 ›</button>
        {noReason > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">管理・理由が未入力 {noReason} 件</span>}
        <span className="ml-auto" />
        {!ro && <button type="button" onClick={() => run(() => send('/api/admin/churn', 'POST', { churnDate: data.today.startsWith(ym) ? data.today : `${ym}-01` }), '行を追加しました')} className="rounded border bg-white px-2 py-0.5 text-sm">＋ 行を追加</button>}
        {!ro && <button type="button" onClick={() => setPaste('')} className="rounded border bg-white px-2 py-0.5 text-sm">📋 スプレッドシートから貼り付け</button>}
        <a href={`/api/admin/churn/export?month=${ym}`} className="rounded border bg-white px-2 py-0.5 text-sm no-underline">Excel で保存</a>
      </div>
      {msg && <p className={`mb-2 rounded px-3 py-1 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="離反率">
        {[['離反した方', `${st.count} 名`], ['前月に来院した方（実人数）', `${st.active} 名`], ['離反率（中止・転院を含む）', st.rate === null ? '－' : `${st.rate}%`], [`離反率（中止・転院の ${st.excluded} 名を除く）`, st.rateEx === null ? '－' : `${st.rateEx}%`]].map(([l, v]) => (
          <div key={l} className="rounded border bg-white px-3 py-1.5"><div className="text-[11px] text-slate-500">{l}</div><div className="text-lg font-bold tabular-nums">{v}</div></div>
        ))}
      </div>
      <div className="overflow-auto rounded border border-slate-300 bg-white">
        <table className="w-full border-collapse text-[12px]" aria-label="離反者リスト">
          <thead className="sticky top-0 bg-slate-300 text-[11px]">
            <tr>{['離反した日付', 'カルテNo.', '患者氏名', '性', '年', '内訳（新・再・既）', '通院回数', '担当', '症状', '施術内容', '管理（治癒・転院）', '理由', '最終来院', ''].map((h, i) => <th key={i} className="whitespace-nowrap border px-1 py-0.5">{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className={`border p-0 text-center ${autoCls(r)}`}><Cell value={md(r.churnDate)} label="離反した日付" ro={ro} w="w-14" half onSave={(v) => { const m = v.match(/^(\d{1,2})\/(\d{1,2})$/); if (m) void patch(r.id, { churnDate: `${ym.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` }); }} /></td>
                <td className={`border p-0 ${autoCls(r)}`}><Cell value={r.cardNo} label="カルテNo" ro={ro} w="w-16" half onSave={(v) => patch(r.id, { cardNo: v })} /></td>
                <td className={`border p-0 ${autoCls(r)}`}><Cell value={r.name} label="患者氏名" ro={ro} w="w-28" onSave={(v) => patch(r.id, { name: v })} /></td>
                <td className={`border p-0 ${autoCls(r)} ${r.sex === '♂' ? 'text-blue-600' : r.sex === '♀' ? 'text-red-600' : ''} font-bold`}><Pick value={r.sex} opts={['♂', '♀']} label="性" ro={ro} onSave={(v) => patch(r.id, { sex: v })} /></td>
                <td className={`border p-0 ${autoCls(r)}`}><Cell value={r.age === null ? '' : String(r.age)} label="年" ro={ro} w="w-10" num half onSave={(v) => patch(r.id, { age: v })} /></td>
                <td className={`border p-0 ${autoCls(r)}`}><Pick value={r.kind} opts={['新患', '再来', '既存']} label="内訳" ro={ro} onSave={(v) => patch(r.id, { kind: v })} /></td>
                <td className={`border p-0 ${autoCls(r)} ${!r.visits && !ro ? 'bg-yellow-200' : ''}`}><Cell value={r.visits} label="通院回数" ro={ro} w="w-14" half onSave={(v) => patch(r.id, { visits: v })} /></td>
                <td className={`border p-0 ${autoCls(r)}`}><Cell value={r.staff} label="担当" ro={ro} w="w-20" onSave={(v) => patch(r.id, { staff: v })} /></td>
                <td className={`border p-0 ${autoCls(r)}`}><Cell value={r.symptom} label="症状" ro={ro} w="w-24" onSave={(v) => patch(r.id, { symptom: v })} /></td>
                <td className={`border p-0 ${autoCls(r)}`}><Pick value={r.treatment} opts={['矯正', 'マッサ']} label="施術内容" ro={ro} onSave={(v) => patch(r.id, { treatment: v })} /></td>
                <td className="border p-0"><Pick value={r.manage} opts={data.manage} label="管理" ro={ro} onSave={(v) => patch(r.id, { manage: v })} /></td>
                <td className="border p-0"><Cell value={r.reason} label="理由" ro={ro} w="min-w-[220px] w-full" onSave={(v) => patch(r.id, { reason: v })} /></td>
                <td className="border px-1 text-center text-slate-500">{md(r.lastVisit)}</td>
                <td className="border px-1 text-center">{!ro && r.source !== 'auto' && <button type="button" title="この行を削除" onClick={() => confirm('この行を削除しますか？') && run(() => send('/api/admin/churn', 'DELETE', { id: r.id }), '削除しました')} className="text-[11px] text-slate-400 hover:text-red-700">✕</button>}</td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={14} className="p-4 text-center text-slate-500">この月に離反した方はいません（予約表の来院チェックから自動で出します）。</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        <i className="mr-1 inline-block h-2.5 w-2.5 border bg-sky-100 align-middle" />水色＝来院の記録から自動で入った欄（直せます）。<i className="mx-1 inline-block h-2.5 w-2.5 border bg-yellow-200 align-middle" />黄色＝通院回数が空（システムを使う前から通っている方は店舗で入れてください）。
        離反＝最後の来院から翌月の同じ日までに来院がない方（例：3/2 が最後なら 4/2 に離反）。新患継続率の予後が中止・転院の方は「管理」に自動で入ります。
        離反率＝その月に離反した方 ÷ 前月に来院した方（実人数）。
      </p>
      {paste !== null && <ImportDialog initial={paste} ym={ym} onClose={() => setPaste(null)} onDone={(m) => { setPaste(null); setMsg({ ok: true, text: m }); reload(); }} />}
    </>
  );
}

function ImportDialog({ initial, ym, onClose, onDone }: { initial: string; ym: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [fy, setFy] = useState(fyOf(`${ym}-01`));
  const [text, setText] = useState(initial);
  const [lines, setLines] = useState<(ChurnLine & { status?: string; serverError?: string })[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const check = async (t = text) => {
    setErr(''); setLines(null);
    const p = parseChurnSheet(t, fy);
    if (p.error) { setErr(p.error); return; }
    const good = p.lines.filter((l) => l.row);
    if (!p.lines.length) { setErr('取り込む行がありません'); return; }
    setBusy(true);
    try {
      const j = good.length ? await send('/api/admin/churn/import', 'POST', { rows: good.map((l) => l.row), dryRun: true }) : { rows: [] };
      let k = 0;
      setLines(p.lines.map((l) => (l.row ? { ...l, status: j.rows[k].status, serverError: j.rows[k++].error } : { ...l, status: 'error' })));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (initial) void check(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = (lines ?? []).filter((l) => l.row && l.status !== 'error');
  const run = async () => {
    setBusy(true);
    try { const j = await send('/api/admin/churn/import', 'POST', { rows: ok.map((l) => l.row) }); onDone(`${j.counts.new} 件を新しく入れ、${j.counts.update} 件を上書きしました`); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void check(); }} onClick={(e) => e.stopPropagation()} aria-label="離反者リストの取り込み" className="w-full max-w-5xl rounded-lg bg-white p-4 text-sm shadow-xl">
        <div className="mb-2 flex items-center"><h2 className="text-base font-bold">📋 離反者リストをスプレッドシートから貼り付け</h2><button type="button" onClick={onClose} aria-label="閉じる" className="ml-auto text-slate-500">✕</button></div>
        <p className="mb-2 text-xs text-slate-600">スプレッドシートで行を選んでコピー（Ctrl+C）し、ここに貼り付け（Ctrl+V）ます。見出しの行はあってもなくても読めます。同じ日付・同じカルテNo（なければ氏名）の行は上書きします。年のない日付は選んだ年度で読みます。</p>
        <label className="mb-2 flex items-center gap-1 text-xs">年度<select value={fy} onChange={(e) => { setFy(Number(e.target.value)); setLines(null); }} className="rounded border px-2 py-1">{[fy - 1, fy, fy + 1].map((y) => <option key={y} value={y}>{y}年度</option>)}</select></label>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setLines(null); }} rows={lines ? 3 : 6} aria-label="貼り付ける欄" placeholder="ここに貼り付け（Ctrl+V）"
          onPaste={(e) => { const t = e.clipboardData.getData('text/plain'); if (t) { e.preventDefault(); setText(t); void check(t); } }} className="w-full rounded border-2 border-dashed px-2 py-1 font-mono text-xs" />
        {err && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-red-800">{err}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!lines ? <button type="submit" disabled={!text.trim() || busy} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">内容を確認する</button> : <>
            <span>新しく入る <b>{lines.filter((l) => l.status === 'new').length}</b> 件・上書き <b>{lines.filter((l) => l.status === 'update').length}</b> 件{lines.some((l) => l.status === 'error') && <b className="text-red-700">・読めない {lines.filter((l) => l.status === 'error').length} 件</b>}</span>
            <button type="button" onClick={run} disabled={busy || !ok.length} className="ml-auto rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{`${ok.length} 件を取り込む`}</button>
          </>}
        </div>
        {lines && (
          <div className="mt-2 max-h-[50vh] overflow-auto rounded border">
            <table className="w-full border-collapse text-[11.5px]" aria-label="取り込みの確認">
              <thead className="sticky top-0 bg-slate-100"><tr>{['行', '結果', '離反日', 'カルテNo', '氏名', '性', '年', '内訳', '通院', '担当', '症状', '施術', '管理', '理由'].map((h) => <th key={h} className="border-b px-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.line} className="border-b">
                  <td className="px-1 text-slate-400">{l.line}</td>
                  <td className="whitespace-nowrap px-1">{l.status === 'new' ? <span className="rounded bg-green-100 px-1 font-bold text-green-800">新しく入る</span> : l.status === 'update' ? <span className="rounded bg-sky-100 px-1 font-bold text-sky-800">上書き</span> : <span className="rounded bg-red-100 px-1 font-bold text-red-800">{l.error ?? l.serverError}</span>}</td>
                  {l.row ? [md(l.row.churnDate), l.row.cardNo, l.row.name, l.row.sex, l.row.age ?? '', l.row.kind, l.row.visits, l.row.staff, l.row.symptom, l.row.treatment, l.row.manage, l.row.reason].map((v, i) => <td key={i} className="whitespace-nowrap px-1">{v}</td>) : <td colSpan={12} />}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </form>
    </div>
  );
}

function FollowTab({ date, pending, setQ }: { date: string; pending: boolean; setQ: (p: Record<string, string | null>) => void }) {
  const { data, error, reload } = useFetch<FollowResp>(`/api/admin/follow?date=${encodeURIComponent(date)}${pending ? '&pending=1' : ''}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const ro = !data.canEdit;
  const patch = async (id: string, p: object) => { try { await send('/api/admin/follow', 'PATCH', { id, patch: p }); setMsg({ ok: true, text: '保存しました' }); reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {!pending && <>
          <button type="button" onClick={() => setQ({ date: addDays(data.date, -1) })} className="rounded border bg-white px-2 py-0.5 text-sm">‹ 前日</button>
          <b className="text-sm">{mdw(data.date)} のリスト（{md(addDays(data.date, -14))} に来院・予約なし）</b>
          <button type="button" disabled={data.date >= data.today} onClick={() => setQ({ date: addDays(data.date, 1) })} className="rounded border bg-white px-2 py-0.5 text-sm disabled:opacity-40">翌日 ›</button>
          {data.date !== data.today && <button type="button" onClick={() => setQ({ date: null })} className="rounded border bg-white px-2 py-0.5 text-sm">今日</button>}
        </>}
        <label className="ml-2 flex items-center gap-1 text-sm"><input type="checkbox" checked={pending} onChange={(e) => setQ({ pending: e.target.checked ? '1' : null })} />まだ対応していない方（過去の分も）</label>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">未対応 {data.pendingCount} 件</span>
      </div>
      {msg && <p className={`mb-2 rounded px-3 py-1 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <div className="overflow-auto rounded border border-slate-300 bg-white">
        <table className="w-full border-collapse text-[12px]" aria-label="2週間フォロー">
          <thead className="bg-slate-300 text-[11px]"><tr>{[...(pending ? ['リストの日'] : []), '最終来院', '経過', 'カルテNo.', '患者氏名', '担当', '連絡', '次回来院日時', '備考'].map((h) => <th key={h} className="whitespace-nowrap border px-1 py-0.5">{h}</th>)}</tr></thead>
          <tbody>
            {data.rows.map((r) => {
              const done = !!r.contactedAt || !!r.nextText || r.noBooking || !!r.autoNext;
              return (
                <tr key={r.id} className={done ? '' : 'bg-amber-50'}>
                  {pending && <td className="border px-1 text-center">{md(r.listDate)}</td>}
                  <td className="border px-1 text-center">{mdw(r.lastVisit)}</td>
                  <td className="border px-1 text-center tabular-nums">{diffDays(r.lastVisit, data.today)} 日</td>
                  <td className="border px-1">{r.cardNo || <span className="text-slate-400">未登録</span>}</td>
                  <td className="border px-1">{r.name}</td>
                  <td className="border px-1">{r.staff}</td>
                  <td className="whitespace-nowrap border px-1 text-center">
                    <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!r.contactedAt} disabled={ro} onChange={(e) => patch(r.id, { contacted: e.target.checked })} aria-label={`${r.name} に連絡した`} />{r.contactedAt ? md(r.contactedAt) : ''}</label>
                  </td>
                  <td className="whitespace-nowrap border p-0">
                    {r.autoNext ? <span className="px-1 font-bold text-green-800">{mdw(r.autoNext.date)} {hm(r.autoNext.time)}〜（予約表）</span> : (
                      <div className="flex items-center">
                        {!r.noBooking && <Cell value={r.nextText} label={`${r.name} の次回来院日時`} ro={ro} w="w-36" ph="例：11/2 10:30" boxed onSave={(v) => patch(r.id, { nextText: v })} />}
                        <label className="mx-1 inline-flex items-center gap-0.5 text-[11px]"><input type="checkbox" checked={r.noBooking} disabled={ro} onChange={(e) => patch(r.id, { noBooking: e.target.checked })} aria-label={`${r.name} は未予約`} />未予約</label>
                      </div>
                    )}
                  </td>
                  <td className="border p-0"><Cell value={r.note} label={`${r.name} の備考`} ro={ro} w="min-w-[200px] w-full" onSave={(v) => patch(r.id, { note: v })} /></td>
                </tr>
              );
            })}
            {data.rows.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-slate-500">{pending ? 'まだ対応していない方はいません。' : 'この日のリストはありません。'}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">毎日、その 14 日前に来院し、そのあと来院・予約がない方をリストにします（リストは日ごとに残ります）。あとから予約表に予約が入ると、次回来院日時が自動で出ます。薄い黄色＝まだ連絡・次回の入力がない方。</p>
    </>
  );
}
