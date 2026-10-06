// 下書きの詳細：左に画像（定型画像を描く／写真を選ぶ）、右に文章の編集と承認などの操作
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, IMAGE_KIND_JA, STATUS_CLASS, STATUS_JA, complianceHits, fileToJpegDataUrl, formatScheduled, sendJson, toInputDateTime, type Post } from '@/lib/sns';
import SnsMediaPicker from '@/components/SnsMediaPicker';
import { drawPostImage } from '@/components/SnsImageCanvas';
import SnsNav from '@/components/SnsNav';
import { useAdmin } from '../Layout';

interface Resp {
  post: Post; store: { code: string; name: string; phone: string; area: string; bookingUrl: string; memo: string };
  neighbors: { prev: { id: string; scheduledAt: string } | null; next: { id: string; scheduledAt: string } | null };
  publishMode: 'api' | 'manual'; forbiddenWords: string[]; me: string; gbpInfo: string[];
}

export default function SnsPostPage() {
  const { id } = useParams();
  const { me } = useAdmin();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/posts/${id}`);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<{ title: string; body: string; closing: string; hashtags: string; scheduledAt: string } | null>(null);
  const [direct, setDirect] = useState<string | null>(null); // 投稿文を直接編集するとき
  const [variant, setVariant] = useState(0);
  const [picker, setPicker] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const p = data?.post;
  useEffect(() => { if (p) { setF({ title: p.title, body: p.body, closing: p.closing, hashtags: p.hashtags, scheduledAt: toInputDateTime(p.scheduledAt) }); setDirect(null); } }, [p?.id, p?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data || !canvasRef.current || !f) return;
    drawPostImage(canvasRef.current, { storeName: data.store.name, title: f.title, body: f.body, phone: data.store.phone, variant, footer: p?.channel === 'gbp' ? 'ご予約はWEB予約ページ・お電話で' : undefined });
  }, [data, f?.title, f?.body, variant, p?.channel]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMsg('');
    try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const action = (a: string, extra: Record<string, unknown> = {}, ok?: string) => run(() => sendJson(`/api/admin/sns/posts/${id}/action`, 'POST', { action: a, ...extra }), ok);
  const save = () => f && run(() => sendJson(`/api/admin/sns/posts/${id}`, 'PUT', direct !== null ? { fullText: direct, scheduledAt: f.scheduledAt } : { ...f }), '保存しました（承認は外れています）');
  async function saveCanvas() {
    const c = canvasRef.current; if (!c) return;
    await run(() => sendJson(`/api/admin/sns/posts/${id}/image`, 'POST', { dataUrl: c.toDataURL('image/jpeg', 0.92), kind: 'template' }), '定型画像を保存しました');
  }
  async function upload(file: File) {
    await run(async () => { const dataUrl = await fileToJpegDataUrl(file); await sendJson(`/api/admin/sns/posts/${id}/image`, 'POST', { dataUrl, kind: 'upload' }); }, '写真を保存しました');
  }
  async function copyText() {
    if (!p) return;
    try { await navigator.clipboard.writeText(p.fullText); setMsg('投稿文をコピーしました'); } catch { window.prompt('コピーしてください', p.fullText); }
  }

  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data || !p || !f) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const locked = p.status === 'posted' || p.status === 'publishing';
  const storeQ = me.session.role === 'hq' ? `store=${encodeURIComponent(data.store.code)}` : '';
  const liveHits = complianceHits(direct ?? `${f.title}\n${f.body}\n${f.closing}`, data.forbiddenWords);
  const dirty = direct !== null || f.title !== p.title || f.body !== p.body || f.closing !== p.closing || f.hashtags !== p.hashtags || f.scheduledAt !== toInputDateTime(p.scheduledAt);
  const isManual = data.publishMode === 'manual';

  return (
    <div className="space-y-3">
      <SnsNav />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link to="/admin/sns/posts" className="text-brand underline">‹ 投稿一覧</Link>
        <h1 className="text-xl font-bold">{CHANNEL_JA[p.channel]} {formatScheduled(p.scheduledAt)}</h1>
        <span className={`rounded px-1.5 text-xs ${STATUS_CLASS[p.status]}`}>{STATUS_JA[p.status]}</span>
        {isManual && p.status !== 'posted' && <span className="rounded bg-slate-200 px-1.5 text-xs">手動投稿（API 未連携）</span>}
        {me.session.role === 'hq' && <span className="text-slate-500">{data.store.name}</span>}
        <span className="ml-auto flex gap-2 text-xs">
          {data.neighbors.prev && <Link to={`/admin/sns/posts/${data.neighbors.prev.id}`} className="text-brand underline">‹ 前（{formatScheduled(data.neighbors.prev.scheduledAt)}）</Link>}
          {data.neighbors.next && <Link to={`/admin/sns/posts/${data.neighbors.next.id}`} className="text-brand underline">次（{formatScheduled(data.neighbors.next.scheduledAt)}） ›</Link>}
        </span>
      </div>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      {p.error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">エラー：{p.error}</p>}
      {data.store.memo && <p className="whitespace-pre-wrap rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><span className="font-bold">運用メモ：</span>{data.store.memo}</p>}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* 左：画像 */}
        <section className="space-y-2 rounded border bg-white p-3 text-sm">
          <h2 className="font-bold">画像 {p.channel === 'ig' ? <span className="text-xs font-normal text-red-700">（Instagram は必須）</span> : <span className="text-xs font-normal text-slate-500">（Google は任意）</span>}</h2>
          {p.imageUrl ? (
            <div>
              <img src={p.imageUrl} alt="投稿画像" className="w-full rounded border" />
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500"><span>{p.imageKind === 'template' ? '定型画像' : p.imageKind === 'topic' ? '定型投稿の画像' : '写真'}</span>{!locked && <button type="button" onClick={() => run(() => sendJson(`/api/admin/sns/posts/${id}/image`, 'POST', { remove: true }), '画像を外しました')} className="text-red-700 underline">画像を外す</button>}</div>
            </div>
          ) : <p className="text-xs text-slate-500">まだ画像がありません。画像ライブラリから選ぶか、写真をアップロードしてください。</p>}
          {!locked && (
            <div className="space-y-2 border-t pt-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => setPicker(true)} className="rounded bg-brand px-3 py-1 text-white disabled:opacity-50">画像ライブラリから選ぶ</button>
                <label className="cursor-pointer rounded border bg-white px-3 py-1">写真をアップロード<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
              </div>
              <p className="text-xs text-slate-500">写真は 1080px に縮小して JPEG で保存します。人物が写る写真は本人の同意を確認してください。画像を変えると承認は外れます。</p>
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-600">文字だけの簡易画像を作る（ライブラリに画像が無いとき）</summary>
                <div className="mt-2 flex items-center gap-2"><select value={variant} onChange={(e) => setVariant(Number(e.target.value))} className="rounded border px-1 text-xs"><option value={0}>白</option><option value={1}>紺</option><option value={2}>ブランド色</option></select><button type="button" disabled={busy} onClick={saveCanvas} className="rounded border bg-white px-2 py-0.5 disabled:opacity-50">この簡易画像を使う</button></div>
                <canvas ref={canvasRef} className="mt-1 w-full rounded border" />
              </details>
            </div>
          )}
          {picker && <SnsMediaPicker storeQ={storeQ} channel={p.channel} onClose={() => setPicker(false)} onPick={(m) => { setPicker(false); run(() => sendJson(`/api/admin/sns/posts/${id}/image`, 'POST', { mediaId: m.id }), 'ライブラリの画像を付けました'); }} />}
        </section>

        {/* 右：文章と操作 */}
        <section className="space-y-3 rounded border bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <label>予定日時 <input type="datetime-local" disabled={locked} value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} className="rounded border px-2 py-1" /></label>
            <span className="ml-auto text-xs text-slate-500">{(direct ?? p.fullText).length} / {p.maxLength} 文字</span>
          </div>
          {direct === null ? (
            p.standalone ? (
              <>
                <p className="text-xs text-slate-500">定型投稿「{p.title || '（名前なし）'}」から作成。{'{店舗名}'} {'{エリア}'} などの差し込み語は保存時にこの店舗の値に置き換わります。</p>
                <label className="block">投稿文（差し込み語入り）<textarea disabled={locked} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={10} className="mt-1 w-full rounded border px-2 py-1" /></label>
              </>
            ) : (
            <>
              <label className="block">見出し<input disabled={locked} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" /></label>
              <label className="block">本文<textarea disabled={locked} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={6} className="mt-1 w-full rounded border px-2 py-1" /></label>
              <label className="block">締めの一言<textarea disabled={locked} value={f.closing} onChange={(e) => setF({ ...f, closing: e.target.value })} rows={2} className="mt-1 w-full rounded border px-2 py-1" /></label>
              {p.channel === 'ig' && <label className="block">ハッシュタグ<input disabled={locked} value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" /></label>}
            </>
            )
          ) : (
            <label className="block">投稿文（そのまま投稿されます）<textarea value={direct} onChange={(e) => setDirect(e.target.value)} rows={14} className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs" /></label>
          )}
          {p.channel === 'gbp' && data.gbpInfo.length > 0 && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-800">Google の投稿文に GBP に載っている情報が入っています：{data.gbpInfo.join('、')}。電話番号・住所・営業時間・URL は本文に入れません（Google のルール。予約は「予約」ボタンが自動で付きます）。</p>}
          {p.unfilled.length > 0 && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-800">埋まっていない差し込み語：{p.unfilled.join(' ')}。この店舗の <Link to={`/admin/sns/settings${me.session.role === 'hq' ? `?store=${data.store.code}` : ''}`} className="underline">SNS 設定</Link> で値を入れる（保存すると「別のネタ」や保存で組み立て直せます）か、本文から外してください。</p>}
          {liveHits.length > 0 && <p className={`rounded px-3 py-2 text-xs ${p.channel === 'gbp' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>広告規制で使わない語：{liveHits.join('、')}{p.channel === 'gbp' ? '（Google はこのままでは承認できません）' : '（Instagram は注意。言い換えをおすすめします）'}</p>}
          {!locked && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !dirty} onClick={save} className="rounded bg-brand px-3 py-1 text-white disabled:opacity-40">保存</button>
              {!p.standalone && <button type="button" disabled={busy} onClick={() => action('regenerate', {}, '別のパターンにしました')} className="rounded border bg-white px-3 py-1 disabled:opacity-50">別のパターン</button>}
              <button type="button" disabled={busy} onClick={() => action('retopic', {}, '別の定型投稿にしました')} className="rounded border bg-white px-3 py-1 disabled:opacity-50">別の定型投稿</button>
              {direct === null ? <button type="button" onClick={() => setDirect(p.fullText)} className="rounded border bg-white px-3 py-1">投稿文を直接編集</button> : <button type="button" onClick={() => setDirect(null)} className="rounded border bg-white px-3 py-1">見出し・本文の編集に戻る</button>}
            </div>
          )}

          <div className="rounded border bg-slate-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-600"><span className="font-bold">投稿文のプレビュー</span><button type="button" onClick={copyText} className="rounded border bg-white px-2 py-0.5">コピー</button>{dirty && <span className="text-amber-700">※未保存の変更があります（保存すると組み立て直します）</span>}</div>
            <pre className="whitespace-pre-wrap font-sans text-sm">{p.fullText}</pre>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {(p.status === 'draft' || p.status === 'failed') && <button type="button" disabled={busy || dirty} onClick={() => action('approve', {}, '承認しました。予定時刻に投稿されます')} className="rounded bg-green-700 px-4 py-1.5 font-bold text-white disabled:opacity-40">承認する</button>}
            {p.status === 'approved' && <button type="button" disabled={busy} onClick={() => action('unapprove', {}, '承認を取り消しました')} className="rounded border bg-white px-3 py-1">承認を取り消す</button>}
            {p.status === 'approved' && !isManual && <button type="button" disabled={busy} onClick={() => confirm('今すぐ投稿します。よろしいですか？') && action('publish_now', {}, '投稿しました')} className="rounded border border-green-700 bg-white px-3 py-1 text-green-800">今すぐ投稿</button>}
            {isManual && p.status !== 'posted' && p.status !== 'publishing' && <button type="button" disabled={busy || dirty} onClick={() => { const link = window.prompt('投稿した URL があれば入力（なければそのまま OK）', '') ; if (link !== null) action('mark_posted', { permalink: link }, '投稿済みにしました'); }} className="rounded border bg-white px-3 py-1">投稿した（手動）</button>}
            {!locked && data.neighbors.prev && <button type="button" disabled={busy} onClick={() => action('swap', { withId: data.neighbors.prev!.id }, '前の投稿と中身を入れ替えました')} className="rounded border bg-white px-3 py-1 text-xs">前の投稿と入れ替え</button>}
            {!locked && data.neighbors.next && <button type="button" disabled={busy} onClick={() => action('swap', { withId: data.neighbors.next!.id }, '次の投稿と中身を入れ替えました')} className="rounded border bg-white px-3 py-1 text-xs">次の投稿と入れ替え</button>}
            {p.status !== 'publishing' && <button type="button" disabled={busy} onClick={() => confirm('この投稿を削除しますか？') && run(async () => { await sendJson(`/api/admin/sns/posts/${id}/action`, 'POST', { action: 'delete' }); navigate('/admin/sns/posts'); })} className="ml-auto rounded border bg-white px-3 py-1 text-red-700">削除</button>}
          </div>
          {dirty && (p.status === 'draft' || p.status === 'failed') && <p className="text-xs text-amber-700">変更を保存してから承認してください。</p>}
          {isManual && p.status !== 'posted' && (
            <div className="rounded border border-slate-300 bg-white p-3 text-xs text-slate-700">
              <p className="font-bold">手動投稿の手順（{CHANNEL_JA[p.channel]}）</p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>上の「コピー」で投稿文をコピーし、画像があれば右クリックで保存します。</li>
                <li>{p.channel === 'gbp' ? 'Google ビジネスプロフィール（Google 検索で店名を検索 → 「最新情報を追加」）に貼り付けて投稿します。' : 'Instagram アプリで新規投稿を作り、画像を選んでキャプションに貼り付けます。'}</li>
                <li>「投稿した（手動）」を押して記録します。{p.channel === 'gbp' ? ' API の利用許可が出ると自動投稿に切り替わります。' : ''}</li>
              </ol>
            </div>
          )}
          {(p.status === 'posted') && (
            <div className="text-xs text-slate-600">
              <p>投稿日時：{p.postedAt}　{p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="text-brand underline">投稿を開く↗</a>}　{p.approvedBy && `承認：${p.approvedBy}`}</p>
              {p.stat && <p className="mt-1">リーチ {p.stat.reach ?? '-'}　いいね {p.stat.likes ?? '-'}　コメント {p.stat.comments ?? '-'}　保存 {p.stat.saved ?? '-'}　シェア {p.stat.shares ?? '-'}（{p.stat.fetchedAt.slice(5, 16)} 時点）</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
