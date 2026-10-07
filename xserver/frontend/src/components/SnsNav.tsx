// SNS 投稿管理の各ページの見出し（メニューは左の SnsShell にある）
import { useAdmin } from '@/pages/admin/Layout';
import { StoreDot } from '@/lib/storeColor';

export default function SnsNav({ title }: { title?: string }) {
  const { me } = useAdmin();
  if (!title) return null;
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <h1 className="text-xl font-bold">{title}</h1>
      {me.store && me.session.role !== 'hq' && <span className="text-xs text-slate-500"><StoreDot code={me.store.code} className="mr-1" />{me.store.name}</span>}
    </div>
  );
}
