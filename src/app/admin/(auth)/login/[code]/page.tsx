import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import LoginForm from '../LoginForm';

export const dynamic = 'force-dynamic';

/** 店舗専用のログインURL（/admin/login/<店舗コード>）。店舗コードは固定でパスワードだけ入力する */
export default async function StoreLoginPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const store = await prisma.store.findUnique({ where: { code }, select: { code: true, name: true, active: true } });
  if (!store || !store.active) notFound();
  return (
    <main className="mx-auto max-w-sm px-4 pt-16">
      <h1 className="mb-1 text-center text-xl font-bold">{store.name}</h1>
      <p className="mb-6 text-center text-sm text-slate-500">管理画面ログイン</p>
      <LoginForm fixedCode={store.code} />
    </main>
  );
}
