// この端末（ブラウザ）で WEB 予約した予約の「確認ページの合言葉」を覚えておく（予約ページの「ご予約の確認」で一覧にする）
// サーバーには何も足さない。中身（日時・店舗）は毎回、確認ページと同じしくみでサーバーに聞く
const KEY = 'natsume.myReservations';
export interface MyReservation { token: string; date: string }

export function loadMyReservations(today?: string): MyReservation[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(v)) return [];
    const list = v.filter((x) => x && /^[0-9a-f]{32}$/.test(x.token) && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
    // 予約日の翌日を過ぎたものは見られないので捨てる（日付は予約したときのもの。店舗で日を動かしたら確認ページの答えで判断する）
    return today ? list.filter((x) => x.date >= addDaysIso(today, -30)) : list;
  } catch { return []; }
}

export function addMyReservation(r: MyReservation): void {
  try {
    const list = loadMyReservations().filter((x) => x.token !== r.token);
    list.push(r);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-30)));
  } catch { /* 保存できない端末では何もしない */ }
}

export function removeMyReservations(tokens: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(loadMyReservations().filter((x) => !tokens.includes(x.token)))); } catch { /* 同上 */ }
}

function addDaysIso(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
