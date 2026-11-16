// 本部：WEB 予約の設定チェック（店舗ごとに、済んでいない設定を一覧にする。読み取りだけ）
import { useState } from 'react';

interface Issue { key: string; label: string; fix: string }
interface Row { code: string; name: string; issues: Issue[] }

export default function SetupCheck() {
  const [data, setData] = useState<{ stores: Row[]; checkedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function run() {
    setBusy(true); setErr('');
    const r = await fetch('/api/admin/hq/setup-check');
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr((j as { error?: string }).error ?? 'チェックできませんでした'); return; }
    setData(j as { stores: Row[]; checkedAt: string });
  }
  const todo = data?.stores.filter((s) => s.issues.length) ?? [];
  const done = data?.stores.filter((s) => !s.issues.length) ?? [];
  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label="WEB予約の設定チェック">
      <h2 className="font-bold">WEB予約の設定チェック</h2>
      <p className="mt-1 text-xs text-slate-600">店舗ごとに、まだ済んでいない設定（電話番号・住所・地図の位置・店舗えらびへの掲載・施術者・初回／再来の担当・この先 2 週間のシフト・患者一覧・初期パスワード・見本の店舗）を一覧にします。見るだけで、何も変えません。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={busy} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-50">{busy ? 'チェック中…' : data ? 'もう一度チェックする' : 'チェックする'}</button>
        {data && <span className="text-xs text-slate-500">{data.checkedAt.slice(5, 16).replace('-', '/')} 時点</span>}
      </div>
      {err && <p className="mt-2 text-red-700">{err}</p>}
      {data && (
        <>
          <p className="mt-3 font-bold" role="status">{todo.length ? `設定が残っている店舗：${todo.length} 店（全 ${data.stores.length} 店）` : `すべての店舗（${data.stores.length} 店）の設定が済んでいます`}</p>
          <ul className="mt-2 space-y-2">
            {todo.map((s) => (
              <li key={s.code} className="rounded border border-amber-300 bg-amber-50 p-2" aria-label={`${s.name}の残り`}>
                <p className="font-bold">{s.name} <span className="text-xs font-normal text-slate-500">（{s.code}・{s.issues.length} 件）</span></p>
                <ul className="mt-1 list-disc pl-5">
                  {s.issues.map((i) => <li key={i.key} data-key={i.key}><span className="font-bold text-amber-900">{i.label}</span><br /><span className="text-xs text-slate-600">→ {i.fix}</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
          {done.length > 0 && <p className="mt-2 text-xs text-slate-600">✓ 済んでいる店舗：{done.map((s) => s.name).join('、')}</p>}
        </>
      )}
    </section>
  );
}
