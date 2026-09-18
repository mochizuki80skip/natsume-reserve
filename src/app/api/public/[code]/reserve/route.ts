import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { buildInput } from '@/lib/public';
import { freeBedsAt, remainingAt, statusFor } from '@/lib/availability';
import { isPublished } from '@/lib/public';
import { isValidDate, nowJst, formatDateJa, minToHm } from '@/lib/time';
import { normalizeJpPhone, sendSms } from '@/lib/sms';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { loadStore } from '../_store';

export const dynamic = 'force-dynamic';

const Body = z.object({
  kind: z.enum(['NEW', 'RETURN']),
  date: z.string().refine(isValidDate, '日付が不正です'),
  time: z.number().int().min(0).max(24 * 60),
  name: z.string().trim().min(1, 'お名前を入力してください').max(40),
  phone: z.string().trim().min(10, '電話番号を入力してください').max(20),
  cardNo: z.string().trim().max(20).optional().default(''),
});

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!rateLimit(`reserve:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: '短時間に多くの操作がありました。しばらくしてからお試しください。' }, { status: 429 });
  }
  const ctx = await loadStore(code);
  if (!ctx) return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
  const { store, setting } = ctx;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' }, { status: 400 });
  }
  const body = parsed.data;
  if (body.kind === 'RETURN' && !body.cardNo) {
    return NextResponse.json({ error: '診察券番号を入力してください' }, { status: 400 });
  }
  const phone = normalizeJpPhone(body.phone);
  if (!phone) return NextResponse.json({ error: '電話番号の形式が正しくありません' }, { status: 400 });

  const { date: today } = nowJst();
  const day = await prisma.dayStatus.findUnique({ where: { storeId_date: { storeId: store.id, date: body.date } } });
  if (!isPublished(store, body.date, today, day?.published)) {
    return NextResponse.json({ error: 'この日は現在WEB予約を受け付けていません' }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 同じ店舗・同じ日の予約処理を直列化して二重予約を防ぐ
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${store.id}:${body.date}`}))`;
      const cells = await tx.cell.findMany({ where: { storeId: store.id, date: body.date, bed: { gt: 0 } } });
      const input = await buildInput(store, setting, body.date, body.kind, { closed: day?.closed, cells });
      const free = freeBedsAt(input, body.time);
      const status = statusFor(input, body.time, remainingAt(input, body.time));
      if (status !== 'open') {
        throw new Error(status === 'phone' ? 'この時間はお電話でのみ受付しております' : 'この時間は空きがなくなりました。別の時間をお選びください');
      }
      const bed = free[0];
      const reservation = await tx.reservation.create({
        data: {
          storeId: store.id, date: body.date, time: body.time, bed, kind: body.kind,
          cardNo: body.kind === 'RETURN' ? body.cardNo : null, name: body.name, phone,
        },
      });
      const cellData = [];
      for (let k = 0; k < input.neededSlots; k++) {
        cellData.push({
          storeId: store.id, date: body.date, time: body.time + k * setting.slotMinutes, bed,
          text: k === 0 ? (body.kind === 'NEW' ? `${body.name}（初）` : body.name) : '上記初診対応',
          reservationId: reservation.id,
        });
      }
      await tx.cell.createMany({ data: cellData });
      return reservation;
    });

    const smsBody =
      `【${store.name}】ご予約を承りました。\n` +
      `${formatDateJa(body.date, false)} ${minToHm(body.time)}〜\n` +
      (body.kind === 'NEW' ? '初めての方は10分前にお越しください。\n' : '') +
      `変更・キャンセルはお電話（${store.phone}）へお願いします。`;
    const smsStatus = await sendSms(phone, smsBody);
    await prisma.reservation.update({ where: { id: result.id }, data: { smsStatus } });
    if (store.notifyPhone) {
      const to = normalizeJpPhone(store.notifyPhone);
      if (to) await sendSms(to, `【WEB予約】${formatDateJa(body.date, false)} ${minToHm(body.time)} ${body.kind === 'NEW' ? '初回' : '通院中'} ${body.name} 様`);
    }
    return NextResponse.json({ ok: true, id: result.id, date: body.date, time: body.time, smsStatus });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '予約に失敗しました';
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
