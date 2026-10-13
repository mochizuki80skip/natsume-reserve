// 紹介カード（ギフトカード）の QR の読み取り先 /stores?from=card
// 店舗えらびページ（全店の一覧・空いている時間帯・近い順）は準備中。それまでは案内だけを出し、管理画面には案内しない
const SKY = '#1eb4ec';

function Mark() {
  return (
    <svg width="46" height="46" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="30" cy="27" r="19" fill="none" stroke={SKY} strokeWidth="10" />
      <circle cx="30" cy="73" r="19" fill="none" stroke={SKY} strokeWidth="10" />
      <circle cx="73" cy="50" r="19" fill="none" stroke={SKY} strokeWidth="10" />
    </svg>
  );
}

export default function Stores() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-white">
      <div className="flex items-center gap-3 px-4 pb-3 pt-5">
        <Mark />
        <div>
          <div className="text-[11px] tracking-[0.18em] text-[#9b9b9b]">80歳になっても、スキップしよう！</div>
          <div className="text-lg font-bold tracking-[0.16em] text-[#9b9b9b]">HACHIMARU SKIP</div>
        </div>
      </div>
      <div className="px-4 py-4 text-white" style={{ background: SKY }}>
        <h1 className="text-xl font-bold">店舗のご案内</h1>
        <p className="mt-1 text-sm">ご来院ありがとうございます。</p>
      </div>
      <div className="space-y-3 px-4 py-6 text-sm leading-relaxed text-slate-700">
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-base font-bold text-sky-900">店舗一覧のページは、ただいま準備中です。</p>
        <p>まもなく、こちらから全店舗の一覧・空いている時間帯をご覧いただき、WEB でご予約いただけるようになります。</p>
        <p>それまでは、お近くの店舗へお電話でご予約ください。</p>
      </div>
    </main>
  );
}
