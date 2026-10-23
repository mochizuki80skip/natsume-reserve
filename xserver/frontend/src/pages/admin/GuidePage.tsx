// 使い方（店舗アカウント向けのガイド）/admin/guide?from=開いていた画面&a=記事
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GUIDE, GUIDE_CATS, GUIDE_FOR_SCREEN, searchGuide, type GuideArticle } from '@/lib/guide';
import { useAdmin } from './Layout';

/** **〜** を太字に */
function rich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
}

/** 調べた言葉に色を付ける */
function mark(text: string, q: string): ReactNode[] {
  const words = q.trim().split(/[\s　]+/).filter(Boolean);
  if (!words.length) return [text];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i} className="rounded bg-yellow-200 px-0.5">{p}</mark> : p));
}

function Shot({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img src={`/guide/${src}`} alt={alt} loading="lazy" onError={() => setOk(false)} className="mt-2 max-w-full rounded border shadow-sm" />;
}

export default function GuidePage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const from = sp.get('from') ?? '';
  const id = sp.get('a');
  // 自賠請求だけに使う店舗には、自賠請求とログインの記事だけ
  const list = me.store?.jibaiOnly ? GUIDE.filter((a) => ['login', 'jibai'].includes(a.id)) : GUIDE;
  const byId = (x: string) => list.find((a) => a.id === x);
  const article = id ? byId(id) : undefined;
  const screen = me.store?.jibaiOnly ? undefined : GUIDE_FOR_SCREEN.find((s) => from.startsWith(s.prefix));
  const open = (x: string) => { const n = new URLSearchParams(sp); n.set('a', x); setSp(n); setQ(''); window.scrollTo(0, 0); };
  const back = () => { const n = new URLSearchParams(sp); n.delete('a'); setSp(n); };
  const hits = q.trim() ? searchGuide(q).filter((h) => byId(h.a.id)) : [];

  const ArticleLink = ({ a }: { a: GuideArticle }) => (
    <button type="button" onClick={() => open(a.id)} className="text-left text-brand-dark hover:underline">{a.title}</button>
  );

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">使い方</h1>
        {from && <Link to={from} className="text-xs text-brand-dark underline">← もとの画面に戻る</Link>}
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="調べたいことを入れる（例：キャンセル、電話、QR）" aria-label="使い方を調べる"
          className="ml-auto w-full rounded border px-3 py-1.5 text-sm sm:w-80"
        />
      </div>

      {q.trim() ? (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-bold">「{q.trim()}」の記事（{hits.length} 件）</h2>
          {hits.length === 0 && <p className="text-sm text-slate-500">見つかりませんでした。別の言葉で調べるか、下の「よくある質問」を見てください。</p>}
          <ul className="grid gap-2">
            {hits.map(({ a, snippet }) => (
              <li key={a.id} className="border-b pb-2 last:border-b-0">
                <button type="button" onClick={() => open(a.id)} className="text-left font-bold text-brand-dark hover:underline">{mark(a.title, q)}</button>
                <span className="ml-2 text-[11px] text-slate-500">{a.cat}</span>
                <p className="text-xs text-slate-600">{mark(snippet, q)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : article ? (
        <article className="rounded-lg border bg-white p-4">
          <button type="button" onClick={back} className="mb-2 text-xs text-brand-dark underline">← 使い方の目次</button>
          <p className="text-[11px] text-slate-500">{article.cat}</p>
          <h2 className="mb-2 text-lg font-bold">{article.title}</h2>
          <p className="mb-3 text-sm">{rich(article.lead)}</p>
          {article.steps && (
            <ol className="grid gap-4">
              {article.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">{rich(s.text)}{s.img && <Shot src={s.img} alt={`${article.title}（${i + 1}）の画面`} />}</div>
                </li>
              ))}
            </ol>
          )}
          {article.qa && (
            <dl className="grid gap-3">
              {article.qa.map((x, i) => (
                <div key={i} className="rounded border p-2 text-sm">
                  <dt className="font-bold">Q. {x.q}</dt>
                  <dd className="mt-1">A. {rich(x.a)}</dd>
                </div>
              ))}
            </dl>
          )}
          {article.tips && (
            <div className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-1 font-bold">ポイント</p>
              <ul className="list-disc space-y-1 pl-5">{article.tips.map((t, i) => <li key={i}>{rich(t)}</li>)}</ul>
            </div>
          )}
          {article.related && article.related.some(byId) && (
            <div className="mt-4 border-t pt-3 text-sm">
              <p className="mb-1 text-xs text-slate-500">あわせて読む</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">{article.related.map(byId).filter(Boolean).map((a) => <li key={a!.id}><ArticleLink a={a!} /></li>)}</ul>
            </div>
          )}
        </article>
      ) : (
        <div className="grid gap-3">
          {screen && (
            <section className="rounded-lg border-2 border-brand bg-brand-light/40 p-4">
              <h2 className="mb-2 text-sm font-bold">いま開いていた画面（{screen.label}）の使い方</h2>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">{screen.ids.map(byId).filter(Boolean).map((a) => <li key={a!.id}>・<ArticleLink a={a!} /></li>)}</ul>
            </section>
          )}
          {GUIDE_CATS.map((cat) => {
            const arts = list.filter((a) => a.cat === cat);
            if (!arts.length) return null;
            return (
              <section key={cat} className="rounded-lg border bg-white p-4">
                <h2 className="mb-2 text-sm font-bold">{cat}</h2>
                <ul className="grid gap-1 text-sm sm:grid-cols-2">{arts.map((a) => <li key={a.id}>・<ArticleLink a={a} /></li>)}</ul>
              </section>
            );
          })}
          <p className="text-xs text-slate-500">説明と画面が違うところや、載せてほしい内容があれば本部に伝えてください。</p>
        </div>
      )}
    </div>
  );
}
