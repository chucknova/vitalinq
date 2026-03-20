import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Search,
  User,
  X,
  XCircle,
} from 'lucide-react';
import api from '../../lib/api';
import useHandshake from '../../hooks/useHandshake';

const STEPS = {
  SEARCH: 'search',
  RESULTS: 'results',
  PATIENT: 'patient',
  TRACKING: 'tracking',
};

const stepLabels = ['Search', 'Select', 'Details', 'Track'];
const stepOrder = [STEPS.SEARCH, STEPS.RESULTS, STEPS.PATIENT, STEPS.TRACKING];

function formatConditionCategory(value) {
  if (!value) return 'Triage summary';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function formatFreshness(hours) {
  if (hours == null) return null;
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  return `${Math.round(hours)} h ago`;
}

function getBestBedSummary(beds = {}) {
  const entries = Object.entries(beds);
  if (!entries.length) return 'Capacity details unavailable';

  const best = entries.find(([, data]) => data?.available > 0) || entries[0];
  const [type, data] = best;

  if (data?.available > 0) return `${data.available} ${type.toUpperCase()} beds available`;
  if (data?.overflow > 0) return `${data.overflow} ${type.toUpperCase()} overflow slots`;
  return `${type.toUpperCase()} currently full`;
}

export default function SearchPanel({
  onResults,
  onClear,
  searchResults,
  hospitals,
  onHospitalSelect,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState(STEPS.SEARCH);
  const [mode, setMode] = useState('triage');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [triageAnalysis, setTriageAnalysis] = useState(null);
  const [error, setError] = useState(null);

  const [selectedResult, setSelectedResult] = useState(null);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientCondition, setPatientCondition] = useState('');
  const [handshakeId, setHandshakeId] = useState(null);
  const [transferCode, setTransferCode] = useState(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const { handshake, countdown } = useHandshake(handshakeId);

  async function handleTriageSearch(e) {
    e.preventDefault();
    if (!description.trim()) return;

    setLoading(true);
    setError(null);
    setTriageAnalysis(null);

    try {
      let lat = 6.5244;
      let lng = 3.3792;

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
      let lat = 6.5244;
      let lng = 3.3792;

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

  function handleSelectHospital(result) {
    setSelectedResult(result);
    const hospital = hospitals.find(hospitalItem => hospitalItem.id === result.hospital_id);
    if (hospital) onHospitalSelect(hospital);

    if (description && !patientCondition) {
      setPatientCondition(description);
    }

    setStep(STEPS.PATIENT);
  }

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
        patient_summary: `${patientName ? `${patientName}. ` : ''}${patientCondition || description || 'Emergency'}`.trim(),
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
    if (!transferCode) return;
    navigator.clipboard.writeText(transferCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  const currentStepIndex = stepOrder.indexOf(step);

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Expand search panel"
        onClick={() => setCollapsed(false)}
        className="absolute left-5 top-5 z-30 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/95 text-slate-200 shadow-[0_18px_36px_rgba(2,6,23,0.4)] transition hover:bg-slate-800"
      >
        <ChevronRight size={18} />
      </button>
    );
  }

  return (
    <aside className="relative z-20 flex h-full w-[400px] flex-col overflow-hidden border-r border-slate-800 bg-slate-950 text-slate-100 shadow-[8px_0_40px_rgba(2,6,23,0.28)]">
      <div className="border-b border-slate-800 bg-[linear-gradient(180deg,_rgba(8,15,28,0.98)_0%,_rgba(10,19,34,0.98)_100%)] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {step !== STEPS.SEARCH && (
              <button
                type="button"
                aria-label="Go back"
                onClick={() => {
                  if (step === STEPS.RESULTS) {
                    setStep(STEPS.SEARCH);
                    onClear();
                  } else if (step === STEPS.PATIENT) {
                    setStep(STEPS.RESULTS);
                  }
                }}
                className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition hover:bg-slate-800"
              >
                <ArrowLeft size={16} />
              </button>
            )}

            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-md bg-blue-500/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-300">
                <Search size={12} />
                Emergency routing
              </div>
              <h2 className="mt-3 text-lg font-semibold tracking-tight text-slate-50">
                {step === STEPS.SEARCH && 'Find the right hospital'}
                {step === STEPS.RESULTS && 'Choose a destination'}
                {step === STEPS.PATIENT && 'Add patient details'}
                {step === STEPS.TRACKING && 'Track the reservation'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                {step === STEPS.SEARCH && 'Start with triage guidance or a nearby search.'}
                {step === STEPS.RESULTS && `${searchResults?.length || 0} hospitals ranked for speed and fit.`}
                {step === STEPS.PATIENT && selectedResult?.name}
                {step === STEPS.TRACKING && (transferCode ? `Transfer code ${transferCode}` : 'Creating your reservation now.')}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Collapse search panel"
            onClick={() => setCollapsed(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            <ChevronLeft size={18} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2">
          {stepLabels.map((label, index) => {
            const isCompleteOrActive = index <= currentStepIndex;
            const isCurrent = index === currentStepIndex;

            return (
              <div key={label} className="space-y-2">
                <div
                  className={`h-1.5 rounded-md transition ${
                    isCompleteOrActive ? 'bg-blue-500' : 'bg-slate-800'
                  }`}
                />
                <p
                  className={`text-[11px] font-medium ${
                    isCurrent ? 'text-slate-100' : isCompleteOrActive ? 'text-blue-300' : 'text-slate-500'
                  }`}
                >
                  {label}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="leading-6">{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
            className="ml-auto text-red-300 transition hover:text-red-100"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {step === STEPS.SEARCH && (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 shadow-[0_20px_50px_rgba(2,6,23,0.28)]">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-950 p-1.5">
              <button
                type="button"
                onClick={() => setMode('triage')}
                className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-3 text-sm font-medium transition ${
                  mode === 'triage'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Brain size={16} />
                Smart Triage
              </button>
              <button
                type="button"
                onClick={() => setMode('quick')}
                className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-3 text-sm font-medium transition ${
                  mode === 'quick'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <MapPin size={16} />
                Nearby
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {mode === 'triage' ? (
                <form onSubmit={handleTriageSearch} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">
                      Describe the emergency
                    </label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder={"e.g. Adult male, diabetic, collapsed and bleeding from the head"}
                      rows={5}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    />
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      Include age, symptoms, injuries, or any equipment you think may be needed.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !description.trim()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Analyzing urgency...
                      </>
                    ) : (
                      <>
                        <Brain size={16} />
                        Find best hospital
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg bg-slate-950 p-4">
                    <p className="text-sm font-medium text-slate-200">Use your location to shortlist nearby hospitals.</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Best for urgent transport when you already know what care is needed.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleQuickSearch}
                    disabled={loading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Searching nearby...
                      </>
                    ) : (
                      <>
                        <MapPin size={16} />
                        Find hospitals near me
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
              Routing note
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Results favor live availability, distance, and hospital capability so the closest option is not always the first one.
            </p>
          </div>
        </div>
      )}

      {step === STEPS.RESULTS && (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            {triageAnalysis && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 shadow-[0_18px_36px_rgba(2,6,23,0.24)]">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
                  <Brain size={14} />
                  AI triage summary
                </div>
                <h3 className="mt-3 text-base font-semibold text-slate-100">
                  {formatConditionCategory(triageAnalysis.condition_category)}
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase ${
                      triageAnalysis.urgency === 'critical'
                        ? 'bg-red-500/15 text-red-300'
                        : triageAnalysis.urgency === 'high'
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {triageAnalysis.urgency} urgency
                  </span>
                  {triageAnalysis.required_equipment?.slice(0, 3).map(eq => (
                    <span key={eq} className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300">
                      {eq.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {searchResults?.map((result, idx) => {
              const beds = result.beds || {};
              const freshness = formatFreshness(result.freshness_hours);

              return (
                <button
                  key={result.hospital_id}
                  type="button"
                  onClick={() => handleSelectHospital(result)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 p-4 text-left shadow-[0_18px_36px_rgba(2,6,23,0.2)] transition hover:border-blue-500/40 hover:bg-slate-900/90"
                >
                  <div className="flex items-start gap-4">
                    <div className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
                      idx === 0 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'
                    }`}>
                      {idx + 1}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="truncate text-base font-semibold text-slate-100">{result.name}</h4>
                          <p className="mt-1 text-sm text-slate-400">
                            {getBestBedSummary(beds)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold text-slate-100">{result.distance_km} km</p>
                          <p className="text-xs text-slate-500">away</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {Object.entries(beds).map(([type, data]) => (
                          <span key={type} className="rounded-md bg-slate-950 px-2.5 py-1 text-[11px] text-slate-400">
                            <span className="font-semibold text-slate-200">{type.toUpperCase()}</span>{' '}
                            <span className={
                              data.available > 0
                                ? 'text-emerald-300'
                                : data.overflow > 0
                                  ? 'text-amber-300'
                                  : 'text-red-300'
                            }>
                              {data.available > 0 ? data.available : data.overflow > 0 ? `${data.overflow} ovf` : 'full'}
                            </span>
                          </span>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                        {result.trust_tier === 'verified' && (
                          <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-300">
                            Verified listing
                          </span>
                        )}
                        {result.trust_tier === 'unverified' && (
                          <span className="rounded-md bg-amber-500/15 px-2.5 py-1 font-medium text-amber-300">
                            Unverified listing
                          </span>
                        )}
                        {freshness && <span className="text-slate-500">Updated {freshness}</span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {searchResults?.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-6 py-10 text-center">
                <Search size={24} className="mx-auto text-slate-500" />
                <p className="mt-4 text-sm font-medium text-slate-200">No hospitals found in this search.</p>
                <p className="mt-1 text-sm text-slate-500">Try nearby mode or broaden the emergency description.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {step === STEPS.PATIENT && (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {selectedResult && (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 shadow-[0_18px_36px_rgba(2,6,23,0.22)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
                    Selected hospital
                  </p>
                  <h3 className="mt-2 truncate text-base font-semibold text-slate-100">{selectedResult.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{selectedResult.address}</p>
                </div>
                <span className="rounded-md bg-slate-950 px-3 py-1 text-xs font-medium text-slate-300">
                  {selectedResult.distance_km} km
                </span>
              </div>
            </div>
          )}

          <form onSubmit={handleBookBed} className="mt-4 space-y-4">
            <Field label="Patient name" icon={User}>
              <input
                type="text"
                value={patientName}
                onChange={e => setPatientName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
            </Field>

            <Field label="Phone number" icon={Phone} required>
              <input
                type="tel"
                value={patientPhone}
                onChange={e => setPatientPhone(e.target.value)}
                placeholder="+234..."
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                The hospital receives this number for WhatsApp coordination and arrival follow-up.
              </p>
            </Field>

            <Field label="Brief condition" icon={FileText}>
              <textarea
                value={patientCondition}
                onChange={e => setPatientCondition(e.target.value)}
                placeholder="e.g. Male, 68, fell from height, suspected head injury"
                rows={4}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
            </Field>

            <button
              type="submit"
              disabled={loading || !patientPhone.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Reserving bed...
                </>
              ) : (
                'Reserve bed'
              )}
            </button>
          </form>
        </div>
      )}

      {step === STEPS.TRACKING && (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {transferCode && (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 text-center shadow-[0_20px_40px_rgba(2,6,23,0.24)]">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">Transfer code</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="text-4xl font-bold tracking-[0.24em] text-slate-100">{transferCode}</span>
                <button
                  type="button"
                  aria-label="Copy transfer code"
                  onClick={copyCode}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-400 transition hover:text-slate-100"
                >
                  {codeCopied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                </button>
              </div>
              <p className="mt-2 text-sm text-slate-400">Show this code when you arrive at the hospital.</p>
            </div>
          )}

          {selectedResult && (
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h4 className="text-base font-semibold text-slate-100">{selectedResult.name}</h4>
              {selectedResult.address && (
                <p className="mt-1 text-sm leading-6 text-slate-400">{selectedResult.address}</p>
              )}
              {selectedResult.phone && (
                <a
                  href={`tel:${selectedResult.phone}`}
                  className="mt-4 flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 transition hover:bg-blue-500/15"
                >
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-blue-300">
                    <Phone size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{selectedResult.phone}</p>
                    <p className="text-xs text-slate-400">Tap to call the hospital</p>
                  </div>
                </a>
              )}
            </div>
          )}

          <div className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
            {handshake?.status === 'completed' ? (
              <div className="py-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-emerald-500/15">
                  <CheckCircle2 size={30} className="text-emerald-600" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-100">Arrival confirmed</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  The transfer code has been verified at{' '}
                  <span className="font-medium text-slate-200">{selectedResult?.name || 'the hospital'}</span>.
                </p>
                <button
                  type="button"
                  onClick={handleReset}
                  className="mt-5 text-sm font-medium text-slate-400 transition hover:text-slate-100"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <StatusStep label="Reservation created" status="done" detail={selectedResult?.name} />
                <StatusStep label="Hospital notified via WhatsApp" status="done" />
                <StatusStep
                  label="Waiting for hospital response"
                  status={
                    !handshake || handshake.status === 'requested'
                      ? 'active'
                      : handshake.status === 'accepted'
                        ? 'done'
                        : handshake.status === 'declined'
                          ? 'failed'
                          : 'done'
                  }
                  detail={
                    !handshake || handshake.status === 'requested'
                      ? 'Most hospitals respond within a few minutes.'
                      : undefined
                  }
                />

                {handshake?.status === 'accepted' && (
                  <>
                    <StatusStep
                      label="Bed confirmed"
                      status="done"
                      detail={`Held for ${countdown ? Math.ceil(countdown / 60) : 45} minutes`}
                      highlight
                    />
                    <StatusStep
                      label="Awaiting your arrival"
                      status="active"
                      detail="Present the transfer code to the nurse on arrival."
                    />
                  </>
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
                    detail="The hold time ran out before arrival."
                  />
                )}
              </>
            )}
          </div>

          {handshake?.status === 'accepted' && selectedResult && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <a
                href={`https://maps.google.com/maps?daddr=${selectedResult.address || `${selectedResult.name} Lagos`}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                <Navigation size={15} />
                Directions
              </a>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `BedSignal - Bed Reserved\n\n` +
                  `Hospital: ${selectedResult.name}\n` +
                  `Transfer Code: ${transferCode}\n` +
                  `Address: ${selectedResult.address || ''}\n\n` +
                  `Directions: https://maps.google.com/maps?daddr=${encodeURIComponent(selectedResult.address || `${selectedResult.name} Lagos`)}\n\n` +
                  `Show the transfer code on arrival.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                Share
              </a>
            </div>
          )}

          {(handshake?.status === 'declined' || handshake?.status === 'expired') && (
            <button
              type="button"
              onClick={handleReset}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Search again
            </button>
          )}

          {handshake?.status === 'accepted' && countdown > 0 && (
            <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">Bed held for</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">
                {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
              </p>
              <p className="mt-1 text-xs text-slate-400">Please arrive before the hold expires.</p>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-slate-800 bg-slate-950/90 px-5 py-4">
        {step === STEPS.TRACKING ? (
          <button
            type="button"
            onClick={handleReset}
            className="w-full text-sm font-medium text-slate-400 transition hover:text-slate-100"
          >
            Start a new search
          </button>
        ) : (
          <p className="text-center text-xs leading-5 text-slate-500">
            In an emergency? Text <span className="font-semibold text-blue-300">EMERGENCY</span> to our WhatsApp.
          </p>
        )}
      </div>
    </aside>
  );
}

function Field({ label, icon: Icon, required, children }) {
  return (
    <label className="block rounded-lg border border-slate-800 bg-slate-900 p-4">
      <span className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200">
        <Icon size={15} className="text-blue-300" />
        {label}
        {required && <span className="text-blue-300">*</span>}
      </span>
      {children}
    </label>
  );
}

function StatusStep({ label, status, detail, highlight }) {
  const icons = {
    done: <CheckCircle2 size={18} className="text-emerald-600" />,
    active: <Loader2 size={18} className="animate-spin text-blue-400" />,
    failed: <XCircle size={18} className="text-red-600" />,
    pending: <Clock size={18} className="text-slate-600" />,
  };

  return (
    <div className={`flex items-start gap-3 rounded-lg ${highlight ? 'border border-emerald-500/20 bg-emerald-500/10 p-4' : 'p-1'}`}>
      <div className="mt-0.5 shrink-0">
        {icons[status] || icons.pending}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${
          status === 'failed'
            ? 'text-red-300'
            : status === 'active'
              ? 'text-slate-100'
              : 'text-slate-200'
        }`}>
          {label}
        </p>
        {detail && (
          <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
        )}
      </div>
    </div>
  );
}
