// 本日の空き状況をストーリーズ用画像にして、共有（Instagram）または保存する画面
import { useEffect, useRef, useState } from 'react';
import { formatDateJa, minToHm, nowJst } from '@/lib/time';
import { drawStory, type SlotStatus, type StorySlot } from './StoryCanvas';

interface Props { store: { code: string; name: string; phone: string }; date: string }
interface SlotsResp { date: string; published: boolean; slots: { time: number; status: SlotStatus; period: 'AM' | 'PM' }[] }

export default function StoryClient({ store, date }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState('loading');
    const api = (kind: string) => fetch(`/api/public/${encodeURIComponent(store.code)}/slots?date=${date}&kind=${kind}`, { cache: 'no-store' }).then((r) => r.json() as Promise<SlotsResp>);
    Promise.all([api('NEW'), api('RETURN')])
      .then(([n, r]) => {
        if (!alive || !canvasRef.current) return;
        const retMap = new Map(r.slots.map((s) => [s.time, s.status]));
        const slots: StorySlot[] = n.slots.map((s) => ({ time: s.time, period: s.period, newStatus: s.status, returnStatus: retMap.get(s.time) ?? 'closed' }));
        const now = nowJst();
        drawStory(canvasRef.current, {
          storeName: store.name, phone: store.phone,
          dateText: formatDateJa(date, false), nowText: minToHm(now.minutes),
          slots, closedText: !n.published ? '本日のWEB受付はありません' : '本日は休診日です',
        });
        setState('ready');
      })
      .catch(() => alive && setState('error'));
    return () => { alive = false; };
  }, [store.code, store.name, store.phone, date, tick]);

  useEffect(() => {
    // 画像の共有（スマホの共有画面 → Instagram）に対応しているか
    const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      const f = new File([new Blob(['x'])], 'x.png', { type: 'image/png' });
      setCanShare(typeof n.share === 'function' && typeof n.canShare === 'function' && n.canShare({ files: [f] }));
    } catch { setCanShare(false); }
  }, []);

  const fileName = `${store.code}_${date}_story.png`;
  const toFile = () => new Promise<File>((resolve, reject) => {
    canvasRef.current?.toBlob((b) => (b ? resolve(new File([b], fileName, { type: 'image/png' })) : reject(new Error('画像を作れませんでした'))), 'image/png');
  });
  async function share() {
    setMsg('');
    try {
      const file = await toFile();
      await navigator.share({ files: [file], title: `${store.name} 本日の空き状況` });
      setMsg('共有画面で Instagram を選び、「ストーリーズ」に投稿してください。');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsg('共有できませんでした。「画像を保存」から投稿してください。');
    }
  }
  async function download() {
    setMsg('');
    const file = await toFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setMsg('保存した画像を Instagram アプリの「ストーリーズ」から選んで投稿してください。');
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-bold">ストーリー画像（本日の空き状況）</h1>
      <p className="mb-3 text-xs text-slate-600">{formatDateJa(date)}　{store.name}。氏名は載りません。投稿後に予約が入っても画像は変わらないので、朝の投稿をおすすめします。</p>
      <div className="flex flex-wrap items-start gap-4">
        <div className="rounded-lg border bg-white p-2 shadow-sm">
          <canvas ref={canvasRef} className="block h-auto w-[270px]" aria-label="ストーリー画像のプレビュー" />
        </div>
        <div className="flex-1 space-y-2 text-sm">
          {state === 'loading' && <p className="text-slate-500">作成中…</p>}
          {state === 'error' && <p className="text-red-700">空き状況を取得できませんでした。<button type="button" className="ml-2 underline" onClick={() => setTick((t) => t + 1)}>再試行</button></p>}
          {canShare && <button type="button" disabled={state !== 'ready'} onClick={share} className="block w-full rounded-lg bg-brand px-4 py-3 font-bold text-white disabled:opacity-50">Instagram へ共有</button>}
          <button type="button" disabled={state !== 'ready'} onClick={download} className="block w-full rounded-lg border bg-white px-4 py-3 font-bold disabled:opacity-50">画像を保存</button>
          <button type="button" onClick={() => setTick((t) => t + 1)} className="block w-full rounded-lg border bg-white px-4 py-2 text-slate-600">最新の空き状況で作り直す</button>
          {msg && <p className="rounded bg-brand-light px-3 py-2 text-brand-dark">{msg}</p>}
          <div className="rounded border bg-white p-3 text-xs text-slate-600">
            <p className="mb-1 font-bold">投稿のしかた</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>スマホなら「Instagram へ共有」→ 共有画面で Instagram →「ストーリーズ」を選ぶ。出てこない場合は「画像を保存」。</li>
              <li>Instagram アプリでストーリーズを開き、保存した画像を選ぶ。</li>
              <li>リンクのスタンプで予約ページ（/s/{store.code}）の URL を付けると、そのまま予約に進めます。</li>
              <li>記号：〇 どなたでも／△ ご通院中の方のみ（30分枠が取れない時間）／📞 お電話で／× 空きなし</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
