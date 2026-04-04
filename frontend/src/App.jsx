import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import PulseMap from './components/PulseMap/PulseMap';
import LandingPage from './pages/LandingPage';
import OnboardPage from './pages/OnboardPage';
import PatientLog from './pages/PatientLog';
import HospitalDashboard from './pages/HospitalDashboard';
import HospitalBroadcasts from './pages/HospitalBroadcasts';
import BroadcastNew from './pages/BroadcastNew';
import BroadcastList from './pages/BroadcastList';
import BroadcastDashboard from './pages/BroadcastDashboard';
import BroadcastPatientLog from './pages/BroadcastPatientLog';
import AmbulanceTracker from './pages/AmbulanceTracker';
import DispatchDashboard from './pages/DispatchDashboard';
import AmbulanceCrew from './pages/AmbulanceCrew';
import EmergencyTrackerPage from './pages/EmergencyTrackerPage';
import BedScanner from './pages/BedScanner';
import DepartmentDashboard from './pages/DepartmentDashboard';
import LoginPage from './pages/LoginPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/map" element={<PulseMap />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/onboard" element={<OnboardPage />} />
          <Route path="/join" element={<OnboardPage />} />
          <Route path="/log/:slug" element={<PatientLog />} />
          <Route path="/ambulance/:patientId" element={<AmbulanceTracker />} />
          <Route path="/ambulance/:ambulanceId/crew" element={<AmbulanceCrew />} />
          <Route path="/emergency/:handshakeId/track" element={<EmergencyTrackerPage />} />
          <Route path="/hospital/:slug/department" element={<DepartmentDashboard />} />

          {/* Hospital admin routes */}
          <Route path="/hospital/:slug/dashboard" element={
            <ProtectedRoute role="hospital_admin">
              <HospitalDashboard />
            </ProtectedRoute>
          } />
          <Route path="/hospital/:slug/scan" element={
            <ProtectedRoute role="hospital_admin">
              <BedScanner />
            </ProtectedRoute>
          } />
          <Route path="/hospital/:slug/broadcasts" element={
            <ProtectedRoute role="hospital_admin">
              <HospitalBroadcasts />
            </ProtectedRoute>
          } />

          {/* Dispatch manager routes — PIN-based access */}
          <Route path="/dispatch/:slug" element={<DispatchDashboard />} />

          {/* Broadcast routes — any authenticated user */}
          <Route path="/broadcast" element={
            <ProtectedRoute>
              <BroadcastList />
            </ProtectedRoute>
          } />
          <Route path="/broadcast/new" element={
            <ProtectedRoute>
              <BroadcastNew />
            </ProtectedRoute>
          } />
          <Route path="/broadcast/:id" element={
            <ProtectedRoute>
              <BroadcastDashboard />
            </ProtectedRoute>
          } />
          <Route path="/broadcast/:id/log" element={
            <ProtectedRoute>
              <BroadcastPatientLog />
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
