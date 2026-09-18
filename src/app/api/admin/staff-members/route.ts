import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';

const Create = z.object({ name: z.string().trim().min(1).max(30), role: z.enum(['THERAPIST', 'RECEPTION']) });
const Update = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(30).optional(),
  role: z.enum(['THERAPIST', 'RECEPTION']).optional(),
  active: z.boolean().optional(),
  move: z.enum(['up', 'down']).optional(),
});

/** スタッフ追加 */
export async function POST(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '氏名を入力してください' }, { status: 400 });
  const { name, role } = parsed.data;
  const max = role === 'THERAPIST' ? ctx.store.maxTherapists : ctx.store.maxReception;
  const count = await prisma.staffMember.count({ where: { storeId: ctx.store.id, role, active: true } });
  if (count >= max) return NextResponse.json({ error: `${role === 'THERAPIST' ? '施術者' : '受付'}は最大 ${max} 名です（店舗設定で変更できます）` }, { status: 400 });
  const last = await prisma.staffMember.findFirst({ where: { storeId: ctx.store.id }, orderBy: { order: 'desc' } });
  const m = await prisma.staffMember.create({ data: { storeId: ctx.store.id, name, role, order: (last?.order ?? 0) + 1 } });
  return NextResponse.json({ ok: true, member: m });
}

/** スタッフ更新（氏名・区分・稼働・並び順） */
export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { id, move, ...rest } = parsed.data;
  const m = await prisma.staffMember.findFirst({ where: { id, storeId: ctx.store.id } });
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (move) {
    const all = await prisma.staffMember.findMany({ where: { storeId: ctx.store.id }, orderBy: { order: 'asc' } });
    const i = all.findIndex((x) => x.id === id);
    const j = move === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < all.length) {
      await prisma.$transaction([
        prisma.staffMember.update({ where: { id: all[i].id }, data: { order: all[j].order } }),
        prisma.staffMember.update({ where: { id: all[j].id }, data: { order: all[i].order } }),
      ]);
    }
  }
  if (Object.keys(rest).length) await prisma.staffMember.update({ where: { id }, data: rest });
  return NextResponse.json({ ok: true });
}

/** スタッフ削除（シフトも削除） */
export async function DELETE(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  const m = await prisma.staffMember.findFirst({ where: { id: String(id), storeId: ctx.store.id } });
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await prisma.staffMember.delete({ where: { id: m.id } });
  return NextResponse.json({ ok: true });
}
