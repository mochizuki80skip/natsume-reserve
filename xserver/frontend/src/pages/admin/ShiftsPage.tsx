import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import ShiftTable from '@/components/ShiftTable';
import { useAdmin } from './Layout';

interface Resp { month: string; dates: string[]; closedDates: string[]; members: { id: string; name: string; role: string }[]; shifts: { staffId: string; date: string; status: string }[] }

export default function ShiftsPage() {
  const [sp] = useSearchParams();
  const { me } = useAdmin();
  const month = sp.get('month') ?? '';
  const { data, error } = useFetch<Resp>(`/api/admin/shifts?month=${encodeURIComponent(month)}`);
  if (!me.store) return <p>店舗が登録されていません。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  return <ShiftTable key={data.month} month={data.month} dates={data.dates} closedDates={data.closedDates} members={data.members} shifts={data.shifts} />;
}
