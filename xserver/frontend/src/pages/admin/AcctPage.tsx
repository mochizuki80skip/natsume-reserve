// 窓口集計・売上 /admin/acct?month=YYYY-MM&view=mine|area|all（経理・本部・管轄MG＝全店。管轄MG は「管轄店舗」も）
// 上に売上サマリー（売上・目標・達成率・前月比など）、下に店舗ごとの表。経理確認・売上目標・Excel
import { Link, useSearchParams } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { useFetch } from '@/lib/api';
import { halfNum } from '@/lib/format';
import { useAdmin } from './Layout';

interface Row {
  code: string; name: string; area: string; mine: boolean; target: number | null; sales: number; prevSales: number; total: number; goods: number; goodsSales: number; insClaim: number; jibaiClaim: number; jibaiSokuhou: number;
  mismatchDays: number; henreiCount: number; henreiTotal: number; checkedAt: string | null; checkedBy: string; editedAfterCheck: boolean; entered: number; canTarget?: boolean;
}
interface Resp { month: string; areas: string[]; rows: Row[]; canCheck: boolean; canTarget: boolean }
type View = 'mine' | 'area' | 'all';

const yen = (n: number | null) => (n === null ? '' : n.toLocaleString('ja-JP'));
const shiftYm = (ym: string, d: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + d, 1)).toISOString().slice(0, 7);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const NUMS = ['target', 'sales', 'prevSales', 'total', 'goods', 'insClaim', 'jibaiClaim', 'jibaiSokuhou', 'mismatchDays', 'henreiCount', 'henreiTotal'] as const;
type Sum = Record<(typeof NUMS)[number], number>;
const sumOf = (rows: Row[]): Sum => Object.fromEntries(NUMS.map((k) => [k, rows.reduce((a, r) => a + ((r[k] as number | null) ?? 0), 0)])) as Sum;

async function put(url: string, body: object) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? '保存できませんでした');
}

/** 達成率の横棒（100% の線つき） */
function RateBar({ label, sales, target }: { label: string; sales: number; target: number }) {
  const p = pct(sales, target);
  const w = p === null ? 0 : Math.min(p, 130) / 1.3;
  return (
    <div className="grid grid-cols-[8rem_1fr_7rem] items-center gap-2 text-xs">
      <span className="truncate">{label}</span>
      <div className="relative h-3 rounded bg-slate-200">
        <div className={`h-3 rounded ${p === null ? '' : p >= 100 ? 'bg-green-600' : p >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${w}%` }} />
        <div className="absolute inset-y-[-2px] w-px bg-slate-700" style={{ left: `${100 / 1.3}%` }} title="目標（100%）" />
      </div>
      <span className="text-right tabular-nums">{p === null ? '目標なし' : `${p}%`}<span className="ml-1 text-slate-500">{yen(sales)}</span></span>
    </div>
  );
}

export default function AcctPage() {
  const { me } = useAdmin();
  const isMg = me.session.role === 'mg';
  const [sp, setSp] = useSearchParams();
  const { data, error, reload } = useFetch<Resp>(`/api/admin/acct/madoguchi?month=${encodeURIComponent(sp.get('month') ?? '')}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const view: View = (sp.get('view') as View) || (isMg ? 'mine' : 'all');
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const ym = data.month;
  const setQ = (p: Record<string, string>) => { const n = new URLSearchParams(sp); Object.entries(p).forEach(([k, v]) => n.set(k, v)); setSp(n); };
  const run = async (fn: () => Promise<void>, done: string) => { try { await fn(); setMsg({ ok: true, text: done }); reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  const rows = view === 'mine' ? data.rows.filter((r) => r.mine) : data.rows;
  const s = sumOf(rows);
  const num = 'px-2 py-1 text-right tabular-nums';
  // エリアごと（エリアの設定の順。どのエリアにも入っていない店舗は「エリア未設定」）
  const groups = [...data.areas, ''].map((a) => ({ name: a || 'エリア未設定', rows: rows.filter((r) => r.area === a) })).filter((g) => g.rows.length);
  const checked = rows.filter((r) => r.checkedAt && !r.editedAfterCheck).length;

  const Card = ({ l, v, sub, c = '' }: { l: string; v: ReactNode; sub?: ReactNode; c?: string }) => (
    <div className="rounded border bg-white px-3 py-1.5"><div className="text-[11px] text-slate-500">{l}</div><div className={`text-lg font-bold tabular-nums ${c}`}>{v}</div>{sub && <div className="text-[11px] text-slate-500">{sub}</div>}</div>
  );
  const rate = pct(s.sales, s.target);
  const mom = pct(s.sales, s.prevSales);

  const StoreRow = ({ r }: { r: Row }) => (
    <tr className="border-t">
      <td className="whitespace-nowrap px-2 py-1 pl-4">{r.name}{isMg && r.mine && <span className="ml-1 rounded bg-brand-light px-1 text-[10px] text-brand-dark">管轄</span>}</td>
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
        {r.canTarget
          ? <input key={String(r.target)} defaultValue={r.target ?? ''} inputMode="numeric" aria-label={`${r.name} の売上目標`}
            onBlur={(e) => { const v = halfNum(e.target.value).replace(/[,\s]/g, ''); if (v !== String(r.target ?? '')) void run(() => put('/api/admin/acct/madoguchi/target', { store: r.code, month: ym, target: v === '' ? null : Number(v) }), `${r.name} の売上目標を保存しました`); }}
            className="w-28 rounded border px-1 text-right" />
          : yen(r.target)}
      </td>
      <td className={`${num} font-bold`}>{yen(r.sales)}</td>
      <td className={num}>{r.target ? `${pct(r.sales, r.target)}%` : '－'}</td>
      <td className={num}>{r.prevSales ? `${pct(r.sales, r.prevSales)}%` : '－'}</td>
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
  );
  const SumRow = ({ label, list, strong }: { label: string; list: Row[]; strong?: boolean }) => {
    const t = sumOf(list);
    return (
      <tr className={`border-t ${strong ? 'border-t-2 bg-slate-100 font-bold' : 'bg-sky-50 font-bold'}`}>
        <td className="px-2 py-1" colSpan={2}>{label}（{list.length} 店舗）</td><td className={num}>{yen(t.target)}</td><td className={num}>{yen(t.sales)}</td>
        <td className={num}>{t.target ? `${pct(t.sales, t.target)}%` : '－'}</td><td className={num}>{t.prevSales ? `${pct(t.sales, t.prevSales)}%` : '－'}</td><td className={num}>{yen(t.total)}</td><td className={num}>{yen(t.goods)}</td><td className={num}>{yen(t.insClaim)}</td>
        <td className={num}>{yen(t.jibaiClaim)}<span className="text-xs font-normal text-slate-500">／{yen(t.jibaiSokuhou)}</span></td><td className={num}>{t.mismatchDays}</td><td className={num}>{t.henreiCount}件 {yen(t.henreiTotal)}</td><td colSpan={2} />
      </tr>
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-lg font-bold">窓口集計・売上</h1>
        <button type="button" onClick={() => setQ({ month: shiftYm(ym, -1) })} className="rounded border bg-white px-2 py-0.5 text-sm">‹ 前月</button>
        <b className="text-sm">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b>
        <button type="button" onClick={() => setQ({ month: shiftYm(ym, 1) })} className="rounded border bg-white px-2 py-0.5 text-sm">翌月 ›</button>
        <span className="inline-flex overflow-hidden rounded border text-sm" role="group" aria-label="表示の単位">
          {([...(isMg ? [['mine', `管轄店舗（${me.session.area}）`]] : []), ['area', 'エリア別'], ['all', '全体']] as [View, string][]).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setQ({ view: v })} className={`px-3 py-0.5 ${view === v ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{l}</button>
          ))}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">経理確認 {checked} / {rows.length} 店舗</span>
        <a href={`/api/admin/acct/madoguchi/export?month=${ym}`} className="ml-auto rounded border bg-white px-3 py-0.5 text-sm no-underline">全店の一覧を Excel で保存</a>
      </div>
      {msg && <p className={`mb-2 rounded px-3 py-1 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

      <section className="mb-3 rounded-lg border bg-slate-50 p-3" aria-label="売上サマリー">
        <h2 className="mb-2 text-sm font-bold">売上サマリー（{view === 'mine' ? `管轄店舗・${me.session.area}` : view === 'area' ? 'エリア別' : '全体'}）</h2>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Card l="売上" v={yen(s.sales)} sub="窓口＋保険＋自賠責" />
          <Card l="売上目標" v={s.target ? yen(s.target) : '－'} />
          <Card l="達成率" v={rate === null ? '－' : `${rate}%`} c={rate === null ? '' : rate >= 100 ? 'text-green-700' : rate >= 80 ? 'text-amber-700' : 'text-red-700'} />
          <Card l="前月比" v={mom === null ? '－' : `${mom}%`} sub={`前月 ${yen(s.prevSales)}`} />
          <Card l="窓口合計" v={yen(s.total)} />
          <Card l="保険請求" v={yen(s.insClaim)} />
          <Card l="自賠責（日々／速報）" v={yen(s.jibaiClaim)} sub={`速報 ${yen(s.jibaiSokuhou)}`} />
          <Card l="物販" v={yen(s.goods)} />
        </div>
        <div className="grid gap-1">
          {(view === 'mine' ? rows.map((r) => ({ label: r.name, list: [r] })) : groups.map((g) => ({ label: g.name, list: g.rows }))).map((b) => {
            const t = sumOf(b.list);
            return <RateBar key={b.label} label={b.label} sales={t.sales} target={t.target} />;
          })}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">棒＝{view === 'mine' ? '店舗' : 'エリア'}ごとの達成率（縦の線が目標の 100%。緑＝100% 以上、黄＝80% 以上、赤＝80% 未満）。</p>
      </section>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm" aria-label="窓口集計の一覧">
          <thead className="bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left">店舗</th><th className="px-2 py-1 text-left">経理確認</th><th className="px-2 py-1 text-right">売上目標</th><th className="px-2 py-1 text-right">売上</th><th className="px-2 py-1 text-right">達成率</th><th className="px-2 py-1 text-right">前月比</th>
              <th className="px-2 py-1 text-right">窓口合計</th><th className="px-2 py-1 text-right">物販</th><th className="px-2 py-1 text-right">保険請求</th><th className="px-2 py-1 text-right">自賠責（日々／速報）</th>
              <th className="px-2 py-1 text-right">合わない日</th><th className="px-2 py-1 text-right">返戻</th><th className="px-2 py-1 text-right">入力した日</th><th />
            </tr>
          </thead>
          <tbody>
            {view === 'area'
              ? groups.map((g) => [<SumRow key={`s${g.name}`} label={g.name} list={g.rows} />, ...g.rows.map((r) => <StoreRow key={r.code} r={r} />)])
              : rows.map((r) => <StoreRow key={r.code} r={r} />)}
            {rows.length === 0 && <tr><td colSpan={14} className="px-2 py-4 text-center text-slate-500">店舗がありません</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><SumRow label={view === 'mine' ? '管轄店舗の合計' : '合計'} list={rows} strong /></tfoot>}
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">売上＝窓口合計＋保険請求＋自賠責請求（日々の入力）。前月比＝前月の売上と比べた割合。自賠責の「速報」は自賠請求に登録した金額です。「開く」でその店舗の窓口表・物販内訳・返戻を見られます（見るだけ）。{data.canTarget && (isMg ? '売上目標は管轄の店舗だけ入れられます。' : '売上目標は本部が店舗ごと・月ごとに入れます。')}</p>
    </div>
  );
}
