
import { useState } from 'react';
import PublicFooter, { PrivacyNote } from './PublicFooter';
import ClosureNotice from './ClosureNotice';
import type { Closure } from '@/lib/closure';
import { formatDateJa, minToHm } from '@/lib/time';
import { formatJpPhone } from '@/lib/format';
import { Link } from 'react-router-dom';
import WeekGrid, { KIND_TEXT, type Kind, type Selection } from './WeekGrid';
import { forgetPatient, loadPatient, savePatient } from '@/lib/patientMemory';
import { addMyReservation, loadMyReservations } from '@/lib/myReservations';
import CampaignBox, { type PublicCampaign } from './CampaignBox';

interface Companion { kind: Kind | null; name: string; cardNo: string; sel: Selection | null }
const KIND_SHORT: Record<Kind, string> = { NEW: 'はじめて（ケガ・痛み・不調など）', ACCIDENT: 'はじめて（交通事故）', RETURN: '現在通院中', REVISIT: '1ヶ月以上ご来院の無い方' };

interface Props { store: { code: string; name: string; phone: string }; smsEnabled: boolean; via?: 'card'; refCode?: string; closures?: Closure[]; campaign?: PublicCampaign | null; campaignCode?: string }

export default function BookingApp({ store, smsEnabled, via, refCode, closures = [], campaign = null, campaignCode }: Props) {
  // 1=日時（週間一覧。上部で来院区分を切替）, 2=入力, 3=確認, 4=完了
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // 最初は未選択（キャンペーンの経路から来たときは、キャンペーンで決めた区分を選んだ状態で始める。変えることもできる）
  const presetKind = (['NEW', 'ACCIDENT', 'RETURN', 'REVISIT'] as Kind[]).find((k) => k === campaign?.kind) ?? null;
  const [kind, setKind] = useState<Kind | null>(presetKind);
  const submitKind = kind;
  const [sel, setSel] = useState<Selection | null>(null);
  const [form, setForm] = useState({ cardNo: '', name: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ date: string; time: number; smsStatus: string; token?: string; campaign?: PublicCampaign | null } | null>(null);
  // この端末で前に予約した方の情報（次回は入力欄に最初から入れる）。「別の方の予約をする」で今回は使わない
  const [memory, setMemory] = useState(loadPatient);
  const [useMemory, setUseMemory] = useState(true);
  const [remember, setRemember] = useState(true);
  const [gridKey, setGridKey] = useState(0);
  // ご家族（お連れ様）と一緒の予約：人数・お連れ様（2人目以降）・日時の決め方（みんな同じ／1人ずつ）
  const [count, setCount] = useState(1);
  const [comps, setComps] = useState<Companion[]>([]);
  const [mode, setMode] = useState<'same' | 'each'>('same');
  const [stage, setStage] = useState<'leader' | 'comps'>('leader'); // 1人ずつ：1人目の日時を決めたあと、お連れ様の日時を選ぶ
  const [picking, setPicking] = useState<number | null>(null); // カレンダーから日時を選んでいるお連れ様
  const [checking, setChecking] = useState(false);
  const party = count > 1;
  const compKinds = comps.map((c) => c.kind).filter((k): k is Kind => !!k);
  const allKinds = comps.every((c) => c.kind);
  function changeCount(n: number) {
    setCount(n);
    setComps((cur) => Array.from({ length: n - 1 }, (_, i) => cur[i] ?? { kind: null, name: '', cardNo: '', sel: null }));
    setStage('leader'); setPicking(null); setError('');
  }
  const setComp = (i: number, patch: Partial<Companion>) => setComps((cur) => cur.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  /** 全員まとめて取れるか（予約はしない）。取れないときは理由の文を返す */
  async function checkParty(leaderSel: Selection, list: Companion[]): Promise<string> {
    if (!kind) return '来院区分を選んでください';
    setChecking(true);
    try {
      const r = await fetch(api('/reserve-group'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, people: [{ kind, date: leaderSel.date, time: leaderSel.time }, ...list.map((c) => ({ kind: c.kind, date: c.sel!.date, time: c.sel!.time }))] }) });
      if (r.ok) return '';
      return (await r.json().catch(() => ({}))).error ?? '確かめられませんでした';
    } catch { return '通信に失敗しました'; } finally { setChecking(false); }
  }
  async function proceedLeader(s: Selection) {
    setError('');
    if (!party) { setSel(s); setStep(2); if (memory && useMemory) setForm((f) => ({ cardNo: f.cardNo || memory.cardNo, name: f.name || memory.name, phone: f.phone || memory.phone })); return; }
    if (!allKinds) { setError('お連れ様の来院区分を選んでください（上の「ご予約の人数」の欄）'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (memory && useMemory) setForm((f) => ({ cardNo: f.cardNo || memory.cardNo, name: f.name || memory.name, phone: f.phone || memory.phone }));
    if (mode === 'each') { setSel(s); setStage('comps'); window.scrollTo(0, 0); return; }
    const list = comps.map((c) => ({ ...c, sel: s }));
    const msg = await checkParty(s, list);
    if (msg) { setError(msg); setGridKey((k) => k + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSel(s); setComps(list); setStep(2); window.scrollTo(0, 0);
  }
  async function proceedComps() {
    if (!sel) return;
    if (comps.some((c) => !c.sel)) { setError('お連れ様の日時を選んでください'); return; }
    const msg = await checkParty(sel, comps);
    if (msg) { setError(msg); return; }
    setError(''); setStep(2); window.scrollTo(0, 0);
  }

  const api = (path: string) => `/api/public/${encodeURIComponent(store.code)}${path}`;

  // 入力画面 →（まだ予約しない）確認画面へ
  function toConfirm(e: React.FormEvent) {
    e.preventDefault();
    setForm({ cardNo: form.cardNo.trim(), name: form.name.trim(), phone: form.phone.trim() });
    setComps((cur) => cur.map((c) => ({ ...c, name: c.name.trim(), cardNo: c.cardNo.trim() })));
    setError(''); setStep(3);
    window.scrollTo(0, 0);
  }

  // 確認画面で「この内容で予約する」を押したときに初めて予約を送る
  // この端末で WEB 予約した予約があれば、上に「ご予約の確認」を出す
  const [hasMine, setHasMine] = useState(() => loadMyReservations().length > 0);
  async function submit() {
    if (!sel || !kind || loading) return;
    setLoading(true); setError('');
    if (party) { await submitParty(); return; }
    try {
      const r = await fetch(api('/reserve'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: submitKind, date: sel.date, time: sel.time, ...form, via, ref: refCode, c: campaignCode }), // via=card：紹介カード（店舗えらびページ）から。ref：紹介元（業者）の専用 QR から
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? '予約に失敗しました');
        if (r.status === 409) { setStep(1); setSel(null); setGridKey((k) => k + 1); } // 埋まった・二重予約 → 日時から選び直し
        else if (r.status === 400) setStep(2); // 入力の誤り → 入力画面で直す
        return;
      }
      setDone(j); setStep(4); window.scrollTo(0, 0);
      if (j.token) { addMyReservation({ token: j.token, date: sel.date }); setHasMine(true); } // 「ご予約の確認」の一覧に出すため、この端末に覚えておく
      if (remember) { const m = { name: form.name, phone: form.phone, cardNo: form.cardNo || (useMemory ? memory?.cardNo ?? '' : '') }; savePatient(m); setMemory(m); }
    } catch { setError('通信に失敗しました'); } finally { setLoading(false); }
  }

  // ご家族（お連れ様）と一緒の予約を送る（全員取れたときだけ予約になる）
  const [partyDone, setPartyDone] = useState<{ token: string; kind: Kind; date: string; time: number; name: string }[] | null>(null);
  async function submitParty() {
    if (!sel || !kind) return;
    try {
      const r = await fetch(api('/reserve-group'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, via, ref: refCode, c: campaignCode,
          people: [{ kind, date: sel.date, time: sel.time, name: form.name, cardNo: form.cardNo }, ...comps.map((c) => ({ kind: c.kind, date: c.sel!.date, time: c.sel!.time, name: c.name, cardNo: c.cardNo }))] }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? '予約に失敗しました');
        if (r.status === 409) { setStep(1); setStage('leader'); setSel(null); setComps((cur) => cur.map((c) => ({ ...c, sel: null }))); setGridKey((k) => k + 1); }
        else if (r.status === 400) setStep(2);
        return;
      }
      setPartyDone(j.people); setDone({ date: sel.date, time: sel.time, smsStatus: 'SKIPPED', token: j.people[0]?.token, campaign: j.campaign }); setStep(4); window.scrollTo(0, 0);
      for (const x of j.people as { token: string; date: string }[]) addMyReservation({ token: x.token, date: x.date });
      setHasMine(true);
      if (remember) { const m = { name: form.name, phone: form.phone, cardNo: form.cardNo || (useMemory ? memory?.cardNo ?? '' : '') }; savePatient(m); setMemory(m); }
    } catch { setError('通信に失敗しました'); } finally { setLoading(false); }
  }

  const phoneHref = `tel:${store.phone.replace(/[^\d+]/g, '')}`;
  const phoneLink = <a href={phoneHref} className="font-bold text-brand underline">{store.phone}</a>;
  // 電話番号バナー（週間一覧の直下・入力／完了画面の下に表示）
  // ご来院についての注記（日時選択・入力・完了の各画面に表示）
  const notes = (
    <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-900">
      <li>※ 予約時間より15分以上前後してのご来院時はお待ちいただく時がございます。</li>
      <li>※ 混雑状況によって予約時間を過ぎてのご案内になってしまう時がございます。</li>
      <li>※ 当院は予約優先制です。急患の方がいらっしゃる場合は順番が前後し、お待ちいただくことがございます。あらかじめご了承ください。</li>
    </ul>
  );
  const phoneBanner = (
    <a href={phoneHref} className="mt-3 block rounded-xl border-2 border-brand bg-brand-light px-4 py-3 text-center no-underline shadow-sm">
      <span className="block text-xs font-semibold text-brand-dark">お電話でのご予約・変更・キャンセル</span>
      <span className="mt-0.5 block text-[26px] font-bold tabular-nums tracking-wide text-brand-dark">📞 {store.phone}</span>
      <span className="block text-[11px] text-slate-600">{store.name}</span>
    </a>
  );

  return (
    <main className="pub mx-auto max-w-lg px-3 pb-6 pt-4">
      <header className="mb-3">
        {/* 各店舗の予約ページにはロゴ・グループ院の表示は出さない（依頼者の決定。店舗えらびページだけに出す） */}
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-bold">{store.name}　WEB予約</h1>
          {hasMine && <Link to={`/my?store=${encodeURIComponent(store.code)}`} className="flex-none whitespace-nowrap rounded-lg border border-brand bg-white px-2.5 py-1 text-xs font-bold text-brand no-underline">📅 ご予約の確認</Link>}
        </div>
        <ol className="mt-2 flex gap-1 text-xs text-slate-500">
          {['日時', '入力', '確認', '完了'].map((l, i) => {
            const n = (i + 1) as 1 | 2 | 3 | 4;
            const canGoBack = step !== 4 && n < step;
            return (
              <li key={l} className={`flex-1 rounded px-1 py-1 text-center ${step === n ? 'bg-brand text-white' : n < step ? 'bg-brand-light text-brand' : 'bg-slate-100'}`}>
                {canGoBack ? <button type="button" onClick={() => { setStep(n); setError(''); }} className="w-full underline">{l}</button> : l}
              </li>
            );
          })}
        </ol>
      </header>

      {step === 1 && <ClosureNotice closures={closures} />}
      {step === 1 && campaign && <div className="mb-3"><CampaignBox c={campaign} /></div>}

      {error && step !== 1 && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {step === 1 && (
        <section>
          {memory && useMemory && (
            <div className="mb-3 rounded-lg border border-brand bg-brand-light px-3 py-2 text-sm text-brand-dark">
              <b>{memory.name} 様</b>、いつもありがとうございます。<br />
              <span className="text-xs">お名前・電話番号{memory.cardNo ? '・診察券番号' : ''}は前回の内容が入ります。</span>
              <button type="button" className="ml-1 text-xs underline" onClick={() => { setUseMemory(false); setForm({ cardNo: '', name: '', phone: '' }); }}>別の方（ご家族など）の予約をする</button>
            </div>
          )}
          {stage === 'leader' && <PartyBox count={count} onCount={changeCount} comps={comps} setComp={setComp} mode={mode} onMode={(m) => { setMode(m); setError(''); }} />}
          {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          {checking && <p className="mb-2 rounded bg-sky-50 px-3 py-2 text-sm text-sky-900">{count}名様分の空きを確かめています…</p>}
          {stage === 'leader' && (
            <WeekGrid key={gridKey} storeCode={store.code} kind={kind} onKindChange={setKind} phone={store.phone} cardRemembered={!!(memory && useMemory && memory.cardNo)}
              companions={party && mode === 'same' && allKinds ? compKinds : []} party={party}
              onProceed={(s) => void proceedLeader(s)} />
          )}
          {stage === 'comps' && sel && kind && (
            picking !== null && comps[picking]?.kind
              ? <WeekGrid key={`c${picking}`} storeCode={store.code} kind={comps[picking].kind} onKindChange={() => undefined} phone={store.phone} lockKind
                  title={`${picking + 2}人目（お連れ様・${KIND_SHORT[comps[picking].kind!]}）の日時`}
                  onProceed={(s) => { setComp(picking, { sel: s }); setPicking(null); setError(''); window.scrollTo(0, 0); }} />
              : <section aria-label="お連れ様の日時">
                  <h2 className="mb-2 font-bold">お連れ様の日時を選んでください</h2>
                  <div className="rounded-lg border bg-white p-3 text-sm"><b>1人目（ご本人）</b>　{formatDateJa(sel.date)} {minToHm(sel.time)}〜<span className="block text-xs text-slate-500">{KIND_SHORT[kind]}</span></div>
                  {comps.map((c, i) => (
                    <div key={i} className="mt-2 rounded-lg border bg-white p-3 text-sm" role="group" aria-label={`${i + 2}人目の日時`}>
                      <b>{i + 2}人目（お連れ様）</b><span className="ml-1 text-xs text-slate-500">{c.kind && KIND_SHORT[c.kind]}</span>
                      {c.sel && <p className="mt-1 text-base font-bold">{formatDateJa(c.sel.date)} {minToHm(c.sel.time)}〜</p>}
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <button type="button" onClick={() => setComp(i, { sel })} className={`rounded-lg border-2 border-brand px-2 py-2 text-[12.5px] font-bold ${c.sel && c.sel.date === sel.date && c.sel.time === sel.time ? 'bg-brand text-white' : 'bg-white text-brand-dark'}`}>1人目と同じ日時</button>
                        <button type="button" onClick={() => setPicking(i)} className="rounded-lg border-2 border-brand bg-white px-2 py-2 text-[12.5px] font-bold text-brand-dark">カレンダーから選ぶ</button>
                      </div>
                    </div>
                  ))}
                  <button type="button" disabled={checking || comps.some((c) => !c.sel)} onClick={() => void proceedComps()} className="mt-3 w-full rounded-lg bg-brand px-4 py-3 text-base font-bold text-white disabled:opacity-50">お名前の入力へ進む</button>
                  <button type="button" className="mt-3 text-sm text-brand underline" onClick={() => { setStage('leader'); setSel(null); setComps((cur) => cur.map((c) => ({ ...c, sel: null }))); setError(''); }}>← 1人目の日時を選び直す</button>
                </section>
          )}
          {notes}
          {phoneBanner}
        </section>
      )}

      {step === 2 && sel && kind && (
        <form onSubmit={toConfirm}>
          {party && <p className="mb-1 text-sm font-bold text-brand-dark">1人目（ご本人）</p>}
          <h2 className="mb-1 font-bold">{formatDateJa(sel.date)} {minToHm(sel.time)}〜</h2>
          <p className="mb-4 text-xs text-slate-500">{KIND_TEXT[kind]}</p>
          {(submitKind === 'RETURN' || submitKind === 'REVISIT') && (
            <label className="mb-3 block text-sm">診察券番号{submitKind === 'RETURN' ? <span className="ml-1 text-red-500">*</span> : <span className="ml-1 text-xs text-slate-500">（分かれば）</span>}
              <input required={submitKind === 'RETURN'} inputMode="numeric" value={form.cardNo} onChange={(e) => setForm({ ...form, cardNo: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" />
              {submitKind === 'RETURN' && <span className="mt-1 block text-xs text-slate-500">お手元の診察券に書かれている番号をご確認のうえ、入力してください。</span>}
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
          {comps.map((c, i) => c.kind && c.sel && (
            <div key={i} className="mb-3 rounded-lg border border-brand/40 bg-brand-light/30 p-3" role="group" aria-label={`${i + 2}人目（お連れ様）`}>
              <p className="text-sm font-bold text-brand-dark">{i + 2}人目（お連れ様）</p>
              <p className="text-sm font-bold">{formatDateJa(c.sel.date)} {minToHm(c.sel.time)}〜</p>
              <p className="mb-2 text-xs text-slate-500">{KIND_TEXT[c.kind]}</p>
              {(c.kind === 'RETURN' || c.kind === 'REVISIT') && (
                <label className="mb-2 block text-sm">診察券番号{c.kind === 'RETURN' ? <span className="ml-1 text-red-500">*</span> : <span className="ml-1 text-xs text-slate-500">（分かれば）</span>}
                  <input required={c.kind === 'RETURN'} inputMode="numeric" value={c.cardNo} onChange={(e) => setComp(i, { cardNo: e.target.value })} className="mt-1 w-full rounded border bg-white px-3 py-2" />
                </label>
              )}
              <label className="block text-sm">氏名<span className="ml-1 text-red-500">*</span>
                <input required maxLength={40} value={c.name} onChange={(e) => setComp(i, { name: e.target.value })} className="mt-1 w-full rounded border bg-white px-3 py-2" placeholder="例）山田 花子" />
              </label>
              <span className="mt-1 block text-xs text-slate-500">電話番号は 1人目と同じものを使います。</span>
            </div>
          ))}
          <button type="submit" className="mt-2 w-full rounded-lg bg-brand px-4 py-3 text-base font-bold text-white">
            入力内容を確認する
          </button>
          <p className="mt-1 text-center text-xs text-slate-500">まだ予約は確定していません</p>
          {notes}
          <button type="button" className="mt-4 text-sm text-brand underline" onClick={() => { setStep(1); setStage('leader'); setError(''); }}>← 日時・来院区分を変更</button>
        </form>
      )}

      {step === 3 && sel && kind && (
        <section>
          <h2 className="mb-1 font-bold">ご予約内容の確認</h2>
          <p className="mb-3 text-sm text-slate-600">以下の内容でお間違いありませんか？</p>
          <dl className="divide-y rounded-lg border bg-white text-sm">
            <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">店舗</dt><dd>{store.name}</dd></div>
            <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">日時</dt><dd className="text-base font-bold">{formatDateJa(sel.date)} {minToHm(sel.time)}〜</dd></div>
            <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">ご来院</dt><dd>{KIND_TEXT[kind]}</dd></div>
            {(submitKind === 'RETURN' || submitKind === 'REVISIT') && (
              <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">診察券番号</dt><dd>{form.cardNo || '（未入力）'}</dd></div>
            )}
            <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">氏名</dt><dd className="font-bold">{form.name}</dd></div>
            <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">電話番号</dt><dd className="font-bold tabular-nums">{formatJpPhone(form.phone) || form.phone}</dd></div>
          </dl>
          {comps.map((c, i) => c.kind && c.sel && (
            <dl key={i} className="mt-2 divide-y rounded-lg border bg-white text-sm" aria-label={`${i + 2}人目（お連れ様）の確認`}>
              <div className="px-4 py-2 text-xs font-bold text-brand-dark">{i + 2}人目（お連れ様）</div>
              <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">日時</dt><dd className="text-base font-bold">{formatDateJa(c.sel.date)} {minToHm(c.sel.time)}〜</dd></div>
              <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">ご来院</dt><dd>{KIND_TEXT[c.kind]}</dd></div>
              {(c.kind === 'RETURN' || c.kind === 'REVISIT') && <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">診察券番号</dt><dd>{c.cardNo || '（未入力）'}</dd></div>}
              <div className="flex gap-3 px-4 py-3"><dt className="w-24 shrink-0 text-slate-500">氏名</dt><dd className="font-bold">{c.name}</dd></div>
            </dl>
          ))}
          {party && <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900" role="note" aria-label="まとめての予約の案内">{count}名様分をまとめてお取りします。手続き中にほかの方のご予約で埋まったときは、<b>全員分のご予約を取らずに</b>日時の選び直しになります。</p>}
          {campaign && <div className="mt-3"><CampaignBox c={campaign} compact /></div>}
          <PrivacyNote />
          {sel.status === 'few' && <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note" aria-label="残り1枠の案内">この時間は<b>残り1枠</b>です。ご予約の手続き中に、ほかの方のご予約で埋まることがあります。ご予約が取れたかどうかは、次の画面でお知らせします。</p>}
          <button type="button" onClick={submit} disabled={loading} className="mt-4 w-full rounded-lg bg-brand px-4 py-3 text-base font-bold text-white disabled:opacity-50">
            {loading ? '送信中…' : party ? `${count}名分を予約する` : 'この内容で予約する'}
          </button>
          <button type="button" onClick={() => { setStep(2); setError(''); }} disabled={loading} className="mt-2 w-full rounded-lg border border-brand bg-white px-4 py-3 text-base font-bold text-brand disabled:opacity-50">
            入力画面に戻って修正する
          </button>
          {notes}
          <button type="button" className="mt-4 text-sm text-brand underline" onClick={() => { setStep(1); setStage('leader'); setError(''); }}>← 日時・来院区分を変更</button>
        </section>
      )}

      {step === 4 && done && (
        <section className="rounded-lg border border-brand bg-white p-5">
          <h2 className="text-lg font-bold text-brand-dark">✓ ご予約が確定しました</h2>
          <p className="mt-1 text-sm text-slate-600">このお時間でご予約をお取りしました。</p>
          {partyDone
            ? <ul className="mt-3 space-y-1.5" aria-label="お取りしたご予約">
                {partyDone.map((x, i) => (
                  <li key={x.token} className="rounded border px-3 py-2 text-sm">
                    <b>{x.name} 様</b>{i > 0 && <span className="ml-1 text-xs text-slate-500">（お連れ様）</span>}
                    <span className="block text-base">{formatDateJa(x.date)} {minToHm(x.time)}〜</span>
                    <Link to={`/r/${x.token}`} className="text-xs text-brand underline">確認ページ</Link>
                  </li>
                ))}
              </ul>
            : <p className="mt-3 text-base">{formatDateJa(done.date)} {minToHm(done.time)}〜</p>}
          <p className="mt-1 text-sm text-slate-600">{store.name}</p>
          {done.campaign && <div className="mt-3"><CampaignBox c={done.campaign} compact /></div>}
          {done.smsStatus === 'SENT'
            ? <p className="mt-3 text-sm">確認のSMSをお送りしました。</p>
            : !done.token && <p className="mt-3 text-sm text-slate-600">この画面を保存（スクリーンショット）しておいてください。</p>}
          <ul className="mt-4 space-y-2 rounded-lg border border-brand bg-brand-light px-4 py-3 text-sm leading-relaxed text-brand-dark">
            <li><b>お支払いは現金のみ</b>となります。</li>
            <li><b>マイナンバーカード（保険証）</b>と、お持ちの方は<b>各種受給者証</b>を必ずお持ちください。</li>
            <li>お時間に余裕をもってご来院ください。{(kind !== 'RETURN' || compKinds.some((k) => k !== 'RETURN')) && '初めての方・久しぶりの方は10分前にお越しください。'}</li>
          </ul>
          {done.token && !partyDone && (
            <>
              <Link to={`/r/${done.token}`} className="mt-4 block rounded-lg bg-brand px-4 py-3 text-center text-base font-bold text-white no-underline">ご予約の確認ページを開く</Link>
              <p className="mt-1 text-center text-[11.5px] text-slate-600">ブックマークしておくと予約日の翌日まで確認できます</p>
            </>
          )}
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={remember} onChange={(e) => {
              setRemember(e.target.checked);
              if (e.target.checked) { const m = { name: form.name, phone: form.phone, cardNo: form.cardNo }; savePatient(m); setMemory(m); } else { forgetPatient(); setMemory(null); }
            }} />
            <span><b>次回のために、この端末にお名前・電話番号・診察券番号を覚えておく</b><span className="block text-xs text-slate-600">このスマホの中だけに保存します。共用の端末ではチェックを外してください。</span></span>
          </label>
          {notes}
          <p className="mt-3 text-sm">変更・キャンセルはお電話（{phoneLink}）へお願いいたします。</p>
          <button type="button" className="mt-5 text-sm text-brand underline" onClick={() => { setStep(1); setSel(null); setDone(null); setPartyDone(null); changeCount(1); setKind(presetKind); setUseMemory(true); setForm({ cardNo: '', name: '', phone: '' }); setGridKey((k) => k + 1); }}>続けて予約する</button>
        </section>
      )}

      {step !== 1 && phoneBanner}
      <PublicFooter />
    </main>
  );
}

/** ご予約の人数（1〜4 名）・お連れ様の来院区分・日時の決め方 */
function PartyBox({ count, onCount, comps, setComp, mode, onMode }: {
  count: number; onCount: (n: number) => void; comps: Companion[]; setComp: (i: number, p: Partial<Companion>) => void; mode: 'same' | 'each'; onMode: (m: 'same' | 'each') => void;
}) {
  return (
    <div className="mb-3 rounded-lg border bg-white p-3" role="group" aria-label="ご予約の人数">
      <p className="text-[14px] font-bold text-brand-dark">ご予約の人数<span className="ml-1 text-[11px] font-normal text-slate-500">（ご家族などと一緒に 4 名まで）</span></p>
      <div className="mt-1 grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" aria-pressed={count === n} onClick={() => onCount(n)} className={`rounded-md border-2 border-brand py-1.5 text-sm font-bold ${count === n ? 'bg-brand text-white' : 'bg-white text-brand-dark'}`}>{n}名</button>
        ))}
      </div>
      {count > 1 && <>
        <p className="mt-2 text-xs text-slate-600">1人目（ご本人）の来院区分は、下の表の上で選びます。</p>
        {comps.map((c, i) => (
          <div key={i} className="mt-2" role="radiogroup" aria-label={`${i + 2}人目（お連れ様）の来院区分`}>
            <p className={`text-[13px] font-bold ${c.kind ? 'text-slate-700' : 'text-red-600'}`}>{i + 2}人目（お連れ様）の来院区分</p>
            <div className="mt-0.5 grid grid-cols-2 gap-1">
              {(Object.keys(KIND_SHORT) as Kind[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={c.kind === k} onClick={() => setComp(i, { kind: k, sel: null })}
                  className={`rounded-md border px-1.5 py-1.5 text-[12px] font-semibold leading-tight ${c.kind === k ? 'border-brand bg-brand-light text-brand-dark ring-2 ring-brand' : 'border-slate-300 bg-white text-slate-700'}`}>
                  {c.kind === k ? '● ' : '○ '}{KIND_SHORT[k]}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="mt-2 text-[13px] font-bold text-slate-700">日時</p>
        <div className="mt-0.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="日時の決め方">
          {([['same', 'みんな同じ日時'], ['each', '1人ずつ選ぶ']] as const).map(([m, l]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onMode(m)} className={`rounded-md border-2 border-brand py-1.5 text-[13px] font-bold ${mode === m ? 'bg-brand text-white' : 'bg-white text-brand-dark'}`}>{l}</button>
          ))}
        </div>
        <p className="mt-1 text-[11.5px] text-slate-500">{mode === 'same' ? '下の表は、人数分ご一緒に取れる時間だけ 〇・△ になります。' : 'まず 1人目の日時を選び、そのあとお連れ様の日時を選びます。'}</p>
      </>}
    </div>
  );
}
