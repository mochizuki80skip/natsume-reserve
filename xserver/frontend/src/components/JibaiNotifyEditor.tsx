// 本部：新自（交通事故）が来院したときの通知メールの送り先と、交通事故の相談 LINE の URL
import { useEffect, useState } from 'react';
import { useFetch } from '@/lib/api';
import LineNotifyEditor from './LineNotifyEditor';

interface Row { area: string; email: string; label: string }
interface Resp { rows: (Row & { id: string })[]; areas: string[]; consultLineUrl: string; notifyName: string; mailFrom: string }
const NAME_MODES = [['surname', '名字＋カルテNo（例：見本 様（カルテNo 1201））'], ['karte', 'カルテNo だけ'], ['full', '氏名（予約表のとおり）＋カルテNo（例：見本 太郎 様（カルテNo 1201））'], ['none', '出さない']] as const;

export default function JibaiNotifyEditor() {
  const { data, reload } = useFetch<Resp>('/api/admin/hq/jibai-notify');
  const [rows, setRows] = useState<Row[]>([]);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data) { setRows(data.rows.map(({ area, email, label }) => ({ area, email, label }))); setUrl(data.consultLineUrl); setDirty(false); } }, [data]);
  if (!data) return null;
  const set = (i: number, p: Partial<Row>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r))); setDirty(true); };
  async function call(method: string, path: string, body?: unknown, done = '保存しました') {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? '{}' : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg({ ok: r.ok, text: r.ok ? (typeof j.sent === 'number' ? `試しのメールを ${j.sent} 件送りました。届いたか確かめてください（届かないときは迷惑メールのフォルダも見てください）。` : done) : (j.error ?? '保存できませんでした') });
    if (r.ok && method === 'PUT') reload();
  }

  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label="新自の通知と相談LINE">
      <h2 className="font-bold">新自（交通事故）・新三（第三者行為）の通知・相談LINE</h2>
      {msg && <p className={`mt-2 rounded px-3 py-1 ${msg.ok ? 'bg-brand-light' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <b>通知に出す患者様</b>
        <select value={data.notifyName} onChange={(e) => call('PUT', '/api/admin/hq/notify-name', { mode: e.target.value }, '通知に出す患者様を変えました')} aria-label="通知に出す患者様" className="rounded border px-1 py-0.5">
          {NAME_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="text-xs text-slate-500">LINE・メールの両方に出ます。カルテNo は、来院チェックの時に新患継続率に入っているときだけ出ます。</span>
      </div>

      <h3 className="mt-3 font-bold">新自・新三が来院したときのメール（使わないときは空のまま）</h3>
      <p className="mt-1 text-xs text-slate-600">予約表で新自（初自）・新三の方に来院チェックを付けると、ここの送り先へメールで知らせます（店舗・患者様（下で選んだ形）・初診日・時間・担当・きっかけ）。「エリア」を選ぶとそのエリアの店舗の分だけ、「全店」は全店の分が届きます。メールは料金がかかりません。送り主は {data.mailFrom} です。</p>
      <table className="mt-2 w-full max-w-3xl">
        <thead><tr className="text-left text-xs text-slate-500"><th>エリア</th><th>メールアドレス</th><th>名前（メモ）</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="py-1 pr-1">
                <select value={r.area} onChange={(e) => set(i, { area: e.target.value })} aria-label="送り先のエリア" className="rounded border px-1 py-0.5">
                  <option value="">全店</option>
                  {data.areas.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </td>
              <td className="py-1 pr-1"><input type="email" value={r.email} onChange={(e) => set(i, { email: e.target.value })} maxLength={200} aria-label="送り先のメールアドレス" className="w-64 rounded border px-1 py-0.5" /></td>
              <td className="py-1 pr-1"><input value={r.label} onChange={(e) => set(i, { label: e.target.value })} maxLength={30} aria-label="送り先の名前" placeholder="例）静岡エリアMG" className="w-40 rounded border px-1 py-0.5" /></td>
              <td className="py-1 text-right"><button type="button" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true); }} className="rounded border px-2 py-0.5 text-xs">消す</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setRows([...rows, { area: '', email: '', label: '' }]); setDirty(true); }} className="rounded border px-3 py-1">＋ 送り先を足す</button>
        <button type="button" onClick={() => call('PUT', '/api/admin/hq/jibai-notify', { rows }, '送り先を保存しました')} disabled={!dirty} className="rounded bg-brand px-4 py-1 font-bold text-white disabled:opacity-40">送り先を保存</button>
        {dirty && <span className="text-xs text-amber-700">保存していない変更があります</span>}
        <button type="button" onClick={() => call('POST', '/api/admin/hq/jibai-notify/test')} disabled={dirty || data.rows.length === 0} className="ml-auto rounded border px-3 py-1 text-xs disabled:opacity-40">試しのメールを送る</button>
      </div>

      <LineNotifyEditor />

      <h3 className="mt-5 font-bold">交通事故の相談LINE（バナー）</h3>
      <p className="mt-1 text-xs text-slate-600">入れると、店舗えらびのページの上と、各店舗の予約ページのいちばん下に「交通事故のご相談はLINEで」のバナーが出ます。タップするとこの URL（LINE の友だち追加など）が開きます。空にするとバナーは出ません（全店共通）。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={300} placeholder="https://lin.ee/…" aria-label="相談LINEのURL" className="w-96 max-w-full rounded border px-2 py-1" />
        <button type="button" onClick={() => call('PUT', '/api/admin/hq/consult-line', { url }, url.trim() ? '相談LINEの URL を保存しました（バナーが出ます）' : 'URL を消しました（バナーは出ません）')} disabled={url === data.consultLineUrl} className="rounded bg-brand px-4 py-1 font-bold text-white disabled:opacity-40">URL を保存</button>
      </div>
    </section>
  );
}
