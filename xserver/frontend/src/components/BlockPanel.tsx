// 予約表のブロック（打合せ・ミーティングなど、前もって決まっている時間に WEB 予約を止める）
import { useState } from 'react';
import { minToHm } from '@/lib/time';
import type { SlotBlock } from '@/lib/types';

interface Props { date: string; times: number[]; slotMinutes: number; maxCount: number; blocks: SlotBlock[]; onRefresh: () => void }

export const blockCountText = (n: number) => (n <= 0 ? '全枠' : `${n}枠`);

export default function BlockPanel({ date, times, slotMinutes, maxCount, blocks, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ start: times[0] ?? 540, end: (times[0] ?? 540) + slotMinutes * 4, count: 0, label: '' });
  const [err, setErr] = useState('');
  const ends = times.map((t) => t + slotMinutes);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const r = await fetch('/api/admin/blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, ...f }) });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? '追加できませんでした'); return; }
    setOpen(false);
    setF({ ...f, label: '' });
    onRefresh();
  }
  async function remove(id: string) {
    if (!confirm('このブロックを解除しますか？')) return;
    await fetch('/api/admin/blocks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    onRefresh();
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
      <span className="font-bold text-slate-700">ブロック</span>
      <span className="text-slate-500">（打合せ・ミーティングなどで WEB 予約を止める時間）</span>
      {blocks.map((b) => (
        <span key={b.id} className="inline-flex items-center gap-1 rounded border border-slate-400 bg-slate-200 px-2 py-0.5">
          🔒 {minToHm(b.start)}〜{minToHm(b.end)} {b.label && <b>{b.label}</b>}（{blockCountText(b.count)}止める）
          <button type="button" onClick={() => remove(b.id)} className="ml-1 text-slate-500 hover:text-red-700" aria-label="ブロックを解除">✕</button>
        </span>
      ))}
      {!open && <button type="button" onClick={() => setOpen(true)} className="rounded border px-2 py-0.5">＋ ブロックを追加</button>}
      {open && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-1 rounded border bg-slate-50 px-2 py-1">
          <select value={f.start} onChange={(e) => setF({ ...f, start: Number(e.target.value) })} className="rounded border px-1 py-0.5" aria-label="開始">
            {times.map((t) => <option key={t} value={t}>{minToHm(t)}</option>)}
          </select>〜
          <select value={f.end} onChange={(e) => setF({ ...f, end: Number(e.target.value) })} className="rounded border px-1 py-0.5" aria-label="終了">
            {ends.map((t) => <option key={t} value={t}>{minToHm(t)}</option>)}
          </select>
          <select value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })} className="rounded border px-1 py-0.5" aria-label="止める枠数">
            <option value={0}>全枠を止める</option>
            {Array.from({ length: Math.max(0, maxCount) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}枠だけ止める</option>)}
          </select>
          <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={30} placeholder="内容（例：打合せ）" className="w-32 rounded border px-1 py-0.5" />
          <button type="submit" className="rounded bg-brand px-2 py-0.5 font-bold text-white">追加</button>
          <button type="button" onClick={() => { setOpen(false); setErr(''); }} className="rounded border px-2 py-0.5">やめる</button>
          {err && <span className="text-red-700">{err}</span>}
        </form>
      )}
    </div>
  );
}
