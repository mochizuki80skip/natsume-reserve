import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidDate } from '@/lib/time';
import { isContinuationText, isTwoSlotName } from '@/lib/attendance';

const Create = z.object({
  date: z.string().refine(isValidDate), time: z.number().int(), bed: z.number().int().min(1),
  kind: z.enum(['ADVANCE', 'NOSHOW']), memo: z.string().max(200).optional(),
});

/** セルの予約をキャンセル名簿へ移す（セルは空になり、枠が空く） */
export async function POST(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { date, time, bed, kind, memo } = parsed.data;
  const storeId = ctx.store.id;
  const setting = await prisma.globalSetting.findUnique({ where: { id: 1 } });
  const step = setting?.slotMinutes ?? 15;
  const cell = await prisma.cell.findUnique({ where: { storeId_date_time_bed: { storeId, date, time, bed } } });
  if (!cell || !cell.text.trim()) return NextResponse.json({ error: 'セルが空です' }, { status: 404 });
  const next = isTwoSlotName(cell.text)
    ? await prisma.cell.findUnique({ where: { storeId_date_time_bed: { storeId, date, time: time + step, bed } } })
    : null;
  const cont = next && isContinuationText(next.text) ? next : null;
  const log = await prisma.$transaction(async (tx) => {
    const l = await tx.cancelLog.create({
      data: {
        storeId, date, time, bed, name: cell.text, contText: cont?.text ?? null, kind,
        source: cell.reservationId ? 'WEB' : 'MANUAL', reservationId: cell.reservationId, byCode: ctx.session.code, memo: memo || null,
      },
    });
    await tx.cell.delete({ where: { id: cell.id } });
    if (cont) await tx.cell.delete({ where: { id: cont.id } });
    if (cell.reservationId) await tx.reservation.update({ where: { id: cell.reservationId }, data: { status: 'CANCELLED' } });
    return l;
  });
  return NextResponse.json({ ok: true, log });
}

/** 名簿から予約表に戻す（元のセルが空いている場合のみ） */
export async function DELETE(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  const storeId = ctx.store.id;
  const log = await prisma.cancelLog.findFirst({ where: { id: String(id), storeId } });
  if (!log) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const setting = await prisma.globalSetting.findUnique({ where: { id: 1 } });
  const step = setting?.slotMinutes ?? 15;
  const times = log.contText ? [log.time, log.time + step] : [log.time];
  const busy = await prisma.cell.findMany({ where: { storeId, date: log.date, bed: log.bed, time: { in: times } } });
  if (busy.some((c) => c.text.trim())) return NextResponse.json({ error: '元の枠に別の予約が入っているため戻せません。空けてから戻してください。' }, { status: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.cell.deleteMany({ where: { storeId, date: log.date, bed: log.bed, time: { in: times } } });
    await tx.cell.create({ data: { storeId, date: log.date, time: log.time, bed: log.bed, text: log.name, reservationId: log.reservationId } });
    if (log.contText) await tx.cell.create({ data: { storeId, date: log.date, time: log.time + step, bed: log.bed, text: log.contText, reservationId: log.reservationId } });
    if (log.reservationId) await tx.reservation.update({ where: { id: log.reservationId }, data: { status: 'BOOKED' } }).catch(() => undefined);
    await tx.cancelLog.delete({ where: { id: log.id } });
  });
  return NextResponse.json({ ok: true });
}

/** 名簿のメモ更新 */
export async function PATCH(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id, memo } = await req.json().catch(() => ({}));
  const log = await prisma.cancelLog.findFirst({ where: { id: String(id), storeId: ctx.store.id } });
  if (!log) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await prisma.cancelLog.update({ where: { id: log.id }, data: { memo: String(memo ?? '').slice(0, 200) || null } });
  return NextResponse.json({ ok: true });
}
