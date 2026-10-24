// 窓口集計の一覧 /admin/acct?month=YYYY-MM（経理・本部＝全店、管轄MG＝管轄エリアの店舗）。経理確認・売上目標（本部）・Excel
import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { halfNum } from '@/lib/format';
import { useAdmin } from './Layout';

interface Row {
  code: string; name: string; target: number | null; sales: number; total: number; goods: number; goodsSales: number; insClaim: number; jibaiClaim: number; jibaiSokuhou: number;
  mismatchDays: number; henreiCount: number; henreiTotal: number; checkedAt: string | null; checkedBy: string; editedAfterCheck: boolean; entered: number;
}
interface Resp { month: string; rows: Row[]; canCheck: boolean; canTarget: boolean }

const yen = (n: number | null) => (n === null ? '' : n.toLocaleString('ja-JP'));
const shiftYm = (ym: string, d: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + d, 1)).toISOString().slice(0, 7);

async function put(url: string, body: object) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? '保存できませんでした');
}

export default function AcctPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const { data, error, reload } = useFetch<Resp>(`/api/admin/acct/madoguchi?month=${encodeURIComponent(sp.get('month') ?? '')}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const ym = data.month;
  const run = async (fn: () => Promise<void>, done: string) => { try { await fn(); setMsg({ ok: true, text: done }); reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  const sum = (k: keyof Row) => data.rows.reduce((a, r) => a + ((r[k] as number) ?? 0), 0);
  const num = 'px-2 py-1 text-right tabular-nums';
  const checked = data.rows.filter((r) => r.checkedAt && !r.editedAfterCheck).length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-lg font-bold">窓口集計（{me.session.role === 'mg' ? me.session.area : '全店'}）</h1>
        <button type="button" onClick={() => setSp({ month: shiftYm(ym, -1) })} className="rounded border bg-white px-2 py-0.5 text-sm">‹ 前月</button>
        <b className="text-sm">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b>
        <button type="button" onClick={() => setSp({ month: shiftYm(ym, 1) })} className="rounded border bg-white px-2 py-0.5 text-sm">翌月 ›</button>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">経理確認 {checked} / {data.rows.length} 店舗</span>
        <a href={`/api/admin/acct/madoguchi/export?month=${ym}`} className="ml-auto rounded border bg-white px-3 py-0.5 text-sm no-underline">一覧を Excel で保存</a>
      </div>
      {msg && <p className={`mb-2 rounded px-3 py-1 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm" aria-label="窓口集計の一覧">
          <thead className="bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left">店舗</th><th className="px-2 py-1 text-left">経理確認</th><th className="px-2 py-1 text-right">売上目標</th><th className="px-2 py-1 text-right">売上</th><th className="px-2 py-1 text-right">達成率</th>
              <th className="px-2 py-1 text-right">窓口合計</th><th className="px-2 py-1 text-right">物販</th><th className="px-2 py-1 text-right">保険請求</th><th className="px-2 py-1 text-right">自賠責（日々／速報）</th>
              <th className="px-2 py-1 text-right">合わない日</th><th className="px-2 py-1 text-right">返戻</th><th className="px-2 py-1 text-right">入力した日</th><th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.code} className="border-t">
                <td className="whitespace-nowrap px-2 py-1">{r.name}</td>
                <td className="whitespace-nowrap px-2 py-1">
                  {r.checkedAt
                    ? <span className={`rounded px-1.5 text-xs font-bold ${r.editedAfterCheck ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`} title={`${r.checkedAt}（${r.checkedBy}）`}>{r.editedAfterCheck ? '確認後に変更あり' : `済 ${r.checkedAt.slice(5, 10).replace('-', '/')}`}</span>
                    : <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">未</span>}
                  {data.canCheck && (
                    <button type="button" onClick={() => run(() => put('/api/admin/acct/madoguchi/check', { store: r.code, month: ym, checked: !r.checkedAt || r.editedAfterCheck }), !r.checkedAt || r.editedAfterCheck ? `${r.name} を経理確認済みにしました` : `${r.name} の経理確認を取り消しました`)}
                      className="ml-1 rounded border px-1.5 text-xs">{!r.checkedAt || r.editedAfterCheck ? '確認済みにする' : '取り消す'}</button>
                  )}
                </td>
                <td className={num}>
                  {data.canTarget
                    ? <input key={String(r.target)} defaultValue={r.target ?? ''} inputMode="numeric" aria-label={`${r.name} の売上目標`}
                      onBlur={(e) => { const v = halfNum(e.target.value).replace(/[,\s]/g, ''); if (v !== String(r.target ?? '')) void run(() => put('/api/admin/acct/madoguchi/target', { store: r.code, month: ym, target: v === '' ? null : Number(v) }), `${r.name} の売上目標を保存しました`); }}
                      className="w-28 rounded border px-1 text-right" />
                    : yen(r.target)}
                </td>
                <td className={`${num} font-bold`}>{yen(r.sales)}</td>
                <td className={num}>{r.target ? `${Math.round((r.sales / r.target) * 100)}%` : '－'}</td>
                <td className={num}>{yen(r.total)}</td>
                <td className={num}>{yen(r.goods)}</td>
                <td className={num}>{yen(r.insClaim)}</td>
                <td className={num}>{yen(r.jibaiClaim)}<span className="text-xs text-slate-500">／{yen(r.jibaiSokuhou)}</span></td>
                <td className={`${num} ${r.mismatchDays ? 'font-bold text-red-700' : 'text-slate-400'}`}>{r.mismatchDays}</td>
                <td className={num}>{r.henreiCount ? `${r.henreiCount}件 ${yen(r.henreiTotal)}` : '0件'}</td>
                <td className={num}>{r.entered}日</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  <Link to={`/admin/madoguchi?store=${encodeURIComponent(r.code)}&month=${ym}`} className="mr-1 rounded border px-2 py-0.5 text-xs no-underline">開く</Link>
                  <a href={`/api/admin/madoguchi/export?store=${encodeURIComponent(r.code)}&month=${ym}`} className="rounded border px-2 py-0.5 text-xs no-underline">Excel</a>
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={13} className="px-2 py-4 text-center text-slate-500">店舗がありません</td></tr>}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot><tr className="border-t-2 bg-slate-50 font-bold">
              <td className="px-2 py-1" colSpan={2}>合計（{data.rows.length} 店舗）</td><td className={num}>{yen(sum('target'))}</td><td className={num}>{yen(sum('sales'))}</td>
              <td className={num}>{sum('target') ? `${Math.round((sum('sales') / sum('target')) * 100)}%` : '－'}</td><td className={num}>{yen(sum('total'))}</td><td className={num}>{yen(sum('goods'))}</td><td className={num}>{yen(sum('insClaim'))}</td>
              <td className={num}>{yen(sum('jibaiClaim'))}<span className="text-xs text-slate-500">／{yen(sum('jibaiSokuhou'))}</span></td><td className={num}>{sum('mismatchDays')}</td><td className={num}>{sum('henreiCount')}件 {yen(sum('henreiTotal'))}</td><td colSpan={2} />
            </tr></tfoot>
          )}
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">売上＝窓口合計＋保険請求＋自賠責請求（日々の入力）。自賠責の「速報」は自賠請求に登録した金額です。「開く」でその店舗の窓口表・物販内訳・返戻を見られます（見るだけ）。{data.canTarget && '売上目標は本部が店舗ごと・月ごとに入れます。'}</p>
    </div>
  );
}
