// 店舗ごとの色（店舗コードから決まる。一覧やメニューの丸印に使う）
const PALETTE = ['#c0703a', '#1f6f8b', '#6b8e23', '#8e44ad', '#c2185b', '#0e7c7b', '#b8860b', '#d2691e', '#2e6fb8', '#5d7b2a', '#9c3f8f', '#a0522d'];

export function storeColor(code: string): string {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function StoreDot({ code, className = '' }: { code: string | null | undefined; className?: string }) {
  if (!code) return null;
  return <span className={`inline-block h-2.5 w-2.5 rounded-full align-middle ${className}`} style={{ background: storeColor(code) }} aria-hidden="true" />;
}
