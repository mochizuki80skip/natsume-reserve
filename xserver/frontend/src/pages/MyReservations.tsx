// 患者様：この端末で WEB 予約した予約の一覧 /my（予約ページの「ご予約の確認」から）
// 中身は 1 件ずつ「ご予約の確認ページ」と同じ API で聞く。予約日の翌日を過ぎたものは一覧から消える
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDateJa, minToHm } from '@/lib/time';
import { loadMyReservations, removeMyReservations } from '@/lib/myReservations';

interface View { state: 'BOOKED' | 'PAST' | 'CANCELLED' | 'ENDED'; store: { code: string; name: string; phone: string }; date?: string; time?: number; name?: string; daysLeft?: number }
type Item = View & { token: string };

export default function MyReservations() {
  const [sp] = useSearchParams();
  const back = /^[A-Za-z0-9_-]{2,20}$/.test(sp.get('store') ?? '') ? sp.get('store')! : '';
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    document.title = 'ご予約の確認';
    const list = loadMyReservations();
    Promise.all(list.map(async (x) => {
      try {
        const r = await fetch(`/api/public-reservation/${x.token}`, { cache: 'no-store' });
        if (r.status === 404) return { token: x.token, state: 'ENDED' } as Item; // 予約が見つからない（削除された等）
        if (!r.ok) return null; // 通信の都合（混み合い等）はそのまま残す
        return { ...(await r.json()), token: x.token } as Item;
      } catch { return null; }
    })).then((rs) => {
      const got = rs.filter((x): x is Item => !!x);
      // 見られなくなったもの（予約日の翌日を過ぎた・見つからない）はこの端末から消す
      removeMyReservations(got.filter((x) => x.state === 'ENDED').map((x) => x.token));
      setItems(got.filter((x) => x.state !== 'ENDED').sort((a, b) => `${a.date}${String(a.time).padStart(4, '0')}`.localeCompare(`${b.date}${String(b.time).padStart(4, '0')}`)));
    });
  }, []);
  function forget(token: string) {
    removeMyReservations([token]);
    setItems((v) => (v ?? []).filter((x) => x.token !== token));
  }
  const label = { BOOKED: 'ご予約中', PAST: '終わった予約', CANCELLED: 'キャンセル済み', ENDED: '' } as const;
  return (
    <main className="mx-auto max-w-lg px-3 pb-8 pt-4">
      <h1 className="text-lg font-bold">ご予約の確認</h1>
      <p className="mt-1 text-xs text-slate-600">このスマホ（ブラウザ）で WEB 予約したご予約です。お電話・窓口でのご予約は出ません。</p>
      {items === null ? <p className="mt-6 text-sm text-slate-500">読み込み中…</p> : items.length === 0 ? (
        <p className="mt-4 rounded-lg border bg-white px-4 py-4 text-sm text-slate-600">この端末で WEB 予約したご予約はありません。</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((x) => (
            <li key={x.token} className="overflow-hidden rounded-xl border bg-white">
              <Link to={`/r/${x.token}`} className="block px-4 py-3 text-inherit no-underline">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${x.state === 'BOOKED' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                  {label[x.state]}{x.state === 'BOOKED' && x.daysLeft !== undefined ? (x.daysLeft === 0 ? '・本日' : `・あと ${x.daysLeft} 日`) : ''}
                </span>
                <b className={`mt-1 block text-[17px] ${x.state === 'CANCELLED' ? 'line-through' : ''}`}>{formatDateJa(x.date!)} {minToHm(x.time!)}〜</b>
                <span className="block text-sm">{x.store.name}</span>
                <span className="block text-xs text-slate-500">{x.name} 様　<span className="text-brand underline">くわしく見る ›</span></span>
              </Link>
              {x.state !== 'BOOKED' && <button type="button" onClick={() => forget(x.token)} className="w-full border-t px-4 py-1.5 text-left text-xs text-slate-500">この一覧から消す</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-slate-700">変更・キャンセルは、各店舗へ<b>お電話</b>でお願いします（くわしく見る から電話番号を押せます）。</p>
      {back && <Link to={`/s/${encodeURIComponent(back)}`} className="mt-4 block rounded-lg bg-brand px-4 py-3 text-center text-base font-bold text-white no-underline">WEB 予約の画面に戻る</Link>}
      <p className="mt-2 text-xs text-slate-500">終わった予約は、予約日の翌日まで出て、そのあと消えます。</p>
    </main>
  );
}
