// 本部：自賠請求の店舗別・全社の速報合計（提出状況・経理確認の進み具合・過去 12 か月の推移・氏名の保持期間）
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { addMonths, formatDateTime, formatYm, yen } from '@/lib/jibai';
import { useAdmin } from './Layout';

interface Row { code: string; name: string; status: 'NONE' | 'DRAFT' | 'SUBMITTED'; submittedAt: string | null; submittedBy: string | null; count: number; total: number; ocrCount: number; verifiedCount: number; verifiedTotal: number }
interface Resp {
  ym: string; currentYm: string; rows: Row[]; sum: { count: number; total: number; verifiedCount: number; verifiedTotal: number; submitted: number }; storeCount: number;
  trend: { ym: string; count: number; total: number; verifiedTotal: number }[]; setting: { nameRetentionDays: number };
}

export default function JibaiHqPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const ymParam = sp.get('ym') ?? '';
  const { data, error, reload } = useFetch<Resp>(me.session.role === 'hq' ? `/api/admin/hq/jibai?ym=${encodeURIComponent(ymParam)}` : null);
  const [days, setDays] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  if (me.session.role !== 'hq') return <Navigate to="/admin" replace />;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const { ym, rows, sum } = data;
  const go = (m: string) => navigate(`/admin/hq/jibai?ym=${m}`);
  const num = 'px-2 py-1 text-right tabular-nums';
  const statusBadge = (r: Row) => r.status === 'SUBMITTED'
    ? <span className="rounded bg-green-100 px-1.5 text-xs text-green-800">提出済み</span>
    : r.status === 'DRAFT' || r.count > 0 ? <span className="rounded bg-yellow-100 px-1.5 text-xs text-yellow-800">入力中</span>
    : <span className="rounded bg-slate-200 px-1.5 text-xs text-slate-600">未提出</span>;

  async function saveDays(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/admin/hq/jibai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nameRetentionDays: Number(days) }) });
    setMsg(r.ok ? '保存しました' : (await r.json()).error ?? '保存に失敗しました');
    if (r.ok) { setDays(null); reload(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h1 className="mr-2 text-xl font-bold">自賠請求 全店集計（速報）</h1>
        <button type="button" onClick={() => go(addMonths(ym, -1))} className="rounded border bg-white px-3 py-1">‹ 前月</button>
        <select value={ym} onChange={(e) => go(e.target.value)} className="rounded border px-2 py-1">
          {Array.from(new Set([ym, ...Array.from({ length: 24 }, (_, i) => addMonths(data.currentYm, -i)), ...data.trend.map((t) => t.ym)])).sort().reverse().map((m) => <option key={m} value={m}>{formatYm(m)}</option>)}
        </select>
        <button type="button" onClick={() => go(addMonths(ym, 1))} className="rounded border bg-white px-3 py-1">翌月 ›</button>
        <button type="button" onClick={() => go(data.currentYm)} className="rounded border bg-white px-3 py-1">今月</button>
        <span className="ml-auto text-xs text-slate-500">{data.storeCount} 店舗（停止中の店舗は除く）</span>
      </div>

      <div className="flex flex-wrap items-center gap-6 rounded border bg-white px-4 py-3">
        <div><span className="text-xs text-slate-500">{formatYm(ym)} 全社速報合計</span><div className="text-2xl font-bold tabular-nums text-brand-dark">{yen(sum.total)}</div></div>
        <div><span className="text-xs text-slate-500">件数</span><div className="text-xl font-bold tabular-nums">{sum.count} 件</div></div>
        <div><span className="text-xs text-slate-500">提出済み店舗</span><div className="text-xl font-bold tabular-nums">{sum.submitted} / {data.storeCount}</div></div>
        <div><span className="text-xs text-slate-500">経理確認済み</span><div className="text-xl font-bold tabular-nums">{sum.verifiedCount} 件 / {yen(sum.verifiedTotal)}</div></div>
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left text-xs text-slate-600">
              <th className="px-2 py-1">店舗</th>
              <th className="px-2 py-1">状態</th>
              <th className={num}>件数</th>
              <th className={num}>速報合計</th>
              <th className={num}>経理確認</th>
              <th className={num}>確定合計</th>
              <th className={num}>差額</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t">
                <td className="whitespace-nowrap px-2 py-1"><span className="mr-1 font-mono text-xs text-slate-500">{r.code}</span>{r.name}</td>
                <td className="whitespace-nowrap px-2 py-1">{statusBadge(r)}{r.submittedAt && <span className="ml-1 text-xs text-slate-500">{formatDateTime(r.submittedAt)}</span>}</td>
                <td className={num}>{r.count}</td>
                <td className={`${num} font-bold`}>{r.count > 0 ? r.total.toLocaleString('ja-JP') : ''}</td>
                <td className={num}>{r.count > 0 ? `${r.verifiedCount} / ${r.count}` : ''}</td>
                <td className={num}>{r.verifiedCount > 0 ? r.verifiedTotal.toLocaleString('ja-JP') : ''}</td>
                <td className={`${num} ${r.verifiedCount > 0 && r.verifiedCount === r.count && r.verifiedTotal !== r.total ? 'text-amber-700' : 'text-slate-500'}`}>{r.verifiedCount > 0 && r.verifiedCount === r.count ? (r.verifiedTotal - r.total).toLocaleString('ja-JP') : ''}</td>
                <td className="whitespace-nowrap px-2 py-1">
                  <form action="/api/admin/switch" method="post" className="inline">
                    <input type="hidden" name="store" value={r.code} /><input type="hidden" name="back" value={`/admin/jibai?ym=${ym}`} />
                    <button className="text-brand underline">明細・経理確認</button>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-500">稼働中の店舗がありません</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-slate-50 font-bold">
                <td className="px-2 py-1" colSpan={2}>合計（{rows.length} 店舗）</td>
                <td className={num}>{sum.count}</td>
                <td className={num}>{sum.total.toLocaleString('ja-JP')}</td>
                <td className={num}>{sum.verifiedCount} / {sum.count}</td>
                <td className={num}>{sum.verifiedCount > 0 ? sum.verifiedTotal.toLocaleString('ja-JP') : ''}</td>
                <td className={num}></td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-slate-500">速報合計は店舗がスクショから登録した金額の合計（提出前の入力中の分も含む）。確定合計は経理が請求書コピーと照合して登録した金額。差額は全件の経理確認が終わった店舗だけ表示します。「明細・経理確認」を押すとその店舗に切り替えて明細を開きます。</p>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded border bg-white p-4">
          <h2 className="mb-2 font-bold">過去 12 か月の全社合計</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="px-2 py-1">月</th><th className={num}>件数</th><th className={num}>速報合計</th><th className={num}>確定合計</th></tr></thead>
            <tbody>
              {data.trend.map((t) => (
                <tr key={t.ym} className="border-t">
                  <td className="px-2 py-1"><button type="button" onClick={() => go(t.ym)} className="text-brand underline">{formatYm(t.ym)}</button></td>
                  <td className={num}>{t.count}</td>
                  <td className={`${num} font-bold`}>{t.total.toLocaleString('ja-JP')}</td>
                  <td className={num}>{t.verifiedTotal > 0 ? t.verifiedTotal.toLocaleString('ja-JP') : ''}</td>
                </tr>
              ))}
              {data.trend.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-500">まだデータがありません</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="rounded border bg-white p-4">
          <h2 className="mb-2 font-bold">氏名の保持期間</h2>
          <form onSubmit={saveDays} className="flex flex-wrap items-center gap-2 text-sm">
            <span>対象月の翌月 1 日から</span>
            <input type="number" min={7} max={3650} value={days ?? String(data.setting.nameRetentionDays)} onChange={(e) => setDays(e.target.value)} className="w-24 rounded border px-2 py-1 text-right" />
            <span>日を過ぎたら氏名を自動で消す</span>
            <button type="submit" className="rounded bg-brand px-3 py-1 text-white">保存</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">患者番号・金額・確認結果は残り、氏名だけが消えます。毎日の自動削除（Cron）で実行されます。経理の照合が終わるまでの期間より長めにしてください。</p>
          {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1 text-sm">{msg}</p>}
        </section>
      </div>
    </div>
  );
}
