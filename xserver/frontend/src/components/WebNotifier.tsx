// 新しい WEB予約のお知らせ（管理画面のどの画面でも、30 秒ごとに確認して右上に出す。閉じるまで残す）
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateJa, minToHm } from '@/lib/time';

interface Item { id: string; date: string; time: number; bed: number; kind: string; name: string }
const KIND_MARK: Record<string, string> = { NEW: '（初診）', ACCIDENT: '（初自）', REVISIT: '（再）', RETURN: '' };

export default function WebNotifier() {
  const [items, setItems] = useState<Item[]>([]);
  const since = useRef('');
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    async function check() {
      if (document.visibilityState !== 'visible' && since.current) return;
      try {
        const r = await fetch(`/api/admin/web-new${since.current ? `?since=${encodeURIComponent(since.current)}` : ''}`, { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const j = await r.json() as { now: string; items: Item[] };
        const fresh = j.items.filter((x) => !seen.current.has(x.id));
        for (const x of j.items) seen.current.add(x.id);
        since.current = j.now;
        if (fresh.length) setItems((list) => [...list, ...fresh]);
      } catch { /* 通信できないときは次の確認でもう一度 */ }
    }
    void check();
    const id = setInterval(check, 30 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);

  if (items.length === 0) return null;
  const close = (id: string) => setItems((list) => list.filter((x) => x.id !== id));
  return (
    <div className="no-print fixed right-4 top-14 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.length > 1 && (
        <button type="button" onClick={() => setItems([])} className="self-end rounded bg-white/90 px-2 py-0.5 text-xs text-slate-600 shadow">すべて閉じる</button>
      )}
      {items.map((x) => (
        <div key={x.id} role="status" className="rounded-lg border-2 border-sky-400 bg-sky-50 p-3 text-sm shadow-lg">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="font-bold text-sky-800">新しい WEB予約が入りました</div>
              <div className="mt-1">{formatDateJa(x.date)} {minToHm(x.time)}〜（ベッド{x.bed}）</div>
              <div className="font-bold">{x.name}{KIND_MARK[x.kind] ?? ''}</div>
            </div>
            <button type="button" onClick={() => close(x.id)} aria-label="閉じる" className="text-slate-400 hover:text-slate-700">✕</button>
          </div>
          <Link to={`/admin/day/${x.date}`} onClick={() => close(x.id)} className="mt-2 inline-block rounded bg-sky-600 px-2 py-0.5 text-xs text-white">予約表を開く</Link>
        </div>
      ))}
    </div>
  );
}
