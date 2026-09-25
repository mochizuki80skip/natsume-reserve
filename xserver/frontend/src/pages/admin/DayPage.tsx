// 予約表 /admin/day/<日付>
import { useParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { isValidDate } from '@/lib/time';
import type { DayResponse } from '@/lib/types';
import DayGrid from '@/components/DayGrid';
import { useAdmin } from './Layout';

export default function DayPage() {
  const { date = '' } = useParams();
  const { me } = useAdmin();
  const valid = isValidDate(date);
  const { data, error, loading, reload } = useFetch<DayResponse>(valid ? `/api/admin/day?date=${date}` : null);
  if (!valid) return <p className="text-sm text-red-700">日付が正しくありません。</p>;
  if (!me.store) return <p>店舗が登録されていません。本部画面から店舗を追加してください。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">{loading ? '読み込み中…' : ''}</p>;
  return (
    <DayGrid
      key={`${me.store.id}:${date}`}
      data={data.data}
      storeName={data.storeName}
      published={data.published}
      today={data.today}
      onRefresh={reload}
    />
  );
}
