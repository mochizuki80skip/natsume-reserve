// 本部：物販の商品（窓口集計の物販内訳に出す商品・販売価格・原価）
import { useState } from 'react';
import { useFetch } from '@/lib/api';

interface Goods { id: string; name: string; price: number; cost: number; active: boolean }

export default function GoodsEditor() {
  const { data, reload } = useFetch<{ rows: Goods[] }>('/api/admin/hq/goods');
  const [f, setF] = useState({ name: '', price: '', cost: '' });
  const [msg, setMsg] = useState('');
  async function put(body: object, done: string) {
    const r = await fetch('/api/admin/hq/goods', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? done : (j as { error?: string }).error ?? '保存できませんでした');
    if (r.ok) reload();
    return r.ok;
  }
  const rows = data?.rows ?? [];
  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label="物販の商品">
      <h2 className="font-bold">物販の商品（窓口集計の物販内訳）</h2>
      <p className="mt-1 text-xs text-slate-600">ここに登録した商品が、各店舗の窓口集計「物販内訳」の列になります。店舗が個数を入れると、販売価格・原価から金額と利益を自動で計算します。価格を変えても、すでに入力を始めた月はその月の価格のままです。</p>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      <table className="mt-2 w-full max-w-2xl">
        <thead><tr className="text-left text-xs text-slate-500"><th>並び</th><th>商品名</th><th className="text-right">販売価格</th><th className="text-right">原価</th><th /></tr></thead>
        <tbody>
          {rows.map((g, i) => (
            <tr key={`${g.id}:${g.name}:${g.price}:${g.cost}:${g.active}`} className={`border-t ${g.active ? '' : 'text-slate-400'}`}>
              <td className="py-1 pr-2">{g.active && <><button type="button" disabled={i === 0} onClick={() => put({ id: g.id, move: -1 }, '並びを変えました')} className="rounded border px-1 disabled:opacity-30">↑</button> <button type="button" disabled={!rows[i + 1]?.active} onClick={() => put({ id: g.id, move: 1 }, '並びを変えました')} className="rounded border px-1 disabled:opacity-30">↓</button></>}</td>
              <td className="py-1 pr-2"><input defaultValue={g.name} aria-label="商品名" maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== g.name && put({ id: g.id, name: e.target.value.trim() }, '商品名を変えました')} className="w-48 rounded border px-2 py-0.5" /></td>
              {(['price', 'cost'] as const).map((k) => <td key={k} className="py-1 pr-2 text-right"><input defaultValue={g[k]} inputMode="numeric" aria-label={k === 'price' ? '販売価格' : '原価'} onBlur={(e) => Number(e.target.value) !== g[k] && put({ id: g.id, [k]: Number(e.target.value.replace(/[^\d]/g, '')) }, '保存しました')} className="w-24 rounded border px-2 py-0.5 text-right" /></td>)}
              <td className="py-1 text-right"><button type="button" onClick={() => put({ id: g.id, active: !g.active }, g.active ? `${g.name} を一覧から外しました（今までの記録は残ります）` : `${g.name} を戻しました`)} className="rounded border px-2 py-0.5 text-xs">{g.active ? '外す' : '戻す'}</button></td>
            </tr>
          ))}
          {data && rows.length === 0 && <tr><td colSpan={5} className="py-2 text-xs text-slate-400">まだ登録はありません</td></tr>}
        </tbody>
      </table>
      <form onSubmit={async (e) => { e.preventDefault(); if (await put({ name: f.name, price: Number(f.price || 0), cost: Number(f.cost || 0) }, `「${f.name}」を追加しました`)) setF({ name: '', price: '', cost: '' }); }} className="mt-2 flex flex-wrap items-center gap-2">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="商品名（例：バイオゼロ）" maxLength={40} aria-label="新しい商品名" className="w-48 rounded border px-2 py-1" />
        <input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d]/g, '') })} placeholder="販売価格" inputMode="numeric" aria-label="新しい商品の販売価格" className="w-24 rounded border px-2 py-1 text-right" />
        <input value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^\d]/g, '') })} placeholder="原価" inputMode="numeric" aria-label="新しい商品の原価" className="w-24 rounded border px-2 py-1 text-right" />
        <button type="submit" disabled={!f.name.trim()} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">商品を追加</button>
      </form>
    </section>
  );
}
