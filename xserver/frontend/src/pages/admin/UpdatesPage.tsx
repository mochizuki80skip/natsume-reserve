// 更新のお知らせ（これまでの変更内容）/admin/updates
import { CHANGELOG } from '@/changelog';
import { ChangeList } from '@/components/UpdateNotice';
import { APP_VERSION } from '@/version';
import { useAdmin } from './Layout';

export default function UpdatesPage() {
  const { me } = useAdmin();
  const list = CHANGELOG.filter((c) => me.session.role === 'hq' || c.audience.includes('店舗'));
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">更新のお知らせ</h1>
      <p className="mb-4 text-xs text-slate-500">今の画面の版：{APP_VERSION}</p>
      <div className="rounded-lg border bg-white p-4"><ChangeList list={list} /></div>
    </div>
  );
}
