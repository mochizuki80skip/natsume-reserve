'use client';
// スクショの大きさの案内（現場向け）。ピクセルではなく「画面の縦の何割」と絵で示す
import { useEffect, useState } from 'react';
import { requiredScreenFraction, wari } from '@/lib/jibai';

function Monitor({ ok, label, win, inv }: { ok: boolean; label: string; win: { x: number; w: number }; inv: { h: number } }) {
  // 画面 80×50。win＝レセコンのウィンドウの位置と幅、inv.h＝請求書の縦の長さ（画面の縦に対する割合）
  const ih = 44 * inv.h, iw = ih / 1.43;
  const ix = win.x + (win.w - iw) / 2, iy = 3 + (44 - ih) / 2;
  return (
    <figure className="flex flex-col items-center gap-0.5">
      <svg viewBox="0 0 80 62" width="96" height="74" role="img" aria-label={label}>
        <rect x="1" y="1" width="78" height="48" rx="2" fill="#f1f5f9" stroke="#64748b" strokeWidth="1.5" />
        <rect x={win.x} y="3" width={win.w} height="44" fill="#fff" stroke="#cbd5e1" strokeWidth="0.8" />
        <rect x={ix} y={iy} width={iw} height={ih} fill="#fff" stroke={ok ? '#1f6f8b' : '#b91c1c'} strokeWidth="1.2" />
        {Array.from({ length: 5 }, (_, i) => <line key={i} x1={ix + iw * 0.12} x2={ix + iw * 0.88} y1={iy + ih * (0.18 + i * 0.16)} y2={iy + ih * (0.18 + i * 0.16)} stroke="#94a3b8" strokeWidth="0.6" />)}
        <rect x="34" y="50" width="12" height="4" fill="#64748b" /><rect x="26" y="54" width="28" height="3" rx="1" fill="#64748b" />
      </svg>
      <figcaption className={`text-[11px] font-bold ${ok ? 'text-brand-dark' : 'text-red-700'}`}>{ok ? '○' : '×'} {label}</figcaption>
    </figure>
  );
}

export default function JibaiSizeGuide() {
  // 画面の大きさはブラウザでしか分からないので、表示後に計算する
  const [need, setNeed] = useState<number | null>(null);
  useEffect(() => { setNeed(requiredScreenFraction()); }, []);
  const needText = need === null ? '8割' : wari(need);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 rounded bg-slate-50 px-3 py-2">
      <div className="flex gap-2">
        <Monitor ok label="全画面" win={{ x: 3, w: 74 }} inv={{ h: 0.95 }} />
        <Monitor ok label="左右半分でも可" win={{ x: 3, w: 37 }} inv={{ h: 0.95 }} />
        <Monitor ok={false} label="小さい" win={{ x: 3, w: 37 }} inv={{ h: 0.45 }} />
      </div>
      <div className="min-w-[240px] flex-1 text-xs leading-relaxed text-slate-700">
        <p className="font-bold text-slate-800">きれいに読むコツ（撮る大きさ）</p>
        {need !== null && need > 1
          ? <p>・請求書の<b>縦の長さが画面の上から下までいっぱい</b>になるように大きく表示して撮ってください。</p>
          : <p>・請求書の<b>縦の長さが画面の縦の {needText} 以上</b>になるように大きく表示して撮ってください。プレビューを「ページ全体」表示にして、請求書が画面の上から下までいっぱいになっていれば十分です。</p>}
        <p>・レセコンのウィンドウは<b>全画面でも、左右半分でも</b>構いません。画面全体を撮っても、請求書の部分だけを囲んで撮っても読めます。</p>
        <p>・上の「令和 ○年 ○月」から下の「合計」まで、請求書全体を入れてください。</p>
        {need !== null && need > 1 && <p className="mt-1 font-bold text-red-700">このパソコンの画面は小さいため、請求書を画面いっぱいに表示しても読み取りを誤ることがあります。読み取り結果を画像と見比べて、必ず確認してください。</p>}
      </div>
    </div>
  );
}
