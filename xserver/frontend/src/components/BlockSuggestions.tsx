// 新規・再来ブロックの提案（院長が承認するとブロックになる）
// ・営業中：予約表で予約・担当が変わって、新しく当てはまったらその場でお知らせ（POPUP）
// ・営業時間のあと（と、開店前）：その日はじめて予約表を開いたときに、今日から 14 日先までの提案を一覧で出す
import { useEffect, useRef, useState } from 'react';
import { formatDateShort, minToHm } from '@/lib/time';

export interface Suggestion { date: string; kind: 'N' | 'R'; start: number; end: number }
interface Resp { suggestions: Suggestion[]; today: string; now: number; closeAt: number | null; openAt: number | null }
const KIND = { N: '新規', R: '再来' } as const;
const keyOf = (s: Suggestion) => `${s.date}|${s.kind}|${s.start}|${s.end}`;
const REASON = { N: '初回を担当できる人が全員ふさがっています', R: '再来を担当できる人が全員ふさがっています' } as const;

/** version が変わる（予約表が変わる）たびに、その日の提案を確かめる */
export default function BlockSuggestions({ store, date, version, canEdit, onChanged }: { store: string; date: string; version: number; canEdit: boolean; onChanged: () => void }) {
  const [all, setAll] = useState<Suggestion[]>([]);
  const [pop, setPop] = useState<{ list: Suggestion[]; title: string } | null>(null);
  const seen = useRef<Set<string> | null>(null);

  // はじめて開いたとき：14 日先までの提案。閉院後・開店前で、今日まだ見せていなければ一覧で出す
  useEffect(() => {
    if (!canEdit) return;
    let stop = false;
    void (async () => {
      const r = await fetch('/api/admin/block-suggestions');
      if (!r.ok || stop) return;
      const j: Resp = await r.json();
      setAll(j.suggestions);
      seen.current = new Set(j.suggestions.map(keyOf));
      const shownKey = `natsume.blockSuggest.${store}.${j.today}`;
      const after = j.closeAt === null || j.now >= j.closeAt || (j.openAt !== null && j.now < j.openAt);
      let shown = false;
      try { shown = localStorage.getItem(shownKey) === '1'; } catch { /* 保存できなくても出す */ }
      if (after && !shown && j.suggestions.length) {
        setPop({ list: j.suggestions, title: '今日から 14 日先までのブロックの提案' });
        try { localStorage.setItem(shownKey, '1'); } catch { /* なにもしない */ }
      }
    })();
    return () => { stop = true; };
  }, [store, canEdit]);

  // 予約表が変わったら（少し待ってから）その日の提案を確かめ、新しいものだけお知らせ
  useEffect(() => {
    if (!canEdit || version === 0) return;
    const id = setTimeout(async () => {
      const r = await fetch(`/api/admin/block-suggestions?date=${date}`);
      if (!r.ok) return;
      const j: Resp = await r.json();
      setAll((cur) => [...cur.filter((s) => s.date !== date), ...j.suggestions]);
      const fresh = j.suggestions.filter((s) => !seen.current?.has(keyOf(s)));
      j.suggestions.forEach((s) => seen.current?.add(keyOf(s)));
      if (fresh.length) setPop({ list: fresh, title: 'この時間は担当がふさがりました' });
      // 予約表の読み直しはしない（読み直し → 確認 → 読み直し…とくり返さないように。承認・止めないのときだけ読み直す）
    }, 1200);
    return () => clearTimeout(id);
  }, [version, date, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(s: Suggestion, action: 'approve' | 'dismiss') {
    const r = await fetch('/api/admin/block-suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, action }) });
    if (!r.ok) return;
    setAll((cur) => cur.filter((x) => keyOf(x) !== keyOf(s)));
    setPop((p) => (p ? { ...p, list: p.list.filter((x) => keyOf(x) !== keyOf(s)) } : p));
    onChanged();
  }
  if (!canEdit) return null;
  const Row = ({ s }: { s: Suggestion }) => (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t py-1.5 first:border-t-0">
      <span className="font-bold">{formatDateShort(s.date)} {minToHm(s.start)}〜{minToHm(s.end)}</span>
      <span className="rounded bg-red-100 px-1.5 text-xs font-bold text-red-800">{KIND[s.kind]}を止める</span>
      <span className="text-xs text-slate-600">{REASON[s.kind]}</span>
      <span className="ml-auto flex gap-1">
        <button type="button" onClick={() => act(s, 'approve')} className="rounded bg-brand px-2 py-0.5 text-xs font-bold text-white">止める（承認）</button>
        <button type="button" onClick={() => act(s, 'dismiss')} className="rounded border bg-white px-2 py-0.5 text-xs">止めない</button>
      </span>
    </li>
  );
  return (
    <>
      {all.length > 0 && (
        <div className="no-print mb-2 flex flex-wrap items-center gap-2 rounded border border-amber-400 bg-amber-50 px-3 py-1 text-sm text-amber-900" role="status" aria-label="ブロックの提案">
          <b>ブロックの提案 {all.length} 件</b>
          <span className="text-xs">新規・再来を担当できる人がふさがっている時間があります（WEB 予約だけ止めます）</span>
          <button type="button" onClick={() => setPop({ list: all, title: '今日から 14 日先までのブロックの提案' })} className="rounded border border-amber-500 bg-white px-2 py-0.5 text-xs font-bold">見る・承認する</button>
        </div>
      )}
      {pop && pop.list.length > 0 && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3">
          <div role="dialog" aria-label="ブロックの提案" className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border-2 border-amber-400 bg-white p-4 shadow-xl">
            <h2 className="text-base font-bold">{pop.title}</h2>
            <p className="mt-1 text-xs text-slate-600">院長の判断で「止める（承認）」を押すと、その時間は WEB 予約で{pop.list.every((s) => s.kind === 'N') ? '新規' : '新規・再来'}が取れなくなります（電話で予約表に書くのは止めません）。予約が動いて当てはまらなくなったら、自動で外れます。</p>
            <ul className="mt-2 text-sm">{pop.list.map((s) => <Row key={keyOf(s)} s={s} />)}</ul>
            <div className="mt-3 flex justify-end"><button type="button" onClick={() => setPop(null)} className="rounded border px-3 py-1 text-sm">あとで</button></div>
          </div>
        </div>
      )}
    </>
  );
}
