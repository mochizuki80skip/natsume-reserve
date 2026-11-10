// 予約表のブロック（打合せ・ミーティングなど、前もって決まっている時間に WEB 予約を止める）
import { useState } from 'react';
import { minToHm } from '@/lib/time';
import type { KindBlock, SlotBlock } from '@/lib/types';

interface Props { date: string; times: number[]; slotMinutes: number; beds: number[]; blocks: SlotBlock[]; kindBlocks?: KindBlock[]; onRefresh: () => void }

/** 受付を止めるもの（N＝新規・R＝再来・E＝既存）の文字。short は予約表の時刻の欄の印用 */
const KIND_STOP = [['N', '新規', '新'], ['R', '再来', '再'], ['E', '既存', '既']] as const;
export const kindStopText = (kinds = 'NR') => KIND_STOP.filter(([k]) => kinds.includes(k)).map(([, l]) => l).join('・');
export const kindStopShort = (kinds = 'NR') => KIND_STOP.filter(([k]) => kinds.includes(k)).map(([, , s]) => s).join('') + '✕';
export const isAllDay = (b: { start: number; end: number }) => b.start <= 0 && b.end >= 24 * 60;

export const blockBedsText = (beds: number[], all: number[]) => (beds.length >= all.length ? '全ベッド' : `ベッド${beds.join('・')}`);

export default function BlockPanel({ date, times, slotMinutes, beds, blocks, kindBlocks = [], onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ start: times[0] ?? 540, end: (times[0] ?? 540) + slotMinutes * 4, beds: [] as number[], label: '' });
  const toggleBed = (b: number) => setF({ ...f, beds: f.beds.includes(b) ? f.beds.filter((x) => x !== b) : [...f.beds, b].sort((x, y) => x - y) });
  const [err, setErr] = useState('');
  const ends = times.map((t) => t + slotMinutes);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (f.beds.length === 0) { setErr('ベッドを選んでください'); return; }
    const r = await fetch('/api/admin/blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, ...f }) });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? '追加できませんでした'); return; }
    setOpen(false);
    setF({ ...f, beds: [], label: '' });
    onRefresh();
  }
  async function remove(id: string) {
    if (!confirm('このブロックを解除しますか？')) return;
    await fetch('/api/admin/blocks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    onRefresh();
  }

  return (
    <>
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
      <span className="font-bold text-slate-700">ブロック</span>
      <span className="text-slate-500">（打合せ・ミーティングなどで、ベッドを使えなくする時間）</span>
      {blocks.map((b) => (
        <span key={b.id} className="inline-flex items-center gap-1 rounded border border-slate-400 bg-slate-200 px-2 py-0.5">
          🔒 {minToHm(b.start)}〜{minToHm(b.end)} {blockBedsText(b.beds, beds)} {b.label && <b>{b.label}</b>}
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
          <span className="ml-1 inline-flex flex-wrap items-center gap-1">
            {beds.map((b) => (
              <label key={b} className={`cursor-pointer rounded border px-1.5 py-0.5 ${f.beds.includes(b) ? 'border-slate-600 bg-slate-600 text-white' : 'bg-white'}`}>
                <input type="checkbox" className="sr-only" checked={f.beds.includes(b)} onChange={() => toggleBed(b)} />ベッド{b}
              </label>
            ))}
            <button type="button" onClick={() => setF({ ...f, beds: f.beds.length === beds.length ? [] : [...beds] })} className="rounded border bg-white px-1.5 py-0.5 text-slate-600">{f.beds.length === beds.length ? '全部外す' : '全部選ぶ'}</button>
          </span>
          <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={30} placeholder="内容（例：打合せ）" className="w-32 rounded border px-1 py-0.5" />
          <button type="submit" className="rounded bg-brand px-2 py-0.5 font-bold text-white">追加</button>
          <button type="button" onClick={() => { setOpen(false); setErr(''); }} className="rounded border px-2 py-0.5">やめる</button>
          {err && <span className="text-red-700">{err}</span>}
        </form>
      )}
    </div>
    <KindStop date={date} times={times} slotMinutes={slotMinutes} beds={beds} kindBlocks={kindBlocks} onRefresh={onRefresh} />
    </>
  );
}

/** WEB の受付を止める時間帯（院長不在など）。新規（初診）・再来・既存（現在通院中）から選んで、1日まるごとか時間を決めて止める。
 *  電話・予約表への手入力はできる。新自（交通事故の初診）は止めない */
function KindStop({ date, times, slotMinutes, beds, kindBlocks, onRefresh }: { date: string; times: number[]; slotMinutes: number; beds: number[]; kindBlocks: KindBlock[]; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ start: times[0] ?? 540, end: (times[0] ?? 540) + slotMinutes * 8, label: '', kinds: 'NR', allDay: false, beds: [...beds] });
  const toggleBed = (b: number) => setF({ ...f, beds: f.beds.includes(b) ? f.beds.filter((x) => x !== b) : [...f.beds, b].sort((x, y) => x - y) });
  const [err, setErr] = useState('');
  const toggle = (k: string) => setF({ ...f, kinds: ['N', 'R', 'E'].filter((x) => (x === k ? !f.kinds.includes(x) : f.kinds.includes(x))).join('') });
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.kinds) { setErr('止めるもの（新規・再来・既存）を選んでください'); return; }
    if (f.beds.length === 0) { setErr('ベッドを選んでください'); return; }
    const r = await fetch('/api/admin/kind-blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, ...f }) });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? '追加できませんでした'); return; }
    setOpen(false); setErr(''); setF({ ...f, label: '', beds: [...beds] });
    onRefresh();
  }
  async function remove(id: string) {
    if (!confirm('受付を止めるのをやめますか？')) return;
    await fetch('/api/admin/kind-blocks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    onRefresh();
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs" aria-label="WEBの受付を止める">
      <span className="font-bold text-slate-700">WEB の受付を止める</span>
      <span className="text-slate-500">（新規・再来・既存から選んで、WEB 予約だけ取れなくします。電話・予約表への入力と新自はできます）</span>
      {kindBlocks.map((b) => (
        <span key={b.id} className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-amber-900">
          {kindStopText(b.kinds)}✕ {isAllDay(b) ? '1日まるごと' : `${minToHm(b.start)}〜${minToHm(b.end)}`} {blockBedsText(b.beds ?? beds, beds)} {b.label && <b>{b.label}</b>}{b.auto && <span className="text-[10px]">（自動で外れます）</span>}
          <button type="button" onClick={() => remove(b.id)} className="ml-1 text-amber-700 hover:text-red-700" aria-label="受付を止めるのをやめる">✕</button>
        </span>
      ))}
      {!open && <button type="button" onClick={() => setOpen(true)} className="rounded border px-2 py-0.5">＋ 止める時間を追加</button>}
      {open && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2 rounded border bg-amber-50 px-2 py-1" aria-label="止める時間を追加">
          <span className="flex items-center gap-2" role="group" aria-label="止めるもの">
            <b>止めるもの</b>
            {([['N', '新規（初診）'], ['R', '再来（1か月以上ぶり）'], ['E', '既存（現在通院中）']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-0.5"><input type="checkbox" checked={f.kinds.includes(k)} onChange={() => toggle(k)} />{l}</label>
            ))}
          </span>
          <span className="flex items-center gap-1" role="radiogroup" aria-label="止める時間">
            <b>時間</b>
            <label className="flex items-center gap-0.5"><input type="radio" checked={f.allDay} onChange={() => setF({ ...f, allDay: true })} />1日まるごと</label>
            <label className="flex items-center gap-0.5"><input type="radio" checked={!f.allDay} onChange={() => setF({ ...f, allDay: false })} />時間を決める</label>
            {!f.allDay && <>
              <select value={f.start} onChange={(e) => setF({ ...f, start: Number(e.target.value) })} className="rounded border px-1 py-0.5" aria-label="止める開始">
                {times.map((t) => <option key={t} value={t}>{minToHm(t)}</option>)}
              </select>〜
              <select value={f.end} onChange={(e) => setF({ ...f, end: Number(e.target.value) })} className="rounded border px-1 py-0.5" aria-label="止める終了">
                {times.map((t) => t + slotMinutes).map((t) => <option key={t} value={t}>{minToHm(t)}</option>)}
              </select>
            </>}
          </span>
          <span className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="止めるベッド">
            <b>ベッド</b>
            {beds.map((b) => (
              <label key={b} className={`cursor-pointer rounded border px-1.5 py-0.5 ${f.beds.includes(b) ? 'border-amber-600 bg-amber-600 text-white' : 'bg-white'}`}>
                <input type="checkbox" className="sr-only" checked={f.beds.includes(b)} onChange={() => toggleBed(b)} />ベッド{b}
              </label>
            ))}
            <button type="button" onClick={() => setF({ ...f, beds: f.beds.length === beds.length ? [] : [...beds] })} className="rounded border bg-white px-1.5 py-0.5 text-slate-600">{f.beds.length === beds.length ? '全部外す' : '全部選ぶ'}</button>
          </span>
          <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={30} placeholder="理由（例：院長不在）" className="w-32 rounded border px-1 py-0.5" />
          <button type="submit" className="rounded bg-brand px-2 py-0.5 font-bold text-white">追加</button>
          <button type="button" onClick={() => { setOpen(false); setErr(''); }} className="rounded border px-2 py-0.5">やめる</button>
          {err && <span className="text-red-700">{err}</span>}
        </form>
      )}
    </div>
  );
}
