// 患者様の「ご予約の確認ページ」 /r/<合言葉>。予約完了画面・SMS のリンクから開く。変更・キャンセルは電話のみ
import { Link, useParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { formatDateJa, minToHm } from '@/lib/time';
import { KIND_TEXT, type Kind } from '@/components/WeekGrid';

interface View {
  state: 'BOOKED' | 'PAST' | 'CANCELLED' | 'ENDED';
  store: { code: string; name: string; phone: string };
  date?: string; time?: number; kind?: Kind; name?: string; daysLeft?: number;
}

export default function ReservationView() {
  const { token = '' } = useParams();
  const valid = /^[0-9a-f]{32}$/.test(token);
  const { data, error, loading } = useFetch<View>(valid ? `/api/public-reservation/${token}` : null);
  if (valid && loading) return <main className="mx-auto max-w-lg px-3 pt-8 text-sm text-slate-500">読み込み中…</main>;
  if (!valid || error || !data) {
    return (
      <main className="mx-auto max-w-lg px-3 pt-16 text-center">
        <h1 className="text-lg font-bold">ご予約が見つかりません</h1>
        <p className="mt-2 text-sm text-slate-600">{error?.status === 429 ? error.message : 'URL をご確認ください。ご不明な点は店舗へお電話ください。'}</p>
      </main>
    );
  }
  const { store } = data;
  const tel = `tel:${store.phone.replace(/[^\d+]/g, '')}`;
  const badge = data.state === 'BOOKED' ? (data.daysLeft === 0 ? '本日' : `あと ${data.daysLeft} 日`) : null;
  const head = { BOOKED: 'ご予約中', PAST: 'ご来院日を過ぎました', CANCELLED: 'キャンセル済み', ENDED: 'このご予約は終了しました' }[data.state];

  return (
    <main className="mx-auto max-w-lg px-3 pb-8 pt-4">
      <h1 className="text-lg font-bold">ご予約の確認</h1>
      <p className="mt-1 text-xs text-slate-600">予約された方だけが開けるページです（URL を他の人に教えないでください）。</p>
      <section className="mt-3 overflow-hidden rounded-lg border bg-white">
        <div className={`flex items-center justify-between px-4 py-2.5 text-white ${data.state === 'BOOKED' ? 'bg-brand' : 'bg-slate-500'}`}>
          <b className="text-sm">{head}</b>
          {badge && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-brand-dark">{badge}</span>}
        </div>
        {data.state === 'ENDED' ? (
          <p className="px-4 py-4 text-sm text-slate-600">予約日の翌日を過ぎたため、内容は表示されません。</p>
        ) : (
          <dl className="divide-y px-4 text-sm">
            <div className="flex gap-3 py-2.5"><dt className="w-20 shrink-0 text-slate-500">日時</dt><dd className={`text-base font-bold ${data.state === 'CANCELLED' ? 'line-through' : ''}`}>{formatDateJa(data.date!)} {minToHm(data.time!)}〜</dd></div>
            <div className="flex gap-3 py-2.5"><dt className="w-20 shrink-0 text-slate-500">店舗</dt><dd>{store.name}</dd></div>
            <div className="flex gap-3 py-2.5"><dt className="w-20 shrink-0 text-slate-500">ご来院</dt><dd>{KIND_TEXT[data.kind!] ?? ''}</dd></div>
            <div className="flex gap-3 py-2.5"><dt className="w-20 shrink-0 text-slate-500">お名前</dt><dd>{data.name} 様</dd></div>
          </dl>
        )}
      </section>
      {data.state === 'BOOKED' && (
        <ul className="mt-3 space-y-1 rounded-lg border border-brand bg-brand-light px-4 py-3 text-sm leading-relaxed text-brand-dark">
          <li><b>お支払いは現金のみ</b>となります。</li>
          <li><b>マイナンバーカード（保険証）</b>と、お持ちの方は<b>各種受給者証</b>をお持ちください。</li>
          <li>お時間に余裕をもってご来院ください。</li>
        </ul>
      )}
      <a href={tel} className="mt-3 block rounded-xl border-2 border-brand bg-brand-light px-4 py-3 text-center no-underline shadow-sm">
        <span className="block text-xs font-semibold text-brand-dark">変更・キャンセルはお電話で</span>
        <span className="mt-0.5 block text-[26px] font-bold tabular-nums tracking-wide text-brand-dark">📞 {store.phone}</span>
        <span className="block text-[11px] text-slate-600">{store.name}</span>
      </a>
      <Link to={`/s/${encodeURIComponent(store.code)}`} className="mt-3 block rounded-lg bg-brand px-4 py-3 text-center text-base font-bold text-white no-underline">次回のご予約をとる</Link>
      <p className="mt-2 text-xs text-slate-500">このページは予約日の翌日まで見られます。</p>
    </main>
  );
}
