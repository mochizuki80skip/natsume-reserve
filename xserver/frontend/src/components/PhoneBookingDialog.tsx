// 予約表：電話で取った予約を入れる（WEB 予約と同じように、来院区分・氏名・電話番号）。
// 氏名と（初診）などはセルの文字に、電話番号はセルとは別に持つ（氏名の下に出す。新患継続率には入らない）。
// 氏名の入ったセルでは「電話番号だけ入れる・直す」に使う
import { useState } from 'react';
import { formatDateJa, minToHm } from '@/lib/time';

export type PhoneKind = 'NEW' | 'ACCIDENT' | 'THIRD' | 'REVISIT' | 'RETURN';
export const PHONE_KINDS: { v: PhoneKind; label: string; help: string }[] = [
  { v: 'NEW', label: 'はじめて（ケガ・痛み・不調）', help: '（初診）を付けて 2 枠' },
  { v: 'ACCIDENT', label: 'はじめて（交通事故）', help: '（新自）を付けて 2 枠' },
  { v: 'THIRD', label: 'はじめて（第三者行為）', help: '（新三）を付けて 2 枠' },
  { v: 'REVISIT', label: '1ヶ月以上ぶり（再来）', help: '（再来）を付けて 2 枠' },
  { v: 'RETURN', label: '現在通院中', help: '氏名だけ・1 枠' },
];

interface Props {
  date: string; time: number; bed: number;
  /** 電話番号だけを入れる・直す（氏名の入ったセル） */
  phoneOnly?: { name: string; phone: string };
  belowFree: boolean;
  onSubmit: (v: { kind: PhoneKind; name: string; phone: string }) => Promise<string | null>;
  onClose: () => void;
}

export default function PhoneBookingDialog({ date, time, bed, phoneOnly, belowFree, onSubmit, onClose }: Props) {
  const [kind, setKind] = useState<PhoneKind>('NEW');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(phoneOnly?.phone ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneOnly && !name.trim()) { setErr('お名前を入れてください'); return; }
    const digits = phone.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, '');
    if (!phoneOnly && digits.length < 10) { setErr('電話番号を入れてください（例：090-1234-5678）'); return; }
    if (phone.trim() && digits.length < 10) { setErr('電話番号の形式が正しくありません（例：090-1234-5678）'); return; }
    setBusy(true); setErr('');
    const e2 = await onSubmit({ kind, name: name.trim(), phone: phone.trim() });
    setBusy(false);
    if (e2) setErr(e2); else onClose();
  }
  const twoSlots = kind !== 'RETURN';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} aria-label={phoneOnly ? '電話番号' : '電話予約を入れる'} className="w-full max-w-md space-y-3 rounded-lg bg-white p-4 text-sm shadow-xl">
        <h2 className="text-base font-bold">{phoneOnly ? '📞 電話番号を入れる・直す' : '📞 電話予約を入れる'}</h2>
        <p className="text-xs text-slate-600">{formatDateJa(date)} {minToHm(time)}〜　ベッド{bed}{phoneOnly ? `　${phoneOnly.name}` : ''}</p>
        {!phoneOnly && (
          <>
            <fieldset className="space-y-1">
              <legend className="mb-1 font-bold">来院区分</legend>
              {PHONE_KINDS.map((k) => (
                <label key={k.v} className="flex items-center gap-2">
                  <input type="radio" name="kind" checked={kind === k.v} onChange={() => setKind(k.v)} />
                  {k.label}<span className="text-xs text-slate-500">{k.help}</span>
                </label>
              ))}
            </fieldset>
            {twoSlots && !belowFree && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">下のセルがふさがっているため、2 枠目（上記初診対応など）は入りません。</p>}
            <label className="block font-bold">お名前<input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="山田 太郎" maxLength={40} className="mt-1 block w-full rounded border px-2 py-1.5 font-normal" /></label>
          </>
        )}
        <label className="block font-bold">電話番号<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus={!!phoneOnly} placeholder="090-1234-5678" maxLength={20} className="mt-1 block w-full rounded border px-2 py-1.5 font-normal tabular-nums" />
          <span className="text-xs font-normal text-slate-500">氏名の下に小さく出ます（印刷には出ません）。{phoneOnly ? '消すと外れます。' : ''}</span>
        </label>
        {err && <p className="rounded bg-red-50 px-2 py-1 text-red-800" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1.5">やめる</button>
          <button type="submit" disabled={busy} className="rounded bg-brand px-4 py-1.5 font-bold text-white disabled:opacity-50">{busy ? '保存中…' : phoneOnly ? '保存' : '予約表に入れる'}</button>
        </div>
      </form>
    </div>
  );
}
