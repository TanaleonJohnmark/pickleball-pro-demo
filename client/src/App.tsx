import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { AppLayout, RequireRole } from './components/Layout';
import { can } from './lib/auth';
import Landing from './pages/Landing';
import { Login, Register } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Book from './pages/Book';
import { ReservationList, ReservationDetail } from './pages/Reservations';
import Calendar from './pages/Calendar';
import { CourtList, CourtDetail } from './pages/Courts';
import { PlayerList, PlayerDetail } from './pages/Players';
import { MyMembership, ManageMemberships } from './pages/Memberships';
import { MatchList, MatchDetail } from './pages/Matches';
import { TournamentList, TournamentDetail } from './pages/Tournaments';
import Rankings from './pages/Rankings';
import { PaymentList, FrontDesk, Receipt } from './pages/Payments';
import { CoachingList, CoachingDetail } from './pages/Coaching';
import Reports from './pages/Reports';
import { Notifications, Announcements, Profile } from './pages/Misc';
import { StaffUsers, AuditLog, SettingsPage } from './pages/Admin';

const NotFound = () => <div className="py-20 text-center"><h1 className="text-4xl font-bold">Page not found</h1><Link to="/app" className="mt-3 inline-block font-semibold text-court-600 underline">Go to your dashboard</Link></div>;

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="book" element={<Book />} />
        <Route path="reservations" element={<ReservationList />} />
        <Route path="reservations/:id" element={<ReservationDetail />} />
        <Route path="calendar" element={<RequireRole allow={can.staff}><Calendar /></RequireRole>} />
        <Route path="courts" element={<RequireRole allow={can.staff}><CourtList /></RequireRole>} />
        <Route path="courts/:id" element={<RequireRole allow={can.staff}><CourtDetail /></RequireRole>} />
        <Route path="players" element={<RequireRole allow={(u) => can.staff(u) || can.coach(u)}><PlayerList /></RequireRole>} />
        <Route path="players/:id" element={<PlayerDetail />} />
        <Route path="membership" element={<MyMembership />} />
        <Route path="memberships/manage" element={<RequireRole allow={can.admin}><ManageMemberships /></RequireRole>} />
        <Route path="matches" element={<MatchList />} />
        <Route path="matches/:id" element={<MatchDetail />} />
        <Route path="tournaments" element={<TournamentList />} />
        <Route path="tournaments/:id" element={<TournamentDetail />} />
        <Route path="rankings" element={<Rankings />} />
        <Route path="payments" element={<PaymentList />} />
        <Route path="payments/desk" element={<RequireRole allow={can.staff}><FrontDesk /></RequireRole>} />
        <Route path="payments/:id" element={<Receipt />} />
        <Route path="coaching" element={<CoachingList />} />
        <Route path="coaching/:id" element={<CoachingDetail />} />
        <Route path="reports" element={<RequireRole allow={can.admin}><Reports /></RequireRole>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin/users" element={<RequireRole allow={can.superAdmin}><StaffUsers /></RequireRole>} />
        <Route path="admin/audit" element={<RequireRole allow={can.superAdmin}><AuditLog /></RequireRole>} />
        <Route path="admin/settings" element={<RequireRole allow={can.admin}><SettingsPage /></RequireRole>} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
