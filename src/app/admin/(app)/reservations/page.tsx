import Link from 'next/link';
import { requireSession, resolveStore } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { addDays, formatDateShort, isValidDate, minToHm, nowJst } from '@/lib/time';

export const dynamic = 'force-dynamic';

const STATUS_JA: Record<string, string> = { BOOKED: '予約中', CANCELLED: '取消' };
const KIND_JA: Record<string, string> = { NEW: '初診', REVISIT: '再来', RETURN: '通院中' };
/** +81901234xxxx → 090-1234-xxxx */
function jpPhone(p: string): string {
  const d = p.startsWith('+81') ? `0${p.slice(3)}` : p;
  return /^0\d{10}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : /^0\d{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
}

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; status?: string; q?: string; tab?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const store = await resolveStore(session);
  if (!store) return <p>店舗が登録されていません。</p>;
  const today = nowJst().date;
  const from = sp.from && isValidDate(sp.from) ? sp.from : addDays(today, -7);
  const to = sp.to && isValidDate(sp.to) ? sp.to : addDays(today, 60);
  const status = sp.status === 'BOOKED' || sp.status === 'CANCELLED' ? sp.status : '';
  const q = (sp.q ?? '').trim();
  const tab = sp.tab === 'cancel' ? 'cancel' : 'web';
  const cancels = tab === 'cancel' ? await prisma.cancelLog.findMany({
    where: { storeId: store.id, date: { gte: from, lte: to }, ...(q ? { name: { contains: q } } : {}) },
    orderBy: [{ date: 'desc' }, { time: 'asc' }], take: 500,
  }) : [];
  const rows = tab === 'cancel' ? [] : await prisma.reservation.findMany({
    where: {
      storeId: store.id, date: { gte: from, lte: to },
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q.replace(/[^\d+]/g, '') || q } }, { cardNo: { contains: q } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
  });
  const fmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold">予約・来院ログ</h1>
      <div className="mb-3 flex gap-2 text-sm">
        <Link href={`/admin/reservations?from=${from}&to=${to}`} className={`rounded px-3 py-1 ${tab === 'web' ? 'bg-brand text-white' : 'border bg-white'}`}>WEB予約一覧</Link>
        <Link href={`/admin/reservations?tab=cancel&from=${from}&to=${to}`} className={`rounded px-3 py-1 ${tab === 'cancel' ? 'bg-brand text-white' : 'border bg-white'}`}>キャンセル名簿</Link>
      </div>
      <form className="mb-3 flex flex-wrap items-end gap-2 rounded border bg-white p-3 text-sm">
        <input type="hidden" name="tab" value={tab} />
        <label>予約日（from）<input type="date" name="from" defaultValue={from} className="ml-1 rounded border px-2 py-1" /></label>
        <label>〜（to）<input type="date" name="to" defaultValue={to} className="ml-1 rounded border px-2 py-1" /></label>
        <label>状態
          <select name="status" defaultValue={status} className="ml-1 rounded border px-2 py-1">
            <option value="">すべて</option><option value="BOOKED">予約中</option><option value="CANCELLED">取消</option>
          </select>
        </label>
        <label>氏名で検索<input name="q" defaultValue={q} placeholder="氏名の一部でも可" className="ml-1 w-40 rounded border px-2 py-1" />
          <span className="ml-1 text-xs text-slate-500">（電話番号・診察券番号でも可）</span></label>
        <button type="submit" className="rounded bg-brand px-3 py-1 text-white">絞り込む</button>
        <span className="text-xs text-slate-500">{tab === 'cancel' ? cancels.length : rows.length} 件（最大 500 件表示）。個人情報は保持期間（既定 60 日）を過ぎると自動削除されます。</span>
      </form>
      {tab === 'cancel' && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left"><th className="px-2 py-1">予約日時</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">氏名</th><th className="px-2 py-1">区分</th><th className="px-2 py-1">種別</th><th className="px-2 py-1">登録</th><th className="px-2 py-1">メモ</th><th></th></tr></thead>
            <tbody>
              {cancels.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="whitespace-nowrap px-2 py-1">{formatDateShort(c.date)} {minToHm(c.time)}</td>
                  <td className="px-2 py-1">{c.bed}</td>
                  <td className="px-2 py-1">{c.name}</td>
                  <td className="px-2 py-1"><span className={`rounded px-1.5 text-xs ${c.kind === 'ADVANCE' ? 'bg-brand-light text-brand-dark' : 'bg-red-100 text-red-800'}`}>{c.kind === 'ADVANCE' ? '事前連絡' : '無断'}</span></td>
                  <td className="px-2 py-1 text-xs">{c.source === 'WEB' ? 'WEB予約' : '電話・窓口'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs text-slate-500">{fmt.format(c.createdAt)} {c.byCode}</td>
                  <td className="px-2 py-1 text-xs">{c.memo ?? ''}</td>
                  <td className="px-2 py-1"><Link href={`/admin/day/${c.date}`} className="text-brand underline">予約表</Link></td>
                </tr>
              ))}
              {cancels.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-500">該当するキャンセルはありません</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'web' && (
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="px-2 py-1">受付日時</th><th className="px-2 py-1">予約日時</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">区分</th>
              <th className="px-2 py-1">氏名</th><th className="px-2 py-1">診察券</th><th className="px-2 py-1">電話</th><th className="px-2 py-1">状態</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t ${r.status === 'CANCELLED' ? 'text-slate-400' : ''}`}>
                <td className="whitespace-nowrap px-2 py-1">{fmt.format(r.createdAt)}</td>
                <td className="whitespace-nowrap px-2 py-1">{formatDateShort(r.date)} {minToHm(r.time)}</td>
                <td className="px-2 py-1">{r.bed}</td>
                <td className="px-2 py-1">{KIND_JA[r.kind] ?? r.kind}</td>
                <td className="px-2 py-1">{r.name}</td>
                <td className="px-2 py-1">{r.cardNo ?? ''}</td>
                <td className="whitespace-nowrap px-2 py-1">{jpPhone(r.phone)}</td>
                <td className="px-2 py-1">{STATUS_JA[r.status] ?? r.status}</td>
                <td className="px-2 py-1"><Link href={`/admin/day/${r.date}`} className="text-brand underline">予約表</Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-2 py-4 text-center text-slate-500">該当する予約はありません</td></tr>}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
