// 配信設定（本部）：どの店舗が何曜日・何時に Google／Instagram に投稿するかと、店舗のエリア分けを、全店舗の表（またはカード）で編集する。
// エリアで絞り込み、エリアの店舗にまとめて同じ曜日・時刻を入れられる
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { sendJson, describeSchedule, type Schedule, type StoreSetting } from '@/lib/sns';
import { WEEKDAY_JA } from '@/lib/time';
import { StoreDot } from '@/lib/storeColor';
import SnsNav from '@/components/SnsNav';
import SnsScheduleEditor from '@/components/SnsScheduleEditor';
import { useAdmin } from '../Layout';

const NO_AREA = 'エリア未設定';
const areaOf = (s: StoreSetting) => s.areaGroup?.trim() || NO_AREA;
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const pad = (n: number) => String(n).padStart(2, '0');
/** 曜日のボタン（毎週の曜日）。毎月の設定のときに押すと、毎週のその曜日に切り替わる */
function WeekChips({ value, isDefault, onChange, label }: { value: Schedule; isDefault: boolean; onChange: (s: Schedule) => void; label: string }) {
  const days = value.type === 'weekly' ? value.weekdays : [];
  const toggle = (d: number) => {
    if (value.type !== 'weekly') { onChange({ type: 'weekly', weekdays: [d], hour: value.hour, minute: value.minute }); return; }
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    if (next.length) onChange({ ...value, weekdays: next });
  };
  return (
    <div className="space-y-1" title={isDefault ? '全店共通の既定を表示中（変えるとこの店舗だけの設定になります）' : ''}>
      <div className="flex items-center gap-1">
      {WD_ORDER.map((d) => (
        <button key={d} type="button" aria-label={`${label} ${WEEKDAY_JA[d]}`} aria-pressed={days.includes(d)} onClick={() => toggle(d)}
          className={`h-7 w-7 rounded text-xs ${days.includes(d) ? (isDefault ? 'bg-brand/50 text-white' : 'bg-brand font-bold text-white') : 'border bg-white text-slate-500'} ${d === 0 ? 'text-red-600' : ''}`}>{WEEKDAY_JA[d]}</button>
      ))}
      </div>
      <div className="flex items-center gap-1">
      <input type="time" value={`${pad(value.hour)}:${pad(value.minute)}`} aria-label={`${label} 時刻`}
        onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (!Number.isNaN(h)) onChange({ ...value, hour: h, minute: m || 0 }); }}
        className={`w-28 rounded border px-1 py-0.5 text-xs ${isDefault ? 'text-slate-400' : ''}`} />
      {value.type === 'monthly' && <span className="ml-1 text-xs text-amber-700">{describeSchedule(value)}</span>}
      {isDefault && <span className="text-[11px] text-slate-400">既定</span>}
      </div>
    </div>
  );
}

interface Row { code: string; name: string; phone: string; setting: StoreSetting; draftCount: number }
interface Resp { stores: Row[]; defaults: { igSchedule: Schedule; gbpSchedule: Schedule }; gbpManual: boolean }

export default function SnsSchedulePage() {
  const { me } = useAdmin();
  const { data, error, reload } = useFetch<Resp>(me.session.role === 'hq' ? '/api/admin/hq/sns/stores' : null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [sp, setSp] = useSearchParams();
  const area = sp.get('area') ?? '';
  const view = sp.get('view') === 'cards' ? 'cards' : 'table';
  const [bulk, setBulk] = useState<{ ig: Schedule | null; gbp: Schedule | null }>({ ig: null, gbp: null });
  useEffect(() => { if (data) { setRows(data.stores); setDirty(new Set()); } }, [data]);
  if (me.session.role !== 'hq') return <p className="text-sm">本部だけが使えます。店舗の設定は <Link to="/admin/sns/settings" className="text-brand underline">こちら</Link>。</p>;
  if (error) return <div><SnsNav title="配信設定（曜日・エリア）" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="配信設定（曜日・エリア）" /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  // エリアの並び：店舗コード順で最初に出てくる順（カレンダーと同じ）。エリア未設定は最後
  // 絞り込みは保存済みのエリア分けで（入力中にエリアを書き換えても行が消えないように）
  const savedArea = new Map(data.stores.map((r) => [r.code, areaOf(r.setting)]));
  const areaOfRow = (r: Row) => savedArea.get(r.code) ?? areaOf(r.setting);
  const areas = [...new Set(rows.map(areaOfRow))].sort((a, b) => a === NO_AREA ? 1 : b === NO_AREA ? -1 : 0);
  const shown = (area ? rows.filter((r) => areaOfRow(r) === area) : rows).slice().sort((a, b) => areas.indexOf(areaOfRow(a)) - areas.indexOf(areaOfRow(b)) || a.code.localeCompare(b.code));
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const setArea = (a: string) => setParam('area', a);
  const sched = (s: StoreSetting, ch: 'ig' | 'gbp') => (ch === 'ig' ? s.igSchedule : s.gbpSchedule) ?? data.defaults[ch === 'ig' ? 'igSchedule' : 'gbpSchedule'];
  /** 曜日ごとの投稿する店舗の数（表示中の店舗。偏りの確認用） */
  const perDay = (ch: 'ig' | 'gbp') => WD_ORDER.map((d) => shown.filter((r) => { const s = r.setting; if (!(ch === 'ig' ? s.igEnabled : s.gbpEnabled)) return false; const v = sched(s, ch); return v.type === 'weekly' ? v.weekdays.includes(d) : v.weekday === d; }).length);
  const allAreaNames = areas.filter((a) => a !== NO_AREA);
  /** 表示中の店舗（エリア）にまとめて同じ曜日・時刻を入れる（保存は右下の「保存」） */
  const applyBulk = (ch: 'ig' | 'gbp') => {
    const v = bulk[ch] ?? data.defaults[ch === 'ig' ? 'igSchedule' : 'gbpSchedule'];
    const codes = shown.filter((r) => (ch === 'ig' ? r.setting.igEnabled : r.setting.gbpEnabled)).map((r) => r.code);
    setRows((rs) => rs.map((r) => codes.includes(r.code) ? { ...r, setting: { ...r.setting, [ch === 'ig' ? 'igSchedule' : 'gbpSchedule']: v } } : r));
    setDirty((d) => { const n = new Set(d); codes.forEach((c) => n.add(c)); return n; });
    setMsg(`${area || 'すべて'}の ${codes.length} 店舗の ${ch === 'ig' ? 'Instagram' : 'Google'} の曜日・時刻を入れました（まだ保存していません。右下の「保存」を押してください）`);
  };
  const upd = (code: string, patch: Partial<StoreSetting>) => { setRows((rs) => rs.map((r) => r.code === code ? { ...r, setting: { ...r.setting, ...patch } } : r)); setDirty((d) => new Set(d).add(code)); };
  async function saveAll() {
    const errs: string[] = []; let n = 0;
    for (const code of dirty) {
      const r = rows.find((x) => x.code === code)!;
      const s = r.setting;
      try { await sendJson(`/api/admin/sns/settings?store=${encodeURIComponent(code)}`, 'PUT', { igEnabled: s.igEnabled, igSchedule: s.igSchedule, gbpEnabled: s.gbpEnabled, gbpSchedule: s.gbpSchedule, memo: s.memo, areaGroup: s.areaGroup ?? '' }); n++; }
      catch (e) { errs.push(`${r.name}: ${(e as Error).message}`); }
    }
    setMsg(`${n} 店舗を保存しました${errs.length ? `。エラー：${errs.join(' / ')}` : ''}`);
    reload();
  }
  return (
    <div className="space-y-4 pb-20">
      <SnsNav title="配信設定（曜日・エリア）" />
      <p className="-mt-2 text-sm text-slate-600">どの店舗が、何曜日・何時に Google／Instagram に投稿するかを決めます。エリア分けもここで変えられます。変更は、これから作る下書きとカレンダーの予定枠に反映されます（作成済みの下書きの日時は変わりません）。</p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="エリア">
        <button type="button" onClick={() => setArea('')} className={`rounded-full border px-3 py-1 ${area === '' ? 'bg-brand font-bold text-white' : 'bg-white'}`}>すべて（{rows.length} 店）</button>
        {areas.map((a) => <button key={a} type="button" onClick={() => setArea(a)} className={`rounded-full border px-3 py-1 ${area === a ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{a}（{rows.filter((r) => areaOf(r.setting) === a).length} 店）</button>)}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setParam('view', '')} className={`rounded border px-3 py-1 ${view === 'table' ? 'bg-slate-700 text-white' : 'bg-white'}`}>表</button>
          <button type="button" onClick={() => setParam('view', 'cards')} className={`rounded border px-3 py-1 ${view === 'cards' ? 'bg-slate-700 text-white' : 'bg-white'}`}>カード（運用メモ）</button>
        </span>
        <Link to={`/admin/sns/calendar${area ? `?area=${encodeURIComponent(area)}` : ''}`} className="text-brand underline">カレンダーで見る</Link>
      </div>
      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
        <div className="mb-2 font-bold">{area || 'すべて'}の {shown.length} 店舗にまとめて設定</div>
        <p className="mb-2 text-xs text-slate-600">エリアごとに投稿の曜日を分けるときに使います（例：浜松は 月・水・金、静岡は 火・木・土）。エリアは「店舗の一括設定」の「エリア分け」で決めます。</p>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><span className="w-20 font-bold">Instagram</span><SnsScheduleEditor value={bulk.ig ?? data.defaults.igSchedule} onChange={(v) => setBulk({ ...bulk, ig: v })} /><button type="button" onClick={() => applyBulk('ig')} className="rounded border bg-white px-3 py-1">このエリアに入れる</button></div>
          <div className="flex flex-wrap items-center gap-2"><span className="w-20 font-bold">Google</span><SnsScheduleEditor value={bulk.gbp ?? data.defaults.gbpSchedule} onChange={(v) => setBulk({ ...bulk, gbp: v })} /><button type="button" onClick={() => applyBulk('gbp')} className="rounded border bg-white px-3 py-1">このエリアに入れる</button></div>
        </div>
      </section>
      {view === 'table' && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <datalist id="sns-area-groups">{allAreaNames.map((a) => <option key={a} value={a} />)}</datalist>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-left text-xs text-slate-600">
                <th className="px-3 py-2">店舗</th><th className="px-2 py-2">エリア分け</th>
                <th className="px-2 py-2">Google（曜日・時刻）{data.gbpManual && <span className="font-normal">　手動投稿</span>}</th>
                <th className="px-2 py-2">Instagram（曜日・時刻）</th><th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const s = r.setting;
                const head = i === 0 || areaOfRow(shown[i - 1]) !== areaOfRow(r);
                return [
                  head && !area ? <tr key={`h-${r.code}`} className="bg-blue-50/60"><td colSpan={5} className="px-3 py-1 text-xs font-bold text-brand-dark">{areaOfRow(r)}（{shown.filter((x) => areaOfRow(x) === areaOfRow(r)).length} 店）</td></tr> : null,
                  <tr key={r.code} className={`border-t ${dirty.has(r.code) ? 'bg-amber-50/60' : ''}`}>
                    <td className="whitespace-nowrap px-3 py-2"><StoreDot code={r.code} className="mr-1" /><span className="font-bold">{r.name}</span> <span className="text-xs text-slate-400">{r.code}</span></td>
                    <td className="px-2 py-2"><input value={s.areaGroup ?? ''} list="sns-area-groups" onChange={(e) => upd(r.code, { areaGroup: e.target.value })} placeholder="例：浜松" aria-label={`${r.name} のエリア分け`} className="w-28 rounded border px-2 py-1 text-sm" /></td>
                    {(['gbp', 'ig'] as const).map((ch) => {
                      const on = ch === 'ig' ? s.igEnabled : s.gbpEnabled;
                      const label = `${r.name} ${ch === 'ig' ? 'Instagram' : 'Google'}`;
                      return (
                        <td key={ch} className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <input type="checkbox" checked={on} aria-label={`${label} に投稿する`} onChange={(e) => upd(r.code, ch === 'ig' ? { igEnabled: e.target.checked } : { gbpEnabled: e.target.checked })} />
                            {on ? <WeekChips label={label} value={sched(s, ch)} isDefault={(ch === 'ig' ? s.igSchedule : s.gbpSchedule) === null} onChange={(v) => upd(r.code, ch === 'ig' ? { igSchedule: v } : { gbpSchedule: v })} /> : <span className="text-xs text-slate-400">投稿しない</span>}
                          </div>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-2 py-2 text-xs"><button type="button" onClick={() => upd(r.code, { igSchedule: null, gbpSchedule: null })} className="text-brand underline">既定に戻す</button></td>
                  </tr>,
                ];
              })}
            </tbody>
            <tfoot>
              {(['gbp', 'ig'] as const).map((ch) => (
                <tr key={ch} className="border-t bg-slate-50 text-xs text-slate-600">
                  <td colSpan={2} className="px-3 py-1.5 text-right">{ch === 'ig' ? 'Instagram' : 'Google'} の曜日ごとの店舗数</td>
                  <td colSpan={3} className="px-2 py-1.5">{WD_ORDER.map((d, k) => <span key={d} className="mr-3 inline-block">{WEEKDAY_JA[d]} <b className="tabular-nums">{perDay(ch)[k]}</b></span>)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
          <p className="border-t px-3 py-2 text-xs text-slate-500">曜日のボタンを押して入れ外しします。薄い色は全店共通の既定を表示中です（押すとこの店舗だけの設定になります）。エリア分けを変えると、カレンダーのエリアのタブと定型投稿の「対象エリア」に使われます。最後に右下の「保存」を押してください。</p>
        </div>
      )}
      {view === 'cards' && <div className="grid gap-4 xl:grid-cols-2">
        {shown.map((r) => {
          const s = r.setting;
          return (
            <section key={r.code} className="rounded-lg border bg-white p-4 text-sm">
              <div className="mb-3 flex items-center gap-2"><StoreDot code={r.code} /><span className="font-bold">{r.name}</span><span className="text-xs text-slate-400">{r.code}</span><span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{areaOfRow(r)}</span>
                <button type="button" onClick={() => upd(r.code, { igSchedule: null, gbpSchedule: null })} className="ml-auto text-xs text-brand underline">既定に戻す</button>
                <Link to={`/admin/sns/settings?store=${encodeURIComponent(r.code)}`} className="text-xs text-brand underline">詳しい設定</Link>
              </div>
              <div className="space-y-2 border-b pb-3">
                <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={s.igEnabled} onChange={(e) => upd(r.code, { igEnabled: e.target.checked })} />Instagram に投稿する</label>
                {s.igEnabled && <div className="pl-6"><SnsScheduleEditor value={s.igSchedule ?? data.defaults.igSchedule} onChange={(v) => upd(r.code, { igSchedule: v })} />{!s.igSchedule && <div className="mt-1 text-xs text-slate-400">（全店共通の既定を表示中。変えるとこの店舗だけの設定になります）</div>}</div>}
              </div>
              <div className="space-y-2 pt-3">
                <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={s.gbpEnabled} onChange={(e) => upd(r.code, { gbpEnabled: e.target.checked })} />Google に投稿する{data.gbpManual && <span className="text-xs font-normal text-slate-500">（手動投稿）</span>}</label>
                {s.gbpEnabled && <div className="pl-6"><SnsScheduleEditor value={s.gbpSchedule ?? data.defaults.gbpSchedule} onChange={(v) => upd(r.code, { gbpSchedule: v })} />{!s.gbpSchedule && <div className="mt-1 text-xs text-slate-400">（全店共通の既定を表示中）</div>}</div>}
              </div>
              <label className="mt-3 block text-xs text-slate-600">運用メモ（下書きを確認する人が毎回見るルール）<textarea value={s.memo} onChange={(e) => upd(r.code, { memo: e.target.value })} rows={2} placeholder="例：料金は書かない、絵文字なし" className="mt-1 w-full rounded border px-2 py-1 text-sm" /></label>
            </section>
          );
        })}
      </div>}
      <div className="fixed bottom-6 right-6"><button type="button" disabled={dirty.size === 0} onClick={saveAll} className="rounded-md bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg disabled:opacity-40">保存{dirty.size > 0 ? `（${dirty.size} 店舗）` : ''}</button></div>
    </div>
  );
}
