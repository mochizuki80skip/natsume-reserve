import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import CalendarPage from './CalendarPage';
import StoreSettingsForm from '@/components/StoreSettingsForm';
import StaffList from '@/components/StaffList';
import PatientImport from '@/components/PatientImport';
import SpecialDaysEditor from '@/components/SpecialDaysEditor';
import { StoreUrlCards } from '@/components/UrlQrCard';
import { useAdmin } from './Layout';

interface Resp {
  store: { code: string; name: string; phone: string; beds: number; defaultActiveBeds: number; maxTherapists: number; maxReception: number; publishDaysAhead: number; maxNewConcurrent: number | null; maxRevisitConcurrent?: number | null; notifyPhone: string; hoursOverride: string };
  globalHours: string; slotMinutes?: number; canChangePassword: boolean; smsEnabled: boolean;
  members: { id: string; name: string; role: string; active: boolean; startDate: string | null; endDate: string | null; joinType: string | null; canFirst?: boolean; canRevisit?: boolean; color?: string }[];
}

export default function SettingsPage() {
  const [sp] = useSearchParams();
  const tab = sp.get('tab') === 'calendar' ? 'calendar' : 'store';
  const { me } = useAdmin();
  if (!me.store) return <p>店舗が登録されていません。</p>;
  const tabCls = (on: boolean) => `rounded-t border border-b-0 px-4 py-1.5 text-sm no-underline ${on ? 'bg-white font-bold text-brand-dark' : 'bg-slate-100 text-slate-600 hover:bg-slate-50'}`;
  return (
    <div className="max-w-6xl">
      <h1 className="mb-3 text-xl font-bold">店舗設定：{me.store.name}</h1>
      {/* 店舗設定の中に「カレンダー（WEB 予約の公開日・臨時休診）」を入れる */}
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        <Link to="/admin/settings" role="tab" aria-selected={tab === 'store'} className={tabCls(tab === 'store')}>店舗・スタッフ</Link>
        <Link to="/admin/settings?tab=calendar" role="tab" aria-selected={tab === 'calendar'} className={tabCls(tab === 'calendar')}>カレンダー（公開日・臨時休診）</Link>
      </div>
      {tab === 'calendar' ? <CalendarPage /> : <StoreSettings />}
    </div>
  );
}

function StoreSettings() {
  const { me, refreshMe } = useAdmin();
  const { data, error, reload } = useFetch<Resp>('/api/admin/settings');
  if (!me.store) return <p>店舗が登録されていません。</p>;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  const refresh = () => { reload(); refreshMe(); };
  return (
    <div>
      {/* 画面が広いときは 2 列（左：店舗設定、右：スタッフ・シフト）、半面では 1 列 */}
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <StoreSettingsForm store={data.store} globalHours={data.globalHours} slotMinutes={data.slotMinutes ?? 15} canChangePassword={data.canChangePassword} smsEnabled={data.smsEnabled} onRefresh={refresh} />
        <StaffList key={data.members.map((m) => `${m.id}:${m.name}:${m.active}:${m.startDate}:${m.endDate}:${m.joinType}:${m.canFirst}:${m.canRevisit}:${m.color}`).join(',')} members={data.members} maxTherapists={data.store.maxTherapists} maxReception={data.store.maxReception} onRefresh={reload} />
        <section className="rounded-lg border bg-white p-4 text-sm xl:col-span-2" aria-label="この店舗の URL・QR コード">
          <h2 className="mb-1 font-bold">この店舗の URL・QR コード</h2>
          <p className="mb-2 text-xs text-slate-500">「QR 画像を保存」で PNG 画像として保存できます（印刷物・掲示用）。店舗コードを変えると URL も変わるので、そのときは作り直してください。</p>
          <StoreUrlCards code={data.store.code} name={data.store.name} />
        </section>
        <SpecialDaysEditor />
        <PatientImport />
      </div>
    </div>
  );
}
