// 予約・来院ログ（WEB予約一覧／キャンセル名簿）
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { formatDateShort, minToHm } from '@/lib/time';
import NextDateInput from '@/components/NextDateInput';
import { useAdmin } from './Layout';

const STATUS_JA: Record<string, string> = { BOOKED: '予約中', CANCELLED: '取消' };
const KIND_JA: Record<string, string> = { NEW: '初診', REVISIT: '再来', RETURN: '通院中' };

interface Filter { tab: 'web' | 'cancel'; from: string; to: string; status: string; q: string }
interface WebRow { id: string; date: string; time: number; bed: number; kind: string; name: string; cardNo: string | null; phone: string; phoneText: string; status: string; createdAtText: string }
interface CancelRow { id: string; date: string; time: number; bed: number; name: string; kind: string; source: string; byCode: string; memo: string | null; nextDate: string | null; createdAtText: string }
interface Resp { filter: Filter; rows: (WebRow | CancelRow)[] }

export default function ReservationsPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const qs = sp.toString();
  const { data, error } = useFetch<Resp>(`/api/admin/reservations?${qs}`);
  const [form, setForm] = useState<{ from: string; to: string; status: string; q: string } | null>(null);
  if (!me.store) return <p>店舗が登録されていません。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const f = data.filter;
  const cur = form ?? { from: f.from, to: f.to, status: f.status, q: f.q };
  const tab = f.tab;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams({ tab, from: cur.from, to: cur.to });
    if (cur.status) p.set('status', cur.status);
    if (cur.q) p.set('q', cur.q);
    setSp(p);
  };
  const exportHref = (format: 'csv' | 'xlsx') => `/api/admin/reservations/export?${qs}&format=${format}`;
  const cancels = tab === 'cancel' ? (data.rows as CancelRow[]) : [];
  const rows = tab === 'web' ? (data.rows as WebRow[]) : [];

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold">予約・来院ログ</h1>
      <div className="mb-3 flex gap-2 text-sm">
        <Link to={`/admin/reservations?from=${f.from}&to=${f.to}`} className={`rounded px-3 py-1 ${tab === 'web' ? 'bg-brand text-white' : 'border bg-white'}`}>WEB予約一覧</Link>
        <Link to={`/admin/reservations?tab=cancel&from=${f.from}&to=${f.to}`} className={`rounded px-3 py-1 ${tab === 'cancel' ? 'bg-brand text-white' : 'border bg-white'}`}>キャンセル名簿</Link>
      </div>
      <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-2 rounded border bg-white p-3 text-sm">
        <label>予約日（from）<input type="date" value={cur.from} onChange={(e) => setForm({ ...cur, from: e.target.value })} className="ml-1 rounded border px-2 py-1" /></label>
        <label>〜（to）<input type="date" value={cur.to} onChange={(e) => setForm({ ...cur, to: e.target.value })} className="ml-1 rounded border px-2 py-1" /></label>
        {tab === 'web' && (
          <label>状態
            <select value={cur.status} onChange={(e) => setForm({ ...cur, status: e.target.value })} className="ml-1 rounded border px-2 py-1">
              <option value="">すべて</option><option value="BOOKED">予約中</option><option value="CANCELLED">取消</option>
            </select>
          </label>
        )}
        <label>氏名で検索<input value={cur.q} onChange={(e) => setForm({ ...cur, q: e.target.value })} placeholder="氏名の一部でも可" className="ml-1 w-40 rounded border px-2 py-1" />
          {tab === 'web' && <span className="ml-1 text-xs text-slate-500">（電話番号・診察券番号でも可）</span>}</label>
        <button type="submit" className="rounded bg-brand px-3 py-1 text-white">絞り込む</button>
        <span className="ml-auto flex items-center gap-2">
          <a href={exportHref('csv')} className="rounded border bg-white px-3 py-1">CSV で保存</a>
          <a href={exportHref('xlsx')} className="rounded border bg-white px-3 py-1">Excel で保存</a>
        </span>
        <span className="w-full text-xs text-slate-500">{data.rows.length} 件（最大 500 件表示）。保存は今の絞り込み条件で行います。個人情報は保持期間（既定 60 日）を過ぎると自動削除されます。</span>
      </form>
      {tab === 'cancel' && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left"><th className="px-2 py-1">予約日時</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">氏名</th><th className="px-2 py-1">区分</th><th className="px-2 py-1">種別</th><th className="px-2 py-1">登録</th><th className="px-2 py-1">次回予約</th><th className="px-2 py-1">メモ</th><th></th></tr></thead>
            <tbody>
              {cancels.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="whitespace-nowrap px-2 py-1">{formatDateShort(c.date)} {minToHm(c.time)}</td>
                  <td className="px-2 py-1">{c.bed}</td>
                  <td className="px-2 py-1">{c.name}</td>
                  <td className="px-2 py-1"><span className={`rounded px-1.5 text-xs ${c.kind === 'ADVANCE' ? 'bg-brand-light text-brand-dark' : 'bg-red-100 text-red-800'}`}>{c.kind === 'ADVANCE' ? '事前連絡' : '無断'}</span></td>
                  <td className="px-2 py-1 text-xs">{c.source === 'WEB' ? 'WEB予約' : '電話・窓口'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs text-slate-500">{c.createdAtText} {c.byCode}</td>
                  <td className="whitespace-nowrap px-2 py-1"><NextDateInput id={c.id} value={c.nextDate} /></td>
                  <td className="px-2 py-1 text-xs">{c.memo ?? ''}</td>
                  <td className="px-2 py-1"><Link to={`/admin/day/${c.date}`} className="text-brand underline">予約表</Link></td>
                </tr>
              ))}
              {cancels.length === 0 && <tr><td colSpan={9} className="px-2 py-4 text-center text-slate-500">該当するキャンセルはありません</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'web' && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="px-2 py-1">受付日時</th><th className="px-2 py-1">予約日時</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">区分</th>
                <th className="px-2 py-1">氏名</th><th className="px-2 py-1">診察券</th><th className="px-2 py-1">電話</th><th className="px-2 py-1">状態</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t ${r.status === 'CANCELLED' ? 'text-slate-400' : ''}`}>
                  <td className="whitespace-nowrap px-2 py-1">{r.createdAtText}</td>
                  <td className="whitespace-nowrap px-2 py-1">{formatDateShort(r.date)} {minToHm(r.time)}</td>
                  <td className="px-2 py-1">{r.bed}</td>
                  <td className="px-2 py-1">{KIND_JA[r.kind] ?? r.kind}</td>
                  <td className="px-2 py-1">{r.name}</td>
                  <td className="px-2 py-1">{r.cardNo ?? ''}</td>
                  <td className="whitespace-nowrap px-2 py-1">{r.phoneText}</td>
                  <td className="px-2 py-1">{STATUS_JA[r.status] ?? r.status}</td>
                  <td className="px-2 py-1"><Link to={`/admin/day/${r.date}`} className="text-brand underline">予約表</Link></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="px-2 py-4 text-center text-slate-500">該当する予約はありません</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
