'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { WEEKDAY_JA, formatDateJa, minToHm, weekdayOf } from '@/lib/time';

type Kind = 'NEW' | 'RETURN';
type DayMark = 'open' | 'full' | 'closed' | 'unpublished';
type SlotStatus = 'open' | 'phone' | 'closed';
interface Slot { time: number; status: SlotStatus; period: 'AM' | 'PM' }

interface Props { store: { code: string; name: string; phone: string } }

const KIND_LABEL: Record<Kind, string> = {
  NEW: 'はじめての方／1ヶ月以上ご来院の無い方',
  RETURN: 'ご通院中の方',
};

function monthOf(date: string) { return date.slice(0, 7); }
function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default function BookingApp({ store }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [kind, setKind] = useState<Kind | null>(null);
  const [month, setMonth] = useState<string>('');
  const [today, setToday] = useState<string>('');
  const [days, setDays] = useState<{ date: string; mark: DayMark }[]>([]);
  const [date, setDate] = useState<string>('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [time, setTime] = useState<number | null>(null);
  const [form, setForm] = useState({ cardNo: '', name: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [done, setDone] = useState<{ date: string; time: number; smsStatus: string } | null>(null);

  const api = useCallback((path: string) => `/api/public/${encodeURIComponent(store.code)}${path}`, [store.code]);

  // カレンダー読込
  useEffect(() => {
    if (!kind || step !== 2) return;
    let alive = true;
    setLoading(true);
    fetch(api(`/calendar?kind=${kind}${month ? `&month=${month}` : ''}`))
      .then((r) => r.json())
      .then((j) => { if (!alive) return; setDays(j.days ?? []); setToday(j.today); if (!month) setMonth(j.month); })
      .catch(() => setError('読み込みに失敗しました'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [api, kind, month, step]);

  // 時間枠読込
  useEffect(() => {
    if (!kind || !date || step !== 3) return;
    let alive = true;
    setLoading(true);
    fetch(api(`/slots?kind=${kind}&date=${date}`))
      .then((r) => r.json())
      .then((j) => alive && setSlots(j.slots ?? []))
      .catch(() => setError('読み込みに失敗しました'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [api, kind, date, step]);

  const calendarCells = useMemo(() => {
    if (!month || days.length === 0) return [];
    const first = `${month}-01`;
    const lead = weekdayOf(first);
    const cells: ({ date: string; mark: DayMark } | null)[] = Array(lead).fill(null);
    cells.push(...days);
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month, days]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind || !date || time === null) return;
    setLoading(true); setError('');
    try {
      const r = await fetch(api('/reserve'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, date, time, ...form }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? '予約に失敗しました'); if (r.status === 409) { setStep(3); setTime(null); } return; }
      setDone(j); setStep(5);
    } catch { setError('通信に失敗しました'); } finally { setLoading(false); }
  }

  const phoneLink = <a href={`tel:${store.phone.replace(/[^\d+]/g, '')}`} className="font-bold text-brand underline">{store.phone}</a>;

  return (
    <main className="mx-auto max-w-lg px-4 pb-16 pt-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold">{store.name}　WEB予約</h1>
        <ol className="mt-3 flex gap-1 text-xs text-slate-500">
          {['来院区分', '日付', '時間', '入力', '完了'].map((l, i) => (
            <li key={l} className={`flex-1 rounded px-1 py-1 text-center ${step === i + 1 ? 'bg-brand text-white' : step > i + 1 ? 'bg-brand-light text-brand' : 'bg-slate-100'}`}>{l}</li>
          ))}
        </ol>
      </header>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {step === 1 && (
        <section>
          <h2 className="mb-3 font-bold">来院区分をお選びください</h2>
          {(['NEW', 'RETURN'] as Kind[]).map((k) => (
            <button key={k} type="button" onClick={() => { setKind(k); setStep(2); setError(''); }}
              className="mb-3 block w-full rounded-lg border-2 border-brand bg-white px-4 py-4 text-left text-base font-semibold text-brand-dark hover:bg-brand-light">
              {k === 'NEW' ? '①' : '②'} {KIND_LABEL[k]}
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {k === 'NEW' ? '初回は30分枠でご案内します' : '診察券番号をご用意ください'}
              </span>
            </button>
          ))}
        </section>
      )}

      {step === 2 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <button type="button" className="rounded border px-3 py-1" onClick={() => setMonth(shiftMonth(month, -1))} disabled={!month || month <= monthOf(today)}>‹ 前月</button>
            <h2 className="font-bold">{month ? `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月` : ''}</h2>
            <button type="button" className="rounded border px-3 py-1" onClick={() => setMonth(shiftMonth(month, 1))} disabled={!month}>翌月 ›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-sm">
            {WEEKDAY_JA.map((w, i) => <div key={w} className={`py-1 text-xs ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-600' : 'text-slate-500'}`}>{w}</div>)}
            {calendarCells.map((c, i) => c ? (
              <button key={c.date} type="button" disabled={c.mark !== 'open' && c.mark !== 'full'}
                onClick={() => { setDate(c.date); setStep(3); setTime(null); setError(''); }}
                className={`flex h-14 flex-col items-center justify-center rounded border ${c.mark === 'open' ? 'border-brand bg-white hover:bg-brand-light' : 'border-slate-100 bg-slate-100 text-slate-400'}`}>
                <span>{Number(c.date.slice(8))}</span>
                <span className="text-xs">{c.mark === 'open' ? '〇' : c.mark === 'full' ? '×' : c.mark === 'closed' ? '休' : '－'}</span>
              </button>
            ) : <div key={`e${i}`} />)}
          </div>
          {loading && <p className="mt-3 text-sm text-slate-500">読み込み中…</p>}
          <p className="mt-4 text-xs text-slate-500">〇：空きあり　×：満枠　休：休診日　－：受付期間外</p>
          <button type="button" className="mt-4 text-sm text-brand underline" onClick={() => setStep(1)}>← 来院区分を変更</button>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2 className="mb-1 font-bold">{formatDateJa(date)}</h2>
          <p className="mb-3 text-xs text-slate-500">{kind && KIND_LABEL[kind]}</p>
          {loading ? <p className="text-sm text-slate-500">読み込み中…</p> : (
            (['AM', 'PM'] as const).map((p) => {
              const list = slots.filter((s) => s.period === p);
              if (list.length === 0) return null;
              return (
                <div key={p} className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-600">{p === 'AM' ? '午前' : '午後'}</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {list.map((s) => (
                      <button key={s.time} type="button" disabled={s.status !== 'open'}
                        onClick={() => { if (s.status === 'open') { setTime(s.time); setStep(4); setError(''); } }}
                        className={`rounded border px-2 py-2 text-sm ${s.status === 'open' ? 'border-brand bg-white font-semibold text-brand-dark hover:bg-brand-light' : s.status === 'phone' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-100 bg-slate-100 text-slate-400'}`}>
                        {minToHm(s.time)} <span className="ml-1">{s.status === 'open' ? '〇' : s.status === 'phone' ? '📞' : '×'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
          {!loading && slots.length === 0 && <p className="text-sm text-slate-500">この日は受付しておりません。</p>}
          <p className="mt-2 text-xs text-slate-500">〇：WEB予約できます　📞：残りわずか／直前のためお電話（{phoneLink}）でご予約ください　×：空きなし</p>
          <button type="button" className="mt-4 text-sm text-brand underline" onClick={() => { setStep(2); setError(''); }}>← 日付を変更</button>
        </section>
      )}

      {step === 4 && time !== null && (
        <form onSubmit={submit}>
          <h2 className="mb-1 font-bold">{formatDateJa(date)} {minToHm(time)}〜</h2>
          <p className="mb-4 text-xs text-slate-500">{kind && KIND_LABEL[kind]}</p>
          {kind === 'RETURN' && (
            <label className="mb-3 block text-sm">診察券番号<span className="ml-1 text-red-500">*</span>
              <input required inputMode="numeric" value={form.cardNo} onChange={(e) => setForm({ ...form, cardNo: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" />
            </label>
          )}
          <label className="mb-3 block text-sm">氏名<span className="ml-1 text-red-500">*</span>
            <input required maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" placeholder="例）山田 太郎" />
          </label>
          <label className="mb-3 block text-sm">電話番号（携帯）<span className="ml-1 text-red-500">*</span>
            <input required type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" placeholder="例）09012345678" />
            <span className="mt-1 block text-xs text-slate-500">ご予約確定のSMSをお送りします。</span>
          </label>
          <button type="submit" disabled={loading} className="mt-2 w-full rounded-lg bg-brand px-4 py-3 text-base font-bold text-white disabled:opacity-50">
            {loading ? '送信中…' : 'この内容で予約する'}
          </button>
          <button type="button" className="mt-4 text-sm text-brand underline" onClick={() => { setStep(3); setError(''); }}>← 時間を変更</button>
        </form>
      )}

      {step === 5 && done && (
        <section className="rounded-lg border border-brand bg-white p-5">
          <h2 className="text-lg font-bold text-brand-dark">ご予約が確定しました</h2>
          <p className="mt-3 text-base">{formatDateJa(done.date)} {minToHm(done.time)}〜</p>
          <p className="mt-1 text-sm text-slate-600">{store.name}</p>
          {done.smsStatus === 'SENT' && <p className="mt-3 text-sm">確認のSMSをお送りしました。</p>}
          {kind === 'NEW' && <p className="mt-3 text-sm">初めての方は10分前にお越しください。</p>}
          <p className="mt-3 text-sm">変更・キャンセルはお電話（{phoneLink}）へお願いいたします。</p>
          <button type="button" className="mt-5 text-sm text-brand underline" onClick={() => { setStep(1); setKind(null); setDate(''); setTime(null); setDone(null); setForm({ cardNo: '', name: '', phone: '' }); }}>続けて予約する</button>
        </section>
      )}

      <footer className="mt-10 text-center text-xs text-slate-400">お電話でのご予約：{phoneLink}</footer>
    </main>
  );
}
