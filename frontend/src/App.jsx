import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PulseMap from './components/PulseMap/PulseMap';
import OnboardPage from './pages/OnboardPage';
import PatientLog from './pages/PatientLog';
import HospitalDashboard from './pages/HospitalDashboard';
import BroadcastNew from './pages/BroadcastNew';
import BroadcastList from './pages/BroadcastList';
import BroadcastDashboard from './pages/BroadcastDashboard';
import BroadcastPatientLog from './pages/BroadcastPatientLog';
import AmbulanceTracker from './pages/AmbulanceTracker';
import TransportQueue from './pages/TransportQueue';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PulseMap />} />
        <Route path="/onboard" element={<OnboardPage />} />
        <Route path="/join" element={<OnboardPage />} />
        <Route path="/log/:slug" element={<PatientLog />} />
        <Route path="/hospital/:slug/dashboard" element={<HospitalDashboard />} />
        <Route path="/broadcast" element={<BroadcastList />} />
        <Route path="/broadcast/new" element={<BroadcastNew />} />
        <Route path="/broadcast/:id" element={<BroadcastDashboard />} />
        <Route path="/broadcast/:id/log" element={<BroadcastPatientLog />} />
        <Route path="/ambulance/:patientId" element={<AmbulanceTracker />} />
        <Route path="/dispatch" element={<TransportQueue />} />
      </Routes>
    </BrowserRouter>
  );
}
