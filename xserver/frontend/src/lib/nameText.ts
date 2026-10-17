// 氏名の文字の扱い：敬称（様）を外す・初回カルテで確認したほうがよい氏名を見つける

/**
 * 氏名の後ろの「様」を外す（パソコンの予測変換で「山田太郎様」と入ってしまうため）。
 * 後ろに（初診）などの印が付いていても外す：「山田 太郎様（初診）」→「山田 太郎（初診）」
 */
export function dropHonorific(text: string): string {
  return text.replace(/[\s　]*様(?=[\s　]*(?:[（(][^）)]*[）)][\s　]*)*$)/u, '');
}

export type NameCheck = { kind: 'surname' | 'kana' | 'foreign'; label: string; help: string };

/** 初回カルテの氏名で、確認したほうがよいもの（名字だけ・ひらがなだけ・カタカナだけ）。問題なければ null */
export function nameCheck(name: string): NameCheck | null {
  const t = name.trim();
  if (!t) return null;
  const flat = t.replace(/[\s　]/g, '');
  if (/^[゠-ヿｦ-ﾟ・ー=＝]+$/u.test(flat) || /^[A-Za-zＡ-Ｚａ-ｚ.'\-]+$/u.test(flat)) {
    return { kind: 'foreign', label: '外国の方？', help: 'カタカナ（またはローマ字）だけの氏名です。外国の方ならこのままで「正しい」を押してください。漢字の方なら漢字に直してください。' };
  }
  if (/^[぀-ゟ゠-ヿー]+$/u.test(flat)) {
    return { kind: 'kana', label: 'ひらがなのみ', help: 'ひらがなだけの氏名です。漢字がわかれば直してください。このままで正しければ「正しい」を押してください。' };
  }
  if (!/[\s　]/.test(t) && /^[一-鿿々〆ヶ]{1,3}$/u.test(t)) {
    return { kind: 'surname', label: '名字だけ？', help: '名字だけの可能性があります（スペースがなく 3 文字以内）。下の名前がわかれば足してください。このままで正しければ「正しい」を押してください。' };
  }
  return null;
}
