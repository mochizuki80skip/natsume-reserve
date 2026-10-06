// 初回カルテ集計 /admin/karte?month=YYYY-MM
// 予約表で来院チェックした「（初診）（初）（初自）（再）」の人が自動で入り（日付・氏名・新・再）、残りを店舗で入力する
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { KIND_LABEL, TREATMENTS, VISIT_COUNT, md, missingFields, parseMd, type DetailFor, type KarteKind, type KarteOptions, type KarteRow, type KarteVisit } from '@/lib/karte';
import KarteRetention from '@/components/KarteRetention';
import { useAdmin } from './Layout';

interface Resp { month: string; today: string; storeName: string; rows: KarteRow[]; options: KarteOptions; detailFor: DetailFor; staff: string[] }

const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const KIND_CLASS: Record<KarteKind, string> = { NEW: 'bg-[#e34948] text-white', ACCIDENT: 'bg-[#eda100] text-slate-900', REVISIT: 'bg-[#2a78d6] text-white' };
const VISIT_HEAD = ['#dbe9f7', '#c9def2', '#b7d3ee', '#a6c8ea', '#8fb8e6'];
const ERR = 'bg-yellow-300';
const cellBase = 'h-[24px] w-full bg-transparent px-1 text-center text-[11.5px] outline-none focus:bg-yellow-50';

/** 選択肢に今の値が無いときも表示できるようにする */
const withCurrent = (list: string[], v: string) => (v && !list.includes(v) ? [...list, v] : list);

function Sel({ value, options, onChange, className = '', blank = '', label }: { value: string; options: string[]; onChange: (v: string) => void; className?: string; blank?: string; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${cellBase} appearance-none ${className}`}>
      <option value="">{blank}</option>
      {withCurrent(options, value).map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Txt({ value, onSave, className = '', label, inputMode, maxLength, align = 'center' }: { value: string; onSave: (v: string) => void; className?: string; label: string; inputMode?: 'numeric'; maxLength?: number; align?: 'left' | 'center' }) {
  return (
    <input key={value} defaultValue={value} aria-label={label} inputMode={inputMode} maxLength={maxLength}
      onBlur={(e) => e.target.value.trim() !== value && onSave(e.target.value.trim())}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${cellBase} ${align === 'left' ? 'text-left' : ''} ${className}`} />
  );
}

function DateTxt({ value, base, onSave, label }: { value: string; base: string; onSave: (iso: string) => void; label: string }) {
  const [bad, setBad] = useState(false);
  return (
    <input key={value} defaultValue={md(value)} aria-label={label} placeholder="" title="例）9/5 または 0905"
      onBlur={(e) => { const iso = parseMd(e.target.value, base); if (iso === null) { setBad(true); return; } setBad(false); if (iso !== value) onSave(iso); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${cellBase} ${bad ? 'bg-red-200' : ''}`} />
  );
}

function DetailCell({ row, detailFor, options, onSave, err }: { row: KarteRow; detailFor: DetailFor; options: KarteOptions; onSave: (v: string) => void; err: boolean }) {
  const kind = row.kind !== 'REVISIT' && row.trig in detailFor ? detailFor[row.trig] : undefined;
  const [other, setOther] = useState(false);
  if (kind === undefined) return <td className="border bg-slate-50 text-center text-slate-300">—</td>;
  if (kind === 'otherBiz') return <td className={`border ${err ? ERR : ''}`}><Sel value={row.trigDetail} options={options.otherBiz} onChange={onSave} label="内訳" /></td>;
  if (kind === 'campaign') {
    const isOther = other || (row.trigDetail !== '' && !options.campaign.includes(row.trigDetail));
    return (
      <td className={`border ${err ? ERR : ''}`}>
        {isOther ? (
          <div className="flex items-center">
            <Txt value={row.trigDetail} onSave={onSave} label="キャンペーン名" maxLength={60} align="left" />
            <button type="button" title="選択肢に戻す" onClick={() => { setOther(false); if (row.trigDetail) onSave(''); }} className="px-1 text-[10px] text-slate-400">↺</button>
          </div>
        ) : (
          <select value={row.trigDetail} aria-label="内訳" onChange={(e) => (e.target.value === '__other' ? setOther(true) : onSave(e.target.value))} className={`${cellBase} appearance-none`}>
            <option value="" />
            {options.campaign.map((o) => <option key={o} value={o}>{o}</option>)}
            <option value="__other">その他（記入）</option>
          </select>
        )}
      </td>
    );
  }
  return <td className={`border ${err ? ERR : ''}`}><Txt value={row.trigDetail} onSave={onSave} label="内訳（記入）" maxLength={60} align="left" /></td>;
}

function Row({ row, data, onPatch, onDelete }: { row: KarteRow; data: Resp; onPatch: (id: string, patch: Partial<KarteRow>) => void; onDelete: (id: string) => void }) {
  const miss = missingFields(row, data.detailFor);
  const e = (k: string) => (miss.has(k) ? ERR : '');
  const p = (patch: Partial<KarteRow>) => onPatch(row.id, patch);
  const isRe = row.kind === 'REVISIT';
  const setVisit = (i: number, v: Partial<KarteVisit>) => p({ visits: row.visits.map((x, j) => (j === i ? { ...x, ...v } : x)) });
  const autoCls = 'bg-slate-100';
  return (
    <tr className="hover:bg-sky-50/40">
      <td className={`border ${autoCls}`}><DateTxt value={row.date} base={row.date} onSave={(v) => v && p({ date: v })} label="日付" /></td>
      <td className={`border ${e('karteNo')}`}><Txt value={row.karteNo} onSave={(v) => p({ karteNo: v })} label="カルテNo" maxLength={20} /></td>
      <td className={`border ${isRe ? 'bg-sky-50' : ''} ${e('trig')}`}>
        <Sel value={row.trig} options={isRe ? data.options.revisitAction : data.options.trigger} label={isRe ? '再来アクション' : 'きっかけ'}
          onChange={(v) => p({ trig: v, ...(v in data.detailFor || !row.trigDetail ? {} : { trigDetail: '' }) })} />
      </td>
      <DetailCell row={row} detailFor={data.detailFor} options={data.options} onSave={(v) => p({ trigDetail: v })} err={miss.has('trigDetail')} />
      <td className={`border ${autoCls} ${e('name')}`}><Txt value={row.name} onSave={(v) => p({ name: v })} label="氏名" maxLength={40} align="left" /></td>
      <td className={`border ${KIND_CLASS[row.kind]}`}>
        <select value={row.kind} onChange={(ev) => p({ kind: ev.target.value as KarteKind })} aria-label="新・再" className={`${cellBase} appearance-none font-bold`}>
          {(['NEW', 'ACCIDENT', 'REVISIT'] as KarteKind[]).map((k) => <option key={k} value={k} className="bg-white text-slate-900">{KIND_LABEL[k]}</option>)}
        </select>
      </td>
      <td className={`border ${e('age')}`}><Txt value={row.age === null ? '' : String(row.age)} onSave={(v) => p({ age: v === '' ? null : (v as unknown as number) })} label="年齢" inputMode="numeric" maxLength={3} /></td>
      <td className={`border ${row.sex === '♂' ? 'bg-[#2a78d6] text-white' : row.sex === '♀' ? 'bg-[#e34948] text-white' : e('sex')}`}>
        <select value={row.sex} onChange={(ev) => p({ sex: ev.target.value })} aria-label="性別" className={`${cellBase} appearance-none`}>
          <option value="" /><option value="♂" className="bg-white text-slate-900">♂</option><option value="♀" className="bg-white text-slate-900">♀</option>
        </select>
      </td>
      <td className={`border ${e('symptomCat')}`}><Sel value={row.symptomCat} options={data.options.symptom} onChange={(v) => p({ symptomCat: v })} label="症状カテゴリー" /></td>
      <td className={`border ${e('symptom')}`}><Txt value={row.symptom} onSave={(v) => p({ symptom: v })} label="症状" maxLength={100} align="left" /></td>
      <td className={`border ${e('staff')}`}><Sel value={row.staff} options={data.staff} onChange={(v) => p({ staff: v })} label="担当" /></td>
      <td className={`border ${e('treatment')}`}><Sel value={row.treatment} options={TREATMENTS} onChange={(v) => p({ treatment: v })} label="施術内容" /></td>
      {row.visits.map((v, i) => (
        <VisitCells key={i} n={i + 2} v={v} base={row.date} staff={data.staff} onChange={(x) => setVisit(i, x)} />
      ))}
      <td className="border px-0.5 text-center">
        {!row.auto && <button type="button" onClick={() => onDelete(row.id)} title="この行を削除" className="text-[11px] text-slate-400 hover:text-red-700">✕</button>}
      </td>
    </tr>
  );
}

function VisitCells({ n, v, base, staff, onChange }: { n: number; v: KarteVisit; base: string; staff: string[]; onChange: (x: Partial<KarteVisit>) => void }) {
  return (
    <>
      <td className="border"><DateTxt value={v.d} base={base} onSave={(d) => onChange({ d })} label={`${n}回目 日付`} /></td>
      <td className="border"><Sel value={v.s} options={staff} onChange={(s) => onChange({ s })} label={`${n}回目 担当`} /></td>
      <td className="border"><Sel value={v.t} options={TREATMENTS} onChange={(t) => onChange({ t })} label={`${n}回目 施術`} /></td>
    </>
  );
}

export default function KartePage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') ?? '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/karte?month=${encodeURIComponent(month)}`);
  const [rows, setRows] = useState<KarteRow[]>([]);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => { if (data) setRows(data.rows); }, [data]);
  if (!me.store) return <p>店舗が登録されていません。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;

  const ym = data.month;
  const monthLabel = `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`;
  async function patch(id: string, p: Partial<KarteRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    setState('saving');
    const r = await fetch('/api/admin/karte', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, patch: p }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setState('error'); alert(j.error ?? '保存できませんでした'); reload(); return; }
    setState('saved');
    setRows((rs) => rs.map((x) => (x.id === id ? j.row : x)));
  }
  async function addRow() {
    const date = data!.today.startsWith(ym) ? data!.today : `${ym}-01`;
    const r = await fetch('/api/admin/karte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) });
    const j = await r.json();
    if (r.ok) setRows((rs) => [...rs, j.row]);
  }
  async function del(id: string) {
    if (!confirm('この行を削除しますか？')) return;
    const r = await fetch('/api/admin/karte', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!r.ok) { alert((await r.json().catch(() => ({}))).error ?? '削除できませんでした'); return; }
    setRows((rs) => rs.filter((x) => x.id !== id));
  }

  const count = (k: KarteKind) => rows.filter((r) => r.kind === k).length;
  const missingRows = rows.filter((r) => missingFields(r, data.detailFor).size > 0).length;
  const go = (n: number) => setSp({ month: shiftMonth(ym, n) });

  return (
    <div>
      <div className="no-print mb-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-lg font-bold">初回カルテ集計</h1>
        <button type="button" onClick={() => go(-1)} className="rounded border bg-white px-2 py-0.5 text-sm">‹ 前月</button>
        <b className="text-sm">{monthLabel}</b>
        <button type="button" onClick={() => go(1)} className="rounded border bg-white px-2 py-0.5 text-sm">翌月 ›</button>
        <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-sm font-bold text-red-800">新患 {count('NEW')}</span>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-900">初自 {count('ACCIDENT')}</span>
        <span className="rounded bg-blue-100 px-2 py-0.5 text-sm font-bold text-blue-800">再 {count('REVISIT')}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-sm font-bold">合計 {rows.length}</span>
        {missingRows > 0 && <span className="rounded bg-yellow-200 px-2 py-0.5 text-sm font-bold text-yellow-900">⚠ 未入力 {missingRows}件</span>}
        <span className="ml-auto text-xs text-slate-500">{state === 'saving' ? '保存中…' : state === 'saved' ? '保存しました' : state === 'error' ? '保存に失敗しました' : '入力すると自動で保存されます'}</span>
        <a href={`/api/admin/karte/export?month=${ym}`} className="rounded border bg-white px-2 py-0.5 text-sm">Excelで保存</a>
        <button type="button" onClick={() => window.print()} className="rounded border bg-white px-2 py-0.5 text-sm">印刷</button>
        <button type="button" onClick={addRow} className="rounded border bg-white px-2 py-0.5 text-sm">＋ 行を追加</button>
      </div>
      <div className="max-h-[470px] overflow-auto rounded border border-slate-300 bg-white print:max-h-none">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th colSpan={12} className="border bg-[#f4cccc] px-1 py-0.5">初回入力　※初回入力欄はすべて埋めてください　再来のきっかけ（再来アクション）は空欄でも可</th>
              {Array.from({ length: VISIT_COUNT }, (_, i) => <th key={i} colSpan={3} className="border px-1 py-0.5" style={{ background: VISIT_HEAD[i] }}>{i + 2}回目</th>)}
              <th className="border bg-slate-100" />
            </tr>
            <tr className="bg-slate-100 text-[10.5px]">
              {[['日付', 40], ['カルテNo', 44], ['きっかけ', 92], ['内訳', 104], ['氏名', 96], ['新・再', 42], ['年齢', 34], ['性別', 32], ['症状ｶﾃｺﾞﾘｰ', 60], ['症状', 96], ['担当', 48], ['施術', 44]].map(([h, w]) => <th key={h as string} className="whitespace-nowrap border px-0.5 py-0.5" style={{ minWidth: w as number }}>{h}</th>)}
              {Array.from({ length: VISIT_COUNT }, (_, i) => ['日付', '担当', '施術'].map((h) => <th key={`${i}${h}`} className="border px-0.5 py-0.5" style={{ minWidth: h === '日付' ? 36 : 42 }}>{h}</th>))}
              <th className="border" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.id} row={r} data={data} onPatch={patch} onDelete={del} />)}
            {rows.length === 0 && <tr><td colSpan={12 + VISIT_COUNT * 3 + 1} className="p-4 text-center text-slate-500">この月はまだありません。予約表で「（初診）（初）（初自）（再）」の人に来院チェックを付けると、ここに自動で入ります。</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="no-print mt-1 text-[11px] text-slate-500">
        <i className="mr-1 inline-block h-2.5 w-2.5 border bg-slate-100 align-middle" />グレー＝予約表から自動で入る欄（直せます）　
        <i className="mr-1 inline-block h-2.5 w-2.5 border bg-yellow-300 align-middle" />黄色＝未入力　
        日付は「9/5」や「0905」で入力できます。予約表から入った行は、来院チェックを外すと消えます（手を加えた行は残ります）。
        <Link to={`/admin/day/${data.today}`} className="ml-2 text-brand underline">予約表へ</Link>
      </p>
      <KarteRetention rows={rows} monthLabel={monthLabel} />
    </div>
  );
}
