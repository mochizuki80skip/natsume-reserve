// 予約・来院ログの CSV / Excel 書き出し（画面と同じ絞り込み条件。最大 5,000 件）
import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { apiContext } from '@/lib/admin';
import { formatJpPhone } from '@/lib/format';
import { findCancels, findReservations, KIND_JA, parseLogFilter, STATUS_JA } from '@/lib/reservationLog';
import { minToHm, nowJst } from '@/lib/time';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 5000;

export async function GET(req: Request) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const f = parseLogFilter(sp);
  const format = sp.format === 'xlsx' ? 'xlsx' : 'csv';
  const fmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  let header: string[];
  let rows: (string | number)[][];
  if (f.tab === 'cancel') {
    const list = await findCancels(ctx.store, f, MAX_ROWS);
    header = ['予約日', '時刻', 'ベッド', '氏名', '区分', '種別', '登録日時', '登録者', '次回予約', 'メモ'];
    rows = list.map((c) => [c.date, minToHm(c.time), c.bed, c.name, c.kind === 'ADVANCE' ? '事前連絡' : '無断', c.source === 'WEB' ? 'WEB予約' : '電話・窓口', fmt.format(c.createdAt), c.byCode, c.nextDate ?? '', c.memo ?? '']);
  } else {
    const list = await findReservations(ctx.store, f, MAX_ROWS);
    header = ['受付日時', '予約日', '時刻', 'ベッド', '区分', '氏名', '診察券番号', '電話番号', '状態'];
    rows = list.map((r) => [fmt.format(r.createdAt), r.date, minToHm(r.time), r.bed, KIND_JA[r.kind] ?? r.kind, r.name, r.cardNo ?? '', formatJpPhone(r.phone), STATUS_JA[r.status] ?? r.status]);
  }
  const base = `${ctx.store.code}_${f.tab === 'cancel' ? 'cancel' : 'web'}_${f.from}_${f.to}`;
  const disposition = (ext: string) => `attachment; filename="${base}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${ctx.store.name}_${f.tab === 'cancel' ? 'キャンセル名簿' : 'WEB予約一覧'}_${f.from}_${f.to}.${ext}`)}`;

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    const ws = wb.addWorksheet(f.tab === 'cancel' ? 'キャンセル名簿' : 'WEB予約一覧');
    ws.addRow([`${ctx.store.name}　${f.tab === 'cancel' ? 'キャンセル名簿' : 'WEB予約一覧'}　${f.from} 〜 ${f.to}　（出力 ${nowJst().date}）`]);
    const h = ws.addRow(header);
    h.font = { bold: true };
    h.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F2F6' } }; });
    for (const r of rows) ws.addRow(r);
    ws.columns.forEach((col, i) => { col.width = Math.max(10, Math.min(40, (header[i]?.length ?? 8) * 2 + 4)); });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': disposition('xlsx'), 'Cache-Control': 'no-store' },
    });
  }
  // CSV：Excel で文字化けしないよう UTF-8 BOM 付き
  const esc = (v: string | number) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': disposition('csv'), 'Cache-Control': 'no-store' },
  });
}
