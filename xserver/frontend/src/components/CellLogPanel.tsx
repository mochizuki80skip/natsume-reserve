// この日に消した・別の名前に書き換えた入力の一覧（サーバーに残っている記録）。空いているセルなら「戻す」で元に戻せる
import { useEffect, useState } from 'react';
import { minToHm } from '@/lib/time';

interface Row { id: string; time: number; bed: number; before: string; after: string; byCode: string; createdAt: string }
interface Props { date: string; isEmpty: (time: number, bed: number) => boolean; onRestore: (time: number, bed: number, text: string) => void }

export default function CellLogPanel({ date, isEmpty, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null);
    fetch(`/api/admin/cell-log?date=${date}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => alive && setRows(j.rows ?? [])).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [open, date]);
  return (
    <details className="no-print mt-4 rounded border bg-white" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-bold">消した・書き換えた入力の履歴（この日）<span className="ml-2 text-xs font-normal text-slate-500">画面を閉じたあとでも、ここから元に戻せます</span></summary>
      <div className="overflow-x-auto border-t">
        {rows === null ? <p className="px-3 py-2 text-xs text-slate-500">読み込み中…</p> : rows.length === 0 ? <p className="px-3 py-2 text-xs text-slate-400">この日に消した入力はありません</p> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left text-xs"><th className="px-2 py-1">時刻</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">消した内容</th><th className="px-2 py-1">変更後</th><th className="px-2 py-1">いつ・だれ</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const empty = isEmpty(r.time, r.bed);
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1 font-mono">{minToHm(r.time)}</td>
                    <td className="px-2 py-1 text-center">{r.bed}</td>
                    <td className="px-2 py-1 font-bold">{r.before}</td>
                    <td className="px-2 py-1 text-slate-500">{r.after || '（空欄）'}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-xs text-slate-500">{r.createdAt.slice(5, 16)} {r.byCode}</td>
                    <td className="px-2 py-1 text-right">{empty
                      ? <button type="button" onClick={() => onRestore(r.time, r.bed, r.before)} className="text-xs text-brand underline">このセルに戻す</button>
                      : <span className="text-xs text-slate-400" title="今は別の入力があるため戻せません。空けてから戻してください">別の入力あり</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
