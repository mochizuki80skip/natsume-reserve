import { requireSession, resolveStore } from '@/lib/admin';
import { getGlobalSetting } from '@/lib/settings';
import StoreSettingsForm from './StoreSettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSession();
  const store = await resolveStore(session);
  if (!store) return <p>店舗が登録されていません。</p>;
  const setting = await getGlobalSetting();
  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">店舗設定：{store.name}（{store.code}）</h1>
      <StoreSettingsForm
        store={{ name: store.name, phone: store.phone, beds: store.beds, defaultActiveBeds: store.defaultActiveBeds, maxTherapists: store.maxTherapists, maxReception: store.maxReception, publishDaysAhead: store.publishDaysAhead, notifyPhone: store.notifyPhone ?? '', hoursOverride: store.hoursOverride ? JSON.stringify(store.hoursOverride, null, 2) : '' }}
        globalHours={JSON.stringify(setting.hours, null, 2)}
        canChangePassword={session.role === 'store'}
      />
    </div>
  );
}
