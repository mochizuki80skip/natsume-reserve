// 自賠請求（速報集計）：月の提出（確定）と取り消し
import { NextResponse } from 'next/server';
import { apiContext } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { isValidYm, jibaiLog, monthRow, yenFmt } from '@/lib/jibaiServer';

export async function POST(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const ym = String(b.ym ?? '');
  const action = String(b.action ?? 'submit');
  if (!isValidYm(ym)) return NextResponse.json({ error: '対象月が不正です' }, { status: 400 });
  const sid = ctx.store.id;
  const by = ctx.session.code;
  const key = { storeId_ym: { storeId: sid, ym } };
  if (action === 'submit' || action === 'submit_empty') {
    const agg = await prisma.jibaiClaim.aggregate({ where: { storeId: sid, ym }, _count: { _all: true }, _sum: { amount: true } });
    const n = agg._count._all;
    if (action === 'submit' && n === 0) return NextResponse.json({ error: '明細が 1 件もありません。自賠請求が無い月は「0 件で提出」を押してください' }, { status: 400 });
    if (action === 'submit') {
      const missing = await prisma.jibaiClaim.count({ where: { storeId: sid, ym, invoiceYm: null } });
      if (missing > 0) return NextResponse.json({ error: `請求月が未選択の明細が ${missing} 件あります。何年何月分かを選んで保存してから提出してください` }, { status: 400 });
    }
    if (action === 'submit_empty' && n > 0) return NextResponse.json({ error: '明細があるので通常の「提出」を押してください' }, { status: 400 });
    const data = { status: 'SUBMITTED', submittedAt: new Date(), submittedBy: by };
    await prisma.jibaiMonth.upsert({ where: key, update: data, create: { storeId: sid, ym, ...data } });
    await jibaiLog(sid, ym, null, 'submit', n === 0 ? '0 件（自賠請求なし）' : `${n} 件 ${yenFmt(agg._sum.amount ?? 0)}円`, by);
  } else if (action === 'reopen') {
    const m = await prisma.jibaiMonth.findUnique({ where: key });
    if (!m || m.status !== 'SUBMITTED') return NextResponse.json({ error: '提出されていません' }, { status: 400 });
    await prisma.jibaiMonth.update({ where: key, data: { status: 'DRAFT', submittedAt: null, submittedBy: null } });
    await jibaiLog(sid, ym, null, 'reopen', null, by);
  } else {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, month: monthRow(await prisma.jibaiMonth.findUnique({ where: key })) });
}
