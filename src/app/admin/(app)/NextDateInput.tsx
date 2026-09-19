'use client';
import { useState } from 'react';

/** キャンセル名簿の「次回予約日」入力欄。変更すると自動保存する（予約表・予約来院ログで共用） */
export default function NextDateInput({ id, value, className }: { id: string; value: string | null; className?: string }) {
  const [v, setV] = useState(value ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  async function save(next: string) {
    setV(next);
    setState('saving');
    const r = await fetch('/api/admin/cancel', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, nextDate: next }) });
    setState(r.ok ? 'saved' : 'error');
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input type="date" value={v} onChange={(e) => save(e.target.value)} title="次回予約が取れている場合はその日付" className={className ?? 'rounded border px-1 text-xs'} />
      {state === 'saving' && <span className="text-[10px] text-slate-400">保存中</span>}
      {state === 'error' && <span className="text-[10px] text-red-600">保存失敗</span>}
    </span>
  );
}
