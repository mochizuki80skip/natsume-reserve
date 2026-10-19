// カレンダー（本部）：全店舗の投稿予定を月のカレンダーで。エリア分け（例：浜松・静岡）のタブで絞り込み、
// エリアの店舗の投稿曜日・時刻もまとめて見られる。曜日の変更は「設定」をエリアで絞って行う
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNELS, CHANNEL_JA, STATUS_JA, addMonthsYm, monthGrid, type Channel, type PostStatus } from '@/lib/sns';
import { WEEKDAY_JA, addDays, weekdayOf } from '@/lib/time';
import SnsNav from '@/components/SnsNav';
import { StoreDot } from '@/lib/storeColor';
import { useAdmin } from '../Layout';
import SnsPostsPage from './SnsPostsPage';

interface CalPost { id: string; channel: Channel; status: PostStatus; scheduledAt: string; title: string; storeCode: string; storeName: string }
interface CalStore { code: string; name: string; areaGroup: string; igEnabled: boolean; gbpEnabled: boolean; igSchedule: string; gbpSchedule: string }
interface Resp { today: string; areas: { name: string; stores: number }[]; stores: CalStore[]; posts: CalPost[] }

const PER_DAY = 6;

/** 店舗名の共通の頭（例：「なつめ接骨院 」）を除いた短い名前。カレンダーのマスで店舗を見分けやすくする */
function shortNamer(names: string[]): (name: string) => string {
  if (names.length < 2) return (n) => n;
  let pre = names[0];
  for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
  if (pre.length < 2) return (n) => n;
  return (n) => n.slice(pre.length).trim() || n;
}

/** 本部は全店舗のカレンダー、店舗は自店舗のカレンダー（投稿一覧の月表示） */
export default function SnsCalendarRoute() {
  const { me } = useAdmin();
  return me.session.role === 'hq' ? <SnsAreaCalendarPage /> : <SnsPostsPage defaultView="calendar" />;
}

function SnsAreaCalendarPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v === null || v === '') n.delete(k); else n.set(k, v); setSp(n, { replace: true }); };
  const area = sp.get('area') ?? '';
  const channel = (sp.get('channel') ?? 'all') as Channel | 'all';
  const storeCode = sp.get('store') ?? '';
  const ym = sp.get('ym') ?? me.today.slice(0, 7);
  const from = `${ym}-01`;
  const to = addDays(addMonthsYm(ym, 1) + '-01', -1);
  const { data, error } = useFetch<Resp>(`/api/admin/sns/calendar?from=${from}&to=${to}${channel !== 'all' ? `&channel=${channel}` : ''}${area ? `&area=${encodeURIComponent(area)}` : ''}`);
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (error) return <div><SnsNav title="カレンダー" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="カレンダー" /><p className="text-sm text-slate-500">読み込み中…</p></div>;

  const stores = storeCode ? data.stores.filter((s) => s.code === storeCode) : data.stores;
  const short = shortNamer(data.stores.map((s) => s.name));
  const posts = storeCode ? data.posts.filter((p) => p.storeCode === storeCode) : data.posts;
  const byDate = new Map<string, CalPost[]>();
  for (const p of posts) { const d = p.scheduledAt.slice(0, 10); byDate.set(d, [...(byDate.get(d) ?? []), p]); }
  // 同じ曜日・時刻の店舗をまとめて表示（例：Google 毎週 月・水・金 10:00 … 5 店）
  const groups: { ch: Channel; sched: string; names: string[] }[] = [];
  for (const ch of CHANNELS) {
    if (channel !== 'all' && channel !== ch) continue;
    for (const s of stores) {
      if (!(ch === 'ig' ? s.igEnabled : s.gbpEnabled)) continue;
      const sched = ch === 'ig' ? s.igSchedule : s.gbpSchedule;
      const g = groups.find((x) => x.ch === ch && x.sched === sched);
      if (g) g.names.push(s.name); else groups.push({ ch, sched, names: [s.name] });
    }
  }
  const tab = (key: string, label: string) => (
    <button key={key || 'all'} type="button" onClick={() => { const n = new URLSearchParams(sp); if (key) n.set('area', key); else n.delete('area'); n.delete('store'); setSp(n, { replace: true }); }}
      className={`rounded-full border px-3 py-1 ${area === key ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{label}</button>
  );

  return (
    <div className="space-y-4">
      <SnsNav title="カレンダー" />
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="エリア">
        {tab('', `すべて（${data.areas.reduce((a, x) => a + x.stores, 0)} 店）`)}
        {data.areas.map((a) => tab(a.name, `${a.name}（${a.stores} 店）`))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['all', ...CHANNELS] as const).map((c) => <button key={c} type="button" onClick={() => set('channel', c === 'all' ? null : c)} className={`rounded border px-3 py-1 ${channel === c ? 'bg-slate-700 text-white' : 'bg-white'}`}>{c === 'all' ? 'すべて' : CHANNEL_JA[c]}</button>)}
        <select value={storeCode} onChange={(e) => set('store', e.target.value)} className="rounded border px-2 py-1" aria-label="店舗">
          <option value="">{area || 'すべて'}の全店舗</option>
          {data.stores.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
        {storeCode && <Link to={`/admin/sns/posts?view=calendar&store=${encodeURIComponent(storeCode)}`} className="text-brand underline">この店舗の一覧・下書きの追加</Link>}
        <span className="ml-auto text-xs text-slate-500">{posts.length} 件</span>
      </div>

      {groups.length > 0 && (
        <div className="rounded border bg-white px-3 py-2 text-sm">
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500"><span className="font-bold text-slate-700">{storeCode ? stores[0]?.name : (area || 'すべてのエリア')}の投稿の曜日・時刻</span>
            {me.session.role === 'hq' && <Link to={`/admin/sns/schedule${area ? `?area=${encodeURIComponent(area)}` : ''}`} className="ml-auto text-brand underline">曜日・時刻を変える</Link>}
          </div>
          <ul className="space-y-0.5">
            {groups.map((g, i) => (
              <li key={i} className="flex flex-wrap gap-x-2"><span className={`rounded px-1.5 text-xs leading-5 ${g.ch === 'ig' ? 'bg-pink-100 text-pink-800' : 'bg-blue-100 text-blue-800'}`}>{CHANNEL_JA[g.ch]}</span><span className="font-bold">{g.sched}</span>
                <span className="text-xs leading-5 text-slate-500">{g.names.length} 店{g.names.length <= 6 ? `（${g.names.join('、')}）` : ''}</span></li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded border bg-white p-3">
        <div className="mb-2 flex items-center gap-2 text-sm">
          <button type="button" onClick={() => set('ym', addMonthsYm(ym, -1))} className="rounded border px-2 py-1">‹ 前月</button>
          <span className="font-bold">{ym.replace('-', '年')}月</span>
          <button type="button" onClick={() => set('ym', addMonthsYm(ym, 1))} className="rounded border px-2 py-1">翌月 ›</button>
          <button type="button" onClick={() => set('ym', null)} className="rounded border px-2 py-1">今月</button>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 gap-1 text-xs">
            {[1, 2, 3, 4, 5, 6, 0].map((w) => <div key={w} className={`px-1 py-1 text-center font-bold ${w === 0 ? 'text-red-700' : w === 6 ? 'text-blue-700' : 'text-slate-600'}`}>{WEEKDAY_JA[w]}</div>)}
            {monthGrid(ym).flat().map((d, i) => {
              const list = d ? byDate.get(d) ?? [] : [];
              const expanded = d !== null && open.has(d);
              return (
                <div key={i} className={`min-h-28 rounded-md border p-1 ${d === null ? 'bg-slate-50' : d === data.today ? 'border-2 border-blue-500 bg-white' : 'bg-white'}`}>
                  {d && <div className="mb-1 flex items-center text-xs"><span className={weekdayOf(d) === 0 ? 'text-red-700' : weekdayOf(d) === 6 ? 'text-blue-700' : 'text-slate-500'}>{Number(d.slice(8))}</span>{list.length > 0 && <span className="ml-auto text-[10px] text-slate-400">{list.length} 件</span>}</div>}
                  {(expanded ? list : list.slice(0, PER_DAY)).map((p) => (
                    <Link key={p.id} to={`/admin/sns/posts/${p.id}`} title={`${p.storeName} ${CHANNEL_JA[p.channel]} ${p.scheduledAt.slice(11)} ${p.title}（${STATUS_JA[p.status]}）`}
                      className={`mb-0.5 flex items-center gap-1 rounded border-l-4 px-1 py-0.5 ${p.channel === 'ig' ? 'border-pink-500' : 'border-blue-500'} ${p.status === 'posted' ? 'bg-slate-100 text-slate-500' : p.status === 'approved' ? 'bg-green-50' : p.status === 'failed' ? 'bg-red-50' : 'bg-amber-50'}`}>
                      <StoreDot code={p.storeCode} className="shrink-0" />
                      <span className="shrink-0 text-[10px] text-slate-500">{p.scheduledAt.slice(11, 16)}</span>
                      <span className="truncate">{storeCode ? p.title : short(p.storeName)}</span>
                    </Link>
                  ))}
                  {d && list.length > PER_DAY && (
                    <button type="button" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(d)) n.delete(d); else n.add(d); return n; })} className="w-full rounded px-1 text-left text-[11px] text-brand underline">
                      {expanded ? 'たたむ' : `ほか ${list.length - PER_DAY} 件`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">左の線：桃＝Instagram、青＝Google。背景：黄＝確認待ち、緑＝承認済み、灰＝投稿済み、赤＝失敗。丸の色は店舗ごと。エリアは「店舗の一括設定」の「エリア分け」で決めます。</p>
      </div>
    </div>
  );
}
