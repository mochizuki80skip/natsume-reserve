import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import './globals.css';
import Home from './pages/Home';
import Booking from './pages/Booking';
import ReservationView from './pages/ReservationView';
import Stores from './pages/Stores';
import Login from './pages/Login';
import AdminLayout from './pages/admin/Layout';
import AdminIndex from './pages/admin/Index';
import DayPage from './pages/admin/DayPage';
import ShiftsPage from './pages/admin/ShiftsPage';
import ReservationsPage from './pages/admin/ReservationsPage';
import SettingsPage from './pages/admin/SettingsPage';
import PrintPage from './pages/admin/PrintPage';
import HqPage from './pages/admin/HqPage';
import OverviewPage from './pages/admin/OverviewPage';
import JibaiPage from './pages/admin/JibaiPage';
import JibaiHqPage from './pages/admin/JibaiHqPage';
import StoryPage from './pages/admin/StoryPage';
import KartePage from './pages/admin/KartePage';
import KarteHqPage from './pages/admin/KarteHqPage';
import StaffCountsPage from './pages/admin/StaffCountsPage';
import AccountsPage from './pages/admin/AccountsPage';

/** 前の「カレンダー」の URL（/admin/calendar?month=…）は、店舗設定の中のカレンダーへ（月はそのまま） */
function OldCalendar() {
  const [sp] = useSearchParams();
  const month = sp.get('month');
  return <Navigate to={`/admin/settings?tab=calendar${month ? `&month=${encodeURIComponent(month)}` : ''}`} replace />;
}
import UpdatesPage from './pages/admin/UpdatesPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:code" element={<Booking />} />
        <Route path="/r/:token" element={<ReservationView />} />
        <Route path="/stores" element={<Stores />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin/login/:code" element={<Login />} />
        <Route path="/admin/print/:date" element={<PrintPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          <Route path="day/:date" element={<DayPage />} />
          <Route path="calendar" element={<OldCalendar />} />
          <Route path="shifts" element={<ShiftsPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="jibai" element={<JibaiPage />} />
          <Route path="story" element={<StoryPage />} />
          <Route path="karte" element={<KartePage />} />
          <Route path="karte/summary" element={<KarteHqPage />} />
          <Route path="staff-counts" element={<StaffCountsPage />} />
          <Route path="hq/karte" element={<KarteHqPage />} />
          <Route path="hq/accounts" element={<AccountsPage />} />
          <Route path="updates" element={<UpdatesPage />} />
          <Route path="hq" element={<HqPage />} />
          <Route path="hq/overview" element={<OverviewPage />} />
          <Route path="hq/jibai" element={<JibaiHqPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
