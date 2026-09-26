// Instagram ストーリーズ用の「本日の空き状況」画像（当日のみ。確認用に ?date= で他の日も出せる）
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { isValidDate } from '@/lib/time';
import StoryClient from '@/components/StoryClient';
import { useAdmin } from './Layout';

interface StoreInfo { code: string; name: string; phone: string }

export default function StoryPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const { data, error } = useFetch<StoreInfo>(me.store ? `/api/public/${encodeURIComponent(me.store.code)}/store` : null);
  if (!me.store) return <p>店舗が登録されていません。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const d = sp.get('date');
  const date = d && isValidDate(d) ? d : me.today;
  return <StoryClient store={{ code: data.code, name: data.name, phone: data.phone }} date={date} />;
}
