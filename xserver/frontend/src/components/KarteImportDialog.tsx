// 新患継続率：スプレッドシートからコピーした行を貼り付けて取り込む。取り込む前に、行ごとの結果（新しく入る／上書き／読めない）を見せる
import { useEffect, useState } from 'react';
import { KIND_LABEL, md, type KarteOptions } from '@/lib/karte';
import { parseSheet, type ImportRow, type ParsedLine } from '@/lib/karteImport';

type Checked = ParsedLine & { status?: 'new' | 'update' | 'error'; serverError?: string };

const fyOf = (date: string) => (Number(date.slice(5, 7)) >= 4 ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1);

/** month：開いている月（年のない日付はその月の年度で読む）。initialText：画面で Ctrl+V したときの中身（すぐ確認まで進める） */
export default function KarteImportDialog({ today, month, initialText = '', options, onClose, onDone }: { today: string; month: string; initialText?: string; options: KarteOptions; onClose: () => void; onDone: (months: string[]) => void }) {
  const thisFy = fyOf(today);
  const [fy, setFy] = useState(fyOf(`${month}-01`));
  const [text, setText] = useState(initialText);
  const [lines, setLines] = useState<Checked[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(rows: ImportRow[], dryRun: boolean) {
    const r = await fetch('/api/admin/karte/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, dryRun }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? '読み込めませんでした');
    return j as { counts: { new: number; update: number; error: number }; rows: { status: 'new' | 'update' | 'error'; error?: string }[] };
  }

  async function check(t = text) {
    setErr(''); setLines(null);
    const p = parseSheet(t, fy);
    if (p.error) { setErr(p.error); return; }
    if (!p.lines.length) { setErr('取り込む行がありません（氏名の入った行がありません）'); return; }
    const good = p.lines.filter((l) => l.row);
    setBusy(true);
    try {
      const res = good.length ? await post(good.map((l) => l.row!), true) : { rows: [] };
      let k = 0;
      setLines(p.lines.map((l) => (l.row ? { ...l, status: res.rows[k].status, serverError: res.rows[k++].error } : { ...l, status: 'error' })));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function run() {
    const ok = (lines ?? []).filter((l) => l.row && l.status !== 'error');
    if (!ok.length) return;
    setBusy(true);
    try {
      const res = await post(ok.map((l) => l.row!), false);
      alert(`${res.counts.new} 件を新しく入れ、${res.counts.update} 件を上書きしました。`);
      onDone([...new Set(ok.map((l) => l.row!.date.slice(0, 7)))].sort());
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  useEffect(() => { if (initialText) void check(initialText); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nNew = lines?.filter((l) => l.status === 'new').length ?? 0;
  const nUp = lines?.filter((l) => l.status === 'update').length ?? 0;
  const nErr = lines?.filter((l) => l.status === 'error').length ?? 0;
  const odd = (v: string, list: string[]) => v !== '' && !list.includes(v);
  const Chip = ({ l }: { l: Checked }) => l.status === 'new' ? <span className="rounded bg-green-100 px-1.5 font-bold text-green-800">新しく入る</span>
    : l.status === 'update' ? <span className="rounded bg-sky-100 px-1.5 font-bold text-sky-800">上書き</span>
      : <span className="rounded bg-red-100 px-1.5 font-bold text-red-800">{l.error ?? l.serverError ?? '読めません'}</span>;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void check(); }} onClick={(e) => e.stopPropagation()} aria-label="スプレッドシートから貼り付け" className="w-full max-w-5xl rounded-lg bg-white p-4 text-sm shadow-xl">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-bold">📋 スプレッドシートから貼り付け</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="ml-auto text-slate-500">✕</button>
        </div>
        <ol className="mb-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
          <li>スプレッドシートで、取り込みたい行を選んでコピー（Ctrl+C）します。</li>
          <li>下の欄に貼り付け（Ctrl+V）ます。新患継続率の画面のどこで Ctrl+V しても、ここが開きます。見出しの行がなくても、画面と同じ並びなら読めます。年のない日付（「4/3」など）は、選んだ年度で読みます。</li>
          <li>同じ日付・同じ氏名の行がもうあるときは、<b>貼り付けた内容で上書き</b>します（貼り付けた側が空の欄は、今の内容のままです）。</li>
        </ol>
        <div className="mb-2 flex items-center gap-2">
          <label className="flex items-center gap-1">年度
            <select value={fy} onChange={(e) => { setFy(Number(e.target.value)); setLines(null); }} className="rounded border px-2 py-1">
              {[...new Set([thisFy - 2, thisFy - 1, thisFy, fy])].sort().map((y) => <option key={y} value={y}>{y}年度（{y}年4月〜{y + 1}年3月）</option>)}
            </select>
          </label>
        </div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setLines(null); }}
          onPaste={(e) => { const t = e.clipboardData.getData('text/plain'); if (t) { e.preventDefault(); setText(t); void check(t); } }}
          placeholder="ここに貼り付け（Ctrl+V）" aria-label="貼り付ける欄" rows={lines ? 3 : 8}
          className="w-full rounded border-2 border-dashed px-2 py-1 font-mono text-xs" />
        {err && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-red-800">{err}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!lines && <button type="submit" disabled={!text.trim() || busy} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{busy ? '確認中…' : '内容を確認する'}</button>}
          {lines && <>
            <span>新しく入る <b>{nNew}</b> 件・上書き <b>{nUp}</b> 件{nErr > 0 && <>・<b className="text-red-700">読めない {nErr} 件（取り込みません）</b></>}</span>
            <button type="button" onClick={run} disabled={busy || nNew + nUp === 0} className="ml-auto rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{busy ? '取り込み中…' : `${nNew + nUp} 件を取り込む`}</button>
            <button type="button" onClick={onClose} className="rounded border px-3 py-1">やめる</button>
          </>}
        </div>
        {lines && (
          <div className="mt-2 max-h-[55vh] overflow-auto rounded border">
            <table className="w-full border-collapse text-[11.5px]" aria-label="取り込みの確認">
              <thead className="sticky top-0 bg-slate-100 text-[10.5px] text-slate-600">
                <tr>{['行', '結果', '日付', 'カルテNo', '氏名', '新・再', 'きっかけ', '内訳', '年齢', '性別', '症状ｶﾃｺﾞﾘｰ', '担当', '施術', '2回目', '3回目', '4回目', '5回目', '6回目'].map((h) => <th key={h} className="whitespace-nowrap border-b px-1.5 py-1 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const r = l.row;
                  return (
                    <tr key={l.line} className={`border-b ${l.status === 'error' ? 'bg-red-50/50' : ''}`}>
                      <td className="px-1.5 py-0.5 text-slate-400">{l.line}</td>
                      <td className="whitespace-nowrap px-1.5 py-0.5"><Chip l={l} /></td>
                      {r ? <>
                        <td className="whitespace-nowrap px-1.5">{r.date.replace(/-/g, '/')}</td>
                        <td className="px-1.5">{r.karteNo}</td>
                        <td className="whitespace-nowrap px-1.5">{r.name}</td>
                        <td className="px-1.5">{KIND_LABEL[r.kind]}</td>
                        <td className={`whitespace-nowrap px-1.5 ${odd(r.trig, [...options.trigger, ...options.revisitAction]) ? 'bg-yellow-200' : ''}`} title={odd(r.trig, [...options.trigger, ...options.revisitAction]) ? '選択肢にない言葉です（そのまま入ります）' : undefined}>{r.trig}</td>
                        <td className="whitespace-nowrap px-1.5">{r.trigDetail}</td>
                        <td className="px-1.5">{r.age ?? ''}</td>
                        <td className="px-1.5">{r.sex}</td>
                        <td className={`whitespace-nowrap px-1.5 ${odd(r.symptomCat, options.symptom) ? 'bg-yellow-200' : ''}`} title={odd(r.symptomCat, options.symptom) ? '選択肢にない言葉です（そのまま入ります）' : undefined}>{r.symptomCat}</td>
                        <td className="whitespace-nowrap px-1.5">{r.staff}</td>
                        <td className="px-1.5">{r.treatment}</td>
                        {r.visits.map((v, i) => <td key={i} className="whitespace-nowrap px-1.5">{md(v.d)}</td>)}
                      </> : <td colSpan={16} />}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {lines && <p className="mt-1 text-[11px] text-slate-500"><i className="mr-1 inline-block h-2.5 w-2.5 bg-yellow-200 align-middle" />黄色＝新患継続率の選択肢にない言葉（そのまま入ります。あとで直せます）</p>}
      </form>
    </div>
  );
}
