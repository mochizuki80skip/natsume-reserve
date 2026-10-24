// プライバシーポリシー /privacy（全店共通。本部が書いて公開したもの）
import { useFetch } from '@/lib/api';
import { parsePolicy } from '@/lib/privacy';

export function PolicyBody({ body }: { body: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {parsePolicy(body).map((b, i) =>
        b.t === 'h' ? <h2 key={i} className="mt-5 border-l-4 border-sky-500 pl-2 text-base font-bold">{b.text}</h2>
          : b.t === 'ul' ? <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
            : <p key={i}>{b.text}</p>)}
    </div>
  );
}

export default function Privacy() {
  const { data, loading } = useFetch<{ published: boolean; body?: string }>('/api/public-privacy');
  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-6">
      <p className="text-xs font-bold text-sky-600">privacy policy</p>
      <h1 className="mb-4 border-b-2 border-sky-500 pb-2 text-xl font-bold">プライバシーポリシー</h1>
      {loading && !data ? <p className="text-sm text-slate-500">読み込み中…</p>
        : data?.published && data.body ? <PolicyBody body={data.body} />
          : <p className="text-sm text-slate-500">ただいま準備中です。</p>}
      <p className="mt-8 border-t pt-3 text-center text-xs text-slate-500">なつめ接骨院グループ</p>
    </main>
  );
}
