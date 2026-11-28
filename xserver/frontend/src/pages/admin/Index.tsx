import { Navigate } from 'react-router-dom';
import { useAdmin } from './Layout';

export default function AdminIndex() {
  const { me } = useAdmin();
  // 本部は全店状況から。ほかは今日の予約表
  return <Navigate to={me.session.role === 'hq' ? '/admin/hq/overview' : `/admin/day/${me.today}`} replace />;
}
