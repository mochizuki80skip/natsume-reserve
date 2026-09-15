'use client';
export default function PrintButton() {
  return (
    <div className="no-print mb-3 flex gap-2">
      <button type="button" onClick={() => window.print()} className="rounded bg-brand px-3 py-1 text-sm text-white">印刷／PDFに保存</button>
      <span className="text-xs text-slate-500">印刷ダイアログで「PDFに保存」を選ぶと PDF になります（A4 縦）。</span>
    </div>
  );
}
