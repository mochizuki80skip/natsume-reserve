import { requireSession, resolveStore } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { getGlobalSetting, storeSessions } from '@/lib/settings';
import { isPublished } from '@/lib/public';
import { datesOfMonth, isValidMonth, nowJst } from '@/lib/time';
import CalendarClient from './CalendarClient';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const session = await requireSession();
  const store = await resolveStore(session);
  if (!store) return <p>店舗が登録されていません。</p>;
  const today = nowJst().date;
  const ym = month && isValidMonth(month) ? month : today.slice(0, 7);
  const setting = await getGlobalSetting();
  const dates = datesOfMonth(ym);
  const rows = await prisma.dayStatus.findMany({ where: { storeId: store.id, date: { in: dates } } });
  const map = new Map(rows.map((r) => [r.date, r]));
  const days = dates.map((date) => {
    const r = map.get(date);
    const open = storeSessions(store, setting, date, r?.closed).length > 0;
    return {
      date,
      published: r?.published ?? null,
      closed: r?.closed ?? false,
      businessDay: open || (r?.closed ?? false), // 臨時休診で閉じている日も営業日として扱い、解除できるようにする
      effectivePublished: isPublished(store, date, today, r?.published),
    };
  });
  return <CalendarClient month={ym} today={today} days={days} publishDaysAhead={store.publishDaysAhead} />;
}
