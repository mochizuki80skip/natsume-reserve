// 人員の過不足 /admin/staffing?month=YYYY-MM（本部＝全店、管轄MG＝エリアの店舗）。人員基準（施術者・受付）と、その月の在籍人数を店舗ごとに。採用の判断に使う
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { halfNum } from '@/lib/format';

interface Count { std: number | null; start: number; end: number; min: number }
interface Row {
  code: string; name: string; area: string; canEdit: boolean; therapist: Count; reception: Count;
  changes: { name: string; role: 'therapist' | 'reception'; in: boolean; date: string; joinType: string | null }[];
  paused: { name: string; role: 'therapist' | 'reception' }[];
}
const ROLE = { therapist: '施術者', reception: '受付' } as const;
const shiftYm = (ym: string, d: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + d, 1)).toISOString().slice(0, 7);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

/** 過不足：月の中でいちばん少ない日の人数 − 基準 */
const diffOf = (c: Count) => (c.std === null ? null : c.min - c.std);
const tone = (d: number | null) => (d === null ? 'bg-slate-100 text-slate-500' : d < 0 ? 'bg-red-500 font-bold text-white' : d === 0 ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800');

export default function StaffingPage() {
  const [sp, setSp] = useSearchParams();
  const { data, error, reload } = useFetch<{ month: string; rows: Row[] }>(`/api/admin/staffing?month=${encodeURIComponent(sp.get('month') ?? '')}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const ym = data.month;
  async function saveStd(code: string, key: 'therapists' | 'reception', raw: string, name: string) {
    const v = halfNum(raw).trim();
    const r = await fetch('/api/admin/staffing/std', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store: code, [key]: v === '' ? null : Number(v) }) });
    const j = await r.json().catch(() => ({}));
    setMsg({ ok: r.ok, text: r.ok ? `${name} の人員基準を保存しました` : (j as { error?: string }).error ?? '保存できませんでした' });
    if (r.ok) reload();
  }
  const short = (k: 'therapist' | 'reception') => data.rows.reduce((a, r) => a + Math.max(0, -(diffOf(r[k]) ?? 0)), 0);

  const Cells = ({ r, k }: { r: Row; k: 'therapist' | 'reception' }) => {
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
        <td className={`border px-2 py-0.5 text-center tabular-nums ${tone(d)}`}>{d === null ? '基準なし' : d < 0 ? `${d} 人` : d === 0 ? '±0' : `＋${d} 人`}</td>
      </>
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-lg font-bold">人員の過不足（全店）</h1>
        <button type="button" onClick={() => setSp({ month: shiftYm(ym, -1) })} className="rounded border bg-white px-2 py-0.5 text-sm">‹ 前月</button>
        <b className="text-sm">{Number(ym.slice(0, 4))}年{Number(ym.slice(5))}月</b>
        <button type="button" onClick={() => setSp({ month: shiftYm(ym, 1) })} className="rounded border bg-white px-2 py-0.5 text-sm">翌月 ›</button>
        <span className="rounded bg-red-100 px-2 py-0.5 text-sm font-bold text-red-800">足りない：施術者 {short('therapist')} 人・受付 {short('reception')} 人</span>
      </div>
      {msg && <p className={`mb-2 rounded px-3 py-1 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse text-sm" aria-label="人員の過不足">
          <thead className="bg-slate-300 text-[11px]">
            <tr><th rowSpan={2} className="border px-2 text-left">店舗</th><th colSpan={3} className="border px-2">施術者</th><th colSpan={3} className="border px-2">受付</th><th rowSpan={2} className="border px-2 text-left">この月の入れ替わり・休職</th></tr>
            <tr>{[0, 1].map((i) => ['人員基準', '在籍（月初→月末）', '過不足'].map((h) => <th key={`${i}${h}`} className="border px-2">{h}</th>))}</tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.code}>
                <td className="whitespace-nowrap border px-2 py-0.5">{r.name}{r.area && <span className="ml-1 text-[10px] text-slate-500">{r.area}</span>}</td>
                <Cells r={r} k="therapist" />
                <Cells r={r} k="reception" />
                <td className="border px-2 py-0.5 text-xs">
                  {r.changes.map((c, i) => (
                    <span key={i} className={`mr-2 inline-block ${c.in ? 'text-green-800' : 'text-red-700'}`}>
                      {md(c.date)} {c.in ? (c.joinType === 'TRANSFER' ? '異動で来る' : c.joinType === 'NEW' ? '入社' : '開始') : '終了（異動・退職）'}：{c.name}（{ROLE[c.role]}）
                    </span>
                  ))}
                  {r.paused.map((p, i) => <span key={`p${i}`} className="mr-2 inline-block text-slate-500">休職・停止中：{p.name}（{ROLE[p.role]}）</span>)}
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-500">店舗がありません</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        在籍＝店舗設定の「スタッフ・シフト」に登録されている人（所属期間の中にいる人。休職・停止中は数えません）。過不足＝月の中でいちばん人が少ない日の人数 − 人員基準（月の途中で異動・退職する人がいても、ひと月を通していられるかを見ます）。
        <span className="ml-1 inline-block rounded bg-red-500 px-1 text-white">赤</span>＝足りない（採用・異動が必要）、<span className="rounded bg-green-100 px-1 text-green-800">緑</span>＝ちょうど、<span className="rounded bg-blue-100 px-1 text-blue-800">青</span>＝多い。人員基準は本部と管轄MG（管轄の店舗だけ）が入れられます。
      </p>
    </div>
  );
}
