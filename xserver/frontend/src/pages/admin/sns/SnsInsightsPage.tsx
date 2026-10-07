// 分析：店舗 × 媒体 × 期間の数字（前の期間との比較）、店舗の詳しい内容（日別・投稿ごと・クチコミ・気づき）
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, formatScheduled, num, pct, sendJson, type Post } from '@/lib/sns';
import { addDays, formatDateShort } from '@/lib/time';
import SnsNav from '@/components/SnsNav';
import { StoreDot } from '@/lib/storeColor';
import { useAdmin } from '../Layout';

type Pair = { now: number; prev: number } | { now: number | null; prev: number | null };
interface Row { code: string; name: string; ig: Record<string, Pair>; gbp: Record<string, Pair>; posts: { ig: number; gbp: number }; postStats: { n: number; reach: number; likes: number; saved: number; shares: number } | null; reviews: { n: number; avg: number; noReply: number; recent: number } | null }
interface Review { id: string; reviewer: string; rating: number; comment: string | null; createTime: string | null; replyComment: string | null; replyTime: string | null }
interface Resp { from: string; to: string; days: number; prevFrom: string; today: string; rows: Row[]; detail?: { store: { code: string; name: string }; daily: Record<string, Record<string, number>>; posts: Post[]; reviews: Review[]; findings: string[] } }
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
      <p className="text-xs text-slate-500">数字は毎朝 5 時以降の自動処理で取り込みます（Google の数字は数日遅れて確定します）。％は前の同じ長さの期間との比較。連携していない媒体は 0 または「-」になります。</p>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left text-xs text-slate-600">
              <th className="px-2 py-1">店舗</th><th className="px-2 py-1">投稿 IG/G</th><th className="px-2 py-1">IGフォロワー</th><th className="px-2 py-1">IGリーチ</th><th className="px-2 py-1">IG投稿平均（リーチ/いいね/保存）</th>
              {GBP_COLS.map(([k, l]) => <th key={k} className="px-2 py-1">G {l}</th>)}<th className="px-2 py-1">クチコミ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.code} className={`border-t ${d?.store.code === r.code ? 'bg-yellow-50' : ''}`}>
                <td className="whitespace-nowrap px-2 py-1"><StoreDot code={r.code} className="mr-1" />{r.name}</td>
                <td className="px-2 py-1 tabular-nums">{r.posts.ig} / {r.posts.gbp}</td>
                <td className="px-2 py-1"><Delta p={r.ig.followers} /></td>
                <td className="px-2 py-1"><Delta p={r.ig.reach} /></td>
                <td className="px-2 py-1 text-xs tabular-nums">{r.postStats ? `${num(r.postStats.reach)} / ${num(r.postStats.likes)} / ${num(r.postStats.saved)}（${r.postStats.n}件）` : '-'}</td>
                {GBP_COLS.map(([k]) => <td key={k} className="px-2 py-1"><Delta p={r.gbp[k]} /></td>)}
                <td className="whitespace-nowrap px-2 py-1 text-xs">{r.reviews ? <>{r.reviews.n}件 ★{r.reviews.avg}{r.reviews.noReply > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">未返信 {r.reviews.noReply}</span>}</> : '-'}</td>
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
