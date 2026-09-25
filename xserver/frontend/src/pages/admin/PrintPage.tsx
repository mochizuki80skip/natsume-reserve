// A4 縦 1 枚に収める印刷用ページ（/admin/print/<日付>）
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { formatDateJa, formatDateShort, isValidDate, minToHm } from '@/lib/time';
import { isPatientText } from '@/lib/availability';
import { isAm } from '@/lib/hours';
import { categorizeCell, isContinuationText } from '@/lib/attendance';
import type { DayResponse } from '@/lib/types';
import PrintButton from '@/components/PrintButton';

export default function PrintPage() {
  const { date = '' } = useParams();
  const navigate = useNavigate();
  const valid = isValidDate(date);
  const { data, error } = useFetch<DayResponse>(valid ? `/api/admin/day?date=${date}` : null);
  useEffect(() => { if (error?.status === 401) navigate('/admin/login', { replace: true }); }, [error, navigate]);
  if (!valid) return <p className="p-4 text-sm text-red-700">日付が正しくありません。</p>;
  if (error) return <p className="p-4 text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="p-4 text-sm text-slate-500">読み込み中…</p>;
  const d = data.data;
  const cell = new Map(d.cells.map((c) => [`${c.time}:${c.bed}`, c]));
  const cnt = { rAm: 0, rPm: 0, vAm: 0, vPm: 0, nAm: 0, nPm: 0, reAm: 0, rePm: 0, jAm: 0, jPm: 0 };
  for (const c of d.cells) {
    if (!isPatientText(c.text)) continue;
    const a = isAm(d.sessions, c.time);
    if (a) cnt.rAm++; else cnt.rPm++;
    if (c.visited) { if (a) cnt.vAm++; else cnt.vPm++; }
    const cat = categorizeCell(c.text);
    if (cat.isNew) { if (a) cnt.nAm++; else cnt.nPm++; }
    if (cat.isRevisit) { if (a) cnt.reAm++; else cnt.rePm++; }
    if (cat.isJibai) { if (a) cnt.jAm++; else cnt.jPm++; }
  }
  const cols = d.beds;
  const names = (n: string[]) => (n.length ? n.join('・') : '－');
  const visitedOf = (t: number, b: number) => {
    const c = cell.get(`${t}:${b}`);
    if (!c) return false;
    if (isContinuationText(c.text)) return cell.get(`${t - d.slotMinutes}:${b}`)?.visited ?? false;
    return c.visited;
  };
  // 行の高さ：A4 縦（有効 約 277mm）に 32 行＋見出し＋名簿を収める
  const rowMm = d.times.length > 30 ? 4.6 : 5.2;

  return (
    <main className="mx-auto max-w-[194mm] bg-white p-3 text-[10px] leading-tight print:p-0">
      <PrintButton />
      <div className="mb-1 flex items-end justify-between">
        <h1 className="text-base font-bold">《予約表》 {data.storeName}　{formatDateJa(date)}</h1>
        <div className="text-right text-[11px]">
          <div>予約 午前 <b>{cnt.rAm}</b>／午後 <b>{cnt.rPm}</b>／計 <b>{cnt.rAm + cnt.rPm}</b>　来院 午前 <b>{cnt.vAm}</b>／午後 <b>{cnt.vPm}</b>／計 <b>{cnt.vAm + cnt.vPm}</b></div>
          <div className="text-[10px]">初診 <b>{cnt.nAm}</b>／<b>{cnt.nPm}</b>／計 <b>{cnt.nAm + cnt.nPm}</b>　再来 <b>{cnt.reAm}</b>／<b>{cnt.rePm}</b>／計 <b>{cnt.reAm + cnt.rePm}</b>　自賠 <b>{cnt.jAm}</b>／<b>{cnt.jPm}</b>／計 <b>{cnt.jAm + cnt.jPm}</b></div>
        </div>
      </div>
      <div className="mb-1 flex flex-wrap gap-x-4 text-[9px] text-slate-700">
        <span>午前：{names(d.capacity.namesAm)}（{d.capacity.am} 枠）</span>
        <span>午後：{names(d.capacity.namesPm)}（{d.capacity.pm} 枠）</span>
        <span>受付：{names(d.receptionNames)}</span>
        <span>✓＝来院　網掛け＝予約サイト非表示／管理側のみの枠</span>
      </div>
      {d.times.length === 0 ? <p>休診日</p> : (
        <table className="w-full table-fixed border-collapse">
          <thead>
            {(() => {
              const lo = Math.min(d.capacity.am, d.capacity.pm), hi = Math.max(d.capacity.am, d.capacity.pm), n = cols.length;
              const g: { span: number; label: string }[] = [];
              if (lo > 0) g.push({ span: Math.min(lo, n), label: '予約サイトに表示' });
              if (hi > lo && lo < n) g.push({ span: Math.min(hi, n) - lo, label: d.capacity.am > d.capacity.pm ? '午前のみ表示' : '午後のみ表示' });
              if (hi < n) g.push({ span: n - hi, label: '非表示（管理側のみ）' });
              return (
                <tr className="text-[8px]">
                  <th className="border border-black" />
                  {g.map((x, i) => <th key={i} colSpan={x.span} className="border border-black px-1 font-normal">{x.label}</th>)}
                </tr>
              );
            })()}
            <tr>
              <th className="w-11 border border-black px-0.5">時間</th>
              {cols.map((b) => <th key={b} className={`border border-black px-0.5 ${b > Math.max(d.capacity.am, d.capacity.pm) ? 'bg-slate-200' : ''}`}>{b}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.times.map((t, r) => (
              <tr key={t} className={r > 0 && isAm(d.sessions, d.times[r - 1]) && !isAm(d.sessions, t) ? 'border-t-2 border-t-black' : ''} style={{ height: `${rowMm}mm` }}>
                <td className={`border border-black px-0.5 text-center font-mono ${d.customerTimes.includes(t) ? '' : 'bg-slate-100'}`}>{minToHm(t)}</td>
                {cols.map((b) => {
                  const c = cell.get(`${t}:${b}`);
                  const v = visitedOf(t, b);
                  return (
                    <td key={b} className={`overflow-hidden whitespace-nowrap border border-black px-0.5 ${b > (isAm(d.sessions, t) ? d.capacity.am : d.capacity.pm) ? 'bg-slate-100' : ''}`}>
                      {v && c && !isContinuationText(c.text) ? <span className="mr-0.5 font-bold">✓</span> : null}{c?.text ?? ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-1 flex gap-2">
        <div className="flex-1">
          <div className="text-[9px] font-bold">キャンセル名簿</div>
          {d.cancels.length === 0 ? <div className="border border-black px-1 py-0.5 text-[9px] text-slate-500">なし</div> : (
            <table className="w-full border-collapse text-[9px]">
              <thead><tr><th className="border border-black px-1 text-left">時刻</th><th className="border border-black px-1">ベッド</th><th className="border border-black px-1 text-left">氏名</th><th className="border border-black px-1">区分</th><th className="border border-black px-1">種別</th><th className="border border-black px-1">次回予約</th><th className="border border-black px-1 text-left">メモ</th></tr></thead>
              <tbody>
                {d.cancels.map((c) => (
                  <tr key={c.id}><td className="border border-black px-1 font-mono">{minToHm(c.time)}</td><td className="border border-black px-1 text-center">{c.bed}</td><td className="border border-black px-1">{c.name}</td><td className="border border-black px-1 text-center">{c.kind === 'ADVANCE' ? '事前連絡' : '無断'}</td><td className="border border-black px-1 text-center">{c.source === 'WEB' ? 'WEB' : '電話'}</td><td className="border border-black px-1 text-center">{c.nextDate ? formatDateShort(c.nextDate) : ''}</td><td className="border border-black px-1">{c.memo ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {d.day.memo && <div className="w-[60mm] border border-black p-1 text-[9px] whitespace-pre-wrap"><b>メモ：</b>{d.day.memo}</div>}
      </div>
    </main>
  );
}
