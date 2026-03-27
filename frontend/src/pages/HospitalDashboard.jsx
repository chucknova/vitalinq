import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Plus, Minus, Check, Loader2,
  BedDouble, AlertTriangle, X, Zap, ChevronDown, Activity,
  ClipboardList, Ambulance, Clock3, ShieldAlert, Building2,
  Search, Filter, MapPinned, TrendingUp, CircleDot, CheckCircle2,
  Stethoscope, ChevronRight
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
  icu: { accent: '#f97316', soft: '#fff3ea' },
  ward: { accent: '#3b82f6', soft: '#eef5ff' },
  maternity: { accent: '#ec4899', soft: '#fff0f7' },
  emergency: { accent: '#ef4444', soft: '#fff1f2' },
  pediatric: { accent: '#14b8a6', soft: '#edfdfa' },
  surgical: { accent: '#8b5cf6', soft: '#f5f3ff' },
  psychiatric: { accent: '#84cc16', soft: '#f7fee7' },
};

const DECLINE_OPTIONS = [
  { id: 'no_beds', label: 'No beds available' },
  { id: 'wrong_specialty', label: 'Wrong specialty' },
  { id: 'equipment_unavailable', label: 'Equipment unavailable' },
  { id: 'too_severe', label: 'Condition too severe' },
  { id: 'too_minor', label: 'Condition too minor' },
  { id: 'other', label: 'Other reason' },
];

const URGENCY_OPTIONS = [
  { id: 'critical', label: 'Critical', icon: ShieldAlert, desc: 'Needs immediate lifesaving care', tone: 'red' },
  { id: 'high', label: 'High', icon: Activity, desc: 'Serious, but stable for now', tone: 'amber' },
  { id: 'medium', label: 'Medium', icon: Clock3, desc: 'Needs care, but not critical', tone: 'slate' },
];

const URGENCY_META = {
  critical: { label: 'Critical', className: 'bg-red-50 text-red-600 border-red-100' },
  high: { label: 'High', className: 'bg-amber-50 text-amber-600 border-amber-100' },
  medium: { label: 'Medium', className: 'bg-sky-50 text-sky-700 border-sky-100' },
  low: { label: 'Low', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
};

const STATUS_META = {
  accepted: { label: 'Held', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  requested: { label: 'Incoming', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  pending: { label: 'Incoming', className: 'bg-amber-50 text-amber-700 border-amber-100' },
};

function formatTime(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const hrs = (now - d) / (1000 * 60 * 60);
  if (hrs < 0.1) return 'Just now';
  if (hrs < 1) return `${Math.round(hrs * 60)}m ago`;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function getFreshnessLabel(hours) {
  if (hours == null) return 'No recent update';
  if (hours <= 2) return 'Fresh';
  if (hours <= 6) return 'Needs review soon';
  return 'Stale';
}

function toneClass(tone) {
  return {
    red: 'border-red-100 bg-red-50 text-red-600',
    amber: 'border-amber-100 bg-amber-50 text-amber-600',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  }[tone] || 'border-slate-200 bg-slate-50 text-slate-600';
}

export default function HospitalDashboard() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [sortBy, setSortBy] = useState('time');
  const [transportRequests, setTransportRequests] = useState([]);
  const [bedDrafts, setBedDrafts] = useState({});
  const intervalRef = useRef(null);

  const URGENCY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedHandshakes = data?.active_handshakes
    ? [...data.active_handshakes].sort((a, b) => {
        if (sortBy === 'urgency') {
          const aUrg = a.parsed_requirements?.urgency || 'medium';
          const bUrg = b.parsed_requirements?.urgency || 'medium';
          return (URGENCY_ORDER[aUrg] ?? 3) - (URGENCY_ORDER[bUrg] ?? 3);
        }
        return new Date(b.created_at) - new Date(a.created_at);
      })
    : [];

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await api.get(`/api/hospitals/dashboard/${slug}`);
      setData(res.data);
      setBedDrafts(
        Object.fromEntries((res.data?.beds || []).map((bed) => [bed.bed_type, String(bed.available_count ?? 0)]))
      );
      setError(null);
      setLastRefresh(new Date());

      try {
        const hospitalId = res.data?.hospital?.id;
        if (hospitalId) {
          const trRes = await api.get(`/api/transport/hospital/${hospitalId}/pending`);
          setTransportRequests(trRes.data.pending || []);
        }
      } catch {
        // Keep page usable if transport requests fail.
      }
    } catch (err) {
      if (err.response?.status === 404) setError('Hospital not found. Check the URL.');
      else setError('Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchDashboard();
    intervalRef.current = setInterval(fetchDashboard, 10000);
    return () => clearInterval(intervalRef.current);
  }, [fetchDashboard]);

  async function handleIncrement(bedType) {
    setActionLoading((prev) => ({ ...prev, [bedType]: 'inc' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/beds/${bedType}/increment`);
      setData((prev) => ({
        ...prev,
        beds: prev.beds.map((b) =>
          b.bed_type === bedType
            ? { ...b, available_count: Math.min((b.available_count || 0) + 1, b.total_count || 999) }
            : b
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
        beds: prev.beds.map((b) =>
          b.bed_type === bedType
            ? { ...b, available_count: Math.max((b.available_count || 0) - 1, 0) }
            : b
        ),
      }));
    } catch (err) {
      console.error('Decrement failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [bedType]: null }));
    }
  }

  async function handleSetBedCount(bedType, rawValue) {
    if (!data?.beds) return;

    const parsed = Number.parseInt(rawValue, 10);
    const target = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
    const currentBed = data.beds.find((bed) => bed.bed_type === bedType);
    if (!currentBed) return;

    const cappedTarget = Math.min(target, currentBed.total_count || target);

    setActionLoading((prev) => ({ ...prev, [bedType]: 'set' }));
    try {
      const bedsPayload = data.beds.map((bed) => ({
        bed_type: bed.bed_type,
        available_count: bed.bed_type === bedType ? cappedTarget : bed.available_count || 0,
        overflow_count: bed.overflow_count || 0,
      }));

      await api.post(`/api/hospitals/dashboard/${slug}/beds`, {
        beds: bedsPayload,
        reported_by: 'Dashboard — Direct Bed Update',
      });

      setData((prev) => ({
        ...prev,
        beds: prev.beds.map((bed) =>
          bed.bed_type === bedType ? { ...bed, available_count: cappedTarget } : bed
        ),
      }));
      setBedDrafts((prev) => ({ ...prev, [bedType]: String(cappedTarget) }));
    } catch (err) {
      console.error('Direct bed update failed:', err);
      setBedDrafts((prev) => ({ ...prev, [bedType]: String(currentBed.available_count || 0) }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [bedType]: null }));
    }
  }

  async function handleStillAccurate() {
    setActionLoading((prev) => ({ ...prev, _global: 'accurate' }));
    try {
      const beds = data.beds.map((b) => ({
        bed_type: b.bed_type,
        available_count: b.available_count || 0,
        overflow_count: b.overflow_count || 0,
      }));
      await api.post(`/api/hospitals/dashboard/${slug}/beds`, {
        beds,
        reported_by: 'Dashboard — Still Accurate',
      });
      await fetchDashboard();
    } catch (err) {
      console.error('Still accurate failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, _global: null }));
    }
  }

  async function handleAllFull() {
    if (!confirm('Set all bed types to zero?')) return;
    setActionLoading((prev) => ({ ...prev, _global: 'full' }));
    try {
      const beds = data.beds.map((b) => ({
        bed_type: b.bed_type,
        available_count: 0,
        overflow_count: 0,
      }));
      await api.post(`/api/hospitals/dashboard/${slug}/beds`, {
        beds,
        reported_by: 'Dashboard — All Full',
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

  async function handleTransportAccept(transportId) {
    setActionLoading((prev) => ({ ...prev, [`tr_${transportId}`]: 'accept' }));
    try {
      await api.post(`/api/transport/${transportId}/hospital-respond`, { accepted: true });
      await fetchDashboard();
    } catch (err) {
      console.error('Transport accept failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`tr_${transportId}`]: null }));
    }
  }

  async function handleTransportDecline(transportId) {
    setActionLoading((prev) => ({ ...prev, [`tr_${transportId}`]: 'decline' }));
    try {
      await api.post(`/api/transport/${transportId}/hospital-respond`, { accepted: false });
      await fetchDashboard();
    } catch (err) {
      console.error('Transport decline failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`tr_${transportId}`]: null }));
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <Loader2 size={20} className="animate-spin text-slate-700" />
          </div>
          <p className="text-sm text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <AlertTriangle size={40} className="mx-auto mb-3 text-red-500" />
          <p className="mb-1 text-lg font-medium text-slate-900">Something went wrong</p>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const { hospital, beds, active_handshakes, stats } = data;
  const totalOpenBeds = beds.reduce((sum, bed) => sum + (bed.available_count || 0), 0);
  const totalBeds = beds.reduce((sum, bed) => sum + (bed.total_count || 0), 0);
  const heldCount = active_handshakes.filter((hs) => hs.status === 'accepted').length;
  const waitingCount = active_handshakes.filter((hs) => hs.status !== 'accepted').length;

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1320px]">
        <div className="rounded-[36px] border border-black/5 bg-[#141414] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="rounded-[30px] bg-[#f7f8fb] p-3 sm:p-4">
            <TopBar hospital={hospital} slug={slug} lastRefresh={lastRefresh} />

            <div className="mt-4 space-y-4">
              <div className="grid gap-4 xl:grid-cols-[1.45fr,1fr]">
                  <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Dashboard</p>
                        <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-slate-950">Hospital operations</h1>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                          Monitor bed availability, answer incoming requests, and keep ambulance pickups moving.
                        </p>
                      </div>
                      <div className="hidden flex-col gap-2 sm:flex">
                        <button
                          onClick={handleStillAccurate}
                          disabled={actionLoading._global}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-emerald-500 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-400"
                        >
                          {actionLoading._global === 'accurate' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          Mark As Current
                        </button>
                        <button
                          onClick={handleAllFull}
                          disabled={actionLoading._global}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-600 transition hover:bg-red-100"
                        >
                          {actionLoading._global === 'full' ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                          Mark All Full
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricCard icon={BedDouble} label="Open Beds" value={totalOpenBeds} sub={`of ${totalBeds || 0} total`} tone="emerald" />
                      <MetricCard icon={ClipboardList} label="Waiting" value={waitingCount} sub="Need a response" tone="amber" />
                      <MetricCard icon={CheckCircle2} label="Held Beds" value={heldCount} sub="Currently reserved" tone="sky" />
                      <MetricCard icon={Ambulance} label="Transport" value={transportRequests.length || 0} sub="Open pickups" tone="violet" />
                    </div>
                  </section>

                  <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Capacity snapshot</p>
                        <p className="mt-1 text-xs text-slate-500">Quick hospital health indicators</p>
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                        <TrendingUp size={16} />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <ProgressBand
                        label="Capacity in use"
                        value={totalBeds > 0 ? `${Math.round(((totalBeds - totalOpenBeds) / totalBeds) * 100)}%` : '0%'}
                        percent={totalBeds > 0 ? ((totalBeds - totalOpenBeds) / totalBeds) * 100 : 0}
                        tone="emerald"
                      />
                      <ProgressBand
                        label="Accuracy score"
                        value={`${Math.round((stats.accuracy_score || 0.5) * 100)}%`}
                        percent={(stats.accuracy_score || 0.5) * 100}
                        tone="sky"
                      />
                      <ProgressBand
                        label="Update freshness"
                        value={stats.hours_since_last_report != null ? `${stats.hours_since_last_report}h` : '—'}
                        percent={Math.max(0, 100 - ((stats.hours_since_last_report || 24) / 24) * 100)}
                        tone="amber"
                        helper={getFreshnessLabel(stats.hours_since_last_report)}
                      />
                    </div>
                  </section>
              </div>

              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Bed availability</p>
                    <p className="mt-1 text-xs text-slate-500">Adjust open beds for each care type.</p>
                  </div>
                  <div className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-[11px] text-slate-500 sm:flex">
                    <CircleDot size={12} />
                    Live controls
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {beds.map((bed) => (
                    <BedCard
                      key={bed.bed_type}
                      bed={bed}
                      draftValue={bedDrafts[bed.bed_type] ?? String(bed.available_count ?? 0)}
                      isLoading={actionLoading[bed.bed_type]}
                      onDraftChange={(value) => setBedDrafts((prev) => ({ ...prev, [bed.bed_type]: value }))}
                      onCommit={handleSetBedCount}
                      onIncrement={handleIncrement}
                      onDecrement={handleDecrement}
                    />
                  ))}
                </div>
              </section>

              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">Incoming patients</p>
                      {active_handshakes.length > 0 && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                          {active_handshakes.length}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Review requests and decide quickly.</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-h-[40px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
                      <Search size={13} />
                      Search…
                    </div>
                    <div className="flex min-h-[40px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
                      <Filter size={13} />
                      Sort
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="bg-transparent text-slate-700 outline-none"
                      >
                        <option value="time">Newest</option>
                        <option value="urgency">Urgency</option>
                      </select>
                    </div>
                  </div>
                </div>

                {active_handshakes.length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-500">No incoming patients right now.</div>
                ) : (
                  <div className="mt-5 space-y-3">
                    {sortedHandshakes.map((hs) => (
                      <PatientRequestCard
                        key={hs.id}
                        hs={hs}
                        hospital={hospital}
                        loading={actionLoading[`hs_${hs.id}`]}
                        onAccept={handleAccept}
                        onDecline={handleDecline}
                        onOverride={handleOverride}
                        onComplete={handleComplete}
                      />
                    ))}
                  </div>
                )}
              </section>

              {transportRequests.length > 0 && (
                <aside className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Transport requests</p>
                        <p className="mt-1 text-xs text-slate-500">Incoming ambulance pickup needs.</p>
                      </div>
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600">
                        {transportRequests.length}
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      {transportRequests.map((tr) => (
                        <TransportCard
                          key={tr.id}
                          tr={tr}
                          loading={actionLoading[`tr_${tr.id}`]}
                          onAccept={handleTransportAccept}
                          onDecline={handleTransportDecline}
                        />
                      ))}
                    </div>
                </aside>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({ hospital, slug, lastRefresh }) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium">
          <CircleDot size={12} className="text-emerald-400" />
          Dashboard
        </div>
        <div className="hidden items-center gap-2 rounded-full bg-white/[0.04] px-4 py-2 text-sm text-slate-300 md:flex">
          <ClipboardList size={13} />
          Patients
        </div>
        <div className="hidden items-center gap-2 rounded-full bg-white/[0.04] px-4 py-2 text-sm text-slate-300 md:flex">
          <Ambulance size={13} />
          Transport
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-h-[40px] items-center gap-2 rounded-full bg-white/[0.06] px-4 text-sm text-slate-300">
          <Search size={14} />
          Search
        </div>
        <Link
          to={`/log/${slug}`}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white text-sm font-medium text-slate-900 px-4 transition hover:bg-slate-100"
        >
          Open Patient Log
        </Link>
        <div className="text-right text-xs text-slate-400">
          <p>{hospital.name}</p>
          <p className="mt-0.5 flex items-center gap-1">
            <RefreshCw size={10} className="animate-spin" style={{ animationDuration: '10s' }} />
            {lastRefresh ? formatTime(lastRefresh.toISOString()) : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, tone }) {
  const CardIcon = icon;
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    sky: 'bg-sky-50 text-sky-600',
    violet: 'bg-violet-50 text-violet-600',
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-[1.65rem] font-semibold tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{sub}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tones[tone] || tones.sky}`}>
          <CardIcon size={16} />
        </div>
      </div>
    </div>
  );
}

function ProgressBand({ label, value, percent, tone, helper }) {
  const fill = {
    emerald: 'bg-emerald-500',
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
  }[tone] || 'bg-sky-500';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">{label}</p>
          {helper ? <p className="mt-1 text-sm text-slate-500">{helper}</p> : null}
        </div>
        <p className="text-base font-semibold text-slate-900">{value}</p>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(4, Math.min(percent, 100))}%` }} />
      </div>
    </div>
  );
}

function BedCard({ bed, draftValue, isLoading, onDraftChange, onCommit, onIncrement, onDecrement }) {
  const label = BED_LABELS[bed.bed_type] || bed.bed_type;
  const colors = BED_COLORS[bed.bed_type] || BED_COLORS.ward;
  const avail = bed.available_count || 0;
  const total = bed.total_count || 0;
  const percentUsed = total > 0 ? Math.max(0, Math.round(100 - (avail / total) * 100)) : 0;

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors.accent }} />
            <h3 className="text-base font-semibold text-slate-950">{label}</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">Updated {formatTime(bed.reported_at)}</p>
        </div>
        <div className="rounded-xl px-2.5 py-2 text-right" style={{ backgroundColor: colors.soft }}>
          <p className="text-base font-semibold text-slate-900">{percentUsed}% used</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max={total || undefined}
            value={draftValue}
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={() => onCommit(bed.bed_type, draftValue)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            aria-label={`${label} open beds`}
            className="w-14 border-0 bg-transparent p-0 text-2xl font-semibold text-slate-950 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-sm text-slate-500">of {total} open</span>
        </div>

        <div className="flex items-center gap-2">
        <button
          onClick={() => onDecrement(bed.bed_type)}
          disabled={isLoading || avail <= 0}
          aria-label={`Decrease ${label} open beds`}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading === 'dec' ? <Loader2 size={14} className="animate-spin" /> : <Minus size={14} />}
        </button>
        <button
          onClick={() => onIncrement(bed.bed_type)}
          disabled={isLoading || avail >= total}
          aria-label={`Increase ${label} open beds`}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: colors.accent }}
        >
          {isLoading === 'inc' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
        </div>
      </div>
      {isLoading === 'set' ? (
        <p className="mt-2 text-right text-xs text-slate-500">Saving…</p>
      ) : null}
    </div>
  );
}

function PatientRequestCard({ hs, hospital, loading, onAccept, onDecline, onOverride, onComplete }) {
  const isAccepted = hs.status === 'accepted';
  const remaining = hs.time_remaining_sec;
  const urgency = hs.parsed_requirements?.urgency || hs._urgency || 'medium';
  const urgencyMeta = URGENCY_META[urgency] || URGENCY_META.medium;
  const statusMeta = STATUS_META[hs.status] || STATUS_META.requested;

  return (
    <div className="rounded-[24px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
          <ClipboardList size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-base font-semibold text-slate-900">{hs.transfer_code}</p>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${urgencyMeta.className}`}>
                  {urgencyMeta.label}
                </span>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusMeta.className}`}>
                  {statusMeta.label}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {(hs.bed_type || '').toUpperCase()} bed request · Created {formatTime(hs.created_at)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              {!isAccepted ? (
                <>
                  <button
                    onClick={() => onAccept(hs.id)}
                    disabled={loading}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-full bg-emerald-500 px-3.5 text-xs font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {loading === 'accept' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Accept
                  </button>
                  <DeclineDropdown onDecline={(reason) => onDecline(hs.id, reason)} loading={loading === 'decline'} />
                </>
              ) : (
                <>
                  <button
                    onClick={() => onComplete(hs.id)}
                    disabled={loading}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-full bg-emerald-500 px-3.5 text-xs font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {loading === 'complete' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    Arrived
                  </button>
                  <OverrideButton
                    onOverride={(walkinUrgency) => onOverride(hs.id, walkinUrgency)}
                    loading={loading === 'override'}
                    transferCode={hs.transfer_code}
                    bedType={hs.bed_type}
                    heldUrgency={urgency}
                  />
                </>
              )}
            </div>
          </div>

          <p className="mt-3 text-[15px] leading-7 text-slate-700">{hs.patient_summary || 'Patient summary unavailable'}</p>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {isAccepted && remaining > 0 && (
              <span className="font-medium text-emerald-600">
                Hold expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </span>
            )}
            {isAccepted && hs.patient_lat && hs.patient_lng && (
              <PatientETA
                patientLat={hs.patient_lat}
                patientLng={hs.patient_lng}
                hospitalLat={hospital.lat}
                hospitalLng={hospital.lng}
                positionAt={hs.patient_position_at}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TransportCard({ tr, loading, onAccept, onDecline }) {
  return (
    <div className="rounded-[24px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-500">
          <Ambulance size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-slate-900">Ambulance pickup needed</p>
                <span className="inline-flex rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600">
                  {(tr.severity || 'medium').toUpperCase()}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">Transport request from patient flow</p>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                onClick={() => onAccept(tr.id)}
                disabled={loading}
                className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-full bg-emerald-500 px-3.5 text-xs font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {loading === 'accept' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Send
              </button>
              <button
                onClick={() => onDecline(tr.id)}
                disabled={loading}
                className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-full border border-red-200 bg-white px-3.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                {loading === 'decline' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                Decline
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-1">
            <p className="text-[15px] leading-7 text-slate-700">Pickup: {tr.pickup_address || 'Location shared'}</p>
            <p className="text-sm text-slate-500">Respond if your hospital can send an ambulance for this request.</p>
          </div>
        </div>
      </div>
    </div>
  );
}


function DeclineDropdown({ onDecline, loading }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        disabled={loading}
        className="inline-flex min-h-[38px] items-center gap-1 rounded-full border border-red-200 bg-white px-3.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
        Decline
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-2xl border border-slate-200 bg-white py-1 shadow-xl">
          {DECLINE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                onDecline(opt.id);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-xs text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              {opt.label}
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

  function handleSelect(urgency) {
    setSelectedUrgency(urgency);
    setStep('confirm');
  }

  function handleConfirm() {
    onOverride(selectedUrgency);
    setShowModal(false);
    setStep('select');
    setSelectedUrgency(null);
  }

  function handleClose() {
    setShowModal(false);
    setStep('select');
    setSelectedUrgency(null);
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        disabled={loading}
        className="inline-flex min-h-[38px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
        Override
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
          <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 p-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Zap size={14} className="text-red-500" />
                    Override bed hold
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {transferCode} · {(bedType || '').toUpperCase()}
                    {heldUrgency ? <span className="ml-1">· Currently {heldUrgency.toUpperCase()}</span> : null}
                  </p>
                </div>
                <button onClick={handleClose} className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900">
                  <X size={16} />
                </button>
              </div>
            </div>

            {step === 'select' ? (
              <div className="p-5">
                <p className="mb-3 text-xs text-slate-500">How urgent is the walk-in patient?</p>
                <div className="space-y-2">
                  {URGENCY_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleSelect(opt.id)}
                        className={`w-full rounded-2xl border p-3 text-left transition ${toneClass(opt.tone)}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${toneClass(opt.tone)}`}>
                            <Icon size={16} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{opt.label}</p>
                            <p className="text-xs text-slate-500">{opt.desc}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-5">
                <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 p-4">
                  <p className="mb-2 flex items-center gap-2 text-xs font-medium text-red-600">
                    <ShieldAlert size={14} />
                    This cannot be undone
                  </p>
                  <p className="text-sm leading-6 text-slate-700">
                    The current patient will lose this bed hold and be rerouted to another hospital automatically.
                  </p>
                </div>

                <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs">
                  <div className="mb-1 flex justify-between text-slate-500">
                    <span>Walk-in urgency</span>
                    <span className="font-medium text-slate-900">{selectedUrgency?.toUpperCase()}</span>
                  </div>
                  {heldUrgency && (
                    <div className="flex justify-between text-slate-500">
                      <span>Current hold urgency</span>
                      <span className="font-medium text-slate-900">{heldUrgency.toUpperCase()}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setStep('select')}
                    className="flex-1 rounded-full border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirm}
                    className="flex-1 rounded-full bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
                  >
                    Confirm
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

function PatientETA({ patientLat, patientLng, hospitalLat, hospitalLng, positionAt }) {
  const [eta, setEta] = useState(null);
  const [distance, setDistance] = useState(null);
  const fetchedRef = useRef(null);

  useEffect(() => {
    const key = `${patientLat.toFixed(4)},${patientLng.toFixed(4)}`;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;

    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;

    fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/` +
      `${patientLng},${patientLat};${hospitalLng},${hospitalLat}` +
      `?overview=false&access_token=${token}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.routes?.[0]) {
          setEta(Math.round(data.routes[0].duration / 60));
          setDistance((data.routes[0].distance / 1000).toFixed(1));
        }
      })
      .catch(() => {});
  }, [patientLat, patientLng, hospitalLat, hospitalLng]);

  const freshness = positionAt ? Math.round((new Date() - new Date(positionAt)) / 1000) : null;
  const isStale = freshness && freshness > 60;

  if (!eta) return null;

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1">
        <span className={`h-2 w-2 rounded-full ${isStale ? 'bg-slate-300' : 'bg-sky-500'}`} />
        <span className="text-xs font-medium text-sky-700">{eta} min</span>
        <span className="text-[11px] text-slate-500">{distance} km away</span>
      </div>
      {isStale ? <span className="text-[10px] text-slate-400">GPS {freshness}s ago</span> : null}
    </div>
  );
}
