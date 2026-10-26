// 店舗：本部・管轄MG が入れた（取り消した）臨時休業の通知。「確認しました」を押すまで出し続ける
import { Link } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { formatDateJa } from '@/lib/time';

interface Notice { date: string; part: 'ALL' | 'AM' | 'PM' | null; note: string; by: string; booked: number }
const PART_JA = { ALL: '終日', AM: '午前', PM: '午後' } as const;

export default function ClosureNotices() {
  const { data, reload } = useFetch<{ notices: Notice[] }>('/api/admin/closures/notices');
  const list = data?.notices ?? [];
  if (!list.length) return null;
  async function ack(date: string) {
    await fetch('/api/admin/closures/ack', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) });
    reload();
  }
  return (
    <div className="no-print border-b border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-900" role="alert" aria-label="臨時休業の通知">
      {list.map((n) => (
        <div key={n.date} className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 py-0.5">
          {n.part ? (
            <span><b>{n.by}が {formatDateJa(n.date, false)} {PART_JA[n.part]} を臨時休業にしました</b>{n.note && `（${n.note}）`}。
              {n.booked > 0 ? <b> この時間に予約が {n.booked}件 入っています。患者様へ連絡してください。</b> : ' この時間に予約はありません。'}</span>
          ) : <span><b>{n.by}が {formatDateJa(n.date, false)} の臨時休業を取り消しました。</b></span>}
          <Link to={`/admin/day/${n.date}`} className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs">予約表を開く</Link>
          <button type="button" onClick={() => ack(n.date)} className="rounded bg-red-700 px-2 py-0.5 text-xs font-bold text-white">確認しました</button>
        </div>
      ))}
    </div>
  );
}
