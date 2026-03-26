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
  CheckCircle2, Clock, XCircle, Navigation, Copy, Check
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
    content: 'Tell me what happened in your own words. I’ll ask follow-up questions if anything is unclear, then I can find and reserve a bed near you.',
  },
];

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

  // Live status polling
  const { handshake, loading: handshakeLoading, countdown } = useHandshake(handshakeId);

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
          } catch (_) {}

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
  }, [handshake?.status]);

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
              }).catch(() => {}); // silent fail
            },
            () => {},
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
  }, [handshake?.status === 'accepted']);

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
    } catch (_) {}

    return { latitude, longitude };
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
    } catch (err) {
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
    } catch (err) {
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
      // Get patient's current location for drive time calculation
      let holdMin = 45; // default fallback
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
            const driveMin = Math.round(routeData.routes[0].duration / 60);
            holdMin = driveMin + 15; // drive time + 15 min buffer
            holdMin = Math.max(20, Math.min(holdMin, 180));
          }
        }
      } catch (_) {
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
      setStep(STEPS.TRACKING);
    } catch (err) {
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
    setError(null);
    setCodeCopied(false);
    setClinicResults(null);
    setRerouteResults(null);
    setRerouteLoading(false);
    onClear();
  }

  function copyCode() {
    if (transferCode) {
      navigator.clipboard.writeText(transferCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }

  // ── Collapsed state ────────────────────────────────────
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        aria-label="Expand search panel"
        aria-expanded={false}
        className="absolute top-5 left-5 z-30 w-11 h-11 bg-[#08090f]/95 backdrop-blur-md border border-white/10 text-gray-300 flex items-center justify-center rounded-2xl hover:bg-[#0f1420] hover:border-sky-500/40 hover:text-white transition-all duration-200 shadow-xl shadow-black/50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
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
    <div className="w-[390px] h-full bg-[#08090f] border-r border-white/[0.06] flex flex-col z-20 relative shadow-2xl shadow-black/60">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {step !== STEPS.SEARCH && step !== STEPS.TRACKING && (
            <button
              onClick={() => {
                if (step === STEPS.RESULTS) { setStep(STEPS.SEARCH); onClear(); }
                else if (step === STEPS.LOW_URGENCY) { setStep(STEPS.SEARCH); }
                else if (step === STEPS.PATIENT) setStep(STEPS.RESULTS);
                else if (step === STEPS.TRACKING) {} // Can't go back from tracking
              }}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
              aria-label="Go back"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div>
            <h2 className="text-white text-[15px] font-semibold tracking-tight">
              {step === STEPS.SEARCH && 'Find a hospital'}
              {step === STEPS.RESULTS && 'Choose a hospital'}
              {step === STEPS.LOW_URGENCY && 'Non-emergency care'}
              {step === STEPS.PATIENT && 'Patient details'}
              {step === STEPS.TRACKING && 'Bed reservation'}
            </h2>
            <p className="text-gray-500 text-xs mt-0.5 leading-snug">
              {step === STEPS.SEARCH && 'Describe the emergency or search nearby'}
              {step === STEPS.RESULTS && `${searchResults?.length || 0} hospitals found`}
              {step === STEPS.LOW_URGENCY && 'We recommend a clinic for your situation'}
              {step === STEPS.PATIENT && selectedResult?.name}
              {step === STEPS.TRACKING && (transferCode ? `Code: ${transferCode}` : 'Creating reservation...')}
            </p>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Collapse search panel"
          aria-expanded={true}
          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      {/* ── Step indicator ──────────────────────────────── */}
      <nav
        className="px-5 pb-4"
        aria-label="Booking progress"
        role="progressbar"
        aria-valuenow={currentStepIdx + 1}
        aria-valuemin={1}
        aria-valuemax={stepLabels.length}
        aria-label={`Step ${currentStepIdx + 1} of ${stepLabels.length}: ${stepLabels[currentStepIdx]}`}
      >
        <div className="flex gap-1.5">
          {stepLabels.map((label, i) => {
            const isActive = i <= currentStepIdx;
            const isCurrent = i === currentStepIdx;
            return (
              <div key={label} className="flex-1 flex flex-col gap-1">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    isActive
                      ? isLowUrgency
                        ? 'bg-amber-500'
                        : isCurrent
                          ? 'bg-sky-400 shadow-sm shadow-sky-500/50'
                          : 'bg-sky-500/70'
                      : 'bg-white/[0.06]'
                  }`}
                />
                <p className={`text-[10px] font-medium transition-colors ${
                  isActive
                    ? isLowUrgency ? 'text-amber-400' : 'text-sky-400'
                    : 'text-gray-700'
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
          className="mx-5 mb-4 bg-red-500/10 border border-red-500/25 text-red-300 text-sm px-4 py-3 rounded-xl flex items-center gap-2.5"
        >
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="w-6 h-6 flex items-center justify-center hover:bg-red-500/20 rounded transition-colors focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[#08090f]"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── STEP 1: Search ──────────────────────────────── */}
      {step === STEPS.SEARCH && (
        <section aria-label="Search for hospitals" className="px-5 flex-1 flex flex-col">
          {/* Mode toggle — segmented control */}
          <div
            role="group"
            aria-label="Search mode"
            className="flex bg-white/[0.04] border border-white/[0.07] rounded-2xl p-1 mb-5"
          >
            <button
              onClick={() => setMode('triage')}
              aria-pressed={mode === 'triage'}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#08090f] ${
                mode === 'triage'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Brain size={14} />
              Smart Triage
            </button>
            <button
              onClick={() => setMode('quick')}
              aria-pressed={mode === 'quick'}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#08090f] ${
                mode === 'quick'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <MapPin size={14} />
              Nearby
            </button>
          </div>

          {mode === 'triage' ? (
            <div className="flex flex-1 flex-col min-h-0">
              <div className="mb-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-gray-300 text-sm font-medium">AI triage chat</p>
                    <p className="text-gray-600 text-[11px] mt-1">Freeform like WhatsApp. The bot asks only when it needs one more detail.</p>
                  </div>
                  <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300">
                    Live
                  </span>
                </div>

                <div className="max-h-[320px] overflow-y-auto space-y-3 pr-1">
                  {chatMessages.map((message, idx) => (
                    <div
                      key={`${message.role}-${idx}`}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-3 text-sm leading-relaxed ${
                          message.role === 'user'
                            ? 'bg-sky-500 text-white rounded-br-md'
                            : 'bg-white/[0.05] border border-white/[0.08] text-gray-200 rounded-bl-md'
                        }`}
                      >
                        {message.content}
                      </div>
                    </div>
                  ))}

                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-white/[0.05] border border-white/[0.08] text-gray-300 rounded-2xl rounded-bl-md px-3.5 py-3 text-sm flex items-center gap-2">
                        <Loader2 size={14} className="motion-reduce:animate-none animate-spin text-sky-400" />
                        Thinking through the next step...
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  'My dad fell off the roof and is bleeding from his head',
                  'My child ate something under the sink',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setChatInput(prompt)}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-left text-[11px] leading-snug text-gray-400 hover:border-sky-500/30 hover:text-gray-200 transition-all"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <form onSubmit={handleTriageSearch} className="flex flex-col gap-3">
                <div>
                  <label htmlFor="triage-chat-input" className="block text-gray-300 text-sm font-medium mb-2">
                    Reply to the triage bot
                  </label>
                  <textarea
                    id="triage-chat-input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type what happened, symptoms, age, or answer the bot’s question..."
                    rows={3}
                    maxLength={500}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] rounded-xl px-4 py-3.5 text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/30 transition-all leading-relaxed focus-visible:ring-2 focus-visible:ring-sky-500"
                  />
                  <p className="text-gray-700 text-[11px] mt-1.5 text-right">
                    {chatInput.length}/500
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={loading || !chatInput.trim()}
                  aria-busy={loading}
                  className="w-full min-h-[52px] bg-sky-500 hover:bg-sky-400 disabled:bg-white/[0.05] disabled:text-gray-600 disabled:cursor-not-allowed text-white text-[15px] font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 shadow-lg shadow-sky-500/20 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="motion-reduce:animate-none animate-spin" />
                      Waiting for triage bot...
                    </>
                  ) : (
                    <>
                      <Brain size={16} />
                      Send message
                    </>
                  )}
                </button>
              </form>
            </div>
          ) : (
            <button
              onClick={handleQuickSearch}
              disabled={loading}
              aria-busy={loading}
              className="w-full min-h-[52px] bg-sky-500 hover:bg-sky-400 disabled:bg-white/[0.05] disabled:text-gray-600 disabled:cursor-not-allowed text-white text-[15px] font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 shadow-lg shadow-sky-500/20 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="motion-reduce:animate-none animate-spin" />
                  Searching nearby...
                </>
              ) : (
                <>
                  <MapPin size={16} />
                  Find hospitals near me
                </>
              )}
            </button>
          )}
        </section>
      )}

      {/* ── STEP 2: Results ─────────────────────────────── */}
      {step === STEPS.RESULTS && (
        <section aria-label="Hospital results" className="flex-1 overflow-y-auto px-5 space-y-2.5">
          {/* Triage analysis — diagnosis chip card */}
          {triageAnalysis && (
            <div className={`mb-1 rounded-xl p-3.5 flex items-start gap-3 border-l-4 ${
              triageAnalysis.urgency === 'critical'
                ? 'bg-red-500/8 border border-red-500/20 border-l-red-500'
                : triageAnalysis.urgency === 'high'
                  ? 'bg-amber-500/8 border border-amber-500/20 border-l-amber-500'
                  : 'bg-sky-500/8 border border-sky-500/20 border-l-sky-500'
            }`}>
              <Brain size={15} className={
                triageAnalysis.urgency === 'critical' ? 'text-red-400 flex-shrink-0 mt-0.5' :
                triageAnalysis.urgency === 'high' ? 'text-amber-400 flex-shrink-0 mt-0.5' :
                'text-sky-400 flex-shrink-0 mt-0.5'
              } />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold leading-snug">
                  {triageAnalysis.condition_category?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    triageAnalysis.urgency === 'critical' ? 'bg-red-500/20 text-red-300' :
                    triageAnalysis.urgency === 'high' ? 'bg-amber-500/20 text-amber-300' :
                    'bg-emerald-500/20 text-emerald-300'
                  }`}>
                    {triageAnalysis.urgency}
                  </span>
                  {triageAnalysis.required_equipment?.slice(0, 3).map((eq) => (
                    <span key={eq} className="text-[11px] text-gray-400 bg-white/[0.05] px-2 py-0.5 rounded-full">
                      {eq.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Medium urgency advisory */}
          {triageAnalysis?.urgency === 'medium' && (
            <div className="mb-1 bg-amber-500/[0.07] border border-amber-500/20 rounded-xl px-3.5 py-2.5">
              <p className="text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle size={12} className="flex-shrink-0" />
                Consider visiting a clinic if this isn't urgent.
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
                className="w-full text-left bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.07] hover:border-sky-500/30 rounded-2xl p-4 transition-all duration-200 group focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f] relative overflow-hidden"
              >
                {/* Distance pill — top right */}
                <span className="absolute top-3.5 right-3.5 bg-white/[0.07] text-gray-400 text-[11px] font-medium px-2.5 py-1 rounded-full">
                  {result.distance_km}km
                </span>

                <div className="flex items-start gap-3 pr-14">
                  {/* Rank badge */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
                    idx === 0 ? 'bg-sky-500 text-white shadow-md shadow-sky-500/30' : 'bg-white/[0.06] text-gray-400'
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white text-sm font-semibold truncate group-hover:text-sky-300 transition-colors">
                      {result.name}
                    </h4>

                    {/* Bed availability chips */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {Object.entries(beds).map(([type, data]) => (
                        <span key={type} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          data.available > 0
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : data.overflow > 0
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-red-500/15 text-red-400'
                        }`}>
                          {type.toUpperCase()}: {data.available > 0 ? data.available : data.overflow > 0 ? `${data.overflow} ovf` : '0'}
                        </span>
                      ))}
                    </div>

                    {/* Trust + freshness row */}
                    <div className="flex items-center gap-2 mt-2.5">
                      {result.trust_tier === 'verified' && (
                        <span className="text-[11px] font-medium bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded-full">
                          ✓ Verified
                        </span>
                      )}
                      {result.trust_tier === 'unverified' && (
                        <span className="text-[11px] font-medium bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full">
                          ⚠ Unverified
                        </span>
                      )}
                      {result.freshness_hours != null && (
                        <span className="text-[11px] text-gray-600">
                          {result.freshness_hours < 1 ? `${Math.round(result.freshness_hours * 60)}min ago` : `${Math.round(result.freshness_hours)}h ago`}
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
              <div className="w-12 h-12 bg-white/[0.04] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <MapPin size={20} className="text-gray-600" />
              </div>
              <p className="text-gray-400 text-sm font-medium">No hospitals found nearby</p>
              <p className="text-gray-600 text-xs mt-1">Try expanding your search area</p>
            </div>
          )}
        </section>
      )}

      {/* ── STEP 2b: Low Urgency — Clinic Redirect ──────── */}
      {step === STEPS.LOW_URGENCY && (
        <section aria-label="Non-emergency clinic options" className="flex-1 overflow-y-auto px-5 space-y-3">
          {/* Triage analysis */}
          {triageAnalysis && (
            <div className="bg-amber-500/[0.07] border border-amber-500/20 rounded-xl p-3.5">
              <p className="text-amber-300 text-xs font-medium mb-2 flex items-center gap-1.5">
                <Brain size={12} /> AI Analysis
              </p>
              <p className="text-white text-sm font-semibold">
                {triageAnalysis.condition_category?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                  {triageAnalysis.urgency}
                </span>
              </div>
            </div>
          )}

          {/* Advisory card */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
            <p className="text-amber-400 text-xs font-semibold mb-2 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Non-emergency assessment
            </p>
            <p className="text-gray-300 text-sm leading-relaxed">
              Based on your description, this may not require emergency hospital care.
              We recommend visiting a nearby clinic or pharmacy.
            </p>

            {/* Self-care advice */}
            {triageAnalysis?.self_care_advice?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <p className="text-gray-400 text-xs font-semibold mb-2">💊 Self-care suggestions</p>
                <ul className="space-y-1.5">
                  {triageAnalysis.self_care_advice.map((tip, i) => (
                    <li key={i} className="text-gray-400 text-xs flex items-start gap-2 leading-relaxed">
                      <span className="text-gray-600 mt-1 flex-shrink-0">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
                <p className="text-gray-600 text-[11px] mt-3 italic">
                  If symptoms worsen, seek medical attention immediately.
                </p>
              </div>
            )}
          </div>

          {/* Clinic results */}
          {clinicResults && clinicResults.length > 0 && (
            <>
              <p className="text-gray-500 text-xs font-medium">Nearby clinics & pharmacies</p>
              {clinicResults.map((clinic) => (
                <div
                  key={clinic.id}
                  className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-4"
                >
                  <h4 className="text-white text-sm font-semibold">{clinic.name}</h4>
                  {clinic.address && (
                    <address className="text-gray-500 text-xs mt-1 not-italic">📍 {clinic.address}</address>
                  )}
                  <div className="flex gap-2 mt-3">
                    {clinic.phone && (
                      <a
                        href={`tel:${clinic.phone}`}
                        className="flex-1 min-h-[44px] bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 text-sky-300 text-xs font-semibold py-2.5 rounded-xl transition-all text-center flex items-center justify-center focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#08090f]"
                        onClick={e => e.stopPropagation()}
                      >
                        📞 Call
                      </a>
                    )}
                    <a
                      href={`https://maps.google.com/maps?daddr=${encodeURIComponent(clinic.address || clinic.name + ' Lagos')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-h-[44px] bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-300 text-xs font-semibold py-2.5 rounded-xl transition-all text-center flex items-center justify-center focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[#08090f]"
                      onClick={e => e.stopPropagation()}
                    >
                      🗺 Directions
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
                } catch (err) {
                  setError('Search failed.');
                } finally {
                  setLoading(false);
                }
              })();
            }}
            className="w-full min-h-[48px] mt-1 bg-red-500/10 hover:bg-red-500/18 border border-red-500/25 text-red-400 text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
          >
            <AlertTriangle size={14} />
            I still need a hospital
          </button>
        </section>
      )}

      {/* ── STEP 3: Patient Details ─────────────────────── */}
      {step === STEPS.PATIENT && (
        <section aria-label="Patient information" className="px-5 flex-1 overflow-y-auto">
          {/* Selected hospital summary */}
          {selectedResult && (
            <div className="bg-sky-500/[0.07] border border-sky-500/20 rounded-2xl p-4 mb-5">
              <div className="flex items-center justify-between">
                <h4 className="text-white text-sm font-semibold">{selectedResult.name}</h4>
                <span className="bg-white/[0.06] text-gray-400 text-[11px] px-2 py-0.5 rounded-full">{selectedResult.distance_km}km</span>
              </div>
              {selectedResult.address && (
                <address className="text-gray-500 text-xs mt-1.5 not-italic">{selectedResult.address}</address>
              )}
            </div>
          )}

          <form onSubmit={handleBookBed} className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="patient-name" className="block text-gray-300 text-sm font-medium mb-2">
                Patient name
              </label>
              <div className="relative">
                <User size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
                <input
                  id="patient-name"
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full h-[52px] bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] rounded-xl pl-10 pr-4 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/30 transition-all focus-visible:ring-2 focus-visible:ring-sky-500"
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="patient-phone" className="block text-gray-300 text-sm font-medium mb-2">
                Phone number <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Phone size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
                <input
                  id="patient-phone"
                  type="tel"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  placeholder="+234..."
                  required
                  className="w-full h-[52px] bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] rounded-xl pl-10 pr-4 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/30 transition-all focus-visible:ring-2 focus-visible:ring-sky-500"
                />
              </div>
              <p className="text-xs mt-2 text-gray-500 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#25D366] flex-shrink-0" />
                Hospital will receive a notification via WhatsApp
              </p>
            </div>

            {/* Condition */}
            <div>
              <label htmlFor="patient-condition" className="block text-gray-300 text-sm font-medium mb-2">
                Brief condition
              </label>
              <div className="relative">
                <FileText size={15} className="absolute left-4 top-4 text-gray-600 pointer-events-none" />
                <textarea
                  id="patient-condition"
                  value={patientCondition}
                  onChange={(e) => setPatientCondition(e.target.value)}
                  placeholder="e.g. Male, 68, fell from height, head injury"
                  rows={3}
                  className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] rounded-xl pl-10 pr-4 pt-3.5 pb-3 text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/30 transition-all leading-relaxed focus-visible:ring-2 focus-visible:ring-sky-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !patientPhone.trim()}
              aria-busy={loading}
              className="w-full min-h-[52px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/[0.05] disabled:text-gray-600 disabled:cursor-not-allowed text-white text-[15px] font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/20 mt-2 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="motion-reduce:animate-none animate-spin" />
                  Reserving bed...
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Reserve bed
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
          className="px-5 flex-1 overflow-y-auto"
        >
          {/* Transfer code card */}
          {transferCode && (
            <div className={`rounded-2xl p-5 mb-4 text-center relative ${
              handshake?.status === 'accepted'
                ? 'bg-sky-500/[0.07] border-2 border-sky-400/40'
                : 'bg-white/[0.03] border border-white/[0.08]'
            }`}>
              {/* Pulsing halo when accepted */}
              {handshake?.status === 'accepted' && (
                <div className="absolute inset-0 rounded-2xl border-2 border-sky-400/20 motion-reduce:hidden animate-ping opacity-40 pointer-events-none" />
              )}
              <p className="text-gray-500 text-xs font-medium mb-3 uppercase tracking-wider">Transfer Code</p>
              <div className="flex items-center justify-center gap-3">
                <span className="text-white text-4xl font-mono font-bold tracking-[0.2em]">
                  {transferCode}
                </span>
                <button
                  onClick={copyCode}
                  aria-label="Copy transfer code"
                  className="w-9 h-9 flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.10] rounded-xl text-gray-400 hover:text-white transition-all focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#08090f]"
                >
                  {codeCopied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                </button>
              </div>
              <p
                aria-live="polite"
                className="text-gray-600 text-[11px] mt-3"
              >
                {codeCopied ? '✓ Copied to clipboard' : 'Show this code when you arrive at the hospital'}
              </p>
            </div>
          )}

          {/* Hospital contact card */}
          {selectedResult && (
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-4 mb-4">
              <h4 className="text-white text-sm font-semibold">{selectedResult.name}</h4>
              {selectedResult.address && (
                <address className="text-gray-500 text-xs mt-1.5 not-italic leading-relaxed">{selectedResult.address}</address>
              )}
              {selectedResult.phone && (
                <a
                  href={`tel:${selectedResult.phone}`}
                  className="mt-3 flex items-center gap-2.5 bg-sky-500/[0.07] hover:bg-sky-500/[0.13] border border-sky-500/20 rounded-xl px-3.5 py-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#08090f]"
                >
                  <Phone size={14} className="text-sky-400" />
                  <span className="text-sky-300 text-sm font-medium">{selectedResult.phone}</span>
                  <span className="text-gray-600 text-[10px] ml-auto">Tap to call</span>
                </a>
              )}
            </div>
          )}

          {/* Countdown timer for accepted */}
          {handshake?.status === 'accepted' && countdown > 0 && (
            <div className="mb-4 bg-amber-500/[0.08] border border-amber-500/20 rounded-2xl px-4 py-3.5 flex items-center gap-4">
              <div className="flex-1">
                <p className="text-amber-400/80 text-[11px] font-medium uppercase tracking-wider">Bed held for</p>
                <p className="text-amber-300 text-3xl font-mono font-bold mt-0.5 tabular-nums">
                  {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                </p>
              </div>
              <Clock size={24} className="text-amber-500/40 flex-shrink-0" />
              <p className="text-amber-400/50 text-[10px] max-w-[80px] leading-snug">Please arrive before expiry</p>
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

                <h3 className="text-white text-xl font-bold mb-2">Arrival Confirmed</h3>
                <p className="text-gray-400 text-sm leading-relaxed mb-5">
                  You have been checked in at<br />
                  <span className="text-white font-semibold">{selectedResult?.name || 'the hospital'}</span>
                </p>

                <div className="bg-emerald-500/[0.07] border border-emerald-500/20 rounded-xl px-5 py-4 mb-5 inline-block">
                  <p className="text-emerald-400/60 text-[10px] uppercase tracking-widest mb-1">Transfer Code</p>
                  <p className="text-emerald-300 text-2xl font-mono font-bold tracking-[0.2em]">{transferCode}</p>
                </div>

                <p className="text-gray-600 text-xs mb-6 leading-relaxed">
                  The hospital has verified your code.<br />
                  Wishing a speedy recovery.
                </p>

                <button
                  onClick={handleReset}
                  className="text-gray-500 hover:text-gray-300 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f] rounded"
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
                />
                <StatusStep
                  label="Hospital notified via WhatsApp"
                  status="done"
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
                      ? 'This usually takes 1–3 minutes...'
                      : undefined
                  }
                  isLast={!handshake || handshake.status === 'requested'}
                />

                {handshake?.status === 'accepted' && (
                  <>
                    <StatusStep
                      label="Bed confirmed!"
                      status="done"
                      detail={`Held for ${countdown ? Math.ceil(countdown / 60) : '—'} minutes`}
                      highlight
                    />
                    <StatusStep
                      label="Awaiting your arrival"
                      status="active"
                      detail="Show your transfer code to the nurse on arrival"
                      isLast
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
                    />
                  </>
                )}

                {handshake?.status === 'declined' && (
                  <StatusStep
                    label="Hospital could not hold a bed"
                    status="failed"
                    detail={
                      {
                        no_beds: 'All beds are currently occupied.',
                        wrong_specialty: "This hospital doesn't have the specialty needed.",
                        equipment_unavailable: 'Required equipment is currently unavailable.',
                        too_severe: 'Your condition needs a higher-level facility.',
                        too_minor: 'Your condition may not need hospital care.',
                      }[handshake.declined_reason] || handshake.declined_reason || 'Try another hospital'
                    }
                    isLast
                  />
                )}

                {handshake?.status === 'expired' && (
                  <StatusStep
                    label="Reservation expired"
                    status="failed"
                    detail="The hold time ran out"
                    isLast
                  />
                )}

                {handshake?.status === 'overridden' && (
                  <>
                    <StatusStep
                      label="Bed reassigned — we're sorry"
                      status="failed"
                      detail="A critical walk-in emergency required immediate care. We understand this is frustrating."
                    />
                    {rerouteLoading && (
                      <StatusStep
                        label="Finding you another hospital..."
                        status="active"
                        detail="We're on it — no action needed from you"
                      />
                    )}
                    {rerouteResults && rerouteResults.length > 0 && (
                      <StatusStep
                        label={`We've found ${rerouteResults.length} alternative${rerouteResults.length > 1 ? 's' : ''} for you`}
                        status="done"
                        detail="Tap one to confirm and we'll reserve it immediately"
                        highlight
                        isLast
                      />
                    )}
                    {rerouteResults && rerouteResults.length === 0 && (
                      <StatusStep
                        label="No alternatives found nearby"
                        status="failed"
                        detail="Try searching again with a wider area"
                        isLast
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Reroute results for overridden */}
          {handshake?.status === 'overridden' && rerouteResults && rerouteResults.length > 0 && (
            <div className="mt-4">
              <p className="text-gray-500 text-xs font-medium mb-2.5">Alternative hospitals found:</p>
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
                      className="w-full text-left bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.07] hover:border-sky-500/30 rounded-2xl p-3.5 transition-all group focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5 ${
                          idx === 0 ? 'bg-sky-500 text-white' : 'bg-white/[0.06] text-gray-400'
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="text-white text-sm font-medium truncate group-hover:text-sky-300 transition-colors">
                              {result.name}
                            </h4>
                            <span className="text-gray-600 text-[11px] flex-shrink-0">{result.distance_km}km</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {Object.entries(beds).map(([type, data]) => (
                              <span key={type} className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                                data.available > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-400'
                              }`}>
                                {type.toUpperCase()}: {data.available || 0}
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
            <div className="mt-4 flex gap-2.5">
              <a
                href={`https://maps.google.com/maps?daddr=${selectedResult.address || selectedResult.name + ' Lagos'}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-h-[48px] bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
              >
                <Navigation size={15} />
                Directions
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
                className="flex-1 min-h-[48px] bg-[#25D366] hover:bg-[#20bd5a] text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#25D366]/20 focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Share
              </a>
            </div>
          )}

          {(handshake?.status === 'declined' || handshake?.status === 'expired' || handshake?.status === 'overridden') && (
            <button
              onClick={handleReset}
              className="w-full mt-4 min-h-[48px] bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f]"
            >
              Search again
            </button>
          )}
        </section>
      )}

      {/* ── Footer ──────────────────────────────────────── */}
      <div className="px-5 py-4 border-t border-white/[0.05]">
        {step === STEPS.TRACKING ? (
          <button
            onClick={handleReset}
            className="w-full text-gray-600 hover:text-gray-400 text-xs text-center transition-colors focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090f] rounded"
          >
            Start a new search
          </button>
        ) : (
          <p className="text-gray-700 text-[11px] text-center">
            In an emergency? Text <span className="text-sky-400 font-semibold">EMERGENCY</span> to our WhatsApp
          </p>
        )}
      </div>
    </div>
  );
}


/**
 * StatusStep — single step in the vertical timeline status tracker.
 */
function StatusStep({ label, status, detail, highlight, isLast }) {
  // Node style per status
  const nodeStyle = {
    done: 'bg-emerald-500 border-emerald-500',
    active: 'bg-transparent border-sky-400',
    failed: 'bg-red-500 border-red-500',
    pending: 'bg-transparent border-white/[0.12]',
  }[status] || 'bg-transparent border-white/[0.12]';

  const nodeIcon = {
    done: <Check size={10} className="text-white" strokeWidth={3} />,
    active: null, // pulsing ring — no inner icon
    failed: <X size={10} className="text-white" strokeWidth={3} />,
    pending: null,
  }[status];

  const labelColor = {
    done: 'text-white',
    active: 'text-sky-300',
    failed: 'text-red-400',
    pending: 'text-gray-600',
  }[status] || 'text-gray-600';

  return (
    <div className={`flex items-stretch gap-3 ${highlight ? 'relative' : ''}`}>
      {/* Left column: connector line + node */}
      <div className="flex flex-col items-center flex-shrink-0 w-5">
        {/* Node circle */}
        <div className={`relative w-5 h-5 rounded-full border-2 flex items-center justify-center z-10 mt-1 ${nodeStyle}`}>
          {nodeIcon}
          {/* Pulsing ring for active */}
          {status === 'active' && (
            <div className="absolute inset-0 rounded-full border-2 border-sky-400 motion-reduce:hidden animate-ping opacity-60" />
          )}
        </div>
        {/* Connector line below */}
        {!isLast && (
          <div className="w-px flex-1 mt-1 bg-white/[0.07]" style={{ minHeight: '20px' }} />
        )}
      </div>

      {/* Right column: label + detail */}
      <div className={`flex-1 pb-5 ${isLast ? 'pb-2' : ''} ${highlight ? 'bg-emerald-500/[0.05] border border-emerald-500/15 rounded-xl px-3 py-2.5 -mt-1 mb-4' : ''}`}>
        <p className={`text-sm font-medium leading-snug ${labelColor}`}>
          {label}
        </p>
        {detail && (
          <p className="text-gray-500 text-xs mt-1 leading-relaxed">{detail}</p>
        )}
      </div>
    </div>
  );
}
