// 自賠請求（速報集計）：経理確認（本部のみ）。確定金額の登録・取り消し・メモ
import { NextResponse } from 'next/server';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { claimRow, jibaiLog, MAX_AMOUNT, yenFmt } from '@/lib/jibaiServer';

export async function PUT(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.session.role !== 'hq') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const old = await prisma.jibaiClaim.findFirst({ where: { id: String(b.id ?? ''), storeId: ctx.store.id } });
  if (!old) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const by = ctx.session.code;
  const note = 'note' in b ? String(b.note ?? '').trim().slice(0, 200) || null : old.note;
  if ('verifiedAmount' in b && b.verifiedAmount === null) {
    await prisma.jibaiClaim.update({ where: { id: old.id }, data: { verifiedAmount: null, verifiedAt: null, verifiedBy: null, note } });
    if (old.verifiedAmount !== null) await jibaiLog(ctx.store.id, old.ym, old.id, 'unverify', old.patientNo, by);
  } else if ('verifiedAmount' in b) {
    const v = Number(b.verifiedAmount);
    if (!Number.isInteger(v) || v < 0 || v > MAX_AMOUNT) return NextResponse.json({ error: '確定金額を確認してください' }, { status: 400 });
    await prisma.jibaiClaim.update({ where: { id: old.id }, data: { verifiedAmount: v, verifiedAt: new Date(), verifiedBy: by, note } });
    const diff = v - old.amount;
    await jibaiLog(ctx.store.id, old.ym, old.id, 'verify', `${old.patientNo} 確定 ${yenFmt(v)}円${diff === 0 ? '' : `（速報との差 ${diff > 0 ? '+' : ''}${yenFmt(diff)}円）`}`, by);
  } else {
    await prisma.jibaiClaim.update({ where: { id: old.id }, data: { note } });
  }
  const c = await prisma.jibaiClaim.findUniqueOrThrow({ where: { id: old.id } });
  return NextResponse.json({ ok: true, claim: claimRow(c) });
}
