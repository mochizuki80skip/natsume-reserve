import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import CalendarClient from '@/components/CalendarClient';
import { useAdmin } from './Layout';

interface Day { date: string; published: boolean | null; closed: boolean; businessDay: boolean; effectivePublished: boolean }
interface Resp { month: string; today: string; days: Day[]; publishDaysAhead: number }

export default function CalendarPage() {
  const [sp] = useSearchParams();
  const { me } = useAdmin();
  const month = sp.get('month') ?? '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/calendar?month=${encodeURIComponent(month)}`);
  if (!me.store) return <p>店舗が登録されていません。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  return <CalendarClient key={data.month} month={data.month} today={data.today} days={data.days} publishDaysAhead={data.publishDaysAhead} onRefresh={reload} />;
}
