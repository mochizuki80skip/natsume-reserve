'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DayData } from '@/lib/dayData';
import { addDays, formatDateJa, minToHm } from '@/lib/time';
import { isPatientText } from '@/lib/availability';
import { isAm } from '@/lib/hours';

interface Props { data: DayData; storeName: string; published: boolean; today: string }

const key = (time: number, bed: number) => `${time}:${bed}`;

export default function DayGrid({ data, storeName, published, today }: Props) {
  const router = useRouter();
  const [cells, setCells] = useState<Map<string, string>>(() => new Map(data.cells.map((c) => [key(c.time, c.bed), c.text])));
  const webInfo = useMemo(() => new Map(data.cells.filter((c) => c.web).map((c) => [key(c.time, c.bed), c.web!])), [data.cells]);
  const [day, setDay] = useState(data.day);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  // 列：物理ベッド 1..N（管理側は施術者数に関係なくどのベッドにも入力できる）
  const cols = data.beds;
  const rows = data.times;

  const flush = useCallback(async () => {
    if (dirty.current.size === 0) return;
    const batch = Array.from(dirty.current.entries()).map(([k, text]) => {
      const [time, bed] = k.split(':').map(Number);
      return { time, bed, text };
    });
    dirty.current.clear();
    setSaveState('saving');
    const r = await fetch('/api/admin/cells', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, cells: batch }) });
    setSaveState(r.ok ? 'saved' : 'error');
  }, [data.date]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [flush]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function setCell(time: number, bed: number, text: string) {
    setCells((m) => { const n = new Map(m); n.set(key(time, bed), text); return n; });
    dirty.current.set(key(time, bed), text);
    schedule();
  }

  function focusCell(r: number, c: number) {
    if (r < 0 || r >= rows.length || c < 0 || c >= cols.length) return;
    inputs.current.get(key(rows[r], cols[c]))?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const nav: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] };
    if (e.key in nav) { e.preventDefault(); focusCell(r + nav[e.key][0], c + nav[e.key][1]); return; }
    if (e.key === 'Tab') { e.preventDefault(); const d = e.shiftKey ? -1 : 1; focusCell(r, c + d); return; }
    const el = e.currentTarget;
    if (e.key === 'ArrowLeft' && el.selectionStart === 0 && el.selectionEnd === 0) { e.preventDefault(); focusCell(r, c - 1); }
    if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) { e.preventDefault(); focusCell(r, c + 1); }
  }

  /** Excel からの複数セル貼り付け（タブ区切り・改行区切り） */
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\n') && !text.includes('\t')) return; // 単一セルは通常の貼り付け
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    lines.forEach((line, dr) => {
      line.split('\t').forEach((v, dc) => {
        const rr = r + dr, cc = c + dc;
        if (rr < rows.length && cc < cols.length) setCell(rows[rr], cols[cc], v.trim());
      });
    });
  }

  async function saveCapacity(which: 'capacityAm' | 'capacityPm', raw: string) {
    const v = raw.trim() === '' ? null : Math.max(0, Math.min(20, Number(raw)));
    if (v !== null && Number.isNaN(v)) return;
    await updateDay({ [which]: v } as Partial<typeof day>);
  }
  async function updateDay(patch: Partial<typeof day>) {
    const next = { ...day, ...patch };
    setDay(next);
    await fetch('/api/admin/days', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: data.date, ...patch }) });
    router.refresh();
  }

  function copyAll() {
    const header = ['時間', ...cols.map((b) => `ベッド${b}`)].join('\t');
    const body = rows.map((t) => [minToHm(t), ...cols.map((b) => cells.get(key(t, b)) ?? '')].join('\t')).join('\n');
    navigator.clipboard.writeText(`${header}\n${body}`);
  }

  const counts = useMemo(() => {
    let am = 0, pm = 0;
    for (const [k, v] of cells) {
      if (!isPatientText(v)) continue;
      const time = Number(k.split(':')[0]);
      if (isAm(data.sessions, time)) am++; else pm++;
    }
    return { am, pm, total: am + pm };
  }, [cells, data.sessions]);

  const cap = data.capacity;
  const am = (t: number) => isAm(data.sessions, t);
  const capacityAt = (t: number) => (am(t) ? cap.am : cap.pm);
  const customerSet = useMemo(() => new Set(data.customerTimes), [data.customerTimes]);
  const shiftLabel: Record<string, string> = { WORK: '〇', OFF: '休', AM_OFF: '前休', PM_OFF: '後休', PAID: '有給', AM_PAID: '前有', PM_PAID: '後有' };

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => router.push(`/admin/day/${addDays(data.date, -1)}`)}>‹ 前日</button>
        <input type="date" value={data.date} onChange={(e) => e.target.value && router.push(`/admin/day/${e.target.value}`)} className="rounded border px-2 py-1" />
        <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => router.push(`/admin/day/${addDays(data.date, 1)}`)}>翌日 ›</button>
        <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => router.push(`/admin/day/${today}`)}>今日</button>
        <span className="ml-auto text-xs text-slate-500">
          {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '保存しました' : saveState === 'error' ? '保存に失敗しました' : '入力すると自動保存されます'}
        </span>
        <a href={`/admin/print/${data.date}`} target="_blank" rel="noreferrer" className="rounded bg-brand px-3 py-1 text-white">印刷／PDF</a>
        <button type="button" onClick={copyAll} className="rounded border bg-white px-3 py-1">表をコピー</button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <h1 className="text-2xl font-bold">{formatDateJa(data.date)}</h1>
        <div className="text-sm">午前 <b className="text-lg">{counts.am}</b> 名　午後 <b className="text-lg">{counts.pm}</b> 名　合計 <b className="text-lg">{counts.total}</b> 名</div>
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

      {rows.length === 0 ? (
        <p className="rounded border bg-white p-4 text-sm text-slate-600">この日は休診日（定休日・祝日・臨時休診）のため予約表はありません。営業する場合は「臨時休診」を外すか、店舗設定の営業時間を確認してください。</p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100">
                <th className="w-16 border px-1 py-1">時間</th>
                {cols.map((b) => (
                  <th key={b} className={`border px-1 py-1 ${b > Math.max(cap.am, cap.pm) ? 'bg-slate-100 text-slate-500' : ''}`}>
                    ベッド{b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, r) => {
                const isPmStart = r > 0 && am(rows[r - 1]) && !am(t);
                const adminOnly = !customerSet.has(t);
                return (
                  <tr key={t} className={`${isPmStart ? 'border-t-4 border-t-slate-300' : ''}`}>
                    <td className={`border px-1 text-center font-mono ${adminOnly ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'}`} title={adminOnly ? '管理側のみの枠（顧客は予約できません）' : undefined}>{minToHm(t)}</td>
                    {cols.map((b, c) => {
                      const k = key(t, b);
                      const web = webInfo.get(k);
                      return (
                        <td key={b} className={`grid-cell border p-0 ${b > capacityAt(t) ? 'bg-slate-50' : ''} ${adminOnly ? 'bg-amber-50/40' : ''} ${web ? 'bg-sky-50' : ''}`}
                          title={web ? `WEB予約（${web.kind === 'NEW' ? '初回' : '通院中'}）${web.cardNo ? ` 診察券:${web.cardNo}` : ''} TEL:${web.phone}` : undefined}>
                          <input
                            ref={(el) => { if (el) inputs.current.set(k, el); else inputs.current.delete(k); }}
                            value={cells.get(k) ?? ''}
                            onChange={(e) => setCell(t, b, e.target.value)}
                            onKeyDown={(e) => onKeyDown(e, r, c)}
                            onPaste={(e) => onPaste(e, r, c)}
                            onBlur={flush}
                          />
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

      <div className="mt-3">
        <label className="block text-sm text-slate-600">メモ（電話・とびこみ など）
          <textarea defaultValue={day.memo} onBlur={(e) => e.target.value !== day.memo && updateDay({ memo: e.target.value })} rows={3} className="mt-1 w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>
      <p className="no-print mt-2 text-xs text-slate-500">
        セルに氏名を入力すると自動保存されます。Excel からコピーした複数セルをそのまま貼り付けできます。矢印キー／Enter／Tab で移動。
        薄い青のセルは WEB 予約（カーソルを合わせると電話番号を表示）。初回の 2 枠目は「〃」。「〃」「✖」は人数に数えません。
        施術者数を超える列（灰色）にも入力できますが、顧客には施術者数ぶんの枠しか空きとして見えません。
        黄色の時間（12:00 / 19:30 など）は管理側だけの枠で、顧客は予約できません（初回30分の2枠目としては使われます）。
      </p>
    </div>
  );
}
