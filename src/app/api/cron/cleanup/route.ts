// 個人情報の保持期間（既定 60 日）を過ぎた予約・予約表セルを削除する。Vercel Cron から毎日呼ばれる
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getGlobalSetting } from '@/lib/settings';
import { addDays, nowJst } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const setting = await getGlobalSetting();
  const cutoff = addDays(nowJst().date, -setting.retentionDays);
  const [cells, reservations, days, beds, staff] = await prisma.$transaction([
    prisma.cell.deleteMany({ where: { date: { lt: cutoff } } }),
    prisma.reservation.deleteMany({ where: { date: { lt: cutoff } } }),
    prisma.dayStatus.deleteMany({ where: { date: { lt: cutoff } } }),
    prisma.bedStatus.deleteMany({ where: { date: { lt: cutoff } } }),
    prisma.staffDay.deleteMany({ where: { date: { lt: cutoff } } }),
  ]);
  return NextResponse.json({ ok: true, cutoff, deleted: { cells: cells.count, reservations: reservations.count, days: days.count, beds: beds.count, staff: staff.count } });
}
