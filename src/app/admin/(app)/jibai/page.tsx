// 自賠責請求の速報登録（店舗）。本部は店舗切替で同じ画面から経理確認を行う
import { Suspense } from 'react';
import { requireSession } from '@/lib/admin';
import JibaiClient from './JibaiClient';

export const dynamic = 'force-dynamic';

export default async function JibaiPage() {
  await requireSession();
  return <Suspense fallback={<p className="text-sm text-slate-500">読み込み中…</p>}><JibaiClient /></Suspense>;
}
