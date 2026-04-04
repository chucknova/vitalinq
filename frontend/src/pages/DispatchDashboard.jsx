/**
 * DispatchDashboard — fleet management for ambulance dispatch companies.
 *
 * Route: /dispatch/:slug
 * Shows: ambulance fleet with statuses, active assignments, stats.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Ambulance, Plus, RefreshCw, X, Loader2,
  AlertTriangle, User, MapPin, Clock3, ChevronDown, Wrench,
  Building2, Activity, Phone, ShieldAlert, Navigation, CircleDot,
  CheckCircle2, Truck, LogOut, Lock
} from 'lucide-react';
import api from '../lib/api';
import HistoryNav from '../components/HistoryNav';

const STATUS_CONFIG = {
  available: { label: 'Available', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  dispatched: { label: 'Dispatched', badge: 'bg-sky-50 text-sky-700 border-sky-100' },
  en_route_to_patient: { label: 'To patient', badge: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
  at_scene: { label: 'At scene', badge: 'bg-amber-50 text-amber-700 border-amber-100' },
  en_route_to_hospital: { label: 'To hospital', badge: 'bg-violet-50 text-violet-700 border-violet-100' },
  offline: { label: 'Offline', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
  maintenance: { label: 'Maintenance', badge: 'bg-red-50 text-red-600 border-red-100' },
};

const TYPE_LABELS = {
  BLS: 'Basic Life Support',
  ALS: 'Advanced Life Support',
  motorcycle: 'First Responder Bike',
};

const SEVERITY_META = {
  critical: { label: 'Critical', className: 'bg-red-50 text-red-600 border-red-100', icon: ShieldAlert },
  high: { label: 'High', className: 'bg-amber-50 text-amber-600 border-amber-100', icon: AlertTriangle },
  medium: { label: 'Medium', className: 'bg-sky-50 text-sky-700 border-sky-100', icon: Activity },
  low: { label: 'Low', className: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: CheckCircle2 },
};

const ASSIGNMENT_STAGES = [
  { id: 'assigned', label: 'Dispatched', icon: Ambulance },
  { id: 'en_route_to_patient', label: 'To patient', icon: Navigation },
  { id: 'at_scene', label: 'At scene', icon: MapPin },
  { id: 'en_route_to_hospital', label: 'To hospital', icon: Building2 },
  { id: 'delivered', label: 'Delivered', icon: CheckCircle2 },
];

const DASHBOARD_POLL_MS = 20000;

function timeSince(iso) {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function formatClock(date = new Date()) {
  return date.toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function DispatchDashboard() {
  const { slug } = useParams();
  const [pinVerified, setPinVerified] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [pendingTransports, setPendingTransports] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [now, setNow] = useState(new Date());
  const intervalRef = useRef(null);

  // Check if PIN is already verified in sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(`dispatch_pin_${slug}`);
    if (saved === 'verified') {
      setPinVerified(true);
    }
  }, [slug]);

  const fetchData = useCallback(async () => {
    if (!pinVerified) return;
    try {
      const res = await api.get(`/api/dispatch/${slug}`);
      setData(res.data);
      setPendingTransports(res.data.pending_transports || []);
      setLastRefresh(new Date());
      setError(null);
    } catch {
      setError('Failed to load dispatch data.');
      setPendingTransports([]);
    } finally {
      setLoading(false);
    }
  }, [slug, pinVerified]);

  useEffect(() => {
    if (!pinVerified) return;
    fetchData();
    intervalRef.current = setInterval(fetchData, DASHBOARD_POLL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchData, pinVerified]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function handleStatusChange(ambulanceId, newStatus) {
    setActionLoading((prev) => ({ ...prev, [ambulanceId]: true }));
    try {
      await api.patch(`/api/dispatch/ambulances/${ambulanceId}`, { status: newStatus });
      await fetchData();
    } catch (err) {
      console.error('Status update failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [ambulanceId]: false }));
    }
  }

  async function handleDelete(ambulanceId, vehicleId) {
    if (!confirm(`Remove ambulance ${vehicleId}?`)) return;
    try {
      await api.delete(`/api/dispatch/ambulances/${ambulanceId}`);
      await fetchData();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  async function handleTransportAssign(transportId, ambulanceId) {
    setActionLoading((prev) => ({ ...prev, [`tr_${transportId}`]: true }));
    try {
      const company = data?.company;
      await api.post(`/api/transport/${transportId}/dispatch-respond`, {
        company_id: company.id,
        ambulance_id: ambulanceId,
      });
      await fetchData();
    } catch (err) {
      console.error('Transport assign failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`tr_${transportId}`]: null }));
    }
  }

  async function handleVerifyPin(e) {
    e.preventDefault();
    setPinLoading(true);
    setPinError(null);
    try {
      await api.post(`/api/dispatch/${slug}/verify-pin`, { pin: pinInput });
      sessionStorage.setItem(`dispatch_pin_${slug}`, 'verified');
      setPinVerified(true);
    } catch (err) {
      setPinError(err.response?.data?.detail || 'Incorrect PIN');
    } finally {
      setPinLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(`dispatch_pin_${slug}`);
    setPinVerified(false);
    setPinInput('');
    setData(null);
  }

  // ── PIN gate ────────────────────────────────────────
  if (!pinVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50">
            <Lock size={24} className="text-sky-600" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Dispatch Access</h1>
          <p className="mt-1 text-sm text-slate-500">Enter your company PIN to continue</p>

          {pinError && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600">
              {pinError}
            </div>
          )}

          <form onSubmit={handleVerifyPin} className="mt-5">
            <input
              type="password"
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              placeholder="Enter PIN"
              autoFocus
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-2xl font-mono tracking-[0.3em] text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
            <button
              type="submit"
              disabled={pinLoading || !pinInput.trim()}
              className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
            >
              {pinLoading ? <Loader2 size={16} className="animate-spin" /> : 'Verify'}
            </button>
          </form>

          <Link to="/" className="mt-4 inline-block text-xs text-slate-400 hover:text-slate-600">
            Back to map
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <RefreshCw size={18} className="animate-spin text-slate-700" />
          </div>
          <p className="text-sm text-slate-500">Loading dispatch dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <AlertTriangle size={40} className="mx-auto mb-3 text-red-500" />
          <p className="mb-1 text-lg font-medium text-slate-900">Something went wrong</p>
          <p className="text-sm text-slate-500">{error || 'Dispatch company not found.'}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-medium text-sky-600 hover:underline">
            Go to Pulse Map
          </Link>
        </div>
      </div>
    );
  }

  const { company, ambulances, assignments, stats } = data;
  const activeAssignments = assignments.filter((assignment) => !['delivered', 'cancelled'].includes(assignment.status));

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1280px]">
        <div className="rounded-[36px] border border-black/5 bg-[#141414] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="rounded-[30px] bg-[#f7f8fb] p-3 sm:p-4">
            <TopBar
              company={company}
              now={now}
              slug={slug}
              onAdd={() => setShowAddForm(true)}
              onLogout={handleLogout}
            />

            <div className="mt-4 space-y-4">
              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Dispatch</p>
                    <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-slate-950">Fleet and transport activity</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      Manage available ambulances, assign pickups, and follow active trips from one place.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <HeaderInfoCard
                      icon={Building2}
                      label="Coverage"
                      value={company.coverage_area || 'Coverage area not set'}
                      sub={company.address || 'Address not set'}
                    />
                    <HeaderInfoCard
                      icon={Activity}
                      label="Refresh"
                      value={lastRefresh ? timeSince(lastRefresh.toISOString()) : '—'}
                      sub="Updates every 20 seconds"
                    />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-4">
                  <SummaryCard label="Fleet" value={stats.total} sub="Registered ambulances" tone="sky" />
                  <SummaryCard label="Available" value={stats.available} sub="Ready for a new pickup" tone="emerald" />
                  <SummaryCard label="Active trips" value={stats.dispatched} sub="Currently on the road" tone="amber" />
                  <SummaryCard label="Offline" value={stats.offline} sub="Not available right now" tone="slate" />
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <SectionHeader title="Fleet" count={ambulances.length} subtitle="Vehicles, crews, and current availability." />

                  {ambulances.length === 0 ? (
                    <EmptyState text="No ambulances have been added yet." />
                  ) : (
                    <div className="mt-5 space-y-3">
                      {ambulances.map((ambulance) => (
                        <FleetCard
                          key={ambulance.id}
                          ambulance={ambulance}
                          loading={actionLoading[ambulance.id]}
                          onDelete={handleDelete}
                          onStatusChange={handleStatusChange}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <div className="space-y-4">
                  <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                    <SectionHeader
                      title="Transport requests"
                      count={pendingTransports.length}
                      subtitle="New pickup requests waiting for an ambulance."
                    />

                    {pendingTransports.length === 0 ? (
                      <EmptyState text="No transport requests are waiting right now." compact />
                    ) : (
                      <div className="mt-5 space-y-3">
                        {pendingTransports.map((request) => (
                          <TransportRequestCard
                            key={request.id}
                            request={request}
                            ambulances={ambulances.filter((ambulance) => ambulance.status === 'available')}
                            loading={actionLoading[`tr_${request.id}`]}
                            onAssign={(ambulanceId) => handleTransportAssign(request.id, ambulanceId)}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-slate-950">Active assignments</p>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                            {activeAssignments.length}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">Trips currently in progress.</p>
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
                        <RefreshCw size={12} className="animate-spin" style={{ animationDuration: '10s' }} />
                        Live updates
                      </div>
                    </div>

                    {activeAssignments.length === 0 ? (
                      <EmptyState text="No active assignments right now." compact />
                    ) : (
                      <div className="mt-5 space-y-3">
                        {activeAssignments.map((assignment) => (
                          <AssignmentCard key={assignment.id} assignment={assignment} />
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAddForm && (
        <AddAmbulanceModal
          slug={slug}
          onClose={() => setShowAddForm(false)}
          onAdded={() => {
            setShowAddForm(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

function TopBar({ company, now, slug, onAdd, onLogout }) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <HistoryNav backFallback="/" />
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium">
          <CircleDot size={12} className="text-sky-400" />
          Dispatch
        </div>
        <div className="hidden items-center gap-2 rounded-full bg-white/[0.04] px-4 py-2 text-sm text-slate-300 md:flex">
          <Ambulance size={13} />
          Fleet management
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/hospital/${slug}/dashboard`}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white/8 px-4 text-sm font-medium text-slate-200 transition hover:bg-white/12"
        >
          Hospital view
        </Link>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
        >
          <Plus size={14} />
          Add ambulance
        </button>
        <div className="text-right text-xs text-slate-400">
          <p className="font-medium text-slate-300">{company.name}</p>
          <p className="mt-0.5 font-mono">{formatClock(now)}</p>
        </div>
        <button
          onClick={onLogout}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-slate-400 transition hover:bg-red-500/15 hover:text-red-400"
          title="Log out"
        >
          <LogOut size={15} />
        </button>
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

function SummaryCard({ label, value, sub, tone }) {
  const tones = {
    sky: 'bg-sky-50 text-sky-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
  };

  return (
    <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-[1.75rem] font-semibold tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{sub}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-[18px] ${tones[tone] || tones.sky}`}>
          <Ambulance size={16} />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, count, subtitle }) {
  return (
    <div className="border-b border-slate-100 pb-4">
      <div className="flex items-center gap-2">
        <p className="text-base font-semibold text-slate-950">{title}</p>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{count}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function EmptyState({ text, compact = false }) {
  return (
    <div className={`${compact ? 'py-12' : 'py-16'} text-center text-sm text-slate-500`}>
      {text}
    </div>
  );
}

function FleetCard({ ambulance, loading, onDelete, onStatusChange }) {
  const status = STATUS_CONFIG[ambulance.status] || STATUS_CONFIG.offline;

  return (
    <div className="rounded-[24px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-base font-semibold text-slate-950">{ambulance.vehicle_id}</p>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.badge}`}>
              {status.label}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {TYPE_LABELS[ambulance.type] || ambulance.type}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
            {ambulance.plate_number ? (
              <span className="font-medium text-slate-700">{ambulance.plate_number}</span>
            ) : (
              <span>No plate number</span>
            )}
            {ambulance.crew_name ? <span>{ambulance.crew_name}</span> : <span>No crew assigned</span>}
            {ambulance.crew_phone ? <span>{ambulance.crew_phone}</span> : null}
          </div>

          {ambulance.note ? (
            <p className="mt-3 text-sm leading-6 text-slate-500">{ambulance.note}</p>
          ) : null}

          {ambulance.status !== 'available' && ambulance.status !== 'offline' && ambulance.status !== 'maintenance' ? (
            <a
              href={`/ambulance/${ambulance.id}/crew`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-sky-600 hover:underline"
            >
              Open crew page
            </a>
          ) : null}
        </div>

        <div className="flex items-center gap-2 lg:justify-end">
          <StatusDropdown
            current={ambulance.status}
            loading={loading}
            onChange={(nextStatus) => onStatusChange(ambulance.id, nextStatus)}
          />
          <button
            type="button"
            onClick={() => onDelete(ambulance.id, ambulance.vehicle_id)}
            className="inline-flex min-h-[38px] items-center rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-500 transition hover:border-red-200 hover:text-red-600"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function TransportRequestCard({ request, ambulances, loading, onAssign }) {
  const severity = SEVERITY_META[request.severity] || SEVERITY_META.medium;
  const SeverityIcon = severity.icon;

  return (
    <div className="rounded-[24px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-slate-950">Ambulance pickup request</p>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${severity.className}`}>
              <SeverityIcon size={12} />
              {severity.label}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-2">
              <MapPin size={14} className="text-slate-400" />
              {request.pickup_address || 'Location shared'}
            </span>
            {request._hospital ? (
              <span className="inline-flex items-center gap-2">
                <Building2 size={14} className="text-slate-400" />
                {request._hospital.name}
              </span>
            ) : null}
          </div>
        </div>

        <TransportAssignDropdown ambulances={ambulances} loading={loading} onAssign={onAssign} />
      </div>
    </div>
  );
}

function AssignmentCard({ assignment }) {
  const status = STATUS_CONFIG[assignment.status] || STATUS_CONFIG.dispatched;
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const completedStatuses = new Set(timeline.map((item) => item.status));
  const currentIdx = ASSIGNMENT_STAGES.findIndex((stage) => stage.id === assignment.status);

  async function handleToggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || timeline.length > 0 || timelineLoading) return;

    setTimelineLoading(true);
    try {
      const res = await api.get(`/api/dispatch/assignments/${assignment.id}/track`);
      setTimeline(res.data.timeline || []);
    } catch (err) {
      console.error('Assignment timeline failed:', err);
    } finally {
      setTimelineLoading(false);
    }
  }

  return (
    <div className="rounded-[24px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {assignment._ambulance ? (
              <p className="font-mono text-base font-semibold text-slate-950">{assignment._ambulance.vehicle_id}</p>
            ) : null}
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.badge}`}>
              {status.label}
            </span>
            {assignment._patient ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {assignment._patient.tag_number}
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
            {assignment.pickup_address ? (
              <span className="inline-flex items-center gap-2">
                <MapPin size={14} className="text-slate-400" />
                {assignment.pickup_address}
              </span>
            ) : null}
            {assignment._hospital ? (
              <span className="inline-flex items-center gap-2">
                <Building2 size={14} className="text-slate-400" />
                {assignment._hospital.name}
              </span>
            ) : null}
            {assignment._transfer_code ? (
              <span className="font-mono text-slate-700">{assignment._transfer_code}</span>
            ) : null}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleToggleOpen}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            >
              {timelineLoading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />}
              {open ? 'Hide timeline' : 'View timeline'}
            </button>

            {open ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {ASSIGNMENT_STAGES.map((stage, index) => {
                  const Icon = stage.icon;
                  const isDone = index <= currentIdx || completedStatuses.has(stage.id);
                  const isCurrent = stage.id === assignment.status;
                  const timeEntry = timeline.find((item) => item.status === stage.id);

                  return (
                    <div key={stage.id} className="flex items-center gap-2">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                          isDone ? 'border-emerald-100 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-50 text-slate-400'
                        } ${isCurrent ? 'ring-2 ring-emerald-100' : ''}`}
                      >
                        <Icon size={16} />
                      </div>
                      <div>
                        <p className={`text-xs font-medium ${isDone ? 'text-slate-700' : 'text-slate-400'}`}>{stage.label}</p>
                        {timeEntry ? (
                          <p className="text-[11px] text-slate-400">
                            {new Date(timeEntry.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="text-sm text-slate-500 lg:text-right">
          <p className="font-medium text-slate-700">{timeSince(assignment.assigned_at)}</p>
          <a
            href={`/ambulance/${assignment.ambulance_id}/crew`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-2 font-medium text-sky-600 hover:underline"
          >
            Open crew page
          </a>
        </div>
      </div>
    </div>
  );
}

function StatusDropdown({ current, loading, onChange }) {
  const [open, setOpen] = useState(false);
  const options = [
    { id: 'available', label: 'Available', icon: CheckCircle2 },
    { id: 'offline', label: 'Offline', icon: Clock3 },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
        Update status
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-44 rounded-2xl border border-slate-200 bg-white py-1 shadow-xl">
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  current === option.id ? 'bg-slate-50 text-slate-950' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`}
              >
                <Icon size={14} />
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AddAmbulanceModal({ slug, onClose, onAdded }) {
  const [vehicleId, setVehicleId] = useState('');
  const [plate, setPlate] = useState('');
  const [type, setType] = useState('BLS');
  const [crewName, setCrewName] = useState('');
  const [crewPhone, setCrewPhone] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!vehicleId.trim()) return;
    setLoading(true);
    try {
      await api.post(`/api/dispatch/${slug}/ambulances`, {
        vehicle_id: vehicleId.trim(),
        plate_number: plate.trim(),
        type,
        crew_name: crewName.trim(),
        crew_phone: crewPhone.trim(),
      });
      onAdded();
    } catch (err) {
      console.error('Add failed:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-[28px] border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fleet</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">Add ambulance</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 transition hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <label htmlFor="vehicleId" className="mb-1 block text-xs font-medium text-slate-500">Vehicle ID</label>
            <input
              id="vehicleId"
              type="text"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              placeholder="AMB-005"
              required
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="plate" className="mb-1 block text-xs font-medium text-slate-500">Plate number</label>
            <input
              id="plate"
              type="text"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="KJA-234-XY"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="type" className="mb-1 block text-xs font-medium text-slate-500">Vehicle type</label>
            <select
              id="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-sky-300 focus:outline-none"
            >
              <option value="BLS">Basic Life Support</option>
              <option value="ALS">Advanced Life Support</option>
              <option value="motorcycle">First Responder Bike</option>
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="crewName" className="mb-1 block text-xs font-medium text-slate-500">Crew name</label>
              <input
                id="crewName"
                type="text"
                value={crewName}
                onChange={(e) => setCrewName(e.target.value)}
                placeholder="Driver name"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="crewPhone" className="mb-1 block text-xs font-medium text-slate-500">Crew phone</label>
              <input
                id="crewPhone"
                type="tel"
                value={crewPhone}
                onChange={(e) => setCrewPhone(e.target.value)}
                placeholder="+234..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !vehicleId.trim()}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add to fleet
          </button>
        </form>
      </div>
    </div>
  );
}

function TransportAssignDropdown({ ambulances, loading, onAssign }) {
  const [open, setOpen] = useState(false);

  if (ambulances.length === 0) {
    return <p className="text-sm text-slate-400">No ambulances available</p>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
        Assign ambulance
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-2xl border border-slate-200 bg-white py-1 shadow-xl">
          {ambulances.map((ambulance) => (
            <button
              key={ambulance.id}
              type="button"
              onClick={() => {
                onAssign(ambulance.id);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left transition hover:bg-slate-50"
            >
              <p className="font-mono text-sm font-semibold text-slate-950">{ambulance.vehicle_id}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {ambulance.plate_number || 'No plate number'} · {ambulance.crew_name || 'No crew'}
              </p>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
