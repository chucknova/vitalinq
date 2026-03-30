/**
 * SearchPanel — left sidebar with full emergency booking flow.
 *
 * Steps:
 *   1. Search (Smart Triage or Nearby)
 *   2. Results list (pick a hospital)
 *   3. Patient details (name, phone, condition)
 *   4. Live status tracker (polling handshake until resolved)
 */

import { useState, useRef, useEffect } from 'react';
import {
  Brain, MapPin, ChevronLeft, ChevronRight, X,
  Loader2, AlertTriangle, ArrowLeft, Phone, User, FileText,
  CheckCircle2, Clock, Navigation, Copy, Check, Ambulance, LocateFixed, Building2,
  Bell, BedDouble, MapPinned, RefreshCcw, ShieldAlert
} from 'lucide-react';
import api from '../../lib/api';
import useHandshake from '../../hooks/useHandshake';

const STEPS = {
  SEARCH: 'search',
  RESULTS: 'results',
  LOW_URGENCY: 'low_urgency',
  PATIENT: 'patient',
  TRACKING: 'tracking',
};

const INITIAL_CHAT_MESSAGES = [
  {
    role: 'assistant',
    content: 'Tell me what’s going on by describing the emergency, and I’ll help you find the right care nearby.',
  },
];

function formatConditionLabel(value) {
  return value?.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) || 'Care match';
}

function formatUrgencyLabel(value) {
  return (
    {
      critical: 'Needs urgent help',
      high: 'Needs quick care',
      medium: 'Needs care soon',
      low: 'May be okay for a clinic',
    }[value] || 'Care level'
  );
}

export default function SearchPanel({ onResults, onClear, searchResults, hospitals, onHospitalSelect, onStartTracking }) {
  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState(STEPS.SEARCH);
  const [mode, setMode] = useState('triage');
  const [description, setDescription] = useState('');
  const [chatMessages, setChatMessages] = useState(INITIAL_CHAT_MESSAGES);
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [triageAnalysis, setTriageAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [clinicResults, setClinicResults] = useState(null);

  // Booking state
  const [selectedResult, setSelectedResult] = useState(null);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientCondition, setPatientCondition] = useState('');
  const [handshakeId, setHandshakeId] = useState(null);
  const [transferCode, setTransferCode] = useState(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [rerouteResults, setRerouteResults] = useState(null);
  const [rerouteLoading, setRerouteLoading] = useState(false);
  const [transportLoading, setTransportLoading] = useState(false);
  const [transportId, setTransportId] = useState(null);
  const [transportData, setTransportData] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [holdInfo, setHoldInfo] = useState(null); // { minutes, driveEstimate, distanceKm }
  const [holdExtended, setHoldExtended] = useState(false);

  // ── Restore session from sessionStorage on mount ────────
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('bedsignal_session');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.handshakeId) {
          setHandshakeId(s.handshakeId);
          setTransferCode(s.transferCode || null);
          setTransportId(s.transportId || null);
          setSelectedResult(s.selectedResult || null);
          setPatientName(s.patientName || '');
          setPatientPhone(s.patientPhone || '');
          setStep(STEPS.TRACKING);
        }
      }
    } catch {}
  }, []);

  // Live status polling
  const { handshake, countdown } = useHandshake(handshakeId);
  const hasAmbulanceReroute = handshake?.status === 'overridden' && transportData?._rerouted;

  // Poll transport status when we have a transport request
  useEffect(() => {
    if (!transportId) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await api.get(`/api/transport/${transportId}`);
        if (active) setTransportData(res.data);
      } catch {
        // Ignore transport polling errors and try again on the next interval.
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [transportId]);

  // Detect when hold is extended due to transport acceptance
  const prevTransportStatus = useRef(null);
  useEffect(() => {
    if (transportData?.status && transportData.status !== prevTransportStatus.current) {
      if (['hospital_accepted', 'dispatch_accepted'].includes(transportData.status) &&
          !['hospital_accepted', 'dispatch_accepted'].includes(prevTransportStatus.current)) {
        setHoldExtended(true);
        setHoldInfo(prev => prev ? { ...prev, minutes: 60 } : { minutes: 60, driveEstimate: null, distanceKm: null });
      }
      prevTransportStatus.current = transportData.status;
    }
  }, [transportData?.status]);

  // Clear persisted session when handshake reaches a terminal state
  useEffect(() => {
    if (handshake?.status && ['completed', 'expired'].includes(handshake.status)) {
      try { sessionStorage.removeItem('bedsignal_session'); } catch {}
    }
  }, [handshake?.status]);

  // Auto-search for alternatives when overridden
  const prevStatus = useRef(null);
  useEffect(() => {
    if (handshake?.status === 'overridden' && prevStatus.current !== 'overridden') {
      // Status just changed to overridden — auto-search for alternatives
      (async () => {
        setRerouteLoading(true);
        try {
          let lat = 6.5244, lng = 3.3792;
          try {
            const pos = await new Promise((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
            );
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
          } catch {
            // Fall back to the default Lagos center when location is unavailable.
          }

          const res = await api.post('/api/search/nearby', {
            latitude: lat,
            longitude: lng,
            radius_km: 20,
            limit: 5,
          });

          // Filter out the hospital that overrode
          const filtered = res.data.results.filter(
            r => r.hospital_id !== selectedResult?.hospital_id
          );
          setRerouteResults(filtered);
        } catch (err) {
          console.error('Reroute search failed:', err);
        } finally {
          setRerouteLoading(false);
        }
      })();
    }
    prevStatus.current = handshake?.status;
  }, [handshake?.status, selectedResult?.hospital_id]);

  // Start map tracking when bed is confirmed
  const positionIntervalRef = useRef(null);
  useEffect(() => {
    if (handshake?.status === 'accepted' && selectedResult && onStartTracking) {
      const hospital = hospitals.find(h => h.id === selectedResult.hospital_id);
      if (hospital) {
        onStartTracking({
          lat: hospital.lat,
          lng: hospital.lng,
          name: hospital.name || selectedResult.name,
          address: hospital.address || selectedResult.address,
        });
      }

      // Report position to backend every 10 seconds so hospital dashboard can show ETA
      if (handshakeId) {
        function reportPosition() {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              api.patch(`/api/handshakes/${handshakeId}/position`, {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              }).catch(() => undefined);
            },
            () => undefined,
            { enableHighAccuracy: false, timeout: 5000 }
          );
        }
        reportPosition(); // immediate first report
        positionIntervalRef.current = setInterval(reportPosition, 10000);
      }
    }

    // Cleanup when status changes away from accepted
    if (handshake?.status && handshake.status !== 'accepted' && positionIntervalRef.current) {
      clearInterval(positionIntervalRef.current);
      positionIntervalRef.current = null;
    }

    return () => {
      if (positionIntervalRef.current) {
        clearInterval(positionIntervalRef.current);
      }
    };
  }, [handshake?.status, handshakeId, hospitals, onStartTracking, selectedResult]);

  function summarizeConversation(messages) {
    return messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content.trim())
      .join(' ')
      .trim();
  }

  function resolveClinicResults() {
    const clinics = hospitals.filter((h) =>
      h.beds?.length === 0 || ['clinic', 'pharmacy'].includes(h.hospital_type)
    );
    return clinics.length > 0 ? clinics : hospitals.slice(-5);
  }

  async function getCurrentLocation(timeout = 8000) {
    let latitude = 6.5244;
    let longitude = 3.3792;

    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout })
      );
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch {
      // Fall back to the default Lagos center when location is unavailable.
    }

    return { latitude, longitude };
  }

  async function reverseGeocodeLocation(latitude, longitude) {
    const fallback = `Lat ${latitude.toFixed(5)}, Lng ${longitude.toFixed(5)}`;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return fallback;

    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json` +
        `?access_token=${token}&limit=1&country=NG`
      );
      const data = await res.json();
      const placeName = data?.features?.[0]?.place_name;
      return placeName || fallback;
    } catch {
      return fallback;
    }
  }

  function handleTriageOutcome({ parsed_requirements: parsedRequirements, results }) {
    setTriageAnalysis(parsedRequirements);

    const urgency = parsedRequirements?.urgency;
    if (urgency === 'low') {
      setClinicResults(resolveClinicResults());
      setStep(STEPS.LOW_URGENCY);
      return;
    }

    onResults(results);
    setStep(STEPS.RESULTS);
  }

  // ── Search handlers ────────────────────────────────────
  async function handleTriageSearch(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMessage = { role: 'user', content: chatInput.trim() };
    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);
    setChatInput('');

    setLoading(true);
    setError(null);

    try {
      const { latitude, longitude } = await getCurrentLocation();
      const res = await api.post('/api/search/chat', {
        messages: nextMessages,
        latitude,
        longitude,
        radius_km: 20,
      });
      const assistantMessage = {
        role: 'assistant',
        content: res.data.assistant_message,
      };
      setChatMessages([...nextMessages, assistantMessage]);

      if (res.data.should_search) {
        const transcript = summarizeConversation(nextMessages);
        setDescription(transcript);
        setPatientCondition((current) => current || transcript);
        handleTriageOutcome(res.data);
      }
    } catch (error) {
      console.error('Chat search failed:', error);
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickSearch() {
    setLoading(true);
    setError(null);

    try {
      const { latitude, longitude } = await getCurrentLocation();

      const res = await api.post('/api/search/nearby', {
        latitude,
        longitude,
        radius_km: 15,
        limit: 5,
      });

      onResults(res.data.results);
      setStep(STEPS.RESULTS);
    } catch (error) {
      console.error('Quick search failed:', error);
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Hospital selection ─────────────────────────────────
  function handleSelectHospital(result) {
    setSelectedResult(result);
    const hospital = hospitals.find((h) => h.id === result.hospital_id);
    if (hospital) onHospitalSelect(hospital);
    // Pre-fill condition from triage description
    if (description && !patientCondition) {
      setPatientCondition(description);
    }
    setStep(STEPS.PATIENT);
  }

  // ── Create handshake ───────────────────────────────────
  async function handleBookBed(e) {
    e.preventDefault();
    if (!selectedResult || !patientPhone.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // Calculate dynamic hold time based on distance and Lagos traffic
      // Base: 45 min (get ready, gather documents, arrange transport)
      // + traffic-adjusted drive time (Mapbox estimate × 1.5 for Lagos traffic)
      // Clamped between 45 and 180 minutes
      let holdMin = 45; // base: preparation time
      let driveEstimate = null;
      let distanceKm = selectedResult?.distance_km || null;

      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        );
        const pLat = pos.coords.latitude;
        const pLng = pos.coords.longitude;

        // Find hospital coordinates
        const hospital = hospitals.find(h => h.id === selectedResult.hospital_id);
        if (hospital) {
          const token = import.meta.env.VITE_MAPBOX_TOKEN;
          const routeRes = await fetch(
            `https://api.mapbox.com/directions/v5/mapbox/driving/${pLng},${pLat};${hospital.lng},${hospital.lat}?access_token=${token}`
          );
          const routeData = await routeRes.json();
          if (routeData.routes?.[0]?.duration) {
            const rawDriveMin = Math.round(routeData.routes[0].duration / 60);
            // Lagos traffic multiplier: 1.5× for realistic estimate
            driveEstimate = Math.round(rawDriveMin * 1.5);
            // Total: base prep time + traffic-adjusted drive
            holdMin = 45 + driveEstimate;
            holdMin = Math.max(45, Math.min(holdMin, 180));
          }
          if (routeData.routes?.[0]?.distance) {
            distanceKm = Math.round(routeData.routes[0].distance / 1000 * 10) / 10;
          }
        }
      } catch {
        // GPS or Mapbox failed — use default 45 min
      }

      const res = await api.post('/api/handshakes', {
        receiving_hospital_id: selectedResult.hospital_id,
        bed_type: Object.keys(selectedResult.beds || {})[0] || 'emergency',
        requesting_party_type: 'individual',
        requesting_party_phone: patientPhone.trim(),
        patient_summary: `${patientName ? patientName + '. ' : ''}${patientCondition || description || 'Emergency'}`.trim(),
        hold_duration_min: holdMin,
        parsed_requirements: triageAnalysis || undefined,
      });

      setHandshakeId(res.data.handshake_id);
      setTransferCode(res.data.transfer_code);
      setHoldInfo({ minutes: holdMin, driveEstimate, distanceKm });
      setStep(STEPS.TRACKING);

      // Persist to sessionStorage so refresh doesn't lose state
      try {
        sessionStorage.setItem('bedsignal_session', JSON.stringify({
          handshakeId: res.data.handshake_id,
          transferCode: res.data.transfer_code,
          selectedResult,
          patientName: patientName.trim(),
          patientPhone: patientPhone.trim(),
        }));
      } catch {}
    } catch (error) {
      console.error('Bed booking failed:', error);
      setError('Failed to create bed reservation. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Reset everything ───────────────────────────────────
  function handleReset() {
    setStep(STEPS.SEARCH);
    setDescription('');
    setChatMessages(INITIAL_CHAT_MESSAGES);
    setChatInput('');
    setTriageAnalysis(null);
    setSelectedResult(null);
    setPatientName('');
    setPatientPhone('');
    setPatientCondition('');
    setHandshakeId(null);
    setTransferCode(null);
    setTransportId(null);
    setTransportData(null);
    setHoldInfo(null);
    setHoldExtended(false);
    setError(null);
    setCodeCopied(false);
    setClinicResults(null);
    setRerouteResults(null);
    setRerouteLoading(false);
    onClear();

    // Clear persisted session
    try { sessionStorage.removeItem('bedsignal_session'); } catch {}
  }

  function copyCode() {
    if (transferCode) {
      navigator.clipboard.writeText(transferCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }

  async function handleRequestTransport() {
    if (!handshakeId) return;

    setTransportLoading(true);
    setError(null);

    try {
      const { latitude, longitude } = await getCurrentLocation(10000);
      const pickupAddress = await reverseGeocodeLocation(latitude, longitude);
      const res = await api.post('/api/transport/request', {
        handshake_id: handshakeId,
        pickup_lat: latitude,
        pickup_lng: longitude,
        pickup_address: pickupAddress,
      });
      setTransportId(res.data.transport_id);

      // Update sessionStorage with transport ID
      try {
        const saved = sessionStorage.getItem('bedsignal_session');
        if (saved) {
          const s = JSON.parse(saved);
          s.transportId = res.data.transport_id;
          sessionStorage.setItem('bedsignal_session', JSON.stringify(s));
        }
      } catch {}
    } catch (error) {
      console.error('Transport request failed:', error);
      setError(error.response?.data?.detail || 'Failed to request transport.');
    } finally {
      setTransportLoading(false);
    }
  }

  async function handleCancelReservation() {
    if (!handshakeId) return;

    setCancelLoading(true);
    setShowCancelConfirm(false);
    try {
      await api.post(`/api/transport/cancel-reservation/${handshakeId}`);
      handleReset();
    } catch (error) {
      console.error('Cancel failed:', error);
      setError('Failed to cancel. Please try again.');
    } finally {
      setCancelLoading(false);
    }
  }

  // ── Collapsed state ────────────────────────────────────
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        aria-label="Expand search panel"
        aria-expanded={false}
        className="absolute top-6 left-6 z-30 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#0b1220]/95 text-slate-300 shadow-xl shadow-black/40 transition-all duration-200 hover:border-sky-500/30 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060b14]"
      >
        <ChevronRight size={18} />
      </button>
    );
  }

  // Step order arrays
  const isLowUrgency = step === STEPS.LOW_URGENCY;
  const stepLabels = isLowUrgency
    ? ['Search', 'Assessment', 'Clinics']
    : ['Search', 'Select', 'Details', 'Track'];
  const stepOrder = isLowUrgency
    ? [STEPS.SEARCH, STEPS.LOW_URGENCY, STEPS.LOW_URGENCY]
    : [STEPS.SEARCH, STEPS.RESULTS, STEPS.PATIENT, STEPS.TRACKING];
  const currentStepIdx = stepOrder.indexOf(step);

  return (
    <aside className="z-20 flex h-full w-[500px] flex-col rounded-2xl border border-white/[0.06] bg-[#08111d] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-start justify-between px-7 pt-7 pb-4">
        <div className="flex items-center gap-3">
          {step !== STEPS.SEARCH && step !== STEPS.TRACKING && (
            <button
              onClick={() => {
                if (step === STEPS.RESULTS) { setStep(STEPS.SEARCH); onClear(); }
                else if (step === STEPS.LOW_URGENCY) { setStep(STEPS.SEARCH); }
                else if (step === STEPS.PATIENT) setStep(STEPS.RESULTS);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
              aria-label="Go back"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div>
            <h2 className="text-[1.45rem] font-semibold tracking-tight text-white">
              {step === STEPS.SEARCH && 'Find care nearby'}
              {step === STEPS.RESULTS && 'Choose a place'}
              {step === STEPS.LOW_URGENCY && 'Clinic options'}
              {step === STEPS.PATIENT && 'A few details'}
              {step === STEPS.TRACKING && 'Your booking'}
            </h2>
            {step !== STEPS.SEARCH && (
              <p className="mt-1 max-w-[28rem] text-sm leading-snug text-slate-400">
                {step === STEPS.RESULTS && `${searchResults?.length || 0} place${searchResults?.length === 1 ? '' : 's'} found`}
                {step === STEPS.LOW_URGENCY && 'A clinic may be a better fit right now.'}
                {step === STEPS.PATIENT && selectedResult?.name}
                {step === STEPS.TRACKING && (transferCode ? `Booking code: ${transferCode}` : 'Setting things up...')}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Collapse search panel"
          aria-expanded={true}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-all hover:bg-white/5 hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      {/* ── Step indicator ──────────────────────────────── */}
      <nav
        className="px-7 pb-5"
        aria-label="Booking progress"
        role="progressbar"
        aria-valuenow={currentStepIdx + 1}
        aria-valuemin={1}
        aria-valuemax={stepLabels.length}
        aria-label={`Step ${currentStepIdx + 1} of ${stepLabels.length}: ${stepLabels[currentStepIdx]}`}
      >
        <div className="flex gap-2">
          {stepLabels.map((label, i) => {
            const isActive = i <= currentStepIdx;
            const isCurrent = i === currentStepIdx;
            return (
              <div key={label} className="flex-1 flex flex-col gap-1">
                <div
                  className={`h-2.5 rounded-full transition-all duration-500 ${
                    isActive
                      ? isLowUrgency
                        ? 'bg-amber-500'
                        : isCurrent
                          ? 'bg-sky-400 shadow-sm shadow-sky-500/40'
                          : 'bg-sky-500/60'
                      : 'bg-white/[0.08]'
                  }`}
                />
                <p className={`text-[11px] font-medium transition-colors ${
                  isActive
                    ? isLowUrgency ? 'text-amber-300' : 'text-sky-300'
                    : 'text-slate-600'
                }`}>{label}</p>
              </div>
            );
          })}
        </div>
      </nav>

      {/* ── Error ───────────────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="mx-6 mb-4 flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[#070d17]"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── STEP 1: Search ──────────────────────────────── */}
      {step === STEPS.SEARCH && (
        <section aria-label="Search for hospitals" className="flex flex-1 flex-col px-7 pb-7 min-h-0">
          {/* Mode toggle — segmented control */}
          <div
            role="group"
            aria-label="Search mode"
            className="mb-5 grid grid-cols-2 rounded-xl border border-white/[0.08] bg-white/[0.04] p-1"
          >
            <button
              onClick={() => setMode('triage')}
              aria-pressed={mode === 'triage'}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#fcfcf8] ${
                mode === 'triage'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Brain size={14} />
              Tell us what happened
            </button>
            <button
              onClick={() => setMode('quick')}
              aria-pressed={mode === 'quick'}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#fcfcf8] ${
                mode === 'quick'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <MapPin size={14} />
              Find nearby now
            </button>
          </div>

          {mode === 'triage' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c1626]">
              <div className="border-b border-white/[0.06] px-6 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">Vitalinq Care assistant</p>
                  </div>
                  <span className="rounded-md bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-300">
                    Ready
                  </span>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
                <div className="mx-auto flex max-w-[420px] flex-col gap-4">
                  {chatMessages.map((message, idx) => (
                    <div
                      key={`${message.role}-${idx}`}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[92%] rounded-xl px-4 py-3 text-sm leading-7 shadow-sm ${
                          message.role === 'user'
                            ? 'rounded-br-sm bg-sky-500 text-white'
                            : 'rounded-bl-sm border border-white/[0.08] bg-white/[0.05] text-slate-100'
                        }`}
                      >
                        {message.content}
                      </div>
                    </div>
                  ))}

                  {loading && (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-2 rounded-xl rounded-bl-sm border border-white/[0.08] bg-white/[0.05] px-4 py-3 text-sm text-slate-200">
                        <Loader2 size={14} className="motion-reduce:animate-none animate-spin text-sky-400" />
                        Looking for the best next step...
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-white/[0.06] bg-[#0c1626] pt-2 px-6 py-5">
              <form onSubmit={handleTriageSearch} className="mx-auto flex max-w-[420px] flex-col gap-3">
                  <textarea
                    id="triage-chat-input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Message Vitalinq..."
                    rows={2}
                    maxLength={500}
                    className="max-h-32 w-full resize-none overflow-y-auto rounded-[12px] border border-white/[0.08] bg-white/[0.05] px-4 py-3 text-sm leading-6 text-white placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  />
                <button
                  type="submit"
                  disabled={loading || !chatInput.trim()}
                  aria-busy={loading}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-lg bg-sky-500 text-sm font-semibold text-white transition-all duration-200 hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-slate-500 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08111d]"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="motion-reduce:animate-none animate-spin" />
                      Getting a reply...
                    </>
                  ) : (
                    <>
                      <Brain size={16} />
                      Send
                    </>
                  )}
                </button>
              </form>
              </div>
            </div>
          ) : (
            <button
              onClick={handleQuickSearch}
              disabled={loading}
              aria-busy={loading}
              className="flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-lg bg-sky-500 text-sm font-semibold text-white transition-all duration-200 hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-slate-500 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="motion-reduce:animate-none animate-spin" />
                  Searching nearby...
                </>
              ) : (
                <>
                  <MapPin size={16} />
                  Find nearby hospitals
                </>
              )}
            </button>
          )}
        </section>
      )}

      {/* ── STEP 2: Results ─────────────────────────────── */}
      {step === STEPS.RESULTS && (
        <section aria-label="Hospital results" className="flex-1 overflow-y-auto px-7 space-y-3 pb-7">
          {/* Triage analysis — diagnosis chip card */}
          {triageAnalysis && (
            <div className={`mb-1 flex items-start gap-3 rounded-xl p-4 border ${
              triageAnalysis.urgency === 'critical'
                ? 'border-red-500/25 bg-red-500/10'
                : triageAnalysis.urgency === 'high'
                  ? 'border-amber-500/25 bg-amber-500/10'
                  : 'border-sky-500/25 bg-sky-500/10'
            }`}>
              <Brain size={15} className={
                triageAnalysis.urgency === 'critical' ? 'mt-0.5 flex-shrink-0 text-red-500' :
                triageAnalysis.urgency === 'high' ? 'mt-0.5 flex-shrink-0 text-amber-500' :
                'mt-0.5 flex-shrink-0 text-sky-500'
              } />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug text-white">
                  {formatConditionLabel(triageAnalysis.condition_category)}
                </p>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    triageAnalysis.urgency === 'critical' ? 'bg-red-500/15 text-red-300' :
                    triageAnalysis.urgency === 'high' ? 'bg-amber-500/15 text-amber-300' :
                    'bg-emerald-500/15 text-emerald-300'
                  }`}>
                    {formatUrgencyLabel(triageAnalysis.urgency)}
                  </span>
                  {triageAnalysis.required_equipment?.slice(0, 3).map((eq) => (
                    <span key={eq} className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-300">
                      {eq.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Medium urgency advisory */}
          {triageAnalysis?.urgency === 'medium' && (
            <div className="mb-1 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3">
              <p className="flex items-center gap-2 text-xs text-amber-300">
                <AlertTriangle size={12} className="flex-shrink-0" />
                If this feels manageable, a clinic could also help.
              </p>
            </div>
          )}

          {/* Result cards */}
          {searchResults?.map((result, idx) => {
            const beds = result.beds || {};
            const totalAvailable = Object.values(beds).reduce((acc, d) => acc + (d.available || 0), 0);
            return (
              <button
                key={result.hospital_id}
                onClick={() => handleSelectHospital(result)}
                aria-label={`Select ${result.name}, ${totalAvailable} emergency bed${totalAvailable !== 1 ? 's' : ''} available, ${result.distance_km}km away`}
                className="group relative w-full overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.04] p-4 text-left transition-all duration-200 hover:border-sky-500/30 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
              >
                {/* Distance pill — top right */}
                <span className="absolute top-3.5 right-3.5 rounded-md bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-slate-300">
                  {result.distance_km} km away
                </span>

                <div className="flex items-start gap-3 pr-14">
                  {/* Rank badge */}
                  <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    idx === 0 ? 'bg-sky-500 text-white' : 'bg-white/[0.06] text-slate-400'
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="truncate text-sm font-semibold text-white transition-colors group-hover:text-sky-300">
                      {result.name}
                    </h4>

                    {/* Bed availability chips */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(beds).map(([type, data]) => (
                        <span key={type} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          data.available > 0
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : data.overflow > 0
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-red-500/15 text-red-300'
                        }`}>
                          {type.replace(/_/g, ' ')}: {data.available > 0 ? `${data.available} open` : data.overflow > 0 ? `${data.overflow} limited` : 'full'}
                        </span>
                      ))}
                    </div>

                    {/* Trust + freshness row */}
                    <div className="mt-2.5 flex items-center gap-2">
                      {result.trust_tier === 'verified' && (
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                          Confirmed recently
                        </span>
                      )}
                      {result.trust_tier === 'unverified' && (
                        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300">
                          Needs a quick check
                        </span>
                      )}
                      {result.freshness_hours != null && (
                        <span className="text-[11px] text-slate-500">
                          Updated {result.freshness_hours < 1 ? `${Math.round(result.freshness_hours * 60)} min ago` : `${Math.round(result.freshness_hours)} hr ago`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {searchResults?.length === 0 && (
            <div className="text-center py-12">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05]">
                <MapPin size={20} className="text-slate-500" />
              </div>
              <p className="text-sm font-medium text-slate-200">No nearby hospitals found</p>
              <p className="mt-1 text-xs text-slate-500">Try again and allow a wider search area.</p>
            </div>
          )}
        </section>
      )}

      {/* ── STEP 2b: Low Urgency — Clinic Redirect ──────── */}
      {step === STEPS.LOW_URGENCY && (
        <section aria-label="Non-emergency clinic options" className="flex-1 overflow-y-auto px-7 pb-7 space-y-3">
          {/* Triage analysis */}
          {triageAnalysis && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-300">
                <Brain size={12} /> What we noticed
              </p>
              <p className="text-sm font-semibold text-white">
                {formatConditionLabel(triageAnalysis.condition_category)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  {formatUrgencyLabel(triageAnalysis.urgency)}
                </span>
              </div>
            </div>
          )}

          {/* Advisory card */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
              <AlertTriangle size={12} /> Good news
            </p>
            <p className="text-sm leading-relaxed text-slate-200">
              This may not need emergency hospital care. A nearby clinic or pharmacy could be the right next step.
            </p>

            {/* Self-care advice */}
            {triageAnalysis?.self_care_advice?.length > 0 && (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <p className="mb-2 text-xs font-semibold text-slate-400">Self-care tips</p>
                <ul className="space-y-1.5">
                  {triageAnalysis.self_care_advice.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-slate-300">
                      <span className="mt-1 flex-shrink-0 text-slate-500">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] italic text-slate-500">
                  If symptoms worsen, seek medical attention immediately.
                </p>
              </div>
            )}
          </div>

          {/* Clinic results */}
          {clinicResults && clinicResults.length > 0 && (
            <>
              <p className="text-xs font-medium text-slate-400">Nearby clinics and pharmacies</p>
              {clinicResults.map((clinic) => (
                <div
                  key={clinic.id}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-4"
                >
                  <h4 className="text-sm font-semibold text-white">{clinic.name}</h4>
                  {clinic.address && (
                    <address className="mt-1 text-xs not-italic text-slate-400">{clinic.address}</address>
                  )}
                  <div className="flex gap-2 mt-3">
                    {clinic.phone && (
                      <a
                        href={`tel:${clinic.phone}`}
                        className="flex min-h-[42px] flex-1 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.05] py-2.5 text-center text-xs font-semibold text-slate-200 transition-all hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#070d17]"
                        onClick={e => e.stopPropagation()}
                      >
                        Call
                      </a>
                    )}
                    <a
                      href={`https://maps.google.com/maps?daddr=${encodeURIComponent(clinic.address || clinic.name + ' Lagos')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[42px] flex-1 items-center justify-center rounded-lg bg-sky-500 py-2.5 text-center text-xs font-semibold text-white transition-all hover:bg-sky-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#070d17]"
                      onClick={e => e.stopPropagation()}
                    >
                      Get directions
                    </a>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Override button */}
          <button
            onClick={() => {
              // Re-run triage search but force medium urgency
              if (triageAnalysis) {
                triageAnalysis.urgency = 'medium';
                setTriageAnalysis({ ...triageAnalysis });
              }
              // Re-trigger search — use the existing triage results but go to normal results
              setLoading(true);
              (async () => {
                try {
                  const { latitude, longitude } = await getCurrentLocation();

                  const res = await api.post('/api/search/triage', {
                    description: description.trim() || summarizeConversation(chatMessages),
                    latitude,
                    longitude,
                    radius_km: 20,
                  });
                  onResults(res.data.results);
                  setStep(STEPS.RESULTS);
                } catch (error) {
                  console.error('Clinic fallback search failed:', error);
                  setError('Search failed.');
                } finally {
                  setLoading(false);
                }
              })();
            }}
            className="mt-1 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 text-sm font-semibold text-red-300 transition-all hover:bg-red-500/15 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
          >
            <AlertTriangle size={14} />
            I still need a hospital
          </button>
        </section>
      )}

      {/* ── STEP 3: Patient Details ─────────────────────── */}
      {step === STEPS.PATIENT && (
        <section aria-label="Patient information" className="px-7 flex-1 overflow-y-auto pb-7">
          {/* Selected hospital summary */}
          {selectedResult && (
            <div className="mb-5 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white">{selectedResult.name}</h4>
                <span className="rounded-md bg-white/[0.06] px-2.5 py-1 text-[11px] text-slate-300">{selectedResult.distance_km} km</span>
              </div>
              {selectedResult.address && (
                <address className="mt-1.5 text-xs not-italic text-slate-400">{selectedResult.address}</address>
              )}
            </div>
          )}

          <form onSubmit={handleBookBed} className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="patient-name" className="mb-2 block text-sm font-medium text-slate-200">
                Person's name
              </label>
              <div className="relative">
                <User size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="patient-name"
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="h-[50px] w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="patient-phone" className="mb-2 block text-sm font-medium text-slate-200">
                Phone number <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Phone size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="patient-phone"
                  type="tel"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  placeholder="+234..."
                  required
                  className="h-[50px] w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                <span className="w-2 h-2 rounded-full bg-[#25D366] flex-shrink-0" />
                We may use this number to contact you with updates.
              </p>
            </div>

            {/* Condition */}
            <div>
              <label htmlFor="patient-condition" className="mb-2 block text-sm font-medium text-slate-200">
                What should they know?
              </label>
              <div className="relative">
                <FileText size={15} className="pointer-events-none absolute left-4 top-4 text-slate-500" />
                <textarea
                  id="patient-condition"
                  value={patientCondition}
                  onChange={(e) => setPatientCondition(e.target.value)}
                  placeholder="Example: 68 years old, fell from a height, bleeding from the head"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.04] pl-10 pr-4 pt-3 pb-3 text-sm leading-relaxed text-white placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !patientPhone.trim()}
              aria-busy={loading}
              className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-lg bg-sky-500 text-sm font-semibold text-white transition-all duration-200 hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-slate-500 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="motion-reduce:animate-none animate-spin" />
                  Saving your request...
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Save my spot
                </>
              )}
            </button>
          </form>
        </section>
      )}

      {/* ── STEP 4: Live Status Tracker ─────────────────── */}
      {step === STEPS.TRACKING && (
        <section
          aria-label="Reservation status"
          className="px-7 flex-1 overflow-y-auto pb-7"
        >
          {/* Transfer code card */}
          {transferCode && (
            <div className={`relative mb-4 rounded-xl p-5 text-center ${
              handshake?.status === 'accepted'
                ? 'border-2 border-sky-400/35 bg-sky-500/10'
                : 'border border-white/[0.08] bg-white/[0.04]'
            }`}>
              {/* Pulsing halo when accepted */}
              {handshake?.status === 'accepted' && (
                <div className="absolute inset-0 rounded-xl border-2 border-sky-400/20 motion-reduce:hidden animate-ping opacity-40 pointer-events-none" />
              )}
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-400">Booking code</p>
              <div className="flex items-center justify-center gap-3">
                <span className="text-4xl font-mono font-bold tracking-[0.2em] text-white">
                  {transferCode}
                </span>
                <button
                  onClick={copyCode}
                  aria-label="Copy booking code"
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-slate-400 transition-all hover:bg-white/[0.1] hover:text-white focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#070d17]"
                >
                  {codeCopied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                </button>
              </div>
              <p
                aria-live="polite"
                className="mt-3 text-[11px] text-slate-400"
              >
                {codeCopied ? 'Copied' : 'Show this code when you arrive'}
              </p>
            </div>
          )}

          {/* Hospital contact card */}
          {selectedResult && (
            <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
              <h4 className="text-sm font-semibold text-white">{selectedResult.name}</h4>
              {selectedResult.address && (
                <address className="mt-1.5 text-xs not-italic leading-relaxed text-slate-400">{selectedResult.address}</address>
              )}
              {selectedResult.phone && (
                <a
                  href={`tel:${selectedResult.phone}`}
                  className="mt-3 flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.05] px-3.5 py-2.5 transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#070d17]"
                >
                  <Phone size={14} className="text-sky-400" />
                  <span className="text-sm font-medium text-slate-100">{selectedResult.phone}</span>
                  <span className="ml-auto text-[10px] text-slate-500">Tap to call</span>
                </a>
              )}
            </div>
          )}

          {/* Countdown timer for accepted */}
          {handshake?.status === 'accepted' && countdown > 0 && (
            <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3.5">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-amber-300">Spot held for</p>
                  <p className="mt-0.5 text-3xl font-mono font-bold tabular-nums text-amber-300">
                    {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                  </p>
                </div>
                <Clock size={24} className="flex-shrink-0 text-amber-400" />
                <p className="max-w-[80px] text-[10px] leading-snug text-amber-300">Please arrive before time runs out</p>
              </div>
              {holdInfo && !holdExtended && (
                <p className="mt-2 border-t border-amber-500/15 pt-2 text-[10px] text-amber-400/70">
                  Hold estimate: {holdInfo.minutes} min
                  {holdInfo.driveEstimate ? ` (${holdInfo.driveEstimate} min drive + 45 min prep)` : ' (base preparation time)'}
                  {holdInfo.distanceKm ? ` · ${holdInfo.distanceKm} km away` : ''}
                </p>
              )}
              {holdExtended && (
                <p className="mt-2 border-t border-emerald-500/15 pt-2 text-[10px] text-emerald-400">
                  🚑 Hold extended to 60 minutes — transport is on the way
                </p>
              )}
            </div>
          )}

          {/* Status display */}
          <div
            role="status"
            aria-live="polite"
            aria-label="Reservation status updates"
          >
            {/* Completed — full arrival confirmation */}
            {handshake?.status === 'completed' ? (
              <div className="text-center py-6">
                {/* Success circle */}
                <div className="relative w-20 h-20 mx-auto mb-5">
                  <div className="absolute inset-0 bg-emerald-500/10 rounded-full border-2 border-emerald-500/30 motion-reduce:hidden animate-ping opacity-30" />
                  <div className="relative w-20 h-20 bg-emerald-500/15 border-2 border-emerald-500/40 rounded-full flex items-center justify-center">
                    <CheckCircle2 size={36} className="text-emerald-400" />
                  </div>
                </div>

                <h3 className="mb-2 text-xl font-bold text-white">Arrival confirmed</h3>
                <p className="mb-5 text-sm leading-relaxed text-slate-400">
                  You have been checked in at<br />
                  <span className="font-semibold text-white">{selectedResult?.name || 'the hospital'}</span>
                </p>

                <div className="mb-5 inline-block rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-5 py-4">
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-emerald-300">Booking code</p>
                  <p className="text-2xl font-mono font-bold tracking-[0.2em] text-emerald-300">{transferCode}</p>
                </div>

                <p className="mb-6 text-xs leading-relaxed text-slate-400">
                  The hospital has confirmed your code.<br />
                  Wishing you a smooth recovery.
                </p>

                <button
                  onClick={handleReset}
                  className="rounded text-sm text-slate-400 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
                >
                  Close
                </button>
              </div>
            ) : (
              /* Vertical timeline tracker */
              <div className="space-y-0 pb-2">
                <StatusStep
                  label="Reservation created"
                  status="done"
                  detail={selectedResult?.name}
                  icon={BedDouble}
                />
                <StatusStep
                  label="Hospital has been notified"
                  status="done"
                  icon={Bell}
                />
                <StatusStep
                  label="Waiting for hospital response"
                  status={
                    !handshake || handshake.status === 'requested' ? 'active' :
                    handshake.status === 'accepted' ? 'done' :
                    handshake.status === 'declined' ? 'failed' : 'done'
                  }
                  detail={
                    !handshake || handshake.status === 'requested'
                      ? 'This usually takes 1 to 3 minutes.'
                      : undefined
                  }
                  isLast={!handshake || handshake.status === 'requested'}
                  icon={Clock}
                />

                {(handshake?.status === 'accepted' || hasAmbulanceReroute) && (
                  <>
                    <StatusStep
                      label={hasAmbulanceReroute ? 'Bed was reassigned' : 'Bed confirmed!'}
                      status={hasAmbulanceReroute ? 'failed' : 'done'}
                      detail={
                        hasAmbulanceReroute
                          ? `Your ambulance has been rerouted to ${transportData?._hospital?.name || 'a new hospital'}`
                          : `Held for ~${holdInfo?.minutes || Math.ceil((countdown || 0) / 60) || 45} min${holdInfo?.driveEstimate ? ` (${holdInfo.driveEstimate} min drive + 45 min prep)` : ''}`
                      }
                      highlight
                      icon={CheckCircle2}
                    />

                    {/* Ambulance tracking — second to last */}
                    {transportData && (
                      <StatusStep
                        label={
                          transportData.status === 'asking_hospital' ? 'Checking whether the hospital can send transport' :
                          transportData.status === 'asking_dispatch' ? 'Checking ambulance services nearby' :
                          transportData.status === 'hospital_accepted' ? 'The hospital is sending transport' :
                          transportData.status === 'dispatch_accepted' ? 'An ambulance is on the way' :
                          transportData.status === 'rerouted' ? '🔄 Ambulance rerouted' :
                          transportData.status === 'no_ambulance' ? 'No ambulance is available right now' :
                          'Transport requested'
                        }
                        status={
                          transportData.status === 'asking_hospital' || transportData.status === 'asking_dispatch' ? 'active' :
                          transportData.status === 'hospital_accepted' || transportData.status === 'dispatch_accepted' || transportData.status === 'rerouted' ? 'done' :
                          transportData.status === 'no_ambulance' ? 'failed' : 'active'
                        }
                        detail={
                          transportData.status === 'hospital_accepted' && transportData.crew_phone
                            ? `Call them: ${transportData.crew_phone}`
                            : transportData.status === 'dispatch_accepted'
                            ? `${transportData._company?.name || 'Ambulance service'} — ${transportData._ambulance?.vehicle_id || 'ambulance'}`
                            : transportData.status === 'rerouted'
                            ? `Now heading to ${transportData._hospital?.name || 'new hospital'}`
                            : transportData.status === 'no_ambulance'
                            ? 'Call LASEMA: 767 or 112'
                            : undefined
                        }
                      />
                    )}

                    {/* Dispatch delivery tracker inline */}
                    {(transportData?.status === 'dispatch_accepted' || transportData?.status === 'rerouted') && (() => {
                      const STAGES = [
                        { id: 'assigned', icon: Ambulance, label: 'Ambulance assigned' },
                        { id: 'dispatched', icon: Ambulance, label: 'Ambulance dispatched' },
                        { id: 'en_route_to_patient', icon: Navigation, label: 'Heading to patient' },
                        { id: 'at_scene', icon: LocateFixed, label: 'Arrived at pickup point' },
                        { id: 'en_route_to_hospital', icon: Building2, label: 'Heading to hospital' },
                        { id: 'delivered', icon: CheckCircle2, label: 'Arrived at hospital' },
                      ];
                      const timeline = transportData._timeline || [];
                      const completedStatuses = new Set(timeline.map(t => t.status));
                      const assignmentStatus = transportData._assignment_status || 'assigned';
                      const currentIdx = STAGES.findIndex(s => s.id === assignmentStatus);

                      return (
                        <div className="ml-8 mb-4 rounded-lg border border-white/[0.08] bg-[#0c1322] px-4 py-4">
                          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Ambulance progress</p>
                          {STAGES.filter((s, i) => i === 0 || s.id !== 'dispatched').map((stage, i) => {
                            const timeEntry = timeline.find(t => t.status === stage.id);
                            const stageIdx = STAGES.findIndex(s => s.id === stage.id);
                            const isDone = stageIdx <= currentIdx || completedStatuses.has(stage.id);
                            const isCurrent = stage.id === assignmentStatus;
                            const StageIcon = stage.icon;

                            return (
                              <div key={stage.id} className="flex items-start gap-3">
                                <div className="flex flex-col items-center">
                                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border ${
                                    isDone
                                      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                                      : isCurrent
                                        ? 'border-sky-400/40 bg-sky-500/15 text-sky-300'
                                        : 'border-white/[0.08] bg-white/[0.04] text-slate-500'
                                  } ${isCurrent ? 'ring-2 ring-sky-400/20' : ''}`}>
                                    <StageIcon size={16} strokeWidth={2.2} />
                                  </div>
                                  {i < 4 && (
                                    <div className={`mt-2 w-px h-6 ${isDone && !isCurrent ? 'bg-emerald-400/50' : 'bg-white/[0.08]'}`} />
                                  )}
                                </div>
                                <div className="pt-1 pb-2">
                                  <p className={`text-sm font-medium leading-snug ${
                                    isDone ? 'text-white' : isCurrent ? 'text-sky-200' : 'text-slate-400'
                                  }`}>
                                    {stage.label}
                                  </p>
                                  {timeEntry && (
                                    <p className="mt-1 text-xs text-slate-500">
                                      {new Date(timeEntry.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {transportData.crew_phone && (
                            <p className="mt-2 border-t border-white/[0.08] pt-3 text-sm text-slate-400">
                              Crew phone: <span className="text-white">{transportData.crew_phone}</span>
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Reroute alert */}
                    {transportData?._rerouted && (
                      <div className="ml-8 mb-3 rounded-2xl bg-red-500/[0.06] border border-red-500/20 px-4 py-3">
                        <p className="text-red-400 text-[10px] font-semibold uppercase tracking-wider">⚠️ Destination Changed</p>
                        <p className="text-gray-300 text-xs mt-1.5 leading-relaxed">{transportData._reroute_note || 'The original hospital overrode your bed. Your ambulance is being rerouted.'}</p>
                        {transportData._hospital && (
                          <p className="text-white text-sm font-semibold mt-2">
                            New destination: {transportData._hospital.name}
                          </p>
                        )}
                      </div>
                    )}

                    <StatusStep
                      label="Awaiting your arrival"
                      status="active"
                      detail="Show your booking code when you arrive"
                      isLast
                      icon={MapPinned}
                    />
                  </>
                )}

                {handshake?.status === 'completed' && (
                  <>
                    <StatusStep label="Bed confirmed!" status="done" />
                    <StatusStep
                      label="Arrival confirmed"
                      status="done"
                      detail="You've been admitted. Wishing a speedy recovery."
                      highlight
                      isLast
                      icon={CheckCircle2}
                    />
                  </>
                )}

                {handshake?.status === 'declined' && (
                  <StatusStep
                    label="Hospital could not hold a bed"
                    status="failed"
                    detail={
                      {
                        no_beds: 'All beds are full right now.',
                        wrong_specialty: "This hospital may not have the care you need.",
                        equipment_unavailable: 'Important equipment is not available right now.',
                        too_severe: 'A higher-level hospital may be safer for this case.',
                        too_minor: 'This may not need hospital care.',
                      }[handshake.declined_reason] || handshake.declined_reason || 'Try another hospital'
                    }
                    isLast
                    icon={ShieldAlert}
                  />
                )}

                {handshake?.status === 'expired' && (
                  <StatusStep
                    label="Reservation expired"
                    status="failed"
                    detail="The hold time ran out"
                    isLast
                    icon={Clock}
                  />
                )}

                {handshake?.status === 'overridden' && !hasAmbulanceReroute && (
                  <>
                    <StatusStep
                      label="The saved bed was reassigned"
                      status="failed"
                      detail="A walk-in emergency needed immediate care. We know this is frustrating."
                      icon={RefreshCcw}
                    />
                    {rerouteLoading && (
                      <StatusStep
                        label="Looking for another hospital"
                        status="active"
                        detail="You do not need to do anything right now."
                        icon={RefreshCcw}
                      />
                    )}
                    {rerouteResults && rerouteResults.length > 0 && (
                      <StatusStep
                        label={`We found ${rerouteResults.length} other option${rerouteResults.length > 1 ? 's' : ''}`}
                        status="done"
                        detail="Choose one and we will try to save a spot there."
                        highlight
                        isLast
                        icon={MapPin}
                      />
                    )}
                    {rerouteResults && rerouteResults.length === 0 && (
                      <StatusStep
                        label="No other nearby hospitals found"
                        status="failed"
                        detail="Please search again and try a wider area."
                        isLast
                        icon={MapPin}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Reroute results for overridden */}
          {handshake?.status === 'overridden' && !hasAmbulanceReroute && rerouteResults && rerouteResults.length > 0 && (
            <div className="mt-4">
              <p className="mb-2.5 text-xs font-medium text-slate-400">Other hospitals you can try:</p>
              <div className="space-y-2">
                {rerouteResults.map((result, idx) => {
                  const beds = result.beds || {};
                  const totalAvail = Object.values(beds).reduce((acc, d) => acc + (d.available || 0), 0);
                  return (
                    <button
                      key={result.hospital_id}
                      onClick={() => {
                        // Select this hospital and go to patient details
                        setSelectedResult(result);
                        const hospital = hospitals.find(h => h.id === result.hospital_id);
                        if (hospital) onHospitalSelect(hospital);
                        setHandshakeId(null);
                        setTransferCode(null);
                        setRerouteResults(null);
                        if (description && !patientCondition) {
                          setPatientCondition(description);
                        }
                        setStep(STEPS.PATIENT);
                      }}
                      aria-label={`Select ${result.name}, ${totalAvail} emergency beds available, ${result.distance_km}km away`}
                      className="group w-full rounded-lg border border-white/[0.08] bg-white/[0.04] p-3.5 text-left transition-all hover:border-sky-500/30 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5 ${
                          idx === 0 ? 'bg-sky-500 text-white' : 'bg-white/[0.06] text-slate-400'
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="truncate text-sm font-medium text-white transition-colors group-hover:text-sky-300">
                              {result.name}
                            </h4>
                            <span className="flex-shrink-0 text-[11px] text-slate-500">{result.distance_km} km</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {Object.entries(beds).map(([type, data]) => (
                              <span key={type} className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                data.available > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                              }`}>
                                {type.replace(/_/g, ' ')}: {data.available || 0}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions based on status */}
          {handshake?.status === 'accepted' && selectedResult && (
            <div className="mt-4 space-y-2.5">
              <div className="flex gap-2.5">
                <a
                  href={`https://maps.google.com/maps?daddr=${selectedResult.address || selectedResult.name + ' Lagos'}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-lg bg-sky-500 text-sm font-semibold text-white transition-all hover:bg-sky-400 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
                >
                  <Navigation size={15} />
                  Get directions
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    `🏥 BedSignal — Bed Reserved\n\n` +
                    `Hospital: ${selectedResult.name}\n` +
                    `Transfer Code: ${transferCode}\n` +
                    `Address: ${selectedResult.address || ''}\n\n` +
                    `Directions: https://maps.google.com/maps?daddr=${encodeURIComponent(selectedResult.address || selectedResult.name + ' Lagos')}\n\n` +
                    `Show the transfer code on arrival.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.05] text-sm font-semibold text-slate-100 transition-all hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  Share details
                </a>
              </div>

              <button
                onClick={handleRequestTransport}
                disabled={transportLoading || !!transportId}
                className="flex min-h-[46px] w-full items-center justify-center gap-2.5 rounded-lg border border-red-500/25 bg-red-500/10 text-sm font-semibold text-red-300 transition-all hover:bg-red-500/15 disabled:border-white/[0.06] disabled:bg-white/[0.05] disabled:text-slate-500 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
              >
                {transportLoading ? (
                  <>
                    <Loader2 size={16} className="motion-reduce:animate-none animate-spin" />
                    Requesting transport...
                  </>
                ) : transportId ? (
                  <>Transport requested</>
                ) : (
                  <>I need transport</>
                )}
              </button>

              <button
                onClick={() => setShowCancelConfirm(true)}
                disabled={cancelLoading}
                className="mt-2 w-full text-center text-xs text-slate-500 transition-colors hover:text-red-400 disabled:text-slate-700"
              >
                {cancelLoading ? 'Cancelling...' : 'Cancel reservation'}
              </button>
            </div>
          )}

          {(handshake?.status === 'declined' || handshake?.status === 'expired' || handshake?.status === 'overridden') && (
            <button
              onClick={handleReset}
              className="mt-4 min-h-[46px] w-full rounded-lg bg-sky-500 text-sm font-semibold text-white transition-all hover:bg-sky-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
            >
              Search again
            </button>
          )}
        </section>
      )}

      {/* ── Footer ──────────────────────────────────────── */}
      <div className="border-t border-white/[0.06] px-6 py-4">
        {step === STEPS.TRACKING ? (
          <button
            onClick={handleReset}
            className="w-full rounded text-center text-xs text-slate-400 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d17]"
          >
            Start a new search
          </button>
        ) : (
          <p className="text-center text-[11px] text-slate-500">
            If this is life-threatening, call your local emergency number right away.
          </p>
        )}
      </div>

      {/* ── Cancel Confirmation Modal ──────────────────── */}
      {showCancelConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCancelConfirm(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d1320] p-6 shadow-2xl">
            <h3 className="text-white text-sm font-semibold mb-2">Cancel reservation?</h3>
            <p className="text-slate-400 text-xs leading-relaxed mb-5">
              This will release your bed hold{transportId ? ', stop any ambulance that was dispatched,' : ''} and notify the hospital. This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 min-h-[40px] rounded-lg border border-white/10 bg-white/5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
              >
                Keep reservation
              </button>
              <button
                onClick={handleCancelReservation}
                disabled={cancelLoading}
                className="flex-1 min-h-[40px] rounded-lg bg-red-500 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:bg-red-500/50 flex items-center justify-center gap-1.5"
              >
                {cancelLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}


/**
 * StatusStep — single step in the vertical timeline status tracker.
 */
function StatusStep({ label, status, detail, highlight, isLast, icon: Icon }) {
  const nodeStyle = {
    done: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300',
    active: 'border-sky-400/40 bg-sky-500/15 text-sky-300',
    failed: 'border-red-400/40 bg-red-500/15 text-red-200',
    pending: 'border-white/[0.08] bg-white/[0.04] text-slate-500',
  }[status] || 'bg-transparent border-white/[0.12]';

  const nodeIcon = {
    done: Icon ? <Icon size={16} strokeWidth={2.2} /> : <Check size={15} strokeWidth={2.8} />,
    active: Icon ? <Icon size={16} strokeWidth={2.2} /> : null,
    failed: Icon ? <Icon size={16} strokeWidth={2.2} /> : <X size={15} strokeWidth={2.8} />,
    pending: null,
  }[status];

  const labelColor = {
    done: 'text-slate-100',
    active: 'text-sky-300',
    failed: 'text-red-700',
    pending: 'text-slate-500',
  }[status] || 'text-slate-500';

  return (
    <div className={`flex items-stretch gap-3 ${highlight ? 'relative' : ''}`}>
      {/* Left column: connector line + node */}
      <div className="flex w-10 flex-shrink-0 flex-col items-center">
        {/* Node circle */}
        <div className={`relative z-10 mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border ${nodeStyle}`}>
          {nodeIcon}
          {/* Pulsing ring for active */}
          {status === 'active' && (
            <div className="absolute inset-0 rounded-full border border-sky-400 motion-reduce:hidden animate-ping opacity-60" />
          )}
        </div>
        {/* Connector line below */}
        {!isLast && <div className="mt-2 w-px flex-1 bg-white/[0.08]" style={{ minHeight: '22px' }} />}
      </div>

      {/* Right column: label + detail */}
      <div className={`flex-1 pb-5 ${isLast ? 'pb-2' : ''} ${highlight ? 'mb-4 -mt-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5' : ''}`}>
        <p className={`text-sm font-medium leading-snug ${labelColor}`}>
          {label}
        </p>
        {detail && (
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{detail}</p>
        )}
      </div>
    </div>
  );
}