// 分析：エリア別の合計、店舗 × 媒体 × 期間の数字（前の期間との比較）、メインキーワードの検索回数、
// 店舗の詳しい内容（週ごとの投稿と Google の数字・日別・投稿ごと・クチコミ・気づき）
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, formatScheduled, num, pct, sendJson, type Post } from '@/lib/sns';
import { addDays, formatDateShort } from '@/lib/time';
import SnsNav from '@/components/SnsNav';
import { StoreDot } from '@/lib/storeColor';
import { useAdmin } from '../Layout';

type Pair = { now: number; prev: number } | { now: number | null; prev: number | null };
interface MainKw { word: string; month: string | null; now: number; prev: number | null }
interface AreaRow { name: string; stores: number; posts: { ig: number; gbp: number }; gbp: Record<string, { now: number; prev: number }>; reviews: { n: number; avg: number; noReply: number } | null; mainKw: { now: number; prev: number | null; stores: number } }
interface Weekly { rows: { week: string; postsGbp: number; postsIg: number; hasData: boolean; impressions: number; actions: number; calls: number; directions: number }[]; postedWeeks: number; quietWeeks: number; avgPosted: number | null; avgQuiet: number | null }
interface Row { code: string; name: string; areaGroup?: string; mainKw?: MainKw; ig: Record<string, Pair>; gbp: Record<string, Pair>; posts: { ig: number; gbp: number }; postStats: { n: number; reach: number; likes: number; saved: number; shares: number } | null; reviews: { n: number; avg: number; noReply: number; recent: number } | null; kwTop?: Kw[] }
interface Kw { keyword: string; value: number; threshold: boolean; prev?: number | null }
interface Keywords { month: string | null; prevMonth: string | null; rows: Kw[]; tracked: { word: string; value: number; prev: number | null; count: number }[]; total: number }
interface Review { id: string; reviewer: string; rating: number; comment: string | null; createTime: string | null; replyComment: string | null; replyTime: string | null }
interface Resp { from: string; to: string; days: number; prevFrom: string; today: string; rows: Row[]; areas?: AreaRow[]; detail?: { store: { code: string; name: string }; daily: Record<string, Record<string, number>>; posts: Post[]; reviews: Review[]; keywords?: Keywords; weekly?: Weekly; findings: string[] } }
const ACTIONS = ['calls', 'directions', 'website_clicks', 'bookings', 'conversations'];
const rate = (g: Record<string, { now: number | null; prev: number | null }>, k: 'now' | 'prev') => {
  const imp = (g.impressions_maps?.[k] ?? 0) + (g.impressions_search?.[k] ?? 0);
  return imp >= 100 ? ACTIONS.reduce((a, m) => a + (g[m]?.[k] ?? 0), 0) / imp * 100 : null;
};
function Rate({ g }: { g: Record<string, { now: number | null; prev: number | null }> }) {
  const now = rate(g, 'now'); const prev = rate(g, 'prev');
  if (now === null) return <span className="text-slate-400">-</span>;
  return <span className="tabular-nums">{now.toFixed(1)}%{prev !== null && <span className={`ml-1 text-xs ${now > prev ? 'text-green-700' : now < prev ? 'text-red-700' : 'text-slate-400'}`}>（前 {prev.toFixed(1)}%）</span>}</span>;
}
const GBP_COLS: [string, string][] = [['impressions_maps', 'マップ表示'], ['impressions_search', '検索表示'], ['calls', '電話'], ['website_clicks', 'サイト'], ['directions', 'ルート'], ['bookings', '予約']];

function Delta({ p }: { p: Pair }) {
  if (p.now === null || p.now === undefined) return <span className="text-slate-400">-</span>;
  const d = p.prev === null || p.prev === undefined ? null : pct(p.now, p.prev);
  return <span className="tabular-nums">{num(p.now)}{d !== null && <span className={`ml-1 text-xs ${d > 0 ? 'text-green-700' : d < 0 ? 'text-red-700' : 'text-slate-400'}`}>{d > 0 ? '+' : ''}{d}%</span>}</span>;
}

export default function SnsInsightsPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const isHq = me.session.role === 'hq';
  const days = Number(sp.get('days') ?? 28);
  const detail = sp.get('detail') ?? (isHq ? '' : me.store?.code ?? '');
  const areaF = sp.get('area') ?? '';
  const to = addDays(me.today, 1);
  const from = addDays(to, -days);
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/insights?from=${from}&to=${to}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}${isHq ? '' : '&store=me'}`);
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const [msg, setMsg] = useState('');
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  async function sendReply() {
    if (!reply) return;
    try { await sendJson('/api/admin/sns/reviews/reply', 'POST', { id: reply.id, comment: reply.text }); setMsg('返信しました'); setReply(null); reload(); } catch (e) { setMsg((e as Error).message); }
  }
  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const d = data.detail;
  const dailyDates = d ? Object.keys(d.daily).sort() : [];
  const dailyKeys = d ? Array.from(new Set(dailyDates.flatMap((x) => Object.keys(d.daily[x])))).sort() : [];
  const KEY_JA: Record<string, string> = { 'ig:followers': 'IGフォロワー', 'ig:reach': 'IGリーチ', 'gbp:impressions_maps': 'Gマップ表示', 'gbp:impressions_search': 'G検索表示', 'gbp:calls': 'G電話', 'gbp:website_clicks': 'Gサイト', 'gbp:directions': 'Gルート', 'gbp:conversations': 'Gメッセージ', 'gbp:bookings': 'G予約' };

  return (
    <div className="space-y-4">
      <SnsNav title="分析" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">期間：</span>
        {[7, 28, 90].map((n) => <button key={n} type="button" onClick={() => set('days', String(n))} className={`rounded border px-3 py-1 ${days === n ? 'bg-brand text-white' : 'bg-white'}`}>直近 {n} 日</button>)}
        <span className="text-xs text-slate-500">{formatDateShort(data.from)} 〜 {formatDateShort(addDays(data.to, -1))}（比較：{formatDateShort(data.prevFrom)} 〜 {formatDateShort(addDays(data.from, -1))}）</span>
        {isHq && <a href={`/api/admin/sns/insights/export?from=${from}&to=${to}`} className="ml-auto rounded border bg-white px-3 py-1">CSV で書き出し</a>}
      </div>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <p className="text-xs text-slate-500">数字は毎朝 5 時以降の自動処理で取り込みます（Google の数字は数日遅れて確定し、検索キーワードは月単位で前月分まで）。％は前の同じ長さの期間との比較。連携していない媒体は 0 または「-」になります。</p>

      {isHq && data.areas && data.areas.length > 0 && (
        <section className="overflow-x-auto rounded border bg-white">
          <h3 className="border-b px-3 py-2 font-bold">エリア別（Google）<span className="ml-2 text-xs font-normal text-slate-500">行を押すと、下の店舗の表をそのエリアに絞ります</span></h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="whitespace-nowrap bg-slate-100 text-left text-xs text-slate-600">
                <th className="px-2 py-1">エリア</th><th className="px-2 py-1">店舗</th><th className="px-2 py-1">投稿 G</th>
                {GBP_COLS.map(([k, l]) => <th key={k} className="px-2 py-1">{l}</th>)}<th className="px-2 py-1">行動の割合</th><th className="px-2 py-1">クチコミ</th><th className="px-2 py-1">メインKWを含む検索（月）</th>
              </tr>
            </thead>
            <tbody>
              {data.areas.map((a) => (
                <tr key={a.name} onClick={() => set('area', areaF === a.name ? null : a.name)} className={`cursor-pointer border-t hover:bg-slate-50 ${areaF === a.name ? 'bg-brand-light' : ''}`}>
                  <td className="whitespace-nowrap px-2 py-1 font-bold">{a.name}</td>
                  <td className="px-2 py-1 tabular-nums">{a.stores}</td>
                  <td className="px-2 py-1 tabular-nums">{a.posts.gbp}</td>
                  {GBP_COLS.map(([k]) => <td key={k} className="px-2 py-1"><Delta p={a.gbp[k]} /></td>)}
                  <td className="whitespace-nowrap px-2 py-1 text-xs"><Rate g={a.gbp} /></td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{a.reviews ? <>{a.reviews.n}件 ★{a.reviews.avg}{a.reviews.noReply > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">未返信 {a.reviews.noReply}</span>}</> : '-'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{a.mainKw.stores > 0 ? <Delta p={{ now: a.mainKw.now, prev: a.mainKw.prev }} /> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1 text-xs text-slate-500">行動の割合：表示されたうち、電話・ルート検索・サイト・予約・メッセージにつながった割合（表示 100 回以上のとき）。メインKW：各店舗の「メインキーワード」（例：接骨院）を含む検索で表示された回数の合計。</p>
        </section>
      )}

      <div className="overflow-x-auto rounded border bg-white">
        {areaF && <div className="flex items-center gap-2 border-b px-3 py-1 text-xs"><span>エリア「{areaF}」の店舗だけ表示中</span><button type="button" onClick={() => set('area', null)} className="text-brand underline">すべて表示</button></div>}
        <table className="w-full text-sm">
          <thead>
            <tr className="whitespace-nowrap bg-slate-100 text-left text-xs text-slate-600">
              <th className="px-2 py-1">店舗</th><th className="px-2 py-1">投稿 IG/G</th><th className="px-2 py-1">IGフォロワー</th><th className="px-2 py-1">IGリーチ</th><th className="px-2 py-1">IG投稿平均（リーチ/いいね/保存）</th>
              {GBP_COLS.map(([k, l]) => <th key={k} className="px-2 py-1">G {l}</th>)}<th className="px-2 py-1">クチコミ</th><th className="px-2 py-1">メインKWを含む検索（月）</th><th className="px-2 py-1">G 検索キーワード上位（月）</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.filter((r) => !areaF || r.areaGroup === areaF).map((r) => (
              <tr key={r.code} className={`border-t ${d?.store.code === r.code ? 'bg-yellow-50' : ''}`}>
                <td className="whitespace-nowrap px-2 py-1"><StoreDot code={r.code} className="mr-1" />{r.name}{isHq && r.areaGroup && <div className="text-[10px] text-slate-400">{r.areaGroup}</div>}</td>
                <td className="px-2 py-1 tabular-nums">{r.posts.ig} / {r.posts.gbp}</td>
                <td className="px-2 py-1"><Delta p={r.ig.followers} /></td>
                <td className="px-2 py-1"><Delta p={r.ig.reach} /></td>
                <td className="px-2 py-1 text-xs tabular-nums">{r.postStats ? `${num(r.postStats.reach)} / ${num(r.postStats.likes)} / ${num(r.postStats.saved)}（${r.postStats.n}件）` : '-'}</td>
                {GBP_COLS.map(([k]) => <td key={k} className="px-2 py-1"><Delta p={r.gbp[k]} /></td>)}
                <td className="whitespace-nowrap px-2 py-1 text-xs">{r.reviews ? <>{r.reviews.n}件 ★{r.reviews.avg}{r.reviews.noReply > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">未返信 {r.reviews.noReply}</span>}</> : '-'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-xs">{r.mainKw?.month ? <><span className="text-slate-500">{r.mainKw.word}</span> <Delta p={{ now: r.mainKw.now, prev: r.mainKw.prev }} /></> : '-'}</td>
                <td className="px-2 py-1 text-xs">{r.kwTop && r.kwTop.length > 0 ? r.kwTop.map((k) => <div key={k.keyword} className="whitespace-nowrap">{k.keyword} <span className="tabular-nums text-slate-500">{kwNum(k)}</span></div>) : '-'}</td>
                <td className="px-2 py-1">{isHq && <button type="button" onClick={() => set('detail', r.code)} className="text-brand underline">詳しく</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">{d.store.name} の詳しい内容</h2>
          <section className="rounded border bg-white p-3 text-sm">
            <h3 className="mb-1 font-bold">気づき（数字から機械的に出しています。改善するかは相談して決めてください）</h3>
            {d.findings.length === 0 ? <p className="text-slate-500">まだ十分な数字がありません。</p> : <ul className="ml-5 list-disc space-y-0.5">{d.findings.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          </section>
          {d.weekly && <WeeklySection w={d.weekly} />}
          {d.keywords && <KeywordSection k={d.keywords} />}
          <section className="overflow-x-auto rounded border bg-white">
            <h3 className="border-b px-3 py-2 font-bold">投稿ごとの数字（この期間に投稿したもの）</h3>
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="px-2 py-1">投稿日</th><th className="px-2 py-1">媒体</th><th className="px-2 py-1">見出し</th><th className="px-2 py-1">リーチ</th><th className="px-2 py-1">いいね</th><th className="px-2 py-1">コメント</th><th className="px-2 py-1">保存</th><th className="px-2 py-1">シェア</th><th></th></tr></thead>
              <tbody>
                {d.posts.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="whitespace-nowrap px-2 py-1 tabular-nums">{formatScheduled(p.postedAt ?? p.scheduledAt)}</td>
                    <td className="px-2 py-1 text-xs">{CHANNEL_JA[p.channel]}</td>
                    <td className="px-2 py-1">{p.title || p.body.slice(0, 24)}</td>
                    <td className="px-2 py-1 tabular-nums">{num(p.stat?.reach)}</td><td className="px-2 py-1 tabular-nums">{num(p.stat?.likes)}</td><td className="px-2 py-1 tabular-nums">{num(p.stat?.comments)}</td><td className="px-2 py-1 tabular-nums">{num(p.stat?.saved)}</td><td className="px-2 py-1 tabular-nums">{num(p.stat?.shares)}</td>
                    <td className="px-2 py-1 text-xs">{p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="text-brand underline">開く↗</a>}</td>
                  </tr>
                ))}
                {d.posts.length === 0 && <tr><td colSpan={9} className="px-2 py-3 text-slate-500">この期間に投稿したものはありません</td></tr>}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-slate-500">Google の投稿ごとの数字は API で取れないため、店舗全体の表示回数・電話などで見ます。</p>
          </section>
          <section className="overflow-x-auto rounded border bg-white">
            <h3 className="border-b px-3 py-2 font-bold">Google のクチコミ（最新 50 件）</h3>
            <table className="w-full text-sm">
              <tbody>
                {d.reviews.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-2 py-1 text-xs text-slate-500">{r.createTime?.slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-2 py-1">{'★'.repeat(r.rating)}<span className="text-slate-300">{'★'.repeat(5 - r.rating)}</span><div className="text-xs text-slate-500">{r.reviewer}</div></td>
                    <td className="px-2 py-1"><div className="whitespace-pre-wrap">{r.comment ?? <span className="text-slate-400">（本文なし）</span>}</div>
                      {r.replyComment ? <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs"><span className="font-bold">返信：</span>{r.replyComment}</div>
                        : reply?.id === r.id ? <div className="mt-1 space-y-1"><textarea value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })} rows={3} className="w-full rounded border px-2 py-1 text-xs" /><div className="flex gap-2"><button type="button" onClick={sendReply} className="rounded bg-brand px-2 py-0.5 text-xs text-white">返信を送る</button><button type="button" onClick={() => setReply(null)} className="rounded border px-2 py-0.5 text-xs">取消</button></div></div>
                        : <button type="button" onClick={() => setReply({ id: r.id, text: `${r.reviewer} 様、ご来院とクチコミをありがとうございます。` })} className="mt-1 text-xs text-brand underline">返信する</button>}
                    </td>
                  </tr>
                ))}
                {d.reviews.length === 0 && <tr><td className="px-2 py-3 text-slate-500">クチコミはまだ取り込まれていません（Google 連携後、毎朝取り込みます）</td></tr>}
              </tbody>
            </table>
          </section>
          {dailyDates.length > 0 && (
            <section className="overflow-x-auto rounded border bg-white">
              <h3 className="border-b px-3 py-2 font-bold">日別の数字</h3>
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-100 text-left text-slate-600"><th className="px-2 py-1">日付</th>{dailyKeys.map((k) => <th key={k} className="px-2 py-1">{KEY_JA[k] ?? k}</th>)}</tr></thead>
                <tbody>{dailyDates.map((x) => <tr key={x} className="border-t"><td className="whitespace-nowrap px-2 py-0.5">{formatDateShort(x)}</td>{dailyKeys.map((k) => <td key={k} className="px-2 py-0.5 tabular-nums">{num(d.daily[x][k])}</td>)}</tr>)}</tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** 週ごとの Google への投稿と、表示回数・行動（電話・ルートなど）。投稿した週としなかった週の平均も比べる */
function WeeklySection({ w }: { w: Weekly }) {
  const any = w.rows.some((r) => r.hasData || r.postsGbp > 0);
  return (
    <section className="overflow-x-auto rounded border bg-white">
      <h3 className="border-b px-3 py-2 font-bold">週ごとの投稿と Google の数字（直近 12 週・月曜はじまり）</h3>
      {!any ? <p className="p-3 text-sm text-slate-500">まだ数字がありません。Google と連携して拠点を割り当てると、毎朝取り込みます。</p> : (
        <>
          {w.avgPosted !== null && w.avgQuiet !== null && (
            <p className="border-b px-3 py-2 text-sm">投稿した週（{w.postedWeeks} 週）の表示回数の平均 <b className="tabular-nums">{num(w.avgPosted)}</b>　／　投稿しなかった週（{w.quietWeeks} 週）<b className="tabular-nums">{num(w.avgQuiet)}</b>
              <span className="ml-2 text-xs text-slate-500">季節などの影響もあるため目安です</span></p>
          )}
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="px-2 py-1">週</th><th className="px-2 py-1">Google 投稿</th><th className="px-2 py-1">IG 投稿</th><th className="px-2 py-1">表示回数</th><th className="px-2 py-1">行動（電話・ルートなど）</th><th className="px-2 py-1">電話</th><th className="px-2 py-1">ルート</th></tr></thead>
            <tbody>
              {w.rows.map((r) => (
                <tr key={r.week} className={`border-t ${r.postsGbp > 0 ? '' : 'text-slate-500'}`}>
                  <td className="whitespace-nowrap px-2 py-0.5">{formatDateShort(r.week)}〜</td>
                  <td className="px-2 py-0.5 tabular-nums">{r.postsGbp > 0 ? <b>{r.postsGbp}</b> : 0}</td>
                  <td className="px-2 py-0.5 tabular-nums">{r.postsIg}</td>
                  <td className="px-2 py-0.5 tabular-nums">{r.hasData ? num(r.impressions) : '-'}</td>
                  <td className="px-2 py-0.5 tabular-nums">{r.hasData ? num(r.actions) : '-'}</td>
                  <td className="px-2 py-0.5 tabular-nums">{r.hasData ? num(r.calls) : '-'}</td>
                  <td className="px-2 py-0.5 tabular-nums">{r.hasData ? num(r.directions) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1 text-xs text-slate-500">Google の投稿は「投稿した」を押したものを数えます。Google の数字は数日遅れて確定するため、直近の週は少なめに出ます。</p>
        </>
      )}
    </section>
  );
}

/** 検索キーワードの回数（少ない語は「15 未満」のような上限で返る） */
function kwNum(k: { value: number; threshold: boolean }): string {
  return k.threshold ? `${k.value}未満` : k.value.toLocaleString();
}

/** Google の検索キーワード（月ごと）：設定した語を含む検索の合計と、上位 50 語 */
function KeywordSection({ k }: { k: Keywords }) {
  const ym = (x: string | null) => (x ? `${Number(x.slice(0, 4))}年${Number(x.slice(5, 7))}月` : '');
  if (!k.month) return (
    <section className="rounded border bg-white p-3 text-sm">
      <h3 className="mb-1 font-bold">Google の検索キーワード</h3>
      <p className="text-slate-500">まだ取り込まれていません。本部の「接続状況」で Google と連携し、この店舗に拠点を割り当てると、毎朝前月分までを取り込みます。</p>
    </section>
  );
  const diff = (now: number, prev: number | null | undefined) => prev === null || prev === undefined ? <span className="text-slate-400">-</span> : now === prev ? <span className="text-slate-500">±0</span> : <span className={now > prev ? 'text-green-700' : 'text-red-700'}>{now > prev ? '+' : ''}{(now - prev).toLocaleString()}</span>;
  return (
    <section className="overflow-x-auto rounded border bg-white">
      <h3 className="border-b px-3 py-2 font-bold">Google の検索キーワード（{ym(k.month)}。Google 検索・マップでこの店舗が表示されたときの語）</h3>
      {k.tracked.length > 0 && (
        <div className="border-b p-3">
          <div className="mb-1 text-xs font-bold text-slate-600">設定した語（メインキーワード・エリア・症状）を含む検索の回数{k.prevMonth && `（前月 ${ym(k.prevMonth)} との差）`}</div>
          <div className="flex flex-wrap gap-2">
            {k.tracked.map((t) => (
              <div key={t.word} className={`rounded border px-2 py-1 text-xs ${t.value === 0 ? 'border-amber-200 bg-amber-50' : 'bg-slate-50'}`}>
                <span className="font-bold">{t.word}</span> <span className="tabular-nums">{t.value.toLocaleString()} 回</span>（{t.count} 語） {diff(t.value, t.prev)}
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">回数が 0 の語は、その語でほとんど検索されていません。投稿のキーワードや、Google のサービス・説明文の見直しの目安にしてください。少ない語は「15 未満」のように Google が丸めた数で返るため、合計は目安です。</p>
        </div>
      )}
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="px-2 py-1">順位</th><th className="px-2 py-1">検索キーワード</th><th className="px-2 py-1">回数</th><th className="px-2 py-1">前月との差</th></tr></thead>
        <tbody>
          {k.rows.map((r, i) => (
            <tr key={r.keyword} className="border-t">
              <td className="px-2 py-0.5 tabular-nums text-slate-500">{i + 1}</td>
              <td className="px-2 py-0.5">{r.keyword}</td>
              <td className="px-2 py-0.5 tabular-nums">{kwNum(r)}</td>
              <td className="px-2 py-0.5 tabular-nums">{r.threshold ? <span className="text-slate-400">-</span> : diff(r.value, r.prev)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
