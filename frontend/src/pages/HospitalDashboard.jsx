import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bed,
  Check,
  ChevronDown,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
  Users,
  X,
  Zap,
} from 'lucide-react';
import api from '../lib/api';

const BED_LABELS = {
  icu: 'ICU',
  ward: 'Ward',
  maternity: 'Maternity',
  emergency: 'Emergency',
  pediatric: 'Pediatric',
  surgical: 'Surgical',
  psychiatric: 'Psychiatric',
};

const BED_COLORS = {
  icu: { dot: 'bg-red-400', ring: 'ring-red-500/20', soft: 'bg-red-500/10 text-red-200 border-red-500/20' },
  ward: { dot: 'bg-blue-400', ring: 'ring-blue-500/20', soft: 'bg-blue-500/10 text-blue-200 border-blue-500/20' },
  maternity: { dot: 'bg-pink-400', ring: 'ring-pink-500/20', soft: 'bg-pink-500/10 text-pink-200 border-pink-500/20' },
  emergency: { dot: 'bg-amber-400', ring: 'ring-amber-500/20', soft: 'bg-amber-500/10 text-amber-100 border-amber-500/20' },
  pediatric: { dot: 'bg-violet-400', ring: 'ring-violet-500/20', soft: 'bg-violet-500/10 text-violet-200 border-violet-500/20' },
  surgical: { dot: 'bg-cyan-400', ring: 'ring-cyan-500/20', soft: 'bg-cyan-500/10 text-cyan-200 border-cyan-500/20' },
  psychiatric: { dot: 'bg-lime-400', ring: 'ring-lime-500/20', soft: 'bg-lime-500/10 text-lime-200 border-lime-500/20' },
};

const URGENCY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const DECLINE_OPTIONS = [
  { id: 'no_beds', label: 'No beds available' },
  { id: 'wrong_specialty', label: 'Wrong specialty' },
  { id: 'equipment_unavailable', label: 'Equipment unavailable' },
  { id: 'too_severe', label: 'Condition too severe' },
  { id: 'too_minor', label: 'Condition too minor' },
  { id: 'other', label: 'Other reason' },
];

const URGENCY_OPTIONS = [
  {
    id: 'critical',
    label: 'Critical',
    desc: 'Life-threatening and needs immediate care',
    badge: 'bg-red-500/10 text-red-200 border-red-500/20',
  },
  {
    id: 'high',
    label: 'High',
    desc: 'Serious condition, but currently stable',
    badge: 'bg-amber-500/10 text-amber-100 border-amber-500/20',
  },
  {
    id: 'medium',
    label: 'Medium',
    desc: 'Needs prompt care but is not critical',
    badge: 'bg-yellow-500/10 text-yellow-100 border-yellow-500/20',
  },
];

const pageShellClass = 'min-h-screen bg-slate-950 text-slate-100';
const surfaceClass =
  'rounded-3xl border border-slate-800 bg-slate-900/80 shadow-[0_1px_2px_rgba(15,23,42,0.35)]';
const subtleSurfaceClass = 'rounded-2xl border border-slate-800/80 bg-slate-900/45';
const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-500/20 disabled:cursor-not-allowed disabled:opacity-50';

function formatTime(iso) {
  if (!iso) return 'Never';
  const date = new Date(iso);
  const now = new Date();
  const hrs = (now - date) / (1000 * 60 * 60);
  if (hrs < 0.1) return 'Just now';
  if (hrs < 1) return `${Math.round(hrs * 60)}m ago`;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function getUrgencyConfig(urgency) {
  return (
    {
      critical: { label: 'Critical', className: 'bg-red-500/10 text-red-200 border-red-500/20' },
      high: { label: 'High', className: 'bg-amber-500/10 text-amber-100 border-amber-500/20' },
      medium: { label: 'Medium', className: 'bg-yellow-500/10 text-yellow-100 border-yellow-500/20' },
      low: { label: 'Low', className: 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20' },
    }[urgency] || null
  );
}

function getFreshnessTone(score) {
  if (score >= 0.8) return 'emerald';
  if (score >= 0.4) return 'amber';
  return 'red';
}

function getFreshnessLabel(score) {
  if (score >= 0.8) return 'Fresh';
  if (score >= 0.4) return 'Getting stale';
  return 'Stale';
}

export default function HospitalDashboard() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [sortBy, setSortBy] = useState('time');
  const intervalRef = useRef(null);

  const sortedHandshakes = useMemo(() => {
    if (!data?.active_handshakes) return [];
    return [...data.active_handshakes].sort((a, b) => {
      if (sortBy === 'urgency') {
        const aUrg = a.parsed_requirements?.urgency || 'medium';
        const bUrg = b.parsed_requirements?.urgency || 'medium';
        return (URGENCY_ORDER[aUrg] ?? 3) - (URGENCY_ORDER[bUrg] ?? 3);
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [data?.active_handshakes, sortBy]);

  async function fetchDashboard() {
    try {
      const res = await api.get(`/api/hospitals/dashboard/${slug}`);
      setData(res.data);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Hospital not found. Check the URL.');
      } else {
        setError('Failed to load dashboard.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboard();
    intervalRef.current = setInterval(fetchDashboard, 10000);
    return () => clearInterval(intervalRef.current);
  }, [slug]);

  async function handleIncrement(bedType) {
    setActionLoading((prev) => ({ ...prev, [bedType]: 'inc' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/beds/${bedType}/increment`);
      setData((prev) => ({
        ...prev,
        beds: prev.beds.map((bed) =>
          bed.bed_type === bedType
            ? {
                ...bed,
                available_count: Math.min(
                  (bed.available_count || 0) + 1,
                  bed.total_count || 999
                ),
              }
            : bed
        ),
      }));
    } catch (err) {
      console.error('Increment failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [bedType]: null }));
    }
  }

  async function handleDecrement(bedType) {
    setActionLoading((prev) => ({ ...prev, [bedType]: 'dec' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/beds/${bedType}/decrement`);
      setData((prev) => ({
        ...prev,
        beds: prev.beds.map((bed) =>
          bed.bed_type === bedType
            ? { ...bed, available_count: Math.max((bed.available_count || 0) - 1, 0) }
            : bed
        ),
      }));
    } catch (err) {
      console.error('Decrement failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [bedType]: null }));
    }
  }

  async function handleStillAccurate() {
    setActionLoading((prev) => ({ ...prev, _global: 'accurate' }));
    try {
      const beds = data.beds.map((bed) => ({
        bed_type: bed.bed_type,
        available_count: bed.available_count || 0,
        overflow_count: bed.overflow_count || 0,
      }));
      await api.post(`/api/hospitals/dashboard/${slug}/beds`, {
        beds,
        reported_by: 'Dashboard - Still Accurate',
      });
      await fetchDashboard();
    } catch (err) {
      console.error('Still accurate failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, _global: null }));
    }
  }

  async function handleAllFull() {
    if (!confirm('Set ALL bed types to zero? This cannot be undone.')) return;
    setActionLoading((prev) => ({ ...prev, _global: 'full' }));
    try {
      const beds = data.beds.map((bed) => ({
        bed_type: bed.bed_type,
        available_count: 0,
        overflow_count: 0,
      }));
      await api.post(`/api/hospitals/dashboard/${slug}/beds`, {
        beds,
        reported_by: 'Dashboard - All Full',
      });
      await fetchDashboard();
    } catch (err) {
      console.error('All full failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, _global: null }));
    }
  }

  async function handleAccept(handshakeId) {
    setActionLoading((prev) => ({ ...prev, [`hs_${handshakeId}`]: 'accept' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/accept/${handshakeId}`);
      await fetchDashboard();
    } catch (err) {
      console.error('Accept failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`hs_${handshakeId}`]: null }));
    }
  }

  async function handleDecline(handshakeId, reason = 'no_beds') {
    setActionLoading((prev) => ({ ...prev, [`hs_${handshakeId}`]: 'decline' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/decline/${handshakeId}`, { reason });
      await fetchDashboard();
    } catch (err) {
      console.error('Decline failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`hs_${handshakeId}`]: null }));
    }
  }

  async function handleOverride(handshakeId, walkinUrgency) {
    setActionLoading((prev) => ({ ...prev, [`hs_${handshakeId}`]: 'override' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/override/${handshakeId}`, {
        walkin_urgency: walkinUrgency,
      });
      await fetchDashboard();
    } catch (err) {
      console.error('Override failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`hs_${handshakeId}`]: null }));
    }
  }

  async function handleComplete(handshakeId) {
    setActionLoading((prev) => ({ ...prev, [`hs_${handshakeId}`]: 'complete' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/complete/${handshakeId}`);
      await fetchDashboard();
    } catch (err) {
      console.error('Complete failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`hs_${handshakeId}`]: null }));
    }
  }

  if (loading) {
    return (
      <div className={`${pageShellClass} flex items-center justify-center px-6`}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10">
            <Loader2 size={22} className="animate-spin text-cyan-300" />
          </div>
          <p className="text-sm font-medium text-slate-300">Loading hospital dashboard</p>
          <p className="mt-1 text-sm text-slate-500">Preparing live bed status and incoming patients.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${pageShellClass} flex items-center justify-center px-6`}>
        <div className={`${surfaceClass} w-full max-w-md p-8 text-center`}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
            <AlertTriangle size={26} className="text-red-300" />
          </div>
          <h1 className="text-xl font-semibold text-white">Unable to load dashboard</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  const { hospital, beds, active_handshakes, stats } = data;
  const totalAvailableBeds = beds.reduce((sum, bed) => sum + (bed.available_count || 0), 0);
  const totalCapacity = beds.reduce((sum, bed) => sum + (bed.total_count || 0), 0);
  const totalOverflow = beds.reduce((sum, bed) => sum + (bed.overflow_count || 0), 0);

  return (
    <div className={pageShellClass}>
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <Link
                to="/"
                aria-label="Back to home"
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
              >
                <ArrowLeft size={18} />
              </Link>

              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                  Hospital operations
                </p>
                <h1 className="truncate text-2xl font-semibold tracking-tight text-white">
                  {hospital.name}
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Live bed management, patient intake, and operational signals in one place.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to={`/log/${slug}`}
                className={`${secondaryButtonClass} justify-center`}
              >
                <Users size={16} />
                Patient log
              </Link>

              <div className={`${subtleSurfaceClass} flex items-center gap-2 px-3 py-2`}>
                <RefreshCw
                  size={14}
                  className="text-slate-500 animate-spin"
                  style={{ animationDuration: '10s' }}
                />
                <div className="text-sm">
                  <p className="font-medium text-slate-300">Auto-refreshing</p>
                  <p className="text-slate-500">
                    {lastRefresh ? `Updated ${formatTime(lastRefresh.toISOString())}` : 'Waiting for refresh'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryTile
              icon={<Bed size={18} className="text-cyan-300" />}
              label="Beds available now"
              value={totalAvailableBeds}
              detail={`${totalCapacity} total capacity`}
            />
            <SummaryTile
              icon={<Zap size={18} className="text-amber-300" />}
              label="Incoming patients"
              value={active_handshakes.length}
              detail={active_handshakes.some((item) => item.status === 'accepted') ? 'Includes active holds' : 'No active holds yet'}
            />
            <SummaryTile
              icon={<ShieldCheck size={18} className="text-emerald-300" />}
              label="Reporting freshness"
              value={stats.hours_since_last_report != null ? `${stats.hours_since_last_report}h` : '—'}
              detail={getFreshnessLabel(stats.freshness_score || 0)}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <h2 className="text-lg font-semibold text-white">Quick actions</h2>
            <p className="mt-1 text-sm text-slate-400">
              Use these for full-dashboard updates when the live numbers are still accurate or all capacity is unavailable.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleStillAccurate}
              disabled={!!actionLoading._global}
              className={`${primaryButtonClass} bg-emerald-500/12 text-emerald-100 border border-emerald-500/20 hover:bg-emerald-500/18`}
            >
              {actionLoading._global === 'accurate' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Check size={16} />
              )}
              All still accurate
            </button>
            <button
              type="button"
              onClick={handleAllFull}
              disabled={!!actionLoading._global}
              className={`${primaryButtonClass} bg-red-500/12 text-red-100 border border-red-500/20 hover:bg-red-500/18`}
            >
              {actionLoading._global === 'full' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <AlertTriangle size={16} />
              )}
              Mark all full
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
          <section className="space-y-6">
            <div>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Bed availability</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Update live capacity by unit with one-tap actions and clear status visibility.
                  </p>
                </div>
                <div className={`${subtleSurfaceClass} flex items-center gap-4 px-4 py-3 text-sm`}>
                  <div>
                    <p className="text-slate-500">Open beds</p>
                    <p className="font-semibold text-white">{totalAvailableBeds}</p>
                  </div>
                  <div className="h-8 w-px bg-slate-800" />
                  <div>
                    <p className="text-slate-500">Overflow</p>
                    <p className="font-semibold text-white">{totalOverflow}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {beds.map((bed) => (
                  <BedCard
                    key={bed.bed_type}
                    bed={bed}
                    loadingState={actionLoading[bed.bed_type]}
                    onIncrement={handleIncrement}
                    onDecrement={handleDecrement}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Hospital stats</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Performance and freshness signals for the last reporting window.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Accuracy"
                  value={`${Math.round((stats.accuracy_score || 0.5) * 100)}%`}
                  sub={stats.trust_tier || 'Unknown'}
                  tone={stats.trust_tier === 'verified' ? 'emerald' : stats.trust_tier === 'unverified' ? 'red' : 'slate'}
                />
                <StatCard
                  label="Patients routed (7d)"
                  value={stats.patients_routed_7d || 0}
                  sub={`${stats.patients_admitted_7d || 0} admitted`}
                  tone="cyan"
                />
                <StatCard
                  label="Today"
                  value={stats.handshakes_today || 0}
                  sub={`${stats.handshakes_today_by_status?.completed || 0} completed`}
                  tone="blue"
                />
                <StatCard
                  label="Last update"
                  value={stats.hours_since_last_report != null ? `${stats.hours_since_last_report}h` : '—'}
                  sub={getFreshnessLabel(stats.freshness_score || 0)}
                  tone={getFreshnessTone(stats.freshness_score || 0)}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className={`${surfaceClass} p-5 sm:p-6`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">Incoming patients</h2>
                    {active_handshakes.length > 0 && (
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                        {active_handshakes.length}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    Review incoming transfer requests, confirm holds, and manage arrivals.
                  </p>
                </div>

                {active_handshakes.length > 1 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="sort-handshakes" className="text-sm text-slate-500">
                      Sort
                    </label>
                    <select
                      id="sort-handshakes"
                      value={sortBy}
                      onChange={(event) => setSortBy(event.target.value)}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/10"
                    >
                      <option value="time">Newest first</option>
                      <option value="urgency">Most urgent</option>
                    </select>
                  </div>
                )}
              </div>

              {active_handshakes.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-10 text-center">
                  <p className="text-base font-medium text-slate-300">No incoming patients right now</p>
                  <p className="mt-2 text-sm text-slate-500">
                    New transfer requests will appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {sortedHandshakes.map((handshake) => (
                    <HandshakeCard
                      key={handshake.id}
                      handshake={handshake}
                      loadingState={actionLoading[`hs_${handshake.id}`]}
                      onAccept={handleAccept}
                      onDecline={handleDecline}
                      onComplete={handleComplete}
                      onOverride={handleOverride}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function SummaryTile({ icon, label, value, detail }) {
  return (
    <div className={`${surfaceClass} flex items-start gap-3 p-4`}>
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-white">{value}</p>
        <p className="mt-1 text-sm text-slate-400">{detail}</p>
      </div>
    </div>
  );
}

function BedCard({ bed, loadingState, onIncrement, onDecrement }) {
  const label = BED_LABELS[bed.bed_type] || bed.bed_type;
  const color = BED_COLORS[bed.bed_type] || BED_COLORS.ward;
  const available = bed.available_count || 0;
  const total = bed.total_count || 0;
  const overflow = bed.overflow_count || 0;
  const pct = total > 0 ? (available / total) * 100 : 0;
  const capacityTone =
    pct > 50 ? 'bg-emerald-400' : pct > 10 ? 'bg-amber-400' : 'bg-red-400';

  return (
    <article className={`${surfaceClass} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${color.dot}`} aria-hidden="true" />
            <h3 className="text-base font-semibold text-white">{label}</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">Updated {formatTime(bed.reported_at)}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${color.soft}`}>
          {total > 0 ? `${Math.round(pct)}% open` : 'No total set'}
        </span>
      </div>

      <div className="mt-6 flex items-end justify-between gap-3">
        <div>
          <p className="text-4xl font-semibold tracking-tight text-white">{available}</p>
          <p className="mt-1 text-sm text-slate-500">available of {total}</p>
        </div>
        {overflow > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-right">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-amber-200/80">Overflow</p>
            <p className="mt-1 text-sm font-semibold text-amber-100">+{overflow}</p>
          </div>
        )}
      </div>

      <div className="mt-5">
        <div className="h-2 rounded-full bg-slate-800">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${capacityTone}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onDecrement(bed.bed_type)}
          disabled={!!loadingState || available <= 0}
          aria-label={`Decrease ${label} availability`}
          className={secondaryButtonClass}
        >
          {loadingState === 'dec' ? <Loader2 size={16} className="animate-spin" /> : <Minus size={16} />}
          Mark occupied
        </button>
        <button
          type="button"
          onClick={() => onIncrement(bed.bed_type)}
          disabled={!!loadingState || available >= total}
          aria-label={`Increase ${label} availability`}
          className={`${primaryButtonClass} bg-cyan-500 text-slate-950 hover:bg-cyan-400`}
        >
          {loadingState === 'inc' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Mark open
        </button>
      </div>
    </article>
  );
}

function HandshakeCard({
  handshake,
  loadingState,
  onAccept,
  onDecline,
  onComplete,
  onOverride,
}) {
  const isAccepted = handshake.status === 'accepted';
  const urgency = handshake.parsed_requirements?.urgency || handshake._urgency || null;
  const urgencyConfig = getUrgencyConfig(urgency);
  const bedTypeLabel = BED_LABELS[handshake.bed_type] || (handshake.bed_type || '').toUpperCase();

  return (
    <article
      className={`rounded-2xl border p-4 ${
        isAccepted
          ? 'border-cyan-500/20 bg-cyan-500/5'
          : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-semibold tracking-[0.16em] text-white">
                {handshake.transfer_code}
              </span>
              <Badge>{bedTypeLabel}</Badge>
              {urgencyConfig && <Badge className={urgencyConfig.className}>{urgencyConfig.label}</Badge>}
              <Badge
                className={
                  isAccepted
                    ? 'bg-cyan-500/10 text-cyan-200 border-cyan-500/20'
                    : 'bg-amber-500/10 text-amber-100 border-amber-500/20'
                }
              >
                {isAccepted ? 'Held' : 'Incoming'}
              </Badge>
            </div>

            {handshake.patient_summary && (
              <p className="mt-3 text-sm leading-6 text-slate-300">{handshake.patient_summary}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-500">
              <span>Requested {formatTime(handshake.created_at)}</span>
              {isAccepted && handshake.time_remaining_sec > 0 && (
                <span className="inline-flex items-center gap-2 text-cyan-200">
                  <Timer size={14} />
                  Hold expires in {Math.floor(handshake.time_remaining_sec / 60)}:
                  {String(handshake.time_remaining_sec % 60).padStart(2, '0')}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            {!isAccepted ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => onAccept(handshake.id)}
                  disabled={!!loadingState}
                  className={`${primaryButtonClass} bg-emerald-500 text-white hover:bg-emerald-400`}
                >
                  {loadingState === 'accept' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Check size={16} />
                  )}
                  Accept hold
                </button>
                <DeclineDropdown
                  onDecline={(reason) => onDecline(handshake.id, reason)}
                  loading={loadingState === 'decline'}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => onComplete(handshake.id)}
                  disabled={!!loadingState}
                  className={`${primaryButtonClass} bg-emerald-500 text-white hover:bg-emerald-400`}
                >
                  {loadingState === 'complete' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Check size={16} />
                  )}
                  Mark arrived
                </button>
                <OverrideButton
                  onOverride={(walkinUrgency) => onOverride(handshake.id, walkinUrgency)}
                  loading={loadingState === 'override'}
                  transferCode={handshake.transfer_code}
                  bedType={handshake.bed_type}
                  heldUrgency={urgency}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function StatCard({ label, value, sub, tone }) {
  const tones = {
    emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100',
    cyan: 'border-cyan-500/20 bg-cyan-500/5 text-cyan-100',
    blue: 'border-blue-500/20 bg-blue-500/5 text-blue-100',
    amber: 'border-amber-500/20 bg-amber-500/5 text-amber-100',
    red: 'border-red-500/20 bg-red-500/5 text-red-100',
    slate: 'border-slate-800 bg-slate-900/55 text-slate-100',
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.slate}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{sub}</p>
    </div>
  );
}

function Badge({ children, className = 'bg-slate-900 text-slate-300 border-slate-700' }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function DeclineDropdown({ onDecline, loading }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-100 transition hover:bg-red-500/15 focus:outline-none focus:ring-4 focus:ring-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
        Decline
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-2 w-56 rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl shadow-black/30"
        >
          {DECLINE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onDecline(option.id);
                setOpen(false);
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OverrideButton({ onOverride, loading, transferCode, bedType, heldUrgency }) {
  const [showModal, setShowModal] = useState(false);
  const [selectedUrgency, setSelectedUrgency] = useState(null);
  const [step, setStep] = useState('select');

  function handleClose() {
    setShowModal(false);
    setSelectedUrgency(null);
    setStep('select');
  }

  function handleConfirm() {
    onOverride(selectedUrgency);
    handleClose();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        disabled={loading}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-100 transition hover:bg-red-500/15 focus:outline-none focus:ring-4 focus:ring-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
        Override
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="override-title"
        >
          <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-5 sm:px-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                  Bed hold override
                </p>
                <h3 id="override-title" className="mt-1 text-lg font-semibold text-white">
                  Release this hold for a walk-in
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  {transferCode} · {(BED_LABELS[bedType] || bedType || '').toUpperCase()}
                  {heldUrgency ? ` · current urgency ${heldUrgency}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-slate-900 hover:text-white focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
              >
                <X size={18} />
              </button>
            </div>

            {step === 'select' ? (
              <div className="px-5 py-5 sm:px-6">
                <p className="text-sm text-slate-400">Choose the urgency level for the walk-in patient.</p>
                <div className="mt-4 space-y-3">
                  {URGENCY_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setSelectedUrgency(option.id);
                        setStep('confirm');
                      }}
                      className="w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-left transition hover:border-slate-700 hover:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-base font-semibold text-white">{option.label}</p>
                          <p className="mt-1 text-sm leading-6 text-slate-400">{option.desc}</p>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${option.badge}`}>
                          {option.label}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-5 py-5 sm:px-6">
                <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4">
                  <p className="text-sm font-semibold text-red-100">This action cannot be undone</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    The current patient will lose this bed hold and be rerouted to the nearest available hospital automatically.
                  </p>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-500">Walk-in urgency</span>
                    <span className="font-medium text-white">{selectedUrgency?.toUpperCase()}</span>
                  </div>
                  {heldUrgency && (
                    <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-500">Current hold urgency</span>
                      <span className="font-medium text-white">{heldUrgency.toUpperCase()}</span>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => setStep('select')} className={secondaryButtonClass}>
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className={`${primaryButtonClass} bg-red-500 text-white hover:bg-red-400`}
                  >
                    Confirm override
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
