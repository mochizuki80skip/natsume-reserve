// レセコンの患者一覧 CSV から「診察券番号・氏名・フリガナ」だけを取り出す（純粋関数）。
// 住所・電話番号・生年月日などは読み捨てる（サーバーには送らない）。
// 9 月分の形：フリガナ（半角カナ）, 氏名, 郵便番号, 住所1, 住所2, 生年月日, 電話, 性別, 診察券番号（6 桁＋末尾 空白／x 自費／a 自賠／r 労災）

export interface PatientRow { no: string; name: string; kana: string }

/** CSV の 1 行を項目に分ける（"..." で囲まれた項目にも対応） */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const NO_RE = /^\s*0*(\d{1,10})\s*[A-Za-z]?\s*$/;

/** 診察券番号をそろえる（頭の 0・末尾の印を取る） */
export function normalizeCardNo(v: string): string | null {
  const m = NO_RE.exec(v);
  if (!m) return null;
  return String(Number(m[1]));
}

export function parsePatientCsv(text: string): { rows: PatientRow[]; skipped: number } {
  const rows: PatientRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    // 診察券番号：9 列目。列の数が違うときは、後ろから番号らしい項目を探す
    let noCell = f.length >= 9 ? f[8] : '';
    if (normalizeCardNo(noCell) === null) noCell = [...f].reverse().find((x) => normalizeCardNo(x) !== null && x.trim().length <= 12) ?? '';
    const no = normalizeCardNo(noCell);
    const name = (f[1] ?? '').replace(/[\s　]+/g, ' ').trim();
    if (!no || !name) { skipped++; continue; }
    if (seen.has(no)) continue; // 同じ番号（自費・自賠・労災の別の行）は最初の行だけ
    seen.add(no);
    rows.push({ no, name, kana: (f[0] ?? '').trim() });
  }
  return { rows, skipped };
}
