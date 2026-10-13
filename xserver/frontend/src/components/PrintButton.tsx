import { APP_VERSION } from '@/version';

export default function PrintButton() {
  return (
    <div className="no-print mb-3 flex gap-2">
      <button type="button" onClick={() => window.print()} className="rounded bg-brand px-3 py-1 text-sm text-white">印刷／PDFに保存</button>
      <span className="text-xs text-slate-500">印刷ダイアログで「PDFに保存」を選ぶと、色付きの PDF になります（A4 縦）。紙に印刷するときは「カラー」を選んでください。</span>
      <span className="ml-auto text-[10px] text-slate-400">画面の版 {APP_VERSION}</span>
    </div>
  );
}
