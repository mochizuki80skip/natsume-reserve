// 患者様用ページ /s/<店舗コード>
import { useParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import BookingApp from '@/components/BookingApp';

interface StoreInfo { code: string; name: string; phone: string; smsEnabled: boolean }

export default function Booking() {
  const { code = '' } = useParams();
  const { data, error, loading } = useFetch<StoreInfo>(`/api/public/${encodeURIComponent(code)}/store`);
  if (loading) return <main className="mx-auto max-w-lg px-3 pt-8 text-sm text-slate-500">読み込み中…</main>;
  if (error || !data) {
    return (
      <main className="mx-auto max-w-lg px-3 pt-16 text-center">
        <h1 className="text-lg font-bold">ページが見つかりません</h1>
        <p className="mt-2 text-sm text-slate-600">URL をご確認ください。</p>
      </main>
    );
  }
  return <BookingApp store={{ code: data.code, name: data.name, phone: data.phone }} smsEnabled={data.smsEnabled} />;
}
