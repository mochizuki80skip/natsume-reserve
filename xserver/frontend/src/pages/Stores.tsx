// 紹介カード（ギフトカード）の QR の読み取り先 /stores?from=card
// 店舗えらびページ（全店の一覧・空いている時間帯・近い順）は準備中。それまでは案内だけを出し、管理画面には案内しない
const SKY = '#1eb4ec';

export default function Stores() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-white">
      <div className="flex justify-center px-4 pb-4 pt-5">
        {/* ロゴは元データ（横長の画像）をそのまま使う。なつめ接骨院グループのロゴができたら差し替え */}
        <img src="/brand/hachimaru-skip-yoko.png" alt="HACHIMARU SKIP　80歳になっても、スキップしよう！" width={960} height={264} className="h-auto w-full max-w-[300px]" />
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
