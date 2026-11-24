// この日の予約表の変更の履歴（入力・書き換え・消した・キャンセル・予約変更）。どのアカウントで操作したかも出す。
// 消した・書き換えた入力は、空いているセルなら「戻す」で元に戻せる
import { useEffect, useState } from 'react';
import { minToHm } from '@/lib/time';

interface Row { id: string; time: number; bed: number; before: string; after: string; byCode: string; who?: string; kind?: string; note?: string; createdAt: string }
const KIND_JA: Record<string, string> = { INPUT: '入力', EDIT: '書き換え', DELETE: '消した', CANCEL: 'キャンセル', MOVE: '予約変更', RESTORE: '名簿から戻した' };
const KIND_CLASS: Record<string, string> = { INPUT: 'bg-sky-100 text-sky-800', EDIT: 'bg-amber-100 text-amber-800', DELETE: 'bg-red-100 text-red-800', CANCEL: 'bg-red-100 text-red-800', MOVE: 'bg-violet-100 text-violet-800', RESTORE: 'bg-emerald-100 text-emerald-800' };
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
      <summary className="cursor-pointer px-3 py-2 text-sm font-bold">この日の変更の履歴（だれが・いつ・何を）<span className="ml-2 text-xs font-normal text-slate-500">消した・書き換えた入力は、画面を閉じたあとでも、ここから元に戻せます</span></summary>
      <div className="overflow-x-auto border-t">
        {rows === null ? <p className="px-3 py-2 text-xs text-slate-500">読み込み中…</p> : rows.length === 0 ? <p className="px-3 py-2 text-xs text-slate-400">この日の変更の記録はありません</p> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left text-xs"><th className="px-2 py-1">時刻</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">操作</th><th className="px-2 py-1">変更前</th><th className="px-2 py-1">変更後・詳細</th><th className="px-2 py-1">いつ・どのアカウント</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const empty = isEmpty(r.time, r.bed);
                const kind = r.kind ?? (r.after ? 'EDIT' : 'DELETE');
                const canBack = (kind === 'EDIT' || kind === 'DELETE') && r.before !== '';
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1 font-mono">{minToHm(r.time)}</td>
                    <td className="px-2 py-1 text-center">{r.bed}</td>
                    <td className="whitespace-nowrap px-2 py-1"><span className={`rounded px-1.5 text-xs ${KIND_CLASS[kind] ?? 'bg-slate-100'}`}>{KIND_JA[kind] ?? kind}</span></td>
                    <td className="px-2 py-1 font-bold">{r.before}</td>
                    <td className="px-2 py-1 text-slate-500">{r.after || (kind === 'EDIT' || kind === 'DELETE' ? '（空欄）' : '')}{r.note && <span className="block text-xs text-slate-500">{r.note}</span>}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-xs text-slate-500">{r.createdAt.slice(5, 16)} {r.who ?? r.byCode}</td>
                    <td className="px-2 py-1 text-right">{!canBack ? null : empty
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
