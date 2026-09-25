import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold">接骨院 WEB予約システム</h1>
      <p className="mt-3 text-sm text-slate-600">
        患者様向けページは店舗ごとの URL（<code>/s/店舗コード</code>）からご利用ください。
      </p>
      <Link to="/admin" className="mt-6 inline-block rounded bg-brand px-4 py-2 text-white">管理画面へ</Link>
    </main>
  );
}
