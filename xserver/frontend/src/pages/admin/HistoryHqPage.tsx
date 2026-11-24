// 本部メニュー・MG メニューの「変更履歴」：全店（管轄MG は管轄の店舗）の予約表の変更を、だれが（店舗・本部・管轄MG のどのアカウントで）・いつ・何をしたか
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { formatDateShort, minToHm } from '@/lib/time';
import { HIST_CLASS } from './ReservationsPage';
import { useAdmin } from './Layout';

interface Row { createdAt: string; createdAtText: string; store: string; who: string; kind: string; kindText: string; date: string; time: number; bed: number; before: string; after: string; note: string }
interface Resp { filter: { from: string; to: string; q: string; basis: 'op' | 'date'; store: string }; stores: { code: string; name: string }[]; rows: Row[] }

export default function HistoryHqPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const qs = sp.toString();
  const { data, error } = useFetch<Resp>(`/api/admin/hq/history?${qs}`);
  const [form, setForm] = useState<Resp['filter'] | null>(null);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const cur = form ?? data.filter;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams({ from: cur.from, to: cur.to });
    if (cur.store) p.set('store', cur.store);
    if (cur.q) p.set('q', cur.q);
    if (cur.basis === 'date') p.set('basis', 'date');
    setSp(p);
  };
  const mg = me.session.role === 'mg';
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">変更履歴（{mg ? '管轄の店舗・店舗を選んで' : '全店'}）</h1>
      <p className="mb-3 text-xs text-slate-600">予約表の入力・書き換え・消した・キャンセル・予約変更（移動）・名簿から戻したことと、WEB 予約の受付を、操作したアカウント（店舗・本部・管轄MG）と一緒に新しい順に出します。</p>
      <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-2 rounded border bg-white p-3 text-sm">
        <label>店舗
          <select aria-label="店舗" value={cur.store} onChange={(e) => setForm({ ...cur, store: e.target.value })} className="ml-1 rounded border px-2 py-1">
            <option value="">{mg ? '管轄の店舗すべて' : 'すべての店舗'}</option>
            {data.stores.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label>日付の見方
          <select aria-label="日付の見方" value={cur.basis} onChange={(e) => setForm({ ...cur, basis: e.target.value as 'op' | 'date' })} className="ml-1 rounded border px-2 py-1">
            <option value="op">操作した日</option><option value="date">予約日</option>
          </select>
        </label>
        <label>{cur.basis === 'date' ? '予約日' : '操作した日'}（from）<input type="date" value={cur.from} onChange={(e) => setForm({ ...cur, from: e.target.value })} className="ml-1 rounded border px-2 py-1" /></label>
        <label>〜（to）<input type="date" value={cur.to} onChange={(e) => setForm({ ...cur, to: e.target.value })} className="ml-1 rounded border px-2 py-1" /></label>
        <label>氏名で検索<input value={cur.q} onChange={(e) => setForm({ ...cur, q: e.target.value })} placeholder="氏名の一部でも可" className="ml-1 w-40 rounded border px-2 py-1" /></label>
        <button type="submit" className="rounded bg-brand px-3 py-1 text-white">絞り込む</button>
        <span className="ml-auto flex items-center gap-2">
          <a href={`/api/admin/hq/history/export?${qs}&format=csv`} className="rounded border bg-white px-3 py-1">CSV で保存</a>
          <a href={`/api/admin/hq/history/export?${qs}&format=xlsx`} className="rounded border bg-white px-3 py-1">Excel で保存</a>
        </span>
        <span className="w-full text-xs text-slate-500">{data.rows.length} 件（最大 500 件表示）。</span>
      </form>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm" aria-label="変更履歴（全店）">
          <thead><tr className="bg-slate-100 text-left"><th className="px-2 py-1">操作日時</th><th className="px-2 py-1">店舗</th><th className="px-2 py-1">アカウント</th><th className="px-2 py-1">操作</th><th className="px-2 py-1">予約日時・ベッド</th><th className="px-2 py-1">変更前</th><th className="px-2 py-1">変更後</th><th className="px-2 py-1">詳細</th></tr></thead>
          <tbody>
            {data.rows.map((h, i) => (
              <tr key={i} className="border-t">
                <td className="whitespace-nowrap px-2 py-1 text-xs">{h.createdAtText}</td>
                <td className="whitespace-nowrap px-2 py-1 text-xs">{h.store}</td>
                <td className="whitespace-nowrap px-2 py-1 text-xs">{h.who}</td>
                <td className="whitespace-nowrap px-2 py-1"><span className={`rounded px-1.5 text-xs ${HIST_CLASS[h.kind] ?? 'bg-slate-100'}`}>{h.kindText}</span></td>
                <td className="whitespace-nowrap px-2 py-1 text-xs">{formatDateShort(h.date)} {minToHm(h.time)}　ベッド{h.bed}</td>
                <td className="px-2 py-1">{h.before}</td>
                <td className="px-2 py-1">{h.after}</td>
                <td className="px-2 py-1 text-xs text-slate-600">{h.note}</td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-500">該当する履歴はありません</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">店舗の予約表を開くときは、上の店舗の切り替えから店舗を選び「<Link to="/admin/reservations?tab=history" className="text-brand underline">予約・来院ログ → 変更履歴</Link>」へ。</p>
    </div>
  );
}
