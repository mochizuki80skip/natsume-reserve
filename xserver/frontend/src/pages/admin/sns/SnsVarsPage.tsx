// 店舗の一括設定：各店舗の「SNS 設定」の項目（店舗名・エリア・キーワード・差し込み語・ハッシュタグ・投稿ページの URL・住所・メモ・投稿の有無）を、
// 全店舗まとめて表で入力する。Excel で編集できるように CSV の書き出しと貼り付け（見出し行で列を判別）に対応。
// 保存すると、作成済みの下書きの {…} も埋まり、手で直していない自動の下書きは本文に合うキーワードで作り直される
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { sendJson, type VarDef } from '@/lib/sns';
import { type StoreVars } from '@/lib/snsVars';
import { StoreDot } from '@/lib/storeColor';
import SnsNav from '@/components/SnsNav';

interface Resp { stores: StoreVars[]; customVars: VarDef[]; isHq: boolean }
type Tab = 'meo' | 'link' | 'other';
type Col = { id: string; tab: Tab; label: string; hint?: string; ph: string; kind?: 'text' | 'bool'; get: (s: StoreVars) => string; set: (s: StoreVars, v: string) => StoreVars; width: string; required?: boolean };

const TABS: [Tab, string][] = [['meo', '文章の言葉（MEO）'], ['link', 'ハッシュタグ・投稿ページ'], ['other', '投稿の有無・住所・メモ']];

export default function SnsVarsPage() {
  const { data, error, reload } = useFetch<Resp>('/api/admin/sns/vars');
  const [rows, setRows] = useState<StoreVars[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('meo');
  useEffect(() => { if (data) { setRows(data.stores); setDirty(new Set()); } }, [data]);

  const cols: Col[] = useMemo(() => {
    const str = (k: keyof StoreVars) => (s: StoreVars) => String(s[k] ?? '');
    const put = (k: keyof StoreVars) => (s: StoreVars, v: string) => ({ ...s, [k]: v });
    const bool = (k: 'igEnabled' | 'gbpEnabled') => ({ get: (s: StoreVars) => (s[k] ? '○' : ''), set: (s: StoreVars, v: string) => ({ ...s, [k]: /^(○|〇|1|true|yes|はい|する|on)$/i.test(v.trim()) }) });
    return [
      { id: 'name', tab: 'meo', label: '店舗名', hint: '{店舗名}', ph: '例：あかり接骨院', get: str('name'), set: put('name'), width: 'min-w-44', required: true },
      { id: 'area', tab: 'meo', label: 'エリア', hint: '{エリア}', ph: '例：三島市谷田', get: str('area'), set: put('area'), width: 'min-w-36', required: true },
      { id: 'kf', tab: 'meo', label: 'メインキーワード', hint: '{メインキーワード} 先頭の語を毎回', ph: '例：接骨院', get: str('keywordsFixed'), set: put('keywordsFixed'), width: 'min-w-44', required: true },
      { id: 'kr', tab: 'meo', label: '症状・施術のキーワード', hint: '{症状} 本文に合うもの 1 つ', ph: '例：交通事故、ムチウチ、腰痛', get: str('keywordsRotation'), set: put('keywordsRotation'), width: 'min-w-56' },
      ...(data?.customVars ?? []).map((cv): Col => ({ id: `var:${cv.key}`, tab: 'meo', label: cv.label, hint: `{${cv.key}}`, ph: cv.default ? `既定：${cv.default}` : '', get: (s) => s.vars[cv.key] ?? '', set: (s, v) => ({ ...s, vars: { ...s.vars, [cv.key]: v } }), width: 'min-w-36', required: !cv.default })),
      { id: 'hashtags', tab: 'link', label: 'Instagram のハッシュタグ', hint: '空なら全店共通', ph: '例：#あかり接骨院 #三島市', get: str('hashtags'), set: put('hashtags'), width: 'min-w-64' },
      { id: 'gbpPostUrl', tab: 'link', label: 'Google の投稿ページ URL', hint: '手動投稿で開く', ph: 'https://…', get: str('gbpPostUrl'), set: put('gbpPostUrl'), width: 'min-w-72' },
      { id: 'igProfileUrl', tab: 'link', label: 'Instagram のプロフィール URL', hint: '手動投稿で開く', ph: 'https://www.instagram.com/…/', get: str('igProfileUrl'), set: put('igProfileUrl'), width: 'min-w-64' },
      { id: 'igEnabled', tab: 'other', label: 'Instagram に投稿', hint: '○ で投稿する', ph: '', kind: 'bool', ...bool('igEnabled'), width: 'min-w-24' },
      { id: 'gbpEnabled', tab: 'other', label: 'Google に投稿', hint: '○ で投稿する', ph: '', kind: 'bool', ...bool('gbpEnabled'), width: 'min-w-24' },
      { id: 'address', tab: 'other', label: '住所', hint: 'Instagram の {住所}（Google には入りません）', ph: '空でよい', get: str('address'), set: put('address'), width: 'min-w-56' },
      { id: 'hoursText', tab: 'other', label: '営業時間の表記', hint: 'Instagram の {営業時間}（Google には入りません）', ph: '空でよい', get: str('hoursText'), set: put('hoursText'), width: 'min-w-56' },
      { id: 'memo', tab: 'other', label: '運用メモ', hint: '下書きを確認する人が見るルール', ph: '例：料金は書かない', get: str('memo'), set: put('memo'), width: 'min-w-64' },
    ];
  }, [data]);

  if (error) return <div><SnsNav title="店舗の一括設定" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="店舗の一括設定" /><p className="text-sm text-slate-500">読み込み中…</p></div>;

  const shown = cols.filter((c) => c.tab === tab);
  const upd = (code: string, c: Col, v: string) => { setRows((rs) => rs.map((r) => r.code === code ? c.set(r, v) : r)); setDirty((d) => new Set(d).add(code)); };

  /** CSV（Excel 用。UTF-8 BOM 付き）で全項目を書き出す */
  function downloadCsv() {
    const esc = (v: string) => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [['店舗コード', ...cols.map((c) => c.label)], ...rows.map((r) => [r.code, ...cols.map((c) => c.get(r))])].map((l) => l.map(esc).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'store-settings.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  /** Excel から貼り付け：1 行目が見出し（店舗コード…）なら見出しで列を判別、無ければ今のタブの列の順 */
  function applyPaste() {
    const lines = paste.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return;
    const split = (l: string) => (l.includes('\t') ? l.split('\t') : l.split(',')).map((x) => x.trim());
    const head = split(lines[0]);
    let order: (Col | null)[]; let body = lines;
    if (head[0] === '店舗コード') {
      order = head.slice(1).map((h) => cols.find((c) => c.label === h) ?? null);
      body = lines.slice(1);
    } else order = shown;
    let n = 0; const miss: string[] = []; const d = new Set(dirty); let next = rows;
    for (const line of body) {
      const cells = split(line);
      const i = next.findIndex((r) => r.code === cells[0]);
      if (i < 0) { if (cells[0]) miss.push(cells[0]); continue; }
      let r = next[i];
      order.forEach((c, ci) => { const v = cells[ci + 1]; if (c && v !== undefined && (v !== '' || c.kind === 'bool')) r = c.set(r, v); });
      next = next.map((x, xi) => xi === i ? r : x); d.add(cells[0]); n++;
    }
    setRows(next); setDirty(d); setPaste('');
    setMsg(`${n} 店舗に反映しました（まだ保存していません。右下の「保存」を押してください）${miss.length ? `。見つからない店舗コード：${miss.join('、')}` : ''}`);
  }

  async function saveAll() {
    setBusy(true); setMsg('');
    try {
      const payload = rows.filter((x) => dirty.has(x.code)).map((s) => ({
        code: s.code, name: s.name, area: s.area, keywordsFixed: s.keywordsFixed, keywordsRotation: s.keywordsRotation, vars: s.vars,
        hashtags: s.hashtags ?? '', gbpPostUrl: s.gbpPostUrl ?? '', igProfileUrl: s.igProfileUrl ?? '', address: s.address ?? '', hoursText: s.hoursText ?? '', memo: s.memo ?? '', igEnabled: s.igEnabled, gbpEnabled: s.gbpEnabled,
      }));
      const r = await sendJson<{ saved: number; refilled: number }>('/api/admin/sns/vars', 'PUT', { rows: payload });
      setMsg(`${r.saved} 店舗を保存しました。作成済みの下書き ${r.refilled} 件を今の設定で更新しました`);
      reload();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }
  async function recomposeAll() {
    if (!confirm('自動で作った確認待ちの下書きを、今の設定で作り直します（手で直した下書きはそのまま）。よろしいですか？')) return;
    setBusy(true);
    try { const r = await sendJson<{ recomposed: number }>('/api/admin/sns/recompose', 'POST', {}); setMsg(`${r.recomposed} 件の下書きを作り直しました`); reload(); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }
  const unfilledTotal = rows.reduce((a, r) => a + (r.unfilled ?? 0), 0);

  return (
    <div className="space-y-4 pb-20">
      <SnsNav title="店舗の一括設定" />
      <p className="-mt-2 text-sm text-slate-600">各店舗の「SNS設定」の項目を、全店舗まとめて入力します。黄色の欄は未入力です。保存すると、作成済みの下書きにも反映されます（手で直した下書きはそのまま）。</p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      {unfilledTotal > 0 && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">差し込み語が埋まっていない下書きが {unfilledTotal} 件あります。<Link to="/admin/sns/drafts?unfilled=1" className="underline">下書きで確認</Link></p>}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {TABS.map(([t, label]) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded border px-3 py-1 ${tab === t ? 'bg-brand text-white' : 'bg-white'}`}>{label}</button>)}
        <span className="ml-auto" />
        <button type="button" onClick={downloadCsv} className="rounded border bg-white px-3 py-1">Excel 用に書き出す（CSV）</button>
        <button type="button" disabled={busy} onClick={recomposeAll} className="rounded border bg-white px-3 py-1 disabled:opacity-50">下書きを今の設定で作り直す</button>
      </div>
      {tab === 'meo' && <p className="text-xs text-slate-500">Google の投稿には毎回「<b>エリア＋メインキーワード</b>」（例：三島市谷田で接骨院をお探しの方は…）が入ります。MEO で一番狙う語（例：接骨院）を先頭に 1 つ入れてください。「症状・施術のキーワード」は、本文の内容に合うものがあるときだけ 1 つ添えます（例：腰の話 →「腰痛のご相談も承っています」）。</p>}
      {tab === 'link' && <p className="text-xs text-slate-500">Google の投稿ページ URL の取り方：オーナーの Google アカウントでログイン → business.google.com/locations で店舗を開く（または Google 検索で店名を検索）→「最新情報を追加」→ アドレスバーの URL をコピー。</p>}

      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">店舗</th>
              {shown.map((c) => <th key={c.id} className="px-2 py-2 align-bottom">{c.label}{c.hint && <div className="font-normal text-slate-400">{c.hint}</div>}</th>)}
              {tab === 'meo' && <th className="px-2 py-2">未完成の下書き</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className={`border-t ${dirty.has(r.code) ? 'bg-yellow-50' : ''}`}>
                <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-1.5 ${dirty.has(r.code) ? 'bg-yellow-50' : 'bg-white'}`}><StoreDot code={r.code} className="mr-1" /><span className="font-mono text-xs text-slate-500">{r.code}</span>{tab !== 'meo' && <div className="max-w-32 truncate text-xs">{r.name}</div>}</td>
                {shown.map((c) => (
                  <td key={c.id} className="px-1 py-1">
                    {c.kind === 'bool'
                      ? <label className="flex justify-center"><input type="checkbox" checked={c.get(r) === '○'} onChange={(e) => upd(r.code, c, e.target.checked ? '○' : '')} /></label>
                      : <input value={c.get(r)} onChange={(e) => upd(r.code, c, e.target.value)} placeholder={c.ph} className={`w-full rounded border px-2 py-1 placeholder:text-slate-300 ${c.width} ${c.required && c.get(r) === '' ? 'border-amber-300 bg-amber-50' : ''}`} />}
                  </td>
                ))}
                {tab === 'meo' && <td className="whitespace-nowrap px-2 py-1.5 text-center">{r.unfilled ? <Link to={`/admin/sns/drafts?store=${encodeURIComponent(r.code)}&unfilled=1`} className="text-red-700 underline">{r.unfilled} 件</Link> : <span className="text-slate-400">0</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <details className="rounded-lg border bg-white p-3 text-sm" open={paste !== ''}>
        <summary className="cursor-pointer text-slate-700">Excel から貼り付けて入力（24 店舗をまとめて）</summary>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
          <li>「Excel 用に書き出す（CSV）」で今の設定をダウンロードし、Excel で開いて編集します（1 行目の見出しは消さない）。</li>
          <li>見出し行を含めて表全体を選んでコピーし、下に貼り付けて「表に反映」→ 右下の「保存」。</li>
          <li>見出し行なしで貼るときは、列の順を「店舗コード、{shown.map((c) => c.label).join('、')}」にします（今開いているタブの列）。空のセルは変更しません。「投稿の有無」は ○ で投稿する、空で投稿しない。</li>
        </ol>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={`店舗コード\t店舗名\tエリア\tメインキーワード\t症状・施術のキーワード\nS001\tあかり接骨院\t三島市谷田\t接骨院\t交通事故、ムチウチ、腰痛`} className="mt-2 w-full rounded border px-2 py-1 font-mono text-xs" />
        <button type="button" onClick={applyPaste} disabled={!paste.trim()} className="mt-1 rounded border bg-white px-3 py-1 disabled:opacity-40">表に反映</button>
      </details>

      <div className="fixed bottom-6 right-6"><button type="button" disabled={dirty.size === 0 || busy} onClick={saveAll} className="rounded-md bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg disabled:opacity-40">保存{dirty.size > 0 ? `（${dirty.size} 店舗）` : ''}</button></div>
    </div>
  );
}
