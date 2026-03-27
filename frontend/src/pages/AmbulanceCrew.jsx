/**
 * AmbulanceCrew — mobile page for the ambulance crew to update their status.
 *
 * Route: /ambulance/:ambulanceId/crew
 * Shows: current assignment, big status buttons, status history.
 * The crew taps through stages: Dispatched → En Route → At Scene → To Hospital → Delivered.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Ambulance, MapPin, Navigation, CheckCircle2, Loader2, AlertTriangle,
  Clock3, Building2, Activity, CircleDot, ShieldAlert
} from 'lucide-react';
import api from '../lib/api';

const STATUS_FLOW = [
  { id: 'dispatched', label: 'Dispatched', desc: 'Assignment received', icon: Ambulance },
  { id: 'en_route_to_patient', label: 'To patient', desc: 'Heading to the pickup location', icon: Navigation },
  { id: 'at_scene', label: 'At scene', desc: 'Crew has arrived at the patient location', icon: MapPin },
  { id: 'en_route_to_hospital', label: 'To hospital', desc: 'Patient is onboard and heading to hospital', icon: Building2 },
  { id: 'delivered', label: 'Delivered', desc: 'Patient has been handed over to the hospital', icon: CheckCircle2 },
];

const SEVERITY_META = {
  critical: { label: 'Critical', className: 'bg-red-50 text-red-600 border-red-100', icon: ShieldAlert },
  high: { label: 'High', className: 'bg-amber-50 text-amber-600 border-amber-100', icon: AlertTriangle },
  medium: { label: 'Medium', className: 'bg-sky-50 text-sky-700 border-sky-100', icon: Activity },
  low: { label: 'Low', className: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: CheckCircle2 },
};

function timeSince(iso) {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

export default function AmbulanceCrew() {
  const { ambulanceId } = useParams();
  const [ambulance, setAmbulance] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [rerouted, setRerouted] = useState(false);
  const [rerouteNote, setRerouteNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const dashRes = await api.get(`/api/dispatch/ambulances/${ambulanceId}/active`);
      setAmbulance(dashRes.data.ambulance);
      setAssignment(dashRes.data.assignment);
      setTimeline(dashRes.data.timeline || []);
      setRerouted(dashRes.data.rerouted || false);
      setRerouteNote(dashRes.data.reroute_note || null);
      setLastRefresh(new Date());
      setError(null);
    } catch {
      setError('No active assignment found for this ambulance.');
    } finally {
      setLoading(false);
    }
  }, [ambulanceId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function handleStatusUpdate(newStatus) {
    if (!assignment) return;
    setUpdating(true);
    try {
      await api.post(`/api/dispatch/assignments/${assignment.id}/status`, {
        status: newStatus,
      });
      await fetchData();
    } catch (err) {
      console.error('Status update failed:', err);
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <Loader2 size={18} className="animate-spin text-slate-700" />
          </div>
          <p className="text-sm text-slate-500">Loading crew page...</p>
        </div>
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <Ambulance size={40} className="mx-auto mb-3 text-slate-400" />
          <p className="mb-1 text-lg font-medium text-slate-900">{error || 'No active assignment'}</p>
          <p className="text-sm text-slate-500">Waiting for dispatch to assign a pickup.</p>
        </div>
      </div>
    );
  }

  const currentIdx = STATUS_FLOW.findIndex((status) => status.id === assignment.status);
  const nextStatus = currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null;
  const isComplete = assignment.status === 'delivered' || assignment.status === 'cancelled';
  const severity = SEVERITY_META[assignment._patient?.severity] || SEVERITY_META.medium;
  const SeverityIcon = severity.icon;

  return (
    <div className="min-h-screen bg-[#eef2f7] px-3 py-4 text-slate-900 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-[760px]">
        <div className="rounded-[32px] border border-black/5 bg-[#141414] p-3 shadow-[0_24px_80px_rgba(15,23,42,0.18)] sm:p-4">
          <div className="rounded-[28px] bg-[#f7f8fb] p-3 sm:p-4">
            <CrewTopBar ambulance={ambulance} isComplete={isComplete} />

            <div className="mt-4 space-y-4">
              {rerouted && (
                <section className="rounded-[26px] border border-red-200 bg-red-50 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <ShieldAlert size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-800">Destination changed</p>
                      <p className="mt-1 text-sm text-red-700">
                        {rerouteNote || 'The original hospital overrode the bed. You have been rerouted to a new hospital.'}
                      </p>
                      {assignment._hospital && (
                        <p className="mt-2 text-sm font-semibold text-red-900">
                          New destination: {assignment._hospital.name}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}
              <section className="rounded-[26px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current trip</p>
                    <h1 className="mt-2 text-[1.55rem] font-semibold tracking-tight text-slate-950">
                      {assignment._patient?.tag_number || 'Active assignment'}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Follow the trip steps below and update the status as the crew moves.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${severity.className}`}>
                      <SeverityIcon size={12} />
                      {severity.label}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                      Updated {lastRefresh ? timeSince(lastRefresh.toISOString()) : '—'}
                    </span>
                  </div>
                </div>

                {assignment._patient?.condition_notes ? (
                  <p className="mt-4 rounded-[18px] bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                    {assignment._patient.condition_notes}
                  </p>
                ) : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <InfoCard
                    icon={MapPin}
                    label="Pickup"
                    title={assignment.pickup_address || 'Location shared'}
                    sub="Patient pickup point"
                  />
                  <InfoCard
                    icon={Building2}
                    label="Hospital"
                    title={assignment._hospital?.name || 'Hospital not available'}
                    sub={assignment._hospital?.address || 'Destination hospital'}
                  />
                </div>

                {assignment._transfer_code ? (
                  <div className="mt-4 rounded-[20px] border border-amber-100 bg-amber-50 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-600">Transfer code</p>
                    <p className="mt-2 font-mono text-[1.85rem] font-semibold tracking-[0.18em] text-slate-950">
                      {assignment._transfer_code}
                    </p>
                    <p className="mt-1 text-sm text-amber-700">Show this code when you arrive at the hospital.</p>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {assignment.pickup_address && assignment.status === 'en_route_to_patient' ? (
                    <a
                      href={`https://maps.google.com/maps?daddr=${encodeURIComponent(assignment.pickup_address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                    >
                      <Navigation size={14} />
                      Navigate to patient
                    </a>
                  ) : null}

                  {assignment._hospital && (assignment.status === 'en_route_to_hospital' || assignment.status === 'at_scene') ? (
                    <a
                      href={`https://maps.google.com/maps?daddr=${encodeURIComponent(assignment._hospital.address || `${assignment._hospital.name} Lagos`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      <Navigation size={14} />
                      Navigate to hospital
                    </a>
                  ) : null}
                </div>
              </section>

              <section className="rounded-[26px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="border-b border-slate-100 pb-4">
                  <p className="text-base font-semibold text-slate-950">Progress</p>
                  <p className="mt-1 text-sm text-slate-500">Track each handoff step from dispatch to delivery.</p>
                </div>

                <div className="mt-5 space-y-4">
                  {STATUS_FLOW.map((step, index) => {
                    const Icon = step.icon;
                    const isDone = index <= currentIdx;
                    const isCurrent = index === currentIdx;
                    const timelineEntry = timeline.find((item) => item.status === step.id);

                    return (
                      <div key={step.id} className="flex items-start gap-3">
                        <div className="flex flex-col items-center">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-full border ${
                              isDone ? 'border-emerald-100 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-50 text-slate-400'
                            } ${isCurrent ? 'ring-2 ring-emerald-100' : ''}`}
                          >
                            <Icon size={16} />
                          </div>
                          {index < STATUS_FLOW.length - 1 ? (
                            <div className={`mt-2 h-8 w-px ${isDone && index < currentIdx ? 'bg-emerald-200' : 'bg-slate-200'}`} />
                          ) : null}
                        </div>

                        <div className="min-w-0 flex-1 pb-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className={`text-sm font-semibold ${isDone ? 'text-slate-950' : 'text-slate-500'}`}>
                                {step.label}
                              </p>
                              <p className="mt-1 text-sm text-slate-500">{step.desc}</p>
                            </div>
                            <div className="text-sm text-slate-400 sm:text-right">
                              {timelineEntry ? formatTime(timelineEntry.created_at) : 'Waiting'}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {!isComplete && nextStatus ? (
                <button
                  type="button"
                  onClick={() => handleStatusUpdate(nextStatus.id)}
                  disabled={updating}
                  className="inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[20px] bg-slate-950 px-5 text-base font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                >
                  {updating ? <Loader2 size={18} className="animate-spin" /> : <CircleDot size={18} />}
                  Mark as {nextStatus.label.toLowerCase()}
                </button>
              ) : null}

              {isComplete ? (
                <section className="rounded-[26px] border border-emerald-100 bg-emerald-50 px-5 py-5 text-center">
                  <CheckCircle2 size={26} className="mx-auto text-emerald-600" />
                  <p className="mt-3 text-base font-semibold text-emerald-800">Assignment complete</p>
                  <p className="mt-1 text-sm text-emerald-700">Patient has been delivered and the trip is finished.</p>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CrewTopBar({ ambulance, isComplete }) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
          <Ambulance size={16} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{ambulance?.vehicle_id || 'Ambulance'}</p>
          <p className="mt-0.5 text-xs text-slate-400">{ambulance?.plate_number || 'Crew assignment'}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium text-slate-200">
        <Clock3 size={13} />
        {isComplete ? 'Trip complete' : 'Trip active'}
      </div>
    </div>
  );
}

function InfoCard({ icon, label, title, sub }) {
  const IconComponent = icon;

  return (
    <div className="rounded-[20px] border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
          <IconComponent size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-1 text-sm font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{sub}</p>
        </div>
      </div>
    </div>
  );
}