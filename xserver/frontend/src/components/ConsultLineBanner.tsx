// 交通事故の相談 LINE へのバナー（店舗えらびの上・予約ページのいちばん下）。URL は本部が決める（全店共通）
export default function ConsultLineBanner({ url, className = '' }: { url: string; className?: string }) {
  if (!/^https:\/\//.test(url)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" aria-label="交通事故のご相談はLINEで（LINE が開きます）"
      className={`flex items-center gap-2.5 rounded-xl bg-[#06c755] px-3 py-2 text-white no-underline shadow-sm active:opacity-90 ${className}`}>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white text-[10px] font-black text-[#06c755]" aria-hidden>LINE</span>
      <b className="min-w-0 flex-1 truncate whitespace-nowrap text-[15px]">交通事故のご相談はLINEで</b>
      <span className="flex-none text-xl leading-none" aria-hidden>›</span>
    </a>
  );
}
