// Excel / Google スプレッドシートからの貼り付けテキストを予約表の形に整える（純粋関数）
import { hmToMin } from './time';

/** タブ区切りテキストを 2 次元配列に。Google スプレッドシートの "..." で囲まれたセル（改行入り）にも対応 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  // 末尾の空行を除去
  while (rows.length && rows[rows.length - 1].every((v) => v.trim() === '')) rows.pop();
  return rows.map((r) => r.map((v) => v.trim()));
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** "9:00" / "09:00" / "9:00:00" を分に。時刻でなければ null */
export function parseTimeCell(v: string): number | null {
  const m = TIME_RE.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return hmToMin(`${h}:${m[2]}`);
}

export interface PastePlan {
  /** 貼り付け先。row = 予約表の行番号（時刻で揃えた場合）または貼り付け位置からの相対行 */
  cells: { row: number; col: number; text: string }[];
  timeAligned: boolean;   // 先頭列が時刻だったので時刻で行を揃えた
  mergedCollapsed: boolean; // 結合セル（2列で1ベッド）を1列にまとめた
  skippedTimes: string[]; // 予約表に無い時刻（貼り付けなかった行）
}

/**
 * 貼り付けテキストを予約表のセルに割り当てる。
 * - 先頭列が時刻なら、その時刻の行に貼る（12:00 の行があってもずれない）
 * - 全行で 2 列目・4 列目…が空なら Excel の結合セル（2列=1ベッド）とみなして 1 列にまとめる
 * @param gridTimes 予約表の行の時刻（分）
 * @param startRow 貼り付け位置の行番号（時刻列が無い場合の起点）
 */
export function planPaste(text: string, gridTimes: number[], startRow: number): PastePlan {
  let matrix = parseTsv(text);
  const plan: PastePlan = { cells: [], timeAligned: false, mergedCollapsed: false, skippedTimes: [] };
  if (matrix.length === 0) return plan;

  // 1. 時刻列の検出：先頭列が時刻の行が過半数なら時刻で揃える
  const timeVals = matrix.map((r) => parseTimeCell(r[0] ?? ''));
  const timeCount = timeVals.filter((t) => t !== null).length;
  let rowIndex: (number | null)[];
  if (timeCount > 0 && timeCount >= Math.ceil(matrix.filter((r) => r.some((v) => v)).length / 2)) {
    plan.timeAligned = true;
    rowIndex = timeVals.map((t, i) => {
      if (t === null) return null;
      const idx = gridTimes.indexOf(t);
      if (idx < 0) plan.skippedTimes.push(matrix[i][0]);
      return idx < 0 ? null : idx;
    });
    matrix = matrix.map((r) => r.slice(1));
  } else {
    rowIndex = matrix.map((_, i) => startRow + i);
  }

  // 2. 結合セルの検出：奇数番目の列（0 始まりで 1,3,5…）が全行空、かつ偶数列に値がある
  const width = Math.max(...matrix.map((r) => r.length));
  if (width >= 2) {
    const oddAllEmpty = matrix.every((r) => r.every((v, i) => i % 2 === 0 || v === ''));
    const evenHasValue = matrix.some((r) => r.some((v, i) => i % 2 === 0 && v !== ''));
    if (oddAllEmpty && evenHasValue) {
      plan.mergedCollapsed = true;
      matrix = matrix.map((r) => r.filter((_, i) => i % 2 === 0));
    }
  }

  // 3. セルに展開（末尾の空列は貼らない＝既存の入力を消さない）
  matrix.forEach((r, i) => {
    const row = rowIndex[i];
    if (row === null || row === undefined) return;
    let last = r.length - 1;
    while (last >= 0 && r[last] === '') last--;
    for (let c = 0; c <= last; c++) plan.cells.push({ row, col: c, text: r[c] });
  });
  return plan;
}
