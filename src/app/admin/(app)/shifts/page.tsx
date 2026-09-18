import { requireSession, resolveStore } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { getGlobalSetting, storeSessions } from '@/lib/settings';
import { datesOfMonth, isValidMonth, nowJst } from '@/lib/time';
import ShiftTable from './ShiftTable';

export const dynamic = 'force-dynamic';

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const session = await requireSession();
  const store = await resolveStore(session);
  if (!store) return <p>店舗が登録されていません。</p>;
  const today = nowJst().date;
  const ym = month && isValidMonth(month) ? month : today.slice(0, 7);
  const setting = await getGlobalSetting();
  const dates = datesOfMonth(ym);
  const [members, shifts, days] = await Promise.all([
    prisma.staffMember.findMany({ where: { storeId: store.id, active: true }, orderBy: { order: 'asc' } }),
    prisma.shift.findMany({ where: { storeId: store.id, date: { in: dates } } }),
    prisma.dayStatus.findMany({ where: { storeId: store.id, date: { in: dates } } }),
  ]);
  const closedMap = new Map(days.map((d) => [d.date, d.closed]));
  const closedDates = dates.filter((d) => storeSessions(store, setting, d, closedMap.get(d)).length === 0);
  return (
    <ShiftTable
      month={ym}
      dates={dates}
      closedDates={closedDates}
      members={members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
      shifts={shifts.map((s) => ({ staffId: s.staffId, date: s.date, status: s.status }))}
    />
  );
}
