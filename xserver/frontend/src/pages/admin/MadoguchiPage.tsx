// 窓口集計 /admin/madoguchi?month=YYYY-MM（店舗：月間窓口表・物販内訳・返戻を日ごとに入力。?store= は経理・本部・管轄MG が見るだけで開くとき）
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { halfNum, halfNumInput } from '@/lib/format';
import { useAdmin } from './Layout';

interface Calc { copayTotal: number; selfAcu: number; total: number; match: number; mismatch: boolean; goodsSales: number }
type Vals = Record<string, number | string | Record<string, number> | undefined> & { goodsCount?: Record<string, number>; otherNote?: string };
interface Day { date: string; closed: boolean; vals: Vals; calc: Calc }
interface Goods { id: string; name: string; price: number; cost: number }
interface Henrei { id: string; special: boolean; treatYm: string; claimMonth: string; patient: string; relation: string; insurer: string; insurerCode: string; amount: number | null; reamount: number | null; place: string; action: string; reason: string }
interface Resp {
  month: string; store: { code: string; name: string }; target: number | null; sales: number;
  days: Day[]; sum: Record<string, number>; mismatchDays: number;
  goods: Goods[]; goodsSum: Record<string, number>; stockStart: Record<string, number>;
  extra: Record<string, number>; memo: string; henrei: Henrei[]; jibaiSokuhou: { count: number; total: number };
  checkedAt: string | null; checkedBy: string; editedAfterCheck: boolean; canEdit: boolean; canCheck: boolean; today: string;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const yen = (n: number | null | undefined) => (n === null || n === undefined ? '' : n.toLocaleString('ja-JP'));
const exTax = (n: number) => Math.sign(n) * Math.round(Math.abs(n) / 1.1);
const shiftYm = (ym: string, d: number) => { const t = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + d, 1)); return t.toISOString().slice(0, 7); };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

/** 月間窓口表の列（k＝入力、c＝自動の計算）。g は上の段の見出し */
const COLS: { k?: string; c?: keyof Calc; l: string; g?: string; cls?: string }[] = [
  { k: 'copay', l: '一部負担金' }, { k: 'third', l: '第三者' }, { c: 'copayTotal', l: '一部負担金合計', cls: 'bg-yellow-300' },
  { k: 'self', l: '自費' }, { k: 'acu', l: '鍼' }, { c: 'selfAcu', l: '自費＋鍼', cls: 'bg-orange-300' }, { c: 'total', l: '合計', cls: 'bg-yellow-300 font-bold' },
  { k: 'goods', l: '物販' },
  { k: 'colCopay', l: '一部負担金', g: '未収回収' }, { k: 'colSelf', l: '自費', g: '未収回収' },
  { k: 'diffCopay', l: '一部負担金', g: '差額' }, { k: 'diffSelf', l: '自費', g: '差額' },
  { k: 'unknown', l: '不明金' }, { k: 'deposit', l: '保証金' }, { k: 'cert', l: '証明書代' },
  { c: 'match', l: '合計', g: '金額を一致させてください', cls: 'bg-amber-400 font-bold' }, { k: 'mail', l: '報告メール合計', g: '金額を一致させてください' }, { k: 'bank', l: '通帳入金額', g: '金額を一致させてください' },
  { k: 'insClaim', l: '保険請求金額' }, { k: 'jibaiClaim', l: '自賠責請求金額' },
];
const MONTH_KEYS: [string, string][] = [['lateIns', '保険請求 月遅れ請求'], ['lateJibai', '自賠責 月遅れ請求'], ['rousai', '労災（月末入力）'], ['curClaim', '当月請求（月末入力）']];

async function put(url: string, body: object, method = 'PUT') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? '保存できませんでした');
  return j;
}

/** 金額・個数の入力欄（全角でも半角に。カンマは外す）。空にすると消える */
function Num({ value, onSave, label, readOnly, className = '' }: { value: number | undefined | null; onSave: (v: number | null) => void; label: string; readOnly?: boolean; className?: string }) {
  if (readOnly) return <span className={`block px-1 text-right ${className}`}>{yen(value)}</span>;
  return (
    <input key={String(value ?? '')} defaultValue={value === null || value === undefined ? '' : value.toLocaleString('ja-JP')} aria-label={label} inputMode="numeric"
      onInput={(e) => { if (!(e.nativeEvent as InputEvent).isComposing) halfNumInput(e.currentTarget); }} onCompositionEnd={(e) => halfNumInput(e.currentTarget)}
      onBlur={(e) => {
        const raw = halfNum(e.target.value).replace(/[,\s]/g, '');
        if (raw === String(value ?? '')) { e.target.value = value === null || value === undefined ? '' : value.toLocaleString('ja-JP'); return; }
        if (raw !== '' && !/^-?\d+$/.test(raw)) { e.target.classList.add('bg-red-100'); return; }
        e.target.classList.remove('bg-red-100');
        onSave(raw === '' ? null : Number(raw));
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`w-full min-w-[64px] bg-transparent px-1 text-right outline-none focus:bg-sky-50 ${className}`} />
  );
}

function Txt({ value, onSave, label, readOnly, className = '' }: { value: string; onSave: (v: string) => void; label: string; readOnly?: boolean; className?: string }) {
  if (readOnly) return <span className={`block px-1 ${className}`}>{value}</span>;
  return <input key={value} defaultValue={value} aria-label={label} onBlur={(e) => e.target.value.trim() !== value && onSave(e.target.value.trim())} className={`w-full bg-transparent px-1 outline-none focus:bg-sky-50 ${className}`} />;
}

export default function MadoguchiPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') ?? '';
  const storeParam = sp.get('store') ?? '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/madoguchi?month=${encodeURIComponent(month)}${storeParam ? `&store=${encodeURIComponent(storeParam)}` : ''}`);
  const [tab, setTab] = useState<'main' | 'goods' | 'henrei'>('main');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  // 経理アカウントと、一覧から別の店舗を開いたときは見るだけ
  const ro = !data.canEdit || !!storeParam;
  const ym = data.month;
  const go = (n: number) => { const p = new URLSearchParams(sp); p.set('month', shiftYm(ym, n)); setSp(p); };
  const save = async (fn: () => Promise<unknown>) => {
    try { await fn(); setMsg({ ok: true, text: '保存しました' }); reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const saveDay = (date: string, patch: object) => save(() => put('/api/admin/madoguchi/day', { date, patch }));
  const saveMonth = (patch: object) => save(() => put('/api/admin/madoguchi/month', { month: ym, patch }));
  const check = (checked: boolean) => save(() => put('/api/admin/acct/madoguchi/check', { store: data.store.code, month: ym, checked }));
  const rate = data.target ? Math.round((data.sales / data.target) * 100) : null;

  const Kpi = ({ l, v, c = '' }: { l: string; v: ReactNode; c?: string }) => <div className="rounded border bg-white px-3 py-1.5"><div className="text-[11px] text-slate-500">{l}</div><div className={`text-lg font-bold tabular-nums ${c}`}>{v}</div></div>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-lg font-bold">窓口集計{storeParam && `（${data.store.name}）`}</h1>
        <button type="button" onClick={() => go(-1)} className="rounded border bg-white px-2 py-0.5 text-sm">‹ 前月</button>
        <b className="text-sm">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b>
        <button type="button" onClick={() => go(1)} className="rounded border bg-white px-2 py-0.5 text-sm">翌月 ›</button>
        <span className="inline-flex overflow-hidden rounded border text-sm" role="tablist">
          {([['main', '月間窓口表'], ['goods', '物販内訳'], ['henrei', '返戻']] as const).map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`px-3 py-0.5 ${tab === v ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{l}</button>)}
        </span>
        {data.checkedAt
          ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">経理確認済み {data.checkedAt.slice(5, 16).replace('-', '/')}（{data.checkedBy}）{data.editedAfterCheck && <span className="ml-1 text-amber-700">確認後に変更あり</span>}</span>
          : <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">経理 未確認</span>}
        {data.canCheck && <button type="button" onClick={() => check(!data.checkedAt || data.editedAfterCheck)} className="rounded bg-brand px-3 py-0.5 text-sm font-bold text-white">{!data.checkedAt || data.editedAfterCheck ? '経理確認済みにする' : '経理確認を取り消す'}</button>}
        <span className="ml-auto text-xs text-slate-500">{ro ? '見るだけ（直すときは店舗を切り替えてください）' : '入力すると自動で保存されます'}</span>
        <a href={`/api/admin/madoguchi/export?month=${ym}${storeParam ? `&store=${encodeURIComponent(storeParam)}` : ''}`} className="rounded border bg-white px-2 py-0.5 text-sm no-underline">Excel で保存</a>
        {storeParam && <Link to={`/admin/acct?month=${ym}`} className="text-sm text-brand underline">← 一覧に戻る</Link>}
      </div>
      {msg && <p className={`mb-2 rounded px-3 py-1 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi l="売上目標" v={data.target === null ? '（本部が入力）' : yen(data.target)} />
        <Kpi l="売上（窓口＋保険＋自賠責）" v={yen(data.sales)} />
        <Kpi l="達成率" v={rate === null ? '－' : `${rate}%`} />
        <Kpi l="窓口合計" v={yen(data.sum.total)} />
        <Kpi l="保険請求" v={yen(data.sum.insClaim)} />
        <Kpi l="自賠責（日々の入力／自賠請求の速報）" v={<>{yen(data.sum.jibaiClaim)}<span className="ml-1 text-xs font-normal text-slate-500">／{yen(data.jibaiSokuhou.total)}</span></>} />
        <Kpi l="金額が合わない日" v={`${data.mismatchDays} 日`} c={data.mismatchDays ? 'text-red-700' : ''} />
      </div>

      {tab === 'main' && (
        <>
          <div className="overflow-auto rounded border border-slate-300 bg-white">
            <table className="w-full border-collapse text-[11.5px] tabular-nums" aria-label="月間窓口表">
              <thead className="sticky top-0 z-10 bg-slate-300 text-[10.5px]">
                <tr>
                  <th rowSpan={2} className="border px-1">日付</th><th rowSpan={2} className="border px-1">曜</th>
                  {COLS.map((c, i) => {
                    if (!c.g) return <th key={i} rowSpan={2} className={`border px-1 ${c.cls ?? ''}`}>{c.l}</th>;
                    if (COLS[i - 1]?.g === c.g) return null;
                    return <th key={i} colSpan={COLS.filter((x) => x.g === c.g).length} className={`border px-1 ${c.g.startsWith('金額') ? 'bg-amber-400' : ''}`}>{c.g}</th>;
                  })}
                </tr>
                <tr>{COLS.filter((c) => c.g).map((c, i) => <th key={i} className={`border px-1 ${c.cls ?? ''}`}>{c.l}</th>)}</tr>
              </thead>
              <tbody>
                {data.days.map((d) => {
                  const v = d.vals as Record<string, number | undefined>;
                  const w = new Date(`${d.date}T00:00:00`).getDay();
                  return (
                    <tr key={d.date} className={d.closed ? 'bg-slate-200 text-slate-500' : ''}>
                      <td className="border px-1 text-center">{md(d.date)}</td>
                      <td className={`border px-1 text-center ${w === 0 || d.closed ? 'bg-red-500 font-bold text-white' : w === 6 ? 'font-bold text-blue-700' : ''}`}>{WD[w]}</td>
                      {COLS.map((c, i) => {
                        // 金額を一致させてください：合計・報告メール・通帳入金がそろっていなければ 3 つとも赤
                        const red = d.calc.mismatch && (c.c === 'match' || c.k === 'mail' || c.k === 'bank');
                        if (c.c) return <td key={i} className={`border px-1 text-right ${red ? 'bg-red-500 font-bold text-white' : c.cls ?? ''}`}>{d.calc[c.c] || Object.keys(v).length ? yen(d.calc[c.c] as number) : ''}</td>;
                        return <td key={i} className={`border p-0 ${red ? 'bg-red-500 font-bold text-white' : ''}`}><Num value={v[c.k!]} readOnly={ro} label={`${md(d.date)} ${c.g ? `${c.g} ` : ''}${c.l}`} onSave={(x) => saveDay(d.date, { [c.k!]: x })} /></td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="font-bold">
                <tr className="bg-yellow-300"><td colSpan={2} className="border px-1 text-center">計</td>{COLS.map((c, i) => <td key={i} className="border px-1 text-right">{yen(data.sum[(c.k ?? c.c)!])}</td>)}</tr>
                <tr className="bg-yellow-200"><td colSpan={2} className="border px-1 text-center">税抜</td>{COLS.map((c, i) => <td key={i} className="border px-1 text-right">{c.k === 'insClaim' || c.k === 'jibaiClaim' ? '' : yen(exTax(data.sum[(c.k ?? c.c)!]))}</td>)}</tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">白＝入力、黄・橙＝自動で計算、赤＝「合計」「報告メール合計」「通帳入金額」の 3 つがそろっていない（まだ入れていないときも赤）。グレーの行は休診日です（入力もできます）。全角の数字で打っても半角で入ります。</p>
          <UnknownList data={data} ro={ro} saveDay={saveDay} />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <table className="w-full border-collapse rounded border bg-white text-sm" aria-label="月末に入れる欄">
              <tbody>{MONTH_KEYS.map(([k, l]) => <tr key={k}><td className="border px-2 py-1">{l}</td><td className="w-40 border p-0"><Num value={data.extra[k]} readOnly={ro} label={l} onSave={(x) => saveMonth({ extra: { [k]: x } })} /></td></tr>)}</tbody>
            </table>
            <div className="rounded border bg-white p-2 text-sm">
              <label className="block text-xs text-slate-500">備考（例：2日 不明金 -400円 会計ミス）
                {ro ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{data.memo}</p>
                  : <textarea key={data.memo} defaultValue={data.memo} rows={4} onBlur={(e) => e.target.value !== data.memo && saveMonth({ memo: e.target.value })} className="mt-1 w-full rounded border px-2 py-1 text-sm" />}
              </label>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">入力ルール：自賠責請求（部位が決定している患者様の金額）は毎日入力。部位が未決定で翌月以降に請求する場合は、翌月の「月遅れ請求」に金額を入力。月の途中で部位が決まり決定前の金額を打てていない場合は、今月の請求額に入力。</p>
            </div>
          </div>
        </>
      )}

      {tab === 'goods' && <GoodsTab data={data} ro={ro} saveDay={saveDay} saveMonth={saveMonth} />}
      {tab === 'henrei' && <HenreiTab data={data} ro={ro} onSaved={() => save(async () => undefined)} onError={(t) => setMsg({ ok: false, text: t })} />}
      {me.session.role === 'store' && <p className="mt-4 text-[11px] text-slate-500">経理が確認したあとに直すと、「確認後に変更あり」と経理に伝わります。</p>}
    </div>
  );
}

/** 不明金が出た日の一覧（日付・金額は自動。詳細だけ打ち込む） */
function UnknownList({ data, ro, saveDay }: { data: Resp; ro: boolean; saveDay: (d: string, p: object) => void }) {
  const days = data.days.filter((d) => Number(d.vals.unknown ?? 0) !== 0);
  return (
    <section className="mt-3 rounded border bg-white p-2 text-sm" aria-label="不明金の詳細">
      <h2 className="mb-1 font-bold">不明金の詳細</h2>
      {days.length === 0 ? <p className="text-xs text-slate-500">この月は不明金はありません（窓口表の「不明金」に金額を入れると、ここに日付と金額が出ます）。</p> : (
        <table className="w-full max-w-3xl border-collapse text-[12px]">
          <thead className="bg-slate-300 text-[11px]"><tr><th className="w-16 border px-1">日付</th><th className="w-24 border px-1">不明金</th><th className="border px-1 text-left">詳細（何があったか）</th></tr></thead>
          <tbody>
            {days.map((d) => {
              const note = (d.vals.unknownNote as string) ?? '';
              return (
                <tr key={d.date}>
                  <td className="border px-1 text-center">{md(d.date)}（{WD[new Date(`${d.date}T00:00:00`).getDay()]}）</td>
                  <td className="border px-1 text-right font-bold tabular-nums">{yen(Number(d.vals.unknown))}円</td>
                  <td className={`border p-0 ${!note && !ro ? 'bg-yellow-200' : ''}`}><Txt value={note} readOnly={ro} label={`${md(d.date)} 不明金の詳細`} onSave={(x) => saveDay(d.date, { unknownNote: x })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {days.some((d) => !d.vals.unknownNote) && !ro && <p className="mt-1 text-[11px] text-amber-800">黄色＝詳細がまだ入っていません。</p>}
    </section>
  );
}

function GoodsTab({ data, ro, saveDay, saveMonth }: { data: Resp; ro: boolean; saveDay: (d: string, p: object) => void; saveMonth: (p: object) => void }) {
  if (!data.goods.length) return <p className="rounded border bg-white p-4 text-sm text-slate-600">物販の商品がまだ登録されていません。本部の「本部（店舗・設定）」→「物販の商品（窓口集計）」で登録してください。</p>;
  const profit = data.goods.reduce((a, g) => a + (data.goodsSum[g.id] ?? 0) * (g.price - g.cost), 0);
  return (
    <>
      <p className="mb-1 text-sm">販売合計 <b className="tabular-nums">{yen(data.sum.goodsSales)}</b>　利益（その他を除く） <b className="tabular-nums">{yen(profit)}</b></p>
      <div className="overflow-auto rounded border border-slate-300 bg-white">
        <table className="w-full border-collapse text-[11.5px] tabular-nums" aria-label="物販内訳">
          <thead className="sticky top-0 z-10 bg-slate-300 text-[10.5px]">
            <tr><th className="border px-1">日付</th><th className="border px-1">曜</th>{data.goods.map((g) => <th key={g.id} className="border px-1">{g.name}</th>)}<th className="border px-1">その他 金額</th><th className="border px-1">その他の内訳（商品名×個数）</th><th className="border bg-yellow-300 px-1">販売合計</th></tr>
          </thead>
          <tbody>
            {data.days.map((d) => {
              const gc = d.vals.goodsCount ?? {};
              const w = new Date(`${d.date}T00:00:00`).getDay();
              return (
                <tr key={d.date} className={d.closed ? 'bg-slate-200 text-slate-500' : ''}>
                  <td className="border px-1 text-center">{md(d.date)}</td><td className={`border px-1 text-center ${w === 0 || d.closed ? 'bg-red-500 font-bold text-white' : ''}`}>{WD[w]}</td>
                  {data.goods.map((g) => <td key={g.id} className="border p-0"><Num value={gc[g.id]} readOnly={ro} label={`${md(d.date)} ${g.name}`} onSave={(x) => saveDay(d.date, { goodsCount: { [g.id]: x } })} /></td>)}
                  <td className="border p-0"><Num value={d.vals.otherAmt as number | undefined} readOnly={ro} label={`${md(d.date)} その他 金額`} onSave={(x) => saveDay(d.date, { otherAmt: x })} /></td>
                  <td className="border p-0"><Txt value={(d.vals.otherNote as string) ?? ''} readOnly={ro} label={`${md(d.date)} その他の内訳`} onSave={(x) => saveDay(d.date, { otherNote: x })} /></td>
                  <td className="border bg-yellow-200 px-1 text-right">{d.calc.goodsSales ? yen(d.calc.goodsSales) : ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-yellow-300 font-bold"><td colSpan={2} className="border px-1 text-center">販売個数</td>{data.goods.map((g) => <td key={g.id} className="border px-1 text-right">{data.goodsSum[g.id] ?? 0}</td>)}<td className="border px-1 text-right">{yen(data.sum.otherAmt)}</td><td className="border" /><td className="border px-1 text-right">{yen(data.sum.goodsSales)}</td></tr>
            <tr><td colSpan={2} className="border px-1 text-center">販売価格</td>{data.goods.map((g) => <td key={g.id} className="border px-1 text-right">{yen(g.price)}</td>)}<td colSpan={3} className="border" /></tr>
            <tr><td colSpan={2} className="border px-1 text-center">原価</td>{data.goods.map((g) => <td key={g.id} className="border px-1 text-right">{yen(g.cost)}</td>)}<td colSpan={3} className="border" /></tr>
            <tr className="font-bold"><td colSpan={2} className="border px-1 text-center">利益</td>{data.goods.map((g) => <td key={g.id} className="border px-1 text-right">{yen((data.goodsSum[g.id] ?? 0) * (g.price - g.cost))}</td>)}<td colSpan={3} className="border" /></tr>
            <tr><td colSpan={2} className="border px-1 text-center">月初の在庫</td>{data.goods.map((g) => <td key={g.id} className="border p-0"><Num value={data.stockStart[g.id]} readOnly={ro} label={`${g.name} 月初の在庫`} onSave={(x) => saveMonth({ stockStart: { [g.id]: x } })} /></td>)}<td colSpan={3} className="border" /></tr>
            <tr><td colSpan={2} className="border px-1 text-center">月末の在庫</td>{data.goods.map((g) => <td key={g.id} className="border bg-yellow-200 px-1 text-right">{data.stockStart[g.id] === undefined ? '' : data.stockStart[g.id] - (data.goodsSum[g.id] ?? 0)}</td>)}<td colSpan={3} className="border" /></tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">商品・販売価格・原価は本部で決めます。月の途中で本部が価格を変えても、その月は入力を始めたときの価格で計算します。</p>
    </>
  );
}

const HENREI_COLS: { k: keyof Henrei; l: string; w: number; num?: boolean; opts?: string[] }[] = [
  { k: 'treatYm', l: '施術月', w: 60 }, { k: 'claimMonth', l: '請求月', w: 50 }, { k: 'patient', l: '患者様名', w: 110 }, { k: 'relation', l: '本人／家族', w: 70, opts: ['本人', '家族'] },
  { k: 'insurer', l: '保険者', w: 130 }, { k: 'insurerCode', l: '保険者コード', w: 80 }, { k: 'amount', l: '請求額', w: 80, num: true }, { k: 'reamount', l: '再請求額', w: 80, num: true },
  { k: 'place', l: '返戻場所', w: 100 }, { k: 'action', l: '取／再提出／保', w: 90, opts: ['取', '再提出', '保'] }, { k: 'reason', l: '理由', w: 150 },
];

function HenreiTab({ data, ro, onSaved, onError }: { data: Resp; ro: boolean; onSaved: () => void; onError: (t: string) => void }) {
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); onSaved(); } catch (e) { onError((e as Error).message); } };
  // 部品として作り直すと保存のたびに表が作り直されて入力が消えるので、関数として呼ぶ
  const table = (special: boolean) => {
    const rows = data.henrei.filter((r) => r.special === special);
    return (
      <section key={String(special)} className="mb-4">
        <h2 className="mb-1 text-base font-bold">{special ? '特殊返戻' : '返戻'}</h2>
        <div className="overflow-auto rounded border border-slate-300 bg-white">
          <table className="w-full border-collapse text-[11.5px]" aria-label={special ? '特殊返戻' : '返戻'}>
            <thead className="bg-slate-300 text-[10.5px]"><tr>{HENREI_COLS.map((c) => <th key={c.k} className={`border px-1 ${c.k === 'amount' ? 'bg-amber-400' : ''}`} style={{ minWidth: c.w }}>{c.l}</th>)}{!ro && <th className="border" />}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {HENREI_COLS.map((c) => (
                    <td key={c.k} className={`border p-0 ${c.k === 'amount' ? 'bg-amber-200' : ''}`}>
                      {c.num ? <Num value={r[c.k] as number | null} readOnly={ro} label={c.l} onSave={(x) => run(() => put('/api/admin/madoguchi/henrei', { id: r.id, patch: { [c.k]: x } }))} />
                        : c.opts && !ro ? (
                          <select value={r[c.k] as string} aria-label={c.l} onChange={(e) => run(() => put('/api/admin/madoguchi/henrei', { id: r.id, patch: { [c.k]: e.target.value } }))} className="w-full bg-transparent px-1">
                            <option value="" />{c.opts.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : <Txt value={r[c.k] as string} readOnly={ro} label={c.l} onSave={(x) => run(() => put('/api/admin/madoguchi/henrei', { id: r.id, patch: { [c.k]: x } }))} />}
                    </td>
                  ))}
                  {!ro && <td className="border px-1"><button type="button" onClick={() => confirm('この行を削除しますか？') && run(() => put('/api/admin/madoguchi/henrei', { id: r.id }, 'DELETE'))} className="text-[11px] text-slate-400 hover:text-red-700">✕</button></td>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={HENREI_COLS.length + 1} className="px-2 py-3 text-center text-slate-400">この月はありません</td></tr>}
            </tbody>
            <tfoot><tr className="font-bold"><td colSpan={6} className="border px-1 text-right">計</td><td className="border bg-amber-400 px-1 text-right">{yen(rows.reduce((a, r) => a + (r.amount ?? 0), 0))}</td><td className="border px-1 text-right">{yen(rows.reduce((a, r) => a + (r.reamount ?? 0), 0))}</td><td colSpan={ro ? 3 : 4} className="border" /></tr></tfoot>
          </table>
        </div>
        {!ro && <button type="button" onClick={() => run(() => put('/api/admin/madoguchi/henrei', { month: data.month, special, patch: {} }))} className="mt-1 rounded border bg-white px-3 py-0.5 text-sm">＋ 行を追加</button>}
      </section>
    );
  };
  return (
    <>
      <p className="mb-2 text-xs text-slate-600">月内にあった返戻はすべて記入してください（毎月 10 日までに）。売掛戻し：取消 → 保険収入（4111A③）／売掛金（1121）。</p>
      {table(false)}
      {table(true)}
    </>
  );
}
