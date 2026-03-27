/**
 * BroadcastPatientLog — paramedic logs patients at the scene.
 *
 * Route: /broadcast/:id/log
 * Mobile-optimized. Quick severity selection and minimal typing.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Check, Loader2, AlertTriangle, Radio, Users, X,
  ShieldAlert, Activity, HeartPulse, CircleDot, ClipboardList
} from 'lucide-react';
import api from '../lib/api';

const SEVERITY_OPTIONS = [
  { id: 'critical', label: 'Critical', icon: ShieldAlert, tone: 'bg-red-50 text-red-600 border-red-100', dot: 'bg-red-500', desc: 'Life-threatening' },
  { id: 'high', label: 'High', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-600 border-amber-100', dot: 'bg-amber-500', desc: 'Serious but stable' },
  { id: 'medium', label: 'Medium', icon: Activity, tone: 'bg-sky-50 text-sky-700 border-sky-100', dot: 'bg-sky-500', desc: 'Needs care soon' },
  { id: 'low', label: 'Low', icon: HeartPulse, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500', desc: 'Lower urgency' },
  { id: 'deceased', label: 'Deceased', icon: CircleDot, tone: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-500', desc: 'No signs of life' },
];

const REQUIREMENT_OPTIONS = [
  'icu', 'surgical', 'ventilator', 'ct_scanner', 'blood_bank',
  'xray', 'pediatric', 'maternity', 'orthopedic', 'oxygen',
];

const REQ_LABELS = {
  icu: 'ICU',
  surgical: 'Surgical',
  ventilator: 'Ventilator',
  ct_scanner: 'CT scanner',
  blood_bank: 'Blood bank',
  xray: 'X-ray',
  pediatric: 'Pediatric',
  maternity: 'Maternity',
  orthopedic: 'Orthopedic',
  oxygen: 'Oxygen',
};

export default function BroadcastPatientLog() {
  const { id } = useParams();
  const [broadcast, setBroadcast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [severity, setSeverity] = useState(null);
  const [condition, setCondition] = useState('');
  const [requirements, setRequirements] = useState([]);
  const [logged, setLogged] = useState([]);
  const [lastTag, setLastTag] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const conditionRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/api/broadcast/${id}`);
        setBroadcast(res.data.broadcast);
        setLogged(res.data.patients || []);
      } catch {
        setError('Broadcast not found.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const recentPatients = useMemo(() => [...logged].reverse().slice(0, 10), [logged]);

  function toggleRequirement(requirement) {
    setRequirements((prev) =>
      prev.includes(requirement) ? prev.filter((item) => item !== requirement) : [...prev, requirement]
    );
  }

  async function handleSubmit() {
    if (!severity) {
      setError('Choose a severity level first.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await api.post(`/api/broadcast/${id}/patients`, {
        severity,
        condition_notes: condition.trim(),
        requirements,
      });

      setLastTag(res.data.tag_number);
      setShowSuccess(true);
      setLogged((prev) => [...prev, {
        tag_number: res.data.tag_number,
        severity: res.data.severity,
        condition_notes: condition.trim(),
      }]);

      setSeverity(null);
      setCondition('');
      setRequirements([]);
      setTimeout(() => setShowSuccess(false), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to log patient.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <Loader2 size={18} className="animate-spin text-slate-700" />
          </div>
          <p className="text-sm text-slate-500">Loading patient log...</p>
        </div>
      </div>
    );
  }

  if (error && !broadcast) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <AlertTriangle size={40} className="mx-auto mb-3 text-red-500" />
          <p className="mb-1 text-lg font-medium text-slate-900">{error}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-medium text-sky-600 hover:underline">
            Go to Pulse Map
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[980px]">
        <div className="rounded-[36px] border border-black/5 bg-[#141414] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="rounded-[30px] bg-[#f7f8fb] p-3 sm:p-4">
            <TopBar broadcast={broadcast} id={id} count={logged.length} />

            <div className="mt-4 space-y-4">
              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Patient log</p>
                    <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-slate-950">Add patients from the scene</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      Capture severity, short notes, and care needs quickly so the command center can route patients faster.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <HeaderInfoCard
                      icon={Users}
                      label="Logged"
                      value={logged.length}
                      sub="Patients added to this incident"
                    />
                    <HeaderInfoCard
                      icon={ClipboardList}
                      label="Incident"
                      value={broadcast?.title || 'Broadcast'}
                      sub="Shared with the command center"
                    />
                  </div>
                </div>
              </section>

              {showSuccess && lastTag ? (
                <section className="rounded-[24px] border border-emerald-100 bg-emerald-50 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
                      <Check size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-emerald-800">{lastTag} logged</p>
                      <p className="text-sm text-emerald-700">Patient added to the broadcast queue.</p>
                    </div>
                  </div>
                </section>
              ) : null}

              {error ? (
                <section className="rounded-[24px] border border-red-100 bg-red-50 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle size={16} className="text-red-600" />
                    <p className="text-sm font-medium text-red-700">{error}</p>
                    <button type="button" onClick={() => setError(null)} className="ml-auto text-red-500 transition hover:text-red-700">
                      <X size={14} />
                    </button>
                  </div>
                </section>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <div className="border-b border-slate-100 pb-4">
                    <p className="text-base font-semibold text-slate-950">New patient</p>
                    <p className="mt-1 text-sm text-slate-500">Choose severity first, then add any notes or care needs.</p>
                  </div>

                  <div className="mt-5 space-y-5">
                    <div>
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Severity</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {SEVERITY_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const active = severity === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setSeverity(option.id);
                                setTimeout(() => conditionRef.current?.focus(), 100);
                              }}
                              className={`rounded-[22px] border px-4 py-4 text-left transition ${
                                active ? `${option.tone} shadow-sm` : 'border-slate-200 bg-slate-50 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${active ? 'bg-white' : 'bg-white/70'} shadow-sm`}>
                                  <Icon size={16} />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-slate-950">{option.label}</p>
                                  <p className="mt-1 text-xs text-slate-500">{option.desc}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="condition" className="mb-3 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Condition notes
                      </label>
                      <input
                        id="condition"
                        ref={conditionRef}
                        type="text"
                        value={condition}
                        onChange={(e) => setCondition(e.target.value)}
                        placeholder="Head injury, bleeding, difficulty breathing..."
                        className="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Care needs</p>
                      <div className="flex flex-wrap gap-2">
                        {REQUIREMENT_OPTIONS.map((requirement) => (
                          <button
                            key={requirement}
                            type="button"
                            onClick={() => toggleRequirement(requirement)}
                            className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                              requirements.includes(requirement)
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:text-slate-700'
                            }`}
                          >
                            {REQ_LABELS[requirement] || requirement}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!severity || submitting}
                      className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                    >
                      {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      {submitting ? 'Logging patient...' : 'Log patient'}
                    </button>
                  </div>
                </section>

                <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-slate-950">Recent entries</p>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                        {recentPatients.length}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">The latest patients logged from the field.</p>
                  </div>

                  {recentPatients.length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-500">No patients logged yet.</div>
                  ) : (
                    <div className="mt-5 max-h-[560px] space-y-3 overflow-y-auto pr-1">
                      {recentPatients.map((patient, index) => {
                        const severityMeta = SEVERITY_OPTIONS.find((option) => option.id === patient.severity) || SEVERITY_OPTIONS[2];
                        return (
                          <RecentLogCard key={`${patient.tag_number}-${index}`} patient={patient} severityMeta={severityMeta} />
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({ broadcast, id, count }) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/broadcast/${id}`} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium">
          <Radio size={13} className="text-red-400" />
          Broadcast log
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-full bg-white/[0.06] px-4 py-2 text-sm text-slate-200">
          {count} logged
        </div>
        <div className="text-right text-xs text-slate-400">
          <p className="font-medium text-slate-300">{broadcast?.title}</p>
          <p className="mt-0.5">Shared with dispatch and hospitals</p>
        </div>
      </div>
    </div>
  );
}

function HeaderInfoCard({ icon, label, value, sub }) {
  const IconComponent = icon;

  return (
    <div className="min-w-[180px] rounded-[22px] border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
          <IconComponent size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{sub}</p>
        </div>
      </div>
    </div>
  );
}

function RecentLogCard({ patient, severityMeta }) {
  const Icon = severityMeta.icon;

  return (
    <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${severityMeta.tone}`}>
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold text-slate-950">{patient.tag_number}</p>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${severityMeta.tone}`}>
              {severityMeta.label}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">{patient.condition_notes || 'No notes added.'}</p>
        </div>
      </div>
    </div>
  );
}
