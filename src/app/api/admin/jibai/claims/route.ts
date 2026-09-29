// 自賠請求（速報集計）：明細の一括保存・削除
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidYm, jibaiLog, listClaims, MAX_AMOUNT, yenFmt } from '@/lib/jibaiServer';

const ClaimIn = z.object({
  id: z.string().min(1).max(40).nullable().optional(),
  patientNo: z.string().max(20).default(''),
  patientName: z.string().max(40).nullable().optional(),
  invoiceYm: z.string().nullable().optional(),
  days: z.number().int().min(0).max(31).nullable().optional(),
  amount: z.number().int().min(0).max(MAX_AMOUNT),
  source: z.enum(['OCR', 'MANUAL']).optional(),
});
const PutBody = z.object({ ym: z.string(), claims: z.array(ClaimIn).max(500) });

/** 店舗は提出済みの月を編集できない（「提出を取り消す」で再開する） */
async function editableError(role: string, storeId: string, ym: string): Promise<NextResponse | null> {
  if (role === 'hq') return null;
  const m = await prisma.jibaiMonth.findUnique({ where: { storeId_ym: { storeId, ym } } });
  if (m && m.status === 'SUBMITTED') return NextResponse.json({ error: 'この月は提出済みです。修正するには「提出を取り消す」を押してください' }, { status: 409 });
  return null;
}

export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '入力内容を確認してください（金額は数字、実日数は 0〜31）' }, { status: 400 });
  const { ym, claims } = parsed.data;
  if (!isValidYm(ym)) return NextResponse.json({ error: '対象月が不正です' }, { status: 400 });
  const err = await editableError(ctx.session.role, ctx.store.id, ym);
  if (err) return err;
  const sid = ctx.store.id;
  const by = ctx.session.code;
  const isHq = ctx.session.role === 'hq';
  let added = 0, updated = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const last = await tx.jibaiClaim.findFirst({ where: { storeId: sid, ym }, orderBy: { seq: 'desc' }, select: { seq: true } });
      let seq = last?.seq ?? 0;
      for (const r of claims) {
        const patientNo = r.patientNo.trim().slice(0, 20);
        const patientName = (r.patientName ?? '').trim().slice(0, 40) || null;
        const invoiceYm = isValidYm(r.invoiceYm) ? r.invoiceYm : null;
        const days = r.days ?? null;
        const source = r.source === 'OCR' ? 'OCR' : 'MANUAL';
        if (r.id) {
          const old = await tx.jibaiClaim.findFirst({ where: { id: r.id, storeId: sid, ym } });
          if (!old) throw new Error('NOT_FOUND');
          if (old.verifiedAmount !== null && !isHq && old.amount !== r.amount) throw new Error('VERIFIED_LOCK');
          await tx.jibaiClaim.update({ where: { id: old.id }, data: { patientNo, patientName, invoiceYm, days, amount: r.amount } });
          if (old.amount !== r.amount || old.patientNo !== patientNo || old.days !== days) {
            await tx.jibaiLog.create({ data: { storeId: sid, ym, claimId: old.id, action: 'update', detail: `${old.patientNo} ${yenFmt(old.amount)}円 → ${patientNo} ${yenFmt(r.amount)}円`, byCode: by } });
          }
          updated++;
        } else {
          const c = await tx.jibaiClaim.create({ data: { storeId: sid, ym, seq: ++seq, invoiceYm, patientNo, patientName, days, amount: r.amount, source, createdBy: by } });
          await tx.jibaiLog.create({ data: { storeId: sid, ym, claimId: c.id, action: 'add', detail: `${patientNo} ${yenFmt(r.amount)}円（${source === 'OCR' ? '読み取り' : '手入力'}）`, byCode: by } });
          added++;
        }
      }
      await tx.jibaiMonth.upsert({ where: { storeId_ym: { storeId: sid, ym } }, update: {}, create: { storeId: sid, ym, status: 'DRAFT' } });
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return NextResponse.json({ error: '明細が見つかりません（他の端末で削除された可能性があります）' }, { status: 404 });
    if (msg === 'VERIFIED_LOCK') return NextResponse.json({ error: '経理確認済みの明細の金額は店舗では変更できません' }, { status: 409 });
    throw e;
  }
  const list = await listClaims(sid, ym);
  return NextResponse.json({ ok: true, added, updated, claims: list, total: list.reduce((s, c) => s + c.amount, 0) });
}

export async function DELETE(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  const old = await prisma.jibaiClaim.findFirst({ where: { id: String(id ?? ''), storeId: ctx.store.id } });
  if (!old) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const err = await editableError(ctx.session.role, ctx.store.id, old.ym);
  if (err) return err;
  if (old.verifiedAmount !== null && ctx.session.role !== 'hq') return NextResponse.json({ error: '経理確認済みの明細は店舗では削除できません' }, { status: 409 });
  await prisma.jibaiClaim.delete({ where: { id: old.id } });
  await jibaiLog(ctx.store.id, old.ym, old.id, 'delete', `${old.patientNo} ${yenFmt(old.amount)}円`, ctx.session.code);
  return NextResponse.json({ ok: true });
}
