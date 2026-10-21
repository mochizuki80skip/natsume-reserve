// URL を文字・QR コードで出し、コピーと QR 画像の保存（PNG）ができるカード（店舗設定・本部の店舗一覧で使う）
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * QR コードの画像（PNG）を blob: の URL で作る。data: の URL だと、ブラウザによっては「保存」したときのファイル名が
 * 付かない（download などになる）ため
 */
export function useQrBlobUrl(text: string): string {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    let made = '';
    QRCode.toDataURL(text, { width: 800, margin: 2, errorCorrectionLevel: 'M' })
      .then((d) => fetch(d)).then((r) => r.blob())
      .then((b) => { if (!alive) return; made = URL.createObjectURL(b); setSrc(made); })
      .catch(() => alive && setSrc(''));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [text]);
  return src;
}

export default function UrlQrCard({ label, help, url, fileName }: { label: string; help: string; url: string; fileName: string }) {
  const src = useQrBlobUrl(url);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border bg-white p-3">
      {src && <img src={src} alt={`${label}の QR コード`} width={104} height={104} className="flex-none rounded border" />}
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="font-bold">{label}</div>
        <div className="text-xs text-slate-500">{help}</div>
        <code className="block break-all rounded bg-slate-50 px-2 py-0.5 text-xs">{url}</code>
        <div className="flex flex-wrap gap-2 pt-1">
          {src && <a href={src} download={`${fileName}.png`} className="rounded bg-brand px-3 py-1 text-xs font-bold text-white no-underline">QR 画像を保存</a>}
          <button type="button" onClick={() => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})} className="rounded border px-3 py-1 text-xs">{copied ? 'コピーしました' : 'URL をコピー'}</button>
          <a href={url} target="_blank" rel="noreferrer" className="rounded border px-3 py-1 text-xs no-underline">開く↗</a>
        </div>
      </div>
    </div>
  );
}

/** 店舗の顧客 URL・管理 URL の 2 枚 */
export function StoreUrlCards({ code, name }: { code: string; name: string }) {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <UrlQrCard label="顧客URL（WEB 予約）" help="患者様が WEB 予約するページ。ポスター・名刺・LINE などに" url={`${origin}/s/${code}`} fileName={`QR_${name}_顧客URL`} />
      <UrlQrCard label="管理URL（店舗のログイン）" help="スタッフが予約表を開くページ。スタッフ用のタブレットなどに" url={`${origin}/admin/login/${code}`} fileName={`QR_${name}_管理URL`} />
    </div>
  );
}
