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
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [kind, setKind] = useState<Kind>('NEW');
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
        body: JSON.stringify({ kind, date: sel.date, time: sel.time, ...form }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? '予約に失敗しました'); if (r.status === 409) { setStep(2); setSel(null); setGridKey((k) => k + 1); } return; }
      setDone(j); setStep(4);
    } catch { setError('通信に失敗しました'); } finally { setLoading(false); }
  }

  const phoneLink = <a href={`tel:${store.phone.replace(/[^\d+]/g, '')}`} className="font-bold text-brand underline">{store.phone}</a>;

  return (
    <main className="mx-auto max-w-lg px-3 pb-16 pt-4">
      <header className="mb-3">
        <h1 className="text-lg font-bold">{store.name}　WEB予約</h1>
        <ol className="mt-2 flex gap-1 text-xs text-slate-500">
          {['来院区分', '日時', '入力', '完了'].map((l, i) => (
            <li key={l} className={`flex-1 rounded px-1 py-1 text-center ${step === i + 1 ? 'bg-brand text-white' : step > i + 1 ? 'bg-brand-light text-brand' : 'bg-slate-100'}`}>{l}</li>
          ))}
        </ol>
      </header>

      {error && step !== 2 && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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
          {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <WeekGrid key={gridKey} storeCode={store.code} kind={kind} onKindChange={setKind} phone={store.phone}
            onProceed={(s) => { setSel(s); setStep(3); setError(''); }} />
        </section>
      )}

      {step === 3 && sel && (
        <form onSubmit={submit}>
          <h2 className="mb-1 font-bold">{formatDateJa(sel.date)} {minToHm(sel.time)}〜</h2>
          <p className="mb-4 text-xs text-slate-500">{KIND_LABEL[kind]}</p>
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
            <span className="mt-1 block text-xs text-slate-500">{smsEnabled ? 'ご予約確定のSMSをお送りします。' : '当院からご連絡する場合に使用します。'}</span>
          </label>
          <button type="submit" disabled={loading} className="mt-2 w-full rounded-lg bg-brand px-4 py-3 text-base font-bold text-white disabled:opacity-50">
            {loading ? '送信中…' : 'この内容で予約する'}
          </button>
          <button type="button" className="mt-4 text-sm text-brand underline" onClick={() => { setStep(2); setError(''); }}>← 日時を変更</button>
        </form>
      )}

      {step === 4 && done && (
        <section className="rounded-lg border border-brand bg-white p-5">
          <h2 className="text-lg font-bold text-brand-dark">ご予約が確定しました</h2>
          <p className="mt-3 text-base">{formatDateJa(done.date)} {minToHm(done.time)}〜</p>
          <p className="mt-1 text-sm text-slate-600">{store.name}</p>
          {done.smsStatus === 'SENT'
            ? <p className="mt-3 text-sm">確認のSMSをお送りしました。</p>
            : <p className="mt-3 text-sm text-slate-600">この画面を保存（スクリーンショット）しておいてください。</p>}
          {kind === 'NEW' && <p className="mt-3 text-sm">初めての方は10分前にお越しください。</p>}
          <p className="mt-3 text-sm">変更・キャンセルはお電話（{phoneLink}）へお願いいたします。</p>
          <button type="button" className="mt-5 text-sm text-brand underline" onClick={() => { setStep(1); setSel(null); setDone(null); setForm({ cardNo: '', name: '', phone: '' }); setGridKey((k) => k + 1); }}>続けて予約する</button>
        </section>
      )}

      <footer className="mt-10 text-center text-xs text-slate-400">お電話でのご予約：{phoneLink}</footer>
    </main>
  );
}
