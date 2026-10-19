// 定型投稿（文章＋画像）の一覧と編集。文章には {店舗名} {エリア} {メインキーワード} などの差し込み語を書き、店舗ごとの設定の値に置き換わる
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, copyText, fileToJpegDataUrl, sendJson, type Channel, type Topic } from '@/lib/sns';
import { addDays } from '@/lib/time';
import SnsNav from '@/components/SnsNav';
import SnsMediaPicker from '@/components/SnsMediaPicker';
import { useAdmin } from '../Layout';

interface VarHelp { key: string; label: string; builtin: boolean }
interface Resp { store: { code: string; name: string }; isHq: boolean; topics: Topic[]; vars: VarHelp[]; storeCount: number }
interface Preview { fullText: string; length: number; compliance: string[]; unfilled: string[]; unknown: string[] }
const CH_LABEL: Record<Channel | 'both', string> = { both: '両方', ig: CHANNEL_JA.ig, gbp: CHANNEL_JA.gbp };

export default function SnsTopicsPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const storeQ = me.session.role === 'hq' && sp.get('store') ? `store=${encodeURIComponent(sp.get('store')!)}` : '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/topics?${storeQ}`);
  const [msg, setMsg] = useState('');
  const { data: areaData } = useFetch<{ stores: { areaGroup?: string }[] }>('/api/admin/sns/vars');
  const areaGroups = [...new Set((areaData?.stores ?? []).map((s) => (s.areaGroup ?? '').trim()).filter(Boolean))];
  const [nf, setNf] = useState({ shared: me.session.role === 'hq', channel: 'both' as Channel | 'both', title: '', body: '', months: '', weekdays: '', areas: '', standalone: true });
  const [edit, setEdit] = useState<Topic | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bc, setBc] = useState<{ id: string; channel: Channel; scheduledAt: string } | null>(null);
  const [showVars, setShowVars] = useState(false);
  const [pickFor, setPickFor] = useState<Topic | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg('');
    try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setMsg((e as Error).message); }
  }
  const add = (e: React.FormEvent) => { e.preventDefault(); run(async () => { const r = await sendJson<{ unknownPlaceholders: string[] }>(`/api/admin/sns/topics?${storeQ}`, 'POST', nf); setNf({ ...nf, title: '', body: '', months: '', weekdays: '', areas: '' }); setPreview(null); if (r.unknownPlaceholders.length) throw new Error(`追加しました。ただし未定義の差し込み語があります：${r.unknownPlaceholders.join(' ')}（本部の SNS 管理で定義するか、本文を直してください）`); }, '定型投稿を追加しました'); };
  const saveEdit = () => edit && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: edit.id, title: edit.title, body: edit.body, channel: edit.channel, months: edit.months, weekdays: edit.weekdays, areas: edit.areas, standalone: edit.standalone }), '保存しました').then(() => setEdit(null));
  const toggle = (t: Topic) => run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: t.id, active: !t.active }), t.active ? '使わないようにしました' : '使うようにしました');
  const del = (t: Topic) => confirm('この定型投稿を削除しますか？（作成済みの下書きは残ります）') && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: t.id, action: 'delete' }), '削除しました');
  const bulkDel = () => sel.size > 0 && confirm(`${sel.size} 件を削除しますか？`) && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: [...sel][0], action: 'bulk_delete', ids: [...sel] }), '削除しました').then(() => setSel(new Set()));
  const uploadImage = (t: Topic, file: File) => run(async () => { const dataUrl = await fileToJpegDataUrl(file); await sendJson(`/api/admin/sns/topics/${t.id}/image?${storeQ}`, 'POST', { dataUrl }); }, '画像を保存しました');
  const removeImage = (t: Topic) => confirm('画像を外しますか？') && run(() => sendJson(`/api/admin/sns/topics/${t.id}/image?${storeQ}`, 'POST', { remove: true }), '画像を外しました');
  async function doPreview(body: string, standalone: boolean, channel: Channel | 'both') {
    try { setPreview(await sendJson<Preview>(`/api/admin/sns/preview?${storeQ}`, 'POST', { channel: channel === 'gbp' ? 'gbp' : 'ig', standalone, body, title: '見出しの例' })); } catch (e) { setMsg((e as Error).message); }
  }
  async function broadcast() {
    if (!bc || !data) return;
    if (!confirm(`この定型投稿を全店舗（${data.storeCount} 店舗）の ${bc.scheduledAt.replace('T', ' ')} の下書きにします。各店舗（または本部）が承認すると投稿されます。よろしいですか？`)) return;
    await run(async () => {
      const r = await sendJson<{ created: number; skipped: string[]; unfilled: string[] }>(`/api/admin/hq/sns/topics/${bc.id}/broadcast`, 'POST', { channel: bc.channel, scheduledAt: bc.scheduledAt, stores: 'all' });
      setBc(null);
      let m = `${r.created} 店舗分の下書きを作りました。`;
      if (r.skipped.length) m += `　作らなかった店舗：${r.skipped.join('、')}`;
      if (r.unfilled.length) m += `　差し込み語が埋まっていない店舗（承認前に SNS 設定で値を入れてください）：${r.unfilled.join('／')}`;
      setMsg(m);
    }, '');
  }

  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const groups: [string, Topic[]][] = [['全店共通の定型投稿（本部が管理）', data.topics.filter((t) => t.shared)], [`${data.store.name} だけの定型投稿`, data.topics.filter((t) => !t.shared)]];
  const canEdit = (t: Topic) => (t.shared ? data.isHq : true);
  const insertVar = (key: string) => setNf({ ...nf, body: nf.body + `{${key}}` });

  return (
    <div className="space-y-4">
      <SnsNav title="定型投稿（文章＋画像）" />
      <datalist id="sns-topic-areas">{areaGroups.map((a) => <option key={a} value={a} />)}</datalist>
      <p className="text-sm text-slate-600">
        文章と画像を作って保管しておくと、予定枠に合わせて自動で下書きになります（使った回数が少ないもの → 最後に使ってから長いもの、の順）。
        文章の中の <code className="rounded bg-slate-100 px-1">{'{店舗名}'}</code> <code className="rounded bg-slate-100 px-1">{'{エリア}'}</code> などの差し込み語は、投稿するときに店舗ごとの設定の値に置き換わります。
        値が無い店舗では <code className="rounded bg-slate-100 px-1">{'{…}'}</code> のまま残り、承認できません（その店舗の SNS 設定で値を入れてください）。
        <span className="font-bold text-red-800">Google 用の文章には、GBP に載っている情報（電話番号・住所・営業時間・URL、差し込み語の {'{電話} {住所} {営業時間} {予約URL}'}）を入れません</span>（Google のルール。予約は投稿の「予約」ボタンが自動で付きます）。
        <button type="button" onClick={() => setShowVars((v) => !v)} className="ml-2 text-brand underline">使える差し込み語を{showVars ? '隠す' : '見る'}</button>
      </p>
      {showVars && (
        <div className="rounded border bg-white p-3 text-xs">
          <table className="w-full"><tbody>
            {data.vars.map((v) => <tr key={v.key} className="border-t"><td className="whitespace-nowrap px-2 py-0.5"><code className="rounded bg-slate-100 px-1">{`{${v.key}}`}</code></td><td className="px-2 py-0.5">{v.label}{!v.builtin && <span className="ml-1 text-slate-400">（本部が定義）</span>}</td><td className="px-2 py-0.5"><button type="button" onClick={() => insertVar(v.key)} className="text-brand underline">本文に挿入</button></td></tr>)}
          </tbody></table>
          {data.isHq && <p className="mt-2 text-slate-500">「駐車場」など店舗ごとに変わる言葉は、本部の SNS 管理「差し込み語の定義」で項目を追加し、各店舗の SNS 設定で値を入れます。</p>}
        </div>
      )}
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}

      {data.isHq && <ClaudeImport onImported={reload} />}

      <form onSubmit={add} className="space-y-2 rounded border bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold">定型投稿を追加</span>
          {data.isHq && <label className="flex items-center gap-1"><input type="checkbox" checked={nf.shared} onChange={(e) => setNf({ ...nf, shared: e.target.checked })} />全店共通にする</label>}
          <select value={nf.channel} onChange={(e) => setNf({ ...nf, channel: e.target.value as Channel | 'both' })} className="rounded border px-2 py-1">{(['both', 'ig', 'gbp'] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}</select>
          <input value={nf.months} onChange={(e) => setNf({ ...nf, months: e.target.value })} placeholder="使う月（例 12,1,2。空なら通年）" className="w-56 rounded border px-2 py-1" />
          <label className="flex items-center gap-1" title="オフにすると、見出し＋本文として扱い、書き出し・締め・ハッシュタグ・営業時間の型で囲みます"><input type="checkbox" checked={nf.standalone} onChange={(e) => setNf({ ...nf, standalone: e.target.checked })} />本文をそのまま投稿文にする</label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-600">投稿する曜日</span><WeekdayPicker value={nf.weekdays} onChange={(v) => setNf({ ...nf, weekdays: v })} />
          <input value={nf.areas} onChange={(e) => setNf({ ...nf, areas: e.target.value })} placeholder="対象エリア（例：東部。空なら全店）" list="sns-topic-areas" className="w-72 rounded border px-2 py-1" />
        </div>
        <p className="text-xs text-slate-500">曜日を選ぶと、その曜日の予定にだけこの定型投稿が使われます（例：月曜は「月_お悩み共感」）。対象エリアにエリア分けの名前（例：東部）を入れると、エリア分けがそれと同じ店舗だけに使われます（「東部」で「中東部」の店舗には使いません）。地名（例：沼津）を入れると、地域・店舗名にその語を含む店舗に使われます。店舗の投稿の曜日は「配信設定」（または「接続状況」の既定の頻度）で、定型投稿の曜日と同じにしておきます。</p>
        <input value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} placeholder={nf.standalone ? '名前（一覧用。投稿文には入りません。例：駅チカ案内）' : '見出し（投稿文の先頭に入ります）'} className="w-full rounded border px-2 py-1" />
        <textarea value={nf.body} onChange={(e) => setNf({ ...nf, body: e.target.value })} required rows={6} placeholder={nf.standalone ? '投稿文（差し込み語入り）。例：{エリア}で{メインキーワード}をお探しなら{店舗名}へ。\n\nご予約はこちら {予約URL}\n\n{ハッシュタグ}' : '本文（店名・締め・ハッシュタグは型から自動で付きます）'} className="w-full rounded border px-2 py-1" />
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded bg-brand px-3 py-1 text-white">追加</button>
          <button type="button" onClick={() => doPreview(nf.body, nf.standalone, nf.channel)} className="rounded border bg-white px-3 py-1">{data.store.name} での見本</button>
          <span className="text-xs text-slate-500">画像は追加したあと、一覧の「ライブラリから」または「アップロード」で付けます。画像が無い定型投稿には、下書きを作るときに画像ライブラリから自動で 1 枚付きます。</span>
        </div>
        {preview && (
          <div className="rounded border bg-slate-50 p-3">
            <div className="mb-1 text-xs text-slate-600">見本（{preview.length} 文字）
              {preview.compliance.length > 0 && <span className="ml-2 text-red-700">禁止語：{preview.compliance.join('、')}</span>}
              {preview.unknown.length > 0 && <span className="ml-2 text-red-700">未定義の差し込み語：{preview.unknown.join(' ')}</span>}
              {preview.unfilled.filter((u) => !preview.unknown.includes(u)).length > 0 && <span className="ml-2 text-amber-700">この店舗で値が空：{preview.unfilled.filter((u) => !preview.unknown.includes(u)).join(' ')}</span>}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm">{preview.fullText}</pre>
          </div>
        )}
      </form>

      {groups.map(([label, list]) => (
        <section key={label} className="rounded border bg-white">
          <h2 className="flex items-center gap-2 border-b px-3 py-2 font-bold">{label}<span className="text-sm font-normal text-slate-500">{list.length} 件</span>
            {list.some(canEdit) && <button type="button" disabled={![...sel].some((id) => list.some((t) => t.id === id))} onClick={bulkDel} className="ml-auto rounded border px-2 py-0.5 text-xs text-red-700 disabled:opacity-40">選択を削除</button>}
          </h2>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="w-8 px-2 py-1"></th><th className="px-2 py-1">画像</th><th className="px-2 py-1">媒体</th><th className="px-2 py-1">月・曜日・エリア</th><th className="px-2 py-1">名前／投稿文</th><th className="px-2 py-1">使用</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {list.map((t) => edit?.id === t.id ? (
                <tr key={t.id} className="border-t bg-yellow-50">
                  <td></td>
                  <td className="px-2 py-1">{t.imageUrl && <img src={t.imageUrl} alt="" className="h-16 w-16 rounded object-cover" />}</td>
                  <td className="px-2 py-1"><select value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value as Channel | 'both' })} className="rounded border px-1">{(['both', 'ig', 'gbp'] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}</select></td>
                  <td className="space-y-1 px-2 py-1 text-xs">
                    <label className="block">月<input value={edit.months} onChange={(e) => setEdit({ ...edit, months: e.target.value })} placeholder="空なら通年" className="ml-1 w-20 rounded border px-1" /></label>
                    <WeekdayPicker value={edit.weekdays} onChange={(v) => setEdit({ ...edit, weekdays: v })} small />
                    <input value={edit.areas} onChange={(e) => setEdit({ ...edit, areas: e.target.value })} placeholder="対象エリア（空なら全店）" list="sns-topic-areas" className="w-36 rounded border px-1" />
                  </td>
                  <td className="px-2 py-1">
                    <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="mb-1 w-full rounded border px-1" />
                    <textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={6} className="w-full rounded border px-1" />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={edit.standalone} onChange={(e) => setEdit({ ...edit, standalone: e.target.checked })} />本文をそのまま投稿文にする</label>
                  </td>
                  <td></td>
                  <td className="whitespace-nowrap px-2 py-1"><button type="button" onClick={saveEdit} className="rounded bg-brand px-2 py-0.5 text-white">保存</button> <button type="button" onClick={() => setEdit(null)} className="rounded border px-2 py-0.5">取消</button><br /><button type="button" onClick={() => doPreview(edit.body, edit.standalone, edit.channel)} className="mt-1 text-xs text-brand underline">見本を見る</button></td>
                </tr>
              ) : (
                <tr key={t.id} className={`border-t ${t.active ? '' : 'text-slate-400'}`}>
                  <td className="px-2 py-1">{canEdit(t) && <input type="checkbox" checked={sel.has(t.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(t.id); else n.delete(t.id); setSel(n); }} />}</td>
                  <td className="px-2 py-1">
                    {t.imageUrl ? <img src={t.imageUrl} alt="" className="h-16 w-16 rounded border object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed text-xs text-slate-400">なし</div>}
                    {canEdit(t) && <div className="mt-1 flex flex-wrap gap-1 text-xs"><button type="button" onClick={() => setPickFor(t)} className="text-brand underline">ライブラリから</button><label className="cursor-pointer text-brand underline">アップロード<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(t, e.target.files[0])} /></label>{t.imageUrl && <button type="button" onClick={() => removeImage(t)} className="text-red-700 underline">外す</button>}</div>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{CH_LABEL[t.channel]}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">
                    <div>{t.months ? t.months.split(',').map((m) => `${m}月`).join(' ') : '通年'}</div>
                    <div className={t.weekdays ? 'font-bold text-brand-dark' : 'text-slate-400'}>{t.weekdays ? t.weekdays.split(',').map((d) => WD[Number(d)]).join('・') + '曜' : '毎日'}</div>
                    <div className={t.areas ? 'font-bold text-brand-dark' : 'text-slate-400'}>{t.areas || '全店'}</div>
                  </td>
                  <td className="px-2 py-1">
                    <div className="font-bold">{t.title || '（名前なし）'}{!t.standalone && <span className="ml-2 rounded bg-slate-100 px-1 text-xs font-normal text-slate-600">型で囲む</span>}</div>
                    <div className="whitespace-pre-wrap text-xs text-slate-600">{t.body}</div>
                    {t.unknownPlaceholders.length > 0 && <div className="mt-1 text-xs text-red-700">未定義の差し込み語：{t.unknownPlaceholders.join(' ')}</div>}
                    {t.channel !== 'gbp' && !t.imageUrl && <div className="mt-1 text-xs text-slate-500">画像なし：下書きを作るときに画像ライブラリから自動で付きます</div>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs tabular-nums">{t.useCount} 回{t.lastUsedAt && <div className="text-slate-400">{t.lastUsedAt.slice(0, 10)}</div>}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">
                    {canEdit(t) && <><button type="button" onClick={() => setEdit(t)} className="text-brand underline">編集</button> <button type="button" onClick={() => toggle(t)} className="text-slate-600 underline">{t.active ? '使わない' : '使う'}</button> <button type="button" onClick={() => del(t)} className="text-red-700 underline">削除</button></>}
                    {data.isHq && t.shared && <div className="mt-1"><button type="button" onClick={() => setBc({ id: t.id, channel: t.channel === 'gbp' ? 'gbp' : 'ig', scheduledAt: `${addDays(me.today, 1)}T18:00` })} className="rounded border bg-white px-2 py-0.5">全店舗に一斉配信</button></div>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-slate-500">まだありません</td></tr>}
            </tbody>
          </table>
        </section>
      ))}

      {bc && <BroadcastDialog bc={bc} setBc={setBc} topic={data.topics.find((t) => t.id === bc.id)!} storeCount={data.storeCount} onRun={broadcast} />}
      {pickFor && <SnsMediaPicker storeQ={storeQ} channel={pickFor.channel === 'both' ? undefined : pickFor.channel} onClose={() => setPickFor(null)} onPick={(m) => { const t = pickFor; setPickFor(null); run(() => sendJson(`/api/admin/sns/topics/${t.id}/image?${storeQ}`, 'POST', { mediaId: m.id }), 'ライブラリの画像を付けました'); }} />}
    </div>
  );
}

function BroadcastDialog({ bc, setBc, topic, storeCount, onRun }: { bc: { id: string; channel: Channel; scheduledAt: string }; setBc: (v: typeof bc | null) => void; topic: Topic; storeCount: number; onRun: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && setBc(null); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [setBc]);
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={() => setBc(null)}>
      <div className="w-full max-w-lg space-y-3 rounded border bg-white p-4 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">「{topic.title || topic.body.slice(0, 20)}」を全店舗に一斉配信</h3>
        <p className="text-xs text-slate-600">稼働中の {storeCount} 店舗それぞれに、店舗ごとの差し込み語（店舗名・エリア・メインキーワードなど）で置き換えた下書きを作ります。媒体を「使わない」設定の店舗には作りません。</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={bc.channel} onChange={(e) => setBc({ ...bc, channel: e.target.value as Channel })} className="rounded border px-2 py-1">
            {(topic.channel === 'both' ? (['ig', 'gbp'] as Channel[]) : [topic.channel as Channel]).map((c) => <option key={c} value={c}>{CHANNEL_JA[c]}</option>)}
          </select>
          <input type="datetime-local" value={bc.scheduledAt} onChange={(e) => setBc({ ...bc, scheduledAt: e.target.value })} className="rounded border px-2 py-1" />
        </div>
        <p className="text-xs text-slate-600">作った下書きは、各店舗（または本部）が承認すると予定時刻に投稿されます。ホームの「選択を承認」でまとめて承認できます。</p>
        {bc.channel === 'ig' && !topic.imageUrl && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">この定型投稿には画像がありません。各店舗の下書きには画像ライブラリから自動で 1 枚付きます（ライブラリが空なら画像なし）。</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setBc(null)} className="rounded border px-3 py-1">やめる</button><button type="button" onClick={onRun} className="rounded bg-brand px-3 py-1 text-white">下書きを作る</button></div>
      </div>
    </div>
  );
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** 曜日の選択（"1,3,5" の形で持つ。何も選ばなければ毎日） */
function WeekdayPicker({ value, onChange, small = false }: { value: string; onChange: (v: string) => void; small?: boolean }) {
  const set = new Set(value.split(',').filter((x) => x !== '').map(Number));
  const toggle = (d: number) => { const n = new Set(set); if (n.has(d)) n.delete(d); else n.add(d); onChange([...n].sort((a, b) => a - b).join(',')); };
  return (
    <span className="inline-flex gap-0.5">
      {WD.map((w, d) => (
        <button key={d} type="button" onClick={() => toggle(d)} className={`rounded border ${small ? 'px-1 text-xs' : 'px-1.5 py-0.5 text-xs'} ${set.has(d) ? 'border-brand bg-brand text-white' : 'bg-white text-slate-600'}`}>{w}</button>
      ))}
      {!small && <span className="ml-1 self-center text-xs text-slate-400">{set.size ? '' : '（毎日）'}</span>}
    </span>
  );
}

interface ImportItem { title: string; channel: Channel | 'both'; weekdays: string; areas: string; months: string; store: string; body: string; errors: string[]; warnings: string[]; status: 'ok' | 'error' | 'created' | 'duplicate' }

/**
 * claude.ai（MAX プランなど）で定型投稿を作って取り込む：①依頼文をコピー → ②claude.ai に貼る → ③返ってきた文章を貼って確認 → 取り込む。
 * システムから AI は呼ばないので、API の費用はかからない
 */
function ClaudeImport({ onImported }: { onImported: () => void }) {
  const [o, setO] = useState({ theme: '', count: 3, channel: 'gbp' as Channel | 'both', weekdays: '', perStore: false, area: '' });
  // 店舗のエリア分け（配信設定で入れたもの）。エリアを選ぶと、そのエリアの店舗だけに使う投稿として作って取り込む
  const { data: varsData } = useFetch<{ stores: { areaGroup?: string }[] }>('/api/admin/sns/vars');
  const areaNames = [...new Set((varsData?.stores ?? []).map((s) => (s.areaGroup ?? '').trim()).filter(Boolean))];
  const [prompt, setPrompt] = useState('');
  const [text, setText] = useState('');
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const CH: Record<string, string> = { gbp: 'Google', ig: 'Instagram', both: '両方' };

  async function makePrompt() {
    setBusy(true); setMsg('');
    try {
      const r = await sendJson<{ prompt: string }>('/api/admin/sns/topics/prompt', 'POST', o);
      setPrompt(r.prompt);
      const copied = await copyText(r.prompt);
      setMsg(copied ? '依頼文をコピーしました。claude.ai を開いて貼り付け、送信してください' : '');
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }
  async function check(dryRun: boolean) {
    setBusy(true); setMsg('');
    try {
      const r = await sendJson<{ items: ImportItem[]; created: number; skipped: number }>('/api/admin/sns/topics/import', 'POST', { text, dryRun, channel: o.channel, area: o.area });
      setItems(r.items);
      if (r.items.length === 0) setMsg('定型投稿を読み取れませんでした。「---」で区切られた「名前：」「本文：」の形か確認してください');
      else if (!dryRun) { setMsg(`${r.created} 件を定型投稿に登録しました${r.skipped ? `（同じものが登録済みで飛ばした ${r.skipped} 件）` : ''}`); setText(''); onImported(); }
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }
  /** claude.ai からダウンロードしたファイル（.txt / .md。複数可）を読み込んで、貼り付け欄に入れる */
  async function loadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = [...files].sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
    const texts = await Promise.all(list.map((f) => f.text()));
    setText(texts.join('\n---\n')); setItems(null);
    setMsg(`${list.length} 個のファイルを読み込みました。「確認する」を押してください`);
  }
  const okCount = items?.filter((i) => i.status === 'ok').length ?? 0;
  const WDJ = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <details className="rounded border border-violet-200 bg-violet-50/40 p-3 text-sm">
      <summary className="cursor-pointer font-bold text-violet-900">Claude で定型投稿を作って取り込む（claude.ai を使うので、システム側の費用はかかりません）</summary>
      <div className="mt-3 space-y-4">
        <section className="space-y-2">
          <div className="font-bold">① 依頼文を作ってコピー</div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={o.theme} onChange={(e) => setO({ ...o, theme: e.target.value })} placeholder="テーマ（例：冬のぎっくり腰の予防、交通事故のあとの通院）" className="min-w-80 flex-1 rounded border px-2 py-1" />
            <label className="flex items-center gap-1">本数<input type="number" min={1} max={30} value={o.count} onChange={(e) => setO({ ...o, count: Number(e.target.value) || 1 })} className="w-16 rounded border px-1 py-1" /></label>
            <select value={o.channel} onChange={(e) => setO({ ...o, channel: e.target.value as Channel | 'both' })} className="rounded border px-2 py-1">{(['gbp', 'ig', 'both'] as const).map((c) => <option key={c} value={c}>{CH[c]}</option>)}</select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-600">投稿する曜日</span><WeekdayPicker value={o.weekdays} onChange={(v) => setO({ ...o, weekdays: v })} />
            <label className="flex items-center gap-1">対象エリア
              <select value={o.area} onChange={(e) => { setO({ ...o, area: e.target.value }); setItems(null); }} className="rounded border px-2 py-1" aria-label="対象エリア">
                <option value="">全店共通</option>
                {areaNames.map((a) => <option key={a} value={a}>{a}だけ</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1" title="店舗の一覧を依頼文に入れ、店舗ごとに違う文章を作ってもらいます（本数 × 店舗数の量になります）"><input type="checkbox" checked={o.perStore} onChange={(e) => setO({ ...o, perStore: e.target.checked })} />店舗ごとに書き分ける</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={makePrompt} className="rounded bg-violet-700 px-3 py-1.5 text-white disabled:opacity-50">依頼文をコピー</button>
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className="rounded border bg-white px-3 py-1.5">claude.ai を開く↗</a>
            {o.perStore && <span className="text-xs text-amber-800">店舗ごとの書き分けは量が多くなるので、本数は 1〜2 本、返答が途中で止まったら「続けて」と送ってください。</span>}
          </div>
          {prompt && <details className="text-xs"><summary className="cursor-pointer text-slate-600">依頼文を見る（コピーできないときはここから選んでコピー）</summary><textarea readOnly value={prompt} rows={10} className="mt-1 w-full rounded border bg-white px-2 py-1 font-mono text-xs" /></details>}
        </section>
        <section className="space-y-2">
          <div className="font-bold">② claude.ai の返答を貼り付けて確認 → 取り込む</div>
          <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded border bg-white px-3 py-1.5 text-sm text-slate-800">ファイルから読み込む（複数まとめて選べます）</span>
            <input type="file" accept=".txt,.md,text/plain,text/markdown" multiple onChange={(e) => { void loadFiles(e.target.files); e.target.value = ''; }} className="text-xs" aria-label="返答のファイル" />
            <span>claude.ai でファイルとして受け取った返答（.txt など）を、そのまま読み込めます。</span>
          </label>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setItems(null); }} rows={8} placeholder={'claude.ai の返答をそのまま貼り付け（「---」で区切られた「名前：」「媒体：」「曜日：」「本文：」の形）'} className="w-full rounded border bg-white px-2 py-1 font-mono text-xs" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !text.trim()} onClick={() => check(true)} className="rounded border bg-white px-3 py-1.5 disabled:opacity-40">確認する</button>
            {items && okCount > 0 && <button type="button" disabled={busy} onClick={() => check(false)} className="rounded bg-brand px-3 py-1.5 font-bold text-white disabled:opacity-50">{okCount} 件を定型投稿に取り込む</button>}
            {msg && <span className="text-xs text-brand-dark">{msg}</span>}
          </div>
          {items && items.length > 0 && (
            <table className="w-full rounded border bg-white text-xs">
              <thead><tr className="bg-slate-100 text-left text-slate-600"><th className="px-2 py-1">名前</th><th className="px-2 py-1">媒体</th><th className="px-2 py-1">曜日</th><th className="px-2 py-1">月</th><th className="px-2 py-1">店舗</th><th className="px-2 py-1">本文</th><th className="px-2 py-1">確認</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className={`border-t align-top ${it.errors.length ? 'bg-red-50' : ''}`}>
                    <td className="px-2 py-1 font-bold">{it.title}</td>
                    <td className="whitespace-nowrap px-2 py-1">{CH[it.channel]}</td>
                    <td className="whitespace-nowrap px-2 py-1">{it.weekdays ? it.weekdays.split(',').map((d) => WDJ[Number(d)]).join('・') : '毎日'}</td>
                    <td className="whitespace-nowrap px-2 py-1">{it.months ? it.months.split(',').map((m) => `${m}月`).join('・') : '通年'}</td>
                    <td className="whitespace-nowrap px-2 py-1">{it.store || '全店共通'}{it.areas && <div className="text-slate-500">{it.areas}</div>}</td>
                    <td className="px-2 py-1"><div className="line-clamp-4 whitespace-pre-wrap">{it.body}</div></td>
                    <td className="px-2 py-1">
                      {it.status === 'created' ? <span className="text-green-700">登録しました</span> : it.status === 'duplicate' ? <span className="text-slate-500">登録済み</span> : it.errors.length ? <span className="text-red-700">{it.errors.join(' / ')}</span> : <span className="text-green-700">OK</span>}
                      {it.warnings.length > 0 && <div className="text-amber-700">{it.warnings.join(' / ')}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-slate-500">{o.area && <><b>対象エリア「{o.area}」</b>を選んでいるので、「エリア：」が空のものも{o.area}の店舗だけに使います。</>}名前に「7月」のように月があるものは、その月の予定だけに使います（例：月_7月_01_夏休みの部活）。取り込んだ定型投稿は「全店共通」（「店舗：」がある場合はその店舗用）になります。赤い行（Google に電話番号・URL などが入っているなど）は取り込みません。黄色の注意は取り込めますが、下書きの承認前に直してください。</p>
        </section>
      </div>
    </details>
  );
}
