// 住所から市・町・村を取り出す（店舗えらびページの絞り込み用）。
// 静岡県静岡市葵区… → 静岡市、浜松市中央区… → 浜松市、駿東郡長泉町… → 長泉町、富士市… → 富士市
export function cityOf(address: string): string {
  const s = address.normalize('NFKC').replace(/\s/g, '').replace(/^.{2,3}?[都道府県]/, '');
  const gun = s.match(/^.+?郡(.+?[町村])/);
  if (gun) return gun[1];
  const city = s.match(/^.+?市/);
  if (city) return city[0];
  const town = s.match(/^.+?[町村]/);
  return town ? town[0] : '';
}
