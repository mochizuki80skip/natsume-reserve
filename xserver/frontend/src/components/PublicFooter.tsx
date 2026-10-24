// 患者様の画面（店舗えらび・WEB 予約・ご予約の確認）のいちばん下。プライバシーポリシーを公開しているときだけリンクを出す
import { usePrivacyPublished } from '@/lib/privacy';

export default function PublicFooter() {
  const on = usePrivacyPublished();
  if (!on) return null;
  return (
    <footer className="mt-8 border-t pt-3 text-center text-xs text-slate-500">
      なつめ接骨院グループ　｜　<a href="/privacy" target="_blank" rel="noreferrer" className="text-brand underline">プライバシーポリシー</a>
    </footer>
  );
}

/** 予約の最後のボタンの上に出す一文（ボタンはそのまま） */
export function PrivacyNote() {
  const on = usePrivacyPublished();
  if (!on) return null;
  return (
    <p className="mt-3 text-xs leading-relaxed text-slate-600">
      ご入力いただいた個人情報は、ご予約の管理とご連絡、施術のために使います。くわしくは<a href="/privacy" target="_blank" rel="noreferrer" className="text-brand underline">プライバシーポリシー</a>をご覧ください。
    </p>
  );
}
