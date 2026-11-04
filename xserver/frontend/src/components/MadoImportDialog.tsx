// 窓口集計：スプレッドシートから取り込む（貼り付け・ファイル）。月間窓口表の日ごとの欄と、返戻。
// 取り込む前に、日・行ごとの結果（新しく入る／上書き／同じ）を見せ、上書きがあるときは最後に確かめてから取り込む
import { useState } from 'react';
import SheetFilePicker from './SheetFilePicker';
import { parseTsv } from '@/lib/karteImport';
import { DAY_LABEL, HENREI_LABEL, readMado, type HenreiRow, type MadoDay } from '@/lib/madoImport';

interface Res { counts: { new: number; update: number; same: number }; days: { date: string; status: 'new' | 'update' | 'same'; overwrite: string[] }[]; henrei: { status: 'new' | 'update' | 'same' | 'error'; error?: string }[] }
const fyOf = (ym: string) => (Number(ym.slice(5, 7)) >= 4 ? Number(ym.slice(0, 4)) : Number(ym.slice(0, 4)) - 1);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const Chip = ({ s, err }: { s: string; err?: string }) => s === 'new' ? <span className="rounded bg-green-100 px-1.5 font-bold text-green-800">新しく入る</span>
  : s === 'update' ? <span className="rounded bg-sky-100 px-1.5 font-bold text-sky-800">上書き</span>
    : s === 'same' ? <span className="rounded bg-slate-100 px-1.5 text-slate-600">同じ（変わらない）</span>
      : <span className="rounded bg-red-100 px-1.5 font-bold text-red-800">{err ?? '読めません'}</span>;

export default function MadoImportDialog({ month, onClose, onDone }: { month: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [text, setText] = useState('');
  const [data, setData] = useState<{ days: MadoDay[]; henrei: HenreiRow[]; month: string } | null>(null);
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(d: { days: MadoDay[]; henrei: HenreiRow[]; month: string }, dryRun: boolean): Promise<Res> {
    const r = await fetch('/api/admin/madoguchi/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, dryRun }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? '読み込めませんでした');
    return j as Res;
  }
  async function check(grid: string[][]) {
    setErr(''); setRes(null); setData(null);
    const p = readMado(grid, fyOf(month));
    if (p.error) { setErr(p.error); return; }
    if (!p.days.length && !p.henrei.length) { setErr('取り込む内容がありません（金額の入った日・返戻の行がありません）'); return; }
    // 返戻は、読んだ日付の月（なければ開いている月）の分として入れる
    const months = p.days.map((d) => d.date.slice(0, 7));
    const m = months.length ? months.sort((a, b) => months.filter((x) => x === b).length - months.filter((x) => x === a).length)[0] : month;
    const d = { days: p.days, henrei: p.henrei, month: m };
    setBusy(true);
    try { setRes(await post(d, true)); setData(d); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function run() {
    if (!data || !res) return;
    const upDays = res.days.filter((x) => x.status === 'update');
    const upHen = res.henrei.filter((x) => x.status === 'update').length;
    if ((upDays.length || upHen) && !confirm(`次の内容は、今入っている金額を取り込んだ内容で上書きします（取り込む側が空の欄は今のまま）。\n${upDays.length ? `月間窓口表：${upDays.map((x) => md(x.date)).join('・')}\n` : ''}${upHen ? `返戻：${upHen} 行\n` : ''}取り込みますか？`)) return;
    setBusy(true);
    try {
      const j = await post(data, false);
      onDone(`取り込みました（新しく入る ${j.counts.new}・上書き ${j.counts.update}・同じ ${j.counts.same}）`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  const total = res ? res.counts.new + res.counts.update : 0;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void check(parseTsv(text)); }} onClick={(e) => e.stopPropagation()} aria-label="窓口集計の取り込み" className="w-full max-w-5xl rounded-lg bg-white p-4 text-sm shadow-xl">
        <div className="mb-2 flex items-center"><h2 className="text-base font-bold">📋 窓口集計をスプレッドシートから取り込む（貼り付け・ファイル）</h2><button type="button" onClick={onClose} aria-label="閉じる" className="ml-auto text-slate-500">✕</button></div>
        <ol className="mb-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
          <li><b>ファイルから</b>：スプレッドシートを Excel（.xlsx）で保存したファイルを選び、月のシートを選びます。「月間窓口表」と「返戻」を見出しで見つけて読みます（物販内訳・計算の欄は読みません）。</li>
          <li><b>貼り付け</b>：月間窓口表の「日付」から「自賠責請求金額」までを、見出しの 2 段もいっしょにコピー（Ctrl+C）して、下の欄に貼り付け（Ctrl+V）ます。</li>
          <li>もう入っている日は、<b>取り込んだ金額で上書き</b>します（取り込む側が空の欄は今のまま）。取り込む前に結果を確かめられます。</li>
        </ol>
        <div className="mb-2"><SheetFilePicker kind="mado" onPick={(sh) => void check(sh.grid)} /></div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} rows={res ? 2 : 5} aria-label="貼り付ける欄" placeholder="ここに貼り付け（Ctrl+V）"
          onPaste={(e) => { const t = e.clipboardData.getData('text/plain'); if (t) { e.preventDefault(); setText(t); void check(parseTsv(t)); } }} className="w-full rounded border-2 border-dashed px-2 py-1 font-mono text-xs" />
        {err && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-red-800" role="alert">{err}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!res ? <button type="submit" disabled={!text.trim() || busy} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{busy ? '確認中…' : '内容を確認する'}</button> : <>
            <span aria-label="取り込みの結果">新しく入る <b>{res.counts.new}</b>・上書き <b>{res.counts.update}</b>・同じ <b>{res.counts.same}</b>（月間窓口表 {res.days.length} 日・返戻 {res.henrei.length} 行）</span>
            <button type="button" onClick={run} disabled={busy || total === 0} className="ml-auto rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{busy ? '取り込み中…' : `${total} 件を取り込む`}</button>
            <button type="button" onClick={onClose} className="rounded border px-3 py-1">やめる</button>
          </>}
        </div>
        {res && data && (
          <div className="mt-2 max-h-[55vh] space-y-2 overflow-auto">
            {res.days.length > 0 && (
              <table className="w-full border-collapse text-[11.5px]" aria-label="月間窓口表の取り込みの確認">
                <thead className="sticky top-0 bg-slate-100"><tr><th className="border px-1">日付</th><th className="border px-1">結果</th><th className="border px-1 text-left">取り込む金額（上書きする欄は青）</th></tr></thead>
                <tbody>{res.days.map((x, i) => (
                  <tr key={x.date}>
                    <td className="whitespace-nowrap border px-1 tabular-nums">{md(x.date)}</td>
                    <td className="whitespace-nowrap border px-1"><Chip s={x.status} /></td>
                    <td className="border px-1">{Object.entries(data.days[i]?.vals ?? {}).map(([k, v]) => <span key={k} className={`mr-2 whitespace-nowrap ${x.overwrite.includes(k) ? 'font-bold text-sky-800' : ''}`}>{DAY_LABEL[k] ?? k} {v.toLocaleString()}</span>)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {res.henrei.length > 0 && (
              <table className="w-full border-collapse text-[11.5px]" aria-label="返戻の取り込みの確認">
                <thead className="sticky top-0 bg-slate-100"><tr><th className="border px-1">結果</th>{Object.values(HENREI_LABEL).map((h) => <th key={h} className="border px-1">{h}</th>)}</tr></thead>
                <tbody>{res.henrei.map((x, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap border px-1"><Chip s={x.status} err={x.error} /></td>
                    {Object.keys(HENREI_LABEL).map((k) => <td key={k} className="whitespace-nowrap border px-1">{String(data.henrei[i]?.[k] ?? '')}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
