import { Navigate } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import HqClient from '@/components/HqClient';
import { useAdmin } from './Layout';

interface Resp {
  stores: { code: string; name: string; phone: string; beds: number; active: boolean }[];
  setting: { slotMinutes: number; newVisitSlots: number; returnVisitSlots: number; webCutoffMinutes: number; phoneCutoffMinutes: number; phoneMarkRemaining: number; closeOnHolidays: boolean; adminExtraSlots: number; retentionDays: number; hours: string };
}

export default function HqPage() {
  const { me, refreshMe } = useAdmin();
  const { data, error, reload } = useFetch<Resp>(me.session.role === 'hq' ? '/api/admin/hq' : null);
  if (me.session.role !== 'hq') return <Navigate to="/admin" replace />;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  return <HqClient key={data.stores.map((s) => `${s.code}:${s.name}:${s.active}`).join(',')} stores={data.stores} setting={data.setting} onRefresh={() => { reload(); refreshMe(); }} />;
}
