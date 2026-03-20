import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PulseMap from './components/PulseMap/PulseMap';
import OnboardPage from './pages/OnboardPage';
import PatientLog from './pages/PatientLog';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PulseMap />} />
        <Route path="/onboard" element={<OnboardPage />} />
        <Route path="/join" element={<OnboardPage />} />
        <Route path="/log/:slug" element={<PatientLog />} />
      </Routes>
    </BrowserRouter>
  );
}