import { Navigate } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import HqClient from '@/components/HqClient';
import StoresPageEditor, { type ListingStore } from '@/components/StoresPageEditor';
import ReferralEditor from '@/components/ReferralEditor';
import PrivacyEditor from '@/components/PrivacyEditor';
import GoodsEditor from '@/components/GoodsEditor';
import ReportItemsEditor from '@/components/ReportItemsEditor';
import ClosureBulkEditor from '@/components/ClosureBulkEditor';
import JibaiNotifyEditor from '@/components/JibaiNotifyEditor';
import { useAdmin } from './Layout';

interface Resp {
  stores: ({ code: string; name: string; phone: string; beds: number; active: boolean; area?: string; hqOnly?: boolean; jibaiOnly?: boolean } & ListingStore)[];
  storesPageOpen?: boolean;
  areas?: string[];
  setting: { slotMinutes: number; newVisitSlots: number; returnVisitSlots: number; webCutoffMinutes: number; phoneCutoffMinutes: number; phoneMarkRemaining: number; closeOnHolidays: boolean; adminExtraSlots: number; retentionDays: number; hours: string };
}

export default function HqPage() {
  const { me, refreshMe } = useAdmin();
  const { data, error, reload } = useFetch<Resp>(me.session.role === 'hq' ? '/api/admin/hq' : null);
  if (me.session.role !== 'hq') return <Navigate to="/admin" replace />;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  return (
    <>
      <HqClient key={data.stores.map((s) => `${s.code}:${s.name}:${s.active}`).join(',')} stores={data.stores} areas={data.areas ?? []} setting={data.setting} onRefresh={() => { reload(); refreshMe(); }} />
      <ClosureBulkEditor />
      <StoresPageEditor stores={data.stores.filter((s) => !s.jibaiOnly)} open={!!data.storesPageOpen} onRefresh={reload} />
      <ReferralEditor pageOpen={!!data.storesPageOpen} />
      <ReferralEditor pageOpen={!!data.storesPageOpen} kind="media" />
      <JibaiNotifyEditor />
      <GoodsEditor />
      <ReportItemsEditor />
      <PrivacyEditor />
    </>
  );
}
