// 患者様用ページ /s/<店舗コード>
import { useParams, useSearchParams } from 'react-router-dom';
import type { Closure } from '@/lib/closure';
import { useFetch } from '@/lib/api';
import BookingApp from '@/components/BookingApp';

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
  const hasLine = /^https:\/\//.test(consult);
  return (
    // 下に固定した帯（電話の予約・変更・キャンセル／交通事故の相談 LINE）。日時を選んだときの帯はその上に出す（.has-dock）
    <div className="has-dock" style={{ ['--dock-h' as string]: 'calc(52px + env(safe-area-inset-bottom, 0px))' }}>
      <BookingApp store={{ code: data.code, name: data.name, phone: data.phone }} smsEnabled={data.smsEnabled} via={params.get('from') === 'card' ? 'card' : undefined} closures={data.closures ?? []} refCode={/^[a-z0-9]{4,16}$/.test(params.get('ref') ?? '') ? params.get('ref')! : undefined} />
      {/* ページのいちばん下（電話の欄など）が帯に隠れないよう、帯の高さぶん空ける */}
      <div style={{ height: 'calc(var(--dock-h) + 8px)' }} aria-hidden />
      <nav aria-label="お電話・ご相談" className="fixed inset-x-0 bottom-0 z-30 border-t bg-white shadow-[0_-3px_10px_rgba(0,0,0,0.08)]" style={{ padding: '6px 8px calc(6px + env(safe-area-inset-bottom, 0px))' }}>
        <div className="mx-auto flex max-w-lg gap-1.5">
          <a href={`tel:${data.phone.replace(/[^\d+]/g, '')}`} aria-label={`お電話で予約・変更・キャンセル（${data.phone}）`}
            className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-[9px] border-2 border-brand bg-brand-light px-1 text-[12.5px] font-bold text-brand-dark no-underline">
            <span aria-hidden>📞</span><span className="truncate">予約・変更・キャンセル</span>
          </a>
          {hasLine && (
            <a href={consult} target="_blank" rel="noopener noreferrer" aria-label="交通事故のご相談はLINEで（LINE が開きます）"
              className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-[9px] bg-[#06c755] px-1 text-[12.5px] font-bold text-white no-underline">
              <span className="flex-none rounded bg-white px-1 text-[8.5px] font-black leading-[14px] text-[#06c755]" aria-hidden>LINE</span><span className="truncate">交通事故のご相談</span>
            </a>
          )}
        </div>
      </nav>
    </div>
  );
}
