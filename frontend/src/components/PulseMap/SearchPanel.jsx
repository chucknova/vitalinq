import { useEffect, useRef, useState } from 'react';
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
  LOW_URGENCY: 'low_urgency',
  PATIENT: 'patient',
  TRACKING: 'tracking',
};

const FALLBACK_LOCATION = { lat: 6.5244, lng: 3.3792 };

const shellClass =
  'relative z-20 flex h-full w-full max-w-full flex-col border-r border-slate-800/80 bg-slate-950/95 text-slate-100 backdrop-blur md:w-[400px] md:max-w-[400px]';
const surfaceClass =
  'rounded-2xl border border-slate-800 bg-slate-900/80 shadow-[0_1px_2px_rgba(15,23,42,0.3)]';
const subtleSurfaceClass = 'rounded-2xl border border-slate-800/80 bg-slate-900/50';
const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/10';
const primaryButtonClass =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 active:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 focus:outline-none focus:ring-4 focus:ring-cyan-500/20';
const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 active:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-500/20';

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
  const [clinicResults, setClinicResults] = useState(null);

  const [selectedResult, setSelectedResult] = useState(null);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientCondition, setPatientCondition] = useState('');
  const [handshakeId, setHandshakeId] = useState(null);
  const [transferCode, setTransferCode] = useState(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [rerouteResults, setRerouteResults] = useState(null);
  const [rerouteLoading, setRerouteLoading] = useState(false);

  const { handshake, loading: handshakeLoading, countdown } = useHandshake(handshakeId);
  const prevStatus = useRef(null);

  useEffect(() => {
    if (handshake?.status === 'overridden' && prevStatus.current !== 'overridden') {
      (async () => {
        setRerouteLoading(true);
        try {
          const { lat, lng } = await getUserCoordinates();
          const res = await api.post('/api/search/nearby', {
            latitude: lat,
            longitude: lng,
            radius_km: 20,
            limit: 5,
          });

          const filtered = res.data.results.filter(
            (result) => result.hospital_id !== selectedResult?.hospital_id
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

  async function handleTriageSearch(event) {
    event.preventDefault();
    if (!description.trim()) return;

    setLoading(true);
    setError(null);
    setTriageAnalysis(null);

    try {
      const { lat, lng } = await getUserCoordinates();
      const res = await api.post('/api/search/triage', {
        description: description.trim(),
        latitude: lat,
        longitude: lng,
        radius_km: 20,
      });

      const analysis = res.data.parsed_requirements;
      setTriageAnalysis(analysis);

      if (analysis?.urgency === 'low') {
        const clinics = hospitals.filter(
          (hospital) =>
            hospital.beds?.length === 0 ||
            ['clinic', 'pharmacy'].includes(hospital.hospital_type)
        );
        setClinicResults(clinics.length > 0 ? clinics : hospitals.slice(-5));
        setStep(STEPS.LOW_URGENCY);
        return;
      }

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
      const { lat, lng } = await getUserCoordinates();
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
    const hospital = hospitals.find((item) => item.id === result.hospital_id);
    if (hospital) onHospitalSelect(hospital);
    if (description && !patientCondition) {
      setPatientCondition(description);
    }
    setStep(STEPS.PATIENT);
  }

  async function handleBookBed(event) {
    event.preventDefault();
    if (!selectedResult || !patientPhone.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.post('/api/handshakes', {
        receiving_hospital_id: selectedResult.hospital_id,
        bed_type: Object.keys(selectedResult.beds || {})[0] || 'emergency',
        requesting_party_type: 'individual',
        requesting_party_phone: patientPhone.trim(),
        patient_summary: `${patientName ? `${patientName}. ` : ''}${
          patientCondition || description || 'Emergency'
        }`.trim(),
        hold_duration_min: 45,
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

  async function handleOverrideToHospitals() {
    setLoading(true);
    setError(null);

    if (triageAnalysis) {
      setTriageAnalysis({ ...triageAnalysis, urgency: 'medium' });
    }

    try {
      const { lat, lng } = await getUserCoordinates();
      const res = await api.post('/api/search/triage', {
        description: description.trim(),
        latitude: lat,
        longitude: lng,
        radius_km: 20,
      });
      onResults(res.data.results);
      setStep(STEPS.RESULTS);
    } catch (err) {
      setError('Search failed.');
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
    setClinicResults(null);
    setRerouteResults(null);
    setRerouteLoading(false);
    onClear();
  }

  function copyCode() {
    if (!transferCode) return;

    navigator.clipboard.writeText(transferCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Expand search panel"
        className="absolute left-4 top-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/90 text-slate-200 shadow-lg transition hover:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
      >
        <ChevronRight size={18} />
      </button>
    );
  }

  const header = getStepCopy(step, searchResults, selectedResult, transferCode);

  return (
    <aside className={shellClass} aria-label="Emergency search panel">
      <header className="border-b border-slate-800/80 px-4 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {step !== STEPS.SEARCH && (
                <button
                  type="button"
                  onClick={() => {
                    if (step === STEPS.RESULTS) {
                      setStep(STEPS.SEARCH);
                      onClear();
                    } else if (step === STEPS.LOW_URGENCY) {
                      setStep(STEPS.SEARCH);
                    } else if (step === STEPS.PATIENT) {
                      setStep(STEPS.RESULTS);
                    }
                  }}
                  aria-label="Go back"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                  Emergency routing
                </p>
                <h2 className="text-lg font-semibold tracking-tight text-white">{header.title}</h2>
              </div>
            </div>
            <p className="max-w-[32ch] text-sm leading-5 text-slate-400">{header.description}</p>
          </div>

          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse search panel"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-900 hover:text-slate-200 focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
          >
            <ChevronLeft size={18} />
          </button>
        </div>

        <nav aria-label="Progress" className="mt-4">
          <ol className="flex items-center gap-2">
            {getProgressItems(step).map((item, index, items) => (
              <li key={item.label} className="flex min-w-0 flex-1 items-center gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                      item.state === 'complete'
                        ? 'bg-cyan-500 text-slate-950'
                        : item.state === 'current'
                          ? 'border border-cyan-400/50 bg-cyan-500/10 text-cyan-300'
                          : 'border border-slate-700 bg-slate-900 text-slate-500'
                    }`}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span
                    className={`truncate text-xs font-medium ${
                      item.state === 'pending' ? 'text-slate-500' : 'text-slate-300'
                    }`}
                  >
                    {item.label}
                  </span>
                </div>
                {index < items.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={`h-px flex-1 ${
                      item.state === 'complete' ? 'bg-cyan-500/50' : 'bg-slate-800'
                    }`}
                  />
                )}
              </li>
            ))}
          </ol>
        </nav>
      </header>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="mx-4 mt-4 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 sm:mx-6"
        >
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-red-300" />
          <p className="flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-red-200 transition hover:bg-red-500/10 focus:outline-none focus:ring-4 focus:ring-red-500/20"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {step === STEPS.SEARCH && (
          <section className="space-y-4" aria-labelledby="search-panel-heading">
            <div className={`${surfaceClass} p-4 sm:p-5`}>
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 id="search-panel-heading" className="text-base font-semibold text-white">
                    Start with the fastest path
                  </h3>
                  <p className="text-sm leading-6 text-slate-400">
                    Use triage when you need the best-fit facility, or search nearby for the
                    quickest list.
                  </p>
                </div>
              </div>

              <div
                className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-950/60 p-1"
                role="tablist"
                aria-label="Search mode"
              >
                <ModeButton
                  active={mode === 'triage'}
                  icon={<Brain size={14} />}
                  label="Smart triage"
                  description="Best match"
                  onClick={() => setMode('triage')}
                />
                <ModeButton
                  active={mode === 'quick'}
                  icon={<MapPin size={14} />}
                  label="Nearby"
                  description="Fastest list"
                  onClick={() => setMode('quick')}
                />
              </div>

              {mode === 'triage' ? (
                <form onSubmit={handleTriageSearch} className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <label
                      htmlFor="emergency-description"
                      className="text-sm font-medium text-slate-300"
                    >
                      Describe what is happening
                    </label>
                    <textarea
                      id="emergency-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="My father collapsed, he's diabetic, and he has a head injury."
                      rows={5}
                      className={`${inputClass} resize-none leading-6`}
                    />
                    <p className="text-xs leading-5 text-slate-500">
                      Include age, symptoms, injuries, or anything the hospital should know.
                    </p>
                  </div>

                  <button type="submit" disabled={loading || !description.trim()} className={primaryButtonClass}>
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Analyzing need
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
                <div className="mt-4 space-y-4">
                  <div className={`${subtleSurfaceClass} p-4`}>
                    <p className="text-sm leading-6 text-slate-400">
                      We’ll use your current location to show nearby hospitals with available
                      capacity.
                    </p>
                  </div>
                  <button type="button" onClick={handleQuickSearch} disabled={loading} className={primaryButtonClass}>
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Searching nearby
                      </>
                    ) : (
                      <>
                        <Search size={16} />
                        Find hospitals near me
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {step === STEPS.RESULTS && (
          <section className="space-y-4" aria-labelledby="results-heading">
            {triageAnalysis && (
              <AnalysisCard triageAnalysis={triageAnalysis} tone="cyan" title="Triage summary" />
            )}

            {triageAnalysis?.urgency === 'medium' && (
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-300" />
                  <p>Consider a clinic if the situation is stable and symptoms are not worsening.</p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 id="results-heading" className="text-base font-semibold text-white">
                    Recommended hospitals
                  </h3>
                  <p className="text-sm text-slate-400">
                    Sorted by fit, distance, and current availability.
                  </p>
                </div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  {searchResults?.length || 0} results
                </p>
              </div>

              {searchResults?.length ? (
                <ul className="space-y-3" aria-label="Hospital results">
                  {searchResults.map((result, index) => (
                    <li key={result.hospital_id}>
                      <ResultCard result={result} index={index} onSelect={handleSelectHospital} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No hospitals found nearby"
                  description="Try expanding your search area or use a different description."
                />
              )}
            </div>
          </section>
        )}

        {step === STEPS.LOW_URGENCY && (
          <section className="space-y-4" aria-labelledby="clinic-heading">
            {triageAnalysis && (
              <AnalysisCard triageAnalysis={triageAnalysis} tone="amber" title="Assessment summary" />
            )}

            <div className={`${surfaceClass} p-4 sm:p-5`}>
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-300" />
                <div className="space-y-2">
                  <h3 id="clinic-heading" className="text-base font-semibold text-white">
                    Non-emergency care is likely appropriate
                  </h3>
                  <p className="text-sm leading-6 text-slate-400">
                    Based on the description, a clinic or pharmacy may be a better next step than
                    an emergency department.
                  </p>
                </div>
              </div>

              {triageAnalysis?.self_care_advice?.length > 0 && (
                <div className="mt-4 border-t border-slate-800 pt-4">
                  <p className="text-sm font-medium text-slate-300">Self-care suggestions</p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
                    {triageAnalysis.self_care_advice.map((tip, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-500" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Seek urgent care immediately if symptoms worsen or new severe symptoms appear.
                  </p>
                </div>
              )}
            </div>

            {clinicResults?.length ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-white">Nearby clinics and pharmacies</h3>
                  <p className="text-sm text-slate-400">Safer, lower-friction care options nearby.</p>
                </div>

                <div className="space-y-3">
                  {clinicResults.map((clinic) => (
                    <ClinicCard key={clinic.id} clinic={clinic} />
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleOverrideToHospitals}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/15 active:bg-red-500/20 focus:outline-none focus:ring-4 focus:ring-red-500/20"
            >
              <AlertTriangle size={14} />
              I still need a hospital
            </button>
          </section>
        )}

        {step === STEPS.PATIENT && (
          <section className="space-y-4" aria-labelledby="patient-heading">
            {selectedResult && (
              <div className={`${surfaceClass} p-4 sm:p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                      Selected hospital
                    </p>
                    <h3 id="patient-heading" className="text-base font-semibold text-white">
                      {selectedResult.name}
                    </h3>
                    {selectedResult.address && (
                      <p className="text-sm leading-6 text-slate-400">{selectedResult.address}</p>
                    )}
                  </div>
                  <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs font-medium text-slate-300">
                    {selectedResult.distance_km} km
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleBookBed} className={`${surfaceClass} space-y-4 p-4 sm:p-5`}>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-white">Patient details</h3>
                <p className="text-sm text-slate-400">
                  Share the minimum needed so the receiving team can prepare.
                </p>
              </div>

              <FieldLabel htmlFor="patient-name" icon={<User size={14} />} text="Patient name" />
              <input
                id="patient-name"
                type="text"
                value={patientName}
                onChange={(event) => setPatientName(event.target.value)}
                placeholder="John Doe"
                className={inputClass}
              />

              <div className="space-y-2">
                <FieldLabel
                  htmlFor="patient-phone"
                  icon={<Phone size={14} />}
                  text="Phone number"
                  required
                />
                <input
                  id="patient-phone"
                  type="tel"
                  value={patientPhone}
                  onChange={(event) => setPatientPhone(event.target.value)}
                  placeholder="+234..."
                  required
                  aria-describedby="patient-phone-help"
                  className={inputClass}
                />
                <p id="patient-phone-help" className="text-xs leading-5 text-slate-500">
                  The hospital receives the notification through WhatsApp.
                </p>
              </div>

              <div className="space-y-2">
                <FieldLabel htmlFor="patient-condition" icon={<FileText size={14} />} text="Brief condition" />
                <textarea
                  id="patient-condition"
                  value={patientCondition}
                  onChange={(event) => setPatientCondition(event.target.value)}
                  placeholder="Male, 68, fell from height, head injury."
                  rows={4}
                  className={`${inputClass} resize-none leading-6`}
                />
              </div>

              <button type="submit" disabled={loading || !patientPhone.trim()} className={primaryButtonClass}>
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Reserving bed
                  </>
                ) : (
                  'Reserve bed'
                )}
              </button>
            </form>
          </section>
        )}

        {step === STEPS.TRACKING && (
          <section className="space-y-4" aria-labelledby="tracking-heading">
            <div className={`${surfaceClass} p-4 sm:p-5`}>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    Reservation status
                  </p>
                  <h3 id="tracking-heading" className="text-base font-semibold text-white">
                    Track this transfer live
                  </h3>
                </div>
                {handshakeLoading && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs text-slate-400">
                    <Loader2 size={12} className="animate-spin" />
                    Updating
                  </span>
                )}
              </div>

              {transferCode && (
                <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/8 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-200/80">
                    Transfer code
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-3xl font-bold tracking-[0.24em] text-white">{transferCode}</span>
                    <button
                      type="button"
                      onClick={copyCode}
                      aria-label={codeCopied ? 'Transfer code copied' : 'Copy transfer code'}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/20 bg-slate-950/60 text-cyan-200 transition hover:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
                    >
                      {codeCopied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} />}
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">Show this code when you arrive.</p>
                </div>
              )}

              {selectedResult && (
                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-white">{selectedResult.name}</h4>
                    {selectedResult.address && (
                      <p className="text-sm leading-6 text-slate-400">{selectedResult.address}</p>
                    )}
                  </div>
                  {selectedResult.phone && (
                    <a
                      href={`tel:${selectedResult.phone}`}
                      className="mt-4 inline-flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
                    >
                      <span className="flex items-center gap-2">
                        <Phone size={14} className="text-cyan-300" />
                        {selectedResult.phone}
                      </span>
                      <span className="text-xs text-slate-500">Tap to call</span>
                    </a>
                  )}
                </div>
              )}
            </div>

            {handshake?.status === 'completed' ? (
              <div className={`${surfaceClass} p-6 text-center`}>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
                  <CheckCircle2 size={30} className="text-emerald-400" />
                </div>
                <h3 className="mt-4 text-xl font-semibold text-white">Arrival confirmed</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  The hospital has verified your code and completed check-in.
                </p>
                {transferCode && (
                  <div className="mx-auto mt-4 inline-flex rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                    <span className="font-mono text-lg font-semibold tracking-[0.24em] text-emerald-300">
                      {transferCode}
                    </span>
                  </div>
                )}
                <button type="button" onClick={handleReset} className={`${secondaryButtonClass} mt-6 w-auto px-5`}>
                  Close
                </button>
              </div>
            ) : (
              <div className={`${surfaceClass} p-4 sm:p-5`} aria-live="polite">
                <ol className="space-y-4">
                  <li>
                    <StatusStep label="Reservation created" status="done" detail={selectedResult?.name} />
                  </li>
                  <li>
                    <StatusStep label="Hospital notified via WhatsApp" status="done" />
                  </li>
                  <li>
                    <StatusStep
                      label="Waiting for hospital response"
                      status={getWaitingStatus(handshake?.status)}
                      detail={
                        !handshake || handshake.status === 'requested'
                          ? 'This usually takes 1 to 3 minutes.'
                          : undefined
                      }
                    />
                  </li>

                  {handshake?.status === 'accepted' && (
                    <>
                      <li>
                        <StatusStep
                          label="Bed confirmed"
                          status="done"
                          detail={`Held for ${countdown ? Math.ceil(countdown / 60) : 45} minutes`}
                          highlight
                        />
                      </li>
                      <li>
                        <StatusStep
                          label="Awaiting your arrival"
                          status="active"
                          detail="Show your transfer code to the nurse on arrival."
                        />
                      </li>
                    </>
                  )}

                  {handshake?.status === 'declined' && (
                    <li>
                      <StatusStep
                        label="Hospital could not hold a bed"
                        status="failed"
                        detail={getDeclineReason(handshake.declined_reason)}
                      />
                    </li>
                  )}

                  {handshake?.status === 'expired' && (
                    <li>
                      <StatusStep
                        label="Reservation expired"
                        status="failed"
                        detail="The hold time ran out."
                      />
                    </li>
                  )}

                  {handshake?.status === 'overridden' && (
                    <>
                      <li>
                        <StatusStep
                          label="Bed reassigned"
                          status="failed"
                          detail="A critical walk-in required immediate care. We understand this is frustrating."
                        />
                      </li>
                      {rerouteLoading && (
                        <li>
                          <StatusStep
                            label="Finding another hospital"
                            status="active"
                            detail="We’re searching automatically now."
                          />
                        </li>
                      )}
                      {rerouteResults && rerouteResults.length > 0 && (
                        <li>
                          <StatusStep
                            label={`Found ${rerouteResults.length} alternative${rerouteResults.length > 1 ? 's' : ''}`}
                            status="done"
                            detail="Select one below to continue."
                            highlight
                          />
                        </li>
                      )}
                      {rerouteResults && rerouteResults.length === 0 && (
                        <li>
                          <StatusStep
                            label="No alternatives found nearby"
                            status="failed"
                            detail="Try a new search with a wider area."
                          />
                        </li>
                      )}
                    </>
                  )}
                </ol>
              </div>
            )}

            {handshake?.status === 'overridden' && rerouteResults?.length > 0 && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-white">Alternative hospitals</h3>
                  <p className="text-sm text-slate-400">
                    Pick another option and we’ll continue with the reservation flow.
                  </p>
                </div>
                <ul className="space-y-3">
                  {rerouteResults.map((result, index) => (
                    <li key={result.hospital_id}>
                      <ResultCard
                        result={result}
                        index={index}
                        compact
                        onSelect={(item) => {
                          setSelectedResult(item);
                          const hospital = hospitals.find((entry) => entry.id === item.hospital_id);
                          if (hospital) onHospitalSelect(hospital);
                          setHandshakeId(null);
                          setTransferCode(null);
                          setRerouteResults(null);
                          if (description && !patientCondition) {
                            setPatientCondition(description);
                          }
                          setStep(STEPS.PATIENT);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {handshake?.status === 'accepted' && selectedResult && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <a
                  href={`https://maps.google.com/maps?daddr=${encodeURIComponent(
                    selectedResult.address || `${selectedResult.name} Lagos`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 active:bg-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                >
                  <Navigation size={16} />
                  Get directions
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    `BedSignal - Bed Reserved\n\nHospital: ${selectedResult.name}\nTransfer Code: ${transferCode}\nAddress: ${
                      selectedResult.address || ''
                    }\n\nDirections: https://maps.google.com/maps?daddr=${encodeURIComponent(
                      selectedResult.address || `${selectedResult.name} Lagos`
                    )}\n\nShow the transfer code on arrival.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#20bd5a] active:bg-[#1ca652] focus:outline-none focus:ring-4 focus:ring-[#25D366]/20"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  Share details
                </a>
              </div>
            )}

            {(handshake?.status === 'declined' ||
              handshake?.status === 'expired' ||
              handshake?.status === 'overridden') && (
              <button type="button" onClick={handleReset} className={primaryButtonClass}>
                Search again
              </button>
            )}

            {handshake?.status === 'accepted' && countdown > 0 && (
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-4 text-center">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-amber-200/80">
                  Bed hold expires in
                </p>
                <p className="mt-2 font-mono text-2xl font-semibold text-amber-100">
                  {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                </p>
                <p className="mt-1 text-sm text-amber-100/80">Please arrive before the timer ends.</p>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="border-t border-slate-800/80 px-4 py-4 sm:px-6">
        {step === STEPS.TRACKING ? (
          <button
            type="button"
            onClick={handleReset}
            className="text-sm font-medium text-slate-400 transition hover:text-white focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
          >
            Start a new search
          </button>
        ) : (
          <p className="text-xs leading-5 text-slate-500">
            In an emergency, text <span className="font-semibold text-cyan-300">EMERGENCY</span> to
            our WhatsApp line.
          </p>
        )}
      </footer>
    </aside>
  );
}

function ModeButton({ active, icon, label, description, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-xl px-3 py-3 text-left transition focus:outline-none focus:ring-4 focus:ring-cyan-500/20 ${
        active
          ? 'bg-slate-900 text-white shadow-sm ring-1 ring-cyan-500/20'
          : 'text-slate-400 hover:bg-slate-900/70 hover:text-slate-200'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span className={active ? 'text-cyan-300' : 'text-slate-500'}>{icon}</span>
        {label}
      </span>
      <span className="mt-1 block text-xs text-slate-500">{description}</span>
    </button>
  );
}

function AnalysisCard({ triageAnalysis, tone, title }) {
  const urgencyTone =
    triageAnalysis?.urgency === 'critical'
      ? 'bg-red-500/15 text-red-200'
      : triageAnalysis?.urgency === 'high'
        ? 'bg-amber-500/15 text-amber-100'
        : 'bg-emerald-500/15 text-emerald-100';
  const toneClass =
    tone === 'amber'
      ? 'border-amber-500/20 bg-amber-500/8'
      : 'border-cyan-500/20 bg-cyan-500/8';

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{title}</p>
          <h3 className="text-base font-semibold text-white">
            {formatConditionCategory(triageAnalysis?.condition_category)}
          </h3>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${urgencyTone}`}>
          {triageAnalysis?.urgency || 'unknown'}
        </span>
      </div>
      {triageAnalysis?.required_equipment?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {triageAnalysis.required_equipment.slice(0, 4).map((equipment) => (
            <span
              key={equipment}
              className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs text-slate-300"
            >
              {equipment.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ result, index, onSelect, compact = false }) {
  const beds = result.beds || {};

  return (
    <button
      type="button"
      onClick={() => onSelect(result)}
      className={`group w-full rounded-2xl border border-slate-800 bg-slate-900/75 text-left transition hover:border-cyan-500/30 hover:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-cyan-500/20 ${
        compact ? 'p-4' : 'p-4 sm:p-5'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            index === 0 ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold text-white transition group-hover:text-cyan-300">
                {result.name}
              </h4>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="slate">{result.distance_km} km away</Badge>
                {result.trust_tier === 'verified' && <Badge tone="green">Verified</Badge>}
                {result.trust_tier === 'unverified' && <Badge tone="amber">Unverified</Badge>}
                {result.freshness_hours != null && <Badge tone="slate">{formatFreshness(result.freshness_hours)}</Badge>}
              </div>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(beds).map(([type, data]) => (
              <div key={type} className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
                <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {type}
                </dt>
                <dd
                  className={`mt-1 text-sm font-semibold ${
                    data.available > 0
                      ? 'text-emerald-300'
                      : data.overflow > 0
                        ? 'text-amber-300'
                        : 'text-red-300'
                  }`}
                >
                  {data.available > 0 ? `${data.available} available` : data.overflow > 0 ? `${data.overflow} overflow` : 'No availability'}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </button>
  );
}

function ClinicCard({ clinic }) {
  return (
    <article className={`${surfaceClass} p-4 sm:p-5`}>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-white">{clinic.name}</h4>
        {clinic.address && <p className="text-sm leading-6 text-slate-400">{clinic.address}</p>}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {clinic.phone && (
          <a href={`tel:${clinic.phone}`} className={secondaryButtonClass}>
            <Phone size={14} />
            Call
          </a>
        )}
        <a
          href={`https://maps.google.com/maps?daddr=${encodeURIComponent(
            clinic.address || `${clinic.name} Lagos`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
        >
          <Navigation size={14} />
          Directions
        </a>
      </div>
    </article>
  );
}

function FieldLabel({ htmlFor, icon, text, required = false }) {
  return (
    <label htmlFor={htmlFor} className="flex items-center gap-2 text-sm font-medium text-slate-300">
      <span className="text-slate-500">{icon}</span>
      {text}
      {required && <span className="text-red-300">*</span>}
    </label>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className={`${surfaceClass} px-4 py-8 text-center sm:px-5`}>
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </div>
  );
}

function Badge({ children, tone }) {
  const classes = {
    slate: 'border-slate-700 bg-slate-950/60 text-slate-300',
    green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
  };

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${classes[tone]}`}>
      {children}
    </span>
  );
}

function StatusStep({ label, status, detail, highlight }) {
  const icons = {
    done: <CheckCircle2 size={18} className="text-emerald-400" />,
    active: <Loader2 size={18} className="animate-spin text-cyan-300" />,
    failed: <XCircle size={18} className="text-red-300" />,
    pending: <Clock size={18} className="text-slate-600" />,
  };

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl ${
        highlight ? 'border border-emerald-500/20 bg-emerald-500/8 p-4' : ''
      }`}
    >
      <div className="mt-0.5 flex-shrink-0">{icons[status] || icons.pending}</div>
      <div className="space-y-1">
        <p
          className={`text-sm font-medium ${
            status === 'done'
              ? 'text-white'
              : status === 'active'
                ? 'text-cyan-200'
                : status === 'failed'
                  ? 'text-red-200'
                  : 'text-slate-500'
          }`}
        >
          {label}
        </p>
        {detail && <p className="text-sm leading-6 text-slate-400">{detail}</p>}
      </div>
    </div>
  );
}

function getStepCopy(step, searchResults, selectedResult, transferCode) {
  if (step === STEPS.RESULTS) {
    return {
      title: 'Choose a hospital',
      description: `${searchResults?.length || 0} hospital${searchResults?.length === 1 ? '' : 's'} found`,
    };
  }

  if (step === STEPS.LOW_URGENCY) {
    return {
      title: 'Consider lower-acuity care',
      description: 'A clinic may be a better fit for this situation.',
    };
  }

  if (step === STEPS.PATIENT) {
    return {
      title: 'Add patient details',
      description: selectedResult?.name || 'Share the essentials for handoff.',
    };
  }

  if (step === STEPS.TRACKING) {
    return {
      title: 'Bed reservation',
      description: transferCode ? `Transfer code ${transferCode}` : 'Creating reservation...',
    };
  }

  return {
    title: 'Find a hospital',
    description: 'Describe the situation or search nearby facilities.',
  };
}

function getProgressItems(step) {
  const lowUrgency = step === STEPS.LOW_URGENCY;
  const items = lowUrgency
    ? [
        { label: 'Search', step: STEPS.SEARCH },
        { label: 'Assessment', step: STEPS.LOW_URGENCY },
        { label: 'Clinics', step: STEPS.LOW_URGENCY },
      ]
    : [
        { label: 'Search', step: STEPS.SEARCH },
        { label: 'Select', step: STEPS.RESULTS },
        { label: 'Details', step: STEPS.PATIENT },
        { label: 'Track', step: STEPS.TRACKING },
      ];
  const order = lowUrgency
    ? [STEPS.SEARCH, STEPS.LOW_URGENCY, STEPS.LOW_URGENCY]
    : [STEPS.SEARCH, STEPS.RESULTS, STEPS.PATIENT, STEPS.TRACKING];
  const currentIndex = order.indexOf(step);

  return items.map((item, index) => ({
    ...item,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'pending',
  }));
}

function getWaitingStatus(status) {
  if (!status || status === 'requested') return 'active';
  if (status === 'accepted' || status === 'overridden') return 'done';
  if (status === 'declined' || status === 'expired') return 'failed';
  return 'pending';
}

function getDeclineReason(reason) {
  return (
    {
      no_beds: 'All beds are currently occupied.',
      wrong_specialty: 'This hospital does not have the specialty required.',
      equipment_unavailable: 'Required equipment is currently unavailable.',
      too_severe: 'The condition needs a higher-level facility.',
      too_minor: 'The condition may not need hospital care.',
    }[reason] || reason || 'Try another hospital.'
  );
}

function formatConditionCategory(value) {
  if (!value) return 'General emergency';
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatFreshness(hours) {
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  return `${Math.round(hours)} h ago`;
}

async function getUserCoordinates() {
  try {
    const position = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
    );

    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  } catch (_) {
    return FALLBACK_LOCATION;
  }
}
