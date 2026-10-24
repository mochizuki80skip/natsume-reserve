// 本部：店舗えらびページ（紹介カードの QR の行き先）の公開と、店舗ごとの住所・地図の位置・載せるか
import { useState } from 'react';
import UrlQrCard from './UrlQrCard';

export interface ListingStore { code: string; name: string; active: boolean; address: string; lat: number | null; lng: number | null; listed: boolean }

function Row({ st, onSaved }: { st: ListingStore; onSaved: (msg: string) => void }) {
  const [address, setAddress] = useState(st.address);
  const [pos, setPos] = useState(st.lat != null ? `${st.lat}, ${st.lng}` : '');
  const [listed, setListed] = useState(st.listed);
  const [note, setNote] = useState('');
  const dirty = address !== st.address || pos !== (st.lat != null ? `${st.lat}, ${st.lng}` : '') || listed !== st.listed;

  // 国土地理院の住所検索（無料・登録不要）で、住所から地図の位置を調べる
  async function findPos() {
    if (!address.trim()) { setNote('先に住所を入れてください'); return; }
    setNote('調べています…');
    try {
      const j = await (await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(address.trim())}`)).json();
      const c = j?.[0]?.geometry?.coordinates;
      if (!c) { setNote('見つかりませんでした。Google マップで店舗を右クリックして出る数字（例：34.97, 138.38）を貼り付けてください'); return; }
      setPos(`${Number(c[1]).toFixed(6)}, ${Number(c[0]).toFixed(6)}`);
      setNote(`「${j[0].properties?.title ?? ''}」の位置にしました（保存を押してください）`);
    } catch { setNote('調べられませんでした。Google マップで店舗を右クリックして出る数字を貼り付けてください'); }
  }
  async function save() {
    const m = pos.trim() === '' ? null : /^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(pos);
    if (pos.trim() !== '' && !m) { setNote('地図の位置は「緯度, 経度」（例：34.97, 138.38）の形で入れてください'); return; }
    const r = await fetch('/api/admin/hq/stores', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: st.code, action: 'listing', address, lat: m ? Number(m[1]) : null, lng: m ? Number(m[2]) : null, listed }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setNote(j.error ?? '保存できませんでした'); return; }
    setNote('');
    onSaved(`${st.name} を保存しました`);
  }
  return (
    <tr className={`border-t align-top ${st.active ? '' : 'text-slate-400'}`}>
      <td className="py-1.5 pr-2"><label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} aria-label={`${st.name} を載せる`} />{st.name}</label>{!st.active && <span className="text-xs">（停止中）</span>}</td>
      <td className="py-1.5 pr-2"><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="静岡県静岡市…" className="w-full min-w-[16rem] rounded border px-2 py-1" aria-label={`${st.name} の住所`} /></td>
      <td className="py-1.5 pr-2">
        <div className="flex gap-1">
          <input value={pos} onChange={(e) => setPos(e.target.value)} placeholder="34.97, 138.38" className="w-44 rounded border px-2 py-1 font-mono text-xs" aria-label={`${st.name} の地図の位置`} />
          <button type="button" onClick={findPos} className="whitespace-nowrap rounded border px-2 text-xs">住所から調べる</button>
        </div>
        {note && <p className="mt-0.5 text-xs text-slate-600">{note}</p>}
      </td>
      <td className="py-1.5 text-right"><button type="button" onClick={save} disabled={!dirty} className="rounded bg-brand px-3 py-1 text-white disabled:opacity-30">保存</button></td>
    </tr>
  );
}

export default function StoresPageEditor({ stores, open, onRefresh }: { stores: ListingStore[]; open: boolean; onRefresh: () => void }) {
  const [msg, setMsg] = useState('');
  async function toggle() {
    if (!open && !confirm('店舗えらびページを公開します。紹介カードの QR から開いた患者様に、店舗の一覧が表示されるようになります。よろしいですか？')) return;
    const r = await fetch('/api/admin/hq/stores-page', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ open: !open }) });
    setMsg(r.ok ? (open ? '非公開にしました（「準備中」の表示に戻ります）' : '公開しました') : '変更できませんでした');
    onRefresh();
  }
  const done = stores.filter((s) => s.listed && s.active && s.address && s.lat != null).length;
  const shown = stores.filter((s) => s.listed && s.active).length;
  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-bold">店舗えらびページ（紹介カードの QR）</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${open ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>{open ? '公開中' : '非公開（患者様には「準備中」）'}</span>
        <button type="button" onClick={toggle} className={`rounded px-3 py-1 font-bold ${open ? 'border' : 'bg-brand text-white'}`}>{open ? '非公開にする' : '公開する'}</button>
        <a href="/stores?from=card&preview=1" target="_blank" rel="noreferrer" className="text-brand underline">表示を確認する ↗</a>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        チェックした店舗をエリアごと（新患・再来集計の「エリアの設定」）に並べます。住所を入れて「住所から調べる」を押すと地図の位置（近い順・地図ボタンに使う）が入ります。
        入力済み {done}／載せる店舗 {shown}。すべて入れ終わってから「公開する」を押してください。
      </p>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      {/* 店舗えらびページの URL と QR（ふつう用と紹介カード用。紹介カード用から予約すると、きっかけに「ギフトカード」が入る） */}
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <UrlQrCard label="店舗えらびの URL（ふつう）" help="ホームページ・チラシ・SNS などに。全店舗の一覧から店舗を選んで WEB 予約します" url={`${location.origin}/stores`} fileName="QR_店舗えらび" />
        <UrlQrCard label="店舗えらびの URL（紹介カード用）" help="紹介カードに印刷する QR。ここから予約すると、新患継続率のきっかけに「ギフトカード」が入ります" url={`${location.origin}/stores?from=card`} fileName="QR_店舗えらび_紹介カード" />
      </div>
      {!open && <p className="mt-1 text-xs text-amber-800">※ 今は非公開なので、この URL を開いた患者様には「準備中」と出ます。公開してから配ってください。</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full">
          <thead><tr className="text-left text-xs text-slate-500"><th className="pr-2">載せる・店舗</th><th className="pr-2">住所</th><th className="pr-2">地図の位置（緯度, 経度）</th><th /></tr></thead>
          <tbody>{stores.map((st) => <Row key={`${st.code}:${st.address}:${st.lat}:${st.listed}`} st={st} onSaved={(m) => { setMsg(m); onRefresh(); }} />)}</tbody>
        </table>
      </div>
    </section>
  );
}
