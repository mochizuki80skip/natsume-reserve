// 本部（アカウント管理の権限がある人）：集計API（統合ダッシュボード用）のキーの発行・停止・接続元 IP の制限
import { useState } from 'react';
import { useFetch } from '@/lib/api';

interface ApiKey { id: string; name: string; prefix: string; allowedIps: string; active: boolean; lastUsedAt: string; lastIp: string; createdAt: string; createdBy: string }

async function send(method: string, body: object): Promise<{ ok: boolean; error: string; key?: string }> {
  const r = await fetch('/api/admin/hq/api-keys', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, error: (j as { error?: string }).error ?? '保存できませんでした', key: (j as { key?: string }).key };
}

export default function ApiKeyEditor() {
  const { data, reload } = useFetch<{ keys: ApiKey[]; base: string }>('/api/admin/hq/api-keys');
  const [name, setName] = useState('統合ダッシュボード');
  const [ips, setIps] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [made, setMade] = useState<string | null>(null);

  async function act(method: string, body: object, done: string) {
    const r = await send(method, body);
    setMsg({ ok: r.ok, text: r.ok ? done : r.error });
    if (r.ok) reload();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await send('POST', { name, allowedIps: ips });
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setMade(r.key ?? null);
    setMsg(null);
    setIps('');
    reload();
  }

  return (
    <section className="rounded-lg border bg-white p-3 text-sm" aria-label="集計APIのキー">
      <h2 className="font-bold">🔑 集計API のキー（統合ダッシュボードとの連携）</h2>
      <p className="mt-1 text-xs text-slate-600">
        統合ダッシュボードが、店舗ごとの件数・金額（来院・新規・窓口集計・継続率・離反・スタッフ数）を読み取るためのキーです。<b>読み取りだけ</b>で、患者様の氏名・電話番号・カルテ番号やスタッフの名前は渡しません。
        キーは発行したときに<b>1 回だけ</b>表示されます。チャットやメールに貼らず、ダッシュボードの設定画面に直接入れてください。
      </p>
      {data && <p className="mt-1 text-xs text-slate-500">API の場所：<code className="rounded bg-slate-100 px-1">{data.base}</code></p>}
      {msg && <p className={`mt-2 rounded px-3 py-2 text-xs ${msg.ok ? 'bg-brand-light text-brand-dark' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      {made && (
        <div className="mt-2 rounded border-2 border-amber-400 bg-amber-50 p-2 text-xs" role="alert" aria-label="発行したキー">
          <p className="font-bold text-amber-800">キーを発行しました。この画面を閉じると二度と表示されません。今すぐダッシュボード側に入れてください。</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 font-mono text-[12px]" aria-label="キー">{made}</code>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(made); setMsg({ ok: true, text: 'キーをコピーしました' }); }} className="rounded border px-2 py-0.5">コピー</button>
            <button type="button" onClick={() => setMade(null)} className="rounded border px-2 py-0.5">閉じる（入れ終わった）</button>
          </div>
        </div>
      )}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr><th className="px-2 py-1 text-left">名前</th><th className="px-2 py-1 text-left">キーの先頭</th><th className="px-2 py-1 text-left">接続元 IP（空＝制限なし）</th><th className="px-2 py-1 text-left">状態</th><th className="px-2 py-1 text-left">最後に使った日時</th><th className="px-2 py-1 text-left">発行</th><th className="px-2 py-1 text-left">操作</th></tr>
          </thead>
          <tbody>
            {(data?.keys ?? []).map((k) => (
              <tr key={k.id} className={`border-t ${k.active ? '' : 'bg-slate-50 text-slate-400'}`}>
                <td className="px-2 py-1">{k.name}</td>
                <td className="px-2 py-1 font-mono">{k.prefix}…</td>
                <td className="px-2 py-1">
                  <input key={k.allowedIps} defaultValue={k.allowedIps} aria-label={`${k.name} の接続元 IP`} placeholder="例）203.0.113.10"
                    onBlur={(e) => e.target.value.trim() !== k.allowedIps && act('PUT', { id: k.id, allowedIps: e.target.value }, '接続元 IP を変更しました')} className="w-48 rounded border px-1 py-0.5 font-mono" />
                </td>
                <td className="px-2 py-1">{k.active ? <span className="font-bold text-brand-dark">使用中</span> : '停止'}</td>
                <td className="px-2 py-1">{k.lastUsedAt || '—'}{k.lastIp && <span className="ml-1 text-slate-400">（{k.lastIp}）</span>}</td>
                <td className="px-2 py-1">{k.createdAt}{k.createdBy && `・${k.createdBy}`}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {k.active
                    ? <button type="button" onClick={() => confirm(`「${k.name}」のキーを停止しますか？（ダッシュボードから読めなくなります）`) && act('PUT', { id: k.id, active: false }, 'キーを停止しました')} className="rounded border border-red-300 px-2 py-0.5 text-red-700">停止</button>
                    : <>
                        <button type="button" onClick={() => act('PUT', { id: k.id, active: true }, 'キーを使用中に戻しました')} className="rounded border px-2 py-0.5">再開</button>
                        <button type="button" onClick={() => confirm(`「${k.name}」のキーを削除しますか？`) && act('DELETE', { id: k.id }, 'キーを削除しました')} className="ml-1 rounded border px-2 py-0.5">削除</button>
                      </>}
                </td>
              </tr>
            ))}
            {data && data.keys.length === 0 && <tr><td colSpan={7} className="px-2 py-2 text-slate-500">まだキーはありません。</td></tr>}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="mt-2 flex flex-wrap items-end gap-2" aria-label="集計APIのキーを発行">
        <label className="text-xs">名前<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} className="mt-0.5 block w-44 rounded border px-2 py-1 text-sm" /></label>
        <label className="text-xs">接続元 IP（任意・カンマ区切り）<input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="空＝制限なし" className="mt-0.5 block w-56 rounded border px-2 py-1 font-mono text-sm" /></label>
        <button type="submit" className="rounded bg-brand px-4 py-1.5 font-bold text-white">キーを発行</button>
      </form>
      <p className="mt-1 text-[11px] text-slate-500">使わなくなったキー・漏れたかもしれないキーは「停止」してください。停止したキーはすぐに使えなくなります。呼ばれた記録は下の「操作の記録」に残ります。</p>
    </section>
  );
}
