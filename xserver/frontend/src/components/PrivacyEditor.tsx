// 本部：プライバシーポリシー（全店共通）の文章と公開。公開すると、店舗えらび・WEB 予約・ご予約の確認の下にリンク、予約ボタンの上に一文が出る
import { useEffect, useState } from 'react';
import { useFetch } from '@/lib/api';
import { PRIVACY_DRAFT } from '@/lib/privacy';
import { PolicyBody } from '@/pages/Privacy';

export default function PrivacyEditor() {
  const { data, reload } = useFetch<{ body: string; published: boolean; updatedAt: string | null; updatedBy: string }>('/api/admin/hq/privacy');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (data) setBody(data.body || PRIVACY_DRAFT); }, [data]);
  if (!data) return null;
  const holes = [...new Set(body.match(/【[^】]*】/g) ?? [])];
  const changed = body !== (data.body || PRIVACY_DRAFT) || !data.body;

  async function save(published: boolean) {
    if (published && !confirm('プライバシーポリシーを公開します。店舗えらびページ・各店舗の WEB 予約の画面にリンクが出ます。よろしいですか？')) return;
    const r = await fetch('/api/admin/hq/privacy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, published }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (published ? '保存して公開しました' : data!.published ? '保存して非公開にしました' : '保存しました（まだ非公開です）') : j.error ?? '保存できませんでした');
    if (r.ok) reload();
  }

  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label="プライバシーポリシー">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-bold">プライバシーポリシー（全店共通）</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${data.published ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>{data.published ? '公開中' : '非公開'}</span>
        {data.updatedAt && <span className="text-xs text-slate-500">最後に保存：{data.updatedAt.slice(0, 16)}（{data.updatedBy}）</span>}
        <a href="/privacy" target="_blank" rel="noreferrer" className="text-brand underline">公開ページを開く ↗</a>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        公開すると、店舗えらびページ・各店舗の WEB 予約・ご予約の確認のいちばん下にリンクが出て、予約の最後のボタンの上に「ご入力いただいた個人情報は…」の一文が出ます。
        書き方：「## 」で始まる行は見出し、「- 」で始まる行は箇条書き、そのほかは段落です。<b>【 】の所が残っているうちは公開できません。</b>
      </p>
      {!data.body && <p className="mt-2 rounded bg-amber-50 px-3 py-1 text-xs text-amber-900">下書きを入れてあります。【 】の所を埋め、内容を確かめてから「保存して公開する」を押してください。</p>}
      {holes.length > 0 && <p className="mt-2 rounded bg-amber-50 px-3 py-1 text-xs text-amber-900">まだ埋まっていない所 {holes.length} か所：{holes.join('　')}</p>}
      <div className="mt-2 inline-flex overflow-hidden rounded border text-xs">
        {([[false, '文章を直す'], [true, '見え方を確認']] as const).map(([v, l]) => <button key={l} type="button" aria-pressed={preview === v} onClick={() => setPreview(v)} className={`px-3 py-1 ${preview === v ? 'bg-brand font-bold text-white' : 'bg-white'}`}>{l}</button>)}
      </div>
      {preview
        ? <div className="mt-2 max-h-[520px] overflow-auto rounded border p-4"><PolicyBody body={body} /></div>
        : <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={22} aria-label="プライバシーポリシーの文章" className="mt-2 w-full rounded border px-2 py-1 font-mono text-xs leading-relaxed" />}
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => save(data.published)} disabled={!changed && !!data.body} className="rounded border px-3 py-1 font-bold disabled:opacity-40">{data.published ? '保存する（公開のまま）' : '保存する（非公開のまま）'}</button>
        {!data.published && <button type="button" onClick={() => save(true)} disabled={holes.length > 0} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">保存して公開する</button>}
        {data.published && <button type="button" onClick={() => save(false)} className="rounded border px-3 py-1">非公開にする</button>}
        <button type="button" onClick={() => { if (confirm('下書きの文章に戻しますか？（保存するまでは変わりません）')) setBody(PRIVACY_DRAFT); }} className="ml-auto rounded border px-3 py-1 text-xs">下書きに戻す</button>
      </div>
    </section>
  );
}
