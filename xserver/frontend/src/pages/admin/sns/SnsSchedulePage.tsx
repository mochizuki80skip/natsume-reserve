// 設定（本部）：店舗ごとの投稿の頻度・曜日・時刻・運用メモをカードで並べて編集する。エリア分けで絞り込み、エリアの店舗にまとめて同じ曜日・時刻を入れられる
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { sendJson, type Schedule, type StoreSetting } from '@/lib/sns';
import { StoreDot } from '@/lib/storeColor';
import SnsNav from '@/components/SnsNav';
import SnsScheduleEditor from '@/components/SnsScheduleEditor';
import { useAdmin } from '../Layout';

const NO_AREA = 'エリア未設定';
const areaOf = (s: StoreSetting) => s.areaGroup?.trim() || NO_AREA;

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
  const [bulk, setBulk] = useState<{ ig: Schedule | null; gbp: Schedule | null }>({ ig: null, gbp: null });
  useEffect(() => { if (data) { setRows(data.stores); setDirty(new Set()); } }, [data]);
  if (me.session.role !== 'hq') return <p className="text-sm">本部だけが使えます。店舗の設定は <Link to="/admin/sns/settings" className="text-brand underline">こちら</Link>。</p>;
  if (error) return <div><SnsNav title="設定" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="設定" /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  // エリアの並び：店舗コード順で最初に出てくる順（カレンダーと同じ）。エリア未設定は最後
  const areas = [...new Set(rows.map((r) => areaOf(r.setting)))].sort((a, b) => a === NO_AREA ? 1 : b === NO_AREA ? -1 : 0);
  const shown = area ? rows.filter((r) => areaOf(r.setting) === area) : rows;
  const setArea = (a: string) => { const n = new URLSearchParams(sp); if (a) n.set('area', a); else n.delete('area'); setSp(n, { replace: true }); };
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
      try { await sendJson(`/api/admin/sns/settings?store=${encodeURIComponent(code)}`, 'PUT', { igEnabled: s.igEnabled, igSchedule: s.igSchedule, gbpEnabled: s.gbpEnabled, gbpSchedule: s.gbpSchedule, memo: s.memo }); n++; }
      catch (e) { errs.push(`${r.name}: ${(e as Error).message}`); }
    }
    setMsg(`${n} 店舗を保存しました${errs.length ? `。エラー：${errs.join(' / ')}` : ''}`);
    reload();
  }
  return (
    <div className="space-y-4 pb-20">
      <SnsNav title="設定" />
      <p className="-mt-2 text-sm text-slate-600">店舗ごとの投稿の頻度・曜日・時刻の既定値です。変更すると、これから作る下書きとカレンダーの予定枠に反映されます（作成済みの下書きの日時は変わりません）。地域・住所・差し込み語・Google の投稿ページ URL などは各店舗の「詳しい設定」で入れます。</p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="エリア">
        <button type="button" onClick={() => setArea('')} className={`rounded-full border px-3 py-1 ${area === '' ? 'bg-brand font-bold text-white' : 'bg-white'}`}>すべて（{rows.length} 店）</button>
        {areas.map((a) => <button key={a} type="button" onClick={() => setArea(a)} className={`rounded-full border px-3 py-1 ${area === a ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{a}（{rows.filter((r) => areaOf(r.setting) === a).length} 店）</button>)}
        <Link to={`/admin/sns/calendar${area ? `?area=${encodeURIComponent(area)}` : ''}`} className="ml-auto text-brand underline">カレンダーで見る</Link>
      </div>
      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
        <div className="mb-2 font-bold">{area || 'すべて'}の {shown.length} 店舗にまとめて設定</div>
        <p className="mb-2 text-xs text-slate-600">エリアごとに投稿の曜日を分けるときに使います（例：浜松は 月・水・金、静岡は 火・木・土）。エリアは「店舗の一括設定」の「エリア分け」で決めます。</p>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><span className="w-20 font-bold">Instagram</span><SnsScheduleEditor value={bulk.ig ?? data.defaults.igSchedule} onChange={(v) => setBulk({ ...bulk, ig: v })} /><button type="button" onClick={() => applyBulk('ig')} className="rounded border bg-white px-3 py-1">このエリアに入れる</button></div>
          <div className="flex flex-wrap items-center gap-2"><span className="w-20 font-bold">Google</span><SnsScheduleEditor value={bulk.gbp ?? data.defaults.gbpSchedule} onChange={(v) => setBulk({ ...bulk, gbp: v })} /><button type="button" onClick={() => applyBulk('gbp')} className="rounded border bg-white px-3 py-1">このエリアに入れる</button></div>
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        {shown.map((r) => {
          const s = r.setting;
          return (
            <section key={r.code} className="rounded-lg border bg-white p-4 text-sm">
              <div className="mb-3 flex items-center gap-2"><StoreDot code={r.code} /><span className="font-bold">{r.name}</span><span className="text-xs text-slate-400">{r.code}</span><span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{areaOf(s)}</span>
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
      </div>
      <div className="fixed bottom-6 right-6"><button type="button" disabled={dirty.size === 0} onClick={saveAll} className="rounded-md bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg disabled:opacity-40">保存{dirty.size > 0 ? `（${dirty.size} 店舗）` : ''}</button></div>
    </div>
  );
}
