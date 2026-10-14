
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
import BlockPanel, { blockBedsText } from './BlockPanel';
import ChangeDialog, { type ChangeFrom } from './ChangeDialog';
import CellLogPanel from './CellLogPanel';
import { CANCEL_KIND_CLASS, CANCEL_KIND_JA, changeTargetText } from '@/lib/cancelKind';
import { applyKindTag, kindTagOf, type KindTag, KIND_TAGS } from '@/lib/kindTag';
import { menuColor, menuShort, toggleMenu } from '@/lib/menus';
import { cellColor, KIND_COLORS, KIND_COLOR_NAMES, MENU_CELL_COLORS, VISIT_COLORS } from '@/lib/cellColor';

interface Props { data: DayData; storeName: string; published: boolean; today: string; onRefresh: () => void }

const key = (time: number, bed: number) => `${time}:${bed}`;
const KIND_JA: Record<string, string> = { NEW: '初診', ACCIDENT: '初診（交通事故）', REVISIT: '再来', RETURN: '通院中' };

export default function DayGrid({ data, published, today, onRefresh }: Props) {
  const navigate = useNavigate();
  const [cells, setCells] = useState<Map<string, string>>(() => new Map(data.cells.map((c) => [key(c.time, c.bed), c.text])));
  const [visited, setVisited] = useState<Set<string>>(() => new Set(data.cells.filter((c) => c.visited).map((c) => key(c.time, c.bed))));
  // 予約ごとのメニュー（矯正・2回目 など）と、メニューを付ける対象として選んでいるセル
  const [menus, setMenus] = useState<Map<string, string[]>>(() => new Map(data.cells.filter((c) => c.menus?.length).map((c) => [key(c.time, c.bed), c.menus!])));
  const [sel, setSel] = useState<{ time: number; bed: number } | null>(null);
  const menuOptions = data.menuOptions ?? [];
  // 予約ごとの担当者と、初回の担当が同姓同名で決められなかったセル（「担当を確認」）
  const [staffMap, setStaffMap] = useState<Map<string, string>>(() => new Map(data.cells.filter((c) => c.staff).map((c) => [key(c.time, c.bed), c.staff!])));
  const [staffCheck, setStaffCheck] = useState<Set<string>>(() => new Set(data.cells.filter((c) => c.staffCheck).map((c) => key(c.time, c.bed))));
  const staffOptions = data.staffOptions ?? [];
  const webInfo = useMemo(() => new Map(data.cells.filter((c) => c.web).map((c) => [key(c.time, c.bed), c.web!])), [data.cells]);
  const [day, setDay] = useState(data.day);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [menu, setMenu] = useState<string | null>(null);
  const [pasteInfo, setPasteInfo] = useState('');
  const dirty = useRef(new Map<string, string>());
  // サーバーが最後に知らせてきたセルの内容（保存時に送り、WEB予約の上書きを防ぐ）と、この画面で最後に触った時刻
  const serverText = useRef(new Map<string, string>(data.cells.map((c) => [key(c.time, c.bed), c.text])));
  const touchedAt = useRef(new Map<string, number>());
  const [conflictMsg, setConflictMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  // 元に戻す：変更のまとまり（セルごとの「前」と「後」）を新しい順に積む。画面を開いている間だけ
  const history = useRef<{ k: string; before: string; after: string }[][]>([]);
  const [historyLen, setHistoryLen] = useState(0);
  const focusSnap = useRef<{ k: string; val: string } | null>(null);
  // 複数セルの選択（Shift＋クリック／Shift＋矢印）。家族・親子などをまとめてコピー・貼り付け
  const anchor = useRef<{ r: number; c: number } | null>(null);
  const [range, setRange] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  const extending = useRef(false);

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
    const batch = Array.from(dirty.current.entries()).map(([k, text]) => { const [time, bed] = k.split(':').map(Number); return { time, bed, text, prev: serverText.current.get(k) ?? '' }; });
    dirty.current.clear();
    setSaveState('saving');
    try {
      const r = await fetch('/api/admin/cells', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, cells: batch }) });
      setSaveState(r.ok ? 'saved' : 'error');
      if (!r.ok) return;
      const j = await r.json().catch(() => ({})) as { conflicts?: { time: number; bed: number; text: string }[] };
      const conflicts = j.conflicts ?? [];
      const lost = new Set(conflicts.map((c) => key(c.time, c.bed)));
      for (const c of batch) if (!lost.has(key(c.time, c.bed))) serverText.current.set(key(c.time, c.bed), c.text);
      if (conflicts.length) {
        // 先に WEB予約が入っていたセル：入力は保存せず、WEB予約を表示し直す
        setCells((m) => { const n = new Map(m); for (const c of conflicts) n.set(key(c.time, c.bed), c.text); return n; });
        for (const c of conflicts) { serverText.current.set(key(c.time, c.bed), c.text); touchedAt.current.delete(key(c.time, c.bed)); }
        setConflictMsg(`先に WEB予約が入っていたため、次のセルの入力は保存されませんでした：${conflicts.map((c) => `${minToHm(c.time)} ベッド${c.bed}（${c.text}）`).join('、')}。空いている別のセルに入れ直してください。`);
        onRefresh();
      }
    } catch { setSaveState('error'); }
  }, [data.date, onRefresh]);
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
    if (!text.trim()) setMenus((m) => { if (!m.has(key(time, bed))) return m; const n = new Map(m); n.delete(key(time, bed)); return n; });
    dirty.current.set(key(time, bed), text);
    touchedAt.current.set(key(time, bed), Date.now());
    schedule();
  }

  // ---------- 元に戻す ----------
  function pushHistory(batch: { k: string; before: string; after: string }[]) {
    const b = batch.filter((x) => x.before !== x.after);
    if (!b.length) return;
    history.current.push(b);
    if (history.current.length > 50) history.current.shift();
    setHistoryLen(history.current.length);
  }
  /** まとめて書き換えて、元に戻せるように記録する */
  function setCellsTracked(changes: { time: number; bed: number; text: string }[]) {
    const batch = changes.map((c) => ({ k: key(c.time, c.bed), before: cells.get(key(c.time, c.bed)) ?? '', after: c.text }));
    for (const c of changes) setCell(c.time, c.bed, c.text);
    pushHistory(batch);
    syncSnap(changes);
  }
  // 入力中のセルをボタンなどで書き換えたときは、そのセルの「入力前の内容」も合わせる（二重に記録しない）
  function syncSnap(changes: { time: number; bed: number; text: string }[]) {
    const snap = focusSnap.current;
    if (!snap) return;
    const hit = changes.find((c) => key(c.time, c.bed) === snap.k);
    if (hit) focusSnap.current = { k: snap.k, val: hit.text };
  }
  function undo() {
    const b = history.current.pop();
    setHistoryLen(history.current.length);
    if (!b) return;
    for (const x of [...b].reverse()) { const [time, bed] = x.k.split(':').map(Number); setCell(time, bed, x.before); }
    syncSnap(b.map((x) => { const [time, bed] = x.k.split(':').map(Number); return { time, bed, text: x.before }; }));
    const first = b[0].k.split(':').map(Number);
    setPasteInfo(`元に戻しました（${b.length} セル：${minToHm(first[0])} ベッド${first[1]} など）`);
  }

  // ---------- 自動更新（30 秒ごと・画面に戻ったとき） ----------
  // 新しく読み込んだ内容を画面に反映する。入力中・直前（15 秒以内）に触ったセルはそのまま（保存時にサーバーが確認する）
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    const fresh = new Map(data.cells.map((c) => [key(c.time, c.bed), c.text]));
    const recent = (k: string) => dirty.current.has(k) || Date.now() - (touchedAt.current.get(k) ?? 0) < 15000;
    setCells((m) => {
      const n = new Map(m);
      for (const k of new Set([...m.keys(), ...fresh.keys()])) {
        if (recent(k)) continue;
        const v = fresh.get(k) ?? '';
        n.set(k, v);
        serverText.current.set(k, v);
      }
      return n;
    });
    const freshMenus = new Map(data.cells.filter((c) => c.menus?.length).map((c) => [key(c.time, c.bed), c.menus!]));
    setMenus((m) => {
      const n = new Map(m);
      for (const k of new Set([...m.keys(), ...freshMenus.keys()])) {
        if (recent(k)) continue;
        const v = freshMenus.get(k);
        if (v) n.set(k, v); else n.delete(k);
      }
      return n;
    });
    const freshStaff = new Map(data.cells.filter((c) => c.staff).map((c) => [key(c.time, c.bed), c.staff!]));
    setStaffMap((m) => {
      const n = new Map(m);
      for (const k of new Set([...m.keys(), ...freshStaff.keys()])) {
        if (recent(k)) continue;
        const v = freshStaff.get(k);
        if (v) n.set(k, v); else n.delete(k);
      }
      return n;
    });
    setStaffCheck(new Set(data.cells.filter((c) => c.staffCheck).map((c) => key(c.time, c.bed))));
    const freshVisited = new Set(data.cells.filter((c) => c.visited).map((c) => key(c.time, c.bed)));
    setVisited((v) => {
      const n = new Set(freshVisited);
      for (const k of v) if (recent(k) && !freshVisited.has(k)) n.add(k);
      for (const k of freshVisited) if (recent(k) && !v.has(k)) n.delete(k);
      return n;
    });
  }, [data.cells]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') onRefresh(); };
    const id = setInterval(tick, 30 * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [onRefresh]);

  // ---------- キー操作・貼り付け ----------
  function focusCell(r: number, c: number) {
    if (r < 0 || r >= rows.length || c < 0 || c >= cols.length) return;
    inputs.current.get(key(rows[r], cols[c]))?.focus();
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    // Ctrl+Z：打ちかけの文字が無ければ、この画面での変更を 1 つ戻す（打ちかけはブラウザの元に戻すに任せる）
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && e.currentTarget.value === (focusSnap.current?.val ?? e.currentTarget.value)) {
      if (history.current.length) { e.preventDefault(); undo(); }
      return;
    }
    // Shift＋矢印：選択を広げる
    const ext: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.shiftKey && e.key in ext) {
      e.preventDefault();
      const nr = Math.max(0, Math.min(rows.length - 1, r + ext[e.key][0])), nc = Math.max(0, Math.min(cols.length - 1, c + ext[e.key][1]));
      const a = anchor.current ?? { r, c };
      anchor.current = a;
      extending.current = true;
      setRange({ r0: Math.min(a.r, nr), c0: Math.min(a.c, nc), r1: Math.max(a.r, nr), c1: Math.max(a.c, nc) });
      focusCell(nr, nc);
      return;
    }
    if (e.key === 'Escape') { setRange(null); return; }
    // 複数セルを選んでいるときの Delete：まとめて消す（元に戻せる）
    if ((e.key === 'Delete' || e.key === 'Backspace') && range && rangeSize(range) > 1) {
      e.preventDefault();
      clearRange(range);
      return;
    }
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
    const changes: { time: number; bed: number; text: string }[] = [];
    for (const cell of plan.cells) {
      const cc = c + cell.col;
      if (cell.row < rows.length && cc < cols.length) changes.push({ time: rows[cell.row], bed: cols[cc], text: cell.text });
    }
    setCellsTracked(changes);
    const n = changes.length;
    if (n > 1) setRange({ r0: plan.timeAligned ? Math.min(...plan.cells.map((x) => x.row)) : r, c0: c, r1: Math.min(rows.length - 1, Math.max(...plan.cells.map((x) => x.row))), c1: Math.min(cols.length - 1, c + Math.max(...plan.cells.map((x) => x.col))) });
    const notes = [`${n} セルを貼り付けました`];
    if (plan.timeAligned) notes.push('時間列で行を合わせました');
    if (plan.mergedCollapsed) notes.push('結合セル（2列=1ベッド）を1列にまとめました');
    if (plan.skippedTimes.length) notes.push(`予約表に無い時刻は飛ばしました：${plan.skippedTimes.join('、')}`);
    setPasteInfo(notes.join('。') + '（間違えたときは「元に戻す」）');
  }
  // ---------- 複数セルのコピー・切り取り・消去 ----------
  const rangeSize = (g: { r0: number; c0: number; r1: number; c1: number }) => (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);
  const inRange = (r: number, c: number) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
  function rangeText(g: { r0: number; c0: number; r1: number; c1: number }) {
    const lines: string[] = [];
    for (let r = g.r0; r <= g.r1; r++) { const row: string[] = []; for (let c = g.c0; c <= g.c1; c++) row.push(cells.get(key(rows[r], cols[c])) ?? ''); lines.push(row.join('\t')); }
    return lines.join('\n');
  }
  function clearRange(g: { r0: number; c0: number; r1: number; c1: number }) {
    const changes: { time: number; bed: number; text: string }[] = [];
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) if ((cells.get(key(rows[r], cols[c])) ?? '') !== '') changes.push({ time: rows[r], bed: cols[c], text: '' });
    setCellsTracked(changes);
    setPasteInfo(`${changes.length} セルを消しました（間違えたときは「元に戻す」）`);
  }
  function onCopyCut(e: React.ClipboardEvent<HTMLInputElement>, cut: boolean) {
    if (!range || rangeSize(range) <= 1) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', rangeText(range));
    const n = rangeSize(range);
    if (cut) clearRange(range);
    else setPasteInfo(`${n} セルをコピーしました。貼り付けたい場所の左上のセルを押して Ctrl+V`);
  }

  // ---------- 来院チェック・キャンセル ----------
  async function toggleVisit(time: number, bed: number) {
    const k = key(time, bed);
    const next = !visited.has(k);
    setVisited((s) => { const n = new Set(s); if (next) n.add(k); else n.delete(k); return n; });
    touchedAt.current.set(k, Date.now());
    const r = await fetch('/api/admin/visit', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, time, bed, visited: next }) });
    if (!r.ok) { setVisited((s) => { const n = new Set(s); if (next) n.delete(k); else n.add(k); return n; }); alert('来院チェックの保存に失敗しました'); }
  }
  // キャンセル・予約変更（1 つのダイアログ）
  const [changeDlg, setChangeDlg] = useState<ChangeFrom | null>(null);
  const [moveMsg, setMoveMsg] = useState<{ text: string; date: string } | null>(null);
  async function openChange(time: number, bed: number) {
    setMenu(null);
    await flush();
    setChangeDlg({ date: data.date, time, bed, name: cells.get(key(time, bed)) ?? '', twoSlots: isContinuationText(cells.get(key(time + data.slotMinutes, bed))) });
  }
  function cancelled() {
    if (!changeDlg) return;
    const { time, bed } = changeDlg;
    touchedAt.current.set(key(time, bed), Date.now()); touchedAt.current.set(key(time + data.slotMinutes, bed), Date.now());
    setCells((m) => { const n = new Map(m); n.set(key(time, bed), ''); const k2 = key(time + data.slotMinutes, bed); if (isContinuationText(n.get(k2))) n.set(k2, ''); return n; });
    setMenus((m) => { const n = new Map(m); n.delete(key(time, bed)); return n; });
    setChangeDlg(null);
    onRefresh();
  }
  function moved(to: { date: string; time: number; bed: number; slots: number }) {
    if (!changeDlg) return;
    const { time, bed, twoSlots } = changeDlg;
    for (const k of [key(time, bed), key(time + data.slotMinutes, bed), key(to.time, to.bed), key(to.time + data.slotMinutes, to.bed)]) touchedAt.current.set(k, Date.now());
    setCells((m) => {
      const n = new Map(m);
      const name = n.get(key(time, bed)) ?? '';
      const cont = n.get(key(time + data.slotMinutes, bed)) ?? '';
      n.set(key(time, bed), '');
      if (twoSlots) n.set(key(time + data.slotMinutes, bed), '');
      // 同じ日の中で動かしたときは、変更先にも表示する
      if (to.date === data.date) { n.set(key(to.time, to.bed), name); if (twoSlots) n.set(key(to.time + data.slotMinutes, to.bed), cont); }
      return n;
    });
    setVisited((v) => { const n = new Set(v); n.delete(key(time, bed)); return n; });
    setMenus((m) => {
      const n = new Map(m);
      const list = n.get(key(time, bed));
      n.delete(key(time, bed));
      if (list && to.date === data.date) n.set(key(to.time, to.bed), list);
      return n;
    });
    setStaffMap((m) => {
      const n = new Map(m);
      const st = n.get(key(time, bed));
      n.delete(key(time, bed));
      if (st && to.date === data.date) n.set(key(to.time, to.bed), st);
      return n;
    });
    setMoveMsg({ text: `${changeDlg.name} を ${formatDateJa(to.date)} ${minToHm(to.time)}〜（ベッド${to.bed}）に変更しました`, date: to.date });
    setChangeDlg(null);
    onRefresh();
  }
  // メニューの付け外し（先に氏名を保存してから送る）
  async function toggleMenuAt(time: number, bed: number, label: string) {
    const k = key(time, bed);
    const before = menus.get(k) ?? [];
    const next = toggleMenu(before, label, menuOptions);
    touchedAt.current.set(k, Date.now());
    setMenus((m) => { const n = new Map(m); if (next.length) n.set(k, next); else n.delete(k); return n; });
    await flush();
    const r = await fetch('/api/admin/cell-menus', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, time, bed, menus: next }) });
    if (!r.ok) {
      setMenus((m) => { const n = new Map(m); if (before.length) n.set(k, before); else n.delete(k); return n; });
      alert((await r.json().catch(() => ({}))).error ?? 'メニューを保存できませんでした');
      return;
    }
    // 2回目・3回目などを付けると、初回を担当したスタッフが担当に入る
    const j = await r.json().catch(() => ({})) as { staff?: string; staffCheck?: boolean };
    if (j.staff) setStaffMap((m) => new Map(m).set(k, j.staff!));
    setStaffCheck((s) => { const n = new Set(s); if (j.staffCheck) n.add(k); else n.delete(k); return n; });
  }
  // 担当者をまとめて付ける・外す（選んだ範囲の、氏名の入ったセル）
  function targetCells(): { time: number; bed: number }[] {
    const out: { time: number; bed: number }[] = [];
    const add = (r: number, c: number) => { const t = rows[r], b = cols[c]; const v = cells.get(key(t, b)) ?? ''; if (v.trim() && !isContinuationText(v)) out.push({ time: t, bed: b }); };
    if (range && rangeSize(range) > 1) { for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) add(r, c); }
    else if (sel) add(rows.indexOf(sel.time), cols.indexOf(sel.bed));
    return out;
  }
  async function setStaffFor(name: string) {
    const list = targetCells();
    if (!list.length) return;
    await flush();
    const before = new Map(staffMap);
    for (const c of list) touchedAt.current.set(key(c.time, c.bed), Date.now());
    setStaffMap((m) => { const n = new Map(m); for (const c of list) { if (name) n.set(key(c.time, c.bed), name); else n.delete(key(c.time, c.bed)); } return n; });
    setStaffCheck((s) => { const n = new Set(s); for (const c of list) n.delete(key(c.time, c.bed)); return n; });
    const r = await fetch('/api/admin/cell-staff', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, cells: list, staff: name }) });
    if (!r.ok) { setStaffMap(before); alert((await r.json().catch(() => ({}))).error ?? '担当を保存できませんでした'); return; }
    setPasteInfo(name ? `${list.length} 件に担当「${name}」を付けました` : `${list.length} 件の担当を外しました`);
  }
  // 新患・再来・新自：氏名の後ろに（初診）（再来）（新自）を付け外しし、下のセルの「上記初診対応」「上記再来対応」も合わせる
  function setKindTag(time: number, bed: number, tag: KindTag) {
    const text = cells.get(key(time, bed)) ?? '';
    const { text: next, cont } = applyKindTag(text, tag);
    const changes = [{ time, bed, text: next }];
    const t2 = time + data.slotMinutes;
    const below = cells.get(key(t2, bed)) ?? '';
    if (rows.includes(t2)) {
      if (cont && (below.trim() === '' || isContinuationText(below))) changes.push({ time: t2, bed, text: cont });
      else if (!cont && isContinuationText(below)) changes.push({ time: t2, bed, text: '' });
    }
    setCellsTracked(changes);
    inputs.current.get(key(time, bed))?.focus();
  }
  // 下のセルに「上記初診対応」「上記再来対応」を入れる（手入力の初診・再来用。打ち込まなくてよい）
  function fillBelow(time: number, bed: number, text: string) {
    setMenu(null);
    const t2 = time + data.slotMinutes;
    if (!rows.includes(t2)) { alert('下の時間が予約表にないため入れられません'); return; }
    if ((cells.get(key(t2, bed)) ?? '').trim()) { alert('下のセルにすでに入力があります'); return; }
    setCellsTracked([{ time: t2, bed, text }]);
  }
  // セルをクリックしたら文字を全部選ぶ（そのまま Ctrl+C でコピー、入力すると置き換え）
  const justFocused = useRef(false);
  function deleteCell(time: number, bed: number) {
    setMenu(null);
    const changes = [{ time, bed, text: '' }];
    if (isContinuationText(cells.get(key(time + data.slotMinutes, bed)))) changes.push({ time: time + data.slotMinutes, bed, text: '' });
    setCellsTracked(changes);
    setPasteInfo('削除しました（間違えたときは「元に戻す」）');
  }
  async function restore(id: string) {
    const r = await fetch('/api/admin/cancel', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!r.ok) { alert((await r.json()).error ?? '戻せませんでした'); return; }
    onRefresh();
    // 画面のセルにも即反映
    const c = data.cancels.find((x) => x.id === id);
    if (c) { touchedAt.current.set(key(c.time, c.bed), Date.now()); touchedAt.current.set(key(c.time + data.slotMinutes, c.bed), Date.now()); }
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
    // 予約／来院の人数に加えて、内訳（初診＝（初診）（初自）（初）、再来＝（再）、自賠＝（初自）または「自賠」「事故」の手入力）を数える
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

  // メニュー別の人数（午前・午後）
  const menuCounts = useMemo(() => {
    const out = new Map<string, { am: number; pm: number }>();
    for (const [k, list] of menus) {
      if (!isPatientText(cells.get(k))) continue;
      const a = isAm(data.sessions, Number(k.split(':')[0]));
      for (const m of list) { const c = out.get(m) ?? { am: 0, pm: 0 }; if (a) c.am++; else c.pm++; out.set(m, c); }
    }
    for (const m of menuOptions) if (!out.has(m)) out.set(m, { am: 0, pm: 0 });
    const order = (m: string) => { const i = menuOptions.indexOf(m); return i < 0 ? menuOptions.length : i; };
    return [...out.entries()].sort((a, b) => order(a[0]) - order(b[0]));
  }, [menus, cells, data.sessions, menuOptions]);

  // 「未来院」の赤は出さない（予約時刻を過ぎて未チェックの黄色だけで見る）
  const noRed = (st: CellState): CellState => (st === 'noshow' ? 'pending' : st);
  /** セルの色。2枠目は1枠目（同じベッドの1つ前の枠）の状態に合わせる */
  function stateOf(t: number, b: number): CellState {
    const k = key(t, b);
    const text = cells.get(k) ?? '';
    if (!text.trim()) return 'none';
    if (isContinuationText(text)) {
      const pt = t - data.slotMinutes;
      const ptext = cells.get(key(pt, b)) ?? '';
      if (!ptext.trim()) return 'none';
      return noRed(cellState(visited.has(key(pt, b)), pt, nowMin));
    }
    return noRed(cellState(visited.has(k), t, nowMin));
  }
  const shiftLabel: Record<string, string> = { WORK: '〇', OFF: '休', AM_OFF: '前休', PM_OFF: '後休', PAID: '有給', AM_PAID: '前有', PM_PAID: '後有', HELP: 'ヘルプ', AM_HELP: '前ヘルプ', PM_HELP: '後ヘルプ' };

  return (
    <div onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-menu]')) setMenu(null); }}>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => navigate(`/admin/day/${addDays(data.date, -1)}`)}>‹ 前日</button>
        <input type="date" value={data.date} onChange={(e) => e.target.value && navigate(`/admin/day/${e.target.value}`)} className="rounded border px-2 py-1" />
        <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => navigate(`/admin/day/${addDays(data.date, 1)}`)}>翌日 ›</button>
        <button type="button" className={`rounded px-4 py-1 font-bold ${data.date === today ? 'border border-brand bg-brand-light text-brand-dark' : 'bg-brand text-white'}`} onClick={() => navigate(`/admin/day/${today}`)} aria-current={data.date === today ? 'date' : undefined}>本日</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={undo} disabled={historyLen === 0} className="rounded border bg-white px-3 py-1 disabled:opacity-40" title="この画面で入力・削除・貼り付けしたものを 1 つずつ戻します（Ctrl+Z）">↶ 元に戻す{historyLen ? `（${historyLen}）` : ''}</button>
        <span className="ml-auto text-xs text-slate-500">
          {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '保存しました' : saveState === 'error' ? '保存に失敗しました' : '入力すると自動保存されます'}
          <span className="ml-2 text-slate-400">（30秒ごとに最新の内容に自動更新）</span>
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
        <table className="text-sm" title="内訳。初診＝「（初診）」「（初自）」「（初）」または括弧なしの「初診」「初自」、再来＝「（再）」または括弧なしの「再来」「再診」、自賠＝「初自」「自賠」「事故」を含むセル（手入力可）">
          <thead><tr className="text-[11px] text-slate-500"><th></th><th className="px-2 text-right font-normal">午前</th><th className="px-2 text-right font-normal">午後</th><th className="px-2 text-right font-normal">合計</th></tr></thead>
          <tbody>
            <tr><td className="pr-2 text-slate-500">初診</td><td className="px-2 text-right font-bold tabular-nums">{counts.nAm}</td><td className="px-2 text-right font-bold tabular-nums">{counts.nPm}</td><td className="px-2 text-right font-bold tabular-nums">{counts.nAm + counts.nPm}</td></tr>
            <tr><td className="pr-2 text-slate-500">再来</td><td className="px-2 text-right font-bold tabular-nums">{counts.reAm}</td><td className="px-2 text-right font-bold tabular-nums">{counts.rePm}</td><td className="px-2 text-right font-bold tabular-nums">{counts.reAm + counts.rePm}</td></tr>
            <tr><td className="pr-2 text-slate-500">自賠</td><td className="px-2 text-right font-bold tabular-nums text-amber-800">{counts.jAm}</td><td className="px-2 text-right font-bold tabular-nums text-amber-800">{counts.jPm}</td><td className="px-2 text-right font-bold tabular-nums text-amber-800">{counts.jAm + counts.jPm}</td></tr>
          </tbody>
        </table>
        {menuOptions.length > 0 && (
          // メニュー別の人数：行は午前・午後・合計で固定（メニューが増えても高さは変わらない）
          <div className="max-w-full overflow-x-auto">
            <table className="text-sm" aria-label="メニュー別の人数">
              <thead><tr className="text-[11px] text-slate-500"><th></th>{menuCounts.map(([m]) => (
                <th key={m} className="whitespace-nowrap px-1.5 text-right font-normal" title={m}><i className="mr-0.5 inline-block min-w-[13px] rounded-sm px-[2px] text-center text-[9px] font-bold not-italic leading-[14px] text-white" style={{ background: menuColor(m, menuOptions) }}>{menuShort(m)}</i>{m.length > 4 ? `${m.slice(0, 4)}…` : m}</th>
              ))}</tr></thead>
              <tbody>
                {(['am', 'pm', 'all'] as const).map((w) => (
                  <tr key={w}><td className="pr-2 text-slate-500">{w === 'am' ? '午前' : w === 'pm' ? '午後' : '合計'}</td>
                    {menuCounts.map(([m, c]) => { const v = w === 'am' ? c.am : w === 'pm' ? c.pm : c.am + c.pm; return <td key={m} className={`px-1.5 text-right tabular-nums ${v ? 'font-bold' : 'text-slate-300'}`}>{v}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
        <BlockPanel key={data.date} date={data.date} times={rows} slotMinutes={data.slotMinutes} beds={cols} blocks={data.blocks ?? []} onRefresh={onRefresh} />
      </div>

      <div className="no-print mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {(Object.keys(KIND_COLORS) as (keyof typeof KIND_COLORS)[]).map((kk) => <span key={kk}><i className="mr-1 inline-block h-3 w-3 border align-[-2px]" style={{ background: KIND_COLORS[kk] }} />{KIND_COLOR_NAMES[kk]}</span>)}
        {Object.entries({ ...VISIT_COLORS, ...MENU_CELL_COLORS }).map(([m, c]) => <span key={m}><i className="mr-1 inline-block h-3 w-3 border align-[-2px]" style={{ background: c }} />{m}</span>)}
        <span><i className="mr-1 inline-block h-3 w-3 border border-l-4 border-l-green-700 align-[-2px]" />来院チェック済み（左に緑の線）</span>
        <span><span className="mr-1 rounded bg-yellow-600 px-1 text-[10px] text-white">未チェック</span>予約時刻を過ぎて未チェック</span>
        <span><span className="mr-1 rounded-sm border border-sky-600 px-[2px] text-[8px] font-bold text-sky-700">WEB</span>WEB予約</span>
        <span><span className="mr-1 rounded-full border border-brand px-1.5 text-[10px] font-bold text-brand-dark">名前</span>担当</span>
        <span><i className="mr-1 inline-block h-3 w-3 border bg-amber-50 align-[-2px]" />管理側だけの枠</span>
        <span><i className="mr-1 inline-block h-3 w-3 border bg-slate-300 align-[-2px]" />🔒 ブロック中の時間</span>
      </div>

      {conflictMsg && (
        <p role="alert" className="no-print mb-2 flex items-start gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="flex-1">{conflictMsg}</span>
          <button type="button" onClick={() => setConflictMsg('')} aria-label="閉じる" className="text-red-500">✕</button>
        </p>
      )}
      {pasteInfo && <p className="no-print mb-2 rounded bg-brand-light px-3 py-1 text-xs text-brand-dark">{pasteInfo}</p>}
      {rows.length === 0 ? (
        <p className="rounded border bg-white p-4 text-sm text-slate-600">この日は休診日（定休日・祝日・臨時休診）のため予約表はありません。営業する場合は「臨時休診」を外すか、店舗設定の営業時間を確認してください。</p>
      ) : (
        <>
        {(() => {
          const sk = sel ? key(sel.time, sel.bed) : '';
          const sText = sel ? cells.get(sk) ?? '' : '';
          const ok = !!sel && sText.trim() !== '' && !isContinuationText(sText);
          const cur = ok ? menus.get(sk) ?? [] : [];
          const tag = ok ? kindTagOf(sText) : null;
          const multi = !!range && rangeSize(range) > 1;
          const curStaff = ok && !multi ? staffMap.get(sk) ?? '' : '';
          const staffBtns = staffOptions.length > 0 && (ok || multi) && (
            <>
              <span className="mx-0.5 h-5 w-px bg-slate-300" aria-hidden="true" />
              <span className="text-xs font-bold text-slate-600">担当</span>
              {staffOptions.map((n) => (
                <button key={n} type="button" aria-pressed={curStaff === n} onMouseDown={(e) => e.preventDefault()} onClick={() => setStaffFor(n)}
                  className={`rounded-full border-2 px-2 py-0.5 text-xs font-bold ${curStaff === n ? 'border-brand bg-brand text-white' : 'border-brand/40 bg-white text-brand-dark hover:border-brand'}`}>{n}</button>
              ))}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setStaffFor('')} className="rounded-full border px-2 py-0.5 text-xs text-slate-500 hover:border-slate-400">担当を外す</button>
            </>
          );
          return (
            <div className="no-print sticky top-0 z-10 mb-1 flex min-h-[38px] flex-wrap items-center gap-1.5 rounded border bg-white/95 px-2 py-1 text-sm shadow-sm backdrop-blur" role="group" aria-label="予約のメニュー">
              <span className="mr-1 text-xs font-bold text-slate-600">メニュー</span>
              {multi ? (
                <>
                  <span className="mr-1 text-xs text-slate-600"><b className="text-slate-800">{targetCells().length} 件</b>選択中（Shift＋クリックで範囲を選ぶと、担当をまとめて付けられます）</span>
                  {staffBtns}
                </>
              ) : ok ? (
                <>
                  <span className="mr-1 max-w-[16rem] truncate text-xs text-slate-600">{minToHm(sel!.time)} ベッド{sel!.bed}　<b className="text-slate-800">{sText}</b></span>
                  {KIND_TAGS.map((kt) => (
                    <button key={kt.tag} type="button" aria-pressed={tag === kt.tag} onMouseDown={(e) => e.preventDefault()} onClick={() => setKindTag(sel!.time, sel!.bed, kt.tag)}
                      title={`氏名の後ろに${kt.suffix}を付けます（もう一度押すと外れます）。下のセルに「${kt.cont}」も入ります`}
                      className={`rounded border-2 px-2 py-0.5 text-xs font-bold ${tag === kt.tag ? 'border-transparent text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
                      style={tag === kt.tag ? { background: kt.color } : undefined}>{kt.tag}</button>
                  ))}
                  <span className="mx-0.5 h-5 w-px bg-slate-300" aria-hidden="true" />
                  {menuOptions.map((m) => {
                    const on = cur.includes(m);
                    return (
                      <button key={m} type="button" aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleMenuAt(sel!.time, sel!.bed, m)}
                        className={`rounded border-2 px-2 py-0.5 text-xs font-bold ${on ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
                        style={on ? { background: menuColor(m, menuOptions) } : undefined}>{m}</button>
                    );
                  })}
                  {staffBtns}
                </>
              ) : (
                <span className="text-xs text-slate-500">名前の入ったセルをクリックすると、ここで新患・再来・新自{menuOptions.length ? `・メニュー（${menuOptions.join('・')}）` : ''}・担当を付けられます</span>
              )}
            </div>
          );
        })()}
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
                const blk = (data.blocks ?? []).filter((b) => t >= b.start && t < b.end);
                return (
                  <tr key={t} className={isPmStart ? 'border-t-4 border-t-slate-300' : ''}>
                    <td className={`whitespace-nowrap border px-1 text-center font-mono ${blk.length ? 'bg-slate-300 text-slate-800' : adminOnly ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'}`}
                      title={blk.length ? `ブロック中：${blk.map((b) => `${b.label || '（内容なし）'} ${blockBedsText(b.beds, cols)}`).join('、')}` : adminOnly ? '管理側のみの枠（顧客は予約できません）' : undefined}>
                      {blk.length > 0 && <span className="no-print mr-0.5 text-[10px]">🔒</span>}{minToHm(t)}
                    </td>
                    {cols.map((b, c) => {
                      const k = key(t, b);
                      const text = cells.get(k) ?? '';
                      const web = webInfo.get(k);
                      const cont = isContinuationText(text);
                      const st = stateOf(t, b);
                      const bBlock = blk.find((x) => x.beds.includes(b));
                      const hasName = text.trim() !== '' && !cont;
                      const cellMenus = hasName ? menus.get(k) ?? [] : [];
                      // セルの色：初診・再来・新自 → 回数（2・3・6回目）。2 枠目は 1 枠目に合わせる
                      const pk = key(t - data.slotMinutes, b);
                      const color = !text.trim() ? null : cont ? cellColor(cells.get(pk) ?? '', menus.get(pk) ?? []) : cellColor(text, cellMenus);
                      const bg = color ? '' : bBlock && !text ? 'bg-slate-300' : b > capacityAt(t) ? 'bg-slate-50' : adminOnly ? 'bg-amber-50/40' : '';
                      const staffName = hasName ? staffMap.get(k) ?? '' : '';
                      const needCheck = hasName && !staffName && staffCheck.has(k);
                      const isSel = !!sel && sel.time === t && sel.bed === b && hasName;
                      const ranged = inRange(r, c);
                      return (
                        <td key={b} className={`grid-cell border p-0 ${ranged ? 'bg-indigo-100' : bg} ${color?.dark && !ranged ? 'dark-cell' : ''} ${isSel || ranged ? 'outline outline-2 -outline-offset-2 outline-brand' : ''} ${st === 'visited' ? 'shadow-[inset_4px_0_0_#15803d]' : ''}`}
                          style={color && !ranged ? { background: color.bg } : undefined}
                          title={web ? `WEB予約（${KIND_JA[web.kind] ?? web.kind}）${web.cardNo ? ` 診察券:${web.cardNo}` : ''} TEL:${web.phone}` : undefined}>
                          <div className={`relative flex items-center ${hasName ? 'pr-4' : ''}`}>
                            {hasName && (
                              <button type="button" tabIndex={-1} onClick={() => toggleVisit(t, b)} aria-label={visited.has(k) ? '来院チェックを外す' : '来院チェック'}
                                className={`no-print ml-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-sm border text-[11px] ${visited.has(k) ? 'border-green-700 bg-green-700 text-white' : 'border-slate-400 bg-white text-transparent hover:text-slate-300'}`}>✓</button>
                            )}
                            {web && hasName && <span className="ml-0.5 flex-none rounded-sm border border-sky-600 bg-white px-[2px] text-[8px] font-bold leading-[12px] text-sky-700" title="WEB予約">WEB</span>}
                            {cellMenus.length > 0 && (
                              <span className="ml-0.5 flex flex-none gap-px" title={`メニュー：${cellMenus.join('・')}`} aria-label={`メニュー：${cellMenus.join('・')}`}>
                                {cellMenus.map((m) => <i key={m} className="min-w-[13px] rounded-sm px-[2px] text-center text-[9px] font-bold not-italic leading-[14px] text-white" style={{ background: menuColor(m, menuOptions) }}>{menuShort(m)}</i>)}
                              </span>
                            )}
                            <input
                              ref={(el) => { if (el) inputs.current.set(k, el); else inputs.current.delete(k); }}
                              value={text}
                              onChange={(e) => setCell(t, b, e.target.value)}
                              onKeyDown={(e) => onKeyDown(e, r, c)}
                              onPaste={(e) => onPaste(e, r, c)}
                              onCopy={(e) => onCopyCut(e, false)}
                              onCut={(e) => onCopyCut(e, true)}
                              onMouseDown={(e) => {
                                // Shift＋クリック：最初に押したセルからここまでをまとめて選ぶ
                                if (e.shiftKey && anchor.current) {
                                  e.preventDefault();
                                  const a = anchor.current;
                                  setRange({ r0: Math.min(a.r, r), c0: Math.min(a.c, c), r1: Math.max(a.r, r), c1: Math.max(a.c, c) });
                                }
                              }}
                              onBlur={(e) => {
                                const snap = focusSnap.current;
                                if (snap && snap.k === k && snap.val !== e.currentTarget.value) pushHistory([{ k, before: snap.val, after: e.currentTarget.value }]);
                                focusSnap.current = null;
                                void flush();
                              }}
                              onFocus={(e) => {
                                e.currentTarget.select(); justFocused.current = true; setSel({ time: t, bed: b });
                                focusSnap.current = { k, val: e.currentTarget.value };
                                if (extending.current) extending.current = false; else { anchor.current = { r, c }; setRange(null); }
                              }}
                              onMouseUp={(e) => { if (justFocused.current) { e.preventDefault(); justFocused.current = false; } }}
                              placeholder={bBlock ? `🔒${bBlock.label || 'ブロック'}` : undefined}
                              className={`min-w-0 flex-1 ${bBlock ? 'placeholder:text-slate-600' : ''}`}
                            />
                            {hasName && st === 'pending' && <span className="no-print pointer-events-none flex-none rounded bg-yellow-600 px-1 text-[10px] leading-4 text-white">未チェック</span>}
                            {staffName && <span className="ml-0.5 flex-none rounded-full border border-brand bg-white px-1.5 text-[10px] font-bold leading-4 text-brand-dark" title={`担当：${staffName}`}>{staffName}</span>}
                            {needCheck && <span className="no-print ml-0.5 flex-none rounded bg-amber-500 px-1 text-[10px] font-bold leading-4 text-white" title="同じ名前の初回の患者様が複数いるため、担当を自動で付けられませんでした">担当を確認</span>}
                            {hasName && (
                              <button type="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); setMenu(menu === k ? null : k); }} aria-label="メニュー"
                                className="no-print absolute right-0 top-0 h-full w-4 text-xs text-slate-400 hover:text-slate-700">⋯</button>
                            )}
                            {menu === k && (
                              <div data-menu className="absolute right-0 top-full z-20 min-w-[200px] rounded border bg-white py-1 text-left text-sm shadow-lg">
                                <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-brand-light" onClick={() => { setMenu(null); toggleVisit(t, b); }}>{visited.has(k) ? '来院チェックを外す' : '✓ 来院'}</button>
                                {!(cells.get(key(t + data.slotMinutes, b)) ?? '').trim() && rows.includes(t + data.slotMinutes) && (
                                  <>
                                    <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-brand-light" onClick={() => fillBelow(t, b, '上記初診対応')}>下のセルに「上記初診対応」</button>
                                    <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-brand-light" onClick={() => fillBelow(t, b, '上記再来対応')}>下のセルに「上記再来対応」</button>
                                  </>
                                )}
                                <div className="my-1 border-t" />
                                <button type="button" className="block w-full px-3 py-1.5 text-left font-bold hover:bg-brand-light" onClick={() => openChange(t, b)}>キャンセル・予約変更…</button>
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
        </>
      )}

      <h2 className="mt-4 flex items-center gap-2 text-base font-bold">キャンセル・変更名簿 <span className="text-xs font-normal text-slate-500">この日にキャンセル・予約変更になった予約。セルからは外れているので枠は空いています。</span></h2>
      <div className="mt-1 overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-left text-xs"><th className="px-2 py-1">時刻</th><th className="px-2 py-1">ベッド</th><th className="px-2 py-1">氏名</th><th className="px-2 py-1">区分</th><th className="px-2 py-1">種別</th><th className="px-2 py-1">登録</th><th className="px-2 py-1">次回予約</th><th className="px-2 py-1">メモ</th><th className="no-print"></th></tr></thead>
          <tbody>
            {data.cancels.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-2 py-1 font-mono">{minToHm(c.time)}</td>
                <td className="px-2 py-1 text-center">{c.bed}</td>
                <td className="px-2 py-1">{c.name}</td>
                <td className="px-2 py-1"><span className={`rounded px-1.5 text-xs ${CANCEL_KIND_CLASS[c.kind] ?? ''}`}>{CANCEL_KIND_JA[c.kind] ?? c.kind}</span></td>
                <td className="px-2 py-1 text-xs">{c.source === 'WEB' ? 'WEB予約' : '電話・窓口'}</td>
                <td className="px-2 py-1 text-xs text-slate-500">{c.createdAt} {c.byCode}</td>
                <td className="whitespace-nowrap px-2 py-1">{c.kind === 'CHANGE'
                  ? (c.nextDate && c.nextDate !== data.date ? <button type="button" className="text-xs text-violet-800 underline" onClick={() => navigate(`/admin/day/${c.nextDate}`)}>→ {changeTargetText(c.nextDate, c.nextTime)}</button> : <span className="text-xs text-violet-800">→ {changeTargetText(c.nextDate, c.nextTime)}</span>)
                  : <NextDateInput key={c.id + (c.nextDate ?? '')} id={c.id} value={c.nextDate} />}</td>
                <td className="px-2 py-1"><input defaultValue={c.memo ?? ''} onBlur={(e) => e.target.value !== (c.memo ?? '') && saveMemo(c.id, e.target.value)} placeholder="メモ" className="w-full rounded border px-1 text-xs" /></td>
                <td className="no-print px-2 py-1 text-right">{c.kind !== 'CHANGE' && <button type="button" onClick={() => restore(c.id)} className="text-xs text-brand underline">予約表に戻す</button>}</td>
              </tr>
            ))}
            {data.cancels.length === 0 && <tr><td colSpan={9} className="px-2 py-2 text-xs text-slate-400">キャンセル・変更はありません</td></tr>}
          </tbody>
        </table>
      </div>

      {changeDlg && <ChangeDialog from={changeDlg} onClose={() => setChangeDlg(null)} onMoved={moved} onCancelled={cancelled} />}
      {moveMsg && (
        <div className="no-print fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {moveMsg.text}
          {moveMsg.date !== data.date && <button type="button" onClick={() => { setMoveMsg(null); navigate(`/admin/day/${moveMsg.date}`); }} className="rounded bg-white/20 px-2 py-0.5 underline">変更先の日を開く</button>}
          <button type="button" onClick={() => setMoveMsg(null)} aria-label="閉じる" className="text-white/70">✕</button>
        </div>
      )}

      <CellLogPanel date={data.date} isEmpty={(time, bed) => !(cells.get(key(time, bed)) ?? '').trim()} onRestore={(time, bed, text) => { setCellsTracked([{ time, bed, text }]); setPasteInfo(`${minToHm(time)} ベッド${bed} に「${text}」を戻しました`); }} />

      <div className="mt-3">
        <label className="block text-sm text-slate-600">メモ（電話・とびこみ など）
          <textarea defaultValue={day.memo} onBlur={(e) => e.target.value !== day.memo && updateDay({ memo: e.target.value })} rows={3} className="mt-1 w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>
      <p className="no-print mt-2 text-xs text-slate-500">
        セルに氏名を入力すると自動保存されます。Excel／スプレッドシートからの貼り付けは、<b>時間の列を含めて</b>（例：B7:L36）コピーし、9:00 のベッド1 のセルで Ctrl+V。
        時刻で行を合わせ、結合セル（2列で1ベッド）は自動で1列にまとめます。矢印キー／Enter／Tab で移動。
        氏名の左の □ で来院チェック、右の「⋯」でキャンセル・予約変更や削除。Shift＋クリック（または Shift＋矢印）で複数のセルを選んで Ctrl+C／Ctrl+X／Delete、貼り付けは左上のセルで Ctrl+V。間違えたら「↶ 元に戻す」（Ctrl+Z）。初診の 2 枠目「上記初診対応」、再来の「上記再来対応」は 1 枠目と同じ色になり、人数には数えません。初診・再来は「山田 初診」「山田 再来」のように括弧なしでも数えます（「初」「再」1文字のときは「（初）」「（再）」と括弧が必要）。内訳の「自賠」は、セルに「自賠」または「事故」と入力すると数えます（例：山田 自賠）。
        黄色の時間（12:00 / 19:30 など）は管理側だけの枠で、顧客は予約できません。
      </p>
    </div>
  );
}
