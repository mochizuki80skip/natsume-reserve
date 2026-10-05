// 画像ライブラリから 1 枚選ぶ小窓
import { useEffect } from 'react';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, type Channel, type Media } from '@/lib/sns';

export default function SnsMediaPicker({ storeQ, channel, onPick, onClose }: { storeQ: string; channel?: Channel; onPick: (m: Media) => void; onClose: () => void }) {
  const { data, error } = useFetch<{ media: Media[] }>(`/api/admin/sns/media?${storeQ}`);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const list = (data?.media ?? []).filter((m) => m.active && (!channel || m.channel === 'both' || m.channel === channel));
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded border bg-white p-4 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-2"><h3 className="font-bold">画像ライブラリから選ぶ</h3>{channel && <span className="text-xs text-slate-500">{CHANNEL_JA[channel]} 用または両方の画像</span>}<button type="button" onClick={onClose} className="ml-auto rounded border px-2 py-0.5">閉じる</button></div>
        {error && <p className="text-red-700">{error.message}</p>}
        {data && list.length === 0 && <p className="text-slate-500">使える画像がありません。「画像」ページで登録してください。</p>}
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {list.map((m) => (
            <button key={m.id} type="button" onClick={() => onPick(m)} className="rounded border p-1 text-left hover:ring-2 hover:ring-brand">
              <img src={m.url} alt="" className="aspect-square w-full rounded object-cover" />
              <div className="mt-1 truncate text-xs">{m.label || '（メモなし）'}</div>
              <div className="text-xs text-slate-400">{m.useCount} 回使用{m.shared ? '' : '・この店舗'}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
