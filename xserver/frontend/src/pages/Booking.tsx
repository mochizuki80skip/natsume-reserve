// 患者様用ページ /s/<店舗コード>
import { useParams, useSearchParams } from 'react-router-dom';
import type { Closure } from '@/lib/closure';
import { useFetch } from '@/lib/api';
import BookingApp from '@/components/BookingApp';
import ConsultLineBanner from '@/components/ConsultLineBanner';

interface StoreInfo { code: string; name: string; phone: string; smsEnabled: boolean; jibaiOnly?: boolean; closures?: Closure[]; consultLineUrl?: string }

export default function Booking() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const { data, error, loading } = useFetch<StoreInfo>(`/api/public/${encodeURIComponent(code)}/store`);
  if (loading) return <main className="mx-auto max-w-lg px-3 pt-8 text-sm text-slate-500">読み込み中…</main>;
  if (error || !data || data.jibaiOnly) { // 自賠請求だけに使う店舗は WEB 予約のページを出さない
    return (
      <main className="mx-auto max-w-lg px-3 pt-16 text-center">
        <h1 className="text-lg font-bold">ページが見つかりません</h1>
        <p className="mt-2 text-sm text-slate-600">URL をご確認ください。</p>
      </main>
    );
  }
  const consult = data.consultLineUrl ?? '';
  return (
    <>
      <BookingApp store={{ code: data.code, name: data.name, phone: data.phone }} smsEnabled={data.smsEnabled} via={params.get('from') === 'card' ? 'card' : undefined} closures={data.closures ?? []} refCode={/^[a-z0-9]{4,16}$/.test(params.get('ref') ?? '') ? params.get('ref')! : undefined} />
      {/* 交通事故の相談 LINE：どの段階（日時・入力・確認・完了）でも画面のいちばん下に出し続ける */}
      {/^https:\/\//.test(consult) && (
        <>
          <div className="h-20" aria-hidden />
          <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-3 pt-2 backdrop-blur" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
            <ConsultLineBanner url={consult} className="mx-auto max-w-lg" />
          </div>
        </>
      )}
    </>
  );
}
