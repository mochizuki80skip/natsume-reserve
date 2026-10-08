// 予約を別の日・時間に移動するダイアログ（ベッドは空いているところを自動で選ぶ）
import { useEffect, useState } from 'react';
import { formatDateJa, minToHm } from '@/lib/time';

interface Props {
  from: { date: string; time: number; bed: number; name: string; twoSlots: boolean };
  onClose: () => void;
  onMoved: (to: { date: string; time: number; bed: number; slots: number }) => void;
}

export default function MoveDialog({ from, onClose, onMoved }: Props) {
  const [date, setDate] = useState(from.date);
  const [times, setTimes] = useState<number[] | null>(null);
  const [time, setTime] = useState<number>(from.time);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setTimes(null); setErr('');
    fetch(`/api/admin/day?date=${date}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (!alive) return;
      const ts: number[] = j?.data?.times ?? [];
      setTimes(ts);
      if (ts.length && !ts.includes(time)) setTime(ts.includes(from.time) ? from.time : ts[0]);
    }).catch(() => alive && setTimes([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (date === from.date && time === from.time) { setErr('移動先が今と同じです'); return; }
    setBusy(true); setErr('');
    const r = await fetch('/api/admin/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: from.date, time: from.time, bed: from.bed, toDate: date, toTime: time }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? '移動できませんでした'); return; }
    onMoved(j.moved);
  }

  return (
    <div className="no-print fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl">
        <h3 className="mb-1 text-base font-bold">予約を移動</h3>
        <p className="mb-3 text-sm text-slate-600"><b>{from.name}</b>　{formatDateJa(from.date)} {minToHm(from.time)}〜（ベッド{from.bed}）{from.twoSlots && <span className="text-xs">　※2枠ごと移動します</span>}</p>
        <label className="mb-2 block text-sm">移動先の日付
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required className="mt-1 block w-full rounded border px-2 py-1" />
        </label>
        <label className="mb-2 block text-sm">移動先の時間
          {times === null ? <span className="mt-1 block text-xs text-slate-500">読み込み中…</span>
            : times.length === 0 ? <span className="mt-1 block text-xs text-red-700">この日は休診日です。別の日を選んでください。</span>
              : (
                <select value={time} onChange={(e) => setTime(Number(e.target.value))} className="mt-1 block w-full rounded border px-2 py-1">
                  {times.map((t) => <option key={t} value={t}>{minToHm(t)}</option>)}
                </select>
              )}
        </label>
        <p className="mb-2 text-xs text-slate-500">ベッドは空いているところに自動で入ります。WEB予約の場合は、電話番号などの情報と予約・来院ログの日時も一緒に移ります。</p>
        {err && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm">やめる</button>
          <button type="submit" disabled={busy || !times?.length} className="rounded bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">{busy ? '移動中…' : '移動する'}</button>
        </div>
      </form>
    </div>
  );
}
