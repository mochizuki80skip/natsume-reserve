import { notFound } from 'next/navigation';
import { requireSession, resolveStore } from '@/lib/admin';
import { getGlobalSetting } from '@/lib/settings';
import { loadDay } from '@/lib/dayData';
import { isValidDate, nowJst } from '@/lib/time';
import { isPublished } from '@/lib/public';
import DayGrid from './DayGrid';

export const dynamic = 'force-dynamic';

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();
  const session = await requireSession();
  const store = await resolveStore(session);
  if (!store) return <p>店舗が登録されていません。本部画面から店舗を追加してください。</p>;
  const setting = await getGlobalSetting();
  const data = await loadDay(store, setting, date);
  const today = nowJst().date;
  return (
    <DayGrid
      key={`${store.id}:${date}`}
      data={data}
      storeName={store.name}
      published={isPublished(store, date, today, data.day.published)}
      today={today}
    />
  );
}
