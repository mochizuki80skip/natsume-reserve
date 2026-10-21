// 予約表：氏名または診察券番号で、この店舗の予約を探す（30 日前〜1 年先）。行を押すとその日の予約表へ
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateJa, minToHm } from '@/lib/time';

interface Row { date: string; time: number; bed: number; text: string; source: 'WEB' | 'PHONE' | 'GRID'; phone: string; status: 'BOOKED' | 'CANCELLED' | 'MISSING'; visited: boolean }
const SRC = { WEB: 'WEB予約', PHONE: '電話予約', GRID: '予約表に入力' } as const;

export default function FindDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ rows: Row[]; names: string[]; today: string; q: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const j = await (await fetch(`/api/admin/find?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })).json();
      setRes({ ...j, q: q.trim() });
    } finally { setBusy(false); }
  }
  const isNo = /^[0-9０-９]+[a-zA-Z]?$/.test(res?.q ?? '');
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-12" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="予約を探す" className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white p-4 text-sm shadow-xl">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold">🔍 予約を探す</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="ml-auto text-slate-500">✕</button>
        </div>
        <form onSubmit={search} className="mt-2 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="氏名（一部でも可）または診察券番号" aria-label="氏名または診察券番号" className="min-w-0 flex-1 rounded border px-2 py-1.5" />
          <button type="submit" disabled={busy} className="rounded bg-brand px-4 py-1.5 font-bold text-white disabled:opacity-50">{busy ? '探しています…' : '探す'}</button>
        </form>
        <p className="mt-1 text-xs text-slate-500">この店舗の 30 日前〜1 年先の予約を探します（WEB 予約・電話予約・予約表に入れた名前）。診察券番号は、店舗設定で取り込んだ患者一覧で氏名に直して探します。</p>
        {res && (
          <div className="mt-3 min-h-0 overflow-auto">
            {isNo && <p className="mb-2 text-xs text-slate-600">診察券番号 {res.q} → {res.names.length ? <b>{res.names.join('・')}</b> : '患者一覧にありません（WEB 予約に書かれた番号だけで探しました）'}</p>}
            {res.rows.length === 0 ? <p className="py-4 text-center text-slate-500">見つかりませんでした</p> : (
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="px-2 py-1">日時</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">氏名</th><th className="px-2 py-1">種類</th><th className="px-2 py-1">電話</th><th className="px-2 py-1">状態</th></tr></thead>
                <tbody>
                  {res.rows.map((r, i) => {
                    const past = r.date < res.today;
                    return (
                      <tr key={i} onClick={() => { onClose(); navigate(`/admin/day/${r.date}`); }} className={`cursor-pointer border-t hover:bg-brand-light ${past ? 'text-slate-400' : ''}`} title="押すとその日の予約表を開きます">
                        <td className="whitespace-nowrap px-2 py-1 font-bold">{formatDateJa(r.date)} {minToHm(r.time)}</td>
                        <td className="px-2 py-1 text-center">{r.bed}</td>
                        <td className="px-2 py-1">{r.text}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-xs">{SRC[r.source]}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-xs tabular-nums">{r.phone}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-xs">{r.status === 'CANCELLED' ? '取消' : r.status === 'MISSING' ? '予約表にありません' : r.visited ? '来院済み' : past ? '過ぎた予約' : '予約中'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
