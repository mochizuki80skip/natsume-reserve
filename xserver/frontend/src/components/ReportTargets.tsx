// 本部・管轄MG：日報の目標（月ごと・店舗ごと）。窓口集計（全店）の画面で、売上目標といっしょに入れる
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { halfNum } from '@/lib/format';

interface Resp { month: string; sources: { src: string; label: string; fmt: string }[]; rows: { code: string; name: string; canEdit: boolean; values: Record<string, number> }[] }

export default function ReportTargets({ month }: { month: string }) {
  const { data, reload } = useFetch<Resp>(`/api/admin/report/targets?month=${encodeURIComponent(month)}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data || data.sources.length === 0) return null;
  async function save(store: string, name: string, src: string, label: string, raw: string) {
    const v = halfNum(raw).replace(/[,\s¥￥]/g, '');
    const r = await fetch('/api/admin/report/targets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store, month: data!.month, src, value: v === '' ? null : Number(v) }) });
    const j = await r.json().catch(() => ({}));
    setMsg({ ok: r.ok, text: r.ok ? `${name} の${label}の目標を保存しました` : (j as { error?: string }).error ?? '保存できませんでした' });
    if (r.ok) reload();
  }
  return (
    <section className="mt-6" aria-label="日報の目標">
      <h2 className="text-base font-bold">日報の目標（{Number(data.month.slice(5))}月）</h2>
      <p className="text-xs text-slate-500">店舗の日報の「目標」に出ます。項目は本部（店舗・設定）の「日報の項目」で決めます。</p>
      {msg && <p className={`mt-1 rounded px-3 py-1 text-sm ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <div className="mt-1 overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-100 text-xs"><tr><th className="border px-2 py-1 text-left">店舗</th>{data.sources.map((s) => <th key={s.src} className="border px-2 py-1">{s.label}</th>)}</tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.code}>
                <td className="whitespace-nowrap border px-2 py-0.5">{r.name}</td>
                {data.sources.map((s) => {
                  const cur = r.values[s.src];
                  return (
                    <td key={s.src} className="border px-1 py-0.5 text-center">
                      {r.canEdit
                        ? <input key={`${month}:${cur}`} defaultValue={cur ?? ''} inputMode="decimal" aria-label={`${r.name} ${s.label}の目標`} onBlur={(e) => e.target.value.trim() !== String(cur ?? '') && save(r.code, r.name, s.src, s.label, e.target.value)} className="w-24 rounded border px-1 text-right" />
                        : <span className="tabular-nums">{cur ?? '－'}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
