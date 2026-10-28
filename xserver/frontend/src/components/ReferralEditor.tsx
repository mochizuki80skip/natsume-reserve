// 本部：紹介元（業者）・媒体ごとの専用 QR。QR から店舗えらびページを開いて予約した初診の方は、新患継続率のきっかけが
// 「業者紹介」（媒体は決めたきっかけ）、内訳が業者名・媒体名で入る
import { useState } from 'react';
import QRCode from 'qrcode';
import { useQrBlobUrl } from './UrlQrCard';
import { makeZip, safeFileName } from '@/lib/zip';
import { useFetch } from '@/lib/api';

interface Ref { id: string; code: string; name: string; active: boolean; kind: 'partner' | 'media'; trig: string; createdAt: string; reservations: number; kartes: number; stores?: string[]; byStore?: Record<string, number> }
interface StoreLite { code: string; name: string; area: string }
type Kind = 'partner' | 'media';
const WORD: Record<Kind, string> = { partner: '紹介元', media: '媒体' };

const urlOf = (code: string) => `${location.origin}/stores?ref=${code}`;
/** 店舗の予約ページへ直接の URL（媒体の印つき） */
export const storeUrlOf = (store: string, code: string) => `${location.origin}/s/${encodeURIComponent(store)}?ref=${code}`;

function Qr({ url, fileName, alt, size = 72 }: { url: string; fileName: string; alt: string; size?: number }) {
  const src = useQrBlobUrl(url);
  if (!src) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <img src={src} alt={alt} width={size} height={size} className="rounded border" />
      <a href={src} download={`${fileName}.png`} className="whitespace-nowrap rounded border px-2 py-1 text-xs no-underline">保存</a>
    </span>
  );
}

/** 媒体を使う店舗を選ぶ（エリアごと。選んだ店舗に、その店舗の予約ページへ直接の URL・QR ができる） */
function StorePicker({ r, all, onSave }: { r: Ref; all: StoreLite[]; onSave: (stores: string[]) => void }) {
  const [pick, setPick] = useState<string[]>(r.stores ?? []);
  const areas = [...new Set(all.map((s) => s.area))];
  const dirty = pick.slice().sort().join() !== (r.stores ?? []).slice().sort().join();
  const toggle = (codes: string[], on: boolean) => setPick((p) => (on ? [...new Set([...p, ...codes])] : p.filter((c) => !codes.includes(c))));
  return (
    <details className="text-xs">
      <summary className="cursor-pointer whitespace-nowrap rounded border px-2 py-1" aria-label={`${r.name} を使う店舗`}>使う店舗 {(r.stores ?? []).length}店</summary>
      <div className="mt-1 w-72 rounded border bg-white p-2 shadow">
        <div className="mb-1 flex gap-2"><button type="button" onClick={() => setPick(all.map((s) => s.code))} className="underline">全店</button><button type="button" onClick={() => setPick([])} className="underline">すべて外す</button></div>
        {areas.map((a) => {
          const list = all.filter((s) => s.area === a);
          return (
            <div key={a || '-'} className="mb-1">
              <label className="font-bold"><input type="checkbox" checked={list.every((s) => pick.includes(s.code))} onChange={(e) => toggle(list.map((s) => s.code), e.target.checked)} /> {a || 'エリア未設定'}</label>
              <div className="ml-4 flex flex-wrap gap-x-3">{list.map((s) => <label key={s.code} className="whitespace-nowrap"><input type="checkbox" checked={pick.includes(s.code)} onChange={(e) => toggle([s.code], e.target.checked)} aria-label={`${r.name}：${s.name}`} /> {s.name}</label>)}</div>
            </div>
          );
        })}
        <button type="button" disabled={!dirty} onClick={() => onSave(pick)} className="mt-1 rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">保存（{pick.length}店）</button>
      </div>
    </details>
  );
}

/** 媒体ごと・店舗ごとの URL・QR の一覧と、まとめて保存（QR の zip・URL の Excel） */
function MediaStoreTable({ rows, stores, onMsg }: { rows: Ref[]; stores: StoreLite[]; onMsg: (m: string) => void }) {
  const media = rows.filter((r) => r.active && (r.stores ?? []).length > 0);
  const [off, setOff] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const nameOf = new Map(stores.map((s) => [s.code, s.name]));
  if (media.length === 0) return <p className="mt-3 text-xs text-slate-500">媒体の「使う店舗」を選ぶと、その店舗の予約ページへ直接の URL・QR がここにできます（店舗設定にも出ます）。</p>;
  async function zip() {
    setBusy(true);
    try {
      const files: { name: string; data: Uint8Array }[] = [];
      for (const m of media.filter((x) => !off.includes(x.id))) {
        for (const c of m.stores ?? []) {
          if (!nameOf.has(c)) continue;
          const d = await QRCode.toDataURL(storeUrlOf(c, m.code), { width: 800, margin: 2, errorCorrectionLevel: 'M' });
          files.push({ name: `QR_${safeFileName(nameOf.get(c)!)}_${safeFileName(m.name)}.png`, data: new Uint8Array(await (await fetch(d)).arrayBuffer()) });
        }
      }
      const blob = new Blob([makeZip(files)], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `媒体別QR_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      onMsg(`QR を ${files.length} 枚まとめて保存しました（zip）`);
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-4" role="region" aria-label="店舗ごとの URL・QR">
      <h3 className="font-bold">店舗ごとの WEB 予約 URL・QR（店舗の予約ページへ直接）</h3>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">まとめて保存する媒体：</span>
        {media.map((m) => <label key={m.id}><input type="checkbox" checked={!off.includes(m.id)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((x) => x !== m.id) : [...o, m.id]))} /> {m.name}</label>)}
        <button type="button" disabled={busy || media.every((m) => off.includes(m.id))} onClick={zip} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{busy ? '作っています…' : 'QR をまとめて保存（zip）'}</button>
        <a href="/api/admin/hq/referrals/export" className="rounded border px-3 py-1 font-bold no-underline">URL の一覧を Excel で保存</a>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th className="pr-2">媒体</th><th className="pr-2">店舗</th><th className="pr-2">URL</th><th className="pr-2">QR</th><th className="pr-2 text-right">WEB 予約</th></tr></thead>
          <tbody>
            {media.flatMap((m) => (m.stores ?? []).filter((c) => nameOf.has(c)).map((c, i) => (
              <tr key={`${m.id}:${c}`} className="border-t align-middle">
                <td className="py-1 pr-2 font-bold">{i === 0 ? <>{m.name}<span className="block font-normal text-slate-500">{m.trig}</span></> : ''}</td>
                <td className="py-1 pr-2 whitespace-nowrap">{nameOf.get(c)}</td>
                <td className="py-1 pr-2"><code className="break-all">{storeUrlOf(c, m.code)}</code> <button type="button" onClick={() => navigator.clipboard.writeText(storeUrlOf(c, m.code)).then(() => onMsg('URL をコピーしました')).catch(() => {})} className="rounded border px-1.5">コピー</button></td>
                <td className="py-1 pr-2"><Qr url={storeUrlOf(c, m.code)} fileName={`QR_${safeFileName(nameOf.get(c)!)}_${safeFileName(m.name)}`} alt={`${nameOf.get(c)}・${m.name} の QR コード`} size={48} /></td>
                <td className="py-1 pr-2 text-right tabular-nums">{m.byStore?.[c] ?? 0}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function Row({ r, triggers, stores, onSaved, onMsg }: { r: Ref; triggers: string[]; stores: StoreLite[]; onSaved: () => void; onMsg: (m: string) => void }) {
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
      <td className="py-1.5 pr-2">{r.active && <Qr url={urlOf(r.code)} fileName={`QR_${r.name}`} alt={`${r.name} の QR コード`} />}</td>
      {r.kind === 'media' && <td className="py-1.5 pr-2 align-top">{r.active && <StorePicker key={(r.stores ?? []).join()} r={r} all={stores} onSave={(s) => put({ stores: s }, `${r.name} を使う店舗を ${s.length} 店にしました（店舗ごとの URL・QR は下の表と店舗設定に出ます）`)} />}</td>}
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.reservations}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.kartes}</td>
      <td className="py-1.5 text-right">
        <button type="button" onClick={() => put({ active: !r.active }, r.active ? `${r.name} の QR を止めました（読んでも${w}は付きません）` : `${r.name} の QR を再開しました`)} className="whitespace-nowrap rounded border px-2 py-1 text-xs">{r.active ? '止める' : '再開する'}</button>
      </td>
    </tr>
  );
}

export default function ReferralEditor({ pageOpen, kind = 'partner' }: { pageOpen: boolean; kind?: Kind }) {
  const { data, reload } = useFetch<{ rows: Ref[]; stores?: StoreLite[] }>('/api/admin/hq/referrals');
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
      <h2 className="font-bold">{kind === 'media' ? '媒体ごとの WEB 予約 URL・QR（Instagram・チラシ・ポスターなど）' : '紹介元（業者）の専用 QR'}</h2>
      {kind === 'media' ? (
        <p className="mt-1 text-xs text-slate-600">
          媒体ごとに専用の URL と QR を作ります。そこから WEB 予約した初診の方は、新患継続率のきっかけが<b>選んだきっかけ</b>（SNS・チラシなど）、内訳が<b>媒体の名前</b>で自動で入ります。「<b>使う店舗</b>」を選ぶと、その店舗の予約ページへ直接の URL・QR が下の表にでき、店舗の「店舗設定」にも出ます（店舗は見る・保存するだけ）。
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
          <thead><tr className="text-left text-xs text-slate-500"><th className="pr-2">{w}</th>{kind === 'media' && <th className="pr-2">入るきっかけ</th>}<th className="pr-2">{kind === 'media' ? '店舗えらびの URL' : '専用 URL'}</th><th className="pr-2">QR</th>{kind === 'media' && <th className="pr-2">使う店舗</th>}<th className="pr-2 text-right">WEB 予約</th><th className="pr-2 text-right">新患継続率</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => <Row key={`${r.id}:${r.name}:${r.active}:${r.trig}`} r={r} triggers={triggers} stores={data?.stores ?? []} onSaved={reload} onMsg={setMsg} />)}
            {data && rows.length === 0 && <tr><td colSpan={8} className="py-2 text-xs text-slate-400">まだ登録はありません</td></tr>}
          </tbody>
        </table>
      </div>
      {kind === 'media' && data && <MediaStoreTable rows={rows} stores={data.stores ?? []} onMsg={setMsg} />}
    </section>
  );
}
