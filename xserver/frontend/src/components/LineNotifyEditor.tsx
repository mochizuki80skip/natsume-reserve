// 本部：新自の通知を LINE 公式アカウントで送る（合言葉の入力・送り先の登録・試し・今月の通数）
import { useState } from 'react';
import { useFetch } from '@/lib/api';

interface Target { id: string; area: string; label: string; kind: string; linked: boolean; active: boolean; code: string | null; codeExpires: string | null }
interface Resp { hasToken: boolean; hasSecret: boolean; webhookUrl: string; targets: Target[]; areas: string[]; quota: { used: number; limit: number | null } | null }

export default function LineNotifyEditor() {
  const { data, reload } = useFetch<Resp>('/api/admin/hq/line');
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [area, setArea] = useState('');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return null;
  async function call(method: string, path: string, body: unknown, done: (j: Record<string, unknown>) => string) {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg({ ok: r.ok, text: r.ok ? done(j) : (j.error ?? 'できませんでした') });
    if (r.ok) reload();
    return r.ok;
  }
  const ready = data.hasToken && data.hasSecret;

  return (
    <div className="mt-5 border-t pt-4" aria-label="LINEの通知">
      <h3 className="font-bold">新自が来院したときの LINE</h3>
      <p className="mt-1 text-xs text-slate-600">LINE 公式アカウント（無料プラン：月 200 通まで）から、登録した個人・グループのトークに知らせます。1 人に 1 回送ると 1 通、グループは人数分を数えます。200 通を超えた月は、その月の残りが送られないだけで料金はかかりません。</p>
      {msg && <p className={`mt-2 rounded px-3 py-1 ${msg.ok ? 'bg-brand-light' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

      <div className="mt-2 rounded border bg-slate-50 p-2 text-xs">
        <p className="font-bold">① 公式アカウントの合言葉 {ready ? <span className="text-green-700">（入っています）</span> : <span className="text-red-700">（まだです）</span>}</p>
        <p className="mt-0.5 text-slate-600">LINE Developers の「Messaging API 設定」の「チャネルアクセストークン（長期）」と、「チャネル基本設定」の「チャネルシークレット」を貼ってください。入れたあとは画面に出ません（変えるときは入れ直します）。チャットやメールには貼らないでください。</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" placeholder={data.hasToken ? '（入っています。変えるときだけ）' : 'チャネルアクセストークン'} aria-label="チャネルアクセストークン" className="w-72 max-w-full rounded border bg-white px-2 py-1" />
          <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" autoComplete="off" placeholder={data.hasSecret ? '（入っています。変えるときだけ）' : 'チャネルシークレット'} aria-label="チャネルシークレット" className="w-56 max-w-full rounded border bg-white px-2 py-1" />
          <button type="button" disabled={!token.trim() && !secret.trim()} onClick={async () => { if (await call('PUT', '/api/admin/hq/line', { ...(token.trim() ? { token: token.trim() } : {}), ...(secret.trim() ? { secret: secret.trim() } : {}) }, () => '合言葉を保存しました')) { setToken(''); setSecret(''); } }} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">保存</button>
        </div>
        <p className="mt-1 text-slate-600">LINE Developers の「Webhook URL」には次を入れて、「Webhook の利用」をオンにしてください：<code className="select-all rounded bg-white px-1">{data.webhookUrl}</code></p>
      </div>

      <div className="mt-2 rounded border bg-slate-50 p-2 text-xs">
        <p className="font-bold">② 送り先（個人・グループ）</p>
        <p className="mt-0.5 text-slate-600">「番号を出す」を押すと 6 桁の番号が出ます。受け取る人が公式アカウントを友だち追加して、その番号をトークで送ると登録されます（グループのときは、公式アカウントをグループに招待して、グループのトークで番号を送ります）。番号は 24 時間使えます。</p>
        <table className="mt-1 w-full max-w-3xl bg-white">
          <thead><tr className="text-left text-slate-500"><th className="px-1">名前</th><th className="px-1">エリア</th><th className="px-1">状態</th><th /></tr></thead>
          <tbody>
            {data.targets.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-1 py-1">{t.label}</td>
                <td className="px-1 py-1">{t.area || '全店'}</td>
                <td className="px-1 py-1">
                  {t.linked
                    ? (t.active ? <span className="text-green-700">登録済み（{t.kind === 'group' ? 'グループ' : '個人'}）</span> : <span className="text-slate-500">止めています</span>)
                    : <span>番号 <b className="select-all rounded bg-yellow-100 px-1 text-sm tracking-widest">{t.code}</b> を送ってください（{t.codeExpires?.slice(5, 16).replace('-', '/')} まで）</span>}
                </td>
                <td className="whitespace-nowrap px-1 py-1 text-right">
                  {t.linked && <button type="button" onClick={() => call('PUT', '/api/admin/hq/line/targets', { id: t.id, active: !t.active }, () => (t.active ? '止めました' : '再開しました'))} className="mr-1 rounded border px-2 py-0.5">{t.active ? '止める' : '再開'}</button>}
                  {!t.linked && <button type="button" onClick={() => call('PUT', '/api/admin/hq/line/targets', { id: t.id, newCode: true }, () => '番号を出し直しました')} className="mr-1 rounded border px-2 py-0.5">番号を出し直す</button>}
                  <button type="button" onClick={() => confirm(`「${t.label}」を送り先から消しますか？`) && call('PUT', '/api/admin/hq/line/targets', { id: t.id, delete: true }, () => '消しました')} className="rounded border px-2 py-0.5">消す</button>
                </td>
              </tr>
            ))}
            {data.targets.length === 0 && <tr><td colSpan={4} className="px-1 py-2 text-slate-500">まだありません</td></tr>}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} placeholder="名前（例：静岡エリアMG）" aria-label="LINEの送り先の名前" className="w-48 rounded border bg-white px-2 py-1" />
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="LINEの送り先のエリア" className="rounded border bg-white px-1 py-1">
            <option value="">全店</option>
            {data.areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button type="button" disabled={!label.trim()} onClick={async () => { if (await call('POST', '/api/admin/hq/line/targets', { area, label }, (j) => `番号 ${j.code} を出しました。受け取る人に、公式アカウントのトークでこの番号を送ってもらってください。`)) setLabel(''); }} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">番号を出す</button>
          <button type="button" disabled={!ready || !data.targets.some((t) => t.linked && t.active)} onClick={() => call('POST', '/api/admin/hq/line/test', {}, (j) => `試しの通知を ${j.sent} か所に送りました。届いたか確かめてください。`)} className="ml-auto rounded border bg-white px-3 py-1 disabled:opacity-40">試しの通知を送る</button>
        </div>
        {data.quota && <p className="mt-1 text-slate-600">今月送った数：<b>{data.quota.used}</b>{data.quota.limit !== null ? ` ／ ${data.quota.limit} 通` : ' 通'}</p>}
      </div>
    </div>
  );
}
