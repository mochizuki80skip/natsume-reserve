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

  // ストーリーズのリンクスタンプに貼る予約ページの URL
  const bookingUrl = `${location.origin}/s/${encodeURIComponent(store.code)}`;
  const [copied, setCopied] = useState(false);
  async function copyUrl() {
    try { await navigator.clipboard.writeText(bookingUrl); setCopied(true); setTimeout(() => setCopied(false), 3000); }
    catch { setCopied(false); window.prompt('このURLをコピーしてください', bookingUrl); }
  }

  const fileName = `${store.code}_${date}_story.png`;
  const toFile = () => new Promise<File>((resolve, reject) => {
    canvasRef.current?.toBlob((b) => (b ? resolve(new File([b], fileName, { type: 'image/png' })) : reject(new Error('画像を作れませんでした'))), 'image/png');
  });
  async function share() {
    setMsg('');
    try {
      const file = await toFile();
      await navigator.share({ files: [file], title: `${store.name} 本日の空き状況` });
      setMsg('Instagram で「ストーリーズ」を選んだら、手順3のリンクのスタンプを付けてください。');
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
    setMsg('保存しました。Instagram アプリの「＋」→「ストーリーズ」で保存した画像を選び、手順3へ進んでください。');
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-bold">ストーリー画像（本日の空き状況）</h1>
      <p className="mb-3 text-xs text-slate-600">{formatDateJa(date)}　{store.name}。氏名は載りません。投稿後に予約が入っても画像は変わらないので、朝の投稿をおすすめします。</p>
      <div className="flex flex-wrap items-start gap-4">
        <div className="rounded-lg border bg-white p-2 shadow-sm">
          <canvas ref={canvasRef} className="block h-auto w-[270px]" aria-label="ストーリー画像のプレビュー" />
        </div>
        <div className="min-w-[260px] flex-1 space-y-3 text-sm">
          {state === 'loading' && <p className="text-slate-500">作成中…</p>}
          {state === 'error' && <p className="text-red-700">空き状況を取得できませんでした。<button type="button" className="ml-2 underline" onClick={() => setTick((t) => t + 1)}>再試行</button></p>}

          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">📱 投稿は<b>スマホ</b>でこの画面を開いて行うのがかんたんです（スマホのブラウザで管理画面にログイン →「ストーリー画像」）。</p>

          <ol className="space-y-3">
            <Step n={1} title="予約ページのURLをコピー">
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded border bg-slate-50 px-2 py-1.5 text-xs">{bookingUrl}</code>
                <button type="button" onClick={copyUrl} className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-bold text-white">{copied ? 'コピーしました' : 'コピー'}</button>
              </div>
              <p className="mt-1 text-xs text-slate-500">あとでリンクのスタンプに貼り付けます。</p>
            </Step>
            <Step n={2} title="画像を Instagram へ">
              <div className="mt-1 space-y-2">
                {canShare && <button type="button" disabled={state !== 'ready'} onClick={share} className="block w-full rounded-lg bg-brand px-4 py-3 font-bold text-white disabled:opacity-50">Instagram へ共有</button>}
                <button type="button" disabled={state !== 'ready'} onClick={download} className="block w-full rounded-lg border bg-white px-4 py-2.5 font-bold disabled:opacity-50">画像を保存</button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                「Instagram へ共有」→ 共有画面で <b>Instagram</b> →「<b>ストーリーズ</b>」を選びます。
                共有のボタンが無い・Instagram が出ない場合は「画像を保存」し、Instagram アプリの「＋」→「ストーリーズ」で保存した画像を選びます。
              </p>
            </Step>
            <Step n={3} title="リンクのスタンプを付ける">
              <p className="mt-1 text-xs">
                画面上の <b>スタンプのマーク</b>（四角い顔の絵）を押す →「<b>リンク</b>」を選ぶ →
                URL の欄を長押しして「<b>ペースト</b>」（手順1でコピーしたURL）。
              </p>
            </Step>
            <Step n={4} title="スタンプの文字を変えて置く">
              <p className="mt-1 text-xs">
                「スタンプのテキストをカスタマイズ」で <b>WEB予約はこちら</b> と入力 →「完了」。
                スタンプは指で動かして、<b>下の紺色の帯（WEB予約の案内）の上</b>に重ねて置きます。時間の表には重ねないでください（一番下は返信欄に隠れるので避けます）。
              </p>
            </Step>
            <Step n={5} title="ストーリーズに投稿">
              <p className="mt-1 text-xs">左下の「<b>ストーリーズ</b>」（自分のアイコン）を押して完了です。投稿後、スタンプを押して予約ページが開くか確認しましょう。</p>
            </Step>
          </ol>

          <button type="button" onClick={() => setTick((t) => t + 1)} className="block w-full rounded-lg border bg-white px-4 py-2 text-slate-600">最新の空き状況で作り直す</button>
          {msg && <p className="rounded bg-brand-light px-3 py-2 text-brand-dark">{msg}</p>}
          <p className="rounded border bg-white p-3 text-xs text-slate-600">
            記号：〇 どなたでも／△ ご通院中の方のみ（30分枠が取れない時間）／📞 お電話で／× 空きなし。
            投稿後に予約が入っても画像は変わりません。空き状況が大きく変わったら、作り直して投稿し直してください。
          </p>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-lg border bg-white p-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{title}</p>
        {children}
      </div>
    </li>
  );
}
