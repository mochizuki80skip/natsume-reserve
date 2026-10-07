// 設定（本部）：店舗ごとの投稿の頻度・曜日・時刻・運用メモをカードで並べて編集する
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { sendJson, type Schedule, type StoreSetting } from '@/lib/sns';
import { StoreDot } from '@/lib/storeColor';
import SnsNav from '@/components/SnsNav';
import SnsScheduleEditor from '@/components/SnsScheduleEditor';
import { useAdmin } from '../Layout';

interface Row { code: string; name: string; phone: string; setting: StoreSetting; draftCount: number }
interface Resp { stores: Row[]; defaults: { igSchedule: Schedule; gbpSchedule: Schedule }; gbpManual: boolean }

export default function SnsSchedulePage() {
  const { me } = useAdmin();
  const { data, error, reload } = useFetch<Resp>(me.session.role === 'hq' ? '/api/admin/hq/sns/stores' : null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  useEffect(() => { if (data) { setRows(data.stores); setDirty(new Set()); } }, [data]);
  if (me.session.role !== 'hq') return <p className="text-sm">本部だけが使えます。店舗の設定は <Link to="/admin/sns/settings" className="text-brand underline">こちら</Link>。</p>;
  if (error) return <div><SnsNav title="設定" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="設定" /><p className="text-sm text-slate-500">読み込み中…</p></div>;
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
      <div className="grid gap-4 xl:grid-cols-2">
        {rows.map((r) => {
          const s = r.setting;
          return (
            <section key={r.code} className="rounded-lg border bg-white p-4 text-sm">
              <div className="mb-3 flex items-center gap-2"><StoreDot code={r.code} /><span className="font-bold">{r.name}</span><span className="text-xs text-slate-400">{r.code}</span>
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
