// 差し込み語（MEO）：店舗名・エリア・キーワード・本部が決めた差し込み語を、全店舗まとめて表で入力する。
// 保存すると、作成済みの下書きに残っている {…} も埋まる（下書きが完成する）
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { sendJson, type VarDef } from '@/lib/sns';
import { toRow, type StoreVars } from '@/lib/snsVars';
import { StoreDot } from '@/lib/storeColor';
import SnsNav from '@/components/SnsNav';

interface Resp { stores: StoreVars[]; customVars: VarDef[]; isHq: boolean }
type Col = { id: string; label: string; token: string; ph: string; get: (s: StoreVars) => string; set: (s: StoreVars, v: string) => StoreVars; wide?: boolean };

export default function SnsVarsPage() {
  const { data, error, reload } = useFetch<Resp>('/api/admin/sns/vars');
  const [rows, setRows] = useState<StoreVars[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setRows(data.stores); setDirty(new Set()); } }, [data]);
  if (error) return <div><SnsNav title="差し込み語（MEO）" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="差し込み語（MEO）" /><p className="text-sm text-slate-500">読み込み中…</p></div>;

  const cols: Col[] = [
    { id: 'name', label: '店舗名', token: '{店舗名}', ph: '例：なつめ接骨院 沼津院', get: (s) => s.name, set: (s, v) => ({ ...s, name: v }), wide: true },
    { id: 'area', label: 'エリア', token: '{エリア}', ph: '例：沼津市', get: (s) => s.area, set: (s, v) => ({ ...s, area: v }) },
    { id: 'kf', label: '毎回入れるキーワード', token: '{キーワード}', ph: '例：接骨院、整骨院', get: (s) => s.keywordsFixed, set: (s, v) => ({ ...s, keywordsFixed: v }), wide: true },
    { id: 'kr', label: '日替わりキーワード', token: '{キーワード}', ph: '例：腰痛、肩こり、交通事故', get: (s) => s.keywordsRotation, set: (s, v) => ({ ...s, keywordsRotation: v }), wide: true },
    ...data.customVars.map((cv): Col => ({ id: `var:${cv.key}`, label: cv.label, token: `{${cv.key}}`, ph: cv.default ? `既定：${cv.default}` : '', get: (s) => s.vars[cv.key] ?? '', set: (s, v) => ({ ...s, vars: { ...s.vars, [cv.key]: v } }) })),
  ];
  const upd = (code: string, c: Col, v: string) => { setRows((rs) => rs.map((r) => r.code === code ? c.set(r, v) : r)); setDirty((d) => new Set(d).add(code)); };

  /** Excel から貼り付け：1 行目から「店舗コード, 店舗名, エリア, 毎回KW, 日替わりKW, 追加の差し込み語…」の順 */
  function applyPaste() {
    const lines = paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let n = 0; const miss: string[] = [];
    let next = rows; const d = new Set(dirty);
    for (const line of lines) {
      const cells = line.split('\t').length > 1 ? line.split('\t') : line.split(',');
      const code = (cells[0] ?? '').trim();
      const i = next.findIndex((r) => r.code === code);
      if (i < 0) { if (code && code !== '店舗コード') miss.push(code); continue; }
      let r = next[i];
      cols.forEach((c, ci) => { const v = cells[ci + 1]; if (v !== undefined && v.trim() !== '') r = c.set(r, v.trim()); });
      next = next.map((x, xi) => xi === i ? r : x); d.add(code); n++;
    }
    setRows(next); setDirty(d); setPaste('');
    setMsg(`${n} 店舗に貼り付けました（まだ保存していません）${miss.length ? `。見つからない店舗コード：${miss.join('、')}` : ''}`);
  }
  async function saveAll() {
    setBusy(true); setMsg('');
    try {
      const r = await sendJson<{ saved: number; refilled: number }>('/api/admin/sns/vars', 'PUT', { rows: rows.filter((x) => dirty.has(x.code)).map(toRow) });
      setMsg(`${r.saved} 店舗を保存しました。作成済みの下書き ${r.refilled} 件の差し込み語を埋めました`);
      reload();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }
  const unfilledTotal = rows.reduce((a, r) => a + (r.unfilled ?? 0), 0);

  return (
    <div className="space-y-4 pb-20">
      <SnsNav title="差し込み語（MEO）" />
      <p className="-mt-2 text-sm text-slate-600">定型投稿の <code className="rounded bg-slate-100 px-1">{'{店舗名}'}</code> <code className="rounded bg-slate-100 px-1">{'{エリア}'}</code> <code className="rounded bg-slate-100 px-1">{'{キーワード}'}</code> などに入る言葉を店舗ごとに入力します。保存すると、これから作る下書きだけでなく、作成済みの下書きに残っている {'{…}'} も埋まります。</p>
      <p className="-mt-2 text-xs text-slate-500">{'{キーワード}'} には「毎回入れるキーワード」と「日替わりキーワード」から 1 つが「・」でつながって入ります（例：接骨院・整骨院・腰痛）。差し込み語の項目を増やすときは「接続状況」の「差し込み語の定義」で追加します。</p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      {unfilledTotal > 0 && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">差し込み語が埋まっていない下書きが {unfilledTotal} 件あります。<Link to="/admin/sns/drafts?unfilled=1" className="underline">下書きで確認</Link></p>}

      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">店舗</th>
              {cols.map((c) => <th key={c.id} className="px-2 py-2">{c.label}<div className="font-mono font-normal text-slate-400">{c.token}</div></th>)}
              <th className="px-2 py-2">未完成の下書き</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className={`border-t ${dirty.has(r.code) ? 'bg-yellow-50' : ''}`}>
                <td className="whitespace-nowrap px-3 py-1.5"><StoreDot code={r.code} className="mr-1" /><span className="font-mono text-xs text-slate-500">{r.code}</span></td>
                {cols.map((c) => (
                  <td key={c.id} className="px-1 py-1">
                    <input value={c.get(r)} onChange={(e) => upd(r.code, c, e.target.value)} placeholder={c.ph} className={`w-full rounded border px-2 py-1 placeholder:text-slate-300 ${c.wide ? 'min-w-48' : 'min-w-32'} ${c.id !== 'name' && c.id !== 'kr' && c.get(r) === '' && !c.ph.startsWith('既定') ? 'border-amber-300 bg-amber-50' : ''}`} />
                  </td>
                ))}
                <td className="whitespace-nowrap px-2 py-1.5 text-center">{r.unfilled ? <Link to={`/admin/sns/drafts?store=${encodeURIComponent(r.code)}&unfilled=1`} className="text-red-700 underline">{r.unfilled} 件</Link> : <span className="text-slate-400">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {data.isHq && (
        <details className="rounded-lg border bg-white p-3 text-sm">
          <summary className="cursor-pointer text-slate-700">Excel から貼り付けて入力</summary>
          <p className="mt-2 text-xs text-slate-500">1 行 1 店舗で、列の順は「店舗コード、{cols.map((c) => c.label).join('、')}」。Excel でこの順に並べた範囲をコピーして貼り付けます（空のセルは変更しません）。</p>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder={`S001\tなつめ接骨院 沼津院\t沼津市\t接骨院、整骨院\t腰痛、肩こり`} className="mt-2 w-full rounded border px-2 py-1 font-mono text-xs" />
          <button type="button" onClick={applyPaste} disabled={!paste.trim()} className="mt-1 rounded border bg-white px-3 py-1 disabled:opacity-40">表に反映</button>
        </details>
      )}

      <div className="fixed bottom-6 right-6"><button type="button" disabled={dirty.size === 0 || busy} onClick={saveAll} className="rounded-md bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg disabled:opacity-40">保存して下書きを完成{dirty.size > 0 ? `（${dirty.size} 店舗）` : ''}</button></div>
    </div>
  );
}
