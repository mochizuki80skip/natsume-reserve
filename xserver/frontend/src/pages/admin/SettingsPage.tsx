import { useFetch } from '@/lib/api';
import StoreSettingsForm from '@/components/StoreSettingsForm';
import StaffList from '@/components/StaffList';
import { useAdmin } from './Layout';

interface Resp {
  store: { code: string; name: string; phone: string; beds: number; defaultActiveBeds: number; maxTherapists: number; maxReception: number; publishDaysAhead: number; notifyPhone: string; hoursOverride: string };
  globalHours: string; canChangePassword: boolean; smsEnabled: boolean;
  members: { id: string; name: string; role: string; active: boolean }[];
}

export default function SettingsPage() {
  const { me, refreshMe } = useAdmin();
  const { data, error, reload } = useFetch<Resp>('/api/admin/settings');
  if (!me.store) return <p>店舗が登録されていません。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const refresh = () => { reload(); refreshMe(); };
  return (
    <div className="max-w-6xl">
      <h1 className="mb-4 text-xl font-bold">店舗設定：{data.store.name}（{data.store.code}）</h1>
      {/* 画面が広いときは 2 列（左：店舗設定、右：スタッフ・シフト）、半面では 1 列 */}
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <StoreSettingsForm store={data.store} globalHours={data.globalHours} canChangePassword={data.canChangePassword} smsEnabled={data.smsEnabled} onRefresh={refresh} />
        <StaffList key={data.members.map((m) => `${m.id}:${m.name}:${m.active}`).join(',')} members={data.members} maxTherapists={data.store.maxTherapists} maxReception={data.store.maxReception} onRefresh={reload} />
      </div>
    </div>
  );
}
