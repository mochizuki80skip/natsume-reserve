import { Navigate } from 'react-router-dom';
import { useAdmin } from './Layout';

export default function AdminIndex() {
  const { me } = useAdmin();
  return <Navigate to={`/admin/day/${me.today}`} replace />;
}
