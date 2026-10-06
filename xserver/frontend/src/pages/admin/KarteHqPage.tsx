// 本部：新患・再来の集計 /admin/hq/karte（全体・エリア・店舗 × 日別・週別・月別、きっかけ別、継続率）
import { useMemo, useState } from 'react';
import { useFetch } from '@/lib/api';
import { KIND_COLOR, isNewKind, pct, retentionOf, VISIT_COUNT, type DetailFor, type KarteOptions } from '@/lib/karte';
import { Donut, SERIES_COLORS, StackedColumns } from '@/components/charts';
import { useAdmin } from './Layout';

interface HqRow { store: string; date: string; kind: 'NEW' | 'ACCIDENT' | 'REVISIT'; trig: string; trigDetail: string; staff: string; reached: boolean[]; missing: boolean }
interface Area { id?: string; name: string; stores: string[] }
interface StoreInfo { code: string; name: string; active?: boolean }
interface DataResp { rows: HqRow[]; areas: Area[]; stores: StoreInfo[]; today: string }
interface OptResp { options: KarteOptions; detailFor: DetailFor; areas: Area[]; stores: StoreInfo[] }

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`); };
const shiftYm = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return iso(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7); };
const mdj = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const wd = (d: string) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()];
/** 月を月曜始まりの週に分ける（月の外ははみ出さない） */
function weeksOf(ym: string) {
  const out: { label: string; from: string; to: string }[] = [];
  let cur: string[] = [];
  for (const d of daysOf(ym)) {
    if (cur.length && new Date(`${d}T00:00:00Z`).getUTCDay() === 1) { out.push({ label: `${mdj(cur[0])}〜${mdj(cur[cur.length - 1])}`, from: cur[0], to: cur[cur.length - 1] }); cur = []; }
    cur.push(d);
  }
  if (cur.length) out.push({ label: `${mdj(cur[0])}〜${mdj(cur[cur.length - 1])}`, from: cur[0], to: cur[cur.length - 1] });
  return out;
}
type Bucket = { label: string; from: string; to: string; title: string };

export default function KarteHqPage() {
  const { me } = useAdmin();
  const [tab, setTab] = useState<'sum' | 'settings'>('sum');
  if (me.session.role !== 'hq') return <p>本部アカウントでログインしてください。</p>;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-lg font-bold">新患・再来 集計（本部）</h1>
        <div className="inline-flex overflow-hidden rounded border text-sm">
          <button type="button" onClick={() => setTab('sum')} className={`px-3 py-1 ${tab === 'sum' ? 'bg-brand font-bold text-white' : 'bg-white'}`}>集計</button>
          <button type="button" onClick={() => setTab('settings')} className={`px-3 py-1 ${tab === 'settings' ? 'bg-brand font-bold text-white' : 'bg-white'}`}>選択肢・エリアの設定</button>
        </div>
      </div>
      {tab === 'sum' ? <Summary /> : <SettingsTab />}
    </div>
  );
}

function Summary() {
  const now = new Date(Date.now() + 9 * 3600e3);
  const [target, setTarget] = useState<'all' | 'area' | 'store'>('all');
  const [areaIdx, setAreaIdx] = useState(0);
  const [storeCode, setStoreCode] = useState('');
  const [unit, setUnit] = useState<'day' | 'week' | 'month'>('day');
  const [ym, setYm] = useState(iso(now).slice(0, 7));
  const [year, setYear] = useState(now.getUTCFullYear());
  const [openTrig, setOpenTrig] = useState<string | null>(null);

  const range = unit === 'month' ? { from: `${year - 1}-01-01`, to: `${year}-12-31` } : { from: `${shiftYm(ym, -1)}-01`, to: daysOf(ym).slice(-1)[0] };
  const { data, error } = useFetch<DataResp>(`/api/admin/hq/karte?from=${range.from}&to=${range.to}`);
  const opt = useFetch<OptResp>('/api/admin/hq/karte/options').data;

  const view = useMemo(() => {
    if (!data || !opt) return null;
    const area = data.areas[areaIdx];
    const inTarget = (code: string) => (target === 'all' ? true : target === 'area' ? !!area?.stores.includes(code) : code === (storeCode || data.stores[0]?.code));
    const rows = data.rows.filter((r) => inTarget(r.store));
    const buckets: Bucket[] = unit === 'day'
      ? daysOf(ym).map((d) => ({ label: String(Number(d.slice(8))), from: d, to: d, title: `${mdj(d)}（${wd(d)}）` }))
      : unit === 'week'
        ? weeksOf(ym).map((w) => ({ ...w, title: w.label }))
        : Array.from({ length: 12 }, (_, i) => { const m = `${year}-${String(i + 1).padStart(2, '0')}`; return { label: `${i + 1}月`, from: `${m}-01`, to: daysOf(m).slice(-1)[0], title: `${year}年${i + 1}月` }; });
    const cur = { from: buckets[0].from, to: buckets[buckets.length - 1].to };
    const prev = unit === 'month' ? { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` } : { from: `${shiftYm(ym, -1)}-01`, to: daysOf(shiftYm(ym, -1)).slice(-1)[0] };
    const inR = (r: HqRow, x: { from: string; to: string }) => r.date >= x.from && r.date <= x.to;
    const curRows = rows.filter((r) => inR(r, cur));
    const prevRows = rows.filter((r) => inR(r, prev));
    const trigBuckets = unit === 'month' ? buckets : weeksOf(ym).map((w) => ({ ...w, title: w.label }));
    return { rows, curRows, prevRows, buckets, trigBuckets, area };
  }, [data, opt, target, areaIdx, storeCode, unit, ym, year]);

  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data || !opt || !view) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const { curRows, prevRows, buckets, trigBuckets } = view;
  const kinds = [['NEW', '新患（初診・初）'], ['ACCIDENT', '初自（自賠）'], ['REVISIT', '再来']] as const;
  const cnt = (list: HqRow[], k?: string) => (k ? list.filter((r) => r.kind === k).length : list.length);
  const diff = (a: number, b: number) => (a - b >= 0 ? `+${a - b}` : `${a - b}`);
  const prevLabel = unit === 'month' ? '前年' : '前月';
  const periodLabel = unit === 'month' ? `${year}年` : `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`;

  // きっかけ別（新患＋初自）
  const newCur = curRows.filter((r) => isNewKind(r.kind));
  const trigList = [...opt.options.trigger, ...[...new Set(newCur.map((r) => r.trig || '（未入力）'))].filter((t) => !opt.options.trigger.includes(t))];
  const trigCount = (t: string, b?: Bucket) => newCur.filter((r) => (r.trig || '（未入力）') === t && (!b || (r.date >= b.from && r.date <= b.to))).length;
  const trigTotals = trigList.map((t) => ({ label: t, value: trigCount(t) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const reCur = curRows.filter((r) => r.kind === 'REVISIT');
  const actions = [...opt.options.revisitAction, ...[...new Set(reCur.map((r) => r.trig).filter((t) => t && !opt.options.revisitAction.includes(t)))]];

  // 店舗別（エリアごとに小計）
  const storeName = new Map(data.stores.map((s) => [s.code, s.name]));
  const storesInTarget = data.stores.filter((s) => (target === 'all' ? true : target === 'area' ? view.area?.stores.includes(s.code) : s.code === (storeCode || data.stores[0]?.code)));
  const groups: { name: string; codes: string[] }[] = target === 'all'
    ? [...data.areas.map((a) => ({ name: a.name, codes: a.stores })), { name: 'エリア未設定', codes: storesInTarget.map((s) => s.code).filter((c) => !data.areas.some((a) => a.stores.includes(c))) }].filter((g) => g.codes.length)
    : [{ name: target === 'area' ? view.area?.name ?? '' : storeName.get(storeCode || data.stores[0]?.code) ?? '', codes: storesInTarget.map((s) => s.code) }];
  const StoreLine = ({ label, list, bold, sub }: { label: string; list: HqRow[]; bold?: boolean; sub?: boolean }) => {
    const ret = retentionOf(list.filter((r) => isNewKind(r.kind)));
    return (
      <tr className={`${bold ? 'bg-slate-50 font-bold' : ''} border-b border-slate-100`}>
        <td className={`whitespace-nowrap px-2 py-1 text-left ${sub ? 'pl-5' : ''}`}>{label}</td>
        {kinds.map(([k]) => <td key={k} className="px-2">{cnt(list, k)}</td>)}
        <td className="px-2">{list.length}</td>
        <td className={`px-2 ${list.filter((r) => r.missing).length ? 'font-bold text-amber-700' : 'text-slate-400'}`}>{list.filter((r) => r.missing).length}</td>
        {ret.reached.map((v, i) => <td key={i} className="px-2">{ret.first ? <><b>{pct(v, ret.first)}%</b> <span className="text-[10px] text-slate-500">{v}</span></> : '－'}</td>)}
      </tr>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
        <span>対象</span>
        <Seg value={target} onChange={(v) => setTarget(v as typeof target)} items={[['all', '全体'], ['area', 'エリア'], ['store', '店舗']]} />
        {target === 'area' && (data.areas.length
          ? <select value={areaIdx} onChange={(e) => setAreaIdx(Number(e.target.value))} className="rounded border px-2 py-1">{data.areas.map((a, i) => <option key={i} value={i}>{a.name}（{a.stores.length}店舗）</option>)}</select>
          : <span className="text-xs text-slate-500">エリアは「選択肢・エリアの設定」で作れます</span>)}
        {target === 'store' && <select value={storeCode || data.stores[0]?.code} onChange={(e) => setStoreCode(e.target.value)} className="rounded border px-2 py-1">{data.stores.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>}
        <span className="ml-3">単位</span>
        <Seg value={unit} onChange={(v) => setUnit(v as typeof unit)} items={[['day', '日別'], ['week', '週別'], ['month', '月別']]} />
        {unit === 'month' ? (
          <><button type="button" onClick={() => setYear(year - 1)} className="rounded border px-2">‹</button><b>{year}年</b><button type="button" onClick={() => setYear(year + 1)} className="rounded border px-2">›</button></>
        ) : (
          <><button type="button" onClick={() => setYm(shiftYm(ym, -1))} className="rounded border px-2">‹</button><b>{periodLabel}</b><button type="button" onClick={() => setYm(shiftYm(ym, 1))} className="rounded border px-2">›</button></>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[...kinds.map(([k, l]) => ({ l, c: KIND_COLOR[k], a: cnt(curRows, k), b: cnt(prevRows, k) })), { l: '合計', c: '', a: curRows.length, b: prevRows.length }].map((t) => (
          <div key={t.l} className="rounded-lg border bg-white px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">{t.c && <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: t.c }} />}{t.l}</div>
            <div className="text-3xl font-bold tabular-nums">{t.a}</div>
            <div className="text-[11px] text-slate-500">{prevLabel} {t.b}（{diff(t.a, t.b)}）</div>
          </div>
        ))}
      </div>

      <div className="mb-3 rounded-lg border bg-white p-3">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold">{unit === 'day' ? '日別' : unit === 'week' ? '週別' : '月別'}の推移（{periodLabel}）</h2>
          {kinds.map(([k, l]) => <span key={k} className="text-xs"><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: KIND_COLOR[k] }} />{l}</span>)}
        </div>
        <StackedColumns labels={buckets.map((b) => b.label)} titleOf={(i) => buckets[i].title}
          series={kinds.map(([k, l]) => ({ name: l.replace(/（.*）/, ''), color: KIND_COLOR[k], values: buckets.map((b) => curRows.filter((r) => r.kind === k && r.date >= b.from && r.date <= b.to).length) }))} />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr]">
        <div className="overflow-x-auto rounded-lg border bg-white p-3">
          <h2 className="mb-1 text-sm font-bold">きっかけ別（{unit === 'month' ? '月ごと' : '週ごと'}・新患＋初自）</h2>
          <table className="w-full text-right text-xs tabular-nums">
            <thead><tr className="bg-slate-50 text-[10.5px] text-slate-500"><th className="px-2 py-1 text-left">きっかけ</th>{trigBuckets.map((b) => <th key={b.label} className="whitespace-nowrap px-2 py-1">{b.label}</th>)}<th className="px-2 py-1">計</th></tr></thead>
            <tbody>
              {trigList.filter((t) => trigCount(t) > 0).map((t) => (
                <tr key={t} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1 text-left">
                    {t in opt.detailFor ? <button type="button" onClick={() => setOpenTrig(openTrig === t ? null : t)} className="text-brand underline">{t}</button> : t}
                  </td>
                  {trigBuckets.map((b) => <td key={b.label} className="px-2">{trigCount(t, b) || '－'}</td>)}
                  <td className="px-2 font-bold">{trigCount(t)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 font-bold"><td className="px-2 py-1 text-left">合計</td>{trigBuckets.map((b) => <td key={b.label} className="px-2">{newCur.filter((r) => r.date >= b.from && r.date <= b.to).length}</td>)}<td className="px-2">{newCur.length}</td></tr>
            </tbody>
          </table>
          {newCur.length === 0 && <p className="py-3 text-center text-xs text-slate-400">この期間はまだありません</p>}
          {openTrig && (
            <div className="mt-2 rounded border bg-slate-50 p-2 text-xs">
              <b>「{openTrig}」の内訳</b>
              <ul className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">
                {Object.entries(newCur.filter((r) => r.trig === openTrig).reduce<Record<string, number>>((a, r) => { const k = r.trigDetail || '（未入力）'; a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k}>{k}　<b>{v}</b></li>)}
              </ul>
            </div>
          )}
          <p className="mt-1 text-[11px] text-slate-500">「紹介他事業」「キャンペーン」「イベント」を押すと内訳が見られます。</p>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <h2 className="mb-2 text-sm font-bold">きっかけの割合（{periodLabel}）</h2>
          <Donut items={trigTotals} center="新患＋初自" />
          <h3 className="mb-1 mt-4 text-sm font-bold">再来アクション（{periodLabel}・再来 {reCur.length}名）</h3>
          <div className="flex flex-wrap gap-2 text-xs">
            {[...actions, ''].map((a) => <span key={a || 'none'} className="rounded border px-2 py-1">{a || 'なし（空白）'}　<b>{reCur.filter((r) => r.trig === a).length}</b></span>)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white p-3">
        <h2 className="mb-1 text-sm font-bold">店舗別（{periodLabel}）</h2>
        <table className="w-full text-right text-xs tabular-nums">
          <thead>
            <tr className="bg-slate-50 text-[10.5px] text-slate-500">
              <th className="px-2 py-1 text-left">店舗</th><th className="px-2">新患</th><th className="px-2">初自</th><th className="px-2">再来</th><th className="px-2">合計</th><th className="px-2">未入力</th>
              {Array.from({ length: VISIT_COUNT }, (_, i) => <th key={i} className="whitespace-nowrap px-2">継続 {i + 2}回目</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Group key={g.name} g={g} rows={curRows} storeName={storeName} StoreLine={StoreLine} showSub={target !== 'store'} />
            ))}
            {target === 'all' && <StoreLine label="全体" list={curRows} bold />}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-slate-500">継続＝新患（初診・初・初自）のうち、2〜6回目の日付が入っている割合（横の数字は人数）。未入力＝カルテ集計で黄色の欄が残っている件数。</p>
      </div>
    </div>
  );
}

function Group({ g, rows, storeName, StoreLine, showSub }: { g: { name: string; codes: string[] }; rows: HqRow[]; storeName: Map<string, string>; StoreLine: (p: { label: string; list: HqRow[]; bold?: boolean; sub?: boolean }) => React.ReactElement; showSub: boolean }) {
  return (
    <>
      <StoreLine label={g.name} list={rows.filter((r) => g.codes.includes(r.store))} bold />
      {showSub && g.codes.map((c) => <StoreLine key={c} label={storeName.get(c) ?? c} list={rows.filter((r) => r.store === c)} sub />)}
    </>
  );
}

function Seg({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <div className="inline-flex overflow-hidden rounded border">
      {items.map(([v, l]) => <button key={v} type="button" onClick={() => onChange(v)} className={`border-r px-3 py-0.5 last:border-r-0 ${value === v ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{l}</button>)}
    </div>
  );
}

const CAT_LABEL: [keyof KarteOptions, string, string][] = [
  ['trigger', '集客きっかけ', '新患・初自の「きっかけ」'],
  ['otherBiz', '他事業紹介', 'きっかけ「紹介他事業」の内訳'],
  ['campaign', 'キャンペーン', 'きっかけ「キャンペーン」の内訳（ほかに記入もできます）'],
  ['symptom', '症状カテゴリー', ''],
  ['revisitAction', '再来アクション', '再の人の「きっかけ」欄（空白も可）'],
];

function SettingsTab() {
  const { data, reload } = useFetch<OptResp>('/api/admin/hq/karte/options');
  const [msg, setMsg] = useState('');
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  async function saveOpt(category: string, text: string) {
    const r = await fetch('/api/admin/hq/karte/options', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, labels: text.split('\n') }) });
    setMsg(r.ok ? '保存しました' : '保存できませんでした');
    if (r.ok) reload();
  }
  return (
    <div className="space-y-4">
      {msg && <p className="rounded bg-brand-light px-3 py-1 text-sm">{msg}</p>}
      <AreasEditor key={JSON.stringify(data.areas)} areas={data.areas} stores={data.stores} onSaved={() => { setMsg('エリアを保存しました'); reload(); }} />
      <div className="rounded-lg border bg-white p-3">
        <h2 className="text-sm font-bold">カルテ集計の選択肢</h2>
        <p className="mb-2 text-xs text-slate-500">1行に1つずつ書きます。上からの順番でプルダウンに出ます。「イベント」「紹介他事業」「キャンペーン」は内訳と連動するので、名前を変えないでください。</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {CAT_LABEL.map(([cat, label, help]) => <OptBox key={cat + data.options[cat].join()} label={label} help={help} initial={data.options[cat].join('\n')} onSave={(t) => saveOpt(cat, t)} />)}
        </div>
      </div>
    </div>
  );
}

function OptBox({ label, help, initial, onSave }: { label: string; help: string; initial: string; onSave: (t: string) => void }) {
  const [t, setT] = useState(initial);
  return (
    <div className="text-sm">
      <div className="font-bold">{label}</div>
      {help && <div className="text-[11px] text-slate-500">{help}</div>}
      <textarea value={t} onChange={(e) => setT(e.target.value)} rows={12} className="mt-1 w-full rounded border px-2 py-1 text-xs" />
      <button type="button" disabled={t === initial} onClick={() => onSave(t)} className="mt-1 rounded bg-brand px-3 py-1 text-xs font-bold text-white disabled:opacity-40">保存</button>
    </div>
  );
}

function AreasEditor({ areas, stores, onSaved }: { areas: Area[]; stores: StoreInfo[]; onSaved: () => void }) {
  const [list, setList] = useState<Area[]>(areas);
  const [err, setErr] = useState('');
  async function save() {
    const r = await fetch('/api/admin/hq/areas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ areas: list }) });
    if (!r.ok) { setErr('保存できませんでした'); return; }
    onSaved();
  }
  return (
    <div className="rounded-lg border bg-white p-3 text-sm">
      <h2 className="text-sm font-bold">エリア</h2>
      <p className="mb-2 text-xs text-slate-500">エリア名を付けて、含める店舗にチェックを入れます。本部の集計で「エリア」を選ぶと、まとめて見られます。</p>
      <div className="space-y-2">
        {list.map((a, i) => (
          <div key={i} className="rounded border p-2">
            <div className="mb-1 flex items-center gap-2">
              <input value={a.name} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="エリア名（例：三島エリア）" className="w-56 rounded border px-2 py-1" />
              <button type="button" onClick={() => setList(list.filter((_, j) => j !== i))} className="text-xs text-red-700">このエリアを削除</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {stores.map((s) => {
                const on = a.stores.includes(s.code);
                return (
                  <label key={s.code} className={`cursor-pointer rounded border px-2 py-0.5 text-xs ${on ? 'border-brand bg-brand text-white' : 'bg-white'}`}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => setList(list.map((x, j) => (j === i ? { ...x, stores: on ? x.stores.filter((c) => c !== s.code) : [...x.stores, s.code] } : x)))} />{s.name}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => setList([...list, { name: '', stores: [] }])} className="rounded border px-3 py-1 text-xs">＋ エリアを追加</button>
        <button type="button" onClick={save} className="rounded bg-brand px-3 py-1 text-xs font-bold text-white">エリアを保存</button>
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </div>
  );
}
