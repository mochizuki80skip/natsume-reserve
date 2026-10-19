// カレンダー（本部）：全店舗の投稿予定を月のカレンダーで。エリア分け（例：中部・東部）のタブと店舗で絞り込み、
// 投稿の内容（定型投稿の名前）を見ながら、ドラッグで日付を移動、クリックで日時・内容の変更や承認、日付を押してその日の投稿の追加ができる
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNELS, CHANNEL_JA, STATUS_CLASS, STATUS_JA, addMonthsYm, monthGrid, sendJson, toInputDateTime, type Channel, type Post, type PostStatus, type Topic } from '@/lib/sns';
import { WEEKDAY_JA, addDays, weekdayOf } from '@/lib/time';
import SnsNav from '@/components/SnsNav';
import { StoreDot } from '@/lib/storeColor';
import { useAdmin } from '../Layout';
import SnsPostsPage from './SnsPostsPage';

interface CalPost { id: string; channel: Channel; status: PostStatus; scheduledAt: string; title: string; storeCode: string; storeName: string }
interface CalStore { code: string; name: string; areaGroup: string; igEnabled: boolean; gbpEnabled: boolean; igSchedule: string; gbpSchedule: string }
interface Resp { today: string; areas: { name: string; stores: number }[]; stores: CalStore[]; posts: CalPost[] }

const PER_DAY = 6;
const EDITABLE: PostStatus[] = ['draft', 'approved', 'failed'];
const editable = (p: { status: PostStatus }) => EDITABLE.includes(p.status);
const fmtDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}（${WEEKDAY_JA[weekdayOf(d)]}）`;

/** 店舗名の共通の頭（例：「なつめ接骨院 」）を除いた短い名前。カレンダーのマスで店舗を見分けやすくする */
function shortNamer(names: string[]): (name: string) => string {
  if (names.length < 2) return (n) => n;
  let pre = names[0];
  for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
  if (pre.length < 2) return (n) => n;
  return (n) => n.slice(pre.length).trim() || n;
}

/** 投稿を別の日へ（時刻はそのまま）。結果のメッセージを返す */
async function movePosts(posts: CalPost[], date: string): Promise<string> {
  let n = 0; const errs: string[] = [];
  for (const p of posts.filter(editable)) {
    try { await sendJson(`/api/admin/sns/posts/${p.id}`, 'PUT', { scheduledAt: `${date} ${p.scheduledAt.slice(11, 16)}` }); n++; } catch (e) { errs.push(`${p.storeName}：${(e as Error).message}`); }
  }
  const skipped = posts.length - posts.filter(editable).length;
  return `${n} 件を ${fmtDay(date)} に移動しました${skipped ? `（投稿済みなど ${skipped} 件は動かせません）` : ''}${errs.length ? `。エラー：${errs.slice(0, 3).join(' / ')}` : ''}`;
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
  const show = sp.get('show') === 'store' ? 'store' : 'content';      // マスの表示：内容ごとにまとめる／店舗ごと
  const ym = sp.get('ym') ?? me.today.slice(0, 7);
  const from = `${ym}-01`;
  const to = addDays(addMonthsYm(ym, 1) + '-01', -1);
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/calendar?from=${from}&to=${to}${channel !== 'all' ? `&channel=${channel}` : ''}${area ? `&area=${encodeURIComponent(area)}` : ''}`);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [postId, setPostId] = useState<string | null>(null);             // 右のパネル：投稿 1 件
  const [day, setDay] = useState<{ date: string; key?: string } | null>(null); // 右のパネル：その日（key があればその内容だけ）
  const [dragOver, setDragOver] = useState<string | null>(null);

  if (error) return <div><SnsNav title="カレンダー" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="カレンダー" /><p className="text-sm text-slate-500">読み込み中…</p></div>;

  const stores = storeCode ? data.stores.filter((s) => s.code === storeCode) : data.stores;
  const short = shortNamer(data.stores.map((s) => s.name));
  const posts = storeCode ? data.posts.filter((p) => p.storeCode === storeCode) : data.posts;
  const byId = new Map(posts.map((p) => [p.id, p]));
  const byDate = new Map<string, CalPost[]>();
  for (const p of posts) { const d = p.scheduledAt.slice(0, 10); byDate.set(d, [...(byDate.get(d) ?? []), p]); }
  const keyOf = (p: CalPost) => `${p.channel}|${p.title}`;
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
  const changed = (m: string) => { setMsg(m); reload(); };

  async function drop(date: string, ids: string[]) {
    setDragOver(null);
    const list = ids.map((id) => byId.get(id)).filter((p): p is CalPost => !!p && p.scheduledAt.slice(0, 10) !== date);
    if (list.length === 0) return;
    if (date < data!.today) { setMsg('今日より前の日には移動できません'); return; }
    if (list.length > 1 && !confirm(`${list.length} 件を ${fmtDay(date)} に移動しますか？（時刻はそのまま）`)) return;
    changed(await movePosts(list, date));
  }
  const dragProps = (ids: string[], can: boolean) => can ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'move'; },
  } : {};
  const cardClass = (ch: Channel, st: PostStatus) => `mb-0.5 flex w-full items-center gap-1 rounded border-l-4 px-1 py-0.5 text-left ${ch === 'ig' ? 'border-pink-500' : 'border-blue-500'} ${st === 'posted' ? 'bg-slate-100 text-slate-500' : st === 'approved' ? 'bg-green-50' : st === 'failed' ? 'bg-red-50' : 'bg-amber-50'}`;

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
        <span className="mx-1 text-slate-300">|</span>
        <span className="text-xs text-slate-500">マスの表示</span>
        <button type="button" onClick={() => set('show', null)} className={`rounded border px-2 py-1 ${show === 'content' ? 'bg-slate-700 text-white' : 'bg-white'}`}>内容ごと</button>
        <button type="button" onClick={() => set('show', 'store')} className={`rounded border px-2 py-1 ${show === 'store' ? 'bg-slate-700 text-white' : 'bg-white'}`}>店舗ごと</button>
        <span className="ml-auto text-xs text-slate-500">{posts.length} 件</span>
      </div>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}

      {groups.length > 0 && (
        <div className="rounded border bg-white px-3 py-2 text-sm">
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500"><span className="font-bold text-slate-700">{storeCode ? stores[0]?.name : (area || 'すべてのエリア')}の投稿の曜日・時刻</span>
            <Link to={`/admin/sns/schedule${area ? `?area=${encodeURIComponent(area)}` : ''}`} className="ml-auto text-brand underline">曜日・時刻を変える</Link>
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
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => set('ym', addMonthsYm(ym, -1))} className="rounded border px-2 py-1">‹ 前月</button>
          <span className="font-bold">{ym.replace('-', '年')}月</span>
          <button type="button" onClick={() => set('ym', addMonthsYm(ym, 1))} className="rounded border px-2 py-1">翌月 ›</button>
          <button type="button" onClick={() => set('ym', null)} className="rounded border px-2 py-1">今月</button>
          <span className="ml-auto text-xs text-slate-500">投稿をドラッグして別の日へ移動できます。日付を押すと、その日の投稿の一覧・まとめて移動・追加ができます。</span>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 gap-1 text-xs">
            {[1, 2, 3, 4, 5, 6, 0].map((w) => <div key={w} className={`px-1 py-1 text-center font-bold ${w === 0 ? 'text-red-700' : w === 6 ? 'text-blue-700' : 'text-slate-600'}`}>{WEEKDAY_JA[w]}</div>)}
            {monthGrid(ym).flat().map((d, i) => {
              const list = d ? byDate.get(d) ?? [] : [];
              // 内容ごと：同じ媒体・同じ名前の投稿を 1 つにまとめる（例：スポーツの秋のケガ ×6 店）
              const bundles: { key: string; posts: CalPost[] }[] = [];
              if (show === 'content') for (const p of list) { const k = keyOf(p); const b = bundles.find((x) => x.key === k); if (b) b.posts.push(p); else bundles.push({ key: k, posts: [p] }); }
              const items = show === 'content' ? bundles.length : list.length;
              const expanded = d !== null && open.has(d);
              return (
                <div key={i} data-date={d ?? undefined}
                  onDragOver={d ? (e) => { e.preventDefault(); if (dragOver !== d) setDragOver(d); } : undefined}
                  onDragLeave={d ? () => setDragOver((x) => (x === d ? null : x)) : undefined}
                  onDrop={d ? (e) => { e.preventDefault(); try { void drop(d, JSON.parse(e.dataTransfer.getData('text/plain'))); } catch { /* 投稿以外のドロップは無視 */ } } : undefined}
                  className={`min-h-28 rounded-md border p-1 ${d === null ? 'bg-slate-50' : dragOver === d ? 'border-2 border-dashed border-brand bg-brand-light' : d === data.today ? 'border-2 border-blue-500 bg-white' : 'bg-white'}`}>
                  {d && (
                    <div className="mb-1 flex items-center text-xs">
                      <button type="button" onClick={() => { setPostId(null); setDay({ date: d }); }} title="この日の投稿の一覧・移動・追加" className={`rounded px-1 hover:bg-slate-100 ${weekdayOf(d) === 0 ? 'text-red-700' : weekdayOf(d) === 6 ? 'text-blue-700' : 'text-slate-500'}`}>{Number(d.slice(8))}</button>
                      {list.length > 0 && <span className="ml-auto text-[10px] text-slate-400">{list.length} 件</span>}
                    </div>
                  )}
                  {show === 'content'
                    ? (expanded ? bundles : bundles.slice(0, PER_DAY)).map((b) => {
                      const p0 = b.posts[0];
                      const ids = b.posts.map((p) => p.id);
                      const st = b.posts.every((p) => p.status === 'posted') ? 'posted' : b.posts.some((p) => p.status === 'failed') ? 'failed' : b.posts.every((p) => p.status === 'approved') ? 'approved' : 'draft';
                      return (
                        <button key={b.key} type="button" {...dragProps(ids, b.posts.some(editable))}
                          onClick={() => { if (b.posts.length === 1) { setDay(null); setPostId(p0.id); } else { setPostId(null); setDay({ date: d!, key: b.key }); } }}
                          title={`${CHANNEL_JA[p0.channel]} ${p0.title}（${b.posts.length} 店：${b.posts.map((p) => short(p.storeName)).join('、')}）`}
                          className={cardClass(p0.channel, st)}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-bold">{p0.title || '（名前なし）'}</span>
                            <span className="block truncate text-[10px] text-slate-500">{b.posts.length === 1 ? `${p0.scheduledAt.slice(11, 16)} ${short(p0.storeName)}` : `${b.posts.length} 店`}</span>
                          </span>
                        </button>
                      );
                    })
                    : (expanded ? list : list.slice(0, PER_DAY)).map((p) => (
                      <button key={p.id} type="button" {...dragProps([p.id], editable(p))} onClick={() => { setDay(null); setPostId(p.id); }}
                        title={`${p.storeName} ${CHANNEL_JA[p.channel]} ${p.scheduledAt.slice(11)} ${p.title}（${STATUS_JA[p.status]}）`} className={cardClass(p.channel, p.status)}>
                        <StoreDot code={p.storeCode} className="shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate"><span className="text-[10px] text-slate-500">{p.scheduledAt.slice(11, 16)}</span> {storeCode ? '' : short(p.storeName)}</span>
                          <span className="block truncate text-[10px] text-slate-600">{p.title}</span>
                        </span>
                      </button>
                    ))}
                  {d && items > PER_DAY && (
                    <button type="button" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(d)) n.delete(d); else n.add(d); return n; })} className="w-full rounded px-1 text-left text-[11px] text-brand underline">
                      {expanded ? 'たたむ' : `ほか ${items - PER_DAY} 件`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">左の線：桃＝Instagram、青＝Google。背景：黄＝確認待ち、緑＝承認済み、灰＝投稿済み、赤＝失敗。「内容ごと」は同じ定型投稿を使う店舗を 1 つにまとめて表示します（ドラッグするとまとめて移動）。</p>
      </div>

      {postId && <PostPanel id={postId} today={data.today} short={short} onClose={() => setPostId(null)} onChanged={changed} />}
      {day && (
        <DayPanel date={day.date} today={data.today} short={short}
          posts={(byDate.get(day.date) ?? []).filter((p) => !day.key || keyOf(p) === day.key)} all={!day.key}
          stores={stores} channel={channel} area={storeCode ? '' : area}
          onOpenPost={(id) => { setDay(null); setPostId(id); }} onClose={() => setDay(null)} onChanged={changed} />
      )}
    </div>
  );
}

/** 右から出るパネルの枠 */
function Drawer({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside role="dialog" aria-label="投稿の設定" onClick={(e) => e.stopPropagation()} className="h-full w-full max-w-md overflow-y-auto bg-white p-4 text-sm shadow-xl">
        <div className="mb-3 flex items-start gap-2"><div className="flex-1 font-bold">{title}</div><button type="button" onClick={onClose} className="rounded border px-2 py-0.5" aria-label="閉じる">×</button></div>
        {children}
      </aside>
    </div>
  );
}

/** 定型投稿の候補を、その日に合うもの（曜日・月）から並べる */
function sortTopics(topics: Topic[], ch: Channel, date: string, shared: boolean): Topic[] {
  const wd = String(weekdayOf(date)); const m = String(Number(date.slice(5, 7)));
  const fit = (t: Topic) => (t.weekdays ? (t.weekdays.split(',').includes(wd) ? 0 : 2) : 1) + (t.months ? (t.months.split(',').includes(m) ? 0 : 2) : 1);
  return topics.filter((t) => t.active && (t.channel === 'both' || t.channel === ch) && (!shared || t.shared)).sort((a, b) => fit(a) - fit(b) || a.sortOrder - b.sortOrder);
}
const topicLabel = (t: Topic) => `${t.shared ? '' : '［店舗］'}${t.title || t.body.slice(0, 20)}${t.areas ? `〔${t.areas}〕` : ''}`;

/** 投稿 1 件：日時・定型投稿（内容）の変更、承認、削除 */
function PostPanel({ id, today, short, onClose, onChanged }: { id: string; today: string; short: (n: string) => string; onClose: () => void; onChanged: (m: string) => void }) {
  const { data, error, reload } = useFetch<{ post: Post }>(`/api/admin/sns/posts/${id}`);
  const p = data?.post;
  const { data: tdata } = useFetch<{ topics: Topic[] }>(p ? `/api/admin/sns/topics?store=${encodeURIComponent(p.storeCode ?? '')}` : null);
  const [at, setAt] = useState('');
  const [topicId, setTopicId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (p) setAt(toInputDateTime(p.scheduledAt)); }, [p]);
  const topics = useMemo(() => (p && tdata ? sortTopics(tdata.topics, p.channel, p.scheduledAt.slice(0, 10), false) : []), [p, tdata]);
  async function run(f: () => Promise<unknown>, m: string, close = false) {
    setBusy(true); setErr('');
    try { await f(); onChanged(m); if (close) onClose(); else reload(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  if (error) return <Drawer title="投稿" onClose={onClose}><p className="text-red-700">{error.message}</p></Drawer>;
  if (!p) return <Drawer title="投稿" onClose={onClose}><p className="text-slate-500">読み込み中…</p></Drawer>;
  const can = editable(p);
  return (
    <Drawer onClose={onClose} title={<><StoreDot code={p.storeCode} className="mr-1" />{short(p.storeName ?? '')}　<span className={`rounded px-1.5 text-xs ${p.channel === 'ig' ? 'bg-pink-100 text-pink-800' : 'bg-blue-100 text-blue-800'}`}>{CHANNEL_JA[p.channel]}</span> <span className={`rounded px-1.5 text-xs ${STATUS_CLASS[p.status]}`}>{STATUS_JA[p.status]}</span></>}>
      {err && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-red-800">{err}</p>}
      <section className="space-y-1 border-b pb-3">
        <div className="text-xs font-bold text-slate-600">日時</div>
        <div className="flex items-center gap-2">
          <input type="datetime-local" value={at} disabled={!can} min={`${today}T00:00`} onChange={(e) => setAt(e.target.value)} className="rounded border px-2 py-1" aria-label="予定日時" />
          <button type="button" disabled={!can || busy || at === toInputDateTime(p.scheduledAt)} onClick={() => run(() => sendJson(`/api/admin/sns/posts/${p.id}`, 'PUT', { scheduledAt: at.replace('T', ' ') }), `${short(p.storeName ?? '')}の投稿を ${at.replace('T', ' ')} に移動しました`)} className="rounded bg-brand px-3 py-1 text-white disabled:opacity-40">日時を変える</button>
        </div>
      </section>
      <section className="space-y-1 border-b py-3">
        <div className="text-xs font-bold text-slate-600">内容（定型投稿）</div>
        <div className="font-bold">{p.title || '（名前なし）'}</div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={topicId} disabled={!can} onChange={(e) => setTopicId(e.target.value)} className="min-w-0 flex-1 rounded border px-2 py-1" aria-label="定型投稿を選ぶ">
            <option value="">定型投稿を選ぶ（{topics.length} 件。この日に合うものが上）</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{topicLabel(t)}</option>)}
          </select>
          <button type="button" disabled={!can || busy || !topicId} onClick={() => run(() => sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'retopic', topicId }), `${short(p.storeName ?? '')}の内容を変えました`)} className="rounded bg-brand px-3 py-1 text-white disabled:opacity-40">この内容にする</button>
          <button type="button" disabled={!can || busy} onClick={() => run(() => sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'retopic' }), `${short(p.storeName ?? '')}の内容を別の定型投稿にしました`)} className="rounded border px-2 py-1 disabled:opacity-40">おまかせで替える</button>
        </div>
      </section>
      <section className="space-y-1 border-b py-3">
        <div className="text-xs font-bold text-slate-600">投稿文</div>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{p.fullText}</div>
        {p.unfilled.length > 0 && <p className="text-xs text-red-700">未入力：{p.unfilled.join(' ')}</p>}
        {p.compliance.hits.length > 0 && <p className="text-xs text-red-700">要確認：{p.compliance.hits.join('、')}</p>}
      </section>
      <div className="flex flex-wrap items-center gap-2 pt-3">
        {(p.status === 'draft' || p.status === 'failed') && <button type="button" disabled={busy} onClick={() => run(() => sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'approve' }), '承認しました')} className="rounded bg-green-700 px-3 py-1 font-bold text-white disabled:opacity-40">承認</button>}
        {p.status === 'approved' && <button type="button" disabled={busy} onClick={() => run(() => sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'unapprove' }), '承認を取り消しました')} className="rounded border px-3 py-1 disabled:opacity-40">承認を取り消す</button>}
        <Link to={`/admin/sns/posts/${p.id}`} className="rounded border px-3 py-1">本文・画像を直す</Link>
        {can && <button type="button" disabled={busy} onClick={() => confirm('この投稿を削除しますか？') && run(() => sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'delete' }), '削除しました', true)} className="ml-auto rounded border px-3 py-1 text-red-700 disabled:opacity-40">削除</button>}
      </div>
    </Drawer>
  );
}

/** その日（または、その日の同じ内容）の投稿：一覧、まとめて移動・承認・内容の変更、投稿の追加 */
function DayPanel({ date, today, short, posts, all, stores, channel, area, onOpenPost, onClose, onChanged }: {
  date: string; today: string; short: (n: string) => string; posts: CalPost[]; all: boolean; stores: CalStore[]; channel: Channel | 'all'; area: string;
  onOpenPost: (id: string) => void; onClose: () => void; onChanged: (m: string) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(posts.filter(editable).map((p) => p.id)));
  const [to, setTo] = useState(date < today ? today : date);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const chosen = posts.filter((p) => sel.has(p.id));
  const { data: tdata } = useFetch<{ topics: Topic[] }>('/api/admin/sns/topics');
  const [topicId, setTopicId] = useState('');
  // 追加：媒体・時刻・定型投稿・店舗
  const [add, setAdd] = useState({ channel: (channel === 'all' ? 'gbp' : channel) as Channel, time: '10:00', topicId: '' });
  const enabledFor = (s: CalStore, ch: Channel) => (ch === 'ig' ? s.igEnabled : s.gbpEnabled);
  const [addStores, setAddStores] = useState<Set<string>>(() => new Set(stores.filter((s) => enabledFor(s, add.channel)).map((s) => s.code)));
  useEffect(() => { setAddStores(new Set(stores.filter((s) => enabledFor(s, add.channel)).map((s) => s.code))); }, [add.channel, stores]);
  const chOfSel = [...new Set(chosen.map((p) => p.channel))];
  const retopicChoices = useMemo(() => (tdata && chOfSel.length === 1 ? sortTopics(tdata.topics, chOfSel[0], date, true) : []), [tdata, chOfSel.join(), date]);
  const addChoices = useMemo(() => (tdata ? sortTopics(tdata.topics, add.channel, date, true) : []), [tdata, add.channel, date]);

  async function each(action: (p: CalPost) => Promise<unknown>, label: string) {
    setBusy(true); setErr('');
    let n = 0; const errs: string[] = [];
    for (const p of chosen) { try { await action(p); n++; } catch (e) { errs.push(`${short(p.storeName)}：${(e as Error).message}`); } }
    setBusy(false);
    onChanged(`${n} 件を${label}${errs.length ? `。できなかったもの：${errs.slice(0, 3).join(' / ')}` : ''}`);
    if (errs.length) setErr(errs.join(' / ')); else onClose();
  }
  async function addPosts() {
    if (!add.topicId || addStores.size === 0) return;
    setBusy(true); setErr('');
    try {
      const r = await sendJson<{ created: number; skipped: string[]; unfilled: string[] }>(`/api/admin/hq/sns/topics/${add.topicId}/broadcast`, 'POST', { channel: add.channel, scheduledAt: `${date} ${add.time}`, stores: [...addStores] });
      onChanged(`${fmtDay(date)} ${add.time} に ${r.created} 店舗分の下書きを作りました${r.skipped.length ? `（作らなかった店舗：${r.skipped.join('、')}）` : ''}`);
      onClose();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <Drawer onClose={onClose} title={<>{fmtDay(date)}{area && <span className="ml-1 text-xs font-normal text-slate-500">〔{area}〕</span>}{!all && posts[0] && <div className="mt-0.5 text-xs font-normal text-slate-600">{CHANNEL_JA[posts[0].channel]}：{posts[0].title}</div>}</>}>
      {err && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-red-800">{err}</p>}
      {posts.length > 0 && (
        <section className="space-y-2 border-b pb-3">
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={chosen.length > 0 && chosen.length === posts.filter(editable).length} onChange={(e) => setSel(new Set(e.target.checked ? posts.filter(editable).map((p) => p.id) : []))} />すべて選ぶ</label>
            <span className="ml-auto text-slate-500">{chosen.length} / {posts.length} 件を選択</span>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {posts.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <input type="checkbox" disabled={!editable(p)} checked={sel.has(p.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.id); else n.delete(p.id); setSel(n); }} aria-label={`${p.storeName} を選ぶ`} />
                <button type="button" onClick={() => onOpenPost(p.id)} className="flex min-w-0 flex-1 items-center gap-1 text-left hover:underline">
                  <StoreDot code={p.storeCode} className="shrink-0" /><span className="shrink-0 text-xs text-slate-500">{p.scheduledAt.slice(11, 16)}</span>
                  <span className="shrink-0">{short(p.storeName)}</span><span className="truncate text-xs text-slate-600">{all ? p.title : ''}</span>
                </button>
                <span className={`shrink-0 rounded px-1 text-[10px] ${p.channel === 'ig' ? 'bg-pink-100 text-pink-800' : 'bg-blue-100 text-blue-800'}`}>{p.channel === 'ig' ? 'IG' : 'G'}</span>
                <span className={`shrink-0 rounded px-1 text-[10px] ${STATUS_CLASS[p.status]}`}>{STATUS_JA[p.status]}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={to} min={today} onChange={(e) => setTo(e.target.value)} className="rounded border px-2 py-1" aria-label="移動先の日" />
            <button type="button" disabled={busy || chosen.length === 0 || to === date || !to} onClick={async () => { setBusy(true); const m = await movePosts(chosen, to); setBusy(false); onChanged(m); onClose(); }} className="rounded bg-brand px-3 py-1 text-white disabled:opacity-40">選んだ {chosen.length} 件をこの日に移動</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={topicId} disabled={retopicChoices.length === 0} onChange={(e) => setTopicId(e.target.value)} className="min-w-0 flex-1 rounded border px-2 py-1" aria-label="まとめて変える定型投稿">
              <option value="">{chOfSel.length > 1 ? '内容を変えるときは媒体をそろえて選んでください' : '選んだ投稿の内容を、この定型投稿にそろえる'}</option>
              {retopicChoices.map((t) => <option key={t.id} value={t.id}>{topicLabel(t)}</option>)}
            </select>
            <button type="button" disabled={busy || !topicId || chosen.length === 0} onClick={() => each((p) => sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'retopic', topicId }), '同じ内容にしました')} className="rounded border px-3 py-1 disabled:opacity-40">内容を変える</button>
          </div>
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => each((p) => p.status === 'approved' ? Promise.resolve() : sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'approve' }), '承認しました')} className="rounded bg-green-700 px-3 py-1 text-white disabled:opacity-40">選んだ {chosen.length} 件を承認</button>
        </section>
      )}
      {all && (
        <section className="space-y-2 pt-3">
          <div className="font-bold">＋ この日に投稿を追加{area && `（${area}）`}</div>
          {date < today ? <p className="text-xs text-slate-500">今日より前の日には追加できません。</p> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select value={add.channel} onChange={(e) => setAdd({ ...add, channel: e.target.value as Channel, topicId: '' })} className="rounded border px-2 py-1" aria-label="追加する媒体">{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_JA[c]}</option>)}</select>
                <input type="time" value={add.time} onChange={(e) => setAdd({ ...add, time: e.target.value })} className="rounded border px-2 py-1" aria-label="追加する時刻" />
              </div>
              <select value={add.topicId} onChange={(e) => setAdd({ ...add, topicId: e.target.value })} className="w-full rounded border px-2 py-1" aria-label="追加する定型投稿">
                <option value="">定型投稿を選ぶ（全店共通 {addChoices.length} 件。この日に合うものが上）</option>
                {addChoices.map((t) => <option key={t.id} value={t.id}>{topicLabel(t)}</option>)}
              </select>
              <div className="text-xs text-slate-600">店舗（{addStores.size} 店）
                <button type="button" onClick={() => setAddStores(new Set(stores.filter((s) => enabledFor(s, add.channel)).map((s) => s.code)))} className="ml-2 text-brand underline">すべて</button>
                <button type="button" onClick={() => setAddStores(new Set())} className="ml-2 text-brand underline">外す</button>
              </div>
              <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto">
                {stores.map((s) => (
                  <label key={s.code} className={`flex items-center gap-1 text-xs ${enabledFor(s, add.channel) ? '' : 'text-slate-400'}`} title={enabledFor(s, add.channel) ? '' : `${CHANNEL_JA[add.channel]} に投稿しない設定の店舗`}>
                    <input type="checkbox" disabled={!enabledFor(s, add.channel)} checked={addStores.has(s.code)} onChange={(e) => { const n = new Set(addStores); if (e.target.checked) n.add(s.code); else n.delete(s.code); setAddStores(n); }} />
                    <StoreDot code={s.code} />{short(s.name)}
                  </label>
                ))}
              </div>
              <button type="button" disabled={busy || !add.topicId || addStores.size === 0} onClick={addPosts} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{addStores.size} 店舗に下書きを作る</button>
              <p className="text-xs text-slate-500">対象エリアの決まった定型投稿は、そのエリアの店舗にだけ作られます。作った下書きは、承認すると投稿されます。</p>
            </>
          )}
        </section>
      )}
    </Drawer>
  );
}
