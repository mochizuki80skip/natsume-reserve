// 本部メニュー・MG メニューの「📈 マーケ」 /admin/marke?tab=daily|trig|urls
// ① 店舗ごとの入件（日ごと：新規・再来・新自・新三・来院数）と広告費の配分
// ② きっかけ別（店舗ごと：月・年度・期間）
// ③ URL・QR の月別（年度）
// 全体・エリア（管轄）・店舗で見られる。管轄MG ははじめは自分のエリア
import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { useAdmin } from './Layout';

interface StoreLite { code: string; name: string; area: string; canEdit: boolean }
interface Area { name: string; stores: string[] }
interface Base { stores: StoreLite[]; areas: Area[]; mine: string[] | null }
interface DailyResp extends Base { month: string; kind: string; dates: string[]; counts: Record<string, Record<string, number>>; lastYear: Record<string, number>; budget: Record<string, number> }
interface TrigResp extends Base { period: string; from: string; to: string; month?: string; fy?: number; triggers: string[]; counts: Record<string, Record<string, number>>; details: Record<string, Record<string, Record<string, number>>> }
interface UrlRow { id: string; label: string; trig: string; detail: string; months: Record<string, { res: number; resNew: number; came: number; cameNew: number }> }
interface UrlResp extends Base { fy: number; months: string[]; triggers: string[]; urls: UrlRow[] }

type Scope = { kind: 'all' } | { kind: 'area'; name: string } | { kind: 'store'; code: string };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const shiftYm = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1)).toISOString().slice(0, 7);
const fyOf = (d: string) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
const heat = (n: number, max: number) => (!n || !max ? '' : n / max >= 0.66 ? 'bg-teal-500 font-bold text-white' : n / max >= 0.33 ? 'bg-teal-300' : 'bg-teal-100');

function inScope(stores: StoreLite[], sc: Scope) {
  return stores.filter((s) => sc.kind === 'all' || (sc.kind === 'area' ? s.area === sc.name : s.code === sc.code));
}

function ScopePick({ base, sc, set }: { base: Base; sc: Scope; set: (s: Scope) => void }) {
  const v = sc.kind === 'all' ? 'all' : sc.kind === 'area' ? `a:${sc.name}` : `s:${sc.code}`;
  return (
    <select aria-label="見る範囲" value={v} onChange={(e) => { const x = e.target.value; set(x === 'all' ? { kind: 'all' } : x.startsWith('a:') ? { kind: 'area', name: x.slice(2) } : { kind: 'store', code: x.slice(2) }); }} className="rounded border px-2 py-1">
      <option value="all">全体（全店）</option>
      <optgroup label="エリア（管轄）">{base.areas.map((a) => <option key={a.name} value={`a:${a.name}`}>{a.name}</option>)}</optgroup>
      <optgroup label="店舗">{base.stores.map((s) => <option key={s.code} value={`s:${s.code}`}>{s.name}</option>)}</optgroup>
    </select>
  );
}

export default function MarketingPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const tab = (['daily', 'trig', 'urls'] as const).find((t) => t === sp.get('tab')) ?? 'daily';
  const [sc, setSc] = useState<Scope | null>(null);
  if (me.session.role !== 'hq' && me.session.role !== 'mg') return <Navigate to="/admin" replace />;
  const today = me.today ?? new Date().toISOString().slice(0, 10);
  const tabs = [['daily', '① 店舗ごとの入件（日ごと）'], ['trig', '② きっかけ別（店舗ごと）'], ['urls', '③ URL・QR の月別']] as const;
  return (
    <div className="space-y-3 text-sm">
      <h1 className="text-xl font-bold">📈 マーケ</h1>
      <div className="inline-flex overflow-hidden rounded border" role="tablist">
        {tabs.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setSp({ tab: t })} className={`border-r px-3 py-1 last:border-r-0 ${tab === t ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{l}</button>)}
      </div>
      {tab === 'daily' && <Daily today={today} sc={sc} setSc={setSc} />}
      {tab === 'trig' && <Trig today={today} sc={sc} setSc={setSc} />}
      {tab === 'urls' && <Urls today={today} sc={sc} setSc={setSc} />}
    </div>
  );
}

/** 管轄MG は、はじめは自分のエリア */
function useDefaultScope(base: Base | null, sc: Scope | null, setSc: (s: Scope) => void) {
  useEffect(() => {
    if (!base || sc) return;
    if (base.mine?.length) {
      const a = base.areas.find((x) => base.mine!.every((c) => x.stores.includes(c)));
      setSc(a ? { kind: 'area', name: a.name } : { kind: 'all' });
    } else setSc({ kind: 'all' });
  }, [base, sc, setSc]);
}

const KINDS = [['NEW', '新規（新患）'], ['REVISIT', '再来'], ['ACCIDENT', '新自'], ['THIRD', '新三'], ['VISIT', '来院数']] as const;

function Daily({ today, sc, setSc }: { today: string; sc: Scope | null; setSc: (s: Scope) => void }) {
  const [ym, setYm] = useState(today.slice(0, 7));
  const [kind, setKind] = useState<string>('NEW');
  const { data, error, reload } = useFetch<DailyResp>(`/api/admin/marke/daily?month=${ym}&kind=${kind}`);
  useDefaultScope(data, sc, setSc);
  const [msg, setMsg] = useState('');
  if (error) return <p className="text-red-700">{error.message}</p>;
  if (!data || !sc) return <p className="text-slate-500">読み込み中…</p>;
  const stores = inScope(data.stores, sc);
  const cnt = (code: string, d: string) => data.counts[code]?.[d] ?? 0;
  const total = (code: string) => data.dates.reduce((a, d) => a + cnt(code, d), 0);
  const dayTotal = (d: string) => stores.reduce((a, s) => a + cnt(s.code, d), 0);
  const all = stores.reduce((a, s) => a + total(s.code), 0);
  const lyAll = stores.reduce((a, s) => a + (data.lastYear[s.code] ?? 0), 0);
  const openDays = (code: string) => data.dates.filter((d) => cnt(code, d) > 0).length;
  const diff = (n: number, l: number) => (l === 0 && n === 0 ? null : <span className={`ml-0.5 text-[10px] ${n >= l ? 'text-green-700' : 'text-red-700'}`}>{n >= l ? '+' : '−'}{Math.abs(n - l)}</span>);
  const saveBudget = async (code: string, v: string) => {
    const r = await fetch('/api/admin/marke/budget', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: ym, store: code, amount: v.trim() === '' ? null : Number(v) }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? '広告費の配分を保存しました' : (j as { error?: string }).error ?? '保存できませんでした');
    if (r.ok) reload();
  };
  // 全体を見ているときは、エリアごとの合計も出す
  const areaSums = sc.kind === 'all' ? data.areas.map((a) => ({ name: a.name, n: stores.filter((s) => s.area === a.name).reduce((x, s) => x + total(s.code), 0), ly: stores.filter((s) => s.area === a.name).reduce((x, s) => x + (data.lastYear[s.code] ?? 0), 0) })) : [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setYm(shiftYm(ym, -1))} className="rounded border bg-white px-2 py-0.5">‹ 前月</button>
        <b className="tabular-nums">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b>
        <button type="button" onClick={() => setYm(shiftYm(ym, 1))} className="rounded border bg-white px-2 py-0.5">翌月 ›</button>
        <span className="inline-flex overflow-hidden rounded border" role="group" aria-label="数えるもの">
          {KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`border-r px-2 py-0.5 last:border-r-0 ${kind === k ? 'bg-teal-700 font-bold text-white' : 'bg-white'}`}>{l}</button>)}
        </span>
        <ScopePick base={data} sc={sc} set={setSc} />
      </div>
      {msg && <p className="rounded bg-brand-light px-3 py-1">{msg}</p>}
      {areaSums.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="エリアごとの合計">
          {areaSums.map((a) => <span key={a.name} className="rounded border bg-white px-2 py-0.5">{a.name} <b>{a.n}</b>{diff(a.n, a.ly)}</span>)}
          <span className="rounded border border-teal-600 bg-teal-50 px-2 py-0.5 font-bold">全体 {all}{diff(all, lyAll)}</span>
        </div>
      )}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse text-[12px]" aria-label="店舗ごとの入件">
          <thead className="bg-slate-100 text-[11px]">
            <tr><th className="sticky left-0 z-10 border bg-slate-100 px-1 py-0.5">日付</th>{stores.map((s) => <th key={s.code} className="border px-1 py-0.5 leading-tight">{s.name}</th>)}<th className="border px-1 py-0.5">合計</th></tr>
          </thead>
          <tbody>
            <tr className="bg-teal-50 font-bold"><td className="sticky left-0 z-10 border bg-teal-50 px-1">月の合計</td>{stores.map((s) => <td key={s.code} className="border px-1 text-right tabular-nums">{total(s.code)}</td>)}<td className="border px-1 text-right tabular-nums" aria-label="月の合計（全体）">{all}</td></tr>
            <tr className="text-slate-600"><td className="sticky left-0 z-10 border bg-white px-1">前年同月</td>{stores.map((s) => <td key={s.code} className="border px-1 text-right tabular-nums">{data.lastYear[s.code] ?? 0}{diff(total(s.code), data.lastYear[s.code] ?? 0)}</td>)}<td className="border px-1 text-right tabular-nums">{lyAll}{diff(all, lyAll)}</td></tr>
            {kind === 'VISIT' && <tr className="text-slate-600"><td className="sticky left-0 z-10 border bg-white px-1">1日平均</td>{stores.map((s) => <td key={s.code} className="border px-1 text-right tabular-nums">{openDays(s.code) ? (total(s.code) / openDays(s.code)).toFixed(1) : '－'}</td>)}<td /></tr>}
            {kind === 'NEW' && (
              <tr className="bg-amber-50"><td className="sticky left-0 z-10 border bg-amber-50 px-1" title="広告費の分配計画（店舗ごと・月ごと）。本部は全店、管轄MG は管轄の店舗を入れられます">広告費の配分</td>
                {stores.map((s) => <td key={s.code + ym + (data.budget[s.code] ?? '')} className="border p-0">
                  {s.canEdit
                    ? <input defaultValue={data.budget[s.code] ?? ''} inputMode="decimal" aria-label={`${s.name} の広告費の配分`} onBlur={(e) => { const v = e.target.value; if (v !== String(data.budget[s.code] ?? '')) void saveBudget(s.code, v); }} className="w-12 bg-transparent px-1 text-right outline-none focus:bg-white" />
                    : <span className="block px-1 text-right">{data.budget[s.code] ?? ''}</span>}
                </td>)}
                <td className="border px-1 text-right tabular-nums">{stores.reduce((a, s) => a + (data.budget[s.code] ?? 0), 0) || ''}</td></tr>
            )}
            {data.dates.map((d) => {
              const w = new Date(`${d}T00:00:00`).getDay();
              const t = dayTotal(d);
              return (
                <tr key={d} className={t === 0 ? 'text-slate-300' : ''}>
                  <td className={`sticky left-0 z-10 whitespace-nowrap border bg-white px-1 ${w === 0 ? 'text-red-600' : w === 6 ? 'text-blue-600' : ''}`}>{md(d)}（{WD[w]}）</td>
                  {stores.map((s) => <td key={s.code} className="border px-1 text-right tabular-nums">{cnt(s.code, d) || ''}</td>)}
                  <td className="border px-1 text-right font-bold tabular-nums">{t || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">新規＝新患（新自・新三は別）。新規・再来・新自・新三は新患継続率（来院チェックした初診・初自・新三・再）から、来院数は予約表の来院チェックから数えます。広告費の配分は店舗ごと・月ごとに入れます（本部は全店、管轄MG は管轄の店舗）。</p>
    </>
  );
}

function Trig({ today, sc, setSc }: { today: string; sc: Scope | null; setSc: (s: Scope) => void }) {
  const [period, setPeriod] = useState<'month' | 'fy' | 'range'>('month');
  const [ym, setYm] = useState(today.slice(0, 7));
  const [fy, setFy] = useState(fyOf(today));
  const [range, setRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [inj, setInj] = useState(false);
  const [openTrig, setOpenTrig] = useState<string | null>(null);
  const q = period === 'month' ? `month=${ym}` : period === 'fy' ? `fy=${fy}` : `from=${range.from}&to=${range.to}`;
  const { data, error } = useFetch<TrigResp>(`/api/admin/marke/trig?period=${period}&${q}${inj ? '&withInjury=1' : ''}`);
  useDefaultScope(data, sc, setSc);
  if (error) return <p className="text-red-700">{error.message}</p>;
  if (!data || !sc) return <p className="text-slate-500">読み込み中…</p>;
  const stores = inScope(data.stores, sc);
  const c = (code: string, t: string) => data.counts[code]?.[t] ?? 0;
  const rowSum = (codes: string[], t: string) => codes.reduce((a, x) => a + c(x, t), 0);
  const trigs = data.triggers.filter((t) => stores.some((s) => c(s.code, t) > 0));
  const totalOf = (codes: string[]) => trigs.reduce((a, t) => a + rowSum(codes, t), 0);
  const groups = sc.kind === 'store' ? [{ name: '', list: stores }] : [...new Set(stores.map((s) => s.area))].map((a) => ({ name: a, list: stores.filter((s) => s.area === a) }));
  const allCodes = stores.map((s) => s.code);
  const all = totalOf(allCodes);
  const Row = ({ label, codes, strong }: { label: string; codes: string[]; strong?: boolean }) => {
    const n = totalOf(codes);
    const max = Math.max(0, ...trigs.map((t) => rowSum(codes, t)));
    return (
      <tr className={strong ? 'bg-slate-100 font-bold' : ''}>
        <td className="sticky left-0 z-10 whitespace-nowrap border bg-inherit px-1 text-left">{label}</td>
        <td className="border px-1 text-right font-bold tabular-nums">{n}</td>
        {trigs.map((t) => { const v = rowSum(codes, t); return <td key={t} className={`border px-1 text-right tabular-nums ${strong ? '' : heat(v, max)}`}>{v || ''}</td>; })}
      </tr>
    );
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex overflow-hidden rounded border" role="group" aria-label="期間の種類">
          {([['month', '月'], ['fy', '年度（4月〜）'], ['range', '期間を選ぶ']] as const).map(([p, l]) => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={`border-r px-2 py-0.5 last:border-r-0 ${period === p ? 'bg-teal-700 font-bold text-white' : 'bg-white'}`}>{l}</button>)}
        </span>
        {period === 'month' && <><button type="button" onClick={() => setYm(shiftYm(ym, -1))} className="rounded border bg-white px-2">‹</button><b className="tabular-nums">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b><button type="button" onClick={() => setYm(shiftYm(ym, 1))} className="rounded border bg-white px-2">›</button></>}
        {period === 'fy' && <><button type="button" onClick={() => setFy(fy - 1)} className="rounded border bg-white px-2">‹</button><b>{fy}年度</b><button type="button" onClick={() => setFy(fy + 1)} className="rounded border bg-white px-2">›</button></>}
        {period === 'range' && <><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="期間の始め" className="rounded border px-1" />〜<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="期間の終わり" className="rounded border px-1" /></>}
        <ScopePick base={data} sc={sc} set={setSc} />
        <label className="text-xs"><input type="checkbox" checked={inj} onChange={(e) => setInj(e.target.checked)} /> 新自・新三も含める</label>
      </div>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse text-[12px]" aria-label="きっかけ別（店舗ごと）">
          <thead className="bg-slate-100 text-[11px]">
            <tr><th className="sticky left-0 z-10 border bg-slate-100 px-1">店舗</th><th className="border px-1">新患計</th>
              {trigs.map((t) => <th key={t} className="border px-1 leading-tight"><button type="button" onClick={() => setOpenTrig(openTrig === t ? null : t)} className="underline decoration-dotted" title="押すと内訳">{t}</button></th>)}</tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentRows key={g.name || 'one'}>
                {g.list.map((s) => <Row key={s.code} label={s.name} codes={[s.code]} />)}
                {sc.kind === 'all' && g.name && <Row label={`${g.name} 計`} codes={g.list.map((s) => s.code)} strong />}
              </FragmentRows>
            ))}
            {stores.length > 1 && <Row label={sc.kind === 'area' ? `${sc.name} 計` : '全体'} codes={allCodes} strong />}
            <tr className="text-slate-600"><td className="sticky left-0 z-10 border bg-white px-1">割合</td><td className="border px-1 text-right">{all ? '100%' : ''}</td>{trigs.map((t) => <td key={t} className="border px-1 text-right tabular-nums">{all ? `${Math.round((rowSum(allCodes, t) / all) * 100)}%` : ''}</td>)}</tr>
          </tbody>
        </table>
      </div>
      {openTrig && (
        <div className="rounded border bg-white p-2" aria-label="きっかけの内訳">
          <b>「{openTrig}」の内訳</b>
          <table className="mt-1 border-collapse text-[12px]">
            <tbody>
              {(() => {
                const m = new Map<string, number>();
                for (const s of stores) for (const [k, v] of Object.entries(data.details[s.code]?.[openTrig] ?? {})) m.set(k, (m.get(k) ?? 0) + v);
                const list = [...m].sort((a, b) => b[1] - a[1]);
                return list.length ? list.map(([k, v]) => <tr key={k}><td className="border px-2">{k}</td><td className="border px-2 text-right tabular-nums">{v}</td></tr>) : <tr><td className="px-2 text-slate-500">内訳の入っている方はいません</td></tr>;
              })()}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">新患継続率のきっかけから数えます（新患。チェックで新自・新三も含めます）。多いところほど色が濃くなります（店舗ごとに見て）。きっかけの名前を押すと内訳が出ます。0 人のきっかけの列は出しません。</p>
    </>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) { return <>{children}</>; }

const URL_METRICS = [['cameNew', '来院した新規'], ['resNew', '新規の WEB 予約'], ['res', 'WEB 予約（全部）'], ['came', '来院（全部）']] as const;

function Urls({ today, sc, setSc }: { today: string; sc: Scope | null; setSc: (s: Scope) => void }) {
  const [fy, setFy] = useState(fyOf(today));
  const [metric, setMetric] = useState<'cameNew' | 'resNew' | 'res' | 'came'>('cameNew');
  const q = !sc || sc.kind === 'all' ? '' : sc.kind === 'area' ? `&area=${encodeURIComponent(sc.name)}` : `&store=${encodeURIComponent(sc.code)}`;
  const { data, error } = useFetch<UrlResp>(`/api/admin/marke/urls?fy=${fy}${q}`);
  useDefaultScope(data, sc, setSc);
  if (error) return <p className="text-red-700">{error.message}</p>;
  if (!data || !sc) return <p className="text-slate-500">読み込み中…</p>;
  const v = (u: UrlRow, m: string) => u.months[m]?.[metric] ?? 0;
  const sum = (u: UrlRow) => data.months.reduce((a, m) => a + v(u, m), 0);
  const order = (t: string) => (t === '' ? 1e9 : data.triggers.indexOf(t) === -1 ? 1e8 : data.triggers.indexOf(t));
  const groups = [...new Set(data.urls.map((u) => u.trig))].sort((a, b) => order(a) - order(b)).map((t) => ({ trig: t, list: data.urls.filter((u) => u.trig === t) }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setFy(fy - 1)} className="rounded border bg-white px-2">‹</button><b>{fy}年度</b><button type="button" onClick={() => setFy(fy + 1)} className="rounded border bg-white px-2">›</button>
        <span className="inline-flex overflow-hidden rounded border" role="group" aria-label="数えるもの（URL）">
          {URL_METRICS.map(([k, l]) => <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)} className={`border-r px-2 py-0.5 last:border-r-0 ${metric === k ? 'bg-teal-700 font-bold text-white' : 'bg-white'}`}>{l}</button>)}
        </span>
        <ScopePick base={data} sc={sc} set={setSc} />
      </div>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse text-[12px]" aria-label="URL・QR の月別">
          <thead className="bg-slate-100 text-[11px]"><tr><th className="border px-1 text-left">きっかけ / URL・QR</th>{data.months.map((m) => <th key={m} className="border px-1">{Number(m.slice(5))}月</th>)}<th className="border px-1">合計</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <FragmentRows key={g.trig || 'blank'}>
                <tr className="bg-slate-100 font-bold"><td className="border px-1">▼ {g.trig || '（空白：店舗が選ぶ）'}</td>{data.months.map((m) => <td key={m} className="border px-1 text-right tabular-nums">{g.list.reduce((a, u) => a + v(u, m), 0) || ''}</td>)}<td className="border px-1 text-right tabular-nums">{g.list.reduce((a, u) => a + sum(u), 0)}</td></tr>
                {g.list.map((u) => (
                  <tr key={u.id}><td className="whitespace-nowrap border px-1 pl-4">{u.label}{u.detail && <span className="ml-1 text-[10.5px] text-slate-500">（{u.detail}）</span>}</td>{data.months.map((m) => <td key={m} className="border px-1 text-right tabular-nums">{v(u, m) || ''}</td>)}<td className="border px-1 text-right font-bold tabular-nums">{sum(u)}</td></tr>
                ))}
              </FragmentRows>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">その URL・QR から入った WEB 予約を、予約日の月で数えます。来院した新規＝新規（はじめて・交通事故）の WEB 予約のうち、予約表で来院チェックが付いたもの。範囲を選ぶと、その店舗（エリア）の予約だけを数えます。</p>
    </>
  );
}
