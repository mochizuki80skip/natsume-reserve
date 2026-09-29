// 本部：自賠請求の全店集計
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/admin';
import JibaiHqClient from './JibaiHqClient';

export const dynamic = 'force-dynamic';

export default async function JibaiHqPage() {
  const session = await requireSession();
  if (session.role !== 'hq') redirect('/admin');
  return <Suspense fallback={<p className="text-sm text-slate-500">読み込み中…</p>}><JibaiHqClient /></Suspense>;
}
