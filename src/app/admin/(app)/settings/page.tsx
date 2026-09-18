import { requireSession, resolveStore } from '@/lib/admin';
import { getGlobalSetting } from '@/lib/settings';
import StoreSettingsForm from './StoreSettingsForm';
import StaffList from './StaffList';
import { prisma } from '@/lib/prisma';
import { smsEnabled } from '@/lib/sms';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSession();
  const store = await resolveStore(session);
  if (!store) return <p>店舗が登録されていません。</p>;
  const setting = await getGlobalSetting();
  const members = await prisma.staffMember.findMany({ where: { storeId: store.id }, orderBy: { order: 'asc' } });
  return (
    <div className="max-w-6xl">
      <h1 className="mb-4 text-xl font-bold">店舗設定：{store.name}（{store.code}）</h1>
      {/* 画面が広いときは 2 列（左：店舗設定、右：スタッフ・シフト）、半面では 1 列 */}
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <StoreSettingsForm
          store={{ code: store.code, name: store.name, phone: store.phone, beds: store.beds, defaultActiveBeds: store.defaultActiveBeds, maxTherapists: store.maxTherapists, maxReception: store.maxReception, publishDaysAhead: store.publishDaysAhead, notifyPhone: store.notifyPhone ?? '', hoursOverride: store.hoursOverride ? JSON.stringify(store.hoursOverride, null, 2) : '' }}
          globalHours={JSON.stringify(setting.hours, null, 2)}
          canChangePassword={session.role === 'store'}
          smsEnabled={smsEnabled()}
        />
        <StaffList members={members.map((m) => ({ id: m.id, name: m.name, role: m.role, active: m.active }))} maxTherapists={store.maxTherapists} maxReception={store.maxReception} />
      </div>
    </div>
  );
}
