// SNS 投稿管理のページ共通の見出しとメニュー
import { Link, useLocation } from 'react-router-dom';
import { useAdmin } from '@/pages/admin/Layout';

const ITEMS: [string, string][] = [['/admin/sns', 'ホーム'], ['/admin/sns/manual', '手動投稿'], ['/admin/sns/posts', '投稿一覧'], ['/admin/sns/topics', '定型投稿'], ['/admin/sns/media', '画像'], ['/admin/sns/settings', '設定'], ['/admin/sns/insights', '分析']];

export default function SnsNav({ title }: { title?: string }) {
  const { me } = useAdmin();
  const { pathname } = useLocation();
  const items = me.session.role === 'hq' ? [...ITEMS, ['/admin/hq/sns', 'SNS管理（本部）'] as [string, string]] : ITEMS;
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-bold text-brand-dark">SNS投稿</span>
        {items.map(([to, label]) => {
          const active = to === '/admin/sns' ? pathname === to : pathname.startsWith(to);
          return <Link key={to} to={to} className={active ? 'font-bold underline' : 'text-slate-600 hover:underline'}>{label}</Link>;
        })}
        {me.store && <span className="ml-auto text-xs text-slate-500">店舗：{me.store.name}</span>}
      </div>
      {title && <h1 className="mt-2 text-xl font-bold">{title}</h1>}
    </div>
  );
}
