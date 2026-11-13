// 自賠請求：レセコン（THE 柔 PLUS）でスクショを撮る手順と、このシステムでの読み取り・提出の手順をフローで出す（全店共通・固定）。
// 画像は public/guide/jibai-flow-N.png（レセコンの画像は依頼者から受け取ったもの。無ければ文字だけ出す）。閉じたことはこの端末で覚える
import { useState } from 'react';

export const JIBAI_DEADLINE = '毎月 5 日まで（基本は月末の作業のときに提出）';

interface Step { n: number; title: string; text: React.ReactNode }
const Key = ({ k }: { k: string }) => <kbd className="rounded border border-slate-500 bg-white px-1 font-sans text-[11px] font-bold">{k}</kbd>;

const RECECON: Step[] = [
  { n: 1, title: '提出書類 → 労災・自賠責レセ', text: <>メニューの「2:提出書類」を開き、「<b>労災・自賠責レセ</b>」を選ぶ</> },
  { n: 2, title: '計算書 自賠責 を選ぶ', text: <>上の段の 4 つのボタンのうち、<b>左から 3 つ目</b>。画面の右に「計算書 自賠責」と出る</> },
  { n: 3, title: '受診者No → プレビュー → 印刷', text: <>① 受診者No を入力　② 「<b>プレビューする</b>」にチェック　③ 右上の <b>F1 印刷</b></> },
  { n: 4, title: '確認メッセージで「はい」', text: <>「印刷処理を実行してよろしいですか？」→ <b>はい(Y)</b></> },
  { n: 5, title: 'プレビューをいちばん大きく', text: <>プレビューの右上の □（<b>最大化</b>）を押して、画面いっぱいにする</> },
  { n: 6, title: '白い用紙の部分をスクショ', text: <><Key k="Win" />＋<Key k="Shift" />＋<Key k="S" /> → 画面が暗くなったら、<b>白い用紙の部分だけ</b>をドラッグ。用紙全体が入っているか確かめる</> },
];
const SYSTEM: Step[] = [
  { n: 7, title: 'この画面に貼り付け', text: <>この画面で <Key k="Ctrl" />＋<Key k="V" />（「スクショを選ぶ」・ドラッグでも可）。<b>1 人ずつ 6 → 7 をくり返す</b></> },
  { n: 8, title: '読み取った内容を見比べる', text: <><b>患者番号・氏名・請求月・実日数・金額</b>を見比べて、違っていれば直す。<b>月遅れ請求は本来請求するべき月</b>を選ぶ</> },
  { n: 9, title: '「変更を保存」', text: <>表の下の「<b>変更を保存</b>」を押す</> },
  { n: 10, title: '「この月を提出する」', text: <><b>未請求者数</b>（請求ができていない自賠の患者様の人数。いなければ 0）を入れて、全員入れたら「<b>この月を提出する</b>」（請求する患者様がいない月は「<b>請求者なし（0 件で提出）</b>」）。締め切り：<b>{JIBAI_DEADLINE}</b></> },
];

function StepCard({ s, sys }: { s: Step; sys?: boolean }) {
  const [img, setImg] = useState(true);
  return (
    <li className="flex flex-col rounded border bg-white p-2 text-xs leading-relaxed">
      <span className="font-bold"><b className={`mr-1 inline-block h-5 w-5 rounded-full text-center leading-5 text-white ${sys ? 'bg-brand' : 'bg-red-600'}`}>{s.n}</b>{s.title}</span>
      <span className="mt-0.5 text-slate-700">{s.text}</span>
      {img && (
        // 押すと大きな画像を別のタブで開く
        <a href={`/guide/jibai-flow-${s.n}.png`} target="_blank" rel="noreferrer" title="押すと大きく見られます" className="mt-1 block">
          <img src={`/guide/jibai-flow-${s.n}.png`} alt={`手順 ${s.n}：${s.title}`} loading="lazy" onError={() => setImg(false)} className="max-h-40 w-full rounded border bg-white object-contain hover:opacity-80" />
          <span className="text-[10.5px] text-brand underline">🔍 大きく見る</span>
        </a>
      )}
    </li>
  );
}

export default function JibaiFlow() {
  const KEY = 'jibaiFlowClosed';
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) !== '1'; } catch { return true; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(KEY, v ? '0' : '1'); } catch { /* 覚えられなくても動く */ } };
  return (
    <section className="rounded border border-brand/40 bg-brand-light/40 text-sm" aria-label="自賠請求の手順">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-left font-bold text-brand-dark">
        <span>📋 自賠請求の手順（スクショ → 読み取り → 提出）<span className="ml-2 font-normal text-slate-600">締め切り：{JIBAI_DEADLINE}</span></span>
        <span className="whitespace-nowrap text-xs font-normal">{open ? '▲ 閉じる' : '▼ 開く'}</span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <p className="text-xs font-bold text-red-700">レセコン（THE 柔 PLUS）でスクショを撮る</p>
          <ol className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">{RECECON.map((s) => <StepCard key={s.n} s={s} />)}</ol>
          <p className="text-xs font-bold text-brand-dark">このシステムで読み取り・提出（この画面）</p>
          <ol className="grid grid-cols-2 gap-2 xl:grid-cols-4">{SYSTEM.map((s) => <StepCard key={s.n} s={s} sys />)}</ol>
        </div>
      )}
    </section>
  );
}
