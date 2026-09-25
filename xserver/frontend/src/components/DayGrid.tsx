
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DayData } from '@/lib/types';
import { addDays, formatDateJa, minToHm, nowJst } from '@/lib/time';
import { isPatientText } from '@/lib/availability';
import { isAm } from '@/lib/hours';
import { planPaste } from '@/lib/paste';
import { categorizeCell, cellState, isContinuationText, type CellState } from '@/lib/attendance';
import { formatJpPhone } from '@/lib/format';
import NextDateInput from './NextDateInput';

interface Props { data: DayData; storeName: string; published: boolean; today: string; onRefresh: () => void }

const key = (time: number, bed: number) => `${time}:${bed}`;
const KIND_JA: Record<string, string> = { NEW: '初診', REVISIT: '再来', RETURN: '通院中' };
const STATE_BG: Record<CellState, string> = { visited: 'bg-green-100', noshow: 'bg-red-100', pending: 'bg-yellow-100', none: '' };

export default function DayGrid({ data, published, today, onRefresh }: Props) {
  const navigate = useNavigate();
  const [cells, setCells] = useState<Map<string, string>>(() => new Map(data.cells.map((c) => [key(c.time, c.bed), c.text])));
  const [visited, setVisited] = useState<Set<string>>(() => new Set(data.cells.filter((c) => c.visited).map((c) => key(c.time, c.bed))));
  const webInfo = useMemo(() => new Map(data.cells.filter((c) => c.web).map((c) => [key(c.time, c.bed), c.web!])), [data.cells]);
  const [day, setDay] = useState(data.day);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [menu, setMenu] = useState<string | null>(null);
  const [pasteInfo, setPasteInfo] = useState('');
  const dirty = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  // 現在時刻（日本時間）。当日は毎分更新して「未チェック」「未来院」の表示を切り替える
  const [nowMin, setNowMin] = useState<number | null>(() => (data.date < today ? Infinity : data.date === today ? nowJst().minutes : null));
  useEffect(() => {
    if (data.date !== today) return;
    const id = setInterval(() => setNowMin(nowJst().minutes), 60 * 1000);
    return () => clearInterval(id);
  }, [data.date, today]);

  const cols = data.beds;
  const rows = data.times;
  const cap = data.capacity;
  const am = (t: number) => isAm(data.sessions, t);
  const capacityAt = (t: number) => (am(t) ? cap.am : cap.pm);
  const customerSet = useMemo(() => new Set(data.customerTimes), [data.customerTimes]);

  // ---------- 保存 ----------
  const flush = useCallback(async () => {
    if (dirty.current.size === 0) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const batch = Array.from(dirty.current.entries()).map(([k, text]) => { const [time, bed] = k.split(':').map(Number); return { time, bed, text }; });
    dirty.current.clear();
    setSaveState('saving');
    try {
      const r = await fetch('/api/admin/cells', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, cells: batch }) });
      setSaveState(r.ok ? 'saved' : 'error');
    } catch { setSaveState('error'); }
  }, [data.date]);
  const schedule = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flush, 200); }, [flush]);
  useEffect(() => {
    const onLeave = () => { void flush(); };
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    const onVis = () => { if (document.visibilityState === 'hidden') onLeave(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('pagehide', onLeave); window.removeEventListener('beforeunload', onLeave); document.removeEventListener('visibilitychange', onVis); void flush(); };
  }, [flush]);

  function setCell(time: number, bed: number, text: string) {
    setCells((m) => { const n = new Map(m); n.set(key(time, bed), text); return n; });
    dirty.current.set(key(time, bed), text);
    schedule();
  }

  // ---------- キー操作・貼り付け ----------
  function focusCell(r: number, c: number) {
    if (r < 0 || r >= rows.length || c < 0 || c >= cols.length) return;
    inputs.current.get(key(rows[r], cols[c]))?.focus();
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const nav: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] };
    if (e.key in nav) { e.preventDefault(); focusCell(r + nav[e.key][0], c + nav[e.key][1]); return; }
    if (e.key === 'Tab') { e.preventDefault(); focusCell(r, c + (e.shiftKey ? -1 : 1)); return; }
    const el = e.currentTarget;
    if (e.key === 'ArrowLeft' && el.selectionStart === 0 && el.selectionEnd === 0) { e.preventDefault(); focusCell(r, c - 1); }
    if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) { e.preventDefault(); focusCell(r, c + 1); }
  }
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\n') && !text.includes('\t')) return;
    e.preventDefault();
    const plan = planPaste(text, rows, r);
    let n = 0;
    for (const cell of plan.cells) {
      const cc = c + cell.col;
      if (cell.row < rows.length && cc < cols.length) { setCell(rows[cell.row], cols[cc], cell.text); n++; }
    }
    const notes = [`${n} セルを貼り付けました`];
    if (plan.timeAligned) notes.push('時間列で行を合わせました');
    if (plan.mergedCollapsed) notes.push('結合セル（2列=1ベッド）を1列にまとめました');
    if (plan.skippedTimes.length) notes.push(`予約表に無い時刻は飛ばしました：${plan.skippedTimes.join('、')}`);
    setPasteInfo(notes.join('。'));
  }

  // ---------- 来院チェック・キャンセル ----------
  async function toggleVisit(time: number, bed: number) {
    const k = key(time, bed);
    const next = !visited.has(k);
    setVisited((s) => { const n = new Set(s); if (next) n.add(k); else n.delete(k); return n; });
    const r = await fetch('/api/admin/visit', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, time, bed, visited: next }) });
    if (!r.ok) { setVisited((s) => { const n = new Set(s); if (next) n.delete(k); else n.add(k); return n; }); alert('来院チェックの保存に失敗しました'); }
  }
  // キャンセル：メモと次回予約日を入力する小さなダイアログを出してから名簿へ移す
  const [cancelDlg, setCancelDlg] = useState<{ time: number; bed: number; kind: 'ADVANCE' | 'NOSHOW'; name: string; memo: string; nextDate: string } | null>(null);
  async function cancelCell(time: number, bed: number, kind: 'ADVANCE' | 'NOSHOW') {
    setMenu(null);
    await flush();
    setCancelDlg({ time, bed, kind, name: cells.get(key(time, bed)) ?? '', memo: '', nextDate: '' });
  }
  async function submitCancel() {
    if (!cancelDlg) return;
    const { time, bed, kind, memo, nextDate } = cancelDlg;
    const r = await fetch('/api/admin/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, time, bed, kind, memo, nextDate }) });
    if (!r.ok) { alert((await r.json()).error ?? 'キャンセルに失敗しました'); return; }
    setCancelDlg(null);
    setCells((m) => { const n = new Map(m); n.set(key(time, bed), ''); const k2 = key(time + data.slotMinutes, bed); if (isContinuationText(n.get(k2))) n.set(k2, ''); return n; });
    onRefresh();
  }
  function deleteCell(time: number, bed: number) {
    setMenu(null);
    if (!confirm('この入力を削除します（名簿には残しません）。よろしいですか？')) return;
    setCell(time, bed, '');
    const k2 = key(time + data.slotMinutes, bed);
    if (isContinuationText(cells.get(k2))) setCell(time + data.slotMinutes, bed, '');
  }
  async function restore(id: string) {
    const r = await fetch('/api/admin/cancel', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!r.ok) { alert((await r.json()).error ?? '戻せませんでした'); return; }
    onRefresh();
    // 画面のセルにも即反映
    const c = data.cancels.find((x) => x.id === id);
    if (c) setCells((m) => { const n = new Map(m); n.set(key(c.time, c.bed), c.name); if (c.contText) n.set(key(c.time + data.slotMinutes, c.bed), c.contText); return n; });
  }
  async function saveMemo(id: string, memo: string) {
    await fetch('/api/admin/cancel', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, memo }) });
  }

  // ---------- 日付設定 ----------
  async function updateDay(patch: Partial<typeof day>) {
    setDay({ ...day, ...patch });
    await fetch('/api/admin/days', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, ...patch }) });
    onRefresh();
  }
  async function saveCapacity(which: 'capacityAm' | 'capacityPm', raw: string) {
    const v = raw.trim() === '' ? null : Math.max(0, Math.min(20, Number(raw)));
    if (v !== null && Number.isNaN(v)) return;
    await updateDay({ [which]: v } as Partial<typeof day>);
  }
  function copyAll() {
    const header = ['時間', ...cols.map((b) => `ベッド${b}`)].join('\t');
    const body = rows.map((t) => [minToHm(t), ...cols.map((b) => cells.get(key(t, b)) ?? '')].join('\t')).join('\n');
    navigator.clipboard.writeText(`${header}\n${body}`);
  }

  // ---------- 集計 ----------
  const counts = useMemo(() => {
    // 予約／来院の人数に加えて、内訳（初診＝（初）、再来＝（再）、自賠＝「自賠」「事故」の手入力）を数える
    const c = { rAm: 0, rPm: 0, vAm: 0, vPm: 0, nAm: 0, nPm: 0, reAm: 0, rePm: 0, jAm: 0, jPm: 0 };
    for (const [k, v] of cells) {
      if (!isPatientText(v)) continue;
      const time = Number(k.split(':')[0]);
      const a = isAm(data.sessions, time);
      if (a) c.rAm++; else c.rPm++;
      if (visited.has(k)) { if (a) c.vAm++; else c.vPm++; }
      const cat = categorizeCell(v);
      if (cat.isNew) { if (a) c.nAm++; else c.nPm++; }
      if (cat.isRevisit) { if (a) c.reAm++; else c.rePm++; }
      if (cat.isJibai) { if (a) c.jAm++; else c.jPm++; }
    }
    return c;
  }, [cells, visited, data.sessions]);

  /** セルの色。2枠目は1枠目（同じベッドの1つ前の枠）の状態に合わせる */
  function stateOf(t: number, b: number): CellState {
    const k = key(t, b);
    const text = cells.get(k) ?? '';
    if (!text.trim()) return 'none';
    if (isContinuationText(text)) {
      const pt = t - data.slotMinutes;
      const ptext = cells.get(key(pt, b)) ?? '';
      if (!ptext.trim()) return 'none';
      return cellState(visited.has(key(pt, b)), pt, nowMin);
    }
    return cellState(visited.has(k), t, nowMin);
  }
  const shiftLabel: Record<string, string> = { WORK: '〇', OFF: '休', AM_OFF: '前休', PM_OFF: '後休', PAID: '有給', AM_PAID: '前有', PM_PAID: '後有' };

  return (
    <div onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-menu]')) setMenu(null); }}>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => navigate(`/admin/day/${addDays(data.date, -1)}`)}>‹ 前日</button>
        <input type="date" value={data.date} onChange={(e) => e.target.value && navigate(`/admin/day/${e.target.value}`)} className="rounded border px-2 py-1" />
        <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => navigate(`/admin/day/${addDays(data.date, 1)}`)}>翌日 ›</button>
        <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => navigate(`/admin/day/${today}`)}>今日</button>
        <span className="ml-auto text-xs text-slate-500">
          {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '保存しました' : saveState === 'error' ? '保存に失敗しました' : '入力すると自動保存されます'}
        </span>
        <a href={`/admin/print/${data.date}`} target="_blank" rel="noreferrer" className="rounded bg-brand px-3 py-1 text-white">印刷／PDF</a>
        <button type="button" onClick={copyAll} className="rounded border bg-white px-3 py-1">表をコピー</button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <h1 className="text-2xl font-bold">{formatDateJa(data.date)}</h1>
        <table className="text-sm">
          <thead><tr className="text-[11px] text-slate-500"><th></th><th className="px-2 text-right font-normal">午前</th><th className="px-2 text-right font-normal">午後</th><th className="px-2 text-right font-normal">合計</th></tr></thead>
          <tbody>
            <tr><td className="pr-2 text-slate-500">予約</td><td className="px-2 text-right text-lg font-bold tabular-nums">{counts.rAm}</td><td className="px-2 text-right text-lg font-bold tabular-nums">{counts.rPm}</td><td className="px-2 text-right text-lg font-bold tabular-nums">{counts.rAm + counts.rPm}</td></tr>
            <tr><td className="pr-2 text-slate-500">来院</td><td className="px-2 text-right text-lg font-bold tabular-nums text-green-700">{counts.vAm}</td><td className="px-2 text-right text-lg font-bold tabular-nums text-green-700">{counts.vPm}</td><td className="px-2 text-right text-lg font-bold tabular-nums text-green-700">{counts.vAm + counts.vPm}</td></tr>
          </tbody>
        </table>
        <table className="text-sm" title="内訳。初診＝「（初）」、再来＝「（再）」、自賠＝「自賠」または「事故」を含むセル（手入力可）">
          <thead><tr className="text-[11px] text-slate-500"><th></th><th className="px-2 text-right font-normal">午前</th><th className="px-2 text-right font-normal">午後</th><th className="px-2 text-right font-normal">合計</th></tr></thead>
          <tbody>
            <tr><td className="pr-2 text-slate-500">初診</td><td className="px-2 text-right font-bold tabular-nums">{counts.nAm}</td><td className="px-2 text-right font-bold tabular-nums">{counts.nPm}</td><td className="px-2 text-right font-bold tabular-nums">{counts.nAm + counts.nPm}</td></tr>
            <tr><td className="pr-2 text-slate-500">再来</td><td className="px-2 text-right font-bold tabular-nums">{counts.reAm}</td><td className="px-2 text-right font-bold tabular-nums">{counts.rePm}</td><td className="px-2 text-right font-bold tabular-nums">{counts.reAm + counts.rePm}</td></tr>
            <tr><td className="pr-2 text-slate-500">自賠</td><td className="px-2 text-right font-bold tabular-nums text-amber-800">{counts.jAm}</td><td className="px-2 text-right font-bold tabular-nums text-amber-800">{counts.jPm}</td><td className="px-2 text-right font-bold tabular-nums text-amber-800">{counts.jAm + counts.jPm}</td></tr>
          </tbody>
        </table>
        <div className="no-print flex flex-wrap items-center gap-3 text-sm">
          <span className={`rounded px-2 py-0.5 ${published && !day.closed ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>
            顧客サイト：{day.closed ? '臨時休診' : published ? '公開中' : '非公開'}
          </span>
          <label className="flex items-center gap-1"><input type="checkbox" checked={day.published === true} onChange={(e) => updateDay({ published: e.target.checked ? true : null })} />公開する</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={day.published === false} onChange={(e) => updateDay({ published: e.target.checked ? false : null })} />非公開にする</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={day.closed} onChange={(e) => updateDay({ closed: e.target.checked })} />臨時休診</label>
        </div>
      </div>

      <div className="no-print mb-3 rounded border bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="font-bold">顧客に見える枠数</span>
          <label className="flex items-center gap-1">午前
            <input type="number" min={0} max={20} defaultValue={day.capacityAm ?? ''} placeholder={String(cap.autoAm)} onBlur={(e) => saveCapacity('capacityAm', e.target.value)} className="w-16 rounded border px-2 py-1 text-center" />
            <span className="text-slate-500">枠（シフトから {cap.autoAm}）</span>
          </label>
          <label className="flex items-center gap-1">午後
            <input type="number" min={0} max={20} defaultValue={day.capacityPm ?? ''} placeholder={String(cap.autoPm)} onBlur={(e) => saveCapacity('capacityPm', e.target.value)} className="w-16 rounded border px-2 py-1 text-center" />
            <span className="text-slate-500">枠（シフトから {cap.autoPm}）</span>
          </label>
          <a href={`/admin/shifts?month=${data.date.slice(0, 7)}`} className="text-brand underline">シフト表を開く</a>
        </div>
        <div className="mt-2 text-xs text-slate-600">
          {data.hasStaff ? (
            <>
              <span className="mr-3">午前：{cap.namesAm.length ? cap.namesAm.join('・') : '－'}</span>
              <span className="mr-3">午後：{cap.namesPm.length ? cap.namesPm.join('・') : '－'}</span>
              {data.shiftLabels.filter((x) => x.status !== 'WORK').length > 0 && (
                <span className="text-slate-500">（{data.shiftLabels.filter((x) => x.status !== 'WORK').map((x) => `${x.name}:${shiftLabel[x.status] ?? x.status}`).join('、')}）</span>
              )}
              {data.receptionNames.length > 0 && <span className="ml-3">受付：{data.receptionNames.join('・')}</span>}
            </>
          ) : (
            <span>施術者が登録されていないため既定値を使っています。店舗設定でスタッフを登録し、シフト表を入力すると自動計算されます。</span>
          )}
          <span className="ml-2">空欄＝シフトからの自動計算。数字を入れるとその日だけ上書きします。</span>
        </div>
      </div>

      <div className="no-print mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span><i className="mr-1 inline-block h-3 w-3 border bg-sky-50 align-[-2px]" />WEB予約</span>
        <span><i className="mr-1 inline-block h-3 w-3 border bg-green-100 align-[-2px]" />来院チェック済み</span>
        <span><i className="mr-1 inline-block h-3 w-3 border bg-yellow-100 align-[-2px]" />予約時刻を過ぎて未チェック</span>
        <span><i className="mr-1 inline-block h-3 w-3 border bg-red-100 align-[-2px]" />未来院（予約時刻＋30分）</span>
        <span><i className="mr-1 inline-block h-3 w-3 border bg-amber-50 align-[-2px]" />管理側だけの枠</span>
      </div>

      {pasteInfo && <p className="no-print mb-2 rounded bg-brand-light px-3 py-1 text-xs text-brand-dark">{pasteInfo}</p>}
      {rows.length === 0 ? (
        <p className="rounded border bg-white p-4 text-sm text-slate-600">この日は休診日（定休日・祝日・臨時休診）のため予約表はありません。営業する場合は「臨時休診」を外すか、店舗設定の営業時間を確認してください。</p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table id="grid" className="w-full border-collapse text-sm">
            <thead>
              {(() => {
                const lo = Math.min(cap.am, cap.pm), hi = Math.max(cap.am, cap.pm), n = cols.length;
                const groups: { span: number; label: string; cls: string }[] = [];
                if (lo > 0) groups.push({ span: Math.min(lo, n), label: `予約サイトに表示（午前 ${cap.am} 枠／午後 ${cap.pm} 枠）`, cls: 'bg-green-50 text-green-800' });
                if (hi > lo && lo < n) groups.push({ span: Math.min(hi, n) - lo, label: cap.am > cap.pm ? '午前のみ表示' : '午後のみ表示', cls: 'bg-amber-50 text-amber-800' });
                if (hi < n) groups.push({ span: n - hi, label: '予約サイトに非表示（管理側のみ入力可）', cls: 'bg-slate-100 text-slate-500' });
                return (
                  <tr className="text-[11px]">
                    <th className="border bg-slate-50" />
                    {groups.map((g, i) => <th key={i} colSpan={g.span} className={`border px-1 py-0.5 font-normal ${g.cls}`}>{g.label}</th>)}
                  </tr>
                );
              })()}
              <tr className="bg-slate-100">
                <th className="w-16 border px-1 py-1">時間</th>
                {cols.map((b) => <th key={b} className={`border px-1 py-1 ${b > Math.max(cap.am, cap.pm) ? 'bg-slate-100 text-slate-500' : ''}`}>ベッド{b}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, r) => {
                const isPmStart = r > 0 && am(rows[r - 1]) && !am(t);
                const adminOnly = !customerSet.has(t);
                return (
                  <tr key={t} className={isPmStart ? 'border-t-4 border-t-slate-300' : ''}>
                    <td className={`border px-1 text-center font-mono ${adminOnly ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'}`} title={adminOnly ? '管理側のみの枠（顧客は予約できません）' : undefined}>{minToHm(t)}</td>
                    {cols.map((b, c) => {
                      const k = key(t, b);
                      const text = cells.get(k) ?? '';
                      const web = webInfo.get(k);
                      const cont = isContinuationText(text);
                      const st = stateOf(t, b);
                      const bg = STATE_BG[st] || (web ? 'bg-sky-50' : b > capacityAt(t) ? 'bg-slate-50' : adminOnly ? 'bg-amber-50/40' : '');
                      const hasName = text.trim() !== '' && !cont;
                      return (
                        <td key={b} className={`grid-cell border p-0 ${bg}`}
                          title={web ? `WEB予約（${KIND_JA[web.kind] ?? web.kind}）${web.cardNo ? ` 診察券:${web.cardNo}` : ''} TEL:${web.phone}` : undefined}>
                          <div className="relative flex items-center">
                            {hasName && (
                              <button type="button" tabIndex={-1} onClick={() => toggleVisit(t, b)} aria-label={visited.has(k) ? '来院チェックを外す' : '来院チェック'}
                                className={`no-print ml-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-sm border text-[11px] ${visited.has(k) ? 'border-green-700 bg-green-700 text-white' : 'border-slate-400 bg-white text-transparent hover:text-slate-300'}`}>✓</button>
                            )}
                            <input
                              ref={(el) => { if (el) inputs.current.set(k, el); else inputs.current.delete(k); }}
                              value={text}
                              onChange={(e) => setCell(t, b, e.target.value)}
                              onKeyDown={(e) => onKeyDown(e, r, c)}
                              onPaste={(e) => onPaste(e, r, c)}
                              onBlur={flush}
                              className={hasName ? (st === 'noshow' || st === 'pending' ? 'pr-16' : 'pr-4') : ''}
                            />
                            {hasName && st === 'noshow' && <span className="no-print pointer-events-none absolute right-4 rounded bg-red-600 px-1 text-[10px] leading-4 text-white">未来院</span>}
                            {hasName && st === 'pending' && <span className="no-print pointer-events-none absolute right-4 rounded bg-yellow-600 px-1 text-[10px] leading-4 text-white">未チェック</span>}
                            {hasName && (
                              <button type="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); setMenu(menu === k ? null : k); }} aria-label="メニュー"
                                className="no-print absolute right-0 top-0 h-full w-4 text-xs text-slate-400 hover:text-slate-700">⋯</button>
                            )}
                            {menu === k && (
                              <div data-menu className="absolute right-0 top-full z-20 min-w-[200px] rounded border bg-white py-1 text-left text-sm shadow-lg">
                                <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-brand-light" onClick={() => { setMenu(null); toggleVisit(t, b); }}>{visited.has(k) ? '来院チェックを外す' : '✓ 来院'}</button>
                                <div className="my-1 border-t" />
                                <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-brand-light" onClick={() => cancelCell(t, b, 'ADVANCE')}>キャンセル（連絡あり）→ 名簿へ</button>
                                <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-brand-light" onClick={() => cancelCell(t, b, 'NOSHOW')}>無断キャンセル → 名簿へ</button>
                                <div className="my-1 border-t" />
                                <button type="button" className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-red-50" onClick={() => deleteCell(t, b)}>削除（入力ミス・名簿に残さない）</button>
                              </div>
                            )}
                          </div>
                          {web && hasName && (
                            <div className="no-print px-1 pb-0.5 text-[7px] leading-none tabular-nums text-slate-500" title="WEB予約の電話番号（印刷には出ません）">{formatJpPhone(web.phone)}</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-4 flex items-center gap-2 text-base font-bold">キャンセル名簿 <span className="text-xs font-normal text-slate-500">この日にキャンセルになった予約。セルからは外れているので枠は空いています。</span></h2>
      <div className="mt-1 overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-left text-xs"><th className="px-2 py-1">時刻</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">氏名</th><th className="px-2 py-1">区分</th><th className="px-2 py-1">種別</th><th className="px-2 py-1">登録</th><th className="px-2 py-1">次回予約</th><th className="px-2 py-1">メモ</th><th className="no-print"></th></tr></thead>
          <tbody>
            {data.cancels.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-2 py-1 font-mono">{minToHm(c.time)}</td>
                <td className="px-2 py-1 text-center">{c.bed}</td>
                <td className="px-2 py-1">{c.name}</td>
                <td className="px-2 py-1"><span className={`rounded px-1.5 text-xs ${c.kind === 'ADVANCE' ? 'bg-brand-light text-brand-dark' : 'bg-red-100 text-red-800'}`}>{c.kind === 'ADVANCE' ? '事前連絡' : '無断'}</span></td>
                <td className="px-2 py-1 text-xs">{c.source === 'WEB' ? 'WEB予約' : '電話・窓口'}</td>
                <td className="px-2 py-1 text-xs text-slate-500">{c.createdAt} {c.byCode}</td>
                <td className="whitespace-nowrap px-2 py-1"><NextDateInput key={c.id + (c.nextDate ?? '')} id={c.id} value={c.nextDate} /></td>
                <td className="px-2 py-1"><input defaultValue={c.memo ?? ''} onBlur={(e) => e.target.value !== (c.memo ?? '') && saveMemo(c.id, e.target.value)} placeholder="メモ" className="w-full rounded border px-1 text-xs" /></td>
                <td className="no-print px-2 py-1 text-right"><button type="button" onClick={() => restore(c.id)} className="text-xs text-brand underline">予約表に戻す</button></td>
              </tr>
            ))}
            {data.cancels.length === 0 && <tr><td colSpan={9} className="px-2 py-2 text-xs text-slate-400">キャンセルはありません</td></tr>}
          </tbody>
        </table>
      </div>

      {cancelDlg && (
        <div className="no-print fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setCancelDlg(null)}>
          <div className="w-full max-w-md rounded-lg border bg-white p-4 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">{cancelDlg.kind === 'ADVANCE' ? 'キャンセル（連絡あり）' : '無断キャンセル'}</h3>
            <p className="mt-1 text-slate-600">「{cancelDlg.name}」（{minToHm(cancelDlg.time)} ベッド{cancelDlg.bed}）をキャンセル名簿に移します。枠は空きます。</p>
            <label className="mt-3 block">次回予約が取れている場合はその日付<span className="ml-1 text-xs text-slate-500">（無ければ空欄）</span>
              <input type="date" value={cancelDlg.nextDate} onChange={(e) => setCancelDlg({ ...cancelDlg, nextDate: e.target.value })} className="mt-1 block rounded border px-2 py-1" />
            </label>
            <label className="mt-3 block">メモ<span className="ml-1 text-xs text-slate-500">（空欄可）</span>
              <input value={cancelDlg.memo} onChange={(e) => setCancelDlg({ ...cancelDlg, memo: e.target.value })} maxLength={200} className="mt-1 w-full rounded border px-2 py-1" placeholder="例）体調不良のため" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCancelDlg(null)} className="rounded border px-3 py-1">やめる</button>
              <button type="button" onClick={submitCancel} className="rounded bg-brand px-3 py-1 text-white">名簿へ移す</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3">
        <label className="block text-sm text-slate-600">メモ（電話・とびこみ など）
          <textarea defaultValue={day.memo} onBlur={(e) => e.target.value !== day.memo && updateDay({ memo: e.target.value })} rows={3} className="mt-1 w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>
      <p className="no-print mt-2 text-xs text-slate-500">
        セルに氏名を入力すると自動保存されます。Excel／スプレッドシートからの貼り付けは、<b>時間の列を含めて</b>（例：B7:L36）コピーし、9:00 のベッド1 のセルで Ctrl+V。
        時刻で行を合わせ、結合セル（2列で1ベッド）は自動で1列にまとめます。矢印キー／Enter／Tab で移動。
        氏名の左の □ で来院チェック、右の「⋯」でキャンセル（名簿へ）や削除。初診の 2 枠目「上記初診対応」、再来の「上記再来対応」は 1 枠目と同じ色になり、人数には数えません。内訳の「自賠」は、セルに「自賠」または「事故」と入力すると数えます（例：山田 自賠）。
        黄色の時間（12:00 / 19:30 など）は管理側だけの枠で、顧客は予約できません。
      </p>
    </div>
  );
}
