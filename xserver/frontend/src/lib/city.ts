// 住所から市・町・村を取り出す（店舗えらびページの絞り込み用）。
// 静岡県静岡市葵区… → 静岡市、浜松市中央区… → 浜松市、駿東郡長泉町… → 長泉町、富士市… → 富士市
export function cityOf(address: string): string {
  // 頭の郵便番号（〒418-0047 など）と、都道府県までを外す
  const s = address.normalize('NFKC').replace(/\s/g, '').replace(/^〒?\d{3}-?\d{4}/, '').replace(/^.*?(東京都|北海道|京都府|大阪府|.{2,3}県)/, '');
  const gun = s.match(/^.+?郡(.+?[町村])/);
  if (gun) return gun[1];
  const city = s.match(/^.+?市/);
  if (city) return city[0];
  const town = s.match(/^.+?[町村]/);
  return town ? town[0] : '';
}
