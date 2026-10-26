import { closureSentence, type Closure } from '@/lib/closure';

/** 予約ページの上に出す臨時休業のお知らせ */
export default function ClosureNotice({ closures }: { closures: Closure[] }) {
  if (!closures.length) return null;
  return (
    <div role="note" aria-label="臨時休業のお知らせ" className="mb-3 rounded-lg border-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">
      <b className="block">臨時休業のお知らせ</b>
      {closures.map((c) => <p key={c.date} className="m-0">{closureSentence(c)}</p>)}
      <p className="m-0 mt-0.5 text-xs">ご迷惑をおかけしますが、よろしくお願いいたします。</p>
    </div>
  );
}
