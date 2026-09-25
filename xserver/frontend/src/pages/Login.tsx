// 管理画面ログイン。/admin/login（店舗コード＋パスワード）と /admin/login/<店舗コード>（パスワードのみ）
import { useParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import LoginForm from '@/components/LoginForm';

interface StoreInfo { code: string; name: string }

export default function Login() {
  const { code } = useParams();
  const { data, error, loading } = useFetch<StoreInfo>(code ? `/api/public/${encodeURIComponent(code)}/store` : null);
  if (code) {
    if (loading) return <main className="mx-auto max-w-sm px-4 pt-16 text-sm text-slate-500">読み込み中…</main>;
    if (error || !data) {
      return (
        <main className="mx-auto max-w-sm px-4 pt-16 text-center">
          <h1 className="text-lg font-bold">ページが見つかりません</h1>
          <p className="mt-2 text-sm text-slate-600">店舗コードをご確認ください。<a href="/admin/login" className="ml-2 underline">共通のログイン画面へ</a></p>
        </main>
      );
    }
    return (
      <main className="mx-auto max-w-sm px-4 pt-16">
        <h1 className="mb-1 text-center text-xl font-bold">{data.name}</h1>
        <p className="mb-6 text-center text-sm text-slate-500">管理画面ログイン</p>
        <LoginForm fixedCode={data.code} />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-sm px-4 pt-16">
      <h1 className="mb-6 text-center text-xl font-bold">管理画面ログイン</h1>
      <LoginForm />
    </main>
  );
}
