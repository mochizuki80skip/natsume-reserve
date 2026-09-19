'use client';

import { useState } from 'react';
import { formatDateJa, minToHm } from '@/lib/time';
import WeekGrid, { type Kind, type Selection } from './WeekGrid';

interface Props { store: { code: string; name: string; phone: string }; smsEnabled: boolean }

const KIND_LABEL: Record<Kind, string> = {
  NEW: 'はじめての方／1ヶ月以上ご来院の無い方',
  RETURN: 'ご通院中の方',
};

export default function BookingApp({ store, smsEnabled }: Props) {
  // 1=日時（週間一覧。上部で来院区分を切替）, 2=入力, 3=完了
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<Kind>('NEW');
  // ①はじめての方／1ヶ月以上ご来院の無い方 の内訳（NEW=初診, REVISIT=再来）
  const [firstSub, setFirstSub] = useState<'NEW' | 'REVISIT'>('NEW');
  const submitKind: 'NEW' | 'REVISIT' | 'RETURN' = kind === 'NEW' ? firstSub : 'RETURN';
  const [sel, setSel] = useState<Selection | null>(null);
  const [form, setForm] = useState({ cardNo: '', name: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ date: string; time: number; smsStatus: string } | null>(null);
  const [gridKey, setGridKey] = useState(0);

  const api = (path: string) => `/api/public/${encodeURIComponent(store.code)}${path}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sel) return;
    setLoading(true); setError('');
    try {
      const r = await fetch(api('/reserve'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: submitKind, date: sel.date, time: sel.time, ...form }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? '予約に失敗しました'); if (r.status === 409) { setStep(1); setSel(null); setGridKey((k) => k + 1); } return; }
      setDone(j); setStep(3);
    } catch { setError('通信に失敗しました'); } finally { setLoading(false); }
  }

  const phoneHref = `tel:${store.phone.replace(/[^\d+]/g, '')}`;
  const phoneLink = <a href={phoneHref} className="font-bold text-brand underline">{store.phone}</a>;
  // 電話番号バナー（週間一覧の直下・入力／完了画面の下に表示）
  const phoneBanner = (
    <a href={phoneHref} className="mt-3 block rounded-xl border-2 border-brand bg-brand-light px-4 py-3 text-center no-underline shadow-sm">
      <span className="block text-xs font-semibold text-brand-dark">お電話でのご予約・変更・キャンセル</span>
      <span className="mt-0.5 block text-[26px] font-bold tabular-nums tracking-wide text-brand-dark">📞 {store.phone}</span>
      <span className="block text-[11px] text-slate-600">{store.name}</span>
    </a>
  );

  return (
    <main className="mx-auto max-w-lg px-3 pb-6 pt-4">
      <header className="mb-3">
        <h1 className="text-lg font-bold">{store.name}　WEB予約</h1>
        <ol className="mt-2 flex gap-1 text-xs text-slate-500">
          {['日時', '入力', '完了'].map((l, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const canGoBack = step !== 3 && n < step;
            return (
              <li key={l} className={`flex-1 rounded px-1 py-1 text-center ${step === n ? 'bg-brand text-white' : n < step ? 'bg-brand-light text-brand' : 'bg-slate-100'}`}>
                {canGoBack ? <button type="button" onClick={() => { setStep(n); setError(''); }} className="w-full underline">{l}</button> : l}
              </li>
            );
          })}
        </ol>
      </header>

      {error && step !== 1 && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {step === 1 && (
        <section>
          <p className="mb-2 text-xs text-slate-600">上の「①はじめての方／②ご通院中の方」を選んでから、ご希望の日時の〇を押してください。</p>
          {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <WeekGrid key={gridKey} storeCode={store.code} kind={kind} onKindChange={setKind} phone={store.phone}
            onProceed={(s) => { setSel(s); setStep(2); setError(''); }} />
          {phoneBanner}
        </section>
      )}

      {step === 2 && sel && (
        <form onSubmit={submit}>
          <h2 className="mb-1 font-bold">{formatDateJa(sel.date)} {minToHm(sel.time)}〜</h2>
          <p className="mb-4 text-xs text-slate-500">{KIND_LABEL[kind]}</p>
          {kind === 'NEW' && (
            <fieldset className="mb-3 rounded border bg-white p-3 text-sm">
              <legend className="px-1 text-xs text-slate-500">当院のご利用は</legend>
              <label className="mb-1 flex items-center gap-2"><input type="radio" name="firstSub" checked={firstSub === 'NEW'} onChange={() => setFirstSub('NEW')} />はじめて来院する</label>
              <label className="flex items-center gap-2"><input type="radio" name="firstSub" checked={firstSub === 'REVISIT'} onChange={() => setFirstSub('REVISIT')} />以前来院したことがある（1ヶ月以上ぶり・診察券あり）</label>
            </fieldset>
          )}
          {submitKind !== 'NEW' && (
            <label className="mb-3 block text-sm">診察券番号{submitKind === 'RETURN' ? <span className="ml-1 text-red-500">*</span> : <span className="ml-1 text-xs text-slate-500">（分かれば）</span>}
              <input required={submitKind === 'RETURN'} inputMode="numeric" value={form.cardNo} onChange={(e) => setForm({ ...form, cardNo: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" />
              {submitKind === 'REVISIT' && <span className="mt-1 block text-xs text-slate-500">診察券が手元に無い・番号が分からない場合は空欄のままで大丈夫です。</span>}
            </label>
          )}
          <label className="mb-3 block text-sm">氏名<span className="ml-1 text-red-500">*</span>
            <input required maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" placeholder="例）山田 太郎" />
          </label>
          <label className="mb-3 block text-sm">電話番号（携帯）<span className="ml-1 text-red-500">*</span>
            <input required type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" placeholder="例）09012345678" />
            <span className="mt-1 block text-xs text-slate-500">{smsEnabled ? 'ご予約確定のSMSをお送りします。' : '当院からご連絡する場合に使用します。'}</span>
          </label>
          <button type="submit" disabled={loading} className="mt-2 w-full rounded-lg bg-brand px-4 py-3 text-base font-bold text-white disabled:opacity-50">
            {loading ? '送信中…' : 'この内容で予約する'}
          </button>
          <button type="button" className="mt-4 text-sm text-brand underline" onClick={() => { setStep(1); setError(''); }}>← 日時・来院区分を変更</button>
        </form>
      )}

      {step === 3 && done && (
        <section className="rounded-lg border border-brand bg-white p-5">
          <h2 className="text-lg font-bold text-brand-dark">ご予約が確定しました</h2>
          <p className="mt-3 text-base">{formatDateJa(done.date)} {minToHm(done.time)}〜</p>
          <p className="mt-1 text-sm text-slate-600">{store.name}</p>
          {done.smsStatus === 'SENT'
            ? <p className="mt-3 text-sm">確認のSMSをお送りしました。</p>
            : <p className="mt-3 text-sm text-slate-600">この画面を保存（スクリーンショット）しておいてください。</p>}
          {kind === 'NEW' && <p className="mt-3 text-sm">初めての方・久しぶりの方は10分前にお越しください。</p>}
          <p className="mt-3 text-sm">変更・キャンセルはお電話（{phoneLink}）へお願いいたします。</p>
          <button type="button" className="mt-5 text-sm text-brand underline" onClick={() => { setStep(1); setSel(null); setDone(null); setForm({ cardNo: '', name: '', phone: '' }); setGridKey((k) => k + 1); }}>続けて予約する</button>
        </section>
      )}

      {step !== 1 && phoneBanner}
    </main>
  );
}
