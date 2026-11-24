// 新自・新三の「週の通院予定」（1〜5 回）。店舗・本部・管轄MG が選ぶ。選んだらすぐ保存
import { useState } from 'react';

export default function WeeklyPlanSelect({ id, value, ro }: { id: string; value: number | null | undefined; ro?: boolean }) {
  const [v, setV] = useState<string>(value ? String(value) : '');
  const [err, setErr] = useState(false);
  if (ro) return <span className="block text-center">{v ? `${v}回` : ''}</span>;
  const save = async (nv: string) => {
    const old = v;
    setV(nv); setErr(false);
    const r = await fetch('/api/admin/accidents/plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, plan: nv === '' ? null : Number(nv) }) }).catch(() => null);
    if (!r || !r.ok) { setV(old); setErr(true); }
  };
  return (
    <select value={v} onChange={(e) => void save(e.target.value)} aria-label="週の通院予定" title={err ? '保存できませんでした' : '週に何回通院する予定か'}
      className={`w-full bg-transparent text-center ${err ? 'text-red-700' : ''} ${v ? '' : 'text-slate-400'}`}>
      <option value="">－</option>
      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}回</option>)}
    </select>
  );
}
