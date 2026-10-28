// 予約表で、同じ日に同じお名前の方が 2 か所以上に入っているか（重複の注意）（純粋関数）
import { isContinuationText } from './attendance';
import { isPatientText } from './availability';
import { dropHonorific } from './nameText';

/** セルの文字からお名前だけを取り出して比べられる形に（（初診）などの印・様・電話番号・空白を外す）。お名前でなければ '' */
export function patientKey(text: string | null | undefined): string {
  const t = (text ?? '').trim();
  if (!t || isContinuationText(t) || !isPatientText(t)) return '';
  let s = dropHonorific(t);
  s = s.replace(/[（(][^）)]*[）)]/g, ' ');
  s = s.replace(/(初診|初自|新自|新三|再来|再診)/g, ' ');
  s = s.replace(/[0-9０-９\-－ー‐]{6,}/g, ' '); // 電話番号
  s = s.replace(/[\s　]+/g, '');
  s = s.normalize('NFKC').toLowerCase();
  return s.length >= 2 ? s : ''; // 1 文字（「見」など）は名前か分からないので比べない
}

export interface DupGroup { key: string; name: string; places: { time: number; bed: number }[] }

/** cells：「time:bed」→ セルの文字。2 か所以上に入っているお名前の一覧 */
export function findDuplicates(cells: Map<string, string>): DupGroup[] {
  const by = new Map<string, DupGroup>();
  for (const [k, text] of cells) {
    const pk = patientKey(text);
    if (!pk) continue;
    const [time, bed] = k.split(':').map(Number);
    const g = by.get(pk) ?? { key: pk, name: dropHonorific(text.trim()).replace(/\s*[（(][^）)]*[）)]\s*$/, ''), places: [] };
    g.places.push({ time, bed });
    by.set(pk, g);
  }
  return [...by.values()].filter((g) => g.places.length >= 2).map((g) => ({ ...g, places: g.places.sort((a, b) => a.time - b.time || a.bed - b.bed) }));
}
