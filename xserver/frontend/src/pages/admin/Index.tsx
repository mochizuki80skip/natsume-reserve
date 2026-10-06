import { Navigate } from 'react-router-dom';
import { SNS_ONLY } from '@/lib/mode';
import { useAdmin } from './Layout';

export default function AdminIndex() {
  const { me } = useAdmin();
  return <Navigate to={SNS_ONLY ? '/admin/sns' : `/admin/day/${me.today}`} replace />;
}
