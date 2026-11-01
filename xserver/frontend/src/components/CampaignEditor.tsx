// 本部：WEB 予約の URL・QR（集客経路）の一覧。1 行＝1 つの URL（店舗えらび用 1 本＋店舗別）。
// 作るときは ① 名前 ② 新患継続率のきっかけ（媒体） ③ 使う店舗 ④ キャンペーンを付けるか の順。キャンペーンは付けても付けなくてもよい。
// キャンペーンを付けると、その URL から開いた店舗えらびページ・予約ページに内容と保険の目安を出し、決めた区分を選んだ状態で始める。
// 店舗向けメモは予約表にだけ出す（患者様には出さない）。保険のご負担の目安は全キャンペーン共通の表
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { formatDateJa } from '@/lib/time';
import QRCode from 'qrcode';
import CampaignBox from './CampaignBox';
import { Qr } from './ReferralEditor';
import { makeZip, safeFileName } from '@/lib/zip';

interface Ins { label: string; amount: number }
interface StoreLite { code: string; name: string; area: string }
interface Entry {
  id: string; code: string; label: string; trig: string; stores: string[]; hasContent: boolean; active: boolean;
  name: string; description: string; showInsurance: boolean; presetKind: string; from: string; to: string; memo: string;
  reservations: number; kartes: number;
}
interface Resp { rows: Entry[]; insurance: Ins[]; stores: StoreLite[]; triggers: string[] }

/** URL（店舗えらび用・店舗別） */
const urlOf = (code: string, store?: string) => `${location.origin}${store ? `/s/${encodeURIComponent(store)}` : '/stores'}?c=${code}`;

const KIND_OPTIONS: [string, string][] = [['', '選ばない（患者様が選ぶ）'], ['NEW', 'はじめて（ケガ・痛み・不調など）'], ['ACCIDENT', 'はじめて（交通事故）'], ['REVISIT', '再来（1ヶ月以上ぶり）'], ['RETURN', '現在通院中']];
const EMPTY = { label: '', trig: '', stores: [] as string[], hasContent: false, name: '', description: '', showInsurance: true, presetKind: 'NEW', from: '', to: '', memo: '' };
const isGift = (trig: string) => trig === 'ギフトカード';

async function send(method: string, url: string, body: unknown): Promise<{ ok: boolean; j: { error?: string } }> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}

function InsuranceEditor({ rows, onSaved, onMsg }: { rows: Ins[]; onSaved: () => void; onMsg: (m: string) => void }) {
  const [list, setList] = useState<{ label: string; amount: string }[]>(rows.map((r) => ({ label: r.label, amount: String(r.amount) })));
  const set = (i: number, k: 'label' | 'amount', v: string) => setList(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  async function save() {
    const { ok, j } = await send('PUT', '/api/admin/hq/insurance', { rows: list.map((x) => ({ label: x.label, amount: x.amount.replace(/[,，円\s]/g, '') })) });
    onMsg(ok ? '保険のご負担の目安を保存しました（全部のキャンペーンに反映します。すでに入っている予約は、予約したときの金額のままです）' : j.error ?? '保存できませんでした');
    if (ok) onSaved();
  }
  return (
    <div className="mt-3 rounded border p-3" role="group" aria-label="保険のご負担の目安">
      <h3 className="font-bold">保険のご負担の目安（全部のキャンペーンで共通）</h3>
      <p className="text-xs text-slate-600">保険の改定のときは、ここを直すだけで全部のキャンペーンに反映します（すでに入っている予約は、予約したときの金額のまま）。キャンペーンごとに「出す・出さない」を選べます。</p>
      <table className="mt-1 text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="pr-2">負担割合</th><th className="pr-2">金額（円）</th><th /></tr></thead>
        <tbody>
          {list.map((x, i) => (
            <tr key={i}>
              <td className="pr-2"><input value={x.label} onChange={(e) => set(i, 'label', e.target.value)} maxLength={20} aria-label={`負担割合 ${i + 1}`} className="w-28 rounded border px-2 py-0.5" /></td>
              <td className="pr-2"><input value={x.amount} onChange={(e) => set(i, 'amount', e.target.value)} inputMode="numeric" aria-label={`金額 ${i + 1}`} className="w-24 rounded border px-2 py-0.5 text-right" /></td>
              <td><button type="button" onClick={() => setList(list.filter((_, j) => j !== i))} className="text-xs text-red-700 underline">消す</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex gap-2">
        <button type="button" onClick={() => setList([...list, { label: '', amount: '' }])} className="rounded border px-2 py-0.5 text-xs">＋ 行を足す</button>
        <button type="button" onClick={save} className="rounded bg-brand px-3 py-0.5 text-xs font-bold text-white">目安を保存</button>
      </div>
    </div>
  );
}

function StoreChoice({ all, pick, onChange }: { all: StoreLite[]; pick: string[]; onChange: (p: string[]) => void }) {
  const areas = [...new Set(all.map((s) => s.area))];
  const toggle = (codes: string[], on: boolean) => onChange(on ? [...new Set([...pick, ...codes])] : pick.filter((c) => !codes.includes(c)));
  const [some, setSome] = useState(pick.length > 0);
  return (
    <div>
      <label className="mr-3"><input type="radio" checked={!some} onChange={() => { setSome(false); onChange([]); }} /> 全店（基本）</label>
      <label><input type="radio" checked={some} onChange={() => setSome(true)} aria-label="店舗を選ぶ" /> 店舗を選ぶ</label>
      {some && (
        <div className="mt-1 rounded border bg-slate-50 p-2 text-xs" role="group" aria-label="キャンペーンを使う店舗">
          {areas.map((a) => {
            const list = all.filter((s) => s.area === a);
            return (
              <div key={a || '-'} className="mb-1">
                <label className="font-bold"><input type="checkbox" checked={list.every((s) => pick.includes(s.code))} onChange={(e) => toggle(list.map((s) => s.code), e.target.checked)} /> {a || 'エリア未設定'}</label>
                <div className="ml-4 flex flex-wrap gap-x-3">{list.map((s) => <label key={s.code} className="whitespace-nowrap"><input type="checkbox" checked={pick.includes(s.code)} onChange={(e) => toggle([s.code], e.target.checked)} aria-label={`キャンペーンの店舗：${s.name}`} /> {s.name}</label>)}</div>
              </div>
            );
          })}
          <p className="text-slate-500">{pick.length} 店を選んでいます（選んでいない店舗の予約ページには出ません）</p>
        </div>
      )}
    </div>
  );
}

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="rounded border bg-slate-50 p-2">
    <p className="font-bold"><b className="mr-1 inline-block h-5 w-5 rounded-full bg-brand text-center text-xs leading-5 text-white">{n}</b>{title}</p>
    <div className="mt-1">{children}</div>
  </div>
);

function EntryForm({ init, data, onDone, onMsg }: { init: Entry | null; data: Resp; onDone: () => void; onMsg: (m: string) => void }) {
  const [f, setF] = useState(init ? { label: init.label, trig: init.trig, stores: init.stores, hasContent: init.hasContent, name: init.name, description: init.description, showInsurance: init.showInsurance, presetKind: init.presetKind, from: init.from, to: init.to, memo: init.memo } : EMPTY);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { ok, j } = await send('PUT', '/api/admin/hq/campaigns', { ...(init ? { id: init.id } : {}), ...f });
    onMsg(ok ? `「${f.label.trim()}」を保存しました。${init ? '' : '一覧に URL・QR ができました（店舗えらび用＋店舗別）'}` : j.error ?? '保存できませんでした');
    if (ok) onDone();
  }
  const can = f.label.trim() !== '' && f.trig !== '' && (!f.hasContent || f.name.trim() !== '');
  return (
    <form onSubmit={save} className="mt-3 rounded border-2 border-brand p-3" aria-label={init ? 'URL・QR を直す' : 'URL・QR を作る'}>
      <h3 className="font-bold">{init ? `「${init.label}」を直す` : 'URL・QR を作る'}<span className="ml-2 text-xs font-normal text-slate-500">上から順に入れてください</span></h3>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <Step n={1} title="名前">
          <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={60} placeholder="例）Instagram 広告（冬）、ギフトカード、ポータルサイト A" aria-label="URL の名前" className="w-full rounded border px-2 py-1" />
          <span className="text-xs text-slate-500">新患継続率の「内訳」に入ります</span>
        </Step>
        <Step n={2} title="新患継続率のきっかけ（媒体）">
          <select value={f.trig} onChange={(e) => setF({ ...f, trig: e.target.value })} aria-label="新患継続率のきっかけ" className="rounded border px-2 py-1">
            <option value="">選ぶ</option>
            {data.triggers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="block text-xs text-slate-500">この URL から予約した初診の方は、ここで選んだきっかけで自動で入ります</span>
        </Step>
        <Step n={3} title="使う店舗">
          <StoreChoice all={data.stores} pick={f.stores} onChange={(stores) => setF({ ...f, stores })} />
          <span className="text-xs text-slate-500">店舗えらび用の URL を開くと、ここで選んだ店舗だけが並びます</span>
        </Step>
        <Step n={4} title="キャンペーン">
          <div role="radiogroup" aria-label="キャンペーンを付けるか" className="flex gap-2">
            {([[false, '付けない'], [true, '付ける']] as const).map(([v, l]) => (
              <button key={l} type="button" role="radio" aria-checked={f.hasContent === v} onClick={() => setF({ ...f, hasContent: v })}
                className={`rounded border-2 border-brand px-3 py-0.5 font-bold ${f.hasContent === v ? 'bg-brand text-white' : 'bg-white text-brand-dark'}`}>{l}</button>
            ))}
          </div>
          <span className="text-xs text-slate-500">付けると、その URL から開いたページの上にキャンペーンの内容が出ます</span>
        </Step>
      </div>
      {f.hasContent && (
        <div className="mt-2 flex flex-wrap gap-4 rounded border border-orange-300 bg-orange-50/40 p-2" role="group" aria-label="キャンペーンの内容">
          <div className="min-w-[300px] flex-1 space-y-2">
            <label className="block">キャンペーン名<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} placeholder="例）初回 骨格・骨盤矯正 1,000円 → 無料" aria-label="キャンペーン名" className="mt-0.5 w-full rounded border px-2 py-1" /></label>
            <label className="block">説明（患者様に出す）<textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={600} rows={3} placeholder={'例）初回の骨格・骨盤矯正が無料になります。\n※別途、保険の自己負担分がかかります。'} aria-label="説明" className="mt-0.5 w-full rounded border px-2 py-1" /></label>
            <label className="block"><input type="checkbox" checked={f.showInsurance} onChange={(e) => setF({ ...f, showInsurance: e.target.checked })} /> 保険のご負担の目安（共通の表）を出す</label>
            <label className="block">はじめから選ぶ区分
              <select value={f.presetKind} onChange={(e) => setF({ ...f, presetKind: e.target.value })} aria-label="はじめから選ぶ区分" className="ml-2 rounded border px-2 py-1">
                {KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span className="block text-xs text-slate-500">患者様はあとから変えることもできます</span>
            </label>
            <div>期間
              <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="期間の始め" className="ml-2 rounded border px-1 py-0.5" /> 〜
              <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="期間の終わり" className="ml-1 rounded border px-1 py-0.5" />
              <span className="ml-2 text-xs text-slate-500">空欄＝ずっと。期間の外は、URL はそのまま使えてキャンペーンだけ出ません</span>
            </div>
            <label className="block">店舗向けメモ（会計の注意など。予約表にだけ出す）<textarea value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} maxLength={600} rows={2} placeholder="例）会計：矯正 0 円＋保険の自己負担" aria-label="店舗向けメモ" className="mt-0.5 w-full rounded border px-2 py-1" /></label>
          </div>
          <div className="w-[300px]">
            <p className="text-xs font-bold text-slate-600">予約ページでの見え方</p>
            <CampaignBox c={{ route: isGift(f.trig) ? 'ギフトカード' : 'キャンペーン', name: f.name || 'キャンペーン名', description: f.description, insurance: f.showInsurance ? data.insurance : [] }} />
          </div>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={!can} className="rounded bg-brand px-4 py-1 font-bold text-white disabled:opacity-40">保存</button>
        <button type="button" onClick={onDone} className="rounded border px-3 py-1">やめる</button>
        {!can && <span className="self-center text-xs text-slate-500">{!f.label.trim() ? '① 名前を入れてください' : !f.trig ? '② きっかけを選んでください' : 'キャンペーン名を入れてください'}</span>}
      </div>
    </form>
  );
}

/** URL・QR（店舗えらび用 1 本と、使う店舗ごと） */
function EntryUrls({ c, stores, onMsg }: { c: Entry; stores: StoreLite[]; onMsg: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const list = c.stores.length ? stores.filter((s) => c.stores.includes(s.code)) : stores;
  const copy = (u: string) => navigator.clipboard.writeText(u).then(() => onMsg('URL をコピーしました')).catch(() => {});
  async function zip() {
    setBusy(true);
    try {
      const files: { name: string; data: Uint8Array }[] = [];
      for (const [u, n] of [[urlOf(c.code), '店舗えらび'], ...list.map((s) => [urlOf(c.code, s.code), s.name])] as [string, string][]) {
        const d = await QRCode.toDataURL(u, { width: 800, margin: 2, errorCorrectionLevel: 'M' });
        files.push({ name: `QR_${safeFileName(c.label)}_${safeFileName(n)}.png`, data: new Uint8Array(await (await fetch(d)).arrayBuffer()) });
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([makeZip(files)], { type: 'application/zip' })); a.download = `QR_${safeFileName(c.label)}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      onMsg(`QR を ${files.length} 枚まとめて保存しました（zip）`);
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-1 space-y-1 rounded border bg-slate-50 p-2 text-xs" role="region" aria-label={`${c.label} の URL・QR の一覧`}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="w-28">店舗えらび用</b><code className="break-all">{urlOf(c.code)}</code>
        <button type="button" onClick={() => copy(urlOf(c.code))} className="rounded border bg-white px-1.5">コピー</button>
        <Qr url={urlOf(c.code)} fileName={`QR_${safeFileName(c.label)}_店舗えらび`} alt={`${c.label}（店舗えらび用）の QR コード`} size={48} />
      </div>
      <div className="flex flex-wrap gap-2 py-1">
        <button type="button" disabled={busy} onClick={zip} className="rounded bg-brand px-3 py-1 font-bold text-white disabled:opacity-40">{busy ? '作っています…' : 'QR をまとめて保存（zip）'}</button>
      </div>
      <table className="w-full">
        <tbody>
          {list.map((s) => (
            <tr key={s.code} className="border-t align-middle">
              <td className="w-28 whitespace-nowrap py-1 pr-2">{s.name}</td>
              <td className="py-1 pr-2"><code className="break-all">{urlOf(c.code, s.code)}</code> <button type="button" onClick={() => copy(urlOf(c.code, s.code))} className="rounded border bg-white px-1.5">コピー</button></td>
              <td className="py-1"><Qr url={urlOf(c.code, s.code)} fileName={`QR_${safeFileName(c.label)}_${safeFileName(s.name)}`} alt={`${c.label}・${s.name} の QR コード`} size={48} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ c, data, onEdit, onMsg, reload }: { c: Entry; data: Resp; onEdit: () => void; onMsg: (m: string) => void; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const nameOf = new Map(data.stores.map((s) => [s.code, s.name]));
  async function toggle() {
    const { ok } = await send('PUT', '/api/admin/hq/campaigns', { id: c.id, active: !c.active });
    onMsg(ok ? `「${c.name}」を${c.active ? '止めました（URL はそのまま使えます）' : '再開しました'}` : '変えられませんでした');
    reload();
  }
  async function remove() {
    if (!confirm(`「${c.label}」の URL・QR を消しますか？\nこの URL を開いた方は、ふつうの予約ページになります（新患継続率のきっかけは入りません）。配った QR があるときは消さないでください。`)) return;
    const { ok } = await send('DELETE', '/api/admin/hq/campaigns', { id: c.id });
    onMsg(ok ? `「${c.label}」を消しました` : '消せませんでした');
    reload();
  }
  return (
    <>
      <tr className="border-t align-top" aria-label={`URL ${c.label}`}>
        <td className="py-1 pr-2 font-bold">{c.label}</td>
        <td className="whitespace-nowrap py-1 pr-2">{c.trig}</td>
        <td className="py-1 pr-2 text-xs" title={c.stores.map((s) => nameOf.get(s) ?? s).join('・')}>{c.stores.length ? `${c.stores.length} 店` : '全店'}</td>
        <td className="py-1 pr-2 text-xs">
          {c.hasContent ? (
            <>
              <span className={`rounded px-1.5 font-bold ${c.active ? 'bg-orange-600 text-white' : 'bg-slate-200 text-slate-500'}`}>🎁 {c.name}{!c.active && '（止めている）'}</span>
              {(c.from || c.to) && <span className="block text-slate-500">{c.from ? formatDateJa(c.from) : ''}〜{c.to ? formatDateJa(c.to) : ''}</span>}
              {c.memo && <span className="block text-slate-500">店舗向け：{c.memo}</span>}
            </>
          ) : <span className="rounded bg-slate-200 px-1.5 text-slate-600">なし</span>}
        </td>
        <td className="py-1 pr-2 text-right tabular-nums">{c.reservations}</td>
        <td className="py-1 pr-2 text-right tabular-nums">{c.kartes}</td>
        <td className="whitespace-nowrap py-1 text-xs">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mr-2 rounded border-2 border-brand px-2 font-bold text-brand-dark">{open ? '▲ URL・QR' : '▼ URL・QR'}</button>
          <button type="button" onClick={onEdit} className="mr-2 underline">直す</button>
          {c.hasContent && <button type="button" onClick={toggle} className="mr-2 underline">{c.active ? 'キャンペーンを止める' : 'キャンペーンを再開'}</button>}
          <button type="button" onClick={remove} className="text-red-700 underline">消す</button>
        </td>
      </tr>
      {open && <tr><td colSpan={7}><EntryUrls c={c} stores={data.stores} onMsg={onMsg} /></td></tr>}
    </>
  );
}

export default function CampaignEditor() {
  const { data, reload } = useFetch<Resp>('/api/admin/hq/campaigns');
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<Entry | 'new' | null>(null);
  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label="WEB 予約の URL・QR">
      <h2 className="font-bold">🔗 WEB 予約の URL・QR（集客経路）とキャンペーン</h2>
      <p className="mt-1 text-xs text-slate-600">
        ギフトカード・SNS 広告・チラシ・ポータルサイトなど、載せる先ごとに URL・QR を作ります。1 つ作ると、<b>店舗えらび用の URL・QR 1 本</b>と<b>店舗別の URL・QR</b>ができます。
        そこから予約した初診の方は、新患継続率のきっかけ・内訳（URL の名前）が自動で入ります。<b>キャンペーン</b>は付けても付けなくてもよく、付けるとその URL から開いたページの上に内容が出て、
        予約表のセルには <b className="rounded bg-orange-600 px-1 text-white">🎁特典</b> と店舗向けメモが出ます。キャンペーンを止めても URL はそのまま使えます（キャンペーンが出なくなるだけ）。
      </p>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full">
          <thead><tr className="text-left text-xs text-slate-500"><th className="pr-2">名前</th><th className="pr-2">きっかけ</th><th className="pr-2">店舗</th><th className="pr-2">キャンペーン</th><th className="pr-2 text-right">WEB 予約</th><th className="pr-2 text-right">新患継続率</th><th /></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((c) => <Row key={c.id} c={c} data={data!} onEdit={() => setEdit(c)} onMsg={setMsg} reload={reload} />)}
            {data && data.rows.length === 0 && <tr><td colSpan={7} className="py-2 text-xs text-slate-400">まだありません。「＋ URL・QR を作る」から作ってください</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {edit === null && <button type="button" onClick={() => setEdit('new')} className="rounded bg-brand px-3 py-1 font-bold text-white">＋ URL・QR を作る</button>}
        <a href="/api/admin/hq/campaigns/export" className="rounded border px-3 py-1 font-bold no-underline">URL の一覧を Excel で保存</a>
      </div>
      {data && edit !== null && <EntryForm key={edit === 'new' ? 'new' : edit.id} init={edit === 'new' ? null : edit} data={data} onDone={() => { setEdit(null); reload(); }} onMsg={setMsg} />}
      {data && <InsuranceEditor key={JSON.stringify(data.insurance)} rows={data.insurance} onSaved={reload} onMsg={setMsg} />}
    </section>
  );
}
