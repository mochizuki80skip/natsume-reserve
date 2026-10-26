// 本部：日報の項目（まとまり・種類・名前・どこから取るか・並び）。保存すると全店の日報が変わる
import { useEffect, useState } from 'react';
import { useFetch } from '@/lib/api';

interface Item { id: string; section: string; kind: 'value' | 'perf' | 'text' | 'staff'; label: string; source: string }
interface Opt { key: string; label: string }
const KIND = { value: '名前と値', perf: '目標・実績・差分', text: '文章', staff: '出勤状況（施術者・受付）' } as const;

export default function ReportItemsEditor() {
  const { data, reload } = useFetch<{ items: Item[]; auto: Opt[]; manual: Opt[] }>('/api/admin/hq/report-items');
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data) { setItems(data.items); setDirty(false); } }, [data]);
  if (!data) return null;
  const set = (i: number, patch: Partial<Item>) => { setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };
  const move = (i: number, d: -1 | 1) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setItems(n); setDirty(true); };
  const remove = (i: number) => { setItems(items.filter((_, j) => j !== i)); setDirty(true); };
  const add = () => { const last = items.at(-1); setItems([...items, { id: '', section: last?.section ?? '', kind: 'value', label: '', source: 'manual:num' }]); setDirty(true); };
  // 「今月の合計」に使える手入力の項目（数・金額・時間）
  const sumable = items.filter((x) => x.id && ['manual:num', 'manual:yen', 'manual:time'].includes(x.source));
  async function save(list: Item[], done: string) {
    const r = await fetch('/api/admin/hq/report-items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: list }) });
    const j = await r.json().catch(() => ({}));
    setMsg({ ok: r.ok, text: r.ok ? done : (j as { error?: string }).error ?? '保存できませんでした' });
    if (r.ok) reload();
  }

  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label="日報の項目">
      <h2 className="font-bold">日報の項目（全店共通）</h2>
      <p className="mt-1 text-xs text-slate-600">店舗の「日報」に出す項目です。日報は今のスプレッドシートと同じ形で、初めからある項目は決まった場所に出ます（名前と「どこから取るか」は変えられます）。足した項目は、日報の下の「追加の項目」にこの表の順で出ます。「どこから取るか」で自動の数字を選ぶと毎日自動で入り、「店舗で入力」にすると店舗が日報の画面で入れます。「目標・実績・差分」の項目と「目標：…」の項目の目標は、窓口集計（全店）の画面で月ごとに入れます。</p>
      {msg && <p className={`mt-2 rounded px-3 py-1 ${msg.ok ? 'bg-brand-light' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead><tr className="text-left text-xs text-slate-500"><th>並び</th><th>まとまり</th><th>種類</th><th>項目名</th><th>どこから取るか</th><th /></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t align-top">
                <td className="whitespace-nowrap py-1 pr-1"><button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded border px-1 disabled:opacity-30" aria-label={`${it.label} を上へ（日報）`}>↑</button> <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded border px-1 disabled:opacity-30" aria-label={`${it.label} を下へ（日報）`}>↓</button></td>
                <td className="py-1 pr-1"><input value={it.section} onChange={(e) => set(i, { section: e.target.value })} maxLength={60} aria-label="まとまり" className="w-36 rounded border px-1 py-0.5" /></td>
                <td className="py-1 pr-1">
                  <select value={it.kind} onChange={(e) => { const k = e.target.value as Item['kind']; set(i, { kind: k, source: k === 'staff' ? 'staff' : k === 'text' ? 'manual:monthtext' : it.source === 'staff' ? 'manual:num' : it.source }); }} aria-label="種類" className="rounded border px-1 py-0.5">
                    {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td className="py-1 pr-1">{it.kind !== 'staff' && <input value={it.label} onChange={(e) => set(i, { label: e.target.value })} maxLength={30} aria-label="項目名" className="w-32 rounded border px-1 py-0.5" />}</td>
                <td className="py-1 pr-1">
                  {it.kind !== 'staff' && (
                    <select value={it.source} onChange={(e) => set(i, { source: e.target.value })} aria-label={`${it.label} のどこから取るか`} className={`max-w-[22rem] rounded border px-1 py-0.5 ${it.source.startsWith('manual:') ? 'bg-yellow-50' : 'bg-sky-50'}`}>
                      <optgroup label="店舗で入力">{data.manual.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
                      <optgroup label="自動">{data.auto.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
                      {sumable.length > 0 && <optgroup label="今月の合計（手入力の項目）">{sumable.map((x) => <option key={x.id} value={`sum:${x.id}`}>今月の合計：{x.label}</option>)}</optgroup>}
                      <optgroup label="目標（窓口集計の画面で入れる）">
                        {data.auto.map((o) => <option key={o.key} value={`target:${o.key}`}>目標：{o.label}</option>)}
                        {sumable.map((x) => <option key={x.id} value={`target:sum:${x.id}`}>目標：今月の合計：{x.label}</option>)}
                      </optgroup>
                    </select>
                  )}
                </td>
                <td className="py-1 text-right"><button type="button" onClick={() => remove(i)} className="rounded border px-2 py-0.5 text-xs">消す</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={add} className="rounded border px-3 py-1">＋ 項目を足す</button>
        <button type="button" onClick={() => save(items, '日報の項目を保存しました（全店の日報に反映されます）')} disabled={!dirty} className="rounded bg-brand px-4 py-1 font-bold text-white disabled:opacity-40">保存</button>
        {dirty && <span className="text-xs text-amber-700">保存していない変更があります</span>}
        <button type="button" onClick={() => confirm('日報の項目を初めの形（今のスプレッドシートと同じ）に戻しますか？') && save([], '初めの項目に戻しました')} className="ml-auto rounded border px-3 py-1 text-xs text-slate-600">初めの項目に戻す</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">項目を消しても、店舗が入れた値は残ります（同じ項目を足し直すと戻ります）。新しく足した項目は、保存すると名前の付いた番号が振られます。</p>
    </section>
  );
}
