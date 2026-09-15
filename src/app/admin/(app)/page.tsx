import { redirect } from 'next/navigation';
import { nowJst } from '@/lib/time';

export default function AdminIndex() {
  redirect(`/admin/day/${nowJst().date}`);
}
