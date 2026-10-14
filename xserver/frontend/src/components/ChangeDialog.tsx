// キャンセル・予約変更のダイアログ（1 つにまとめた）。
// 予約変更：日付と時間を選ぶと空いているベッドに移し、キャンセル・変更名簿に「予約変更」として残す。
// 予約サイトの枠（施術者の人数）がいっぱいの時間は、「枠を超えて入れる」にチェックしたときだけ入れる
import { useEffect, useState } from 'react';
import { formatDateJa, minToHm } from '@/lib/time';

export type ChangeKind = 'CHANGE' | 'ADVANCE' | 'NOSHOW';
interface Slot { time: number; left: number; beds: number }
export interface ChangeFrom { date: string; time: number; bed: number; name: string; twoSlots: boolean }

interface Props {
  from: ChangeFrom;
  onClose: () => void;
  onMoved: (to: { date: string; time: number; bed: number; slots: number }) => void;
  onCancelled: () => void;
}

const KINDS: [ChangeKind, string, string][] = [
  ['CHANGE', '予約変更', '別の日・時間に変える'],
  ['ADVANCE', 'キャンセル（連絡あり）', '名簿へ移す'],
  ['NOSHOW', '無断キャンセル', '名簿へ移す'],
];

export default function ChangeDialog({ from, onClose, onMoved, onCancelled }: Props) {
  const [kind, setKind] = useState<ChangeKind>('CHANGE');
  const [date, setDate] = useState(from.date);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [time, setTime] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const [nextDate, setNextDate] = useState('');
  const [memo, setMemo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // 変更先の日の時間ごとの空き（枠の残り・空いているベッド）
  useEffect(() => {
    if (kind !== 'CHANGE') return;
    let alive = true;
    setSlots(null); setErr(''); setOver(false);
    const q = new URLSearchParams({ date, slots: from.twoSlots ? '2' : '1', fromDate: from.date, fromTime: String(from.time), fromBed: String(from.bed) });
    fetch(`/api/admin/move-slots?${q}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (!alive) return;
      const list: Slot[] = j?.slots ?? [];
      setSlots(list);
      setTime((cur) => (cur !== null && list.some((s) => s.time === cur) ? cur : list.find((s) => s.left > 0 && !(date === from.date && s.time === from.time))?.time ?? list[0]?.time ?? null));
    }).catch(() => alive && setSlots([]));
    return () => { alive = false; };
  }, [kind, date, from]);

  const cur = slots?.find((s) => s.time === time) ?? null;
  const full = !!cur && cur.left <= 0;
  const noBed = !!cur && cur.beds <= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (kind === 'CHANGE') {
      if (time === null) { setErr('変更先の時間を選んでください'); return; }
      if (date === from.date && time === from.time) { setErr('変更先が今と同じです'); return; }
      if (noBed) { setErr('この時間は空いているベッドがありません。別の時間を選んでください。'); return; }
      if (full && !over) { setErr('この時間は予約サイトの枠がいっぱいです。入れる場合は「枠を超えて入れる」にチェックしてください。'); return; }
      setBusy(true);
      const r = await fetch('/api/admin/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: from.date, time: from.time, bed: from.bed, toDate: date, toTime: time, allowOver: over, memo }) });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) { setErr(j.error ?? '変更できませんでした'); return; }
      onMoved(j.moved);
      return;
    }
    setBusy(true);
    const r = await fetch('/api/admin/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: from.date, time: from.time, bed: from.bed, kind, memo, nextDate }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? 'キャンセルできませんでした'); return; }
    onCancelled();
  }

  const slotLabel = (s: Slot) => `${minToHm(s.time)}　${s.beds <= 0 ? '空きベッドなし' : s.left <= 0 ? '枠いっぱい' : `空き ${s.left}`}`;

  return (
    <div className="no-print fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-lg bg-white p-4 text-sm shadow-xl" aria-label="キャンセル・予約変更">
        <h3 className="text-base font-bold">キャンセル・予約変更</h3>
        <p className="mt-1 text-slate-600"><b className="text-slate-800">{from.name}</b>　{formatDateJa(from.date)} {minToHm(from.time)}〜（ベッド{from.bed}）{from.twoSlots && <span className="text-xs">　※2枠ごと</span>}</p>

        <div className="mt-3 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="どうするか">
          {KINDS.map(([k, label, sub]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setErr(''); }}
              className={`rounded-md border-2 px-1.5 py-1.5 text-center text-xs font-bold leading-tight ${kind === k ? (k === 'CHANGE' ? 'border-violet-600 bg-violet-50 text-violet-900' : 'border-brand bg-brand-light text-brand-dark') : 'border-slate-200 bg-white text-slate-700'}`}>
              {label}<span className="block text-[10.5px] font-normal">{sub}</span>
            </button>
          ))}
        </div>

        {kind === 'CHANGE' ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">変更先の日付
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            <label className="block">変更先の時間
              {slots === null ? <span className="mt-1 block text-xs text-slate-500">読み込み中…</span>
                : slots.length === 0 ? <span className="mt-1 block text-xs text-red-700">この日は休診日です</span>
                  : (
                    <select value={time ?? ''} onChange={(e) => { setTime(Number(e.target.value)); setOver(false); setErr(''); }} className="mt-1 block w-full rounded border px-2 py-1">
                      {slots.map((s) => <option key={s.time} value={s.time} disabled={s.beds <= 0}>{slotLabel(s)}</option>)}
                    </select>
                  )}
            </label>
            {full && !noBed && (
              <div className="col-span-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                この時間は<b>予約サイトの枠（施術者の人数）がいっぱい</b>です。入れると施術者の人数を超えます。
                <label className="mt-1 flex items-center gap-1.5 font-bold"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} />枠を超えて入れる（予約サイトに出していないベッドに入れます）</label>
              </div>
            )}
          </div>
        ) : (
          <label className="mt-3 block">次回予約が取れている場合はその日付<span className="ml-1 text-xs text-slate-500">（無ければ空欄）</span>
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="mt-1 block rounded border px-2 py-1" />
          </label>
        )}

        <label className="mt-3 block">メモ<span className="ml-1 text-xs text-slate-500">（空欄可）</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} className="mt-1 w-full rounded border px-2 py-1" placeholder={kind === 'CHANGE' ? '例）仕事の都合で夕方に変更' : '例）体調不良のため'} />
        </label>
        <p className="mt-2 text-xs text-slate-500">
          {kind === 'CHANGE'
            ? 'ベッドは空いているところに自動で入ります。元の日の「キャンセル・変更名簿」に「予約変更」として残ります。WEB予約は電話番号などの情報と予約確認ページの日時も一緒に変わります。'
            : '枠は空きます。名簿の「予約表に戻す」で元に戻せます。'}
        </p>
        {err && <p className="mt-2 rounded bg-red-50 px-3 py-2 font-bold text-red-700">{err}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1.5">やめる</button>
          <button type="submit" disabled={busy || (kind === 'CHANGE' && !slots?.length)} className="rounded bg-brand px-4 py-1.5 font-bold text-white disabled:opacity-50">
            {busy ? '処理中…' : kind === 'CHANGE' ? 'この日時に変更する' : '名簿へ移す'}
          </button>
        </div>
      </form>
    </div>
  );
}
