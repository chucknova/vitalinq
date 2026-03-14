/**
 * SearchPanel — left sidebar with full emergency booking flow.
 *
 * Steps:
 *   1. Search (Smart Triage or Nearby)
 *   2. Results list (pick a hospital)
 *   3. Patient details (name, phone, condition)
 *   4. Live status tracker (polling handshake until resolved)
 */

import { useState } from 'react';
import {
  Search, Brain, MapPin, ChevronLeft, ChevronRight, X,
  Loader2, AlertTriangle, ArrowLeft, Phone, User, FileText,
  CheckCircle2, Clock, XCircle, Navigation, Copy, Check
} from 'lucide-react';
import api from '../../lib/api';
import useHandshake from '../../hooks/useHandshake';

const STEPS = {
  SEARCH: 'search',
  RESULTS: 'results',
  PATIENT: 'patient',
  TRACKING: 'tracking',
};

export default function SearchPanel({ onResults, onClear, searchResults, hospitals, onHospitalSelect }) {
  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState(STEPS.SEARCH);
  const [mode, setMode] = useState('triage');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [triageAnalysis, setTriageAnalysis] = useState(null);
  const [error, setError] = useState(null);

  // Booking state
  const [selectedResult, setSelectedResult] = useState(null);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientCondition, setPatientCondition] = useState('');
  const [handshakeId, setHandshakeId] = useState(null);
  const [transferCode, setTransferCode] = useState(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Live status polling
  const { handshake, loading: handshakeLoading } = useHandshake(handshakeId);

  // ── Search handlers ────────────────────────────────────
  async function handleTriageSearch(e) {
    e.preventDefault();
    if (!description.trim()) return;

    setLoading(true);
    setError(null);
    setTriageAnalysis(null);

    try {
      let lat = 6.5244, lng = 3.3792; // Lagos fallback
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch (_) {}

      const res = await api.post('/api/search/triage', {
        description: description.trim(),
        latitude: lat,
        longitude: lng,
        radius_km: 20,
      });

      setTriageAnalysis(res.data.parsed_requirements);
      onResults(res.data.results);
      setStep(STEPS.RESULTS);
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
      const res = await api.post('/api/handshakes', {
        receiving_hospital_id: selectedResult.hospital_id,
        bed_type: Object.keys(selectedResult.beds || {})[0] || 'emergency',
        requesting_party_type: 'individual',
        requesting_party_phone: patientPhone.trim(),
        patient_summary: `${patientName ? patientName + '. ' : ''}${patientCondition || description || 'Emergency'}`.trim(),
        hold_duration_min: 45,
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
    setTriageAnalysis(null);
    setSelectedResult(null);
    setPatientName('');
    setPatientPhone('');
    setPatientCondition('');
    setHandshakeId(null);
    setTransferCode(null);
    setError(null);
    setCodeCopied(false);
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
        className="absolute top-5 left-5 z-30 bg-[#0d1320]/90 backdrop-blur-sm border border-gray-700/50 text-gray-300 p-2.5 rounded-xl hover:bg-[#151d2e] transition-colors"
      >
        <ChevronRight size={18} />
      </button>
    );
  }

  return (
    <div className="w-[380px] h-full bg-[#0a0f1a] border-r border-gray-800/50 flex flex-col z-20 relative">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="p-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {step !== STEPS.SEARCH && (
            <button
              onClick={() => {
                if (step === STEPS.RESULTS) { setStep(STEPS.SEARCH); onClear(); }
                else if (step === STEPS.PATIENT) setStep(STEPS.RESULTS);
                else if (step === STEPS.TRACKING) {} // Can't go back from tracking
              }}
              className="text-gray-400 hover:text-white p-1 transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div>
            <h2 className="text-white text-base font-semibold">
              {step === STEPS.SEARCH && 'Find a hospital'}
              {step === STEPS.RESULTS && 'Choose a hospital'}
              {step === STEPS.PATIENT && 'Patient details'}
              {step === STEPS.TRACKING && 'Bed reservation'}
            </h2>
            <p className="text-gray-500 text-xs mt-0.5">
              {step === STEPS.SEARCH && 'Describe your emergency or search nearby'}
              {step === STEPS.RESULTS && `${searchResults?.length || 0} hospitals found`}
              {step === STEPS.PATIENT && selectedResult?.name}
              {step === STEPS.TRACKING && (transferCode ? `Code: ${transferCode}` : 'Creating reservation...')}
            </p>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      {/* ── Step indicator ──────────────────────────────── */}
      <div className="px-5 pb-4">
        <div className="flex gap-1">
          {['Search', 'Select', 'Details', 'Track'].map((label, i) => {
            const stepOrder = [STEPS.SEARCH, STEPS.RESULTS, STEPS.PATIENT, STEPS.TRACKING];
            const currentIdx = stepOrder.indexOf(step);
            const isActive = i <= currentIdx;
            return (
              <div key={label} className="flex-1">
                <div className={`h-1 rounded-full transition-all duration-500 ${
                  isActive ? 'bg-cyan-500' : 'bg-gray-800'
                }`} />
                <p className={`text-[9px] mt-1 ${
                  isActive ? 'text-cyan-400' : 'text-gray-700'
                }`}>{label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────── */}
      {error && (
        <div className="mx-5 mb-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
          <AlertTriangle size={12} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {/* ── STEP 1: Search ──────────────────────────────── */}
      {step === STEPS.SEARCH && (
        <div className="px-5 flex-1">
          {/* Mode toggle */}
          <div className="flex gap-1 bg-[#151d2e] rounded-lg p-1 mb-4">
            <button
              onClick={() => setMode('triage')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
                mode === 'triage'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Brain size={13} />
              Smart Triage
            </button>
            <button
              onClick={() => setMode('quick')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
                mode === 'quick'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <MapPin size={13} />
              Nearby
            </button>
          </div>

          {mode === 'triage' ? (
            <form onSubmit={handleTriageSearch}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={"Describe the emergency...\ne.g. 'My father collapsed, he's diabetic, bleeding from his head'"}
                rows={3}
                className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all"
              />
              <button
                type="submit"
                disabled={loading || !description.trim()}
                className="w-full mt-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 size={14} className="animate-spin" /> Analyzing...</>
                ) : (
                  <><Brain size={14} /> Find best hospital</>
                )}
              </button>
            </form>
          ) : (
            <button
              onClick={handleQuickSearch}
              disabled={loading}
              className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium py-3 rounded-lg transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 size={14} className="animate-spin" /> Searching...</>
              ) : (
                <><MapPin size={14} /> Find hospitals near me</>
              )}
            </button>
          )}
        </div>
      )}

      {/* ── STEP 2: Results ─────────────────────────────── */}
      {step === STEPS.RESULTS && (
        <div className="flex-1 overflow-y-auto px-5">
          {/* Triage analysis card */}
          {triageAnalysis && (
            <div className="mb-3 bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3">
              <p className="text-cyan-300 text-xs font-medium mb-1.5 flex items-center gap-1.5">
                <Brain size={12} /> AI Analysis
              </p>
              <p className="text-white text-sm font-medium">
                {triageAnalysis.condition_category?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  triageAnalysis.urgency === 'critical' ? 'bg-red-500/20 text-red-400' :
                  triageAnalysis.urgency === 'high' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-green-500/20 text-green-400'
                }`}>
                  {triageAnalysis.urgency}
                </span>
                {triageAnalysis.required_equipment?.slice(0, 3).map((eq) => (
                  <span key={eq} className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                    {eq.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Result cards */}
          {searchResults?.map((result, idx) => {
            const beds = result.beds || {};
            return (
              <button
                key={result.hospital_id}
                onClick={() => handleSelectHospital(result)}
                className="w-full text-left mb-2 bg-[#151d2e] hover:bg-[#1a2435] border border-gray-800/50 hover:border-cyan-500/30 rounded-xl p-3.5 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    idx === 0 ? 'bg-cyan-500 text-white' : 'bg-gray-700 text-gray-300'
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="text-white text-sm font-medium truncate group-hover:text-cyan-300 transition-colors">
                        {result.name}
                      </h4>
                      <span className="text-gray-500 text-xs flex-shrink-0">{result.distance_km}km</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                      {Object.entries(beds).map(([type, data]) => (
                        <span key={type} className="text-[11px]">
                          <span className="text-gray-500">{type.toUpperCase()}: </span>
                          <span className={data.available > 0 ? 'text-emerald-400' : data.overflow > 0 ? 'text-amber-400' : 'text-red-400'}>
                            {data.available > 0 ? data.available : data.overflow > 0 ? `${data.overflow} ovf` : '0'}
                          </span>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {result.trust_tier === 'verified' && <span className="text-[10px] text-emerald-400">✓ Verified</span>}
                      {result.trust_tier === 'unverified' && <span className="text-[10px] text-amber-400">⚠ Unverified</span>}
                      {result.freshness_hours != null && (
                        <span className="text-[10px] text-gray-600">
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
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">No hospitals found nearby</p>
              <p className="text-gray-600 text-xs mt-1">Try expanding your search area</p>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Patient Details ─────────────────────── */}
      {step === STEPS.PATIENT && (
        <div className="px-5 flex-1">
          {/* Selected hospital summary */}
          {selectedResult && (
            <div className="bg-[#151d2e] rounded-lg p-3 mb-4 border border-gray-800/50">
              <div className="flex items-center justify-between">
                <h4 className="text-white text-sm font-medium">{selectedResult.name}</h4>
                <span className="text-gray-500 text-xs">{selectedResult.distance_km}km</span>
              </div>
              <p className="text-gray-500 text-xs mt-1">{selectedResult.address}</p>
            </div>
          )}

          <form onSubmit={handleBookBed} className="space-y-3">
            {/* Name */}
            <div>
              <label className="text-gray-400 text-xs mb-1 block flex items-center gap-1.5">
                <User size={11} /> Patient name
              </label>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="text-gray-400 text-xs mb-1 block flex items-center gap-1.5">
                <Phone size={11} /> Phone number <span className="text-red-400">*</span>
              </label>
              <input
                type="tel"
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                placeholder="+234..."
                required
                className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all"
              />
              <p className="text-gray-600 text-[10px] mt-1">Hospital will receive notification via WhatsApp</p>
            </div>

            {/* Condition */}
            <div>
              <label className="text-gray-400 text-xs mb-1 block flex items-center gap-1.5">
                <FileText size={11} /> Brief condition
              </label>
              <textarea
                value={patientCondition}
                onChange={(e) => setPatientCondition(e.target.value)}
                placeholder="e.g. Male, 68, fell from height, head injury"
                rows={2}
                className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-cyan-500/50 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !patientPhone.trim()}
              className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium py-3 rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <><Loader2 size={14} className="animate-spin" /> Reserving bed...</>
              ) : (
                'Reserve bed'
              )}
            </button>
          </form>
        </div>
      )}

      {/* ── STEP 4: Live Status Tracker ─────────────────── */}
      {step === STEPS.TRACKING && (
        <div className="px-5 flex-1">
          {/* Transfer code card */}
          {transferCode && (
            <div className="bg-[#151d2e] border border-gray-800/50 rounded-xl p-4 mb-4 text-center">
              <p className="text-gray-400 text-xs mb-2">Transfer Code</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-white text-3xl font-mono font-bold tracking-widest">
                  {transferCode}
                </span>
                <button
                  onClick={copyCode}
                  className="text-gray-500 hover:text-cyan-400 p-1.5 transition-colors"
                >
                  {codeCopied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                </button>
              </div>
              <p className="text-gray-600 text-[10px] mt-2">Show this code when you arrive at the hospital</p>
            </div>
          )}

          {/* Status display */}
          <div className="space-y-3">
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
                  ? 'This usually takes 1-3 minutes...'
                  : undefined
              }
            />

            {handshake?.status === 'accepted' && (
              <StatusStep
                label="Bed confirmed!"
                status="done"
                detail={`Held for ${handshake.time_remaining_sec ? Math.ceil(handshake.time_remaining_sec / 60) : 45} minutes`}
                highlight
              />
            )}

            {handshake?.status === 'declined' && (
              <StatusStep
                label="Hospital could not hold a bed"
                status="failed"
                detail={handshake.declined_reason || 'Try another hospital'}
              />
            )}

            {handshake?.status === 'expired' && (
              <StatusStep
                label="Reservation expired"
                status="failed"
                detail="The hold time ran out"
              />
            )}
          </div>

          {/* Actions based on status */}
          {handshake?.status === 'accepted' && selectedResult && (
            <a
              href={`https://maps.google.com/maps?daddr=${selectedResult.address || selectedResult.name + ' Lagos'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full mt-4 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium py-3 rounded-lg transition-all flex items-center justify-center gap-2"
            >
              <Navigation size={14} />
              Get directions
            </a>
          )}

          {(handshake?.status === 'declined' || handshake?.status === 'expired') && (
            <button
              onClick={handleReset}
              className="w-full mt-4 bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-medium py-3 rounded-lg transition-all"
            >
              Search again
            </button>
          )}

          {/* Countdown timer for accepted */}
          {handshake?.status === 'accepted' && handshake?.time_remaining_sec > 0 && (
            <div className="mt-4 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
              <p className="text-amber-400 text-xs">Bed held for</p>
              <p className="text-amber-300 text-xl font-mono font-bold mt-1">
                {Math.floor(handshake.time_remaining_sec / 60)}:{String(handshake.time_remaining_sec % 60).padStart(2, '0')}
              </p>
              <p className="text-amber-400/60 text-[10px] mt-1">Please arrive before the hold expires</p>
            </div>
          )}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────── */}
      <div className="p-4 border-t border-gray-800/50">
        {step === STEPS.TRACKING ? (
          <button
            onClick={handleReset}
            className="w-full text-gray-500 hover:text-gray-300 text-xs text-center transition-colors"
          >
            Start a new search
          </button>
        ) : (
          <p className="text-gray-600 text-[10px] text-center">
            In an emergency? Text <span className="text-cyan-400 font-medium">EMERGENCY</span> to our WhatsApp
          </p>
        )}
      </div>
    </div>
  );
}


/**
 * StatusStep — single step in the status tracker.
 */
function StatusStep({ label, status, detail, highlight }) {
  const icons = {
    done: <CheckCircle2 size={16} className="text-emerald-400" />,
    active: <Loader2 size={16} className="text-cyan-400 animate-spin" />,
    failed: <XCircle size={16} className="text-red-400" />,
    pending: <Clock size={16} className="text-gray-600" />,
  };

  return (
    <div className={`flex items-start gap-3 ${highlight ? 'bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 -mx-1' : ''}`}>
      <div className="mt-0.5 flex-shrink-0">
        {icons[status] || icons.pending}
      </div>
      <div>
        <p className={`text-sm ${
          status === 'done' ? 'text-white' :
          status === 'active' ? 'text-cyan-300' :
          status === 'failed' ? 'text-red-400' :
          'text-gray-500'
        }`}>
          {label}
        </p>
        {detail && (
          <p className="text-gray-500 text-xs mt-0.5">{detail}</p>
        )}
      </div>
    </div>
  );
}