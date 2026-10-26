// 人員の過不足 /admin/staffing?month=YYYY-MM&view=all|area（本部・管轄MG＝全店）。人員基準（施術者・受付）と、その月の在籍人数・氏名を店舗ごとに。採用の判断に使う
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { halfNum } from '@/lib/format';

type Role = 'therapist' | 'reception';
interface Count { std: number | null; start: number; end: number; min: number }
interface Note { kind: 'join' | 'transferIn' | 'retire' | 'transferOut' | 'end' | 'leave'; date: string; until?: string | null }
interface Person { name: string; head: boolean; notes: Note[] }
interface Row {
  code: string; name: string; area: string; canEdit: boolean; therapist: Count; reception: Count;
  people: Record<Role, Person[]>;
  paused: { name: string; role: Role }[];
}
const ROLE = { therapist: '施術者', reception: '受付' } as const;
const shiftYm = (ym: string, d: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + d, 1)).toISOString().slice(0, 7);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const NOTE = (n: Note) => ({
  join: `${md(n.date)}〜 入社`, transferIn: `${md(n.date)}〜 異動で来る`, retire: `${md(n.date)} 退職`, transferOut: `${md(n.date)} 異動`, end: `${md(n.date)} まで`,
  leave: `休職 ${md(n.date)}〜${n.until ? md(n.until) : ''}`,
}[n.kind]);
const NOTE_TONE: Record<Note['kind'], string> = { join: 'text-green-800', transferIn: 'text-green-800', retire: 'text-red-700', transferOut: 'text-red-700', end: 'text-red-700', leave: 'text-amber-800' };

/** 過不足：月の中でいちばん少ない日の人数 − 基準 */
const diffOf = (c: Count) => (c.std === null ? null : c.min - c.std);
const tone = (d: number | null) => (d === null ? 'bg-slate-100 text-slate-500' : d < 0 ? 'bg-red-500 font-bold text-white' : d === 0 ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800');
const diffText = (d: number | null) => (d === null ? '基準なし' : d < 0 ? `${d} 人` : d === 0 ? '±0' : `＋${d} 人`);

/** 店舗をまとめた数（基準を入れた店舗だけで過不足を出す） */
function sumOf(rows: Row[], k: Role) {
  const withStd = rows.filter((r) => r[k].std !== null);
  return {
    std: withStd.length ? withStd.reduce((a, r) => a + (r[k].std ?? 0), 0) : null,
    min: rows.reduce((a, r) => a + r[k].min, 0),
    diff: withStd.length ? withStd.reduce((a, r) => a + (diffOf(r[k]) ?? 0), 0) : null,
  };
}

export default function StaffingPage() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') === 'area' ? 'area' : 'all';
  const { data, error, reload } = useFetch<{ month: string; rows: Row[] }>(`/api/admin/staffing?month=${encodeURIComponent(sp.get('month') ?? '')}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const ym = data.month;
  const go = (p: { month?: string; view?: string }) => setSp({ month: p.month ?? ym, ...(p.view ?? view) === 'area' ? { view: 'area' } : {} });
  async function saveStd(code: string, key: 'therapists' | 'reception', raw: string, name: string) {
    const v = halfNum(raw).trim();
    const r = await fetch('/api/admin/staffing/std', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store: code, [key]: v === '' ? null : Number(v) }) });
    const j = await r.json().catch(() => ({}));
    setMsg({ ok: r.ok, text: r.ok ? `${name} の人員基準を保存しました` : (j as { error?: string }).error ?? '保存できませんでした' });
    if (r.ok) reload();
  }
  const areas = [...new Set(data.rows.map((r) => r.area))];
  const groups = areas.map((a) => ({ area: a, rows: data.rows.filter((r) => r.area === a) }));

  const Cells = ({ r, k }: { r: Row; k: Role }) => {
    const c = r[k];
    const d = diffOf(c);
    return (
      <>
        <td className="border px-1 py-0.5 text-center">
          {!r.canEdit ? <span>{c.std ?? '－'}</span> : <input key={String(c.std)} defaultValue={c.std ?? ''} inputMode="numeric" aria-label={`${r.name} ${ROLE[k]}の人員基準`}
            onBlur={(e) => e.target.value.trim() !== String(c.std ?? '') && void saveStd(r.code, k === 'therapist' ? 'therapists' : 'reception', e.target.value, r.name)}
            className="w-12 rounded border px-1 text-center" />}
        </td>
        <td className="border px-2 py-0.5 text-center tabular-nums">{c.start}{c.start !== c.end && <span className="text-slate-500"> → {c.end}</span>}</td>
        <td className={`border px-2 py-0.5 text-center tabular-nums ${tone(d)}`}>{diffText(d)}</td>
      </>
    );
  };
  const Names = ({ r, k }: { r: Row; k: Role }) => (
    <td className="border px-2 py-0.5 text-xs" aria-label={`${r.name} ${ROLE[k]}の氏名`}>
      {r.people[k].length === 0 && !r.paused.some((p) => p.role === k) && <span className="text-slate-400">（いない）</span>}
      {r.people[k].map((p, i) => (
        <span key={i} className="mr-2 inline-block whitespace-nowrap">
          {p.name}{p.head && <span className="ml-0.5 rounded bg-brand px-1 text-[10px] font-bold text-white">院長</span>}
          {p.notes.map((n, j) => <span key={j} className={`ml-0.5 ${NOTE_TONE[n.kind]}`}>（{NOTE(n)}）</span>)}
        </span>
      ))}
      {r.paused.filter((p) => p.role === k).map((p, i) => <span key={`p${i}`} className="mr-2 inline-block whitespace-nowrap text-slate-400">{p.name}（停止中）</span>)}
    </td>
  );
  const StoreRow = ({ r, indent }: { r: Row; indent?: boolean }) => (
    <tr>
      <td className="whitespace-nowrap border px-2 py-0.5">{indent && '　'}{r.name}{!indent && r.area && <span className="ml-1 text-[10px] text-slate-500">{r.area}</span>}</td>
      <Cells r={r} k="therapist" />
      <Cells r={r} k="reception" />
      <Names r={r} k="therapist" />
      <Names r={r} k="reception" />
    </tr>
  );
  const SumCells = ({ rows }: { rows: Row[] }) => (
    <>
      {(['therapist', 'reception'] as const).map((k) => {
        const s = sumOf(rows, k);
        return (
          <Fragment key={k}>
            <td className="border px-2 py-0.5 text-center tabular-nums">{s.std ?? '－'}</td>
            <td className="border px-2 py-0.5 text-center tabular-nums">{s.min}</td>
            <td className={`border px-2 py-0.5 text-center tabular-nums ${tone(s.diff)}`}>{diffText(s.diff)}</td>
          </Fragment>
        );
      })}
    </>
  );
  const Card = ({ title, rows }: { title: string; rows: Row[] }) => {
    const shortStores = rows.filter((r) => (diffOf(r.therapist) ?? 0) < 0 || (diffOf(r.reception) ?? 0) < 0);
    return (
      <div className="rounded border bg-white px-3 py-2 text-sm" aria-label={`${title}のまとめ`}>
        <b>{title}</b><span className="ml-1 text-xs text-slate-500">（{rows.length} 店舗）</span>
        {(['therapist', 'reception'] as const).map((k) => {
          const s = sumOf(rows, k);
          return (
            <div key={k} className="mt-0.5 flex items-center gap-1.5">
              <span className="w-12 text-slate-600">{ROLE[k]}</span>
              <span className="tabular-nums">基準 {s.std ?? '－'} ／ 在籍 {s.min}</span>
              <span className={`ml-auto rounded px-1.5 text-xs tabular-nums ${tone(s.diff)}`}>{diffText(s.diff)}</span>
            </div>
          );
        })}
        {shortStores.length > 0 && <div className="mt-0.5 text-xs text-red-700">足りない店舗：{shortStores.map((r) => r.name).join('・')}</div>}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-lg font-bold">人員の過不足</h1>
        <button type="button" onClick={() => go({ month: shiftYm(ym, -1) })} className="rounded border bg-white px-2 py-0.5 text-sm">‹ 前月</button>
        <b className="text-sm">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b>
        <button type="button" onClick={() => go({ month: shiftYm(ym, 1) })} className="rounded border bg-white px-2 py-0.5 text-sm">翌月 ›</button>
        <span className="inline-flex overflow-hidden rounded border text-sm" role="tablist" aria-label="見方">
          {([['all', '全体'], ['area', 'エリア別']] as const).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => go({ view: v })} className={`px-3 py-0.5 ${view === v ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{l}</button>
          ))}
        </span>
      </div>
      {msg && <p className={`mb-2 rounded px-3 py-1 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      {view === 'all' && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {groups.map((g) => <Card key={g.area || 'none'} title={g.area || 'エリア未設定'} rows={g.rows} />)}
          <Card title="全体" rows={data.rows} />
        </div>
      )}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse text-sm" aria-label="人員の過不足">
          <thead className="bg-slate-300 text-[11px]">
            <tr><th rowSpan={2} className="border px-2 text-left">{view === 'area' ? 'エリア・店舗' : '店舗'}</th><th colSpan={3} className="border px-2">施術者</th><th colSpan={3} className="border px-2">受付</th><th rowSpan={2} className="border px-2 text-left">施術者の氏名</th><th rowSpan={2} className="border px-2 text-left">受付の氏名</th></tr>
            <tr>{[0, 1].map((i) => ['人員基準', '在籍（月初→月末）', '過不足'].map((h) => <th key={`${i}${h}`} className="border px-2">{h}</th>))}</tr>
          </thead>
          <tbody>
            {view === 'all' ? data.rows.map((r) => <StoreRow key={r.code} r={r} />) : groups.map((g) => (
              <Fragment key={g.area || 'none'}>
                <tr className="bg-brand-light/60 font-bold"><td className="border px-2 py-0.5">{g.area || 'エリア未設定'} 計</td><SumCells rows={g.rows} /><td className="border" colSpan={2} /></tr>
                {g.rows.map((r) => <StoreRow key={r.code} r={r} indent />)}
              </Fragment>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={9} className="px-2 py-4 text-center text-slate-500">店舗がありません</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        在籍・氏名＝店舗設定の「スタッフ・シフト」に登録されている人（所属期間の中にいる人。休職の期間中・停止中は数えません）。過不足＝月の中でいちばん人が少ない日の人数 − 人員基準（月の途中で異動・退職・休職する人がいても、ひと月を通していられるかを見ます）。エリア・全体の在籍は、各店舗のいちばん少ない日の人数の合計です。
        <span className="ml-1 inline-block rounded bg-red-500 px-1 text-white">赤</span>＝足りない（採用・異動が必要）、<span className="rounded bg-green-100 px-1 text-green-800">緑</span>＝ちょうど、<span className="rounded bg-blue-100 px-1 text-blue-800">青</span>＝多い。人員基準は本部と管轄MG（管轄の店舗だけ）が入れられます。院長・退職／異動・休職の期間は、店舗設定のスタッフで入れます。
      </p>
    </div>
  );
}
