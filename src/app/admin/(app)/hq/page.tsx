import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { getGlobalSetting } from '@/lib/settings';
import HqClient from './HqClient';

export const dynamic = 'force-dynamic';

export default async function HqPage() {
  const session = await requireSession();
  if (session.role !== 'hq') redirect('/admin');
  const [stores, setting] = await Promise.all([
    prisma.store.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true, phone: true, beds: true, active: true } }),
    getGlobalSetting(),
  ]);
  return (
    <HqClient
      stores={stores}
      setting={{
        slotMinutes: setting.slotMinutes, newVisitSlots: setting.newVisitSlots, returnVisitSlots: setting.returnVisitSlots,
        webCutoffMinutes: setting.webCutoffMinutes, phoneCutoffMinutes: setting.phoneCutoffMinutes, phoneMarkRemaining: setting.phoneMarkRemaining,
        closeOnHolidays: setting.closeOnHolidays, adminExtraSlots: setting.adminExtraSlots, retentionDays: setting.retentionDays, hours: JSON.stringify(setting.hours, null, 2),
      }}
    />
  );
}
