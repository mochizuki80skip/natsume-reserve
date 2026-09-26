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
import StoryPage from './pages/admin/StoryPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:code" element={<Booking />} />
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
          <Route path="story" element={<StoryPage />} />
          <Route path="hq" element={<HqPage />} />
          <Route path="hq/overview" element={<OverviewPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
