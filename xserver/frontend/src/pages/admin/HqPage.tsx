import { Navigate } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import HqClient from '@/components/HqClient';
import StoresPageEditor, { type ListingStore } from '@/components/StoresPageEditor';
import ReferralEditor from '@/components/ReferralEditor';
import CampaignEditor from '@/components/CampaignEditor';
import PrivacyEditor from '@/components/PrivacyEditor';
import GoodsEditor from '@/components/GoodsEditor';
import ReportItemsEditor from '@/components/ReportItemsEditor';
import ClosureBulkEditor from '@/components/ClosureBulkEditor';
import SpecialBulkEditor from '@/components/SpecialBulkEditor';
import JibaiNotifyEditor from '@/components/JibaiNotifyEditor';
import SetupCheck from '@/components/SetupCheck';
import Fold from '@/components/Fold';
import { useAdmin } from './Layout';

interface Resp {
  stores: ({ code: string; name: string; phone: string; beds: number; active: boolean; area?: string; hqOnly?: boolean; jibaiOnly?: boolean } & ListingStore)[];
  storesPageOpen?: boolean;
  areas?: string[];
  setting: { slotMinutes: number; newVisitSlots: number; returnVisitSlots: number; webCutoffMinutes: number; phoneCutoffMinutes: number; phoneMarkRemaining: number; closeOnHolidays: boolean; adminExtraSlots: number; retentionDays: number; hours: string };
}

export default function HqPage() {
  const { me, refreshMe } = useAdmin();
  const { data, error, reload } = useFetch<Resp>(me.session.role === 'hq' ? '/api/admin/hq' : null);
  if (me.session.role !== 'hq') return <Navigate to="/admin" replace />;
  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;
  return (
    <>
      <HqClient key={data.stores.map((s) => `${s.code}:${s.name}:${s.active}`).join(',')} stores={data.stores} areas={data.areas ?? []} setting={data.setting} onRefresh={() => { reload(); refreshMe(); }} />
      <Fold id="setup" title="WEB予約の設定チェック"><SetupCheck /></Fold>
      <Fold id="closure" title="臨時休業（まとめて）"><ClosureBulkEditor /></Fold>
      <Fold id="special" title="特別な営業日"><SpecialBulkEditor /></Fold>
      <Fold id="storesPage" title="店舗えらびページ"><StoresPageEditor stores={data.stores.filter((s) => !s.jibaiOnly)} open={!!data.storesPageOpen} onRefresh={reload} /></Fold>
      <Fold id="campaign" title="WEB 予約の URL・QR"><CampaignEditor /></Fold>
      <Fold id="referral" title="紹介元の専用 QR"><ReferralEditor pageOpen={!!data.storesPageOpen} /></Fold>
      <Fold id="jibai" title="新自の通知・相談LINE"><JibaiNotifyEditor /></Fold>
      <Fold id="goods" title="物販の商品"><GoodsEditor /></Fold>
      <Fold id="report" title="日報の項目"><ReportItemsEditor /></Fold>
      <Fold id="privacy" title="プライバシーポリシー"><PrivacyEditor /></Fold>
    </>
  );
}
