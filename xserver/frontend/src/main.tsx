import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './globals.css';
import Home from './pages/Home';
import Booking from './pages/Booking';
import Login from './pages/Login';
import AdminLayout from './pages/admin/Layout';
import AdminIndex from './pages/admin/Index';
import DayPage from './pages/admin/DayPage';
import CalendarPage from './pages/admin/CalendarPage';
import ShiftsPage from './pages/admin/ShiftsPage';
import ReservationsPage from './pages/admin/ReservationsPage';
import SettingsPage from './pages/admin/SettingsPage';
import PrintPage from './pages/admin/PrintPage';
import HqPage from './pages/admin/HqPage';
import OverviewPage from './pages/admin/OverviewPage';
import JibaiPage from './pages/admin/JibaiPage';
import JibaiHqPage from './pages/admin/JibaiHqPage';
import StoryPage from './pages/admin/StoryPage';
import SnsHomePage from './pages/admin/sns/SnsHomePage';
import SnsPostsPage from './pages/admin/sns/SnsPostsPage';
import SnsPostPage from './pages/admin/sns/SnsPostPage';
import SnsTopicsPage from './pages/admin/sns/SnsTopicsPage';
import SnsSettingsPage from './pages/admin/sns/SnsSettingsPage';
import SnsInsightsPage from './pages/admin/sns/SnsInsightsPage';
import SnsHqPage from './pages/admin/sns/SnsHqPage';
import SnsMediaPage from './pages/admin/sns/SnsMediaPage';
import SnsManualPage from './pages/admin/sns/SnsManualPage';
import SnsShell from './components/SnsShell';
import SnsSchedulePage from './pages/admin/sns/SnsSchedulePage';
import { SNS_ONLY } from './lib/mode';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={SNS_ONLY ? <Navigate to="/admin" replace /> : <Home />} />
        <Route path="/s/:code" element={SNS_ONLY ? <Navigate to="/admin/login" replace /> : <Booking />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin/login/:code" element={<Login />} />
        <Route path="/admin/print/:date" element={<PrintPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          <Route path="day/:date" element={<DayPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="shifts" element={<ShiftsPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="jibai" element={<JibaiPage />} />
          <Route path="story" element={<StoryPage />} />
          <Route element={<SnsShell />}>
            <Route path="sns" element={<SnsHomePage />} />
            <Route path="sns/manual" element={<SnsManualPage />} />
            <Route path="sns/calendar" element={<SnsPostsPage defaultView="calendar" />} />
            <Route path="sns/posts" element={<SnsPostsPage />} />
            <Route path="sns/posts/:id" element={<SnsPostPage />} />
            <Route path="sns/topics" element={<SnsTopicsPage />} />
            <Route path="sns/media" element={<SnsMediaPage />} />
            <Route path="sns/settings" element={<SnsSettingsPage />} />
            <Route path="sns/schedule" element={<SnsSchedulePage />} />
            <Route path="sns/insights" element={<SnsInsightsPage />} />
            <Route path="hq/sns" element={<SnsHqPage />} />
          </Route>
          <Route path="hq" element={<HqPage />} />
          <Route path="hq/overview" element={<OverviewPage />} />
          <Route path="hq/jibai" element={<JibaiHqPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
