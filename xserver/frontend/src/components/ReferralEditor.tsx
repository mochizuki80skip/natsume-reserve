// 本部：紹介元（業者）ごとの専用 QR。QR から店舗えらびページを開いて予約した初診の方は、初回カルテのきっかけが「業者紹介」、内訳が業者名で入る
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useFetch } from '@/lib/api';

interface Ref { id: string; code: string; name: string; active: boolean; createdAt: string; reservations: number; kartes: number }

const urlOf = (code: string) => `${location.origin}/stores?ref=${code}`;

function Qr({ code, name }: { code: string; name: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(urlOf(code), { width: 600, margin: 2, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc(''));
  }, [code]);
  if (!src) return null;
  return (
    <div className="flex items-center gap-2">
      <img src={src} alt={`${name} の QR コード`} width={72} height={72} className="rounded border" />
      <a href={src} download={`QR_${name}.png`} className="whitespace-nowrap rounded border px-2 py-1 text-xs no-underline">QR 画像を保存</a>
    </div>
  );
}

function Row({ r, onSaved, onMsg }: { r: Ref; onSaved: () => void; onMsg: (m: string) => void }) {
  const [name, setName] = useState(r.name);
  async function put(body: Record<string, unknown>, done: string) {
    const res = await fetch('/api/admin/hq/referrals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, ...body }) });
    const j = await res.json().catch(() => ({}));
    onMsg(res.ok ? done : j.error ?? '保存できませんでした');
    if (res.ok) onSaved();
  }
  return (
    <tr className={`border-t align-middle ${r.active ? '' : 'text-slate-400'}`}>
      <td className="py-1.5 pr-2">
        <div className="flex gap-1">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="紹介元の名前" className="w-36 rounded border px-2 py-1" />
          {name.trim() !== r.name && <button type="button" onClick={() => put({ name }, '名前を変えました（初回カルテの内訳もそろえました）')} className="rounded bg-brand px-2 text-xs text-white">保存</button>}
        </div>
        {!r.active && <span className="text-xs">（止めています）</span>}
      </td>
      <td className="py-1.5 pr-2">
        <code className="break-all text-xs">{urlOf(r.code)}</code>
        <button type="button" onClick={() => navigator.clipboard.writeText(urlOf(r.code)).then(() => onMsg('URL をコピーしました')).catch(() => {})} className="ml-1 rounded border px-1.5 text-xs">コピー</button>
      </td>
      <td className="py-1.5 pr-2">{r.active && <Qr code={r.code} name={r.name} />}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.reservations}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.kartes}</td>
      <td className="py-1.5 text-right">
        <button type="button" onClick={() => put({ active: !r.active }, r.active ? `${r.name} の QR を止めました（読んでも紹介元は付きません）` : `${r.name} の QR を再開しました`)} className="whitespace-nowrap rounded border px-2 py-1 text-xs">{r.active ? '止める' : '再開する'}</button>
      </td>
    </tr>
  );
}

export default function ReferralEditor({ pageOpen }: { pageOpen: boolean }) {
  const { data, reload } = useFetch<{ rows: Ref[] }>('/api/admin/hq/referrals');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/hq/referrals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? `「${name.trim()}」を追加しました。QR 画像を保存してパンフレットに貼ってください` : j.error ?? '追加できませんでした');
    if (res.ok) { setName(''); reload(); }
  }
  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm">
      <h2 className="font-bold">紹介元（業者）の専用 QR</h2>
      <p className="mt-1 text-xs text-slate-600">
        業者ごとに専用の QR を作ります。QR を読むと店舗えらびページが開き、そこから WEB 予約した初診の方は、初回カルテのきっかけが<b>「業者紹介」</b>、内訳が<b>業者の名前</b>で自動で入ります。
        業者ごとの人数は、新患・再来集計のきっかけ「業者紹介」の内訳で見られます。
      </p>
      {!pageOpen && <p className="mt-2 rounded bg-amber-50 px-3 py-1 text-xs text-amber-900">店舗えらびページがまだ「非公開」です。公開するまでは、QR を読んでも「準備中」と出ます（上の「店舗えらびページ」で公開してください）。</p>}
      <form onSubmit={add} className="mt-2 flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：ワタモ" maxLength={40} aria-label="新しい紹介元の名前" className="w-48 rounded border px-2 py-1" />
        <button type="submit" disabled={!name.trim()} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">紹介元を追加</button>
      </form>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full">
          <thead><tr className="text-left text-xs text-slate-500"><th className="pr-2">紹介元</th><th className="pr-2">専用 URL</th><th className="pr-2">QR</th><th className="pr-2 text-right">WEB 予約</th><th className="pr-2 text-right">初回カルテ</th><th /></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((r) => <Row key={`${r.id}:${r.name}:${r.active}`} r={r} onSaved={reload} onMsg={setMsg} />)}
            {data && data.rows.length === 0 && <tr><td colSpan={6} className="py-2 text-xs text-slate-400">まだ登録はありません</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
