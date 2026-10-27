// 予約表 /admin/day/<日付>
import { useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { isValidDate } from '@/lib/time';
import type { DayResponse } from '@/lib/types';
import DayGrid from '@/components/DayGrid';
import BlockSuggestions from '@/components/BlockSuggestions';
import { useAdmin } from './Layout';

export default function DayPage() {
  const { date = '' } = useParams();
  const { me } = useAdmin();
  const valid = isValidDate(date);
  const { data, error, loading, reload } = useFetch<DayResponse>(valid ? `/api/admin/day?date=${date}` : null);
  // 日付を続けて送ったとき、休診日（表のない日）や表の短い日でページが短くなると、ブラウザがスクロールを上へ戻して
  // 次の日の表が上下にずれて見える。表のある日の高さを覚えておき、その高さより短くならないようにする
  const boxRef = useRef<HTMLDivElement>(null);
  // ブロックの提案：日付を送っても作り直さない（14 日分の確認を毎回しない・帯が出たり消えたりしない）。予約表が変わるたびに数を増やす
  const [suggestVer, setSuggestVer] = useState(0);
  const keepH = useRef(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && el.querySelector('#grid')) keepH.current = el.scrollHeight;
  });
  if (!valid) return <p className="text-sm text-red-700">日付が正しくありません。</p>;
  if (!me.store) return <p>店舗が登録されていません。本部画面から店舗を追加してください。</p>;
  if (error && !data) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">{loading ? '読み込み中…' : ''}</p>;
  return (
    <>
    {/* 自動更新で読み込めなかったときは表をそのまま残して知らせる */}
    {error && <p role="alert" className="no-print mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">最新の内容を読み込めませんでした（{error.message}）。インターネットの接続を確認して、F5 を押してください。</p>}
    <BlockSuggestions store={me.store.code} date={data.data.date} version={suggestVer} canEdit={!me.store.readOnly && me.session.role !== 'acct'} onChanged={reload} />
    <div ref={boxRef} style={{ minHeight: keepH.current || undefined }}>
    <DayGrid
      // 読み込み済みデータの日付で作り直す（URL の日付だと、前の日のデータのまま表が作られて氏名が出なくなる）
      key={`${me.store.id}:${data.data.date}`}
      data={data.data}
      storeName={data.storeName}
      published={data.published}
      today={data.today}
      onRefresh={reload}
      onEdited={() => setSuggestVer((v) => v + 1)}
    />
    </div>
    </>
  );
}
