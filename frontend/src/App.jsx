import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PulseMap from './components/PulseMap/PulseMap';
import OnboardPage from './pages/OnboardPage';
import PatientLog from './pages/PatientLog';
import HospitalDashboard from './pages/HospitalDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PulseMap />} />
        <Route path="/onboard" element={<OnboardPage />} />
        <Route path="/join" element={<OnboardPage />} />
        <Route path="/log/:slug" element={<PatientLog />} />
        <Route path="/hospital/:slug/dashboard" element={<HospitalDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}