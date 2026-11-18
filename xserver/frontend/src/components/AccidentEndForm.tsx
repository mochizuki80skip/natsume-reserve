// 交通事故患者様の終了報告（店舗）：自賠請求のページの下。何件でも入れて「申請する」でまとめて送る（Google フォーム「事故患者終了報告」と同じ項目）。
// 店舗名は自動。2ヶ月経過のリストの方から選ぶと、氏名・性別・年齢・事故日・事故内容が入る。入れかけの内容はこのパソコンに残す
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { useAdmin } from '@/pages/admin/Layout';

const SEX = ['男性', '女性'];
const PARTS = ['首', '肩', '背中', '腕', '手', '腰', '股関節', '足'];
const PERIODS = Array.from({ length: 12 }, (_, i) => `${i + 1}ヶ月`);
const PHOTO = ['撮影済み（顔出しOK）', '撮影済み（顔出しNG）', '撮影不可'];
const SURVEY = ['回答済み', '不可'];

export interface Draft {
  key: string; karteId: string | null; patientName: string; sex: string; age: string; job: string; accidentDate: string; place: string; mechanism: string;
  fault: string; parts: string[]; partsOther: string; period: string; periodOther: string; months: string[]; photo: string; survey: string; surveyOther: string; note: string;
}
interface Two { id: string; name: string; date: string; kind: string; status: string }
interface KarteLite { id: string; sex: string; age: number | null; accidentDate: string | null; accidentNote: string }

const empty = (): Draft => ({ key: Math.random().toString(36).slice(2), karteId: null, patientName: '', sex: '', age: '', job: '', accidentDate: '', place: '', mechanism: '', fault: '', parts: [], partsOther: '', period: '', periodOther: '', months: Array(12).fill(''), photo: '', survey: '', surveyOther: '', note: '' });
const monthsOf = (d: Draft) => { const n = Number((d.period === 'その他' ? '' : d.period).replace(/[^\d]/g, '')); return Math.min(12, Math.max(1, n || 1)); };
/** 送る形にする（その他の欄を中に入れる） */
const toReport = (d: Draft) => ({
  karteId: d.karteId, patientName: d.patientName, sex: d.sex, age: d.age, job: d.job, accidentDate: d.accidentDate, place: d.place, mechanism: d.mechanism, fault: d.fault,
  parts: [...d.parts, ...(d.partsOther.trim() ? [d.partsOther.trim()] : [])], period: d.period === 'その他' ? d.periodOther : d.period,
  months: d.months.slice(0, d.period === 'その他' ? 12 : monthsOf(d)), photo: d.photo, survey: d.survey === 'その他' ? d.surveyOther : d.survey, note: d.note,
});
/** 未入力（フォームの必須と同じ） */
export function missingOf(d: Draft): string[] {
  const r = toReport(d), m: string[] = [];
  if (!r.patientName.trim()) m.push('患者氏名');
  if (!r.sex) m.push('性別');
  if (!r.age.trim()) m.push('年齢');
  if (!r.job.trim()) m.push('職業');
  if (!r.accidentDate) m.push('事故日');
  if (!r.place.trim()) m.push('事故発生地域');
  if (!r.mechanism.trim()) m.push('発生機序');
  if (!r.fault.trim()) m.push('過失割合');
  if (!r.parts.length) m.push('診断部位');
  if (!r.period.trim()) m.push('通院期間');
  if (!(r.months[0] ?? '').trim()) m.push('1ヶ月目');
  if (!r.photo) m.push('写真');
  if (!r.survey.trim()) m.push('アンケート');
  return m;
}

export default function AccidentEndForm() {
  const { me, refreshMe } = useAdmin();
  const KEY = `accidentEnd:${me.store?.code ?? ''}`;
  const [drafts, setDrafts] = useState<Draft[]>(() => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return Array.isArray(v) ? v : []; } catch { return []; } });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const two = useFetch<{ rows: Two[] }>('/api/admin/accidents/two-months?scope=store').data;
  const ym = (me.today ?? new Date().toISOString()).slice(0, 7);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(drafts)); } catch { /* 残せなくても入力はできる */ } }, [drafts, KEY]);
  const upd = (key: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));
  async function fromKarte(t: Two) {
    const r = await fetch(`/api/admin/karte?month=${t.date.slice(0, 7)}`); const j = await r.json().catch(() => ({}));
    const k = ((j as { rows?: KarteLite[] }).rows ?? []).find((x) => x.id === t.id);
    const d = empty();
    setDrafts((ds) => [...ds, { ...d, karteId: t.id, patientName: t.name, sex: k?.sex === '♂' ? '男性' : k?.sex === '♀' ? '女性' : '', age: k?.age != null ? `${Math.floor(k.age / 10) * 10}代` : '', accidentDate: k?.accidentDate ?? '', mechanism: k?.accidentNote ?? '' }]);
  }
  async function submit() {
    setTried(true); setMsg(null);
    const bad = drafts.map((d, i) => ({ i, m: missingOf(d), name: d.patientName })).filter((x) => x.m.length);
    if (bad.length) { setMsg({ ok: false, text: `未入力があります：${bad.map((b) => `${b.i + 1}件目（${b.name || '氏名なし'}）${b.m.join('・')}`).join(' ／ ')}` }); return; }
    setBusy(true);
    const r = await fetch('/api/admin/accident-ends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reports: drafts.map(toReport) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: (j as { error?: string }).error ?? '申請できませんでした' }); return; }
    setMsg({ ok: true, text: `${(j as { count: number }).count} 件の終了報告を申請しました（2ヶ月経過のリストからも外れます）` });
    setDrafts([]); setTried(false); refreshMe();
  }
  const used = new Set(drafts.map((d) => d.karteId).filter(Boolean));
  const inp = 'w-full rounded border px-2 py-1 text-sm';
  return (
    <section className="rounded border bg-white p-4 text-sm" aria-label="交通事故患者様 終了報告">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">交通事故患者様 終了報告</h2>
        <span className="text-xs text-slate-500">{me.store?.name}（店舗名は自動で入ります）</span>
        <Link to={`/admin/accident-ends?unit=month&period=${ym}`} className="ml-auto text-xs text-brand underline">これまでの報告を見る</Link>
      </div>
      <p className="mt-1 text-xs text-slate-600">事故の施術が終わったら、終了した翌月 10 日までに報告してください。何人分でも入れてから「申請する」でまとめて送れます。入れかけの内容は、このパソコンに残ります。通院期間と施術内容に相違があるときは、確認の連絡が来ることがあります。</p>
      {msg && <p className={`mt-2 rounded px-3 py-2 ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`} role="status">{msg.text}</p>}
      <div className="mt-2 space-y-3">
        {drafts.map((d, i) => {
          const miss = tried ? new Set(missingOf(d)) : new Set<string>();
          const err = (k: string) => (miss.has(k) ? 'border-red-500 bg-red-50' : '');
          return (
            <fieldset key={d.key} className="rounded border border-slate-300 p-3" aria-label={`終了報告 ${i + 1}件目`}>
              <legend className="px-1 text-xs font-bold">{i + 1}件目 {d.patientName}</legend>
              <div className="grid gap-2 md:grid-cols-4">
                <label>患者氏名 *<input value={d.patientName} onChange={(e) => upd(d.key, { patientName: e.target.value })} aria-label="患者氏名" maxLength={40} className={`${inp} ${err('患者氏名')}`} /></label>
                <div>性別 *<div className={`flex gap-3 rounded border px-2 py-1 ${err('性別')}`}>{SEX.map((v) => <label key={v}><input type="radio" checked={d.sex === v} onChange={() => upd(d.key, { sex: v })} /> {v}</label>)}</div></div>
                <label>年齢 *<input value={d.age} onChange={(e) => upd(d.key, { age: e.target.value })} aria-label="年齢" placeholder="例）30代" maxLength={20} className={`${inp} ${err('年齢')}`} /></label>
                <label>職業 *<input value={d.job} onChange={(e) => upd(d.key, { job: e.target.value })} aria-label="職業" placeholder="例）デスクワーク" maxLength={60} className={`${inp} ${err('職業')}`} /></label>
                <label>事故日 *<input type="date" value={d.accidentDate} onChange={(e) => upd(d.key, { accidentDate: e.target.value })} aria-label="事故日" className={`${inp} ${err('事故日')}`} /></label>
                <label className="md:col-span-2">事故発生地域 *<input value={d.place} onChange={(e) => upd(d.key, { place: e.target.value })} aria-label="事故発生地域" placeholder="例）三島市徳倉の交差点（発生場所をなるべく細かく）" maxLength={200} className={`${inp} ${err('事故発生地域')}`} /></label>
                <label>過失割合 *<input value={d.fault} onChange={(e) => upd(d.key, { fault: e.target.value })} aria-label="過失割合" placeholder="例）10：0　被害者" maxLength={60} className={`${inp} ${err('過失割合')}`} /></label>
                <label className="md:col-span-4">発生機序 *<textarea value={d.mechanism} onChange={(e) => upd(d.key, { mechanism: e.target.value })} aria-label="発生機序" rows={2} placeholder="例）赤信号で停車中に後ろから 30〜40 キロで普通車に追突された" maxLength={2000} className={`${inp} ${err('発生機序')}`} /></label>
                <div className="md:col-span-2">診断部位 *<div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-2 py-1 ${err('診断部位')}`}>
                  {PARTS.map((v) => <label key={v}><input type="checkbox" checked={d.parts.includes(v)} onChange={(e) => upd(d.key, { parts: e.target.checked ? [...d.parts, v] : d.parts.filter((x) => x !== v) })} /> {v}</label>)}
                  <label>その他 <input value={d.partsOther} onChange={(e) => upd(d.key, { partsOther: e.target.value })} aria-label="診断部位（その他）" maxLength={30} className="w-24 rounded border px-1" /></label>
                </div></div>
                <div className="md:col-span-2">通院期間 *<div className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 ${err('通院期間')}`}>
                  <select value={d.period} onChange={(e) => upd(d.key, { period: e.target.value })} aria-label="通院期間" className="rounded border px-1 py-0.5">
                    <option value="">選ぶ</option>{PERIODS.map((v) => <option key={v} value={v}>{v}</option>)}<option value="その他">その他</option>
                  </select>
                  {d.period === 'その他' && <input value={d.periodOther} onChange={(e) => upd(d.key, { periodOther: e.target.value })} aria-label="通院期間（その他）" placeholder="例）2週間" maxLength={30} className="w-32 rounded border px-1" />}
                </div></div>
              </div>
              <div className="mt-2">
                <b>施術内容</b><span className="ml-1 text-xs text-slate-500">症状や施術内容（どこに何の施術を）、施術後どうなったかを、施術の月ごとに簡単に（交通事故ホームページの症例報告に使います）。例）むち打ち：右に首を回せない → 骨盤矯正・筋肉調整 → 痛み 60％改善、長時間の PC 作業でつらさが出る</span>
                <div className="mt-1 grid gap-2 md:grid-cols-2">
                  {Array.from({ length: d.period === 'その他' ? 12 : monthsOf(d) }, (_, m) => (
                    <label key={m} className="text-xs">{m + 1}ヶ月目{m === 0 && ' *'}<textarea value={d.months[m] ?? ''} onChange={(e) => upd(d.key, { months: d.months.map((x, j) => (j === m ? e.target.value : x)) })} aria-label={`${m + 1}ヶ月目`} rows={2} maxLength={1000} className={`${inp} ${m === 0 ? err('1ヶ月目') : ''}`} /></label>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">通院期間で選んだ月数ぶんの欄が出ます（2ヶ月目からは空欄でも申請できます）。</p>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>写真はとれましたか？ *<div className={`flex flex-wrap gap-3 rounded border px-2 py-1 ${err('写真')}`}>{PHOTO.map((v) => <label key={v}><input type="radio" checked={d.photo === v} onChange={() => upd(d.key, { photo: v })} /> {v}</label>)}</div></div>
                <div>アンケートは協力してもらえましたか？ *<div className={`flex flex-wrap items-center gap-3 rounded border px-2 py-1 ${err('アンケート')}`}>
                  {[...SURVEY, 'その他'].map((v) => <label key={v}><input type="radio" checked={d.survey === v} onChange={() => upd(d.key, { survey: v })} /> {v}</label>)}
                  {d.survey === 'その他' && <input value={d.surveyOther} onChange={(e) => upd(d.key, { surveyOther: e.target.value })} aria-label="アンケート（その他）" placeholder="例）12/1 にもらう予定" maxLength={100} className="w-48 rounded border px-1" />}
                </div></div>
                <label className="md:col-span-2">備考欄<textarea value={d.note} onChange={(e) => upd(d.key, { note: e.target.value })} aria-label="備考欄" rows={2} maxLength={2000} className={inp} /></label>
              </div>
              <div className="mt-2 text-right"><button type="button" onClick={() => confirm(`${i + 1}件目（${d.patientName || '氏名なし'}）を消しますか？`) && setDrafts((ds) => ds.filter((x) => x.key !== d.key))} className="text-xs text-red-700 underline">この件を消す</button></div>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setDrafts((ds) => [...ds, empty()])} className="rounded border bg-white px-3 py-1.5">＋ 患者様を追加</button>
        {(two?.rows ?? []).filter((t) => !used.has(t.id)).length > 0 && (
          <select value="" onChange={(e) => { const t = two!.rows.find((x) => x.id === e.target.value); if (t) void fromKarte(t); }} aria-label="2ヶ月経過のリストから選ぶ" className="rounded border px-2 py-1.5">
            <option value="">2ヶ月経過のリストから選ぶ…</option>
            {two!.rows.filter((t) => !used.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}（{Number(t.date.slice(5, 7))}/{Number(t.date.slice(8))} 初診・{t.kind === 'THIRD' ? '新三' : '新自'}）</option>)}
          </select>
        )}
        {drafts.length > 0 && <button type="button" onClick={submit} disabled={busy} className="ml-auto rounded bg-brand px-5 py-1.5 font-bold text-white disabled:opacity-50">{busy ? '申請中…' : `申請する（${drafts.length} 件）`}</button>}
      </div>
    </section>
  );
}
