// 本部：紹介元（業者）・媒体ごとの専用 QR。QR から店舗えらびページを開いて予約した初診の方は、新患継続率のきっかけが
// 「業者紹介」（媒体は決めたきっかけ）、内訳が業者名・媒体名で入る
import { useState } from 'react';
import { useQrBlobUrl } from './UrlQrCard';
import { useFetch } from '@/lib/api';

interface Ref { id: string; code: string; name: string; active: boolean; kind: 'partner' | 'media'; trig: string; createdAt: string; reservations: number; kartes: number }
type Kind = 'partner' | 'media';
const WORD: Record<Kind, string> = { partner: '紹介元', media: '媒体' };

const urlOf = (code: string) => `${location.origin}/stores?ref=${code}`;

function Qr({ code, name }: { code: string; name: string }) {
  const src = useQrBlobUrl(urlOf(code));
  if (!src) return null;
  return (
    <div className="flex items-center gap-2">
      <img src={src} alt={`${name} の QR コード`} width={72} height={72} className="rounded border" />
      <a href={src} download={`QR_${name}.png`} className="whitespace-nowrap rounded border px-2 py-1 text-xs no-underline">QR 画像を保存</a>
    </div>
  );
}

function Row({ r, triggers, onSaved, onMsg }: { r: Ref; triggers: string[]; onSaved: () => void; onMsg: (m: string) => void }) {
  const [name, setName] = useState(r.name);
  const w = WORD[r.kind];
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
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label={`${w}の名前`} className="w-36 rounded border px-2 py-1" />
          {name.trim() !== r.name && <button type="button" onClick={() => put({ name }, '名前を変えました（新患継続率の内訳もそろえました）')} className="rounded bg-brand px-2 text-xs text-white">保存</button>}
        </div>
        {!r.active && <span className="text-xs">（止めています）</span>}
      </td>
      {r.kind === 'media' && (
        <td className="py-1.5 pr-2">
          <select value={r.trig} onChange={(e) => put({ trig: e.target.value }, `${r.name} のきっかけを「${e.target.value}」にしました（新患継続率の行もそろえました）`)} aria-label="入るきっかけ" className="rounded border px-1 py-1">
            {[...new Set([r.trig, ...triggers])].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </td>
      )}
      <td className="py-1.5 pr-2">
        <code className="break-all text-xs">{urlOf(r.code)}</code>
        <button type="button" onClick={() => navigator.clipboard.writeText(urlOf(r.code)).then(() => onMsg('URL をコピーしました')).catch(() => {})} className="ml-1 rounded border px-1.5 text-xs">コピー</button>
      </td>
      <td className="py-1.5 pr-2">{r.active && <Qr code={r.code} name={r.name} />}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.reservations}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.kartes}</td>
      <td className="py-1.5 text-right">
        <button type="button" onClick={() => put({ active: !r.active }, r.active ? `${r.name} の QR を止めました（読んでも${w}は付きません）` : `${r.name} の QR を再開しました`)} className="whitespace-nowrap rounded border px-2 py-1 text-xs">{r.active ? '止める' : '再開する'}</button>
      </td>
    </tr>
  );
}

export default function ReferralEditor({ pageOpen, kind = 'partner' }: { pageOpen: boolean; kind?: Kind }) {
  const { data, reload } = useFetch<{ rows: Ref[] }>('/api/admin/hq/referrals');
  // 媒体に使えるきっかけ：新患継続率のきっかけの選択肢から、内訳つきのもの（業者紹介・紹介他事業など）とギフトカードを除く
  const opt = useFetch<{ options: { trigger: string[] }; detailFor: Record<string, unknown> }>(kind === 'media' ? '/api/admin/hq/karte/options' : null).data;
  const triggers = (opt?.options.trigger ?? []).filter((t) => !(t in (opt?.detailFor ?? {})) && t !== 'ギフトカード');
  const [name, setName] = useState('');
  const [trig, setTrig] = useState('');
  const [msg, setMsg] = useState('');
  const w = WORD[kind];
  const rows = (data?.rows ?? []).filter((r) => (r.kind ?? 'partner') === kind);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/hq/referrals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'media' ? { name, kind, trig } : { name }) });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? `「${name.trim()}」を追加しました。${kind === 'media' ? 'URL をコピーするか QR 画像を保存して、その媒体に載せてください' : 'QR 画像を保存してパンフレットに貼ってください'}` : j.error ?? '追加できませんでした');
    if (res.ok) { setName(''); reload(); }
  }
  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label={`${w}の専用 QR`}>
      <h2 className="font-bold">{kind === 'media' ? '媒体ごとの店舗えらび URL・QR（Instagram・チラシ・ポスターなど）' : '紹介元（業者）の専用 QR'}</h2>
      {kind === 'media' ? (
        <p className="mt-1 text-xs text-slate-600">
          媒体ごとに専用の URL と QR を作ります。そこから店舗えらびページを開いて WEB 予約した初診の方は、新患継続率のきっかけが<b>選んだきっかけ</b>（SNS・チラシなど）、内訳が<b>媒体の名前</b>で自動で入ります。
          媒体ごとの予約数は、この表で見られます。
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-600">
          業者ごとに専用の QR を作ります。QR を読むと店舗えらびページが開き、そこから WEB 予約した初診の方は、新患継続率のきっかけが<b>「業者紹介」</b>、内訳が<b>業者の名前</b>で自動で入ります。
          業者ごとの人数は、新患・再来集計のきっかけ「業者紹介」の内訳で見られます。
        </p>
      )}
      {!pageOpen && <p className="mt-2 rounded bg-amber-50 px-3 py-1 text-xs text-amber-900">店舗えらびページがまだ「非公開」です。公開するまでは、QR を読んでも「準備中」と出ます（上の「店舗えらびページ」で公開してください）。</p>}
      <form onSubmit={add} className="mt-2 flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'media' ? '例：Instagram、11月 ポスティングチラシ' : '例：ワタモ'} maxLength={40} aria-label={`新しい${w}の名前`} className="w-56 rounded border px-2 py-1" />
        {kind === 'media' && (
          <select value={trig} onChange={(e) => setTrig(e.target.value)} aria-label="入るきっかけ" className="rounded border px-2 py-1">
            <option value="">入るきっかけを選ぶ</option>
            {triggers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button type="submit" disabled={!name.trim() || (kind === 'media' && !trig)} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{w}を追加</button>
      </form>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full">
          <thead><tr className="text-left text-xs text-slate-500"><th className="pr-2">{w}</th>{kind === 'media' && <th className="pr-2">入るきっかけ</th>}<th className="pr-2">専用 URL</th><th className="pr-2">QR</th><th className="pr-2 text-right">WEB 予約</th><th className="pr-2 text-right">新患継続率</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => <Row key={`${r.id}:${r.name}:${r.active}:${r.trig}`} r={r} triggers={triggers} onSaved={reload} onMsg={setMsg} />)}
            {data && rows.length === 0 && <tr><td colSpan={7} className="py-2 text-xs text-slate-400">まだ登録はありません</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
