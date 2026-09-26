import { requireSession, resolveStore } from '@/lib/admin';
import { isValidDate, nowJst } from '@/lib/time';
import StoryClient from './StoryClient';

export const dynamic = 'force-dynamic';

/** Instagram ストーリーズ用の「本日の空き状況」画像。当日のみ（確認用に ?date= で他の日も出せる） */
export default async function StoryPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const store = await resolveStore(session);
  if (!store) return <p>店舗が登録されていません。</p>;
  const today = nowJst().date;
  const date = sp.date && isValidDate(sp.date) ? sp.date : today;
  return <StoryClient store={{ code: store.code, name: store.name, phone: store.phone }} date={date} />;
}
