// 表示・比較用の小さな整形関数（純粋関数）

/** +81901234xxxx / 09012345678 → 090-1234-xxxx（整形できない場合はそのまま返す） */
export function formatJpPhone(p: string | null | undefined): string {
  const raw = (p ?? '').trim();
  const d = raw.startsWith('+81') ? `0${raw.slice(3)}` : raw;
  if (/^0\d{10}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^0\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

/** 氏名の比較用に、全角・半角の空白をすべて取り除き、英数字を半角にそろえる */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? '')
    .replace(/[\s　]+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 同一人物とみなす氏名か（空白の有無・全角半角の違いは無視） */
export function isSameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeName(a), y = normalizeName(b);
  return x.length > 0 && x === y;
}
