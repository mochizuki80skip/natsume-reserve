// 本部：経路（ギフトカード・媒体の QR・紹介元の QR）ごとのキャンペーンと、保険のご負担の目安（全キャンペーン共通の表）。
// 予約ページにキャンペーンの内容を出し、はじめから選ぶ来院区分を決める。店舗向けメモは予約表にだけ出す（患者様には出さない）
import { useState } from 'react';
import { useFetch } from '@/lib/api';
import { formatDateJa } from '@/lib/time';
import CampaignBox from './CampaignBox';

interface Ins { label: string; amount: number }
interface Route { route: string; label: string; group: 'card' | 'media' | 'partner' }
interface StoreLite { code: string; name: string; area: string }
interface Camp { id: string; route: string; name: string; description: string; showInsurance: boolean; presetKind: string; from: string; to: string; memo: string; stores: string[]; active: boolean; reservations: number }
interface Resp { rows: Camp[]; routes: Route[]; insurance: Ins[]; stores: StoreLite[] }

const KIND_OPTIONS: [string, string][] = [['', '選ばない（患者様が選ぶ）'], ['NEW', 'はじめて（ケガ・痛み・不調など）'], ['ACCIDENT', 'はじめて（交通事故）'], ['REVISIT', '再来（1ヶ月以上ぶり）'], ['RETURN', '現在通院中']];
const KIND_SHORT: Record<string, string> = { '': '選ばない', NEW: 'はじめて（一般）', ACCIDENT: 'はじめて（交通事故）', REVISIT: '再来（1ヶ月以上ぶり）', RETURN: '現在通院中' };
const GROUP_LABEL = { card: 'ギフトカード', media: '媒体の QR', partner: '紹介元（業者）の QR' };
const EMPTY: Omit<Camp, 'id' | 'active' | 'reservations'> = { route: 'card', name: '', description: '', showInsurance: true, presetKind: 'NEW', from: '', to: '', memo: '', stores: [] };

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
      <p className="text-xs text-slate-600">保険の改定のときは、ここを直すだけで全部のキャンペーンに反映します。キャンペーンごとに「出す・出さない」を選べます。</p>
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

function CampaignForm({ init, data, onDone, onMsg }: { init: Camp | null; data: Resp; onDone: () => void; onMsg: (m: string) => void }) {
  const [f, setF] = useState(init ? { route: init.route, name: init.name, description: init.description, showInsurance: init.showInsurance, presetKind: init.presetKind, from: init.from, to: init.to, memo: init.memo, stores: init.stores } : EMPTY);
  const routeLabel = data.routes.find((r) => r.route === f.route)?.label ?? '';
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { ok, j } = await send('PUT', '/api/admin/hq/campaigns', { ...(init ? { id: init.id } : {}), ...f });
    onMsg(ok ? `「${f.name.trim()}」を保存しました。${routeLabel} から開いた予約ページに出ます` : j.error ?? '保存できませんでした');
    if (ok) onDone();
  }
  const groups = (['card', 'media', 'partner'] as const).map((g) => [g, data.routes.filter((r) => r.group === g)] as const).filter(([, l]) => l.length);
  return (
    <form onSubmit={save} className="mt-3 rounded border border-brand p-3" aria-label={init ? 'キャンペーンを直す' : 'キャンペーンを追加'}>
      <h3 className="font-bold">{init ? 'キャンペーンを直す' : 'キャンペーンを追加'}</h3>
      <div className="mt-2 flex flex-wrap gap-4">
        <div className="min-w-[320px] flex-1 space-y-2">
          <label className="block">経路
            <select value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })} aria-label="経路" className="ml-2 rounded border px-2 py-1">
              {groups.map(([g, l]) => <optgroup key={g} label={GROUP_LABEL[g]}>{l.map((r) => <option key={r.route} value={r.route}>{r.label}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="block">キャンペーン名<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} placeholder="例）初回 骨格・骨盤矯正 無料" aria-label="キャンペーン名" className="mt-0.5 w-full rounded border px-2 py-1" /></label>
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
            <span className="ml-2 text-xs text-slate-500">空欄＝ずっと</span>
          </div>
          <div>使う店舗 <StoreChoice all={data.stores} pick={f.stores} onChange={(stores) => setF({ ...f, stores })} /></div>
          <label className="block">店舗向けメモ（会計の注意など。予約表にだけ出す）<textarea value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} maxLength={600} rows={2} placeholder="例）会計：矯正 0 円＋保険の自己負担。レセコンでは「ギフト」コードを入れる" aria-label="店舗向けメモ" className="mt-0.5 w-full rounded border px-2 py-1" /></label>
          <div className="flex gap-2">
            <button type="submit" disabled={!f.name.trim()} className="rounded bg-brand px-4 py-1 font-bold text-white disabled:opacity-40">保存</button>
            <button type="button" onClick={onDone} className="rounded border px-3 py-1">やめる</button>
          </div>
        </div>
        <div className="w-[300px]">
          <p className="text-xs font-bold text-slate-600">予約ページでの見え方</p>
          <CampaignBox c={{ route: routeLabel.replace(/（止めている）$/, ''), name: f.name || 'キャンペーン名', description: f.description, insurance: f.showInsurance ? data.insurance : [] }} />
        </div>
      </div>
    </form>
  );
}

export default function CampaignEditor() {
  const { data, reload } = useFetch<Resp>('/api/admin/hq/campaigns');
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<Camp | 'new' | null>(null);
  const routeLabel = (r: string) => data?.routes.find((x) => x.route === r)?.label ?? r;
  const nameOf = new Map((data?.stores ?? []).map((s) => [s.code, s.name]));
  async function toggle(c: Camp) {
    const { ok } = await send('PUT', '/api/admin/hq/campaigns', { id: c.id, active: !c.active });
    setMsg(ok ? `「${c.name}」を${c.active ? '止めました' : '再開しました'}` : '変えられませんでした');
    reload();
  }
  async function remove(c: Camp) {
    if (!confirm(`「${c.name}」を消しますか？（入っている予約には、予約したときの内容が残ります）`)) return;
    const { ok } = await send('DELETE', '/api/admin/hq/campaigns', { id: c.id });
    setMsg(ok ? `「${c.name}」を消しました` : '消せませんでした');
    reload();
  }
  return (
    <section className="mt-6 rounded border bg-white p-4 text-sm" aria-label="経路別キャンペーン">
      <h2 className="font-bold">🎁 経路別キャンペーン（ギフトカード・媒体・紹介元の QR）</h2>
      <p className="mt-1 text-xs text-slate-600">
        経路ごとに、予約ページに出すキャンペーンの内容と金額の目安を決めます。その経路の URL・QR から開いた予約ページの上に出て、決めた来院区分が選ばれた状態で始まります。
        予約表では、その方のセルに <b className="rounded bg-orange-600 px-1 text-white">🎁特典</b> が付き、セルを選ぶと内容と店舗向けメモが出ます（予約したときの内容が残ります）。
      </p>
      {msg && <p className="mt-2 rounded bg-brand-light px-3 py-1">{msg}</p>}
      {data && <InsuranceEditor key={JSON.stringify(data.insurance)} rows={data.insurance} onSaved={reload} onMsg={setMsg} />}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full">
          <thead><tr className="text-left text-xs text-slate-500"><th className="pr-2">経路</th><th className="pr-2">キャンペーン名</th><th className="pr-2">はじめの区分</th><th className="pr-2">期間</th><th className="pr-2">店舗</th><th className="pr-2 text-right">予約</th><th /></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((c) => (
              <tr key={c.id} className={`border-t ${c.active ? '' : 'text-slate-400'}`} aria-label={`キャンペーン ${c.name}`}>
                <td className="whitespace-nowrap pr-2">{routeLabel(c.route)}</td>
                <td className="pr-2 font-bold">{c.name}{!c.active && '（止めている）'}{c.memo && <span className="block text-xs font-normal text-slate-500">店舗向け：{c.memo}</span>}</td>
                <td className="whitespace-nowrap pr-2 text-xs">{KIND_SHORT[c.presetKind] ?? ''}</td>
                <td className="whitespace-nowrap pr-2 text-xs">{c.from || c.to ? `${c.from ? formatDateJa(c.from) : ''}〜${c.to ? formatDateJa(c.to) : ''}` : 'ずっと'}</td>
                <td className="pr-2 text-xs" title={c.stores.map((s) => nameOf.get(s) ?? s).join('・')}>{c.stores.length ? `${c.stores.length} 店` : '全店'}</td>
                <td className="pr-2 text-right tabular-nums">{c.reservations}</td>
                <td className="whitespace-nowrap text-xs">
                  <button type="button" onClick={() => setEdit(c)} className="mr-2 underline">直す</button>
                  <button type="button" onClick={() => toggle(c)} className="mr-2 underline">{c.active ? '止める' : '再開'}</button>
                  <button type="button" onClick={() => remove(c)} className="text-red-700 underline">消す</button>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={7} className="py-2 text-xs text-slate-400">まだキャンペーンはありません</td></tr>}
          </tbody>
        </table>
      </div>
      {edit === null && <button type="button" onClick={() => setEdit('new')} className="mt-2 rounded border-2 border-brand px-3 py-1 font-bold text-brand-dark">＋ キャンペーンを追加</button>}
      {data && edit !== null && <CampaignForm key={edit === 'new' ? 'new' : edit.id} init={edit === 'new' ? null : edit} data={data} onDone={() => { setEdit(null); reload(); }} onMsg={setMsg} />}
    </section>
  );
}
