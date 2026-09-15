import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import BookingApp from './BookingApp';
import { smsEnabled } from '@/lib/sms';

export const dynamic = 'force-dynamic';

export default async function StorePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const store = await prisma.store.findUnique({ where: { code }, select: { code: true, name: true, phone: true, active: true } });
  if (!store || !store.active) notFound();
  return <BookingApp store={{ code: store.code, name: store.name, phone: store.phone }} smsEnabled={smsEnabled()} />;
}
